/**
 * balancer-core/adapters/cdnvideohub.js — адаптер CDNVideoHub (CDN okcdn, srcIp).
 *
 * capabilities: cdn=okcdn, srcIp=true, castable=false, antiBot=none, resolveOn=device.
 *
 * Алгоритм (спек §4.5):
 *   1. GET plapi.cdnvideohub.com/api/v1/player/sv/playlist?pub=12&aggr=kp&id=<kp>
 *      → {items:[{cvhId, vkId, voiceStudio?, voiceType?, season?, episode?}]}
 *   2. Пропустить hex-32 vkId (мёртвые, HTTP 400).
 *   3. GET .../api/v1/player/sv/video/<vkId> → sources{mpeg*Url, dashUrl, hlsUrl}
 */

(function () {
  'use strict';

  var QMAP = {
    mpeg4kUrl: '4K', mpeg2kUrl: '2K', mpegQhdUrl: '1440p',
    mpegFullHdUrl: '1080p', mpegHighUrl: '720p', mpegMediumUrl: '480p',
    mpegLowUrl: '360p', mpegLowestUrl: '240p', mpegTinyUrl: '144p',
    dashUrl: 'DASH (.mpd)', hlsUrl: 'HLS'
  };

  function isDeadVkId(vkId) {
    return /^[0-9a-f]{32}$/i.test(String(vkId || ''));
  }

  function voiceClean(x) {
    x = (x || '').trim();
    if (/^неизвест/i.test(x)) return '';
    if (/^(unknown|undefined|null|n\/?a)$/i.test(x)) return '';
    return x;
  }

  function voiceName(it, fallback) {
    var s = voiceClean(it.voiceStudio), t = voiceClean(it.voiceType);
    if (s && t && s !== t) return s + ' (' + t + ')';
    return s || t || fallback || 'Стандарт';
  }

  function fetchQ(vkId, transport) {
    if (isDeadVkId(vkId)) return Promise.resolve(null);
    return transport.fetch('https://plapi.cdnvideohub.com/api/v1/player/sv/video/' + vkId, {}).then(function (r) {
      if (!r.ok) return null;
      return r.json();
    }).then(function (v) {
      var src = (v && v.sources) || {}, q = {};
      Object.keys(QMAP).forEach(function (k) { if (src[k]) q[QMAP[k]] = src[k]; });
      return Object.keys(q).length ? q : null;
    }).catch(function () { return null; });
  }

  var cdnvideohubAdapter = {
    id: 'cdnvideohub',
    name: 'CDNVideoHub',
    kind: 'both',
    capabilities: {
      cdn: 'okcdn',
      srcIp: true,
      castable: false,
      antiBot: 'none',
      resolveOn: 'device'
    },

    /**
     * @param {{ kp?: string }} query
     * @param {object} transport
     * @returns {Promise<import('../schema.js').Source>}
     */
    resolve: function (query, transport) {
      var kp = query.kp;
      if (!kp) {
        return Promise.resolve({ balancer: 'cdnvideohub', ok: false, error: 'kp обязателен', cdn: 'okcdn', castable: false, resolveOn: 'device' });
      }

      var fail = function (err) {
        return { balancer: 'cdnvideohub', ok: false, error: String(err && err.message || err), cdn: 'okcdn', castable: false, resolveOn: 'device' };
      };

      var url = 'https://plapi.cdnvideohub.com/api/v1/player/sv/playlist?pub=12&aggr=kp&id=' + kp;

      return transport.fetch(url, {}).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).then(function (d) {
        var items = d && d.items;
        if (!Array.isArray(items) || !items.length) return fail('нет items в playlist');

        // СЕРИАЛ
        var isSerial = items.some(function (it) { return it.season != null && it.episode != null && it.vkId; });
        if (isSerial) {
          var smap = {};
          items.forEach(function (it) {
            if (it.season == null || it.episode == null || !it.vkId) return;
            if (isDeadVkId(it.vkId)) return;
            var s = String(it.season), e = String(it.episode);
            smap[s] = smap[s] || {};
            (smap[s][e] = smap[s][e] || []).push({ name: voiceName(it, ''), vkId: it.vkId, cvhId: it.cvhId || it.vkId });
          });
          var sNums = Object.keys(smap).map(Number).sort(function (a, b) { return a - b; });
          if (!sNums.length) return fail('нет живых vkId в сериале');
          var seasons = sNums.map(function (sNum) {
            var eNums = Object.keys(smap[String(sNum)]).map(Number).sort(function (a, b) { return a - b; });
            var episodes = eNums.map(function (eNum) {
              var vmeta = smap[String(sNum)][String(eNum)];
              vmeta.sort(function (a, b) { return String(a.cvhId).localeCompare(String(b.cvhId)); });
              vmeta.forEach(function (vm, i) { if (!vm.name) vm.name = 'Озвучка ' + (i + 1); });
              return {
                num: eNum,
                title: 'Серия ' + eNum,
                resolve: function () {
                  return Promise.all(vmeta.map(function (vm) {
                    return fetchQ(vm.vkId, transport).then(function (q) {
                      return q ? { name: vm.name, id: vm.vkId, qualities: q } : null;
                    });
                  })).then(function (vs) { return vs.filter(Boolean); });
                }
              };
            });
            return { num: sNum, episodes: episodes };
          });
          return { balancer: 'cdnvideohub', ok: true, cdn: 'okcdn', castable: false, resolveOn: 'device', type: 'serial', seasons: seasons };
        }

        // ФИЛЬМ
        return Promise.all(items.map(function (it, i) {
          if (!it.vkId) return Promise.resolve(null);
          var nm = voiceName(it, items.length > 1 ? 'Озвучка ' + (i + 1) : 'Стандарт');
          return fetchQ(it.vkId, transport).then(function (q) {
            return q ? { name: nm, id: it.vkId, qualities: q } : null;
          });
        })).then(function (voices) {
          voices = voices.filter(Boolean);
          if (!voices.length) return fail('нет живых vkId или sources пусты');
          return { balancer: 'cdnvideohub', ok: true, cdn: 'okcdn', castable: false, resolveOn: 'device', type: 'movie', voices: voices };
        });
      }).catch(function (e) {
        return fail(e);
      });
    }
  };

  var API = { cdnvideohubAdapter: cdnvideohubAdapter };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  } else {
    var g = (typeof self !== 'undefined' ? self : window);
    g.BalancerCore = Object.assign(g.BalancerCore || {}, API);
  }
})();

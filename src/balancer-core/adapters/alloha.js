/**
 * balancer-core/adapters/alloha.js — адаптер Alloha (CDN vkvideo, srcIp, borth).
 *
 * capabilities: cdn=vkvideo, srcIp=true, castable=false, antiBot=borth, resolveOn=device.
 *
 * Алгоритм (спек §4.1):
 *   1. GET api.apbugall.org/?token=<tok>&kp=<kp> → структура фильм/сериал (iframe-ссылки)
 *   2. На клик озвучки: GET <iframe> (referer=playerOrigin) → viewporti из <meta>
 *   3. borth = RS + '|' + G7(G8(G9(viewporti)))
 *   4. POST <domain>/bnsi/movies/<id> headers{Borth,...} → hlsSource
 *
 * В рамках core/Node: шаг 1 работает полностью (отдаём iframe-ссылки как qualities).
 * Шаги 2-4 (borth+bnsi) выполняются при вызове resolve() ленивых серий/качеств.
 * Для smoke-теста: возвращаем ok=true если apbugall вернул данные с iframe.
 */

(function () {
  'use strict';

  var _secrets, _antibot, _schema;
  if (typeof module !== 'undefined' && module.exports) {
    _secrets = require('../secrets.js');
    _antibot = require('../antibot.js');
    _schema  = require('../schema.js');
  } else {
    var g = (typeof self !== 'undefined' ? self : window);
    _secrets = g.BalancerCore;
    _antibot = g.BalancerCore;
    _schema  = g.BalancerCore;
  }

  var ALLOHA_TOKEN = _secrets ? _secrets.TOK_ALLOHA_CRACKED : 'd317441359e505c343c2063edc97e7';

  // ─── Парсинг hlsSource из ответа /bnsi/movies ────────────────────────────────
  // Возвращает одну voice с audioTracks (audioMode="tracks"):
  // hlsSource[0] — мастер-поток (все дорожки в одном HLS); label = имя дорожки.
  function parseHlsSource(json, av1) {
    var hs = (json && json.hlsSource) || [];
    var rawTracks = (json && json.tracks) || [];
    var sharedSubs = _schema.allohaParseTracksSubs(rawTracks);

    // Берём первый поток с URL как мастер (все качества из него)
    var masterQ = null, masterName = null;
    var audioTracks = [];
    hs.forEach(function (s, idx) {
      var q = {}, qual = s.quality || {};
      Object.keys(qual).forEach(function (k) {
        var url = String(qual[k] || '').split(' or ')[0].trim();
        if (!url) return;
        var res = parseInt(k, 10);
        if (!av1 && res > 1080) return;
        q[k + 'p'] = url;
      });
      if (Object.keys(q).length) {
        if (!masterQ) { masterQ = q; masterName = s.label || 'Alloha'; }
        audioTracks.push({ name: s.label || ('Дорожка ' + (idx + 1)), index: idx });
      }
    });

    if (!masterQ) return null;

    var voice = { name: masterName, id: masterName, qualities: masterQ, audioTracks: audioTracks };
    if (sharedSubs.length) voice.subtitles = sharedSubs;
    return [voice];
  }

  // ─── Получить поток через borth+bnsi (no-tab, для Node) ─────────────────────
  // Шаги 2-4 спека §4.1.
  function fetchBnsiStream(iframeUrl, transport) {
    var playerOrigin;
    try { playerOrigin = new URL(iframeUrl).origin; } catch (e) { playerOrigin = 'https://larkin-as.stravers.live'; }

    // Шаг 2: GET iframe HTML → viewporti
    return transport.fetch(iframeUrl, {
      referer: playerOrigin + '/',
      creds: true,
      headers: { 'Accept': 'text/html,application/xhtml+xml' }
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' на плеере');
      return r.text();
    }).then(function (html) {
      var mVp = html.match(/<meta name="viewporti"\s+content="([^"]*)"/i);
      if (!mVp) throw new Error('нет <meta viewporti>');
      var viewporti = mVp[1];

      // media.id из fileList
      var mediaId = null;
      try {
        var mfl = html.match(/ fileList = JSON\.parse\('(\{.*\})'\);/);
        if (mfl) {
          var pl = JSON.parse(mfl[1]);
          if (pl && pl.all) {
            outer:
            for (var k1 in pl.all) {
              for (var k2 in pl.all[k1]) {
                for (var k3 in pl.all[k1][k2]) {
                  if (pl.all[k1][k2][k3] && pl.all[k1][k2][k3].id) {
                    mediaId = pl.all[k1][k2][k3].id;
                    break outer;
                  }
                }
              }
            }
          }
        }
      } catch (e) {}

      if (!mediaId) throw new Error('нет media.id в fileList');

      // Шаг 3: borth
      return _antibot.buildBorth(viewporti).then(function (borth) {
        var domain = playerOrigin + '/';
        var body = 'token=' + encodeURIComponent(ALLOHA_TOKEN) + '&av1=true&autoplay=0&audio=&subtitle=';

        // Шаг 4: POST /bnsi/movies/<id>
        return transport.fetch(domain + 'bnsi/movies/' + mediaId, {
          body: body,
          referer: iframeUrl,
          origin: playerOrigin,
          headers: {
            'borth': borth,
            'X-Requested-With': 'XMLHttpRequest',
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
          }
        });
      }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status + ' на /bnsi/movies');
        return r.json();
      }).then(function (json) {
        return parseHlsSource(json, true);
      });
    });
  }

  var allohaAdapter = {
    id: 'alloha',
    name: 'Alloha',
    kind: 'both',
    capabilities: {
      cdn: 'vkvideo',
      srcIp: true,
      castable: false,
      antiBot: 'borth',
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
        return Promise.resolve({ balancer: 'alloha', ok: false, error: 'kp обязателен', cdn: 'vkvideo', castable: false, resolveOn: 'device' });
      }

      var fail = function (err) {
        return { balancer: 'alloha', ok: false, error: String(err && err.message || err), cdn: 'vkvideo', castable: false, resolveOn: 'device' };
      };

      var apiUrl = 'https://api.apbugall.org/?token=' + ALLOHA_TOKEN + '&kp=' + kp;

      return transport.fetch(apiUrl, {}).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).then(function (d) {
        if (!d || d.status !== 'success' || !d.data) return fail('нет данных от apbugall');

        var ti0 = d.data.translation_iframe || {};
        var nameMap = {};
        Object.keys(ti0).forEach(function (k) { if (ti0[k]) nameMap[k] = ti0[k].name; });

        // СЕРИАЛ
        var sData = d.data.seasons;
        if (sData && typeof sData === 'object' && Object.keys(sData).length) {
          var sNums = Object.keys(sData).map(Number).sort(function (a, b) { return a - b; });
          var seasons = sNums.map(function (sNum) {
            var sObj = sData[String(sNum)];
            var eps = sObj && sObj.episodes;
            if (!eps || typeof eps !== 'object') return null;
            var eNums = Object.keys(eps).map(Number).sort(function (a, b) { return a - b; });
            var episodes = eNums.map(function (eNum) {
              var epObj = eps[String(eNum)];
              var tr = (epObj && epObj.translation) || {};
              // audioMode="tracks": одна voice per серия с audioTracks по озвучкам
              var tids = Object.keys(tr).filter(function (tid) { return tr[tid] && tr[tid].iframe; });
              var epVoices = [];
              if (tids.length) {
                var masterTid = tids[0];
                var masterTr  = tr[masterTid];
                var masterUrl = masterTr.iframe;
                var masterQ   = {};
                masterQ['плеер · iframe'] = masterUrl;
                var audioTracks = tids.map(function (tid, i) {
                  var t = tr[tid];
                  return {
                    name: nameMap[tid] || t.name || ('Озвучка ' + tid),
                    id: tid,
                    index: i,
                    resolveStream: (function (u) {
                      return function () { return fetchBnsiStream(u, transport); };
                    }(t.iframe))
                  };
                });
                epVoices = [{
                  name: nameMap[masterTid] || masterTr.name || ('Озвучка ' + masterTid),
                  id: masterTid,
                  qualities: masterQ,
                  audioTracks: audioTracks,
                  resolve: function () { return fetchBnsiStream(masterUrl, transport); }
                }];
              }
              return { num: eNum, title: 'Серия ' + eNum, voices: epVoices };
            });
            return { num: sNum, episodes: episodes.filter(Boolean) };
          }).filter(function (s) { return s && s.episodes.length; });
          if (seasons.length) {
            return { balancer: 'alloha', ok: true, cdn: 'vkvideo', castable: false, resolveOn: 'device', audioMode: 'tracks', type: 'serial', seasons: seasons };
          }
        }

        // ФИЛЬМ: translation_iframe → audioMode="tracks", одна voice + audioTracks
        var ti = d.data.translation_iframe;
        var masterVoice = null;

        if (ti && typeof ti === 'object') {
          var tiKeys = Object.keys(ti).filter(function (k) { return ti[k] && ti[k].iframe; });
          if (tiKeys.length) {
            // Первый ключ — мастер (его iframe идёт в qualities)
            var masterKey = tiKeys[0];
            var masterTi  = ti[masterKey];
            var masterUrl = masterTi.iframe;
            var masterQual = {};
            masterQual[(masterTi.quality || 'плеер') + ' · iframe'] = masterUrl;

            var audioTracks = tiKeys.map(function (k, i) {
              var t = ti[k];
              return {
                name: t.name || ('Озвучка ' + k),
                id: k,
                index: i,
                // ленивый resolve дорожки (borth на клик)
                resolveStream: (function (u) {
                  return function () { return fetchBnsiStream(u, transport); };
                }(t.iframe))
              };
            });

            masterVoice = {
              name: masterTi.name || ('Озвучка ' + masterKey),
              id: masterKey,
              qualities: masterQual,
              audioTracks: audioTracks,
              resolve: function () { return fetchBnsiStream(masterUrl, transport); }
            };
          }
        }

        if (!masterVoice && d.data.iframe) {
          var q0 = {};
          q0['плеер · iframe'] = d.data.iframe;
          var url0 = d.data.iframe;
          masterVoice = {
            name: 'Плеер', id: 0, qualities: q0,
            audioTracks: [{ name: 'Плеер', index: 0 }],
            resolve: function () { return fetchBnsiStream(url0, transport); }
          };
        }

        if (!masterVoice) return fail('нет iframe в ответе apbugall');
        return { balancer: 'alloha', ok: true, cdn: 'vkvideo', castable: false, resolveOn: 'device', audioMode: 'tracks', type: 'movie', voices: [masterVoice] };
      }).catch(function (e) {
        return fail(e);
      });
    }
  };

  var API = { allohaAdapter: allohaAdapter };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  } else {
    var g = (typeof self !== 'undefined' ? self : window);
    g.BalancerCore = Object.assign(g.BalancerCore || {}, API);
  }
})();

/**
 * balancer-core/adapters/kodik.js — адаптер Kodik (CDN solodcdn, открыт).
 *
 * capabilities: cdn=solodcdn, srcIp=false, castable=true, antiBot=ftor, resolveOn=any.
 *
 * Алгоритм (спек §4.2):
 *   1. GET kodik-api.com/search?kinopoisk_id=<kp>&token=<tok>&with_seasons&with_episodes
 *   2. Для каждого result (озвучки/серии): GET iframe-link → парсим urlParams/vInfo
 *   3. POST https://kodikplayer.com/ftor body{d,d_sign,pd,pd_sign,ref,ref_sign,type,hash,id}
 *      Referer=kodikplayer.com, Origin=kodikplayer.com
 *   4. Декодируем links[q][].src: ROT18+base64 → прямой .m3u8
 */

(function () {
  'use strict';

  var _secrets, _antibot;
  if (typeof module !== 'undefined' && module.exports) {
    _secrets = require('../secrets.js');
    _antibot = require('../antibot.js');
  } else {
    var g = (typeof self !== 'undefined' ? self : window);
    _secrets = g.BalancerCore;
    _antibot = g.BalancerCore;
  }

  // ─── Парсинг HTML плеера Kodik ────────────────────────────────────────────────
  function kodikParsePlayerHtml(html) {
    if (!html) return null;

    function getJsVar(name) {
      var m = html.match(new RegExp('var\\s+' + name + '\\s*=\\s*["\']([^"\']+)["\']'));
      return m ? m[1] : null;
    }

    var d        = getJsVar('domain') || 'kodikplayer.com';
    var d_sign   = getJsVar('d_sign');
    var pd       = getJsVar('pd') || d;
    var pd_sign  = getJsVar('pd_sign') || d_sign;
    var ref      = getJsVar('ref') || 'https://kodikplayer.com/';
    var ref_sign = getJsVar('ref_sign');

    if (!d_sign) {
      try {
        var mParams = html.match(/urlParams\s*=\s*'(\{.*?\})'/);
        if (mParams) {
          var p = JSON.parse(mParams[1]);
          d        = p.d        || d;
          d_sign   = p.d_sign   || d_sign;
          pd       = p.pd       || pd;
          pd_sign  = p.pd_sign  || pd_sign;
          ref      = p.ref ? decodeURIComponent(p.ref) : ref;
          ref_sign = p.ref_sign || ref_sign;
        }
      } catch (e) {}
    }

    if (!d_sign) return null;

    var type = (html.match(/vInfo\.type\s*=\s*'([^']+)'/) || [])[1];
    var hash = (html.match(/vInfo\.hash\s*=\s*'([^']+)'/) || [])[1];
    var id   = (html.match(/vInfo\.id\s*=\s*'([^']+)'/) || [])[1];

    if (!type || !hash || !id) return null;

    return { d: d, d_sign: d_sign, pd: pd, pd_sign: pd_sign, ref: ref, ref_sign: ref_sign,
             type: type, hash: hash, id: id };
  }

  // ─── POST /ftor → qualities ──────────────────────────────────────────────────
  function fetchFtor(playerUrl, parsed, transport) {
    var fullPlayerUrl = playerUrl.startsWith('//') ? 'https:' + playerUrl : playerUrl;

    var params = [
      'd=' + encodeURIComponent(parsed.d),
      'd_sign=' + encodeURIComponent(parsed.d_sign),
      'pd=' + encodeURIComponent(parsed.pd),
      'pd_sign=' + encodeURIComponent(parsed.pd_sign),
      'ref=' + encodeURIComponent(parsed.ref),
      'ref_sign=' + encodeURIComponent(parsed.ref_sign || ''),
      'bad_user=false',
      'cdn_is_working=false',
      'type=' + encodeURIComponent(parsed.type),
      'hash=' + encodeURIComponent(parsed.hash),
      'id=' + encodeURIComponent(parsed.id)
    ];
    var body = params.join('&');

    return transport.fetch('https://kodikplayer.com/ftor', {
      body: body,
      referer: fullPlayerUrl,
      origin: 'https://kodikplayer.com',
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Accept': 'application/json, text/javascript, */*; q=0.01'
      }
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' на /ftor');
      return r.json();
    });
  }

  // ─── Построить qualities из links ────────────────────────────────────────────
  function linksToQualities(links) {
    var q = {};
    if (!links || typeof links !== 'object') return q;
    Object.keys(links).forEach(function (quality) {
      var items = links[quality];
      if (!Array.isArray(items) || !items.length) return;
      var src = items[0].src || '';
      if (!src) return;
      var decoded = _antibot.kodikDecodeUrl(src);
      if (!decoded) return;
      var url = decoded.startsWith('//') ? 'https:' + decoded : decoded;
      q[quality + 'p'] = url;
    });
    return q;
  }

  // ─── Разворачивание одного iframe-link → [{name,id,qualities}] ──────────────
  function resolveLink(playerUrl, voiceName, voiceId, transport) {
    var fullUrl = playerUrl.startsWith('//') ? 'https:' + playerUrl : playerUrl;
    return transport.fetch(fullUrl, {
      referer: 'https://kodikplayer.com/',
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    }).then(function (html) {
      var parsed = kodikParsePlayerHtml(html);
      if (!parsed) throw new Error('нет vInfo или d_sign в HTML');
      return fetchFtor(playerUrl, parsed, transport);
    }).then(function (data) {
      var q = linksToQualities(data.links);
      var qCount = Object.keys(q).length;
      if (!qCount) throw new Error('пустой links после декодирования');
      return [{ name: voiceName || 'Kodik', id: voiceId || 0, qualities: q }];
    });
  }

  var kodikAdapter = {
    id: 'kodik',
    name: 'Kodik',
    kind: 'both',
    capabilities: {
      cdn: 'solodcdn',
      srcIp: false,
      castable: true,
      antiBot: 'ftor',
      resolveOn: 'any'
    },

    /**
     * @param {{ kp?: string, title?: string }} query
     * @param {object} transport
     * @returns {Promise<import('../schema.js').Source>}
     */
    resolve: function (query, transport) {
      var token = _secrets.deriveToken('kodik');
      var fail = function (err) {
        return { balancer: 'kodik', ok: false, error: String(err && err.message || err), cdn: 'solodcdn', castable: true, resolveOn: 'any' };
      };

      // Строим URL поиска (приоритет kp, потом title)
      var searchUrl;
      if (query.kp) {
        searchUrl = 'https://kodik-api.com/search?kinopoisk_id=' + encodeURIComponent(query.kp) +
          '&token=' + token + '&with_seasons=true&with_episodes=true&limit=100';
      } else if (query.title) {
        searchUrl = 'https://kodik-api.com/search?title=' + encodeURIComponent(query.title) +
          '&token=' + token + '&with_seasons=true&with_episodes=true&limit=100';
      } else {
        return Promise.resolve(fail('нужен kp или title'));
      }

      return transport.fetch(searchUrl, {}).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).then(function (d) {
        if (!d || !d.results || !d.results.length) {
          return { balancer: 'kodik', ok: false, error: 'не найден', cdn: 'solodcdn', castable: true, resolveOn: 'any' };
        }

        var hasSeasons = d.results.some(function (r) { return r.seasons && typeof r.seasons === 'object'; });

        if (hasSeasons) {
          // СЕРИАЛ: строим seasonMap → episodes с ленивым resolve
          var seasonMap = {};
          d.results.forEach(function (r) {
            if (!r.seasons) return;
            var voiceName = (r.translation && r.translation.title) || 'Неизвестно';
            var voiceId   = (r.translation && r.translation.id)    || 'd';
            Object.keys(r.seasons).forEach(function (sKey) {
              var sNum = parseInt(sKey, 10);
              var season = r.seasons[sKey];
              var episodes = season && season.episodes;
              if (!episodes) return;
              if (!seasonMap[sNum]) seasonMap[sNum] = {};
              Object.keys(episodes).forEach(function (epKey) {
                var epNum = parseInt(epKey, 10);
                var link = episodes[epKey];
                if (!link) return;
                if (!seasonMap[sNum][epNum]) seasonMap[sNum][epNum] = [];
                seasonMap[sNum][epNum].push({ voiceName: voiceName, voiceId: voiceId, link: link });
              });
            });
          });

          var sNums = Object.keys(seasonMap).map(Number).sort(function (a, b) { return a - b; });
          if (!sNums.length) return fail('нет серий в seasonMap');

          var seasons = sNums.map(function (sNum) {
            var epNums = Object.keys(seasonMap[sNum]).map(Number).sort(function (a, b) { return a - b; });
            var episodes = epNums.map(function (epNum) {
              var vList = seasonMap[sNum][epNum];
              return {
                num: epNum,
                title: 'Серия ' + epNum,
                resolve: (function (voices) {
                  return function () {
                    return Promise.all(voices.map(function (v) {
                      return resolveLink(v.link, v.voiceName, v.voiceId, transport)
                        .catch(function () { return null; });
                    })).then(function (results) {
                      var all = [];
                      results.forEach(function (vs) { if (vs) vs.forEach(function (v) { all.push(v); }); });
                      return all;
                    });
                  };
                }(vList))
              };
            });
            return { num: sNum, episodes: episodes };
          });
          return { balancer: 'kodik', ok: true, cdn: 'solodcdn', castable: true, resolveOn: 'any', type: 'serial', seasons: seasons };
        }

        // ФИЛЬМ: разворачиваем все озвучки сразу
        return Promise.all(d.results.map(function (r) {
          var voiceName = (r.translation && r.translation.title) || 'Неизвестно';
          var voiceId   = (r.translation && r.translation.id)    || 'd';
          var link      = r.link || '';
          return resolveLink(link, voiceName, voiceId, transport).catch(function () { return null; });
        })).then(function (results) {
          var all = [];
          results.forEach(function (vs) { if (vs) vs.forEach(function (v) { all.push(v); }); });
          if (!all.length) return fail('не удалось декодировать ни одного потока');
          return { balancer: 'kodik', ok: true, cdn: 'solodcdn', castable: true, resolveOn: 'any', type: 'movie', voices: all };
        });
      }).catch(function (e) {
        return fail(e);
      });
    }
  };

  var API = { kodikAdapter: kodikAdapter };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  } else {
    var g = (typeof self !== 'undefined' ? self : window);
    g.BalancerCore = Object.assign(g.BalancerCore || {}, API);
  }
})();

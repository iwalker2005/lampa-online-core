/**
 * balancer-core/adapters/hdrezka.js — адаптер HDrezka (CDN voidboost, открыт).
 *
 * capabilities: cdn=voidboost, srcIp=false, castable=true, antiBot=none, resolveOn=any.
 *
 * Алгоритм (спек §4.4):
 *   1. apbugall(kp) → meta name/year
 *   2. POST hdrezka.me/engine/ajax/search.php?q=<name> → ищем страницу
 *   3. GET страница → filmId, переводчики, inline-стримы
 *   4. POST /ajax/get_cdn_series/?t=... action=get_movie per translator → clearTrash → Playerjs
 *   Сериал: action=get_episodes → сезоны; action=get_stream per серия × переводчик
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
  var HD = 'https://hdrezka.me';

  // ─── Хелперы парсинга Playerjs (порт из balancer-search.js) ─────────────────

  function rezkaStripHtml(s) { return String(s || '').replace(/<[^>]+>/g, '').trim(); }

  function rezkaParseItems(str) {
    str = _antibot.clearTrash(str || '');
    var out = [], seen = {};
    str.split(',').forEach(function (chunk) {
      var m = chunk.trim().match(/^\[([^\]]+)\](.*)/);
      if (!m) return;
      var label = rezkaStripHtml(m[1]);
      if (!label) return;
      var links = m[2].replace(/\\\//g, '/').split(/ or /).map(function (s) { return s.trim(); }).filter(Boolean);
      if (!links.length) return;
      var url = links[0];
      if (url.indexOf('http') !== 0) url = 'https:' + url;
      var hashM = url.match(/\/([a-f0-9]{32}):/i), hash = hashM ? hashM[1] : url;
      if (seen[hash]) return;
      seen[hash] = true;
      out.push({ label: label, url: url });
    });
    return out;
  }

  function rezkaItemsToQualities(items) {
    var q = {};
    items.forEach(function (it) { q[it.label] = it.url; });
    return q;
  }

  // ─── AJAX-запрос на hdrezka ──────────────────────────────────────────────────
  function ajaxPost(body, transport) {
    var rand = Math.floor(Math.random() * 899) + 101;
    return transport.fetch(HD + '/ajax/get_cdn_series/?t=' + (Date.now() + rand), {
      body: body,
      referer: HD + '/',
      origin: HD,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest'
      }
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  // ─── Одна озвучка фильма (AJAX get_movie) ────────────────────────────────────
  function fetchVoice(filmId, tr, favs, transport) {
    var body = 'id=' + filmId + '&translator_id=' + tr.id +
      '&is_camrip=0&is_ads=0&is_director=0&favs=' + encodeURIComponent(favs) + '&action=get_movie';
    return ajaxPost(body, transport).then(function (json) {
      if (!json || !json.success || !json.url || json.premium_content) return null;
      var items = rezkaParseItems(json.url);
      if (!items.length) return null;
      var subs = _schema.rezkaParseSubtitles(json.subtitle, json.subtitle_lns);
      var voice = { name: tr.name, id: tr.id, qualities: rezkaItemsToQualities(items) };
      if (subs.length) voice.subtitles = subs;
      return voice;
    }).catch(function () { return null; });
  }

  // ─── Парсинг HTML-фрагмента get_episodes (seasons/episodes) ─────────────────
  function rezkaSerialFromHtml(content, filmId, trs, favs, transport) {
    var seasonNums = [];
    var sreSeason = /data-tab="season-(\d+)"/g, sm;
    while ((sm = sreSeason.exec(content))) {
      var sn = parseInt(sm[1], 10);
      if (seasonNums.indexOf(sn) === -1) seasonNums.push(sn);
    }
    if (!seasonNums.length) seasonNums.push(1);
    seasonNums.sort(function (a, b) { return a - b; });

    var epMap = {};
    var sreEp = /<(?:li|a)[^>]+class="[^"]*b-simple_episode__item[^"]*"[^>]*data-season_id="(\d+)"[^>]*data-episode_id="(\d+)"[^>]*>([^<]*)</g, em;
    while ((em = sreEp.exec(content))) {
      var sNum = parseInt(em[1], 10), eNum = parseInt(em[2], 10), eName = (em[3] || '').trim();
      if (!epMap[sNum]) epMap[sNum] = [];
      epMap[sNum].push({ num: eNum, title: eName || ('Серия ' + eNum) });
    }
    if (!Object.keys(epMap).length) {
      var sreEp2 = /data-season_id="(\d+)"[^>]*data-episode_id="(\d+)"/g, em2;
      while ((em2 = sreEp2.exec(content))) {
        var s2 = parseInt(em2[1], 10), e2 = parseInt(em2[2], 10);
        if (!epMap[s2]) epMap[s2] = [];
        if (!epMap[s2].some(function (x) { return x.num === e2; })) epMap[s2].push({ num: e2, title: 'Серия ' + e2 });
      }
    }
    return rezkaSerialBuild(seasonNums, epMap, filmId, trs, favs, transport);
  }

  function rezkaSerialFromObj(seasonsObj, filmId, trs, favs, transport) {
    var seasonNums = Object.keys(seasonsObj).map(Number).sort(function (a, b) { return a - b; });
    if (!seasonNums.length) return null;
    var epMap = {};
    seasonNums.forEach(function (sNum) {
      var eps = seasonsObj[String(sNum)] || {};
      epMap[sNum] = Object.keys(eps).map(Number).sort(function (a, b) { return a - b; }).map(function (eNum) {
        return { num: eNum, title: String(eps[String(eNum)] || ('Серия ' + eNum)).trim() || ('Серия ' + eNum) };
      });
    });
    return rezkaSerialBuild(seasonNums, epMap, filmId, trs, favs, transport);
  }

  function rezkaSerialBuild(seasonNums, epMap, filmId, trs, favs, transport) {
    function streamBody(filmId, trId, season, episode) {
      return 'id=' + filmId + '&translator_id=' + trId +
        '&season=' + season + '&episode=' + episode +
        '&favs=' + encodeURIComponent(favs) + '&action=get_stream';
    }
    function fetchStream(trId, season, episode) {
      return ajaxPost(streamBody(filmId, trId, season, episode), transport)
        .catch(function () { return null; });
    }

    var seasons = seasonNums.map(function (sNum) {
      var eps = (epMap[sNum] || []);
      if (!eps.length) return null;
      var episodes = eps.map(function (ep) {
        return {
          num: ep.num,
          title: ep.title,
          resolve: function () {
            return Promise.all(trs.map(function (tr) {
              return fetchStream(tr.id, sNum, ep.num).then(function (json) {
                if (!json || !json.success || !json.url || json.premium_content) return null;
                var items = rezkaParseItems(json.url);
                if (!items.length) return null;
                var subs = _schema.rezkaParseSubtitles(json.subtitle, json.subtitle_lns);
                var voice = { name: tr.name, id: tr.id, qualities: rezkaItemsToQualities(items) };
                if (subs.length) voice.subtitles = subs;
                return voice;
              }).catch(function () { return null; });
            })).then(function (vs) { return vs.filter(Boolean); });
          }
        };
      });
      return { num: sNum, episodes: episodes };
    }).filter(Boolean);
    return seasons.length ? { serial: true, seasons: seasons } : null;
  }

  var hdrezkaAdapter = {
    id: 'hdrezka',
    name: 'HDrezka',
    kind: 'both',
    capabilities: {
      cdn: 'voidboost',
      srcIp: false,
      castable: true,
      antiBot: 'none',
      resolveOn: 'any'
    },

    /**
     * @param {{ kp?: string }} query
     * @param {object} transport
     * @returns {Promise<import('../schema.js').Source>}
     */
    resolve: function (query, transport) {
      var kp = query.kp;
      if (!kp) {
        return Promise.resolve({ balancer: 'hdrezka', ok: false, error: 'kp обязателен', cdn: 'voidboost', castable: true, resolveOn: 'any' });
      }

      var fail = function (err) {
        return { balancer: 'hdrezka', ok: false, error: String(err && err.message || err), cdn: 'voidboost', castable: true, resolveOn: 'any' };
      };

      // Шаг 1: apbugall → meta (название/год)
      var apbugallUrl = 'https://api.apbugall.org/?token=' + ALLOHA_TOKEN + '&kp=' + kp;
      return transport.fetch(apbugallUrl, {}).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status + ' на apbugall');
        return r.json();
      }).then(function (meta) {
        if (!meta || meta.status !== 'success' || !meta.data) throw new Error('нет данных от apbugall');
        var data = meta.data;
        var searchTitle = (data.original_name || data.name || '').trim();
        var year = parseInt(data.year, 10) || 0;
        if (!searchTitle) throw new Error('нет названия в ответе apbugall');

        // Шаг 2: поиск по hdrezka
        function search(q) {
          return transport.fetch(HD + '/engine/ajax/search.php', {
            body: 'q=' + encodeURIComponent(q),
            referer: HD + '/',
            origin: HD,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' }
          }).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.text();
          }).then(function (html) {
            var re = /href="(https:\/\/hdrezka\.me\/[^"]+\/(\d+)-([^"]+)\.html)"/g, m, c = [];
            while ((m = re.exec(html))) {
              c.push({ url: m[1], id: m[2], slugYear: parseInt((m[3].match(/-(\d{4})-/) || [, '0'])[1], 10) });
            }
            return c;
          });
        }

        return search(searchTitle).then(function (c) {
          return (c && c.length) ? c : search(data.name || '');
        }).then(function (candidates) {
          if (!candidates || !candidates.length) throw new Error('не найден на HDrezka');
          var best = candidates[0];
          if (year) { var by = candidates.filter(function (x) { return x.slugYear === year; }); if (by.length) best = by[0]; }

          // Шаг 3: GET страница фильма
          return transport.fetch(best.url, {
            referer: HD + '/',
            headers: { 'Accept-Language': 'ru-RU,ru;q=0.9' }
          }).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status + ' на странице фильма');
            return r.text();
          }).then(function (html) {
            var mSeries = html.match(/initCDNSeriesEvents\((\d+),\s*(\d+)/);
            var mMovie  = html.match(/initCDNMoviesEvents\((\d+),\s*(\d+)/);
            var mInit = mSeries || mMovie;
            if (!mInit) throw new Error('нет initCDNEvents на странице');
            var filmId = mInit[1], defTr = mInit[2];
            var isSeries = !!mSeries;

            var trRe = /data-translator_id="(\d+)"[^>]*>([^<]+)</g, tm, trs = [], seenTr = {};
            while ((tm = trRe.exec(html))) {
              if (!seenTr[tm[1]]) { seenTr[tm[1]] = 1; trs.push({ id: tm[1], name: tm[2].trim() }); }
            }
            if (!trs.length) trs.push({ id: defTr, name: 'Дубляж' });
            var favs = (html.match(/favs[:=]["']([a-f0-9\-]{36})["']/i) || [])[1] || '';

            // СЕРИАЛ
            if (isSeries) {
              var epsBody = 'id=' + filmId + '&translator_id=' + defTr +
                '&favs=' + encodeURIComponent(favs) + '&action=get_episodes';
              return ajaxPost(epsBody, transport).then(function (epJson) {
                if (!epJson || !epJson.success) throw new Error('get_episodes вернул false');
                var content = epJson.content || epJson.episodes || '';
                var result;
                if (!content && epJson.seasons) {
                  result = rezkaSerialFromObj(epJson.seasons, filmId, trs, favs, transport);
                } else if (content) {
                  result = rezkaSerialFromHtml(content, filmId, trs, favs, transport);
                }
                if (!result) throw new Error('не удалось распарсить структуру сериала');
                return { balancer: 'hdrezka', ok: true, cdn: 'voidboost', castable: true, resolveOn: 'any', audioMode: 'separate', type: 'serial', seasons: result.seasons };
              });
            }

            // ФИЛЬМ: инлайн-стримы + AJAX
            var mStreams = html.match(/"streams":"([^"]+)"/);
            var defItems = mStreams ? rezkaParseItems(mStreams[1].replace(/\\\//g, '/')) : [];

            var mSubStr = html.match(/"subtitle":"([^"]*)"/) || html.match(/"subtitle":(false)/);
            var mSubLns = html.match(/"subtitle_lns":(\{[^}]*\})/);
            var defSubRaw = mSubStr ? mSubStr[1].replace(/\\u([0-9a-f]{4})/gi, function (_, h) { return String.fromCharCode(parseInt(h, 16)); }) : '';
            var defSubLns = {};
            if (mSubLns) { try { defSubLns = JSON.parse(mSubLns[1]); } catch (e) {} }

            var voicePromises = trs.map(function (tr) {
              if (tr.id === defTr && defItems.length) {
                var defSubs = _schema.rezkaParseSubtitles(defSubRaw, defSubLns);
                if (defSubs.length) {
                  return Promise.resolve({ name: tr.name, id: tr.id, qualities: rezkaItemsToQualities(defItems), subtitles: defSubs });
                }
                return fetchVoice(filmId, tr, favs, transport).then(function (v) {
                  if (!v) return { name: tr.name, id: tr.id, qualities: rezkaItemsToQualities(defItems) };
                  return v;
                });
              }
              return fetchVoice(filmId, tr, favs, transport);
            });

            return Promise.all(voicePromises).then(function (vs) {
              var voices = vs.filter(Boolean);
              if (!voices.length) throw new Error('нет озвучек после get_movie');
              return { balancer: 'hdrezka', ok: true, cdn: 'voidboost', castable: true, resolveOn: 'any', audioMode: 'separate', type: 'movie', voices: voices };
            });
          });
        });
      }).catch(function (e) {
        return fail(e);
      });
    }
  };

  var API = { hdrezkaAdapter: hdrezkaAdapter };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  } else {
    var g = (typeof self !== 'undefined' ? self : window);
    g.BalancerCore = Object.assign(g.BalancerCore || {}, API);
  }
})();

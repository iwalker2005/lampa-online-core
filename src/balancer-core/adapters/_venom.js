/**
 * balancer-core/adapters/_venom.js — общий парсер VenomPlayer (Collaps + femd).
 * Порт из balancer-search.js (parseMakePlayer / parseMakePlayerSerial).
 * Внутренний модуль, не экспортируется напрямую в BalancerCore.
 */

(function () {
  'use strict';

  var _schema;
  if (typeof module !== 'undefined' && module.exports) {
    _schema = require('../schema.js');
  } else {
    var g = (typeof self !== 'undefined' ? self : window);
    _schema = g.BalancerCore;
  }

  function collapsParseCC(ccArr) {
    return _schema.collapsParseCC(ccArr);
  }

  // ─── Парсер сериала VenomPlayer ───────────────────────────────────────────────
  function parseMakePlayerSerial(html, startIdx) {
    var arrStart = html.indexOf('[', startIdx + 'seasons:'.length);
    if (arrStart === -1) return null;
    var depth = 0, i, c;
    for (i = arrStart; i < html.length; i++) {
      c = html[i];
      if (c === '[' || c === '{') depth++;
      else if (c === ']' || c === '}') { depth--; if (depth === 0) break; }
    }
    var arrJson = html.slice(arrStart, i + 1);
    var rawSeasons;
    try { rawSeasons = JSON.parse(arrJson); } catch (e) { return null; }
    if (!Array.isArray(rawSeasons) || !rawSeasons.length) return null;

    var seasons = [];
    rawSeasons.forEach(function (rs) {
      if (!rs || rs.blocked || !Array.isArray(rs.episodes) || !rs.episodes.length) return;
      var seasonNum = rs.season || rs.season_num || 0;
      var episodes = [];
      rs.episodes.forEach(function (ep) {
        var epNum = ep.episode != null ? parseInt(ep.episode, 10) : null;
        if (epNum == null || (!ep.hls && !ep.dash)) return;
        var q = {};
        if (ep.hls)  q['HLS (.m3u8)'] = ep.hls;
        if (ep.dash) q['DASH (.mpd)'] = ep.dash;
        var audioNames = (ep.audio && Array.isArray(ep.audio.names) && ep.audio.names.length)
          ? ep.audio.names : ['Основной'];
        var epSubs = collapsParseCC(ep.cc);
        var voices = audioNames.map(function (n, idx) {
          var v = { name: n, id: idx, qualities: q };
          if (epSubs.length) v.subtitles = epSubs;
          return v;
        });
        episodes.push({ num: epNum, title: ep.title || ('Серия ' + epNum), voices: voices });
      });
      if (episodes.length) {
        episodes.sort(function (a, b) { return a.num - b.num; });
        seasons.push({ num: seasonNum, episodes: episodes });
      }
    });
    if (!seasons.length) return null;
    seasons.sort(function (a, b) { return a.num - b.num; });
    return { serial: true, seasons: seasons };
  }

  // ─── Основной парсер VenomPlayer/makePlayer ──────────────────────────────────
  /**
   * @param {string} html
   * @returns {{ voices: Voice[] } | { serial: true, seasons: Season[] } | null}
   */
  function parseMakePlayer(html) {
    html = String(html || '').replace(/\r/g, '');

    // Сериал
    var seasonsIdx = html.indexOf('seasons:[{');
    if (seasonsIdx !== -1) {
      return parseMakePlayerSerial(html, seasonsIdx);
    }

    // Фильм
    var mHls  = html.match(/["']?hls["']?\s*:\s*["'](https?:[^"']+\.m3u8[^"']*)["']/i);
    var mDash = html.match(/["']?dash["']?\s*:\s*["'](https?:[^"']+\.mpd[^"']*)["']/i);
    if (!mHls && !mDash) return null;

    var names = ['Основной'];
    var mNames = html.match(/["']names["']\s*:\s*(\[[^\]]*\])/i);
    if (mNames) {
      try {
        var a = JSON.parse(mNames[1]);
        if (Array.isArray(a) && a.length) names = a;
      } catch (e) {}
    }

    var q = {};
    if (mHls)  q['HLS (.m3u8)'] = mHls[1];
    if (mDash) q['DASH (.mpd)'] = mDash[1];

    var filmSubs = [];
    var mCC = html.match(/\bcc\s*:\s*(\[[^\]]*\])/);
    if (mCC) {
      try { filmSubs = collapsParseCC(JSON.parse(mCC[1])); } catch (e) {}
    }

    return {
      voices: names.map(function (n, i) {
        var v = { name: n, id: i, qualities: q };
        if (filmSubs.length) v.subtitles = filmSubs;
        return v;
      })
    };
  }

  var API = { parseMakePlayer: parseMakePlayer };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  } else {
    var g = (typeof self !== 'undefined' ? self : window);
    g.BalancerCore = Object.assign(g.BalancerCore || {}, API);
  }
})();

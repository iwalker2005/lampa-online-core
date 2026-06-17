/**
 * balancer-core/schema.js — JSDoc-типы контракта (раздел 1 спека) + хелперы нормализации.
 *
 * @typedef {{ kp?: string, title?: string, imdb?: string }} BalancerQuery
 *
 * @typedef {{ lang: string, label: string, url: string, format: 'vtt'|'srt' }} SubtitleTrack
 *
 * @typedef {{ name: string, lang: string }} AudioTrack
 *
 * @typedef {{
 *   name: string,
 *   id: string|number,
 *   qualities: Object.<string,string>,
 *   audioTracks?: AudioTrack[],
 *   subtitles?: SubtitleTrack[]
 * }} Voice
 *
 * @typedef {{
 *   num: number,
 *   title: string,
 *   voices?: Voice[],
 *   resolve?: () => Promise<Voice[]>
 * }} Episode
 *
 * @typedef {{ num: number, episodes: Episode[] }} Season
 *
 * @typedef {{
 *   balancer: string,
 *   ok: boolean,
 *   error?: string,
 *   cdn: string,
 *   castable: boolean,
 *   resolveOn: 'device'|'any',
 *   voices?: Voice[],
 *   seasons?: Season[]
 * }} Source
 *
 * @typedef {{
 *   query: BalancerQuery,
 *   title?: string,
 *   year?: number,
 *   type: 'movie'|'serial',
 *   sources: Source[]
 * }} ResolveResult
 */

(function () {
  'use strict';

  /** Определить язык из строкового лейбла субтитра. */
  function subLangFromLabel(label) {
    label = String(label || '').toLowerCase();
    if (/\bru(ss?)\b|рус|русск/.test(label)) return 'ru';
    if (/\ben(gl)?\b|english|sdh/.test(label)) return 'en';
    if (/\buk[r]?\b|укр/.test(label)) return 'uk';
    if (/\bde\b|deuts/.test(label)) return 'de';
    if (/\bfr\b|franc/.test(label)) return 'fr';
    if (/\bes\b|span/.test(label)) return 'es';
    if (/\bzh\b|chin/.test(label)) return 'zh';
    if (/\bja\b|jap/.test(label)) return 'ja';
    if (/\bko\b|kor/.test(label)) return 'ko';
    if (/\bpl\b|pol/.test(label)) return 'pl';
    if (/\bcs\b|czech/.test(label)) return 'cs';
    return label.replace(/\s.*/, '').slice(0, 3) || 'und';
  }

  /** Определить format субтитра по URL (расширение перед ?). */
  function subFormatFromUrl(url) {
    var path = String(url || '').split('?')[0];
    if (/\.vtt$/i.test(path)) return 'vtt';
    if (/\.srt$/i.test(path)) return 'srt';
    return 'vtt';
  }

  /**
   * Парсинг Playerjs-строки субтитров HDrezka:
   * "[Русские]url,[English]url,..."
   * @param {string} subtitle
   * @param {Object.<string,string>} subtitleLns
   * @returns {SubtitleTrack[]}
   */
  function rezkaParseSubtitles(subtitle, subtitleLns) {
    var out = [];
    if (!subtitle || subtitle === 'false' || subtitle === false) return out;
    var lns = subtitleLns || {};
    String(subtitle).split(',').forEach(function (chunk) {
      chunk = chunk.trim();
      var m = chunk.match(/^\[([^\]]+)\](https?:.+)$/);
      if (!m) return;
      var rawLabel = m[1].trim(), url = m[2].trim();
      if (!url) return;
      var lang = lns[rawLabel] || subLangFromLabel(rawLabel);
      out.push({ lang: lang, label: rawLabel, url: url, format: subFormatFromUrl(url) });
    });
    return out;
  }

  /**
   * Парсинг массива cc:{url,name} из Collaps/femd VenomPlayer.
   * @param {Array} ccArr
   * @returns {SubtitleTrack[]}
   */
  function collapsParseCC(ccArr) {
    var out = [];
    if (!Array.isArray(ccArr)) return out;
    ccArr.forEach(function (item) {
      var url = item.url || item.src || '';
      if (!url) return;
      var rawName = item.name || item.label || '';
      var lang = item.lang || item.srclang || subLangFromLabel(rawName);
      out.push({ lang: lang, label: rawName || lang, url: url, format: subFormatFromUrl(url) });
    });
    return out;
  }

  /**
   * Парсинг tracks:[{kind,label,src}] из ответа Alloha /bnsi/movies.
   * @param {Array} tracks
   * @returns {SubtitleTrack[]}
   */
  function allohaParseTracksSubs(tracks) {
    var out = [];
    if (!Array.isArray(tracks)) return out;
    tracks.forEach(function (t) {
      var url = t.src || t.url || '';
      if (!url) return;
      var rawLabel = t.label || '';
      var lang = t.srclang || subLangFromLabel(rawLabel);
      out.push({ lang: lang, label: rawLabel || lang, url: url, format: subFormatFromUrl(url) });
    });
    return out;
  }

  var API = {
    subLangFromLabel: subLangFromLabel,
    subFormatFromUrl: subFormatFromUrl,
    rezkaParseSubtitles: rezkaParseSubtitles,
    collapsParseCC: collapsParseCC,
    allohaParseTracksSubs: allohaParseTracksSubs
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  } else {
    var g = (typeof self !== 'undefined' ? self : window);
    g.BalancerCore = Object.assign(g.BalancerCore || {}, API);
  }
})();

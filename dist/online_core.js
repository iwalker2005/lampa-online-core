/*!
 * online_core.js — Balancer Core + Lampa Transport
 * Version: 1.0.0
 * Built:   2026-06-17
 * https://github.com/nb557/lampa-online-core
 *
 * Содержит: schema, secrets, antibot, transport (browser/node/lampa),
 *   адаптеры: Collaps, femd, Kodik, Alloha, HDrezka, CDNVideoHub,
 *   lampaTransport (Lampa.Reguest + proxyLink enc2t).
 */

(function (window) {
'use strict';

// ── src/balancer-core/schema.js ──────────────────────────────────────────
/**
 * balancer-core/schema.js — JSDoc-типы контракта (раздел 1 спека) + хелперы нормализации.
 *
 * @typedef {{ kp?: string, title?: string, imdb?: string }} BalancerQuery
 *
 * @typedef {{ lang: string, label: string, url: string, format: 'vtt'|'srt' }} SubtitleTrack
 *
 * @typedef {{ name: string, lang?: string, index?: number }} AudioTrack
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
 *   audioMode?: 'separate'|'tracks',
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
   * Построить одну Voice-запись для audioMode="tracks":
   * одна мастер-запись с audioTracks из массива имён.
   *
   * @param {Object.<string,string>} qualities  — мастер qualities (hls/dash)
   * @param {string[]} names                   — имена озвучек (индекс = index в аудиодорожке)
   * @param {SubtitleTrack[]} [subtitles]
   * @returns {Voice}
   */
  function makeTracksVoice(qualities, names, subtitles) {
    var firstName = (names && names.length) ? names[0] : 'Мультиаудио';
    var audioTracks = (names || []).map(function (n, i) { return { name: n, index: i }; });
    var voice = { name: firstName, id: 0, qualities: qualities, audioTracks: audioTracks };
    if (subtitles && subtitles.length) voice.subtitles = subtitles;
    return voice;
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
    allohaParseTracksSubs: allohaParseTracksSubs,
    makeTracksVoice: makeTracksVoice
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  } else {
    var g = (typeof self !== 'undefined' ? self : window);
    g.BalancerCore = Object.assign(g.BalancerCore || {}, API);
  }

// ── src/balancer-core/secrets.js ──────────────────────────────────────────
/**
 * balancer-core/secrets.js — токены балансёров (порт из balancer-search.js 248–278).
 * Чистый модуль, без chrome.* и DOM.
 *
 * Экспортирует: salt, decodeSecret, deriveToken, TOK_ALLOHA_CRACKED.
 */

  'use strict';

  /**
   * 10-символьный детерминированный хеш строки.
   * Порт из online_mod.js / balancer-search.js.
   * @param {string} input
   * @returns {string}
   */
  function salt(input) {
    var str = (input || '') + '', hash = 0;
    for (var i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash = hash & hash;
    }
    var result = '';
    for (var _i = 0, j = 29; j >= 0; _i += 3, j -= 3) {
      var x = ((hash >>> _i & 7) << 3) + (hash >>> j & 7);
      result += String.fromCharCode(x < 26 ? 97 + x : x < 52 ? 39 + x : x - 4);
    }
    return result;
  }

  /**
   * XOR-расшифровка байт-массива с keystream на основе salt('123456789'+password).
   * @param {number[]} input  байт-массив токена
   * @param {string}   password
   * @returns {string}
   */
  function decodeSecret(input, password) {
    var result = '';
    password = (password || '') + '';
    if (input && password) {
      var hash = salt('123456789' + password);
      while (hash.length < input.length) hash += hash;
      for (var i = 0; i < input.length; i++) {
        result += String.fromCharCode(input[i] ^ hash.charCodeAt(i));
      }
    }
    return result;
  }

  // Байт-массивы токенов из online_mod.js
  var TOK_KODIK  = [124, 125, 1, 86, 90, 64, 12, 123, 108, 59, 122, 125, 82, 3, 90, 23, 90, 122, 60, 110, 43, 123, 84, 3, 91, 71, 88, 112, 111, 57, 122, 121];
  var TOK_ALLOHA = [40, 120, 84, 65, 86, 14, 118, 70, 71, 97, 41, 126, 85, 67, 1, 9, 115, 70, 17, 106, 124, 125, 86, 19, 6, 89, 126, 66, 23, 111];

  /**
   * Alloha-токен восстановлен криптоанализом keystream LKevb:GurX (период 10).
   * Личный пароль пользователя НЕ нужен — только на случай ротации.
   */
  var TOK_ALLOHA_CRACKED = 'd317441359e505c343c2063edc97e7';

  /**
   * Вывести рабочий токен по id балансёра.
   * @param {'kodik'|'alloha'} id
   * @param {string} [secret]  личный пароль пользователя (только Alloha при ротации)
   * @returns {string}
   */
  function deriveToken(id, secret) {
    if (id === 'kodik') {
      // Личный токен пользователя из настроек (полный каталог); встроенный — fallback (ограничен).
      var userTok = (typeof Lampa !== 'undefined' && Lampa.Storage && Lampa.Storage.get('online_core_kodik_token', '')) || '';
      return (userTok + '').trim() || decodeSecret(TOK_KODIK, 'find your own token');
    }
    if (id === 'alloha') return (secret ? decodeSecret(TOK_ALLOHA, secret) : '') || TOK_ALLOHA_CRACKED;
    return '';
  }

  var API = {
    salt: salt,
    decodeSecret: decodeSecret,
    deriveToken: deriveToken,
    TOK_ALLOHA_CRACKED: TOK_ALLOHA_CRACKED,
    TOK_KODIK: TOK_KODIK,
    TOK_ALLOHA: TOK_ALLOHA
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  } else {
    var g = (typeof self !== 'undefined' ? self : window);
    g.BalancerCore = Object.assign(g.BalancerCore || {}, API);
  }

// ── src/balancer-core/antibot.js ──────────────────────────────────────────
/**
 * balancer-core/antibot.js — антибот-алгоритмы (порт из alloha-extract.js и kodik-extract.js).
 * Чистый модуль, без chrome.*, без DOM (canvas/webgl не нужны — RS = любая непустая строка).
 *
 * Экспортирует: G7, G8, G9, buildBorth, kodikDecodeUrl, clearTrash.
 *
 * Ключевые сноски спека §4.1:
 *   RS — любая непустая строка (сервер проверяет лишь непустоту).
 *   Canvas/SHA-256 нужны только в браузерном варианте для максимальной совместимости.
 *   На Node генерируем crypto.randomBytes(32).toString('hex').
 */

  'use strict';

  // ─── Вспомогательные функции для G7/G8/G9 ───────────────────────────────────

  function _isPrime(n) {
    if (n < 2) return false;
    if (n === 2) return true;
    if (n % 2 === 0) return false;
    for (var i = 3; i * i <= n; i += 2) if (n % i === 0) return false;
    return true;
  }

  function _bitLen(n) {
    if (n === 0) return 0;
    var b = 0;
    while (n > 0) { b++; n >>>= 1; }
    return b;
  }

  // ─── G7: prime-step scatter permutation ─────────────────────────────────────
  function G7(GL) {
    var Gh = GL.length;
    if (Gh <= 1) return GL;
    var Gm = Gh + 1;
    while (!_isPrime(Gm)) Gm++;
    var GO = 0, flags = new Array(Gh).fill(false), GF = [];
    while (GF.length < Gh) {
      GO = (GO + 2) % Gm;
      if (GO < Gh && !flags[GO]) { GF.push(GO); flags[GO] = true; }
    }
    var GE = new Array(Gh);
    for (var i = 0; i < Gh; i++) GE[GF[i]] = GL[i];
    return GE.join('');
  }

  // ─── G9: bit-length grouping, descending ────────────────────────────────────
  function G9(GL) {
    var Gh = GL.length;
    if (Gh <= 1) return GL;
    var Gd = 0;
    while ((1 << Gd) < Gh) Gd++;
    function Gm(n) { return n === 0 ? 0 : _bitLen(n); }
    var Gb = new Array(Gd + 1).fill(0);
    for (var i = 0; i < Gh; i++) Gb[Gm(i)]++;
    var GO = new Array(Gd + 1), GE = 0;
    for (var q = Gd; q >= 0; q--) { var c = Gb[q]; GO[q] = GL.slice(GE, GE + c); GE += c; }
    var Gp = new Array(Gd + 1).fill(0), Gu = new Array(Gh);
    for (var j = 0; j < Gh; j++) { var bl = Gm(j); Gu[j] = GO[bl][Gp[bl]++]; }
    return Gu.join('');
  }

  // ─── G8: trailing-zero-count grouping, ascending ────────────────────────────
  function G8(GL) {
    var Gh = GL.length;
    if (Gh <= 1) return GL;
    var Gd = 0;
    while ((1 << Gd) < Gh) Gd++;
    function Gm(n) {
      if (n === 0) return Gd;
      var c = 0, x = n;
      while (!(1 & x)) { c++; x >>= 1; }
      return c;
    }
    var Gb = new Array(Gd + 1).fill(0);
    for (var i = 0; i < Gh; i++) Gb[Gm(i)]++;
    var GO = new Array(Gd + 1), GE = 0;
    for (var q = 0; q <= Gd; q++) { var c = Gb[q]; GO[q] = GL.slice(GE, GE + c); GE += c; }
    var GS = new Array(Gd + 1).fill(0), Gp = new Array(Gh);
    for (var j = 0; j < Gh; j++) { var bl = Gm(j); Gp[j] = GO[bl][GS[bl]++]; }
    return Gp.join('');
  }

  /**
   * Вычислить nonce из viewporti (серверный nonce из <meta name="viewporti">).
   * @param {string} viewporti
   * @returns {string}
   */
  function allohaNonce(viewporti) {
    return G7(G8(G9(viewporti)));
  }

  /**
   * Сгенерировать RS — «браузерный фингерпринт».
   * Согласно спеку §4.1: сервер проверяет лишь непустоту.
   * На Node: crypto.randomBytes(32).toString('hex').
   * В браузере: можно передать готовый RS (из canvas/SHA-256) или использовать этот fallback.
   * @returns {Promise<string>}
   */
  function generateRS() {
    // Node.js
    if (typeof process !== 'undefined' && process.versions && process.versions.node) {
      try {
        var crypto = require('crypto');
        return Promise.resolve(crypto.randomBytes(32).toString('hex'));
      } catch (e) {}
    }
    // Браузер — Web Crypto (детерминированный фингерпринт не нужен, случайный ок)
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      var buf = new Uint8Array(32);
      crypto.getRandomValues(buf);
      var hex = Array.prototype.map.call(buf, function (b) {
        return ('0' + b.toString(16)).slice(-2);
      }).join('');
      return Promise.resolve(hex);
    }
    // Крайний fallback
    return Promise.resolve(Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2));
  }

  /**
   * Построить borth = RS + '|' + G7(G8(G9(viewporti))).
   * @param {string} viewporti  значение <meta name="viewporti"> из HTML плеера
   * @param {string} [rs]       готовый RS (если уже есть из браузерного фингерпринта)
   * @returns {Promise<string>}
   */
  function buildBorth(viewporti, rs) {
    var nonce = allohaNonce(viewporti);
    if (rs) return Promise.resolve(rs + '|' + nonce);
    return generateRS().then(function (generatedRS) {
      return generatedRS + '|' + nonce;
    });
  }

  // ─── Kodik: ROT18 + atob ────────────────────────────────────────────────────

  /**
   * Декодировать URL из ответа Kodik /ftor: ROT18 алфавита + atob.
   * Порт из kodik-extract.js.
   * На Node: Buffer.from(rot, 'base64').toString() вместо atob.
   * @param {string} encoded
   * @returns {string}
   */
  function kodikDecodeUrl(encoded) {
    if (!encoded || typeof encoded !== 'string') return '';
    var rot = '';
    for (var i = 0; i < encoded.length; i++) {
      var c = encoded[i];
      if (/[a-zA-Z]/.test(c)) {
        var limit = c <= 'Z' ? 90 : 122;
        var code = c.charCodeAt(0) + 18;
        rot += String.fromCharCode(code <= limit ? code : code - 26);
      } else {
        rot += c;
      }
    }
    // Паддинг base64
    var pad = (4 - rot.length % 4) % 4;
    rot += '==='.slice(0, pad);

    // Node.js
    if (typeof Buffer !== 'undefined') {
      try { return Buffer.from(rot, 'base64').toString('utf-8'); } catch (e) { return ''; }
    }
    // Браузер
    try {
      return typeof atob !== 'undefined' ? atob(rot) : '';
    } catch (e) {
      return '';
    }
  }

  // ─── HDrezka: clearTrash ─────────────────────────────────────────────────────

  /**
   * Удалить «мусор» из Playerjs-строки HDrezka.
   * Порт из balancer-search.js / online_mod.js.
   * На Node: btoa/atob через Buffer.
   * @param {string} data  Playerjs-строка (начинается с '#')
   * @returns {string}
   */
  function clearTrash(data) {
    if (typeof data !== 'string' || !data.startsWith('#')) return data;

    // btoa/atob-обёртки, работают и в браузере, и на Node
    function btoaCompat(s) {
      if (typeof btoa !== 'undefined') return btoa(unescape(encodeURIComponent(s)));
      return Buffer.from(s).toString('base64');
    }
    function atobCompat(s) {
      if (typeof atob !== 'undefined') {
        return decodeURIComponent(atob(s).split('').map(function (c) {
          return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
      }
      return Buffer.from(s, 'base64').toString('utf-8');
    }

    var trashList = ['$$!!@$$@^!@#$$@', '@@@@@!##!^^^', '####^!!##!@@', '^^^!@##!!##', '$$#!!@#!@##'];
    var x = data.substring(2);
    trashList.forEach(function (t) {
      x = x.split('//_//' + btoaCompat(t)).join('');
    });
    try { return atobCompat(x); } catch (e) { return ''; }
  }

  var API = {
    G7: G7,
    G8: G8,
    G9: G9,
    allohaNonce: allohaNonce,
    generateRS: generateRS,
    buildBorth: buildBorth,
    kodikDecodeUrl: kodikDecodeUrl,
    clearTrash: clearTrash
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  } else {
    var g = (typeof self !== 'undefined' ? self : window);
    g.BalancerCore = Object.assign(g.BalancerCore || {}, API);
  }

// ── src/balancer-core/transport.js ──────────────────────────────────────────
/**
 * balancer-core/transport.js — абстракция транспорта (раздел 3 спека).
 *
 * Интерфейс transport.fetch(url, opts) → Promise<{ok,status,text(),json()}>
 *   opts: { referer?, origin?, body?, headers?, creds? }
 *
 * Реализации:
 *   browserTransport — Chrome-расширение: DNR ставит Referer/Origin, fetch из sidepanel.
 *   nodeTransport    — Node 18+: заголовки напрямую (нет forbidden-headers ограничения).
 */

  'use strict';

  /**
   * Браузерный транспорт для Chrome-расширения.
   * Referer/Origin ставятся через DNR (declarativeNetRequest), управляемый снаружи.
   * Сам этот транспорт просто делает fetch — DNR-правила уже должны быть установлены
   * внешним кодом (balancer-search.js / alloha-extract.js / kodik-extract.js).
   *
   * Для балансёров, которым не нужен Referer (Collaps/femd/CDNVideoHub), работает «из коробки».
   * Для Kodik/Alloha вызывающий код должен заранее поставить DNR-правило.
   */
  var browserTransport = {
    fetch: function (url, opts) {
      opts = opts || {};
      var fetchOpts = {
        method: opts.body ? 'POST' : 'GET',
        credentials: opts.creds ? 'include' : 'omit'
      };
      if (opts.body) {
        fetchOpts.body = opts.body;
      }
      // В браузерном fetch нельзя поставить Referer/Origin/User-Agent напрямую —
      // они forbidden headers. DNR-правило должно быть установлено до вызова.
      // Остальные заголовки (X-Requested-With, Sraka-bot-Controls и т.п.) — можно.
      var h = opts.headers || {};
      var safeKeys = Object.keys(h).filter(function (k) {
        return !/^(referer|origin|user-agent|sec-fetch)/i.test(k);
      });
      if (safeKeys.length) {
        fetchOpts.headers = {};
        safeKeys.forEach(function (k) { fetchOpts.headers[k] = h[k]; });
      }
      if (opts.signal) fetchOpts.signal = opts.signal;

      return fetch(url, fetchOpts).then(function (r) {
        return {
          ok: r.ok,
          status: r.status,
          text: function () { return r.text(); },
          json: function () { return r.json(); }
        };
      });
    }
  };

  /**
   * Node 18+ транспорт.
   * Заголовки ставятся напрямую — нет ограничения forbidden headers.
   * Используется в smoke-тестах и на будущем сервере.
   */
  var nodeTransport = {
    fetch: function (url, opts) {
      opts = opts || {};
      var headers = {};
      // Базовые заголовки «браузерного» вида
      headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
      headers['Accept'] = 'application/json, text/html, */*';
      if (opts.referer) headers['Referer'] = opts.referer;
      if (opts.origin)  headers['Origin']  = opts.origin;
      // Пользовательские заголовки (borth, X-Requested-With, Content-Type…)
      if (opts.headers) {
        Object.keys(opts.headers).forEach(function (k) {
          headers[k] = opts.headers[k];
        });
      }

      var fetchOpts = {
        method: opts.body ? 'POST' : 'GET',
        headers: headers
      };
      if (opts.body) {
        fetchOpts.body = opts.body;
        if (!headers['Content-Type']) {
          headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
        }
      }
      if (opts.signal) fetchOpts.signal = opts.signal;

      return fetch(url, fetchOpts).then(function (r) {
        return {
          ok: r.ok,
          status: r.status,
          text: function () { return r.text(); },
          json: function () { return r.json(); }
        };
      });
    }
  };

  var API = {
    browserTransport: browserTransport,
    nodeTransport: nodeTransport
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  } else {
    var g = (typeof self !== 'undefined' ? self : window);
    g.BalancerCore = Object.assign(g.BalancerCore || {}, API);
  }

// ── src/balancer-core/adapters/_venom.js ──────────────────────────────────────────
/**
 * balancer-core/adapters/_venom.js — общий парсер VenomPlayer (Collaps + femd).
 * Порт из balancer-search.js (parseMakePlayer / parseMakePlayerSerial).
 * Внутренний модуль, не экспортируется напрямую в BalancerCore.
 */

  'use strict';

  var _schema;
  if (typeof module !== 'undefined' && module.exports) {
    _schema = require('../schema.js');
  } else {
    var g = (typeof self !== 'undefined' ? self : window);
    _schema = g.BalancerCore;
  }

  function makeTracksVoice(q, names, subs) {
    return _schema.makeTracksVoice(q, names, subs);
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
        var voices = [ makeTracksVoice(q, audioNames, epSubs) ];
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

    // Фильм. URL может быть БЕЗ расширения .m3u8/.mpd — interkh отдаёт
    // «директорные» ссылки (напр. https://xxx.interkh.com/.../KVP26X5F/).
    var mHls  = html.match(/["']?hls["']?\s*:\s*["'](https?:[^"']+)["']/i);
    var mDash = html.match(/["']?dash["']?\s*:\s*["'](https?:[^"']+)["']/i);
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
      voices: [ makeTracksVoice(q, names, filmSubs) ]
    };
  }

  var API = { parseMakePlayer: parseMakePlayer };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  } else {
    var g = (typeof self !== 'undefined' ? self : window);
    g.BalancerCore = Object.assign(g.BalancerCore || {}, API);
  }

// ── src/balancer-core/adapters/collaps.js ──────────────────────────────────────────
/**
 * balancer-core/adapters/collaps.js — адаптер Collaps (CDN interkh, открыт).
 *
 * capabilities: cdn=interkh, srcIp=false, castable=true, antiBot=none, resolveOn=any.
 * Парсер: VenomPlayer (parseMakePlayer) — тот же формат, что femd.
 */

  'use strict';

  // ─── Вспомогательные импорты (через BalancerCore или require) ───────────────
  var _schema, _parsers;
  if (typeof module !== 'undefined' && module.exports) {
    _schema  = require('../schema.js');
    _parsers = require('./_venom.js');
  } else {
    var g = (typeof self !== 'undefined' ? self : window);
    _schema  = g.BalancerCore;
    _parsers = g.BalancerCore;
  }

  var FEMD_POOL = /^(?:https?:)?\/\/(?:[a-z0-9]+\.)?(?:delivembed\.cc|buildplayer\.com|embedstorage\.net|mir-dikogo-zapada\.com|multikland\.net|placehere\.link|ameytools\.club|(?:tobaco|topdbltj|delivembd|hostemb|loadbox|getcodes|strvid|ebder|framprox|embprox|bedemp2|embr|lessornot|linktodo|insertunit|marts|ninsel|embess|luxembd|domem|atomics|namy|variyt|zenithjs|ortified)\.ws)\b/i;
  var FEMD_LIVE = 'https://api.embess.ws';

  function actualizeUrl(url) {
    if (FEMD_POOL.test(url)) return url.replace(/^(?:https?:)?\/\/[^/]+/i, FEMD_LIVE);
    return url;
  }

  var collapsAdapter = {
    id: 'collaps',
    name: 'Collaps',
    kind: 'both',
    capabilities: {
      cdn: 'interkh',
      srcIp: false,
      castable: true,
      antiBot: 'none',
      resolveOn: 'any'
    },

    /**
     * @param {{ kp?: string, title?: string }} query
     * @param {object} transport
     * @returns {Promise<import('../schema.js').Source>}
     */
    resolve: function (query, transport) {
      var kp = query.kp;
      if (!kp) {
        return Promise.resolve({ balancer: 'collaps', ok: false, error: 'kp обязателен', cdn: 'interkh', castable: true, resolveOn: 'any' });
      }

      // kinogram.best/femd.ws теперь отдают 422 на не-браузерные запросы;
      // рабочие зеркала того же VenomPlayer/interkh — synchroncode.com / ortified.ws.
      var primaryUrl  = 'https://api.synchroncode.com/embed/kp/' + kp;
      var reserveUrl  = 'https://api.ortified.ws/embed/kp/' + kp;

      function tryUrl(url, isReserve) {
        url = actualizeUrl(url);
        return transport.fetch(url, {}).then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.text();
        }).then(function (text) {
          var parsed = _parsers.parseMakePlayer(text);
          var ok = parsed && ((parsed.voices && parsed.voices.length) ||
                             (parsed.serial && parsed.seasons && parsed.seasons.length));
          if (!ok && !isReserve) return tryUrl(reserveUrl, true);
          if (!ok) return { balancer: 'collaps', ok: false, error: 'контент не найден', cdn: 'interkh', castable: true, resolveOn: 'any' };
          var src = { balancer: 'collaps', ok: true, cdn: 'interkh', castable: true, resolveOn: 'any', audioMode: 'tracks' };
          if (parsed.serial) {
            src.type = 'serial';
            src.seasons = parsed.seasons;
          } else {
            src.type = 'movie';
            src.voices = parsed.voices;
          }
          return src;
        }).catch(function (e) {
          if (!isReserve) return tryUrl(reserveUrl, true);
          return { balancer: 'collaps', ok: false, error: String(e && e.message || e), cdn: 'interkh', castable: true, resolveOn: 'any' };
        });
      }

      return tryUrl(primaryUrl, false);
    }
  };

  var API = { collapsAdapter: collapsAdapter };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  } else {
    var g = (typeof self !== 'undefined' ? self : window);
    g.BalancerCore = Object.assign(g.BalancerCore || {}, API);
  }

// ── src/balancer-core/adapters/femd.js ──────────────────────────────────────────
/**
 * balancer-core/adapters/femd.js — адаптер femd / HDVB (CDN interkh, открыт).
 * Тот же VenomPlayer-формат, что Collaps. Домены ротируются → actualizeUrl.
 *
 * capabilities: cdn=interkh, srcIp=false, castable=true, antiBot=none, resolveOn=any.
 */

  'use strict';

  var _parsers;
  if (typeof module !== 'undefined' && module.exports) {
    _parsers = require('./_venom.js');
  } else {
    var g = (typeof self !== 'undefined' ? self : window);
    _parsers = g.BalancerCore;
  }

  var FEMD_POOL = /^(?:https?:)?\/\/(?:[a-z0-9]+\.)?(?:delivembed\.cc|buildplayer\.com|embedstorage\.net|mir-dikogo-zapada\.com|multikland\.net|placehere\.link|ameytools\.club|(?:tobaco|topdbltj|delivembd|hostemb|loadbox|getcodes|strvid|ebder|framprox|embprox|bedemp2|embr|lessornot|linktodo|insertunit|marts|ninsel|embess|luxembd|domem|atomics|namy|variyt|zenithjs|ortified)\.ws)\b/i;
  var FEMD_LIVE = 'https://api.embess.ws';

  function actualizeUrl(url) {
    if (FEMD_POOL.test(url)) return url.replace(/^(?:https?:)?\/\/[^/]+/i, FEMD_LIVE);
    return url;
  }

  var femdAdapter = {
    id: 'femd',
    name: 'femd / HDVB',
    kind: 'both',
    capabilities: {
      cdn: 'interkh',
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
        return Promise.resolve({ balancer: 'femd', ok: false, error: 'kp обязателен', cdn: 'interkh', castable: true, resolveOn: 'any' });
      }

      var url = actualizeUrl('https://api.embess.ws/embed/kp/' + kp);

      return transport.fetch(url, {}).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      }).then(function (text) {
        var parsed = _parsers.parseMakePlayer(text);
        var ok = parsed && ((parsed.voices && parsed.voices.length) ||
                           (parsed.serial && parsed.seasons && parsed.seasons.length));
        if (!ok) return { balancer: 'femd', ok: false, error: 'контент не найден', cdn: 'interkh', castable: true, resolveOn: 'any' };
        var src = { balancer: 'femd', ok: true, cdn: 'interkh', castable: true, resolveOn: 'any', audioMode: 'tracks' };
        if (parsed.serial) {
          src.type = 'serial';
          src.seasons = parsed.seasons;
        } else {
          src.type = 'movie';
          src.voices = parsed.voices;
        }
        return src;
      }).catch(function (e) {
        return { balancer: 'femd', ok: false, error: String(e && e.message || e), cdn: 'interkh', castable: true, resolveOn: 'any' };
      });
    }
  };

  var API = { femdAdapter: femdAdapter };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  } else {
    var g = (typeof self !== 'undefined' ? self : window);
    g.BalancerCore = Object.assign(g.BalancerCore || {}, API);
  }

// ── src/balancer-core/adapters/kodik.js ──────────────────────────────────────────
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
     * Добыть kinopoisk_id по imdb/названию (ответ Kodik содержит kinopoisk_id).
     * Нужно, когда карточка пришла из TMDB и KP-id неизвестен.
     * @returns {Promise<string>}  kinopoisk_id или ''
     */
    resolveKpId: function (query, transport) {
      var token = _secrets.deriveToken('kodik');
      var url;
      if (query.imdb)       url = 'https://kodik-api.com/search?imdb_id=' + encodeURIComponent(query.imdb) + '&token=' + token + '&limit=1';
      else if (query.title) url = 'https://kodik-api.com/search?title='   + encodeURIComponent(query.title) + '&token=' + token + '&limit=1';
      else return Promise.resolve('');

      return transport.fetch(url, {}).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).then(function (d) {
        var res = d && d.results && d.results[0];
        return (res && res.kinopoisk_id) ? String(res.kinopoisk_id) : '';
      }).catch(function () { return ''; });
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
      } else if (query.imdb) {
        searchUrl = 'https://kodik-api.com/search?imdb_id=' + encodeURIComponent(query.imdb) +
          '&token=' + token + '&with_seasons=true&with_episodes=true&limit=100';
      } else if (query.title) {
        searchUrl = 'https://kodik-api.com/search?title=' + encodeURIComponent(query.title) +
          '&token=' + token + '&with_seasons=true&with_episodes=true&limit=100';
      } else {
        return Promise.resolve(fail('нужен kp, imdb или title'));
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
          return { balancer: 'kodik', ok: true, cdn: 'solodcdn', castable: true, resolveOn: 'any', audioMode: 'separate', type: 'serial', seasons: seasons };
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
          return { balancer: 'kodik', ok: true, cdn: 'solodcdn', castable: true, resolveOn: 'any', audioMode: 'separate', type: 'movie', voices: all };
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

// ── src/balancer-core/adapters/alloha.js ──────────────────────────────────────────
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
     * Добыть kinopoisk_id по imdb/tmdb через Alloha (apbugall возвращает id_kp).
     * Токен «кряк» личного не требует; идём НАПРЯМУЮ — apbugall отдаёт CORS:*.
     * @returns {Promise<string>}  kinopoisk_id или ''
     */
    resolveKpId: function (query, transport) {
      var url;
      if (query.imdb)      url = 'https://api.apbugall.org/?token=' + ALLOHA_TOKEN + '&imdb=' + encodeURIComponent(query.imdb);
      else if (query.tmdb) url = 'https://api.apbugall.org/?token=' + ALLOHA_TOKEN + '&tmdb=' + encodeURIComponent(query.tmdb);
      else return Promise.resolve('');

      return transport.fetch(url, { noProxy: true }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).then(function (d) {
        var kp = d && d.data && (d.data.id_kp || d.data.alternative_id_kp);
        return kp ? String(kp) : '';
      }).catch(function () { return ''; });
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

// ── src/balancer-core/adapters/hdrezka.js ──────────────────────────────────────────
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

// ── src/balancer-core/adapters/cdnvideohub.js ──────────────────────────────────────────
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
          return { balancer: 'cdnvideohub', ok: true, cdn: 'okcdn', castable: false, resolveOn: 'device', audioMode: 'separate', type: 'serial', seasons: seasons };
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
          return { balancer: 'cdnvideohub', ok: true, cdn: 'okcdn', castable: false, resolveOn: 'device', audioMode: 'separate', type: 'movie', voices: voices };
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

// ── src/balancer-core/index.js ──────────────────────────────────────────
/**
 * balancer-core/index.js — реестр адаптеров + resolveAll.
 *
 * Экспортирует:
 *   adapters  — массив всех адаптеров
 *   resolveAll(query, transport) → Promise<ResolveResult>
 */

  'use strict';

  var _collaps, _femd, _kodik, _alloha, _hdrezka, _cdnvideohub;

  if (typeof module !== 'undefined' && module.exports) {
    _collaps     = require('./adapters/collaps.js');
    _femd        = require('./adapters/femd.js');
    _kodik       = require('./adapters/kodik.js');
    _alloha      = require('./adapters/alloha.js');
    _hdrezka     = require('./adapters/hdrezka.js');
    _cdnvideohub = require('./adapters/cdnvideohub.js');
  } else {
    var g = (typeof self !== 'undefined' ? self : window);
    // В браузере все адаптеры уже в BalancerCore через свои <script>-теги
    _collaps     = g.BalancerCore;
    _femd        = g.BalancerCore;
    _kodik       = g.BalancerCore;
    _alloha      = g.BalancerCore;
    _hdrezka     = g.BalancerCore;
    _cdnvideohub = g.BalancerCore;
  }

  var adapters = [
    _collaps.collapsAdapter,
    _femd.femdAdapter,
    _kodik.kodikAdapter,
    _alloha.allohaAdapter,
    _hdrezka.hdrezkaAdapter,
    _cdnvideohub.cdnvideohubAdapter
  ];

  /**
   * Опросить все адаптеры параллельно.
   *
   * @param {{ kp?: string, title?: string, imdb?: string }} query
   * @param {object} transport  browserTransport или nodeTransport
   * @returns {Promise<ResolveResult>}
   */
  function resolveAll(query, transport) {
    // Шаг 0: если нет kinopoisk_id (TMDB-карточка) — добываем его через Kodik,
    // иначе 5 из 6 балансеров вернут «kp обязателен».
    function _withKp(kp) {
      return { kp: kp, title: query.title, imdb: query.imdb, tmdb: query.tmdb };
    }
    var pre;
    if (query.kp || (!query.imdb && !query.title && !query.tmdb)) {
      pre = Promise.resolve(query);
    } else {
      // 1) Alloha/apbugall (жив, по imdb/tmdb отдаёт id_kp); 2) Kodik — запасной
      pre = _alloha.allohaAdapter.resolveKpId(query, transport).then(function (kp) {
        if (kp) return _withKp(kp);
        return _kodik.kodikAdapter.resolveKpId(query, transport).then(function (kp2) {
          return kp2 ? _withKp(kp2) : query;
        });
      });
    }

    return pre.then(function (q) {
      var promises = adapters.map(function (adapter) {
        return adapter.resolve(q, transport).catch(function (e) {
          return {
            balancer: adapter.id,
            ok: false,
            error: String(e && e.message || e),
            cdn: adapter.capabilities.cdn,
            castable: adapter.capabilities.castable,
            resolveOn: adapter.capabilities.resolveOn
          };
        });
      });

      return Promise.all(promises).then(function (sources) {
        // Определяем тип контента из первого ok-источника
        var firstOk = sources.find(function (s) { return s.ok; });
        var type = (firstOk && firstOk.type) || 'movie';

        return {
          query: q,
          type: type,
          sources: sources
        };
      });
    });
  }

  var API = {
    adapters: adapters,
    resolveAll: resolveAll
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  } else {
    var g = (typeof self !== 'undefined' ? self : window);
    g.BalancerCore = Object.assign(g.BalancerCore || {}, API);
  }

// ── src/lampa-transport.js ──────────────────────────────────────────
/**
 * lampa-transport.js — транспорт для Lampa-плагина (раздел 3 спека).
 *
 * Реализует контракт:
 *   transport.fetch(url, opts) → Promise<{ok, status, text(), json()}>
 *   opts: { referer?, origin?, body?, headers?, creds? }
 *
 * Механизм: Lampa.Reguest().native(proxyLink(url, proxy, proxy_enc, 'enc2t'), ok, err, body, {...})
 * Referer/Origin/User-Agent едут в proxy_enc = 'param/Header=<base64url>/...'
 * CORS обходит воркер (cors.nb557.workers.dev и др., ротация по чётности часа).
 *
 * На Android (Lampa.Platform.is('android')) заголовки прокидываются напрямую,
 * дополнительно к proxy_enc (чтобы корректно обработать forbidden-headers на WebView).
 */

  'use strict';

  // ── Прокси-воркеры (ротация по чётности часа, как в online_mod.js) ─────────
  // Можно переопределить: window.BalancerCore.lampaTransport.setProxy(url)
  var _customProxy = '';

  function _getProxy() {
    if (_customProxy) return _customProxy;
    // Ротация: нечётный час → nb557, чётный → fx666 (как в online_mod.js)
    return new Date().getHours() % 2
      ? 'https://cors.nb557.workers.dev/'
      : 'https://cors.fx666.workers.dev/';
  }

  // ── Базовый User-Agent ────────────────────────────────────────────────────────
  var BASE_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

  // ── proxyLink — точная копия алгоритма из online_mod.js ─────────────────────
  // enc2t: proxy + 'enc2/' + encodeURIComponent(btoa(proxy_enc + link)) + '/' + name + '?jacred.test'
  function proxyLink(link, proxy, proxy_enc, enc) {
    if (link && proxy) {
      if (proxy_enc == null) proxy_enc = '';
      if (enc == null) enc = 'enc';

      if (enc === 'enc') {
        var pos = link.indexOf('/');
        if (pos !== -1 && link.charAt(pos + 1) === '/') pos++;
        var part1 = pos !== -1 ? link.substring(0, pos + 1) : '';
        var part2 = pos !== -1 ? link.substring(pos + 1) : link;
        return proxy + 'enc/' + encodeURIComponent(btoa(proxy_enc + part1)) + '/' + part2;
      }

      if (enc === 'enc1') {
        var _pos = link.lastIndexOf('/');
        var _part = _pos !== -1 ? link.substring(0, _pos + 1) : '';
        var _part2 = _pos !== -1 ? link.substring(_pos + 1) : link;
        return proxy + 'enc1/' + encodeURIComponent(btoa(proxy_enc + _part)) + '/' + _part2;
      }

      if (enc === 'enc2' || enc === 'enc2t') {
        var posEnd = link.lastIndexOf('?');
        var posStart = link.lastIndexOf('://');
        if (posEnd === -1 || posEnd <= posStart) posEnd = link.length;
        if (posStart === -1) posStart = -3;
        var name = link.substring(posStart + 3, posEnd);
        posStart = name.lastIndexOf('/');
        name = posStart !== -1 ? name.substring(posStart + 1) : '';
        return proxy + 'enc2/' + encodeURIComponent(btoa(proxy_enc + link)) + '/' + name + (enc === 'enc2t' ? '?jacred.test' : '');
      }

      return proxy + proxy_enc + link;
    }
    return link;
  }

  // ── Построение proxy_enc из opts ────────────────────────────────────────────
  // Формат: 'param/Referer=<encURIComp(val)>/param/Origin=<encURIComp(val)>/...'
  // (точно как в online_mod.js alloha/filmix-секциях)
  function buildProxyEnc(opts) {
    var enc = '';
    opts = opts || {};
    var h = opts.headers || {};

    // Стандартные forbidden-headers
    var ref = opts.referer || h['Referer'] || h['referer'] || '';
    var origin = opts.origin || h['Origin'] || h['origin'] || '';
    var ua = h['User-Agent'] || h['user-agent'] || '';

    if (ref)    enc += 'param/Referer=' + encodeURIComponent(ref) + '/';
    if (origin) enc += 'param/Origin=' + encodeURIComponent(origin) + '/';
    if (ua)     enc += 'param/User-Agent=' + encodeURIComponent(ua) + '/';

    // Прочие заголовки (borth, X-Requested-With, Sraka-bot-Controls и т.п.)
    // — forbidden-only-in-browser набор через param/
    var FORBIDDEN_RE = /^(referer|origin|user-agent|sec-fetch)/i;
    Object.keys(h).forEach(function (k) {
      if (!FORBIDDEN_RE.test(k)) return; // не-forbidden прокинем напрямую ниже
      if (/^(referer|origin|user-agent)$/i.test(k)) return; // уже добавлены
      enc += 'param/' + k + '=' + encodeURIComponent(h[k]) + '/';
    });

    return enc;
  }

  // ── Заголовки для прямой передачи (non-forbidden) ───────────────────────────
  function buildDirectHeaders(opts) {
    var h = opts.headers || {};
    var FORBIDDEN_RE = /^(referer|origin|user-agent|sec-fetch)/i;
    var out = {};
    Object.keys(h).forEach(function (k) {
      if (!FORBIDDEN_RE.test(k)) out[k] = h[k];
    });
    return out;
  }

  // ── lampaTransport ───────────────────────────────────────────────────────────
  var lampaTransport = {

    /** Сменить прокси-воркер (URL должен заканчиваться на '/') */
    setProxy: function (url) {
      _customProxy = url || '';
    },

    /** Получить текущий прокси-URL */
    getProxy: _getProxy,

    /**
     * Основной метод транспорта.
     * @param {string} url
     * @param {{ referer?, origin?, body?, headers?, creds? }} [opts]
     * @returns {Promise<{ok:boolean, status:number, text:()=>Promise<string>, json:()=>Promise<object>}>}
     */
    fetch: function (url, opts) {
      opts = opts || {};

      return new Promise(function (resolve, reject) {

        // Проверка доступности Lampa.Reguest
        if (typeof Lampa === 'undefined' || !Lampa.Reguest) {
          reject(new Error('lampaTransport: Lampa.Reguest недоступен'));
          return;
        }

        var network = new Lampa.Reguest();
        var isAndroid = typeof Lampa.Platform !== 'undefined' && Lampa.Platform.is('android');
        var proxy = _getProxy();

        // Строим proxy_enc (forbidden headers → base64 в URL воркера)
        var proxy_enc = buildProxyEnc(opts);

        // Прямые заголовки (non-forbidden): X-Requested-With, Borth, Sraka-bot-Controls и т.п.
        var directHeaders = buildDirectHeaders(opts);

        // На Android все заголовки можно ставить напрямую (нет forbidden-headers в OkHttp)
        var nativeHeaders = {};
        if (isAndroid) {
          var h = opts.headers || {};
          Object.keys(h).forEach(function (k) { nativeHeaders[k] = h[k]; });
          if (opts.referer) nativeHeaders['Referer'] = opts.referer;
          if (opts.origin)  nativeHeaders['Origin']  = opts.origin;
        } else {
          // Браузерный WebView: non-forbidden заголовки напрямую
          nativeHeaders = directHeaders;
        }

        // Домены с ОТКРЫТЫМ CORS (api.* балансёров) — всегда напрямую: воркер
        // nb557/fx666 их отвергает ("Malformed URL"), а сами они отдают CORS:*.
        // stravers/allarknow (плеер Alloha) — тоже напрямую (рабочий путь на Android).
        var direct = opts.noProxy || /apbugall\.org|synchroncode\.com|ortified\.ws|embess\.ws|kinogram\.best|femd\.ws|kodik-api\.com|plapi\.cdnvideohub\.com|hdrezka\.me|rezka\.ag|stravers\.|allarknow\.|\.allarknet\.|\bbnsi\b/i.test(url);
        var finalUrl = (proxy && !direct) ? proxyLink(url, proxy, proxy_enc, 'enc2t') : url;

        // Тело POST (false → нет тела, как принято в online_mod.js)
        var postBody = opts.body || false;
        var method   = postBody ? 'POST' : 'GET';

        // Опции для Lampa.Reguest.native
        var reqOpts = {
          dataType: 'text'
        };
        if (Object.keys(nativeHeaders).length) {
          reqOpts.headers = nativeHeaders;
        }
        if (opts.creds) {
          // credentials:'include' — Lampa.Reguest не поддерживает явно,
          // но при native() куки идут через воркер (нужен proxy с поддержкой кук)
          reqOpts.credentials = 'include';
        }

        // Буфер для сырого текста ответа
        var _rawText = null;
        var _status  = 200;
        var _ok      = true;

        network.clear();
        network.timeout(30000);

        if (method === 'POST') {
          // native(url, ok, err, postdata, opts)
          network['native'](finalUrl,
            function (responseText) {
              _rawText = typeof responseText === 'string' ? responseText : JSON.stringify(responseText);
              resolve(_makeResponse(_ok, _status, _rawText));
            },
            function (a, c) {
              // Lampa errorDecode: a — XHR или строка, c — статус
              _status = (c && typeof c === 'number') ? c : 0;
              _ok = false;
              _rawText = (typeof a === 'string' ? a : (a && a.responseText) || '') || '';
              resolve(_makeResponse(_ok, _status, _rawText));
            },
            postBody,
            reqOpts
          );
        } else {
          // silent() — фоновый запрос (json), native() — для текста
          // Используем native() для единообразия и поддержки dataType:'text'
          network['native'](finalUrl,
            function (responseText) {
              _rawText = typeof responseText === 'string' ? responseText : JSON.stringify(responseText);
              resolve(_makeResponse(true, 200, _rawText));
            },
            function (a, c) {
              _status = (c && typeof c === 'number') ? c : 0;
              _rawText = (typeof a === 'string' ? a : (a && a.responseText) || '') || '';
              resolve(_makeResponse(false, _status, _rawText));
            },
            false,
            reqOpts
          );
        }
      });
    }
  };

  // ── Фабрика объекта-ответа ───────────────────────────────────────────────────
  function _makeResponse(ok, status, rawText) {
    return {
      ok: ok,
      status: status,
      text: function () {
        return Promise.resolve(rawText || '');
      },
      json: function () {
        return new Promise(function (resolve, reject) {
          try {
            resolve(JSON.parse(rawText || 'null'));
          } catch (e) {
            reject(new Error('lampaTransport: JSON parse error — ' + e.message));
          }
        });
      }
    };
  }

  // ── Экспорт ──────────────────────────────────────────────────────────────────
  var API = { lampaTransport: lampaTransport, proxyLink: proxyLink };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  } else {
    var g = (typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : {}));
    g.BalancerCore = Object.assign(g.BalancerCore || {}, API);
  }

// ── src/lampa-plugin.js ──────────────────────────────────────────
/**
 * lampa-plugin.js — регистрация плагина online_core в Lampa.
 *
 * Паттерны взяты из nb557/online_mod.js:
 *   - component — функция-конструктор (object); this = Lampa-компонент (Scroll + Explorer + Filter)
 *   - Lampa.Component.add(name, component) + Lampa.Activity.push(...)
 *   - Lampa.Manifest.plugins + Lampa.Listener.follow('full') + кнопка на карточке
 *   - this.filter(filter_items, choice) / this.append(item) / this.reset() / this.loading(bool)
 *   - this.renameQualityMap / this.getDefaultQuality (встроены в component Lampa)
 *   - Lampa.Player.play({ url, quality, subtitles, timeline, title, translate })
 *   - Lampa.Player.playlist([...])
 *
 * Наш движок: BalancerCore.resolveAll(query, BalancerCore.lampaTransport) → ResolveResult
 *   sources[] → Source { balancer, ok, audioMode, voices?, seasons?, castable, resolveOn }
 *
 *   audioMode "separate" (Kodik/HDrezka/CDNVideoHub):
 *     voices[] — несколько записей, у каждой свой qualities:{label:url}.
 *     UI: список озвучек; выбор озвучки → перезагрузка потока.
 *
 *   audioMode "tracks" (Alloha/Collaps/femd):
 *     voices[] — ОДНА запись { name, qualities:{мастер}, audioTracks:[{name,lang?,index}], subtitles? }.
 *     UI: показываем ОДИН пункт потока; аудиодорожки передаём через translate.tracks в Player.
 *
 *   Voice     { name, id, qualities:{label:url}, audioTracks?, subtitles? }
 *   Season    { num, episodes:[{ num, title, voices?, resolveLazy? }] }
 *
 * Субтитры: voice.subtitles:[{label,url}] передаём в Lampa.Player.play({subtitles}).
 *           Встроенные в манифест Lampa берёт сам — их не дублируем.
 *
 * Аудиодорожки (tracks-режим): передаём translate:{tracks:[{language:name}]} по паттерну
 *   online_mod.js collaps (строки 3578–3592): Lampa.Player использует это поле для подписи
 *   аудиодорожек HLS-потока вместо автоматических «ru0/ru1» из манифеста.
 */

    'use strict';

    var PLUGIN_VERSION = '1.0.0';
    var PLUGIN_NAME    = 'online_core';

    // ─── Шаблоны ──────────────────────────────────────────────────────────────

    /**
     * Регистрируем HTML-шаблоны элементов списка.
     * Структура повторяет online_mod.js: online__body / online__title / online__quality.
     */
    function registerTemplates() {
        // Строка озвучки / серии (иконка «воспроизвести»)
        Lampa.Template.add('online_core_item',
            '<div class="online selector">' +
                '<div class="online__body">' +
                    '<div style="position:absolute;left:0;top:-0.3em;width:2.4em;height:2.4em">' +
                        '<svg style="height:2.4em;width:2.4em" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">' +
                            '<circle cx="64" cy="64" r="56" stroke="white" stroke-width="16"/>' +
                            '<path d="M90.5 64.3827L50 87.7654L50 41L90.5 64.3827Z" fill="white"/>' +
                        '</svg>' +
                    '</div>' +
                    '<div class="online__title" style="padding-left:2.1em">{title}</div>' +
                    '<div class="online__quality" style="padding-left:3.4em">{quality}{info}</div>' +
                '</div>' +
            '</div>'
        );

        // Строка балансёра / сезона (иконка «папка»)
        Lampa.Template.add('online_core_folder',
            '<div class="online selector">' +
                '<div class="online__body">' +
                    '<div style="position:absolute;left:0;top:-0.3em;width:2.4em;height:2.4em">' +
                        '<svg style="height:2.4em;width:2.4em" viewBox="0 0 128 112" fill="none" xmlns="http://www.w3.org/2000/svg">' +
                            '<rect y="20" width="128" height="92" rx="13" fill="white"/>' +
                            '<path d="M29.9963 8H98.0037C96.0446 3.3021 91.4079 0 86 0H42C36.5921 0 31.9555 3.3021 29.9963 8Z" fill="white" fill-opacity="0.23"/>' +
                            '<rect x="11" y="8" width="106" height="76" rx="13" fill="white" fill-opacity="0.51"/>' +
                        '</svg>' +
                    '</div>' +
                    '<div class="online__title" style="padding-left:2.1em">{title}</div>' +
                    '<div class="online__quality" style="padding-left:3.4em">{quality}{info}</div>' +
                '</div>' +
            '</div>'
        );
    }

    // ─── Утилиты ──────────────────────────────────────────────────────────────

    /**
     * Добавить невидимый пробел (​U+200B) к ключам качества —
     * паттерн из online_mod.js (renameQualityMap), чтобы Lampa не сортировала ключи.
     *
     * @param {Object.<string,string>} qualityMap
     * @returns {Object.<string,string>}
     */
    function renameQualityMap(qualityMap) {
        if (!qualityMap) return qualityMap;
        var out = {};
        for (var k in qualityMap) {
            out['​' + k] = qualityMap[k];
        }
        return out;
    }

    /**
     * Получить URL предпочтительного качества из словаря.
     * Логика из online_mod.js getDefaultQuality: приоритет по убыванию разрешения,
     * при совпадении — использовать defValue если передан.
     *
     * @param {Object.<string,string>} qualityMap
     * @param {string} [defValue]
     * @returns {string}
     */
    function getDefaultQuality(qualityMap, defValue) {
        if (!qualityMap) return defValue || '';
        var preferred = ['2160p', '2160', '4K', '1440p', '1440', '1080p Ultra', '1080p', '1080', '720p', '720', '480p', '480', '360p', '360'];
        for (var i = 0; i < preferred.length; i++) {
            if (qualityMap[preferred[i]]) return qualityMap[preferred[i]];
        }
        // Первый доступный
        var keys = Object.keys(qualityMap);
        return keys.length ? qualityMap[keys[0]] : (defValue || '');
    }

    /**
     * Привести subtitles из нашей схемы (SubtitleTrack[]) к формату Lampa.Player:
     * [{ label, url }] или false если субтитров нет.
     *
     * @param {Array|undefined} subs
     * @returns {Array|false}
     */
    function mapSubtitles(subs) {
        if (!subs || !subs.length) return false;
        var out = subs.map(function (s) {
            return { label: s.label || s.lang || 'Sub', url: s.url };
        });
        return out.length ? out : false;
    }

    /**
     * Строка с названиями аудиодорожек для дополнительного info.
     *
     * @param {Array|undefined} audioTracks
     * @returns {string}
     */
    function audioInfo(audioTracks) {
        if (!audioTracks || !audioTracks.length) return '';
        return audioTracks.map(function (t) { return t.name || t.lang || ''; }).filter(Boolean).join(', ');
    }

    /**
     * Преобразовать audioTracks нашей схемы в формат translate.tracks для Lampa.Player.
     * Паттерн из online_mod.js collaps (строки 3463–3498, 3578–3592):
     *   audio_tracks = [{language: name}]
     *   Lampa.Player.play({ translate: { tracks: audio_tracks } })
     *
     * Это заставляет Lampa подписывать аудиодорожки HLS именами из tracks[].language
     * вместо автоматически определённых из манифеста («ru0», «ru1» и т.п.).
     *
     * @param {Array|undefined} audioTracks  — [{name, lang?, index?}]
     * @returns {Array|false}                — [{language: string}] или false
     */
    function mapAudioTracks(audioTracks) {
        if (!audioTracks || !audioTracks.length) return false;
        var out = audioTracks.map(function (t) {
            return { language: t.name || t.lang || '' };
        }).filter(function (t) { return t.language; });
        return out.length ? out : false;
    }

    // ─── Компонент Lampa ──────────────────────────────────────────────────────

    /**
     * Функция-конструктор компонента — паттерн online_mod.js.
     * Lampa создаёт экземпляр через «new component(object)» при Lampa.Activity.push.
     * this = объект-компонент Lampa (Scroll + Explorer + Filter + методы).
     *
     * @param {Object} object — { movie, search, search_one, search_two, … }
     */
    function component(object) {
        var _this = this;

        // Данные текущего сеанса поиска
        var _destroyed = false;
        var _result    = null;  // ResolveResult
        var _okSources = [];    // Source[] c ok=true

        // Состояние фильтра (аналог choice в online_mod.js)
        var choice = {
            source: 0,
            voice:  0,
            season: 0
        };

        // Словарь для component.filter (аналог filter_items)
        var filter_items = {};

        // ── Каркас Lampa-компонента (Scroll + Explorer + Filter) ──────────────
        var scroll = new Lampa.Scroll({ mask: true, over: true });
        var files  = new Lampa.Explorer(object);
        var filter = new Lampa.Filter(object);
        var last;

        // ── Поиск ─────────────────────────────────────────────────────────────

        /**
         * Запустить поиск через наш движок.
         * Вызывается Lampa из this.find() → sources[balanser].search(object, kp_id).
         * В нашем случае один «мета-балансёр», поэтому search — главная точка входа.
         */
        this.search = function () {
            var movie  = object.movie || {};
            var query  = {
                // ВНИМАНИЕ: movie.id у TMDB-карточки — это TMDB-id, а НЕ kinopoisk_id.
                // Подставлять его в kp нельзя — балансеры искали по чужому id → «Пусто».
                kp:    String(movie.kinopoisk_id || movie.kinopoisk || ''),
                title: movie.title || movie.name || movie.original_title || movie.original_name || object.search || '',
                imdb:  movie.imdb_id || '',
                // tmdb-id карточки (для резолва KP через Alloha, если нет imdb)
                tmdb:  (movie.source === 'tmdb' || movie.source === 'cub') ? String(movie.id || '') : ''
            };

            _this.loading(true);

            BalancerCore.resolveAll(query, BalancerCore.lampaTransport)
                .then(function (result) {
                    if (_destroyed) return;
                    _this.loading(false);
                    _result    = result;
                    _okSources = (result.sources || []).filter(function (s) { return s.ok; });

                    if (!_okSources.length) {
                        var reasons = (result.sources || []).map(function (s) {
                            return s.balancer + ' — ' + (s.error || 'нет данных');
                        }).join('   |   ');
                        _this.empty('Источники ничего не нашли. kp=' + (query.kp || '—') +
                            ', imdb=' + (query.imdb || '—') + ', «' + query.title + '».   ' + reasons);
                        return;
                    }

                    _buildSourceLevel();
                })
                .catch(function (e) {
                    if (_destroyed) return;
                    _this.loading(false);
                    _this.empty();
                    Lampa.Noty.show('Online Core: ' + (e && e.message || String(e)));
                });
        };

        // ── Уровень 1: балансёры ──────────────────────────────────────────────

        /**
         * Нарисовать список доступных балансёров (источников).
         * Каждый — строка-папка; по клику открываем уровень озвучек / сезонов.
         */
        function _buildSourceLevel() {
            _this.reset();

            filter_items = {
                source: _okSources.map(function (s) { return s.balancer; })
            };
            choice.source = 0;
            _this.filter(filter_items, choice);

            _okSources.forEach(function (source) {
                var isSerial    = (_result && _result.type) === 'serial';
                var resolveTag  = source.resolveOn === 'device' ? ' [srcIP]' : '';
                var castTag     = source.castable   ? ' ✓cast'  : '';

                var row = Lampa.Template.get('online_core_folder', {
                    title:   source.balancer,
                    quality: isSerial ? 'Сериал' : 'Фильм',
                    info:    resolveTag + castTag
                });

                row.on('hover:enter', function () {
                    choice.source = _okSources.indexOf(source);
                    _openSource(source);
                });

                _this.append(row);
            });

            // Диагностика: показать и УПАВШИЕ балансёры с причиной (для отладки).
            (_result && _result.sources || []).forEach(function (s) {
                if (s.ok) return;
                var row = Lampa.Template.get('online_core_folder', {
                    title:   '✗ ' + s.balancer,
                    quality: 'ошибка',
                    info:    ' — ' + (s.error || 'нет данных')
                });
                _this.append(row);
            });

            _this.start(true);
        }

        // ── Уровень 2: открыть источник → озвучки / сезоны ───────────────────

        /**
         * Открыть конкретный источник.
         * Фильм → список озвучек.
         * Сериал → выбор озвучки + сезона через фильтр + список серий.
         *
         * @param {Source} source
         */
        function _openSource(source) {
            _this.reset();
            var isSerial = (_result && _result.type) === 'serial';
            var movie    = object.movie || {};
            var title    = object.search || movie.title || movie.original_title || '';

            if (!isSerial) {
                _buildVoiceLevel(source, movie, title);
            } else {
                _buildSerialFilter(source, movie, title);
            }
        }

        // ── Уровень 2a: фильм → список озвучек ───────────────────────────────

        /**
         * Фильм: показать строки озвучек; по клику — Lampa.Player.play.
         *
         * Режим "separate" (Kodik/HDrezka/CDNVideoHub):
         *   Каждая запись voices[] — отдельный поток со своим qualities.
         *   Показываем N строк (по числу озвучек), клик = перезагрузка потока.
         *
         * Режим "tracks" (Alloha/Collaps/femd):
         *   voices[] содержит ОДНУ запись с мастер-потоком и audioTracks[].
         *   Показываем ОДИН пункт; аудиодорожки передаём через translate.tracks,
         *   чтобы Lampa подписала их именами вместо «ru0/ru1» (паттерн online_mod.js).
         *
         * @param {Source} source
         * @param {Object} movie
         * @param {string} title
         */
        function _buildVoiceLevel(source, movie, title) {
            var voices    = source.voices || [];
            var audioMode = source.audioMode || 'separate';

            if (!voices.length) {
                _this.empty();
                return;
            }

            if (audioMode === 'tracks') {
                // ── tracks: один поток, аудиодорожки внутри ──────────────────
                var voice = voices[0];
                _buildTracksItem(source, voice, movie, title);
            } else {
                // ── separate: N озвучек с разными потоками ────────────────────
                filter_items.voice = voices.map(function (v) { return v.name; });
                choice.voice       = 0;
                _this.filter(filter_items, choice);

                voices.forEach(function (voice) {
                    var qualStr  = Object.keys(voice.qualities || {}).join(' / ') || '—';
                    var castMark = source.castable ? ' ✓' : '';
                    var subMark  = (voice.subtitles && voice.subtitles.length) ? ' [Sub]' : '';

                    var item = Lampa.Template.get('online_core_item', {
                        title:   voice.name || 'Озвучка',
                        quality: qualStr + castMark,
                        info:    subMark
                    });

                    item.on('hover:enter', function () {
                        _playSeparateVoice(voice, title, movie);
                    });

                    _this.append(item);
                });
            }

            _this.start(true);
        }

        /**
         * Построить и добавить ОДИН пункт для tracks-режима (фильм).
         * Играем мастер-поток; аудиодорожки передаём через translate.tracks.
         *
         * @param {Source} source
         * @param {Voice}  voice   — единственная запись voices[0]
         * @param {Object} movie
         * @param {string} title
         */
        function _buildTracksItem(source, voice, movie, title) {
            var atStr    = audioInfo(voice.audioTracks);
            var qualStr  = Object.keys(voice.qualities || {}).join(' / ') || '—';
            var castMark = source.castable ? ' ✓' : '';
            var subMark  = (voice.subtitles && voice.subtitles.length) ? ' [Sub]' : '';

            var item = Lampa.Template.get('online_core_item', {
                title:   title || 'Смотреть',
                quality: qualStr + castMark,
                info:    (atStr ? ' · ' + atStr : '') + subMark
            });

            item.on('hover:enter', function () {
                _playTracksVoice(voice, title, movie);
            });

            _this.append(item);
        }

        /**
         * Воспроизвести озвучку в режиме "separate" (отдельный поток для каждой озвучки).
         *
         * @param {Voice}  voice
         * @param {string} title
         * @param {Object} movie
         */
        function _playSeparateVoice(voice, title, movie) {
            if (voice.resolve && !voice._resolved) {
                _this.activity.loader(true);
                voice.resolve().then(function (rv) {
                    _this.activity.loader(false);
                    var real = rv && rv[0];
                    if (!real || !real.qualities) { Lampa.Noty.show('Не удалось извлечь поток'); return; }
                    _playSeparateVoice({
                        name: voice.name, id: voice.id,
                        qualities: real.qualities,
                        subtitles: real.subtitles || voice.subtitles,
                        _resolved: true
                    }, title, movie);
                }).catch(function (e) {
                    _this.activity.loader(false);
                    Lampa.Noty.show('Ошибка потока: ' + (e && e.message || e));
                });
                return;
            }

            var url = getDefaultQuality(voice.qualities);
            if (!url) {
                Lampa.Noty.show('Нет потока для этой озвучки');
                return;
            }

            var playerItem = {
                url:       url,
                quality:   renameQualityMap(voice.qualities),
                subtitles: mapSubtitles(voice.subtitles),
                title:     title + (voice.name ? ' / ' + voice.name : ''),
                timeline:  Lampa.Timeline.view(
                    Lampa.Utils.hash(title + String(voice.id || voice.name))
                )
            };

            if (movie && movie.id) Lampa.Favorite.add('history', movie, 100);
            Lampa.Player.play(playerItem);
            Lampa.Player.playlist([playerItem]);
        }

        /**
         * Воспроизвести в режиме "tracks" (один поток + аудиодорожки).
         * Передаём translate.tracks — паттерн online_mod.js collaps:
         *   Lampa.Player.play({ ..., translate: { tracks: [{language: name}] } })
         * Lampa использует tracks[i].language как подпись i-й аудиодорожки HLS.
         *
         * Субтитры: voice.subtitles (внешние файлы) → subtitles:[{label,url}].
         *
         * @param {Voice}  voice   — единственная запись voices[0]
         * @param {string} title
         * @param {Object} movie
         */
        function _playTracksVoice(voice, title, movie) {
            // Alloha/iframe-источники отдают URL плеера + ленивый resolve() с реальным HLS.
            // Извлекаем настоящий поток ПЕРЕД запуском плеера.
            if (voice.resolve && !voice._resolved) {
                _this.activity.loader(true);
                voice.resolve().then(function (rv) {
                    _this.activity.loader(false);
                    var real = rv && rv[0];
                    if (!real || !real.qualities) { Lampa.Noty.show('Не удалось извлечь поток'); return; }
                    _playTracksVoice({
                        name: voice.name, id: voice.id,
                        qualities: real.qualities,
                        subtitles: real.subtitles || voice.subtitles,
                        audioTracks: voice.audioTracks,
                        _resolved: true
                    }, title, movie);
                }).catch(function (e) {
                    _this.activity.loader(false);
                    Lampa.Noty.show('Ошибка потока: ' + (e && e.message || e));
                });
                return;
            }

            var url = getDefaultQuality(voice.qualities);
            if (!url) {
                Lampa.Noty.show('Нет потока');
                return;
            }

            var atracks = mapAudioTracks(voice.audioTracks);

            var playerItem = {
                url:       url,
                quality:   renameQualityMap(voice.qualities),
                subtitles: mapSubtitles(voice.subtitles),
                title:     title,
                timeline:  Lampa.Timeline.view(
                    Lampa.Utils.hash(title + String(voice.id || voice.name || 'tracks'))
                )
            };

            // translate.tracks — имена аудиодорожек (паттерн online_mod.js collaps, строки 3578–3592).
            // Если дорожки есть — добавляем; если нет — Lampa берёт из манифеста.
            if (atracks) {
                playerItem.translate = { tracks: atracks };
            }

            if (movie && movie.id) Lampa.Favorite.add('history', movie, 100);
            Lampa.Player.play(playerItem);
            Lampa.Player.playlist([playerItem]);
        }

        // ── Уровень 2б: сериал → фильтр озвучка/сезон + серии ────────────────

        /**
         * Сериал: построить фильтр (озвучка / сезон) и список серий.
         * Паттерн online_mod.js — filter_items.voice + filter_items.season_num.
         *
         * audioMode учитывается при воспроизведении серии (_playEpisode).
         *
         * @param {Source} source
         * @param {Object} movie
         * @param {string} title
         */
        function _buildSerialFilter(source, movie, title) {
            var seasons = source.seasons || [];
            if (!seasons.length) {
                _this.empty();
                return;
            }

            // Собираем имена озвучек из первых доступных серий
            var voiceNames = _collectVoiceNames(seasons, source.audioMode);
            if (!voiceNames.length) voiceNames = ['По умолчанию'];

            // Инициализируем фильтр
            filter_items.voice      = voiceNames;
            filter_items.season_num = seasons.map(function (s) { return 'Сезон ' + s.num; });
            choice.voice  = Math.min(choice.voice,  voiceNames.length  - 1);
            choice.season = Math.min(choice.season, seasons.length - 1);
            _this.filter(filter_items, choice);

            // Сохраняем контекст для перерисовки при смене фильтра
            _this._coreCtx = {
                source:     source,
                seasons:    seasons,
                voiceNames: voiceNames,
                movie:      movie,
                title:      title
            };

            _buildEpisodeLevel(seasons[choice.season], choice.voice, voiceNames, movie, title, source);
        }

        /**
         * Собрать уникальные имена озвучек из первых серий (у кого voices уже есть).
         *
         * В режиме "tracks" озвучки = аудиодорожки внутри потока; имена берём из audioTracks[].
         * В режиме "separate" имена берём из voices[].name.
         *
         * @param {Season[]} seasons
         * @param {string}   audioMode
         * @returns {string[]}
         */
        function _collectVoiceNames(seasons, audioMode) {
            var names = [];
            seasons.forEach(function (season) {
                (season.episodes || []).forEach(function (ep) {
                    var voices = ep.voices || [];
                    if (audioMode === 'tracks') {
                        // Один поток: дорожки из voices[0].audioTracks
                        var v0 = voices[0];
                        if (v0 && v0.audioTracks) {
                            v0.audioTracks.forEach(function (t) {
                                var n = t.name || t.lang || '';
                                if (n && names.indexOf(n) === -1) names.push(n);
                            });
                        }
                    } else {
                        // Separate: каждая запись voices — отдельная озвучка
                        voices.forEach(function (v) {
                            if (v.name && names.indexOf(v.name) === -1) names.push(v.name);
                        });
                    }
                });
            });
            return names;
        }

        // ── Уровень 3: список серий текущего сезона ───────────────────────────

        /**
         * Отрисовать серии выбранного сезона.
         * Если у серии нет voices (только resolveLazy) — загружаем по клику.
         *
         * @param {Season}   season
         * @param {number}   voiceIdx
         * @param {string[]} voiceNames
         * @param {Object}   movie
         * @param {string}   title
         * @param {Source}   source
         */
        function _buildEpisodeLevel(season, voiceIdx, voiceNames, movie, title, source) {
            _this.reset();

            if (!season || !season.episodes || !season.episodes.length) {
                _this.empty();
                return;
            }

            season.episodes.forEach(function (episode) {
                var epLabel = 'С' + season.num + 'E' + episode.num +
                              (episode.title ? ' — ' + episode.title : '');
                var voiceName = voiceNames[voiceIdx] || '';

                var item = Lampa.Template.get('online_core_item', {
                    title:   epLabel,
                    quality: source.castable ? '✓cast' : '',
                    info:    voiceName ? ' · ' + voiceName : ''
                });

                item.on('hover:enter', function () {
                    if (episode.voices && episode.voices.length) {
                        // Озвучки уже резолвлены — играем сразу
                        _playEpisode(episode.voices, voiceIdx, title, epLabel, season, episode, movie, source.audioMode);
                    } else if (typeof episode.resolveLazy === 'function') {
                        // Ленивый резолв (Kodik/Alloha/HDrezka) — тянем по клику
                        _this.loading(true);
                        episode.resolveLazy()
                            .then(function (voices) {
                                _this.loading(false);
                                episode.voices = voices; // кешируем
                                _playEpisode(voices, voiceIdx, title, epLabel, season, episode, movie, source.audioMode);
                            })
                            .catch(function (e) {
                                _this.loading(false);
                                Lampa.Noty.show('Ошибка загрузки серии: ' + (e && e.message || String(e)));
                            });
                    } else {
                        Lampa.Noty.show('Нет потока для этой серии');
                    }
                });

                _this.append(item);
            });

            _this.start(true);
        }

        // ── Воспроизведение ───────────────────────────────────────────────────

        /**
         * Запустить плеер для конкретной серии.
         *
         * audioMode "separate": выбираем voices[voiceIdx] — у него свой поток.
         * audioMode "tracks":   берём voices[0] (один мастер-поток); voiceIdx используется
         *   для установки активной дорожки (пока передаём все треки через translate.tracks,
         *   выбор конкретной дорожки по умолчанию — на стороне Lampa/плеера).
         *
         * Субтитры: voice.subtitles (внешние файлы) передаём в playerItem.subtitles.
         * Встроенные в HLS-манифест Lampa берёт сама — не дублируем.
         *
         * @param {Voice[]} voices
         * @param {number}  voiceIdx
         * @param {string}  movieTitle
         * @param {string}  epLabel
         * @param {Season}  season
         * @param {Episode} episode
         * @param {Object}  movie
         * @param {string}  audioMode   — "separate" | "tracks"
         */
        function _playEpisode(voices, voiceIdx, movieTitle, epLabel, season, episode, movie, audioMode) {
            var voice;

            if (audioMode === 'tracks') {
                // Один мастер-поток; voiceIdx не влияет на выбор голоса
                voice = voices[0];
            } else {
                // Separate: каждая запись voices — свой поток
                voice = voices[voiceIdx] || voices[0];
            }

            if (!voice) {
                Lampa.Noty.show('Нет потока для этой серии');
                return;
            }

            var url = getDefaultQuality(voice.qualities);
            if (!url) {
                Lampa.Noty.show('Нет URL для этой серии');
                return;
            }

            var playerTitle = movieTitle + ' / ' + epLabel +
                              (audioMode !== 'tracks' && voice.name ? ' / ' + voice.name : '');

            var playerItem = {
                url:       url,
                quality:   renameQualityMap(voice.qualities),
                subtitles: mapSubtitles(voice.subtitles),
                title:     playerTitle,
                timeline:  Lampa.Timeline.view(
                    Lampa.Utils.hash([movieTitle, season.num, episode.num, audioMode !== 'tracks' ? (voice.name || '') : 'tracks'].join(':'))
                )
            };

            // tracks-режим: имена аудиодорожек → translate.tracks (паттерн online_mod.js collaps).
            if (audioMode === 'tracks') {
                var atracks = mapAudioTracks(voice.audioTracks);
                if (atracks) {
                    playerItem.translate = { tracks: atracks };
                }
            }

            if (movie && movie.id) Lampa.Favorite.add('history', movie, 100);
            Lampa.Player.play(playerItem);
            Lampa.Player.playlist([playerItem]);
        }

        // ── Обработка фильтра ─────────────────────────────────────────────────

        /**
         * Применить изменение фильтра (озвучка / сезон).
         * Паттерн online_mod.js: this.filter вызывается Lampa при выборе в шапке.
         * Аргументы: (type, filterDef:{stype}, selectedItem:{index}).
         *
         * @param {string} type
         * @param {Object} a  — { stype: 'voice'|'season'|'source', … }
         * @param {Object} b  — { index: number, title: string }
         */
        // ── Построение фильтра (источник / озвучка / сезон) ───────────────────
        // ВАЖНО: build-функции вызывают _this.filter(filter_items, choice).
        this.filter = function (items, ch) {
            if (items) filter_items = items;
            if (ch)    choice = ch;

            var select = [];
            select.push({ title: Lampa.Lang.translate('torrent_parser_reset'), reset: true });

            var add = function (type, title) {
                var list = filter_items[type];
                if (!list || !list.length) return;
                var subitems = list.map(function (name, i) {
                    return { title: name, selected: choice[type] === i, index: i };
                });
                select.push({
                    title:    title,
                    subtitle: list[choice[type]] || list[0],
                    items:    subitems,
                    stype:    type
                });
            };

            add('source', 'Источник');
            add('voice',  Lampa.Lang.translate('torrent_parser_voice'));
            add('season', Lampa.Lang.translate('torrent_serial_season'));

            filter.set('filter', select);

            var chosen = [];
            if (filter_items.voice  && filter_items.voice.length  > 1) chosen.push(filter_items.voice[choice.voice]);
            if (filter_items.season && filter_items.season.length > 1) chosen.push(Lampa.Lang.translate('torrent_serial_season') + ': ' + filter_items.season[choice.season]);
            filter.chosen('filter', chosen);
        };

        // Обработка выбора в фильтре (источник / озвучка / сезон / сброс)
        function onFilterSelect(type, a, b) {
            if (type !== 'filter') return;

            if (a.reset) {
                choice = { source: 0, voice: 0, season: 0 };
                _this.search();
                return;
            }
            if (!b) return;

            choice[a.stype] = b.index;
            var ctx = _this._coreCtx;

            if (a.stype === 'source') {
                var src = _okSources[choice.source];
                if (src) { _this.reset(); _openSource(src); }
            } else if (ctx) {
                _this.reset();
                _buildEpisodeLevel(ctx.seasons[choice.season], choice.voice, ctx.voiceNames, ctx.movie, ctx.title, ctx.source);
            }

            _this.filter(filter_items, choice);
            setTimeout(function () {
                if ($('body').hasClass('selectbox--open')) Lampa.Select.close();
            }, 10);
        }

        // ── Жизненный цикл Lampa-компонента ───────────────────────────────────
        this.create = function () {
            this.activity.loader(true);

            filter.onSelect = onFilterSelect;
            filter.onBack   = function () { _this.start(); };
            filter.onSearch = function (value) {
                Lampa.Activity.replace({ search: value, clarification: true });
            };

            files.appendHead(filter.render());
            files.appendFiles(scroll.render());

            this.search();
            return this.render();
        };

        this.loading = function (status) {
            if (status) {
                this.activity.loader(true);
            } else {
                this.activity.loader(false);
                if (Lampa.Activity.active().activity === this.activity) this.activity.toggle();
            }
        };

        // Очистить список перед перерисовкой уровня
        this.reset = function () {
            last = filter.render().find('.selector').eq(0)[0];
            scroll.render().find('.empty').remove();
            scroll.clear();
            scroll.reset();
        };

        this.append = function (item) {
            item.on('hover:focus', function (e) {
                last = e.target;
                scroll.update($(e.target), true);
            });
            scroll.append(item);
        };

        this.empty = function (msg) {
            var empty = Lampa.Template.get('list_empty');
            if (msg) empty.find('.empty__descr').text(msg);
            scroll.append(empty);
            this.activity.loader(false);
        };

        this.start = function (first_select) {
            if (Lampa.Activity.active().activity !== this.activity) return;

            if (first_select) last = scroll.render().find('.selector').eq(0)[0];

            Lampa.Background.immediately(Lampa.Utils.cardImgBackground(object.movie || {}));

            Lampa.Controller.add('content', {
                toggle: function () {
                    Lampa.Controller.collectionSet(scroll.render(), files.render());
                    Lampa.Controller.collectionFocus(last || false, scroll.render());
                },
                up: function () {
                    if (Navigator.canmove('up')) Navigator.move('up');
                    else Lampa.Controller.toggle('head');
                },
                down: function () { Navigator.move('down'); },
                right: function () {
                    if (Navigator.canmove('right')) Navigator.move('right');
                    else filter.show(Lampa.Lang.translate('title_filter'), 'filter');
                },
                left: function () {
                    if (Navigator.canmove('left')) Navigator.move('left');
                    else Lampa.Controller.toggle('menu');
                },
                back: this.back
            });

            Lampa.Controller.toggle('content');
        };

        this.render = function () {
            return files.render();
        };

        this.back = function () {
            Lampa.Activity.backward();
        };

        this.pause = function () {};
        this.stop  = function () {};

        /**
         * Освободить ресурсы при уходе с активности.
         */
        this.destroy = function () {
            _destroyed = true;
            _result    = null;
            _okSources = [];
            _this._coreCtx = null;
            if (files)  files.destroy();
            if (scroll) scroll.destroy();
        };
    }

    // ─── Запуск поиска ────────────────────────────────────────────────────────

    /**
     * Открыть активность онлайн-просмотра.
     * Паттерн online_mod.js: Component.add → Activity.push.
     *
     * @param {Object} movie  — объект карточки Lampa
     */
    function openOnlineCore(movie) {
        // Перерегистрируем компонент перед push (как в online_mod.js)
        Lampa.Component.add(PLUGIN_NAME, component);

        Lampa.Activity.push({
            url:        '',
            title:      'Смотреть · ' + (movie.title || movie.original_title || ''),
            component:  PLUGIN_NAME,
            search:     movie.title || movie.original_title || '',
            search_one: movie.title || '',
            search_two: movie.original_title || '',
            movie:      movie,
            page:       1
        });
    }

    // ─── Инициализация плагина ────────────────────────────────────────────────

    /**
     * Точка входа плагина.
     * Вызывается один раз — либо сразу (если appready), либо по событию 'app'/'ready'.
     */
    function initPlugin() {
        // Заглушка на старте (паттерн online_mod.js, чтобы Lampa не ругалась «пусто»)
        Lampa.Component.add(PLUGIN_NAME, component);

        registerTemplates();

        // ── Manifest — контекстное меню карточки ──────────────────────────────
        var manifest = {
            type:        'video',
            version:     PLUGIN_VERSION,
            name:        'Online Core ' + PLUGIN_VERSION,
            description: 'Смотреть онлайн',
            component:   PLUGIN_NAME,

            onContextMenu: function (object) {
                return { name: 'Смотреть (core)', description: '' };
            },
            onContextLauch: function (object) {
                openOnlineCore(object.movie || object);
            }
        };
        Lampa.Manifest.plugins = manifest;

        // ── Настройка: личный токен Kodik (полный каталог) ────────────────────
        try {
            if (Lampa.SettingsApi) {
                Lampa.SettingsApi.addParam({
                    component: 'interface',
                    param: { name: 'online_core_kodik_token', type: 'input', 'default': '' },
                    field: {
                        name: 'Kodik — токен API',
                        description: 'Свой токен Kodik = полный каталог. Пусто = встроенный (ограничен, в основном аниме).'
                    }
                });
            }
        } catch (e) {}

        // ── Кнопка на карточке — паттерн online_mod.js ────────────────────────
        // SVG-иконка (повторяет иконку online_mod.js для визуальной согласованности).
        var buttonHtml =
            '<div class="full-start__button selector view--online_core" data-subtitle="online_core ' + PLUGIN_VERSION + '">' +
                '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 244 260" style="enable-background:new 0 0 512 512" xml:space="preserve">' +
                    '<g>' +
                        '<path d="M242,88v170H10V88h41l-38,38h37.1l38-38h38.4l-38,38h38.4l38-38h38.3l-38,38H204L242,88L242,88z ' +
                              'M228.9,2l8,37.7l0,0L191.2,10L228.9,2z M160.6,56l-45.8-29.7l38-8.1l45.8,29.7L160.6,56z ' +
                              'M84.5,72.1L38.8,42.4l38-8.1l45.8,29.7L84.5,72.1z M10,88L2,50.2L47.8,80L10,88z" fill="currentColor"/>' +
                    '</g>' +
                '</svg>' +
                '<span>Смотреть (core)</span>' +
            '</div>';

        // Вставка кнопки в .buttons--container (как в ReYohoho — чтобы кнопка
        // попала в общий список «Источник»), с фолбэками для других сборок Lampa.
        function appendCoreButton(root, movie) {
            if (!root || !root.find) return;
            if (root.find('.view--online_core').length) return; // уже добавлена

            var btn = $(buttonHtml);
            btn.on('hover:enter', function () { openOnlineCore(movie || {}); });

            var torrent = root.find('.buttons--container .view--torrent');
            if (torrent.length) { torrent.after(btn); return; }

            var container = root.find('.buttons--container');
            if (container.length) { container.append(btn); return; }

            var box = root.find('.full-start-new__buttons, .full-start__buttons');
            if (box.length) { box.append(btn); return; }

            root.find('.button--play, .view--trailer, .full-start__button').first().after(btn);
        }

        Lampa.Listener.follow('full', function (e) {
            if (e.type !== 'complite') return;
            appendCoreButton(e.object.activity.render(), e.data && e.data.movie ? e.data.movie : {});
        });

        // Карточка уже открыта (плагин загрузился после неё) — добавляем сразу.
        try {
            var active = Lampa.Activity.active && Lampa.Activity.active();
            if (active && active.component === 'full' && active.activity && active.activity.render) {
                appendCoreButton(active.activity.render(), active.card || active.movie || {});
            }
        } catch (err) {}
    }

    // ─── Ждём готовности приложения ───────────────────────────────────────────
    // Паттерн из online_mod.js: if (window.appready) сразу, иначе слушаем событие.

    if (window.appready) {
        initPlugin();
    } else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') initPlugin();
        });
    }


}(typeof window !== "undefined" ? window : (typeof self !== "undefined" ? self : {})));

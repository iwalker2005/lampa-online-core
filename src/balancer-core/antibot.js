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

(function () {
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
})();

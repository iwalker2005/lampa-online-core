/**
 * balancer-core/secrets.js — токены балансёров (порт из balancer-search.js 248–278).
 * Чистый модуль, без chrome.* и DOM.
 *
 * Экспортирует: salt, decodeSecret, deriveToken, TOK_ALLOHA_CRACKED.
 */

(function () {
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
    if (id === 'kodik') return decodeSecret(TOK_KODIK, 'find your own token');
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
})();

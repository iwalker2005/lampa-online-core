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

(function () {
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

      // Guard: в Lampa-WebView нет chrome.* и может не быть window.fetch —
      // браузерный транспорт здесь не должен использоваться, но на случай
      // ошибочного вызова — вернём rejected promise вместо ReferenceError.
      if (typeof fetch === 'undefined') {
        return Promise.reject(new Error('browserTransport: fetch недоступен (используйте lampaTransport в Lampa)'));
      }

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
})();

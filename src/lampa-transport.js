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

(function () {
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

        // Итоговый URL (через воркер enc2t если есть proxy)
        var finalUrl = proxy ? proxyLink(url, proxy, proxy_enc, 'enc2t') : url;

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

})();

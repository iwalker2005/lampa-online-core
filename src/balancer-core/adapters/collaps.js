/**
 * balancer-core/adapters/collaps.js — адаптер Collaps (CDN interkh, открыт).
 *
 * capabilities: cdn=interkh, srcIp=false, castable=true, antiBot=none, resolveOn=any.
 * Парсер: VenomPlayer (parseMakePlayer) — тот же формат, что femd.
 */

(function () {
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
  var FEMD_LIVE = 'https://api.femd.ws';

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

      var primaryUrl  = 'https://api.kinogram.best/embed/kp/' + kp;
      var reserveUrl  = 'https://api.synchroncode.com/embed/kp/' + kp;

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
          var src = { balancer: 'collaps', ok: true, cdn: 'interkh', castable: true, resolveOn: 'any' };
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
})();

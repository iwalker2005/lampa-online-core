/**
 * balancer-core/adapters/femd.js — адаптер femd / HDVB (CDN interkh, открыт).
 * Тот же VenomPlayer-формат, что Collaps. Домены ротируются → actualizeUrl.
 *
 * capabilities: cdn=interkh, srcIp=false, castable=true, antiBot=none, resolveOn=any.
 */

(function () {
  'use strict';

  var _parsers;
  if (typeof module !== 'undefined' && module.exports) {
    _parsers = require('./_venom.js');
  } else {
    var g = (typeof self !== 'undefined' ? self : window);
    _parsers = g.BalancerCore;
  }

  var FEMD_POOL = /^(?:https?:)?\/\/(?:[a-z0-9]+\.)?(?:delivembed\.cc|buildplayer\.com|embedstorage\.net|mir-dikogo-zapada\.com|multikland\.net|placehere\.link|ameytools\.club|(?:tobaco|topdbltj|delivembd|hostemb|loadbox|getcodes|strvid|ebder|framprox|embprox|bedemp2|embr|lessornot|linktodo|insertunit|marts|ninsel|embess|luxembd|domem|atomics|namy|variyt|zenithjs|ortified)\.ws)\b/i;
  var FEMD_LIVE = 'https://api.femd.ws';

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

      var url = actualizeUrl('https://api.femd.ws/embed/kp/' + kp);

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
})();

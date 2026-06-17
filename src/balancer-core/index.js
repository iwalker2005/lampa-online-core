/**
 * balancer-core/index.js — реестр адаптеров + resolveAll.
 *
 * Экспортирует:
 *   adapters  — массив всех адаптеров
 *   resolveAll(query, transport) → Promise<ResolveResult>
 */

(function () {
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
    var promises = adapters.map(function (adapter) {
      return adapter.resolve(query, transport).catch(function (e) {
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
        query: query,
        type: type,
        sources: sources
      };
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
})();

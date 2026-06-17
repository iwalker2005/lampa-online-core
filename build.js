/**
 * build.js — сборщик dist/online_core.js для Lampa-плагина.
 *
 * Порядок конкатенации (зависимости → потребители):
 *   1. balancer-core/{schema,secrets,antibot,transport}.js
 *   2. balancer-core/adapters/_venom.js
 *   3. balancer-core/adapters/{collaps,femd,kodik,alloha,hdrezka,cdnvideohub}.js
 *   4. balancer-core/index.js
 *   5. src/lampa-transport.js
 *   6. src/lampa-plugin.js (если существует — добавляется напарником)
 *
 * Все файлы оборачиваются в один общий IIFE.
 * Запуск: node build.js
 */

'use strict';

var fs   = require('fs');
var path = require('path');

// ── Константы ────────────────────────────────────────────────────────────────
var ROOT    = __dirname;
var SRC     = path.join(ROOT, 'src');
var CORE    = path.join(SRC, 'balancer-core');
var DIST    = path.join(ROOT, 'dist');
var OUTPUT  = path.join(DIST, 'online_core.js');

var VERSION = '1.0.0';
var DATE    = new Date().toISOString().slice(0, 10);

// ── Порядок файлов ───────────────────────────────────────────────────────────
var FILES = [
  // balancer-core: базовые модули
  path.join(CORE, 'schema.js'),
  path.join(CORE, 'secrets.js'),
  path.join(CORE, 'antibot.js'),
  path.join(CORE, 'transport.js'),

  // адаптеры
  path.join(CORE, 'adapters', '_venom.js'),
  path.join(CORE, 'adapters', 'collaps.js'),
  path.join(CORE, 'adapters', 'femd.js'),
  path.join(CORE, 'adapters', 'kodik.js'),
  path.join(CORE, 'adapters', 'alloha.js'),
  path.join(CORE, 'adapters', 'hdrezka.js'),
  path.join(CORE, 'adapters', 'cdnvideohub.js'),

  // реестр + resolveAll
  path.join(CORE, 'index.js'),

  // Lampa-специфика
  path.join(SRC, 'lampa-transport.js'),
];

// lampa-plugin.js включается если файл уже создан напарником
var PLUGIN = path.join(SRC, 'lampa-plugin.js');
if (fs.existsSync(PLUGIN)) {
  FILES.push(PLUGIN);
} else {
  console.log('[build] lampa-plugin.js не найден — будет добавлен при следующей сборке');
}

// ── Шапка ────────────────────────────────────────────────────────────────────
var HEADER = [
  '/*!',
  ' * online_core.js — Balancer Core + Lampa Transport',
  ' * Version: ' + VERSION,
  ' * Built:   ' + DATE,
  ' * https://github.com/nb557/lampa-online-core',
  ' *',
  ' * Содержит: schema, secrets, antibot, transport (browser/node/lampa),',
  ' *   адаптеры: Collaps, femd, Kodik, Alloha, HDrezka, CDNVideoHub,',
  ' *   lampaTransport (Lampa.Reguest + proxyLink enc2t).',
  ' */',
  ''
].join('\n');

// ── Читаем и обрабатываем каждый файл ────────────────────────────────────────
/**
 * Из каждого файла вырезаем внешний IIFE-враппер (если есть):
 *   (function () { ... })();
 * Оставляем только тело — оно будет в общем IIFE.
 *
 * Паттерн: файл начинается с опционального комментария, затем '(function'
 * и заканчивается '})();' или '}.call(this);'.
 */
function stripIIFE(src, filepath) {
  // Убираем строки с 'use strict' на верхнем уровне (в общем IIFE будет одна)
  var content = src;

  // Ищем внешний (function () { ... })() враппер
  // Стратегия: найти первый '(function' и последний '})();' / '}.call(this);'
  var startIdx = content.indexOf('(function');
  if (startIdx === -1) {
    console.warn('[build] Нет IIFE в ' + path.basename(filepath) + ' — включаем как есть');
    return content;
  }

  // Обрезаем до '(function'
  // Всё что до него (JSDoc-комментарии) — сохраняем как комментарий
  var before = content.slice(0, startIdx).trim();

  var inner = content.slice(startIdx);

  // Снимаем обёртку: '(function () {' в начале и '})();' / '})()' / '}.call(this)' в конце
  // Убираем первую строку — '(function () {' или '(function() {'
  var firstBrace = inner.indexOf('{');
  if (firstBrace === -1) {
    return content;
  }
  // Убираем от начала до первой открывающей скобки включительно
  var body = inner.slice(firstBrace + 1);

  // Убираем хвост '  })();' или '})();' или '}.call(this);' — ищем с конца
  // Хвост: последнее вхождение })(); или }).call(this);
  body = body.trimRight();

  // Снимаем хвостовой враппер
  var tailRe = /\}\s*\)\s*\(\s*\)\s*;?\s*$|\.call\s*\(\s*this\s*\)\s*;?\s*$/;
  body = body.replace(tailRe, '');
  // Ещё раз на случай '})'
  body = body.trimRight();
  if (body.slice(-1) === '}') {
    // возможно последняя закрывающая скобка объекта API,
    // но хвостовой '}' враппера уже мог быть снят. Проверяем:
    // если после последней '}' идёт ')();' — снимаем
    // (уже сделано выше через regex)
  }

  // Собираем: оригинальный JSDoc-комментарий + тело без враппера
  var result = '';
  if (before) result += before + '\n';
  result += body;
  return result;
}

// ── Создаём dist/ ─────────────────────────────────────────────────────────────
if (!fs.existsSync(DIST)) {
  fs.mkdirSync(DIST, { recursive: true });
}

// ── Конкатенируем ─────────────────────────────────────────────────────────────
var parts = [];

FILES.forEach(function (fp) {
  if (!fs.existsSync(fp)) {
    console.error('[build] ФАЙЛ НЕ НАЙДЕН: ' + fp);
    process.exit(1);
  }
  var src = fs.readFileSync(fp, 'utf8');
  var name = path.relative(ROOT, fp).replace(/\\/g, '/');
  var stripped = stripIIFE(src, fp);
  parts.push('// ── ' + name + ' ──────────────────────────────────────────');
  parts.push(stripped.trim());
  parts.push('');
});

// ── Собираем итоговый файл ────────────────────────────────────────────────────
var body = parts.join('\n');

// Единый IIFE-враппер (не трогаем inner 'use strict')
var output = [
  HEADER,
  '(function (window) {',
  "'use strict';",
  '',
  body,
  '',
  '}(typeof window !== "undefined" ? window : (typeof self !== "undefined" ? self : {})));',
  ''
].join('\n');

fs.writeFileSync(OUTPUT, output, 'utf8');

var sizeKb = (fs.statSync(OUTPUT).size / 1024).toFixed(1);
console.log('[build] OK: ' + OUTPUT + ' (' + sizeKb + ' KB)');
console.log('[build] Файлов включено: ' + FILES.length);

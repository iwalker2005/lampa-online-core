# balancer-core

Переиспользуемое ядро адаптеров балансёров (фаза 2 плана UNIFIED-API-SPEC).

## Структура

```
balancer-core/
  schema.js        — JSDoc-типы (Source/Voice/Season) + хелперы субтитров
  transport.js     — browserTransport / nodeTransport
  secrets.js       — salt / decodeSecret / deriveToken
  antibot.js       — G7/G8/G9 + buildBorth / kodikDecodeUrl / clearTrash
  index.js         — реестр адаптеров + resolveAll(query, transport)
  adapters/
    _venom.js      — общий парсер VenomPlayer (Collaps + femd)
    collaps.js     — Collaps (kinogram.best / synchroncode.com)
    femd.js        — femd / HDVB (api.femd.ws)
    kodik.js       — Kodik (ROT18+ftor)
    alloha.js      — Alloha (borth+bnsi)
    hdrezka.js     — HDrezka (clearTrash+Playerjs)
    cdnvideohub.js — CDNVideoHub (OK.ru, srcIp)
```

## Формат модулей

UMD-ish: работает и как `<script>` в расширении (→ `window.BalancerCore`),
и в Node через `require()`.

## Результаты smoke-теста (`node tools/balancer-core/_smoke.mjs`)

Запуск 2026-06-17, Node 18, ветка `high`:

```
=== balancer-core smoke test ===

--- Тест 1: kp=301 (Матрица) ---
Запрос: {"kp":"301"}
Тип: movie
  ✓ collaps (interkh): ok, 22 озвучек, качества: HLS (.m3u8), DASH (.mpd)
  ✓ femd (interkh): ok, 22 озвучек, качества: HLS (.m3u8), DASH (.mpd)
  ✗ kodik: не найден
  ✓ alloha (vkvideo): ok, 7 озвучек, качества: WEB-DL · iframe
  ✓ hdrezka (voidboost): ok, 6 озвучек, качества: 360p, 480p, 720p, 1080p, 1080p Ultra
  ✓ cdnvideohub (okcdn): ok, 3 озвучек, качества: 720p, 480p, 360p, 240p, 144p, DASH (.mpd), HLS

--- Тест 2: title=Наруто ---
Запрос: {"title":"Наруто"}
Тип: serial
  ✗ collaps: kp обязателен
  ✗ femd: kp обязателен
  ✓ kodik (solodcdn): ok, сериал, 2 сезонов, 793 серий
  ✗ alloha: kp обязателен
  ✗ hdrezka: kp обязателен
  ✗ cdnvideohub: kp обязателен

=== done ===
```

### Пояснения

- **Kodik kp=301** — не найден: Kodik специализируется на аниме/сериалах; Матрица там редко есть.
- **Alloha** — `ok=true`, но qualities содержат iframe-ссылки (шаг 1 apbugall). Borth+bnsi-шаги
  (2–4) выполняются ленивым `voice.resolve()` — только на устройстве пользователя (srcIp).
- **Collaps/femd** — 22 озвучки: VenomPlayer мультиаудио HLS.
- **Kodik Наруто** — 793 серии в 2 сезонах (Kodik считает разные части как сезоны).
- **title=Наруто** для других адаптеров: они требуют kp — это правильно (поддержку title
  добавим в index.js в следующей итерации через apbugall-поиск).

## Подключение в расширении

`sidepanel.html` подключает все core-скрипты ДО `balancer-search.js`.
`window.BalancerCore` доступен в `balancer-search.js`.

Полная интеграция (замена inline-логики BALANCERS на вызовы BalancerCore) —
следующий шаг (фаза 2b). Текущий `balancer-search.js` не тронут: UI/рендер/плеер работают
как раньше.

## Следующие шаги

1. Интеграция: заменить массив BALANCERS в `balancer-search.js` на `BalancerCore.adapters`
   через `browserTransport` (+ DNR-обёртка для Kodik/Alloha).
2. Добавить поиск по title через apbugall для адаптеров, принимающих только kp.
3. Фикстуры: сохранить живые `Source` JSON для Kodik/Alloha/Collaps (верификация спека §7).
4. Kotlin-порт: `secrets` + `antibot` (бесплатный перенос borth/ROT18).

# Единый API балансёров — СПЕЦИФИКАЦИЯ (язык-агностичная)

> Источник правды для трёх реализаций: **JS-ядро** (Chrome-расширение + Lampa-плагин) и
> **Kotlin-порт** (Android). Сервер (Node/Python) — позже, по тому же контракту.
> Версия спека: v1 (2026-06-17). План: [../../../.claude/plans/warm-purring-sunset.md].

Цель: каждый балансёр (Alloha/Kodik/Collaps/femd/HDrezka/CDNVideoHub) реализует один и тот же
**контракт адаптера** и возвращает одну и ту же **нормализованную схему**. Единственное, что
отличается между фронтами — **транспорт** (как сделать HTTP с подменой Referer/Origin).

---

## 1. Нормализованная схема (контракт выдачи)

```
ResolveResult {
  query:  { kp?, title?, imdb? },
  title?: string, year?: number,
  type:   "movie" | "serial",
  sources: Source[]                 // по одному на балансёр, у кого контент есть
}

Source {
  balancer: "alloha"|"kodik"|"collaps"|"femd"|"hdrezka"|"cdnvideohub",
  ok:       bool,
  error?:   string,                 // если ok=false
  cdn:      "vkvideo"|"interkh"|"solodcdn"|"okcdn"|"voidboost",
  castable: bool,                   // открытый CDN (играет с любого IP) vs srcIp-bound
  resolveOn:"device" | "any",       // device = srcIp (резолв на устройстве); any = можно на сервере
  voices?:  Voice[],                // type=movie
  seasons?: Season[]                // type=serial
}

Voice {
  name:  string,                    // "LostFilm" / "Дубляж" / "Озвучка 3"
  id:    string|number,
  qualities: { [label: string]: url },   // "2160p"|"1080p"|"720p"|…|"HLS (.m3u8)"|"DASH (.mpd)"
  audioTracks?: [{ name, lang }],        // мультиаудио в ОДНОМ HLS (Alloha/interkh): ru0→[0]
  subtitles?:   [{ lang, label, url, format: "vtt"|"srt" }]
}

Season  { num: int, episodes: Episode[] }
Episode { num: int, title: string, voices?: Voice[], resolveLazy?: () => Promise<Voice[]> }
```

**Правила:**
- `qualities` — словарь «метка → прямой URL потока». Метки числовые (`1080p`) ИЛИ контейнерные (`HLS (.m3u8)`, `DASH (.mpd)`).
- Сериал: серии могут отдавать `voices` сразу (Collaps/femd) или лениво через `resolveLazy()` (Kodik/Alloha/HDrezka/CDNVideoHub — токен серии временный, тянем по клику).
- `subtitles` уже реализованы в JS (раздел 4.6).
- `audioTracks` — для потоков, где озвучки сидят аудиодорожками в одном мастер-HLS; имена дорожек идут в порядке `ru0, ru1, …` и сопоставляются по индексу (`dubNames`).

---

## 2. Контракт адаптера (один на балансёр)

```
Adapter {
  id:   string,
  name: string,
  kind: "movie" | "serial" | "both",
  capabilities: { cdn, srcIp: bool, antiBot: "borth"|"ftor"|"none", castable: bool },

  // ЕДИНСТВЕННЫЙ метод. Использует ТОЛЬКО transport — никаких chrome.*/DOM/hls.js.
  resolve(query: {kp?, title?, imdb?}, transport): Promise<Source>
}
```

Реестр: `resolveAll(query, transport) → ResolveResult` опрашивает все адаптеры параллельно,
собирает `sources[]`, нормализует, проставляет `castable`/`resolveOn` из `capabilities`.

---

## 3. Транспорт-абстракция (единственный «клей»)

Браузер выкидывает `Referer`/`Origin`/`User-Agent` из `fetch()` (forbidden headers). Поэтому
транспорт абстрагируется, а каждый фронт реализует его по-своему:

```
transport.fetch(url, {
  referer?: string,
  origin?:  string,
  body?:    string,     // POST form-urlencoded
  headers?: { [k]: v }, // borth / Sraka-bot-Controls / X-Requested-With и т.п.
  creds?:   bool        // credentials:'include' (только Alloha GET плеера)
}) → { ok: bool, status: int, text(): Promise<string>, json(): Promise<object> }
```

| Фронт | Реализация |
|---|---|
| **Chrome-расширение** | DNR (`declarativeNetRequest`, rule 99997 Kodik / 99998 Alloha; `background.js setTabReferer` для плеера) ставит Referer/Origin; сам запрос — CORS-free `fetch` из sidepanel. |
| **Lampa-плагин** | `new Lampa.Reguest().native(proxyLink(url, prox2, 'enc2t'), ok, err, body, {headers})`. Referer/UA едут в base64 внутри `prox2` = `param/Referer=<b64>/param/Origin=<b64>/…`. CORS обходит koyeb/cloudflare-воркер. |
| **Android (Kotlin)** | OkHttp — заголовки ставятся напрямую (вне браузера forbidden-headers ограничения нет). Stateless: 2 запроса (GET+POST) без cookie. |
| **Сервер (позже)** | curl_cffi `impersonate='chrome'` (JA3 на случай возврата TLS-фильтра) / requests — заголовки напрямую. См. `tools/borth-server-resolver.py`, `tools/kodik-resolver.py`. |

**Маркеры свапа уже в коде:** `[LAMPA-POINT-1..5]` (`alloha-extract.js` шапка + строки 305/316/374),
`[K-LAMPA-1..3]` (`kodik-extract.js` шапка + 146). Они точно указывают, где DNR/fetch → Lampa-прокси.

---

## 4. Алгоритмы резолва по балансёрам (для порта на Kotlin)

### 4.1 Alloha (CDN vkvideo · srcIp · antiBot=borth · resolveOn=device)
1. `GET https://api.apbugall.org/?token=<TOK_ALLOHA_CRACKED>&kp=<kp>` → JSON: `data.iframe` /
   `data.translation_iframe[tid]={name,iframe}` (фильм), `data.seasons[s].episodes[e].translation[tid].iframe` (сериал).
2. На клик озвучки: `GET <iframe>` (creds=include, нужен непустой Referer = playerOrigin) → HTML →
   `viewporti` из `<meta name="viewporti">` + `media.id` из fileList.
3. `borth = RS + "|" + G7(G8(G9(viewporti)))`.
   - **RS — любая непустая строка** (сервер проверяет лишь непустоту; `borth-server-side.md` §8). На Kotlin: `Random.nextBytes(32).toHex()`. Canvas/SHA-256 НЕ нужны.
   - G7/G8/G9 — три перестановки (`alloha-extract.js` 93–133): G9=группировка по bit-length (убыв.), G8=по trailing-zeros (возр.), G7=prime-step scatter.
4. `POST <domain>/bnsi/movies/<id>` headers `{Borth, X-Requested-With:XMLHttpRequest, Content-Type:form}` body `token=<TOK>&av1=<bool>&autoplay=0&audio=&subtitle=` → JSON `hlsSource[].quality{k:url}` + `tracks[]` (субтитры VTT).
   - `av1=true` → до 2160p; `av1=false` → ≤1080p.
- Токен: `TOK_ALLOHA_CRACKED = "d317441359e505c343c2063edc97e7"` (или decodeSecret с пользовательским паролем).

### 4.2 Kodik (CDN solodcdn · ОТКРЫТ · antiBot=ftor · resolveOn=any)
1. `GET https://kodik-api.com/search?{kinopoisk_id|shikimori_id|title}=…&token=<TOK_KODIK>&with_seasons=true&with_episodes=true&limit=100`
   → `results[]`: `link=//kodikplayer.com/{video|serial}/<id>/<hash>` (фильм/сериал, `seasons[s].episodes[e]`=seria-link).
2. На каждую seria/voice: `GET https:<link>` (Referer=`https://kodikplayer.com/`) → HTML →
   `d/d_sign/pd/pd_sign/ref/ref_sign` (JS-переменные / `urlParams` JSON) + `vInfo.{type,hash,id}` (`kodik-extract.js` 99–143).
3. `POST https://kodikplayer.com/ftor` (Referer+Origin=kodikplayer.com) body `d,d_sign,pd,pd_sign,ref,ref_sign,bad_user=false,cdn_is_working=false,type,hash,id`
   → JSON `links{"360":[{src}],…}`.
4. Декод `src`: **ROT18** (сдвиг +18 в A-Z/a-z, откат −26) **+ atob** (`kodik-extract.js` 75–95) → прямой `cloud.solodcdn.com/...:hls:manifest.m3u8`.
- Токен: `TOK_KODIK` → `decodeSecret(TOK_KODIK, "find your own token")` = `41dd95f84c21719b09d6c71182237a25`.
- Каталог — аниме/сериалы; фильмы по KP часто пусты → искать по `title=`/`shikimori_id`.

### 4.3 Collaps / femd (CDN interkh · открыт · antiBot=none · resolveOn=any)
1. `GET https://api.kinogram.best/embed/kp/<kp>` (Collaps; резерв `api.synchroncode.com`) /
   `https://api.femd.ws/embed/kp/<kp>` (femd; пул мёртвых доменов → `actualizeUrl`/FEMD_POOL).
2. Parse VenomPlayer-HTML (`parseMakePlayer` 313–397):
   - фильм: `hls:"…m3u8"`, `dash:"…mpd"`, `names:[…]` (озвучки), `cc:[{url,name}]` (субтитры);
   - сериал: `seasons:[{season, episodes:[{episode, hls, dash, audio:{names,order}, cc}]}]` — мультиаудио в одном HLS.

### 4.4 HDrezka (CDN voidboost · открыт · antiBot=none · resolveOn=any)
1. apbugall(meta: name/year) → `GET hdrezka.me/engine/ajax/search.php` → страница фильма.
2. Инлайн `"streams":"…"` ИЛИ AJAX `get_movie` (фильм) / `get_episodes`+`get_stream` (сериал) per `translator_id`.
3. `clearTrash(data)` (удаляет мусор `//_//<enc(trash)>` через **split/join**, не replace) → Playerjs-строка `[label]url or url2,…` → `rezkaParseItems` (дедуп фейк-4K по MD5-хэшу) (`balancer-search.js` 107–147).
4. Субтитры: `subtitle`/`subtitle_lns` (маппинг лейбл→lang) → Playerjs-формат.
- Премиум-гейт: 1080 Ultra/4K = серверный платный тизер (тупик, не обходим).

### 4.5 CDNVideoHub (CDN okcdn/OK.ru · srcIp · antiBot=none · resolveOn=device)
1. `GET https://plapi.cdnvideohub.com/api/v1/player/sv/playlist?pub=12&aggr=kp&id=<kp>`
   → `{titleName, isSerial, items:[{cvhId, vkId, voiceType?, voiceStudio?, season?, episode?}]}`.
2. Пропустить hex-32 `vkId` (мёртвые, HTTP 400 на `/video/<hex>`); плейсхолдеры имени («Неизвестный»/«Unknown») → «Озвучка N».
3. На числовой `vkId`: `GET .../api/v1/player/sv/video/<vkId>` → `sources{mpeg…Url}` → `qualities` (QMAP) + DASH/HLS.
   - DASH-URL без расширения `.mpd` → плеер определяет тип по `content-type: application/dash+xml`.
- Их плеер = VK/OK-плеер + селектор озвучек (`player.cdnvideohub.com/s2/<ver>/frame/?pub=12&aggr=kp&id=<kp>`, открывается только в iframe-хосте).

### 4.6 Субтитры (общий контракт, уже в коде)
- Извлечение (`balancer-search.js` 36–103): Alloha `tracks[]`, Collaps/femd `cc[]`, HDrezka `subtitle_lns` → `{lang,label,url,format}`. Kodik/CDNVideoHub — субтитров нет.
- Отображение (`player.js`): `fetch` → Blob (обход CORS/Referer) → SRT→VTT (`srtToVtt`, таймкоды `,`→`.` + `WEBVTT`) → `<track>`.

### 4.7 Секреты (общие)
- `salt(str)` → 10-симв. детерминированный хеш (`(h<<5)-h+charCode`).
- `decodeSecret(bytes, password)` → XOR `bytes` с `salt("123456789"+password)` (повторённым). Без пароля — мастер-keystream `LKevb:GurX` (вскрыт криптоанализом).
- Идентичны `online_mod.js` 18–59 в Lampa-плагине → один порт.

---

## 5. Capabilities → где резолвить (srcIp-матрица)

| Балансёр | CDN | srcIp | castable | resolveOn | антибот |
|---|---|---|---|---|---|
| **Kodik** | solodcdn | нет | **да** | any | ftor (ROT18) |
| **Collaps/femd** | interkh | нет | да (HLS) | any | нет |
| **HDrezka** | voidboost | нет | да | any | нет |
| **Alloha** | vkvideo | **да** | нет | **device** | borth |
| **CDNVideoHub** | okcdn | **да** | нет | **device** | нет |

`castable=false` (srcIp) → кнопки «Скачать»/«Chromecast» дизейблятся, резолв обязателен на устройстве.
`castable=true` → можно резолвить на сервере и играть/качать/кастить где угодно.

---

## 6. Маппинг на потребителей

| Спек | Chrome-расширение | Lampa-плагин | Android (Kotlin) |
|---|---|---|---|
| Source/Voice/Quality | карточки `bs-card` + плеер | `Lampa.Player.play({url, quality, subtitles, title})` | data-классы → ExoPlayer |
| transport | DNR + fetch | `Lampa.Reguest.native(proxyLink enc2t)` | OkHttpTransport |
| секреты/антибот | balancer-core/secrets+antibot (JS) | тот же JS-модуль | core/Secrets+antibot (Kotlin порт) |
| субтитры | Blob+track (player.js) | `subtitles:[{label,url}]` в Player | ExoPlayer SubtitleConfiguration |
| srcIp | — (браузер = IP юзера) | — (WebView Lampa = IP юзера) | резолв на устройстве (OkHttp = IP телефона) |

---

## 7. Верификация спека

- Для каждого балансёра приложить **живой пример `Source` JSON** как фикстуру (Фаза 2): Kodik по `title=Наруто`, Alloha по KP 301, Collaps по KP 522. Фикстуры — основа офлайн-тестов и сверки Kotlin↔JS (один вход → один выход).
- JS-ядро после рефактора: выход `resolveAll` побайтово-эквивалентен текущему (harness KP 301).
- Kotlin: unit-тесты `borth`/`ROT18`/`decodeSecret` против JS-фикстур.

*Связано: [borth-reverse.md](borth-reverse.md), [kodik-reverse.md](kodik-reverse.md),
[interkh-cdn.md](interkh-cdn.md), [borth-server-side.md](borth-server-side.md),
[subtitles-reverse.md](subtitles-reverse.md), [../tools/anatomy-extension/HOW-IT-WORKS.md](../tools/anatomy-extension/HOW-IT-WORKS.md).*

# lampa-online-core — плагин Lampa на едином движке балансёров

Плагин для медиацентра **Lampa**, построенный на переносимом движке `balancer-core`
(тот же, что в Chrome-расширении `lampa-balancers-explore`). Достаёт видео-потоки с
пиратских балансёров по Kinopoisk ID / названию и отдаёт их в `Lampa.Player`.

> Учебный reverse-инжиниринг архитектуры балансёров. Контракт API — `UNIFIED-API-SPEC.md`.

## Балансёры
Alloha (borth → vkvideo), Kodik (аниме → solodcdn, открытый), Collaps/femd (interkh),
HDrezka (voidboost), CDNVideoHub (okcdn). См. `UNIFIED-API-SPEC.md` §5 (capabilities/srcIp).

## Структура
```
src/
  balancer-core/        # движок (адаптеры/секреты/антибот/транспорт) — общий с расширением
  lampa-transport.js    # транспорт под Lampa (Lampa.Reguest + proxyLink enc2t)
  lampa-plugin.js       # регистрация в Lampa + маппинг Source → Lampa.Player.play
build.js                # сборка src/* → dist/online_core.js (один файл для Lampa)
dist/online_core.js     # готовый плагин (вставляется в Lampa: Настройки → Расширения)
```

## Как устроен Lampa-плагин (вкратце)
Один JS-файл регистрируется через `Lampa.Component.add` + кнопка на карточке фильма
(`Lampa.Listener.follow('full')`). Сеть — `Lampa.Reguest().native(proxyLink(...))` (обход CORS
через прокси-воркер). Воспроизведение — `Lampa.Player.play({url, quality, subtitles, title})`.
Образец-референс — `online_mod.js` (форк nb557).

## Сборка
```
node build.js   # → dist/online_core.js
```

## Установка в Lampa

Плагин — это один JS-файл, который грузится в Lampa по URL. Удобнее всего через CDN
**jsDelivr** (отдаёт файл с GitHub с правильными заголовками):

```
https://cdn.jsdelivr.net/gh/iwalker2005/lampa-online-core@master/dist/online_core.js
```

**Шаги:**
1. Открой Lampa → **Настройки** → **Расширения** (Plugins).
2. **Добавить плагин** → вставь ссылку выше → подтверди.
3. Перезапусти Lampa (или обнови). На карточке фильма появится кнопка **«Смотреть онлайн»**.
4. Открой фильм → выбери балансёр → озвучку/качество → играет в `Lampa.Player`.

> jsDelivr кеширует ~12 ч. После пуша новой сборки бери свежую версию так:
> `…@<хеш-коммита>/dist/online_core.js` (или подожди, пока обновится `@master`).

Альтернативы URL: `https://raw.githubusercontent.com/iwalker2005/lampa-online-core/master/dist/online_core.js`
(иногда Lampa не любит raw из-за content-type) или свой хостинг/GitHub Pages.

**Что работает (по `UNIFIED-API-SPEC.md` §5):** Kodik (аниме, открытый CDN — кастится/качается),
Collaps/femd, HDrezka, Alloha (borth, srcIp — играет на устройстве), CDNVideoHub. Озвучки:
отдельные потоки (Kodik/HDrezka/CDNVideoHub) ИЛИ аудиодорожки в одном потоке (Alloha/Collaps/femd,
переключаются в плеере) — см. §1.1 `audioMode`.

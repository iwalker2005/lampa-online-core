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
Lampa → Настройки → Расширения → добавить по URL `dist/online_core.js` (или raw-ссылку GitHub).

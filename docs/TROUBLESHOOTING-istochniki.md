# 🔍 Плагин Lampa не виден в «Источник» / не играет — диагностика и решения

> **Аудитория:** технически грамотный пользователь / разработчик плагина.  
> **Основа:** реальный разбор плагина `online_core` (репозиторий [iwalker2005/lampa-online-core](https://github.com/iwalker2005/lampa-online-core)).  
> **Методология:** идти строго по уровням сверху вниз — каждый уровень устраняется до перехода к следующему.

---

## Содержание

1. [Как устроен «Источник»](#как-устроен-источник)
2. [Уровень 0 — Плагина вообще нет в списке расширений](#уровень-0--плагина-вообще-нет-в-списке-расширений)
3. [Уровень 1 — Загружается, но кнопки нет в «Источник»](#уровень-1--загружается-но-кнопки-нет-в-источник)
4. [Уровень 2 — Кнопка есть, но клик даёт краш](#уровень-2--кнопка-есть-но-клик-даёт-краш)
5. [Уровень 3 — Экран открывается, но «Пусто»](#уровень-3--экран-открывается-но-пусто)
6. [Уровень 4 — Получение kinopoisk\_id (главный блокер для TMDB-карточек)](#уровень-4--получение-kinopoisk_id-главный-блокер-для-tmdb-карточек)
7. [Уровень 5 — KP есть, но балансер не отдаёт поток / проблемы с прокси](#уровень-5--kp-есть-но-балансер-не-отдаёт-поток--проблемы-с-прокси)
8. [Приложение — Полезные команды диагностики](#приложение--полезные-команды-диагностики)
9. [Чек-лист TL;DR](#чек-лист-tldr)

---

## Как устроен «Источник»

«**Источник**» — выпадающий список онлайн-плагинов на карточке фильма/сериала в Lampa. Он строится **динамически** из DOM-кнопок:

```
.buttons--container
  └── .full-start__button   ← каждый онлайн-плагин добавляет одну такую кнопку
        ├── <span>НАЗВАНИЕ</span>       ← заголовок пункта в «Источник»
        └── data-subtitle="..."         ← подзаголовок пункта в «Источник»
```

Если плагина нет в «Источник» — значит, его кнопка либо не была создана вообще, либо вставлена не в тот контейнер, либо плагин не загрузился. Ниже — систематический разбор всех причин.

---

## Уровень 0 — Плагина вообще нет в списке расширений

### Дерево диагностики

```
Плагин не появляется в настройках Lampa → Расширения?
│
├─► Ссылка ведёт на HTML-страницу GitHub, а не на .js
│     └─► ФИКС: заменить на raw/CDN-ссылку
│
├─► raw.githubusercontent.com недоступен (РФ)
│     └─► ФИКС: использовать jsDelivr CDN
│
├─► Дубли или мусорные ссылки в списке расширений
│     └─► ФИКС: почистить список
│
└─► Синтаксическая ошибка в .js-файле плагина
      └─► ФИКС: проверить node --check
```

### ❌ Симптом: добавлена ссылка на страницу GitHub

| Признак | Что происходит |
|---------|---------------|
| URL вида `https://github.com/USER/REPO/blob/master/file.js` | Lampa скачивает HTML-страницу вместо JS-кода — плагин не загружается |

**Правило:** Lampa ожидает **прямую (raw) ссылку**, оканчивающуюся на `.js`. Никакого `/blob/`, никаких страниц репозитория.

**Верная ссылка:**
```
https://raw.githubusercontent.com/USER/REPO/BRANCH/path/file.js
```

### ⚠️ Симптом: `raw.githubusercontent.com` нестабилен / режется в РФ

При старте Lampa появляется предупреждение:
> «Часть плагинов не удалось загрузить»

Причина: `raw.githubusercontent.com` периодически блокируется или работает нестабильно в России, что приводит к таймауту при загрузке пачки плагинов.

**Решение — CDN jsDelivr (работает в РФ):**
```
https://cdn.jsdelivr.net/gh/USER/REPO@BRANCH/path/file.js
```

**Примеры:**
```bash
# Последняя версия ветки master
https://cdn.jsdelivr.net/gh/iwalker2005/lampa-online-core@master/dist/online.js

# Привязка к конкретному коммиту (для немедленной проверки свежей версии)
https://cdn.jsdelivr.net/gh/iwalker2005/lampa-online-core@a1b2c3d/dist/online.js
```

**Сброс кэша jsDelivr** (после обновления файла в репозитории):
```bash
# Инвалидация кэша — выполнить в браузере или curl
https://purge.jsdelivr.net/gh/USER/REPO@BRANCH/path/file.js
```

> ⚡ **Совет:** jsDelivr кэширует файлы. После `git push` новая версия появится на CDN через ~1–5 минут. Для мгновенной проверки — использовать ссылку с `@<short-sha>` вместо `@master`.

### 🗑️ Симптом: мусор в списке расширений

Почистить список от следующих записей:

| Тип мусора | Пример | Что происходит |
|-----------|--------|----------------|
| Blob-ссылки | `github.com/.../blob/...` | Загружается HTML |
| Ссылки на репозиторий без файла | `github.com/USER/REPO` | HTTP 200, но JS не грузится |
| Локальные адреса | `http://127.0.0.1:3000/...`, `http://localhost:8080/...` | Дев-сервер не запущен → таймаут |
| Дубли одного плагина | один `.js` по ветке master + тот же по sha | Загружается дважды, конфликт `Component.add` |

### 🔧 Команды проверки

```bash
# Проверить HTTP-статус ссылки (ожидаем 200)
curl -s -o /dev/null -w "%{http_code}\n" "https://cdn.jsdelivr.net/gh/USER/REPO@master/file.js"

# Проверить синтаксис JS-файла
node --check file.js

# Проверить CORS-заголовки (нужен Access-Control-Allow-Origin: *)
curl -s -D - -o /dev/null "https://api.example.com/endpoint" | grep -i access-control
```

---

## Уровень 1 — Загружается, но кнопки нет в «Источник»

### Как Lampa строит «Источник» (внутренняя механика)

Каждый онлайн-плагин должен самостоятельно вставить кнопку в контейнер при открытии карточки. Правильный паттерн (из `online_mod` / `ReYohoho`):

```js
// 1. Зарегистрировать компонент-экран
Lampa.Component.add(PLUGIN_NAME, MyComponent);

// 2. Заполнить манифест (описание плагина)
Lampa.Manifest.plugins = {
    type: 'video',
    name: 'Мой плагин',
    description: 'Описание',
    component: PLUGIN_NAME,
    onContextMenu: 'full',   // показывать в контекстном меню карточки
    onContextLauch: true     // можно запустить из контекста
};

// 3. Слушать событие открытия карточки и вставлять кнопку
Lampa.Listener.follow('full', function(e) {
    if (e.type === 'complite') {
        // e.object — данные карточки, e.element — DOM карточки
        insertButton(e.object, e.element);
    }
});
```

### ❌ Частая ошибка: неверный контейнер для кнопки

| Неверно | Почему не работает |
|---------|-------------------|
| `.full-start-new__buttons` | Этого класса может не быть в данной сборке Lampa |
| `.full-start__buttons` | Аналогично — зависит от версии темы/сборки |
| Любой контейнер вне `.buttons--container` | Кнопка есть в DOM, но «Источник» её не видит |

**Верно:**
```js
function insertButton(object, element) {
    var container = element.find('.buttons--container');
    if (!container.length) return; // нет контейнера — выходим

    // Защита от дублирования при повторном вызове
    if (container.find('.view--my-plugin').length) return;

    var button = $('<div class="full-start__button view--my-plugin">'
        + '<div class="full-start__ico">...</div>'
        + '<span>МОЙ ПЛАГИН</span>'
        + '</div>');

    button.attr('data-subtitle', 'Онлайн · Бесплатно');

    button.on('click', function() {
        Lampa.Activity.push({
            url: '',
            title: object.movie.title || object.movie.name,
            component: PLUGIN_NAME,
            movie: object.movie,
            page: 1
        });
    });

    container.append(button);
}
```

### ⚠️ Edge-case: плагин загрузился ПОСЛЕ открытия карточки

Если пользователь открыл карточку, а плагин ещё не закончил загружаться (или был добавлен позже), событие `full → complite` уже прошло — кнопка не появится до перезахода на карточку.

**Фикс:**

```js
// При инициализации плагина — проверить, открыта ли карточка прямо сейчас
var active = Lampa.Activity.active();
if (active && active.component === 'full') {
    // Карточка уже открыта — вставить кнопку немедленно
    insertButton(active.object, active.activity.render());
}

// И стандартный листенер для будущих открытий
Lampa.Listener.follow('full', function(e) {
    if (e.type === 'complite') insertButton(e.object, e.element);
});
```

---

## Уровень 2 — Кнопка есть, но клик даёт краш

### Симптом

```
TypeError: this.component.create is not a function
```

Или любая другая ошибка при нажатии на кнопку в «Источник».

### Причина

`Lampa.Activity.push({ component: PLUGIN_NAME })` делает примерно следующее:

```js
var inst = new component();   // создаёт экземпляр
inst.create();                // инициализирует экран
inst.start();                 // передаёт управление
// ...в процессе работы...
inst.render();                // получает DOM-элемент
inst.append(item);            // добавляет элементы
inst.filter(items, choice);   // обновляет фильтр
inst.pause();                 // при уходе с экрана
inst.stop();                  // при переходе в другое Activity
inst.destroy();               // при уничтожении Activity
```

Если хотя бы один из методов не реализован — краш при соответствующем вызове.

### Минимально необходимый набор методов компонента

| Метод | Когда вызывается | Что должен делать |
|-------|-----------------|-------------------|
| `create()` | Сразу после `new` | Инициализация, первый поиск, возврат `this.render()` |
| `start()` | После `create()` | Зарегистрировать контроллер навигации |
| `render()` | После `create()`, при обновлении | Вернуть корневой DOM-элемент |
| `append(item)` | При добавлении контента | Добавить элемент в scroll |
| `empty()` | Когда результатов нет | Показать «Пусто» или сообщение |
| `loading(bool)` | Начало/конец загрузки | Показать/скрыть индикатор |
| `filter(items, choice)` | Смена фильтра | Обновить список с новыми параметрами |
| `reset()` | Сброс состояния | Очистить список, сбросить страницу |
| `pause()` | Уход с экрана | Приостановить воспроизведение/таймеры |
| `stop()` | Переключение Activity | Остановить фоновые операции |
| `destroy()` | Уничтожение Activity | Освободить ресурсы, снять листенеры |

### Каркас компонента (Scroll + Explorer + Filter)

```js
function MyComponent(object) {
    var scroll = new Lampa.Scroll({ mask: true, over: true });
    var files  = new Lampa.Explorer(object);
    var filter = new Lampa.Filter(object);
    var currentPage = 1;
    var self = this;

    this.create = function() {
        this.activity.loader(true);

        // Подключить фильтр
        filter.onSelect = function(type, choice) {
            self.filter([], choice); // тип + выбранный вариант
        };

        // Собрать layout
        files.appendHead(filter.render());
        files.appendFiles(scroll.render());

        this.search();
        return this.render();
    };

    this.render = function() {
        return files.render();
    };

    this.append = function(item) {
        scroll.append(item);
    };

    this.empty = function() {
        // ВАЖНО: здесь выводить диагностику (см. Уровень 3)
        var message = Lampa.Lang.translate('empty') || 'Ничего не найдено';
        files.empty(message);
    };

    this.loading = function(status) {
        this.activity.loader(status);
    };

    // ВАЖНО: this.filter — метод жизненного цикла (смена фильтра пользователем)
    // НЕ путать с filter.onSelect (колбэк виджета фильтра)
    this.filter = function(filter_items, choice) {
        currentPage = 1;
        this.search(choice);
    };

    this.reset = function() {
        currentPage = 1;
        scroll.clear();
    };

    this.start = function() {
        Lampa.Controller.add('content', {
            toggle: function() { Lampa.Controller.toggle('content'); },
            up:     function() { Lampa.Controller.collectionUp('content'); },
            down:   function() { Lampa.Controller.collectionDown('content'); },
            right:  function() { /* следующий элемент */ },
            left:   function() { /* предыдущий элемент */ },
            back:   function() { Lampa.Activity.backward(); }
        });
        Lampa.Controller.toggle('content');
    };

    this.pause   = function() {};
    this.stop    = function() {};
    this.destroy = function() { scroll.destroy(); files.destroy(); };

    this.search = function(params) {
        /* Запросы к балансерам */
    };
}
```

> ⚠️ **Внимание:** `filter.onSelect` — это **колбэк**, который навешивается на виджет фильтра (когда пользователь выбирает пункт меню).  
> `this.filter(filter_items, choice)` — это **метод жизненного цикла** компонента, который Lampa вызывает при смене фильтра. Это **разные** вещи, их нельзя путать.

---

## Уровень 3 — Экран открывается, но «Пусто»

### Первый шаг: ВКЛЮЧИ ДИАГНОСТИКУ

Прежде чем копаться в коде балансеров, добавь вывод причины в пустой экран:

```js
this.empty = function() {
    var kp   = object.movie.kinopoisk_id || '—';
    var imdb = object.movie.imdb_id      || '—';
    var name = object.movie.title        || object.movie.name || '—';

    var msg = 'Источники ничего не нашли.\n'
            + 'kp=' + kp + ', imdb=' + imdb + ', «' + name + '»\n'
            + 'balancer1 — ' + (errors.balancer1 || 'ok')  + '\n'
            + 'balancer2 — ' + (errors.balancer2 || 'ok');

    console.log('[MyPlugin] empty:', msg);
    files.empty(msg);
};
```

После этого сразу видно, где именно обрывается цепочка.

### Самая частая причина: нет `kinopoisk_id`

| Ситуация | Значение `movie.id` | Значение `movie.kinopoisk_id` |
|----------|---------------------|-------------------------------|
| Карточка из Кинопоиска (встроенный источник) | KP-id | KP-id ✅ |
| Карточка из TMDB | **TMDB-id** ❌ | `undefined` или отсутствует |

> ❗ **Критично:** `movie.id` у TMDB-карточки — это **TMDB-id**, а не KP-id.  
> Подставлять `movie.id` в поле `kp` при запросе к балансеру — это **молчаливая ошибка**: балансер (alloha/hdrezka/collaps/femd/cdnvideohub) примет запрос, но найдёт чужой контент или вернёт пустой результат.

**В `kp` класть только настоящий `movie.kinopoisk_id`.**

---

## Уровень 4 — Получение kinopoisk\_id (главный блокер для TMDB-карточек)

### Почему Lampa не гарантирует KP

У карточек из TMDB-источника `kinopoisk_id` отсутствует — Lampa его не проставляет. Переключением настроек «надёжно не добыть» — это не решает проблему структурно. **Рабочие плагины резолвят KP самостоятельно.**

### ✅ Рабочий бесплатный способ: Alloha API (`api.apbugall.org`)

| Параметр | Значение |
|---------|---------|
| Хост | `https://api.apbugall.org/` |
| Авторизация | Токен «кряк» — не требует личной регистрации |
| CORS | `Access-Control-Allow-Origin: *` — вызывается **напрямую из браузера** |
| Результат | `data.id_kp` — числовой KP-id |

**Запросы:**

```
# По IMDb-id
GET https://api.apbugall.org/?token=<ALLOHA_TOKEN>&imdb=tt0979432
→ { "data": { "id_kp": 474779, ... } }

# По TMDB-id
GET https://api.apbugall.org/?token=<ALLOHA_TOKEN>&tmdb=<tmdb_id>
→ { "data": { "id_kp": ..., ... } }
```

**Пример использования в плагине:**

```js
function resolveKP(movie, callback) {
    var kp = movie.kinopoisk_id;
    if (kp) return callback(kp);  // уже есть — используем

    var imdb = movie.imdb_id;
    var tmdb = movie.id;

    if (!imdb && !tmdb) return callback(null);

    var url = 'https://api.apbugall.org/?token=' + ALLOHA_TOKEN
            + (imdb ? '&imdb=' + imdb : '&tmdb=' + tmdb);

    $.ajax({ url: url, dataType: 'json', timeout: 5000 })
        .then(function(data) {
            var id = data && data.data && data.data.id_kp;
            callback(id || null);
        })
        .fail(function() { callback(null); });
}
```

### ❌ Почему Kodik не подходит для резолва KP

| Проблема | Детали |
|---------|--------|
| Требует **личный** токен | Регистрация на kodikapi.com |
| Токены в открытых плагинах мертвы | Пароль расшифровки буквально — «find your own token» |
| Kodik-api возвращает `total: 0` | Даже на заведомо существующий контент — API живое, но токены не работают |

**Вывод:** для получения `kinopoisk_id` использовать **Alloha**, не Kodik.

---

## Уровень 5 — KP есть, но балансер не отдаёт поток / проблемы с прокси

### Прокси-воркеры Cloudflare

Многие плагины используют CORS-прокси на базе Cloudflare Workers для обхода блокировок:

```
cors.nb557.workers.dev    ← используется в чётные часы
cors.fx666.workers.dev    ← используется в нечётные часы
```

**Ротация по чётности часа:**
```js
var proxy = (new Date().getHours() % 2 === 0)
    ? 'https://cors.nb557.workers.dev/'
    : 'https://cors.fx666.workers.dev/';
```

### ❌ Что эти воркеры НЕ проксируют

| Хост | Статус через воркер | Решение |
|------|--------------------|---------| 
| `api.apbugall.org` | `Malformed URL` — отвергается | Звать **напрямую** (CORS:* уже есть) |
| `kodikapi.com` | `Malformed URL` — отвергается | Звать напрямую (если есть живой токен) |
| Балансеры без CORS-заголовков | Работает через воркер | Использовать воркер |

> ✅ Хосты с `Access-Control-Allow-Origin: *` (например, `api.apbugall.org`) — вызывать **напрямую**, без прокси.

### Формат enc2t-проксирования

```js
// Стандартный формат для балансеров без CORS
var link = 'https://balancer.example.com/api/...';
var name = 'video.mp4';

var proxied_url = proxy
    + 'enc2/'
    + encodeURIComponent(btoa(proxy_enc + link))
    + '/' + name
    + '?jacred.test';
```

Где `proxy_enc` — строка-префикс, специфичная для конкретного воркера.

---

## Приложение — Полезные команды диагностики

### Командная строка

```bash
# Проверить HTTP-статус URL (ожидаем 200)
curl -s -o /dev/null -w "%{http_code}\n" "https://cdn.jsdelivr.net/gh/USER/REPO@master/file.js"

# Проверить синтаксис JS-файла плагина
node --check file.js

# Проверить CORS-заголовки (нужен Access-Control-Allow-Origin: *)
curl -s -D - -o /dev/null "https://api.apbugall.org/" | grep -i access-control

# Проверить сразу несколько URL через цикл
for url in \
    "https://cdn.jsdelivr.net/gh/USER/REPO@master/plugin.js" \
    "https://api.apbugall.org/?token=TEST&imdb=tt0000001"; do
    echo -n "$url → "
    curl -s -o /dev/null -w "%{http_code}\n" "$url"
done
```

### jsDelivr: управление кэшем

```bash
# Инвалидация кэша после git push (заменить на свой URL)
curl "https://purge.jsdelivr.net/gh/iwalker2005/lampa-online-core@master/dist/online.js"

# Проверить конкретную версию по sha (кэш не влияет)
https://cdn.jsdelivr.net/gh/USER/REPO@a1b2c3d4/dist/online.js
```

### Где смотреть ошибки в Lampa

| Место | Как добраться | Что показывает |
|-------|--------------|----------------|
| Зелёная плашка внизу экрана | Автоматически | Ошибки загрузки плагинов |
| DevTools → Console | F12 в браузере (lampa.mx) | JS-ошибки, `console.log` из плагина |
| DevTools → Network | F12 → вкладка Network | Упавшие запросы, HTTP-коды |

---

## Чек-лист TL;DR

Пройти по порядку — каждый пункт проверить до следующего:

1. ✅ **Ссылка на плагин** — raw-ссылка или jsDelivr (`cdn.jsdelivr.net/gh/...`), оканчивается на `.js`
2. ✅ **Доступность** — `curl -w "%{http_code}"` отвечает `200`; `node --check file.js` без ошибок
3. ✅ **Список расширений** — нет blob-ссылок, нет localhost, нет дублей одного плагина
4. ✅ **Кнопка вставляется в `.buttons--container`** — не в `.full-start__buttons` или другие контейнеры
5. ✅ **Защита от дублей** — `if(container.find('.view--my-plugin').length) return`
6. ✅ **Обработка уже открытой карточки** — проверить `Lampa.Activity.active()` при инициализации
7. ✅ **Все методы lifecycle реализованы** — `create, start, render, append, empty, loading, filter, reset, pause, stop, destroy`
8. ✅ **Диагностика пустого результата** — выводить kp/imdb/title и ошибки по каждому источнику
9. ✅ **Не путать `movie.id` (TMDB) с `movie.kinopoisk_id`** — в балансеры передавать только настоящий KP-id
10. ✅ **Резолв KP** — через Alloha API (`api.apbugall.org`) по imdb или tmdb → `data.id_kp`
11. ✅ **Прямые вызовы для CORS-хостов** — `api.apbugall.org` и аналоги с `Access-Control-Allow-Origin: *` вызывать напрямую, без прокси-воркера

---

*Документ основан на реальном разборе плагина `online_core` (iwalker2005/lampa-online-core). Версия: 2026-06-17.*

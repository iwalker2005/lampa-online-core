/**
 * lampa-plugin.js — регистрация плагина online_core в Lampa.
 *
 * Паттерны взяты из nb557/online_mod.js:
 *   - component — функция-конструктор (object); this = Lampa-компонент (Scroll + Explorer + Filter)
 *   - Lampa.Component.add(name, component) + Lampa.Activity.push(...)
 *   - Lampa.Manifest.plugins + Lampa.Listener.follow('full') + кнопка на карточке
 *   - this.filter(filter_items, choice) / this.append(item) / this.reset() / this.loading(bool)
 *   - this.renameQualityMap / this.getDefaultQuality (встроены в component Lampa)
 *   - Lampa.Player.play({ url, quality, subtitles, timeline, title })
 *   - Lampa.Player.playlist([...])
 *
 * Наш движок: BalancerCore.resolveAll(query, BalancerCore.lampaTransport) → ResolveResult
 *   sources[] → Source { balancer, ok, voices?, seasons?, castable, resolveOn }
 *   Voice     { name, id, qualities:{label:url}, audioTracks?, subtitles? }
 *   Season    { num, episodes:[{ num, title, voices?, resolveLazy? }] }
 */

(function () {
    'use strict';

    var PLUGIN_VERSION = '1.0.0';
    var PLUGIN_NAME    = 'online_core';

    // ─── Шаблоны ──────────────────────────────────────────────────────────────

    /**
     * Регистрируем HTML-шаблоны элементов списка.
     * Структура повторяет online_mod.js: online__body / online__title / online__quality.
     */
    function registerTemplates() {
        // Строка озвучки / серии (иконка «воспроизвести»)
        Lampa.Template.add('online_core_item',
            '<div class="online selector">' +
                '<div class="online__body">' +
                    '<div style="position:absolute;left:0;top:-0.3em;width:2.4em;height:2.4em">' +
                        '<svg style="height:2.4em;width:2.4em" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">' +
                            '<circle cx="64" cy="64" r="56" stroke="white" stroke-width="16"/>' +
                            '<path d="M90.5 64.3827L50 87.7654L50 41L90.5 64.3827Z" fill="white"/>' +
                        '</svg>' +
                    '</div>' +
                    '<div class="online__title" style="padding-left:2.1em">{title}</div>' +
                    '<div class="online__quality" style="padding-left:3.4em">{quality}{info}</div>' +
                '</div>' +
            '</div>'
        );

        // Строка балансёра / сезона (иконка «папка»)
        Lampa.Template.add('online_core_folder',
            '<div class="online selector">' +
                '<div class="online__body">' +
                    '<div style="position:absolute;left:0;top:-0.3em;width:2.4em;height:2.4em">' +
                        '<svg style="height:2.4em;width:2.4em" viewBox="0 0 128 112" fill="none" xmlns="http://www.w3.org/2000/svg">' +
                            '<rect y="20" width="128" height="92" rx="13" fill="white"/>' +
                            '<path d="M29.9963 8H98.0037C96.0446 3.3021 91.4079 0 86 0H42C36.5921 0 31.9555 3.3021 29.9963 8Z" fill="white" fill-opacity="0.23"/>' +
                            '<rect x="11" y="8" width="106" height="76" rx="13" fill="white" fill-opacity="0.51"/>' +
                        '</svg>' +
                    '</div>' +
                    '<div class="online__title" style="padding-left:2.1em">{title}</div>' +
                    '<div class="online__quality" style="padding-left:3.4em">{quality}{info}</div>' +
                '</div>' +
            '</div>'
        );
    }

    // ─── Утилиты ──────────────────────────────────────────────────────────────

    /**
     * Добавить невидимый пробел (​U+200B) к ключам качества —
     * паттерн из online_mod.js (renameQualityMap), чтобы Lampa не сортировала ключи.
     *
     * @param {Object.<string,string>} qualityMap
     * @returns {Object.<string,string>}
     */
    function renameQualityMap(qualityMap) {
        if (!qualityMap) return qualityMap;
        var out = {};
        for (var k in qualityMap) {
            out['​' + k] = qualityMap[k];
        }
        return out;
    }

    /**
     * Получить URL предпочтительного качества из словаря.
     * Логика из online_mod.js getDefaultQuality: приоритет по убыванию разрешения,
     * при совпадении — использовать defValue если передан.
     *
     * @param {Object.<string,string>} qualityMap
     * @param {string} [defValue]
     * @returns {string}
     */
    function getDefaultQuality(qualityMap, defValue) {
        if (!qualityMap) return defValue || '';
        var preferred = ['2160p', '2160', '4K', '1440p', '1440', '1080p Ultra', '1080p', '1080', '720p', '720', '480p', '480', '360p', '360'];
        for (var i = 0; i < preferred.length; i++) {
            if (qualityMap[preferred[i]]) return qualityMap[preferred[i]];
        }
        // Первый доступный
        var keys = Object.keys(qualityMap);
        return keys.length ? qualityMap[keys[0]] : (defValue || '');
    }

    /**
     * Привести subtitles из нашей схемы (SubtitleTrack[]) к формату Lampa.Player:
     * [{ label, url }] или false если субтитров нет.
     *
     * @param {Array|undefined} subs
     * @returns {Array|false}
     */
    function mapSubtitles(subs) {
        if (!subs || !subs.length) return false;
        var out = subs.map(function (s) {
            return { label: s.label || s.lang || 'Sub', url: s.url };
        });
        return out.length ? out : false;
    }

    /**
     * Строка с названиями аудиодорожек для дополнительного info.
     *
     * @param {Array|undefined} audioTracks
     * @returns {string}
     */
    function audioInfo(audioTracks) {
        if (!audioTracks || !audioTracks.length) return '';
        return audioTracks.map(function (t) { return t.name || t.lang || ''; }).filter(Boolean).join(', ');
    }

    // ─── Компонент Lampa ──────────────────────────────────────────────────────

    /**
     * Функция-конструктор компонента — паттерн online_mod.js.
     * Lampa создаёт экземпляр через «new component(object)» при Lampa.Activity.push.
     * this = объект-компонент Lampa (Scroll + Explorer + Filter + методы).
     *
     * @param {Object} object — { movie, search, search_one, search_two, … }
     */
    function component(object) {
        var _this = this;

        // Данные текущего сеанса поиска
        var _destroyed = false;
        var _result    = null;  // ResolveResult
        var _okSources = [];    // Source[] c ok=true

        // Состояние фильтра (аналог choice в online_mod.js)
        var choice = {
            source: 0,
            voice:  0,
            season: 0
        };

        // Словарь для component.filter (аналог filter_items)
        var filter_items = {};

        // ── Поиск ─────────────────────────────────────────────────────────────

        /**
         * Запустить поиск через наш движок.
         * Вызывается Lampa из this.find() → sources[balanser].search(object, kp_id).
         * В нашем случае один «мета-балансёр», поэтому search — главная точка входа.
         */
        this.search = function () {
            var movie  = object.movie || {};
            var query  = {
                kp:    String(movie.kinopoisk_id || movie.id || ''),
                title: movie.title || movie.original_title || object.search || '',
                imdb:  movie.imdb_id || ''
            };

            _this.loading(true);

            BalancerCore.resolveAll(query, BalancerCore.lampaTransport)
                .then(function (result) {
                    if (_destroyed) return;
                    _this.loading(false);
                    _result    = result;
                    _okSources = (result.sources || []).filter(function (s) { return s.ok; });

                    if (!_okSources.length) {
                        _this.empty();
                        return;
                    }

                    _buildSourceLevel();
                })
                .catch(function (e) {
                    if (_destroyed) return;
                    _this.loading(false);
                    _this.empty();
                    Lampa.Noty.show('Online Core: ' + (e && e.message || String(e)));
                });
        };

        // ── Уровень 1: балансёры ──────────────────────────────────────────────

        /**
         * Нарисовать список доступных балансёров (источников).
         * Каждый — строка-папка; по клику открываем уровень озвучек / сезонов.
         */
        function _buildSourceLevel() {
            _this.reset();

            filter_items = {
                source: _okSources.map(function (s) { return s.balancer; })
            };
            choice.source = 0;
            _this.filter(filter_items, choice);

            _okSources.forEach(function (source) {
                var isSerial    = (_result && _result.type) === 'serial';
                var resolveTag  = source.resolveOn === 'device' ? ' [srcIP]' : '';
                var castTag     = source.castable   ? ' ✓cast'  : '';

                var row = Lampa.Template.get('online_core_folder', {
                    title:   source.balancer,
                    quality: isSerial ? 'Сериал' : 'Фильм',
                    info:    resolveTag + castTag
                });

                row.on('hover:enter', function () {
                    choice.source = _okSources.indexOf(source);
                    _openSource(source);
                });

                _this.append(row);
            });

            _this.start(true);
        }

        // ── Уровень 2: открыть источник → озвучки / сезоны ───────────────────

        /**
         * Открыть конкретный источник.
         * Фильм → список озвучек.
         * Сериал → выбор озвучки + сезона через фильтр + список серий.
         *
         * @param {Source} source
         */
        function _openSource(source) {
            _this.reset();
            var isSerial = (_result && _result.type) === 'serial';
            var movie    = object.movie || {};
            var title    = object.search || movie.title || movie.original_title || '';

            if (!isSerial) {
                _buildVoiceLevel(source, movie, title);
            } else {
                _buildSerialFilter(source, movie, title);
            }
        }

        // ── Уровень 2a: фильм → список озвучек ───────────────────────────────

        /**
         * Фильм: показать строки озвучек; по клику — Lampa.Player.play.
         *
         * @param {Source} source
         * @param {Object} movie
         * @param {string} title
         */
        function _buildVoiceLevel(source, movie, title) {
            var voices = source.voices || [];

            if (!voices.length) {
                _this.empty();
                return;
            }

            // Обновляем фильтр (голос) для шапки
            filter_items.voice = voices.map(function (v) { return v.name; });
            choice.voice       = 0;
            _this.filter(filter_items, choice);

            voices.forEach(function (voice) {
                var atStr   = audioInfo(voice.audioTracks);
                var qualStr = Object.keys(voice.qualities || {}).join(' / ') || '—';
                var castMark = source.castable ? ' ✓' : '';

                var item = Lampa.Template.get('online_core_item', {
                    title:   voice.name || 'Озвучка',
                    quality: qualStr + castMark,
                    info:    atStr ? ' · ' + atStr : ''
                });

                item.on('hover:enter', function () {
                    var url = getDefaultQuality(voice.qualities);
                    if (!url) {
                        Lampa.Noty.show('Нет потока для этой озвучки');
                        return;
                    }

                    var playerItem = {
                        url:       url,
                        quality:   renameQualityMap(voice.qualities),
                        subtitles: mapSubtitles(voice.subtitles),
                        title:     title + (voice.name ? ' / ' + voice.name : ''),
                        timeline:  Lampa.Timeline.view(
                            Lampa.Utils.hash(title + String(voice.id || voice.name))
                        )
                    };

                    if (movie && movie.id) Lampa.Favorite.add('history', movie, 100);
                    Lampa.Player.play(playerItem);
                    Lampa.Player.playlist([playerItem]);
                });

                _this.append(item);
            });

            _this.start(true);
        }

        // ── Уровень 2б: сериал → фильтр озвучка/сезон + серии ────────────────

        /**
         * Сериал: построить фильтр (озвучка / сезон) и список серий.
         * Паттерн online_mod.js — filter_items.voice + filter_items.season_num.
         *
         * @param {Source} source
         * @param {Object} movie
         * @param {string} title
         */
        function _buildSerialFilter(source, movie, title) {
            var seasons = source.seasons || [];
            if (!seasons.length) {
                _this.empty();
                return;
            }

            // Собираем имена озвучек из первых доступных серий
            var voiceNames = _collectVoiceNames(seasons);
            if (!voiceNames.length) voiceNames = ['По умолчанию'];

            // Инициализируем фильтр
            filter_items.voice      = voiceNames;
            filter_items.season_num = seasons.map(function (s) { return 'Сезон ' + s.num; });
            choice.voice  = Math.min(choice.voice,  voiceNames.length  - 1);
            choice.season = Math.min(choice.season, seasons.length - 1);
            _this.filter(filter_items, choice);

            // Сохраняем контекст для перерисовки при смене фильтра
            _this._coreCtx = {
                source:     source,
                seasons:    seasons,
                voiceNames: voiceNames,
                movie:      movie,
                title:      title
            };

            _buildEpisodeLevel(seasons[choice.season], choice.voice, voiceNames, movie, title, source);
        }

        /**
         * Собрать уникальные имена озвучек из первых серий (у кого voices уже есть).
         *
         * @param {Season[]} seasons
         * @returns {string[]}
         */
        function _collectVoiceNames(seasons) {
            var names = [];
            seasons.forEach(function (season) {
                (season.episodes || []).forEach(function (ep) {
                    (ep.voices || []).forEach(function (v) {
                        if (names.indexOf(v.name) === -1) names.push(v.name);
                    });
                });
            });
            return names;
        }

        // ── Уровень 3: список серий текущего сезона ───────────────────────────

        /**
         * Отрисовать серии выбранного сезона.
         * Если у серии нет voices (только resolveLazy) — загружаем по клику.
         *
         * @param {Season}   season
         * @param {number}   voiceIdx
         * @param {string[]} voiceNames
         * @param {Object}   movie
         * @param {string}   title
         * @param {Source}   source
         */
        function _buildEpisodeLevel(season, voiceIdx, voiceNames, movie, title, source) {
            _this.reset();

            if (!season || !season.episodes || !season.episodes.length) {
                _this.empty();
                return;
            }

            season.episodes.forEach(function (episode) {
                var epLabel = 'С' + season.num + 'E' + episode.num +
                              (episode.title ? ' — ' + episode.title : '');
                var voiceName = voiceNames[voiceIdx] || '';

                var item = Lampa.Template.get('online_core_item', {
                    title:   epLabel,
                    quality: source.castable ? '✓cast' : '',
                    info:    voiceName ? ' · ' + voiceName : ''
                });

                item.on('hover:enter', function () {
                    if (episode.voices && episode.voices.length) {
                        // Озвучки уже резолвлены — играем сразу
                        _playEpisode(episode.voices, voiceIdx, title, epLabel, season, episode, movie);
                    } else if (typeof episode.resolveLazy === 'function') {
                        // Ленивый резолв (Kodik/Alloha/HDrezka) — тянем по клику
                        _this.loading(true);
                        episode.resolveLazy()
                            .then(function (voices) {
                                _this.loading(false);
                                episode.voices = voices; // кешируем
                                _playEpisode(voices, voiceIdx, title, epLabel, season, episode, movie);
                            })
                            .catch(function (e) {
                                _this.loading(false);
                                Lampa.Noty.show('Ошибка загрузки серии: ' + (e && e.message || String(e)));
                            });
                    } else {
                        Lampa.Noty.show('Нет потока для этой серии');
                    }
                });

                _this.append(item);
            });

            _this.start(true);
        }

        // ── Воспроизведение ───────────────────────────────────────────────────

        /**
         * Запустить плеер для конкретной серии.
         * Маппинг Voice → Lampa.Player.play / playlist по паттерну online_mod.js.
         *
         * @param {Voice[]} voices
         * @param {number}  voiceIdx
         * @param {string}  movieTitle
         * @param {string}  epLabel
         * @param {Season}  season
         * @param {Episode} episode
         * @param {Object}  movie
         */
        function _playEpisode(voices, voiceIdx, movieTitle, epLabel, season, episode, movie) {
            // Если выбранный индекс вышел за границы — берём первый
            var voice = voices[voiceIdx] || voices[0];
            if (!voice) {
                Lampa.Noty.show('Нет потока для этой серии');
                return;
            }

            var url = getDefaultQuality(voice.qualities);
            if (!url) {
                Lampa.Noty.show('Нет URL для этой серии');
                return;
            }

            var playerTitle = movieTitle + ' / ' + epLabel +
                              (voice.name ? ' / ' + voice.name : '');
            var playerItem  = {
                url:       url,
                quality:   renameQualityMap(voice.qualities),
                subtitles: mapSubtitles(voice.subtitles),
                title:     playerTitle,
                timeline:  Lampa.Timeline.view(
                    Lampa.Utils.hash([movieTitle, season.num, episode.num, voice.name || ''].join(':'))
                )
            };

            if (movie && movie.id) Lampa.Favorite.add('history', movie, 100);
            Lampa.Player.play(playerItem);
            Lampa.Player.playlist([playerItem]);
        }

        // ── Обработка фильтра ─────────────────────────────────────────────────

        /**
         * Применить изменение фильтра (озвучка / сезон).
         * Паттерн online_mod.js: this.filter вызывается Lampa при выборе в шапке.
         * Аргументы: (type, filterDef:{stype}, selectedItem:{index}).
         *
         * @param {string} type
         * @param {Object} a  — { stype: 'voice'|'season'|'source', … }
         * @param {Object} b  — { index: number, title: string }
         */
        this.filter = function (type, a, b) {
            if (!a || !b) return;
            var ctx = _this._coreCtx;

            choice[a.stype] = b.index;

            if (!ctx) return; // ещё не открыт сериальный контекст

            _this.reset();
            _buildEpisodeLevel(
                ctx.seasons[choice.season],
                choice.voice,
                ctx.voiceNames,
                ctx.movie,
                ctx.title,
                ctx.source
            );

            _this.saveChoice && _this.saveChoice(choice);
        };

        /**
         * Сброс фильтра к значениям по умолчанию.
         * Паттерн: this.reset вызывается кнопкой «Сбросить» в фильтре Lampa.
         */
        this.reset = function () {
            choice = { source: 0, voice: 0, season: 0 };
            var ctx = _this._coreCtx;
            if (ctx) {
                _this.filter(filter_items, choice);
                _buildEpisodeLevel(
                    ctx.seasons[0],
                    0,
                    ctx.voiceNames,
                    ctx.movie,
                    ctx.title,
                    ctx.source
                );
            }
        };

        /**
         * Освободить ресурсы при уходе с активности.
         */
        this.destroy = function () {
            _destroyed = true;
            _result    = null;
            _okSources = [];
            _this._coreCtx = null;
        };
    }

    // ─── Запуск поиска ────────────────────────────────────────────────────────

    /**
     * Открыть активность онлайн-просмотра.
     * Паттерн online_mod.js: Component.add → Activity.push.
     *
     * @param {Object} movie  — объект карточки Lampa
     */
    function openOnlineCore(movie) {
        // Перерегистрируем компонент перед push (как в online_mod.js)
        Lampa.Component.add(PLUGIN_NAME, component);

        Lampa.Activity.push({
            url:        '',
            title:      'Смотреть · ' + (movie.title || movie.original_title || ''),
            component:  PLUGIN_NAME,
            search:     movie.title || movie.original_title || '',
            search_one: movie.title || '',
            search_two: movie.original_title || '',
            movie:      movie,
            page:       1
        });
    }

    // ─── Инициализация плагина ────────────────────────────────────────────────

    /**
     * Точка входа плагина.
     * Вызывается один раз — либо сразу (если appready), либо по событию 'app'/'ready'.
     */
    function initPlugin() {
        // Заглушка на старте (паттерн online_mod.js, чтобы Lampa не ругалась «пусто»)
        Lampa.Component.add(PLUGIN_NAME, component);

        registerTemplates();

        // ── Manifest — контекстное меню карточки ──────────────────────────────
        var manifest = {
            type:        'video',
            version:     PLUGIN_VERSION,
            name:        'Online Core ' + PLUGIN_VERSION,
            description: 'Смотреть онлайн',
            component:   PLUGIN_NAME,

            onContextMenu: function (object) {
                return { name: 'Смотреть (core)', description: '' };
            },
            onContextLauch: function (object) {
                openOnlineCore(object.movie || object);
            }
        };
        Lampa.Manifest.plugins = manifest;

        // ── Кнопка на карточке — паттерн online_mod.js ────────────────────────
        // SVG-иконка (повторяет иконку online_mod.js для визуальной согласованности).
        var buttonHtml =
            '<div class="full-start__button selector view--online_core" data-subtitle="online_core ' + PLUGIN_VERSION + '">' +
                '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 244 260" style="enable-background:new 0 0 512 512" xml:space="preserve">' +
                    '<g>' +
                        '<path d="M242,88v170H10V88h41l-38,38h37.1l38-38h38.4l-38,38h38.4l38-38h38.3l-38,38H204L242,88L242,88z ' +
                              'M228.9,2l8,37.7l0,0L191.2,10L228.9,2z M160.6,56l-45.8-29.7l38-8.1l45.8,29.7L160.6,56z ' +
                              'M84.5,72.1L38.8,42.4l38-8.1l45.8,29.7L84.5,72.1z M10,88L2,50.2L47.8,80L10,88z" fill="currentColor"/>' +
                    '</g>' +
                '</svg>' +
                '<span>Смотреть (core)</span>' +
            '</div>';

        // Вставка с фолбэками (надёжный паттерн из online_mod.js):
        //   1. После .view--torrent (если торренты есть)
        //   2. В .full-start-new__buttons / .full-start__buttons
        //   3. После первой из .button--play / .view--trailer / .full-start__button
        Lampa.Listener.follow('full', function (e) {
            if (e.type !== 'complite') return;

            var btn = $(buttonHtml);

            btn.on('hover:enter', function () {
                openOnlineCore(e.data.movie);
            });

            var bsRoot   = e.object.activity.render();
            var bsAnchor = bsRoot.find('.view--torrent');

            if (bsAnchor.length) {
                bsAnchor.after(btn);
            } else {
                var bsBox = bsRoot.find('.full-start-new__buttons, .full-start__buttons');
                if (bsBox.length) {
                    bsBox.append(btn);
                } else {
                    bsRoot.find('.button--play, .view--trailer, .full-start__button').first().after(btn);
                }
            }
        });
    }

    // ─── Ждём готовности приложения ───────────────────────────────────────────
    // Паттерн из online_mod.js: if (window.appready) сразу, иначе слушаем событие.

    if (window.appready) {
        initPlugin();
    } else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') initPlugin();
        });
    }

})();

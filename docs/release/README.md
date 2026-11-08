# Пакет публикации ARKTUR: Космический рубеж (alpha 0.82.1)

Статус: **альфа**, одиночная игра (не MMO, без мультиплеера). Всё ниже собрано из ветки `release/yandex-review-20261108`.

| Что | Где |
|---|---|
| Тексты страниц RU/EN: название, описания, управление, функции, ИИ | [listing.md](listing.md) |
| Что загружать на itch.io, CrazyGames, Poki, Steam (черновик), Windows | [platforms.md](platforms.md) |
| Яндекс Игры: сборка, комментарий разработчика, чек-лист черновика | [yandex/README.md](yandex/README.md) |
| Политики конфиденциальности по площадкам | [privacy/](privacy/) |
| Скриншоты, обложки, видео (настоящие кадры игры) | [media/](media/) |
| Постоянные ссылки на файлы (GitHub Release) | [RELEASE.md](RELEASE.md) |

Сборка всех архивов и проверка лимитов: `node tools/build-release.js` → `dist/release/`.
Тесты: `tools/tests/portals.test.js` (iframe, Яндекс-имитация SDK, сайт, файл с диска), `tools/tests/yandex-review.test.js`
(поздний SDK, звук и речь на паузе, политика внутри игры), `tools/tests/desktop.test.js` (Electron: безопасность, офлайн, сохранения).
Материалы: `node tools/media/capture.js …` (съёмка) и `python3 tools/media/compose.py …` (обложки, видео, проверка требований).

Не входит и делается владельцем: регистрация аккаунтов, договоры (в т. ч. Poki — после принятия), налоги и выплаты,
Steam AppID и взнос, цифровая подпись Windows-сборки, размещение черновика на Яндексе и проверка в нём реального SDK.

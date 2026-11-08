# Материалы для площадок — настоящие кадры игры

Всё ниже снято в собранной портальной версии игры (alpha 0.82.1, ветка `release/yandex-review-20261108`) в Chromium:
английская версия — сборка CrazyGames, русская — сборка itch с русским языком браузера. Ничего не нарисовано
и не сгенерировано нейросетью: каждый кадр — это рендер самой игры.

**Как снято (честно):**
- Сцены поставлены через отладочный доступ игры: выбор корабля («Комета», «Молот», «Бегемот»), точка в космосе,
  появление трёх пиратов, навыки и деньги «пилота-ветерана». Дальше полёт, бой и добычу считает сама игра.
- Камера в видео медленно облетает корабль по сценарию; на скриншотах она стоит неподвижно.
- Всплывающие уведомления, обучение и советник скрыты; остальной интерфейс — как у игрока.
- Обложки сделаны из «чистых» кадров (панели интерфейса скрыты) с надписью названия.
- Видео снято с виртуальными часами браузера: между кадрами игра идёт ровно 1/30 с. Так медленный программный рендер
  без видеокарты не делает видео рваным; скорость и физика — настоящие, игра не ускорена.
- Первый кадр видео (0,4 с) — соответствующая обложка. Звука нет, курсора и панелей браузера нет.
- Инструменты: `tools/media/capture.js` (съёмка) и `tools/media/compose.py` (обложки, видео, проверки).

## Файлы
| Файл | Размер кадра, длительность | Вес |
|---|---|---|
| `crazygames/cover-1920x1080.jpg` | 1920×1080 | 0.25 МБ |
| `crazygames/cover-800x1200.jpg` | 800×1200 | 0.13 МБ |
| `crazygames/cover-800x800.jpg` | 800×800 | 0.09 МБ |
| `crazygames/video-landscape-1920x1080.mp4` | 1920×1080, 19.9 с, звук: нет | 15.95 МБ |
| `crazygames/video-portrait-1080x1620.mp4` | 1080×1620, 17.9 с, звук: нет | 9.58 МБ |
| `itch/cover-630x500.jpg` | 630×500 | 0.06 МБ |
| `poki/poki-1-flight.jpg` | 1920×1080 | 0.28 МБ |
| `poki/poki-2-combat.jpg` | 1920×1080 | 0.28 МБ |
| `poki/poki-3-mining.jpg` | 1920×1080 | 0.36 МБ |
| `screenshots/en/arktur-en-01-flight.jpg` | 1920×1080 | 0.31 МБ |
| `screenshots/en/arktur-en-02-combat.jpg` | 1920×1080 | 0.30 МБ |
| `screenshots/en/arktur-en-03-mining.jpg` | 1920×1080 | 0.39 МБ |
| `screenshots/en/arktur-en-04-map.jpg` | 1920×1080 | 0.17 МБ |
| `screenshots/en/arktur-en-05-board.jpg` | 1920×1080 | 0.41 МБ |
| `screenshots/en/arktur-en-06-hangar.jpg` | 1920×1080 | 0.28 МБ |
| `screenshots/ru/arktur-ru-01-flight.jpg` | 1920×1080 | 0.30 МБ |
| `screenshots/ru/arktur-ru-02-combat.jpg` | 1920×1080 | 0.30 МБ |
| `screenshots/ru/arktur-ru-03-mining.jpg` | 1920×1080 | 0.40 МБ |
| `screenshots/ru/arktur-ru-04-map.jpg` | 1920×1080 | 0.18 МБ |
| `screenshots/ru/arktur-ru-05-board.jpg` | 1920×1080 | 0.42 МБ |
| `screenshots/ru/arktur-ru-06-hangar.jpg` | 1920×1080 | 0.38 МБ |
| `steam/capsule-1232x706.jpg` | 1232×706 | 0.13 МБ |
| `steam/capsule-460x215.jpg` | 460×215 | 0.02 МБ |
| `yandex/cover-ru-1920x1080.jpg` | 1920×1080 | 0.26 МБ |
| `yandex/video-ru-1920x1080.mp4` | 1920×1080, 19.9 с, звук: нет | 16.00 МБ |

`clean-frames/` — чистые кадры без интерфейса (для своих обложек, капсул Steam и баннеров).

## Что куда
- **CrazyGames:** `crazygames/cover-1920x1080.jpg`, `cover-800x1200.jpg`, `cover-800x800.jpg`;
  видео `video-landscape-1920x1080.mp4` и `video-portrait-1080x1620.mp4`; скриншоты — `screenshots/en/`.
- **Яндекс Игры:** скриншоты `screenshots/ru/` (16:9, 1920×1080), видео `yandex/video-ru-1920x1080.mp4`,
  обложка `yandex/cover-ru-1920x1080.jpg` (размеры обложки и иконки сверьте с консолью Яндекса).
- **Poki (заявка):** `poki/poki-1-flight.jpg`, `poki-2-combat.jpg`, `poki-3-mining.jpg` + публичная ссылка на игру.
- **itch.io:** обложка `itch/cover-630x500.jpg`, скриншоты `screenshots/en/` (или `ru/`), видео — любое из crazygames/.
- **Steam (черновик):** капсулы `steam/capsule-1232x706.jpg`, `capsule-460x215.jpg` — пример; остальные размеры
  вырежьте из `clean-frames/`. Скриншоты Steam — без надписей: используйте `screenshots/`.

## Проверки требований (из report.json)
- ✓ screenshots/en/arktur-en-01-flight.jpg: 1920×1080
- ✓ screenshots/en/arktur-en-02-combat.jpg: 1920×1080
- ✓ screenshots/en/arktur-en-03-mining.jpg: 1920×1080
- ✓ screenshots/en/arktur-en-04-map.jpg: 1920×1080
- ✓ screenshots/en/arktur-en-05-board.jpg: 1920×1080
- ✓ screenshots/en/arktur-en-06-hangar.jpg: 1920×1080
- ✓ screenshots/ru/arktur-ru-01-flight.jpg: 1920×1080
- ✓ screenshots/ru/arktur-ru-02-combat.jpg: 1920×1080
- ✓ screenshots/ru/arktur-ru-03-mining.jpg: 1920×1080
- ✓ screenshots/ru/arktur-ru-04-map.jpg: 1920×1080
- ✓ screenshots/ru/arktur-ru-05-board.jpg: 1920×1080
- ✓ screenshots/ru/arktur-ru-06-hangar.jpg: 1920×1080
- ✓ не меньше 5 скриншотов 1920×1080 на язык (en 6, ru 6)
- ✓ Яндекс: ≥ 2 скриншота 16:9, длинная сторона 1280–2560 (1920)
- ✓ poki/poki-1-flight.jpg ≤ 5 МиБ (0.28 МиБ)
- ✓ poki/poki-2-combat.jpg ≤ 5 МиБ (0.28 МиБ)
- ✓ poki/poki-3-mining.jpg ≤ 5 МиБ (0.36 МиБ)
- ✓ CrazyGames: обложка 1920x1080
- ✓ CrazyGames: обложка 800x1200
- ✓ CrazyGames: обложка 800x800
- ✓ CrazyGames landscape: 1920×1080, 19.9 с (15–20), без звука, ≤ 50 МБ, первый кадр — обложка
- ✓ CrazyGames portrait: 1080×1620, 17.9 с (15–20), без звука, ≤ 50 МБ, первый кадр — обложка 800×1200
- ✓ Яндекс: видео 16:9, 19.9 с (≤ 28), ≤ 100 МБ

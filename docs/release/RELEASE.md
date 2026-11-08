# Релизы ARKTUR: постоянные ссылки на файлы

Обычная сборка ветки (`.github/workflows/release-builds.yml`) кладёт файлы в **artifacts** запуска — они удаляются через 30 дней
и скачиваются только после входа в GitHub. Для публикации нужен **GitHub Release** — его файлы постоянные и открыты всем.

## Как выпустить релиз
Workflow `.github/workflows/publish-release.yml` (секреты не нужны, работает встроенный `GITHUB_TOKEN`):
- **тегом** (работает сразу, с любой ветки): `git tag v0.82.1-alpha.1 <коммит> && git push origin v0.82.1-alpha.1`;
- **вручную**: Actions → «Publish release» → Run workflow — кнопка появляется, когда файл workflow есть в основной ветке `master`
  (GitHub показывает ручной запуск только для workflow из основной ветки).

Задание `create` создаёт предрелиз (alpha), затем независимо:
- `web` (ubuntu) собирает и прикладывает архивы площадок — они попадут в релиз, даже если Windows-сборка упадёт;
- `windows` (windows-latest) собирает установщик и portable ZIP, запускает `ARKTUR.exe` на 20 с и прикладывает файлы.

## Адреса файлов после выпуска `v0.82.1-alpha.1`
Станут рабочими только после того, как релиз будет выпущен (сейчас его ещё нет):
- https://github.com/dzhikzaur97-arch/arktur/releases/download/v0.82.1-alpha.1/ARKTUR-Setup-0.82.1-x64.exe
- https://github.com/dzhikzaur97-arch/arktur/releases/download/v0.82.1-alpha.1/ARKTUR-0.82.1-win-x64.zip
- https://github.com/dzhikzaur97-arch/arktur/releases/download/v0.82.1-alpha.1/arktur-0.82.1-yandex.zip
- https://github.com/dzhikzaur97-arch/arktur/releases/download/v0.82.1-alpha.1/arktur-0.82.1-itch-html5.zip
- https://github.com/dzhikzaur97-arch/arktur/releases/download/v0.82.1-alpha.1/arktur-0.82.1-itch-download.zip
- https://github.com/dzhikzaur97-arch/arktur/releases/download/v0.82.1-alpha.1/arktur-0.82.1-crazygames.zip
- https://github.com/dzhikzaur97-arch/arktur/releases/download/v0.82.1-alpha.1/arktur-0.82.1-poki.zip
- https://github.com/dzhikzaur97-arch/arktur/releases/download/v0.82.1-alpha.1/SHA256SUMS-web.txt и SHA256SUMS-windows.txt

Windows-сборка не подписана цифровой подписью: SmartScreen покажет «Неизвестный издатель» («Подробнее → Выполнить в любом случае»).

#!/usr/bin/env bash
# Публикация сайта игры на GitHub Pages: содержимое dist/site → ветка gh-pages (без истории сборок).
# Запуск из корня проекта после `node tools/build-public.js`:  bash tools/publish-pages.sh [remote]
# Один раз в настройках репозитория: Settings → Pages → Source: «Deploy from a branch», ветка gh-pages, папка / (root).
set -euo pipefail
REMOTE="${1:-origin}"
SITE="dist/site"
[ -f "$SITE/index.html" ] || { echo "Нет $SITE/index.html — сначала: node tools/build-public.js"; exit 1; }
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cp -r "$SITE"/. "$TMP"/
touch "$TMP/.nojekyll"   # GitHub не прогоняет сайт через Jekyll: файлы отдаются как есть
cd "$TMP"
git init -q -b gh-pages
git add -A
git -c user.name="${GIT_AUTHOR_NAME:-arktur-bot}" -c user.email="${GIT_AUTHOR_EMAIL:-arktur@users.noreply.github.com}" commit -q -m "Сайт игры $(date -u +%Y-%m-%d)"
URL="$(git -C "$OLDPWD" remote get-url "$REMOTE")"
git push -f "$URL" gh-pages:gh-pages
echo "Готово: ветка gh-pages обновлена в $URL"

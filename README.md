# «Рычаг» для iPhone и Android

Здесь то же приложение, что в claude.ai: 2D-модели, мой зал, программы, прогресс, разминка, раздел о здоровье. Оно собрано как нативное приложение на Capacitor 8 и работает без интернета.

Чем мобильная версия отличается от версии в claude.ai:

| | в claude.ai | в приложении |
|---|---|---|
| Данные | в аккаунте Claude | на телефоне (копия в нативном хранилище) |
| Голос | голос Claude | системный синтез речи iOS/Android, русский язык, поверх музыки |
| Микрофон | диктовка claude.ai | системное распознавание речи |
| Тренер и фото | Claude из claude.ai | через твой сервер-посредник с ключом Claude API (п. 3) |
| Экран, вибрация | браузер | нативные плагины: экран не гаснет на тренировке, вибро на iPhone тоже работает |

## Что где лежит
- `src/` — исходники приложения. Меняешь их и пересобираешь.
- `scripts/build-www.js` — собирает `www/` с локальными шрифтами.
- `android/`, `ios/` — нативные проекты. Разрешения на микрофон, распознавание речи и камеру уже прописаны.
- `assets/` — иконка и заставка. После замены выполни `npm run assets`.
- `server/` — сервер-посредник для тренера и распознавания фото (Cloudflare Workers).
- `.github/workflows/build.yml` — облачная сборка APK/AAB и iOS.

## 1. Android — самый быстрый путь (без Android Studio)
1. Создай на GitHub **публичный** репозиторий с именем **rychag** и загрузи туда эту папку (например, через GitHub Desktop). QR-код ведёт на `https://github.com/dzhikzaur97-arch/rychag/releases/latest/download/rychag.apk`, поэтому имя и публичность важны: из приватного репозитория телефон файл не скачает. Если репозиторий будет приватным, APK можно скачать только из раздела Actions после входа в GitHub.
2. Открой вкладку **Actions** → «Сборка приложения» → **Run workflow**. Сборка идёт около 10 минут.
3. После сборки APK появится в разделе **Releases → latest** как `rychag.apk`, и QR-код начнёт работать. Каждая новая сборка заменяет файл по той же ссылке.
4. Отсканируй QR-код телефоном, скачай файл и открой его. Android попросит разрешить установку из этого источника. Сборки подписаны одним ключом (`android/app/rychag-debug.keystore`), поэтому обновления ставятся поверх и журнал сохраняется.

Собрать на своём компьютере с Windows тоже можно. Поставь Node.js 22 и Android Studio, затем выполни `npm install` и `npm run android`. Откроется Android Studio, там нажми ▶ Run.

## 2. iPhone
Для iPhone нужен Mac или облачная сборка, на Windows приложение под iOS не собирается.
- **Есть Mac с Xcode:** выполни `npm install` и `npm run ios`. В Xcode выбери свой Apple ID в Signing & Capabilities и запусти на подключённом iPhone. С бесплатным Apple ID приложение работает 7 дней, потом его надо установить заново.
- **Через TestFlight без Mac:** нужен аккаунт Apple Developer Program. Добавь в репозиторий секреты `IOS_CERT_P12_BASE64`, `IOS_CERT_PASSWORD`, `IOS_PROFILE_BASE64`, `IOS_TEAM_ID`, `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8_BASE64`. После этого workflow сам подпишет сборку и отправит её в TestFlight. Без секретов он только проверяет, что iOS-проект собирается.
- Идентификатор приложения: `ru.rychag.app`. Его же указывай в App Store Connect и в профиле подготовки.

## 3. Тренер и распознавание фото (необязательно)
Без этого шага приложение работает полностью, кроме чата «Тренер» и фото тренажёра. Ключ Claude API нельзя вшивать в приложение, поэтому запросы идут через маленький сервер:
```
cd server
npx wrangler login
npx wrangler secret put ANTHROPIC_API_KEY   # ключ из console.anthropic.com
npx wrangler secret put APP_KEY             # любая длинная строка-пароль
npx wrangler deploy                         # выдаст адрес вида https://rychag-api.<имя>.workers.dev
```
Затем в GitHub добавь секреты **Settings → Secrets → Actions**: `RYCHAG_API` (адрес сервера) и `RYCHAG_APP_KEY` (та же строка, что APP_KEY), и пересобери приложение. Модель по умолчанию — `claude-haiku-5-5`, её можно поменять в `server/wrangler.toml`. Оплата идёт по факту использования в Anthropic Console.

## 4. Публикация в магазинах
- **Google Play / RuStore:** нужен подписанный AAB/APK. Создай ключ:
  `keytool -genkey -v -keystore rychag.jks -keyalg RSA -keysize 2048 -validity 10000 -alias rychag`.
  Добавь секреты `ANDROID_KEYSTORE_BASE64` (файл в base64), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Workflow соберёт `app-release.aab` для Google Play и подписанный `app-release.apk`, который подходит, например, для RuStore. **Ключ храни отдельно: без него не выпустить обновление.**
- **App Store:** TestFlight → проверка → публикация в App Store Connect.
- Для магазинов понадобятся политика конфиденциальности и скриншоты. Данные хранятся на телефоне, а в тренера и распознавание фото уходят только вопрос и снимок.

## 5. Как обновлять
Меняешь файлы в `src/` (или копируешь их из веб-версии) и делаешь push в main. Номер сборки растёт сам.

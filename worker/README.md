# vonzvyagin-fitbit-status — деплой (без терминала)

Всё делается кликами в браузере через Cloudflare Dashboard и Google Cloud
Console. Терминал не нужен. Разбито на 4 блока — можно делать по одному.

## Блок 1. Google Cloud: доступ к твоим данным Fitbit Air

1. Открой https://console.cloud.google.com/
2. Вверху слева нажми на выбор проекта → **New Project** → назови как угодно
   (например `vonzvyagin-status`) → Create.
3. В поиске сверху введи `Google Health API` → открой → **Enable**.
4. В левом меню: **APIs & Services → OAuth consent screen**.
   - User Type: **External** → Create.
   - Заполни название приложения (любое) и свой email в двух местах, где
     просит.
   - Publishing status оставь **Testing**.
   - На шаге **Test users** добавь свой Google-аккаунт (тот, к которому
     привязан Fitbit Air).
   - На шаге **Scopes** нажми Add or Remove Scopes, впиши в фильтр `health` —
     появится список прав Google Health API. Отметь те, что про
     activity/sleep/heart rate (readonly-варианты, если есть) — там будет
     видно по описанию.
5. **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
   - Application type: **Web application**.
   - Authorized redirect URIs → Add URI →
     `https://developers.google.com/oauthplayground`
   - Create.
   - Появится окно с **Client ID** и **Client secret** — скопируй оба куда-то
     во временный текстовый файл, они понадобятся дальше.

Готово с этим блоком — напиши мне, и перейдём к следующему.

## Блок 2. Получить refresh-токен (тоже в браузере)

1. Открой https://developers.google.com/oauthplayground/
2. Справа сверху — иконка шестерёнки → включи **Use your own OAuth
   credentials** → вставь Client ID и Client secret из блока 1.
3. В левой колонке впиши вручную нужные scope-строки (те, что видел на шаге
   консент-скрина) в поле ввода и нажми **Authorize APIs**.
4. Войди тем же Google-аккаунтом, что привязан к Fitbit Air → Allow.
5. Нажми **Exchange authorization code for tokens**.
6. Скопируй `refresh_token` (длинная строка) — он нужен для Блока 3.

## Блок 3. Cloudflare Worker (создаём и вставляем код через дашборд)

1. Открой https://dash.cloudflare.com/ → в меню слева **Workers & Pages**.
2. **Create** → **Workers** → **Create Worker** → дай имя (например
   `vonzvyagin-fitbit-status`) → Deploy (создастся заглушка, это нормально).
3. Открой созданный Worker → вкладка **Edit code** (или **Quick edit**).
4. Сотри весь код-заглушку и вставь содержимое файла `worker/src/index.js` из
   этого репозитория (я пришлю готовый файл — просто копируешь целиком).
5. **Save and deploy**.
6. Настройки Worker'а → **Settings**:
   - **Variables and Secrets** → добавь 4 штуки, каждую как **Secret**
     (галочка/переключатель "Encrypt"):
     - `GOOGLE_CLIENT_ID` — из блока 1
     - `GOOGLE_CLIENT_SECRET` — из блока 1
     - `GOOGLE_REFRESH_TOKEN` — из блока 2
     - `DEBUG_KEY` — придумай любую длинную случайную строку (просто
       понажимай на клавиатуре)
   - **Bindings → KV Namespace bindings → Add** → создай новый namespace
     (например `STATUS_KV`) → variable name должен быть ровно `STATUS_KV`.
   - **Trigger Events / Cron Triggers → Add Cron Trigger** → добавь:
     `*/20 * * * *` (каждые 20 минут).
   - Save.

## Блок 4. Проверка

1. Открой в браузере: `https://<имя-воркера>.<твой-субдомен>.workers.dev/status.json`
   — сразу может быть `{"error":"no data yet"}`, это нормально, подожди до 20
   минут после первого крона (или в дашборде Worker'а есть кнопка "Trigger"
   для ручного запуска — если есть, нажми её).
2. Открой `https://<имя-воркера>.<твой-субдомен>.workers.dev/debug?key=ТВОЙ_DEBUG_KEY`
   — покажет, что реально пришло от Google. Пришли мне этот вывод (текстом
   или скриншотом) — я поправлю разбор данных под реальный формат ответа.
3. Пришли мне сам URL воркера (`.../status.json`) — я подставлю его в
   `index.html` вместо заглушки и опубликую на сайте.

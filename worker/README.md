# vonzvyagin-fitbit-status — деплой

Cloudflare Worker, который раз в 20 минут дёргает Google Health API (данные с
Fitbit Air), считает 3 статуса и отдаёт их публичным JSON'ом для
`vonzvyagin.ru`. Ниже — шаги, которые нужно сделать руками (требуют логина в
твои Google/Cloudflare аккаунты, поэтому их не сделать из этой сессии).

## 1. Google Cloud: проект + OAuth

1. https://console.cloud.google.com/ → создать новый проект (например
   `vonzvyagin-fitbit-status`).
2. В библиотеке API найти и включить **Google Health API**.
3. **OAuth consent screen**:
   - User type: External.
   - Publishing status: **Testing** (это важно — так не нужен security review
     для restricted scopes, потому что приложением пользуешься только ты).
   - В Test users добавь свой Google-аккаунт — тот, что привязан к Fitbit Air.
   - На шаге Scopes поищи в списке `health` — там должны появиться реальные
     строки scope'ов Google Health API. Возьми те, что относятся к activity,
     sleep, heart rate / HRV (readonly-варианты). Точные названия scope'ов я
     не смог подтвердить из документации (заблокирована в моей сети), поэтому
     это единственный шаг, где нужно посмотреть глазами и просто выбрать
     нужное — там будет понятно по описанию.
4. **Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Web application**.
   - Authorized redirect URI: `https://developers.google.com/oauthplayground`
   - Сохрани `Client ID` и `Client secret`.

## 2. Получить refresh-токен и посмотреть реальный формат ответа

1. Открой https://developers.google.com/oauthplayground/
2. Шестерёнка (Settings) справа → включи **Use your own OAuth credentials** →
   вставь Client ID / Client secret из шага 1.
3. В левой панели найди Google Health API (или вручную впиши scope-строки,
   которые взял на шаге 1.3) → Authorize APIs → войди тем же Google-аккаунтом,
   что привязан к Fitbit Air → Allow.
4. Step 2 → **Exchange authorization code for tokens** → скопируй:
   - `refresh_token` — long-lived, он пригодится Worker'у.
   - `access_token` — короткоживущий (~1 час), пригодится для проверки ниже.
5. Проверь реальные эндпоинты у себя в терминале (замени `ACCESS_TOKEN`):

   ```bash
   curl -H "Authorization: Bearer ACCESS_TOKEN" \
     "https://health.googleapis.com/v4/users/me/sleepSessions?date=$(date +%F)"

   curl -H "Authorization: Bearer ACCESS_TOKEN" \
     "https://health.googleapis.com/v4/users/me/readinessScores?date=$(date +%F)"
   ```

   Если путь `sleepSessions`/`readinessScores` не тот — Google обычно отдаёт
   404 с понятным телом ответа. Пришли мне, что вернулось (можно просто текст
   ошибки, без личных данных) — поправлю `ENDPOINTS` в `src/index.js`.
   Как только увидим реальный формат ответа — я поправлю и `computeStatus()`.
   До этого момента Worker будет писать в `debug:lastRaw` то, что реально
   пришло — этого тоже достаточно для калибровки без ручного curl.

## 3. Cloudflare: KV + secrets + деплой

```bash
cd worker
npm install
npx wrangler login                     # откроет браузер, залогинься в Cloudflare

npx wrangler kv namespace create STATUS_KV
# скопируй id из вывода в wrangler.toml → [[kv_namespaces]] → id

npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put GOOGLE_REFRESH_TOKEN
npx wrangler secret put DEBUG_KEY        # придумай любую длинную случайную строку

npx wrangler deploy
```

После деплоя Wrangler выведет URL вида
`https://vonzvyagin-fitbit-status.<твой-субдомен>.workers.dev`.

## 4. Проверка

- `curl https://<worker-url>/status.json` — пока не отработает первый cron,
  вернёт `503 {"error":"no data yet"}`. Можно руками дёрнуть один раз через
  `npx wrangler triggers` или просто подождать до 20 минут.
- `curl "https://<worker-url>/debug?key=ТВОЙ_DEBUG_KEY"` — сырые ответы Google
  Health API + посчитанный статус. Пришли мне вывод (или структуру полей),
  если что-то не совпало с ожидаемым — я быстро поправлю парсинг.

## 5. (опционально) свой домен вместо `*.workers.dev`

Cloudflare Dashboard → Workers & Pages → выбрать Worker → Settings → Domains &
Routes → Add → например `status.vonzvyagin.ru` (у тебя уже DNS на Cloudflare,
это несколько кликов). Тогда на фронтенде URL будет короче и не будет упоминания
`workers.dev`.

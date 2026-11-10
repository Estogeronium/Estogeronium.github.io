# vonzvyagin-fitbit-status — деплой (WHOOP)

Воркер уже существует (`vonzvyagin-fitbit-status.evgenyzv.workers.dev`), просто
меняем источник данных с Google Health на WHOOP. Короче, чем в первый раз —
не нужно создавать новый Worker, KV или cron, только:

## Блок 1. WHOOP Developer App

1. Зайди на https://developer.whoop.com/ → залогинься своим WHOOP-аккаунтом
   (тем же, что в приложении WHOOP на телефоне).
2. Создай приложение (обычно в разделе "Apps" / "Developer Dashboard" →
   Create App).
3. **Redirect URI** — впиши ровно:
   ```
   https://vonzvyagin-fitbit-status.evgenyzv.workers.dev/reconnect
   ```
4. Scopes — отметь: `offline`, `read:recovery`, `read:sleep`, `read:cycles`.
5. Сохрани → скопируй **Client ID** и **Client Secret**.

## Блок 2. Обновить Cloudflare Worker

1. Вставь новый код `worker/src/index.js` (пришлю отдельно) в Edit code →
   Save and deploy.
2. Settings → Variables and Secrets:
   - Добавь `WHOOP_CLIENT_ID` (Secret) — из блока 1.
   - Добавь `WHOOP_CLIENT_SECRET` (Secret) — из блока 1.
   - `DEBUG_KEY` и `STATUS_KV` biding уже есть, не трогай.
   - Старые `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REFRESH_TOKEN`
     можно оставить (не мешают) или удалить — на твоё усмотрение.

## Блок 3. Первая авторизация

Открой:
```
https://vonzvyagin-fitbit-status.evgenyzv.workers.dev/reconnect?key=ТВОЙ_DEBUG_KEY
```
Войди в WHOOP, нажми Allow — воркер сам сохранит refresh-токен в KV и сразу
обновит статус.

## Блок 4. Проверка

1. `https://vonzvyagin-fitbit-status.evgenyzv.workers.dev/status.json` — должны
   быть свежие метки.
2. `https://vonzvyagin-fitbit-status.evgenyzv.workers.dev/debug?key=ТВОЙ_DEBUG_KEY`
   — сырые ответы WHOOP API. Пришли, если метки покажут "Нет данных" — поля в
   ответе WHOOP не до конца проверены (доки противоречивы), поправим парсинг
   под реальный формат.

## Про обновление токена дальше

WHOOP ротирует refresh-токен на каждом цикле (раз в 20 минут), и воркер сам
сохраняет новый в KV каждый раз — в отличие от Google, здесь не должно быть
никакого ручного переоформления раз в N дней. Если вдруг токен всё же
протухнет (ошибка `invalid_grant` в `/debug`) — просто зайди по той же ссылке
`/reconnect` заново.

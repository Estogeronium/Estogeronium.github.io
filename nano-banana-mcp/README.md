# nano-banana-mcp

Remote MCP-сервер для Claude: генерация и редактирование картинок через
Google Nano Banana (Gemini image models). Cloudflare Worker, деплоится сам
через GitHub Actions при пуше в `main` (папка `nano-banana-mcp/`).

Инструменты:
- `generate_image` — картинка по тексту
- `edit_image` — правка/комбинирование 1–14 картинок (URL или base64)

Модели (параметр `model`): `nano-banana-2` (по умолчанию), `nano-banana-2-lite`,
`nano-banana-pro`, `nano-banana`.

## Настройка (один раз, всё в браузере)

1. **Gemini API key**: https://aistudio.google.com/apikey → Create API key.
   Для генерации картинок нужен включённый биллинг в проекте.
2. **Cloudflare API token**: dash.cloudflare.com → My Profile → API Tokens →
   Create Token → шаблон **Edit Cloudflare Workers**. Account ID — на главной
   Workers & Pages справа.
3. **MCP_TOKEN**: любая длинная случайная строка (это «пароль» в адресе).
4. GitHub → репозиторий → Settings → Secrets and variables → Actions →
   New repository secret, четыре штуки:
   `GEMINI_API_KEY`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `MCP_TOKEN`.
5. Actions → **Deploy nano-banana-mcp** → Run workflow.
6. Claude → Settings → Connectors → Add custom connector → URL:
   `https://nano-banana-mcp.<твой-сабдомен>.workers.dev/mcp/<MCP_TOKEN>`

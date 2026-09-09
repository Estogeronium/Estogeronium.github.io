# vonzvyagin.ru

Личная страница Жени Звягина. Один статичный `index.html`, без сборки.

## Файлы

- `index.html` — вся страница (стили инлайн)
- `portrait.jpg` — портрет (1000×1000, ~124 КБ)
- `favicon.svg`
- `CNAME` — домен `vonzvyagin.ru` для GitHub Pages

## Как добавить проект

В `index.html` в блоке `<section class="projects">` → `<ul>` добавить `<li>`:

```html
<li><a href="ССЫЛКА" target="_blank" rel="noopener">Название проекта</a></li>
```

Внешние ссылки — с `target="_blank" rel="noopener"`, внутренние (свои поддомены) — без.

## Деплой

GitHub Pages, репозиторий `Estogeronium/Estogeronium.github.io`.
Settings → Pages → Source: **Deploy from a branch** → `main` / `/ (root)`.
Домен `vonzvyagin.ru` — через `CNAME` + Custom domain в настройках Pages.
DNS (Cloudflare): `CNAME @ → estogeronium.github.io` (grey cloud), `CNAME www → estogeronium.github.io`.

Обновление: правишь `index.html` → коммит + push в GitHub Desktop → сайт пересобирается сам.

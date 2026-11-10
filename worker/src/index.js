/**
 * vonzvyagin-fitbit-status
 *
 * Раз в 20 минут тянет данные с WHOOP через официальный WHOOP API v2,
 * считает 3 качественных статуса и кладёт их в KV. Публичный /status.json
 * отдаёт только эти статусы — без сырых чисел пульса/HRV/strain.
 *
 * WHOOP OAuth: https://api.prod.whoop.com/oauth/oauth2/{auth,token}
 * Данные: https://api.prod.whoop.com/developer/v2/{recovery,activity/sleep,cycle}
 *
 * ВАЖНО про refresh-токен: в отличие от Google, WHOOP ротирует refresh-токен
 * при КАЖДОМ обмене — и при /reconnect, и при обычном плановом обновлении
 * access-токена раз в 20 минут. Поэтому runUpdate() обязан сохранять новый
 * refresh-токен в KV на каждом цикле, а не только при ручной переавторизации
 * — иначе через один цикл токен станет недействительным. У WHOOP нет
 * google-style блокировки верификации для личных приложений, так что раз
 * получив токен, он должен обновляться бесконечно сам.
 *
 * Точные пути полей в ответах (score.recovery_score,
 * score.sleep_performance_percentage, score.strain) не проверены живым
 * вызовом — доки противоречивы. Смотри /debug?key=... после первого
 * реального запуска и поправь pick()-пути при необходимости.
 */

const API_BASE = "https://api.prod.whoop.com/developer/v2";
const AUTH_URL = "https://api.prod.whoop.com/oauth/oauth2/auth";
const TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token";

const SCOPES = ["offline", "read:recovery", "read:sleep", "read:cycles"];

const ENDPOINTS = {
  sleep: "activity/sleep",
  recovery: "recovery",
  cycle: "cycle",
};

// Пороги — стартовые (ориентированы на опубликованные цветовые зоны WHOOP),
// нуждаются в калибровке под личную норму после недели реальных данных
// (см. /debug).
const CONFIG = {
  sleepGoodPct: 85,
  sleepOkPct: 70,
  recoveryGoodPct: 67,
  recoveryOkPct: 34,
  // Strain — накопительная за день метрика (как шаги), поэтому сравниваем
  // не с абсолютной целью, а с ожидаемым темпом на текущий час.
  strain: { dailyGoal: 12, goodRatio: 0.8, okRatio: 0.4 },
};

// Локальный часовой пояс (Москва, без перевода часов).
const LOCAL_UTC_OFFSET_HOURS = 3;
const ACTIVE_DAY_START_HOUR = 8;
const ACTIVE_DAY_END_HOUR = 23;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/status.json" || url.pathname === "/") {
      const stored = await env.STATUS_KV.get("status", "json");
      return jsonResponse(stored || { error: "no data yet" }, stored ? 200 : 503);
    }

    if (url.pathname === "/debug") {
      if (url.searchParams.get("key") !== env.DEBUG_KEY) {
        return new Response("not found", { status: 404 });
      }
      const raw = await env.STATUS_KV.get("debug:lastRaw", "json");
      const status = await env.STATUS_KV.get("status", "json");
      return jsonResponse({ status, raw }, 200, false);
    }

    if (url.pathname === "/run-now") {
      if (url.searchParams.get("key") !== env.DEBUG_KEY) {
        return new Response("not found", { status: 404 });
      }
      await runUpdate(env);
      return new Response("ok", { status: 200 });
    }

    if (url.pathname === "/reconnect") {
      return handleReconnect(request, url, env);
    }

    return new Response("not found", { status: 404 });
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runUpdate(env));
  },
};

async function handleReconnect(request, url, env) {
  const redirectUri = `${url.origin}/reconnect`;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code) {
    if (url.searchParams.get("key") !== env.DEBUG_KEY) {
      return new Response("not found", { status: 404 });
    }
    const authUrl = new URL(AUTH_URL);
    authUrl.searchParams.set("client_id", env.WHOOP_CLIENT_ID);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", SCOPES.join(" "));
    authUrl.searchParams.set("state", env.DEBUG_KEY);
    return Response.redirect(authUrl.toString(), 302);
  }

  if (state !== env.DEBUG_KEY) {
    return new Response("not found", { status: 404 });
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: env.WHOOP_CLIENT_ID,
    client_secret: env.WHOOP_CLIENT_SECRET,
    redirect_uri: redirectUri,
    scope: SCOPES.join(" "),
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    return new Response(`token exchange failed: ${res.status} ${await res.text()}`, { status: 502 });
  }

  const data = await res.json();
  if (!data.refresh_token) {
    return new Response(
      "WHOOP didn't return a refresh_token — scope 'offline' обязателен, проверь, что он включён в запрос.",
      { status: 502 }
    );
  }

  await env.STATUS_KV.put("refreshToken", data.refresh_token);
  await runUpdate(env);

  return new Response(
    `<!doctype html><meta charset="utf-8">
     <body style="font-family:sans-serif;max-width:480px;margin:60px auto;text-align:center">
       <h1>Готово ✅</h1>
       <p>Новый токен сохранён, статус обновлён.</p>
       <p><a href="https://vonzvyagin.ru/">← вернуться на сайт</a></p>
     </body>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

async function runUpdate(env) {
  const refreshToken = (await env.STATUS_KV.get("refreshToken")) || env.WHOOP_REFRESH_TOKEN;
  const tokens = await refreshTokens(env, refreshToken);

  // WHOOP ротирует refresh-токен на каждом обновлении — обязательно
  // сохраняем новый, иначе следующий цикл отвалится с invalid_grant.
  if (tokens.refresh_token) {
    await env.STATUS_KV.put("refreshToken", tokens.refresh_token);
  }

  const raw = await fetchWhoopData(tokens.access_token);
  const status = computeStatus(raw);

  await env.STATUS_KV.put("status", JSON.stringify(status));
  await env.STATUS_KV.put("debug:lastRaw", JSON.stringify(raw));
}

async function refreshTokens(env, refreshToken) {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: env.WHOOP_CLIENT_ID,
    client_secret: env.WHOOP_CLIENT_SECRET,
    scope: "offline",
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    throw new Error(`token refresh failed: ${res.status} ${await res.text()}`);
  }

  return res.json();
}

async function fetchWhoopData(accessToken) {
  const raw = {};

  for (const [key, path] of Object.entries(ENDPOINTS)) {
    try {
      const res = await fetch(`${API_BASE}/${path}?limit=5`, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      });
      raw[key] = res.ok ? await res.json() : { httpError: res.status, body: await res.text() };
    } catch (err) {
      raw[key] = { fetchError: String(err) };
    }
  }

  return raw;
}

function pick(obj, paths) {
  for (const path of paths) {
    const value = path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
    if (value != null) return value;
  }
  return undefined;
}

function toNumber(value) {
  if (value == null) return undefined;
  const n = Number(value);
  return Number.isNaN(n) ? undefined : n;
}

// Берёт самую свежую уже просчитанную запись (score_state === "SCORED") —
// самая последняя запись может быть ещё не обсчитана WHOOP.
function latestScored(rawResponse) {
  const records = pick(rawResponse, ["records"]);
  if (!Array.isArray(records) || records.length === 0) return undefined;
  return records.find((r) => pick(r, ["score_state"]) === "SCORED") || records[0];
}

function computeStatus(raw) {
  const sleepRecord = latestScored(raw.sleep);
  const recoveryRecord = latestScored(raw.recovery);
  const cycleRecord = latestScored(raw.cycle);

  const sleepPct = toNumber(
    pick(sleepRecord, ["score.sleep_performance_percentage", "sleep_performance_percentage"])
  );
  const recoveryPct = toNumber(pick(recoveryRecord, ["score.recovery_score", "recovery_score"]));
  const strain = toNumber(pick(cycleRecord, ["score.strain", "strain"]));

  return {
    sleep: sleepStatus(sleepPct),
    readiness: readiness(recoveryPct),
    energy: energyStatus(strain),
    updatedAt: new Date().toISOString(),
  };
}

function sleepStatus(sleepPct) {
  if (sleepPct == null) return { label: "Нет данных о сне", level: "unknown" };
  if (sleepPct >= CONFIG.sleepGoodPct) return { label: "Выспался", level: "good" };
  if (sleepPct >= CONFIG.sleepOkPct) return { label: "Так себе выспался", level: "ok" };
  return { label: "Не выспался", level: "bad" };
}

function readiness(recoveryPct) {
  if (recoveryPct == null) return { label: "Нет данных о готовности", level: "unknown" };
  if (recoveryPct >= CONFIG.recoveryGoodPct) {
    return { label: "Готов обсуждать важное", level: "good" };
  }
  if (recoveryPct >= CONFIG.recoveryOkPct) {
    return { label: "Лучше про несрочное", level: "ok" };
  }
  return { label: "Сегодня не до серьёзного", level: "bad" };
}

function energyStatus(strain) {
  if (strain == null) return { label: "Нет данных об активности", level: "unknown" };

  const localHour = getLocalHour();
  const span = ACTIVE_DAY_END_HOUR - ACTIVE_DAY_START_HOUR;
  const elapsed = Math.min(Math.max(localHour - ACTIVE_DAY_START_HOUR, 0), span);
  const expectedByNow = (CONFIG.strain.dailyGoal * Math.max(elapsed, 1)) / span;
  const ratio = strain / expectedByNow;

  if (strain >= CONFIG.strain.dailyGoal || ratio >= CONFIG.strain.goodRatio) {
    return { label: "На ногах весь день", level: "good" };
  }
  if (ratio >= CONFIG.strain.okRatio) {
    return { label: "Хожу, но не рекорд", level: "ok" };
  }
  return { label: "Почти не вставал из-за стола", level: "bad" };
}

function getLocalHour() {
  const now = new Date();
  let hour = now.getUTCHours() + now.getUTCMinutes() / 60 + LOCAL_UTC_OFFSET_HOURS;
  if (hour >= 24) hour -= 24;
  return hour;
}

function jsonResponse(data, status = 200, cors = true) {
  const headers = { "Content-Type": "application/json; charset=utf-8" };
  if (cors) {
    headers["Access-Control-Allow-Origin"] = "*";
    headers["Cache-Control"] = "public, max-age=60";
  }
  return new Response(JSON.stringify(data), { status, headers });
}

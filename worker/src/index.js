/**
 * vonzvyagin-fitbit-status
 *
 * Раз в N минут тянет данные с Fitbit Air через Google Health API,
 * считает 3 качественных статуса и кладёт их в KV. Публичный /status.json
 * отдаёт только эти статусы — без сырых чисел пульса/HRV.
 *
 * ВАЖНО: Google Health API запущен в мае 2026, старый Fitbit Web API отключён
 * в сентябре 2026. Точные имена data type'ов ниже (ENDPOINTS) и путей внутри
 * ответа (см. computeStatus) — provisional, взяты по аналогии с REST-паттерном
 * из офдоков (`/v4/users/me/{dataType}`), но не проверены живым вызовом (доступ
 * к developers.google.com заблокирован в текущей рабочей среде). Как только
 * будет реальный ответ API — правим ENDPOINTS и extract*() под факт.
 * Смотри /debug?key=... — там сырые последние ответы, чтобы это можно было
 * поправить без гаданий.
 */

const API_BASE = "https://health.googleapis.com/v4/users/me";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

// Пути данных, которые пробуем вытащить. Каждый — best guess, при ошибке
// (404/иное) просто пропускаем этот сигнал, остальное не ломаем.
const ENDPOINTS = {
  sleep: "sleepSessions",
  heart: "heartRateSummaries",
  hrv: "heartRateVariabilitySummaries",
  readiness: "readinessScores",
  activity: "activitySummaries",
};

// Пороги — стартовые, нуждаются в калибровке под личную норму после недели
// реальных данных (см. /debug).
const CONFIG = {
  sleep: { good: 75, ok: 60 },
  readiness: { good: 70, ok: 45 },
  hrvGoodMs: 40,
  restingHrGoodBpm: 62,
  energy: { goodSteps: 6000, okSteps: 3000 },
};

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

    return new Response("not found", { status: 404 });
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runUpdate(env));
  },
};

async function runUpdate(env) {
  const accessToken = await refreshAccessToken(env);
  const raw = await fetchHealthData(accessToken);
  const status = computeStatus(raw);

  await env.STATUS_KV.put("status", JSON.stringify(status));
  await env.STATUS_KV.put("debug:lastRaw", JSON.stringify(raw));
}

async function refreshAccessToken(env) {
  const body = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    refresh_token: env.GOOGLE_REFRESH_TOKEN,
    grant_type: "refresh_token",
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    throw new Error(`token refresh failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return data.access_token;
}

async function fetchHealthData(accessToken) {
  const today = new Date().toISOString().slice(0, 10);
  const raw = {};

  for (const [key, path] of Object.entries(ENDPOINTS)) {
    try {
      const res = await fetch(`${API_BASE}/${path}?date=${today}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      raw[key] = res.ok ? await res.json() : { httpError: res.status };
    } catch (err) {
      raw[key] = { fetchError: String(err) };
    }
  }

  return raw;
}

// Пытается достать значение по нескольким возможным путям в ответе —
// защита от того, что реальная форма JSON отличается от предположенной.
function pick(obj, paths) {
  for (const path of paths) {
    const value = path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
    if (value != null) return value;
  }
  return undefined;
}

function computeStatus(raw) {
  const sleepScore = pick(raw.sleep, [
    "sleepSessions.0.score",
    "sessions.0.score",
    "0.score",
  ]);
  const readinessScore = pick(raw.readiness, [
    "readinessScores.0.score",
    "scores.0.score",
    "0.score",
  ]);
  const hrv = pick(raw.hrv, [
    "heartRateVariabilitySummaries.0.rmssdMillis",
    "summaries.0.rmssdMillis",
    "0.rmssdMillis",
  ]);
  const restingHr = pick(raw.heart, [
    "heartRateSummaries.0.restingHeartRate",
    "summaries.0.restingHeartRate",
    "0.restingHeartRate",
  ]);
  const steps = pick(raw.activity, [
    "activitySummaries.0.steps",
    "summaries.0.steps",
    "0.steps",
  ]);

  return {
    sleep: bucket(sleepScore, CONFIG.sleep, {
      good: "Выспался",
      ok: "Так себе выспался",
      bad: "Не выспался",
      unknown: "Нет данных о сне",
    }),
    readiness: readiness(readinessScore, hrv, restingHr),
    energy: bucket(steps, CONFIG.energy, {
      good: "Энергии много",
      ok: "Энергия так себе",
      bad: "На нуле",
      unknown: "Нет данных об активности",
    }),
    updatedAt: new Date().toISOString(),
  };
}

function readiness(nativeScore, hrv, restingHr) {
  if (nativeScore != null) {
    return bucket(nativeScore, CONFIG.readiness, {
      good: "Готов обсуждать важное",
      ok: "Лучше про несрочное",
      bad: "Сегодня не до серьёзного",
      unknown: "Нет данных",
    });
  }
  // Фолбэк, если нативный readiness не пришёл: HRV выше нормы и resting HR
  // не задран — считаем, что готов.
  if (hrv == null && restingHr == null) {
    return { label: "Нет данных о готовности", level: "unknown" };
  }
  const hrvOk = hrv == null || hrv >= CONFIG.hrvGoodMs;
  const hrOk = restingHr == null || restingHr <= CONFIG.restingHrGoodBpm;
  if (hrvOk && hrOk) return { label: "Готов обсуждать важное", level: "good" };
  if (hrvOk || hrOk) return { label: "Лучше про несрочное", level: "ok" };
  return { label: "Сегодня не до серьёзного", level: "bad" };
}

function bucket(value, thresholds, labels) {
  if (value == null) return { label: labels.unknown, level: "unknown" };
  if (value >= thresholds.good) return { label: labels.good, level: "good" };
  if (value >= thresholds.ok) return { label: labels.ok, level: "ok" };
  return { label: labels.bad, level: "bad" };
}

function jsonResponse(data, status = 200, cors = true) {
  const headers = { "Content-Type": "application/json; charset=utf-8" };
  if (cors) {
    headers["Access-Control-Allow-Origin"] = "*";
    headers["Cache-Control"] = "public, max-age=60";
  }
  return new Response(JSON.stringify(data), { status, headers });
}

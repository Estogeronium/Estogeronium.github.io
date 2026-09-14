/**
 * vonzvyagin-fitbit-status
 *
 * Раз в N минут тянет данные с Fitbit Air через Google Health API,
 * считает 3 качественных статуса и кладёт их в KV. Публичный /status.json
 * отдаёт только эти статусы — без сырых чисел пульса/HRV.
 *
 * Реальный REST-паттерн Google Health API v4:
 *   GET /v4/users/me/dataTypes/{type}/dataPoints
 * Числовые поля в ответе приходят строками (int64 → JSON string).
 * "daily-heart-rate-variability" уже содержит и HRV, и nonRemHeartRateBeatsPerMinute
 * (по сути пульс покоя) — отдельный запрос heart-rate не нужен.
 * Отдельного "readiness"/"cardio load" типа в публичном API нет — готовность
 * считаем сами из HRV + пульса.
 */

const API_BASE = "https://health.googleapis.com/v4/users/me/dataTypes";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

const ENDPOINTS = {
  sleep: { type: "sleep", pageSize: 3 },
  hrv: { type: "daily-heart-rate-variability", pageSize: 3 },
  steps: { type: "steps", pageSize: 300 },
};

// Пороги — стартовые, нуждаются в калибровке под личную норму после недели
// реальных данных (см. /debug).
const CONFIG = {
  hrvGoodMs: 40,
  restingHrGoodBpm: 62,
  sleepGoodMinutes: 420,
  sleepOkMinutes: 360,
  sleepGoodEfficiency: 85,
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

    if (url.pathname === "/run-now") {
      if (url.searchParams.get("key") !== env.DEBUG_KEY) {
        return new Response("not found", { status: 404 });
      }
      await runUpdate(env);
      return new Response("ok", { status: 200 });
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
  const raw = {};

  for (const [key, { type, pageSize }] of Object.entries(ENDPOINTS)) {
    try {
      const res = await fetch(`${API_BASE}/${type}/dataPoints?pageSize=${pageSize}`, {
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

function computeStatus(raw) {
  const hrv = toNumber(
    pick(raw.hrv, ["dataPoints.0.dailyHeartRateVariability.averageHeartRateVariabilityMilliseconds"])
  );
  const restingHr = toNumber(
    pick(raw.hrv, ["dataPoints.0.dailyHeartRateVariability.nonRemHeartRateBeatsPerMinute"])
  );
  const steps = sumSteps(raw.steps);

  return {
    sleep: sleepStatus(raw.sleep),
    readiness: readiness(hrv, restingHr),
    energy: bucket(steps, CONFIG.energy.goodSteps, CONFIG.energy.okSteps, {
      good: "Энергии много",
      ok: "Энергия так себе",
      bad: "На нуле",
      unknown: "Нет данных об активности",
    }),
    updatedAt: new Date().toISOString(),
  };
}

function sleepStatus(rawSleep) {
  const summary = pick(rawSleep, ["dataPoints.0.sleep.summary"]);
  if (!summary) return { label: "Нет данных о сне", level: "unknown" };

  const asleep = toNumber(summary.minutesAsleep);
  const awake = toNumber(summary.minutesAwake) || 0;
  const inPeriod = toNumber(summary.minutesInSleepPeriod) || asleep + awake;
  if (asleep == null) return { label: "Нет данных о сне", level: "unknown" };

  const efficiency = inPeriod ? (asleep / inPeriod) * 100 : null;
  const efficiencyOk = efficiency == null || efficiency >= CONFIG.sleepGoodEfficiency;

  if (asleep >= CONFIG.sleepGoodMinutes && efficiencyOk) {
    return { label: "Выспался", level: "good" };
  }
  if (asleep >= CONFIG.sleepOkMinutes) {
    return { label: "Так себе выспался", level: "ok" };
  }
  return { label: "Не выспался", level: "bad" };
}

function sumSteps(rawSteps) {
  const points = pick(rawSteps, ["dataPoints"]);
  if (!Array.isArray(points) || points.length === 0) return undefined;
  let total = 0;
  let found = false;
  for (const point of points) {
    const count = toNumber(pick(point, ["steps.count"]));
    if (count != null) {
      total += count;
      found = true;
    }
  }
  return found ? total : undefined;
}

function readiness(hrv, restingHr) {
  if (hrv == null && restingHr == null) {
    return { label: "Нет данных о готовности", level: "unknown" };
  }
  const hrvOk = hrv == null || hrv >= CONFIG.hrvGoodMs;
  const hrOk = restingHr == null || restingHr <= CONFIG.restingHrGoodBpm;
  if (hrvOk && hrOk) return { label: "Готов обсуждать важное", level: "good" };
  if (hrvOk || hrOk) return { label: "Лучше про несрочное", level: "ok" };
  return { label: "Сегодня не до серьёзного", level: "bad" };
}

function bucket(value, goodThreshold, okThreshold, labels) {
  if (value == null) return { label: labels.unknown, level: "unknown" };
  if (value >= goodThreshold) return { label: labels.good, level: "good" };
  if (value >= okThreshold) return { label: labels.ok, level: "ok" };
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

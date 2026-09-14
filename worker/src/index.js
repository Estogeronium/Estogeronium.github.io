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
  energy: { dailyGoalSteps: 6000, goodRatio: 0.8, okRatio: 0.4 },
};

// Локальный часовой пояс (Москва, без перевода часов) — используется, чтобы
// сравнивать шаги не с полной дневной нормой, а с ожидаемым темпом на текущий
// час, иначе бейдж будет «На нуле» весь день до вечера.
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
    energy: energyStatus(steps),
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
    // Одни и те же шаги иногда прилетают и с самого Fitbit Air, и с телефона
    // через Apple Health за то же время — считаем только трекер, чтобы не
    // задваивать.
    if (pick(point, ["dataSource.platform"]) !== "FITBIT") continue;
    const count = toNumber(pick(point, ["steps.count"]));
    if (count != null) {
      total += count;
      found = true;
    }
  }
  return found ? total : undefined;
}

function energyStatus(steps) {
  if (steps == null) return { label: "Нет данных об активности", level: "unknown" };

  const localHour = getLocalHour();
  const span = ACTIVE_DAY_END_HOUR - ACTIVE_DAY_START_HOUR;
  const elapsed = Math.min(Math.max(localHour - ACTIVE_DAY_START_HOUR, 0), span);
  // Минимум 1 час, чтобы рано утром не делить на что-то около нуля.
  const expectedByNow = (CONFIG.energy.dailyGoalSteps * Math.max(elapsed, 1)) / span;
  const ratio = steps / expectedByNow;

  if (steps >= CONFIG.energy.dailyGoalSteps || ratio >= CONFIG.energy.goodRatio) {
    return { label: "Энергии много", level: "good" };
  }
  if (ratio >= CONFIG.energy.okRatio) {
    return { label: "Энергия так себе", level: "ok" };
  }
  return { label: "На нуле", level: "bad" };
}

function getLocalHour() {
  const now = new Date();
  let hour = now.getUTCHours() + now.getUTCMinutes() / 60 + LOCAL_UTC_OFFSET_HOURS;
  if (hour >= 24) hour -= 24;
  return hour;
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

function jsonResponse(data, status = 200, cors = true) {
  const headers = { "Content-Type": "application/json; charset=utf-8" };
  if (cors) {
    headers["Access-Control-Allow-Origin"] = "*";
    headers["Cache-Control"] = "public, max-age=60";
  }
  return new Response(JSON.stringify(data), { status, headers });
}

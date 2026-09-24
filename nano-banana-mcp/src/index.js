// Remote MCP-сервер (Streamable HTTP, stateless) поверх Gemini image API — Nano Banana.
// Подключается в Claude как кастомный коннектор: https://<worker>/mcp/<MCP_TOKEN>

const PROTOCOL_VERSION = "2025-06-18";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";

const MODELS = {
  "nano-banana-2": "gemini-3.1-flash-image",
  "nano-banana-2-lite": "gemini-3.1-flash-lite-image",
  "nano-banana-pro": "gemini-3-pro-image",
  "nano-banana": "gemini-2.5-flash-image",
};

const ASPECT_RATIOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];

const commonProps = {
  prompt: { type: "string", description: "Что нарисовать / что изменить. Лучше подробно." },
  aspect_ratio: { type: "string", enum: ASPECT_RATIOS, description: "Соотношение сторон, по умолчанию 1:1." },
  image_size: { type: "string", enum: ["1K", "2K", "4K"], description: "Разрешение (не для всех моделей). По умолчанию 1K." },
  model: {
    type: "string",
    enum: Object.keys(MODELS),
    description: "nano-banana-2 (по умолчанию), nano-banana-2-lite (дешевле/быстрее), nano-banana-pro (максимум качества), nano-banana (legacy).",
  },
};

const TOOLS = [
  {
    name: "generate_image",
    description: "Сгенерировать изображение по текстовому описанию через Nano Banana (Gemini).",
    inputSchema: { type: "object", properties: commonProps, required: ["prompt"] },
  },
  {
    name: "edit_image",
    description:
      "Отредактировать или скомбинировать изображения через Nano Banana: передай 1–14 исходных картинок (URL или base64) и инструкцию.",
    inputSchema: {
      type: "object",
      properties: {
        ...commonProps,
        images: {
          type: "array",
          minItems: 1,
          maxItems: 14,
          description: "Исходные изображения: публичные https-URL или data:image/...;base64,... строки.",
          items: { type: "string" },
        },
      },
      required: ["prompt", "images"],
    },
  },
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/" && request.method === "GET") {
      return new Response("nano-banana-mcp ok\n");
    }

    if (!env.MCP_TOKEN || url.pathname !== `/mcp/${env.MCP_TOKEN}`) {
      return new Response("Not found", { status: 404 });
    }

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors() });
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: { Allow: "POST", ...cors() } });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json(rpcError(null, -32700, "Parse error"), 400);
    }

    if (Array.isArray(body)) {
      const results = (await Promise.all(body.map((m) => handle(m, env)))).filter(Boolean);
      return results.length ? json(results) : new Response(null, { status: 202, headers: cors() });
    }

    const result = await handle(body, env);
    return result ? json(result) : new Response(null, { status: 202, headers: cors() });
  },
};

async function handle(msg, env) {
  const { id, method, params } = msg || {};
  const isNotification = id === undefined || id === null;

  switch (method) {
    case "initialize":
      return rpcResult(id, {
        protocolVersion: params?.protocolVersion || PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "nano-banana-mcp", version: "1.0.0" },
        instructions: "Генерация и редактирование изображений через Google Nano Banana (Gemini image models).",
      });
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, { tools: TOOLS });
    case "tools/call":
      return rpcResult(id, await callTool(params?.name, params?.arguments || {}, env));
    default:
      if (isNotification) return null;
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

async function callTool(name, args, env) {
  try {
    if (name !== "generate_image" && name !== "edit_image") throw new Error(`Unknown tool: ${name}`);
    if (!args.prompt) throw new Error("prompt is required");

    const parts = [{ text: args.prompt }];
    if (name === "edit_image") {
      if (!Array.isArray(args.images) || !args.images.length) throw new Error("images is required");
      for (const src of args.images) parts.push({ inline_data: await loadImage(src) });
    }

    const model = MODELS[args.model] || env.DEFAULT_MODEL || MODELS["nano-banana-2"];
    const imageConfig = {};
    if (args.aspect_ratio) imageConfig.aspectRatio = args.aspect_ratio;
    if (args.image_size && model !== MODELS["nano-banana"]) imageConfig.imageSize = args.image_size;

    const res = await fetch(`${GEMINI_URL}/${model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${data?.error?.message || "request failed"}`);

    const content = [];
    for (const p of data?.candidates?.[0]?.content?.parts || []) {
      const img = p.inlineData || p.inline_data;
      if (img?.data && !p.thought) {
        content.push({ type: "image", data: img.data, mimeType: img.mimeType || img.mime_type || "image/png" });
      } else if (p.text && !p.thought) {
        content.push({ type: "text", text: p.text });
      }
    }
    if (!content.some((c) => c.type === "image")) {
      const reason = data?.candidates?.[0]?.finishReason || data?.promptFeedback?.blockReason || "no image returned";
      return { isError: true, content: [...content, { type: "text", text: `Модель не вернула картинку (${reason}).` }] };
    }
    content.push({ type: "text", text: `Модель: ${model}` });
    return { content };
  } catch (e) {
    return { isError: true, content: [{ type: "text", text: String(e.message || e) }] };
  }
}

async function loadImage(src) {
  const m = /^data:(image\/[\w.+-]+);base64,(.+)$/s.exec(src);
  if (m) return { mime_type: m[1], data: m[2] };
  if (!/^https?:\/\//.test(src)) return { mime_type: "image/png", data: src }; // голый base64

  const res = await fetch(src);
  if (!res.ok) throw new Error(`Не удалось скачать ${src}: ${res.status}`);
  const mime = (res.headers.get("content-type") || "image/png").split(";")[0];
  const bytes = new Uint8Array(await res.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { mime_type: mime, data: btoa(bin) };
}

const rpcResult = (id, result) => ({ jsonrpc: "2.0", id, result });
const rpcError = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });
const cors = () => ({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, mcp-protocol-version, mcp-session-id, authorization",
});
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", ...cors() } });

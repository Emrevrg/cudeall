// Cude Desktop — model konusma katmani (BYOK: anahtar kasada, deger asla loglanmaz).
// OpenAI-uyumlu tek yol (openrouter/openai/deepseek/groq/cerebras/mistral/gemini)
// + Anthropic yolu. Ajan dongusu: model -> cude araci -> model (max 6 adim).
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const OPENAI_COMPAT = {
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
  openai: "https://api.openai.com/v1/chat/completions",
  deepseek: "https://api.deepseek.com/chat/completions",
  groq: "https://api.groq.com/openai/v1/chat/completions",
  cerebras: "https://api.cerebras.ai/v1/chat/completions",
  mistral: "https://api.mistral.ai/v1/chat/completions",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
};
const KEY_ENV = {
  openrouter: "OPENROUTER_API_KEY", openai: "OPENAI_API_KEY", deepseek: "DEEPSEEK_API_KEY",
  groq: "GROQ_API_KEY", cerebras: "CEREBRAS_API_KEY", mistral: "MISTRAL_API_KEY",
  gemini: "GEMINI_API_KEY", anthropic: "ANTHROPIC_API_KEY",
};

function vaultPath() {
  const cands = [
    process.env.APPDATA ? path.join(process.env.APPDATA, "CudeAll", "providers.json") : null,
    path.join(require("node:os").homedir(), ".config", "cudeall", "providers.json"),
  ].filter(Boolean);
  return cands.find((f) => { try { return fs.existsSync(f); } catch { return false; } }) || null;
}

function dpapiUnprotect(b64) {
  return new Promise((resolve, reject) => {
    const ps = `Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String($env:CUDEALL_SECRET); [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))`;
    execFile("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps],
      { timeout: 15000, env: Object.assign({}, process.env, { CUDEALL_SECRET: b64 }) },
      (err, stdout, stderr) => err ? reject(new Error(stderr || err.message)) : resolve(String(stdout).trim()));
  });
}

async function getKey(provider) {
  const envName = KEY_ENV[provider];
  if (envName && process.env[envName]) return process.env[envName];
  const vf = vaultPath();
  if (!vf) return null;
  try {
    const v = JSON.parse(fs.readFileSync(vf, "utf8"));
    const hit = v.items && v.items[provider];
    if (!hit || !hit.protected) return null;
    return await dpapiUnprotect(hit.protected);
  } catch { return null; }
}

async function chatOnce({ provider, model, messages, maxTokens = 2000 }) {
  const key = await getKey(provider);
  if (!key) throw new Error(`Anahtar yok: ${provider}. Ayarlar'dan ekle (kasaya yazilir, sohbete girmez).`);
  if (provider === "anthropic") {
    const sys = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
    const body = { model, max_tokens: maxTokens, system: sys || undefined, messages: messages.filter((m) => m.role !== "system") };
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(120000),
    });
    if (!r.ok) throw new Error(`anthropic HTTP ${r.status}`);
    const j = await r.json();
    return (j.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
  }
  const url = OPENAI_COMPAT[provider];
  if (!url) throw new Error("Bilinmeyen saglayici: " + provider);
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens }),
    signal: AbortSignal.timeout(120000),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`${provider} HTTP ${r.status}: ${t.slice(0, 200)}`);
  }
  const j = await r.json();
  return (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "";
}

// Ajan araclari (MCP'ye birebir karsilik; model function-calling ile cagirir).
// Omurga araclari (project/task/spine) one cikar: ajan once baglami ve kalici
// is kaydini gorur, sonra web/computer araclarina gecer.
function agentTools(mcpCall, workspace) {
  const dir = workspace ? { dir: workspace } : {};
  const defs = [
    { name: "project_context", desc: "Secili projenin baglamini oku (stack, komutlar, talimatlar, aktif gorevler)", args: { maxChars: "string" }, run: (a) => mcpCall("cude_spine", { action: "context", ...dir, maxChars: Number(a.maxChars) || 12000 }) },
    { name: "task", desc: "Kalici gorev kaydi: action=list|read|start|update|plan|decision|handoff", args: { action: "string", id: "string", text: "string" }, run: (a) => {
      const args = { action: a.action || "list", ...dir };
      if (a.id) args.id = a.id;
      if (a.action === "start" && a.text) args.objective = a.text;
      if (a.action === "update") { args.id = a.id; args.note = a.text; }
      if (a.action === "decision") { args.id = a.id; args.decision = a.text; }
      if (a.action === "handoff") { args.id = a.id; args.target = a.text; }
      return mcpCall("cude_task", args);
    } },
    { name: "evidence", desc: "Dogrulama kaniti yaz: label + calistirilan komut + cikis kodu", args: { label: "string", command: "string" }, run: (a) => mcpCall("cude_spine", { action: "evidence", label: a.label, command: a.command, ...dir }) },
    { name: "web_search", desc: "Web'de arastir", args: { query: "string" }, run: (a) => mcpCall("cude_web_search", { query: a.query, count: 5 }) },
    { name: "web_fetch", desc: "Sayfa metnini cek", args: { url: "string" }, run: (a) => mcpCall("cude_web_fetch", { url: a.url, maxChars: 6000 }) },
    { name: "remember", desc: "Hafizaya yaz", args: { key: "string", value: "string" }, run: (a) => mcpCall("cude_memory", { action: "write", key: a.key, value: a.value }) },
    { name: "recall", desc: "Hafizadan oku", args: { key: "string" }, run: (a) => mcpCall("cude_memory", { action: "read", key: a.key }) },
    { name: "screenshot", desc: "Ekran goruntusu al (yolu doner)", args: {}, run: () => mcpCall("cude_computer", { action: "screenshot" }) },
  ];
  const openaiTools = defs.map((d) => ({
    type: "function",
    function: { name: d.name, description: d.desc, parameters: { type: "object", properties: Object.fromEntries(Object.entries(d.args).map(([k, t]) => [k, { type: t }])), required: Object.keys(d.args) } },
  }));
  return { defs, openaiTools };
}

async function agentRun({ provider, model, task, mcpCall, onStep, workspace }) {
  const key = await getKey(provider);
  if (!key) throw new Error(`Anahtar yok: ${provider}. Ayarlar'dan ekle.`);
  const { defs, openaiTools } = agentTools(mcpCall, workspace);
  const url = OPENAI_COMPAT[provider];
  if (!url || provider === "anthropic") throw new Error("Ajan dongusu su an OpenAI-uyumlu saglayicilarda (openrouter/openai/deepseek/groq/cerebras/mistral/gemini).");
  const spineCtx = await mcpCall("cude_spine", { action: "snapshot", ...(workspace ? { dir: workspace } : {}) })
    .then((r) => ((r.content || []).map((x) => x.text || "").join("\n") || "").trim())
    .catch(() => "");
  const messages = [
    { role: "system", content: "Kisa, somut Turkce cevaplar ver. Gerekirse araclari kullan (en fazla 8 adim), sonra sonucu ozetle. Kod ise once project_context ile proje baglamini, sonra task ile kalici is kaydini oku; is bitince evidence araciyla kanit yaz. Iddia ettigin her seyi dogrulamis ol."
      + (spineCtx ? `\n\nPaylasilan kayit (CudeAll omurgasi):\n${spineCtx}` : "") },
    { role: "user", content: task },
  ];
  const log = [];
  for (let i = 0; i < 6; i++) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
      body: JSON.stringify({ model, messages, tools: openaiTools, tool_choice: "auto", max_tokens: 2000 }),
      signal: AbortSignal.timeout(120000),
    });
    if (!r.ok) throw new Error(`${provider} HTTP ${r.status}`);
    const j = await r.json();
    const msg = j.choices[0].message;
    messages.push(msg);
    const calls = msg.tool_calls || [];
    if (!calls.length) {
      log.push({ step: i + 1, type: "cevap", text: msg.content });
      if (onStep) onStep(log[log.length - 1]);
      return { cevap: msg.content, adimlar: log };
    }
    for (const c of calls) {
      const d = defs.find((x) => x.name === (c.function && c.function.name));
      let out = "bilinmeyen arac";
      try {
        const a = JSON.parse(c.function.arguments || "{}");
        const res = await d.run(a);
        out = ((res.content || []).map((x) => x.text).join("\n") || "").slice(0, 4000);
      } catch (e) { out = "HATA: " + (e.message || e); }
      messages.push({ role: "tool", tool_call_id: c.id, content: out });
      log.push({ step: i + 1, type: "arac", text: `${c.function.name}: ${out.slice(0, 300)}` });
      if (onStep) onStep(log[log.length - 1]);
    }
  }
    return { cevap: "Adim limiti doldu; ara sonuclar yukarida. Kanit yazmadan 'bitti' deme.", adimlar: log };
}

module.exports = { chatOnce, agentRun, getKey };

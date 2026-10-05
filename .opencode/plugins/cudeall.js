// cudeall PLUGIN — TEK PLUGIN: populer cozumlerin birlesimi + Codex/Claude parity
// Topladigi fikirler: opencode-tavily/firecrawl (web), oh-my-opencode (claude uyumu),
// opencode-notify/notificator (bildirim), supermemory/session-memory (hafiza),
// goal-plugin (hedef takibi), dynamic-context-pruning (baglam budama), env-protection,
// shell-strategy (asili komut korumasi).
// Not: @opencode-ai/plugin yoksa bile dosya yuklenir; tool() bulunamazsa hook'larla devam eder.

let toolHelper = null;
const { fetchPublicHttp, readLimitedText } = await import("../lib/network-policy.mjs");
const { activeTaskContext, updateTask } = await import("../lib/project-spine.mjs");
const spine = await import("../lib/spine.mjs");
try {
  // eslint-disable-next-line
  const mod = await import("@opencode-ai/plugin").catch(() => null);
  toolHelper = mod?.tool || null;
} catch { toolHelper = null; }

function fallbackTool(def) {
  // opencode tool() yoksa da calisabilecek duz tanim
  return def;
}
const T = toolHelper || fallbackTool;
const schema = toolHelper?.schema || {
  string: () => ({ __t: "string" }),
  number: () => ({ __t: "number" }),
  boolean: () => ({ __t: "boolean" }),
  array: () => ({ __t: "array" }),
};

async function notifyWindows(title, msg) {
  // opencode-notify/notificator fikri: Windows toast (BurntToast yoksa balon fallback)
  try {
    const { execFile } = await import("node:child_process");
    const ps = `[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] | Out-Null; $t=[Windows.UI.Notifications.ToastTemplateType]::ToastText02; $x=[Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent($t); $x.GetElementsByTagName('text')[0].AppendChild($x.CreateTextNode('${String(title).slice(0, 80).replace(/'/g, "")}'))|Out-Null; $x.GetElementsByTagName('text')[1].AppendChild($x.CreateTextNode('${String(msg).slice(0, 120).replace(/'/g, "")}'))|Out-Null; $n=[Windows.UI.Notifications.ToastNotification]::new($x); [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('cudeall').Show($n);`;
    await new Promise((res) => execFile("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps], () => res()));
  } catch {}
}

async function fetchText(url, max = 12000) {
  const r = await fetchPublicHttp(url, { headers: { "User-Agent": "Mozilla/5.0 cudeall/0.1" }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} — ${url}`);
  const { text: html, truncated } = await readLimitedText(r);
  const t = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return `# ${url}\n\n${t.slice(0, max)}${truncated ? "\n\n[yanit boyut sinirinda kesildi]" : ""}`;
}

async function ddg(query, count = 6) {
  if (process.env.TAVILY_API_KEY) {
    const r = await fetch("https://api.tavily.com/search", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: process.env.TAVILY_API_KEY, query, max_results: count, include_answer: true }),
      signal: AbortSignal.timeout(20000),
    });
    const j = await r.json();
    return `${j.answer ? "OZET: " + j.answer + "\n\n" : ""}${(j.results || []).map((x, i) => `${i + 1}. ${x.title}\n   ${x.url}`).join("\n")}`;
  }
  const r = await fetch(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`, {
    headers: { "User-Agent": "Mozilla/5.0 cudeall/0.1" }, signal: AbortSignal.timeout(20000),
  });
  const html = await r.text();
  const out = [];
  const re = /<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) && out.length < count) {
    let href = m[1].trim().replace(/&amp;/g, "&");
    const label = m[2].replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").trim();
    if (!label) continue;
    const ud = href.match(/[?&]uddg=([^&]+)/);
    if (ud) { try { href = decodeURIComponent(ud[1]); } catch {} }
    if (href.startsWith("//")) href = "https:" + href;
    if (!/^https?:\/\//.test(href) || href.includes("duckduckgo") || !label) continue;
    out.push(`${out.length + 1}. ${label.slice(0, 140)}\n   ${href}`);
  }
  return out.join("\n") || "Sonuc yok. TAVILY_API_KEY eklemeyi dusun.";
}

export const CudeAllPlugin = async ({ project, client, $, directory, worktree }) => {
  try { await client?.app?.log?.({ body: { service: "cudeall", level: "info", message: "cudeall aktif" } }); } catch {}

  return {
    // ---- TEK PLUGIN icindeki 4 hafif arac (MCP kapaliyken bile calisir) ----
    tool: {
      cude_search: T({
        description: "Web'de arastir (Tavily varsa anahtarli, yoksa anahtarsiz). Kod hatasi, dokuman, kutuphane karsilastirmasi icin.",
        args: { query: schema.string?.() },
        async execute(args) { return await ddg(String(args.query || "")); },
      }),
      cude_fetch: T({
        description: "URL'nin temiz metnini cek.",
        args: { url: schema.string?.() },
        async execute(args) { return await fetchText(String(args.url || "")); },
      }),
      cude_remember: T({
        description: "Kisa hafiza yaz/oku (.opencode/cudeall-memory.json). Karar, tercih, hata cozumu sakla.",
        args: { op: schema.string?.(), key: schema.string?.(), value: schema.string?.() },
        async execute(args) {
          const { readFileSync, writeFileSync, existsSync, mkdirSync } = await import("node:fs");
          const { join } = await import("node:path");
          const base = worktree || directory || process.cwd();
          const dir = join(base, ".opencode");
          if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
          const f = join(dir, "cudeall-memory.json");
          let m = {};
          try { if (existsSync(f)) m = JSON.parse(readFileSync(f, "utf8")); } catch {}
          const op = String(args.op || "list");
          if (op === "write") { m[String(args.key)] = { value: String(args.value || ""), at: new Date().toISOString() }; writeFileSync(f, JSON.stringify(m, null, 2)); return `Hatirlaniyor: ${args.key}`; }
          if (op === "read") return m[String(args.key)] ? `${args.key}\n${m[String(args.key)].value}` : `Yok: ${args.key}`;
          return Object.keys(m).map((k) => `- ${k}: ${String(m[k].value).slice(0, 120)}`).join("\n") || "Hafiza bos.";
        },
      }),
      cude_goal: T({
        description: "Oturum hedefini sabitle (goal-plugin fikri): hedefi hatirla, her cevapta o hedefe bagla.",
        args: { hedef: schema.string?.() },
        async execute(args) {
          const { readFileSync, writeFileSync, existsSync, mkdirSync } = await import("node:fs");
          const { join } = await import("node:path");
          const base = worktree || directory || process.cwd();
          const dir = join(base, ".opencode");
          if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
          const f = join(dir, "cudeall-goal.md");
          if (args.hedef) { writeFileSync(f, `# Oturum hedefi\n\n${args.hedef}\n`, "utf8"); return `Hedef sabitlendi: ${args.hedef}`; }
          if (existsSync(f)) return readFileSync(f, "utf8");
          return "Hedef yok. Ornek: cude_goal(hedef='...')";
        },
      }),
      // Omurganin MCP'siz yolu: MCP kapaliyken de proje baglami + arac kesfi calisir.
      cude_spine: T({
        description: "OMURGA (MCP'siz yedek): action=status|context|capabilities|adapters|evidence|kanitlar|handoffs|claim. Proje baglami, arac kesfi, kanit ve devir kuyrugu.",
        args: {
          action: schema.string?.(), dir: schema.string?.(), target: schema.string?.(),
          mode: schema.string?.(), label: schema.string?.(), command: schema.string?.(),
          exitCode: schema.number?.(), output: schema.string?.(), taskId: schema.string?.(),
          agent: schema.string?.(), id: schema.string?.(), limit: schema.number?.(), maxChars: schema.number?.(),
        },
        async execute(args) {
          const base = args.dir || worktree || directory || process.cwd();
          const action = String(args.action || "status").toLowerCase();
          if (action === "context") return spine.writeContext(base, { maxChars: args.maxChars }).text;
          if (action === "capabilities" || action === "status") {
            const c = spine.capabilities(base);
            if (action === "status") {
              const pending = c.spine.root;
              return `CUDEALL OMRUGA\n- kok: ${c.project}\n- omurga: ${pending}\n- opencode plugin/skill: ${c.opencode.plugin ? "var" : "yok"}/${c.opencode.skill ? "var" : "yok"}\n- codex MCP: ${c.codex.mcp ? "var" : "yok"} | claude MCP: ${c.claude.mcp ? "var" : "yok"}\n- adapterlar: ${Object.keys(c.spine.adapters).join(", ") || "(yok)"}\n- araclar (${c.mcpTools.length}): ${c.mcpTools.join(", ")}\n\nTam kesif: action=capabilities`;
            }
            return JSON.stringify({ opencode: c.opencode, codex: c.codex, claude: c.claude, desktop: c.desktop, commands: c.opencode.commands, mcpTools: c.mcpTools }, null, 2);
          }
          if (action === "adapters") return JSON.stringify(spine.syncAdapters(base, { only: args.target, write: String(args.mode || "") !== "dry" }), null, 1);
          if (action === "evidence") {
            const taskId = args.taskId ? String(args.taskId) : "";
            if (taskId) await updateTask(base, { action: "status", id: taskId });
            const entry = spine.addEvidence(base, args);
            if (taskId) {
              const line = `[kanit ${entry.id}] ${entry.label}${entry.command ? " — " + entry.command : ""}${entry.exitCode === null ? "" : " (exit=" + entry.exitCode + ")"}`;
              await updateTask(base, { action: "update", id: taskId, note: line, verification: line });
            }
            return JSON.stringify(entry, null, 1);
          }
          if (action === "kanitlar") return JSON.stringify(spine.readEvidence(base, args.limit || 20).reverse(), null, 1);
          if (action === "handoffs") return JSON.stringify(spine.handoffInbox(base), null, 1);
          if (action === "claim") return spine.claimHandoff(base, { id: args.id, agent: args.agent, note: args.output });
          if (action === "snapshot") return spine.snapshot(base, args.maxChars) || "(omurga bos)";
          throw new Error("cude_spine action status|context|capabilities|adapters|evidence|kanitlar|handoffs|claim|snapshot");
        },
      }),
    },

    // ---- Her yeni kullanici mesajinda omurga onizlemesi (oturum basina bir kez) ----
    "chat.message": async (input, output) => {
      try {
        const base = worktree || directory || process.cwd();
        // surec basina paylasilan surec, oturum basina isaret: her oturum omurgayi gorur,
        // ama ayni oturumda mesaj basina tekrar tekrar enjekte edilmez.
        const seen = (globalThis.__cudeallSpineSessions ||= new Set());
        const key = `${base}\0${input?.sessionID || "default"}`;
        if (seen.has(key)) return;
        const text = spine.snapshot(base, 1400);
        if (!text) return;
        seen.add(key);
        if (seen.size > 50) seen.delete(seen.values().next().value);
        output.parts.push({ type: "text", text: "## CudeAll omurga (paylasilan kayit)\n" + text });
      } catch {}
    },

    // ---- HOOKS: populer pluginlerin ozet davranislari ----
    "tool.execute.before": async (input, output) => {
      const tool = input.tool || "";
      const args = output.args || {};
      // 1) env-protection: .env'yi okutma
      if (tool === "read" && String(args.filePath || "").includes(".env")) {
        throw new Error("cudeall: .env dosyalari okunmaz (guvenlik). .env.example kullan.");
      }
      // 2) shell-strategy: asilabilecek interaktif komutlari engelle
      if (tool === "bash") {
        const cmd = String(args.command || "");
        if (/\b(ssh|telnet|ftp|python(\.exe)?(\s|$)|node(\.exe)?(\s|$).*--inspect|ngrok|cloudflared)\b/i.test(cmd) && !/kill|taskkill/i.test(cmd)) {
          // sadece uyari notu birak, engelleme (akisi bozma)
          try { await client?.app?.log?.({ body: { service: "cudeall", level: "warn", message: "interaktif komut riski: " + cmd.slice(0, 120) } }); } catch {}
        }
        // 3) vibeguard-lite: komuttaki olasi sirri loglama disi birak uyarisi
        if (/(sk-ant-|ghp_|xox[bap]-|AKIA|AIza|-----BEGIN .*PRIVATE KEY)/.test(cmd)) {
          throw new Error("cudeall: komutta acik secret gorunuyor. Env degiskeni kullan (or: $env:KEY).");
        }
      }
    },

    "shell.env": async (input, output) => {
      output.env.CUDEALL_ACTIVE = "1";
      output.env.CUDEALL_HOME = worktree || directory || process.cwd();
      // Saglayici kasasi -> opencode'a OTOMATIK enjeksiyon (kullanici hicbir sey yapmaz).
      // Kasa DPAPI sifrelidir; cozum sadece bu Windows kullanicisinda calisir.
      // Hizli yol: kasa mtime'i degismediyse onbellekten ver (her cagrida powershell acma).
      try {
        const { readFileSync, existsSync, statSync } = await import("node:fs");
        const { join } = await import("node:path");
        const base = worktree || directory || process.cwd();
        const providerDir = process.env.APPDATA
          ? join(process.env.APPDATA, "CudeAll")
          : join((await import("node:os")).homedir(), ".config", "cudeall");
        const vf = join(providerDir, "providers.json");
        if (!existsSync(vf)) return;
        const mt = statSync(vf).mtimeMs;
        if (globalThis.__cudeVaultMt === mt && globalThis.__cudeVaultEnv) {
          Object.assign(output.env, globalThis.__cudeVaultEnv);
          return;
        }
        const vault = JSON.parse(readFileSync(vf, "utf8"));
        const MAP = { openrouter: ["OPENROUTER_API_KEY"], gemini: ["GEMINI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"], groq: ["GROQ_API_KEY"], cerebras: ["CEREBRAS_API_KEY"], mistral: ["MISTRAL_API_KEY"], deepseek: ["DEEPSEEK_API_KEY"], openai: ["OPENAI_API_KEY"], anthropic: ["ANTHROPIC_API_KEY"], tavily: ["TAVILY_API_KEY"], brave: ["BRAVE_API_KEY"] };
        const { execFile } = await import("node:child_process");
        const injected = {};
        for (const [p, envs] of Object.entries(MAP)) {
          const hit = vault.items && vault.items[p];
          if (!hit || !hit.protected) continue;
          const already = envs.some((e) => output.env[e] || process.env[e]);
          if (already) continue; // kullanicinin degeri oncelikli, ezme
          const val = await new Promise((res) => {
            const ps = `Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String('${String(hit.protected).replace(/'/g, "")}'); [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))`;
            execFile("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps], { timeout: 15000 }, (err, stdout) => res(err ? "" : String(stdout).trim()));
          });
          if (val) for (const e of envs) { output.env[e] = val; injected[e] = 1; }
        }
        globalThis.__cudeVaultMt = mt;
        globalThis.__cudeVaultEnv = injected;
      } catch {}
    },

    "session.idle": async (input, output) => {
      // notify/notificator fikri: uzun is bitince Windows bildirimi
      try { await notifyWindows("cudeall", "Oturum bosladi — sonuc hazir olabilir."); } catch {}
    },

    "experimental.session.compacting": async (input, output) => {
      // supermemory + goal + omurga fikri: ozete hedef + hafiza + aktif gorev + devir enjekte et
      try {
        const { readFileSync, existsSync } = await import("node:fs");
        const { join } = await import("node:path");
        const base = worktree || directory || process.cwd();
        const goal = join(base, ".opencode", "cudeall-goal.md");
        const mem = join(base, ".opencode", "cudeall-memory.json");
        if (existsSync(goal)) output.context.push("## Oturum hedefi (koru)\n" + readFileSync(goal, "utf8").slice(0, 1500));
        if (existsSync(mem)) {
          const m = JSON.parse(readFileSync(mem, "utf8"));
          const keys = Object.keys(m).slice(-12);
          if (keys.length) output.context.push("## CudeAll hafiza (koru)\n" + keys.map((k) => `- ${k}: ${String(m[k].value || "").slice(0, 160)}`).join("\n"));
        }
        const tasks = activeTaskContext(base, 6500);
        if (tasks) output.context.push("## Aktif CudeAll proje gorevleri (koru; tamamlandi deme, kaydi oku)\n" + tasks);
        const pending = spine.handoffInbox(base).filter((h) => !h.claimed);
        if (pending.length) {
          output.context.push("## Bekleyen devirler (koru)\n" + pending.map((h) => `- ${h.id} -> ${h.target}: ${h.next || "(sonraki adim yazilmamis)"}`).join("\n"));
        }
        const kanit = spine.readEvidence(base, 8);
        if (kanit.length) {
          output.context.push("## Son kanitlar (koru; dogrulanmis isler)\n" + kanit.slice(-8).map((e) => `- ${e.at} ${e.label}${e.exitCode === null ? "" : " (exit=" + e.exitCode + ")"}${e.taskId ? " [" + e.taskId + "]" : ""}`).join("\n"));
        }
      } catch {}
    },
  };
};

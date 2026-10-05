// Cude Desktop — arayuz: 4 mod + onayli router + sekmeler.
const $ = (s) => document.querySelector(s);
const state = { mode: "chat", tabs: [{ id: 1, title: "Yeni oturum", hist: [] }], tab: 1, cwd: null, settings: {}, idePath: null, editor: null, term: null };

function curTab() { return state.tabs.find((t) => t.id === state.tab); }
function say(msg, cls = "") {
  const d = document.createElement("div");
  d.className = "msg " + cls;
  d.textContent = msg;
  $("#chatLog").appendChild(d);
  $("#chatLog").scrollTop = 1e9;
  const t = curTab();
  if (t) { t.view = t.view || []; t.view.push([msg, cls]); }
}
function agentSay(msg, cls = "") {
  const d = document.createElement("div");
  d.className = "msg " + cls;
  d.textContent = msg;
  $("#agentLog").appendChild(d);
  $("#agentLog").scrollTop = 1e9;
}
function status(t) { $("#stMsg").textContent = t; }
function mcpText(result) {
  const value = result?.data;
  if (typeof value === "string") return value;
  if (Array.isArray(value?.content)) return value.content.map((part) => part.text || "").join("\n");
  return value ? JSON.stringify(value) : "(bos)";
}

async function projectContext() {
  if (!state.cwd) return "";
  const r = await window.cude.mcpCall("cude_project", { action: "context", dir: state.cwd });
  return r.ok ? mcpText(r).slice(0, 9000) : "Project context alinamadi: " + r.error;
}

function setMode(m) {
  state.mode = m;
  document.querySelectorAll("#sidebar button[data-mode]").forEach((b) => b.classList.toggle("active", b.dataset.mode === m));
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + m));
  $("#stMode").textContent = m;
  if (m === "ide") initEditor();
  if (m === "computer" && !$("#compImg").src) takeShot();
}

// Router: oner + ONAY (ayar oto ise direkt gec)
async function maybeRoute(text) {
  try {
    const r = await window.cude.route(text, state.mode);
    if (!r.ok) return;
    const { mode, auto, neden } = r.data;
    if (mode === state.mode) return;
    if (state.settings.autoMode || auto) { setMode(mode); return; }
    $("#rmTitle").textContent = `"${mode}" moduna geçilsin mi?`;
    $("#rmWhy").textContent = "Neden: " + neden;
    $("#routerModal").classList.remove("hidden");
    $("#rmYes").onclick = () => { $("#routerModal").classList.add("hidden"); setMode(mode); };
    $("#rmNo").onclick = () => $("#routerModal").classList.add("hidden");
  } catch {}
}

async function sendChat() {
  const inp = $("#chatIn"), text = inp.value.trim();
  if (!text) return;
  inp.value = "";
  say(text, "me");
  // Hizli komutlar: tum CudeAll araclari uygulamanin icinden
  if (text.startsWith("/")) {
    const [cmd, ...rest] = text.slice(1).split(" ");
    const arg = rest.join(" ");
    status("calisiyor…");
    try {
      if (cmd === "status") {
        const r = await window.cude.mcpCall("cude_setup", { action: "status" });
        say(r.ok ? mcpText(r) : "HATA: " + r.error, "sys");
      } else if (cmd === "spine") {
        const sub = (arg.trim().split(/\s+/)[0] || "status").toLowerCase();
        const r = await window.cude.mcpCall("cude_spine", { action: sub, dir: state.cwd || undefined });
        say(r.ok ? mcpText(r) : "HATA: " + r.error, "sys");
      } else if (cmd === "evidence") {
        const label = arg.trim();
        if (!label) { say("Kullanim: /evidence <ne dogrulandi>", "sys"); return; }
        const r = await window.cude.mcpCall("cude_spine", { action: "evidence", label, dir: state.cwd || undefined });
        say(r.ok ? mcpText(r) : "HATA: " + r.error, "sys");
      } else if (cmd === "project") {
        say(state.cwd ? await projectContext() : "Once Proje klasoru sec dugmesiyle bir workspace sec.", "sys");
      } else if (cmd === "task") {
        const parts = arg.trim().split(/\s+/);
        const action = parts[0] || "list";
        let args = { action, dir: state.cwd || undefined };
        if (action === "start") args.objective = arg.trim().slice("start".length).trim();
        else if (action === "read" || action === "status") args.id = parts[1];
        else if (action === "update") { args.id = parts[1]; args.note = parts.slice(2).join(" "); }
        else if (action === "plan") { args.id = parts[1]; args.operation = parts[2] || "append"; args.steps = parts.slice(3).join(" ").split("|").map((step) => step.trim()).filter(Boolean); }
        else if (action === "decision") { args.id = parts[1]; args.decision = parts.slice(2).join(" "); }
        else if (action === "handoff") { args.id = parts[1]; args.target = parts[2]; args.next = parts.slice(3).join(" "); }
        else if (action === "complete") { args.id = parts[1]; args.status = "complete"; args.verification = parts.slice(2).join(" "); }
        else if (action !== "list") { say("Kullanim: /task start <hedef> | list | status <id> | update <id> <not> | plan <id> append|replace <adim> | <adim> | decision <id> <karar> | handoff <id> <ajan> <sonraki adim> | complete <id> <dogrulama>", "sys"); return; }
        const r = await window.cude.mcpCall("cude_task", args);
        say(r.ok ? mcpText(r) : "HATA: " + r.error, "sys");
      } else if (cmd === "continue") {
        if (!state.cwd) { say("Devam etmek icin once proje klasoru sec; boylece baska projelerin kayitlari acilmaz.", "sys"); return; }
        // Once bekleyen devir: varsa devral, yoksa en guncel acik gorevden devam et.
        const handoffs = await window.cude.mcpCall("cude_spine", { action: "handoffs", dir: state.cwd });
        const queue = handoffs.ok ? [...mcpText(handoffs).matchAll(/^-\s+(t-[a-z0-9-]+)\s+->\s+(\S+)\s+\[(\w+)\]\s+(BEKLIYOR|ALINDI\S*)/gmi)] : [];
        const waiting = queue.find((q) => /BEKLIYOR/.test(q[4]));
        if (waiting) {
          const claim = await window.cude.mcpCall("cude_spine", { action: "claim", id: waiting[1], agent: "cude-desktop", dir: state.cwd });
          say((claim.ok ? "Devir alindi:\n" + mcpText(claim) : "HATA: " + claim.error) + "\n" + mcpText(handoffs).slice(0, 1200), "sys");
          return;
        }
        const r = await window.cude.mcpCall("cude_task", { action: "list", dir: state.cwd });
        if (!r.ok) { say("HATA: " + r.error, "sys"); return; }
        const tasks = mcpText(r);
        const active = [...tasks.matchAll(/^-\s+(t-[a-z0-9-]+)\s+\[(active|blocked)\]/gmi)];
        if (!active.length) say("Secili projede acik CudeAll gorevi ve bekleyen devir yok. /task start ile yeni gorev acabilirsin.", "sys");
        else {
          const detail = await window.cude.mcpCall("cude_task", { action: "read", id: active[0][1], dir: state.cwd });
          say(detail.ok ? "Secili projedeki en guncel acik gorev:\n" + mcpText(detail).slice(0, 3500) : "HATA: " + detail.error, "sys");
        }
      } else if (cmd === "test") {
        say("QA kosuyor (plan+run)…", "sys");
        const r = await window.cude.mcpCall("cude_qa", { action: "run", suite: "unit+sec" });
        say(r.ok ? mcpText(r).slice(0, 3000) : "HATA: " + r.error, "sys");
      } else if (cmd === "review") {
        const r = await window.cude.mcpCall("cude_qa", { action: "run", suite: "sec" });
        say(r.ok ? mcpText(r).slice(0, 3000) : "HATA: " + r.error, "sys");
      } else if (cmd === "search") {
        const r = await window.cude.mcpCall("cude_web_search", { query: arg, count: 5 });
        say(r.ok ? mcpText(r).slice(0, 2500) : "HATA: " + r.error, "sys");
      } else say("Komutlar: /project /spine status|capabilities|context|adapters|handoffs /evidence <ne dogrulandi> /task start|list|status|update|plan|decision|handoff|complete /status /continue /test /review /search <soru>", "sys");
    } catch (e) { say("HATA: " + e.message, "sys"); }
    status("hazır");
    return;
  }
  maybeRoute(text);
  status("dusunuyor…");
  const hist = state.tabs.find((t) => t.id === state.tab).hist;
  hist.push({ role: "user", content: text });
  const context = await projectContext().catch(() => "");
  const system = "Kisa somut Turkce cevaplar." + (context ? "\n\nSecilen workspace icin CudeAll project context (kaynak: yerel dosya agaci/talimatlari; komutlar calistirilmadi):\n" + context : "");
  const r = await window.cude.chatSend({ messages: [{ role: "system", content: system }, ...hist.slice(-10)] });
  status("hazır");
  if (!r.ok) { say("HATA: " + r.error + "\n(Ayarlar'da saglayici/model sec; anahtar kasaya terminalden eklenir.)", "sys"); return; }
  hist.push({ role: "assistant", content: r.data });
  say(r.data);
}

async function sendAgent() {
  const inp = $("#agentIn"), task = inp.value.trim();
  if (!task) return;
  inp.value = "";
  agentSay(task, "me");
  agentSay("Kosuyor (arac adimlari asagida)…", "sys");
  status("ajan calisiyor…");
  const context = await projectContext().catch(() => "");
  const r = await window.cude.agentRun({ task: context ? task + "\n\nSecilen workspace icin yerel CudeAll project context:\n" + context : task });
  status("hazır");
  if (!r.ok) { agentSay("HATA: " + r.error, "sys"); return; }
  for (const s of r.data.adimlar || []) agentSay((s.type === "arac" ? "🔧 " : "➜ ") + s.text, "sys");
  agentSay(r.data.cevap || "(bos)");
}

// IDE: Monaco zinciri (yerli -> CDN -> duz alan). Hata cikarmaz, kademeli duser.
let monacoTried = false;
async function initEditor() {
  if (state.editor || monacoTried) { state.editor && state.editor.layout(); return; }
  monacoTried = true;
  const load = (src) => new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  try {
    try { await load("../node_modules/monaco-editor/min/vs/loader.js"); }
    catch { await load("https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs/loader.js"); }
    self.MonacoEnvironment = { getWorkerUrl: () => "../node_modules/monaco-editor/min/vs/base/worker/workerMain.js" };
    await new Promise((res, rej) => window.require.config({ paths: { vs: "../node_modules/monaco-editor/min/vs" } }) || res());
    await new Promise((res) => window.require(["vs/editor/editor.main"], res));
    state.editor = monaco.editor.create($("#editor"), { value: "// Dosya ac ya da yazmaya basla\n", language: "javascript", theme: "vs", automaticLayout: true });
  } catch (e) {
    try { await load("https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs/loader.js"); window.require.config({ paths: { vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs" } }); await new Promise((res) => window.require(["vs/editor/editor.main"], res)); state.editor = monaco.editor.create($("#editor"), { value: "", language: "plaintext", automaticLayout: true });
    } catch {
      $("#editor").innerHTML = "<textarea id='plainEd' style='width:100%;height:100%'></textarea>";
      state.editor = { getValue: () => $("#plainEd").value, setValue: (v) => { $("#plainEd").value = v; }, layout: () => {} };
    }
  }
}
$("#ideOpen").onclick = async () => {
  const p = await window.cude.dialogFile();
  if (!p) return;
  const r = await window.cude.fsReadText(p);
  if (!r.ok) { alert(r.error); return; }
  await initEditor();
  state.idePath = p;
  state.editor.setValue(r.data);
  $("#idePath").textContent = p;
};
$("#ideSave").onclick = async () => {
  if (!state.idePath || !state.editor) { alert("Once dosya ac."); return; }
  const r = await window.cude.fsWriteText(state.idePath, state.editor.getValue());
  status(r.ok ? "kaydedildi" : "HATA: " + r.error);
};

// Terminal: xterm zinciri (yerli -> duz cikti). Basit kabuk oldugu yaziyor.
let termReady = false;
async function initTerm() {
  if (termReady) return;
  termReady = true;
  const css = (h) => new Promise((res) => { const l = document.createElement("link"); l.rel = "stylesheet"; l.href = h; l.onload = res; l.onerror = res; document.head.appendChild(l); });
  const js = (s) => new Promise((res, rej) => { const e = document.createElement("script"); e.src = s; e.onload = res; e.onerror = rej; document.head.appendChild(e); });
  try {
    await css("../node_modules/@xterm/xterm/css/xterm.css");
    await js("../node_modules/@xterm/xterm/lib/xterm.js");
    await js("../node_modules/@xterm/addon-fit/lib/addon-fit.js");
    state.term = new Terminal({ fontSize: 13 });
    state.term.open($("#term"));
    state.term.writeln("Cude kabuk (basit) — komut yaz, Enter. ‘klasor’ dugmesiyle dizin sec.");
  } catch { $("#term").innerHTML = "<div style='color:#888;padding:8px'>Terminal yuklenemedi, asagidaki kutuyu kullan.</div>"; }
}
async function runTerm(cmd) {
  const c = (cmd || "").trim();
  if (!c) return;
  if (c === "clear") { state.term && state.term.clear(); return; }
  if (c.startsWith("cd ")) { state.cwd = c.slice(3).trim(); $("#termCwd").textContent = state.cwd; state.term && state.term.writeln("(dizin: " + state.cwd + ")"); return; }
  state.term && state.term.writeln("$ " + c);
  const r = await window.cude.shellRun(c, state.cwd, 60000);
  const out = r.ok ? ((r.data.out || "") + (r.data.err || "")) : r.error;
  state.term && state.term.writeln(String(out).slice(0, 4000) || "(bos)");
}
$("#termGo").onclick = () => { runTerm($("#termIn").value); $("#termIn").value = ""; };
$("#termIn").addEventListener("keydown", (e) => { if (e.key === "Enter") { runTerm(e.target.value); e.target.value = ""; } });

// Bilgisayar: goruntu -> koordinat -> tik/yaz (guvenlik kurali motorda)
async function takeShot() {
  status("goruntu aliniyor…");
  const r = await window.cude.mcpCall("cude_computer", { action: "screenshot" });
  status("hazır");
  if (!r.ok) { $("#compHint").textContent = "HATA: " + r.error; return; }
  const m = /([A-Z]:\\.+\.png)/.exec(r.data || "");
  if (!m) { $("#compHint").textContent = r.data; return; }
  const img = await window.cude.fsReadImage(m[1]);
  if (img.ok) { $("#compImg").src = img.data; $("#compHint").textContent = "Koordinati gir, tikla/yaz."; }
}
$("#compShot").onclick = takeShot;
$("#compClick").onclick = async () => {
  const r = await window.cude.mcpCall("cude_computer", { action: "click", x: +$("#cx").value, y: +$("#cy").value });
  $("#compHint").textContent = r.ok ? r.data : "HATA: " + r.error;
  if (r.ok) takeShot();
};
$("#compType").onclick = async () => {
  const r = await window.cude.mcpCall("cude_computer", { action: "type", text: $("#ctext").value });
  $("#compHint").textContent = r.ok ? r.data : "HATA: " + r.error;
};

// Sekmeler + mod dugmeleri + baslik
function renderTabs() {
  const el = $("#tabs");
  el.innerHTML = "";
  for (const t of state.tabs) {
    const d = document.createElement("div");
    d.className = "tab" + (t.id === state.tab ? " active" : "");
    d.textContent = t.title;
    d.onclick = () => { state.tab = t.id; renderTabs(); $("#chatLog").innerHTML = ""; (t.view || []).forEach(([a, b]) => { const x = document.createElement("div"); x.className = "msg " + b; x.textContent = a; $("#chatLog").appendChild(x); }); };
    el.appendChild(d);
  }
}
$("#tabAdd").onclick = () => { const id = Date.now(); state.tabs.push({ id, title: "Yeni oturum", hist: [] }); state.tab = id; renderTabs(); $("#chatLog").innerHTML = ""; };
document.querySelectorAll("#sidebar button[data-mode]").forEach((b) => b.onclick = () => setMode(b.dataset.mode));
$("#chatGo").onclick = sendChat;
$("#chatFile").onclick = async () => {
  const p = await window.cude.dialogFile();
  if (!p) return;
  say("📎 " + p, "me");
  status("donusturuluyor…");
  const r = await window.cude.mdConvert(p);
  status("hazır");
  say(r.ok ? `[${r.data.engine}] ${r.data.markdown.slice(0, 2500)}` : "HATA: " + r.error, "sys");
};
$("#chatIn").addEventListener("keydown", (e) => { if (e.key === "Enter") sendChat(); });
$("#agentGo").onclick = sendAgent;
$("#agentIn").addEventListener("keydown", (e) => { if (e.key === "Enter") sendAgent(); });
$("#btnMin").onclick = () => window.cude.winMin();
$("#btnMax").onclick = () => window.cude.winMax();
$("#btnClose").onclick = () => window.cude.winClose();

// Ayarlar
async function loadSettings() {
  const r = await window.cude.settingsGet();
  state.settings = r.ok ? r.data : {};
  state.cwd = state.settings.workspaceDir || null;
  if (state.cwd) {
    const selected = await window.cude.workspaceSet(state.cwd);
    if (selected.ok) { state.cwd = selected.data; $("#workspacePath").textContent = state.cwd + " (project context aktif saglayiciya gonderilir)"; }
    else { state.cwd = null; $("#workspacePath").textContent = "Workspace yolu artik kullanilamiyor; yeniden sec."; }
  }
  $("#setProvider").value = state.settings.provider || "openrouter";
  $("#setModel").value = state.settings.model || "";
  $("#setAuto").checked = !!state.settings.autoMode;
  $("#setTray").checked = state.settings.minimizeToTray !== false;
  const p = await window.cude.providersStatus();
  $("#provList").textContent = p.ok ? Object.entries(p.data).filter(([, v]) => v).map(([k]) => k).join(", ") || "hicbiri (kasaya ekle)" : "?";
  const m = await window.cude.mcpList();
  $("#mcpStat").textContent = "MCP: " + (m.ok ? m.data.map((t) => t.name).length + " arac bagli" : "bagli degil (" + (m.error || "") + ")");
}
$("#workspacePick").onclick = async () => {
  const picked = await window.cude.dialogDir();
  if (!picked.ok || !picked.data) return;
  const selected = await window.cude.workspaceSet(picked.data);
  if (!selected.ok) { status("Workspace hatasi: " + selected.error); return; }
  state.cwd = selected.data;
  state.settings.workspaceDir = state.cwd;
  $("#workspacePath").textContent = state.cwd + " (project context aktif saglayiciya gonderilir)";
  await window.cude.settingsSet(state.settings);
  status("Workspace secildi");
};
$("#setSave").onclick = async () => {
  state.settings = Object.assign({}, state.settings, { provider: $("#setProvider").value, model: $("#setModel").value.trim(), autoMode: $("#setAuto").checked, minimizeToTray: $("#setTray").checked });
  await window.cude.settingsSet(state.settings);
  status("ayarlar kaydedildi");
};

renderTabs();
initTerm();
loadSettings();
say("Cude Desktop hazir. 4 mod: sohbet / IDE / ajan / bilgisayar. Yaz, router onersin — gecis sende.", "sys");

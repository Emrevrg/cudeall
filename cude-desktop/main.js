// Cude Desktop — ana surec: pencere, tray, gorev cubugu, IPC -> backend.
const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, shell, nativeImage } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

const SMOKE = process.argv.includes("--cude-smoke");
let win = null, tray = null;
const smokeErrors = [];
if (!app.requestSingleInstanceLock()) app.quit();

function settingsPath() {
  return path.join(app.getPath("userData"), "cude-settings.json");
}
function getSettings() {
  try { return JSON.parse(fs.readFileSync(settingsPath(), "utf8")); }
  catch { return { provider: "openrouter", model: "", autoMode: false, theme: "light" }; }
}
function saveSettings(s) {
  try { fs.writeFileSync(settingsPath(), JSON.stringify(s, null, 1)); return true; }
  catch { return false; }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1366, height: 900, minWidth: 900, minHeight: 600,
    frame: false, // ozel baslik cubugu (ekran goruntusundeki gibi sekmeli)
    backgroundColor: "#f4f5f7",
    show: false,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, webSecurity: false },
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  win.once("ready-to-show", () => { if (!SMOKE) win.show(); else win.showInactive(); });
  win.on("close", (e) => {
    if (SMOKE) return;
    const s = getSettings();
    if (s.minimizeToTray !== false) { e.preventDefault(); win.hide(); } // tepsiye iner, kapanmaz
  });
  if (SMOKE) {
    win.webContents.on("console-message", (e, level, msg) => {
      if (level >= 2 && !String(msg).includes("Electron Security Warning")) smokeErrors.push(msg);
    });
    setTimeout(() => {
      console.log("SMOKE-ERRORS:" + JSON.stringify(smokeErrors.slice(0, 10)));
      app.exit(smokeErrors.length ? 2 : 0);
    }, 6000);
    win.show();
  }
}

function createTray(iconPath) {
  try {
    let img = iconPath && fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : null;
    if (!img || img.isEmpty()) img = nativeImage.createEmpty();
    tray = new Tray(img.resize({ width: 16, height: 16 }));
    tray.setToolTip("Cude Desktop");
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: "Goster", click: () => { win && win.show(); } },
      { label: "Gizle", click: () => { win && win.hide(); } },
      { type: "separator" },
      { label: "Cikis", click: () => { app.exit(0); } },
    ]));
    tray.on("click", () => { if (win) { win.isVisible() ? win.hide() : win.show(); } });
  } catch (e) { console.log("tray atlandi:", e.message); }
}

app.whenReady().then(() => {
  app.setAppUserModelId("cude.desktop"); // Windows gorev cubugu gruplamasi
  const mcp = require("./backend/mcp");
  const savedWorkspace = getSettings().workspaceDir;
  if (savedWorkspace) mcp.setWorkspace(savedWorkspace).catch(() => {});
  const router = require("./backend/router");
  const md = require("./backend/markitdown");
  const shellx = require("./backend/shell");
  const chat = require("./backend/chat");

  const iconPng = path.join(__dirname, "assets", "icon.png");
  createWindow();
  createTray(iconPng);

  const H = (ch, fn) => ipcMain.handle(ch, async (e, a) => { try { return { ok: true, data: await fn(a || {}) }; } catch (err) { return { ok: false, error: err.message || String(err) }; } });

  H("mcp-list", () => mcp.list());
  H("mcp-call", (a) => mcp.call(a.name, a.args || {}));
  H("workspace-set", async (a) => {
    const workspaceDir = await mcp.setWorkspace(a.path);
    const settings = getSettings();
    saveSettings(Object.assign(settings, { workspaceDir }));
    return workspaceDir;
  });
  H("router-route", (a) => router.route(a.text, a.cur));
  H("md-convert", (a) => md.convert(a.path));
  H("shell-run", (a) => shellx.run(a.cmd, a.cwd, a.timeoutMs));
  H("chat-send", (a) => {
    const s = getSettings();
    return chat.chatOnce({ provider: a.provider || s.provider, model: a.model || s.model, messages: a.messages });
  });
  H("agent-run", (a) => {
    const s = getSettings();
    return chat.agentRun({
      provider: a.provider || s.provider, model: a.model || s.model, task: a.task,
      workspace: s.workspaceDir || null,
      mcpCall: (n, ar) => mcp.call(n, ar).then((r) => r),
    });
  });
  H("spine-status", () => mcp.call("cude_spine", { action: "status", dir: getSettings().workspaceDir || undefined }));
  H("spine-capabilities", () => mcp.call("cude_spine", { action: "capabilities", dir: getSettings().workspaceDir || undefined }));
  H("providers-status", async () => {
    const names = ["openrouter", "gemini", "groq", "cerebras", "mistral", "deepseek", "openai", "anthropic"];
    const out = {};
    for (const p of names) out[p] = !!(await chat.getKey(p).catch(() => null));
    return out;
  });
  H("fs-read-image", (a) => {
    const b = fs.readFileSync(a.path);
    if (b.length > 8 * 1024 * 1024) throw new Error("Goruntu cok buyuk.");
    return "data:image/png;base64," + b.toString("base64");
  });
  H("fs-read-text", (a) => {
    const st = fs.statSync(a.path);
    if (st.size > 2 * 1024 * 1024) throw new Error("Dosya cok buyuk (>2MB).");
    return fs.readFileSync(a.path, "utf8");
  });
  H("fs-write-text", (a) => { fs.writeFileSync(a.path, a.text, "utf8"); return true; });
  H("dialog-file", async () => {
    const r = await dialog.showOpenDialog(win, { properties: ["openFile"] });
    return r.canceled ? null : r.filePaths[0];
  });
  H("dialog-dir", async () => {
    const r = await dialog.showOpenDialog(win, { properties: ["openDirectory"] });
    return r.canceled ? null : r.filePaths[0];
  });
  H("shell-open", (a) => { shell.openPath(a.path); return true; });
  H("settings-get", () => getSettings());
  H("settings-set", (a) => saveSettings(Object.assign(getSettings(), a)));
  H("win-min", () => win.minimize());
  H("win-max", () => win.isMaximized() ? win.unmaximize() : win.maximize());
  H("win-close", () => { win.hide(); });
  H("win-quit", () => app.exit(0));
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.exit(0); });
app.on("second-instance", () => { if (win) { win.show(); win.focus(); } });

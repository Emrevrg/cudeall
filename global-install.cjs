// CudeAll global kurulum — opencode Desktop dahil her yerde calissin.
// Idempotent: tekrar calistirmak guvenli, uzerine yazar. Global ayari yedekler.
// Kullanim: node global-install.cjs
const fs = require("fs");
const path = require("path");
const os = require("os");

const PROJECT = __dirname;
const HOME = os.homedir();
const GDIR = path.join(HOME, ".config", "opencode");
const MCP_ABS = path.join(PROJECT, "mcp-cudeall", "server.mjs").replace(/\\/g, "/");

function fail(m) { console.error("HATA: " + m); process.exit(1); }
function parseJsonc(source) {
  let clean = "", quoted = false, escaped = false, lineComment = false, blockComment = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i], next = source[i + 1];
    if (lineComment) { if (c === "\n") { lineComment = false; clean += c; } else clean += " "; continue; }
    if (blockComment) { if (c === "*" && next === "/") { clean += "  "; i++; blockComment = false; } else clean += c === "\n" ? "\n" : " "; continue; }
    if (quoted) { clean += c; if (escaped) escaped = false; else if (c === "\\") escaped = true; else if (c === '"') quoted = false; continue; }
    if (c === '"') { quoted = true; clean += c; continue; }
    if (c === "/" && next === "/") { clean += "  "; i++; lineComment = true; continue; }
    if (c === "/" && next === "*") { clean += "  "; i++; blockComment = true; continue; }
    clean += c;
  }
  let out = ""; quoted = false; escaped = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (quoted) { out += c; if (escaped) escaped = false; else if (c === "\\") escaped = true; else if (c === '"') quoted = false; continue; }
    if (c === '"') { quoted = true; out += c; continue; }
    if (c === ",") { let j = i + 1; while (/\s/.test(clean[j] || "")) j++; if (clean[j] === "}" || clean[j] === "]") continue; }
    out += c;
  }
  return JSON.parse(out);
}
if (!fs.existsSync(GDIR)) fail("Global opencode klasoru yok: " + GDIR);

let cfgPath = null;
for (const f of ["opencode.jsonc", "opencode.json"]) {
  if (fs.existsSync(path.join(GDIR, f))) { cfgPath = path.join(GDIR, f); break; }
}
if (!cfgPath) fail("Global opencode.json(c) bulunamadi.");

// 1) yedek (ilk kurulumda bir kez)
const bak = cfgPath + ".cudeall.bak";
if (!fs.existsSync(bak)) {
  fs.copyFileSync(cfgPath, bak);
  console.log("yedek: " + bak);
}

// 2) birlestir (kullanici ayarlarina dokunmadan ekle)
let cfg;
try { cfg = parseJsonc(fs.readFileSync(cfgPath, "utf8")); }
catch (e) { fail("Global config parse edilemedi: " + e.message); }
cfg.mcp = cfg.mcp || {};
// goc: eski adlarin kalintilarini temizle (openall/timurcode/monocode/nexus donemleri)
for (const old of ["openall", "timurcode", "monocode", "nexus"]) delete cfg.mcp[old];
cfg.mcp.cudeall = {
  type: "local",
  command: ["node", MCP_ABS],
  enabled: true,
  timeout: 30000,
};
cfg.permission = cfg.permission || {};
cfg.permission.skill = Object.assign({}, typeof cfg.permission.skill === "object" ? cfg.permission.skill : {}, { cudeall: "allow" });
if (cfg.permission.skill) for (const old of ["openall", "timurcode", "monocode", "nexus"]) delete cfg.permission.skill[old];
for (const k of Object.keys(cfg.permission)) {
  if (/^(cude_|open_|all_|timur_|monocode_|nexus_|timurcode|monocode|nexus)/.test(k)) delete cfg.permission[k];
}
cfg.permission.cude_web_search = "allow";
cfg.permission.cude_web_fetch = "allow";
cfg.permission.cude_project = "allow";
// cude_spine yalnizca yerel dosya okur/yazar; sadece baglam/adapters yazimi onay ister.
cfg.permission.cude_spine = "ask";
for (const t of ["cude_browser", "cude_computer", "cude_memory", "cude_automation", "cude_history", "cude_setup", "cude_orchestrate", "cude_qa", "cude_provider", "cude_task"]) cfg.permission[t] = "ask";
cfg.permission.bash = cfg.permission.bash || {};
if (!cfg.permission.bash["rm -rf *"]) cfg.permission.bash["rm -rf *"] = "deny";
fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n");
console.log("mcp+izin yazildi: " + cfgPath);

// 3) plugin global kopya (+ eski adlari temizle)
const plugDir = path.join(GDIR, "plugins");
fs.mkdirSync(plugDir, { recursive: true });
for (const old of ["openall.js", "timurcode.js", "monocode.js", "nexus.js"]) {
  try { fs.rmSync(path.join(plugDir, old), { force: true }); } catch {}
}
fs.copyFileSync(path.join(PROJECT, ".opencode", "plugins", "cudeall.js"), path.join(plugDir, "cudeall.js"));
const libDst = path.join(GDIR, "lib");
fs.mkdirSync(libDst, { recursive: true });
for (const name of ["network-policy.mjs", "project-spine.mjs", "spine.mjs"]) {
  fs.copyFileSync(path.join(PROJECT, ".opencode", "lib", name), path.join(libDst, name));
}
console.log("plugin: plugins/cudeall.js");

// 4) skill global kopya (+ eski klasorleri temizle)
for (const old of ["openall", "timurcode", "monocode", "nexus"]) {
  try { fs.rmSync(path.join(GDIR, "skills", old), { force: true, recursive: true }); } catch {}
}
// 4b) komutlar global kopya (Codex parity: /review /init /plan /continue /compact /status)
const cmdsSrc = path.join(PROJECT, ".opencode", "commands");
const cmdsDst = path.join(GDIR, "commands");
if (fs.existsSync(cmdsSrc)) {
  fs.mkdirSync(cmdsDst, { recursive: true });
  for (const f of fs.readdirSync(cmdsSrc)) {
    if (f.endsWith(".md")) fs.copyFileSync(path.join(cmdsSrc, f), path.join(cmdsDst, f));
  }
  console.log("komutlar: commands/ (" + fs.readdirSync(cmdsDst).filter((f) => f.endsWith(".md")).join(", ") + ")");
}
const skillDir = path.join(GDIR, "skills", "cudeall");
fs.mkdirSync(skillDir, { recursive: true });
fs.copyFileSync(path.join(PROJECT, ".opencode", "skills", "cudeall", "SKILL.md"), path.join(skillDir, "SKILL.md"));
console.log("skill: skills/cudeall/SKILL.md");

console.log("skill: skills/cudeall/SKILL.md");

// 5) Codex: resmi yolla MCP kaydet + skill kopyala (CLI + Desktop gorur)
try {
  const { spawnSync } = require("child_process");
  let codexBin = null;
  const chk = spawnSync("cmd", ["/c", "where", "codex"], { timeout: 8000, encoding: "utf8", shell: false });
  const hit = (chk.stdout || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
  if (hit) codexBin = hit;
  else {
    const fb = path.join(process.env.APPDATA || "", "npm", "codex.cmd");
    if (fs.existsSync(fb)) codexBin = fb;
  }
  if (codexBin) {
    const wrap = codexBin.toLowerCase().endsWith(".cmd") ? ["cmd", ["/c", codexBin]] : [codexBin, []];
    const get = spawnSync(wrap[0], [...wrap[1], "mcp", "get", "cudeall"], { timeout: 15000, encoding: "utf8" });
    const cur = (get.stdout || "") + (get.stderr || "");
    if (get.status !== 0 || !cur.includes(MCP_ABS)) {
      if (get.status === 0) spawnSync(wrap[0], [...wrap[1], "mcp", "remove", "cudeall"], { timeout: 15000 });
      const add = spawnSync(wrap[0], [...wrap[1], "mcp", "add", "cudeall", "--", "node", MCP_ABS], { timeout: 30000, encoding: "utf8" });
      console.log(add.status === 0 ? "codex: mcp cudeall kayitli" : "codex: kayit BASARISIZ — " + ((add.stderr || "").slice(0, 200)));
    } else console.log("codex: mcp cudeall zaten kayitli");
  } else console.log("codex: CLI yok, atlandi (Desktop uygulamasi configi paylasir)");
} catch (e) { console.log("codex: atlandi (" + String(e.message || e).slice(0, 100) + ")"); }
try {
  const dst = path.join(HOME, ".codex", "skills", "cudeall");
  fs.mkdirSync(dst, { recursive: true });
  fs.copyFileSync(path.join(PROJECT, ".opencode", "skills", "cudeall", "SKILL.md"), path.join(dst, "SKILL.md"));
  console.log("codex: skills/cudeall/SKILL.md");
} catch (e) { console.log("codex skill: atlandi"); }

// 6) Claude: settings.json'a MCP birlestir (yedekli) + skill kopyala
try {
  const sfile = path.join(HOME, ".claude", "settings.json");
  if (fs.existsSync(sfile)) {
    const sbak = sfile + ".cudeall.bak";
    if (!fs.existsSync(sbak)) { fs.copyFileSync(sfile, sbak); console.log("yedek: settings.json.cudeall.bak"); }
    const sc = JSON.parse(fs.readFileSync(sfile, "utf8"));
    sc.mcpServers = sc.mcpServers || {};
    sc.mcpServers.cudeall = { command: "node", args: [MCP_ABS] };
    fs.writeFileSync(sfile, JSON.stringify(sc, null, 2) + "\n");
    console.log("claude: settings.json mcpServers.cudeall");
  } else console.log("claude: settings.json yok, atlandi");
  const dst = path.join(HOME, ".claude", "skills", "cudeall");
  fs.mkdirSync(dst, { recursive: true });
  fs.copyFileSync(path.join(PROJECT, ".opencode", "skills", "cudeall", "SKILL.md"), path.join(dst, "SKILL.md"));
  console.log("claude: skills/cudeall/SKILL.md");
} catch (e) { console.log("claude: atlandi (" + String(e.message || e).slice(0, 100) + ")"); }

// NOT: proje kokunde .agents/.claude kopyasi YOK (opencode ayni isimli
// skill'i 3 yerde gorunce karisir). Codex/Claude global skill'i okur (yukarda),
// proje ozeli lazimsa .opencode/skills yeter.

console.log("GLOBAL KURULUM OK — opencode Desktop'u yeniden baslat, her yerde aktif.");

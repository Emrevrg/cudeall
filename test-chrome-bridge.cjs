const { spawn } = require("child_process");
const net = require("net");
const os = require("os");
const path = require("path");
const fs = require("fs/promises");
const EXTENSION_ORIGIN = "chrome-extension://hnckckmbmobddclopmnohkbignbecoaf";
const answers = {
  group_open: "Grup hazir: CudeAll (0 sekme).",
  group_open_url: "Acildi + gruba eklendi: CudeAll -> Ornek\nhttps://ornek.com",
  tab_read: "# Ornek\nhttps://ornek.com\n\nDeneme icerik",
  tab_click: "Tiklandi: <BUTTON> Gonder",
  tab_close_group: "Kapatildi: CudeAll (2 sekme)."
};
(async () => {
  const portProbe = net.createServer();
  await new Promise((resolve, reject) => portProbe.listen(0, "127.0.0.1", (e) => e ? reject(e) : resolve()));
  const port = portProbe.address().port;
  await new Promise((resolve) => portProbe.close(resolve));
  const bridge = `http://127.0.0.1:${port}`;
  const worktree = await fs.mkdtemp(path.join(os.tmpdir(), "cudeall-smoke-"));
  const p = spawn("node", ["mcp-cudeall/server.mjs"], {
    cwd: __dirname,
    env: { ...process.env, CUDEALL_BRIDGE_PORT: String(port), CUDEALL_WORKTREE: worktree },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let out = "";
  p.stdout.on("data", (d) => { out += d; });
  p.stderr.on("data", (d) => { console.error("STDERR:", String(d).slice(0, 300)); });
  const seq = [
    { action: "group_open" },
    { action: "open", url: "https://ornek.com" },
    { action: "read" },
    { action: "click", text: "Gonder" },
    { action: "close" }
  ];
  let id = 100;
  for (const a of seq) p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: id++, method: "tools/call", params: { name: "cude_browser", arguments: a } }) + "\n");
  let token = "";
  for (let i = 0; i < 40 && !token; i++) {
    try {
      const r = await fetch(`${bridge}/cudeall/bootstrap`, { headers: { Origin: EXTENSION_ORIGIN } });
      if (r.ok) token = (await r.json()).token;
    } catch {}
    if (!token) await new Promise((r) => setTimeout(r, 100));
  }
  if (!token) { console.error("Kopru bootstrap yaniti yok."); p.kill(); await fs.rm(worktree, { recursive: true, force: true }); process.exit(1); }
  const auth = { Origin: EXTENSION_ORIGIN, Authorization: `Bearer ${token}` };
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    let cmds = [];
    try { cmds = (await (await fetch(`${bridge}/cudeall/commands`, { headers: auth })).json()).commands || []; } catch {}
    for (const cmd of cmds) {
      if (seen.has(cmd.id)) continue;
      seen.add(cmd.id);
      await fetch(`${bridge}/cudeall/results`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ id: cmd.id, ok: true, data: answers[cmd.cmd] || "ok" }) });
    }
    const n = out.split("\n").filter((l) => l.includes('"id"')).length;
    if (n >= 5) break;
  }
  const lines = out.split("\n").filter(Boolean);
  console.log("CEVAP SAYISI:", lines.length);
  for (const l of lines) {
    try {
      const j = JSON.parse(l);
      const t = j.result ? j.result.content[0].text.slice(0, 90).replace(/\n/g, " | ") : JSON.stringify(j.error).slice(0, 90);
      console.log(j.id, "=>", t);
    } catch { console.log("PARSE-HATA:", l.slice(0, 120)); }
  }
  p.kill();
  await fs.rm(worktree, { recursive: true, force: true });
  process.exit(0);
})();

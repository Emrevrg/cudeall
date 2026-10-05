// Cude Desktop — MCP istemcisi: gomulu CudeAll (14 arac) ile stdio konusur.
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const MCP_ABS = (() => {
  if (process.env.CUDEALL_MCP && fs.existsSync(process.env.CUDEALL_MCP)) return process.env.CUDEALL_MCP;
  const cands = [
    path.join(__dirname, "..", "..", "mcp-cudeall", "server.mjs"),
    path.join(process.cwd(), "mcp-cudeall", "server.mjs"),
  ];
  for (const c of cands) if (fs.existsSync(c)) return c;
  return null;
})();

let child = null, seq = 0, switching = null;
const pending = new Map();
let buf = "";

function ensure() {
  if (child) return true;
  if (!MCP_ABS) return false;
  child = spawn(process.execPath, [MCP_ABS], { stdio: ["pipe", "pipe", "ignore"] });
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id !== undefined && pending.has(msg.id)) {
          const { res, rej, timer } = pending.get(msg.id);
          pending.delete(msg.id);
          clearTimeout(timer);
          if (msg.error) rej(new Error(msg.error.message || "MCP hatasi"));
          else res(msg.result);
        }
      } catch {}
    }
  });
  child.on("exit", () => { child = null; buf = ""; for (const [, p] of pending) { clearTimeout(p.timer); p.rej(new Error("MCP kapandi")); } pending.clear(); });
  return true;
}

function send(method, params = {}, timeoutMs = 180000) {
  if (switching) return switching.then(() => send(method, params, timeoutMs));
  if (!ensure()) return Promise.reject(new Error("MCP bulunamadi (mcp-cudeall/server.mjs yok)"));
  const id = ++seq;
  return new Promise((res, rej) => {
    const timer = setTimeout(() => { pending.delete(id); rej(new Error("MCP zaman asimi")); }, timeoutMs);
    pending.set(id, { res, rej, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}

function setWorkspace(dir) {
  const resolved = require("node:fs").realpathSync(String(dir));
  if (!require("node:fs").statSync(resolved).isDirectory()) throw new Error("Workspace bir klasor olmali.");
  const previous = switching || Promise.resolve();
  const change = previous.then(async () => {
    process.env.CUDEALL_WORKTREE = resolved;
    const old = child;
    if (old) {
      child = null;
      await new Promise((resolve) => {
        if (old.exitCode !== null) return resolve();
        const timer = setTimeout(resolve, 3000);
        old.once("exit", () => { clearTimeout(timer); resolve(); });
        old.kill();
      });
    }
    return resolved;
  });
  switching = change;
  change.finally(() => { if (switching === change) switching = null; }).catch(() => {});
  return change;
}

module.exports = {
  mcpPath: () => MCP_ABS,
  setWorkspace,
  list: () => send("tools/list", {}).then((r) => r.tools || []),
  call: (name, args = {}) => send("tools/call", { name, arguments: args }),
};

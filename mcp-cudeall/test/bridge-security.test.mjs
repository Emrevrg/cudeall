import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";

const here = dirname(fileURLToPath(import.meta.url));
const serverPath = join(here, "..", "server.mjs");
const extensionOrigin = "chrome-extension://hnckckmbmobddclopmnohkbignbecoaf";
const manifestPath = join(here, "..", "..", "chrome-extension", "manifest.json");

test("the extension origin matches its pinned manifest key and host permissions are valid", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const id = createHash("sha256").update(Buffer.from(manifest.key, "base64"))
    .digest().subarray(0, 16).toString("hex").replace(/[0-9a-f]/g, (digit) => String.fromCharCode(97 + parseInt(digit, 16)));
  assert.equal(`chrome-extension://${id}`, extensionOrigin);
  assert.ok(manifest.host_permissions.includes("http://127.0.0.1/*"));
  assert.ok(manifest.host_permissions.every((pattern) => !pattern.startsWith("<")));
});

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", (error) => error ? reject(error) : resolve()));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForBridge(port, child) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`MCP server exited (${child.exitCode})`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/cudeall/commands`);
      if (response.status === 401) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("CudeAll loopback bridge did not start");
}

test("loopback bridge rejects web origins and requires a short-lived bearer token", async (t) => {
  const port = await freePort();
  const worktree = await mkdtemp(join(tmpdir(), "cudeall-bridge-test-"));
  const child = spawn(process.execPath, [serverPath], {
    cwd: here,
    env: { ...process.env, CUDEALL_BRIDGE_PORT: String(port), CUDEALL_WORKTREE: worktree },
    stdio: ["pipe", "ignore", "pipe"],
  });
  t.after(async () => {
    child.kill();
    await rm(worktree, { recursive: true, force: true });
  });

  child.stdin.write(`${JSON.stringify({
    jsonrpc: "2.0", id: 1, method: "tools/call",
    params: { name: "cude_browser", arguments: { action: "status" } },
  })}\n`);
  await waitForBridge(port, child);
  const url = `http://127.0.0.1:${port}`;

  const deniedOrigin = await fetch(`${url}/cudeall/commands`, { headers: { Origin: "https://attacker.example" } });
  assert.equal(deniedOrigin.status, 403);
  assert.equal(deniedOrigin.headers.get("access-control-allow-origin"), null);
  const noToken = await fetch(`${url}/cudeall/commands`);
  assert.equal(noToken.status, 401);

  const deniedBootstrap = await fetch(`${url}/cudeall/bootstrap`, { headers: { Origin: "https://attacker.example" } });
  assert.equal(deniedBootstrap.status, 403);
  const deniedPreflight = await fetch(`${url}/cudeall/commands`, {
    method: "OPTIONS", headers: { Origin: "https://attacker.example", "Access-Control-Request-Method": "GET" },
  });
  assert.equal(deniedPreflight.status, 403);
  const bootstrap = await fetch(`${url}/cudeall/bootstrap`, { headers: { Origin: extensionOrigin } });
  assert.equal(bootstrap.status, 200);
  assert.equal(bootstrap.headers.get("access-control-allow-origin"), extensionOrigin);
  const { token } = await bootstrap.json();
  assert.equal(typeof token, "string");
  assert.ok(token.length >= 40);
  const preflight = await fetch(`${url}/cudeall/commands`, {
    method: "OPTIONS", headers: { Origin: extensionOrigin, "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "authorization" },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), extensionOrigin);

  const headers = { Origin: extensionOrigin, Authorization: `Bearer ${token}` };
  const evilWithToken = await fetch(`${url}/cudeall/commands`, {
    headers: { ...headers, Origin: "https://attacker.example" },
  });
  assert.equal(evilWithToken.status, 403);
  const allowed = await fetch(`${url}/cudeall/commands`, { headers });
  assert.equal(allowed.status, 200);
  const batch = await allowed.json();
  assert.ok(batch.commands.some((command) => command.cmd === "status"), "the authorized extension can drain its pending command");

  const unknownResult = await fetch(`${url}/cudeall/results`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ id: "not-pending", ok: true, data: "injected" }),
  });
  assert.equal(unknownResult.status, 409);

  const oversizedResult = await fetch(`${url}/cudeall/results`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ id: "not-pending", ok: true, data: "x".repeat(40 * 1024) }),
  });
  assert.equal(oversizedResult.status, 413);
});

test("a bridge port collision is reported without crashing the MCP process", async (t) => {
  const occupied = net.createServer();
  await new Promise((resolve, reject) => occupied.listen(0, "127.0.0.1", (error) => error ? reject(error) : resolve()));
  const port = occupied.address().port;
  const worktree = await mkdtemp(join(tmpdir(), "cudeall-port-test-"));
  const child = spawn(process.execPath, [serverPath], {
    cwd: here,
    env: { ...process.env, CUDEALL_BRIDGE_PORT: String(port), CUDEALL_WORKTREE: worktree },
    stdio: ["pipe", "pipe", "ignore"],
  });
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { output += chunk; });
  t.after(async () => {
    child.kill();
    await new Promise((resolve) => occupied.close(resolve));
    await rm(worktree, { recursive: true, force: true });
  });

  child.stdin.write(`${JSON.stringify({
    jsonrpc: "2.0", id: 2, method: "tools/call",
    params: { name: "cude_browser", arguments: { action: "status" } },
  })}\n`);
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline && !output.includes('"id":2')) {
    if (child.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(child.exitCode, null, "port conflict must not terminate the MCP process");
  const response = output.split("\n").find((line) => line.includes('"id":2'));
  assert.ok(response, "status call should return a diagnostic");
  const text = JSON.parse(response).result.content[0].text;
  assert.match(text, /kopru portu .* acilamadi/i);
});

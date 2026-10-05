import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const serverPath = join(here, "..", "server.mjs");
const spineUrl = pathToFileURL(join(here, "..", "..", ".opencode", "lib", "spine.mjs")).href;
const spine = await import(spineUrl);

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "cudeall-handoff-test-"));
  await readFile(join(root, "package.json")).catch(async () => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "hf", version: "0.0.1" }), "utf8");
  });
  return root;
}

test("handoff inbox lists pending notes and claim records who took over", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.deepEqual(spine.handoffInbox(root), [], "no inbox before any handoff exists");

  // handoff, task kaydinin yanina dosya yazar; bunu spine API uzerinden dogrula.
  const { updateTask } = await import(pathToFileURL(join(here, "..", "..", ".opencode", "lib", "project-spine.mjs")).href);
  const started = await updateTask(root, { action: "start", objective: "Handoff kuyrugunu dogrula", plan: ["Hazirla", "Devret"] });
  const id = started.match(/t-[a-z0-9-]+/)?.[0];
  assert.ok(id, "start returns the task id");

  await updateTask(root, { action: "handoff", id, target: "codex", next: "Devretilen adimi calistir" });
  const inbox = spine.handoffInbox(root);
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0].id, id);
  assert.equal(inbox[0].target, "codex");
  assert.equal(inbox[0].claimed, null, "a fresh handoff is unclaimed");

  const claimed = await spine.claimHandoff(root, { agent: "opencode" });
  assert.match(claimed, /Devralindi/);
  const after = spine.handoffInbox(root);
  assert.equal(after[0].claimed.agent, "opencode");
  await assert.rejects(() => spine.claimHandoff(root, { agent: "ikinci" }), /claim edilmemis/);
});

test("claiming without an id picks the oldest waiting handoff", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const { updateTask } = await import(pathToFileURL(join(here, "..", "..", ".opencode", "lib", "project-spine.mjs")).href);
  const started = await updateTask(root, { action: "start", objective: "Otomatik devralma sirasi" });
  const id = started.match(/t-[a-z0-9-]+/)?.[0];
  await updateTask(root, { action: "handoff", id, target: "claude", next: "Siradaki is" });
  const claimed = await spine.claimHandoff(root, { agent: "desktop" });
  assert.match(claimed, new RegExp(id));
  assert.equal(spine.handoffInbox(root)[0].claimed.agent, "desktop");
});

test("a completed task requires a successful task-linked evidence entry", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const { updateTask } = await import(pathToFileURL(join(here, "..", "..", ".opencode", "lib", "project-spine.mjs")).href);
  const started = await updateTask(root, { action: "start", objective: "Kanit zorunlulugu" });
  const id = started.match(/t-[a-z0-9-]+/)?.[0];
  await assert.rejects(
    () => updateTask(root, { action: "complete", id }),
    /verification/,
    "complete without evidence is rejected",
  );
  await assert.rejects(
    () => updateTask(root, { action: "complete", id, verification: "sadece not, kanit yok" }),
    /basarili kanit/,
    "a verification note without an evidence record is insufficient",
  );
  spine.addEvidence(root, { taskId: id, label: "manuel dogrulama: cikti incelendi" });
  const done = await updateTask(root, { action: "complete", id, verification: "cikti incelendi" });
  assert.match(done, /complete/);
});

test("cude_spine exposes status, evidence and handoffs over MCP stdio", async (t) => {
  const root = await fixture();
  const child = spawn(process.execPath, [serverPath], {
    cwd: here,
    env: { ...process.env, CUDEALL_WORKTREE: root, CUDEALL_BRIDGE_PORT: "0" },
    stdio: ["pipe", "pipe", "ignore"],
  });
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { output += chunk; });
  t.after(async () => { child.kill(); await rm(root, { recursive: true, force: true }); });

  const calls = [
    { name: "cude_spine", arguments: { action: "status" } },
    { name: "cude_spine", arguments: { action: "adapters", mode: "dry" } },
    { name: "cude_spine", arguments: { action: "evidence", label: "test kosuldu", command: "node --test", exitCode: 0 } },
    { name: "cude_spine", arguments: { action: "kanitlar" } },
    { name: "cude_spine", arguments: { action: "handoffs" } },
  ];
  for (const [i, args] of calls.entries()) {
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: i + 1, method: "tools/call", params: args })}\n`);
  }

  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && !output.includes('"id":5')) {
    if (child.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  const replies = output.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
  assert.equal(replies.length, 5, "every spine call answers");
  const text = (id) => replies.find((r) => r.id === id).result.content[0].text;
  assert.match(text(1), /CUDEALL OMRUGA DURUMU/);
  assert.match(text(2), /ADAPTER DENETIMI/);
  assert.match(text(3), /Kanit kaydedildi/);
  assert.match(text(4), /test kosuldu/);
  assert.match(text(5), /handoff yok/);
  assert.deepEqual(await readdir(join(root, ".opencode", "cudeall", "tasks")), [], "spine calls never invent task records");
});

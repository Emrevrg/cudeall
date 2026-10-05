import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const spinePath = pathToFileURL(join(here, "..", "..", ".opencode", "lib", "spine.mjs")).href;
const spine = await import(spinePath);

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "cudeall-spine-test-"));
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "ornek", version: "1.0.0", scripts: { test: "node --test" } }), "utf8");
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "index.js"), "export const ok = true;\n", "utf8");
  return root;
}

test("capabilities reports the project without reading secret values", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const c = spine.capabilities(root);
  assert.equal(c.project, root);
  assert.ok(c.mcpTools.includes("cude_spine"));
  assert.equal(c.env.TAVILY_API_KEY, !!process.env.TAVILY_API_KEY, "only presence, never the value");
  assert.equal(JSON.stringify(c).includes("tvly-"), false, "no key material in capability output");
});

test("adapter blocks are idempotent and preserve surrounding user text", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "AGENTS.md"), "# Bizim talimatimiz\n\nKurallarimiz var.\n", "utf8");

  const first = spine.writeAdapter(root, "codex");
  assert.equal(first.changed, true);
  const second = spine.writeAdapter(root, "codex");
  assert.equal(second.changed, false, "a second write must be a no-op");

  const text = await readFile(join(root, "AGENTS.md"), "utf8");
  assert.ok(text.startsWith("# Bizim talimatimiz"), "existing user content stays at the top");
  assert.ok(text.includes("Kurallarimiz var."));
  assert.equal(text.split(spine.ADAPTER_BLOCK_START).length - 1, 1, "exactly one managed block");

  const claude = spine.writeAdapter(root, "claude");
  assert.equal(claude.file.endsWith("CLAUDE.md"), true);
  assert.equal(spine.writeAdapter(root, "claude").changed, false);
});

test("adapter dry-run reports the change but writes nothing", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const result = spine.writeAdapter(root, "opencode", { write: false });
  assert.equal(result.changed, true);
  assert.equal(result.written, false);
  await assert.rejects(() => readFile(join(root, "AGENTS.md"), "utf8"), "no file in dry mode");
  assert.deepEqual(spine.syncAdapters(root, { write: false }).every((r) => r.written === false), true);
});

test("context is generated once and reused byte-for-byte", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const one = spine.writeContext(root);
  assert.equal(one.changed, true);
  assert.ok(one.text.includes("ornek@1.0.0"), "package name is part of the shared brief");
  const two = spine.writeContext(root);
  assert.equal(two.changed, false, "unchanged project must not rewrite the file");
});

test("evidence is append-only, redacted and readable in reverse order", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const first = spine.addEvidence(root, { label: "syntax kontrolu", command: "node --check a.js", exitCode: 0 });
  const second = spine.addEvidence(root, { label: "anahtar sizdi", command: "echo sk-ant-abcdefghijklmnopqrstuvwxyz012345" });
  assert.notEqual(first.id, second.id);
  assert.equal(second.command.includes("sk-ant-abcdefghijklmnopqrstuvwxyz012345"), false, "secrets are redacted");
  const log = spine.readEvidence(root);
  assert.equal(log.length, 2);
  assert.equal(log[1].id, second.id, "append order is preserved");
  assert.throws(() => spine.addEvidence(root, {}), /label veya command/);
});

test("snapshot stays empty when the spine has nothing, then reflects goal and tasks", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.equal(spine.snapshot(root), "");
  await writeFile(join(root, ".opencode", "cudeall-goal.md"), "# Oturum hedefi\n\nOmurga testi\n", "utf8").catch(async () => {
    await mkdir(join(root, ".opencode"), { recursive: true });
    await writeFile(join(root, ".opencode", "cudeall-goal.md"), "# Oturum hedefi\n\nOmurga testi\n", "utf8");
  });
  const text = spine.snapshot(root);
  assert.ok(text.includes("Omurga testi"));
  assert.ok(text.length <= 1400, "snapshot is a small budget, not a context dump");
});

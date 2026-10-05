#!/usr/bin/env node
// cudeall MCP — TEK MCP: web + browser + computer-use + memory + automation
// Zero-dependency (sadece Node builtins). Windows dostu.
// Protokol: MCP / JSON-RPC 2.0 over stdio (satir bazli JSON).
// Kurulum: opencode.json -> mcp.cudeall.command = ["node", "<proje>/mcp-cudeall/server.mjs"]

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, execFile } from "node:child_process";
import http from "node:http";
import os from "node:os";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { fetchPublicHttp, readLimitedText } from "../.opencode/lib/network-policy.mjs";
import { inspectProject, updateTask, handoffInbox, claimHandoff } from "../.opencode/lib/project-spine.mjs";
import { capabilities, syncAdapters, writeContext, readEvidence, addEvidence, snapshot } from "../.opencode/lib/spine.mjs";

const VERSION = "0.4.0";

function projectAction(args = {}) {
  const action = String(args.action || "context").toLowerCase();
  if (!["context", "inspect"].includes(action)) throw new Error("action context|inspect olmali.");
  return inspectProject(args.dir || cwdRoot());
}
function taskAction(args = {}) {
  return updateTask(args.dir || cwdRoot(), args);
}

// ---------- yardimcilar ----------
function cwdRoot() {
  return process.env.CUDEALL_WORKTREE || process.cwd();
}
function opencodeDir() {
  const d = join(cwdRoot(), ".opencode");
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
}
function memoryFile() {
  if (process.env.CUDEALL_MEMORY_FILE) return process.env.CUDEALL_MEMORY_FILE;
  return join(opencodeDir(), "cudeall-memory.json");
}
function automationsDir() {
  const d = process.env.CUDEALL_AUTOMATIONS_DIR || join(opencodeDir(), "automations");
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
}
function loadMemory() {
  try {
    if (!existsSync(memoryFile())) return {};
    return JSON.parse(readFileSync(memoryFile(), "utf8"));
  } catch { return {}; }
}
function saveMemory(m) {
  writeFileSync(memoryFile(), JSON.stringify(m, null, 2), "utf8");
}
function textResult(text) {
  return { content: [{ type: "text", text: String(text).slice(0, 60000) }] };
}
function errResult(msg) {
  return { content: [{ type: "text", text: `HATA: ${msg}` }], isError: true };
}
function stripHtml(html, baseUrl) {
  let t = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  // linkleri koru: <a href> metin (url)
  t = t.replace(/<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, label) => {
    const clean = String(label).replace(/<[^>]+>/g, " ").trim().slice(0, 200);
    let abs = href;
    try { abs = new URL(href, baseUrl).toString(); } catch {}
    return ` ${clean} (${abs}) `;
  });
  t = t.replace(/<\/(p|div|h1|h2|h3|h4|li|tr|br)>/gi, "\n")
       .replace(/<[^>]+>/g, " ")
       .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
       .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  return t.replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").trim();
}

// ---------- WEB SEARCH (anahtarsiz + anahtarli) ----------
async function webSearch(query, count = 8) {
  count = Math.max(1, Math.min(10, Number(count) || 8));
  // 1) Tavily varsa (en kaliteli) — opencode-tavily plugininin karsiligi
  if (process.env.TAVILY_API_KEY) {
    try {
      const r = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: process.env.TAVILY_API_KEY, query, max_results: count, include_answer: true }),
        signal: AbortSignal.timeout(20000),
      });
      const j = await r.json();
      const lines = (j.results || []).map((x, i) => `${i + 1}. ${x.title}\n   ${x.url}\n   ${String(x.content || "").slice(0, 300)}`);
      return `Tavily (${j.answer ? "cevapli" : "cevapsiz"}):\n${j.answer ? "OZET: " + j.answer + "\n\n" : ""}${lines.join("\n")}`;
    } catch (e) { /* sessizce DDG'ye dus */ }
  }
  // 2) Brave varsa
  if (process.env.BRAVE_API_KEY) {
    try {
      const r = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`, {
        headers: { "X-Subscription-Token": process.env.BRAVE_API_KEY },
        signal: AbortSignal.timeout(20000),
      });
      const j = await r.json();
      const lines = (j.web?.results || []).map((x, i) => `${i + 1}. ${x.title}\n   ${x.url}\n   ${String(x.description || "").slice(0, 300)}`);
      if (lines.length) return `Brave:\n${lines.join("\n")}`;
    } catch {}
  }
  // 3) Anahtarsiz zincir: DDG-lite -> DDG-html -> Mojeek (biri olse digeri; API sart degil)
  const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) cudeall/0.1" };
  const engines = [
    { ad: "DuckDuckGo", url: `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}` },
    { ad: "DuckDuckGo", url: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}` },
    { ad: "Mojeek", url: `https://www.mojeek.com/search?q=${encodeURIComponent(query)}` },
  ];
  for (const e of engines) {
    try {
      const r = await fetch(e.url, { headers: UA, signal: AbortSignal.timeout(20000) });
      if (!r.ok) continue;
      const out = parseAnchorResults(await r.text(), query, count);
      if (out.length) {
        const text = `${e.ad} (anahtarsiz, ${out.length} sonuc):\n${out.join("\n")}\n\nIPUCU: En iyi 2-3 URL'yi cude_web_fetch ile cek. Derin arastirma icin skill'deki "derin arastirma dongusu"ne bak.`;
        saveSearchCache(query, text);
        return text;
      }
    } catch {}
  }
  const stale = readSearchCache(query);
  if (stale) return `[CEVRIMDISI/ONBELLEK — ${stale.gun} gunluk kayit]\n${stale.text}`;
  return `Su an 3 arama motoruna da ulasilamadi (ag kesik olabilir). TAVILY_API_KEY/BRAVE_API_KEY varsa otomatik denenirdi.\nSorgu: ${query}`;
}

// Bagimsiz baglanti cikarici: DDG + Mojeek + genel HTML icin tek kalip
function parseAnchorResults(html, query, count) {
  const out = [];
  const re = /<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) && out.length < count) {
    let href = (m[1] || "").trim().replace(/&amp;/g, "&");
    const label = m[2].replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
    if (!label || label.length < 4) continue;
    if (/^(Sonraki|Next|Daha fazla|Images|Videos|News|Maps|Settings|engel|Anasayfa)$/i.test(label)) continue;
    // DDG yonlendirme linki: //duckduckgo.com/l/?uddg=<gercek url>
    const ud = href.match(/[?&]uddg=([^&]+)/);
    if (ud) { try { href = decodeURIComponent(ud[1]); } catch {} }
    if (href.startsWith("//")) href = "https:" + href;
    if (!/^https?:\/\//.test(href)) continue;
    if (/duckduckgo\.com|mojeek\.com\/(search|preferences)/.test(href)) continue; // ic linkler
    if (out.some((x) => x.includes(href))) continue; // tekrar
    out.push(`${out.length + 1}. ${label.slice(0, 160)}\n   ${href}`);
  }
  return out;
}

// Kendi teknolojimiz: arama onbellegi (ag giderse bayat kayit doner, is durmaz)
function searchCacheFile() {
  return join(opencodeDir(), "search-cache.json");
}
function saveSearchCache(query, text) {
  try {
    let c = {};
    if (existsSync(searchCacheFile())) c = JSON.parse(readFileSync(searchCacheFile(), "utf8"));
    c[String(query).toLowerCase().slice(0, 120)] = { at: Date.now(), text: String(text).slice(0, 6000) };
    const keys = Object.keys(c);
    if (keys.length > 30) for (const k of keys.slice(0, keys.length - 30)) delete c[k];
    writeFileSync(searchCacheFile(), JSON.stringify(c), "utf8");
  } catch {}
}
function readSearchCache(query) {
  try {
    if (!existsSync(searchCacheFile())) return null;
    const c = JSON.parse(readFileSync(searchCacheFile(), "utf8"));
    const hit = c[String(query).toLowerCase().slice(0, 120)];
    if (!hit) return null;
    const gun = Math.round((Date.now() - hit.at) / 86400000);
    return { gun, text: hit.text };
  } catch { return null; }
}

async function webFetch(url, maxChars = 12000) {
  if (!/^https?:\/\//.test(url)) throw new Error("URL http(s) ile baslamali: " + url);
  const r = await fetchPublicHttp(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) cudeall/0.1" },
    signal: AbortSignal.timeout(25000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText} — ${url}`);
  const ct = r.headers.get("content-type") || "";
  const { text: body, truncated } = await readLimitedText(r);
  if (ct.includes("application/json")) return body.slice(0, maxChars) + (truncated ? "\n\n[yanit boyut sinirinda kesildi]" : "");
  const text = stripHtml(body, url);
  const cut = truncated || text.length > maxChars;
  return `# ${url}\n\n${text.slice(0, maxChars)}${cut ? "\n\n[...kirpildi]" : ""}`;
}

// ---------- BROWSER (playwright varsa gercek, yoksa statik + yonlendirme) ----------
let playwrightNoteShown = false;
async function tryPlaywright() {
  try {
    const pw = await import("playwright");
    return pw;
  } catch { return null; }
}
async function browserAction(a) {
  const action = (a.action || "open").toLowerCase();
  const pw = await tryPlaywright();
  if (!pw) {
    // Gecis modu: open/snapshot -> web_fetch ile karsila (baglam kazan, alet sismesin)
    if ((action === "open" || action === "snapshot") && a.url) {
      const text = await webFetch(a.url, 8000);
      return `${text}\n\n[NOT: Gercek tiklamali tarayici icin 'npm i -D playwright' + 'npx playwright install chromium' kur. Sonra @playwright/mcp veya bu aracin headed modu devreye girer. Simdilik statik icerik verildi.]`;
    }
    return `Playwright kurulu degil. Hizli kurulum:\n1) npm i -D playwright\n2) npx playwright install chromium\nSonra ayni komutu tekrar calistir. Statik okuma gerekiyorsa cude_web_fetch kullan.\nIstek: ${action}`;
  }
  // Playwright mevcutsa: tek seferlik chromium ile snapshot/click/type/screenshot
  const { chromium } = pw;
  const browser = await chromium.launch({ headless: process.env.CUDEALL_HEADLESS !== "0" });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    const page = await ctx.newPage();
    if (a.url && (action === "open" || action === "snapshot" || action === "screenshot" || !a.selector)) {
      await page.goto(a.url, { waitUntil: "domcontentloaded", timeout: 30000 });
    }
    if (action === "open" || action === "snapshot") {
      const title = await page.title();
      const body = await page.content();
      const text = stripHtml(body, a.url || "about:blank").slice(0, 8000);
      return `# ${title}\nURL: ${page.url()}\n\n${text}`;
    }
    if (action === "screenshot") {
      const p = join(os.tmpdir(), `cudeall-${Date.now()}.png`);
      await page.screenshot({ path: p, fullPage: !!a.fullPage });
      return `Ekran goruntusu: ${p} (opencode'da read ile acip modele goster)`;
    }
    if (action === "click" && a.selector) { await page.click(a.selector, { timeout: 15000 }); return `Tiklandi: ${a.selector} -> ${page.url()}`; }
    if ((action === "type" || action === "fill") && a.selector) { await page.fill(a.selector, a.text || ""); return `Yazildi: ${a.selector}`; }
    if (action === "run_code" && process.env.CUDEALL_ALLOW_CODE === "1") {
      // bilerek minimal: sadece title+url dondur (RCE riskini buyutme)
      return `URL: ${page.url()} | TITLE: ${await page.title()}`;
    }
    return `Bilinmeyen/kombine aksiyon: ${action}. open|snapshot|screenshot|click|type desteklenir.`;
  } finally { await browser.close().catch(() => {}); }
}

// ---------- CHROME KOPRUSU (gercek Chrome + sekme grubu) ----------
// Mimari: MCP <--HTTP poll--> Chrome eklentisi (chrome-extension/).
// Eklenti her 1.5 sn'de /cudeall/commands'e sorar, komutu chrome.tabs/tabGroups ile
// calistirir, sonucu /cudeall/results'a yazar. CDP (9222) yedek yoldur.
const BRIDGE_PORT = Number(process.env.CUDEALL_BRIDGE_PORT) || 18789;
const CDP_PORT = Number(process.env.CUDEALL_CDP_PORT) || 9222;
const EXTENSION_ID = "hnckckmbmobddclopmnohkbignbecoaf";
const EXTENSION_ORIGIN = `chrome-extension://${EXTENSION_ID}`;
const BRIDGE_TOKEN = randomBytes(32).toString("base64url");
const MAX_BRIDGE_BODY_BYTES = 32 * 1024;
let bridgeServer = null;
let bridgeStartPromise = null;
const cmdQueue = [];
const cmdResults = new Map();
const pendingCmds = new Set();
let cmdSeq = 0;
let bridgePortActual = 0;

async function ensureBridge() {
  if (bridgeServer?.listening) return bridgePortActual || BRIDGE_PORT;
  if (bridgeStartPromise) return bridgeStartPromise;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const origin = req.headers.origin;
    const host = String(req.headers.host || "").toLowerCase();
    if (host !== `127.0.0.1:${BRIDGE_PORT}`) { res.writeHead(421); res.end("invalid host"); return; }
    if (origin && origin !== EXTENSION_ORIGIN) { res.writeHead(403); res.end("origin denied"); return; }
    if (origin === EXTENSION_ORIGIN) {
      res.setHeader("Access-Control-Allow-Origin", EXTENSION_ORIGIN);
      res.setHeader("Vary", "Origin");
    }
    if (req.method === "OPTIONS") {
      if (origin !== EXTENSION_ORIGIN) { res.writeHead(403); res.end("preflight denied"); return; }
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type");
      res.setHeader("Access-Control-Max-Age", "300");
      res.writeHead(204); res.end(); return;
    }
    if (req.method === "GET" && url.pathname === "/cudeall/bootstrap") {
      if (origin !== EXTENSION_ORIGIN) { res.writeHead(403); res.end("extension origin required"); return; }
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ token: BRIDGE_TOKEN }));
      return;
    }
    const auth = String(req.headers.authorization || "");
    const expected = Buffer.from(`Bearer ${BRIDGE_TOKEN}`);
    const provided = Buffer.from(auth);
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      res.writeHead(401, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    if (req.method === "GET" && url.pathname === "/cudeall/status") {
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ ok: true, service: "cudeall-bridge", version: VERSION, pending: cmdQueue.length }));
      return;
    }
    if (req.method === "GET" && url.pathname === "/cudeall/commands") {
      const batch = cmdQueue.splice(0, cmdQueue.length);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ commands: batch }));
      return;
    }
    if (req.method === "POST" && url.pathname === "/cudeall/results") {
      if (!(req.headers["content-type"] || "").toLowerCase().includes("application/json")) {
        res.writeHead(415); res.end("application/json required"); return;
      }
      const chunks = [];
      let size = 0;
      let tooLarge = false;
      req.on("data", (d) => {
        size += d.length;
        if (size > MAX_BRIDGE_BODY_BYTES) {
          tooLarge = true;
          res.writeHead(413); res.end("body too large");
          req.resume();
          return;
        }
        if (!tooLarge) chunks.push(d);
      });
      req.on("end", () => {
        if (tooLarge) return;
        try {
          const j = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
          if (typeof j.id !== "string" || !/^[a-zA-Z0-9-]{1,96}$/.test(j.id) || !pendingCmds.has(j.id)) {
            res.writeHead(409); res.end("unknown command id"); return;
          }
          if (j.ok !== undefined && typeof j.ok !== "boolean") { res.writeHead(400); res.end("ok must be boolean"); return; }
          const value = j.data ?? j.error ?? "ok";
          if (typeof value !== "string") { res.writeHead(400); res.end("result must be text"); return; }
          pendingCmds.delete(j.id);
          cmdResults.set(j.id, { ok: j.ok !== false, data: value.slice(0, 20000), at: Date.now() });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        } catch {
          res.writeHead(400); res.end("bad json");
        }
      });
      return;
    }
    res.writeHead(404); res.end("not found");
  });
  bridgeServer = server;
  bridgeStartPromise = new Promise((resolve, reject) => {
    const onError = (error) => {
      if (bridgeServer === server) bridgeServer = null;
      bridgePortActual = 0;
      bridgeStartPromise = null;
      reject(new Error(`CudeAll kopru portu ${BRIDGE_PORT} acilamadi: ${error.message}`));
    };
    server.once("error", onError);
    server.listen(BRIDGE_PORT, "127.0.0.1", () => {
      server.removeListener("error", onError);
      server.unref(); // opencode stdio sureci yasatir; testlerde bosuna acik kalmasin
      bridgePortActual = server.address()?.port || BRIDGE_PORT;
      resolve(bridgePortActual);
    });
  });
  return bridgeStartPromise;
}

async function extCall(cmd, args = {}, timeoutMs = 25000) {
  await ensureBridge();
  const id = `c${Date.now()}-${++cmdSeq}`;
  pendingCmds.add(id);
  cmdQueue.push({ id, cmd, args });
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (cmdResults.has(id)) {
      const r = cmdResults.get(id);
      cmdResults.delete(id);
      if (!r.ok) throw new Error(`eklenti hatasi: ${r.data}`);
      return r.data;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  pendingCmds.delete(id);
  const queuedAt = cmdQueue.findIndex((x) => x.id === id);
  if (queuedAt >= 0) cmdQueue.splice(queuedAt, 1);
  throw new Error(`Eklenti yanit vermedi. Chrome'da cudeall eklentisi yuklu/etkin mi? Kopru ayakta: http://127.0.0.1:${BRIDGE_PORT}/cudeall/status — eklenti ikonunda "Bagli" gormelisin.`);
}

async function cdpTabs() {
  const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json`, { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`CDP kapali (HTTP ${r.status})`);
  const j = await r.json();
  return j.filter((t) => t.type === "page").map((t) => ({ title: t.title, url: t.url, id: t.id }));
}
async function cdpOpen(url) {
  const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${new URLSearchParams({ url })}`, { method: "PUT", signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`CDP ile sekme acilamadi (HTTP ${r.status})`);
  return await r.json();
}

function fmtRows(tabs) {
  if (!tabs || !tabs.length) return "Acik sekme yok (veya erisim yok).";
  return tabs.slice(0, 30).map((t, i) => `${i + 1}. [${t.groupTitle || t.group || "grupsuz"}] ${t.title || "(baslik yok)"}\n   ${t.url || ""}${t.id ? `  (id=${t.id})` : ""}`).join("\n");
}

async function chromeAction(a) {
  const action = (a.action || "status").toLowerCase();
  const group = String(a.group || "CudeAll");
  if (action === "status") {
    let ext = "bagli degil";
    try {
      await ensureBridge();
      const r = await extCall("status", {}, 4000);
      ext = `bagli (${typeof r === "string" ? r : JSON.stringify(r).slice(0, 120)})`;
    } catch (e) { ext = `bagli degil (${e.message.slice(0, 120)})`; }
    let cdp = "kapali";
    try {
      const tabs = await cdpTabs();
      cdp = `acik (${tabs.length} sekme, port ${CDP_PORT})`;
    } catch { cdp = `kapali (yedek yol icin: .\\start-chrome-debug.ps1 ile baslat)`; }
    return `CHROME DURUMU\n- Eklenti koprusu (:${BRIDGE_PORT}): ${ext}\n- CDP (:${CDP_PORT}): ${cdp}\n- Grup adi: ${group}\n\nCalisma sirasi: eklenti varsa GRUPLU mod, yoksa CDP, ikisi de yoksa kurulum mesaji.`;
  }
  if (action === "tabs" || action === "list") {
    try {
      const raw = await extCall("tabs_list", {}, 15000);
      let tabs = raw;
      try { tabs = JSON.parse(raw); } catch {}
      const body = Array.isArray(tabs) ? fmtRows(tabs) : String(raw).slice(0, 4000);
      return `SEKMELER (eklenti):\n${body}`;
    }
    catch {
      try { return `SEKMELER (CDP yedegi, grupsuz):\n${fmtRows(await cdpTabs())}\n\nNot: grup bilgisi icin eklentiyi kur.`; }
      catch (e2) { throw new Error(`Sekmeler okunamadi. Eklentiyi kur (chrome-extension/README) veya Chrome'u debug modda baslat. Detay: ${e2.message}`); }
    }
  }
  if (action === "group_open") {
    return await extCall("group_open", { group }, 20000);
  }
  if (action === "open") {
    if (!a.url || !/^https?:\/\//.test(a.url)) throw new Error("open icin url gerekli (http(s) ile).");
    try { return await extCall("group_open_url", { url: a.url, group }, 25000); }
    catch {
      const t = await cdpOpen(a.url); // yedek: grupsuz acar
      return `Eklenti yok — CDP ile grupsuz acildi: ${t.title || ""} ${t.url || a.url}\nGruplu mod icin eklentiyi kur.`;
    }
  }
  if (action === "read") {
    try { return await extCall("tab_read", { tabId: a.tabId, maxChars: Math.min(15000, Number(a.maxChars) || 8000) }, 25000); }
    catch { if (a.url) return await webFetch(a.url, 8000) + "\n\n[NOT: canli sekmeden degil, statik cekildi — eklenti bagli degil.]"; throw new Error("Sekme okunamadi: eklenti bagli degil. statik okuma icin url ver ya da eklentiyi kur."); }
  }
  if (action === "click") {
    if (!a.selector && !a.text) throw new Error("click icin selector veya text gerekli (or: selector='#submit' veya text='Gonder').");
    return await extCall("tab_click", { tabId: a.tabId, selector: a.selector, text: a.text }, 25000);
  }
  if (action === "type") {
    if (!a.text) throw new Error("type icin text gerekli.");
    if (!a.selector) throw new Error("type icin selector gerekli (or: selector='input[name=q]').");
    return await extCall("tab_type", { tabId: a.tabId, selector: a.selector, text: a.text, submit: !!a.submit }, 25000);
  }
  if (action === "close") {
    return await extCall("tab_close_group", { group }, 20000);
  }
  throw new Error(`Bilinmeyen chrome action: ${action} (status|tabs|group_open|open|read|click|type|close)`);
}

// ---------- COMPUTER USE (Windows PowerShell; macOS/Linux minimal) ----------
function runPowershell(ps, extraEnv = null) {
  return new Promise((resolve, reject) => {
    execFile("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps], { timeout: 30000, env: extraEnv ? Object.assign({}, process.env, extraEnv) : process.env }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout);
    });
  });
}
// ---------- SAGLAYICI KASASI (DPAPI: anahtar diske acik yazilmaz, sohbete girmez) ----------
const PROVIDERS = {
  openrouter: { env: ["OPENROUTER_API_KEY"], ad: "OpenRouter (free :free modeller)" },
  gemini: { env: ["GEMINI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"], ad: "Google Gemini (comert free katman)" },
  groq: { env: ["GROQ_API_KEY"], ad: "Groq (hizli free katman)" },
  cerebras: { env: ["CEREBRAS_API_KEY"], ad: "Cerebras (hizli free katman)" },
  mistral: { env: ["MISTRAL_API_KEY"], ad: "Mistral (free katman)" },
  deepseek: { env: ["DEEPSEEK_API_KEY"], ad: "DeepSeek (ucuz)" },
  openai: { env: ["OPENAI_API_KEY"], ad: "OpenAI (Codex CLI de bunu kullanir)" },
  anthropic: { env: ["ANTHROPIC_API_KEY"], ad: "Anthropic (Claude Code da bunu kullanir)" },
  tavily: { env: ["TAVILY_API_KEY"], ad: "Tavily (arama kalitesi)" },
  brave: { env: ["BRAVE_API_KEY"], ad: "Brave (arama kalitesi)" },
};
const HOME_DIR = os.homedir();
function cudeDataDir() {
  const d = process.env.APPDATA
    ? join(process.env.APPDATA, "CudeAll")
    : join(HOME_DIR, ".config", "cudeall");
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
}
function vaultFile() {
  return join(cudeDataDir(), "providers.json");
}
function loadVault() {
  try {
    if (!existsSync(vaultFile())) return { items: {} };
    const v = JSON.parse(readFileSync(vaultFile(), "utf8"));
    return v && v.items ? v : { items: {} };
  } catch { return { items: {} }; }
}
async function dpapiProtect(plain) {
  const ps = `Add-Type -AssemblyName System.Security; $b=[Text.Encoding]::UTF8.GetBytes($env:CUDEALL_SECRET); $p=[Security.Cryptography.ProtectedData]::Protect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Convert]::ToBase64String($p)`;
  return (await runPowershell(ps, { CUDEALL_SECRET: plain })).trim();
}
async function dpapiUnprotect(b64) {
  const ps = `Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String($env:CUDEALL_SECRET); $p=[Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Text.Encoding]::UTF8.GetString($p)`;
  return (await runPowershell(ps, { CUDEALL_SECRET: b64 })).trim();
}
async function providerAction(a) {
  const act = (a.action || "status").toLowerCase();
  const vault = loadVault();
  if (act === "list" || act === "status") {
    const lines = Object.entries(PROVIDERS).map(([k, v]) => {
      const kasa = vault.items[k] ? "kasa:VAR" : "kasa:yok";
      const env = v.env.map((e) => `${e}:${process.env[e] ? "var" : "yok"}`).join(" ");
      return `- ${k} (${v.ad})\n  ${kasa} | ${env}`;
    });
    return `SAGLAYICILAR (deger asla gosterilmez)\n${lines.join("\n")}\n\nEkleme: cude_provider(action=add, provider=<ad>) — sana TERMINAL komutu verir, anahtari oraya yapistirirsin (sohbete YAZMA).\nDiger araclara aktarma: cude_provider(action=env_script) — Codex/Claude terminali icin $env yukleyici uretir.\nOpencode baglantisi: plugin, kasa anahtarlarini shell'e OTOMATIK enjekte eder (ayar gerekmez).`;
  }
  if (act === "add") {
    const p = String(a.provider || "").toLowerCase();
    if (!PROVIDERS[p]) throw new Error("Bilinmeyen saglayici: " + (a.provider || "(bos)") + " (" + Object.keys(PROVIDERS).join("|") + ")");
    if (vault.items[p]) return `${p} zaten kasada. Degistirmek icin once remove yap.`;
    // Anahtar BURADA alinmaz (LLM gorurdu). Kullanicinin kendi terminalinde calistiracagi komut:
    // (PS tek-tirnakta tersbolu kacisi gerekmez: yol aynen yazilir)
    const vf = vaultFile();
    const cmd = `$k = Read-Host -AsSecureString '${p} API anahtari (yapistir, Enter)'; $t = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($k); $s = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($t); $b=[Text.Encoding]::UTF8.GetBytes($s); $s=$null; $P=[Security.Cryptography.ProtectedData]::Protect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); $v=@{}; $f='${vf}'; if (Test-Path $f) { $v=(Get-Content $f -Raw | ConvertFrom-Json).items }; $v | Add-Member -NotePropertyName '${p}' -NotePropertyValue @{protected=[Convert]::ToBase64String($P); at=(Get-Date -Format o)} -Force; @{items=$v} | ConvertTo-Json -Depth 5 | Set-Content $f; 'KAYDEDILDI: ${p} (sifreli, sadece bu Windows kullanicisi acar)'`;
    return `ADIM ADIM (anahtar sohbete YAZILMAZ):\n1. Asagidaki komutu KENDI PowerShell pencerene yapistir, Enter'a bas.\n2. Anahtari istendiginde yapistir (yazi gorunmez, guvenlidir).\n3. Sonra burada cude_provider(action=list) ile "kasa:VAR" gor.\n\nKomut:\n${cmd}`;
  }
  if (act === "remove") {
    const p = String(a.provider || "").toLowerCase();
    if (!vault.items[p]) return `${p} zaten kasada yok.`;
    delete vault.items[p];
    writeFileSync(vaultFile(), JSON.stringify(vault, null, 1), "utf8");
    return `Silindi: ${p}. Opencode baglantisi da kesildi (plugin artik enjekte etmez).`;
  }
  if (act === "env_script") {
    // Codex/Claude terminali icin: kasayi bu oturuma $env olarak yukleyen betik
    const f = join(cudeDataDir(), "load-providers.ps1");
    const vf = vaultFile();
    const script = `# CudeAll saglayici yukleyici — terminalde bir kez calistir: . '${f}'\n# Kasa DPAPI sifrelidir; sadece bu Windows kullanicisi acabilir. Anahtarlar ekrana YAZILMAZ.\n$ErrorActionPreference = 'Stop'\nAdd-Type -AssemblyName System.Security\n$f = '${vf}'\nif (!(Test-Path $f)) { Write-Host 'Kasa bos: once cude_provider(action=add) ile ekle.'; return }\n$items = (Get-Content $f -Raw | ConvertFrom-Json).items\n`;
    const mapLines = Object.entries(PROVIDERS).map(([k, v]) => `  '${k}' = @(${v.env.map((e) => `'${e}'`).join(", ")})`).join("\n");
    const tail = `$map = @{\n${mapLines}\n}\nforeach ($p in $map.Keys) {\n  if ($items.$p -and $items.$p.protected) {\n    $b = [Convert]::FromBase64String($items.$p.protected)\n    $s = [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($b, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser))\n    foreach ($e in $map[$p]) { Set-Item \"env:$e\" $s }\n    $s = $null\n  }\n}\nWrite-Host ('Yuklendi: ' + (($map.Keys | Where-Object { $items.$_ }) -join ', '))\n`;
    writeFileSync(f, script + tail, "utf8");
    return `Betik hazir: ${f}\nKullanim (Codex/Claude calistiracagin terminalde):\n. '${f}'\nSonra ayni pencerede codex / claude calistir — anahtarlari $env'den gorurler. Degerler ekrana yazilmaz.`;
  }
  throw new Error("Bilinmeyen provider action: " + act + " (status|list|add|remove|env_script)");
}
let lastShotAt = 0; // guvenli otonomi: tiklamadan once bakmak sart
function needFreshLook(action) {
  if (Date.now() - lastShotAt > 180000) {
    throw new Error(`Guvenlik: '${action}' icin once guncel ekran goruntusu sart (son goruntu 3 dk'dan eski/yok). Once cude_computer(action=screenshot) al, koordinati gor, sonra ${action} yap.`);
  }
}
async function computerAction(a) {
  const action = (a.action || "info").toLowerCase();
  const plat = os.platform();
  if (action === "info") return `platform=${plat} release=${os.release()} arch=${os.arch()} headless=${process.env.CUDEALL_HEADLESS || "auto"}`;
  if (plat !== "win32") {
    if (action === "screenshot") {
      // Linux/macOS: scrot/screencapture varsa
      const cmd = plat === "darwin" ? "screencapture" : "scrot";
      return await new Promise((resolve) => {
        const p = join(os.tmpdir(), `cudeall-${Date.now()}.png`);
        const bin = plat === "darwin" ? "screencapture" : "import";
        execFile(bin, plat === "darwin" ? ["-x", p] : [p], (err) => {
          resolve(err ? `Bu platformda otomatik screenshot destegi yok (${err.message}).` : `Ekran goruntusu: ${p}`);
        });
      });
    }
    return `computer aksiyonu '${action}' su an sadece Windows'ta tam destekli.`;
  }
  if (action === "selftest") {
    // Salt-okunur: fare/ekran altyapisini SIFIR yan etkiyle dogrular (imlec oynatmaz, tiklamaz, yazmaz)
    const ps = `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern bool GetCursorPos([ref]Drawing.Point p);' -Name U32c -Namespace Wc; $b=[Windows.Forms.SystemInformation]::VirtualScreen; $pt=New-Object Drawing.Point; [Wc.U32c]::GetCursorPos([ref]$pt)|Out-Null; $t=[Windows.Forms.SendKeys]; "SCREEN=$($b.Width)x$($b.Height) CURSOR=$($pt.X),$($pt.Y) SENDKEYS=OK"`;
    const out = (await runPowershell(ps)).trim();
    return `SELFTEST OK (yan etki yok): ${out} | son-goruntu: ${lastShotAt ? new Date(lastShotAt).toLocaleTimeString("tr-TR") : "yok — tiklamadan once screenshot sart"}`;
  }
  if (action === "screenshot") {
    const p = a.path || join(os.tmpdir(), `cudeall-${Date.now()}.png`);
    const ps = `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $b=[Windows.Forms.SystemInformation]::VirtualScreen; $bmp=New-Object Drawing.Bitmap($b.Width,$b.Height); $g=[Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Location,[Drawing.Point]::Empty,$b.Size); $bmp.Save('${p.replace(/'/g, "''")}'); $g.Dispose(); $bmp.Dispose(); '${p}'`;
    const out = await runPowershell(ps);
    lastShotAt = Date.now();
    return `Ekran goruntusu: ${out.trim() || p} (read ile ac, modele goster)`;
  }
  if (action === "click" || action === "double_click" || action === "right_click") {
    needFreshLook(action);
    const x = Number(a.x), y = Number(a.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("click icin x,y gerekli (orn: 640, 480). Once screenshot alip koordinat sec.");
    const btn = action === "right_click" ? "Right" : "Left";
    const clicks = action === "double_click" ? 2 : 1;
    const ps = `Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetCursorPos(int X,int Y); [DllImport("user32.dll")] public static extern void mouse_event(int dwFlags,int dx,int dy,int dwData,int dwExtra);' -Name U32 -Namespace W; [W.U32]::SetCursorPos(${x|0},${y|0}); Start-Sleep -m 120; $d=0x0002; $u=0x0004; if('${btn}'-eq'Right'){$d=0x0008;$u=0x0010} for($i=0;$i -lt ${clicks};$i++){[W.U32]::mouse_event($d,0,0,0,0); Start-Sleep -m 60; [W.U32]::mouse_event($u,0,0,0,0); Start-Sleep -m 120} 'OK ${btn}x${clicks} @ ${x|0},${y|0}'`;
    return (await runPowershell(ps)).trim();
  }
  if (action === "type") {
    needFreshLook(action);
    const text = String(a.text || "");
    if (!text) throw new Error("type icin text gerekli.");
    const esc = text.replace(/'/g, "''").replace(/\n/g, "`n");
    // Odaklanmis pencereye yazar; tiklamadan once click kullan.
    return (await runPowershell(`Add-Type -AssemblyName System.Windows.Forms; [Windows.Forms.SendKeys]::SendWait('${esc}'); 'OK typed ${text.length} chars'`)).trim();
  }
  if (action === "key") {
    needFreshLook(action);
    const key = String(a.key || "Enter");
    return (await runPowershell(`Add-Type -AssemblyName System.Windows.Forms; [Windows.Forms.SendKeys]::SendWait('{${key.replace(/'/g, "")}}'); 'OK key ${key}'`)).trim();
  }
  if (action === "scroll") {
    needFreshLook(action);
    const amt = Number(a.amount) || -120;
    const ps = `Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern void mouse_event(int dwFlags,int dx,int dy,int dwData,int dwExtra);' -Name U32b -Namespace Wb; [Wb.U32b]::mouse_event(0x0800,0,0,${amt|0},0); 'OK scroll ${amt|0}'`;
    return (await runPowershell(ps)).trim();
  }
  throw new Error(`Bilinmeyen computer action: ${action} (info|selftest|screenshot|click|double_click|right_click|type|key|scroll)`);
}

// ---------- AUTOMATION (kendine otomasyon yazma) ----------
function safeName(n) {
  const s = String(n || "").replace(/[^a-zA-Z0-9-_]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  if (!s) throw new Error("gecerli name gerekli (or: gunluk-ozet)");
  return s;
}
async function automationAction(a) {
  const action = (a.action || "list").toLowerCase();
  const dir = automationsDir();
  if (action === "list") {
    const files = readdirSync(dir).filter((f) => f.endsWith(".mjs"));
    if (!files.length) return `Otomasyon yok. cude_automation(action=save, name, script) ile ilkini yaz.\nKlasor: ${dir}`;
    return files.map((f) => `- ${basename(f, ".mjs")} (${join(dir, f)})`).join("\n");
  }
  if (action === "save") {
    const name = safeName(a.name);
    const script = String(a.script || "");
    if (script.length < 20) throw new Error("script cok kisa. Calisir bir node ESM kodu ver.");
    if (/rm\s+-rf\s+\/|format\s+C:|powershell.*-EncodedCommand/i.test(script)) throw new Error("Guvenlik: yikici komutlar automation olarak kaydedilemez.");
    writeFileSync(join(dir, name + ".mjs"), script, "utf8");
    return `Kaydedildi: ${name}\nCalistir: cude_automation(action=run, name=${name})`;
  }
  if (action === "run") {
    const name = safeName(a.name);
    const file = join(dir, name + ".mjs");
    if (!existsSync(file)) throw new Error(`Bulunamadi: ${name}. Once list ile bak.`);
    const args = Array.isArray(a.args) ? a.args : [];
    return await new Promise((resolve) => {
      const p = spawn(process.execPath, [file, ...args.map(String)], { timeout: 60000 });
      let out = "", err = "";
      p.stdout.on("data", (d) => (out += d));
      p.stderr.on("data", (d) => (err += d));
      p.on("error", (e) => resolve(`HATA: ${e.message}`));
      p.on("close", (code) => resolve(`exit=${code}\n--- stdout ---\n${out.slice(0, 8000)}\n${err ? "--- stderr ---\n" + err.slice(0, 3000) : ""}`));
    });
  }
  if (action === "delete") {
    const name = safeName(a.name);
    rmSync(join(dir, name + ".mjs"), { force: true });
    return `Silindi: ${name}`;
  }
  throw new Error(`Bilinmeyen automation action: ${action} (list|save|run|delete)`);
}

// ---------- GECMIS (Claude / Codex / opencode konusmalarini okuma-devam) ----------
// Hicbir anahtar gerekmez: resmi uygulamalarin kendi kayit klasorlerini okur.
// Claude Code: ~/.claude/projects/<proje>/*.jsonl | Codex: ~/.codex/sessions/*.jsonl
// opencode: veri klasorundeki session dosyalari (bulunursa).
function historySources() {
  const c = {
    claude: [process.env.CUDEALL_CLAUDE_DIR, join(HOME_DIR, ".claude", "projects")],
    codex: [process.env.CUDEALL_CODEX_DIR, join(HOME_DIR, ".codex", "sessions")],
    opencode: [process.env.CUDEALL_OPENCODE_DATA, join(HOME_DIR, ".local", "share", "opencode"), process.env.APPDATA ? join(process.env.APPDATA, "opencode") : null],
  };
  const out = {};
  for (const [k, dirs] of Object.entries(c)) out[k] = dirs.filter(Boolean).filter((d) => { try { return existsSync(d); } catch { return false; } });
  return out;
}
function walkJsonl(dir, depth = 3) {
  let files = [];
  try {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (depth > 0) files = files.concat(walkJsonl(p, depth - 1)); }
      else if (/\.jsonl?$/.test(e.name)) files.push(p);
    }
  } catch {}
  return files;
}
// Toleransli cikarici: Claude, Codex ve opencode formatlarinin hepsini dener.
function claudeChunks(j) {
  const out = [];
  if (j.type === "user" && j.message) {
    const c = j.message.content;
    if (typeof c === "string" && c.trim()) out.push({ role: "user", text: c });
    else if (Array.isArray(c)) for (const it of c) {
      if (it && it.type === "text" && it.text) out.push({ role: "user", text: it.text });
    }
    // tool_result / dusunme / meta satirlari bilerek atlanir (gurultu)
  } else if (j.type === "assistant" && j.message && Array.isArray(j.message.content)) {
    for (const it of j.message.content) {
      if (it && it.type === "text" && it.text) out.push({ role: "assistant", text: it.text });
      else if (it && it.type === "tool_use") out.push({ role: "-", text: `[arac: ${it.name || "?"}]` });
    }
  }
  return out;
}
function codexChunks(j) {
  const out = [];
  if (j.type === "response_item" && j.payload) {
    const p = j.payload;
    if (p.type === "message" && Array.isArray(p.content) && p.role !== "developer") {
      for (const it of p.content) {
        if (it && (it.type === "input_text" || it.type === "output_text") && it.text) {
          const t = String(it.text);
          if (/^<(recommended_plugins|environment_context)>/.test(t.trim())) continue; // sistem balonu, gurultu
          out.push({ role: p.role || "?", text: it.text });
        }
      }
    } else if (p.type === "function_call") out.push({ role: "-", text: `[arac: ${p.name || "?"}]` });
    else if (p.type === "custom_tool_call") out.push({ role: "-", text: `[arac: ${p.name || p.tool || "?"}]` });
  }
  return out;
}
function parseLine(j, source) {
  if (source === "claude") { const c = claudeChunks(j); if (c.length) return c; }
  if (source === "codex") { const c = codexChunks(j); if (c.length) return c; }
  return [];
}
function extractChunks(obj, acc = []) {
  if (acc.length > 200) return acc;
  if (typeof obj === "string") { if (obj.trim().length > 1) acc.push({ role: "?", text: obj }); return acc; }
  if (Array.isArray(obj)) { for (const x of obj) extractChunks(x, acc); return acc; }
  if (obj && typeof obj === "object") {
    const role = obj.role || obj.speaker || obj.author;
    for (const [k, v] of Object.entries(obj)) {
      if ((k === "text" || k === "content" || k === "message" || k === "input" || k === "output") && (typeof v === "string") && v.trim()) {
        if (/^(system-reminder|hook|meta|<|$)/.test(v.trim())) continue;
        acc.push({ role: typeof role === "string" ? role : "?", text: v });
      } else extractChunks(v, acc);
      if (acc.length > 200) break;
    }
  }
  return acc;
}
function readTranscript(file, maxChars = 12000, source = "") {
  const raw = readFileSync(file, "utf8");
  const lines = raw.split("\n").filter((l) => l.trim());
  const chunks = [];
  for (const ln of lines.slice(-600)) { // kotanin doldugu yer genelde sonda
    let j = null;
    try { j = JSON.parse(ln); } catch { continue; }
    const hit = parseLine(j, source);
    if (hit.length) { for (const c of hit) { chunks.push(c); if (chunks.length > 120) break; } }
    else if (!source) extractChunks(j, chunks); // kaynaksiz genel tarama
    if (chunks.length > 120) break;
  }
  if (!chunks.length) { // yapisal boslukta genel taramaya dus
    for (const ln of lines.slice(-200)) {
      try { extractChunks(JSON.parse(ln), chunks); } catch {}
      if (chunks.length > 60) break;
    }
  }
  // ardarda ayni rolde ezber kirp, uzunu kisalt
  let out = "", n = 0;
  for (const c of chunks.slice(-60)) {
    const role = /user|human|input/i.test(c.role) ? "KULLANICI" : /assistant|ai|output|model/i.test(c.role) ? "ASISTAN" : "BILGI";
    const t = c.text.replace(/\s+/g, " ").trim().slice(0, 600);
    if (!t || t.length < 3) continue;
    out += `\n[${role}] ${t}\n`;
    if (++n >= 40 || out.length > maxChars) break;
  }
  return out.trim() || "(bos/okunamadi)";
}
function fileMeta(f) {
  try {
    const s = statSync(f);
    return { mtime: s.mtimeMs, size: s.size };
  } catch { return { mtime: 0, size: 0 }; }
}
async function opencodeDb() {
  try {
    const { DatabaseSync } = await import("node:sqlite");
    for (const d of historySources().opencode) {
      const f = join(d, "opencode.db");
      try { if (existsSync(f)) return new DatabaseSync(f, { readOnly: true }); } catch {}
    }
  } catch {}
  return null;
}
async function opencodeList() {
  const db = await opencodeDb();
  if (!db) return "(opencode.db bulunamadi — opencode bu makinede calismamis olabilir)";
  try {
    const rows = db.prepare("SELECT id,title,directory,time_updated FROM session ORDER BY time_updated DESC LIMIT 12").all();
    if (!rows.length) return "(oturum yok)";
    return rows.map((r) => `- ${r.id} | ${new Date(r.time_updated).toLocaleString("tr-TR")} | ${r.title} [${r.directory}]`).join("\n");
  } finally { db.close(); }
}
async function opencodeRead(needle, maxChars = 12000) {
  const db = await opencodeDb();
  if (!db) throw new Error("opencode.db bulunamadi.");
  try {
    const sessions = db.prepare("SELECT id,title FROM session").all();
    const n = String(needle).toLowerCase();
    const ses = sessions.find((s) => s.id.toLowerCase().includes(n) || (s.title || "").toLowerCase().includes(n));
    if (!ses) throw new Error(`opencode oturumu bulunamadi: '${needle}'. list ile bak.`);
    const rows = db.prepare("SELECT m.data md, p.data pd FROM message m LEFT JOIN part p ON p.message_id=m.id WHERE m.session_id=? ORDER BY m.time_created, p.time_created").all(ses.id);
    let out = `# opencode / ${ses.title} (${ses.id})\n`;
    let count = 0;
    for (const r of rows.slice(-160)) {
      let role = "?";
      try { role = JSON.parse(r.md).role || "?"; } catch {}
      if (!r.pd) continue;
      let p;
      try { p = JSON.parse(r.pd); } catch { continue; }
      if (p.type !== "text" || !p.text || !String(p.text).trim()) continue;
      const who = /user/i.test(role) ? "KULLANICI" : "ASISTAN";
      out += `\n[${who}] ${String(p.text).replace(/\s+/g, " ").trim().slice(0, 600)}\n`;
      if (++count >= 40 || out.length > maxChars) break;
    }
    return out.trim();
  } finally { db.close(); }
}
async function latestSession(onlySource = "") {
  const src = historySources();
  const want = onlySource ? [onlySource] : ["claude", "codex", "opencode"];
  let best = null;
  for (const s of ["claude", "codex"]) {
    if (!want.includes(s)) continue;
    for (const d of src[s] || []) {
      for (const f of walkJsonl(d, 5)) {
        const m = fileMeta(f).mtime;
        if (m && (!best || m > best.mtime)) best = { source: s, file: basename(f), mtime: m };
      }
    }
  }
  if (want.includes("opencode")) {
    try {
      const db = await opencodeDb();
      if (db) {
        try {
          const r = db.prepare("SELECT id,title,time_updated FROM session ORDER BY time_updated DESC LIMIT 1").get();
          if (r && (!best || r.time_updated > best.mtime)) best = { source: "opencode", file: r.id, mtime: r.time_updated, label: r.title };
        } finally { db.close(); }
      }
    } catch {}
  }
  return best;
}
async function historyAction(a) {
  const act = (a.action || "list").toLowerCase();
  const src = historySources();
  if (act === "sources") {
    return Object.entries(src).map(([k, v]) => `- ${k}: ${v.length ? v.join(", ") : "(bulunamadi — ilgili uygulama bu makinede konusma kaydetmemis)"}`).join("\n");
  }
  if (act === "list") {
    const want = a.source ? [String(a.source).toLowerCase()] : ["claude", "codex", "opencode"];
    let out = "";
    for (const s of want) {
      if (s === "opencode") { out += `\n## opencode (son oturumlar)\n${await opencodeList()}\n`; continue; }
      const dirs = src[s] || [];
      if (!dirs.length) { out += `\n## ${s}\n(yok)\n`; continue; }
      let files = [];
      for (const d of dirs) files = files.concat(walkJsonl(d, s === "claude" ? 2 : 5));
      files = files.map((f) => ({ f, ...fileMeta(f) })).sort((x, y) => y.mtime - x.mtime).slice(0, 12);
      out += `\n## ${s} (son ${files.length})\n`;
      if (!files.length) { out += "(dosya yok)\n"; continue; }
      for (const { f, mtime } of files) {
        let prev = "";
        try {
          const raw = readFileSync(f, "utf8").split("\n").filter((l) => l.trim());
          for (const ln of raw.slice(0, 60)) {
            try {
              const ch = parseLine(JSON.parse(ln), s).filter((c) => /user/i.test(c.role || ""));
              if (ch.length) { prev = ch[0].text.replace(/\s+/g, " ").slice(0, 110); break; }
            } catch {}
          }
        } catch {}
        out += `- ${basename(f)} | ${new Date(mtime).toLocaleString("tr-TR")} | ${prev || "(onizleme yok)"}\n`;
      }
    }
    return out.trim() + `\n\nOkumak icin: cude_history(action=read, source=<claude|codex|opencode>, file=<dosya adindan parca>)`;
  }
  if (act === "read" || act === "continue") {
    let s = String(a.source || "").toLowerCase();
    let needle = String(a.file || "").toLowerCase();
    if (act === "continue" && !needle) {
      // Dosya verilmediyse: tum kaynaklarda EN SON yarim isi otomatik bul (sifir ugras devralma)
      const filt = ["claude", "codex", "opencode"].includes(s) ? s : "";
      const L = await latestSession(filt);
      if (!L) throw new Error("Devralinacak konusma bulunamadi (kaynaklar bos).");
      s = L.source;
      needle = L.file.toLowerCase();
    }
    let body, label;
    if (s === "opencode") {
      body = await opencodeRead(needle, Math.min(20000, Number(a.maxChars) || 12000));
      label = `${s} / ${needle}`;
    } else {
      let files = [];
      for (const d of src[s] || []) files = files.concat(walkJsonl(d, 5));
      // guvenlik: sadece kayit klasorleri ici, disari cikis yok
      const hit = files.find((f) => basename(f).toLowerCase().includes(needle));
      if (!hit) throw new Error(`Bulunamadi: '${needle}' (${s}). Once list ile bak.`);
      body = readTranscript(hit, Math.min(20000, Number(a.maxChars) || 12000), s);
      label = `${s} / ${basename(hit)}`;
    }
    if (act === "read") return `# ${label}\n${body}`;
    return `# KALDIGI YERDEN DEVAM — ${label}\n\nAsagidaki konusma baska aracin kotasi/oturumu bittigi icin yarim kaldi. Gorevi BURADA devam ettir:\n1. Son 5 mesaji baz al, mevcut durumu ozetle (2-3 cumle).\n2. Yarim kalan adimi tespit et, planda goster.\n3. cude_memory(action=write, key=devam-<kisa-ad>, value=<durum>) ile isaret birak.\n4. Hedefi sor ya da cude_goal ile sabitle, ise gir.\n\n--- KONUSMA ---\n${body}`;
  }
  throw new Error("Bilinmeyen history action: " + act + " (sources|list|read|continue)");
}

// ---------- KURULUM (arac kendi araclarini kursun) ----------
async function setupAction(a) {
  const act = (a.action || "status").toLowerCase();
  if (act === "status") {
    const pw = await tryPlaywright();
    let ext = "bagli degil";
    try { await extCall("status", {}, 3000); ext = "bagli"; } catch (e) { ext = "bagli degil"; }
    let cdp = "kapali";
    try { const t = await cdpTabs(); cdp = `acik (${t.length} sekme)`; } catch {}
    const src = historySources();
    const hist = Object.entries(src).map(([k, v]) => `${k}:${v.length ? "var" : "yok"}`).join(" ");
    return `CUDEALL DURUM (anahtar gerekmez)\n- node: ${process.version}\n- playwright paketi: ${pw ? "kurulu" : "yok (install_browser ile tek komutla kurulur)"}\n- chrome eklentisi: ${ext}\n- CDP: ${cdp}\n- konusma kayitlari: ${hist}\n- kopru portu: ${BRIDGE_PORT}\n\nTek komutla tamir: cude_setup(action=install_browser) — chromium'u indirir. Eklenti kurulumu: chrome-extension/README (2 dk, bir kez).`;
  }
  if (act === "install_browser") {
    if (await tryPlaywright()) {
      try { await browserAction({ action: "open", url: "about:blank" }); return "Playwright zaten calisiyor (tarayici hazir)."; }
      catch {}
    }
    const isWin = process.platform === "win32";
    const steps = isWin
      ? [["cmd", ["/c", "npm", "install", "--no-audit", "--no-fund"], join(cwdRoot(), "mcp-cudeall")], ["cmd", ["/c", "npx", "-y", "playwright@latest", "install", "chromium"], cwdRoot()]]
      : [["npm", ["install", "--no-audit", "--no-fund"], join(cwdRoot(), "mcp-cudeall")], ["npx", ["-y", "playwright@latest", "install", "chromium"], cwdRoot()]];
    let log = "";
    for (const [cmd, cmdArgs, cwd] of steps) {
      const r = await new Promise((resolve) => {
        const p = spawn(cmd, cmdArgs, { timeout: 600000, cwd });
        let out = "", err = "";
        p.stdout.on("data", (d) => (out += d));
        p.stderr.on("data", (d) => (err += d));
        p.on("error", (e) => resolve({ code: 99, tail: `HATA: ${e.message}` }));
        p.on("close", (code) => resolve({ code, tail: (out + "\n" + err).slice(-800) }));
      });
      log += `\n$ ${cmd} ${cmdArgs.join(" ")}\n${r.tail}`;
      if (r.code !== 0) return `Kurulum yarida kaldi (exit=${r.code}). Internet/disk kontrol et, tekrar dene.\n${log.slice(-1500)}`;
    }
    if (await tryPlaywright()) return `Playwright + Chromium hazir. Artik cude_browser tam guclu.\n${log.slice(-1500)}`;
    return `Kurulum bitti ama paket yuklenemedi. 'npm install' ciktisina bak:\n${log.slice(-1500)}`;
  }
  if (act === "models") {
    // Free provider + model gorunurlugu + effort yonlendirme. SIR KURALI:
    // env DEGERLERI asla okunmaz/yazilmaz/loglanmaz — sadece "var/yok" bakilir.
    const KEYS = ["OPENROUTER_API_KEY", "GEMINI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "GROQ_API_KEY", "CEREBRAS_API_KEY", "MISTRAL_API_KEY", "DEEPSEEK_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "TAVILY_API_KEY", "BRAVE_API_KEY"];
    const keys = KEYS.map((k) => `${k}:${process.env[k] ? "var" : "yok"}`).join(" ");
    let ollama = "yok", lmstudio = "yok";
    try {
      const r = await fetch("http://127.0.0.1:11434/api/tags", { signal: AbortSignal.timeout(3000) });
      if (r.ok) { const j = await r.json(); ollama = `var (${(j.models || []).map((m) => m.name).join(", ").slice(0, 200) || "model yok"})`; }
    } catch {}
    try {
      const r = await fetch("http://127.0.0.1:1234/v1/models", { signal: AbortSignal.timeout(3000) });
      if (r.ok) { const j = await r.json(); lmstudio = `var (${(j.data || []).map((m) => m.id).join(", ").slice(0, 200) || "model yok"})`; }
    } catch {}
    // Kullanicinin global opencode configindeki modeller (isim listesi, anahtar yok)
    let cfgModels = "(global config okunamadi)";
    try {
      const g = join(HOME_DIR, ".config", "opencode", "opencode.jsonc");
      const g2 = join(HOME_DIR, ".config", "opencode", "opencode.json");
      const f = existsSync(g) ? g : existsSync(g2) ? g2 : null;
      if (f) {
        const c = JSON.parse(readFileSync(f, "utf8"));
        const lines = [`ana model: ${c.model || "-"}`, `kucuk model: ${c.small_model || "-"}`];
        for (const [p, v] of Object.entries(c.provider || {})) {
          const ms = Object.keys(v.models || {});
          lines.push(`${p}: ${ms.length ? ms.join(", ") : "(liste yok)"}`);
        }
        cfgModels = lines.join("\n");
      }
    } catch {}
    const vaultNames = Object.keys(loadVault().items || {});
    const vaultLine = vaultNames.length ? vaultNames.join(", ") : "bos (ekle: cude_provider(action=add))";
    return `MODEL + PROVIDER DURUMU (sadece isimler, anahtar asla gosterilmez)\n\n[Senin bagli modellerin]\n${cfgModels}\n\n[Kasa: ${vaultLine}]\n\n[Env anahtarlari: var/yok]\n${keys}\n\n[Yerel (ucretsiz + sinirsiz)]\n- Ollama (11434): ${ollama}${ollama === "yok" ? " — kur: https://ollama.com, sonra model cek: ollama pull qwen3" : ""}\n- LM Studio (1234): ${lmstudio}\n\n[Ucretsiz baslangiclar (anahtar al, bedava kullan)]\n- OpenRouter: :free biten modeller (OPENROUTER_API_KEY)\n- Google Gemini: comert ucretsiz katman (GEMINI_API_KEY)\n- Groq / Cerebras: hizli ucretsiz katman\n- Pollinations: anahtarsiz metin API'si\n\n[EFFORT secimi — kota/limit dostu]\n- Onemsiz (yeniden adlandir, log, regex): small_model/haiku — ana kotaya DOKUNMA\n- Normal (ozellik, test, refactor): ana model\n- Zor (derin debug, mimari): listedeki EN GUCLU model + plan komutu\n- Kota biterse: free/yerele dus, isi 'cude_history(action=continue)' ile tasi`;
  }
  if (act === "doctor") {
    // Kendi kendine muayene + guvenli oto-tamir. Yikici is YOK, dis API YOK.
    const here = dirname(fileURLToPath(import.meta.url)); // mcp-cudeall/
    const root = join(here, ".."); // proje koku (cwd'den bagimsiz, sasmaz)
    const rows = [];
    const ok = (ad, durum, not = "") => rows.push(`- [${durum ? "OK" : "BOZUK"}] ${ad}${not ? " — " + not : ""}`);
    ok("node " + process.version, Number(process.version.slice(1).split(".")[0]) >= 18);
    for (const f of ["server.mjs", "package.json"]) ok("mcp/" + f, existsSync(join(here, f)));
    for (const f of [".opencode/plugins/cudeall.js", ".opencode/skills/cudeall/SKILL.md", "opencode.json", "kurulum.bat", "eklenti-kur.bat", "global-install.cjs", "chrome-extension/manifest.json", "chrome-extension/background.js"]) ok(f, existsSync(join(root, f)));
    ok(".opencode/lib/project-spine.mjs", existsSync(join(root, ".opencode", "lib", "project-spine.mjs")));
    ok(".opencode/lib/spine.mjs (omurga)", existsSync(join(root, ".opencode", "lib", "spine.mjs")), "proje baglami + arac kesfi + adapter + kanit");
    try {
      const cap = capabilities(root);
      const adapters = Object.keys(cap.spine.adapters || {});
      ok(`omurga adapterlari (${adapters.length})`, adapters.length >= 1, adapters.length ? adapters.join(", ") : "cude_spine(action=adapters) ile AGENTS.md/CLAUDE.md bloklarini yaz");
    } catch (e) { ok("omurga adapterlari", false, String(e.message || e).slice(0, 100)); }
    let cmds = 0;
    try { cmds = readdirSync(join(root, ".opencode", "commands")).filter((f) => f.endsWith(".md")).length; } catch {}
    ok(`komutlar (${cmds})`, cmds >= 12, cmds >= 12 ? "12 komut (omurga/spine dahil)" : "eksik komut var");
    // guvenli oto-tamir: eksik klasorleri sessizce ac
    for (const d of [".opencode/automations", ".opencode/qa", ".opencode/orchestrator"]) {
      try { mkdirSync(join(root, d), { recursive: true }); } catch {}
    }
    ok("calisma klasorleri", true, "automations/qa/orchestrator acildi/dogrulandi");
    const tests = existsSync(join(here, "test", "spine.test.mjs")) && existsSync(join(here, "test", "handoff.test.mjs"));
    ok("omurga testleri", tests, tests ? "npm test (mcp-cudeall) omurga + handoff + kopru guvenligini kosar" : "test/spine.test.mjs eksik");
    // global baglanti (sadece rapor; degisiklik global-install.cjs ile)
    let g = "yok";
    try {
      for (const f of [join(HOME_DIR, ".config", "opencode", "opencode.jsonc"), join(HOME_DIR, ".config", "opencode", "opencode.json")]) {
        if (existsSync(f)) {
          const c = JSON.parse(readFileSync(f, "utf8"));
          if (c.mcp && c.mcp.cudeall) { g = "bagli (" + f.split(/[\\/]/).pop() + ")"; break; }
          g = "MCP eksik (" + f.split(/[\\/]/).pop() + " var, anahtar yok)";
        }
      }
    } catch { g = "okunamadi"; }
    ok("global baglanti", g.startsWith("bagli"), g);
    const pw = await tryPlaywright();
    ok("playwright", !!pw, pw ? "web motoru hazir" : "install_browser ile kurulur");
    const src = historySources();
    ok("konusma kayitlari", Object.values(src).some((v) => v.length), Object.entries(src).map(([k, v]) => `${k}:${v.length ? "var" : "yok"}`).join(" "));
    const bad = rows.filter((r) => r.startsWith("- [BOZUK]")).length;
    return `DOKTOR RAPORU (yerel, anahtarsiz)\n${rows.join("\n")}\n\nHukum: ${bad ? bad + " sorun var — ustteki BOZUK satirlarin cozumune bak" : "SORUNSUZ. Bicilmis kaftan."}`;
  }
  throw new Error("Bilinmeyen setup action: " + act + " (status|install_browser|models|doctor)");
}

// ---------- ORKESTRATOR (Claude Code + Codex + opencode tek cati) ----------
// Felsefe: 3 arac da bu makinede zaten kurulu/kayitli olabilir; hepsini
// tek komutla kostur, ortak panoda bulustur. Ucret: her arac kendi
// aboneligini/kotasini kullanir (opencode bacagi free/yerele dusebilir).
// Baglanti: dosya tabanli pano (.opencode/orchestrator/<id>/) — 3 arac da
// dosya okuyabildigi icin birbirinin isini gorebilir, zincirlenebilir.
function orchDir() {
  const d = join(opencodeDir(), "orchestrator");
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
}
function whichBin(bin) {
  return new Promise((resolve) => {
    const probe = process.platform === "win32" ? "where" : "which";
    execFile(probe, [bin], { timeout: 8000 }, (err, stdout) => {
      if (!err) {
        const hit = stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
        if (hit) return resolve(hit);
      }
      // Yedek: npm global + bilinen kurulum yollari (PATH eksikligine karsi).
      // Windows'ta .cmd ONCE (uzantisiz 'codex' dosyasi shell Betigi, calismaz).
      const cands = [];
      if (process.env.APPDATA) {
        if (process.platform === "win32") cands.push(join(process.env.APPDATA, "npm", bin + ".cmd"));
        cands.push(join(process.env.APPDATA, "npm", bin));
      }
      if (process.env.LOCALAPPDATA) cands.push(join(process.env.LOCALAPPDATA, "AnthropicClaude", "claude.exe"));
      cands.push(join(HOME_DIR, ".codex", "codex.exe"));
      for (const c of cands) { try { if (existsSync(c)) return resolve(c); } catch {} }
      resolve(null);
    });
  });
}
function cmdFor(bin, args) {
  // Windows'ta .cmd/.bat dogrudan spawn edilemez -> cmd /c ile sar
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(bin)) return { bin: "cmd", args: ["/c", bin, ...args] };
  return { bin, args };
}
async function detectAgents() {
  const out = {};
  for (const name of ["claude", "codex", "opencode"]) {
    const bin = await whichBin(name);
    if (!bin) { out[name] = { ok: false, neden: "CLI bulunamadi (PATH ve bilinen yollarda yok)" }; continue; }
    const c = cmdFor(bin, ["--version"]);
    const ver = await new Promise((resolve) => {
      execFile(c.bin, c.args, { timeout: 10000 }, (err, stdout, stderr) => {
        resolve(err ? "surum okunamadi" : (stdout || stderr || "").trim().slice(0, 120));
      });
    });
    out[name] = { ok: true, bin, ver };
  }
  return out;
}
function runAgentCmd(bin, args, cwd, timeoutMs) {
  return new Promise((resolve) => {
    const c = cmdFor(bin, args);
    // stdin kapali: ajan soru soramaz, takilmaz; ya yapar ya hata verir (timeout oldurur)
    const p = spawn(c.bin, c.args, { timeout: timeoutMs, cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "", done = false;
    const fin = (code, signal) => {
      if (done) return;
      done = true;
      resolve({ code: code ?? 99, signal: signal || null, out, err });
    };
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) => fin(99, "spawn-error:" + e.message));
    p.on("exit", (code, signal) => fin(code, signal));
  });
}
async function orchestrateAction(a) {
  const act = (a.action || "status").toLowerCase();
  if (act === "status") {
    const det = await detectAgents();
    const lines = Object.entries(det).map(([k, v]) => `- ${k}: ${v.ok ? `VAR (${v.ver})` : "yok — " + v.neden}`);
    let tasks = [];
    try { tasks = readdirSync(orchDir()).filter((f) => !f.startsWith(".")); } catch {}
    return `ORKESTRATOR DURUMU\n${lines.join("\n")}\n- pano: ${orchDir()} (${tasks.length} gorev: ${tasks.slice(-5).join(", ") || "yok"})\n\nKullanim: dispatch(task, agents=[claude|codex|opencode], mode=readonly|auto) → read(id) ile sonuclari topla.\nUcret notu: her ajan kendi aboneligini kullanir; opencode bacagi free/yerele dusebilir (models'a bak).`;
  }
  if (act === "list") {
    let tasks = [];
    try { tasks = readdirSync(orchDir()); } catch {}
    if (!tasks.length) return "Pano bos. Ilk gorev: orchestrate(action=dispatch, task=..., agents=[...])";
    return tasks.slice(-15).map((t) => {
      let n = 0;
      try { n = readdirSync(join(orchDir(), t)).filter((f) => f.endsWith(".out.md")).length; } catch {}
      return `- ${t} (${n} sonuc)`;
    }).join("\n");
  }
  if (act === "dispatch") {
    const task = String(a.task || "").trim();
    if (task.length < 5) throw new Error("task gerekli (en az bir cumlelik is).");
    const agents = (Array.isArray(a.agents) && a.agents.length ? a.agents : ["codex"]).map((s) => String(s).toLowerCase());
    for (const g of agents) if (!["claude", "codex", "opencode"].includes(g)) throw new Error("Bilinmeyen ajan: " + g + " (claude|codex|opencode)");
    const mode = String(a.mode || "readonly").toLowerCase() === "auto" ? "auto" : "readonly";
    const dir = String(a.dir || cwdRoot());
    const taskId = String(a.taskId || "").trim();
    if (taskId) await updateTask(dir, { action: "status", id: taskId });
    const timeoutMs = Math.min(1800000, Math.max(60000, Number(a.timeoutSec || 600) * 1000));
    const det = await detectAgents();
    const id = `g${Date.now().toString(36)}`;
    const td = join(orchDir(), id);
    mkdirSync(td, { recursive: true });
    writeFileSync(join(td, "task.md"), `# Gorev (${id}, mode=${mode})\n\n${task}\n\n- Calisma klasoru: ${dir}\n- Ajanlar: ${agents.join(", ")}\n${taskId ? `- CudeAll proje gorevi: ${taskId}\n` : ""}`, "utf8");
    const results = {};
    await Promise.all(agents.map(async (g) => {
      const d = det[g];
      if (!d || !d.ok) { results[g] = { code: 98, note: "CLI yok", out: "" }; writeFileSync(join(td, `${g}.out.md`), "(ajan yok: CLI bulunamadi)", "utf8"); return; }
      let args;
      if (g === "codex") args = mode === "auto"
        ? ["exec", "--sandbox", "workspace-write", "-c", "approval_policy=\"never\"", "--skip-git-repo-check", "-C", dir, task]
        : ["exec", "--sandbox", "read-only", "-c", "approval_policy=\"never\"", "--skip-git-repo-check", "-C", dir, task];
      else if (g === "claude") args = mode === "auto"
        ? ["-p", "--output-format", "text", "--dangerously-skip-permissions", task]
        : ["-p", "--output-format", "text", task];
      else {
        // opencode bacagi: MODEL ZINCIRI — kota/limit yiyen model duser, siradaki denenir.
        // Ornek models: ["experiential/gpt-5.6-luna", "ollama/qwen3"] (free/yerele dusus)
        const chain = Array.isArray(a.models) && a.models.length ? a.models.map(String) : (a.model ? [String(a.model)] : [""]);
        let r = null, used = "";
        const tried = [];
        for (const m of chain) {
          const oargs = m ? ["run", "-m", m, task] : ["run", task];
          r = await runAgentCmd(d.bin, oargs, dir, Math.min(timeoutMs, 600000));
          used = m || "(varsayilan model)";
          tried.push(`${used}=exit${r.code}`);
          if (r.code === 0 && (r.out || "").trim()) break; // calisti, zinciri kir
        }
        const body = `## ${g} (exit=${r.code}${r.signal ? `, sinyal=${r.signal}` : ""}, mode=${mode}, model=${used})\nZincir: ${tried.join(" -> ")}\n\n${(r.out || "").slice(0, 6000)}${r.err ? `\n\n[stderr]\n${r.err.slice(0, 1500)}` : ""}${r.code !== 0 ? `\n\n[NOT] Bu bacak calismadi. Sira: baska model dene (models parametresi) -> free provider ekle (cude_setup/action=models) -> isi cude_history ile tasi.` : ""}`;
        writeFileSync(join(td, `${g}.out.md`), body, "utf8");
        results[g] = { code: r.code, model: used, tried };
        return;
      }
      const r = await runAgentCmd(d.bin, args, dir, timeoutMs);
      const body = `## ${g} (exit=${r.code}${r.signal ? `, sinyal=${r.signal}` : ""}, mode=${mode})\n\n${(r.out || "").slice(0, 6000)}${r.err ? `\n\n[stderr]\n${r.err.slice(0, 1500)}` : ""}`;
      writeFileSync(join(td, `${g}.out.md`), body, "utf8");
      results[g] = { code: r.code };
    }));
    writeFileSync(join(td, "exit-codes.json"), JSON.stringify(results, null, 1), "utf8");
    if (taskId) {
      const outcomes = Object.entries(results).map(([agent, result]) => `${agent}=exit${result.code}`).join(", ");
      await updateTask(dir, {
        action: "update", id: taskId,
        note: `Ajan orkestrasyonu ${id} tamamlandi (${mode}): ${outcomes}`,
        artifacts: [join(td, "task.md"), ...agents.map((agent) => join(td, `${agent}.out.md`))],
      });
    }
    const summary = agents.map((g) => {
      let t = "";
      try { t = readFileSync(join(td, `${g}.out.md`), "utf8").slice(0, 2500); } catch {}
      return `\n===== ${g} =====\n${t}`;
    }).join("\n");
    return `# DAGITIM TAMAMLANDI — ${id} (mode=${mode})\nPano: ${td}\nDerin okuma: orchestrate(action=read, id=${id})\n${summary.slice(0, 15000)}`;
  }
  if (act === "read") {
    const id = String(a.id || "").trim();
    if (!id) throw new Error("id gerekli (list ile bak).");
    const td = join(orchDir(), id);
    if (!existsSync(td)) throw new Error(`Gorev bulunamadi: ${id}`);
    let task = "";
    try { task = readFileSync(join(td, "task.md"), "utf8"); } catch {}
    const outs = readdirSync(td).filter((f) => f.endsWith(".out.md"));
    let body = `# PANO — ${id}\n\n${task}\n`;
    for (const f of outs) {
      try { body += `\n----- ${f} -----\n${readFileSync(join(td, f), "utf8").slice(0, Number(a.maxChars) || 6000)}\n`; } catch {}
    }
    return body.slice(0, 25000);
  }
  throw new Error("Bilinmeyen orchestrate action: " + act + " (status|list|dispatch|read)");
}

// ---------- QA (TestSprite + Strix fuzyonu: otonom test + guvenlik) ----------
// TestSprite yani: niyeti anla (kod/PRD) -> TC plani -> unit/api/web kostur ->
// hatayi sinifla (bug/kirilgan/cevresel) -> rapor + duzeltme onerisi -> tekrar.
// Strix yani: secret sizintisi, tehlikeli fonksiyonlar, bagimlilik zafiyeti,
// canli URL guvenlik basliklari; siddet sirali, kanitli, duzeltmeli.
// KURAL: sadece YEREL/statik kontroller + verilen URL'ye normal istek.
// Somuru/PoC saldirisi YOK (guvenlik siniri, bilerek yok).
function qaDir() {
  const d = join(opencodeDir(), "qa");
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
}
function walkText(dir, depth = 4, acc = []) {
  try {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (acc.length > 400) break;
      const p = join(dir, e.name);
      if (/(^|\\)(node_modules|\.git|dist|build|\.next|coverage|\.turbo)(\\|$)/.test(p)) continue;
      if (e.isDirectory()) { if (depth > 0) walkText(p, depth - 1, acc); }
      else if (/\.(mjs|cjs|js|jsx|ts|tsx|json|py|go|php|rb|html)$/.test(e.name)) acc.push(p);
    }
  } catch {}
  return acc;
}
function detectRunners(dir) {
  const out = [];
  try {
    const pj = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    if (pj.scripts && pj.scripts.test) out.push({ kind: "npm", cmd: ["npm", "test", "--", "--silent"] });
    else if (existsSync(join(dir, "vitest.config.ts")) || existsSync(join(dir, "vitest.config.js"))) out.push({ kind: "vitest", cmd: ["npx", "vitest", "run"] });
    else if (existsSync(join(dir, "pytest.ini")) || existsSync(join(dir, "tests"))) out.push({ kind: "pytest", cmd: ["pytest", "-q"] });
    else if (existsSync(join(dir, "go.mod"))) out.push({ kind: "go", cmd: ["go", "test", "./..."] });
  } catch {}
  return out;
}
function qaPlanText(dir) {
  const files = walkText(dir, 3).filter((f) => !f.startsWith(qaDir())); // kendi raporlarini tarama
  const routes = [], forms = [], endpoints = [];
  for (const f of files.slice(0, 150)) {
    let t = "";
    try {
      const st = statSync(f);
      if (st.size > 200000) continue;
      t = readFileSync(f, "utf8");
    } catch { continue; }
    const rel = f.slice(dir.length + 1);
    for (const m of t.matchAll(/\.(get|post|put|delete|patch)\(\s*['"`]([^'"`]+)['"`]/gi)) routes.push(`${m[1].toUpperCase()} ${m[2]} (${rel})`);
    for (const m of t.matchAll(/fetch\(\s*['"`]([^'"`]+)['"`]/gi)) endpoints.push(`${m[1].slice(0, 80)} (${rel})`);
    if (/<form[\s>]/i.test(t)) forms.push(rel);
    if (routes.length + endpoints.length > 40) break;
  }
  let n = 0;
  const tc = (sev, baslik, adim) => `| TC${String(++n).padStart(3, "0")} | ${sev} | ${baslik} | ${adim} |`;
  const rows = [
    tc("HIGH", "Birim testleri yesil", "unit kos, fail varsa logu duzeltmeye gotur"),
    tc("HIGH", "Secret sizintisi yok", "sec: repo + gecmiste kalan anahtar tara"),
    tc("HIGH", "Tehlikeli fonksiyon yok", "sec: eval/innerHTML/exec kalibi denetle"),
  ];
  for (const r of [...new Set(routes)].slice(0, 8)) rows.push(tc("HIGH", `API: ${r.slice(0, 70)}`, "api: 2xx + sure + tip dogrula"));
  for (const f of [...new Set(forms)].slice(0, 5)) rows.push(tc("MED", `Form: ${f.slice(0, 60)}`, "web: doldur-gonder, hata mesaji gor"));
  rows.push(tc("MED", "Konsol hatasiz acilis", "web: sayfa ac, console/pageerror topla"));
  rows.push(tc("LOW", "Bagimlilik denetimi", "sec: npm audit ozeti"));
  return `# QA PLANI — ${dir}\n\n| ID | Seviye | Test | Nasil |\n|---|---|---|---|\n${rows.join("\n")}\n\nKos: cude_qa(action=run, suite=all, url=<canli-adres-varsa>)`;
}
function runCmdLogged(cmd, args, cwd, timeoutMs) {
  return new Promise((resolve) => {
    const isWin = process.platform === "win32";
    const c = isWin ? { bin: "cmd", args: ["/c", cmd, ...args] } : { bin: cmd, args };
    const p = spawn(c.bin, c.args, { timeout: timeoutMs, cwd, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) => resolve({ code: 99, out: "", err: e.message }));
    p.on("exit", (code) => resolve({ code: code ?? 99, out, err }));
  });
}
async function qaRunUnit(dir, timeoutMs) {
  const runners = detectRunners(dir);
  if (!runners.length) return { name: "unit", status: "SKIP", detail: "test calistiricisi bulunamadi (package.json test / vitest / pytest / go test yok)" };
  const r = runners[0];
  const t0 = Date.now();
  const res = await runCmdLogged(r.cmd[0], r.cmd.slice(1), dir, timeoutMs);
  const tail = (res.out + "\n" + res.err).slice(-2500);
  return { name: "unit", status: res.code === 0 ? "PASS" : "FAIL", kind: res.code === 0 ? "" : "bug", detail: `${r.kind} exit=${res.code} (${Math.round((Date.now() - t0) / 1000)}sn)\n${tail}` };
}
async function qaRunApi(urls) {
  const out = [];
  for (const u of urls.slice(0, 10)) {
    const t0 = Date.now();
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(20000), redirect: "follow" });
      await r.arrayBuffer().then((b) => b.byteLength).catch(() => 0);
      const ms = Date.now() - t0;
      const st = r.status;
      out.push({ url: u, status: st >= 500 ? "FAIL" : st >= 400 ? "WARN" : "PASS", kind: st >= 500 ? "bug" : "cevresel", detail: `HTTP ${st} ${ms}ms ${r.headers.get("content-type") || ""}` });
    } catch (e) { out.push({ url: u, status: "FAIL", kind: "cevresel", detail: "erisim yok: " + (e.message || e).slice(0, 120) }); }
  }
  return out;
}
async function qaRunWeb(urls, boardId, timeoutMs) {
  const pw = await tryPlaywright();
  if (!pw) return [{ url: "(yok)", status: "SKIP", detail: "playwright kurulu degil: cude_setup(action=install_browser)" }];
  const out = [];
  const browser = await pw.chromium.launch({ headless: true });
  try {
    for (const u of urls.slice(0, 6)) {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      const cerr = [], perr = [];
      page.on("console", (m) => { if (m.type() === "error") cerr.push(m.text().slice(0, 200)); });
      page.on("pageerror", (e) => perr.push(String(e).slice(0, 200)));
      let title = "", code = 0;
      try {
        const resp = await page.goto(u, { waitUntil: "domcontentloaded", timeout: 25000 });
        code = resp ? resp.status() : 0;
        title = await page.title().catch(() => "");
        const shot = join(qaDir(), boardId + "-" + out.length + ".png");
        await page.screenshot({ path: shot }).catch(() => {});
      } catch (e) { perr.push("acilis hatasi: " + e.message.slice(0, 150)); }
      await ctx.close().catch(() => {});
      const bad = perr.length > 0 || code >= 500;
      out.push({ url: u, status: bad ? "FAIL" : cerr.length ? "WARN" : "PASS", kind: bad ? "bug" : "kirilgan", detail: `HTTP ${code} "${title.slice(0, 80)}" | pageerror:${perr.length} console.error:${cerr.length}${perr[0] ? " | " + perr[0] : ""}${cerr[0] ? " | " + cerr[0] : ""}` });
      if (Date.now() - timeoutMs > 500000) break;
    }
  } finally { await browser.close().catch(() => {}); }
  return out;
}
function qaRunSec(dir) {
  const findings = [];
  const pats = [
    [/sk-ant-[A-Za-z0-9\-_]{10,}/, "Anthropic API anahtari", "high"],
    [/ghp_[A-Za-z0-9]{10,}/, "GitHub token", "high"],
    [/xox[bap]-[A-Za-z0-9\-]+/, "Slack token", "high"],
    [/AKIA[0-9A-Z]{16}/, "AWS anahtari", "high"],
    [/-----BEGIN (RSA |OPENSSH )?PRIVATE KEY/, "Ozel anahtar", "high"],
    [/api[_-]?key\s*[:=]\s*['"][^'"]{8,}['"]/i, "Gomulu API anahtari?", "med"],
    [/\beval\s*\(/, "eval() kullanimi", "med"],
    [/\.innerHTML\s*=/, "innerHTML atama (XSS yuzeyi)", "med"],
    [/dangerouslySetInnerHTML/, "dangerouslySetInnerHTML", "med"],
  ];
  const files = walkText(dir, 4).filter((f) => !f.startsWith(qaDir()) && !f.includes("orchestrator")); // kendi pano/raporlarini tarama
  let scanned = 0;
  for (const f of files) {
    let t = "";
    try {
      if (statSync(f).size > 200000) continue;
      t = readFileSync(f, "utf8");
    } catch { continue; }
    scanned++;
    const lines = t.split("\n");
    for (const [re, ad, sev] of pats) {
      for (let i = 0; i < lines.length; i++) {
        // tarayicinin kendi kalip tablosunu atla: [/.../, "ad", "sev"], satirlari
        if (/\[\s*\/.*\/,\s*".*?",\s*"(high|med|low)"\]/.test(lines[i])) continue;
        if (re.test(lines[i])) {
          findings.push({ url: f.slice(dir.length + 1) + ":" + (i + 1), status: "FAIL", kind: "bug", detail: `[${sev.toUpperCase()}] ${ad}: ${lines[i].trim().slice(0, 120)}` });
          if (findings.length > 25) break;
        }
      }
      if (findings.length > 25) break;
    }
    if (findings.length > 25) break;
  }
  if (existsSync(join(dir, ".env"))) findings.push({ url: ".env", status: "FAIL", kind: "bug", detail: "[HIGH] .env repo kokunde — .env.example kullan, gercegini disarida tut" });
  return { scanned, findings };
}
async function qaAction(a) {
  const act = (a.action || "status").toLowerCase();
  const dir = String(a.dir || cwdRoot());
  if (act === "status") {
    const runners = detectRunners(dir).map((r) => r.kind).join(", ") || "yok";
    const pw = (await tryPlaywright()) ? "hazir" : "yok (install_browser)";
    let boards = [];
    try { boards = readdirSync(qaDir()); } catch {}
    return `QA DURUMU\n- calistirici: ${runners}\n- web motoru: ${pw}\n- pano: ${qaDir()} (${boards.length} kosu)\n\nKullanim: plan (TC uret) -> run(suite=unit|api|web|sec|all, url=...) -> report (hukum + duzeltme).`;
  }
  if (act === "plan") {
    const id = `q${Date.now().toString(36)}`;
    const text = qaPlanText(dir);
    writeFileSync(join(qaDir(), id + "-plan.md"), text, "utf8");
    return `# ${id}\n${text}`;
  }
  if (act === "run") {
    const id = `q${Date.now().toString(36)}`;
    const suite = String(a.suite || "all").toLowerCase();
    const urls = String(a.url || a.urls || "").split(/[,\s]+/).map((s) => s.trim()).filter((s) => /^https?:\/\//.test(s));
    const want = (k) => suite === "all" || suite.split(/[+,]/).includes(k);
    const res = { id, dir, at: new Date().toISOString(), parts: [] };
    if (want("unit")) res.parts.push(await qaRunUnit(dir, 300000));
    if (want("api")) {
      if (!urls.length) res.parts.push({ name: "api", status: "SKIP", detail: "url verilmedi (or: url=https://site.com)" });
      else for (const r of await qaRunApi(urls)) res.parts.push(Object.assign({ name: "api" }, r));
    }
    if (want("web")) {
      if (!urls.length) res.parts.push({ name: "web", status: "SKIP", detail: "url verilmedi" });
      else for (const r of await qaRunWeb(urls, id, Date.now())) res.parts.push(Object.assign({ name: "web" }, r));
    }
    if (want("sec")) {
      const s = qaRunSec(dir);
      res.parts.push({ name: "sec", status: s.findings.length ? "FAIL" : "PASS", detail: `${s.scanned} dosya tarandi, ${s.findings.length} bulgu` });
      for (const f of s.findings) res.parts.push(Object.assign({ name: "sec-bulgu" }, f));
    }
    writeFileSync(join(qaDir(), id + "-results.json"), JSON.stringify(res, null, 1).slice(0, 60000), "utf8");
    const fails = res.parts.filter((p) => p.status === "FAIL").length;
    const warns = res.parts.filter((p) => p.status === "WARN").length;
    const lines = res.parts.map((p) => `- [${p.status}] ${p.name}${p.url ? " " + p.url : ""}: ${String(p.detail || "").slice(0, 300).replace(/\n/g, " | ")}`);
    return `# QA KOSUSU — ${id} (hukum: ${fails ? "FAIL" : "PASS"}, fail=${fails} warn=${warns})\n${lines.join("\n")}\n\nDetay: cude_qa(action=report, id=${id})`;
  }
  if (act === "report") {
    let files = [];
    try { files = readdirSync(qaDir()).filter((f) => f.endsWith("-results.json")); } catch {}
    if (!files.length) return "Rapor yok. Once cude_qa(action=run) yap.";
    const pick = a.id ? files.find((f) => f.startsWith(String(a.id))) : files.sort().pop();
    if (!pick) return `Bulunamadi: ${a.id}`;
    const res = JSON.parse(readFileSync(join(qaDir(), pick), "utf8"));
    const fails = res.parts.filter((p) => p.status === "FAIL");
    let out = `# QA RAPORU — ${res.id} (${res.at})\nHukum: ${fails.length ? "FAIL" : "PASS"} | fail=${fails.length}\n`;
    for (const f of fails.slice(0, 15)) out += `\n- ${f.name}${f.url ? " " + f.url : ""} [${f.kind || "bug"}]\n  Kanit: ${String(f.detail || "").slice(0, 400)}\n  Duzeltme: ilgili dosyayi ac, kanittaki satiri duzelt, tekrari ` + "`cude_qa(action=run, suite=" + f.name.split("-")[0] + ")`" + ` ile dogrula.\n`;
    if (!fails.length) out += "\nTemiz. Kapsami buyutmek icin plan'a bak, yeni TC ekle.";
    return out.slice(0, 15000);
  }
  throw new Error("Bilinmeyen qa action: " + act + " (status|plan|run|report)");
}

// ---------- OMURGA (spine): dort aracin ortak tek nokta ----------
// status/context/capabilities/adapters/evidence/handoffs/claim
// Yalnizca dosya okur-yazar; ag cagrisi ve komut calistirmaz.
function yn(v) { return v ? "var" : "yok"; }
async function spineAction(a = {}) {
  const action = String(a.action || "status").toLowerCase();
  const dir = a.dir || cwdRoot();
  if (action === "context") {
    const r = writeContext(dir, { maxChars: a.maxChars });
    return `${r.text}\n\n[Kaydedildi: ${r.file}]`;
  }
  if (action === "capabilities") {
    const c = capabilities(dir);
    const line = (k, v) => `- ${k}: ${v}`;
    return [
      "# CUDEALL OMRUGA — ARAC KESFI",
      `Root: ${c.project}`,
      "",
      "## OpenCode",
      line("proje config", yn(c.opencode.projectConfig)),
      line("plugin", yn(c.opencode.plugin)),
      line("skill (proje/global)", `${yn(c.opencode.skill)}/${yn(c.opencode.globalSkill)}`),
      line("global MCP", yn(c.opencode.globalMcp)),
      line("komutlar", c.opencode.commands.length ? c.opencode.commands.join(", ") : "(yok)"),
      "",
      "## Codex",
      line("CLI", yn(c.codex.cli)),
      line("MCP kaydi", yn(c.codex.mcp)),
      line("skill", yn(c.codex.skill)),
      line("AGENTS.md adapter", c.codex.adapter.present ? (c.codex.adapter.block ? "blok var" : "blok yok") : "dosya yok"),
      "",
      "## Claude",
      line("settings.json", yn(c.claude.settingsFile)),
      line("MCP kaydi", yn(c.claude.mcp)),
      line("skill", yn(c.claude.skill)),
      line("CLAUDE.md adapter", c.claude.adapter.present ? (c.claude.adapter.block ? "blok var" : "blok yok") : "dosya yok"),
      "",
      "## Cude Desktop",
      line("uygulama", yn(c.desktop.app)),
      line("MCP koprusu", yn(c.desktop.mcpBridge)),
      "",
      `## Omurga dosyalari\n- kok: ${c.spine.root}\n- baglam: ${c.spine.contextFile}\n- kanit: ${c.spine.evidenceFile}\n- adapterlar: ${Object.keys(c.spine.adapters).join(", ") || "(yok)"}`,
      "",
      `## Araclar\n- ${c.mcpTools.join("\n- ")}`,
      "",
      `## Env (deger okunmaz)\n- CUDEALL_WORKTREE: ${yn(c.env.CUDEALL_WORKTREE)}\n- TAVILY_API_KEY: ${yn(c.env.TAVILY_API_KEY)}\n- BRAVE_API_KEY: ${yn(c.env.BRAVE_API_KEY)}`,
    ].join("\n");
  }
  if (action === "adapters") {
    const dry = String(a.mode || "").toLowerCase() === "dry";
    const res = syncAdapters(dir, { only: a.target, write: !dry });
    const seen = new Map();
    for (const r of res) if (!seen.has(r.file)) seen.set(r.file, r);
    const head = dry ? "ADAPTER DENETIMI (yazmadi)" : "ADAPTER YAZILDI";
    const lines = res.map((r) => `- ${r.adapter}: ${r.file} ${seen.get(r.file).changed ? (dry ? "(degisiklik var)" : "(guncellendi)") : "(zaten gecerli)"}`);
    lines.push("", "Not: isaretli blok kullanici metnini degistirmez; kaldirmak icin dosyada <!-- cudeall:spine:start --> ... end araligini sil.");
    return `${head}\n${lines.join("\n")}`;
  }
  if (action === "evidence") {
    const taskId = a.taskId ? String(a.taskId) : "";
    if (taskId) await updateTask(dir, { action: "status", id: taskId });
    const entry = addEvidence(dir, {
      label: a.label, command: a.command, exitCode: a.exitCode,
      output: a.output, taskId, agent: a.agent,
    });
    let linked = "";
    if (taskId) {
      const line = `[kanit ${entry.id}] ${entry.label}${entry.command ? " — " + entry.command : ""}${entry.exitCode === null ? "" : " (exit=" + entry.exitCode + ")"}`;
      await updateTask(dir, { action: "update", id: taskId, note: line, verification: line });
      linked = `\nGorev kaydina islendi: ${taskId}`;
    }
    return `Kanit kaydedildi: ${entry.id} (${entry.at})${linked}\nKanit gunlugu: ${capabilities(dir).spine.evidenceFile}`;
  }
  if (action === "kanitlar" || action === "evidence-list" || action === "log") {
    const items = readEvidence(dir, a.limit);
    if (!items.length) return "Kanit gunlugu bos. cude_spine(action=evidence, label=..., command=...) ile ilk kaniti yaz.";
    const filtered = a.taskId ? items.filter((e) => e.taskId === String(a.taskId)) : items;
    return `KANIT GUNLUGU (son ${filtered.length})\n${filtered.slice(-40).reverse().map((e) => `- ${e.at} ${e.id}${e.taskId ? " [" + e.taskId + "]" : ""} ${e.label}${e.exitCode === null ? "" : " (exit=" + e.exitCode + ")"}${e.command ? " — " + e.command : ""}`).join("\n")}`;
  }
  if (action === "handoffs" || action === "inbox") {
    const items = handoffInbox(dir);
    if (!items.length) return "Bekleyen handoff yok. Devir: cude_task(action=handoff, id=..., target=..., next=...).";
    return `HANDOFF KUYRUĞU (${items.length})\n${items.map((h) => `- ${h.id} -> ${h.target} [${h.status}] ${h.claimed ? "ALINDI: " + h.claimed.agent : "BEKLIYOR"}\n  sonraki: ${h.next || "(yok)"}\n  dosya: ${h.file}`).join("\n")}\n\nDevralmak icin: cude_spine(action=claim, id=<id>, agent=<senin adin>)`;
  }
  if (action === "claim") return await claimHandoff(dir, { id: a.id, agent: a.agent || a.target, note: a.note });
  if (action === "snapshot") return snapshot(dir, a.maxChars) || "Omurga bos: hedef, gorev veya kanit yok.";
  if (action === "status") {
    const c = capabilities(dir);
    const pend = handoffInbox(dir);
    const open = pend.filter((h) => !h.claimed);
    const ev = readEvidence(dir, 5);
    const ctxOk = existsSync(c.spine.contextFile);
    return [
      "CUDEALL OMRUGA DURUMU",
      `- kok: ${c.project}`,
      `- baglam dosyasi: ${yn(ctxOk)} (${c.spine.contextFile})`,
      `- adapterlar: ${Object.keys(c.spine.adapters).join(", ") || "(yok — action=adapters ile yaz)"}`,
      `- bekleyen handoff: ${open.length} / toplam ${pend.length}`,
      `- son kanit: ${ev.length ? ev[ev.length - 1].label + " @ " + ev[ev.length - 1].at : "(yok)"}`,
      `- arac sayisi: ${c.mcpTools.length} (${c.mcpTools.slice(0, 4).join(", ")}, ...)`,
      "",
      "Siradaki adim: context (baglam yaz) -> task start/list (is) -> update (ilerleme) -> evidence (kanit) -> handoff/claim (devir).",
    ].join("\n");
  }
  throw new Error("Bilinmeyen spine action: " + action + " (status|context|capabilities|adapters|evidence|kanitlar|handoffs|claim|snapshot)");
}

// ---------- MCP ARAClARI ----------
const TOOLS = [
  { name: "cude_spine", description: "OMURGA (spine): OpenCode/Codex/Claude/Cude Desktop'un ortak tek noktasi. action=status (kisa durum) | context (proje baglami yaz/oku) | capabilities (arac kesfi: hangi arac/ada nerede bagli) | adapters (AGENTS.md/CLAUDE.md isaretli blok yaz) | evidence (kanit ekle) | kanitlar (kanit oku) | handoffs (devir kuyrugu) | claim (devir al) | snapshot. Yalnizca dosya okur/yazar.", inputSchema: { type: "object", properties: { action: { type: "string", description: "status|context|capabilities|adapters|evidence|kanitlar|handoffs|claim|snapshot" }, dir: { type: "string", description: "Proje koku; bos ise calisma dizini" }, target: { type: "string", description: "adapters icin: codex|claude|opencode" }, mode: { type: "string", description: "adapters icin: dry (yazmadan denetle)" }, label: { type: "string", description: "evidence: ne dogrulandi" }, command: { type: "string", description: "evidence: calistirilan komut" }, exitCode: { type: "number", description: "evidence: komut cikis kodu" }, output: { type: "string", description: "evidence: ozet cikti" }, taskId: { type: "string", description: "evidence: kaniti bu goreve bagla" }, agent: { type: "string", description: "claim: devralan ajan adi" }, id: { type: "string", description: "claim: handoff gorev id" }, limit: { type: "number" }, maxChars: { type: "number" } }, required: ["action"] } },
  { name: "cude_web_search", description: "Web'de arastirma yap (Tavily/Brave varsa anahtarli, yoksa anahtarsiz DDG). Codex/Claude web aramasinin opencode karsiligi.", inputSchema: { type: "object", properties: { query: { type: "string", description: "Arama sorgusu" }, count: { type: "number", description: "Sonuc sayisi 1-10 (varsayilan 8)" } }, required: ["query"] } },
  { name: "cude_web_fetch", description: "URL'nin temiz metnini cek (arastirma, dokuman, hata cozumu).", inputSchema: { type: "object", properties: { url: { type: "string" }, maxChars: { type: "number" } }, required: ["url"] } },
  { name: "cude_browser", description: "Tarayici kullan. Gercek Chrome (eklenti+grup): status|tabs|group_open|open|read|click|type|close. Klasik: open/snapshot/screenshot/click/type. Playwright yoksa statik moda duser.", inputSchema: { type: "object", properties: { action: { type: "string", description: "status|tabs|group_open|open|read|click|type|close (+ snapshot|screenshot)" }, url: { type: "string" }, selector: { type: "string" }, text: { type: "string" }, fullPage: { type: "boolean" }, tabId: { type: "number" }, group: { type: "string", description: "Sekme grup adi (varsayilan CudeAll)" }, submit: { type: "boolean" }, maxChars: { type: "number" } }, required: ["action"] } },
  { name: "cude_computer", description: "Bilgisayari kullan (Windows): screenshot/click/type/key/scroll/info. Uzun sureli denetim ve desktop app hissi.", inputSchema: { type: "object", properties: { action: { type: "string" }, x: { type: "number" }, y: { type: "number" }, text: { type: "string" }, key: { type: "string" }, amount: { type: "number" }, path: { type: "string" } }, required: ["action"] } },
  { name: "cude_memory", description: "Kalıcı hafıza: sohbetler arasi karar/tercih/hata cozumu sakla (session-memory + task-manager birlesimi).", inputSchema: { type: "object", properties: { action: { type: "string", description: "write|read|list|delete" }, key: { type: "string" }, value: { type: "string" }, tag: { type: "string" } }, required: ["action"] } },
  { name: "cude_automation", description: "Kendine otomasyon yaz/kos: tekrar eden isi .mjs olarak kaydet, tek komutla calistir.", inputSchema: { type: "object", properties: { action: { type: "string", description: "save|run|list|delete" }, name: { type: "string" }, script: { type: "string" }, args: { type: "array", items: { type: "string" } } }, required: ["action"] } },
  { name: "cude_history", description: "Claude Code / Codex / opencode konusmalarini OKU ve kaldigi yerden DEVAM ET. Kota biten isi buraya tasi. Anahtar gerekmez.", inputSchema: { type: "object", properties: { action: { type: "string", description: "sources|list|read|continue" }, source: { type: "string", description: "claude|codex|opencode" }, file: { type: "string", description: "Dosya adindan parca" }, maxChars: { type: "number" } }, required: ["action"] } },
  { name: "cude_setup", description: "Arac kendi araclarini kursun: durum + chromium kurulum + free provider/model + doctor (kendi kendine muayene ve tamir). Anahtar gerekmez, anahtar gostermez.", inputSchema: { type: "object", properties: { action: { type: "string", description: "status|install_browser|models|doctor" } }, required: ["action"] } },
  { name: "cude_orchestrate", description: "3 kod aracini tek catida kostur: Claude Code + Codex + opencode'a gorev dagit, ortak panoda topla. taskId verildiginde cikti ve sonuc kodlarini secili proje gorev kaydina baglar.", inputSchema: { type: "object", properties: { action: { type: "string", description: "status|list|dispatch|read" }, task: { type: "string" }, taskId: { type: "string", description: "Istege bagli CudeAll proje gorev ID'si; ajan sonuclari o gorevin artifacts/events alanina kaydedilir." }, agents: { type: "array", items: { type: "string" }, description: "claude|codex|opencode alt kumesi" }, mode: { type: "string", description: "readonly (guvenli) | auto (yazarak, acik onay)" }, dir: { type: "string" }, id: { type: "string" }, model: { type: "string", description: "opencode bacagi icin provider/model (effort secimi)" }, models: { type: "array", items: { type: "string" }, description: "opencode model zinciri: kota yiyen duser, siradaki denenir (free/yerele dusus)" }, timeoutSec: { type: "number" }, maxChars: { type: "number" } }, required: ["action"] } },
  { name: "cude_qa", description: "TestSprite+Strix fuzyonu: test plani uret, unit/api/web/guvenlik kostur, hukum + duzeltme raporu ver. Tek komutla tam QA dongusu.", inputSchema: { type: "object", properties: { action: { type: "string", description: "status|plan|run|report" }, dir: { type: "string" }, suite: { type: "string", description: "unit|api|web|sec|all (+ ile birlestir)" }, url: { type: "string", description: "Virgul ayri URL'ler (api/web icin)" }, id: { type: "string" } }, required: ["action"] } },
  { name: "cude_provider", description: "Saglayici kasasi (DPAPI sifreli): coklu provider bagla, listele, Codex/Claude terminaline aktar. Anahtar sohbete/LLM'e ASLA girmez.", inputSchema: { type: "object", properties: { action: { type: "string", description: "status|list|add|remove|env_script" }, provider: { type: "string", description: "openrouter|gemini|groq|cerebras|mistral|deepseek|openai|anthropic|tavily|brave" } }, required: ["action"] } },
  { name: "cude_project", description: "Secili projeyi sinirli bir taramayla anla: stack, dosya agaci, Git durumu, komutlar ve AGENTS/CLAUDE talimatlari. Dosya icerigi calistirilmaz; .env ve bagimlilik klasorleri taranmaz.", inputSchema: { type: "object", properties: { action: { type: "string", enum: ["context", "inspect"] }, dir: { type: "string", description: "Acil secili workspace; bos ise proje kokunu kullanir." } }, required: ["action"] } },
  { name: "cude_task", description: "Projeye bagli gorev omurgasi: hedef, guncellenebilir plan, kararlar, ilerleme, dosya ciktilari, dogrulama ve ajanlar arasi handoff tek yerel kayitta tutulur; farkli arac surecleri ayni gorev kaydina kilitli yazar.", inputSchema: { type: "object", properties: { action: { type: "string", enum: ["start", "list", "read", "status", "update", "plan", "decision", "complete", "handoff"] }, dir: { type: "string" }, id: { type: "string" }, objective: { type: "string" }, title: { type: "string" }, plan: { type: "array", items: { type: "string" } }, steps: { type: "array", items: { type: "string" } }, operation: { type: "string", enum: ["append", "replace"] }, decision: { type: "string" }, status: { type: "string", enum: ["active", "blocked", "complete"] }, step: { type: "number" }, stepStatus: { type: "string", enum: ["in_progress", "done"] }, note: { type: "string" }, artifacts: { type: "array", items: { type: "string" } }, verification: { type: "string" }, target: { type: "string" }, next: { type: "string" } }, required: ["action"] } },
];

async function callTool(name, args = {}) {
  try {
    if (name === "cude_spine") return textResult(await spineAction(args));
    if (name === "cude_web_search") return textResult(await webSearch(args.query, args.count));
    if (name === "cude_web_fetch") return textResult(await webFetch(args.url, Math.max(500, Math.min(30000, Number(args.maxChars) || 12000))));
    if (name === "cude_browser") {
      const act = String(args.action || "open").toLowerCase();
      // Canli Chrome yolu (eklenti grubu -> CDP -> yoksa klasik/static):
      // status/tabs/group_open/close her zaman chrome; open/read/click/type once chrome dener.
      if (["status", "tabs", "list", "group_open", "close", "open", "read", "click", "type"].includes(act)) {
        try { return textResult(await chromeAction(args)); }
        catch (e) {
          if (["status", "tabs", "list", "group_open", "close", "click", "type"].includes(act)) return errResult(e.message + "\n\nKurulum: chrome-extension/README'ye bak (2 dk).");
          // open/read: klasik yola dus (statik fetch veya playwright)
        }
      }
      return textResult(await browserAction(args));
    }
    if (name === "cude_computer") return textResult(await computerAction(args));
    if (name === "cude_memory") {
      const m = loadMemory();
      const act = (args.action || "list").toLowerCase();
      if (act === "write") { if (!args.key) throw new Error("key gerekli"); m[String(args.key)] = { value: String(args.value || ""), tag: String(args.tag || ""), at: new Date().toISOString() }; saveMemory(m); return textResult(`Hatirlaniyor: ${args.key}`); }
      if (act === "read") { const k = String(args.key || ""); if (!m[k]) return textResult(`Yok: ${k}`); return textResult(`${k} [${m[k].tag}] @${m[k].at}\n${m[k].value}`); }
      if (act === "delete") { delete m[String(args.key)]; saveMemory(m); return textResult(`Silindi: ${args.key}`); }
      const keys = Object.keys(m);
      if (!keys.length) return textResult("Hafiza bos. Ilk kayit: cude_memory(action=write, key, value)");
      return textResult(keys.slice(0, 50).map((k) => `- ${k} [${m[k].tag || "-"}] ${String(m[k].value).slice(0, 100)}`).join("\n"));
    }
    if (name === "cude_automation") return textResult(await automationAction(args));
    if (name === "cude_history") return textResult(await historyAction(args));
    if (name === "cude_setup") return textResult(await setupAction(args));
    if (name === "cude_orchestrate") return textResult(await orchestrateAction(args));
    if (name === "cude_qa") return textResult(await qaAction(args));
    if (name === "cude_provider") return textResult(await providerAction(args));
    if (name === "cude_project") return textResult(projectAction(args));
    if (name === "cude_task") return textResult(await taskAction(args));
    return errResult("Bilinmeyen arac: " + name);
  } catch (e) {
    return errResult(e.message || String(e));
  }
}

// ---------- JSON-RPC STDIO DONGUSU ----------
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", async (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    await handle(msg);
  }
});

function reply(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}
function replyErr(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n");
}

async function handle(msg) {
  const { id, method, params } = msg;
  try {
    if (method === "initialize") {
      return reply(id, { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "mcp-cudeall", version: VERSION } });
    }
    if (method === "notifications/initialized" || (method || "").startsWith("notifications/")) return; // yanit yok
    if (method === "ping") return reply(id, {});
    if (method === "tools/list") return reply(id, { tools: TOOLS });
    if (method === "tools/call") {
      const out = await callTool(params?.name, params?.arguments || {});
      return reply(id, out);
    }
    if (method === "resources/list") return reply(id, { resources: [] });
    if (method === "prompts/list") return reply(id, { prompts: [] });
    if (id !== undefined) return replyErr(id, -32601, "Bilinmeyen method: " + method);
  } catch (e) {
    if (id !== undefined) replyErr(id, -32603, e.message || String(e));
  }
}

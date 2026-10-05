// cudeall — Chrome eklentisi (service worker)
// Gorev: http://127.0.0.1:18789/cudeall/commands adresini 1.5 sn'de bir yoklar,
// komutlari chrome.tabs/tabGroups/scripting ile calistirir,
// sonucu /cudeall/results'a yazar. Tum is sekmeleri "CudeAll" grubunda toplanir.

const BRIDGE = "http://127.0.0.1:18789";
const DEFAULT_GROUP = "CudeAll";
let lastOk = 0;
let bridgeToken = null;

async function getBridgeToken(force = false) {
  if (!force && bridgeToken) return bridgeToken;
  if (!force) {
    const saved = await chrome.storage.local.get("cudeallBridgeToken");
    if (saved.cudeallBridgeToken) {
      bridgeToken = saved.cudeallBridgeToken;
      return bridgeToken;
    }
  }
  const r = await fetch(BRIDGE + "/cudeall/bootstrap", { cache: "no-store" });
  if (!r.ok) throw new Error(`kopru kimligi alinmadi (HTTP ${r.status})`);
  const data = await r.json();
  if (typeof data.token !== "string" || data.token.length < 40) throw new Error("gecersiz kopru kimligi");
  bridgeToken = data.token;
  await chrome.storage.local.set({ cudeallBridgeToken: bridgeToken });
  return bridgeToken;
}

async function api(path, opts = {}) {
  const token = await getBridgeToken();
  const headers = new Headers(opts.headers || {});
  headers.set("Authorization", `Bearer ${token}`);
  let r = await fetch(BRIDGE + path, { ...opts, headers, cache: "no-store" });
  if (r.status === 401) {
    bridgeToken = null;
    await chrome.storage.local.remove("cudeallBridgeToken");
    const refreshed = await getBridgeToken(true);
    headers.set("Authorization", `Bearer ${refreshed}`);
    r = await fetch(BRIDGE + path, { ...opts, headers, cache: "no-store" });
  }
  if (!r.ok) throw new Error(`kopru HTTP ${r.status}`);
  return r.json();
}

async function findGroup(title) {
  const groups = await chrome.tabGroups.query({ title });
  return groups[0] || null;
}

// Grubu bul ya da ac: gruba ait bir sekme yoksa bos bir sekme acip grupla.
async function ensureGroup(title) {
  let g = await findGroup(title);
  if (g) return g;
  const tabs = await chrome.tabs.query({});
  const inGroup = [];
  const allGroups = await chrome.tabGroups.query({});
  const byId = new Map(allGroups.map((x) => [x.id, x]));
  for (const t of tabs) {
    if (t.groupId && t.groupId !== chrome.tabs.TAB_ID_NONE) {
      const gg = byId.get(t.groupId);
      if (gg && gg.title === title) inGroup.push(t.id);
    }
  }
  let tabIds = inGroup;
  if (!tabIds.length) {
    const t = await chrome.tabs.create({ url: "about:blank", active: false });
    tabIds = [t.id];
  }
  const groupId = await chrome.tabs.group({ tabIds });
  await chrome.tabGroups.update(groupId, { title, color: "blue" });
  return (await chrome.tabGroups.query({ title }))[0];
}

async function tabsList() {
  const [tabs, groups] = await Promise.all([chrome.tabs.query({}), chrome.tabGroups.query({})]);
  const byId = new Map(groups.map((g) => [g.id, g]));
  return tabs
    .filter((t) => t.url && !t.url.startsWith("chrome://") && !t.url.startsWith("edge://"))
    .map((t) => ({
      id: t.id,
      title: (t.title || "").slice(0, 120),
      url: t.url,
      active: !!t.active,
      group: t.groupId && t.groupId !== chrome.tabs.TAB_ID_NONE ? (byId.get(t.groupId)?.title || `grup-${t.groupId}`) : null,
    }));
}

function pickTab(tabs, tabId) {
  if (tabId !== undefined && tabId !== null) {
    const t = tabs.find((x) => x.id === Number(tabId));
    if (!t) throw new Error(`Sekme bulunamadi (id=${tabId}). tabs ile listele.`);
    return t;
  }
  const act = tabs.find((t) => t.active) || tabs[0];
  if (!act) throw new Error("Acik sekme yok.");
  return act;
}

async function readTab(tab, maxChars = 8000) {
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const bad = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "SVG", "CANVAS"]);
      const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
      const parts = [];
      let n;
      while ((n = walker.nextNode())) {
        if (n.parentElement && bad.has(n.parentElement.tagName)) continue;
        const s = n.nodeValue.trim();
        if (s) parts.push(s);
      }
      const text = parts.join("\n").replace(/\n{3,}/g, "\n\n");
      const links = [...document.querySelectorAll("a[href]")].slice(0, 60).map((a) => `- ${a.innerText.trim().slice(0, 80)} -> ${a.href}`);
      const buttons = [...document.querySelectorAll("button, input[type=submit], [role=button]")].slice(0, 30).map((b) => `- [buton] ${(b.innerText || b.value || b.getAttribute("aria-label") || "").trim().slice(0, 80)}`);
      return { text: text.slice(0, 20000), links: links.join("\n"), buttons: buttons.join("\n") };
    },
  });
  const d = results[0]?.result || { text: "" };
  let out = `# ${tab.title}\n${tab.url}\n\n${String(d.text).slice(0, maxChars)}`;
  if (d.links) out += `\n\n## Linkler (tiklanabilir)\n${d.links}`;
  if (d.buttons) out += `\n\n## Butonlar\n${d.buttons}`;
  return out.slice(0, maxChars + 4000);
}

async function clickTab(tab, { selector, text }) {
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    args: [{ selector: selector || null, text: text || null }],
    func: ({ selector, text }) => {
      let el = null;
      if (selector) el = document.querySelector(selector);
      if (!el && text) {
        const q = text.toLowerCase();
        const cands = [...document.querySelectorAll("a, button, [role=button], input[type=submit], summary")];
        el = cands.find((e) => (e.innerText || e.value || "").toLowerCase().includes(q)) || null;
      }
      if (!el) return { ok: false, error: "hedef bulunamadi" };
      el.scrollIntoView({ block: "center" });
      el.click();
      return { ok: true, tag: el.tagName, label: (el.innerText || el.value || "").slice(0, 120) };
    },
  });
  const r = results[0]?.result || {};
  if (!r.ok) throw new Error(`Tiklanamadi: ${r.error || "hedef yok"}. read ile buton listesine bak.`);
  await chrome.tabs.update(tab.id, { active: true });
  return `Tiklandi: <${r.tag}> "${r.label}" — ${tab.url}`;
}

async function typeTab(tab, { selector, text, submit }) {
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    args: [{ selector, text }],
    func: ({ selector, text }) => {
      const el = document.querySelector(selector);
      if (!el) return { ok: false, error: "secici bulunamadi: " + selector };
      el.focus();
      if ("value" in el) {
        el.value = text;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      } else {
        el.textContent = text;
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
      return { ok: true, tag: el.tagName };
    },
  });
  const r = results[0]?.result || {};
  if (!r.ok) throw new Error(`Yazilamadi: ${r.error}. read ile sayfadaki input secicisine bak.`);
  if (submit) {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      args: [{ selector }],
      func: ({ selector }) => {
        const el = document.querySelector(selector);
        const form = el?.closest("form");
        if (form) { form.submit(); return; }
        document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      },
    });
  }
  await chrome.tabs.update(tab.id, { active: true });
  return `Yazildi (<${r.tag}> ${selector}, ${String(text).length} karakter)${submit ? " + submit" : ""}`;
}

async function runCommand({ cmd, args }) {
  switch (cmd) {
    case "status": {
      const tabs = await tabsList().catch(() => []);
      return `eklenti aktif, ${tabs.length} sekme gorunuyor`;
    }
    case "tabs_list":
      return JSON.stringify(await tabsList(), null, 1).slice(0, 8000);
    case "group_open": {
      const g = await ensureGroup(args.group || DEFAULT_GROUP);
      const tabs = await chrome.tabs.query({});
      const mine = tabs.filter((t) => t.groupId === g.id).length;
      return `Grup hazir: "${g.title}" (${mine} sekme). Yeni sayfa icin group_open_url kullan.`;
    }
    case "group_open_url": {
      const g = await ensureGroup(args.group || DEFAULT_GROUP);
      const tab = await chrome.tabs.create({ url: args.url, active: true });
      try { await chrome.tabs.group({ tabIds: [tab.id, ...(await chrome.tabs.query({})).filter((t) => t.groupId === g.id).map((t) => t.id)] }); }
      catch { await chrome.tabs.group({ tabIds: tab.id }); }
      await chrome.tabGroups.update(g.id, { title: args.group || DEFAULT_GROUP, color: "blue" });
      // sayfa otursun diye kisa bekle
      await new Promise((r) => setTimeout(r, 2500));
      const cur = await chrome.tabs.get(tab.id).catch(() => tab);
      return `Acildi + gruba eklendi: "${args.group || DEFAULT_GROUP}" -> ${cur.title || args.url}\n${cur.url}\nSonraki: tab_read ile oku, tab_click/tab_type ile isle.`;
    }
    case "tab_read": {
      const tabs = await tabsList();
      const tab = pickTab(tabs, args.tabId);
      return await readTab(tab, Math.min(15000, Number(args.maxChars) || 8000));
    }
    case "tab_click": {
      const tabs = await tabsList();
      const tab = pickTab(tabs, args.tabId);
      return await clickTab(tab, args);
    }
    case "tab_type": {
      const tabs = await tabsList();
      const tab = pickTab(tabs, args.tabId);
      return await typeTab(tab, args);
    }
    case "tab_close_group": {
      const g = await findGroup(args.group || DEFAULT_GROUP);
      if (!g) return "Kapatilacak grup yok.";
      const tabs = await chrome.tabs.query({});
      const mine = tabs.filter((t) => t.groupId === g.id);
      await Promise.all(mine.map((t) => chrome.tabs.remove(t.id).catch(() => {})));
      return `Kapatildi: "${g.title}" (${mine.length} sekme). Senin diger gruplarina dokunulmadi.`;
    }
    default:
      throw new Error("Bilinmeyen eklenti komutu: " + cmd);
  }
}

async function poll() {
  try {
    const { commands } = await api("/cudeall/commands");
    for (const c of commands || []) {
      try {
        const data = await runCommand(c);
        await api("/cudeall/results", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: c.id, ok: true, data: String(data).slice(0, 20000) }) });
      } catch (e) {
        await api("/cudeall/results", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: c.id, ok: false, data: e.message || String(e) }) });
      }
    }
    if ((commands || []).length) lastOk = Date.now();
    else {
      // canlilik isareti: kopruya ulasabiliyoruz
      lastOk = lastOk || Date.now();
    }
    await chrome.storage.local.set({ cudeBridge: "bagli", cudeallLastSeen: Date.now() });
  } catch {
    await chrome.storage.local.set({ cudeBridge: "kopru yok (MCP calisiyor mu?)", cudeallLastSeen: Date.now() });
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ cudeBridge: "kuruldu", cudeallGroup: DEFAULT_GROUP });
  poll();
});
chrome.runtime.onStartup.addListener(poll);
setInterval(poll, 1500);
poll();

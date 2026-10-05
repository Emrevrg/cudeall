const st = document.getElementById("st");
async function refresh() {
  const s = await chrome.storage.local.get(["cudeBridge", "cudeallLastSeen"]);
  const ago = s.cudeallLastSeen ? Math.round((Date.now() - s.cudeallLastSeen) / 1000) : -1;
  st.textContent = `Durum: ${s.cudeBridge || "bilinmiyor"}${ago >= 0 ? ` (${ago} sn önce)` : ""}`;
  st.style.background = (s.cudeBridge || "").startsWith("bagli") ? "#d3f9d8" : "#ffe8cc";
}
document.getElementById("open").onclick = async () => {
  const tabs = await chrome.tabs.query({});
  const t = await chrome.tabs.create({ url: "about:blank", active: true });
  const gid = await chrome.tabs.group({ tabIds: t.id });
  await chrome.tabGroups.update(gid, { title: "CudeAll", color: "blue" });
  refresh();
};
document.getElementById("tabs").onclick = async () => {
  const tabs = await chrome.tabs.query({});
  st.textContent = `${tabs.length} sekme açık`;
};
document.getElementById("close").onclick = async () => {
  const groups = await chrome.tabGroups.query({ title: "CudeAll" });
  for (const g of groups) {
    const tabs = await chrome.tabs.query({});
    for (const t of tabs.filter((x) => x.groupId === g.id)) await chrome.tabs.remove(t.id).catch(() => {});
  }
  refresh();
};
refresh();
setInterval(refresh, 2000);

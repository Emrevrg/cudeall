// Cude Desktop — guvenli kopru (renderer dogrudan node'a erisemez).
const { contextBridge, ipcRenderer } = require("electron");
const call = (ch, a) => ipcRenderer.invoke(ch, a || {});
contextBridge.exposeInMainWorld("cude", {
  mcpList: () => call("mcp-list"),
  mcpCall: (name, args) => call("mcp-call", { name, args }),
  workspaceSet: (path) => call("workspace-set", { path }),
  route: (text, cur) => call("router-route", { text, cur }),
  mdConvert: (p) => call("md-convert", { path: p }),
  shellRun: (cmd, cwd, timeoutMs) => call("shell-run", { cmd, cwd, timeoutMs }),
  chatSend: (o) => call("chat-send", o),
  agentRun: (o) => call("agent-run", o),
  spineStatus: () => call("spine-status"),
  spineCapabilities: () => call("spine-capabilities"),
  providersStatus: () => call("providers-status"),
  fsReadImage: (p) => call("fs-read-image", { path: p }),
  fsReadText: (p) => call("fs-read-text", { path: p }),
  fsWriteText: (p, text) => call("fs-write-text", { path: p, text }),
  dialogFile: () => call("dialog-file"),
  dialogDir: () => call("dialog-dir"),
  shellOpen: (p) => call("shell-open", { path: p }),
  settingsGet: () => call("settings-get"),
  settingsSet: (o) => call("settings-set", o),
  winMin: () => call("win-min"),
  winMax: () => call("win-max"),
  winClose: () => call("win-close"),
  winQuit: () => call("win-quit"),
});

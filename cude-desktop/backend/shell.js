// Cude Desktop — basit kabuk (terminal paneli icin). PTY yok; satir calistir-sonuc dondur.
// Agir/israrci komutlar timeout ile olur. Yikici kalip (rm -rf /, format) engelli.
const { execFile } = require("node:child_process");

function run(cmd, cwd, timeoutMs = 60000) {
  const c = String(cmd || "").trim();
  if (!c) return Promise.resolve({ code: 0, out: "", err: "" });
  if (/rm\s+-rf\s+\/|format\s+[a-z]:|del\s+\/[fs]q?\s+[a-z]:\\/i.test(c)) {
    return Promise.resolve({ code: 403, out: "", err: "Guvenlik: yikici komut engellendi." });
  }
  return new Promise((resolve) => {
    const isWin = process.platform === "win32";
    const bin = isWin ? "cmd" : "sh";
    const args = isWin ? ["/c", c] : ["-c", c];
    execFile(bin, args, { timeout: timeoutMs, cwd: cwd || process.cwd(), maxBuffer: 2 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ code: err && err.code !== undefined ? err.code : err ? 1 : 0, out: stdout || "", err: (err && err.killed ? "ZAMAN ASIMI\n" : "") + (stderr || "") });
    });
  });
}

module.exports = { run };

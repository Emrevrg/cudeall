// Cude Desktop — MarkItDown koprusu (ozgun entegrasyon).
// Strateji: once ORIJINAL MarkItDown (CLI/python) dene; yoksa yerli donusturuculer;
// hicbiri yoksa tek komutluk kurulumu soyle. Saldiri/uzak URL YOK — sadece yerli dosya.
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function sh(cmd, args, timeout = 60000) {
  const bin = process.platform === "win32" ? "cmd" : cmd;
  const a = process.platform === "win32" ? ["/c", cmd, ...args] : args;
  return new Promise((resolve) => {
    execFile(bin, a, { timeout }, (err, stdout, stderr) => resolve({ code: err ? 1 : 0, out: stdout || "", err: stderr || "" }));
  });
}

function stripHtml(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+\n/g, "\n").trim();
}

async function convert(absPath) {
  if (!absPath || !fs.existsSync(absPath)) throw new Error("Dosya yok: " + absPath);
  const st = fs.statSync(absPath);
  if (st.size > 15 * 1024 * 1024) throw new Error("Dosya cok buyuk (>15MB).");
  const ext = path.extname(absPath).toLowerCase();
  // 1) metin ailesi: yerli, aninda
  if ([".txt", ".md", ".markdown", ".log", ".csv", ".tsv", ".json", ".yaml", ".yml", ".xml"].includes(ext)) {
    let t = fs.readFileSync(absPath, "utf8");
    if (ext === ".csv" || ext === ".tsv") {
      const d = ext === ".csv" ? "," : "\t";
      const rows = t.split(/\r?\n/).filter(Boolean).map((r) => "| " + r.split(d).join(" | ") + " |");
      if (rows.length) t = rows.join("\n");
    }
    return { engine: "cude-yerli", markdown: t.slice(0, 60000) };
  }
  if ([".html", ".htm"].includes(ext)) {
    return { engine: "cude-yerli", markdown: stripHtml(fs.readFileSync(absPath, "utf8")).slice(0, 60000) };
  }
  // 2) ORIJINAL MarkItDown: CLI once, sonra python modulu
  const tryMark = async (cmd, args) => {
    const r = await sh(cmd, [...args, absPath], 120000);
    if (r.code === 0 && r.out.trim()) return r.out.slice(0, 80000);
    return null;
  };
  let md = await tryMark("markitdown", []);
  if (md) return { engine: "markitdown-cli", markdown: md };
  md = await tryMark("python", ["-m", "markitdown"]);
  if (md) return { engine: "markitdown-python", markdown: md };
  // 3) yoksa durust yonlendirme
  throw new Error(`Bu tur (${ext}) icin donusturucu yok. Secenekler:\n1) Microsoft MarkItDown: pip install markitdown (python gerekli)\n2) Dosyayi .txt/.md/.csv olarak kaydet, tekrar dene.`);
}

module.exports = { convert };

// Ornek otomasyon: tekrar-dene (retry with backoff)
// Claude/Codex'in "rate_limit'te oldur, isi yarim birak" hastaliginin ilaci:
// gecici hatalarda bekleyip tekrar dener, isi yarida birakmaz.
// Calistir: cude_automation(action=run, name=ornek-tekrar-dene)
// Kullanim: node ornek-tekrar-dene.mjs -- <komut> [argumanlar...]
// Ornek: node ornek-tekrar-dene.mjs -- ping -n 1 8.8.8.8
import { spawn } from "node:child_process";

const args = process.argv.slice(2);
const sep = args.indexOf("--");
const cmd = sep >= 0 ? args.slice(sep + 1) : args;
if (!cmd.length) {
  console.log("Kullanim: node ornek-tekrar-dene.mjs -- <komut> [args...]");
  process.exit(2);
}
const MAX = Number(process.env.NEZ_RETRY || 5);
let wait = 2000;
for (let i = 1; i <= MAX; i++) {
  const code = await new Promise((res) => {
    const p = spawn(cmd[0], cmd.slice(1), { stdio: "inherit", shell: true });
    p.on("error", () => res(99));
    p.on("close", res);
  });
  if (code === 0) { console.log(`OK (deneme ${i})`); process.exit(0); }
  if (i === MAX) { console.log(`BASARISIZ (${MAX} deneme). Komut: ${cmd.join(" ")}`); process.exit(code || 1); }
  console.log(`Deneme ${i} basarisiz (exit=${code}). ${wait / 1000} sn sonra tekrar...`);
  await new Promise((r) => setTimeout(r, wait));
  wait *= 2; // ustel bekleme: 2sn, 4sn, 8sn...
}

// Cude Desktop — niyet router: goreve uygun modu ONERIR, gecis icin ONAY ister.
// Kural tabanli, yerli, anahtarsiz. Son karar her zaman kullanicida (ayar: oto-gecis).
const RULES = [
  { mode: "computer", neden: "tiklama/ekran/pencere istegi", keys: ["tikla", "tiklat", "ekrani", "ekran goruntusu", "pencereyi", "pencere ac", "masaustu", "mouse", "klavye", "surukle", "buyut", "kapat dugmesi", "baslat menus"] },
  { mode: "agent", neden: "calistir/test/uygula istegi", keys: ["test et", "calistir", "kos", "uygula", "duzelt", "ara ve duzelt", "plani uygula", "hepsini yap", "bastan sona", "yorum satiri", "refactor"] },
  { mode: "ide", neden: "dosya/kod duzenleme istegi", keys: ["dosyayi ac", "duzenle", "kod yaz", "fonksiyon ekle", "satiri degistir", " dosyada", "kaydet", "ide"] },
  { mode: "chat", neden: "arastirma/soru/icerik istegi", keys: ["arastir", "nedir", "nasil", "ozetle", "acikla", "karsilastir", "pdf", "dokuman", "tanit", "brag", "plan yap", "oner", "yardim", "merhaba", "selam"] },
];

function route(text, curMode) {
  const t = String(text || "").toLocaleLowerCase("tr-TR");
  let best = null, score = 0;
  for (const r of RULES) {
    let s = 0;
    for (const k of r.keys) if (t.includes(k)) s += k.length;
    if (s > score) { score = s; best = r; }
  }
  if (!best || score < 4) return { mode: curMode || "chat", auto: true, neden: "belirgin sinyal yok, mevcut modda kal" };
  const needApproval = best.mode !== (curMode || "chat");
  return { mode: best.mode, auto: !needApproval, neden: best.neden };
}

module.exports = { route, MODES: ["chat", "ide", "agent", "computer"] };

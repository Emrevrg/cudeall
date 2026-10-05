# Cude Desktop — sohbet + IDE + ajan + computer-use tek cati

CudeAll'in masaustu bedeni: VSCode ruhu (Monaco), opencode+codex mantigi (ajan),
cowork/chat hissi, manus tarzi cok yonluluk. MIT — ozgun, acik kaynak.

## 4 mod + router

| Mod | Ne yapar |
|---|---|
| Sohbet | Saglayicinla konus (kasadaki anahtar), arastirma, PDF->markdown; `/project`, `/task`, `/continue`, `/status`, `/test`, `/review`, `/search` |
| IDE | Monaco editor + dosya ac/kaydet + alt panelde kabuk |
| Ajan | Gorevi araclarla kosar (web/hafiza/ekran), adimlari gosterir |
| Bilgisayar | Ekran goruntusu -> koordinat -> tik/yaz (CudeAll guvenlik kurali gecerli) |

Router her girdide modu ONERIR, gecis icin ONAY ister (Ayarlar'da oto-gecis acilabilir).

## Calistir

```powershell
cd cude-desktop
npm install --no-audit --no-fund   # bir kez
npm start                          # uygulamayi ac
npm run smoke                      # 6 sn acilis kaniti (konsol hatasi raporlar)
```

## Mimari

- `main.js` — pencere (cercevesiz baslik + sekmeler), tray (tepsi), gorev cubugu kimligi, IPC.
- `preload.js` — guvenli kopru (renderer node'a erisemez).
- `backend/mcp.js` — gomulu CudeAll MCP istemcisi (14 arac hepsi kullanilabilir); secili workspace proje baglamini ve ortak gorev panosunu belirler.
- `backend/chat.js` — BYOK konusma (OpenAI-uyumlu + Anthropic) + 6 adimlik ajan dongusu.
- `backend/router.js` — yerli niyet siniflandirici (anahtarsiz).
- `backend/markitdown.js` — once ORIJINAL MarkItDown (CLI/python), yoksa yerli donusturucu, yoksa kurulum soylenir.
- `backend/shell.js` — basit kabuk (yikici komut engelli).
- `renderer/` — 4 mod + ayarlar + sekmeler.

Sohbet alaninda secili workspace icin `/project` proje ozetini verir. `/task start`, `/task plan`, `/task decision`, `/task status`, `/task handoff` ve `/task complete` ayni `.opencode/cudeall/tasks/` kaydini OpenCode MCP ile paylasir; her normal sohbet ve ajan istegine secili workspace ozeti eklenir. `/continue` yalnizca secili projedeki en guncel acik gorevi acar.

## Sinirlar (durust)

- Model beyni icin saglayici anahtari gerekir (Ayarlar; kasaya terminalden eklenir, value sohbete girmez).
- Terminal PTY degil, basit kabuktur (node-pty yukseltme yolu acik).
- Monaco once yerli, sonra CDN, sonra duz alan dener — hicbiri yoksa duz alanla devam, cokmez.

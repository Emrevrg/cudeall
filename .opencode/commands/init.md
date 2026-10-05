---
description: Codex /init karsiligi — projeyi analiz edip AGENTS.md iskeleti cikar
agent: build
---
Bu projeyi 2 dakikada devral:

1. Kök dizindeki paket yoneticisi + dil + framework'u tespit et (`package.json`, `*.sln`, `requirements.txt`, `go.mod`...).
2. Calistirma/test/derleme komutlarini bul, HEPSINI calistirmadan listele; en zararsiz dogrulamayi (or: `node --version`, liste komutu) calistir.
3. Klasor agacini 2 seviye ozetle.
4. `AGENTS.md` yoksa olustur: proje ozeti + komutlar + kurallar (`.env` okuma yasagi, secret yasagi). Varsa eksikleri ekle, uzerine yazma.
5. Sonucu 10 satirda ozetle: ne projesi, nasil calisir, nasil test edilir.

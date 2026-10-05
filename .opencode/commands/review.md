---
description: Codex /review karsiligi — degisiklikleri guvenlik + kalite + test acisindan incele
agent: build
---
`git diff` ve `git status` ciktisina bak, asagidaki gozle incele, Turkce rapor ver:

1. Guvenlik: secret sizintisi, komut enjeksiyonu, yetki asimi, `.env` okuma var mi?
2. Dogruluk: yarim birakilan TODO, hata yutma (bos catch), yanlis kosul var mi?
3. Test: degisen kodu dogrulayan test/adim calistirildi mi? Calistirilmadiysa calistir.
4. Kapsam disi: istenmeyen dosya (kilit dosyalari, gecici cikti) commit alana girmis mi?

Sonuc: BULGU yoksa "temiz" de ve bitir. Varsa dosya:satir ver, duzeltmeyi oner, kritikse duzelt.

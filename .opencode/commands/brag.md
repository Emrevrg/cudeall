---
description: Brag karsiligi — projeyi tek komutla tanitim paketine cevir (tur + ekran goruntuleri + paylasim metni)
agent: build
---
Yaptin, simdi HAVA AT. $ARGUMENTS opsiyonel canli URL (yoksa statik analiz):

1. Projeyi 1 dakikada anla: README + paket dosyasi + klasor agaci (2 seviye). Urun CUMLESI cikar (1 cumle: ne + kimin icin).
2. `brag-output/` klasoru ac. Canli URL varsa `cude_browser` ile tur at: ana sayfa -> en onemli 2 sayfa/ekran; her durakta screenshot al, `read` ile goruntuyu dogrula (bos sayfayi OVME).
3. `brag-output/SHARE.md` yaz: baslik + 1 cumlelik ozet + 3 maddelik ozellik + ekran goruntu listesi + TR ve EN paylasim metni (X/LinkedIn, 2-3 cumle, hashtag'li).
4. `brag-doc` istendiyse (`$ARGUMENTS` icinde "doc" geciyorsa): `git log --oneline -30` + `git diff --stat` ile katkilari cikar, `brag-output/BRAG-DOC.md` yaz: Basarilar (kanitli, tarihli) -> Etki (sayi varsa) -> Gorunmez isler (sor: test, dokuman, mentorluk?).
5. Video (mp4) sormadigi surece URETME. Sorarsa: FFmpeg yoksa kurulumu ver (`winget install ffmpeg`), sonra kareleri slayt videosuna cevirmeyi oner — asla varmis gibi davranma.

Kural: calismayan seyi ovme. Screenshot bos geldiyse once duzelt, sonra brag.

---
description: Codex /plan karsiligi — kod yazmadan once plan oner, onay bekle
agent: plan
---
Kullanicinin son istegini KOD YAZMADAN plana dok:

1. Ilgili dosyalari `read`/`glob`/`grep` ile incele (degisiklik YOK).
2. Plani su basliklarla ver: Hedef (1 cumle) → Adimlar (numarali, dosya yollu) → Riskler → Dogrulama (hangi komut/test).
3. 5 adimdan uzunsa ilk bagimsiz parcayi isaretle ("buradan baslayabiliriz").
4. Sonda tek soru sor: "Onayliyor musun, baslayayim mi?" — onay gelmeden implemente ETME.

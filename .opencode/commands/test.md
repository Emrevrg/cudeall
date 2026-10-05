---
description: TestSprite+Strix karsiligi — tek komutla tam QA dongusu (plan+kos+rapor)
agent: build
---
"Oldu" deme, KANITLA. $ARGUMENTS opsiyonel canli URL (web/api icin):

1. `cude_qa` ile `action=plan` cagir: TC listesini oku.
2. `action=run`, `suite=all` (URL varsa `url=$ARGUMENTS` ile) calistir.
3. `action=report` ile hukmu al: FAIL varsa listedeki duzeltmeleri UYGULA, ilgili suite'i tekrar kos.
4. PASS olana kadar dongu (en fazla 3 tur), sonra sonucu ozetle: ne test edildi, ne duzeldi, ne kaldi.

Kural: kirmizi test varken "bitti" YAZMA.

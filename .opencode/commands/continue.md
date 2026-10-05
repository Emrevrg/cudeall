---
description: Codex resume --last karsiligi — en son yarim isi dosyasiz devral
agent: build
---
Secili projedeki isi devral; proje secimi belirsizse dosya/gecmis okumadan once secili workspace'i kullan veya kullanicidan hangi projeyi kastettigini netlestir.

1. `cude_project(action=context)` ve `cude_task(action=list)` ile proje talimatlarini ve acik gorevleri incele.
2. Acik gorev varsa `cude_task(action=read, id=...)` ile hedefi, son olaylari ve bitmemis plani bul; bunu kullaniciya 2-3 cumlede ozetle ve kaldigi adimdan surdur.
3. Acik gorev yoksa, yalnizca secili projeye ait oturumlari `cude_history` ile listele/devral. Kayit kaynagini belirt; baska projelerin sohbetlerini tarama.
4. Kilometre tasinda ayni gorev kaydini guncelle. Yeni bir ajan/oturum devralacaksa `cude_task(action=handoff)` ile devir notu uret.

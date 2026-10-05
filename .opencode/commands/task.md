---
description: Project-scoped CudeAll gorevi baslat, izle veya ajanlar arasinda devret
agent: build
---
Komut sozdizimi: `/task start <hedef>`, `/task list`, `/task status <id>`, `/task update <id> <not>`, `/task plan <id> append|replace <adim>`, `/task decision <id> <karar>`, `/task handoff <id> <ajan> <sonraki adim>`, `/task complete <id> <dogrulama>`.

- Ilk kod degisikliginden once secili proje icin `cude_project(action=context)` kullan.
- Hedef birden fazla adim veya birden fazla oturum/ajan gerektiriyorsa `cude_task(action=start, objective=...)` ile ortak kayit ac.
- Gorev surerken `cude_task(action=plan, operation=append|replace, steps=[...])` ile plani evrimlestir; mimari/urun tercihlerini `cude_task(action=decision)` ile karar defterine ekle.
- Ilerlemeyi, dosya ciktisini ve dogrulamayi `cude_task(action=update)` ile kaydet; handoff metninde kararlar, bitmemis adim ve ilgili dosyalari belirt.
- `complete` ancak neyin kontrol edildigini `verification` alanina yazinca kabul edilir. Test istenmediyse test kosma; dogrulamayi "kod incelemesi; test calistirilmadi" diye kaydet.

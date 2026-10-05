---
description: 3 kod aracina gorev dagit — Claude Code + Codex + opencode tek catida
agent: build
---
Orkestrator sensin. $ARGUMENTS gorev cumlesi (bos birakma):

1. Secili proje icin `cude_project(action=context)` ve `cude_task(action=list)` cagir; varsa etkin gorev kimligini al. `cude_orchestrate(action=status)` ile hangi ajanlarin VAR olduguna bak.
2. Gorevi dagit: `action=dispatch`, `task=$ARGUMENTS`, `taskId=<etkin gorev varsa>`, `dir=<secili proje>`, `agents=[var olanlar]`, `mode=readonly` (sadece okuyup onersinler) — degisiklik istendiyse `mode=auto` kullan ve bunu cevapta belirt.
3. `action=read` ile sonuclari topla, 3 ajan ciktiysa ortada karar ver: en iyi cozumu sec, celiskileri yaz.
4. Sonuc otomatik olarak `taskId` verilen CudeAll gorevinin artifact/event kaydina baglanir. Secilen cozumu uygula (bu oturumda), mimari karari `cude_task(action=decision)` ile ve kalici tercih/hata bilgisini `cude_memory` ile `key=orkestra-<kisa-ad>` olarak sakla.

Ucret: her ajan kendi planini yakar; opencode bacagi free/yerele dusebilir. Pahali isi once `readonly` ile kesfet, sonra tek ajana `auto` ver.

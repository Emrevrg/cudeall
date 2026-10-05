---
description: Codex /doctor + /bootstrap karsiligi — omurga durumu, arac kesfi ve kose basi adapterlari
agent: build
---
CudeAll omurgasini denetle ve eksik kose basi baglantilarini kur.

1. `cude_spine(action=status)` ile kisa durumu al; `action=capabilities` ile hangi aracin (OpenCode/Codex/Claude/Cude Desktop) nerede bagli oldugunu kesfet.
2. Baglam dosyasi yoksa `cude_spine(action=context)` ile uret (`.opencode/cudeall/context.md`).
3. Codex/Claude/opencode adapter bloklari eksikse once `cude_spine(action=adapters, mode=dry)` ile degisikligi ongor, sonra onayli ise `mode=dry` olmadan yaz (isaretli blok kullanici metnini degistirmez).
4. Bekleyen devir varsa `cude_spine(action=handoffs)` listele, uygun olani `action=claim, id=..., agent=...` ile devral.
5. Son kanitlari `cude_spine(action=kanitlar)` ile goster; kanit yoksa "dogrulanmadi" de, gecmis gibi sunma.
6. Sonucu 8 satirda ozetle: baglam | adapter | bekleyen devir | kanit | eksik olan (varsa tek satirlik cozum komutu).

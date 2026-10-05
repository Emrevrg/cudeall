# Automations

Kendine otomasyon yazma klasoru. `cude_automation(action=save, name, script)` buraya `.mjs` kaydeder.

Ornek: `ornek-gunluk-ozet.mjs` dosyasina bak, kopyala, kendi isini yaz.

Kurallar:
- Calisir Node ESM kodu olmali.
- Yikici komut (rm -rf /, format, sifre sizdirma) yasak.
- Secret'i koda gommek yasak, env'den oku.

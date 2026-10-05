# Chrome eklentisi — 2 dakikalık kurulum

opencode'un SENİN Chrome'unu kullanması (sekmeleri görmesi, kendi **CudeAll** grubunu açıp içinde çalışması, sayfa okuyup tıklaması) için bu eklenti şart. CDP yedeği grup açamaz — eklenti açar.

## Kurulum

1. Chrome adres çubuğuna yaz: `chrome://extensions`
2. Sağ üstte **Geliştirici modu**nu aç.
3. **Paketlenmemiş öğe yükle** → bu klasörü seç: `chrome-extension`
4. Araç çubuğuna iğnele (yapboz ikonu → cudeall → iğne).
5. opencode'da bir iş tetikle (MCP köprüyü `127.0.0.1:18789`'da açar). Eklenti popup'ında **"Bağlı"** görmelisin.

Eklentinin kimliği sabitlenmiştir; MCP köprüsü yalnız bu kimlikten gelen tarayıcı isteklerine izin verir. İlk bağlantıda eklenti, kullanıcıya gösterilmeyen kısa ömürlü süreç anahtarını alır. Yerel köprü adresini tarayıcıya elle açmak artık durum bilgisi vermez; bu, web sayfalarının komut kuyruğunu okumasını önlemek içindir.

Güncelleme sonrası Chrome'da bu klasörün yüklenmiş kopyasını **Yeniden yükle** ile tazele. Başka bir CudeAll kopyası/kimliği görünürse etkin olanı kendin seç; bu proje açık tarayıcı oturumlarını otomatik kapatmaz veya değiştirmez.

İzinler neden: `tabs`+`tabGroups` (sekme gruplarını yönet), `scripting` (sayfa oku/tıkla/yaz), HTTP/HTTPS site erişimi (kullanıcının seçtiği sayfalarda çalış) ve localhost köprüsü.

## Akış (senin istediğin)

1. `cude_browser(action=status)` → eklenti bağlı mı bak.
2. `cude_browser(action=group_open)` → **CudeAll** grubu açılır (mavi). Senin gruplarına dokunulmaz.
3. `cude_browser(action=open, url=...)` → sayfa CudeAll grubunda açılır.
4. `cude_browser(action=read)` → sayfa metni + linkler + butonlar gelir.
5. `cude_browser(action=click, text="Gönder")` veya `selector="#btn"` → etkili tıklama.
6. `cude_browser(action=type, selector="input[name=q]", text="...", submit=true)` → yazar + gönderir.
7. İş bitince `cude_browser(action=close)` → sadece CudeAll grubu kapanır.

## Sorun giderme

- "Eklenti yanıt vermedi" → opencode/MCP çalışıyor mu? Köprü durumu kimlik doğrulamalıdır; URL'yi elle açmak yerine eklenti popup'ındaki bağlantı durumuna bak.
- `tabs` boş / chrome:// sayfaları okunmuyor → normal, Chrome iç sayfalarına eklentiler giremez.
- Girişli siteler: SEN giriş yaparsın, eklenti senin oturumunu kullanır (şifreni sohbete yazma).

# Flashy teması — offline kök menü (2026-10-02)

> Karar (Nadir 02.10): Flashy setlerinin (74430, 59480, 60114) offline paketinde kök menü =
> Flashy'nin web'deki set index'i, AYNEN. Kaynak: Worker'ın `web-proxy-modern` teması
> (`flashyelt.ndr.ist/go/<kod>/web-stream/`). İmpark'ın Cozumler/Web sayfası CF 403, kullanılmaz.
> Kod: `src/agent/webz-tema-kabuk.js` · Tema kopyası: `src/agent/webz-tema/web-proxy-modern/`
> · Eşitleme: `tools/webz-tema-esitle.js` · Test: `src/agent/webz-tema-kabuk.test.js`.

## Kaynak ve parite

| Ne | Değer |
|---|---|
| Tema kaynağı | book-update `services/cloudflare-worker/src/set-ui-templates.ts` `'web-proxy-modern'` (satır 13340-15049, commit e7b2da99 2026-09-22) |
| Canlıyla parite (02.10) | 7 JS/CSS dosyası canlı `mj17c` (74430) ile `cmp` AYNI; index.html farkı yalnız Worker enjeksiyonu (gtag, polyfill, manifest, title, sayfa önyükleme) |
| Kayma bekçisi | test "kaynak paritesi" (book-update varsa bayt bayt) + `KAYNAK.json` sha256 |

## Hangi dosya offline'a taşınır

| Tema dosyası | Pakette | Not |
|---|---|---|
| `_design/{tokens,components}.css`, `_design/components.js`, `theme.css`, `theme.js`, `scripts/{library,xmlParser}.js` | AYNEN | bayt bayt; davranış farkı yalnız yamadan |
| `images/logo.png`, `images/bg.jpg` | AYNEN | Flashy ELT logosu (327×327), düz beyaz bg |
| `index.html` | DÖNÜŞTÜRÜLÜR | CDN → `_vendor/`, `<title>` = set adı, `<meta name="empp-webz-tema">`, yama + stil eklenir |
| `config/settings.json` | YENİDEN | listeden; yamadaki `__setSettings` ile birebir |
| `covers/*.svg`, örnek `config/settings.json`, `scripts/book-preloader.js` | GİRMEZ | örnek / index.html yüklemiyor |
| (yeni) `scripts/cevrimdisi-yama.js`, `styles/cevrimdisi.css`, `set-menu.json`, `_vendor/**`, `images/bookN.<tür>` | ÜRETİLİR | kapak yalnız verilirse |

## Ağ bağımlılıkları → yerel karşılık

| Bağımlılık (web) | Offline |
|---|---|
| Google Fonts (Fraunces, Plus Jakarta Sans) | `_vendor/fonts/` woff2 + `fonts.css` (OFL) |
| Font Awesome 6.5.2 cdnjs | `_vendor/fontawesome/` css + 4 woff2 (ttf yedekleri atıldı) |
| gtag, Turnstile, `polyfill.js`, manifest/SW (Worker enjekte) | YOK (tema dosyası değil, kopyada hiç yok) |
| `config/settings.json` (Worker KV'den dinamik) | yama `fetch` sarmalı → gömülü `window.__setSettings` |
| `images/bookN.png` (Worker kapak proxy'si) | yama `renderCardGrid` sarmalı → `coverUrl` (`bookN/assets/<id>/thumbs/1.jpg` ya da `images/bookN.<tür>`) |
| `/Uploads/WebDijitapDosyalar/<id>/data/BookContent.xml` (üniteler) | gömülü `window.__setUniteler[assetId]` (üretimde BookContent'ten, tema kuralıyla); yoksa `[]` → kitap doğrudan açılır. Temanın "Unit N — Örnek" 8 sahte ünite yedeği ASLA çıkmaz |
| `location.href = /go/<kod>/web-stream/bookN/...` (`openPage`) | `bookN/index.html?defaultPageNo=<sayfa>` (İmpark motoru, sf425 ile aynı parametre); `book\d+` dışı kimlik açılmaz |
| Kütüphanem / PWA kısayolu (`location.origin/go/<kod>`) | gizlenir (`styles/cevrimdisi.css`); file:// altında anlamsız |
| Link kartı (`type:'link'`, set-ek Worksheet) | `window.open(url, '_blank')`, kapak yok, rozet "BAĞLANTI" |

Yama sırası: components.js → xmlParser.js → library.js → **yama** → theme.js. `openPage` theme.js'te
`function` bildirimi olduğu için atama `DOMContentLoaded`'da (yamanın dinleyicisi önce koşar).

## Menü sözleşmesi (araç uyumu)

| Araç | Uyum |
|---|---|
| `g-yayin/menu.yamaAyir`, `set-uyelik-ek` | yamada TEK `window.__setSettings = {...};` + `config/settings.json` aynı books |
| `set-menu-bicim.webZKabukIndexiMi` (K17, kök-ezilme kapısı, set-ek) | `language-set.js` YOK → imza meta `empp-webz-tema` eklendi, işlev iki imzayı tanır |
| index üreteci `webzMenuDosyalari` | yamayı `yamaAyir` ile yeniden yazabilir; `__setUniteler` dışarıda kalır, korunur |

## Index üreteci kancası (bookN düzeni)

`kabukUret({ setAdi, kitaplar: [{ n, assetId, ad, grup, bookContent?, kapak? }] })` →
`{ dosyalar: Map<yol, Buffer> }` köke yazılır. Kalıbın kökü (sf425 + YDS `images/logo.png` +
`kurum.txt`=60) AÇILMAMALI; tema seçimi `temaSec({ kurum: '310' })`.

## Kurum numarası + logo (ölçüm 02.10)

| Kanıt | Sonuç |
|---|---|
| İmpark SQL `S_TestKitaplar.UstKurumId` 74430, 69523, 69084, 59480, 60114 | **310** (`S_UstKurumlar` flashyelt, flashyelt.yayincilik.net) |
| Çapraz kontrol 73768/45550/45482 | 60 "YDS Yayıncılık" = arşivlerdeki `kurum.txt` 60 → `kurum.txt` = UstKurumId |

İmpark motorunun kurumu okuduğu yerler (74430 prototipi `book1/`, bundle `bd0c1a4f…main.js`):

| Nokta | 74430 prototipinde | Etki |
|---|---|---|
| `bookN/kurum.txt` (`getFilePath` = `window.__dirname`) | 60 | `GetKurumLogo?id=<kurum>` → `core/kurumlogo.png` (yalnız mevcut logo düz PNG ise yeniden yazılır) |
| `bookN/core/kurumlogo.png` | YDS logosu (gözle doğrulandı) | çevrimdışı okuyucuda YDS logosu görünür |
| `bookN/app.config.js` `baseEndpointUrl` | `https://akillitahta.ydspublishing.com` | CDP'de ölçüldü: `IsZKitapKurumAktif`, `GetPackageBooks` YDS alanına gidiyor |
| kök `kurum.txt` | 60 | `publisher-update.companyIdFrom` → YDS'nin çalışma zamanı güncellemesi (`uploads/akillitahta/060/Update`) |
| ImWin32 `cover corpID` / `main label` | 60 / "İmpark Eğitim" | bundle `corpID`'yi okumuyor (yalnız `corpID:0` yazıyor) |

Sonuç: YDS motor bundle'ı genel (yayıncıya özgü kod yok). Yalnız `kurum.txt`'yi değiştirmek YETMEZ:
4 nokta değişmeli (iki `kurum.txt`, `core/kurumlogo.png`, `app.config.js` `baseEndpointUrl`).
Kök kabuk bu 4 noktaya DOKUNMAZ (kitap motoru = index üreteci işi). Paketleyici logo kaydı
"Flashy ELT" = settings `publisherName`.

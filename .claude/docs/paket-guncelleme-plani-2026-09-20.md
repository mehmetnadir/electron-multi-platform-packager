# Paket Güncelleme Planı — "aç, arkada güncelle, göz kırp"

> Nadir talebi (2026-09-20): *"ürettiğimiz exe'lerin güncellenmesi için… sayfa açıldıktan
> sonra (güncelleniyor, sayfa yenilenecek diyerek) hemen sayfayı göz kırpmasını uygulama
> içinde yapacak halde olmalıyız. Sanırım bunun için yol, arayüzdeki kitap setleri ve o
> setlerin kendi id'leri olması yoluyla mümkün olur dimi? Çünkü exe üretimlerini
> panelimiz üzerinden yapacağız."*
>
> Durum: **TASLAK — Nadir kararı bekliyor.** Aşağıdaki "Bugün ne var" bölümünün tamamı
> ölçüldü (kaynak kod + üretilmiş exe'nin içi); "Plan" bölümü öneridir.

## 0. KAPSAM DÜZELTMESİ (Nadir, 2026-09-20 — ilk taslaktan sonra)

> *"Ben electron ile sorucoz üzerinden yapılan impark kitap güncellemelerini kastetmiyorum.
> Ben index'in ve o paket içindeki değişikliklerin henüz kitap açılmadan gönderilebilmesinden,
> arka planda bu güncellemelerin indirilebilmesinden bahsediyorum. Kitaplar aynı şekilde
> ötelenmiş güncelleme ile veri çekmeye devam etsin. Ama düşünsene ben pakete başka bir buton,
> başka bir kitap eklersem ne olacak?"*

Yani bu planın konusu **PAKET YAPISI güncellemesi**, kitap içeriği değil:

| | Kapsam | Kim yönetir | Durum |
|---|---|---|---|
| **Hat B — kitap içeriği** (sayfa/soru/video) | mevcut kitapların verisi | İmpark / sorucoz.tv, motorun kendi akışı | **DOKUNULMAYACAK** — K25 ötelemesiyle olduğu gibi kalsın |
| **Hat C — paket yapısı** (BU PLAN) | kök `index.html`, menü, butonlar, **YENİ ALT KİTAP EKLEME**, assets2 | **BİZ** (panel) | kurulacak |

Hat C, Hat B'nin bir çeşidi değil — farklı bir şey. Hat B var olan bir kitabın içini
tazeliyor; Hat C **sete yeni bir öğe ekliyor**, yani menünün ve paket ağacının kendisini
değiştiriyor.

### Hat C'nin sert kısıtı (araştırmayla doğrulandı)

**Windows'ta çalışan Electron süreci `app.asar`'ı KİLİTLER** (electron/electron#6117;
aynı belirti VSCode ve electron-builder'da da kayıtlı: `EBUSY: resource busy or locked`).
Yani süreç kapanmadan asar'ın içine yeni bir kitap eklenemez — bu bir OS dosya kilidi
sınırı, aşılamaz.

Sonuç: **değişen kısım asar'ın içinde olamaz.** Yeni kitap ve güncellenmiş menü
`userData` altında, sürüm klasörü + pointer kalıbıyla durmalı:

```
userData/paket/
  surumler/v12/        ← yeni inen kabuk + yeni kitap(lar)
  surumler/v11/        ← bir önceki (geri alma için tutulur)
  guncel.json          ← {"surum":"v12"}  (tek küçük dosya, atomik yazılır)
```
Akış: geçici dizine indir → sha doğrula → `fs.rename` ile atomik yayına al → pointer'ı
çevir → `reload()`. Yarım inen paket asla yayına girmez.

### Bunun menüye faturası

Yeni kitap `userData` altında duracaksa, **menü onu bulabilmeli.** Bugün SET menüsü kök
`index.html`'de elle yazılmış statik HTML (`data-url="bookN/index.html"`, alt kitap listesi
config'te DEĞİL menünün HTML'inde). Statik HTML yeni kitabı göremez.

Yani Hat C, menünün **dinamik** olmasını gerektirir: paket içi kitaplar + `userData`
altındaki kitaplar bir manifest'ten okunup menü çalışma anında kurulur. Bu da bugünkü
kararı etkiliyor — `set-menu.js` şu an yayıncının kendi özel menüsüne bilerek DOKUNMUYOR
(`motorKopyasiMi()` false → `custom-menu-kept`). Hat C için menünün bizim ürettiğimiz,
manifest okuyan bir menü olması gerekir. **Nadir kararı gerekiyor** (açık soru 7).

---

## 1. Bugün ne var (ÖLÇÜLDÜ, 2026-09-20)

Pakette **iki ayrı** güncelleme hattı var ve ikisi de aynı sunucuya bakıyor.

### Hat A — motor/uygulama güncellemesi (ana süreç, `electron.js`)

```js
const endpoint = `https://www.sorucoz.tv/uploads/akillitahta/${companyId}/Update/`
http.get(endpoint + "version.html", …)          // gövde = sürüm no, örn "1.13.9"
  → checkVersion(version.txt, gövde)
  → downloadUpdates(endpoint + gövde + ".zip")
       const targetPath = path.join(__dirname, "update.zip")
       fs.createWriteStream(targetPath) … new AdmZip(targetPath).extractAllTo(dirname, true)
```

**Bu hat exe'de ÖLÜ.** `__dirname` paketlenmiş uygulamada `resources/app.asar/` — salt okunur.
`createWriteStream` daha ilk adımda patlıyor, hata `catch`'te yutuluyor. Depoda aynı belirti
zaten kayıtlı: `ENOENT .../update.zip not found in .../app.asar`. Hafıza:
`motor-guncelleme-350mb-bosuna` ("indiriyor, açmıyor") — sebebi budur.

Kimlik: `kurum.txt` ("60" → companyId "060") + `version.txt` ("1.13.8"). İkisi de SET kökünde,
alt kitaplarda YOK.

### Hat B — kitap içerik güncellemesi (renderer bundle'ı)

```js
r = AppConfig.xml.desktop.updateBookEndPoint
      .replace("{bookId}", t.id).replace("{version}", t.version).replace("{isSet}", "0")
fetch(r).then(r => r.json())        // → { Data: <zip url | falsy>, Vs: <yeni sürüm> }
```
Uç: `https://www.sorucoz.tv/TestlerMobil/GetKitapGuncellemeBilgi?id={bookId}&setMi={isSet}&versiyon={version}`

Güncelleme varsa:
```js
fetch(url).then(r => r.blob()) → fs.writeFile(cover.book + "\\update.zip", …)
  → new AdmZip(zip).extractAllTo(dir, true) → fs.unlinkSync(zip)
  → loadBook(cover)                      // YENİDEN BAŞLATMA YOK
  → L5(dll)                              // ImWin32.dll (gizlenmiş XML) yeni sürümle yazılır
```

**Bu hat tasarım olarak çalışıyor ve yeniden başlatma İSTEMİYOR.** Nadir'in istediği
"göz kırpma" davranışının çekirdeği zaten burada. Üç kusuru var:
1. Kitap **açılmadan ÖNCE** koşuyor (bloklayan "Kitap Güncelleniyor %" ekranı). K25 ile ana
   süreç ötelendi ama bu hat hâlâ açılış kapısında.
2. `setMi` **sabit "0"** — yani set seviyesi sorgu API'de VAR ama motor hiç kullanmıyor.
3. Hedef `sorucoz.tv`; Windows paketinde adres değişmiyor (aşağı bak).

### Kimlik envanteri — bugün exe'nin içinde fiilen ne var

| Kimlik | Nerede | Örnek | Seviye |
|---|---|---|---|
| companyId | `kurum.txt` | `"60"` → `"060"` | SET |
| paket sürümü | `version.txt` | `"1.13.8"` | SET |
| kitap içerik id'si | `bookN/assets/<id>/` dizin adı | `45516` | kitap |
| `cover.id` / `version` / `url` | **`ImWin32.dll`** içindeki gizlenmiş XML (`<cover ID= version= url= etkAdi= xmlSource=>`) | — | kitap |
| `zKitapId`, `bookId`, `isSet` | `app.config.js` şablonları | yalnız `{placeholder}` | kitap |
| **setId** | — | **YOK** | — |

Kritik: güncellemeyi süren kimlik `app.config.js`'te değil, **`ImWin32.dll`'in içindeki XML'de**.
Motor güncellemeden sonra o dosyayı yeniden yazıyor. Yani sürüm defteri orada tutuluyor.

`set_app.config`, `book1/app.config.js` ile bir alan dışında (`setBook.enable`) birebir aynı ve
kök hiçbir yerden referans almıyor — kalıntı. Alt kitap listesi de config'te değil, **kök
`index.html`'in HTML'inde** (`data-url="bookN/index.html"`).

### Üretilen exe'de ölçülen adresler (SM4-K25, app.asar 1532 MB)

| Arama | Sayı |
|---|---|
| `sorucoz.tv` | **150** |
| `updateBookEndPoint` | 11 |
| `setMi=` | 6 |
| `uploads/akillitahta` | 7 |
| `ydspublishing.com` | **0** |

Sebep: `yayinci-domain-yamasi.js` (K16) yorumunda açık — *"Windows bu adımı ALMAZ"*.
Yani Windows exe'si güncellemeyi yayıncının çalışan host'una değil, Cloudflare challenge
döndüren `sorucoz.tv`'ye soruyor.

### Elimizdeki hazır altyapı

`src/platforms/common/fs-shim.js` zaten bir **kaplama (overlay)**: yazmalar
`userData/work`'e, okumalar önce `work` sonra paket; `readdirSync` ikisinin birleşimi;
`window.fetch` bile `work`'teki dosyayı öne alıyor. İçeriği asar'ın dışında güncelleyip
motora yeni içeriği okutmak için gereken tam mekanizma budur.

İki boşluk: shim **yalnız renderer'da** (ana süreç kapsam dışı) ve
`if (proc.platform === 'win32') return null;` — **Windows'ta tamamen kapalı**.

### Paketleyici tarafındaki boşluklar

- Kuyruk **tamamen bellek içi** (`queueService.js` iki `Map`); süreç yeniden başlayınca
  iş geçmişi yok. Panel "X setinin güncel sürümü nedir?" sorusunu bugün yanıtlayamaz.
- Üretilen exe/dmg/apk için **sha256 hesaplanmıyor** (yalnız `size`).
- `appVersion` kullanıcı girdisi; paketin içindeki `version.txt` ile bağı yok.
- `resources/app-update.yml` → `provider: generic, url: https://example.com` — electron-updater
  fiilen bağlı değil (`generateUpdatesFilesForAllChannels: false`).
- SET tespiti ad kalıbıyla değil **motor imzasıyla** yapılıyor (`index.html` + `app.config.js`
  aynı dizinde) — `sub-book-dirs.js`.

## 2. Nadir'in hipotezinin değerlendirmesi

> *"setlerin kendi id'leri olması yoluyla mümkün olur dimi?"*

**Evet, doğru yön — ve yayıncı API'si bunu zaten biliyor:** `GetKitapGuncellemeBilgi`
imzasında `setMi` parametresi var. Eksik olan tam olarak senin işaret ettiğin şey: pakette
bir **setId yok**. Bugün bir SET'i tanımlayan tek şey `kurum.txt` + `version.txt`, ve
companyId aynı yayıncının BÜTÜN setlerinde aynı — yani bir seti tekilleştirmiyor.

Dolayısıyla iş sırası: **önce kimlik, sonra güncelleme akışı.** Kimlik olmadan "hangi sete
güncelleme var?" sorusu sorulamaz.

## 3. Plan

### Katman 0 — Panelde kalıcı paket kaydı  (önkoşul)
- Üretilen her paket için kalıcı satır: `setId`, `surum`, `kurum`, `platform`, `sha256`,
  `boyut`, `uretim_zamani`, kaynak zip'in sha256'sı, alt kitap listesi (`bookN` ↔ içerik id).
- `queueService`'in bellek-içi Map'i kalıcı bir deftere bağlanır (bugün restart'ta kayboluyor).
- Üretim sonunda artefaktın sha256'sı hesaplanır (bugün yok).

### Katman 1 — Pakete kimlik manifesti
Paket köküne `empp-paket.json` (asar içinde, salt okunur — yalnız okunacak):
```json
{ "setId": "...", "surum": "1.13.8", "kurum": "060",
  "guncellemeUcu": "https://<bizim-uc>/api/paket-guncelleme",
  "kitaplar": [ { "dizin": "book1", "icerikId": 45516, "surum": "..." } ] }
```
Çalışma anı sürümü `userData` altındaki deftere yazılır — asar'a yazılamaz.

### Katman 2 — Bizim güncelleme ucumuz
`GET /api/paket-guncelleme?setId=&surum=` → `{ var, surum, url, sha256, boyut, kapsam }`.
Zip R2'den servis edilir. `kapsam`: tüm set mi, yalnız değişen kitap(lar) mı.

### Katman 3 — Exe içi sessiz güncelleme (yeni modül: `acilis-sessiz-guncelleme.js`)
Kapı: `EMPP_SESSIZ_GUNCELLEME`, varsayılan AÇIK; K24/K25 ile aynı kalıpta enjeksiyon.
1. **İlk sayfa çizildikten sonra** (açılışı bekletmez — K25 kararının devamı) sorgula.
2. Güncelleme varsa arka planda indir → `userData/guncelleme/<surum>.zip`.
3. sha256 doğrula → geçici dizine aç → **atomik rename** ile `work` kaplamasına al.
   Yarım inen paket asla uygulanmaz.
4. Hazır olunca ince bir bant: *"Güncelleme uygulandı, sayfa yenileniyor…"* → ~1,5 sn →
   `location.reload()`. Electron'da bu göz kırpmadır; süreç yeniden başlamaz.
5. Başarısızlıkta hiçbir şey gösterme, bir sonraki açılışta yeniden dene (fail-silent).

Alternatif (daha da yumuşak): yenileme yerine motorun kendi `loadBook(cover)` yeniden
girişini tetiklemek — Hat B bunu zaten yapıyor, sayfa hiç kararmaz. Önce `reload()` ile
başlanır (basit, kesin), ikinci adımda `loadBook` denenir.

### Katman 4 — Windows'ta fs-shim
`win32` erken çıkışı kaldırılmalı ya da koşullu hale gelmeli; aksi halde güncellenen içerik
okunmaz. **Bu adım ölçüm ister** (aşağıdaki açık soru 5).

### Katman 5 — Hat A (motor güncellemesi) ne olacak?
Öneri: **kapatılsın.** Bugün zaten ölü, boşuna ağ ve süre harcıyor. Motor/uygulama
güncellemesi panelden yeni exe üretimiyle yapılır (imzalı); içerik güncellemesi Hat B'den.
Bu, "exe üretimini panelden yapacağız" planıyla da tutarlı.

### Katman 6 — Domain
Windows paketinde de güncelleme adresi bizim/yayıncının çalışan host'una çevrilmeli
(K16'nın Windows istisnası yeniden değerlendirilmeli) — yoksa exe Cloudflare challenge'ına
soruyor.

## 4. Nadir'e açık sorular (karar noktaları)

1. **setId'yi kim üretir?** Panel mi yeni bir kimlik mintler, yoksa yayıncı defterindeki
   mevcut kavram mı kullanılır (zid / seri / kitap kodu)?
2. **Güncelleme paketi neyi taşısın?** Tüm set mi, yalnız değişen alt kitap mı? (1,5 GB'lık
   sette fark büyük.)
3. **Hat A kapatılsın mı?** (Öneri: evet.)
4. **Doğrulama:** sha256 yeterli mi, yoksa imza şart mı?
5. **Windows'ta fs-shim açmanın regresyon riski** — ölçülmeden açılmamalı.
6. Güncelleme **sorulmadan** uygulanacak (Nadir'in talebi). Kullanıcıya yalnız bilgi bandı.
7. **Menü kimin olacak?** Hat C dinamik menü istiyor; yayıncının statik özel menüsüne
   dokunmama kararı (K17/`custom-menu-kept`) bununla çelişiyor. Yeni kitap eklenebilmesi
   isteniyorsa menü bizim manifest okuyan menümüz olmalı.
8. **Yeni kitap paketi ne kadar büyük?** Tek alt kitap sm4'te ~200-400 MB. İndirme
   arka planda ve kesintiye dayanıklı (Range/devam) olmalı.

## 5. Sıra

Katman 0 → 1 → 2 birlikte (kimlik + defter + uç), sonra 3 (exe içi akış), sonra 4/6 (Windows).
Katman 5 bağımsız, istenirse hemen.

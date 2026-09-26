# Aktivasyon Kodlu Windows Paketi Testi (2026-09-26)

> Görev: Windows sözleşmesinin kapanmamış maddesi — "aktivasyonlu paketler bizim NSIS
> paketimizde sağlıklı çalışıyor mu?" (G2: imKeys.dll/storage.im/K içeriği kurulum dizinine
> değil userData'ya yazılır). Sonuç: G1/G2 **koddan ve statik paketten kanıtlandı**; kitap
> gerçekten aktivasyonlu (panel: 15 kitaptan 13'ü kod_ister=1), ama bu kitapta `imKeys.dll`
> olmadığı için kod ekranı kararı SADECE çevrimiçi bir isteğe bağlı (§3) — başsız testte ağ
> kasıtlı kapalıydı, o yüzden kod ekranı görülmedi (kusur değil, ölçüm sınırı). Gerçek
> aktivasyon akışının uçtan uca doğrulanması internet AÇIK VM'de Nadir'de kalıyor.

## 1) Mekanizma özeti

Yayıncı uygulaması (React, Electron'da `window.require`): anahtar `classlibraries/ImWin32.dll`
(şifreli XML) içine `fs` ile YAZILIP `fetch()` ile OKUNUR (`getFilePath()` boş exe yolundan
kök-mutlak sahte yollar üretir: `/classlibraries/…`). Sunucu doğrulaması `KullaniciNewKeySet` /
`IsCorrectZKitapKey` (kitapId+key+makineId, makineId MAC adresinden); offline doğrulama isteğe
bağlı `assets/<id>/imKeys.dll` (yerel hash listesi) — HER kitapta yok. 20 cihaz sınırı SUNUCU
tarafında (paketimizde yerel sayaç YOK, `makineId=null` bile kabul ediliyor).

Bizim pakette (`src/platforms/common/fs-shim.js`, G1/G2 ile Windows'ta da AKTİF): yazma →
`EMPP_WORK_DIR` (=`userData/work`, `packagingService.js:1470-1476`), okuma önce WORK sonra
paket (asar'sız). Kaynaktaki `bookN/temp/data/storage.im` build zamanı dışlanıyor
(`packagingService.js:2195-2207`). K içerik kanalı (`window.require('adm-zip')`)
`empp-vendor/adm-zip` ile Windows'ta da açılıyor (`src/packaging/icerik-guncelleme.js`). G6
(`src/runtime/impark-kaldir.js`): aynı kitabın İmpark kurulumu varsa `ImWin32.dll` +
`imKeys.dll` ÖNCE bizim `userData/work`'e taşınır, SONRA İmpark klasörü silinir.

## 2) Aday kitap

45480 "Marvel Grade 11" (YDS Publishing): küçük→YDS→tek kitap sırasına göre seçildi (kaynak
686.811.352 B, Cloudflare engelsiz indi). Açılışta **SET** çıktı (Grammar/Reading/Vocabulary/
Workbook/Revision, tek motorlu `app.config.js`, `book1/book2` YOK). Panel (keypanel, srv21):
15 kitaptan **13'ü kod_ister=1** — kitap gerçekten aktivasyonlu, seçim doğruydu.

## 3) Aktivasyon kararını NE tetikliyor (kod okundu, dosya:bayt-ofseti)

`resources/app/da55ad5c4b8f1ec31f99.main.js`, webpack modül **6395** (minified, satır yok):

- **SET düzeyi (`main.$.activation`, offset ~368552):** masaüstü modunda (`bookModule.enable
  && !isWeb` — bizim durum) `ImWin32.dll` **doğrudan okunur** (`kV()`, ~370187), hiç ağ çağrısı
  YOK: `J = ("true"==$.json.main.$.activation)`.
- **Kapak (kitap) düzeyi — asıl soru, `g(cover)` (~378695-378900):**
  ```
  imKeysYolu = getFilePath(cover.xmlSource.replace("data/BookContent.xml","imKeys.dll"))
  if (fs.existsSync(imKeysYolu)) return true;                // 1) dosya varlığı — ağsız
  sonuc = await fetch(hasZKitapKeyUrl.replace("{kitapId}",cover.ID)).then(r=>r.json());
  return Boolean(sonuc?.Success);                              // 2) çevrimiçi — yalnız 1 yoksa
  catch → return false                                         // ağ hata/kapalıysa SESSİZCE hayır
  ```
  Sonuç `kV()`'de her kapağa yazılır (~380286): `cover.$.activation=g(cover)?"true":"false"`,
  "true" ise `key=""`.
- **Karar = dosya varlığı VE çevrimiçi isteğin BİLEŞİMİ**, dosya önce kontrol edilir. 45480'in
  15 kapağının hiçbirinde `imKeys.dll` YOK (kaynakta da yoktu) → 13 "kod_ister" kapak SADECE
  çevrimiçi `HasZKitapKey`'e bağlı. Başsız testte ağ kapalıydı → istek patladı → catch → false
  → kod ekranı görünmedi (kusur değil, ölçüm sınırı — VM testi internet AÇIKKEN yapılmalı).
- **Yazma (~383254):** kod girilince XML `xml2js.Builder` ile üretilir, 27 rastgele bayt +
  (1 gerçek karakter+4 rastgele)×N + 27 rastgele bayt olarak `ImWin32.dll`'e yazılır — bizim
  fs-shim bunu `userData/work/classlibraries/ImWin32.dll`'e yönlendirir (G2, doğrulandı).

## 4) Üretim

Kaynak → `unrar` → `resources/app/build` (731 MB) → `build.zip` (627 MB) → 3001 `/api/upload-
build` + `/api/package` (windows, appVersion 2.99.0, publisherName "YDS Publishing"), ~9 dk 26
sn. İlk denemede 3001 yüklemem sırasında başka bir eş-oturum ajanının restart'ı yüzünden upload
kayboldu (kuyrukta görünmediği için "boş" sanıldı) — ikinci denemede sorunsuz gitti. Çıktı:
`temp/f311ae09-.../windows/Marvel Grade 11-2.99.0-Setup.exe` (430.606.331 B).

## 5) Wine ve statik doğrulama

Sessiz kurulum (`wine … /S`) başlatıldı, Şef talimatıyla (macOS sürücüsü odak çalabilir)
**süreç ortasında kill edildi**; Wine bir daha başlatılmadı, gerçek kurulum/açılış denemesi
YAPILMADI. Doğrulama 7z listeleme/çıkarma ile başsız yapıldı: `$PLUGINSDIR/app-32.7z` içinde
`app.config.js`, `classlibraries/ImWin32.dll`, `kurum.txt` ("60") var; `imKeys.dll` YOK (kitapta
zaten yoktu). `resources/app/empp-icerik-durum.json`: `etkin.windows=true, hata=null,
admZip=true, modul=true` — K kanalı temiz. Root `index.html` md5 (paketlenmiş)
`529532c8…`, kaynak `c53f0c84…` (fark beklenen — başına `empp-fs-shim.js` enjekte ediliyor);
Şef'in verdiği referans `9f8032…` SM2 tipi ÇOK KİTAPLI kabuğun md5'iymiş, tek motorlu SET'te
farklı olması normal — hata yok.

## 6) Statik kapı + başsız kabul kapısı

`node scripts/windows-paket-kapisi.js <exe>`: 10 PASS · 2 FAIL · 2 ÖLÇÜLEMEDİ · 1 RAPOR
(FAIL'ler G1/G2 ile ilgisiz: madde 2 logo ikon alfası, madde 13 SET güncelleme kanalı — testte
`setKimligi` kasıtlı verilmedi). **[14] PASS — G1:** adm-zip 0.5.16 · `empp-icerik-guncelleme.js`
ve `empp-fs-shim.js` Windows'ta etkin · ana süreçte `EMPP_ICERIK_GUNCELLEME`. **[15] PASS — G2:**
`storage.im` pakette YOK · fs-shim etkin · `EMPP_WORK_DIR=userData/work`.

`node tools/kabul/basliksiz-kabul.js <exe> --platform windows` (gerçek pencere AÇILMADI,
Electron 27.3.11 offscreen+UIElement, ağ kapalı): **SONUÇ GEÇTİ (30 sn).** Menü ve okuyucu
ekranları sağlıklı piksel eşiklerinde (sapma 0.173-0.178, koyu 0.16-0.94, renk 28k-47k) — beyaz/
sonsuz yükleme YOK. Odak: RustDesk önce=sonra, hiç çalınmadı. Kanıt: `~/.empp-agent/kabul-kanit/
Marvel-Setup-windows-20260926-125008/` (`menu.png`, `kitap.png`, `*.dom.html`, `karar.json`).

## 7) Bulunan kusurlar

**Kod kusuru bulunmadı** — G1/G2 hem statik kapıdan hem gömülü durum dosyasından PASS. İlgisiz
iki FAIL (logo alfa, SET kanalı) düzeltme gerektirmiyor.

## 8) VM teslimi

`~/vm-kapi/MARVEL11-AKTIVASYON-TEST-Setup.exe` (430.606.331 B, md5
`f6ad87847c74717de8cb26893fadf732`) + `~/vm-kapi/MARVEL11-AKTIVASYON-TEST-OKU.md`: kurulum
adımları, **VM'de İNTERNET AÇIK olmalı** uyarısı, gerçek kod girme + kapat/aç kalıcılık testi +
B-sürümü-A-üstüne kurulum testi + geri getirilecek dosyalar (`%APPDATA%\Marvel Grade 11\work\`,
`acilis-zamanlama.log`). Gerçek aktivasyon kodu yazılmadı; Nadir kendisi girer.

## Sonuç

G1/G2 kod ve statik paket düzeyinde kanıtlandı. Kitap seçimi doğruydu; başsız testte kod
ekranının görünmemesi ağın kasıtlı kapalı olması + bu kitapta `imKeys.dll` olmayışının birlikte
sonucuydu (§3). "Kod gir → kapat/aç → korunuyor mu" ve G6 (İmpark'tan devralma) YALNIZ Nadir'in
VM'inde, internet AÇIKKEN ve gerçek kodla doğrulanabilir.

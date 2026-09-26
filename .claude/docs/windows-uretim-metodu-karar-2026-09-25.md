# Windows exe üretim metodu — karar belgesi (2026-09-25 18:08)

`[KARAR: BEKLİYOR — Nadir]` · Kod/config değişikliği YOK; yalnız ölçüm + seçenek. Üç karar birbirine
bağlı: Windows'un nasıl üretildiği, mac/android/pardus'un **KAYNAĞINI** da belirliyor (§4).

## 1. Bugün ne var / ne yok (ölçüldü)
| Konu | Durum | Kanıt |
|---|---|---|
| NSIS üretimi | VAR: ia32, oneClick, per-user, UAC yok, `Ad-sürüm-Setup.exe` | `packagingService.js:2170,2188-2205`; `windows-mimari.js:24,40-43` |
| asar | KAPALI (yalnız Windows; SET kanalı diske yazabilsin) | `windows-asarsiz.js:6-30,55-57`; `packagingService.js:2165` |
| Paket kapısı | 13 madde: 10 PASS · 0 FAIL · 2 ÖLÇÜLEMEDİ (3,5) · 1 RAPOR | `scripts/windows-paket-kapisi.js:10-13`; sözleşme `:16,42` |
| Örnek üretim | sm4 `1.13.8-Setup.exe` 1451,5 MB / 169 sn (19.09); WebP ile 1318 MB | `changelog.md:83,112` |
| Ajan yolu | KAPALI: `windows` işi yalnız `EMPP_RUNNER_WINDOWS=1` ile; ajan yetenekleri `mac,android,pardus` | `runner-helpers.js:50-51`; `~/.empp-agent/run-agent.sh:10` |
| SET güncelleme kanalı | kod var, kapı KAPALI (sözleşme ONAYLI değil); `setKimligi` claim'de daima `null` | `/api/health` `setGuncelleme:false`; book-update `build-agents.ts:395-396` |
| İmza | YOK. `signtoolOptions.publisherName:"Dijitap"` yalnız ad, sertifika yok | `packagingService.js:2177-2179` |
| Tek imza yolu (66902 yuvası) | ÖLÜ: RDS1 ajanı 19.09 kapandı; ajansız plan onay bekliyor | `exe-imzalama/SKILL.md:8`; `ajansiz-yazma-yolu.md:3` |
| Windows'ta açılma kanıtı | VM köprüsü VAR ama akışa bağlı DEĞİL (runner/sunucuda çağrı 0); VM = Win11 **ARM** | `tools/windows/OKU.md:3-6,29`; `grep vm-kapi src/agent src/server` → 0 |
| Diğer platformların kaynağı | İmpark'ın WinRAR SFX exe'si → `unrar` → `resources/app/build` → `build.zip` önbelleği | `runner.js:13-14,631,657-703,1690-1697,1763-1770` |
| Bizim NSIS kaynak olabilir mi | HAYIR (bugün): içinde `resources/app/build` bilerek YOK, `findBuildDir` düşer | `packagingService.js:2126-2157` ↔ `runner.js:678-703` |
| Set kabuğu | Tek üreticisi Üretim Masası `webz-kabuk-uret.swift`; paketleyici kabuk ÜRETMEZ | `08-set-menusu-proxy-menusu.md:24`; tek-kabuk planı Faz 1 durumu |
| Yayındaki set kabukları | hiçbiri doğru değil (Şef girdisi, 25.09 denetim); tek doğru örnek 73768 1.0.2 yerelde, yayınlanmadı | tek-kabuk planı "Durum 2026-09-24 akşam" |

Kural: **Windows imzasız dağıtılmaz** (`memory/windows-guncellik-zinciri.md:24-26`); yayın aracı da
imzasızı R2'ye koymaz (`pe_is_signed`, `exe-imzalama/SKILL.md:15`). İmpark'ın imzası ölçüldü:
DigiCert Trusted G4 · `O=İm Park Bilişim … LTD. STİ., C=TR` · bitiş **2027-07-03** (66902 yuvası, osslsigncode).

## 2. Karar 1 — platform adı ve SET kimliği
**1a. Platform adı**
- (a) Yeni `windows-set` (sözleşme önerisi). Maliyet: MySQL `platform ENUM` göçü (`004:36`; emsal `012`,`019`),
  iki zod şeması (`agent.ts:4-11`, `pipeline.ts:8`), `mapPlatform`, panel/Worker/`book_pages` bayrakları.
  Ad da yanlış: NSIS tek kitaba ve aktivasyonluya da uygulanır (sözleşme `:9`).
- (b) `windows` doğrudan bizim NSIS olur. İmza yokken Windows teslimi DURUR (bugün İmpark'ın imzalı exe'si gidiyor) → gerileme.
- (c) **`windows` satırı kalır, kökeni `build_method` taşır**: `passthrough` = İmpark exe (bugün), `build` = bizim NSIS.
  Alan zaten var (`019:10-11,36`, VARCHAR). Kitap başına geçiş yalnız imzalı + kapı 0 FAIL + VM kabul sonrası;
  İmpark exe R2'de ayrı anahtarda kanıt/geri dönüş olarak kalır. Şema değişikliği yok.
- **Önerim: (c).** (a)'nın "geri alınabilir" faydasını şema göçü olmadan verir; geri dönüş tek alan değeri.

**1b. SET kimliği**
- Değer sorunu yok: SET book-update'te kendi `bookId`'siyle kayıtlı (`agent-guncelleme-upload.ts:67-73`). Eksik olan **tür bayrağı**.
- (1) `pipeline_book_summaries.kitap_turu` = `tek|set|aktivasyonlu`; `set` iken `setKimligi = bookId`.
- (2) Bayraksız `bookId = setKimligi` → tek kitapları da SET sayar (API yorumu bunu "uydurma" diye reddediyor).
- (3) Türet: web-stream proxy listesi dolu = SET → dolaylı, aktivasyonluyu ayıramaz.
- **Önerim: (1), ayrı `set_kimligi` sütunu olmadan.** Yazan: Üretim Masası "Proxy'ye kaydet" (seti zaten o tanımlıyor,
  `08:68-79`); `aktivasyonlu`yu operatör işaretler. Aktivasyon akışı bugüne kadar ÖLÇÜLMEDİ (sözleşme `:44`).

## 3. Karar 2 — imza yolu (web araştırması 25.09; kaynaklar §6)
Değişmezler: 2023-06'dan beri OV de donanım/HSM ister; 2026-03'ten beri sertifika en çok **460 gün** (yıllık yenileme
+ yeniden doğrulama); EV 2024'ten beri SmartScreen'de ANINDA itibar VERMİYOR (Microsoft belgesi 2026-05). İtibar
sertifika + dosya özeti üstünden birikir ("haftalar, yüzlerce temiz kurulum"); yeni sertifika sıfırdan başlar.
Win11 Smart App Control imzasız HER exe'yi engeller (yalnız indirilen değil) → iç Electron exe de imzalı olmalı.

| Seçenek | Maliyet/yıl | Kurulum süresi | SmartScreen | Otomasyon (Mac'ten) | Not |
|---|---|---|---|---|---|
| A. İmpark 66902 yuvası (ajansız SMB ile canlandır) | 0 | ajansız plan onayı + ölçüm | İmpark'ın birikmiş itibarı; yayımcı "İm Park" | Zor: tetik→~5 dk pencere→9 dk/exe; 1,4 GB sığıyor mu ÖLÇÜLMEDİ; **yalnız dış dosya imzalanır, iç exe imzasız** | İmpark ekibi RDS1'i kapattı → rıza belirsiz; `exe-create` klasörü boşaltır |
| B. İmpark'tan resmi imza hizmeti (yazılı anlaşma) | pazarlık | İmpark'a bağlı | A ile aynı, daha iyi | İmpark'ın süreci belirler | Tek tedarikçiye bağımlılık |
| C. DigiCert OV + KeyLocker | ~$370-600 (1000 imza/yıl dahil) | OV doğrulama (TR şirketi için süre ÖLÇÜLMEDİ; İmpark'ın C=TR sertifikası verilebildiğini gösteriyor) | Sıfırdan birikir, yayımcı adı bizim | Kolay: jsign `DIGICERTONE` (Java 17 Mac'te var) + electron-builder 26 `signtoolOptions.sign` kancası | İmpark ile aynı kök zinciri |
| D. SSL.com OV + eSigner | $129 + $20/ay (20 imza) ya da $85/ay (100) → ~$370-1150 | OV doğrulama | C ile aynı | Kolay: jsign `ESIGNER` (TOTP) | Hacimde pahalanır |
| E. Certum Standard Cloud (SimplySign) | ~$108-116 | OV doğrulama | C ile aynı | Zor: SimplySign mobil OTP oturumu, jsign listesinde yok | En ucuz, en az otomatik |
| F. Azure Artifact Signing | $119,88 (Basic $9,99/ay) | 1-20 iş günü | C ile aynı | Kolay (jsign `TRUSTEDSIGNING`) | **UYGUN DEĞİL:** kurum ülke listesinde Türkiye YOK (AB/UK/ABD/… tüzel kişilik şart) |
| G. EV (herhangi CA) | ~$250-560 + donanım/bulut | daha uzun | OV ile AYNI (2024+) | C/D gibi | Ek fiyat SmartScreen'de karşılıksız |

Paket başına imza sayısı ÖLÇÜLMEDİ (electron-builder iç exe + kaldırıcı + kurulumu ayrı imzalar; ilk imzalı derlemede sayılır).
**Önerim: C (DigiCert OV + KeyLocker, jsign ile Mac'ten).** Tam otomatik, iç exe dahil imzalar, hacme uygun, İmpark'a bağımlı
değil. Sertifika gelene kadar Windows teslimi bugünkü gibi İmpark exe'si kalır (1a-c sayesinde gerileme yok). Kabul
edilen bedel: ilk haftalarda "tanınmayan uygulama" uyarısı (yayımcı adı görünür). Nadir'in vereceği alt karar:
sertifikadaki tüzel kişilik adı (SmartScreen'de "Yayımcı" bu; `publisherName` CN ile birebir olmalı).

## 4. Karar 3 — kaynak formatı (diğer platformlar neyi açacak)
Bugün: mac/android/pardus İmpark SFX'ini açıp `build.zip` üretiyor (`runner.js:1763-1770`); SET'te bu ağacın kökü motor
kopyası → yanlış kabuk. Doğru kabuğu yalnız Üretim Masası üretiyor ama runner yolu masadan geçmiyor (tek-kabuk planı Faz 1).
- (a) **Bizim NSIS exe kaynak olur.** Gerekenler: runner'a NSIS dalı (dış 7z + iç `app-32.7z` iki kat açma; `unrar` açamaz),
  `findBuildDir`'e kök tanıma (`index.html`+`app.config.js`). Bedel: her platform önce Windows derlemesini bekler (169 sn + 1,4 GB),
  Windows'a özgü yamalar (asarsız, güncelleyici, WebP, açılış) diğer platformlara sızar, Windows kırılınca hepsi durur.
- (b) **Kanonik "kaynak zip" — NSIS dahil 4 platform TÜKETİCİ.** Üretici tek: Üretim Masası (bookN = İmpark `exe-link`,
  kök = `webz-kabuk-uret`, motor = kanonik). Biçim zaten var: runner'ın `{bookId}/{sürüm}/build.zip` önbelleği; NSIS'in
  girdisi de "zip'e açılmış kabuk + bookN" (sözleşme `:14`). Runner'da tek değişiklik: claim `kaynakUrl` taşırsa İmpark
  SFX yerine onu indirir (pardus `hazirDevir` emsali, `runner.js:1702-1705`). Tek kitapta kaynak İmpark SFX kalabilir.
- **Önerim: (b).** Kabuk tek yerde üretilir, imza/Windows sorunu diğer platformları bloklamaz, döngüsel bağımlılık yok,
  paketleyici kabuk üretmez kuralıyla (`08:24`) uyumlu. Açık: kaynak zip'in saklandığı yer (R2 sürümlü anahtar önerilir).

## 5. Kararlar verilince sıra
| # | Adım | Kim | Kapı |
|---|---|---|---|
| 1 | Bu belgedeki 3 kararı işaretle; Şef sözleşmeye işler; `ONAYLI` yalnız Nadir | Nadir → Şef | Sözleşmede açık karar satırı 0 |
| 2 | Sertifika başvurusu (seçilen CA, tüzel kişilik belgeleri) | Nadir | Test exe'de imza + zaman damgası `osslsigncode verify` geçer |
| 3 | Kaynak zip üreticisi (masa başsız araç) + runner `kaynakUrl` önceliği; testler + mutasyon | ajan (spec Şef) | 73768 aynı zip'ten 4 platform; kök ekran Web-Z; ProBook kabul |
| 4 | `kitap_turu` göçü (eklemeli) + claim'de `setKimligi=bookId` (`set` iken) | ajan; srv21 göçü Nadir onayı | API testleri; 73768 claim'i dolu `setKimligi` taşır |
| 5 | İmza kancası (`signtoolOptions.sign` → jsign) + kapıya madde 14: dış+iç exe imzalı, zaman damgalı | ajan | Kapı 0 FAIL · 0 ÖLÇÜLEMEDİ |
| 6 | VM kabulünü akışa bağla (Windows'un K18'i: kur-aç-piksel) | ajan | VM'de 3 kitap açılır; ARM VM olduğu için 1 x86 cihazda elle teyit |
| 7 | Pilot: 1 tek + 1 set + 1 aktivasyonlu; `windows` satırı `build_method=build` | Şef hazırlar, yayın Nadir | Sahada kurulum raporu; geri dönüş = `passthrough` |
| 8 | Toplu geçiş: ajan yeteneğine `windows`, Üretim Masası kuyruğu | Şef + ajan | Her pakette kapı + VM kabul; imzasız paket R2'ye gitmez |

## 6. Kanıt / kaynaklar
Yerel: dosya:satır'lar yukarıda. İmza ölçümü: `curl …/Uploads/KitapTekExe/66902/windows.exe` (152.704 B) → `osslsigncode extract-signature`.
Web (25.09 erişildi):
- Azure ülke listesi + 1-20 iş günü: https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart
- Azure EV yok, ücretli abonelik şart: https://learn.microsoft.com/en-us/azure/artifact-signing/faq · fiyat: https://azure.microsoft.com/en-us/pricing/details/artifact-signing/
- SmartScreen (EV ayrıcalığı yok, SAC): https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation
- EV 2024 değişikliği: https://www.todesktop.com/blog/posts/windows-apps-psa-ev-certs-do-not-grant-immediate-reputation-anymore
- 460 gün (CSC-31): https://www.digicert.com/blog/understanding-the-new-code-signing-certificate-validity-change · https://www.globalsign.com/en/blog/code-signing-validity-changes
- 2023 HSM şartı: https://knowledge.digicert.com/alerts/code-signing-changes-in-2023
- SSL.com: https://www.ssl.com/guide/esigner-pricing-for-code-signing/ · https://www.ssl.com/products/software-integrity/code-signing/ov/
- DigiCert KeyLocker: https://docs.digicert.com/en/digicert-keylocker/keylocker-signatures.html · https://signmycode.com/digicert-code-signing
- Certum: https://www.sslmentor.com/certum/certumcodecloud
- jsign depo türleri: https://ebourg.github.io/jsign/ · electron-builder: https://www.electron.build/docs/features/code-signing/code-signing-win/

## 7. Güncelleme denetimi (25.09 akşam, SM2 NSIS paketi üzerinden — kod + paket içeriği, Windows'ta ÖLÇÜLMEDİ)

**Bulgu: İmpark'ın içerik güncellemesi (kanal K) bizim NSIS paketinde BOZUK, sessiz.** K kitap başına,
renderer'da çalışır: `GetKitapGuncellemeBilgi?id=<bookId>&setMi=0` → `ZKitapZipH/<id>-<Vs>.zip` →
`bookN/<kitap>/update.zip` → `window.require("adm-zip")` ile yerinde açar (chunk `a3e011c1…450.js`,
modül 6791; hata try/catch'te yutulur). İmpark SFX'i `resources/app/node_modules/adm-zip` (0.5.9)
taşır; bizim `app-32.7z` içinde `node_modules` yok, `package.json` `"dependencies":{}`. Zip iner,
açılamaz. Ayrıca `icerik-guncelleme.js:236` `windows:false`, `empp-fs-shim.js:176` Windows'ta pasif.
İmpark'a yüklenen build zip'ler ETKİLENMEZ (İmpark kendi exe'si + node_modules ile sarar).
Set build'lerinde çıkarılan `electronUpdate.js` hiçbir yerde giriş dosyası değil → etkisiz.

| # | Konu | Durum | Öneri (Şef) | Karar |
|---|---|---|---|---|
| G1 | K içerik güncellemesi Windows'ta nereye açılsın | BOZUK | [a] userData WORK (fs-shim Windows'ta açılır; mac/Pardus Faz 2 ile aynı) · [b] kurulum dizini (adm-zip pakete) | KARARLANDI 25.09 (sözleşme) |
| G2 | Tam sürüm kurulumunda veri | electron-builder `RMDir /r $INSTDIR` (`uninstaller.nsh:152-173`), `customRemoveFiles` yok → `imKeys.dll` (aktivasyon), `bookN/temp/data/storage.im`, K içeriği silinir | G1[a] ile aynı: yazmalar userData'ya; kaynak exe'den gelen `storage.im` paketten çıkar | KARARLANDI 25.09 (sözleşme) |
| G3 | Bizim motor/SET kanalı | kod var, kapı kapalı (`run-agent.sh:32`), setKimligi yok (kapı m.13) | (i) tetik: 1a-c · (ii) SET kimliği: 1b seçenek 1 · (iii) bookN okuyucu/motor kopyaları kanonik ad beyaz listesiyle kanala girsin | KARARLANDI 25.09 (sözleşme) |
| G4 | Güncelleme manifesti imzası | imzasız, yalnız sha256; http de kabul (`kitap-guncelleyici.js:137-140`) | ed25519 imza, açık anahtar pakete gömülü | KARARLANDI 25.09 (sözleşme) |
| G5 | Yayıncı kabuk zip'i (kanal Ş) | etkisiz (`main.js:171` adm-zip require patlar) ama `setAppVersion` `version.txt`'i sunucu değerine çeker (`main.js:136-138`) | `kanalSKapat` Windows'ta da (plan kararı 2) | KARARLANDI: kapalı + Üretim Masası kabul/red |
| G6 | İmpark exe'siyle yan yana | dizin/registry/userData çakışmıyor; 2 ikon | dokunma, pilotta not | KARARLANDI: İmpark kopyası kaldırılır (sınırlı) |

Kapı madde 11 metni yanlış: 350 MB indirme K'nin içerik zip'idir, `version.txt` ile ilgisi yok; Ş zip'i
1,3-1,45 MB. Düzeltme yeri `scripts/windows-paket-kapisi.js:805-857` ("Ş kapalı işareti var ya da 3 parça").
Windows'ta gözle: kapı 3/5, UAC, "Kitap Güncelleniyor %N" sonrası içerik değişiyor mu (G1 saha kanıtı),
Smart App Control. Ölçülmedi: aktivasyonlu kitap, sürüm üstüne kurulumda veri kaybı (ikinci Setup.exe gerekir).

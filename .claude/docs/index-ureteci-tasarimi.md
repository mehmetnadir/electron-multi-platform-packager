# Index Üreteci — kaynaksız setlerin build.zip'i  `[TASARIM + RUNNER BAĞLANTISI + FLASHY — 2026-10-02; faz 1-2 agent-mode'da, faz 3 dal index-flashy-20261002, merge yok]`

> Nadir 02.10: "yapmamız şart". Sözleşme: book-update `exesiz-kaynak-sozlesmesi.md` (ONAYLI) §K "set
> index'i BİZİMDİR, kitap listesi = panel Web-Z listesi", §5 yazma kapısı, §2b imKeys, §7 manuel yollar.
> Kod: `src/agent/index-ureteci.js` (üreteç), `src/agent/uretec-kaynak.js` (runner kaynak adımı: liste/kalıp/tema/erteleme),
> `kaynak-karari.js` (taban yoksa `uretec`), `runner.js` (`r2KurTabanHazirla`), `yazma-kapisi.js` (tek motorlu set kuralı).
> Testler: `index-ureteci.test.js`, `runner-uretec.test.js` (gerçek processJob, sahte sunucu).

## 0. Şef kararları (02.10, Nadir'in "proaktif karar al" kuralıyla)

| # | Karar | Kodda |
|---|---|---|
| 1 | Aktivasyonlu set → tek-motor (zorunlu); aktivasyonsuz → bookN + Web-Z menüsü | `duzen:'otomatik'` → `duzenKarari` |
| 2 | Sürüm kaydı DDL'siz: `kaynak='uretec'` + `kapi_kaniti`'ne üreteç özeti, `tur='otomatik'` | runner `tamamla` gövdesine `uretec:{…}` (sunucu zod'u bilinmeyen alanı atar → **book-update işi**: tamamla `uretec`i okuyup `kaynak`/`kapi_kaniti`'ne yazsın) |
| 3 | Yeniden üretim tetiği = mevcut §4 (Web-Z liste değişimi → kur isteği); üreteç r2-kur'un kaynak adımı | `kaynakKarari` → `taban:{tur:'uretec'}` |
| 4 | Zip'siz oyun/çalışma kâğıdı → link kartı (4fbb8c1 biçimi); rapora say | `webzAdresi` (kisaKod) → `type:'link'`; yoksa `atlanan`; `kapiListesi` |
| 5 | ~~Flashy ertelenir~~ → faz 3 (§11): Flashy (kurum 310) bookN, kalıp = YDS motoru, kök = tema kabuğu | `kabuk:{tema}` + `motorDonusumu`; yayıncı tablosu YDS + Flashy ELT |

> Merge/deploy/DB/R2 yazımı YOK — bu belge ve prototip kuru koşudur.

## 1. Kaynaklar (ölçüldü 02.10)

| Parça | Nereden | Kanıt |
|---|---|---|
| Kitap listesi + sıra + grup | panel Web-Z listesi: `pipeline_platform_summaries.proxy_asset_id` (web-stream; NULL ise KV) — `assetId \| başlık \| kapak \| contentType \| grup` | 45480: 14 kitap; 74430: 2; 45485/45487/45496: DB'de NULL (KV'den okunmalı) |
| Kitap içeriği | motorun kendi sorusu `GetKitapGuncellemeBilgi?id=<id>&setMi=0&versiyon=0` → `Data` = `ZKitapZipH/<id>-<Vs>.zip` → içerik önbelleği (`icerikZipiGetir`, merdivenle aynı) | 45480'in 14 zip'i 613 MB; Flashy 69523/69084 `flashyelt.yayincilik.net` (CF challenge zip'e uygulanmıyor: Mac'ten 206) |
| İçerik biçimi | ZKitapZipH = Web-Z `Uploads/WebDijitapDosyalar/<id>/` = arşiv `bookN/assets/<id>/` | 73454: `pages/1.png`, `thumbs/1.jpg`, `BookContent.xml` md5 üçünde AYNI (ilk 100 bayt gizleme dahil). Arşivdeki fazla 122 dosya eski sürüm artığı (merdiven silmez) |
| Motor kabuğu | aynı yayıncının **arşivli** build'indeki tek kapaklı İmpark `bookN/` motoru (`assets/ classlibraries/ temp/` hariç) + kökten `electronUpdate.js`, `old_app.config.js` | bookN motoru = tam motor: 45472 kökünde olup bookN'de olmayan yalnız bu 2 dosya |
| Kök Web-Z menüsü (bookN düzeni) | arşivli build'in kökü: Üretim Masası `WebZTemaUretici` çıktısı (sf425 + `scripts/cevrimdisi-yama.js`) | 73768 kökü; `assets2/` taşıyan eski kabuklar (45549) kalıp OLMAZ |
| Set menüsü biçimi (tek motor) | İmpark'ın kendi set exe'si (45472 Marvel 12, çözüldü): `<main type="1" ID="<set>" activation key>` → `Group` → `Tab` → `cover` | 45472 menüsü zaten `activation="true" key=""` |
| Web'deki set index'i | Flashy: bizim Worker `flashyelt.ndr.ist/go/<sc>/web-stream/` — tema `web-proxy-modern` (book-update `set-ui-templates.ts`); YDS: `sf425`. İmpark'ın `…/Cozumler/Web/<id>` sayfası CF challenge (403) | 74430 sc=`mj17c` 200 |

## 2. İki düzen

| | `tek-motor` (varsayılan) | `bookN` |
|---|---|---|
| Yerleşim | kök = motor; kök `classlibraries/ImWin32.dll` = TÜM kapaklar; `assets/<id>/` | kök = Web-Z kabuğu; `bookN/` = motor + tek kapaklı menü + `assets/<id>/` |
| Menü | Group(ID=set, label=set adı) → Tab (Web-Z grup sütunu, ilk görülme sırası) → cover (liste sırası) | `settings.books` + yama + `set-menu.json` listeden SIFIRDAN (kalıbın eski girdileri taşınmaz), `<title>` |
| Kapak görseli | `source`/`imageURL` = `assets/<id>/thumbs/1.jpg` (ZKitapZipH ayrı kapak taşımaz) | `coverUrl` = `bookN/assets/<id>/thumbs/1.jpg`; kalıbın `images/book*.png`'i alınmaz |
| Aktivasyon | set düzeyi: `main.activation="true"`, `main.key=""` → kod ilk açılışta BİR kez | YASAK (her kitap ayrı sorar; kapak düzeyi dal çevrimdışında kırık — `getImKeys` ReferenceError) |
| Kimin için | 12 aktivasyonlu Grade 11/12 seti; İmpark'ın kendi düzeni | aktivasyonsuz, web index'i aynen istenen setler (Flashy) |

Kural: aktivasyon `set` (ya da `otomatik` → herhangi bir kapak HasZKitapKey=anahtarlı) ⇒ `tek-motor` zorunlu;
`bookN` + anahtarlı kapak = RED (`aktivasyon-duzen`, içerik indirilmeden önce).

## 3. Aktivasyon kancası (karar sabitlenmedi)

| Parametre | Davranış |
|---|---|
| `aktivasyon: 'yok'` | `activation="false"` |
| `aktivasyon: 'set'` | `activation="true"`, `key=""` |
| `aktivasyon: 'otomatik'` + `anahtarliMi(id)` | runner `imkeys.hasZKitapKeyIstemcisi()` verir; ≥1 true → `set` |

`imKeys.dll` üreteçte YAZILMAZ: runner `imkeys.js` her kaynakta set-ek sonrası yazar, `main.activation`'ı zorlar
(agent-mode `5dfa2cc`) ve `imkeys-yok` kapısını uygular. imkeys kök menüyü zaten tanıyor (`MENU_DESENI`, ölçüldü:
45480 çıktısında `classlibraries/ImWin32.dll setAktivasyon=true`).

## 4. Kimlik eşlemesi — yazma kapısı

| Düzen | Kapı nasıl eşler |
|---|---|
| bookN | mevcut kural: `bookN/assets/<id>` dizin adı = İmpark kimliği (a) — üreteç dizini hep kimlikle açar |
| tek-motor | **YENİ (bu dal):** bookN yok + kök menüde ≥2 İmpark kapağı → her kapak bir kitap (n = menü sırası), içerik/kapak `assets/<kapak ID>/`; liste eşlemesi, `kitap-eksik`, `liste-disi-kitap`, `liste-yok` aynen. Tek kapaklı kök (bugünkü tek kitap) davranışı DEĞİŞMEDİ |

İmpark kimliği olmayan liste satırı (59480 `3100010 Games`, contentType games) build'e girmez → rapor `disarida`;
GetKitapGuncellemeBilgi boş dönerse ya hep ya hiç: build yazılmaz (`kitap-eksik`).

## 5. Motor kalıbı ve sürüm seçimi

| Konu | Karar |
|---|---|
| Kalıp | aynı **kurumun** (kurum.txt) arşivdeki en yeni R2 sürümlü build'i (`kaynak-arsivi/<set>/kaynak.json` `r2Surum`); prototip: 45480 ← 45549, 74430 ← 73768 |
| Motor sürümü | kalıbın bookN motoru olduğu gibi; okuyucu güncellemesi (`publisher-update.js`, kurum `Update/<sürüm>.zip`) bugünkü gibi paketleme anında |
| Kurum | `kurum` parametresi kök `kurum.txt` + kapak `corpID`'ye yazılır; verilmezse kalıbınki |
| Exe | kullanılmaz (sözleşme "hiçbir koşulda"); `~/.empp-agent/cache` exe türevleri kalıp OLAMAZ |

## 6. Sürümleme

| Alan | Değer |
|---|---|
| Sürüm adı | §5 aynen `2.<panel kodu>.<sayaç>` (sayaç set başına tek) |
| `kaynak_build_surumleri.tur` | `otomatik` (DDL yok) — öneri: enum'a `uretec` eklemek (açık soru) |
| `kaynak_build_surumleri.kaynak` (varchar 32) | bugün geri dönüş notu; üretilen build için `kapi_kaniti.uretec = {kalip, motor, duzen, aktivasyon}` önerilir, `kaynak` alanı geri dönüşe kalsın |

## 7. r2-kur akışına bağlanma (UYGULANDI, dalda)

| Adım | Davranış |
|---|---|
| Karar | `r2-kur` + `tabanUrl` yok + arşiv yok + `EMPP_INDEX_URETECI≠0` (varsayılan açık) → `taban:{tur:'uretec'}`; `=0` → eski §6a BEKLER |
| Liste | claim `setListesi` > `EMPP_SET_LISTESI_DIZINI` > Worker `…/go/<kisaKod>/web-stream/config/settings.json` (KV'den kurulur; claim `kisaKod` alanı gerekir → **book-update işi**: claim'e `kisaKod` ekle ya da `set-listesi-claim.ts` KV yedeği) |
| Kalıp | yayıncı tablosu (YDS → kurum 60, tema 'kalip') → arşivde aynı kurumun en yeni motor taşıyan build'i |
| Erteleme (`failed` yok, kilit + kira bırakılır) | `uretec-liste-yok`, `uretec-kalip-yok`, `uretec-tema-yok`, `uretec-kitap-eksik`, `uretec-ag` (HasZKitapKey/İmpark ağı) |
| Sonra | `job.setListesi = kapiListesi` (set eki + kapı aynı listeyi görür) → merdiven → set eki → imKeys → yazma kapısı → R2 → tamamla(+`uretec`) |

Eski plan (kayıt için):

1. `kaynak-karari.r2Karari`: `r2-kur` + `tabanUrl` yok + arşiv yok → bugün `yok` (§6a BEKLER). Yeni: claim
   `kaynakUretec=true` (sunucu `kaynak_modu='uretec'` setlerde) → `taban: {tur:'uretec'}`.
2. `runner.r2KurTabanHazirla`: `uretec` → `indexUreteci.uret({setId, setAdi, listeHam: setListesiCoz(job).ham,
   kalipZip, duzen, aktivasyon:'otomatik', anahtarliMi: imkeys.hasZKitapKeyIstemcisi()})` → `zipPath`; `oncekiBoyut` null.
3. Sonra zincir AYNEN: içerik kapısı → merdiven (ölçüldü: 14/14 ve 2/2 GÜNCEL, no-op) → set eki (tek-motor:
   "set değil" atlar; bookN: eşleşir, değişiklik yok) → imKeys → yazma kapısı → R2 `kaynak/<set>/<sürüm>/` → tamamla.
4. Sonraki kurulumlar `tabanUrl` (önceki R2 build) ile gelir — üreteç yalnız İLK build'i kurar; liste değişince
   (sete kitap eklendi/çıkarıldı) set eki/merdiven yürür; çıkarılan kitap için yeniden üretim (açık soru).

## 8. Prototip sonucu (kuru, `scratchpad/index-ureteci/cikti/`)

| Set | Düzen | Liste | Menü kapak | build.zip | Kapı | S0 | Süre |
|---|---|---|---|---|---|---|---|
| 45480 Marvel 11 | tek-motor, aktivasyon otomatik→**set** (HasZKitapKey) | 14 | 14 (`activation=true key="" ID=45480`) | 701 MB, 9937 girdi | GEÇTİ 14/14 | 14 GÜNCEL | 45 sn (içerik önbellekte) |
| 74430 Flashy Grade 4 | bookN, aktivasyon yok | 2 | 2 (book1/book2) | 157 MB, 2272 girdi | GEÇTİ 2/2 | 2 GÜNCEL | 10 sn |

Her kitapta `BookContent.xml` + `thumbs/1.jpg` + ilk sayfa var; bookN'de `settings.books` = liste (2), başlık set adı.

## 9. Riskler

| Risk | Etki | Önlem |
|---|---|---|
| Tek motor kapak rafı `thumbs/1.jpg` ile çizilmedi/denenmedi | rafta kapak boş görünebilir | başsız kabul (`tools/kabul`) tek-motor build'le koşulmalı |
| Flashy kökü YDS sf425 kabuğu (logo/marka YDS) | 74430 çıktısı marka olarak YAYINLANAMAZ | Flashy `web-proxy-modern` temasını çevrimdışı kabuğa taşımak (§10) |
| Kalıp motoru ≠ kitabın yayıncısının motoru (Flashy: kurum 60) | yanlış kurum logosu/uç | kurum parametresi + Flashy kalıbı |
| Liste DB'de NULL (45485/45487/45496) | üretilemez | KV okuması (`GET /jobs/:id/platforms` `proxySource:'kv'`) |
| ZKitapZipH silinmiş/boş kitap | ya hep ya hiç → set hiç üretilmez | görünür hata + bildirim (§6a ile aynı) |
| Ev hattı: 45480 = 613 MB indirme | yavaşlık | içerik önbelleği paylaşılır (merdiven/set-ek aynı anahtar) |

## 10. Açık sorular

**Nadir'e:**
1. Flashy: kök menü "web'dekiyle aynı" = bizim Worker'ın `web-proxy-modern` teması mı (önerilen), yoksa İmpark'ın
   `Cozumler/Web/<id>` sayfası mı? Tema çevrimdışına taşınacaksa Üretim Masası `WebZTemaUretici` gibi bir yama gerekir.
2. Flashy'nin kurum numarası (kurum.txt) ve okuyucu kalıbı: arşivde Flashy build'i yok; YDS motoru + kurum değişimi kabul mü?
3. Aktivasyonsuz setlerde de varsayılan `tek-motor` mı olsun (İmpark düzeni, tek akış), yoksa web görünümü için `bookN` mi?

**Teknik:**
4. `kaynak_build_surumleri.tur` enum'una `uretec` eklensin mi, yoksa `kapi_kaniti.uretec` yeterli mi?
5. Sete kitap ÇIKARILINCA r2-kur tabanı eski kitabı taşır (set eki silmez) → üreteçle yeniden kurma tetiği.
6. 59480/60114 `games`/`worksheets` Web-Z varlıkları (ZKitapZipH yok) çevrimdışına nasıl girer?

## 11. Faz 3 — Flashy (UYGULANDI, dal `index-flashy-20261002`)

Şef kararları 02.10: Flashy setleri (kurum 310) bookN; kalıp = herhangi bir YDS (60) arşiv build'i, ama
kalıbın KÖKÜ açılmaz — kök = `webz-tema-kabuk.kabukUret` (bkz. `flashy-tema-offline.md`). `uretec-kalip-yok`
artık yalnız arşivde hiç YDS motoru yoksa.

| Karar | Kodda | Kanıt (74430 kuru koşu, 02.10) |
|---|---|---|
| Kök menü = tema kabuğu; kalıpta `scripts/language-set.js` aranmaz; kök ÇALIŞMA dosyaları korunur (aşağı) | `kabukGecerliMi({tema})`, `uret` tema dalı (`kabukAc` yok) | zip'te `language-set.js` yok, `empp-webz-tema` imzası var |
| İki `kurum.txt` → 310 | `motorDonusumu.kurum` (motor kalıbına bir kez; kök `kurum` ondan) | kök + book1 + book2 = 310 |
| `bookN/core/kurumlogo.png` → Flashy logosu | tema `images/logo.png` (327×327) = paketleyici kaydı "Flashy ELT" (sha AYNI); **motorun gizlemesiyle** (ilk 100 bayt 256-b) yazılır | çözülmüş sha = Flashy logo sha |
| `app.config.js` `baseEndpointUrl` | `ucSec`: aday flashyelt GetKitapGuncellemeBilgi + HasZKitapKey JSON → aday, değilse yedek YDS; yoksa anahtar eklenir | aday HasZKitapKey **CF 403** → `akillitahta.ydspublishing.com` |
| Kapak = panel coverUrl | liste 3. alanı (data URI / http indirilir; olmazsa `thumbs/1.jpg` yedeği, sayılır) | 2/2 panel kapağı (webp) |
| Altbilgi "Web Sürümü" kalkar | `TEMALAR['web-proxy-modern'].metin` (desen yoksa üretim durur) | "Akıllı Tahta" kaldı |

**Kök: çalışma dosyası ↔ index (saha 02.10, 74430 pardus kabul RED — kök hiç açılmadığı için `electron.js`
yoktu, paketleyici yedek main.js şablonuna düştü; Lingoland 72378/72379 geçiyordu).** Ölçüm 45540 kökü ↔
74430 üretimi: `index-ureteci.js` `KOK_INDEX`.

| Sınıf | Dosyalar | Kanıt |
|---|---|---|
| INDEX (kalıptan alınmaz; tema üretir) | `index.html`, `set-menu.json`, `config/`, `scripts/`, `styles/`, `images/`, `languages/`, `i18n/`, `features/`, `assets2/`; `kurum.txt` yeniden yazılır | sf425 `index.html` → logo/scripts(7)/styles(3); `language-loader.js` → languages/; `language-set.css` → images/bg.jpg; i18n/features/assets2 Üretim Masası kabuk artığı (hiçbir kök dosya başvurmuyor; assets2 = YDS buton görselleri) |
| ÇALIŞMA (aynen korunur) | `electron.js` (giriş), `electronUpdate.js`, `old_app.config.js`, `set_app.config`, `version.txt`, `core/`, hash'li motor paketleri, `43e23fce…js`, `main.html`, `Main.xml`, `SET_BOOK.txt`, `Default.aspx`, `favicon.ico`, `icons.js`/`images.js`/`tour.js` | `electron.js` → `index.html` + `favicon.ico`; icons/images.js → `core/`; arşivdeki 17 YDS build'inin hepsinde kök giriş = `electron.js` |

Kökte `main.js` yoksa `electron.js` kopyalanır (paketleyicinin kuralıyla aynı); giriş yoksa üretim RED
(`kalip`). Kök dönüşüm: `core/kurumlogo.png` → gizli Flashy logosu, `set_app.config` + `old_app.config.js`
`baseEndpointUrl` → seçilen uç; doğrulamada kök noktalar da okunur. 74430 kuru koşu: kök 540 girdi,
`node --check main.js` geçti; paketin KENDİ `main.js`'i Electron 27'de görünmez koşturuldu (BrowserWindow
show:false+offscreen sarmalı, main.js değişmeden): 1 pencere, `index.html` yüklendi, 2/2 kart, altbilgi
"Akıllı Tahta", odak korundu, kalan Electron süreci 0.

**Logo neden gizli yazılır (bundle ölçümü, 45540 `main.js`):** motor açılışta `core/kurumlogo.png` yoksa ya da
ilk 10 baytında "PNG" varsa `GetKurumLogo?id=<bookN/kurum.txt>` ile İmpark logosunu indirip gizleyerek YAZAR.
İmpark'ın 310 logosu (`flashyelt.yayincilik.net/Uploads/Logo/flashyelt.png`, 218×216, 733 B) beyaz-saydam —
düz yazsaydık ilk çevrimiçi açılışta ona dönerdi.

**Uç neden yedekte (ölçüm 02.10, UA'lı curl):** flashyelt.yayincilik.net `GetKitapGuncellemeBilgi` 200 JSON,
`HasZKitapKey`/`IsZKitapKurumAktif` 403 Cloudflare "Just a moment" (UA'lı/UA'sız/Electron UA). YDS alanı
üçüne de 200 JSON. Paketleyicinin `yayinci-domain-yamasi` sorucoz.tv'yi `baseEndpointUrl` host'una çevirdiği
için uç YDS kalır; Flashy WAF'ı düzelince `ucSec` her üretimde ölçtüğü için kendiliğinden adaya geçer.

**Başsız kabul (74430, `tools/kabul/basliksiz-kabul.js --platform zip`, Electron 27.3.11 offscreen, ağ kapalı):**
kapı tema kartlarını tanımıyordu (kart 0/2 → RED). `kosum/dom-yoklama.js` artık `.flashy-card[data-id=bookN]`
kartını sayar, `kosum/main.js` tıklama ünite penceresi açarsa ilk `.unit-item`'a gerçek fare tıklaması yapar.
Sonuç GEÇTİ: menü 2/2 kart, panel kapakları; book1 → `defaultPageNo=3` ("Theme 1"), okuyucu sol üstte Flashy
logosu. Bilinen gürültü: motorun `core/kurumLogo.png` (büyük L) isteği ERR_FILE_NOT_FOUND — kalıpta da var,
paketleyici `harf-kapisi` çözer.

## 12. Önceki build taban OLMAZ (03.10, dal `uretec-taban-20261003`)

**Saha (ProBook, 74430/59480):** yeni kur isteğine rağmen r2-kur "taban: önceki geçerli R2 build" yolundan
gitti, üreteç hiç koşmadı; yeni build eskisiyle sha256 birebir (kökte Electron girişi yok → paketleyici yedek
`main.js` şablonuna düştü, okuyucu yüklenmedi). Claim taban build'in kaynağını taşımaz → karar zip'ten.

- `uret` kökte `empp-uretec.json` işareti yazar (zaman damgasız; KOK_INDEX sınıfında).
- `uretec-kaynak.tabanUretecMi(zip)`: işaret var YA DA Electron girişi yok (main.js / electron.js /
  package.json main → var olan dosya; tek sarmalayıcı klasör tolere) → ATLA. Okunamayan zip atlamaz.
- `r2KurTabanHazirla`: üreteç açıkken R2 tabanı (indirme + sha sonrası) ve arşiv tabanı bu kontrolden
  geçer; ATLA ise üreteç yolu (log "R2/arşiv tabanı ATLANDI (<sebep>)"). `kalipSec` üreteç build'ini kalıp
  seçmez (üreteç-üstüne-üreteç zinciri yok).
- Yazma kapısı: build kökünde giriş yoksa RED `giris-yok` (üreteç kapalı olsa bile R2'ye yazılmaz).
- Öneri (sunucu): claim'e taban build'in `kaynak`'ını eklemek indirmeyi de gereksizleştirir.

## 13. Üye kitap YEDEK İÇERİK (04.10, dal `uye-icerik-yedek-20261004`)

**Nadir 04.10:** "zip'i her zaman biz kendimiz oluşturuyoruz, paket zip'i sorma" — eksik İmpark zip'i karar
sorusu değil, bizim kurduğumuz girdi; setten kitap düşürmek çözüm değil. Takılan setler: 45479 (14835 zip 404),
11845 (11822 Data = `60-25685.zip`), 60114 (60068 Data boş).

**Kaynak envanteri (ölçüm 04.10):**

| Kitap | İmpark Data | SMB `WebDijitapDosyalar/<id>` | Web-Z | Diğer |
|---|---|---|---|---|
| 14835 | `ZKitapZipH/14835-1.zip` 404 (SMB'de de yok) | yalnız BOŞ `pages/` (27.08) | 404 | `ZKitapOnIzle/14835` 73 PNG önizleme (kitap DEĞİL); arşivde/önbellekte yok; 45479 v51 eski set build'inde de yok |
| 11822 | `60-25685.zip` = 73452 SHALL WE 6 içeriği (kitapId 06003144) — YANLIŞ KİTAP, H yolunda 404 | TAM (176 sayfa, htmletk u1-u10, audio, video; kitapId 0602126) | 200 (oradan) | `ZKitapZip/11822-7..9/` açılmış dizinler |
| 60068 | Data boş, Vs 0 | yok (Flashy vhost'ta hiçbir Uploads alt dizininde yok) | 404 | İmpark SQL: ZKitapId/SayfaSayisi NULL (boş kayıt); 60114 eski paketinde de yok |

`WebDijitapDosyalar/<id>/` eksi `pages2X/` = `ZKitapZipH/<id>-<Vs>.zip` BİREBİR (33574: 2023 dosya, ad kümesi + md5).
HTTP'de dizin listesi yok (403); htmletk iç dosyaları BookContent'ten çıkarılamaz → HTTP taraması YAPILMAZ (eksik etkinlik).

**Akış (`icerikleriTopla`):** İmpark teklifi → Data → içerik önbelleği (eskisi gibi). İmpark CEVAP VERDİ ama zip
kullanılamıyorsa (`ImparkZipYok`: Data boş / başka kitabın zip'i / biçim dışı / indirme ya da düzen hatası) ve satır
KİTAP türündeyse `yedekKaynaklar` sırayla:

| Sıra | Kaynak (`icerik-yedek.js`) | Sürüm | Nerede çalışır |
|---|---|---|---|
| 1 | `webz-smb`: SMB `<uploads>/WebDijitapDosyalar/<id>/` → kendi zip'imiz (pages2X hariç); SMB = df kaynağı `//` | İmpark'ın bildirdiği Vs | İmpark VPN + disk bağlı makine (Mac) |
| 2 | `onbellek`: `<icerik-onbellek>/<id>/<id>-<n>.zip` en büyük n | n | her ajan |
| 3 | `arsiv`: `kaynak-arsivi/*/build.zip` içinde `(bookN/)assets/<id>/` + o menüdeki kapak (kapaksız kopya alınmaz) | o kapak | her ajan |

İmpark'a ULAŞILAMADI (ağ, HTTP≠200, JSON değil, Success≠true) → yedek DENENMEZ (geçici, eskisi gibi ertelenir).

**Kapılar (yedek kendini onaylamaz, üreteç sınar):** (1) kaynak kimliği (dizin/anahtar) = kitap; (2) sürüm tam sayı ≥ 0;
(3) `icerikDenetle`; (4) BookContent `kitapId` = İmpark referansı (`kimlikReferansiKur`: SMB'deki, yoksa origin
HTTP'deki `WebDijitapDosyalar/<id>/data/BookContent.xml` kitapId'si = S_TestKitaplar.ZKitapId). Referans ölçülemezse
1-3 yeter, rapora `kimlik:'kaynak'`. Geçemeyen aday RED, sıradaki denenir.

**Ya hep ya hiç:** hiçbir kaynakta yoksa `kitap-eksik` (erteleme); sebep:
`hiçbir kaynakta yok — İmpark: <neden>; denenenler: webz-smb: … | onbellek: … | arsiv: …`.
Rapor: `kitaplar[].kaynak`, `yedek[]`; `uretecOzeti.yedek` (`<id>:<kaynak>`).

**Kuru koşu (04.10, Mac, 1 kitaplık tek-motor set, scratch):** 11822 → `webz-smb`: 782 MB zip, 2050 dosya, kitapId 0602126 = referans, menü sürümü 9 (İmpark Vs), yazma kapısı GEÇTİ; SMB üstünden 1542 sn (VPN ~0,5 MB/s). 14835 ve 60068 →
ERTELE, sebepte üç kaynak da sayıldı. ProBook'ta SMB yok → 11822 de ertelenir ("SMB bağlı değil"); 11845'in
r2-kur'u İmpark VPN'li Mac'te koşarsa kurulur.

**Açık (şefe):** 14835 ve 60068'in İmpark'ta içeriği HİÇ yok (60068 boş kayıt; 14835 yalnız önizleme PNG'leri) —
kendi kaynağımızda da yok. Önizlemeden sayfa-yalnız kitap sentezi teknik olarak mümkün (sayfalar H zip'te ilk 100
bayt 256-b gizli, `hashed="true"`) ama 25850 kardeş kitabı 81 sayfalık PDF'ten 11 sayfa + test olarak yayınlanmış →
önizleme ≠ yayınlanan kitap; uygulanmadı.

---
Son Güncelleme: 2026-10-04 — üye kitap yedek içerik (§13); önceki: taban kuralı (§12), faz 3 Flashy (§11).

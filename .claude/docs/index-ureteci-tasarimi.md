# Index Üreteci — kaynaksız setlerin build.zip'i  `[TASARIM + RUNNER BAĞLANTISI — 2026-10-02, dal index-ureteci-20261002, merge yok]`

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
| 5 | Flashy teması ayrı ajanda; YDS kabuğuyla YAYINLANMAZ → `uretec-tema-yok` ile ertele | `kabuk` kancası ('kalip' / {zip} / {dizin}); yayıncı tablosu yalnız YDS |

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

---
Son Güncelleme: 2026-10-02 — ilk sürüm (prototip `index-ureteci-20261002`).

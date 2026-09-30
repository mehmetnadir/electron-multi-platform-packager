# Kitap Kaynağı Sözleşmesi — build klasörü nereden, nasıl kurulur  `[SÖZLEŞME: TASLAK]`

> Taslak: 2026-09-26 (oturum 006cff11). Onay Nadir'in. Ölçüm dayanağı:
> `arastirma/mobil-zip-kaynak-olcumu-2026-09-26.md` (§7 ZKitapZipH varyantları, §9 sürüm katmanları).
> Bu sözleşme dört platform paketinin (Windows exe, macOS dmg, Android apk, Pardus impark) ve Web-Z v2'nin
> ORTAK girdisini tanımlar; platform sözleşmeleri kaynağı buradan alır, kendileri tanımlamaz.

## Amaç
Bir set ya da kitap id'sinden, İmpark exe'sini indirmeden, **build klasörünü** (kabuk + setteki kitapların
içeriği + set menüsü) ölçülebilir ve tekrar üretilebilir biçimde kurmak; build zip'i R2 kaynak arşivine koymak.
İmpark exe'si yalnız fallback'tir. Aktivasyonlu kitaplar dahil her kitap aynı yoldan kurulur.

## Tanımlar
| Ad | Anlamı |
|---|---|
| build klasörü | kabuk + `bookN/` kitap içerikleri + set menüsü + `empp-set.json` (kimlik, tür, sürümler, kaynak izi) |
| build zip | build klasörünün zip'i; R2 kaynak arşivinde son 2 sürümü tutulur |
| kabuk | `src/packaging/set-kabuk.js` beyaz listesi (sürüm 2): kök dosyalar + `assets2 core i18n config features images languages scripts styles` + `classlibraries/ImWin32.dll` |
| düz zip | `Uploads/ZKitapZipH/<id>-<v>.zip`: kitabın güncel, katmanları birleştirilmiş paketi; sayfalar mod1 şifreli |
| delta klasörü | `Uploads/ZKitapZip/<id>-<v>/`: yalnız o sürümde değişen dosyalar, şifresiz PNG (SMB Storage) |

## Kaynak merdiveni (kitap başına; üst basamak yetiyorsa alta inilmez)
| Basamak | Ne | Nereden | Ne zaman |
|---|---|---|---|
| S0 sürüm | `TestlerMobil/GetKitapGuncellemeBilgi?id=<id>&setMi=0` → sürüm + zip adresi | İmpark HTTPS, ~150 bayt | her üretimde ve her bekçi turunda |
| S1 güncel içerik | düz zip, olduğu gibi (mod1 sayfalar şifreli kalır, okuyucu çözer) | HTTPS + `x-impark-key`, ölçülen ~15 MB/s | daima |
| S2 tamamlama | alt ağacı taşıyan en son delta klasörü (sayfa alınırsa mod1 uygulanır) | SMB Storage (İmpark VPN) | S1'de bir alt ağaç önceki arşiv sürümüne göre azaldıysa |
| S3 fallback | İmpark'ın imzalı exe'si → `unrar x` | TekExeIndir / R2 `softwares/<id>/` | S1+S2 başarısızsa ya da kabuk şablonu yoksa |
| (kaynak değil) | `m-<id>-<v>.zip`, `__<id>-<v>.zip` | — | yalnız tanı: düz zip'te olmayan dosya taşıyorsa rapora yazılır, otomatik alınmaz |

Neden m- değil: içerik modeli kitaba göre değişir. Bazı kitaplarda sayfaları atar, bazılarında düşük
çözünürlüklü `pages2X` koyar (58237: 1922×2390 → 1281×1593). Canlı istemci akışı da m- adresini hiç döndürmez.

## Kabuk
1. Kabuk, yayınevi/okuyucu şablonu başına BİR kez imzalı İmpark exe'sinden `set-kabuk.js` listesiyle çıkarılır.
   Önbellek anahtarı şablonun md5 manifestidir. Listede olmayan bir dal çıkarsa üretim durur.
2. Kök `index.html` md5'i o okuyucu şablonunun kanon listesinde olmalı. Şablon başına ayrı değer var:
   SET kabuğu (SM2 tipi) `9f8032915a19f3285dd2e3051ae5acc4`; tek motorlu set (45480 Marvel 11) kaynakta
   `c53f0c84d487a3b1782be53b238af2df`. Yeni okuyucu sürümü Üretim Masası'nda kabul edilince listeye girer
   (Windows sözleşmesi G5). Paketleyicinin enjekte ettiği index md5'i ayrı tutulur, kanonla karıştırılmaz.
3. `imKeys.dll` pakete konmaz; uygulama çalışınca İmpark'tan iner. `ImWin32.dll` ve aktivasyon kanalı dosyaları
   kabukta KALIR.
4. `_` önekli kök dizinler ve `bookN/temp/data/storage.im` build klasörüne girmez.

## Set bileşimi, kimlik, tür
1. Setteki kitaplar ve menü sırası panelin paket kaydından gelir (`displayOrder`). Klasör numarası kimlik DEĞİLDİR.
2. Kimlik = kitabın assetId'si + `thumbs/1.jpg` md5'inin panelin `WebDijitapDosyalar/<assetId>/thumbs/1.jpg` ile
   eşleşmesi. Eşleşmeyen kitap menüye girmez, rapora yazılır.
3. Tür deterministik: kitap sayısı > 1 → `set`, değilse `tek`. `aktivasyonlu` işareti aktivasyon panelinin
   kaydından gelir: srv21 `keypanel.db`, `setler.panel_paket_id` ya da `kitaplar.kod_ister=1`. Keypanel'de
   kaydı olmayan kitapta imzalı exe'de imKeys kanal izi varsa da işaret konur.
   26.09 ölçümü: İmpark SQL'de aktivasyon kolonu YOK. Keypanel'de 11 aktivasyonlu set var
   (YDT Privilege/Impact/Influence/Marvel/Power 11-12, YKS-DİL Dergisi).

## Bütünlük kapısı (build zip arşive girmeden)
1. Her kitabın S0 sürümü = kurulan içeriğin sürümü; `empp-set.json`'a basamak iziyle yazılır (`S1`, `S1+S2:v7`, `S3`).
2. Alt ağaç sayıları (`pages thumbs htmletk audio video data`) bir önceki arşiv sürümünden AZ olamaz.
   Azsa S2 denenir. S2 de tamamlayamazsa üretim DURUR ve bildirim gider (58237: v14 htmletk 529 + audio 25'i düşürdü).
3. Sayfa sayısı = thumbs sayısı = `show.xml` sayfa sayısı.
4. Kabuk manifesti şablonla birebir aynı olmalı.
5. Başsız kabul (`tools/kabul`) build klasöründe menüyü ve ilk kitabı açar. RED ise zip arşive girmez.

## Çıktı ve arşiv
- Build zip R2'ye `kaynak/<set_id>/<setSürüm>.zip` + `surumler.json` olarak yazılır. Yol book-update sözleşmesindeki
  "Kaynak arşivi" ile aynıdır. Son 2 sürüm tutulur. Daha eskisi `kaynak/_eski/`'ye taşınır, 60 gün sonra düşer.
- Dört platform paketi ve Web-Z v2 AYNI build zip'ten üretilir. Platform farkı yalnız paketleyicide yaşar.
- Kitap sürümü değişmediyse (S0 aynı) build zip yeniden üretilmez.

## Aktivasyonlu kitaplar
- Aynı merdivenle kurulur. Fark yalnız tür işaretidir ve aktivasyon kanal dosyalarının korunmasıdır.
- Çevrimdışı paketlerde `imKeys.dll` / İmpark DB anahtar kanalı olduğu gibi kalır.
- Web-Z v2'de anahtar keypanel API'sinden aracı uçla alınır (book-update sözleşmesi Web-Z v2 satırı).
- Kodlar, `imKeys.dll` ve lisans dosyaları build zip'e ve R2'ye girmez.

## Fallback (S3)
- Exe'den kurulan build klasörü `kaynak: exe-fallback` diye işaretlenir. Masada sarı rozetle görünür.
  Bir sonraki bekçi turunda S1 ile yeniden denenir.
- İmpark exe'si yayın yedeği olarak R2'de durmaya devam eder (Windows sözleşmesi "Teslim ve yedek").

## Ölçülmüş sınırlar
- ZKitapZipH yalnız güncel sürümü tutar. Sürüm geçmişi yalnız ZKitapZip'te yaşar.
- Kitap zip'i 90–400 MB. Kesintili kitapta S1+S2 ≈ 205–307 MB. Tüm katmanları indirmek ~14× pahalıdır, yapılmaz.
- SMB'de derin `find` sayımı tutarsız çıktı (523/339/112). Sayım `ls`/`du` ile çapraz doğrulanır.
- S2 İmpark VPN ister. VPN yoksa S2 basamağı atlanmaz: üretim "VPN bekliyor" durumunda kalır.

## Yapılmayacaklar
İmpark paneline, SQL'e ya da SMB'ye yazmak · m- zip'in sayfalarını kullanmak · `imKeys.dll`/kod gömmek ·
kimliği klasör numarasından çıkarmak · tüm sürümleri indirip birleştirmek · bütünlük kapısını geçmemiş
build zip'i arşive koymak.

## Açık kararlar (Nadir — tek tek sorulur)
1. **İçerik düşüşü** (yeni sürüm bir alt ağacı düşürmüşse, 58237 tipi): öneri "eski katmanı koru + bildir".
   Alternatif: "İmpark'ı izle, düşür".
2. **`flexibleItems.json`**: düz zip'te ve delta klasörlerinde yok; panel exe üretirken oluşturuyor.
   Öneri: kabukla birlikte exe'den alınır, üretim anında panel verisinden yeniden kurulabilir mi ölçülür.
3. **Set sürümü**: öneri panelin set paket sürüm kodu. Kitap sürümleri `empp-set.json`'da liste olarak tutulur.
4. **Uygulama yeri**: öneri Üretim Masası tetikler, packager'daki `kaynak` modülü kurar. Aynı kod srv21
   işçisinde de koşar.

## Uygulama durumu (26.09)
Merdiven (S0-S3) kodu YOK. İlk yazılan: **runner yerel arşivi** (fd3a5ba, Nadir 26.09 "yeni arayüzle üret, tüm YDS
kuyruğa"). `~/.empp-agent/kaynak-arsivi/<id>/kaynak.json` (`dosya`, `md5`, `boyut`, `etiket`) + `build.zip` varsa
kuyruk İmpark exe'sini indirmez, yayıncı güncellemesi uygulamaz, şerit hazır paketini devralmaz. Kayıt bozuksa iş
düşer (eski kaynağa sessiz iniş yok). Dolu: 25.09 Üretim Masası zip'leri, 13 set (md5 doğrulandı). R2 `kaynak/`
yansısı ve Windows işçisinin (srv21) aynı arşivi okuması açık. İlk kabul: 58336 (kesintisiz) + 58237 (kesintili) +
bir aktivasyonlu set (45480).

**Merdiven S0+S1 (26.09):** `src/agent/icerik-merdiven.js`, `EMPP_ARSIV_MERDIVEN=1` (varsayılan KAPALI) — arşiv ve exe yolunda iş kopyasına: menü sürümü İmpark'a sorulur, geride olan ZKitapZipH (önbellek `<ID>-<Vs>`) thumbs kimliğiyle doğrulanıp `bookN/assets/<ID>`'ye yazılır, kök dokunulmaz, ölçülemezse iş düşer; S2/S3 yok.

**Bayat arşiv (exe ADI) kapısı — KALDIRILDI (Nadir 27.09, ad kırılgan; güncellik içerik sürümünden).** 26.09'da
`kaynak.json` `impark_kaynagi` (arşivin kapsadığı köprü exe adı, ör. `ShallWe8-v47.exe`) işin exe adıyla
(`srcVersionTuret(job.downloadUrl)`) kıyaslanıyor, farkta iş `kaynak arşivi BAYAT … build zip yeniden üretilmeli` diye
düşüyordu. Nadir 27.09: "v47 → v51 gibi isim güncellemesi metodu çok kırılgan (insanlar unutabiliyor), kullanmak
istemiyorum." Ölçüm: ad İmpark `S_TestKitaplar.Adi` alanından gelir ("ShallWe8-v51", elle yazılır), aktivasyon/lisans
değişikliğinde içerik değişmeden de artar; 45482 android bu kapıda düştü, oysa merdiven aynı işte alt kitapları
ZipVersiyon'a göre zaten güncelliyordu. Şimdi: `impark_kaynagi` kayıtta yalnız BİLGİ — ad farklıysa iş başına tek log
satırı (`İmpark exe adı değişti (bilgi) — güncellik içerik merdiveninden ölçülür`), iş sürer; alan yok/bozuk da karar
değil. Arşiv özetine (ProBook şeridi) girmez. Zip/boyut/md5 denetimleri aynen. Güncellik YALNIZ içerik sürümüyle
ölçülür: kaynakta alt kitap başına ZipVersiyon (+ZKitapFileSize), üretimde merdiven S0/S1, yüklemeden önce kabul
E7/K4/SET_TUM. Merdiven kapalıyken (`EMPP_ARSIV_MERDIVEN≠1`) de ad kıyası yok: ad içeriği ölçmez; geride içerik
kabul K4/SET_TUM ya da Pardus K18'de (GÜNCEL-DEĞİL rc 3 → yükleme yok) yakalanır. Nöbetçi test:
`src/agent/kaynak-arsivi.test.js` "AD SÜRÜMÜ KARAR DEĞİL" (depoda test dışı kodda ad sürümü güncellik kararına girmez).

**İmpark-dışı yayınevi savunma kapısı (araştırma notu 28.09, Silinecekler'de):** iş nesnesinde
`job.publisherName`/`job.publisherId` taşınır (`runner-helpers.js parseNextJob`); `imparkKaynakliMi(job,
job.downloadUrl)` Cambridge gibi İmpark-dışı yayınevleri için İmpark kaynağından indirmeyi (ve
publisher-update uygulanmasını) reddeder. **NOT — doğrulandı: yalnız `cambridge-kapi-runner` dalında,
agent-mode'un atası DEĞİL (agent-mode'a merge edilmemiş).**

**S1 kimlik kontrolüne görsel benzerlik + yer tutucu toleransı (araştırma notu 28.09, Silinecekler'de):**
S1'in İmpark/kaynak kimlik doğrulaması md5 tam eşleşmesine ek olarak `sharp` ile 32×40 gri-seviye piksel
farkı (`GORSEL_BENZERLIK_ESIGI=12.0` — JPEG yeniden sıkıştırma farkı ölçülen ~1.04, farklı kitap farkı
~46.01) ve beyaz/boş yer tutucu tespiti (`YER_TUTUCU_STDDEV_ESIGI=5.0`, gerçek kapakta stddev 20-60) kazandı;
yer tutucu kapakta karar en az 3 iç sayfanın eşleşmesine bağlanır. **NOT — doğrulandı: yalnız
`s1-kimlik-tolerans` dalında, agent-mode'un atası DEĞİL (agent-mode'a merge edilmemiş).**

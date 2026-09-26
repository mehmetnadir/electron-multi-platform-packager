# SET güncelleme kanalı — sözleşme (exe tarafı)  `[SÖZLEŞME: TASLAK]`

> **DÜZELTME 2026-09-21:** İlk sürüm yanlıştı — kitap başına (book1…book6) uç nokta
> tasarlamıştı. **Set içindeki kitaplar zaten kendi uçlarından güncelleniyor.**
> Güncellenecek olan **SET'in kendisi**: kabuk + üyelik.

## Kapsam — ne güncellenir, ne güncellenmez

> **DÜZELTME 2 — 2026-09-21 (ÖLÇÜMLE):** kabuk tanımı `index.html` + `set_app.config`
> + `assets2/**` diye yazılmıştı. **Yanlıştı.** Gerçek bir SET ağacında ölçüldü
> (SM4 Set, `temp/d4100a93…/app`): `index.html` 12 varlık referanslıyor ve
> **hiçbiri `assets2/` altında değil**; o tanım 459 kabuk dosyasının 54'ünü ve
> index'in yüklediklerinin **0/12'sini** kapsıyordu. Kanal yeni bir `index.html`
> gönderdiğinde yeni hash'li paketler envanterde olmadığı için hiç inmez →
> **set boş ekrana açılır.** Doğru tanım aşağıdadır ve KODDA TEK KAYNAKTIR:
> `src/packaging/set-kabuk.js` (üretici de kapı da oradan ithal eder).

| Güncellenir (SET kanalı) | Güncellenmez |
|---|---|
| **Kök dosyalarının tamamı** — `index.html`, `set_app.config`, `electron.js`/`main.js`, `empp-fs-shim.js`, `favicon.ico` ve kökteki **hash'li webpack paketleri** (`<hash>.<chunk>.js/css`, motor `43e23fce…js` dahil) | `book1…bookN/**` — kitapların içi (kendi kanalları) |
| `assets2/**` (menü görselleri) | `node_modules/**` (uygulamayla kurulur) |
| `core/**` (ikon, arka plan, flipBook, kurum logosu — 346 dosya) | `temp/**` (electron-builder çıktısı; ölçülen ağaçta 1,8 GB) |
| `i18n/**` (dil dosyaları) | `empp-set.json` + `.empp*` (kanalın kendi durumu) |
| **Üyelik**: sete kitap eklendi / çıkarıldı | |

**Ölçüm (yeni tanım, iki gerçek ağaç):** SM4 Set → 459 kabuk dosyası, 12/12 referans
kapsandı, 0 kitap sızması, 0 artefakt. `uploads/579b35ed…` → 585 dosya, 10/10, 0 sızma.

**Neden beyaz liste (dizin) — statik ayrıştırma değil:** `index.html`ten transitif
kapanış SM4'te 34 hash'li paketin 32'sini, ikinci ağaçta 168'in 166'sını KAÇIRIR
(adlar webpack çalışma-anı haritasından kurulur, statik olarak ayrıştırılamaz).
Ayrıca `app.config.js` referansı gerçekte YOKTUR (`set-app-config-kasitli-yok.test.js`).

**Beyaz listenin kör noktası GÖRÜNÜR:** yayıncı yeni bir kök dizin eklerse
(`fonts/` gibi) paketleyici bunu `empp-set.json → kapsamDisiDallar[]` alanına
yazar ve **kapı FAIL eder** — sessiz eksik yerine gürültülü eksik.

Yani set kanalı **kabuk + üyelik** kanalıdır. Bir kitap sete eklendiğinde o kitabın
**ilk verisi** bu kanaldan iner; ondan sonra kitap kendi ucundan bakımını sürdürür.

## Kimlik: SET'in kimliği (tek)

Paket bir sete karşılık gelir ve **tek bir kimliği** vardır (panelde setin kaydı).
Kaynak sırası:
1. Paketleme isteğindeki `setKimligi` alanı — **otorite budur**
2. Yoksa `kurum.txt` + paket adından türetilmez → **kanal kapalı**. Tahmin yasak.

Kitap başına kimlik **YOK** — o tasarım iptal edildi.

## Uç noktalar (panel bunları sağlayacak)

```
GET <taban>/set/<setKimligi>/surum.json     → {"surum":"<sha256>","uretim":"<ISO8601>"}
GET <taban>/set/<setKimligi>/manifest.json  → {
      "surum":"<sha256>",
      "kabuk":[{"yol","sha256","boyut"}],        // index.html, assets2/…, set_app.config
      "kitaplar":[{"dizin":"book7","durum":"ekle|cikar","kaynak":"<url>","sha256","boyut"}]
    }
GET <taban>/set/<setKimligi>/dosya/<yol>    → ham kabuk dosyası
```

## Üyelik kuralları

**ÇIKARMA** (`durum: "cikar"`): kitap dizini silinir. `EMPP_GUNCELLEME_SILME` kapısına
tabi **değildir** — üyelik kararı açıkça manifestten gelir, tahmin değildir. Ama silme
**atomik** olmalı: önce `.silinecek` adına taşı, menü güncellendikten sonra kaldır;
yarıda kalırsa menüde hayalet madde kalmasın.

**EKLEME** (`durum: "ekle"`): `kaynak` adresinden kitabın arşivi indirilir (yüzlerce MB
olabilir), sha256 doğrulanır, geçici dizine açılır, **sonra** yerine taşınır. Yarım inen
kitap asla menüye girmez. İndirme kesilirse bir sonraki açılışta baştan denenir —
kısmi dosya bırakılmaz.

**Sıra zorunlu:** önce kitap verisi yerine konur, **sonra** kabuk (`index.html`)
güncellenir. Ters sırada menü olmayan bir kitabı gösterir.

## Çalışma anı kuralları (ihlali arıza sayılır)

1. **Açılışı bloklamaz.** Pencere gösterildikten sonra başlar, her istek zaman aşımlı.
2. **Panel yokken sessizce çalışmaya devam eder.** 404 / ağ hatası / bozuk JSON →
   güncelleme atlanır, uygulama normal açılır. Panel ucu henüz yazılmadığı için şart.
3. **Atomik yazım.** Geçici ada indir → sha256 doğrula → yerine taşı.
4. **Varsayılan RET.** Eksik alan, `..`/mutlak yol, boyut uyuşmazlığı → güncellemenin TAMAMI
   reddedilir (2026-09-26'dan beri ya hep ya hiç; bkz. "G istemcisi — kimlik, monoton sürüm").
5. **Kabuk güncellemesi kitap verisinden sonra.** (yukarıdaki sıra kuralı)
6. **Yayıncı kanalıyla çakışma:** yayıncının ~350 MB'lık zip'i kabuğu ezebilir.
   Bu sözleşme onu kapatmaz — ayrı karar (Nadir'e açık madde).

## Kapılar

| Değişken | Varsayılan | Ne yapar |
|---|---|---|
| `EMPP_SET_GUNCELLEME` | AÇIK | Kanalın kendisi |
| `EMPP_GUNCELLEME_TABANI` | pakete gömülü | Uç nokta tabanı |
| `EMPP_GUNCELLEME_ZAMAN_ASIMI` | 15000 ms | İstek başına tavan |

## Paket içine yazılanlar

`empp-set.json` (şema **2**) — `{setKimligi, taban, damga, kabukTanimi, kabukDosyalari[],
kapsamDisiDallar[], kitapDizinleri[], imza, surum}`. `kabukTanimi` kabuk tanımının imzasıdır;
kapı kendi imzasıyla karşılaştırır — üretici ile kapı ayrışmışsa GEÇTİ verilmez.
Set kimliği yoksa dosya yine yazılır, `"setKimligi": null, "sebep": "..."` ile
**görünür** kalır; sessizce düşürülmez.

**Enjeksiyon kararı (2026-09-26):** set kimliği, gerçek taban (yer tutucu `panel-yok.invalid` /
kaynak `varsayilan` DEĞİL) ya da imza anahtarı yoksa güncelleyici pakete ENJEKTE EDİLMEZ, sebep
uyarı olarak yazılır (`guncelleyici-enjekte.js` `enjeksiyonKarari`) — güncelleme alamayan "G'li" paket
üretilmez. Pardus Docker yolu claim'in `setKimligi`/`guncellemeTabani`/`surum`unu runner'da doğrulayıp
`EMPP_G_*` ile konteynere, oradan jobInfo'ya taşır (`pardusGKimligi`, `packager-run-linux.js`).


---

## Ölçülmüş örnek — SM4 Set (ilk test paketi)

| Alan | Değer | Nereden ölçüldü |
|---|---|---|
| `setKimligi` | **11811** | `~/.empp-agent/agent.log` — R2 yolu `softwares/11811/…`, önbellek `cache/11811/SM4-v50.exe` |
| Kısa kod | `xeaah` | önceki teslim belgesi |
| Kurum | 60 (YDS Publishing) | `kurum.txt` |
| Kabuk | 459 dosya: kök dosyaları (60) + `assets2/` (52) + `core/` (346) + `i18n/` (1) | `temp/d4100a93…/app` ölçümü, 2026-09-21 |
| Üyelik | `book1`(45516) `book2`(25788) `book3`(25175) `book4`(11810) `book5`(etkileşimli) `book6`(öğretmen PDF'i) | zip listesi |

**Taban (karar):** `https://akillitahta.ndr.ist/api/v1/guncelleme`
→ uçlar `…/guncelleme/set/11811/surum.json` biçiminde çözülür.
Panel tarafı bu yolu birebir sağlayacak. `EMPP_GUNCELLEME_TABANI` ile ezilebilir.

Set kimliği paketleme isteğinde **açıkça** verilir; `assets/<id>` değerleri kitapların
kendi kimlikleridir ve bu kanalda KULLANILMAZ (kitaplar kendi uçlarından güncellenir).

## Enjeksiyon yeri — ANA SÜREÇ, renderer DEĞİL (2026-09-21, ölçümle)

Güncelleyici `electron.js` (paketlemede `main.js` olur) içine, `app.whenReady()`
zincirine ötelenerek enjekte edilir. `index.html`'e **enjekte edilmez** ve
`index.html` bayt bayt değişmeden kalır.

Gerekçe: kanal diske yazıyor (`indir → sha256 doğrula → rename`). Bu `fs` erişimi
ve açılış zamanlaması ister; ikisi de ana sürecin işidir. `EMPP_ON_GETIRME`
index.html'e enjekte edilir ama o bir **renderer** kanalıdır — aynı yere konması
gerektiği çıkarımı yanlıştır.

Çivi: "YER ÇİVİSİ: enjeksiyon ANA SÜRECE girer, index.html'e GİRMEZ" testi
index.html'in değişmediğini doğrular; hedefi index.html'e kaydıran mutant
(M11) 5 testi öldürür.

## Açık madde — asar yazılabilirliği (ÖLÇÜLÜYOR)

Kurulu uygulamada kabuk dosyaları (kök + `assets2/` + `core/` + `i18n/`) ve `book*`
`app.asar` **içindeyse** arşiv salt-okunur olduğu için kanal hiçbir
şeye yazamaz: doğru davranır (sessizce atlar) ama **boşa çalışır**.

Bu, config'den değil ÜRETİLMİŞ EXE'den ölçülür. Sonuç "içinde" çıkarsa
güncelleyicinin hedef yolları `asarUnpack` listesine eklenir (`asar: false`
yapılmaz — paketi şişirir). Liste ile güncelleyicinin hedefleri iki ayrı yerde
tanımlanırsa bu bir fan-out sapmasıdır; tek kaynağa bağlanıp sözleşme testiyle
çivilenir.

Ölçüm bitmeden yeni exe üretilmez.

## Üretici (sunucu tarafı, 2026-09-22)

> **YAYINA GİTMEYEN YOL (D-2, 26.09):** bu üretici ve onu çağıran `src/packaging/guncelleme-paketi.js`
> (paketleyicinin `guncelleme.tar.gz`'si) artık yayına gitmez — runner tar'ı yüklemez, G'nin tek yazarı
> `tools/g-yayin`. Çıktısı `kanal:"G"`/G3 sürüm taşımadığı için G istemcisi (e07bc37) onu
> `manifest-reddedildi:kanal-g-degil` ile reddeder (testi buna çevrildi). Ölü kod karantinası canlıya
> almadan SONRA ayrı iş.

`scripts/guncelleme-manifesti-uret.js` — SET kökünden 3 uç noktayı düz dosya
üretir; kabuk ayrımı `set-kabuk.js`'ten ölçülür (tahmin yok), `book\d+/` ve
artefakt dizinlerine hiç girilmez. `surum` = kabuk sha256 listesinin
deterministik hash'i (yalnız kabuktan — üyelik-yalnız değişiklik bump'lamaz).

```
node scripts/guncelleme-manifesti-uret.js --set-koku <kok> --set-kimligi <id> \
  --cikti <dizin> [--kitaplar '<json dizisi>']
# çıktı: <cikti>/set/<id>/{surum.json,manifest.json,dosya/<yol>}
```

## Sunucu tarafı — TASARIM (2026-09-23, Şef; Nadir'in "R2 statik" önerisine itirazı yok)

Karar: SET güncelleme uçları **yayıncının R2 kovasında statik dosya** olarak yaşar; API'ye
rota eklenmez. Taban = `<r2Config.publicUrl>/guncelleme` (YDS örneği:
`https://cdn.ydspublishing.com/guncelleme` → `…/guncelleme/set/11811/surum.json`).
Yayınevi × kova ilkesi: taban yayıncının R2 config'inden çözülür, env varsayılanına düşülmez.

Üç parça, üç sorumluluk (R2 kimlik bilgileri YALNIZ srv21'de — Decision B):
1. **Paketleyici (Mac, `packagingService`)** — `setKimligi` verilen Windows işinde, TÜM
   yamalardan sonra (empp-set.json ile aynı anda) `scripts/guncelleme-manifesti-uret.js`
   çekirdeğini `workingPath` üzerinde koşturur → `temp/<jobId>/windows/guncelleme/set/<id>/
   {surum.json, manifest.json, dosya/…}`; `GET /api/download/:jobId/guncelleme` bunu tek
   `.tar.gz` olarak verir. Paketteki `empp-set.json.taban` = istekteki `guncellemeTabani`.
2. **API (srv21, `routes/agent/build-agents.ts`)** — claim yükü `setKimligi` +
   `guncellemeTabani` (= publicUrl + `/guncelleme`) taşır; yeni uç
   `POST /api/v1/agents/:agentId/result/presign-guncelleme` `{bookId, platform, setKimligi,
   dosyalar:[{yol, boyut, contentType}]}` → her dosya için presigned PUT
   (`guncelleme/set/<setKimligi>/<yol>` anahtarı, kitabın yayıncısının kovası, lease şartı).
3. **Runner (Mac, `src/agent/runner.js`)** — Windows SET işi başarıyla bitince
   `guncelleme` paketini indirir, SIRAYLA yükler: önce `dosya/*`, sonra `manifest.json`,
   EN SON `surum.json` (tüketici tutarlı durum görsün); ardından `GET <taban>/set/<id>/surum.json`
   ile üretilen sürümü doğrular; eşleşmezse iş "yüklendi" sayılmaz.

Tetikleyici — KAPANDI (Nadir, 2026-09-25): ayrı `windows-set` platformu YOK; tek `windows` satırı kalır,
kökeni `build_method` taşır (`passthrough` = İmpark exe, `build` = bizim NSIS). Bkz.
`windows-paketleme-sozlesmesi.md` "Teslim ve yedek". Açık kalan: srv21 işçisi `build_method=build`
satırında İmpark exe'sini passthrough ile EZMEMELİ — bu kod + deploy onayı yayın ön şartıdır.

## G yayın aracı (2026-09-26, dal `g-yayin`)

Nadir 26.09: bütün paketlerde bizim istemcimiz (G) olacak. G üç şeyi uzaktan değiştirir: kök `index.html`,
set bileşimi (kitap ekle/çıkar) ve `bookN/43e23fce2b7009474555a77.js`. Yayın aracı `tools/g-yayin/yayinla.js`:

```
node tools/g-yayin/yayinla.js --set-kimligi <id> --taban <https taban> --cikti <dizin> \
  --panel <kod|ad> [--surum 2.p.s] [--onceki-surum 2.p.s] [--onceki-manifest <yol|https>] [--ilk] \
  [--index <html>] [--motor bookN=<js>]... [--ekle bookN=<zip|dizin>]... [--cikar bookN[,bookM]] \
  (--anahtar-zinciri | --anahtar-dosya [yol])
node tools/g-yayin/yayinla.js dogrula (--cikti <dizin> | --uzak <taban>) --set-kimligi <id> [--surum 2.p.s] [--arsivler]
node tools/g-yayin/yayinla.js kuru-imza        # yalnız GEÇTİ/KALDI
node tools/g-yayin/yayinla.js yukle --set-kimligi 74390 --cikti <dizin> [--onayli]   # beyaz liste + onay kapısı
node tools/g-yayin/yayinla.js e2e 74390 [--onayli]    # üret → yükle → canlıdan doğrula; JSON + rc
```

- **Sürüm:** `2.<panel>.<sayaç>`, bilinen bütün önceki sürümlerden kesin büyük olmalı. Önceki sürüm kaynakları: imzalı önceki manifest, `--onceki-surum` (kurulu paket), yerel `surum.json`.
- **Manifest birikimli:** önceki imzalı durum ile bu yayının değişiklikleri birleşir. İmzası tutmayan ya da başka sete ait önceki durum taşınmaz.
- **Şema:** `{sema:1, kanal:"G", setKimligi, surum, onceki, uretim, anahtar, kabuk[], kitaplar[]}`. Windows istemcisiyle uyumlu; eklenen alanlar yok sayılır.
- **Anahtar:** `--anahtar-zinciri` üretim anahtarını Anahtar Zinciri borusundan okur ve `31b8663b…2cf6` ile eşleşmesini ister. `--anahtar-dosya` yalnız TEST içindir; dosyada üretim anahtarı bulunursa araç reddeder.
- R2 düzeni, yükleme sırası ve açık kararlar `g-yayin-r2-yol-tasarimi.md`'de. İstemci kuralları ve yerel HTTPS koşumu `tools/g-uctan-uca/README.md`'de.
- **`ekle` içi imzalı dosya listesi (26.09):** her `kitaplar[]` `durum:"ekle"` girdisi artık isteğe bağlı `dosyalar:[{yol,sha256,boyut}]` taşıyabilir (arşivin İSTEMCİ okuyucusuyla türetilmiş birebir dökümü, yol kaçışı RED, alan yoksa eski istemci/eski manifest değişmeden çalışır) — amaç istemcinin arşivi AÇMADAN bu imzalı listeyle doğrulayabilmesi (mac/Pardus örtü kipindeki "açılışta yeniden doğrula → diskte ×2 yer" sorununu önler); `yayinla.js`'in `dogrula` (yerel ve `--uzak`) alt komutu listeyi arşivle kıyaslayıp uyuşmazsa RED verir.

## G istemcisi — kimlik, monoton sürüm, ya hep ya hiç (2026-09-26, dal `g-electron`)

G yayın ajanı kurulu Windows istemcisinde üç açık buldu; üçü de TÜM kiplerde (Windows yerinde +
mac/Pardus örtü) kapandı — `src/runtime/kitap-guncelleyici.js`:

1. **Monoton sürüm.** İmzası doğru manifest de ancak `surum` G3 biçiminde ve KURULU sürümden
   KESİN büyükse uygulanır. Kurulu = max(`package.json` sürümü, `empp-set.json` `surum`u (claim'in
   `surum`u, G3), son uygulanan G sürümü: Windows'ta damga, örtüde `etkin.json`). Damga eski
   pakete aitse (taban = `empp-set.json` özeti değişti) yok sayılır.
   G3 olmayan paket sürümü (içerik-hash) kıyasa girmez — o paketin İLK G'si her G3'ü alır.
2. **Kimlik.** `kanal == "G"` ve `setKimligi == paketin gömülü kimliği` değilse ret. İmzasız
   `surum.json` yalnız tetiktir; asıl karar imzalı manifestte (`-tetik` senaryoları).
3. **Ya hep ya hiç.** Windows: her şey önce `.empp-gecici/` altında hazırlanır (indir + sha256/boyut
   + arşivi aç); tek hata → canlı ağaca hiç dokunulmaz. Uygulama rename dizisidir (kitaplar →
   kabuk → EN SON `index.html`); düşen adımda geri alınır; `.empp-gecici/gunce.json` çöken süreci
   sonraki açılışta geri sarar; kesinleşme = damganın atomik yazımı. Örtü: tek `rename` ile
   kesinleşir; bu koşuda başka yoldan üretilen aynı içerik bir yolun bozuk ucunu ÖRTMEZ.
4. **Birikimli manifest.** Aynı sha256'lı `ekle` arşivi yeniden indirilmez (Windows: damganın
   `kitaplar` defteri; örtü: arşiv içerik-adresli nesne olarak saklanır).
5. **Kural 8.** `bookN/…` kabuk girdisinin kitabı tabanda yoksa ve aynı manifestte eklenmiyorsa
   atlanır — boş kitap dizini / hayalet kitap oluşmaz.
6. **Örtüde `dosyalar[]` yoksa** (yayın aracının bugünkü biçimi) kitap listesi imzalı sha256'lı
   arşivden türetilir; açılışta arşivden yeniden türetilip kıyaslanır (kurcalanmış liste → kitap
   sunulmaz). `dosyalar[]` varsa ve bozuksa ret. ÖNERİ (yayın aracına): `ekle` girdisine imzalı
   `dosyalar[{yol,sha256,boyut}]` eklenirse örtü arşivi saklamadan doğrular (disk ×2 biter).

Kanıt: `tools/g-uctan-uca/kos.js` 11 senaryo (her ikisi de `--kip yerinde` ve `--kip ortu`),
`src/runtime/kitap-guncelleyici-guvenlik.test.js`, mutasyon `tools/g-kanal/ortu-mutasyon.js` (M25–M44).

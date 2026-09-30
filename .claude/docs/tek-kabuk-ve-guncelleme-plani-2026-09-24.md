# Tek kabuk + içerik güncellemesi — plan TASLAK (2026-09-24)

`[PLAN: TASLAK]` — Nadir onaylamadan kod yazılmaz (plan-onaysiz-kod-yasak). Tespit raporları:
scratchpad `sonuc/SABLON-TESPIT-{WEBZ,KOD,SAHA}.md`, `GUNCELLEME-TESPIT.md`, kararlar `KARARLAR-2026-09-24.md`.

## Kararlar (Nadir, 24.09)
1. Tek kabuk = Web-Z set arayüzü (`/go/<kod>/web-stream/`); paketler ve sunucu YALNIZ oradan beslenir.
2. Motor (`43e23fce…js`): bizim derlememiz kanonik, `player-guncelle` tek dağıtıcı (SKILL §1c).
3. Operatör ekranı yalnız son sürüm numarasına göre uyarı görür.
4. İmpark içerik güncellemesi (zip/SCORM şeridi) çevrimdışı paketlere ulaşmalı; tek kitapta test.

## Tespit özeti (ölçüldü)
- Aynı set (73768 / ei4wf): Web-Z koyu kabuk + adlar; Mac paketi beyaz zemin + kitap ID'leri.
  Sebep: `set-menu.js:82-112` adı PDF dosya adından çıkarıyor, YDS PDF'leri sayısal adlı.
- Üç çalışan paketleyici, üç farklı commit: Mac 3001 (0a55136, HEAD 90ff666), srv21 :3005
  (83b1e74, set-menu yok), srv21 :3093 (539c35b). Dört çekirdek modül hiç commitlenmemiş
  (set-kimligi, set-kabuk, harf-kapisi, guncelleyici-enjekte); ağaçta 79 kirli dosya.
- İçerik güncellemesi: istek/cevap/indirme çalışıyor, AÇMA yok — `adm-zip` pakette yok
  (`packagingService.js:2077/2253/2428` node_modules dışlanıyor). Motor hatayı yutup sürümü
  ilerletiyor → sahte "güncellendi". ProBook'ta 8 pakette 14 açılmamış zip (≈4,9 GB).
  Android açıyor (K8) ama iframe/medya örtüsü yok. Mac/Pardus/Windows(bizim) hiç almamış.

## Fazlar (sıra bağlayıcı; her faz kapılı, atomik commit)

### Faz 0 — Temel: tek kod tabanı (önkoşul, kodsuz)
- Kirli ağacı ayıkla: 4 çekirdek modül + testleri commit (`--only`), kalan 79 dosya sınıflandır.
- Üç paketleyiciyi tek commit'e çek: srv21 :3005 ve :3093 → HEAD; Mac 3001 yeniden başlat
  (Nadir Windows testinden sonra — bekleyen karar). Sağlık ucu `commit` alanı üçünde eşit.
- Kapı: `/api/health.commit == git HEAD` üçünde; `set-menu.js` md5 üçünde aynı.
- **Durum 24.09 (ölçüldü):**
  - Yapıldı: Grup 5 (`tools/windows/kabul/*.onceki-*`) → `_graveyard/2026-09-24-windows-kabul-onceki/`;
    `npm test` globu `scripts/**` + `tools/**` ile genişletildi (182 test daha koşuyor, hepsi geçti);
    `olu-yol-kapisi.test.js` beyanına `platforms/android/ag-bilgisi.js` eklendi (0a55136'nın
    unuttuğu canlı modül; 1501 test → 0 fail, 4 skip). Grup 1-4 commit'i Nadir onayı bekliyor.
  - srv21 gerçeği plandakinden farklı: canlı üretici `/opt/empp-packager` **:3093, systemd DIŞI**
    (terk edilmiş SSH oturumu, pid 2258194, 17.09'dan beri; 17-19.09 arası 30+ SET işi). systemd
    birimi `empp-packager.service` **:3091**'i koşturuyor, iş almıyor. `:3005` pm2 kopyasında 7 günde
    iş yok, origin/main'den 10 commit geride. K17 `set-menu.js` + K15 `zenity-gom.js` srv21'de de
    takipsiz; `packagingService.js`/`queueService.js` orada Mac'ten ayrışmış dal. "HEAD'e çek" bu
    haliyle K15/K17'yi siler → önce commit kararı. `/opt/empp-packager/r2.conf` açık metin R2
    anahtarı taşıyor (0600; değer hiçbir rapora basılmadı) — döndürme kararı Nadir'in.
    Rapor: scratchpad `sonuc/SRV21-PAKETLEYICI-HIZALAMA.md`.

### Faz 1 — Tek kabuk: Üretim Masası üretir, paketleyici ÜRETMEZ (ölçüm 24.09, revize)
- ÖLÇÜLDÜ: `apps/uretim-masasi-mac` (SwiftUI, v1.5.5) Web-Z kabuğunu ZATEN taşıyor —
  `araclar/sf425-cikar.mjs` Worker `set-ui-templates.ts`'ten ÜRETİM kopyasını çıkarır
  (`Kaynaklar/sf425/{index.html,config,scripts,styles,images}`), `WebZTemaUretici` çevrimdışı
  `index.html` + `settings.json` üretir; Set Menüsü ekranı "kök menüyü paketleyici üretmez, biz
  üretiriz" der (`SunucuKitapEkleUclari.swift:280`). Yani iki mekanizma var: masaüstü (doğru kabuk)
  ve paketleyici `set-menu.js` (K17, yanlış kabuk). Runner/KitapTekExe yolundan gelen kaynaklar
  masaüstünden geçmediği için sade menüye düşüyor — dört ailenin sebebi bu çatal.
- KARAR (öneri): kabuğun tek üreticisi masaüstündeki `WebZTemaUretici` (kaynağı Worker şablonu,
  `sf425-cikar.mjs` ile taze). Paketleyici `set-menu.js` HTML ÜRETMEZ; kökte kabuk yoksa
  (a) masaüstünün başsız aracını çağırır (`araclar/set-kaynak-derle.swift` kalıbı) ya da
  (b) işi "kabuk eksik" diye reddeder ve Üretim Masası kuyruğuna düşürür. Tespit/idempotency
  mantığı (`motorKopyasiMi`, `MENU_ISARETI`) kalır. Web-Z şablonu değişince `sf425-cikar` +
  sürüm damgası; paket içindeki kabuk sürümü sağlık kontrolüyle kıyaslanır.
- Tek kitap: kabuk çizilmez (Web-Z ile aynı). Yayıncı tasarımlı kök menü (C ailesi): karar Nadir'in.
- Kapı: 73768 dört platformda kök ekran = Web-Z yapısı; `harf-kapisi` + ProBook kabul; kabuk
  sürümü ≠ Worker şablonu ise kapı kırmızı.

### Faz Ü — Üretim Masası = kontrol merkezi (Nadir, 24.09: "tüm işi masaüstünden yönetelim")
- Sunucu yalnız SİNYAL verir ("sürüm değişti", "kabuk değişti", "motor değişti", "24 Pardus failed");
  masaüstü açılınca sinyalleri sıralı iş kuyruğuna çevirir ve tek tek koşturur (yeniden paketle,
  güncelleme testi, ProBook kabul), her adım Olaylar'a düşer.
- Gözcü (mevcut Bu Mac ekranı genişler, yeni bekçi YOK): 3001 çalışan commit ≠ HEAD; ağaçta 24 s+
  kirli dosya; srv21 :3005/:3093 commit farkı; kapı bayrakları (EMPP_SET_MENU vb.) belgeyle uyuşmazlığı;
  ProBook/telefon erişilebilirliği. Uyarı rozet + push (ntfy).
- Bütünlük: paket parmak izi (kabuk sürümü, motor sürümü, paketleyici commit, adm-zip var/yok)
  `paket.json`'dan okunur; Kitaplar ekranında platform başına "eski/eksik" rozeti.
- Yetki: masaüstü zaten launchctl/Docker/3001 yönetiyor; eklenen tek yetki "paketleyiciyi HEAD'e
  çek + yeniden başlat" düğmesi (onay diyaloğu). Sunucuya yazma disiplini (sayılı, onaylı) korunur.
- Sıra: Faz 0 → Faz Ü gözcü (ölçüm) → Faz 2 (güncelleme) → Faz 1 (kabuk) → Faz 3/4.

### Faz 2 — İmpark içerik kanalı (K) çevrimdışı paketlerde
1. `adm-zip` (saf JS) pakete: electron-builder `files` istisnası `node_modules/adm-zip/**` ya da
   renderer karşılığı (Android K8 kalıbı).
2. Açma hedefi WORK (fs-shim `rel()` eşlemesi); asar içine yazılmaz.
3. Ana süreçte `protocol.handle('file')`/`interceptFileProtocol`: WORK kopyası BASE'in önünde —
   fetch + img + iframe + audio/video. Android'de iframe/medya örtüsü (Capacitor
   `shouldInterceptRequest` ya da SW).
4. Sahte ilerletme kapanır: açma doğrulanmadan (BookContent.xml WORK'te + md5) menü sürümü yazılmaz.
5. AppRun/kurulum: WORK menüsü ↔ paket menüsü uzlaşması (`apprun-template.sh:114`).
6. Kanal Ş (yayıncının kabuk/motor zip'i) BİLİNÇLİ KAPALI (`checkForUpdates` no-op yaması):
   kabuk ve motor yalnız bizim SET kanalı + player-guncelle ile gider (karar 2).
- Kapı: test planı GUNCELLEME-TESPIT §(f) — aday 57806 (Shall We 5 book2, 72 MB): işaretli
  htmletk → `scorm-guncelle` (Nadir onayı: panel yazma) → orijinal exe (Windows) → Pardus/Mac/
  Android'de işaret görünür; kapanışta işaret geri alınır.

### Faz 3 — Motor sürüm damgası + operatör uyarısı
- Derleme çıktısına sürüm/derleme damgası; paketleyici üretimde kaynaktaki motoru kanonikle
  kıyaslar, eskiyse değiştirir, `paket.json.motorSurumu` yazar.
- Üretim Masası: paket başına motor + kabuk + paketleyici sürümü; en son sürümden gerideyse
  "eski" rozeti + tek tık yeniden paketle. Operatör karar vermez.
- `player-guncelle` §1c PLAN satırları VAR'a döner.

### Faz 4 — Sahadaki YDS paketleri (SAHA tespiti geldi, 24.09)
- Evren: YDS 37 aktif kitap/set × 5 platform. Pardus 24/37 `failed`; mac 2 hata; windows/android/
  web-stream 0 hata. Windows = yayıncının kendi exe'si (bizim kod dokunmuyor), kapsam dışı.
- Tek şablon (`set-menu.js`) dört görsel aile üretmiş: A ID-etiketli (73768, üç platformda aynı),
  B başlık-etiketli, C yayıncı tasarımlı (assets2), D sarılmamış motor kopyası → beyaz ekran riski
  (mac DMG'lerin 5/6'sı). 6 SET kitabının 4'ünde mac↔pardus farklı aile. Kod aynı; fark ortam/kaynak
  (`EMPP_SET_MENU` kapısı, önbellek) — kök mekanizma Faz 0'da ölçülür (`EMPP_SOURCE_CACHE`, kapı tarihi).
- Yeniden üretim sırası: önce D ailesi (açılmayan) SET'ler, sonra A/B; C korunur (karar: yayıncı menüsü).
- Yeniden üretim öncesi Faz 2/5 (WORK menüsü uzlaşması) şart; yoksa yeni paket eski menüyle açılır.

## Açık kararlar (Nadir)
- Faz 0: Mac 3001 yeniden başlatma zamanı (Windows testin sonrası?).
- Faz 1: yayıncının kendi kök menüsü olan setler de kabuğa zorlanır mı, yoksa korunur mu?
- Faz 2: `scorm-guncelle` ile 57806'ya test yüklemesi onayı.
- Faz 4: toplu yeniden üretim kapsamı (SAHA raporu sonrası).

## Değişmeyen sınırlar
- Kitap içeriği YALNIZ İmpark kanalı K ile; SET kanalı içerik taşımaz.
- Sunucudaki kitap içlerine dokunulmaz (player-guncelle §0b); bu plan bizim paketlerin içidir.
- `rm` yok, `git add .` yok, deploy.sh yok; hedefli scp + yedek + pm2 reload.

## Durum 2026-09-24 akşam (ölçüldü)
| Faz | Durum | Kanıt |
|---|---|---|
| 0 | Grup 1-5 commitlendi (0efa7d8, 9bfb394, 0651f80, 4d80ae9, 16dc079); test globu genişledi | `npm test` 1652 test, 0 fail, 5 skip |
| 1 | `set-menu.js` Web-Z kabuğuna dokunmuyor (29b8fc8); kabuk masaüstü `webz-kabuk-uret.swift` ile (book-update 802b249, 0ffc10d) | 73768 1.0.1: ProBook 3/3 kitap, kök menü Web-Z ile yan yana |
| 2 | Kanal K çevrimdışı paketlerde (ef3aaa8) + packagingService bağlantısı (17244af) | ProBook 57806 book2 v2→v4, Y-A senaryosu; 22/22 mutant |
| 3 | Motor + okuyucu kabuğu kanonikle değiştirme (e1f080c, 17244af); kapı `scripts/motor-kapisi.js` | 73768 DMG rc 4 → değiştirilmiş kopya rc 0; kabuk deneyi 3/3 açıldı, rozet 1.13.3, 1.0.2 Pardus ProBook KABUL (23:04, Tailscale): md5 eşit, bütünlük TAM, sapma 0.226/koyu 0.969/renk 56832, "Üniteye Git" → Ünite Seçin modalı (6 ünite, %99,8 piksel değişti); etkinlik (htmletk) tıklaması ölçülmedi |
| Ü | Plan yazıldı (book-update `plan-kontrol-merkezi-2026-09-24.md`); ilerleme % ertelendi | — |
| Pardus şeridi | ProBook'ta yerli üretim 367 sn (docker 1025), kabul yerel 51 sn; DEB kapalı Mac'te 259-427 sn | `probook-serit/RAPOR.md`; kayıt sırrı Nadir'de |
| 3001 | 17244af ile yeniden başlatıldı (pid `~/.empp-agent/packager.pid`), ortam `~/.empp-agent/packager.env`; `setGuncelleme` kapısı KAPALI (sözleşme ONAYLI değil) | `/api/health` kapılar eskisiyle aynı |

Açık: 73768 1.0.2 canlıya yükleme kararı (Nadir; Pardus kabul edildi, Mac imzalı derleme ofis bekliyor); etkinlik (htmletk) tıklama kanıtı; ProBook şeridi dosyalarının commit'i + runner yamaları; srv21 `:3093` set-menu.js eşitleme + systemd (Nadir); `r2.conf` anahtar döndürme (Nadir); `surum-kiyas.js` sağlık ucunda `None` (ölçülecek).

## 2026-09-25 akşam — ölçülen durum (Şef, oturum 006cff11)

- **Kök neden kesinleşti:** mac/android/pardus pipeline'ının kaynağı köprüdeki İmpark Windows exe'si
  (`akillitahtalar/{bookId}/*.exe`, `bridge-source.ts`); paketleyici `set-menu.js` yalnız kök
  `index.html` yazar, tema dosyalarını koymaz. 73768'in 25.09 android/mac paketleri düzeltme sonrası
  yine eski kabukla çıktı. Denetim: 49 set kaydı, hiçbirinde kanonik kabuk yok
  (`~/Downloads/Windows/RAPOR-2026-09-24/set-kabuk-denetim-2026-09-25.{csv,md}`).
- **Seçilen yol (Nadir):** düzeltilmiş kabuk KAYNAĞA yazılır → build zip Nadir tarafından İmpark'a
  yüklenir → yeni exe köprü kaynağı olur → mac/android/pardus o kaynaktan üretilir. 13 YDS setinin
  build zip'i teslim edildi (`~/Downloads/Windows/*-BUILD-20260925/`, her birinde OKU.md).
  Runner ZIP-kaynak yaması (`runner.js:610` yalnız `unrar l` doğrular) bu yolda GEREKMEDİ; ileride
  `POST /jobs/:id/source` (sources/*.zip) kullanılacaksa gerekir.
- **Araç eksikleri (Üretim Masası `webz-kabuk-uret` / `SetCiktiUretici`), plan maddesi:**
  (a) menü sırası klasör numarasından değil `settings.json.books[].displayOrder`'dan gelmeli
  (59834'te scratchpad türeviyle üretildi); (b) `assetIdGecerliMi` yalnız rakam kabul ediyor,
  `assets/<id>/` diskte varsa kabul etmeli (45482 "Grade-8-Games"); (c) KV'de "Kitap N" yer tutucu
  başlıkları için uyarı + panel Adi'den öneri.
- **Kaynak/KV tutarsızlıkları (Nadir düzeltecek):** 45504 (3113 kapak/İçerik, 45141 eksik), 45481 ve
  11859 ("Kitap N" başlıkları; Games/Test Book KV'de yok), 45549 (Games KV'de yok), 45551 (book4 kapağı
  SW8'e ait; R2'deki 45551 exe'si Maarif içeriği, android apk boş motor — canlı dağıtım hatalı).
- **3001 kapı arızası:** reboot sonrası run-agent.sh'ta `EMPP_SET_GUNCELLEME`/`EMPP_ICERIK_GUNCELLEME`
  yoktu → varsayılan AÇIK; iki export eklendi, reçete koşul betiği bitmiş işi aktif saymayacak şekilde
  düzeltildi, 3001 pid 52572 kapalı kapılarla doğrulandı (memory `kapi-bayraklari-reboot-sonrasi-acildi`).
- **Windows:** NSIS test paketi üretildi (SM2, 807 MB, kapı 8 PASS/2 FAIL: version.txt 4 parça,
  set kanalı kapalı), Nadir Windows'ta deniyor. İmza: Certum OV bulut (€209) alınacak + İmpark yuvası
  SMB ile (aynı paylaşımda mv 0,15-0,18 sn, kopya 4,5 MB/s, Mac→Storage7 17 MB/s) yedek yol;
  gözcü betiği `scripts/imza-yuva-smb.sh` (kuru koşu testli). **30.09 güncel:** Certum ertelendi,
  tek yol İmpark yuvası (26.09 gerçek koşu imzaladı) — `windows-paketleme-sozlesmesi.md` → İmza (Authenticode).

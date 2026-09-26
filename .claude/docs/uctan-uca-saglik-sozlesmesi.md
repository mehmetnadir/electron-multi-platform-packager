# Uçtan Uca Sağlık Testi Sözleşmesi  `[SÖZLEŞME: TASLAK]`

> Kaynak: Nadir 26.09 (beyanı spec'tir) — "Uçtan uca tam testler istiyorum. Bu testler proje sağlığını
> kontrol etmek için sisteme kalıcı olarak eklenmeli." Önce sözleşme, sonra işlev; sağlıklı test için demo paket.

## Amaç
Nadir'in beş sorusunu tekrar koşan, kanıt üreten, kırmızıda bildirim atan kalıcı testlere çevirmek.
Her test bir soruyu cevaplar; cevap "geçti/kaldı" + kanıt dosyasıdır, yorum değildir.

## Demo kitap
**74390** — YDS test kitabı ("yds exe paket", 1 sayfa, 4 KB). `yayincilikadm book e2e-guncelle` beyaz
listesinde (`E2E_TEST_KITAPLARI={74390}`); İmpark içerik güncellemesi yalnız bu kitapta benzetilir.
26.09 ölçümü: pipeline'da satırı YOK (0) → "kitap ekledim, tüm platformları seçtim" yolu sıfırdan sınanır.
Demo SET (set bileşimi, index ile kitap ekle/çıkar) 2. aşama — açık karar 3.

## Test maddeleri (Nadir'in soruları → ölçüt)
| # | Soru | Geçme ölçütü (hepsi ölçülür, kanıt dosyasına yazılır) |
|---|---|---|
| T1 | Kitap eklenip tüm platformlar seçilince Windows güncel sözleşmeye göre üretilip imzalanıp CDN'e yükleniyor mu? | Üretim işi runner'da (build_method=build); CDN nesnesi NSIS ailesi; Authenticode imzası geçerli; paket içi kök index + kitap ana klasörlerindeki `43e23fce2b7009474555a77.js` md5 = beklenen; G istemcisi + üretim açık anahtarı (parmak izi 31b8663b…) + taban `cdn.ydspublishing.com/guncelleme` pakette; CDN md5 = üretilen md5 (srv21 işçisi ezmemiş) |
| T2 | Pardus ProBook'ta üretilip kabulden geçip CDN'e yükleniyor mu? | İş kaydında üretim yeri `probook` (Mac'e düştüyse rapor "düşme: <neden>" yazar, test SARI); T3 kabulü GEÇTİ; CDN squashfs bütün; CDN md5 = üretilen |
| T3 | Kabul kapısı yalnız "açılıyor mu"ya değil; doğru index, index güncelliği, kitabın açılması ve kitap güncelliğine bakıyor mu? | K1 kurulu kök index sürümü = beklenen · K2 her kitap ana klasöründeki 43e23 md5 = beklenen (etk kopyaları kapsam dışı) · K3 ilk kitaba girilir, içerik ölçütü geçer · K4 G manifesti ve İmpark içerik kanalı sorulur: kurulu sürümden yenisi varsa RED "güncel değil" + yeniden kuyruk. Pardus/mac/Android başsız kabulde dördü de; Windows'ta K1-K2 paket içinden statik, K3-K4 açık karar 1 |
| T4 | DMG ve APK aynı sözleşmeyle üretiliyor ve güncelleme alabiliyor mu? | Ortak temizlik (paket-dışı liste, ölü motor) raporda; T3 kabulü GEÇTİ; G: 74390 için yeni index sürümlü imzalı manifest yayınlanınca istemci uygular (mac: userData örtüsü, imzalı .app gövdesi dokunulmamış `codesign --verify --deep --strict` rc=0; Android: `files/empp-g/durum.txt` yeni sha; Pardus: kurulum dizini); K: içerik güncellemesi sonrası yeni içerik görünür; G istemcisi (tüm platformlar, Windows dahil) üç reddi geçer: eski sürüm, başka setin manifesti, tek dosya bozuk → hiçbir dosya yazılmaz (ya hep ya hiç) |
| T5 | İmpark'ta içerik güncellemesi olunca otomasyon paketleri kendisi güncelliyor mu? | Akşam `yayincilikadm book e2e-guncelle 74390` (damgalı içerik) → srv21 `publisher-version-refresh` (06:20) yeniden kuyruğa alır → dört platform yeniden üretilir → sabah: yeni paketlerde içerik damgası = gönderilen damga. Arşivden üretilen setlerde sahte bump → iş BAYAT diye görünür düşer + bildirim (sessiz eski paket YOK) |

## Koşu düzeni
- **Gece:** launchd; akşam T5 tetiği + T1-T4, sabah T5 doğrulaması. Ağır adımlar `~/.empp-agent/agir.sh` semaforundan.
- **Sonuç:** `~/.empp-agent/e2e/<tarih>.json` + okunur özet; ntfy `kosucu` (geçti) / `bekci` (kaldı, madde + kanıt yolu).
- **Bekçi güveni:** aynı madde 2 gece üst üste kırmızıysa aynı gün onarılır ya da test kapatılıp Nadir'e yazılır.
- **Testin testi:** her kapı mutasyonla sınanır (bilerek bozuk paket/index/eski 43e23 → RED beklenir).

## Veri ve sınırlar
- 74390 paketleri CDN'de herkese açık durur (test kitabı). Üretim anahtarıyla imzalı her manifest gerçek güncellemedir;
  G yayın aracının `yukle` kapısı beyaz listeyle yalnız 74390'a izin verir.
- İmpark paneline yazım yalnız `e2e-guncelle` ile ve yalnız 74390'a. R2 yazımı yalnız 74390 yollarına.
- Windows'ta uygulama açılamaz (Mac'te Wine yasak, RDS1 kapalı) → açık karar 1.

## Bugünkü durum (26.09 ölçüm — testler yazılmadan önce)
| # | Hüküm | Kanıt |
|---|---|---|
| T1 | KISMEN | Üretim kapıları açık (`/api/health` setGuncelleme=windows, 12:39Z); imza kuyrukta otomatik mi — ölçülüyor; srv21 işçisi build_method okumuyor (`book-update handlers.ts:1642`), düzeltme 96860dd deploy bekliyor |
| T2 | HAYIR | Üretim Mac Docker'da; ProBook şeridi kodu (420f21e) runner'a bağlı değil; ProBook'ta unrar yok; kayıt sırrı Nadir'de |
| T3 | HAYIR | `probook-kabul.sh` yalnız kurulum + pencere + piksel (`:363-367`); aktivasyon ekranında "ICERIK dogrulanmadi" (`:386`) |
| T4 | KISMEN | Ortak temizlik 4 platformda (f63500c); G mac/Pardus/Android yazılıyor (g-electron cce77c3, g-android); K mac kapalı |
| T5 | KISMEN | Cron 06:20 requeue (17–22.09 ölçüldü); günde bir; arşiv setlerinde BAYAT kapısı var (17/17 `impark_kaynagi` yazıldı), build zip'i yenileyen adım yok |

## Uygulama durumu
- **26.09 akşam** (dal `e2e-baglama-20260926`, fd62a4d tabanı): girdi keşfi `tests/e2e/adimlar/kesif.js` —
  srv21 `pipeline-sql` SALT-OKUNUR (platform satırları + build_agents), r2_object_key → CDN URL; `--url/--paket`
  gerekmez. 9 bayat gerekçe kaldırıldı; bağlanan ölçümler: runner-is-kaydi (build_method + windows-kanit md5) ·
  uretim-yeri (build_agents ProBook) · kabul-kapisi K3/K4 (pardus agent.log E6/E7; mac/android/windows başsız
  karar.json) · g-dogrula (canlı manifest, `uzakDogrula`) · k-icerik (canlı K kapısı + İmpark ZKitapZipH gerçek
  istemci kodu + bozuk zip mutasyonu) · ortak-temizlik (paket-disi-liste + bookN main.js) · t5-yeniden-kuyruk
  (ZKitapZipH Last-Modified → 06:20 cron → last_queued_at) · t5-sabah-damga (paket ImWin32.dll kapak sürümü = Vs).
  Kuru (`E2E_KURU=1`) yalnız t5-tetik + g-uygula'yı atlar; gece sarmalayıcısı `--indir` varsayılan (salt okuma).
- **İlk bağlı kuru koşu** (`~/.empp-agent/e2e/20260926-2048.md`): 3 GEÇTİ (K kapısı, K uygula, bozuk zip),
  28 ÖLÇÜLEMEDİ — hepsi gerçek engel: 74390 pipeline satırı yok (book-update tarafı; sürüm kuralı Nadir'de) ·
  ProBook ajanı build_agents'ta yok (kayıt sırrı) · canlı G manifesti yok (yayın yazan adım, açık karar 4) ·
  t5-tetik/g-uygula kuru.
- **Satır gelince beklenen gerçek kırmızı:** başsız kabulde (mac/android/windows) K4 güncellik katmanı yok → K4
  KALDI; pardus/mac/android iş kaydında üretilen md5 yok → cdn-md5-kiyas tam md5'i yalnız Windows'ta yapar.
- **K4 başsız kabulde (26.09, dal `kabul-k4-basliksiz`, `KABUL_K4=1`, varsayılan KAPALI):** `tools/kabul/k4-guncellik.js` — ayrı boş profil + `--remote-debugging-port` ile ilk kitaba girilir, motorun `GetKitapGuncellemeBilgi` cevabı ProBook E6/E7'nin kodu (`cdp-kitap-ac.js`) ile yakalanır; Android'de ek olarak emülatör WebView'ı (adb forward + belge-başı kaydedici). Sözlük `kabul-karar.sh` ile aynı (0 GEÇTİ · 3 GÜNCEL-DEĞİL · 4 ÖLÇÜLEMEDİ), karar.json `k4` alanı (`durum/kod/engeller/olcumler`). Runner: GÜNCEL-DEĞİL → yükleme yok + `failed` "güncel değil:" (Pardus K18 rc 3 ile aynı); ÖLÇÜLEMEDİ yalnız CDP kurulamadıysa/E8'de ertelenebilir engel, soru görülmediyse engellemez (Pardus E7 YOK kuralı). Ölçüm: Lingoland 3 DMG 72379 v12 < İmpark v19 → GÜNCEL-DEĞİL (74 sn); SM2 Set DMG 58336 v17 = v17 → GEÇTİ (67 sn); BES 74451 APK Electron'da 4 kapak v1 < İmpark v2/v3 → GÜNCEL-DEĞİL, cihaz WebView kaydedicisi 8 soruyu yakaladı ama emülatörde ağ yok ("Network is offline") → cihaz ÖLÇÜLEMEDİ (engellemez); üçünde odak korundu. karar.json `katmanlar.guncellik` (GÜNCEL-DEĞİL → RED) uçtan uca okuyucusu içindir, genel karara girmez.

**SET tüm alt kitaplar (26.09, dal `kabul-set-tum-kitaplar`, `KABUL_SET_TUM=1`, varsayılan KAPALI):** motor `GetKitapGuncellemeBilgi`'yi yalnız AÇILAN kitap için sorar; iki kapı da SET'te ilk kitaba girdiği için öteki alt kitaplar hiç ölçülmüyordu (SM2 Set: 58237 hiç sorulmadı). Yöntem: ilk kitap CDP ile (motor davranışı kanıtı, K4/E7 aynen) + TÜM alt kitaplar, aynı CDP oturumunda sayfanın Node fs'iyle okunan menülerden, İmpark'a doğrudan (kitap başına tek GET; alt kitabı tek tek açmak kitap başına 10-60 sn ve menü tasarımına bağlı olduğu için seçilmedi). Alt kitap listesi/kimlik/soru/yorum içerik merdiveni S0 çekirdeğiyle tek kaynak (`icerik-merdiven.s0Kaynaktan`). Karar: geride alt kitap → GÜNCEL-DEĞİL (rc 3, hangi kitap); ölçülemeyen alt kitap → ÖLÇÜLEMEDİ satırı, genel kararı değiştirmez (Pardus E7 politikası); ProBook `kabul-karar.sh` S kuralı (E6 RED-KUSUR kalır). Ölçüm: SM2 Set DMG — eski K4 GEÇTİ (58336 v17 = v17); set-tum book1 58336 v17 güncel, **book2 58237 v7 < İmpark v14 → GÜNCEL-DEĞİL rc 3** (50 sn, odak korundu; kanıt `kabul-kanit/settum-sm2set-mac-20260926-221309`).

## Onaylar (Nadir)
74390'ı tüm platformlarla pipeline'a ekleme + CDN yayını + G manifestleri · srv21 işçi düzeltmesi deploy (96860dd) ·
ProBook kayıt sırrı.

## Açık kararlar (Nadir, tek tek)
1. **Windows'ta açma testi (K3-K4) nerede?** Öneri: ofisteki imzalama Windows makinesinde başsız koşucu; yoksa statik K1-K2 + imza.
2. **Gece koşu saati?** Öneri: 22:00 başlat, 07:30 doğrula (cron 06:20'den sonra).
3. **Demo SET?** Öneri: 2. aşamada 74390'dan tek kitaplık demo set; index ile kitap ekle/çıkar ve 43e23 yönetimi o testte.
4. **Gece G testi her gece yeni üretim-imzalı sürüm yayınlasın mı?** Öneri: evet, yalnız 74390 (beyaz liste); sürüm 2.p.s artar,
   eski sürümler kaynak arşivi kuralıyla (son 2 + 60 gün) budanır. Araç hazır: `g-yayin` 023f9ad/ee31634, `yayinla.js e2e 74390 --onayli`.

## Yapılmayacaklar
Gerçek yayın kitaplarında test yazımı · test için imza/kabul kapısı atlamak · kırmızı testi "biliyoruz" diye açık bırakmak.

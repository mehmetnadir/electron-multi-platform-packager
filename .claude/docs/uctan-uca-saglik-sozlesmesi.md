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

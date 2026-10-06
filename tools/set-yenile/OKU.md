# set-yenile — set paketini tek komutla yenile

Araç YDS set paketlerinin Windows ve Pardus yenilemesini tek komutla yapar.
Varsayılan kip kurudur. Kuru kip yazma yapmaz. Yazma için `--uygula` ver.

## Kullanım

```bash
node tools/set-yenile/set-yenile.js <bookId...> [--platform windows,pardus] [--uygula] [--izle] \
  [--ek-atla] [--kur-atla] [--devam <durum.json>] [--ek-uret <yol>] [--kur-tavan <dk>] [--izle-tavan <sa>]
```

| Bayrak | Görev | Varsayılan |
|---|---|---|
| `--uygula` | DB, kasa ve bildirim yazmalarını açar | kapalı (kuru) |
| `--izle` | Platform satırları bitene kadar izler, sonda tek özet bildirim atar | kapalı |
| `--platform` | Yenilenecek platformlar | `windows,pardus` |
| `--ek-atla` | (1) kabuk eki adımını atlar | kapalı |
| `--kur-atla` | (2) ve (3) kaynak kur adımlarını atlar | kapalı |
| `--devam <dosya>` | Durum dosyasından sürer, biten adımları atlar | — |
| `--ek-uret <yol>` | ek-uret.js yolu (ortam: `EMPP_EK_URET`) | `<repo>/tools/set-kabuk/ek-uret.js` (dal incelemede) |
| `--kur-tavan <dk>` | Kaynak kurulumu bekleme tavanı | 120 dk |
| `--izle-tavan <sa>` | İzleme tavanı | 8 sa |

Örnek: önce kuru koşu, sonra gerçek koşu.

```bash
node tools/set-yenile/set-yenile.js 45550
node tools/set-yenile/set-yenile.js 45550 --uygula --izle
```

## Akış

```
ön kontrol → (1) kabuk eki (Mac) → (2) kur isteği (DB) → (3) HEMEN requeue (DB)
           → (4) kasa imza önceliği → (5) yeni build satırını bekle → (6) izle + özet bildirim
```

| Adım | Ne yapar | Kanıt |
|---|---|---|
| 0 ön kontrol | Kitap satırı, platform satırları, tohum kaynak, srv21/kasa/ProBook erişimi | SELECT sonuçları |
| 1 ek | `node ek-uret.js --set <id>` | `son.json` `girdiSha` + `uretildi` (adım başlangıcından sonra) |
| 2 kur | Yedek, sonra `kaynak_kur_istegi_at = NOW(3)` | t0 = DB `NOW(3)`, ROW_COUNT 1 |
| 3 requeue | Yedek, sonra platform satırını `queued` yapar | ROW_COUNT 1 |
| 4 öncelik | Kasada `imza-oncelik.txt` başına id ekler | Geri okuma bayt eşitliği |
| 5 bekle | 60 sn aralıkla okur (bilgi + ret yakalama) | `kaynak_build_surumleri`: `durum='gecerli'` ve `olusturma > t0` olan YENİ satır (sürüm + kaynak raporlanır) |
| 6 izle | 2 dk aralıkla platform satırlarını okur | completed/failed; Windows için bekçi logu |

Çok kitapta (1) ve (2) sırayla koşar. Beklemeleri tek döngü paralel izler.

**DİKKAT:** Requeue beklemeden ÖNCE gelir. Sunucu kaynak kurulumunu (r2-kur) yalnız kuyruktaki
bir platform işi kiralanınca verir (book-update `lib/ajan-claim-sql.ts` `kaynakBekleDislamasi`).
Satırlar `completed` iken kur isteği tek başına hiçbir şey başlatmaz. 06.10'da 45550 bu yüzden beklemede kaldı.

```
(2) kur isteği yazılır → (3) satırlar queued
   ├─ kasa (kaynak-kur yok): istek > geçerli build → işi ALMAZ, bekler
   └─ ProBook (kaynak-kur var): işi alır → kaynağı kurar → kaynak_build_surumleri yeni satır
                                     → kasa yeni build ile windows işini alır
```

- İstek requeue'dan önce yazılır. Bu yüzden kasanın eski kaynakla işi alma yarışı yoktur.
- `--kur-atla`: (2) ve (5) atlanır. Requeue ve öncelik yine yapılır.
- Kur isteği başarısızsa (yedek, ROW_COUNT) requeue yapılmaz. Eski kaynakla üretim açılmaz.

**DİKKAT:** Sıra önemlidir. Ek hattında kaynağı ProBook kurar.
Ek, kur isteğinden ÖNCE yayımlanmış olmalıdır.

```
(1) ek → son.json yayımlandı → (2) kur isteği → ProBook kurar → kaynak_build_surumleri yeni satır
```

- Ek yoksa ProBook kurulumu erteler. `son.json` değişince ProBook yeniden dener.
- set-yenile bu durumu (5) adımında bekleyerek karşılar. Ek ayrıca bir eylem istemez.
- ek-uret çıkış kodları: 0 tamam, 1 hata, 2 eylem yok (kaynak yok). Çıkış 2'de kitap durur.

## Kurallar

**UYARI:** Kuru kip DB'ye, kasaya ve ntfy'ye yazmaz. Durum dosyasını da yazmaz.

- Araç DB'yi yalnız `pipeline-sql` ile okur. Sorgu tek SELECT olur ve `;` içermez.
- `pipeline-sql` 0 satırda çıkış 1 verir. Araç bunu boş sonuç sayar.
- Araç her yazmadan önce `mariadb-dump` yedeği alır: `/root/yedek-deploy/<damga>-set-yenile/`.
- Yedekte "Dump completed" ve en az 1 INSERT yoksa araç yazmaz. Kitap durur.
- Araç book_id'yi yalnız rakam olarak kabul eder. Platform izinli listeden gelir.
- Araç `running` satırı kuyruğa almaz. UPDATE de `status <> 'running'` koşulu taşır.
- Araç DB saatlerini yalnız DB saatleriyle kıyaslar. Mac saatini kullanmaz.
- Araç başarıyı `kaynak_build_surumleri` yeni satırından ölçer. `kaynak_kurulum_bitis` ve
  `kaynak_kurulum_surum` canlıda dolmaz (06.10 ölçümü: 0 satır). Araç bu alanları yalnız bilgi olarak gösterir.
- Başlangıç dolu ve bitiş boşsa araç uyarı basar: "kurulum kilidi açık, ajan: …, başlangıç: …".
  Açık kilit kitabı bekletmez. Yeni geçerli satır gelirse adım başarılıdır.
- Ret gelirse (`kaynak_kur_ret_at > t0`) o kitap durur ve bildirim gider. Diğer kitaplar sürer.
  Ret istek zamanını silmez (`kurRetYaz` yalnız ret alanlarını yazar). Geçerli build varsa
  kuyruktaki satırlar ASILI kalır: kasa bekler (istek > geçerli build), ProBook bekler (ret > istek).
  Eski kaynakla üretim olmaz. Karar insanın: kapı nedenini düzelt ve yeni kur isteği at, ya da
  satırları requeue yedeğinden geri al.
- Tavan dolarsa araç eylem yapmaz. Kitap durur ve bildirim gider.
- `kaynak_modu = manuel` ise (1)-(3) atlanır.
- Tohum kaynak yoksa kitap durur. Tohum = `kaynak_build_surumleri` geçerli satırı ya da
  `~/.empp-agent/kaynak-arsivi/<id>/kaynak.json`.
- srv21 birincil rota bağlanamazsa araç ProBook atlamalı yedek rotayı kullanır:
  `-J etapadmin@100.73.161.76 -p 2222 root@10.0.0.21`. Yalnız bağlantı hatası yedeğe geçirir.
- Kasada araç `.ps1` yazar, `scp` ile `C:\empp-ajan\` altına koyar, `powershell -File` ile çalıştırır.
- Öncelik dosyası: `C:\Users\Administrator\.empp-agent\imza-oncelik.txt`
  (= `C:\empp-ajan\ev\imza-oncelik.txt`, bağlantı). Biçim: satır başına bir id, `#` yorum, CRLF.
- Araç öncelik dosyasını değiştirmeden önce `.once-<damga>` yedeği alır.
  Dosya okuma ile yazma arasında değiştiyse araç yeniden okur.
- Windows "completed" üretildi demektir. Yayın imza bekçisinden sonra olur.
  Araç yayını `C:\empp-ajan\log\imza-bekcisi.log` içindeki `<id>-<sürüm> → yayinlandi` satırından okur.
- Paket bildirimlerini bileşenler atar. Araç yalnız durma bildirimi ve sonda tek özet atar.

## Durum dosyası

Yol: `~/.empp-agent/set-yenile/<YYYYMMDD-HHMMSS>.json`. Dosya kitap başına adım, zaman ve kanıt tutar.

```bash
node tools/set-yenile/set-yenile.js --devam ~/.empp-agent/set-yenile/20261006-090000.json --uygula
```

- `--devam` biten adımları (`tamam`, `atlandi`) atlar.
- Duran kitabın durma kaydını temizler. Araç hatalı adımı yeniden dener.
- t0 dosyada kalır. Araç kur isteğini yeniden atmaz.

## Ortam değişkenleri

| Değişken | Görev |
|---|---|
| `EMPP_SRV21_SSH` | srv21 ssh argümanları (boşlukla ayrılır) |
| `EMPP_SRV21_SSH_YEDEK` | srv21 yedek rota argümanları |
| `EMPP_KASA_SSH` | Kasa hedefi |
| `EMPP_PROBOOK_SSH` | ProBook hedefi |
| `EMPP_KASA_ONCELIK` | Kasadaki öncelik dosyası |
| `EMPP_EK_URET` | ek-uret.js yolu |
| `EMPP_KAYNAK_ARSIVI` | Mac kaynak arşivi kökü |
| `EMPP_BILDIR` | `bildir` komutu yolu |

## Test

```bash
node --test tools/set-yenile/set-yenile.test.js
```

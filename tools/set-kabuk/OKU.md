# tools/set-kabuk — sf425 kabuk araçları

| Dosya | Görev |
|---|---|
| `kur-webz-kabuk-uret.sh` | Swift ikilisini (`webz-kabuk-uret`) `~/.empp-agent/araclar/` altına kurar. |
| `ek-uret.js` | Mac kabuk eki üretici (Parça C). ProBook için `kabuk-ek/<id>/…` dosyalarını üretir. |
| `ek-uret.test.js` | Sahte rclone/ssh/kabukTazele ile akış testleri. |
| `tr.yds.kabuk-ek.plist` | launchd işi: 15 dk'da bir `ek-uret.js --bekleyen`. |

Tasarım: `~/.empp-agent/arastirma/set-kabuk-0510/kabuk-eki-tasarim.md` (§1, §2, §4, §5 C).

## ek-uret.js

```
node tools/set-kabuk/ek-uret.js --set 45550[,45485…] [--kuru] [--cikti <dizin>]
node tools/set-kabuk/ek-uret.js --bekleyen [--kuru] [--cikti <dizin>]
node tools/set-kabuk/ek-uret.js --anahtar-uret
```

Akış (set başına):

```
araç denetimi (Swift ikilisi, zip, rclone) + imza anahtarı (kuru değilse ZORUNLU)
  → srv21 DB (tek SELECT; ssh hedefi EMPP_SRV21_SSH, varsayılan "-p 2222 root@100.117.187.26")
  → taban: kaynak arşivi (~/.empp-agent/kaynak-arsivi/<id>, r2Surum + sha256 aynı)
           | ~/.empp-agent/kabuk-ek-onbellek/<id>/taban.zip (+ taban.json: sürüm, sha256)
           | rclone copyto ydsr2:ydsdigital/kaynak/<id>/<sürüm>/build.zip (sha256 + boyut doğrulanır)
  → merdiven (EMPP_ARSIV_MERDIVEN=1) + set eki (EMPP_SET_UYELIK_EK=1) — runner kaynakAdim
  → kabukTazele({kabukKaynagi:'ikili', ekCikti}) — Swift ikilisi + mevcut kapı
  → manifestKur + ekPaketle → tavan → ed25519 imza (ekImzala)
  → yükleme: <girdiSha>.zip → <girdiSha>.imza → son.json   (ydsr2:ydsdigital/kabuk-ek/<id>/)
```

| Durum | Sonuç |
|---|---|
| `--kuru` | R2'ye hiçbir şey yazılmaz. Bildirim gönderilmez (loga düşer). Taban indirmesi (okuma) yapılabilir. Anahtar varsa ek imzalanır. |
| Özel anahtar yok (kuru değil) | Hiçbir set işlenmez, yükleme yok. Çıkış 1, `bildir`. |
| Araç eksik | Taban indirilmez. Çıkış 1. |
| Tavan aşıldı | Yükleme yok. Log + `bildir kosucu`. Kesin sonuç. |
| ProBook tabanı üreteçle kurar | Ek üretilmez (`atlandi: üreteç tabanı`), `bildir`. Kesin sonuç. Ayrıntı aşağıda. |
| R2'de aynı girdiSha + Web-Z sha için doğrulanmış ek var | Yükleme yok (`mevcut`). Kesin sonuç. |
| Kapı RED, eşleme, kapak 404 ya da küçük gövde | Ek yok. girdiSha varsa `<girdiSha>.ret.json` yazılır. `bildir`. |
| Kapak HTTP 5xx, ağ, Web-Z hatası | Geçici. Geri çekilme: 15 dk → 30 → 60 → 120 …, tavan 6 sa. |
| Bir yükleme düştü | Sonrakiler YÜKLENMEZ (ek düşerse imza ve son.json da). Çıkış 1, `bildir`. |
| `duraklat.istek` var | Hiç çalışmaz (çıkış 0). |
| Kilit dolu (canlı pid) | Çıkış 0, iş yapılmaz. |

### Çıkış kodu

| Kod | Anlam |
|---|---|
| 0 | Tamam. İşlenen setlerde hata yok. Ya da iş yok (`--bekleyen` 0 satır), kilit dolu, duraklatıldı. |
| 1 | Hata. En az bir set hata verdi, DB/ssh hatası, araç ya da imza anahtarı yok, kullanım hatası. |
| 2 | Eylem yok. `--set` ile istenen setlerin hiçbirinde geçerli kaynak build'i yok. |

- srv21 `pipeline-sql` sıfır satırda çıkış 1 verir, stdout ve stderr boş kalır. `ek-uret.js` bunu
  "0 satır" sayar, hata saymaz. Gerçek ssh hatası (255, stderr dolu) yine hatadır.
- `--set` ile istenen bir sette geçerli build yoksa (`kaynak_build_surumleri`) uyarı + `bildir`.
  Diğer setler işlenir.
- Çıkış kodunu boruyla (`| tail`) çağırırken kaybetme: `set -o pipefail` ya da `${PIPESTATUS[0]}`.

- Yalnız `ydsdigital` bucket'ındaki (YDS) build'ler işlenir. ProBook eki `cdn.ydspublishing.com`
  adresinden okur.
- `--bekleyen` koşulu `kaynakRoluKarar` 'kur' koşuludur: istek > geçerli build oluşturma, mod manuel
  değil, son ret istekten eski.
- `~/.empp-agent/kabuk-ek-durum.json` set başına bir kayıt tutar: istek, taban sürümü, Web-Z
  settings sha'sı, kesin mi, hata sayısı, son deneme.
  - Kesin kayıt (yüklendi, tavan, yazılmış ret, uygun değil): `--bekleyen` her turda yalnız
    `settings.json`'u çeker. Sha değiştiyse seti yeniden üretir.
  - Ret işareti yazılamadıysa (girdiSha yok ya da yükleme düştü) kayıt kesin SAYILMAZ.
  - `--set` kayıtlara bakmadan her zaman üretir.
- **Tavan:** A modülünün `tavanAl()` değeri (`EMPP_KABUK_EK_TAVAN`, varsayılan 2 MiB). **DİKKAT:**
  değer Mac ve ProBook'ta EŞİT olmalı. Mac'te büyük tavanla üretilen ek ProBook'ta reddedilir.

## Üreteç tabanı (girdiSha eşliği)

ProBook r2-kur, geçerli R2 build'ini iki durumda taban almaz, build'i üreteçle yeniden kurar
(runner `r2KurTabanHazirla` + "TABAN KAPSAMA"):

1. Taban üreteç build'idir ya da kökte Electron girişi yoktur (`uretec-kaynak.tabanUretecMi`).
2. Set ekinden sonra listedeki bir kitap build'de yoktur (`tabanKitapEksik`). İçeriği kökte duran
   kitap eksik sayılmaz (`panel-menu-hizala.kokIcerikVarMi`).

Bu durumda Mac'in geçerli build'den ürettiği ekin girdiSha'sı ProBook'unkiyle tutmaz. ProBook her
seferinde "ek yok" ile erteler. `ek-uret.js` aynı modül işlevleriyle aynı kararı verir. Karar
olumluysa seti atlar ve `bildir` gönderir. `EMPP_INDEX_URETECI=0` iken karar uygulanmaz.

**DİKKAT:** A1 seti 45485 (geçerli build 2.51.5) üreteç build'idir (06.10 ölçümü). Bu set şu an ek
alamaz. Mac'te üreteç yolu açılırsa (ayrı karar) bu sınırlama kalkar.

## Evde taban indirme (karar 06.10)

- Evde taban indirmesi SERBESTTİR. Ek hattının amacı Mac evdeyken de ek üretmektir.
- Nadir'in ev kuralı büyük YÜKLEMEYİ kapsar (dmg, apk, noter). İndirme bu kuralın dışındadır.
- Taban 1-3 GB'dir. Önce Mac arşivi ve önbellek denenir. İndirme yalnız ikisi de tutmazsa olur.
- SONUÇ satırı ölçüm taşır: `taban=<sürüm>/<arsiv|onbellek|R2>`, `indirilenBayt=<bayt>`,
  `onbellekBayt=<kabuk-ek-onbellek toplamı>`.

## CDN önbellek notu (`?t=`)

- ProBook `son.json` ve ret işaretini `?t=<ms>` önbellek kırıcıyla okur.
- Kırıcı yalnız sorgu dizgisi Cloudflare önbellek anahtarına giriyorsa işe yarar. Bir kenar kuralı
  sorguyu yok sayarsa bayat `son.json` gelir.
- **DİKKAT:** bunu kenardan ölç (ev ya da ofis bağlantısı), srv21'den ölçme. srv21 kenar kuralını
  farklı görür.

## Disk (silme yok)

| Dizin | İçerik | Büyüme |
|---|---|---|
| `~/.empp-agent/kabuk-ek-calisma/<id>/` | `build.zip`, `ek.zip`, `ek.imza`, `son.json`, `ret.json` | Her koşu üzerine yazar |
| `~/.empp-agent/kabuk-ek-onbellek/<id>/` | `taban.zip` + `taban.json` | Set başına 1 taban; yeni sürüm rename ile üzerine gelir |

- `build.zip` taban dosyasının APFS klonudur. Klon her zaman yeni bir ada (`build.zip.yeni`) yapılır,
  sonra rename ile üzerine gelir.
- Yeni taban indirilirken eski taban yerinde kalır: set başına en çok 2 taban boyutu yer kaplar.
- Kilit bırakılırken `os.tmpdir()` altına taşınır.
- `ek-uret.js` hiçbir dosya silmez. Çağrılan mevcut adımlar (`set-kabuk-tazele`,
  `icerik-merdiven`, `set-uyelik-ek`) kendi sahne/aday dosyalarını çalışma dizininde kaldırır.

## İmza anahtarı

1. Mac'te anahtar çiftini üret: `node tools/set-kabuk/ek-uret.js --anahtar-uret`.
   - Özel anahtar: `~/.empp-agent/kabuk-ek-imza/ozel.pem` (izin 600). Var olan anahtar EZİLMEZ.
   - Açık anahtar: `~/.empp-agent/kabuk-ek-imza/acik.pem`. Çıktı yalnız parmak izini basar.
2. Açık anahtarı ProBook'a kopyala: hedef `~/.empp-agent/kabuk-ek-acik.pem`.
   Örnek: `scp ~/.empp-agent/kabuk-ek-imza/acik.pem <probook>:~/.empp-agent/kabuk-ek-acik.pem`.
3. ProBook'ta parmak izini denetle. Mac çıktısındaki `sha256:…` ile aynı olmalı.

**UYARI:** `ozel.pem` dosyasını hiçbir yere kopyalama, loglama ya da commit etme.

## Kurulum (elle, Nadir onayıyla)

**UYARI:** Önce `--kuru` provasını 3 sette koştur (tasarım §5 geçiş planı adım 1). Gerçek kip R2'ye
yazar.

1. Ana çalışma ağacında dalın birleştiğini doğrula:
   `git -C ~/01dev/electron-multi-platform-packager log --oneline -3`.
2. İmza anahtarını üret ve açık anahtarı ProBook'a kopyala (yukarıdaki bölüm).
3. İşi kopyala:
   `cp tools/set-kabuk/tr.yds.kabuk-ek.plist ~/Library/LaunchAgents/`.
4. İşi yükle:
   `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/tr.yds.kabuk-ek.plist`.
5. Bir kez elle tetikle: `launchctl kickstart gui/$(id -u)/tr.yds.kabuk-ek`.
6. Logu izle: `tail -f ~/.empp-agent/log/kabuk-ek.log`.

Geri alma: `launchctl bootout gui/$(id -u)/tr.yds.kabuk-ek`.

## Testler

```
node --test tools/set-kabuk/ek-uret.test.js
```

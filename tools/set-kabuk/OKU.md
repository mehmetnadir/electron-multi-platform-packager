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
```

Akış (set başına):

```
srv21 DB (tek SELECT, ssh -p 2222 root@100.117.187.26 pipeline-sql)
  → taban: kaynak arşivi (~/.empp-agent/kaynak-arsivi/<id>, r2Surum + sha256 aynı)
           | kabuk-ek önbelleği (~/.empp-agent/kabuk-ek-onbellek/<id>/<sürüm>.zip)
           | rclone copyto ydsr2:ydsdigital/kaynak/<id>/<sürüm>/build.zip (sha256 + boyut doğrulanır)
  → merdiven (EMPP_ARSIV_MERDIVEN=1) + set eki (EMPP_SET_UYELIK_EK=1) — runner kaynakAdim
  → kabukTazele({kabukKaynagi:'ikili', ekCikti}) — Swift ikilisi + mevcut kapı
  → manifestKur + ekPaketle → tavan (EK_TAVAN_BAYT) denetimi
  → rclone copyto ek      → ydsr2:ydsdigital/kabuk-ek/<id>/<girdiSha>.zip
  → SONRA son.json        → ydsr2:ydsdigital/kabuk-ek/<id>/son.json
```

| Durum | Sonuç |
|---|---|
| `--kuru` | R2'ye hiçbir şey yazılmaz. Taban indirmesi (okuma) yapılabilir. |
| Tavan aşıldı | Yükleme yok. Log + `bildir kosucu`. |
| Kapı RED, eşleme, kapak (kalıcı) | Ek yok. girdiSha biliniyorsa `<girdiSha>.ret.json` yazılır. `bildir`. |
| Ağ / Web-Z hatası (geçici) | Ek yok. Sonraki turda yeniden denenir. |
| Ek yüklenemedi | `son.json` YÜKLENMEZ. Çıkış 1, `bildir`. |
| `duraklat.istek` var | Hiç çalışmaz (çıkış 0). |
| Kilit dolu (canlı pid) | Çıkış 0, iş yapılmaz. |

- Yalnız `ydsdigital` bucket'ındaki (YDS) build'ler işlenir. ProBook eki `cdn.ydspublishing.com`
  adresinden okur.
- `--bekleyen` koşulu `kaynakRoluKarar` 'kur' koşuludur: istek > geçerli build oluşturma, mod manuel
  değil, son ret istekten eski.
- `~/.empp-agent/kabuk-ek-durum.json`: kesin sonuç (yüklendi, tavan, ret, uygun değil) aynı
  istek + taban sürümü için kaydedilir. `--bekleyen` bu seti yeniden üretmez. `--set` her zaman üretir.
- Kilit: `~/.empp-agent/kabuk-ek.kilit/pid`. Bırakılınca dizin `os.tmpdir()` altına taşınır.
- Geçici dizinler `os.tmpdir()/kabuk-ek-<id>-*` altındadır ve silinmez (OS temizler).
- **DİKKAT:** `kabuk-ek-onbellek/<id>/` eski sürüm zip'lerini kendisi silmez. Disk dolarsa elle
  temizle.

## Kurulum (elle, Nadir onayıyla)

**UYARI:** Önce `--kuru` provasını 3 sette koştur (tasarım §5 geçiş planı adım 1). Gerçek kip R2'ye
yazar.

1. Ana çalışma ağacında dalın birleştiğini doğrula:
   `git -C ~/01dev/electron-multi-platform-packager log --oneline -3`.
2. İşi kopyala:
   `cp tools/set-kabuk/tr.yds.kabuk-ek.plist ~/Library/LaunchAgents/`.
3. İşi yükle:
   `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/tr.yds.kabuk-ek.plist`.
4. Bir kez elle tetikle: `launchctl kickstart gui/$(id -u)/tr.yds.kabuk-ek`.
5. Logu izle: `tail -f ~/.empp-agent/log/kabuk-ek.log`.

Geri alma: `launchctl bootout gui/$(id -u)/tr.yds.kabuk-ek`.

## Testler

```
node --test tools/set-kabuk/ek-uret.test.js
```

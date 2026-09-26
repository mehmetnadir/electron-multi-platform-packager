# Karantina: eski G güncelleme üreticisi (2026-09-26)

**Kalıcı silme adayı:** 2026-11-25 (60 gün). Karar Nadir'in. Geri alma: `git revert <bu commit>`.
Revert, `src/platforms/olu-yol-kapisi.js` `KARANTINA` listesini ve D-2 sentinel'ini de geri alır.

## Ne

| Eski yol | Mezardaki yol |
|---|---|
| `src/packaging/guncelleme-paketi.js` | `src/packaging/guncelleme-paketi.js` |
| `src/packaging/guncelleme-paketi.test.js` | `src/packaging/guncelleme-paketi.test.js` |
| `scripts/guncelleme-manifesti-uret.js` | `scripts/guncelleme-manifesti-uret.js` |
| `scripts/guncelleme-manifesti-uret.test.js` | `scripts/guncelleme-manifesti-uret.test.js` |

Paketleyici Windows SET işinde `workingPath`ten `temp/<job>/windows/guncelleme/set/<id>/`
(surum.json, manifest.json, dosya/…) üretiyor, bunu `guncelleme.tar.gz` yapıyordu. `app.js`
`GET /api/download/:jobId/guncelleme` tar'ı servis ediyordu. Runner eskiden bu tar'ı indirip R2
`guncelleme/set/<id>/` önekine yüklüyordu.

Mezardaki dosyalar buradan ÇALIŞMAZ. `set-kabuk`, `kitap-guncelleyici` ve `guncelleyici-enjekte`
modüllerini göreli yolla istiyorlar, bu modüller de mezarda yok. Bu bilinçli: karantina bir arşiv.

## Neden ölü (D-2, Nadir onayı 2026-09-26)

1. **Tüketici yok.** Runner G set tar'ını hiçbir yere yüklemiyor (d825123). Tar indirme, presign,
   PUT ve surum.json doğrulaması kaldırıldı. `runner-windows.test.js` testi
   "runner G set yükleme yolu kaldırıldı (tek yazar g-yayin)" bunu çiviler. G manifestlerinin tek
   yazarı `tools/g-yayin/yayinla.js` (Anahtar Zinciri imzası).
2. **İstemci reddeder.** Bu üreticinin manifesti `kanal:"G"` taşımıyor. G istemcisi
   (`src/runtime/kitap-guncelleyici.js:440`, `src/platforms/android/empp-g-istemci.js:154`) onu
   `manifest-reddedildi:kanal-g-degil` ile reddeder (e07bc37+). Bunun testi 3a10a29'da RED
   beklentisine çevrilmişti.
3. **Zararlıydı.** `g-yayin-r2-yol-tasarimi.md` §Kurallar: bu tar `guncelleme/` önekine yüklenirse
   G durumunu siler ve sürüm sıralanamaz hâle gelir.

## Canlı çağrı vardı, kaldırıldı (davranış değişikliği, bilinçli)

`src/packaging/packagingService.js:35` `require('./guncelleme-paketi')`. `startPackaging` içinde
`guncellemePaketi.acikMi(process.env, platforms) && setGuncellemeKimligi` iken `paketeUret`
çağrılıyordu, sonuç `results.guncellemePaketi`ye yazılıyordu. Kaldırılanlar:

- `require` satırı;
- `paketeUret` çağrısı (31 satırlık blok, yerine 5 satırlık açıklama);
- `results.guncellemePaketi` ataması;
- yalnız bu bloğun okuduğu `setGuncellemeKimligi` değişkeni.

Kaldırmanın yan etkisi yok. Üretici paket ağacına YAZMAZ: `ciktiyaYaz` yalnız `--cikti`
dizinine yazar ve `workingPath`i yalnız okur. Windows exe araması `.exe` uzantısına bakıyor,
`guncelleme/` dizininin olup olmamasına değil. `setKimligi.paketeYaz` ve `guncelleyiciEnjekte`
(G istemcisi pakete girer) aynen duruyor.

## Etki analizi (komut → sonuç)

```
grep -rn -E "guncelleme-paketi|guncelleme-manifesti-uret|guncellemePaketi|guncelleme_paketi" \
  src scripts tools tests .claude/docs package.json      (node_modules, _graveyard hariç)
```
- Doğrudan require: yalnız `packagingService.js:35` (canlı), `guncelleme-paketi.js:33` → üretici
  ve iki test dosyası.
- `results.guncellemePaketi` okuyucuları: `app.js:921` indirme rotası. Rotayı çağıran yok:
  runner d825123'te kaldırıldı ve sentinel `api/download/${jobId}/guncelleme` yasaklıyor.
  `runner-windows.test.js:191/195` yalnız sahte sunucu fikstürü.
- Dinamik/dize referansı: `windows-sozlesme-baglanti.test.js:43` (paketeUret regex'i) ve `:121`
  (acikMi kapsam döngüsü). İkisi de güncellendi.
- `package.json`: script yok. `build.files` = `src/**/*`, yani modül packager'ın kendi ikilisine
  kör kopyalanıyordu. Artık kopyalanmıyor.
- `~/.claude/skills` (md/sh/js/py/mjs): 0 isabet. Canlı ajan `run-agent.sh` ile
  `node src/agent/runner.js` çalıştırıyor (d825123 dahil, tar'a dokunmuyor).
- `~/.empp-agent` (cache hariç, derinlik 3), tek kod okuyucusu:
  `yds-win-20260926/uret.js:247-266`. Bu depo dışı, tek seferlik YDS Windows parti betiği.
  `results.guncellemePaketi` varsa tar'ı `/api/download/<job>/guncelleme`den indirip durum dosyasına
  yazıyor, yoksa `else` dalında "UYARI güncelleme paketi YOK" + `{yok:true}` yazıp DEVAM ediyor.
  İşlevsel tüketici değil:
  (a) dizinde Şef `DUR` kararı var ("45549'dan sonra yeni Windows derlemesi YOK");
  (b) tar'ı yükleyen "adım 5" yok (`hazir-yukle.py` tar'a dokunmuyor);
  (c) o adımın amacı olan R2 `guncelleme/set/<id>/` yüklemesi D-2 ile yasak.
  `imza-dogrula.py:126/137` raporu tar boyutunu `None` basar. `:137`deki "yayında R2'ye
  `guncelleme/set/<id>/` altına çıkacak" cümlesi D-2 ile çelişen bayat bir talimat.
  `yedek-ana-agac-20260926/` ağaç yedeği, `arastirma/*.md` notlar: tüketici değil.
- `~/01dev/book-update` git grep: yalnız `.claude/docs/guncellik-bekci-sozlesmesi.md:122`. Bayat
  belge satırı ("G manifest üretimi + runner yüklemesi | var"), kod değil.
- `guncellemeImzaAnahtariYolu` / `EMPP_GUNCELLEME_IMZA_ANAHTARI`: taşımadan sonra src, scripts,
  tools ve run-agent.sh içinde 0 referans var (yalnız bu modül okuyordu).
- Belgeler: `kitap-guncelleme-sozlesmesi.md`, `g-yayin-r2-yol-tasarimi.md` ve
  `windows-paketleme-sozlesmesi.md` karantina notuyla güncellendi.

`git log --format='%h %s' -- <dosyalar>`:
- b40e597 (22.09) feat(windows): … — üretici + CLI
- ded619e (26.09) feat(windows): sözleşme uygulaması … ed25519 … — guncelleme-paketi + imza
- 3a10a29 (26.09) test(g-kanal): eski sunucu üreticisinin manifesti G istemcisinde RED (D-2)

Hiçbirinde `Rationale:` / `[STATE:` / `[MAINTENANCE:` yok.

## Kilit (geri gelirse kırılır)

- `src/packaging/windows-sozlesme-baglanti.test.js` "D-2 SENTINEL". packagingService'te
  `require('…guncelleme-paketi')`, `guncelleme-manifesti-uret`, `guncellemePaketi.paketeUret` ya
  da `results.guncellemePaketi =` görülürse, ya da dosya eski yerine dönerse kırılır.
- `src/platforms/olu-yol-kapisi.js` `KARANTINA` + `karantinaIhlalleri()`, testler 10 ve 11.
  `src/`, `scripts/` ya da `tools/` altındaki herhangi bir dosya bu yolları göreli require ederse
  ya da yol eski yerinde yeniden var olursa kırılır.
- Mutasyon kanıtı: aynı dedektör `git archive fd62a4d` ağacında 7 ihlal verdi. Bunların 2'si
  "geri-geldi", 5'i "require" (packagingService dahil). İki sentinel regex'i de eski
  packagingService'te ateşledi.

## Açık bırakılan (kapsam dışı, Şef kararı)

- `app.js` `GET /api/download/:jobId/guncelleme` rotası artık hep 404 `guncelleme-paketi-yok`
  döner. Ölü uç; en küçük değişiklik için bırakıldı. `app.test.js` hâlâ çiviliyor.
- `runner-windows.test.js:191/195` sahte sunucudaki `guncellemePaketi` / `/guncelleme` fikstürü
  bayat ama zararsız.
- Depo dışı bayat metinler: `~/.empp-agent/yds-win-20260926/imza-dogrula.py:137` (tar'ın R2'ye
  çıkacağını söylüyor, D-2 ile çelişir) ve `book-update/.claude/docs/guncellik-bekci-sozlesmesi.md:122`.

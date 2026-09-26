# Karantina: ölü uç `GET /api/download/:jobId/guncelleme` (2026-09-26)

**Kalıcı silme adayı:** 2026-11-25 (60 gün). Karar Nadir'in. Geri alma: `git revert <bu commit>`.

## Ne

`src/server/app.js:907-935` — set güncelleme paketini (`guncelleme.tar.gz`) indiren literal
rota. Fragman aynen `app.js.route-fragment.txt`'te. Çalıştırılabilir DEĞİL (üretici modül
`app`, `packagingJobs`, `fs`, `buildContentDisposition` bağlamına ihtiyaç duyar).

## Neden ölü (kanıt, bu oturumda tekrar ölçüldü)

1. **Üretici zaten kaldırılmış.** Aynı gün (2026-09-26, `olu-kod-g-eski` işi, commit'ler
   b40e597/ded619e/3a10a29 zincirinin devamı) `packagingService.js`'ten `require('./guncelleme-paketi')`
   ve `paketeUret` çağrısı kaldırıldı; `job.results.guncellemePaketi` artık HİÇBİR yerde
   set edilmiyor. Kanıt: `/usr/bin/git grep -n "guncellemePaketi"` — canlı `src/` kodunda tek
   isabet bu rotanın OKUYUCUSU (`app.js:921`), YAZICI yok. `_graveyard/2026-09-26-g-eski-uretici/`
   zaten bu zinciri belgeliyor.
2. **Doğrudan çağıran yok.** `git grep -n "download.*guncelleme|guncelleme.*download"` — repo
   genelinde (node_modules/dist/build/temp/uploads hariç) yalnız: bu rotanın tanımı (app.js:912),
   test dosyaları (app.test.js, runner-windows.test.js — sahte fikstür), ve dokümantasyon/graveyard
   notları. `~/01dev/_worktrees/bu-birlesik-20260926` (book-update) içinde `guncelleme`+`download`
   kombinasyonuna 0 isabet.
3. **7 günlük canlı log'da 0 istek.** `~/.empp-agent/agent.log` (6.6 MB, son ~7 gün) içinde
   `guncellemePaketi|/guncelleme'|/guncelleme"|guncelleme-paketi-yok|GET /api/download` desenine
   0 satır. `packager.log` boyutu 692 B — anlamlı istek yok.
4. **Ekleniş gerekçesi bugüne ait, kalıcı değil.** `git log -S"'/api/download/:jobId/guncelleme'"`
   → tek commit `ded619e` (2026-09-26, "Windows sözleşme uygulaması"). Rota o gün eklendi, aynı
   gün üreticisi kaldırıldı — hiçbir sürümde gerçek trafik almadı. Kodda `Rationale:` / `[STATE:` /
   `[MAINTENANCE:` işareti yok.

## Davranış değişikliği (bilinçli, en küçük etki)

Rota tamamen kaldırıldığı için `/api/download/<jobId>/guncelleme` isteği artık literal rotaya
değil, ondan sonra tanımlı `/api/download/:jobId/:platform` joker rotasına düşer (`platform` =
`'guncelleme'`). O rota `job.results['guncelleme']` anahtarını hiçbir zaman bulamayacağı için
(bu anahtar hiç yazılmıyor) yine `404 {error:'Bu platform için paket bulunamadı'}` döner —
mesaj metni değişti (`guncelleme-paketi-yok` → `Bu platform için paket bulunamadı`), durum kodu
(404) ve dış davranış (indirilemez) AYNI. `buildContentDisposition` başka üç yerde
(app.js:966, 1029 ve kalan indirme rotası) kullanıldığı için dokunulmadı, yalnızca bu rotadan
çağrısı kayboldu.

## Etki analizi (komut → sonuç)

```
/usr/bin/git grep -n "guncellemePaketi|/api/download.*guncelleme" -- .
```
- `src/server/app.js:912` — kaldırılan rota (bu karantina).
- `src/server/app.test.js:50,51,59,60,63` — kaldırılan rotanın sentinel testleri (bu karantina
  ile birlikte tek bir "ölü uç kaldırıldı" testine indirgendi).
- `src/agent/runner-windows.test.js:191,195` — sahte sunucu fikstürü (runner'ın BU ucu
  ÇAĞIRMADIĞINI kanıtlayan test, `:462` — sentinel zaten `api/download/${jobId}/guncelleme`
  desenini runner kaynağında YASAKLIYOR). Fikstür bayat ama zararsız, dokunulmadı (kapsam dışı,
  runner testi bu görevin parçası değil).
- `src/packaging/windows-sozlesme-baglanti.test.js:52` — `guncellemePaketi.paketeUret` /
  `results.guncellemePaketi =` desenini YASAKLAYAN D-2 sentinel'i; bu karantina onunla çelişmiyor
  (biz okuyucuyu kaldırdık, o zaten yazıcının geri gelmediğini kilitliyor).
- `.claude/docs/kitap-guncelleme-sozlesmesi.md:194` — bu ucu "TASARIM" olarak anan belge satırı;
  bayat, kapsam dışı bırakıldı (kod değil, ayrı bir belge güncelleme işi).
- book-update deposu (`~/01dev/_worktrees/bu-birlesik-20260926`): 0 isabet.
- `~/.empp-agent/agent.log`, `packager.log`, `runner.log`: 0 istek deseni (yukarı bkz).

`git log -p -S"'/api/download/:jobId/guncelleme'"`: tek commit `ded619e` (2026-09-26).

## Kilit (geri gelirse kırılır)

- `src/server/app.test.js` yeni testi: SRC'de `app.get('/api/download/:jobId/guncelleme'` deseni
  ARANIRSA -1 dönmeli; bulunursa test FAIL (rota geri gelmiş demektir).

## Açık bırakılan (kapsam dışı)

- `runner-windows.test.js:191,195` sahte fikstürü — runner'ın kendi testine ait, bu görev yalnız
  `app.js`'in ölü ucunu kapsıyor.
- `.claude/docs/kitap-guncelleme-sozlesmesi.md:194` — belge güncellemesi ayrı iş.

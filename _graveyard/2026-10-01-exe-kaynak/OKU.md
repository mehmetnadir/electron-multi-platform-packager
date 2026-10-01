# Karantina: exe kaynak hattının ölü kodu (2026-10-01)

**Kalıcı silme adayı:** 2026-11-30 (60 gün). Karar Nadir'in. Geri alma: `git revert <bu commit>` +
`src/platforms/olu-yol-kapisi.js` `KARANTINA` listesinden ilgili girdileri çıkarmak (yoksa kapı
"geri-geldi" der — bilerek).

## Bağlam

Exe'siz kaynak sözleşmesi (Nadir 01.10, commit b8d6bfa/6c29f3f): runner İmpark SFX exe'sini hiçbir
koşulda indirmez/açmaz; kaynak = arşiv (`kaynak-arsivi`) ya da elle yüklenmiş build.zip
(`manuelZipIndir`). O gün exe girdili araçlar "kapıyla KAPALI, modül silinmedi" bırakıldı
(`.claude/docs/changelog.md:15`). Bu karantina o modülleri ve çağıransız kalan runner
fonksiyonlarını fiilen mezara taşır.

## A) Taşınan dosyalar (`git mv`, `src/agent/` yerleşimi korunarak)

| Dosya | Neden ölü (kanıt) |
|---|---|
| `src/agent/kaynak-isitici.js` | Exe ön-ısıtıcı. `EXE_KAYNAGI_KAPALI` kapısıyla etkisiz. Repo genelinde yalnız kendi testi ve `isitici-dongu.js` anıyor (aşağıdaki grep). `runner.js` require etmez. |
| `src/agent/isitici-dongu.js` | Ayrı süreç döngüsü; `birTur` peek bile yapmadan `{durum:'kapali'}` döner. Başlatan yok: `launchd/com.empp.agent.plist`, `~/Library/LaunchAgents/com.empp.*`, `~/.empp-agent/*.sh`, `~/.empp-agent/araclar/`, crontab, `package.json` scriptleri içinde `isitici` GEÇMİYOR; çalışan süreç yok (`ps`). |
| `src/agent/local-build.js` | Exe girdili yerel Mac derlemesi. `require.main === module` ise ilk iş `exit(3)` (KAPALI), geri kalan gövde erişilemez. Repo içinde çağıran yok (yalnız test + yorum). Yerelde üretim artık `paket-uret` skill'i. |
| `src/agent/kaynak-isitici.test.js` | Yukarıdaki modülü sınar; modül yoksa anlamsız. Koruduğu şey: ısıtıcının indir→aç→zip akışı ve kapı. |
| `src/agent/isitici-dongu.test.js` | Döngünün "kapalı" davranışı + `local-build.js --exe` verilse de çıkış 3 testi. Kapıyı koruyan asıl bekçi artık `olu-yol-kapisi` test 12. |

### Kanıt grep'leri (worktree `emp-olu-exe`, 33636c2 üstü, node_modules/.git hariç)

```
$ grep -rnI "kaynak-isitici\|isitici-dongu" . | grep -v "^./src/agent/\(kaynak-isitici\|isitici-dongu\)"
./.claude/docs/changelog.md:15:  `kaynak-isitici.js`/`isitici-dongu.js`/`local-build.js` kapıyla KAPALI (modüller silinmedi).
./src/agent/runner.js:2546:  // downloadFile/zipDir: kaynak ön-ısıtıcısı (kaynak-isitici.js) için dışa açılmıştı; ısıtıcı
./src/agent/kaynak-karari.js:34: * Exe ısıtma / exe girdili araçların KAPI metni (kaynak-isitici.js, isitici-dongu.js, local-build.js).
   (hepsi yorum/belge — require YOK)
$ grep -rnI "local-build" . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.claude
   -> isitici-dongu.test.js (kapı testi), kaynak-karari.js yorum, surum-tek-kaynak.test.js (yorum + isim listesi,
      bu commit'te düzeltildi), publisher-update.js yorum. Çalışma-zamanı require/spawn YOK.
$ grep -rl "isitici\|local-build" ~/.empp-agent/*.sh ~/.empp-agent/araclar ~/Library/LaunchAgents/com.empp.* launchd
   -> (boş)
```

## B) Fonksiyon düzeyinde çıkarılanlar — `runner-fonksiyonlar.js`

`src/agent/runner.js` içinden gövdeleriyle birlikte kopyalandı (satır no'ları 33636c2'ye göre):

| Fonksiyon | Eski satır | Kanıt |
|---|---|---|
| `cachedZipIsStale` | 587-611 | Tanımından başka çağrısı yok (`grep -rn cachedZipIsStale src tools scripts` yalnız yorum + `runner.test.js:107` "processJob içermemeli" yasak-listesi). processJob'tan exe'siz sözleşmeyle çıkarıldı. |
| `touchCacheEntry` | 1205+ | Üretimde çağıran yok; yalnız `module.exports` + kendi testi. (Aday listesinde yoktu; aynı kanıtla ölü.) |
| `pruneSiblingVersions` | 1229 | Çağıran yok; yalnız `runner.test.js` kaynak-dilimi testi. |
| `dizinBoyutuHesapla` | 1245 | Tek çağıranı `cacheTavaniUygula` (kendi içinde özyineleme). |
| `cacheTavaniUygula` | 1278 | Çağıran yok (grep'te tanım + kendi `warn` satırı + yasak-listesi). |
| buildPardusArtifact içi `if (hazir) {…}` dalı | 1611-1643 | `hazirPardusPaketi` imzası korunmuş ama gövdesi **her zaman `null`** döner (exe'siz sözleşme) → dal erişilemez. Fonksiyon + çağrı (env uyarısı) yerinde kalıyor; yalnız dal ve `hazir.dosya` silme/bağ/kopya kodu çıkarıldı. |

Çıkarılan **kullanılmayan importlar** (runner.js): `applyPublisherUpdate`, `latestLocalUpdate`
(`publisher-update`), `dahaYeniMi` (`surum-kiyas`; yalnız `cachedZipIsStale` kullanıyordu),
`icerikKapisiDenetle` (yalnız `...Zip` varyantı kullanılıyor), `KOK_INDEX_KAYNAK_MARKER`
(`kok-index-denetimi`; hiç kullanılmamış). `node -e "require('./src/agent/runner.js')"` yükleniyor.

## C) Testlerden çıkarılanlar — `testler-cikarilan.js`

| Test | Neyi koruyordu |
|---|---|
| `runner.test.js` "touchCacheEntry mtime i tazeler" / "olmayan dizinde FIRLATMAZ" | TTL temizleyicisinin mtime işareti; hata yutma. |
| `runner.test.js` "eski sürüm cache budayıcısı…" | `pruneSiblingVersions` kaynak-dilimi (readdir, keepVersion, rm). |
| `runner-pardus.test.js` "kapı HER İKİ yolda" — **yalnız hazır-yol yarısı** | Hazır paket yolunda kopyala → kapı sırası. Derleme yolu ve processJob yarısı canlı testte KALDI (başlık "derleme yolunda" olarak daraltıldı). |
| `runner-pardus.test.js` "hazır paket kaynağı ANCAK kabul kapısından sonra silinir" | 45695 kaybı dersi (kapı geçmeden hazır kaynak silinmesin) — dal yok, ders gereksiz. Dal geri getirilirse bu test de geri gelmeli. |
| `surum-tek-kaynak.test.js` | Silinmedi; "bilinen üç uç" listesinden `runner.js`/`local-build.js` düşürüldü (artık ölçülecek kıyas gövdeleri yok), liste `publisher-update.js`'e indi. |

## D) Kapı

`src/platforms/olu-yol-kapisi.js` `KARANTINA` listesine beş yol eklendi; `olu-yol-kapisi.test.js`
test 12: yollar geri gelmemiş + mezar dosyası burada + `runner.js` grafiği onları çekmiyor +
`karantinaIhlalleri() === []`. `src/`, `scripts/`, `tools/` altında bunlardan birini göreli `require`
eden her dosya (test dahil) testi kırmızı yapar.

## E) DOKUNULMAYAN adaylar (ölü olduğu KANITLANAMADI / kapsam dışı)

Bkz. ana rapor: `publisher-update.js` (tools/agent/serit-hazirla.mjs + testler çağırıyor),
`runner-helpers.js` içindeki `kaynakCacheTavaniGb`/`lruSilinecekler` (kendi birim testleri var; artık
üretimde çağıransız — ayrı tur), `tools/agent/serit-uret.js` + `serit-devral.js` (srv21 hazır paket
şeridi; çalıştıran dış kişi/cron doğrulanamaz), `downloadFile`/`zipDir`/`extractSfx`/`findBuildDir`
(testler ve exe-reddi kapısı kullanıyor), `~/.empp-agent/cache` (4,7 GB, 12 dizin — DOKUNULMADI).

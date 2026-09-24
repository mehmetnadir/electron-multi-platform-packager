# Pardus şeridi ProBook'a — plan `[PLAN: TASLAK]` (2026-09-24)

> Nadir'in beyanı (spec): "Pardus paketlemeyi ProBook'ta yap, ProBook yoksa Mac'te. Dosyaları
> buluttan doğrudan ProBook'a indir, orada paketle, oradan yükle. 4 kez sıkıştırmak mantıksız.
> Temizlikleri doğru yaparsan kabul kapısı çalışmaya devam eder."
> Bu belge PLANDIR. Kod yok, ProBook'a kurulum yok. Onay: Nadir.

## 0. Bugünkü akış (ölçüldü, Bloktest 2,2 GB, Mac docker, 24.09)

Kaynak: `RAPOR-2026-09-24/pardus/_rapor/Bloktest_Okuma_Yazma_2023/Bloktest-pardus-{build,container}.log`

| Adım | Saat (konteyner) | Süre | Sıkıştırma? |
|---|---|---|---|
| Kaynak dizini → build.zip (paket-uret/`zipDir`, ev sahibi Mac) | — | ~300 sn'nin parçası¹ | **1. zip** |
| build.zip açma (`packager-entry.sh`) | 08:36:03→08:36:40 | 37 sn | açma |
| asar + Electron açma + AppImage `mksquashfs` | 08:36:40→08:42:52 | ≈372 sn | **2. squashfs** |
| DEB `fpm` (tar + `--deb-compression xz`) | 08:42:52→08:51:41 | **≈529 sn (%55)** | **3. xz** |
| AppImage extract + AppRun + zenity + `appimagetool` → .impark | 08:51:45→08:52:35 | ≈50 sn | **4. squashfs** |
| Flatpak klasörü zip (2,6 KB) | aynı dakika | ~0 | 5. zip (önemsiz) |
| Konteyner toplam / betik toplam | | 955 / 1025 sn | |

¹ OKU-detay.md: pardus 1029 sn, paket-uret toplam 1329 sn. Aradaki ~300 sn zip + kabul aktarımı.
Teslim edilen tek şey `.impark` (2,44 GB). DEB (2,16 GB) ve Flatpak zip üretilip atılıyor.
Tüm x86 ikilileri Rosetta taklidiyle, `nice 19 / ionice 3` altında koşuyor.

**Hemen elde olan bulgu:** `packagingService.js:2437` zaten `EMPP_LINUX_DEB=0` bayrağını
tanıyor (testi: `src/packaging/linux-deb-opsiyonel.test.js`), ama `pardus-packager-build.sh`
bu değişkeni `docker run -e` ile konteynere GEÇİRMİYOR (yalnız SET_MENU/SAYFA_WEBP/OLU_TEMIZLIK
geçiyor). Tek satırlık betik değişikliği Mac şeridinde de ~529 sn kazandırır (ölçülecek).

## A. Hedef akış — ProBook birincil Pardus şeridi

```
iş kaynağı (book-update kuyruğu / Üretim Masası / paket-uret --serit probook)
  → ProBook ajanı (runner.js, AGENT_CAPS=pardus) next-job kiralar
  → job.downloadUrl'den kaynak exe'yi DOĞRUDAN buluttan indirir (Mac'ten geçmez)
  → SFX aç → build dizini (build.zip ÜRETİLMEZ; önbellek dizin olarak tutulur)
  → yerel node x64 + electron-builder, docker/Rosetta YOK:
      target=dir (linux-unpacked, sıkıştırmasız) → AppDir'e AppRun + zenity + .desktop + ikon
      → TEK appimagetool/mksquashfs geçişi → .impark   ("yalnız impark" kipi)
  → impark-butunluk.py (squashfs ofset/kesilme) + impark-dogrula.sh (zenity/asar kapısı)
  → kabul kapısı AYNI makinede, yerel (scp yok, `uzak:` kipi)
  → R2'ye ProBook'tan presigned multipart yükleme (mevcut `uploadMultipart`)
  → complete-multipart → defter/panel kaydı (sunucu tarafı mevcut akış)
  → temizlik sözleşmesi (B.3)
```

Sıkıştırma sayısı 4-5 → **1**. Kalan açma adımları (SFX, asar paketleme) sıkıştırma değil.
Beklenen: 2 ara squashfs + xz yok, Rosetta yok. ProBook CPU'su (i5-2520M, 4 iş parçacığı,
2011) Apple Silicon'dan yavaş — net sonuç TAHMİN EDİLMEZ, D'deki kıyasla ölçülür.
Kapasite ölçümü: `scratchpad/sonuc/PROBOOK-KAPASITE.md` — **ölçüm bekleniyor** (bu yazılırken yoktu).

**Yedek şerit = Mac docker** (bugünkü `pardus-packager-build.sh`, `EMPP_LINUX_DEB=0` eklenmiş hali).
Seçim kuralı (Mac ajanı her iş almadan önce, 60 sn önbellekli):
1. ProBook sağlıklı = son 2 dk içinde nabız (`~/empp-serit/durum.json`, Tailscale ssh ile okunur)
   VE `systemctl --user is-active empp-serit` = active VE son 30 dk'da iş TAMAMLADI ya da kuyruğu boş
   (restart sayacı sağlık değildir — `restart-always-olmayan-dosyayi-diriltir`)
   VE boş disk ≥ gerekli (B.3 formülü).
2. Sağlıklıysa Mac `pardus` yeteneğini heartbeat'ten DÜŞÜRÜR (`etkinYetenekler`'e `probookSaglikli`
   girdisi; mac/ofis kuralıyla aynı desen). Değilse Mac pardus işini alır.
3. Pardus işi 20 dk+ kiralanmadan bekliyorsa Mac yedek devreye girer (ProBook "meşgul" durumu).
Sağlık sinyali: Üretim Masası'nda "Bu Mac" rozetinin yanına **ProBook** rozeti
(yeşil = nabız taze + son iş PASS; sarı = meşgul; kırmızı = nabız yok/disk kapısı).

## B. Kabul kapısıyla birlikte yaşama

### B.1 Dizin ayrımı
| Yol | Sahibi | Kural |
|---|---|---|
| `~/empp-serit/cache/<kitap>/<srcVer>/build/` | ajan | kaynak önbelleği (dizin, zip değil), LRU bayt tavanı |
| `~/empp-serit/work/<isId>/` | ajan | tek işin çalışma alanı, iş bitince silinir |
| `~/empp-serit/out/<isId>/` | ajan | .impark + kanıt; yükleme PASS sonrası silinir, kanıt `kanit/`'e |
| `~/empp-serit/kanit/<isId>/` | ajan | log + kabul ekranları, 14 gün |
| `~/empp-serit/repo/` | kurulum betiği | packager deposu (salt-okuma checkout, sürüm = commit) |
| `~/DijiTap/**` | **kabul kapısı + ETAP kullanıcısı** | ajan ASLA yazmaz; yalnız gizle/temizlik betikleri |

`pkill -f "$HOME/[D]ijiTap/"` kalıbı `~/empp-serit` yollarını yakalamaz — kasıtlı ayrım.
Hiçbir iş yolu `DijiTap` alt dizesi taşımaz (ürün adı dahil: çalışma adı `isId`).

### B.2 Sıra
Tek kuyruk, kesin sıra: **derle → bütünlük → kabul → yükle → temizle**, sonra yeni iş.
Gerekçe: kabul açılış süresini, renk/sapma ölçümünü 20-25 sn pencerede alıyor; 4 iş parçacığı
derlemede doluyken açılış yavaşlar → yanlış RED ya da bekleme zaman aşımı. `nice` bunu
çözmez (I/O ve bellek baskısı kalır). Faz 2 (ölçümden sonra): yalnız **yükleme(n) ∥ derleme(n+1)**
serbest bırakılabilir (ağ ↔ CPU); kabul ile derleme ASLA çakışmaz.

### B.3 Temizlik sözleşmesi
Her iş sonunda (PASS da FAIL da; `trap EXIT` + ajan `finally`):
- Silinir: `work/<isId>/` tamamı (linux-unpacked, AppDir, squashfs-root), `out/<isId>/*.impark`
  (yalnız R2'de boyut eşitliği doğrulandıktan sonra; FAIL'de kanıt için 1 gün tutulur).
- Kabul tarafı: mevcut `probook-temizlik.sh` aynen — test kurulumu silinir, `.kabulgizli-<damga>`
  dizinleri geri konur, boş kökler kaldırılır. Yerel kipte `/tmp/kabul-*.impark` kopyası OLUŞMAZ.
- Açılışta (ajan başlarken) yetim tarama: `~/DijiTap/**/*.kabulgizli-*` varsa ÖNCE geri koy,
  sonra iş al (çökme sonrası gizli kalan öğretmen kurulumu = veri kaybı görünümü).
- Dokunulmaz: `~/DijiTap` altındaki önceden var olan kurulumlar, `cache/` (yalnız LRU tavanı),
  `repo/`, `kanit/` (14 gün kuralı hariç), ProBook sistem paketleri.
- Disk kapısı: iş almadan ÖNCE `boş ≥ kaynak×5 + kaynak×1,5 (kabul kurulumu) + 10 GB taban`
  VE doluluk ≤ %85. Tutmuyorsa yetenek düşer (iş kiralanmaz, Mac yedek alır) — kaynak indirilmez.

### B.4 Kaçak süreç / kilit
- Tek iş kilidi: `flock ~/empp-serit/.kilit` (Linux'ta var; Mac'teki mkdir kilidine gerek yok).
- Ajan yalnız systemd birimiyle koşar; elle başlatılan kopya kilidi alamaz ve çıkar.
- `durum.json` kimlik taşır: pid, commit, başlama zamanı, bayrak kümesi — sağlık kontrolü
  "cevap verdi mi" değil "beklenen kopya mı" sorar (`kacak-test-sureci-uretimi-besliyor`).
- İş başında önceki işin artığı süreç (`electron-builder`, `mksquashfs`, `appimagetool`) varsa
  işi alma, alarm ver — öldürme kararı otomatik değil.

## C. Bileşenler

| # | Bileşen | Boyut | Dosya | Not |
|---|---|---|---|---|
| C1 | ProBook kurulum betiği (idempotent) | M | `tools/pardus/probook-serit-kur.sh` (yeni) | node 22 x64, squashfs-tools, zenity, unrar/7zip-rar (**RAR SFX desteği ölçülecek**, Debian'da non-free), appimagetool `/usr/local/bin`, `~/empp-serit` ağacı, repo checkout |
| C2 | systemd birimi | S | `tools/pardus/empp-serit.service` (yeni) | `--user` birim + linger; `Restart=on-failure`, `RestartSec=30`, `StartLimitBurst=5`; `ExecStartPre` = dosya varlık testi; X oturumu için `DISPLAY=:0`, `XAUTHORITY` |
| C3 | Ajan Linux kipi | M | `src/agent/runner.js` (`buildPardusArtifact`), `runner-helpers.js` | `process.platform==='linux'` → `ensureDockerReady`/binfmt atlanır, yerel derleme betiği çağrılır; kaynak dizin olarak geçer (zip yok); `AGENT_CAPS=pardus` (kod `linux` değil `pardus` bekler — `mapPlatform`) |
| C4 | Yerel derleme betiği | M | `tools/pardus/pardus-yerel-build.sh` (yeni) | `packager-entry.sh` adımlarının docker'sız hali; disk kapısı + flock + log biçimi aynı |
| C5 | "Yalnız impark" kipi | L | `src/packaging/impark-tek-gecis.js` (yeni) + bayrak `EMPP_IMPARK_TEK=1` | `packagingService.js` DONDURULMUŞ — dokunulmaz. electron-builder `target=dir`, AppDir'i `customizeAppImage` ile BİREBİR aynı düzende kurar (AppRun şablonu, `zenity-gom`, .desktop, .DirIcon), tek `appimagetool`. Parite kapısı: `ref-bloktest-asar-root.txt` + `impark-dogrula.sh` rapor satırları eski yolla eşit |
| C6 | Kabul yerel kipi | S | `tools/pardus/probook-kabul.sh` | `PROBOOK_HOST=yerel` → `SSH=(bash -c)`, scp yerine yol; `uzak:` kipi zaten KOPYALA=0 |
| C7 | Mac yedek seçimi | S | `runner-helpers.js` `etkinYetenekler` + `run-agent.sh` | `probookSaglikli` girdisi; test: ProBook sağlıklıyken pardus düşer, nabız bayatken döner |
| C8 | Mac şeridi DEB kapatma | S | `tools/pardus/pardus-packager-build.sh` | `-e EMPP_LINUX_DEB="${EMPP_LINUX_DEB:-0}"` — C5'ten bağımsız, ilk yapılacak |
| C9 | paket-uret şerit seçimi | S | `~/.claude/skills/paket-uret/{SKILL.md,scripts/paket-uret.js}` | `--serit probook|mac|oto` (oto = C7 kuralı); probook seçilirse kuyruğa iş açar, yerelde derlemez |
| C10 | R2 kimliği | S | `~/.empp-agent/token.json` (ProBook, 0600) | ProBook'a **R2 anahtarı GİTMEZ**. Ajan yalnız kendi `X-Agent-Token`'ı ile presigned URL ister (en dar yetki: kendi kiraladığı işin anahtarı). Kayıt sırrı (`AGENT_ENROLL_SECRET`) bir kez stdin'den verilir, diske yazılmaz. `r2.conf` açık metin hatası tekrarlanmaz |
| C11 | Gözcü rozeti | S | Üretim Masası ön yüzü (dosya yolu ölçülecek) | durum.json + sunucu nabzından ProBook rozeti |

Her bileşen kendi testiyle gelir (gate): C3/C7 birim testi, C5 parite testi (aynı girdiyle
iki yol → rapor satırları eşit), C6 `probook-temizlik.test.js` genişletmesi.

## D. Kapılar / kanıt

Kıyas seti: **Bloktest 2,2 GB** (aynı kaynak, aynı sürüm), 3 koşu, ortanca.

| Ölçü | Mac docker bugün | Mac docker + DEB kapalı (C8) | ProBook yalnız-impark | Kapı |
|---|---|---|---|---|
| Kaynak indirme | (Mac hattı) | | ProBook hattı | — |
| Derleme (betik toplam) | 1025 sn | ölçülecek | ölçülecek | ProBook ≤ Mac+C8 ×1,5, değilse Mac birincil kalır |
| Kabul aktarımı | ~2,3 GB scp | aynı | 0 | 0 olmalı |
| Kabul süresi | kanıt: probook-kaniti | | | AÇILDI |
| R2 yükleme | Mac hattı | | ProBook hattı | boyut eşit |
| Uçtan uca | 1329 sn | | | |

Geçme şartları (hepsi):
1. `impark-butunluk.py` PASS + `impark-dogrula.sh`: `zenity: VAR`, AppRun/asar satırları referansla eşit.
2. Parite: yalnız-impark ile eski yolun AppDir dosya listesi farkı yalnız DEB/Flatpak artığı.
3. ProBook kabul: `SUREC=1`, `EKRAN=var`, pencere adı yayıncı, renk/sapma eşiği geçti.
4. R2 nesne boyutu = yerel .impark boyutu (bayt) ve md5 kaydı defterde.
5. İş sonrası: `~/empp-serit/work` boş, `~/DijiTap` envanteri iş öncesiyle aynı,
   `.kabulgizli-*` sayısı 0, `/tmp/kabul-*` yok.
6. Kurulan ilk 5 gerçek iş: 5/5 PASS ya da her FAIL'in kök nedeni yazılı.

## E. Riskler ve Nadir'e açık kararlar

Riskler:
- **Tek makine**: ProBook aynı zamanda test tahtası. Derleme sırasında elle GUI testi yapılırsa
  ölçüm kirlenir → `duraklat.istek` deseni ProBook'ta da olacak.
- **CPU**: 2011 çekirdeği; tek sıkıştırma kazancı taklit kaybını telafi etmeyebilir → D kapısı karar verir.
- **Disk**: 76 GB boş (20.09). Tek iş sığar, paralel iş sığmaz — ProBook'ta eşzamanlılık = 1.
- **RAR SFX**: Debian `unrar` non-free; yoksa kaynak açılamaz → C1'de ilk ölçüm.
- **X oturumu**: kabul GUI ister; systemd kullanıcı birimi oturum kapalıyken ekranı göremez.
  ETAP otomatik oturum açma + uyumama ayarı (`IdleAction=ignore`) mevcut; doğrulanacak.
- **Panel hesabı**: kaynak `yayincilikadm` hesabıyla iniyorsa o iş Mac'te kalır
  (`hesap-kilidi-paralelligi-yutar`); ProBook yalnız `job.downloadUrl` kullanır.
- Windows ve Mac (dmg) şeritleri etkilenmez; Android Mac'te kalır.

Açık kararlar (≤5):
1. **Sır dağıtımı**: ProBook'u ayrı ajan olarak kaydedelim mi (kendi token'ı, önerilen), yoksa
   hiç token vermeyip yüklemeyi Mac'e mi bırakalım (aktarım geri gelir)?
2. **Yedek kuralı**: ProBook sağlıksızken Mac otomatik mi devralsın (önerilen), yoksa iş beklesin mi?
3. **Kabul sırasında derleme**: faz 1'de kesin sıra (önerilen); yükleme∥derleme faz 2'ye — onay?
4. **Ofis dışı**: ProBook ofiste kalıyor; ajan buluta doğrudan çıktığı için konumdan bağımsız.
   Yönetim Tailscale üzerinden (100.73.161.76). Tailscale SSH kapalı kalır — onay?
5. **Sıra**: önce C8 (Mac DEB kapatma, hemen kazanç) → C1-C4+C6 (ProBook, mevcut çift squashfs'le)
   → C5 (tek geçiş) — onay?

## Kararlar (Nadir, 2026-09-24, teker teker soruldu)
| # | Soru | Karar |
|---|---|---|
| 1 | ProBook ajanının kimliği | **Kendi jetonu** — ayrı kayıt; kayıt sırrı bir kez elle, diske yazılmaz |
| 2 | Yedek devri | **Otomatik, eşikli** — nabız 10 dk yok ya da disk kapısı düşük → Mac docker şeridi; olay + ntfy; ProBook dönünce yeni işler ona |
| 3 | İş adımları | **Sıkı sıra** — indir → derle → bütünlük → kur+aç (kabul) → yükle → temizle; derleme sırasında kabul koşmaz |
| 4 | Ofis dışı erişim | **Tailscale** (100.73.161.76); ajan sunucuya kendi bağlanır |
| 5 | Uygulama sırası | **ProBook şeridi önce, tek geçiş sonra**; DEB kapatma yapıldı (`pardus-packager-build.sh` → `EMPP_LINUX_DEB=0`) |

Ölçüm notu (PROBOOK-KAPASITE.md): internet indirme ProBook 1,14 MB/s = Mac 1,04 MB/s (aynı hat, kontrol grubu);
mksquashfs gzip ProBook yerli 55 MB/s, Mac Rosetta 72 MB/s; zstd her ikisinde 3,6× yavaş → gzip kalır.
Durum: `[PLAN: KARARLAR ALINDI — uygulama başladı]`

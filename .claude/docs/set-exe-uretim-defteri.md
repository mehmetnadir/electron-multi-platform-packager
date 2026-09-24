# SET Güncelleme Kanallı Windows exe — Üretim Defteri

> **Ne işe yarar:** set güncelleme kanalını taşıyan ilk Windows exe'sini (SM4 Set, 1,3 GB,
> saatler süren üretim) **doğaçlama yapmadan** üretmek. Her adımda tam komut, beklenen
> çıktı, **başarısızlık işareti** ve o işarette ne yapılacağı yazılıdır.
>
> **Kanıt tabanı:** 2026-09-21 oturumu. Aşağıdaki tuzakların hepsi bu depoda **ölçüldü**;
> hiçbiri tahmin değildir. Ölçüm satırları `ÖLÇÜLDÜ:` ile işaretli.
>
> **Ana kural:** *ölçemediğini GEÇTİ sayma.* Üç durum vardır — GEÇTİ · KALDI · ÖLÇÜLEMEDİ.
> ÖLÇÜLEMEDİ, GEÇTİ değildir.

| | |
|---|---|
| Kaynak ZIP | `~/Downloads/yds-pketler/sm4.zip` — **1.433.105.846 bayt** |
| Paketleyici | `http://127.0.0.1:3001` (yerel HTTP paketleyici, `src/server/app.js`) |
| logoId | `f89d2e30-c4c1-4ba9-bca6-b561f114627b` (YDS Publishing) |
| appName / appVersion | `Super Monsters 4 Set` / `1.0.0` |
| setKimligi | `11811` |
| guncellemeTabani | `https://akillitahta.ndr.ist/api/v1/guncelleme` |
| Hedef makine | `windows-kasa` (gerçek Windows makinesi — VMware misafiri DEĞİL) |
| Teslim | `~/Desktop/SM4-Set-Windows/` |

---

## 0. Ölçüm araçlarının kendi tuzakları (önce bunu oku)

1. **RTK JSON'u ŞEMAYA çevirir, DEĞERİ gizler.** ÖLÇÜLDÜ: `curl …/api/health` çıktısı
   `bayatMi: bool, commit: string` gibi **tip şeması** olarak döndü — `false`/`true`
   ayrımı görünmedi. Değeri önemli olan her ölçümde `rtk proxy` kullan:
   ```bash
   rtk proxy curl -s --max-time 10 http://127.0.0.1:3001/api/health | cat
   ```
2. **RTK `find` / `wc -l` çıktısını da yeniden yazar** — aktif yazılan bir dizin için `0`
   döndürdüğü ölçüldü. Dizin büyümesi ölçerken daima `rtk proxy du -shx …`.
3. **`du` `-x` olmadan Docker overlay'i gezip aynı baytı iki kez sayar.** Daima `-shx`.
4. **`ps eww` env'i kırpar** — `ps ewww` (üç `w`) şart.

---

## 1. ÖN KONTROL (her üretimden önce, istisnasız)

```bash
cd /Users/nadir/01dev/electron-multi-platform-packager
node scripts/uretim-on-kontrol.js          # insan okunur
node scripts/uretim-on-kontrol.js --json   # makine okunur
```

**Beklenen:** `SONUÇ: üretime başlanabilir.` + çıkış kodu `0`.
Sekiz kontrol: paketleyici canlı · süreç taze · kaynak zip · disk · windows-kasa şeridi ·
logo · 7z · teslim dizini.

**Başarısızlık işareti:** çıkış kodu `1` ve en az bir `[KALDI]` satırı.

**🛑 KARAR NOKTASI — KALDI varsa ÜRETİME BAŞLAMA.** Saatler süren bir üretimi bilinen bir
önkoşul ihlaliyle başlatmak, işin sonunda değil **başında** kaybedilmiş demektir.
`[UYARI]` üretimi durdurmaz ama deftere not edilir.

> **Bugünkü gerçek çıktı (2026-09-21 14:45):**
> `GEÇTİ 6 · UYARI 1 · KALDI 1` → **üretime başlanamaz.**
> KALDI: `surec-tazeligi` (bkz. adım 2). UYARI: `windows-kasa` guest eski izleyici.

---

## 2. PAKETLEYİCİ KİMLİĞİ — canlılık kimlik değildir

```bash
rtk proxy curl -s --max-time 10 http://127.0.0.1:3001/api/health | cat
```

**Beklenen (üretim için zorunlu):**
- `"commit"` → `git rev-parse --short HEAD` ile aynı
- `"bayatMi": false`, `"bayatSebepleri": []`
- `"kapilar"` içinde **`windowsAsarsiz` alanı VAR** ve `"setGuncelleme": true`
- `"pid"` → adım 5'te canlılık ölçümünde kullanılacak

**Başarısızlık işaretleri ve anlamları:**

| İşaret | Anlamı | Ne yapılacak |
|---|---|---|
| Cevap yok / ECONNREFUSED | Paketleyici ayakta değil | Adım 2b (başlat) |
| `bayatMi: true` | Bellekteki modül ≠ disk | Adım 2b (yeniden başlat) |
| `kapilar` içinde `windowsAsarsiz` **alanı yok** | Süreç, asar kapısı eklenmeden önceki kapı listesini yüklemiş → **`asar:false` değişikliğini taşımıyor** | Adım 2b |
| `commit` ≠ HEAD | Başka bir koddan koşuyor | Adım 2b |

> **⚠️ `bayatMi:false` TEK BAŞINA YETMEZ — ölçülmüş kör nokta.**
> `bayatMi` yalnız **7 modülü** izler (`set-kimligi`, `set-kabuk`, `guncelleyici-enjekte`,
> `kitap-guncelleyici`, `surum-normallestir`, `surum-kiyas`, `sayfa-webp`).
> `saglik-kimligi.js`, `windows-asarsiz.js`, `packagingService.js`,
> `WindowsPackagingService.js` o listede **YOKTUR**.
> **ÖLÇÜLDÜ (2026-09-21):** canlı süreç `11:14:34Z`'de başladı; bu dört dosya
> `11:22`–`11:40Z` arasında düzenlendi. `/api/health` yine de `bayatMi:false` dedi.
> Süreç bayattı, sağlık ucu göremedi.
> Bu yüzden ön kontrol **ikinci, bağımsız** bir ölçüm yapar: kritik dosyaların mtime'ı
> süreç başlangıcından yeni mi? İkisinden biri bayatlık gösteriyorsa üretim durur.

### 2b. Paketleyiciyi temiz başlatma

**🛑 KARAR NOKTASI — İNSAN ONAYI GEREKİR.** Çalışan süreç öldürülür; o sırada uçuşta bir
paketleme varsa kaybolur. Önce uçuşta iş olup olmadığı ölçülür:

```bash
rtk proxy curl -s http://127.0.0.1:3001/api/queue-status | cat   # activePackagingJobs boş mu?
ps -o pid,ppid,etime,command -p "$(rtk proxy curl -s http://127.0.0.1:3001/api/health | \
  node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).pid))")"
```

Uçuşta iş YOKSA ve onay alındıysa:

```bash
kill <pid>                                   # pid: /api/health'ten
sleep 2 && ~/.empp-agent/run-agent.sh        # servisi kanonik yoldan başlatır
```

**Başlatma doğrulaması (zorunlu):** adım 2'yi tekrar koş — `kapilar.windowsAsarsiz`
alanı **görünmeli** ve `startedAt` yeni olmalı. Görünmüyorsa dosya diskte yoktur veya
başka bir kopya porta oturmuştur — **üretime BAŞLAMA**, Şef'e bildir.

> **Kaçak süreç tuzağı (ölçülmüş saha arızası, 2026-09-20):** elle başlatılmış, terminalden
> kopmuş (PPID=1) bir TEST süreci 3001'e oturdu; `run-agent.sh` yalnız *canlılık* ölçtüğü
> için yeşil gördü ve temiz kopyayı **hiç başlatmadı**. O tarihten sonraki tüm trafik kaçak
> süreçten geçti. Bugünkü canlı süreç de `ppid=1` / `yetimMi:true` — yani aynı desen.
> Kimlik ölçülmeden "ayakta" demek yasaktır.

---

## 3. KAYNAK YÜKLEME → sessionId

```bash
ZIP=~/Downloads/yds-pketler/sm4.zip
stat -f "%z bayt  %N" "$ZIP"          # 1433105846 bekleniyor

rtk proxy curl -s --max-time 7200 -X POST \
  -F "files=@$ZIP" \
  -F "appName=Super Monsters 4 Set" \
  -F "appVersion=1.0.0" \
  http://127.0.0.1:3001/api/upload-build | cat
```

**Beklenen:** `{"success":true,"sessionId":"…","buildInfo":{…"type":"zip_queued"…}}`
→ `sessionId` kaydedilir.

> **⚠️ TUZAK — yükleme cevabı "ZIP açıldı" demek DEĞİLDİR.**
> `/api/upload-build` ZIP'i **kuyruğa ekleyip hemen cevap döner** (`type: "zip_queued"`).
> Açılma asenkron sürer. Hemen `/api/package` çağırırsan iş "ZIP açılması bekleniyor"
> durumunda kuyruğa düşer (kod bunu tolere eder) ama **durumu sen ölçmemiş olursun**.

**Açılmayı ölç — devam etmeden önce:**

```bash
rtk proxy curl -s "http://127.0.0.1:3001/api/zip-status/$SID" | cat
rtk proxy curl -s "http://127.0.0.1:3001/api/validate-session/$SID" | \
  node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);
  console.log('fileCount=',j.fileCount,'files=',(j.files||[]).slice(0,8))})"
```

**Beklenen:** `zipStatus.status` → `completed`; `validate-session` `fileCount` > 1 ve
içinde `build-info.json` **dışında** gerçek içerik klasörleri var.

| Başarısızlık işareti | Ne yapılacak |
|---|---|
| HTTP 400 "Dosya çok büyük" | multer tavanı 2 GB; zip 1,43 GB — bu mesaj gelirse yanlış dosya yüklenmiştir |
| `zipStatus.status` = `not_found` | sessionId yanlış — cevaptaki değeri tekrar oku |
| `fileCount` = 1 (yalnız `build-info.json`) | ZIP açılmamış → **DUR**, `~/.empp-agent/packager.log` içinde ZIP hatası ara |

---

## 4. PAKETLEME İSTEĞİ

```bash
SID=<adım 3'ten>
rtk proxy curl -s -X POST http://127.0.0.1:3001/api/package \
  -H 'Content-Type: application/json' \
  -d "{\"sessionId\":\"$SID\",
       \"platforms\":[\"windows\"],
       \"logoId\":\"f89d2e30-c4c1-4ba9-bca6-b561f114627b\",
       \"appName\":\"Super Monsters 4 Set\",
       \"appVersion\":\"1.0.0\",
       \"setKimligi\":\"11811\",
       \"guncellemeTabani\":\"https://akillitahta.ndr.ist/api/v1/guncelleme\",
       \"packageOptions\":{\"publisherName\":\"YDS Publishing\"}}" | cat
```

**Beklenen:** `{"success":true,"jobId":"…","status":"…","canStart":true|false}` → `jobId` kaydedilir.

> **⚠️ TUZAK — `setKimligi` alanını ŞU AN YALNIZ BU UÇ KABUL EDİYOR.**
> Gövdede yoksa paket üretilir ama `empp-set.json` içine `"setKimligi": null` + sebep
> yazılır → **güncelleme kanalı KAPALI doğar** ve statik kapının 13. maddesi FAIL verir
> (doğru davranış: sessiz yutma yok). Gövdeyi kopyalarken bu iki alanı **asla** düşürme.
>
> **Geçersiz değer isteği DÜŞÜRMEZ:** `setKimligi` yol-güvenli değilse sunucu onu *yok
> sayar*, HTTP 200 döner ve sebebi pakete yazar. Yani **HTTP 200 kanalın açıldığının
> kanıtı değildir** — kanıt, adım 7'deki kapının 13. maddesidir.

**Hemen doğrula (ucuz, 1 sn):** paketleyici günlüğünde kimlik satırı görünmeli —

```bash
grep -a "SET kimliği" ~/.empp-agent/packager.log | tail -3
```
Beklenen: `🆔 SET kimliği: 11811 (acik), …`. `YOK (yok)` görürsen **işi iptal et**
(`POST /api/jobs/<jobId>/cancel`) ve gövdeyi düzeltip yeniden gönder — saatleri boşa
harcama.

---

## 5. İLERLEME İZLEME — `progress` yalan söylemez ama az konuşur

> **⚠️ TUZAK (ÖLÇÜLDÜ):** `progress` alanı yalnız **0** ve **100** değerlerinde yazılır;
> ara güncelleme **YOKTUR**. `progress: 0` bir **takılma kanıtı DEĞİLDİR**.
> Canlılık, işin kendi kanalından ölçülür — üç bağımsız kanal:

```bash
JID=<adım 4'ten>

# (a) günlük akışı — en hızlı sinyal
tail -f ~/.empp-agent/packager.log

# (b) çıktı dizini büyümesi — 60 sn arayla iki ölçüm ARTIYOR olmalı
rtk proxy du -shx "temp/$JID" ; sleep 60 ; rtk proxy du -shx "temp/$JID"

# (c) süreç CPU'su — electron-builder/7z çalışırken %0 olamaz
ps -o pid,%cpu,etime,command -p <paketleyici pid>

# (d) durum ucu (yalnız 'completed'/'failed' geçişi için anlamlı)
rtk proxy curl -s "http://127.0.0.1:3001/api/package-status/$JID" | cat
```

**Beklenen:** (a) satır akıyor · (b) `temp/<jobId>` büyüyor · (c) CPU > 0.

| Başarısızlık işareti | Anlamı | Ne yapılacak |
|---|---|---|
| Üç kanalın **üçü** de 10 dk durgun | Gerçek takılma | Günlüğün son 100 satırına bak; gerekirse iptal + Şef'e bildir |
| `du` `0B` döndü ama günlük akıyor | RTK ölçüm artefaktı | `rtk proxy` ile tekrar ölç — panik yok |
| `status: "failed"` | Üretim düştü | `job.error` oku, **yeniden denemeden önce sebebi yaz** |
| `progress: 0` ve diğer kanallar canlı | **Normal** | Devam et, müdahale etme |

**⏱️ Beklenen süre:** saatler. Tavan koyma; *ilerleme* kapısı kullan (yukarıdaki üç kanal).

---

## 6. EXE'Yİ İNDİR

```bash
mkdir -p ~/Desktop/SM4-Set-Windows
EXE=~/Desktop/SM4-Set-Windows/"Super Monsters 4 Set-1.0.0-Setup.exe"
rtk proxy curl -sfL -o "$EXE" "http://127.0.0.1:3001/api/download/$JID/windows"
stat -f "%z bayt  %N" "$EXE"
```

**Beklenen:** ~1,23–1,24 GB (emsal: `SM4-K32-32BIT.exe` 1.234,0 MB).

| Başarısızlık işareti | Ne yapılacak |
|---|---|
| HTTP 404 "İş bulunamadı veya henüz tamamlanmadı" | Adım 5'e dön, `completed` bekle |
| Dosya < 1 GB | İndirme yarım — **sil değil**, yeniden indir ve boyutu tekrar ölç |
| `curl` çıkış 0 ama dosya yok | *Çıkış kodu kanıt değildir* — daima `stat` ile ölç |

---

## 7. STATİK KAPI — teslimin ön şartı

```bash
mkdir -p ~/empp-kapi-scratch
TMPDIR=~/empp-kapi-scratch node scripts/windows-paket-kapisi.js "$EXE" --tut
echo "KAPI_RC=$?"
```

> **⚠️ TUZAK — `--cikarim <dizin>` "buraya çıkar" DEMEK DEĞİLDİR.**
> Anlamı: *"zaten çıkarılmış bir ağacı kullan"*. Boş bir dizinle çağrılırsa 7z hiç
> çalışmaz ve **her madde ÖLÇÜLEMEDİ döner** — sahte bir "sorun yok" değil, **körlük**.
> Çıkarım yerini değiştirmek istiyorsan yolu `TMPDIR` ile ver (betik geçici dizinini
> `os.tmpdir()` altında açar); `--tut` onu silmeden bırakır.

**Çıkış kodu sözleşmesi:** `0` temiz · `1` **FAIL var** · `3` FAIL yok ama **ÖLÇÜLEMEDİ** var
(`--gevsek` bunu 0 yapar — **teslim için kullanma**).

**Zorunlu bakılacak maddeler:**
- **Madde 13 (SET güncelleme kanalı)** — `setKimligi: 11811` ve `guncellemeTabani`
  pakette mi? Bu üretimin **varlık sebebi** budur.
- **Madde 12 (uygulama içeriği)** — `asar:false` düzeninde içerik `resources/app/`
  altında düz ağaç olarak durur (`app.asar` **değil**). Kap bulunamazsa ÖLÇÜLEMEDİ.
- **Madde 2 (mimari)** — dış NSIS PE'si **daima 0x014c**'dir; kapı içerideki yükü ölçer.

**🛑 KARAR NOKTASI — KAPI FAIL VERİRSE PAKET TESLİM EDİLMEZ.**
Çıkış kodu `1` → teslim yok, Şef'e FAIL maddesiyle bildir.
Çıkış kodu `3` (ÖLÇÜLEMEDİ) → **teslim yok**; önce ölçümü mümkün kıl (7z var mı, çıkarım
başarılı mı). *ÖLÇÜLEMEDİ, GEÇTİ değildir.*

---

## 8. windows-kasa'da KURULUM + AÇILIŞ (gerçek makine kanıtı)

```bash
node tools/windows/vm-kapi.js hazir --makine windows-kasa
```

> **⚠️ TUZAK — `--makine` YOKSA YANLIŞ KALBİ OKUR.**
> **ÖLÇÜLDÜ (bugün, aynı anda):**
> `hazir --makine windows-kasa` → `{"durum":"ayakta","yasSn":2,"serit":"bilinmiyor"}`
> `hazir` (makinesiz)          → `{"durum":"olu","yasSn":7111,…}`
> Makinesiz çağrı eski tek-makine kalbini (`durum/kalp.txt`) okur. `windows-kasa` kendi
> kalbini (`durum/kalp-windows-kasa.txt`) taşır.

**`serit` alanının okunuşu:**

| Değer | Anlamı | Karar |
|---|---|---|
| `akiyor` | Ana döngü ilerliyor | Devam |
| `bilinmiyor` | Guest'te **eski izleyici** — akış ölçülemiyor | Devam et ama **ilerleme körlüğü** kabul edilmiş olur; kurulum uzarsa sebebi bu olabilir |
| `tikali` | Süreç ayakta, **iş akmıyor** ("online ama ölü") | **DUR** — görevi gönderme, izleyiciyi kurtar |

```bash
node tools/windows/vm-kapi.js kur "$EXE" --makine windows-kasa --surec "Super Monsters 4 Set"
node tools/windows/vm-kapi.js ac  --makine windows-kasa --surec "Super Monsters 4 Set"
node tools/windows/vm-kapi.js ekran --makine windows-kasa
```

> **⚠️ TUZAK — kurulum çıkış kodu 0 + `surecSayisi: 0` "kurulum başarısız" DEMEK DEĞİLDİR.**
> "Kuruldu ama **açılmadı**" demektir. İkisi **ayrı** ölçülür: kurulum çıkışı ≠ açılış kanıtı.
> Açılış kanıtı = `surecSayisi > 0` **ve** ekran görüntüsü.

| Başarısızlık işareti | Ne yapılacak |
|---|---|
| `durum: "olu"` | Önce `--makine` verdiğinden emin ol; hâlâ ölüyse guest izleyicisi elle başlatılmalı (`tools/windows/OKU.md`) |
| `surecSayisi: 0` | Açılmadı — ekran görüntüsü al, kurulum günlüğünü oku, **teslim etme** |
| Görev 15 dk sonuçsuz | Şerit tıkalı olabilir; `hazir --makine windows-kasa` ile tekrar ölç |

---

## 9. TESLİM

```bash
DST=~/Desktop/SM4-Set-Windows
mkdir -p "$DST"
# exe zaten orada (adım 6). Kapı raporunu ve kanıtları da yanına koy:
TMPDIR=~/empp-kapi-scratch node scripts/windows-paket-kapisi.js "$EXE" --json > "$DST/kapi-raporu.json"
open "$DST"
```

`OKU.md` içine **yalnız ölçülmüş** değerler yazılır:
exe adı + **bayt** boyutu · `jobId` · paketleyici `commit` · kapı çıkış kodu ve madde 13
sonucu · `windows-kasa` kurulum/açılış sonucu (`surecSayisi`, ekran görüntüsü yolu) ·
üretim başlangıç/bitiş saati (`date` ile alınır, **tahmin edilmez**).

**Klasör `open` ile açılır ve tek satır bildirilir:** `güncelledim: <dosyalar>`.

---

## 10. BİLİNEN AÇIK MADDELER (üretim sırasında sürpriz olmasın)

1. **`setKimligi`'yi hiçbir otomatik çağıran göndermiyor.** ÖLÇÜLDÜ: alan yalnız
   `POST /api/package` gövdesinden okunuyor (`src/server/app.js`), `src/agent/runner.js`
   ve diğer çağıranlar göndermiyor. Yani bu üretim **elle POST** ile yapılmalıdır;
   ajan/kuyruk üzerinden tetiklenen bir iş kanalı **kapalı** doğar.
2. **`asar:false` başka bir ajan tarafından hazırlanıyor.** Çalışma ağacında
   `src/packaging/windows-asarsiz.js` mevcut ve `packagingService.js:2036` +
   `WindowsPackagingService.js:360` ondan `asar` değerini okuyor — ama **canlı süreç
   bunu yüklememiş** (adım 2'deki ölçüm). **Ön koşul:** değişiklik ağaçta sabitlendikten
   sonra paketleyici yeniden başlatılır ve `/api/health` `kapilar.windowsAsarsiz`
   alanını **göstermelidir**. Göstermiyorsa üretim başlamaz.
3. **`windows-kasa` şu an kilitli** — Nadir'in Ctrl+C'si bekleniyor. Adım 8 o ana kadar
   koşturulamaz; adım 1–7 bundan bağımsızdır ve önden yapılabilir.
4. **Guest'te eski izleyici** (`serit: "bilinmiyor"`). Yükseltme yordamı
   `tools/windows/YUKSELTME.md`. Yükseltilmezse adım 8'de ilerleme körlüğü kabul edilmiş olur.
5. **Canlı süreç `ppid=1` / `yetimMi:true`.** Kanonik başlatma `~/.empp-agent/run-agent.sh`
   üzerindendir; yetim süreç, kaçak-paketleyici arızasının deseniyle aynıdır. Adım 2b'deki
   temiz başlatma bunu da düzeltir.

---

## 11. KARAR NOKTALARI — özet

| Adım | Durak tipi | Kural |
|---|---|---|
| 1 | 🛑 **DUR** | Ön kontrol `KALDI` verdiyse üretime başlanmaz |
| 2b | 🛑 **İNSAN ONAYI** | Süreç öldürülecek — uçuşta iş yoksa ve onay varsa |
| 3 | ▶️ otomatik | ZIP açılması `completed` olunca devam |
| 4 | ▶️ otomatik | `jobId` alındı + günlükte `SET kimliği: 11811` göründü |
| 5 | ▶️ otomatik | Üç canlılık kanalından biri akıyorsa bekle; `progress:0` müdahale sebebi DEĞİL |
| 6 | ▶️ otomatik | Boyut ölçüldüyse devam |
| 7 | 🛑 **DUR** | Kapı FAIL (rc=1) veya ÖLÇÜLEMEDİ (rc=3) → **teslim yok** |
| 8 | 🛑 **DUR** | `serit: tikali` → görev gönderme. `surecSayisi:0` → teslim yok |
| 9 | ▶️ otomatik | Klasör `open`, tek satır bildirim |

---

**Oluşturma:** 2026-09-21 · **Ölçüm kaynağı:** canlı `/api/health` (commit `7031658`,
pid 61053), `vm-kapi.js hazir --makine windows-kasa`, `statfs`, `stat`, `git status`.
**Sağlık betiği:** `scripts/uretim-on-kontrol.js` (+ `scripts/uretim-on-kontrol.test.js`, 34 test).

# Sağlık Ucu → Kimlik Kontrolü Reçetesi (`~/.empp-agent/run-agent.sh`)

> **Bu bir reçetedir — UYGULANMADI.** `~/.empp-agent/run-agent.sh` bu deponun dışında;
> ona yazma yetkisi/onayı bu görevde YOK. Aşağıdaki kod parçası Nadir tarafından o
> dosyaya elle yapıştırılana kadar devrede değildir.

## Neden (ölçülmüş arıza, 2026-09-21)

`run-agent.sh` paketleyiciyi başlatmadan önce `curl .../api/health` ile YALNIZ
**canlılığı** ölçüyordu (cevap veriyor mu). 2026-09-20 23:30'da elle başlatılmış,
terminalden kopmuş (PPID=1) bir TEST süreci — ortamında `EMPP_SAYFA_WEBP=1` ile —
3001 portuna oturmuştu. Sağlık kontrolü yeşil döndü (süreç canlıydı) → launchd
kopyası kendi temiz kopyasını **hiç başlatmadı** → o tarihten sonraki tüm paketleme
trafiği kaçak süreçten geçti; ayrıca require-cache yüzünden sonraki commit'ler de
canlı olmadı.

Çözüm bu depoda tamam: `/api/health` artık `pid` + `kapilar` (kapı bayraklarının o
süreçteki açık/kapalı durumu, yalnız boolean) döner; `src/server/saglik-kimligi.js`
saf karar fonksiyonları (`kapilariOku`, `kimlikUyusuyorMu`, `yesilSayilirMi`) sunar.
Eksik olan tek parça: **run-agent.sh'ın bu bilgiyi gerçekten sorması.**

## Ön koşul — beklenen kapı durumu run-agent.sh'ın KENDİ export'larından türer

`run-agent.sh` şu an şunları export ediyor (script'i okuyarak doğrulandı, 2026-09-21):

```
export EMPP_SET_MENU=1
export EMPP_PARDUS_KABUL=1
```

`EMPP_SAYFA_WEBP`, `EMPP_YAMA`, `EMPP_SURUM_NORMALLESTIR` export edilmiyor → varsayılan
davranış geçerli (sayfaWebp=kapalı, yama=kapalı, surumNormallestir=açık).

Yani launchd'nin başlatacağı **temiz** kopyanın beklenen kimliği:

| Kapı | Beklenen |
|---|---|
| `sayfaWebp` | **kapalı** (export edilmemiş) |
| `setMenu` | **açık** (`EMPP_SET_MENU=1`) |
| `pardusKabul` | **açık** (`EMPP_PARDUS_KABUL=1`) |
| `surumNormallestir` | **açık** (varsayılan) |
| `yama` | **kapalı** (export edilmemiş) |

**UYARI:** `run-agent.sh`'a yeni bir `EMPP_*` export eklenir/kaldırılırsa, aşağıdaki
kod parçasındaki `beklenen.kapilar` nesnesi de AYNI ANDA güncellenmeli — aksi halde
reçete kendi kendini yalanlar (kimlik kontrolü kendi başlattığı kopyayı "uymuyor"
diye reddeder).

## Değiştirilecek satırlar

`run-agent.sh` içinde şu blok var (satır numarası scriptin son hâline göre kayabilir,
metinle ara):

```bash
if ! curl -sf -m 5 http://127.0.0.1:3001/api/health >/dev/null 2>&1; then
  (PORT=3001 nohup node src/server/app.js >"$LOGDIR/packager.log" 2>&1 &)
  sleep 4
fi
curl -sf -m 5 http://127.0.0.1:3001/api/health >/dev/null && echo "packager: OK (3001)" || { echo "packager başlamadı"; exit 1; }
```

Bunu şununla DEĞİŞTİR (canlılık kontrolü aynı kalır — kaldırılan `lsof -iTCP` zaten
2026-09-17'de macOS'ta asılma riski yüzünden atılmıştı, ona dönülmüyor):

```bash
if ! curl -sf -m 5 http://127.0.0.1:3001/api/health >/dev/null 2>&1; then
  (PORT=3001 nohup node src/server/app.js >"$LOGDIR/packager.log" 2>&1 &)
  sleep 4
fi

# K-saglik-kimligi (2026-09-21, kaçak paketleyici arızası) — CANLILIK yetmez: yeşil
# dönen süreç BENİM BAŞLATACAĞIM KOPYA MI? Elle başlatılmış/kopmuş bir test süreci
# bu porta oturup canlılık testini yeşil geçebilir (2026-09-20 23:30'da tam bunu
# yaşadık — EMPP_SAYFA_WEBP=1'li bir test süreci aylarca fark edilmeden trafiği
# yuttu). Karar mantığı: src/server/saglik-kimligi.js (saf, testli, mutasyonla
# doğrulanmış). BOZULURSA/BELİRSİZSE DAİMA KIRMIZI SAY.
SAGLIK_JSON="$(curl -sf -m 5 http://127.0.0.1:3001/api/health 2>/dev/null || true)"
BEKLENEN_COMMIT="$(git -C "$REPO" rev-parse --short HEAD 2>/dev/null || echo bilinmiyor)"

KIMLIK="$(node -e '
  const { yesilSayilirMi, kimlikUyusuyorMu } = require(process.argv[1]);
  let saglik = null;
  try { saglik = JSON.parse(process.argv[2]); } catch (e) { /* bozuk JSON -> saglik null kalir, altta KIRMIZI */ }
  // beklenen.kapilar: run-agent.sh'ın KENDİ export'larıyla (EMPP_SET_MENU=1,
  // EMPP_PARDUS_KABUL=1) BİREBİR aynı olmalı — script değişirse burası da değişir.
  const beklenen = {
    commit: process.argv[3],
    kapilar: {
      sayfaWebp: false, setMenu: true, pardusKabul: true,
      surumNormallestir: true, yama: false,
    },
  };
  const yesil = yesilSayilirMi(saglik, beklenen);
  const sebepler = kimlikUyusuyorMu(saglik || {}, beklenen).sebepler;
  process.stdout.write(JSON.stringify({ yesil, sebepler }));
' "$REPO/src/server/saglik-kimligi.js" "$SAGLIK_JSON" "$BEKLENEN_COMMIT")"

if ! node -e 'process.exit(JSON.parse(process.argv[1]).yesil ? 0 : 1)' "$KIMLIK"; then
  echo "!! SAĞLIK UCU CANLI AMA KİMLİK UYUŞMUYOR — 3001 portu BAŞKA bir sürece ait olabilir:"
  node -e '
    const r = JSON.parse(process.argv[1]);
    const sebepler = (r.sebepler && r.sebepler.length) ? r.sebepler : ["cevap yok / bozuk JSON / kapilar eksik"];
    for (const s of sebepler) console.log("  - " + s);
  ' "$KIMLIK"
  echo "!! (kaçak paketleyici arızası, 2026-09-21 deseni — bkz. src/server/saglik-kimligi.js)"
  echo "!! launchd kopyası BAŞLATILMADI/DEVAM ETTİRİLMEDİ. Elle incele:"
  echo "!!   lsof -nP -iTCP:3001 -sTCP:LISTEN   (NOT: macOS'ta -iTCP takılabilir, -m ile zaman sınırı koy; ör: timeout 5 lsof ...)"
  echo "!!   ps -p <pid> -o pid,ppid,lstart,command"
  echo "!! Karar (kaçak süreci öldür / bekle / farklı port kullan) Nadir'e ait — bu script OTOMATİK öldürmez."
  exit 1
fi
echo "packager: KİMLİK OK (commit=$BEKLENEN_COMMIT, 3001)"
```

## Doğrulandı (bu görevde, süreç başlatmadan)

Yukarıdaki `node -e` bloğu gerçek `saglik-kimligi.js`'e karşı 4 senaryoyla elle
koşturuldu (yalnız fonksiyon çağrısı — hiçbir süreç başlatılmadı/öldürülmedi):

| Senaryo | `kapilar.sayfaWebp` | commit | Sonuç |
|---|---|---|---|
| Tam uyuşan (beklenen kopya) | kapalı | eşit | **YEŞİL** |
| Kaçak süreç deseni (webp açık sızmış) | **açık** | eşit | KIRMIZI — `sayfaWebp: bekleniyor kapalı, gelen açık` |
| Eski commit | kapalı | farklı | KIRMIZI — `commit: bekleniyor deadbee, gelen eski123` |
| Boş/curl başarısız cevap | — | — | KIRMIZI — tüm alanlar `tanımsız` |

## Nasıl geri alınır

Reçete uygulandıktan sonra geri almak gerekirse: yukarıdaki yeni bloğu silip, bu
belgenin başındaki orijinal iki satırlık bloğu (`if ! curl -sf ... fi` +
`curl -sf ... exit 1 }`) geri yapıştır. Script'e dokunmadan önce elle yedek almak
yeterli güvence:

```bash
cp ~/.empp-agent/run-agent.sh ~/.empp-agent/run-agent.sh.onceki-$(date +%Y%m%d%H%M)
```

Kimlik kontrolü YALNIZ bu dosyadaki bir bash bloğu — `src/server/saglik-kimligi.js`
ve `/api/health` şeması bu depodaki değişikliklerle zaten canlı (bu dosyaya
dokunulmasa da health ucu pid/kapilar döner; geri alınan tek şey run-agent.sh'ın
BUNU SORMASI olur).

## Uygulama sonrası tek satır kontrol

```bash
curl -s http://127.0.0.1:3001/api/health | node -e '
  const s = JSON.parse(require("fs").readFileSync(0, "utf8"));
  console.log("commit=" + s.commit, "pid=" + s.pid, JSON.stringify(s.kapilar));
'
```

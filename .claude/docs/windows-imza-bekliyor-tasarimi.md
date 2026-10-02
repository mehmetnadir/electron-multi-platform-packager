# Windows "imza bekliyor" — runner + bekçi + sunucu tasarımı (2026-10-02)

Kaynak karar: book-update `exesiz-kaynak-sozlesmesi.md` §2a (Nadir 02.10, ONAYLI): Windows her
hâlükârda üretilir; yuva yoksa paket kabulden geçip "imza bekliyor" olarak hazır tutulur; yarım
saatte bir bekçi diskleri bağlamayı dener, yuva açılınca imzalatır + doğrular + yükler; yuva yoksa
ya da bekleyen 3 saati aşarsa telefona bildirim.

## Runner (bu depo, dal `win-kasa-kabul-20261002`)
- Yetenek: `EMPP_RUNNER_WINDOWS=1` + (`imza yuvası erişilir` VEYA hazır kuyruk açık) → `windows` ilan.
  Kapatma: `EMPP_WIN_IMZA_BEKLEME=0` (eski kural: yuva yoksa ilan yok).
- `imzaKipiSec`: yuva erişilir → bugünkü zincir aynen; değilse `hazir`: statik kapı + imzasız kabul
  → `~/.empp-agent/windows-hazir/<id>-<sürüm>/` (exe + manifest.json) → `/release`
  `{durum:'imza-bekliyor', sebep:'[imza-bekliyor] …'}` → `{ertelendi:true}`. `/result` YAZILMAZ.
- Aynı id+sürüm yeniden kiralanınca üretim YOK: yuva açıksa hazır paket `imzaliYayinZinciri` →
  `postResultSuccess` → `yayinlandi/`; kapalıysa yine imza-bekliyor. Kayıt kilidi (`<kayıt>/.kilit`)
  bekçiyle çift yayını önler.

## Bekçi (`tools/windows/imza-bekcisi.js`, launchd 30 dk)
Bekleyen yoksa hiçbir şeye dokunmaz. Yuva yoksa: VPN ayaktaysa `impark-diskler.sh --sessiz` (yalnız
disk); VPN kapalıysa yalnız parolasız sudo varsa (parola penceresi açılmaz). Yuva varsa en eskiden:
presign yoklaması (kira bizde mi) → `imzaliYayinZinciri` (runner'la AYNI imza kilidi) →
`postResultSuccess` → `yayinlandi/`. KALDI → `reddedildi/`. Bildirim `bildir paket … -p yuksek`.

## Sunucu (book-update) — ÖNERİ, uygulanmadı
Bugün `/release` (canlı, `bu-birakret` eeaaa87) kirayı `KIRA_BIRAK_SQL` ile bırakır (status queued,
leased_by_agent NULL) ve bu ajanı 10→60 dk dışlar; `/result`, `/result/presign`, multipart uçları
`leased_by_agent = agentId` arar → kira bırakılmış satırda bekçi 409 alır. Ara çözüm (kodda): runner
yeniden kiraladığında hazır paketi kendisi imzalar/yayınlar.

En küçük değişiklik (tek dosya + koruma listesi):
1. `routes/agent/build-agents.ts` `/release`: gövdede `durum === 'imza-bekliyor'` ise
   `UPDATE pipeline_platform_summaries SET current_phase='imza-bekliyor', lease_expires_at=NULL,
   last_error=?, last_run_at=NOW() WHERE book_id=? AND platform='windows' AND leased_by_agent=?
   AND status='running' AND deleted_at IS NULL` — `status='running'` ve `leased_by_agent` KORUNUR,
   `ertelemeKaydet` çağrılmaz.
   - Claim (`ajan-claim-sql.ts`) satırı ALMAZ: `status='queued' OR (running AND lease_expires_at<NOW())`
     ve `leased_by_agent IS NULL OR lease_expires_at<NOW()` — NULL süreyle ikisi de yanlış.
   - stale-recovery `lease_expires_at IS NOT NULL` aradığı için satırı kurtarmaz.
2. `stale-recovery.ts` `KORUNAN_FAZLAR`'a `'imza-bekliyor'` ekle (faz artığı temizliği zaten
   `leased_by_agent dolu + lease_expires_at NULL`'u koruyor; açık liste niyeti belgeler).
3. Bekçi aynı ajan jetonuyla (`token.json`) presign + `/result completed` çağırır; `/result`
   kirayı ve fazı temizler — ek değişiklik gerekmez.
4. Panel: `imza-bekliyor` fazını "İmza bekliyor" diye göster; panel "yeniden kuyruğa al" bugünkü
   gibi satırı sıfırlar (tutma biter, runner sıradaki kiralamada hazır kaydı devralır).
Test: `build-agents.release.test.ts` — hold sonrası next-job satırı vermez; aynı ajan presign 200,
başka ajan 409; `/result completed` sonrası faz NULL.

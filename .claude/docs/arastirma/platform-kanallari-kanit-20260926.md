# Platform Kanalları — Kanıt Ayrıntısı (26.09.2026)

> Kaynak: `platform-kanallari-sozlesmesi.md` 150 satıra indirilirken (26.09, oturum 006cff11)
> buraya taşınan tarihli ölçüm/kanıt ayrıntıları. Sözleşmedeki kararların, kapı değerlerinin ve
> KARARLANDI maddelerinin hiçbiri burada değil — onlar sözleşmede kalır. Bu dosya yalnız
> "hangi ölçüm hangi sayıyı verdi" sorusuna cevap verir.

## Kanıt tabanı (sözleşme taslağının dayandığı anlık durum)
HEAD `b363059`, canlı 3001 `2484677` (`/api/health`, 09:24Z başladı), DB `pipeline-sql` 26.09 13:05,
`~/.empp-agent/agent.log` 26.09. `book-update/.claude/docs/pardus-hatti-sozlesmesi.md` (23.09) kararları
§Pardus şeridi'ne bağlandı.

## "Üret, bekle, onaylanınca yayınla" — ilk canlı sonuçlar
İlk canlı sonuçlar: 73768 mac ÖLÇÜLEMEDİ (25 sn, NODE_OPTIONS arızası, d5add17 ile düzeldi); 72378 android RED
(Electron katmanı GEÇTİ, emülatörde "ekranda içerik yok"); 59835 android GEÇTİ (270 sn). Yanlış-pozitif oranı
ÖLÇÜLMEDİ.

## SET paketleri — 26.09 saha
59835 SM2 Set: pardus ProBook GEÇTİ, android GEÇTİ, mac noterli (kabul öncesi). 73768: pardus GEÇTİ, mac yeniden
kuyrukta (`agent.log`).

## Veri ve sınırlar (ölçülen değerler norm değildir; `agent.log` 26.09)
- mac: 72380 tek kitap 5 dk 20 sn / 0,41 GB · 59834 set 12 dk 38 sn / 1,46 GB · 59835 set 59 dk 49 sn / 0,78 GB
  (noter dahil).
- android: 73768 5 dk 15 sn / 0,67 GB (kabulsüz) · 59835 6 dk 32 sn / 0,69 GB (kabul 270 sn) · 72378 kabul RED
  348 sn (emülatör açılışı 73 sn, kurulum 156 sn).
- pardus: 72380 5 dk 23 sn / 0,34 GB (ProBook 248 sn) · 73768 10 dk 14 sn / 0,74 GB (80 sn) · 59835 7 dk 12 sn /
  0,70 GB (313 sn). Bloktest 2,2 GB: Mac Docker 1025 sn, ProBook yerli 367 sn, yerel kabul 51 sn
  (`pardus-seridi-probook-plani…:8-20`, `sozlesme.md:32`).
- R2: 300 MB üstü çok parçalı, 64 MB parça (`runner.js:389-390`); ofiste 25 MB/s, dışarıda 4 MB/s
  (`run-agent.sh:94-97`).

## Eskiyen belgeler (dosya:satır → ne değişmeli)
- ~~`sozlesme.md:26,32,36,117`~~ düzeltildi (26.09, bu oturum): disk kapısı/ProBook durumu/kabul kapısı/başsız
  kabul canlı değeri.
- `book-update/.claude/docs/masaustu-mobil-paketleme.md:11` Android ajanı Server21 → Mac ajanı (Server21 son
  nabız 09-09).
- `…/masaustu-mobil-paketleme.md:12` kaynak `/Uploads/KitapTekExe` → köprü R2 (`build-agents.ts:289-300`), hedef
  build zip.
- `book-update/.claude/docs/paket-yapilari-tek-kitap-vs-set.md:60-61` "tüm SET paketleri açılmıyor" → bu belge
  §SET.
- `book-update/.claude/docs/pardus-hatti-sozlesmesi.md:16-28` → 24.09 ProBook kararları ve bu belge §Pardus
  şeridi'ne bağlanmalı.
- `uretim-masasi-mac/docs/sozlesmeler/04-bu-mac-guncelleme.md:70` ve `05-yayinla.md:63` "Pardus her zaman bu
  Mac'te" → hazır devralma + ProBook.
- `book-update/CLAUDE.md:124` (SET açılmıyor) ve `:131` (noter onaysız dmg) → bu belge; noter artık zorunlu.

## ProBook şeridi — kuru koşu ve parite (26.09, 13acb01; `birlesik-20260926`'ya birleşti)
- Ajan raporu: 431/431 test, 18/18 mutasyon. Kuru koşu 73581 (742 MB → 803 MB): ProBook derleme 120 sn, yerel
  kabul 42 sn, kaynak hazırken kabul dahil ~170 sn. Mac Docker aynı boy sınıfında derleme 79-93 sn, uzak kabul
  79-376 sn. Bulut CDN → ProBook 40 MB/s, LAN rsync 9,3 MB/s; evden Tailscale DERP rölesi 0,18 MB/s (aktarım
  bu yüzden yalnız LAN).
- K kanalı sapması: a0cc28d Mac Docker şeridinde K'yı açtı (`PARDUS_ICERIK_GUNCELLEME:-linux`), yerel şerit 0
  geçiyordu; agent-mode'da `pardus-yerel-build.test.js` bu yüzden kırmızıydı. 13acb01 iki şeride aynı ifadeyi
  verdi.
- Kaynak: `~/.empp-agent/arastirma/probook-serit-hazirlik-20260926.md`.

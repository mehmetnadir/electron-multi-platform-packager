# Devam Notu — 2026-09-20 (ara verildi: Mac kapağı kapanıyor)

> Koordinatör (`nadir-99`) ara talebi üzerine güvenli duruş. Nadir "devam edin"
> dediğinde buradan sürdürülür.

## Bu oturumda BİTEN (hepsi commitli, dal: `agent-mode`)

| Commit | İş |
|---|---|
| `a9091a5` | Windows kabul kapısı: karar modülü + guest izleyici + host sürücü (parolasız) |
| `bb53314` | VM köprüsü HTTP'ye alındı — Apple Silicon + Win11 ARM'da paylaşılan klasör YOK (12 test) |
| `282478b`,`59bac78` | Köprü doğrulama belgesi; `curl` 000'in gerçek sebebi **macOS sistem vekili** (`--noproxy '*'`), `lsof` ile "yalnız bridge*" kanıtı |
| `293d6cc`,`35fbe0c` | Sözleşmeye Windows kapısı + K27 işlevleri |
| `623aa23` | **K27** — "Kitap Açılıyor.." kalktı, güvence 5000→0 ms (22 test, 15/15 mutant) |
| `558cf74` | setId kararı plana yazıldı (panel üretir / elle girilebilir / global tekil / değişmez) |
| `482c31f` | VM kapısına çakışma koruması + `installer-bilgilendirme` testinin kök nedeni |

Tam paket: **672 test, 0 hata, 4 atlanan** (iki ardışık koşuda).

## PUSH EDİLMEDİ — bilerek
`agent-mode` dalında **10 commit** push bekliyor. Push için Nadir'in onayı gerekir;
koordinatör (eş oturum) onay yerine geçmez. Dönünce tek cümlelik onayla gönderilir:
`git push origin agent-mode`.

## Üretilen paket
`~/Downloads/sm4-windows-exe/SM4-K27-HEMEN-ACILIR.exe` (1299 MB) + `OKU-K27.txt`.
Pakette doğrulandı: "Kitap Açılıyor" **0**, 5 sn güvence **0**, işaret 10,
"Kitap Güncelleniyor" 5 (korundu). Yanındaki `SM4-K27-WEBPSIZ-KIYAS.exe` (1421 MB)
yalnız kıyas kaydı — **test için kullanılmaz**.

## Kaldığım yer / sıradaki adım
1. **Nadir K27 exe'sini deneyecek.** Bulgu gelirse ilk iş o.
2. **VM kapısı tek elle adımı bekliyor:** misafirde izleyici bir kez başlatılacak
   (komut `tools/windows/OKU.md`'de). Sonra exe kurulumu+açılışı VM'de otomatik
   doğrulanabilir. VM şu an **çalışıyor ve penceresi açık** (Nadir'de).
3. Hat C menüsü kararı Nadir'de: özel menüye dokunmadan "besleme" önerisi sunuldu
   (bkz. sohbet + `paket-guncelleme-plani-2026-09-20.md` §4/7).
4. ProBook (Pardus) K24-K27 doğrulaması — makine ağda değil (.55/.70 yanıtsız).
5. Katman 0-1-2 (panelde paket kaydı + manifest + güncelleme ucu) — setId kararı
   geldiği için başlanabilir.

## Bu Mac'te koşanlar (kapak kapanınca UYUR)
| Süreç | Not |
|---|---|
| `node src/server/app.js` (pid 52551, :3001) | **`EMPP_SAYFA_WEBP=1` ile başlatıldı** — restart edilirse bu bayrak TEKRAR verilmeli, yoksa paket 122 MB şişer |
| `node src/agent/runner.js` (pid 25842, `caffeinate -i`) | Mac paketleme ajanı; duraklatma bayrağı KALDIRILDI, iş alıyor |
| `node tools/windows/vm-kopru-sunucu.js` (pid 5746, :8791) | VM köprüsü, yalnız bridge100/101 |
| Windows 11 ARM VM | çalışıyor, penceresi açık |

Sızan bir `node --test` süreci (vm-kopru testinden kalma) bulundu ve kapatıldı.

## srv21'de (DEVAM EDER, kapaktan etkilenmez)
`/opt/lane-work` altında iki iş dizini (45550, 73581) duruyor; şu an **aktif
electron-builder yok** (pgrep 0). Mac ajanı uyuduğu için bu şeritlerin çıktısı
ancak Mac uyanınca devralınır — srv21 tarafında veri kaybı olmaz.

## Açık ajan
`webz-performans` (Web-Z set sayfası performans ölçümü) — güvenli noktada durması
ve raporlaması istendi. Kendi deposunda (`book-update/services/cloudflare-worker`)
çalışıyor; bu depoya dokunmuyor.

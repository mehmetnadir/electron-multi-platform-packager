# 2026-10-02 exe'siz geçiş artığı — karantina (Librarian §8)

Kalıcı silme: 2026-12-01 (60 gün). Önceki dalga: `_graveyard/2026-10-01-exe-kaynak/OKU.md`.

## Taşınanlar
| Eski yer | Mezar |
|---|---|
| `src/agent/runner-helpers.js` `lruSilinecekler` | `src/agent/runner-helpers-cikarilan.js` |
| `src/agent/runner-helpers.js` `kaynakCacheTavaniGb` | `src/agent/runner-helpers-cikarilan.js` |
| `src/agent/runner-helpers.test.js` lruSilinecekler testleri (6) | `src/agent/runner-helpers.test-cikarilan.js` |
| `src/agent/kaynak-cache-tavani.test.js` (tüm dosya) | `src/agent/kaynak-cache-tavani.test.js` |

## Kanıt
- Tek tüketici `runner.js` destructure importuydu; çağrı yok (03f3ca7'de `cacheTavaniUygula` ve çağıran dallar karantinaya gitti).
- `~/.empp-agent/run-agent.sh` ve `packager-only.sh`: yalnız yorum satırı; `EMPP_CACHE_CAP_GB/KAT/TABAN/UST_SINIR_PAYI` hiçbir yerde export edilmiyor, src'de okunmuyor.
- `src/`, `scripts/`, `tools/`, test mock, build betiği: başka referans yok.
- Gerekçe: `git log -S` → d1c9ebe (LRU tavanı, 09-13), 9faf963 (boyut-orantılı tavan, 09-21); ikisi de EMPP_SOURCE_CACHE exe-türevi cache içindi, 03f3ca7 ile bu cache kalktı.

## Geri alma
Fonksiyonları `runner-helpers.js`'e geri yapıştır + export et; testleri geri taşı.

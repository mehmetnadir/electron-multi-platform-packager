'use strict';
/**
 * KÖK NEDENİ KORUYAN HATA ÖZETİ — saf fonksiyon (2026-09-26).
 *
 * KÖK NEDEN: `~/.empp-agent/agent.log`'daki "job failed: <id> <platform> - <sebep>"
 * özet satırı `agHatasiOzeti` ile BAŞTAN 200 karaktere kırpılıyordu. Kabul
 * kapılarının attığı hatalarda asıl sebep mesajın SONUNDA:
 *   `pardus paketi ProBook kabul kapısından geçemedi (rc=1): [kabul] olcum 4/4: …
 *    | [kabul] RED: pencere acildi ama ICERIK YOK …`
 * 11845 pardus (26.09) log satırı "[kabul] RED: pencere ac…" diye kesildi — sebep
 * kayboldu.
 *
 * Kural:
 *   - boş / null / yalnız boşluk → 'bilinmeyen hata'
 *   - tek satıra indirilmiş metin `maxLen` (600) içindeyse AYNEN (kırpma yok)
 *   - daha uzunsa: satırlara (gerçek `\n` + kod tabanının `" | "` ayıracı) böl,
 *     SONDAN başlayarak "RED:", "HATA", "BAYAT" ya da "Error"/"ERROR"/"error"
 *     geçen İLK satırı (= mesajın son anlamlı satırı) özetin BAŞINA koy, kalan
 *     tavanı mesajın başıyla doldur. İşaret yoksa baştan kırp.
 *   - çıktı her durumda tek satır ve ≤ `maxLen` karakter.
 *
 * @param {string|null|undefined} mesaj
 * @param {number} [maxLen=600]
 * @returns {string}
 */

const KOK_NEDEN_DESENI = /RED:|HATA|BAYAT|Error|ERROR|\berror\b/;
const AYIRAC = ' | ';
const KIRPMA = '…';

/** Ham metni "satır" birimlerine böler — gerçek satır sonları + " | " ayıracı. Saf. */
function satirlaraAyir(ham) {
  return String(ham)
    .split(/\r?\n/)
    .flatMap((s) => s.split(AYIRAC))
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/** Metni `n` karaktere sığdırır; kırptıysa son karakter '…'. Saf. */
function sigdir(metin, n) {
  if (metin.length <= n) return metin;
  if (n <= 0) return '';
  return `${metin.slice(0, n - 1)}${KIRPMA}`;
}

function hataOzeti(mesaj, maxLen = 600) {
  const sinir = Number.isFinite(maxLen) && maxLen > 0 ? Math.floor(maxLen) : 600;

  if (mesaj == null) return 'bilinmeyen hata';
  const ham = String(mesaj);
  const duzMesaj = ham.replace(/\s+/g, ' ').trim();
  if (!duzMesaj) return 'bilinmeyen hata';
  if (duzMesaj.length <= sinir) return duzMesaj;

  // Tavan aşılıyor — kök nedeni taşıyan SON satırı ara.
  const satirlar = satirlaraAyir(ham);
  let kokSatiri = null;
  for (let i = satirlar.length - 1; i >= 0; i--) {
    if (KOK_NEDEN_DESENI.test(satirlar[i])) { kokSatiri = satirlar[i]; break; }
  }

  if (!kokSatiri) return sigdir(duzMesaj, sinir);

  // Kök satırı + ayıraç + başlangıç bağlamı; bağlam için 20 karakterden az yer
  // kalırsa yalnız kök satırı (gerekirse o da kırpılarak).
  const baglamTavani = sinir - kokSatiri.length - AYIRAC.length;
  if (baglamTavani < 20) return sigdir(kokSatiri, sinir);
  return `${kokSatiri}${AYIRAC}${sigdir(duzMesaj, baglamTavani)}`;
}

module.exports = { hataOzeti, KOK_NEDEN_DESENI };

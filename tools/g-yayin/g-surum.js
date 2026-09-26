'use strict';

/**
 * G SÜRÜMÜ — sözleşme G3 (`windows-paketleme-sozlesmesi.md` madde 1 + G3):
 * `2.<panel kodu>.<paket sayacı>`, MONOTON.
 *
 * NEDEN MONOTON: uzaktan güncelleme (G) istemcisi yerelde duran örtüyü/damgayı ancak
 * daha YENİ bir sürümle değiştirir (platform-kanallari O3: "daha yeni örtü varsa onu
 * yükler"). İçerik-hash sürümü sıralanamaz (`surum-turet.js`, Pardus AppRun arızası);
 * bu yüzden G sürümü sayı üçlüsüdür ve karşılaştırma sayısaldır (2.51.10 > 2.51.9).
 *
 * SAYAÇ ALANI PAKETLE ORTAK: kurulu paketin kendi sürümü de `2.<panel>.<sayaç>`'tır.
 * İlk G yayını kurulu paketin sürümünden BÜYÜK olmalı; yoksa geri-alma korumalı
 * istemci güncellemeyi reddeder. `sonraki()` bunu `onceki` alanıyla sağlar.
 *
 * Saf modül: dosya sistemine/ağa dokunmaz.
 */

/** Baştaki sıfır yok, en çok 9 hane (Number.MAX_SAFE_INTEGER altında kalır). */
const DESEN = /^2\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/;

/** `"2.51.4"` → `{ana:2, panel:51, sayac:4}`; biçim dışıysa `null`. */
function coz(s) {
  if (typeof s !== 'string') return null;
  const m = DESEN.exec(s.trim());
  if (!m) return null;
  return { ana: 2, panel: Number(m[1]), sayac: Number(m[2]) };
}

function gecerliMi(s) {
  return coz(s) !== null;
}

function metin(n) {
  return `2.${n.panel}.${n.sayac}`;
}

/** a<b → -1, a=b → 0, a>b → 1. İkisi de G3 biçiminde olmalı; değilse HATA. */
function kiyasla(a, b) {
  const x = typeof a === 'string' ? coz(a) : a;
  const y = typeof b === 'string' ? coz(b) : b;
  if (!x || !y) throw new Error(`G3 biçiminde olmayan sürüm kıyaslanamaz: ${a} / ${b}`);
  if (x.panel !== y.panel) return x.panel < y.panel ? -1 : 1;
  if (x.sayac !== y.sayac) return x.sayac < y.sayac ? -1 : 1;
  return 0;
}

/** Listede G3 biçimindeki en büyük sürüm; hiç yoksa `null`. Biçim dışılar yok sayılır. */
function enBuyuk(liste) {
  let en = null;
  for (const s of Array.isArray(liste) ? liste : []) {
    if (!gecerliMi(s)) continue;
    if (en === null || kiyasla(s, en) > 0) en = s.trim();
  }
  return en;
}

/**
 * Panel kodunu çözer: sayı (`51`, `"51"`) ya da kitap adı (`"SM2-MMv51"` → 51; son `vNN`).
 * Çözülemezse `null`.
 */
function panelKoduCoz(ham) {
  if (typeof ham === 'number') return Number.isInteger(ham) && ham >= 0 ? ham : null;
  const s = String(ham == null ? '' : ham).trim();
  if (/^(0|[1-9]\d{0,8})$/.test(s)) return Number(s);
  const hepsi = s.match(/v(\d{1,9})(?!\d)/gi);
  if (!hepsi || !hepsi.length) return null;
  const n = Number(hepsi[hepsi.length - 1].slice(1));
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * Sıradaki sürüm. `onceki` bilinen en büyük sürümdür (yoksa null).
 *   - önceki yok            → `2.<panel>.1`
 *   - panel > önceki.panel  → `2.<panel>.1`
 *   - panel = önceki.panel  → `2.<panel>.<sayaç+1>`
 *   - panel < önceki.panel  → HATA (geri gider)
 */
function sonraki(panel, onceki) {
  const p = panelKoduCoz(panel);
  if (p === null) throw new Error(`panel kodu çözülemedi: ${panel}`);
  if (onceki == null) return metin({ panel: p, sayac: 1 });
  const o = coz(onceki);
  if (!o) throw new Error(`önceki sürüm G3 biçiminde değil: ${onceki}`);
  if (p > o.panel) return metin({ panel: p, sayac: 1 });
  if (p === o.panel) return metin({ panel: p, sayac: o.sayac + 1 });
  throw new Error(`panel kodu geri gidiyor: ${p} < önceki ${o.panel} (${onceki})`);
}

/** `yeni` bütün öncekilerden KESİN büyük mü? Değilse HATA; öncekiler boşsa geçer. */
function monotonDenetle(yeni, oncekiler) {
  if (!gecerliMi(yeni)) throw new Error(`sürüm G3 biçiminde değil (2.<panel>.<sayaç>): ${yeni}`);
  const en = enBuyuk(oncekiler);
  if (en !== null && kiyasla(yeni, en) <= 0) {
    throw new Error(`sürüm monoton değil: ${yeni} ≤ bilinen son sürüm ${en}`);
  }
  return en;
}

module.exports = {
  DESEN,
  coz,
  gecerliMi,
  kiyasla,
  enBuyuk,
  panelKoduCoz,
  sonraki,
  monotonDenetle,
};

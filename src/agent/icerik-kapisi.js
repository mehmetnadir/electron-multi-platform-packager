'use strict';

/**
 * İÇERİKSİZ KAYNAK KAPISI (2026-09-26) — bkz. `~/.empp-agent/arastirma/set-koku-ezilmis-kok-neden-20260926.md`.
 *
 * NEDEN: 11845 (Super Monsters 3 Set) İmpark canlısındaki `SM3-v49.exe` yalnız MOTORU
 * taşıyordu — kökte `assets/` yoktu, hiç `bookN/` dizini yoktu. Bizim işleme adımlarımızdan
 * (`publisher-update.js`, `set-menu.js`, `kok-index-denetimi.js`) HİÇBİRİ kitap içeriğini
 * ezmedi; kaynağın kendisinde içerik hiç yoktu. Yine de paket üretilip ProBook'a kadar
 * gitti (91 sn kabul + notarize boşa harcandı) ve RED sonucu geç, pahalı geldi; canlıda da
 * içeriksiz mac/apk yayınlandı (11845, 45551-v50).
 *
 * BU MODÜLÜN İŞİ: kaynak açıldıktan (extractSfx/findBuildDir) hemen SONRA, paketlemeye
 * (zipDir/upload) GİRMEDEN önce kökte gerçek kitap içeriği olup olmadığını ölçmek.
 *   - Tek kitap kaynağı kökte `assets/<id>/...` taşır.
 *   - SET kaynağı kökte `book1/`, `book2/`, … (`book\d+`) dizinleri taşır.
 *   - İkisi de yoksa kaynak yalnız motor/okuyucu kabuğudur — iş GÖRÜNÜR hata ile düşer,
 *     paketlemeye hiç girilmez, R2'ye hiçbir şey yüklenmez.
 *
 * `degerlendir` SAF fonksiyondur (dosya sistemine dokunmaz) — testte sentetik bayraklarla
 * çağrılır. `dizinTara`/`icerikKapisiDenetle` gerçek dizini okuyan ince sarmalayıcıdır.
 *
 * BAĞIMLILIK KURALI: yalnız Node stdlib.
 */

const fsp = require('fs/promises');

const KAPI_ISARETI = '[kaynak-iceriksiz]';

/** Kök dizin girdisi bir SET kitap dizini mi? (`book1`, `book12`, büyük/küçük harf duyarsız). */
function bookNMi(adi) {
  return /^book\d+$/i.test(String(adi || ''));
}

/**
 * Saf değerlendirme: kökte `assets/` ya da en az bir `bookN/` dizini varsa geçer.
 *
 * @param {{ hasAssets?: boolean, hasBookN?: boolean, kaynakAdi?: string }} [girdi]
 * @returns {{ gecti: boolean, sebep: string|null }}
 */
function degerlendir({ hasAssets = false, hasBookN = false, kaynakAdi = '' } = {}) {
  if (hasAssets || hasBookN) return { gecti: true, sebep: null };
  const etiket = kaynakAdi ? ` <${kaynakAdi}>` : '';
  return {
    gecti: false,
    sebep: `${KAPI_ISARETI} bookN 0, assets/ yok — İmpark exe'si ince${etiket} `
      + '(motor var, kitap içeriği yok; İmpark SET exe yeniden oluşturulmalı)',
  };
}

/**
 * `kok` dizininin KÖK seviyesini tarar (recursive değil — kural kökte aranır, rapor da
 * kök seviyesini ölçüyor). Dizin okunamazsa (yok/erişilemez) ikisi de `false` döner —
 * `degerlendir` bunu da içeriksiz sayar (paketlenecek hiçbir şey yoksa geçmemeli).
 *
 * @param {string} kok
 * @returns {Promise<{ hasAssets: boolean, hasBookN: boolean }>}
 */
async function dizinTara(kok) {
  let girdiler = [];
  try {
    girdiler = await fsp.readdir(kok, { withFileTypes: true });
  } catch (_) {
    girdiler = [];
  }
  const hasAssets = girdiler.some((g) => g.isDirectory() && g.name === 'assets');
  const hasBookN = girdiler.some((g) => g.isDirectory() && bookNMi(g.name));
  return { hasAssets, hasBookN };
}

/**
 * Çağrı noktası: `dizinTara` + `degerlendir`i sarar.
 *
 * @param {string} kok build dizini (extractSfx/findBuildDir çıktısı)
 * @param {{ kaynakAdi?: string }} [secenekler]
 * @returns {Promise<{ gecti: boolean, sebep: string|null }>}
 */
async function icerikKapisiDenetle(kok, { kaynakAdi = '' } = {}) {
  const tarama = await dizinTara(kok);
  return degerlendir({ ...tarama, kaynakAdi });
}

module.exports = {
  KAPI_ISARETI,
  bookNMi,
  degerlendir,
  dizinTara,
  icerikKapisiDenetle,
};

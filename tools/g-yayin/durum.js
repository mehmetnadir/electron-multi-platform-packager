'use strict';

/**
 * G DURUMU — önceki imzalı manifest + bu yayının değişiklikleri → YENİ TAM DURUM.
 *
 * NEDEN BİRİKİMLİ (delta değil): istemci bir sürümü atlayabilir (2.51.3 kurulu, 2.51.4
 * yayınlandığında çevrimdışı, 2.51.5'te açıldı). Manifest yalnız "bu yayında değişen"i
 * taşısaydı 2.51.4'teki motor ya da kitap eklemesi o istemciye HİÇ ulaşmazdı. Bu yüzden
 * manifest G'nin yönettiği her şeyin SON HÂLİDİR; aktarım deltası istemcide olur
 * (sha256'sı yerelle aynı dosya indirilmez — G3 "yalnız değişen dosyalar"). Örtü (O3)
 * modelinde örtü = tam olarak bu manifestin içeriği.
 *
 * G KAPSAMI (Nadir 26.09): kök `index.html`, set bileşimi (kitap ekle/çıkar) ve
 * `bookN/43e23fce2b7009474555a77.js`. Set bileşimi MENÜYÜ de kapsar (2026-09-26): kartlar
 * Web-Z kabuğunda `index.html`'de değil `MENU_YOLLARI`'nda yazılıdır; `--ekle`/`--cikar` onları
 * günceller (`menu.js`). Kapsam dışı bir yol önceki manifestte bile olsa RED (sessiz taşıma yok).
 *
 * Saf modül (yalnız `kitap-guncelleyici`'nin saf yol-güvenliği yardımcısını kullanır —
 * ağ/fs YOK).
 */

const kg = require('../../src/runtime/kitap-guncelleyici');

const MOTOR_DOSYA_ADI = '43e23fce2b7009474555a77.js';
const INDEX_YOLU = 'index.html';
/**
 * Web-Z (sf425) menü dosyaları — kartlar `index.html`'den DEĞİL bunlardan çizilir
 * (Üretim Masası `WebZTemaUretici.swift`): `file://` altında tema `config/settings.json`'ı
 * `fetch` edemez, `cevrimdisi-yama.js` içindeki gömülü `window.__setSettings` döner; http'de
 * (Web-Z/Android) dosyanın kendisi okunur; `set-menu.json` masaüstünün menü tanımıdır (kabul
 * araçları kitap adlarını oradan okur). K17 (paketleyici) menüsünde kartlar `index.html`'dedir.
 */
const MENU_WEBZ_YAMA = 'scripts/cevrimdisi-yama.js';
const MENU_WEBZ_AYAR = 'config/settings.json';
const MENU_MASA_TANIMI = 'set-menu.json';
const MENU_YOLLARI = Object.freeze([MENU_WEBZ_YAMA, MENU_WEBZ_AYAR, MENU_MASA_TANIMI]);
const KITAP_DIZIN_DESENI = /^book\d+$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

function siraliAnahtar(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Yol G kapsamında mı: `index.html`, menü dosyası (`MENU_YOLLARI`) ya da `bookN/43e23….js`. */
function gYoluMu(yol) {
  if (yol === INDEX_YOLU || MENU_YOLLARI.includes(yol)) return true;
  const p = String(yol).split('/');
  return p.length === 2 && KITAP_DIZIN_DESENI.test(p[0]) && p[1] === MOTOR_DOSYA_ADI;
}

function motorYolu(dizin) {
  return `${dizin}/${MOTOR_DOSYA_ADI}`;
}

function ozetGecerliMi(o) {
  return (
    !!o &&
    typeof o.sha256 === 'string' &&
    SHA256_RE.test(o.sha256) &&
    Number.isSafeInteger(o.boyut) &&
    o.boyut >= 0
  );
}

function kitapDiziniDenetle(d, ne) {
  if (typeof d !== 'string' || !KITAP_DIZIN_DESENI.test(d)) {
    throw new Error(`${ne}: kitap dizini book<N> biçiminde olmalı: ${JSON.stringify(d)}`);
  }
}

/**
 * Bir arşiv-içi dosya girdisi geçerli mi: `yol` arşiv köküne göreli ve güvenli
 * (`..`/mutlak/boş segment RED — `kg.yolGuvenliMi`), `sha256`+`boyut` tam.
 * Bu, imzalı `kitaplar[].dosyalar[]` girdisinin biçimsel doğrulamasıdır (K1'deki yol
 * kaçışı denetimiyle AYNI kaynak — iki ayrı yol-güvenliği reddedicisi tutmak yasak).
 */
function dosyaGirdisiGecerliMi(g) {
  return !!g && typeof g.yol === 'string' && g.yol !== '' && kg.yolGuvenliMi(g.yol) && ozetGecerliMi(g);
}

/** `dosyalar[]` listesi: dizi, en az bir girdi, hepsi geçerli. */
function dosyalarGecerliMi(liste) {
  return Array.isArray(liste) && liste.length > 0 && liste.every(dosyaGirdisiGecerliMi);
}

/**
 * Önceki manifestin G durumunu okur. Kapsam dışı / bozuk girdi → HATA.
 * @returns {{kabuk: Map<string,object>, kitaplar: Map<string,object>}}
 */
function oncekiDurum(onceki) {
  const kabuk = new Map();
  const kitaplar = new Map();
  if (!onceki) return { kabuk, kitaplar };
  for (const g of Array.isArray(onceki.kabuk) ? onceki.kabuk : []) {
    if (!g || !gYoluMu(g.yol) || !ozetGecerliMi(g)) {
      throw new Error(
        'önceki manifestte G kapsamı dışında ya da bozuk kabuk girdisi: ' +
          JSON.stringify(g && g.yol),
      );
    }
    kabuk.set(g.yol, { yol: g.yol, sha256: g.sha256, boyut: g.boyut });
  }
  for (const g of Array.isArray(onceki.kitaplar) ? onceki.kitaplar : []) {
    if (!g || typeof g.dizin !== 'string' || !KITAP_DIZIN_DESENI.test(g.dizin)) {
      throw new Error(`önceki manifestte bozuk kitap girdisi: ${JSON.stringify(g && g.dizin)}`);
    }
    if (g.durum === 'cikar') kitaplar.set(g.dizin, { dizin: g.dizin, durum: 'cikar' });
    else if (
      g.durum === 'ekle' &&
      ozetGecerliMi(g) &&
      typeof g.kaynak === 'string' &&
      (g.dosyalar === undefined || dosyalarGecerliMi(g.dosyalar))
    ) {
      kitaplar.set(g.dizin, {
        dizin: g.dizin,
        durum: 'ekle',
        kaynak: g.kaynak,
        sha256: g.sha256,
        boyut: g.boyut,
        ...(g.dosyalar !== undefined ? { dosyalar: g.dosyalar } : {}),
      });
    } else throw new Error(`önceki manifestte bozuk kitap girdisi: ${g.dizin}`);
  }
  return { kabuk, kitaplar };
}

/**
 * @param {object|null} onceki  doğrulanmış önceki manifest (yoksa null — ilk yayın)
 * @param {object} d  değişiklikler:
 *   `index`    {sha256, boyut} | undefined
 *   `motorlar` {bookN: {sha256, boyut}}
 *   `ekle`     {bookN: {kaynak, sha256, boyut}}
 *   `cikar`    [bookN]
 *   `menu`     {<MENU_YOLLARI'ndan yol>: {sha256, boyut}} — `--ekle`/`--cikar`'ın menüye yansıması
 *   `dusur`    [G yolu] — önceki imzalı durumdaki kabuk girdisini ÇIKARIR (`--dusur`). Girdi
 *              manifestten düşünce istemci o yol için paketin KENDİ kopyasını kullanır (örtü
 *              `ortuCoz` → null). Önceki durumda olmayan yol, aynı yayında yeniden yazılan yol
 *              (`--index`/`--motor`/menü) ve G kapsamı dışı yol RED — sessiz no-op yok.
 * @returns {{kabuk:object[], kitaplar:object[], ozet:{degisenKabuk:string[], dusenKabuk:string[],
 *   degisenKitap:string[], tasinanKabuk:string[]}}}
 */
function birlestir(onceki, d) {
  const deg = d || {};
  const motorlar = deg.motorlar || {};
  const ekle = deg.ekle || {};
  const cikar = Array.isArray(deg.cikar) ? deg.cikar : [];
  const menu = deg.menu || {};
  const dusur = Array.isArray(deg.dusur) ? [...new Set(deg.dusur)] : [];

  for (const k of Object.keys(motorlar)) kitapDiziniDenetle(k, '--motor');
  for (const k of Object.keys(ekle)) kitapDiziniDenetle(k, '--ekle');
  for (const k of cikar) kitapDiziniDenetle(k, '--cikar');
  const cikarKume = new Set(cikar);
  for (const k of Object.keys(ekle)) {
    if (cikarKume.has(k)) throw new Error(`${k} aynı yayında hem ekleniyor hem çıkarılıyor`);
  }
  for (const k of Object.keys(motorlar)) {
    if (cikarKume.has(k)) throw new Error(`${k} çıkarılıyor; aynı yayında motoru güncellenemez`);
  }
  if (deg.index !== undefined && !ozetGecerliMi(deg.index)) throw new Error('index özeti bozuk');
  for (const [k, v] of Object.entries(motorlar))
    if (!ozetGecerliMi(v)) throw new Error(`${k} motor özeti bozuk`);
  for (const [y, v] of Object.entries(menu)) {
    if (!MENU_YOLLARI.includes(y)) throw new Error(`menü yolu G kapsamında değil: ${y}`);
    if (!ozetGecerliMi(v)) throw new Error(`${y} menü özeti bozuk`);
  }
  for (const y of dusur) {
    if (!gYoluMu(y)) throw new Error(`--dusur: yol G kapsamında değil: ${JSON.stringify(y)}`);
    const yazilan =
      (y === INDEX_YOLU && deg.index !== undefined) ||
      Object.keys(motorlar).some((k) => motorYolu(k) === y) ||
      Object.prototype.hasOwnProperty.call(menu, y);
    if (yazilan) throw new Error(`--dusur ${y}: aynı yayında yeniden yazılıyor (çelişki)`);
  }
  for (const [k, v] of Object.entries(ekle)) {
    if (!ozetGecerliMi(v) || typeof v.kaynak !== 'string' || !v.kaynak)
      throw new Error(`${k} arşiv özeti bozuk`);
    if (v.dosyalar !== undefined && !dosyalarGecerliMi(v.dosyalar))
      throw new Error(`${k} dosyalar listesi bozuk`);
  }
  if (
    deg.index === undefined &&
    !Object.keys(motorlar).length &&
    !Object.keys(ekle).length &&
    !cikar.length &&
    !Object.keys(menu).length &&
    !dusur.length
  ) {
    throw new Error('değişiklik yok: --index, --motor, --ekle, --cikar ya da --dusur verin');
  }

  const eski = oncekiDurum(onceki);
  const kabuk = new Map(eski.kabuk);
  const kitaplar = new Map(eski.kitaplar);

  for (const y of dusur) {
    if (!eski.kabuk.has(y)) {
      throw new Error(`--dusur ${y}: önceki imzalı durumda böyle bir kabuk girdisi yok`);
    }
    kabuk.delete(y);
  }

  for (const k of cikar) {
    kitaplar.set(k, { dizin: k, durum: 'cikar' });
    kabuk.delete(motorYolu(k));
  }
  for (const [k, v] of Object.entries(ekle)) {
    kitaplar.set(k, {
      dizin: k,
      durum: 'ekle',
      kaynak: v.kaynak,
      sha256: v.sha256,
      boyut: v.boyut,
      ...(v.dosyalar !== undefined ? { dosyalar: v.dosyalar } : {}),
    });
    // Yeni arşiv kendi motorunu taşır; eski (taşınan) motor girdisi onu ezmesin.
    kabuk.delete(motorYolu(k));
  }
  if (deg.index !== undefined)
    kabuk.set(INDEX_YOLU, { yol: INDEX_YOLU, sha256: deg.index.sha256, boyut: deg.index.boyut });
  for (const [k, v] of Object.entries(motorlar)) {
    kabuk.set(motorYolu(k), { yol: motorYolu(k), sha256: v.sha256, boyut: v.boyut });
  }
  for (const [y, v] of Object.entries(menu)) {
    kabuk.set(y, { yol: y, sha256: v.sha256, boyut: v.boyut });
  }

  const kabukListe = [...kabuk.values()].sort((a, b) => siraliAnahtar(a.yol, b.yol));
  const kitapListe = [...kitaplar.values()].sort((a, b) => siraliAnahtar(a.dizin, b.dizin));

  const degisenKabuk = kabukListe
    .filter((g) => {
      const o = eski.kabuk.get(g.yol);
      return !o || o.sha256 !== g.sha256 || o.boyut !== g.boyut;
    })
    .map((g) => g.yol);
  const tasinanKabuk = kabukListe.filter((g) => !degisenKabuk.includes(g.yol)).map((g) => g.yol);
  const dusenKabuk = [...eski.kabuk.keys()].filter((y) => !kabuk.has(y)).sort(siraliAnahtar);
  const degisenKitap = kitapListe
    .filter((g) => JSON.stringify(eski.kitaplar.get(g.dizin) || null) !== JSON.stringify(g))
    .map((g) => g.dizin);

  if (!degisenKabuk.length && !dusenKabuk.length && !degisenKitap.length) {
    throw new Error('önceki sürümle aynı içerik — yeni sürüm yayınlamak gereksiz');
  }
  return {
    kabuk: kabukListe,
    kitaplar: kitapListe,
    ozet: { degisenKabuk, tasinanKabuk, dusenKabuk, degisenKitap },
  };
}

module.exports = {
  MOTOR_DOSYA_ADI,
  INDEX_YOLU,
  MENU_WEBZ_YAMA,
  MENU_WEBZ_AYAR,
  MENU_MASA_TANIMI,
  MENU_YOLLARI,
  KITAP_DIZIN_DESENI,
  gYoluMu,
  motorYolu,
  dosyaGirdisiGecerliMi,
  dosyalarGecerliMi,
  oncekiDurum,
  birlestir,
};

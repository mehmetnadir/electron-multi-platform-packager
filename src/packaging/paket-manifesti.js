'use strict';

/**
 * KATMAN 1 — PAKET KİMLİK MANİFESTİ (`paket.json`).
 *
 * NEDEN (2026-09-20, Nadir): "ben pakete başka bir buton, başka bir kitap eklersem
 * ne olacak?" Kurulu bir exe'nin yeni bir kitabı/düzeni alabilmesi için önce
 * **kendini tanıtması** gerekir: hangi set, hangi sürüm, içinde hangi kitaplar var.
 * Bugün paketin içinde bunların HİÇBİRİ yok — ölçüldü (`.claude/docs/
 * paket-guncelleme-plani-2026-09-20.md` §"Kimlik envanteri"): kimlik yalnız
 * `ImWin32.dll`'in şifreli XML'inde, kitap bazında ve SET kimliği olmadan duruyor.
 *
 * NADİR'İN KARARI (setId):
 *   "setid sisteme kitabı eklerken girdiğim ya da eğer girmiyorsam otomatik üretilsin."
 * Yani: dışarıdan verilirse AYNEN yazılır, verilmezse burada üretilir. Üretilen
 * kimlik **global tekil** olmalı — kurum bazlı sayaç daha önce çakışan kimlik
 * üretmişti (memory: `zid-sayaci-kurum-bazli-tekillik-global`), o yüzden sayaç değil
 * rastgelelik kullanılır. Panel kimliği üretmeye başlayınca bu yalnızca yedek yoldur.
 *
 * NE YAZILIR: paket kökünde `paket.json`. Bilerek KÜÇÜK ve okunabilir tutuldu —
 * bunu ileride hem güncelleme ucu hem de (Hat C) manifest okuyan menü tüketecek.
 *
 * NE YAZILMAZ: içeriğin sha256'sı. 1,5 GB'lık sette tam hash paketleme süresine
 * dakikalar ekler; bütünlük parmak izi olarak dosya listesinin (yol+boyut) özeti
 * alınır — değişen tek sayfa bile bu özeti değiştirir, maliyeti ise saniyeler.
 */

const path = require('path');
const crypto = require('crypto');
const fs = require('fs-extra');
const { findSubBookDirs } = require('./sub-book-dirs');

const DOSYA_ADI = 'paket.json';
const SEMA_SURUMU = 1;

/** Kapı: varsayılan AÇIK. Kapatmak için EMPP_PAKET_MANIFESTI=0. */
function acikMi(env = process.env) {
  return env.EMPP_PAKET_MANIFESTI !== '0';
}

/** Ad → kimlikte kullanılabilir kısa sap. Türkçe harfler ASCII'ye indirilir. */
function sap(ad) {
  const harita = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', Ç: 'c', Ğ: 'g', İ: 'i', Ö: 'o', Ş: 's', Ü: 'u' };
  return String(ad || '')
    .replace(/[çğıöşüÇĞİÖŞÜ]/g, (c) => harita[c])
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || 'set';
}

/**
 * setId üretir. Panel vermediğinde kullanılır.
 * Biçim: `SET-<sap>-<12 hex>` — global tekil, sayaç YOK.
 */
function setIdUret(uygulamaAdi, rastgele = crypto.randomBytes(6).toString('hex')) {
  return `SET-${sap(uygulamaAdi)}-${String(rastgele).slice(0, 12)}`;
}

/** Dışarıdan gelen setId geçerli mi? (boşluk/kontrol karakteri/aşırı uzunluk yok) */
function setIdGecerliMi(deger) {
  return typeof deger === 'string'
    && deger.length > 0 && deger.length <= 128
    && /^[A-Za-z0-9._:-]+$/.test(deger);
}

/** Bir dizindeki dosyaların (yol, boyut) listesi — özyinelemeli, sıralı. */
async function dosyaDokumu(kok, goreliKok = '') {
  const sonuc = [];
  let girisler;
  try { girisler = await fs.readdir(kok, { withFileTypes: true }); }
  catch { return sonuc; }                       // okunamayan dizin paketlemeyi durdurmaz
  for (const g of girisler.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const tam = path.join(kok, g.name);
    const gor = goreliKok ? `${goreliKok}/${g.name}` : g.name;
    if (g.isDirectory()) {
      sonuc.push(...await dosyaDokumu(tam, gor));
    } else if (g.isFile()) {
      let boyut = 0;
      try { boyut = (await fs.stat(tam)).size; } catch { boyut = -1; }
      sonuc.push({ yol: gor, bayt: boyut });
    }
  }
  return sonuc;
}

/**
 * Dosya dökümünden bütünlük parmak izi — içerik OKUNMAZ, yol+boyut yeter.
 * `onek` (kitap dizini) özete katılır: dosya listesi birebir aynı olan iki farklı
 * kitap (ölçüldü: aynı iskeletten üretilmiş iki alt kitap) aksi hâlde AYNI izi
 * alırdı ve "bu kitap değişti mi?" sorusu yanlış cevaplanırdı.
 */
function parmakIzi(dokum, onek = '') {
  const ozet = crypto.createHash('sha256');
  if (onek) ozet.update(`#${onek}\n`);
  for (const d of dokum) ozet.update(`${d.yol}:${d.bayt}\n`);
  return ozet.digest('hex');
}

/**
 * Manifest nesnesini kurar (dosyaya YAZMAZ — saf, test edilebilir).
 * @param {{setId?:string, uygulamaAdi:string, uygulamaSurumu:string, kitaplar:Array,
 *          simdiMs?:number, uretici?:string, rastgele?:string}} g
 */
function manifestKur(g) {
  const {
    setId, uygulamaAdi, uygulamaSurumu, kitaplar = [],
    simdiMs = Date.now(), uretici = null, kurum = null, rastgele,
  } = g || {};
  const kimlik = setIdGecerliMi(setId) ? setId : setIdUret(uygulamaAdi, rastgele);
  const govde = {
    sema: SEMA_SURUMU,
    setId: kimlik,
    setIdKaynagi: setIdGecerliMi(setId) ? 'verildi' : 'uretildi',
    uygulamaAdi: String(uygulamaAdi || ''),
    uygulamaSurumu: String(uygulamaSurumu || ''),
    uretim: { zaman: new Date(simdiMs).toISOString(), uretici: uretici || null },
    // Kurum kimliği güncelleme ucunun yetkilendirmesi için gerekir; yoksa null
    // yazılır (alanı HİÇ yazmamak, tüketicide "alan yok mu, boş mu?" belirsizliği
    // üretir — memory: tablo-esleme-sessiz-varsayilan).
    kurum: { id: (kurum && kurum.id) || null, ad: (kurum && kurum.ad) || null },
    kitapSayisi: kitaplar.length,
    kitaplar: kitaplar.map((k) => ({
      dizin: k.dizin,
      dosyaSayisi: k.dosyaSayisi,
      bayt: k.bayt,
      parmakIzi: k.parmakIzi,
    })),
  };
  // Paket parmak izi = kitap parmak izlerinin sırayla özeti. Tek sayfa değişse
  // bile değişir; hiçbir içerik baytı okunmadan hesaplanır.
  const h = crypto.createHash('sha256');
  for (const k of govde.kitaplar) h.update(`${k.dizin}:${k.parmakIzi}\n`);
  govde.parmakIzi = h.digest('hex');
  return govde;
}

/**
 * Paket ağacını tarar, `paket.json` yazar.
 * @returns {{yazildi:boolean, sebep:string, manifest?:object}}
 */
async function paketeUygula(paketKoku, secenekler = {}) {
  const { log = () => {}, setId, uygulamaAdi, uygulamaSurumu, uretici, kurum } = secenekler;
  const hedef = path.join(paketKoku, DOSYA_ADI);

  // setId BİR KEZ yazılır ve DEĞİŞMEZ: kurulu exe'ler güncellemeyi onunla sorar.
  // Ağaçta zaten bir manifest varsa kimliği ondan devralınır.
  let mevcutSetId = null;
  try {
    const eski = JSON.parse(await fs.readFile(hedef, 'utf8'));
    if (setIdGecerliMi(eski.setId)) mevcutSetId = eski.setId;
  } catch { /* yok ya da bozuk — yenisi yazılır */ }

  const dizinler = await findSubBookDirs(paketKoku);
  const kitaplar = [];
  for (const d of dizinler) {
    const dokum = await dosyaDokumu(path.join(paketKoku, d));
    kitaplar.push({
      dizin: d,
      dosyaSayisi: dokum.length,
      bayt: dokum.reduce((t, x) => t + Math.max(0, x.bayt), 0),
      parmakIzi: parmakIzi(dokum, d),
    });
  }

  const manifest = manifestKur({
    setId: mevcutSetId || setId, uygulamaAdi, uygulamaSurumu, kitaplar, uretici, kurum,
  });
  await fs.writeFile(hedef, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  log(`   paket manifesti: ${manifest.setId} (${manifest.setIdKaynagi}) — `
    + `${manifest.kitapSayisi} kitap, parmak izi ${manifest.parmakIzi.slice(0, 12)}…`);
  return { yazildi: true, sebep: 'yazildi', manifest };
}

module.exports = {
  DOSYA_ADI, SEMA_SURUMU, acikMi, sap, setIdUret, setIdGecerliMi,
  dosyaDokumu, parmakIzi, manifestKur, paketeUygula,
};

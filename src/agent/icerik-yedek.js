'use strict';

/**
 * ÜYE KİTAP İÇERİĞİ — YEDEK KAYNAKLAR (2026-10-04, Nadir: "zip'i her zaman biz kendimiz oluşturuyoruz,
 * paket zip'i sorma"). İmpark'ın hazır `ZKitapZipH/<id>-<Vs>.zip`'i yoksa / başka kitabınsa / Data boşsa
 * üreteç (`index-ureteci.js` `icerikleriTopla`) içeriği BU kaynaklardan kurar. Setten kitap düşürmek
 * çözüm değildir; hiçbir kaynakta yoksa "ya hep ya hiç" aynen: build yazılmaz, sebep denenenlerle yazılır.
 *
 * Ölçümler (04.10, salt okuma):
 *   - `Uploads/WebDijitapDosyalar/<id>/` (Web-Z'nin proxy ettiği gevşek dosyalar) eksi `pages2X/` =
 *     `ZKitapZipH/<id>-<Vs>.zip` BİREBİR (33574: 2023 dosya, ad kümesi aynı, BookContent + thumbs md5 aynı).
 *     HTTP'de dizin listesi yok (403) → tam dosya kümesi yalnız SMB'den (`~/Impark/StorageN/vhosts/…`).
 *   - 11822: İmpark Data `ZKitapZipH/60-25685.zip` (404; dosya `ZKitapZip/` altında ve BookContent
 *     kitapId=06003144 = 73452 SHALL WE 6 — YANLIŞ KİTAP). Gerçek içerik `WebDijitapDosyalar/11822/`
 *     (kitapId 0602126 = S_TestKitaplar.ZKitapId), Web-Z de oradan sunuyor.
 *
 * SÖZLEŞME — her yedek `{ ad, getir(c) }`; `getir` şunu döner:
 *   { zip, kaynakId, vs, url?, not? }  — kaynakId = kaynağın içeriği SAKLADIĞI kimlik (dizin/anahtar)
 *   { yok: '<sebep>' }                 — bu kaynakta yok (sebep rapora girer)
 * `c` = { id, imparkVs, calisma, log }. Doğrulama (kaynakId = kitap, içerik düzeni, BookContent kitapId
 * = İmpark referansı) ÜRETEÇTE yapılır — yedek kendi kendini onaylamaz.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const M = require('./icerik-merdiven');
const ig = require('../runtime/icerik-guncelleme');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) '
  + 'Chrome/131.0.0.0 Safari/537.36';
const WEBZ_DIZINI = 'WebDijitapDosyalar';
/** H zip'ine girmeyen alt ağaçlar (retina sayfaları; ölçüm 33574). Büyük/küçük harf ikisi de. */
const WEBZ_HARIC = Object.freeze(['pages2X/*', 'pages2x/*']);

/** İmpark SMB kökü (`impark-diskler.sh` bağlama noktası). */
function smbKoku(env = process.env) {
  return env.EMPP_IMPARK_SMB_KOKU || path.join(os.homedir(), 'Impark');
}

/**
 * Yol GERÇEK bir SMB bağlaması mı (df kaynağı `//…`)? Yol adı kanıt değildir: Storage düşükken
 * `~/Impark/...` yerel dizin olarak kalır (04.10 imza yuvası olayı, d85ed7f ile aynı ölçüt).
 */
async function smbBagliMi(yol, komut = M.komut) {
  if (!yol || !fs.existsSync(yol)) return false;
  const r = await komut('df', ['-P', yol]);
  if (r.code !== 0) return false;
  const son = String(r.stdout).trim().split('\n').pop() || '';
  return son.startsWith('//');
}

/** Ad → güvenli dosya adı parçası. SAF. */
const dosyaAdiParcasi = (s) => String(s).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 60);

/**
 * (1) İmpark Web-Z DOSYALARI (SMB): `<uploads>/WebDijitapDosyalar/<id>/` → kendi zip'imiz (pages2X hariç).
 * İçerik İmpark'ın şu an sunduğu canlı dosyalardır → sürüm = İmpark'ın bildirdiği Vs (yoksa 0).
 * @param {{uploadsKoku:string|null, komut?:Function, smbDenetle?:Function}} o
 */
function webzDosyaYedegi({ uploadsKoku, komut = M.komut, smbDenetle = smbBagliMi } = {}) {
  return {
    ad: 'webz-smb',
    async getir({ id, imparkVs, calisma, log = () => {} }) {
      if (!uploadsKoku) return { yok: 'yayıncının SMB yolu tanımlı değil' };
      if (!(await smbDenetle(uploadsKoku, komut))) return { yok: `SMB bağlı değil (${uploadsKoku})` };
      const dizin = path.join(uploadsKoku, WEBZ_DIZINI, String(id));
      if (!fs.existsSync(dizin)) return { yok: `${WEBZ_DIZINI}/${id} yok` };
      if (!fs.existsSync(path.join(dizin, 'data', 'BookContent.xml'))) {
        let icerik = [];
        try { icerik = fs.readdirSync(dizin); } catch (_) { /* okunamadı */ }
        return { yok: `${WEBZ_DIZINI}/${id} içinde data/BookContent.xml yok (dizinde: ${icerik.join(', ') || 'boş'})` };
      }
      await fsp.mkdir(calisma, { recursive: true });
      const hedef = path.join(calisma, `${id}-webz.zip`);
      const gecici = `${hedef}.yazim-${process.pid}`;
      const bas = Date.now();
      const z = await komut('zip', ['-q', '-r', '-X', '-n', M.SIKISIK_UZANTILAR, path.resolve(gecici), '.',
        '-x', ...WEBZ_HARIC], { cwd: dizin });
      if (z.code !== 0) {
        await fsp.rm(gecici, { force: true }).catch(() => {});
        return { yok: `SMB'den zip kurulamadı (zip ${z.code}: ${String(z.stderr).slice(-120)})` };
      }
      await fsp.rename(gecici, hedef);
      const vs = Number.isSafeInteger(imparkVs) && imparkVs >= 0 ? imparkVs : 0;
      log(`[icerik-yedek] ${id}: ${WEBZ_DIZINI}/${id} SMB'den zip'lendi `
        + `(${((await fsp.stat(hedef)).size / 1e6).toFixed(0)} MB, ${((Date.now() - bas) / 1000).toFixed(0)} sn), sürüm ${vs}`);
      return { zip: hedef, kaynakId: String(id), vs, url: null, not: `SMB ${WEBZ_DIZINI}/${id}` };
    },
  };
}

/**
 * (2) İÇERİK ÖNBELLEĞİ: `<onbellek>/<id>/<id>-<n>.zip` (anahtar, kimliği doğrulanmış İmpark Data'sıyla
 * yazılır — `icerikZipiGetir`). En büyük n; sürüm = n.
 */
function onbellekYedegi({ onbellek } = {}) {
  return {
    ad: 'onbellek',
    async getir({ id }) {
      if (!onbellek) return { yok: 'önbellek kökü yok' };
      const dizin = path.join(onbellek, String(id));
      let adlar = [];
      try { adlar = fs.readdirSync(dizin); } catch (_) { return { yok: 'önbellekte dizin yok' }; }
      const re = new RegExp(`^${String(id)}-(\\d+)\\.zip$`);
      const adaylar = adlar.map((a) => ({ a, m: re.exec(a) })).filter((x) => x.m)
        .map((x) => ({ zip: path.join(dizin, x.a), vs: Number(x.m[1]) })).sort((a, b) => b.vs - a.vs);
      if (!adaylar.length) return { yok: 'önbellekte zip yok' };
      const s = adaylar[0];
      return { zip: s.zip, kaynakId: String(id), vs: s.vs, url: null, not: `önbellek ${path.basename(s.zip)}` };
    },
  };
}

/** Bir build zip'inin girdi adlarında `<önek>assets/<id>/data/BookContent.xml` öneki ('' | 'bookN/'). SAF. */
function arsivOnekiBul(adlar, id) {
  const son = `assets/${id}/data/BookContent.xml`;
  for (const a of adlar) {
    if (a === son) return '';
    if (a.endsWith(`/${son}`) && /^book\d+\/$/.test(a.slice(0, -son.length))) return a.slice(0, -son.length);
  }
  return null;
}

/** Kitabın arşiv menüsündeki kapağından sürüm ve URL (menü yoksa/kapak yoksa null). */
function arsivKapagi(zip, dz, onek, id) {
  const menu = dz.get(`${onek}${ig.MENU_GORELI}`);
  if (!menu) return null;
  try {
    const k = ig.kapaklar(ig.menuCoz(M.zipGirdiOku(zip, menu))).find((x) => x.ID === String(id));
    return k && Number.isSafeInteger(k.version) ? { vs: k.version, url: k.URL || null } : null;
  } catch (_) { return null; }
}

/**
 * (3) KAYNAK ARŞİVİ: `<arsivKoku>/<set>/build.zip` içinde aynı kitabın `assets/<id>/` alt ağacı (başka
 * setlerin arşivli build'i). Alt ağaç kendi zip'imize çıkarılır; sürüm = o build'in menüsündeki kapak.
 * Menüde kapağı olmayan kopya ALINMAZ (sürümsüz içerik motoru yanlış güncellemeye yöneltir).
 */
function arsivYedegi({ arsivKoku, komut = M.komut } = {}) {
  const dizinler = new Map();
  return {
    ad: 'arsiv',
    async getir({ id, calisma }) {
      let setler = [];
      try {
        setler = fs.readdirSync(arsivKoku, { withFileTypes: true }).filter((d) => d.isDirectory())
          .map((d) => d.name).sort();
      } catch (_) { return { yok: 'arşiv kökü yok' }; }
      let bakilan = 0;
      const notlar = [];
      for (const set of setler) {
        const zip = path.join(arsivKoku, set, 'build.zip');
        if (!fs.existsSync(zip)) continue;
        let dz = dizinler.get(zip);
        if (!dz) {
          try { dz = M.zipDizini(zip); } catch (_) { continue; }
          dizinler.set(zip, dz);
        }
        bakilan += 1;
        const onek = arsivOnekiBul(dz.keys(), id);
        if (onek == null) continue;
        const kapak = arsivKapagi(zip, dz, onek, id);
        if (!kapak) { notlar.push(`${set}: menüde ${id} kapağı yok`); continue; }
        const acik = path.join(calisma, `arsiv-${dosyaAdiParcasi(set)}-${id}`);
        await fsp.rm(acik, { recursive: true, force: true });
        await fsp.mkdir(acik, { recursive: true });
        const u = await komut('unzip', ['-q', '-o', zip, `${onek}assets/${id}/*`, '-d', acik]);
        if (u.code !== 0) { notlar.push(`${set}: unzip ${u.code}`); continue; }
        const hedef = path.join(calisma, `${id}-arsiv-${dosyaAdiParcasi(set)}.zip`);
        const z = await komut('zip', ['-q', '-r', '-X', '-n', M.SIKISIK_UZANTILAR, path.resolve(hedef), '.'],
          { cwd: path.join(acik, onek, 'assets', String(id)) });
        await fsp.rm(acik, { recursive: true, force: true }).catch(() => {});
        if (z.code !== 0) { notlar.push(`${set}: zip ${z.code}`); continue; }
        return { zip: hedef, kaynakId: String(id), vs: kapak.vs, url: kapak.url, not: `arşiv ${set}/${onek}assets/${id}` };
      }
      return { yok: `${bakilan} arşiv build'inde yok${notlar.length ? ` (${notlar.slice(0, 3).join('; ')})` : ''}` };
    },
  };
}

async function varsayilanMetinGetir(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
  if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer()).subarray(0, 8192).toString('utf8');
}

/**
 * KİMLİK REFERANSI: İmpark'ın kitap <id> olarak SUNDUĞU BookContent'in `kitapId`'si (= S_TestKitaplar
 * .ZKitapId; kopyalar aynı zid'i paylaşır, içerik aynı). Önce SMB dosyası (bağlıysa), sonra origin HTTP
 * (`<origin>/Uploads/WebDijitapDosyalar/<id>/data/BookContent.xml`). Bulunamazsa null — üreteç o zaman
 * yalnız kaynak kimliğine (dizin/anahtar) dayanır ve bunu rapora yazar.
 * @returns {(id:string) => Promise<string|null>}
 */
function kimlikReferansiKur({ origin = null, uploadsKoku = null, metinGetir = varsayilanMetinGetir,
  komut = M.komut, smbDenetle = smbBagliMi } = {}) {
  const onbellek = new Map();
  return async (id) => {
    if (onbellek.has(id)) return onbellek.get(id);
    let zid = null;
    if (uploadsKoku && await smbDenetle(uploadsKoku, komut).catch(() => false)) {
      try {
        const bc = fs.readFileSync(path.join(uploadsKoku, WEBZ_DIZINI, String(id), 'data', 'BookContent.xml'));
        zid = M.kitapIdOku(bc.subarray(0, 8192));
      } catch (_) { zid = null; }
    }
    if (!zid && origin) {
      try {
        const metin = await metinGetir(`${origin}/Uploads/${WEBZ_DIZINI}/${encodeURIComponent(id)}/data/BookContent.xml`);
        if (/<Book\b/i.test(metin)) zid = M.kitapIdOku(metin);
      } catch (_) { zid = null; }
    }
    onbellek.set(id, zid);
    return zid;
  };
}

/** Varsayılan yedek sırası: tazelikten eskiye — canlı İmpark dosyaları (SMB) → önbellek → arşiv. */
function varsayilanYedekler({ uploadsKoku = null, onbellek, arsivKoku, komut = M.komut } = {}) {
  return [webzDosyaYedegi({ uploadsKoku, komut }), onbellekYedegi({ onbellek }), arsivYedegi({ arsivKoku, komut })];
}

module.exports = {
  WEBZ_DIZINI, WEBZ_HARIC, smbKoku, smbBagliMi, webzDosyaYedegi, onbellekYedegi, arsivYedegi, arsivOnekiBul,
  kimlikReferansiKur, varsayilanYedekler,
};

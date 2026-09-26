'use strict';
/**
 * Bağımlılıksız asar okuyucu (Electron `app.asar`).
 *
 * Biçim: [0..4) = 4 · [4..8) = başlık pickle boyu (B) · [8..12) başlık yükü · [12..16) JSON uzunluğu (L)
 *        · [16..16+L) JSON · veri tabanı = 8 + B. Dosya düğümü {size, offset:"<sayı>", unpacked?}.
 *
 * Neden kendi okuyucumuz: worktree/koşu ortamında `@electron/asar` kurulu olmayabilir ve 1,2 GB'lık
 * asar'ı diske çıkarmadan AKIŞTAN okumak gerekir (`7z e -so … resources/app.asar`): başlık okunur,
 * yalnız istenen dosyaların bayt aralıkları toplanır, hepsi gelince akış kesilir.
 */
const fs = require('fs');
const path = require('path');

/** Başlık için gereken en az bayt sayısı; tampon kısaysa null (daha fazla oku). */
function baslikBoyu(buf) {
  if (!buf || buf.length < 16) return null;
  if (buf.readUInt32LE(0) !== 4) throw new Error('asar değil: ilk pickle boyu 4 değil');
  const b = buf.readUInt32LE(4);
  const l = buf.readUInt32LE(12);
  if (l > b || b > 256 * 1024 * 1024) throw new Error(`asar başlığı tutarsız (B=${b}, L=${l})`);
  return { tabanOfset: 8 + b, jsonUzunluk: l, gereken: 16 + l };
}

/** Başlık ağacını düz listeye çevirir. */
function duzle(dugum, onek, liste) {
  for (const [ad, alt] of Object.entries((dugum && dugum.files) || {})) {
    const yol = onek ? `${onek}/${ad}` : ad;
    if (alt && alt.files) duzle(alt, yol, liste);
    else if (alt && !alt.link) {
      liste.push({
        yol,
        boyut: Number(alt.size) || 0,
        ofset: Number(alt.offset) || 0,
        unpacked: !!alt.unpacked,
      });
    }
  }
  return liste;
}

/**
 * @returns {null | {tabanOfset:number, dosyalar:Array<{yol,boyut,ofset,unpacked}>}}
 *   null = tampon henüz başlığı taşımıyor.
 */
function baslikCoz(buf) {
  const b = baslikBoyu(buf);
  if (!b) return null;
  if (buf.length < b.gereken) return null;
  const json = JSON.parse(buf.subarray(16, 16 + b.jsonUzunluk).toString('utf8'));
  return { tabanOfset: b.tabanOfset, dosyalar: duzle(json, '', []) };
}

/** Yerel asar dosyası: başlık + dosya okuyucu. `unpacked` girdiler `<asar>.unpacked/` altından. */
function yerelAc(asarYolu) {
  const fd = fs.openSync(asarYolu, 'r');
  try {
    const ilk = Buffer.alloc(16);
    fs.readSync(fd, ilk, 0, 16, 0);
    const b = baslikBoyu(ilk);
    if (!b) throw new Error('asar başlığı okunamadı');
    const tam = Buffer.alloc(b.gereken);
    fs.readSync(fd, tam, 0, b.gereken, 0);
    const bas = baslikCoz(tam);
    const oku = (girdi) => {
      if (girdi.unpacked) {
        try {
          return fs.readFileSync(path.join(`${asarYolu}.unpacked`, girdi.yol));
        } catch (_) {
          return null;
        }
      }
      const t = Buffer.alloc(girdi.boyut);
      const f2 = fs.openSync(asarYolu, 'r');
      try {
        fs.readSync(f2, t, 0, girdi.boyut, bas.tabanOfset + girdi.ofset);
      } finally {
        fs.closeSync(f2);
      }
      return t;
    };
    return { dosyalar: bas.dosyalar, oku };
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Akıştan (ör. `7z e -so`) asar oku; `secici(yollar: string[]) → Set<yol>` ile seçilenleri topla.
 * Hepsi toplanınca akış kesilir (`kes()` çağrılır — çocuk süreç öldürülür).
 * @param {import('stream').Readable} akis
 * @param {(yollar:string[])=>Set<string>} secici
 * @param {{kes?:Function}} [secenek]
 * @returns {Promise<{dosyalar:Array, toplanan:Map<string,Buffer>, unpackedAtlanan:string[],
 *                    okunanBayt:number, erkenKesildi:boolean}>}
 */
function akistanTopla(akis, secici, secenek = {}) {
  return new Promise((coz, reddet) => {
    let bas = Buffer.alloc(0);
    let baslik = null;
    let bekleyen = [];
    const toplanan = new Map();
    const unpackedAtlanan = [];
    let konum = 0; // akıştaki mutlak bayt konumu
    let bitti = false;
    let dosyalar = [];

    const tamamla = (erken) => {
      if (bitti) return;
      bitti = true;
      if (erken && secenek.kes) {
        try {
          secenek.kes();
        } catch (_) {
          /* yok */
        }
      }
      if (erken) {
        try {
          akis.destroy();
        } catch (_) {
          /* yok */
        }
      }
      coz({ dosyalar, toplanan, unpackedAtlanan, okunanBayt: konum, erkenKesildi: !!erken });
    };

    const parcaIsle = (parca, parcaBas) => {
      const parcaSon = parcaBas + parca.length;
      for (const g of bekleyen) {
        const gBas = baslik.tabanOfset + g.ofset;
        const gSon = gBas + g.boyut;
        if (gSon <= parcaBas || gBas >= parcaSon) continue;
        const a = Math.max(gBas, parcaBas);
        const s = Math.min(gSon, parcaSon);
        if (!g.tampon) {
          g.tampon = Buffer.alloc(g.boyut);
          g.dolu = 0;
        }
        parca.copy(g.tampon, a - gBas, a - parcaBas, s - parcaBas);
        g.dolu += s - a;
      }
      const kalan = [];
      for (const g of bekleyen) {
        if (g.boyut === 0 || (g.tampon && g.dolu >= g.boyut))
          toplanan.set(g.yol, g.tampon || Buffer.alloc(0));
        else kalan.push(g);
      }
      bekleyen = kalan;
    };

    akis.on('data', (parca) => {
      if (bitti) return;
      const parcaBas = konum;
      konum += parca.length;
      if (!baslik) {
        bas = Buffer.concat([bas, parca]);
        try {
          baslik = baslikCoz(bas);
        } catch (e) {
          bitti = true;
          if (secenek.kes) {
            try {
              secenek.kes();
            } catch (_) {
              /* yok */
            }
          }
          reddet(e);
          return;
        }
        if (!baslik) return;
        dosyalar = baslik.dosyalar;
        const istenen = secici(dosyalar.map((d) => d.yol)) || new Set();
        for (const g of dosyalar) {
          if (!istenen.has(g.yol)) continue;
          if (g.unpacked) unpackedAtlanan.push(g.yol);
          else bekleyen.push({ ...g });
        }
        parcaIsle(bas, 0);
        bas = null;
      } else {
        parcaIsle(parca, parcaBas);
      }
      if (baslik && !bekleyen.length) tamamla(true);
    });
    akis.on('end', () => {
      if (bitti) return;
      if (!baslik) {
        bitti = true;
        reddet(new Error(`asar akışı başlıktan önce bitti (${konum} B)`));
        return;
      }
      tamamla(false);
    });
    akis.on('error', (e) => {
      if (!bitti) {
        bitti = true;
        reddet(e);
      }
    });
  });
}

/** Test/sentetik paket için asar üretir: {yol: Buffer|string} → Buffer. */
function asarYaz(dosyaHaritasi) {
  const kok = { files: {} };
  const govdeler = [];
  let ofset = 0;
  for (const [yol, icerik] of Object.entries(dosyaHaritasi)) {
    const veri = Buffer.isBuffer(icerik) ? icerik : Buffer.from(String(icerik));
    const parcalar = yol.split('/');
    let d = kok;
    for (const p of parcalar.slice(0, -1)) {
      d.files[p] = d.files[p] || { files: {} };
      d = d.files[p];
    }
    d.files[parcalar[parcalar.length - 1]] = { size: veri.length, offset: String(ofset) };
    govdeler.push(veri);
    ofset += veri.length;
  }
  const json = Buffer.from(JSON.stringify(kok), 'utf8');
  const dolgu = (4 - (json.length % 4)) % 4;
  const yuk = Buffer.alloc(8 + json.length + dolgu);
  yuk.writeUInt32LE(4 + json.length + dolgu, 0);
  yuk.writeUInt32LE(json.length, 4);
  json.copy(yuk, 8);
  const boy = Buffer.alloc(8);
  boy.writeUInt32LE(4, 0);
  boy.writeUInt32LE(yuk.length, 4);
  return Buffer.concat([boy, yuk, ...govdeler]);
}

module.exports = { baslikCoz, yerelAc, akistanTopla, asarYaz };

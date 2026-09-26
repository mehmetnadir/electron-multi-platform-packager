'use strict';
/**
 * Paket İÇERİĞİ — gereken birkaç dosyayı paketten çıkarır (GUI açmadan, uygulamayı çalıştırmadan).
 *
 *   nsis      7z: `$PLUGINSDIR/app-*.7z` yükü çalışma dizinine → iç liste → asar ise `7z e -so` akışı
 *   sfx-*     unrar: `unrar lb` liste, `unrar p -inul` dosya başına (asar ise akış)
 *   appimage  unsquashfs -o 193728 (varsa) ya da 7z (squashfs'i ofsetle kendisi bulur)
 *   dmg       hdiutil attach -nobrowse -readonly -noautoopen (Finder'da görünmez), yoksa 7z
 *   apk       unzip -Z1 liste, unzip -p dosya başına
 * Araç yoksa: {eksikArac:'<ad>'} → üst katman OLCULEMEDI yazar ("yok" demez).
 *
 * `secici(goreliListe) → Set<göreli yol>`: uygulama köküne göreli hangi dosyalar lazım.
 * Dönüş: {kok, tur:'asar'|'dizin', liste(göreli), toplanan: Map<göreli, Buffer>, ...}
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const O = require('./ortak');
const asar = require('./asar');
const { SQUASHFS_OFSET } = require('./aile');

const AKIS_TAVANI_MS = Number(process.env.EMPP_E2E_AKIS_MS) || 20 * 60 * 1000;

const norm = (p) =>
  String(p || '')
    .replace(/\\/g, '/')
    .replace(/^\.?\/+/, '');

/** Arşiv listesinden uygulama kökü: asar > resources/app/ > assets/public/. Saf. */
function uygulamaKokuSec(liste) {
  const l = liste.map(norm);
  const asarlar = l
    .filter((p) => /(^|\/)resources\/app\.asar$/i.test(p))
    .sort((a, b) => a.length - b.length);
  if (asarlar.length) return { tur: 'asar', yol: asarlar[0] };
  const onekler = new Set();
  for (const p of l) {
    const m = /^(.*?(?:^|\/)resources\/app\/)/i.exec(p);
    if (m) onekler.add(m[1]);
  }
  if (onekler.size)
    return { tur: 'dizin', onek: [...onekler].sort((a, b) => a.length - b.length)[0] };
  if (l.some((p) => p.startsWith('assets/public/')))
    return { tur: 'dizin', onek: 'assets/public/' };
  return null;
}

function goreliListe(liste, onek) {
  return liste
    .map(norm)
    .filter((p) => p.startsWith(onek) && p.length > onek.length)
    .map((p) => p.slice(onek.length));
}

function yedizListe(yediz, arsiv) {
  const r = O.calistir(yediz, ['l', '-slt', '-ba', arsiv]);
  if (r.status !== 0 && !r.stdout)
    throw new Error(`7z l rc=${r.status}: ${(r.stderr || '').slice(-200)}`);
  const adlar = [];
  let cari = null;
  for (const s of String(r.stdout).split('\n')) {
    const m = /^(Path|Folder|Attributes) = (.*)$/.exec(s.trim());
    if (!m) continue;
    if (m[1] === 'Path') {
      cari = { yol: norm(m[2]), dizin: false };
      adlar.push(cari);
    } else if (cari && m[1] === 'Folder') cari.dizin = m[2] === '+';
    else if (cari && m[1] === 'Attributes' && /^D/.test(m[2])) cari.dizin = true;
  }
  return adlar.filter((a) => !a.dizin).map((a) => a.yol);
}

/** Çocuk süreç stdout'unu asar akışı olarak okur. */
function surecAkisi(komut, argumanlar, secici) {
  const cocuk = spawn(komut, argumanlar, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  cocuk.stderr.on('data', (d) => {
    stderr = (stderr + d).slice(-2000);
  });
  const zaman = setTimeout(() => cocuk.kill('SIGTERM'), AKIS_TAVANI_MS);
  return asar
    .akistanTopla(cocuk.stdout, secici, { kes: () => cocuk.kill('SIGTERM') })
    .then((r) => {
      clearTimeout(zaman);
      return r;
    })
    .catch((e) => {
      clearTimeout(zaman);
      cocuk.kill('SIGTERM');
      throw new Error(`${e.message} ${stderr.slice(-200)}`);
    });
}

/** Dizin düzeni: listeden seç, `getir(arşivYolları) → Map<arşivYolu, Buffer>`. */
async function dizinDuzeni(kok, liste, secici, getir) {
  const gl = goreliListe(liste, kok.onek);
  const secilen = [...(secici(gl) || [])];
  const ham = await getir(secilen.map((g) => kok.onek + g));
  const toplanan = new Map();
  for (const g of secilen) {
    const b = ham.get(kok.onek + g);
    if (b) toplanan.set(g, b);
  }
  return {
    kok: kok.onek.replace(/\/$/, ''),
    tur: 'dizin',
    liste: gl,
    toplanan,
    unpackedAtlanan: [],
  };
}

async function asarDuzeni(kok, akisAc) {
  const r = await akisAc(kok.yol);
  return {
    kok: kok.yol,
    tur: 'asar',
    liste: r.dosyalar.map((d) => d.yol),
    toplanan: r.toplanan,
    unpackedAtlanan: r.unpackedAtlanan,
    okunanBayt: r.okunanBayt,
    erkenKesildi: r.erkenKesildi,
  };
}

/* ------------------------------------------------------------------ aileler */

async function nsisAc(paket, secici, { araclar, calisma }) {
  const yediz = O.aracBul('7z', araclar) || O.aracBul('7zz', araclar);
  if (!yediz) return { eksikArac: '7z' };
  const dis = yedizListe(yediz, paket);
  const yuk = dis.find((a) => /(^|\/)app-(32|64|arm64)\.7z$/i.test(a));
  let ic;
  let icListe;
  if (yuk) {
    const hedef = path.join(calisma, 'nsis-yuk');
    fs.mkdirSync(hedef, { recursive: true });
    const r = O.calistir(yediz, ['x', '-y', `-o${hedef}`, paket, yuk], { timeout: AKIS_TAVANI_MS });
    ic = path.join(hedef, ...yuk.split('/'));
    if (r.status !== 0 || !fs.existsSync(ic))
      throw new Error(`NSIS yükü çıkarılamadı (${yuk}): ${(r.stderr || '').slice(-200)}`);
    icListe = yedizListe(yediz, ic);
  } else {
    ic = paket; // yük yoksa (tek katman) dış arşiv
    icListe = dis;
  }
  const kok = uygulamaKokuSec(icListe);
  if (!kok)
    return {
      hata: `uygulama kökü yok (resources/app.asar | resources/app/) — ${icListe.length} girdi`,
    };
  if (kok.tur === 'asar') {
    return {
      ...(await asarDuzeni(kok, (y) => surecAkisi(yediz, ['e', '-so', ic, y], secici))),
      yuk: yuk || null,
    };
  }
  return {
    ...(await dizinDuzeni(kok, icListe, secici, async (yollar) =>
      yedizGetir(yediz, ic, yollar, path.join(calisma, 'nsis-ic')),
    )),
    yuk: yuk || null,
  };
}

function yedizGetir(yediz, arsiv, yollar, hedef) {
  const m = new Map();
  if (!yollar.length) return m;
  fs.mkdirSync(hedef, { recursive: true });
  const r = O.calistir(yediz, ['x', '-y', `-o${hedef}`, arsiv, ...yollar], {
    timeout: AKIS_TAVANI_MS,
  });
  if (r.status !== 0) throw new Error(`7z x rc=${r.status}: ${(r.stderr || '').slice(-200)}`);
  for (const y of yollar) {
    try {
      m.set(y, fs.readFileSync(path.join(hedef, ...y.split('/'))));
    } catch (_) {
      /* yok */
    }
  }
  return m;
}

async function sfxAc(paket, secici, { araclar }) {
  const unrar = O.aracBul('unrar', araclar);
  if (!unrar) return { eksikArac: 'unrar' };
  const r = O.calistir(unrar, ['lb', paket]);
  if (r.status !== 0)
    throw new Error(`unrar lb rc=${r.status}: ${(r.stderr || r.stdout || '').slice(-200)}`);
  const liste = String(r.stdout)
    .split('\n')
    .map((s) => norm(s.trim()))
    .filter(Boolean);
  const kok = uygulamaKokuSec(liste);
  if (!kok) return { hata: `uygulama kökü yok — ${liste.length} girdi` };
  if (kok.tur === 'asar')
    return asarDuzeni(kok, (y) => surecAkisi(unrar, ['p', '-inul', paket, y], secici));
  return dizinDuzeni(kok, liste, secici, async (yollar) => {
    const m = new Map();
    for (const y of yollar) {
      const p = O.calistir(unrar, ['p', '-inul', paket, y], {
        encoding: 'buffer',
        timeout: AKIS_TAVANI_MS,
      });
      if (p.status === 0) m.set(y, p.stdout);
    }
    return m;
  });
}

async function appimageAc(paket, secici, { araclar, calisma }) {
  const unsq = O.aracBul('unsquashfs', araclar);
  if (unsq) {
    const r = O.calistir(unsq, ['-o', String(SQUASHFS_OFSET), '-l', paket]);
    if (r.status === 0) {
      const liste = String(r.stdout)
        .split('\n')
        .map((s) => s.trim())
        .filter((s) => s.startsWith('squashfs-root/'))
        .map((s) => s.slice('squashfs-root/'.length));
      const kok = uygulamaKokuSec(liste);
      if (!kok) return { hata: `uygulama kökü yok — ${liste.length} girdi` };
      const cat = (y) => ['-o', String(SQUASHFS_OFSET), '-cat', paket, y];
      if (kok.tur === 'asar')
        return {
          ...(await asarDuzeni(kok, (y) => surecAkisi(unsq, cat(y), secici))),
          arac: 'unsquashfs',
        };
      return {
        ...(await dizinDuzeni(kok, liste, secici, async (yollar) => {
          const m = new Map();
          for (const y of yollar) {
            const p = O.calistir(unsq, cat(y), { encoding: 'buffer', timeout: AKIS_TAVANI_MS });
            if (p.status === 0) m.set(y, p.stdout);
          }
          return m;
        })),
        arac: 'unsquashfs',
      };
    }
  }
  const yediz = O.aracBul('7z', araclar) || O.aracBul('7zz', araclar);
  if (!yediz) return { eksikArac: 'unsquashfs|7z' };
  const liste = yedizListe(yediz, paket);
  const kok = uygulamaKokuSec(liste);
  if (!kok) return { hata: `uygulama kökü yok — ${liste.length} girdi` };
  if (kok.tur === 'asar')
    return {
      ...(await asarDuzeni(kok, (y) => surecAkisi(yediz, ['e', '-so', paket, y], secici))),
      arac: '7z',
    };
  return {
    ...(await dizinDuzeni(kok, liste, secici, async (y) =>
      yedizGetir(yediz, paket, y, path.join(calisma, 'appimage')),
    )),
    arac: '7z',
  };
}

function dizinYuru(kok, onek = '', liste = [], sinir = 200000) {
  for (const e of fs.readdirSync(path.join(kok, onek), { withFileTypes: true })) {
    if (liste.length >= sinir) break;
    const g = onek ? `${onek}/${e.name}` : e.name;
    if (e.isDirectory()) dizinYuru(kok, g, liste, sinir);
    else liste.push(g);
  }
  return liste;
}

async function dmgAc(paket, secici, { araclar, calisma }) {
  const hdiutil = O.aracBul('hdiutil', araclar);
  if (!hdiutil) {
    const yediz = O.aracBul('7z', araclar) || O.aracBul('7zz', araclar);
    if (!yediz) return { eksikArac: 'hdiutil|7z' };
    const liste = yedizListe(yediz, paket);
    const kok = uygulamaKokuSec(liste);
    if (!kok) return { hata: `uygulama kökü yok — ${liste.length} girdi` };
    if (kok.tur === 'asar')
      return {
        ...(await asarDuzeni(kok, (y) => surecAkisi(yediz, ['e', '-so', paket, y], secici))),
        arac: '7z',
      };
    return {
      ...(await dizinDuzeni(kok, liste, secici, async (y) =>
        yedizGetir(yediz, paket, y, path.join(calisma, 'dmg')),
      )),
      arac: '7z',
    };
  }
  const baglama = path.join(calisma, 'dmg-baglama');
  fs.mkdirSync(baglama, { recursive: true });
  const a = O.calistir(
    hdiutil,
    ['attach', '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', baglama, paket],
    { input: '' },
  );
  if (a.status !== 0)
    throw new Error(`hdiutil attach rc=${a.status}: ${(a.stderr || '').slice(-200)}`);
  try {
    const app = fs.readdirSync(baglama).find((x) => x.endsWith('.app'));
    if (!app) return { hata: 'DMG içinde .app yok' };
    const res = path.join(baglama, app, 'Contents', 'Resources');
    if (fs.existsSync(path.join(res, 'app.asar'))) {
      const ac = asar.yerelAc(path.join(res, 'app.asar'));
      const secilen = secici(ac.dosyalar.map((d) => d.yol)) || new Set();
      const toplanan = new Map();
      for (const d of ac.dosyalar)
        if (secilen.has(d.yol)) {
          const b = ac.oku(d);
          if (b) toplanan.set(d.yol, b);
        }
      return {
        kok: `${app}/Contents/Resources/app.asar`,
        tur: 'asar',
        liste: ac.dosyalar.map((d) => d.yol),
        toplanan,
        unpackedAtlanan: [],
        arac: 'hdiutil',
      };
    }
    const appDizin = path.join(res, 'app');
    if (!fs.existsSync(appDizin)) return { hata: 'Contents/Resources altında app.asar / app yok' };
    const liste = dizinYuru(appDizin);
    const secilen = secici(liste) || new Set();
    const toplanan = new Map();
    for (const g of secilen) {
      try {
        toplanan.set(g, fs.readFileSync(path.join(appDizin, g)));
      } catch (_) {
        /* yok */
      }
    }
    return {
      kok: `${app}/Contents/Resources/app`,
      tur: 'dizin',
      liste,
      toplanan,
      unpackedAtlanan: [],
      arac: 'hdiutil',
    };
  } finally {
    const d = O.calistir(hdiutil, ['detach', baglama]);
    if (d.status !== 0) O.calistir(hdiutil, ['detach', '-force', baglama]);
  }
}

async function apkAc(paket, secici, { araclar }) {
  const unzip = O.aracBul('unzip', araclar);
  if (!unzip) return { eksikArac: 'unzip' };
  const r = O.calistir(unzip, ['-Z1', paket]);
  if (r.status !== 0) throw new Error(`unzip -Z1 rc=${r.status}: ${(r.stderr || '').slice(-200)}`);
  const liste = String(r.stdout)
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s && !s.endsWith('/'));
  const kok = uygulamaKokuSec(liste);
  if (!kok) return { hata: 'APK içinde assets/public/ yok' };
  return dizinDuzeni(kok, liste, secici, async (yollar) => {
    const m = new Map();
    for (const y of yollar) {
      const p = O.calistir(unzip, ['-p', paket, y], { encoding: 'buffer' });
      if (p.status === 0) m.set(y, p.stdout);
    }
    return m;
  });
}

const ACICILAR = {
  nsis: nsisAc,
  'sfx-rar5': sfxAc,
  'sfx-rar4': sfxAc,
  appimage: appimageAc,
  dmg: dmgAc,
  apk: apkAc,
};

/**
 * @returns {Promise<{eksikArac?:string, hata?:string, kok?:string, tur?:string, liste?:string[],
 *                    toplanan?:Map<string,Buffer>, unpackedAtlanan?:string[]}>}
 */
async function icerikTopla(paket, aile, secici, secenek = {}) {
  const ac = ACICILAR[aile];
  if (!ac) return { hata: `bu aile için içerik açıcı yok: ${aile}` };
  const calisma = secenek.calisma || O.calismaDizini();
  fs.mkdirSync(calisma, { recursive: true });
  return ac(paket, secici, { araclar: secenek.araclar || {}, calisma });
}

module.exports = { icerikTopla, uygulamaKokuSec, goreliListe, yedizListe, ACICILAR };

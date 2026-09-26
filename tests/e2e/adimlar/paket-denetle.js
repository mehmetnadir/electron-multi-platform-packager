#!/usr/bin/env node
'use strict';
/**
 * STATİK PAKET DENETÇİSİ — onaylardan bağımsız koşar (sözleşme T1/T2 CDN ölçütleri + K1/K2'nin
 * paket-içi hali). Girdi: İNDİRİLMİŞ paket dosyası (`--paket`) ya da CDN URL'si (`--url`).
 *
 *   kaynak     yerel dosya boyu | CDN HEAD (durum, boyut, etag, son değişiklik)
 *   aile       NSIS / Rar5 SFX / AppImage / DMG / APK (aile.js)
 *   butunluk   NSIS firstheader+imza yerleşimi · squashfs bytes_used · UDIF koly · zip merkez dizini
 *   imza       Authenticode (PE güvenlik dizini): osslsigncode verify (yerel dosya + araç varsa);
 *              yoksa dizin + WIN_CERTIFICATE başlığı → SARI (doğrulanmadı)
 *   indir      yalnız `--indir`: tam indirme + md5 (CDN md5 = üretilen md5 kıyası için)
 *   icerik-ac  paketten gereken dosyalar çıkarıldı mı (araç yoksa OLCULEMEDI + eksik araç)
 *   index      kök index.html md5 (= beklenen)                                 — K1
 *   43e23      kitap ANA klasörlerindeki 43e23fce…js md5 (= kanonik); etk/ alt kopyaları KAPSAM DIŞI — K2
 *   g-istemci  giriş betiğinde EMPP_SET_GUNCELLEME + require, empp-set-guncelleyici.js yanında, empp-set.json
 *   g-anahtar  empp-set.json → imza.acikAnahtar parmak izi (sha256 SPKI DER) = üretim (anahtar BASILMAZ)
 *   g-taban    empp-set.json → taban = https://cdn.ydspublishing.com/guncelleme
 *
 * Yazma YOK: paket yalnız okunur; DMG `-nobrowse -readonly` bağlanır, uygulama çalıştırılmaz.
 * Kullanım:
 *   node tests/e2e/adimlar/paket-denetle.js (--paket <yol> | --url <url>) [--indir] [--test T1]
 *     [--beklenen-43e23 md5] [--beklenen-index md5] [--beklenen-taban url] [--beklenen-parmak-izi hex]
 *     [--beklenen-aile nsis|sfx-rar5|appimage|dmg|apk] [--icerik 0] [--calisma dizin] [--json]
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const O = require('./ortak');
const { aileTespit } = require('./aile');
const { yerelOkuyucu, uzakOkuyucu, indir } = require('./okuyucu');
const { icerikTopla } = require('./icerik');

const { DURUM } = O;
const BILINEN_AILELER = new Set(['nsis', 'sfx-rar5', 'sfx-rar4', 'appimage', 'dmg', 'apk']);
const ELECTRON_AILELERI = new Set(['nsis', 'sfx-rar5', 'sfx-rar4', 'appimage', 'dmg']);
const MOTOR_RE = /^(book\d+\/)?43e23fce2b7009474555a77\.js$/i;
const G_MODUL = 'empp-set-guncelleyici.js';
const G_SET = 'empp-set.json';
const G_ISARET = 'EMPP_SET_GUNCELLEME';
const ICERIK_ADIMLARI = ['index', '43e23', 'g-istemci', 'g-anahtar', 'g-taban'];

const ad = (alt) => `paket-denetle/${alt}`;

/** Kanonik motorun md5'i (`~/.empp-agent/motor/43e…js`); yoksa null. */
function kanonikMotorMd5(env = process.env) {
  const yol =
    env.EMPP_MOTOR_KANONIK || path.join(os.homedir(), '.empp-agent', 'motor', O.MOTOR_ADI);
  try {
    return { md5: O.md5Dosya(yol), yol };
  } catch (_) {
    return { md5: null, yol };
  }
}

function varsayilanBeklenen(env = process.env) {
  const k = kanonikMotorMd5(env);
  return {
    md5_43e23: k.md5,
    md5_43e23_kaynak: k.md5 ? k.yol : null,
    md5_index: null,
    parmak_izi: O.URETIM_PARMAK_IZI,
    taban: O.VARSAYILAN_TABAN,
    aile: null,
  };
}

/* ------------------------------------------------------------ içerik seçimi */

/** Uygulama köküne göreli listeden gereken dosyalar. Saf. */
function secimYap(liste) {
  const kume = new Set(liste);
  let webKok = null;
  if (kume.has('index.html')) webKok = '';
  else if (kume.has('build/index.html')) webKok = 'build/';
  const secilen = new Set();
  for (const a of ['package.json', 'main.js', 'electron.js', G_SET, G_MODUL])
    if (kume.has(a)) secilen.add(a);
  if (webKok !== null) {
    secilen.add(`${webKok}index.html`);
    if (webKok && kume.has(`${webKok}${G_SET}`)) secilen.add(`${webKok}${G_SET}`);
    for (const p of liste)
      if (p.startsWith(webKok) && MOTOR_RE.test(p.slice(webKok.length))) secilen.add(p);
  }
  return { webKok, secilen };
}

function girisBul(toplanan) {
  const pj = toplanan.get('package.json');
  if (pj) {
    try {
      const main = String(JSON.parse(pj.toString('utf8')).main || '').replace(/^\.\//, '');
      if (main) return { yol: main, kaynak: 'package.json main' };
    } catch (_) {
      /* bozuk package.json → aday adlar */
    }
  }
  if (toplanan.has('main.js')) return { yol: 'main.js', kaynak: 'main.js' };
  if (toplanan.has('electron.js')) return { yol: 'electron.js', kaynak: 'electron.js' };
  return null;
}

/**
 * İçerik ölçümlerini satırlara çevirir. SAF (testler doğrudan çağırır).
 * @param {string} test
 * @param {{liste:string[], toplanan:Map<string,Buffer>}} r
 * @param {Object} beklenen
 * @param {string} aile
 */
function icerikDegerlendir(test, r, beklenen, aile) {
  const satirlar = [];
  const { webKok } = secimYap(r.liste);
  const t = r.toplanan;

  // K1 — kök index.html
  if (webKok === null || !t.has(`${webKok}index.html`)) {
    satirlar.push(
      O.sonuc(test, ad('index'), DURUM.KALDI, {
        olcum: { sebep: 'kök index.html pakette yok', kok: r.kok },
      }),
    );
  } else {
    const yol = `${webKok}index.html`;
    const md5 = O.md5(t.get(yol));
    const olcum = { yol: `${r.kok}/${yol}`, md5, beklenen: beklenen.md5_index || null };
    if (!beklenen.md5_index) {
      satirlar.push(
        O.sonuc(test, ad('index'), DURUM.OLCULEMEDI, {
          olcum: {
            ...olcum,
            sebep: 'beklenen index md5 verilmedi (--beklenen-index) — kıyas yapılamadı',
          },
        }),
      );
    } else {
      satirlar.push(
        O.sonuc(test, ad('index'), md5 === beklenen.md5_index ? DURUM.GECTI : DURUM.KALDI, {
          olcum,
        }),
      );
    }
  }

  // K2 — kitap ANA klasörlerindeki 43e23 (etk/ alt kopyaları kapsam dışı: desen yalnız kök ve bookN/)
  const kopyalar = [];
  if (webKok !== null) {
    for (const [yol, buf] of t) {
      if (!yol.startsWith(webKok)) continue;
      const g = yol.slice(webKok.length);
      if (MOTOR_RE.test(g)) kopyalar.push({ yol: g, md5: O.md5(buf) });
    }
  }
  kopyalar.sort((a, b) => a.yol.localeCompare(b.yol, 'en', { numeric: true }));
  const setMi = kopyalar.some((k) => k.yol.includes('/'));
  for (const k of kopyalar)
    k.yargi = setMi && !k.yol.includes('/') ? 'set-koku (yargılanmadı)' : 'ANA';
  const yargilanan = kopyalar.filter((k) => k.yargi === 'ANA');
  const m43 = { kopyalar, beklenen: beklenen.md5_43e23 || null, set: setMi };
  if (!yargilanan.length) {
    satirlar.push(
      O.sonuc(test, ad('43e23'), DURUM.KALDI, {
        olcum: { ...m43, sebep: 'kitap ana klasörlerinde 43e23fce…js yok' },
      }),
    );
  } else if (!beklenen.md5_43e23) {
    satirlar.push(
      O.sonuc(test, ad('43e23'), DURUM.OLCULEMEDI, {
        olcum: {
          ...m43,
          sebep:
            'kanonik motor md5 bilinmiyor (~/.empp-agent/motor yok, --beklenen-43e23 verilmedi)',
        },
      }),
    );
  } else {
    const farkli = yargilanan.filter((k) => k.md5 !== beklenen.md5_43e23);
    satirlar.push(
      O.sonuc(test, ad('43e23'), farkli.length ? DURUM.KALDI : DURUM.GECTI, {
        olcum: { ...m43, farkli: farkli.map((k) => k.yol), yargilanan: yargilanan.length },
      }),
    );
  }

  // G — istemci + anahtar + taban
  const giris = girisBul(t);
  const girisDizin =
    giris && giris.yol.includes('/') ? giris.yol.slice(0, giris.yol.lastIndexOf('/') + 1) : '';
  const setYolu = [`${girisDizin}${G_SET}`, G_SET, webKok ? `${webKok}${G_SET}` : null].find(
    (y) => y && t.has(y),
  );
  let setJson = null;
  let setHata = null;
  if (setYolu) {
    try {
      setJson = JSON.parse(t.get(setYolu).toString('utf8'));
    } catch (e) {
      setHata = `${G_SET} JSON çözülemedi: ${e.message}`;
    }
  }
  if (!ELECTRON_AILELERI.has(aile) && !setYolu) {
    const neden = {
      sebep: `${aile}: G istemcisinin paket içi yerleşimi tanımlı değil (Android G bağlanmadı) ve ${G_SET} yok`,
    };
    for (const a of ['g-istemci', 'g-anahtar', 'g-taban'])
      satirlar.push(O.sonuc(test, ad(a), DURUM.OLCULEMEDI, { olcum: neden }));
    return satirlar;
  }
  const eksik = [];
  const gOlcum = {
    giris: giris ? `${giris.yol} (${giris.kaynak})` : null,
    set_json: setYolu || null,
  };
  if (ELECTRON_AILELERI.has(aile)) {
    const girisBuf = giris ? t.get(giris.yol) : null;
    if (!giris || !girisBuf)
      eksik.push(`ana süreç giriş betiği okunamadı${giris ? ` (${giris.yol})` : ''}`);
    else {
      const metin = girisBuf.toString('utf8');
      gOlcum.isaret = metin.includes(G_ISARET);
      gOlcum.require = metin.includes(G_MODUL);
      if (!gOlcum.isaret) eksik.push(`${giris.yol} içinde ${G_ISARET} yok`);
      if (!gOlcum.require) eksik.push(`${giris.yol} ${G_MODUL} çağırmıyor`);
    }
    gOlcum.modul_yaninda = r.liste.includes(`${girisDizin}${G_MODUL}`);
    if (!gOlcum.modul_yaninda) eksik.push(`${G_MODUL} giriş betiğinin yanında yok`);
  }
  if (!setYolu) eksik.push(`${G_SET} yok`);
  else if (setHata) eksik.push(setHata);
  else if (!setJson || typeof setJson.setKimligi !== 'string' || !setJson.setKimligi.trim()) {
    eksik.push(
      `setKimligi boş (${setJson && setJson.sebep ? setJson.sebep : 'sebep yok'}) → kanal KAPALI`,
    );
  } else gOlcum.set_kimligi = setJson.setKimligi;
  satirlar.push(
    O.sonuc(test, ad('g-istemci'), eksik.length ? DURUM.KALDI : DURUM.GECTI, {
      olcum: { ...gOlcum, eksik },
    }),
  );

  // anahtar: yalnız parmak izi yazılır
  const imza = setJson && setJson.imza && typeof setJson.imza === 'object' ? setJson.imza : null;
  if (!setJson) {
    satirlar.push(
      O.sonuc(test, ad('g-anahtar'), DURUM.KALDI, { olcum: { sebep: setHata || `${G_SET} yok` } }),
    );
  } else if (
    !imza ||
    imza.alg !== 'ed25519' ||
    typeof imza.acikAnahtar !== 'string' ||
    !imza.acikAnahtar
  ) {
    satirlar.push(
      O.sonuc(test, ad('g-anahtar'), DURUM.KALDI, {
        olcum: {
          sebep: 'imza {alg:ed25519, acikAnahtar} yok → manifest doğrulanamaz, kanal istek yapmaz',
          alg: imza ? imza.alg || null : null,
        },
      }),
    );
  } else {
    const iz = O.sha256(Buffer.from(imza.acikAnahtar, 'base64'));
    const bek = beklenen.parmak_izi || O.URETIM_PARMAK_IZI;
    satirlar.push(
      O.sonuc(test, ad('g-anahtar'), iz === bek ? DURUM.GECTI : DURUM.KALDI, {
        olcum: { parmak_izi: iz, beklenen: bek, alg: imza.alg },
      }),
    );
  }

  if (!setJson) {
    satirlar.push(
      O.sonuc(test, ad('g-taban'), DURUM.KALDI, { olcum: { sebep: setHata || `${G_SET} yok` } }),
    );
  } else {
    const taban = typeof setJson.taban === 'string' ? setJson.taban.replace(/\/+$/, '') : null;
    const bek = String(beklenen.taban || O.VARSAYILAN_TABAN).replace(/\/+$/, '');
    const tutar = !!taban && (taban === bek || taban.startsWith(`${bek}/`));
    satirlar.push(
      O.sonuc(test, ad('g-taban'), tutar ? DURUM.GECTI : DURUM.KALDI, {
        olcum: { taban, beklenen: bek },
      }),
    );
  }
  return satirlar;
}

/* --------------------------------------------------------------------- imza */

function osslOzet(cikti) {
  const s = String(cikti || '');
  const imzaci = /Signer's certificate:[\s\S]*?Subject:\s*(.+)/.exec(s);
  const zaman = /Timestamp time:\s*(.+)/.exec(s);
  return {
    imza_dogrulama: /Signature verification: ok/i.test(s)
      ? 'ok'
      : /Signature verification: failed/i.test(s)
        ? 'failed'
        : null,
    imzaci: imzaci ? imzaci[1].trim() : null,
    zaman_damgasi: zaman ? zaman[1].trim() : null,
    hata: s
      .split('\n')
      .filter((l) => /fail|error|mismatch|unable/i.test(l))
      .slice(0, 3)
      .map((l) => l.trim()),
  };
}

async function imzaDenetle(test, okuyucu, pe, { yerelYol, araclar }) {
  const bas = Date.now();
  const sure = () => Date.now() - bas;
  if (!pe || !pe.ok) {
    return O.sonuc(
      test,
      ad('imza'),
      DURUM.KALDI,
      { olcum: { sebep: `PE başlığı çözülemedi: ${pe ? pe.sebep : 'MZ yok'}` } },
      sure(),
    );
  }
  const g = pe.guvenlik || { ofset: 0, boyut: 0 };
  if (!g.boyut) {
    return O.sonuc(
      test,
      ad('imza'),
      DURUM.KALDI,
      { olcum: { sebep: 'Authenticode güvenlik dizini YOK — paket imzasız' } },
      sure(),
    );
  }
  if (g.ofset + g.boyut > okuyucu.boyut) {
    return O.sonuc(
      test,
      ad('imza'),
      DURUM.KALDI,
      {
        olcum: {
          sebep: `güvenlik dizini dosya dışında [${g.ofset}+${g.boyut}] > ${okuyucu.boyut} (kesik?)`,
        },
      },
      sure(),
    );
  }
  let wc;
  try {
    wc = await okuyucu.oku(g.ofset, 8);
  } catch (e) {
    return O.sonuc(
      test,
      ad('imza'),
      DURUM.OLCULEMEDI,
      {
        olcum: { ofset: g.ofset, boyut: g.boyut, sebep: `WIN_CERTIFICATE okunamadı: ${e.message}` },
      },
      sure(),
    );
  }
  if (wc.length < 8) {
    return O.sonuc(
      test,
      ad('imza'),
      DURUM.KALDI,
      {
        olcum: { ofset: g.ofset, boyut: g.boyut, sebep: 'WIN_CERTIFICATE başlığı eksik (kesik?)' },
      },
      sure(),
    );
  }
  const sertifika = {
    uzunluk: wc.readUInt32LE(0),
    revizyon: `0x${wc.readUInt16LE(4).toString(16)}`,
    tur: wc.readUInt16LE(6),
  };
  const dizin = { ofset: g.ofset, boyut: g.boyut, win_certificate: sertifika };
  if (sertifika.tur !== 2) {
    return O.sonuc(
      test,
      ad('imza'),
      DURUM.KALDI,
      { olcum: { ...dizin, sebep: `WIN_CERTIFICATE türü ${sertifika.tur} (PKCS#7 = 2 değil)` } },
      sure(),
    );
  }
  const ossl = O.aracBul('osslsigncode', araclar);
  if (!yerelYol || !ossl) {
    const neden = !yerelYol
      ? 'CDN nesnesi indirilmedi (--indir yok) — zincir doğrulanmadı'
      : 'osslsigncode kurulu değil — zincir doğrulanmadı';
    return O.sonuc(
      test,
      ad('imza'),
      DURUM.SARI,
      { olcum: { ...dizin, sebep: `imza dizini var (PKCS#7); ${neden}` } },
      sure(),
    );
  }
  const komut = `${ossl} verify -in ${yerelYol}`;
  const r = O.calistir(ossl, ['verify', '-in', yerelYol], { timeout: 100000 });
  const oz = osslOzet(`${r.stdout || ''}\n${r.stderr || ''}`);
  let durum;
  if (r.status === 0 && oz.imza_dogrulama === 'ok') durum = DURUM.GECTI;
  else if (oz.imza_dogrulama === 'ok')
    durum = DURUM.SARI; // imza tutarlı, zincir/CRL doğrulanamadı
  else durum = DURUM.KALDI;
  return O.sonuc(
    test,
    ad('imza'),
    durum,
    { komut, olcum: { ...dizin, rc: r.status, ...oz } },
    sure(),
  );
}

/* -------------------------------------------------------------------- akış */

/**
 * @param {{paket?:string, url?:string, indir?:boolean, test?:string, beklenen?:Object, araclar?:Object,
 *          calisma?:string, icerik?:boolean, log?:Function}} p
 * @returns {Promise<{satirlar:Array, ozet:Object}>}
 */
async function paketDenetle(p) {
  const test = p.test || 'paket';
  const beklenen = { ...varsayilanBeklenen(), ...(p.beklenen || {}) };
  const araclar = p.araclar || {};
  const calisma = p.calisma || O.calismaDizini();
  const log = p.log || (() => {});
  const satirlar = [];
  const ozet = { girdi: p.paket || p.url, tur: p.paket ? 'yerel' : 'uzak' };
  const olcumsuzIcerik = (sebep, ek = {}) => {
    satirlar.push(O.sonuc(test, ad('icerik-ac'), DURUM.OLCULEMEDI, { olcum: { sebep, ...ek } }));
    for (const a of ICERIK_ADIMLARI)
      satirlar.push(O.sonuc(test, ad(a), DURUM.OLCULEMEDI, { olcum: { sebep, ...ek } }));
  };

  // 1) kaynak
  let t0 = Date.now();
  let okuyucu;
  let yerelYol = null;
  if (p.paket) {
    if (!fs.existsSync(p.paket)) {
      satirlar.push(
        O.sonuc(
          test,
          ad('kaynak'),
          DURUM.OLCULEMEDI,
          { dosya: p.paket, olcum: { sebep: 'dosya yok' } },
          Date.now() - t0,
        ),
      );
      return { satirlar, ozet };
    }
    okuyucu = yerelOkuyucu(p.paket);
    yerelYol = p.paket;
    satirlar.push(
      O.sonuc(
        test,
        ad('kaynak'),
        DURUM.GECTI,
        { dosya: p.paket, olcum: { boyut: okuyucu.boyut } },
        Date.now() - t0,
      ),
    );
  } else if (p.url) {
    try {
      okuyucu = await uzakOkuyucu(p.url);
    } catch (e) {
      satirlar.push(
        O.sonuc(
          test,
          ad('kaynak'),
          DURUM.OLCULEMEDI,
          { komut: `HEAD ${p.url}`, olcum: { sebep: `ağ: ${e.message}` } },
          Date.now() - t0,
        ),
      );
      return { satirlar, ozet };
    }
    const b = okuyucu.bas;
    Object.assign(ozet, { boyut: b.boyut, etag: b.etag, son_degisiklik: b.son_degisiklik });
    let durum = DURUM.GECTI;
    let sebep = null;
    if (b.status === 403 && b.cf_mitigated) {
      durum = DURUM.OLCULEMEDI;
      sebep = `Cloudflare ${b.cf_mitigated} (403) — ölçülemedi, "yok" değil`;
    } else if (b.status === 404 || b.status === 410) {
      durum = DURUM.KALDI;
      sebep = `CDN nesnesi YOK (HTTP ${b.status})`;
    } else if (b.status >= 500 || b.status === 429) {
      durum = DURUM.OLCULEMEDI;
      sebep = `CDN HTTP ${b.status}`;
    } else if (b.status !== 200) {
      durum = DURUM.KALDI;
      sebep = `CDN HTTP ${b.status}`;
    } else if (!Number.isFinite(b.boyut) || b.boyut <= 0) {
      durum = DURUM.KALDI;
      sebep = 'content-length yok/0';
    }
    satirlar.push(
      O.sonuc(
        test,
        ad('kaynak'),
        durum,
        { komut: `HEAD ${p.url}`, olcum: { ...b, ...(sebep ? { sebep } : {}) } },
        Date.now() - t0,
      ),
    );
    if (durum !== DURUM.GECTI) return { satirlar, ozet };
  } else {
    throw new Error('--paket ya da --url zorunlu');
  }
  ozet.boyut = okuyucu.boyut;

  // 2) aile + bütünlük
  t0 = Date.now();
  let tespit;
  try {
    tespit = await aileTespit(okuyucu);
  } catch (e) {
    satirlar.push(
      O.sonuc(
        test,
        ad('aile'),
        DURUM.OLCULEMEDI,
        { olcum: { sebep: `okuma: ${e.message}` } },
        Date.now() - t0,
      ),
    );
    return { satirlar, ozet };
  }
  ozet.aile = tespit.aile;
  let aileDurum = BILINEN_AILELER.has(tespit.aile) ? DURUM.GECTI : DURUM.KALDI;
  if (beklenen.aile && tespit.aile !== beklenen.aile) aileDurum = DURUM.KALDI;
  satirlar.push(
    O.sonuc(
      test,
      ad('aile'),
      aileDurum,
      { olcum: { aile: tespit.aile, beklenen: beklenen.aile || null, ...tespit.ayrinti } },
      Date.now() - t0,
    ),
  );
  if (tespit.butunluk) {
    const bd = tespit.butunluk.durum;
    const d = bd === 'TAM' ? DURUM.GECTI : bd === 'OLCULEMEDI' ? DURUM.OLCULEMEDI : DURUM.KALDI;
    satirlar.push(
      O.sonuc(test, ad('butunluk'), d, { olcum: { aile: tespit.aile, ...tespit.butunluk } }),
    );
  }

  // 3) indir (yalnız istenirse)
  if (p.url && p.indir) {
    t0 = Date.now();
    const hedefDizin = path.join(calisma, 'indirilen');
    fs.mkdirSync(hedefDizin, { recursive: true });
    const hedef = path.join(
      hedefDizin,
      decodeURIComponent(path.basename(new URL(p.url).pathname)) || 'paket',
    );
    try {
      const r = await indir(p.url, hedef);
      yerelYol = r.yol;
      ozet.md5 = r.md5;
      const durum = r.boyut === okuyucu.boyut ? DURUM.GECTI : DURUM.KALDI;
      satirlar.push(
        O.sonuc(
          test,
          ad('indir'),
          durum,
          { dosya: r.yol, olcum: { md5: r.md5, boyut: r.boyut, head_boyut: okuyucu.boyut } },
          Date.now() - t0,
        ),
      );
    } catch (e) {
      satirlar.push(
        O.sonuc(
          test,
          ad('indir'),
          DURUM.OLCULEMEDI,
          { olcum: { sebep: e.message } },
          Date.now() - t0,
        ),
      );
    }
  }

  // 4) imza (PE aileleri)
  if (tespit.pe) {
    satirlar.push(
      await imzaDenetle(test, yerelYol ? yerelOkuyucu(yerelYol) : okuyucu, tespit.pe, {
        yerelYol,
        araclar,
      }),
    );
  }

  // 5) içerik
  if (p.icerik === false) return { satirlar, ozet: { ...ozet, indirilen: okuyucu.indirilen } };
  if (!BILINEN_AILELER.has(tespit.aile)) {
    olcumsuzIcerik(`bilinmeyen aile (${tespit.aile}) — içerik açılmadı`);
  } else if (!yerelYol) {
    olcumsuzIcerik('CDN nesnesi tam indirilmedi (--indir yok) — paket içi ölçülmedi');
  } else {
    t0 = Date.now();
    let r;
    try {
      r = await icerikTopla(yerelYol, tespit.aile, (liste) => secimYap(liste).secilen, {
        araclar,
        calisma,
      });
    } catch (e) {
      r = { hata: e.message };
    }
    if (r.eksikArac) olcumsuzIcerik(`araç yok: ${r.eksikArac}`, { eksik_arac: r.eksikArac });
    else if (r.hata) {
      satirlar.push(
        O.sonuc(
          test,
          ad('icerik-ac'),
          DURUM.OLCULEMEDI,
          { olcum: { sebep: r.hata } },
          Date.now() - t0,
        ),
      );
      for (const a of ICERIK_ADIMLARI)
        satirlar.push(
          O.sonuc(test, ad(a), DURUM.OLCULEMEDI, {
            olcum: { sebep: `içerik açılamadı: ${r.hata}` },
          }),
        );
    } else {
      satirlar.push(
        O.sonuc(
          test,
          ad('icerik-ac'),
          DURUM.GECTI,
          {
            olcum: {
              kok: r.kok,
              tur: r.tur,
              arac: r.arac || null,
              dosya_sayisi: r.liste.length,
              toplanan: [...r.toplanan.keys()],
              okunan_bayt: r.okunanBayt || null,
              erken_kesildi: r.erkenKesildi || false,
              unpacked_atlanan: r.unpackedAtlanan || [],
            },
          },
          Date.now() - t0,
        ),
      );
      satirlar.push(...icerikDegerlendir(test, r, beklenen, tespit.aile));
    }
  }
  log(`paket-denetle: ${tespit.aile} ${satirlar.length} satır`);
  return { satirlar, ozet: { ...ozet, indirilen: okuyucu.indirilen } };
}

/* ---------------------------------------------------------------------- CLI */

function argumanlar(argv) {
  const a = { beklenen: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    const v = () => {
      i += 1;
      return argv[i];
    };
    if (k === '--paket') a.paket = v();
    else if (k === '--url') a.url = v();
    else if (k === '--indir') a.indir = true;
    else if (k === '--test') a.test = v();
    else if (k === '--json') a.json = true;
    else if (k === '--icerik') a.icerik = v() !== '0';
    else if (k === '--calisma') a.calisma = v();
    else if (k === '--beklenen-43e23') a.beklenen.md5_43e23 = v();
    else if (k === '--beklenen-index') a.beklenen.md5_index = v();
    else if (k === '--beklenen-taban') a.beklenen.taban = v();
    else if (k === '--beklenen-parmak-izi') a.beklenen.parmak_izi = v();
    else if (k === '--beklenen-aile') a.beklenen.aile = v();
    else throw new Error(`bilinmeyen argüman: ${k}`);
  }
  return a;
}

function tabloYaz(satirlar) {
  for (const s of satirlar) {
    const o = s.kanit.olcum || {};
    const kisa = o.sebep || o.aile || o.md5 || o.parmak_izi || o.taban || o.durum || '';
    console.log(`${s.durum.padEnd(10)} ${s.adim.padEnd(26)} ${String(kisa).slice(0, 110)}`);
  }
}

if (require.main === module) {
  let a;
  try {
    a = argumanlar(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
  if (!a.paket && !a.url) {
    console.error('kullanım: paket-denetle.js (--paket <yol> | --url <url>) [--indir] [--json]');
    process.exit(2);
  }
  const temiz = Object.fromEntries(Object.entries(a.beklenen).filter(([, v]) => v));
  paketDenetle({ ...a, beklenen: temiz })
    .then((r) => {
      if (a.json) process.stdout.write(`E2E-JSON ${JSON.stringify(r)}\n`);
      else tabloYaz(r.satirlar);
      process.exit(r.satirlar.some((s) => s.durum === DURUM.KALDI) ? 1 : 0);
    })
    .catch((e) => {
      console.error(`paket-denetle: ${e.stack || e.message}`);
      process.exit(3);
    });
}

module.exports = {
  paketDenetle,
  icerikDegerlendir,
  secimYap,
  imzaDenetle,
  osslOzet,
  varsayilanBeklenen,
  kanonikMotorMd5,
  MOTOR_RE,
  BILINEN_AILELER,
};

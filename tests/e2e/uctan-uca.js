#!/usr/bin/env node
'use strict';
/**
 * UÇTAN UCA SAĞLIK TESTİ — İSKELET (sözleşme: .claude/docs/uctan-uca-saglik-sozlesmesi.md).
 * Nadir'in beş sorusu T1-T5; her soru adımlardan oluşur, her adım `tests/e2e/adimlar/<ad>.js`.
 *
 *   plan   [--test T1,T3] [--json]                 hangi test hangi adımla koşar (kuru, ölçüm yok)
 *   kos    --test T1,T3 --kitap 74390 [--kuru] [--bildir]
 *          [--paket <yol>]... [--url <cdn>]... [--indir]
 *          [--beklenen-43e23 md5] [--beklenen-index md5] [--beklenen-taban url] [--uretilen-md5 md5]
 *   rapor  [--dosya <json>] [--liste]                son (ya da verilen) raporun özeti
 *
 * Rapor: ~/.empp-agent/e2e/<YYYYMMDD-HHMM>.json + aynı adla .md (EMPP_E2E_DIZIN ile değişir).
 * Bildirim yalnız --bildir: GECTI → `bildir kosucu`, diğer → `bildir bekci` (madde + kanıt yolu).
 * Kuru koşu: yazan/tetikleyen adım koşmaz, tam indirme yok (yalnız HEAD + Range + yerel okuma).
 * Ağır adım (yerel paket açma) `~/.empp-agent/agir.sh e2e-paket-denetle …` semaforundan geçer
 * (EMPP_E2E_AGIR=0 kapatır — testler için).
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, spawnSync } = require('child_process');
const O = require('./adimlar/ortak');
const PD = require('./adimlar/paket-denetle');

const { DURUM } = O;

const TESTLER = Object.freeze({
  T1: {
    soru: "Kitap eklenip tüm platformlar seçilince Windows güncel sözleşmeye göre üretilip imzalanıp CDN'e yükleniyor mu?",
    adimlar: ['runner-is-kaydi', 'paket-statik', 'cdn-md5-kiyas'],
  },
  T2: {
    soru: "Pardus ProBook'ta üretilip kabulden geçip CDN'e yükleniyor mu?",
    adimlar: ['uretim-yeri', 'paket-statik', 'kabul-kapisi', 'cdn-md5-kiyas'],
  },
  T3: {
    soru: 'Kabul kapısı doğru index, index güncelliği, kitabın açılması ve kitap güncelliğine bakıyor mu?',
    adimlar: ['paket-statik', 'kabul-kapisi'],
  },
  T4: {
    soru: 'DMG ve APK aynı sözleşmeyle üretiliyor ve güncelleme alabiliyor mu?',
    adimlar: ['ortak-temizlik', 'paket-statik', 'kabul-kapisi', 'g-uygula', 'k-icerik'],
  },
  T5: {
    soru: "İmpark'ta içerik güncellemesi olunca otomasyon paketleri kendisi güncelliyor mu?",
    adimlar: ['t5-tetik', 't5-yeniden-kuyruk', 't5-sabah-damga'],
  },
});

function adimYukle(ad) {
  // eslint-disable-next-line global-require, import/no-dynamic-require
  return require(path.join(__dirname, 'adimlar', `${ad}.js`));
}

function testListesi(deger) {
  const l = String(deger || Object.keys(TESTLER).join(','))
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  for (const t of l) if (!TESTLER[t]) throw new Error(`bilinmeyen test: ${t} (T1-T5)`);
  return [...new Set(l)];
}

function argumanlar(argv) {
  const a = { komut: argv[0], paketler: [], urller: [], beklenen: {} };
  for (let i = 1; i < argv.length; i += 1) {
    const k = argv[i];
    const v = () => {
      i += 1;
      if (argv[i] === undefined) throw new Error(`${k} değer ister`);
      return argv[i];
    };
    if (k === '--test') a.test = v();
    else if (k === '--kitap') a.kitap = v();
    else if (k === '--kuru') a.kuru = true;
    else if (k === '--bildir') a.bildir = true;
    else if (k === '--paket') a.paketler.push(v());
    else if (k === '--url') a.urller.push(v());
    else if (k === '--indir') a.indir = true;
    else if (k === '--json') a.json = true;
    else if (k === '--dosya') a.dosya = v();
    else if (k === '--liste') a.liste = true;
    else if (k === '--beklenen-43e23') a.beklenen.md5_43e23 = v();
    else if (k === '--beklenen-index') a.beklenen.md5_index = v();
    else if (k === '--beklenen-taban') a.beklenen.taban = v();
    else if (k === '--uretilen-md5') a.beklenen.uretilen_md5 = v();
    else throw new Error(`bilinmeyen argüman: ${k}`);
  }
  return a;
}

/* --------------------------------------------------------------------- plan */

function plan(testler) {
  return testler.map((t) => ({
    test: t,
    soru: TESTLER[t].soru,
    adimlar: TESTLER[t].adimlar.map((ad) => {
      const m = adimYukle(ad);
      return {
        adim: ad,
        modul: `tests/e2e/adimlar/${ad}.js`,
        olcut: m.olcut,
        durum: m.hazir ? 'hazır' : `bekliyor: ${m.bekliyor}`,
        yazar: !!m.yazar,
        agir: !!m.agir,
      };
    }),
  }));
}

function planYaz(p) {
  for (const t of p) {
    console.log(`\n${t.test} — ${t.soru}`);
    for (const a of t.adimlar) {
      const bayrak = [a.yazar ? 'YAZAR' : '', a.agir ? 'AĞIR' : ''].filter(Boolean).join(',');
      console.log(
        `  ${a.adim.padEnd(18)} ${a.durum.startsWith('hazır') ? 'HAZIR   ' : 'BEKLIYOR'} ` +
          `${bayrak ? `[${bayrak}] ` : ''}${a.olcut}`,
      );
      if (!a.durum.startsWith('hazır'))
        console.log(`  ${''.padEnd(18)}          → ${a.durum.slice('bekliyor: '.length)}`);
    }
  }
}

/* ------------------------------------------------------ paket denetimi (bir kez) */

const AGIR = process.env.EMPP_E2E_AGIR_BETIK || path.join(os.homedir(), '.empp-agent', 'agir.sh');

function agirAcikMi(env = process.env) {
  return env.EMPP_E2E_AGIR !== '0' && fs.existsSync(AGIR);
}

/** Yerel paket (ya da --indir) ağır işi: alt süreçte, agir.sh semaforundan. */
function altSurecteDenetle(girdi, a, calisma) {
  return new Promise((coz) => {
    const betik = path.join(__dirname, 'adimlar', 'paket-denetle.js');
    const arg = [
      betik,
      '--json',
      girdi.tur === 'paket' ? '--paket' : '--url',
      girdi.deger,
      '--calisma',
      calisma,
    ];
    if (girdi.tur === 'url' && a.indir) arg.push('--indir');
    const b = a.beklenen;
    if (b.md5_43e23) arg.push('--beklenen-43e23', b.md5_43e23);
    if (b.md5_index) arg.push('--beklenen-index', b.md5_index);
    if (b.taban) arg.push('--beklenen-taban', b.taban);
    const agir = agirAcikMi();
    const [komut, argv] = agir
      ? [AGIR, ['e2e-paket-denetle', process.execPath, ...arg]]
      : [process.execPath, arg];
    const cocuk = spawn(komut, argv, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    cocuk.stdout.on('data', (d) => {
      out += d;
    });
    cocuk.stderr.on('data', (d) => {
      err = (err + d).slice(-4000);
    });
    cocuk.on('close', (rc) => {
      const satir = out.split('\n').find((s) => s.startsWith('E2E-JSON '));
      if (satir) {
        try {
          coz({ girdi, ...JSON.parse(satir.slice('E2E-JSON '.length)), agir });
          return;
        } catch (_) {
          /* aşağı */
        }
      }
      coz({
        girdi,
        agir,
        ozet: {},
        satirlar: [
          O.sonuc('paket', 'paket-denetle/kaynak', DURUM.OLCULEMEDI, {
            komut: `${komut} ${argv.join(' ')}`,
            olcum: { sebep: `alt süreç JSON vermedi (rc=${rc})`, stderr: err.slice(-400) },
          }),
        ],
      });
    });
  });
}

async function paketleriDenetle(a, testler) {
  const statikGerek = testler.some(
    (t) =>
      TESTLER[t].adimlar.includes('paket-statik') || TESTLER[t].adimlar.includes('cdn-md5-kiyas'),
  );
  if (!statikGerek) return [];
  const calisma = O.calismaDizini();
  fs.mkdirSync(calisma, { recursive: true });
  const girdiler = [
    ...a.paketler.map((d) => ({ tur: 'paket', deger: path.resolve(d) })),
    ...a.urller.map((d) => ({ tur: 'url', deger: d })),
  ];
  const sonuclar = [];
  for (const g of girdiler) {
    const t0 = Date.now();
    let r;
    if (g.tur === 'paket' || a.indir) r = await altSurecteDenetle(g, a, calisma);
    else
      r = {
        girdi: g,
        ...(await PD.paketDenetle({ url: g.deger, beklenen: a.beklenen, calisma })),
        agir: false,
      };
    r.sure_ms = Date.now() - t0;
    sonuclar.push(r);
  }
  return sonuclar;
}

/* ---------------------------------------------------------------------- kos */

async function kos(a) {
  const testler = testListesi(a.test);
  const kitap = String(a.kitap || O.DEMO_KITAP);
  if (a.kuru && a.indir)
    throw new Error('kuru koşuda tam indirme yok (--indir ile --kuru birlikte olmaz)');
  const baslangic = new Date();
  const beklenen = { ...PD.varsayilanBeklenen(), ...a.beklenen };
  const paketSonuclari = await paketleriDenetle({ ...a, beklenen }, testler);
  const statik = adimYukle('paket-statik');

  const satirlar = [];
  for (const test of testler) {
    for (const ad of TESTLER[test].adimlar) {
      const m = adimYukle(ad);
      const t0 = Date.now();
      let r;
      try {
        r = await m.kos({
          test,
          kitap,
          kuru: !!a.kuru,
          beklenen,
          paketSonuclari,
          testeUygun: (s) => statik.testeUygun(test, s),
        });
      } catch (e) {
        r = [
          O.sonuc(
            test,
            ad,
            DURUM.OLCULEMEDI,
            { olcum: { sebep: `adım hata verdi: ${e.message}` } },
            Date.now() - t0,
          ),
        ];
      }
      for (const s of r) satirlar.push(s.sure_ms ? s : { ...s, sure_ms: Date.now() - t0 });
    }
  }
  const bitis = new Date();
  const testOzet = {};
  for (const t of testler)
    testOzet[t] = O.enKotu(satirlar.filter((s) => s.test === t).map((s) => s.durum));
  const rapor = {
    surum: 1,
    sozlesme: '.claude/docs/uctan-uca-saglik-sozlesmesi.md',
    baslangic: baslangic.toISOString(),
    bitis: bitis.toISOString(),
    sure_ms: bitis - baslangic,
    kitap,
    testler,
    kuru: !!a.kuru,
    girdiler: paketSonuclari.map((s) => ({
      ...s.girdi,
      aile: s.ozet.aile || null,
      boyut: s.ozet.boyut || null,
      etag: s.ozet.etag || null,
      indirilen: s.ozet.indirilen || 0,
      agir: s.agir,
      sure_ms: s.sure_ms,
    })),
    beklenen: {
      md5_43e23: beklenen.md5_43e23,
      md5_43e23_kaynak: beklenen.md5_43e23_kaynak,
      md5_index: beklenen.md5_index,
      parmak_izi: beklenen.parmak_izi,
      taban: beklenen.taban,
      uretilen_md5: beklenen.uretilen_md5 || null,
    },
    test_ozet: testOzet,
    sayac: O.sayac(satirlar),
    genel: O.enKotu(Object.values(testOzet)),
    sonuclar: satirlar,
  };
  const yollar = raporYaz(rapor, baslangic);
  rapor.dosyalar = yollar;
  if (a.bildir) rapor.bildirim = bildir(rapor, yollar);
  return rapor;
}

/* -------------------------------------------------------------------- rapor */

function kanitKisa(s) {
  const k = s.kanit || {};
  const o = k.olcum || {};
  const parca = [];
  if (o.sebep) parca.push(o.sebep);
  else if (o.bekliyor) parca.push(`bekliyor: ${o.bekliyor}`);
  if (o.kuru) parca.push(o.kuru);
  if (o.reddedildi) parca.push(o.reddedildi);
  if (!o.sebep) {
    if (o.aile) parca.push(`aile=${o.aile}`);
    if (o.md5) parca.push(`md5=${o.md5}`);
    if (Array.isArray(o.kopyalar))
      parca.push(
        o.kopyalar
          .map((c) => `${c.yol}=${c.md5.slice(0, 12)}${c.yargi === 'ANA' ? '' : '(k.d.)'}`)
          .join(' '),
      );
    if (o.parmak_izi) parca.push(`parmak_izi=${o.parmak_izi.slice(0, 16)}…`);
    if (o.taban) parca.push(`taban=${o.taban}`);
    if (o.durum) parca.push(`bütünlük=${o.durum}`);
    if (o.imzaci) parca.push(`imzacı=${o.imzaci}`);
    if (o.boyut && !o.aile) parca.push(`boyut=${o.boyut}`);
    if (o.son_degisiklik) parca.push(`son=${o.son_degisiklik}`);
  }
  if (k.dosya) parca.push(`dosya: ${k.dosya}`);
  return parca.join(' · ').replace(/\|/g, '\\|').slice(0, 300);
}

function mdUret(r) {
  const s = [];
  s.push(
    `# Uçtan uca sağlık — ${path.basename((r.dosyalar && r.dosyalar.json) || '', '.json') || r.baslangic}`,
  );
  s.push('');
  s.push(
    `Genel: **${r.genel}** · kitap ${r.kitap} · ${r.kuru ? 'KURU koşu' : 'tam koşu'} · ${(r.sure_ms / 1000).toFixed(1)} sn · ` +
      `GEÇTİ ${r.sayac.GECTI} · KALDI ${r.sayac.KALDI} · SARI ${r.sayac.SARI} · ÖLÇÜLEMEDİ ${r.sayac.OLCULEMEDI}`,
  );
  s.push('');
  s.push('| Test | Hüküm | Soru |');
  s.push('|---|---|---|');
  for (const t of r.testler) s.push(`| ${t} | ${r.test_ozet[t]} | ${TESTLER[t].soru} |`);
  if (r.girdiler.length) {
    s.push('');
    s.push('| Girdi | Aile | Boyut | İndirilen (Range) | Semafor |');
    s.push('|---|---|---|---|---|');
    for (const g of r.girdiler)
      s.push(
        `| ${g.deger} | ${g.aile || '-'} | ${g.boyut || '-'} | ${g.indirilen} B | ${g.agir ? 'agir.sh' : '-'} |`,
      );
  }
  s.push('');
  s.push('| Test | Adım | Durum | Kanıt | ms |');
  s.push('|---|---|---|---|---|');
  for (const x of r.sonuclar)
    s.push(`| ${x.test} | ${x.adim} | ${x.durum} | ${kanitKisa(x)} | ${x.sure_ms} |`);
  s.push('');
  s.push(
    `Beklenen: 43e23 md5 \`${r.beklenen.md5_43e23 || '-'}\` (${r.beklenen.md5_43e23_kaynak || 'verilmedi'}) · index md5 \`${r.beklenen.md5_index || '-'}\` · ` +
      `parmak izi \`${String(r.beklenen.parmak_izi).slice(0, 16)}…\` · taban ${r.beklenen.taban}`,
  );
  s.push('');
  return s.join('\n');
}

function raporYaz(r, baslangic) {
  const dizin = O.raporDizini();
  fs.mkdirSync(dizin, { recursive: true });
  const taban = O.zamanDamgasi(baslangic);
  let ad = taban;
  for (let n = 2; fs.existsSync(path.join(dizin, `${ad}.json`)); n += 1) ad = `${taban}-${n}`;
  const json = path.join(dizin, `${ad}.json`);
  const md = path.join(dizin, `${ad}.md`);
  const yollar = { json, md };
  fs.writeFileSync(json, `${JSON.stringify({ ...r, dosyalar: yollar }, null, 2)}\n`);
  fs.writeFileSync(md, mdUret({ ...r, dosyalar: yollar }));
  return yollar;
}

/** `bildir <kanal> "<mesaj>"` — iki argüman. GECTI → kosucu, değilse bekci. */
function bildirimMesaji(r, yollar) {
  if (r.genel === DURUM.GECTI) {
    return {
      kanal: 'kosucu',
      mesaj: `e2e GEÇTİ ${r.testler.join(',')} (${r.sonuclar.length} ölçüm) — ${yollar.md}`,
    };
  }
  const kotu = r.sonuclar.filter((s) => s.durum === DURUM.KALDI).slice(0, 3);
  const madde = (kotu.length ? kotu : r.sonuclar.filter((s) => s.durum !== DURUM.GECTI).slice(0, 3))
    .map((s) => `${s.test} ${s.adim} ${s.durum}`)
    .join('; ');
  return {
    kanal: 'bekci',
    mesaj: `e2e ${r.genel}: ${madde} · KALDI ${r.sayac.KALDI} ÖLÇÜLEMEDİ ${r.sayac.OLCULEMEDI} — kanıt ${yollar.json}`,
  };
}

function bildir(r, yollar) {
  const b = bildirimMesaji(r, yollar);
  const arac =
    process.env.EMPP_E2E_BILDIR ||
    O.aracBul('bildir') ||
    path.join(os.homedir(), '.local', 'bin', 'bildir');
  const x = spawnSync(arac, [b.kanal, b.mesaj], { encoding: 'utf8', timeout: 30000 });
  return { ...b, rc: x.status, hata: x.status === 0 ? null : (x.stderr || '').trim().slice(-200) };
}

function sonRapor(dosya) {
  if (dosya) return dosya;
  const dizin = O.raporDizini();
  const l = fs.existsSync(dizin)
    ? fs
        .readdirSync(dizin)
        .filter((f) => /^\d{8}-\d{4}(-\d+)?\.json$/.test(f))
        .sort()
    : [];
  return l.length ? path.join(dizin, l[l.length - 1]) : null;
}

function raporKomutu(a) {
  const dizin = O.raporDizini();
  if (a.liste) {
    const l = fs.existsSync(dizin)
      ? fs
          .readdirSync(dizin)
          .filter((f) => /^\d{8}-\d{4}(-\d+)?\.json$/.test(f))
          .sort()
          .slice(-10)
      : [];
    for (const f of l) {
      try {
        const r = JSON.parse(fs.readFileSync(path.join(dizin, f), 'utf8'));
        console.log(
          `${f.padEnd(24)} ${r.genel.padEnd(10)} ${r.testler.join(',')} ${r.kuru ? 'kuru' : ''}`,
        );
      } catch (e) {
        console.log(`${f.padEnd(24)} OKUNAMADI ${e.message}`);
      }
    }
    return 0;
  }
  const yol = sonRapor(a.dosya);
  if (!yol) {
    console.error(`rapor yok (${dizin})`);
    return 2;
  }
  const r = JSON.parse(fs.readFileSync(yol, 'utf8'));
  process.stdout.write(mdUret(r));
  return 0;
}

/* ---------------------------------------------------------------------- CLI */

async function ana(argv) {
  let a;
  try {
    a = argumanlar(argv);
  } catch (e) {
    console.error(e.message);
    return 2;
  }
  if (a.komut === 'plan') {
    const p = plan(testListesi(a.test));
    if (a.json) console.log(JSON.stringify(p, null, 2));
    else planYaz(p);
    return 0;
  }
  if (a.komut === 'kos') {
    const r = await kos(a);
    if (a.json) console.log(JSON.stringify(r, null, 2));
    else {
      for (const t of r.testler) console.log(`${t.padEnd(3)} ${r.test_ozet[t]}`);
      for (const s of r.sonuclar)
        console.log(
          `  ${s.test} ${s.durum.padEnd(10)} ${s.adim.padEnd(28)} ${kanitKisa(s).slice(0, 120)}`,
        );
      console.log(`GENEL ${r.genel} — ${r.dosyalar.md}`);
      if (r.bildirim) console.log(`bildirim: ${r.bildirim.kanal} rc=${r.bildirim.rc}`);
    }
    return r.genel === DURUM.GECTI ? 0 : r.genel === DURUM.KALDI ? 1 : 3;
  }
  if (a.komut === 'rapor') return raporKomutu(a);
  console.error('kullanım: uctan-uca.js plan|kos|rapor [seçenekler] — başlıktaki açıklamaya bak');
  return 2;
}

if (require.main === module) {
  ana(process.argv.slice(2))
    .then((rc) => process.exit(rc))
    .catch((e) => {
      console.error(e.stack || e.message);
      process.exit(3);
    });
}

module.exports = { TESTLER, plan, kos, ana, mdUret, bildirimMesaji, testListesi, argumanlar };

#!/usr/bin/env node
'use strict';

/**
 * ELLE KAYNAK KURULUMU — TEK SET, runner DIŞI, platform paketi ÜRETMEZ (06.10).
 *
 * Neden: kaynağı hiç olmayan set (ör. 11845 Super Monsters 3 Set — `kaynak_build_surumleri` boş,
 * Mac arşivinde yok) yalnız r2-kur claim'iyle kurulur; runner kaynak-kur yeteneğini evde açmaz,
 * android açmak evde APK üretir. Bu araç runner'ın r2-kur zincirini (`processJob`) AYNEN koşturur:
 *
 *   taban/üreteç → içerik kapısı → merdiven S0 → set eki → kabuk tazele ('ikili', Mac) → panel menü
 *   → imKeys → menü başlığı → [yazma kapısı (B5) → R2 yayını]
 *
 * ve paketleyiciye gitmeden DURUR. Kopya mantık YOK: claim gövdesi runner'ın `parseNextJob`'undan,
 * zincir `processJob`'dan, kapı `kaynak-r2.yazmaKapisiSor`'dan, yayın `kaynak-r2.r2KurYayinla`'dan.
 * Araç yalnız iki seam'i değiştirir: `kaynakAdim.r2KurYayinla` (kuru: kapı-yalnız; uygula: gerçek
 * yayın + arşiv önbelleği) ve `CONFIG.apiBase` (yerel GEÇİT — aşağıda).
 *
 * GEÇİT (yerel HTTP, 127.0.0.1, rastgele kapı): runner'ın sunucu çağrıları buraya gelir.
 *   kuru   → HİÇBİR çağrı iletilmez (kayıt + 200). R2'ye / DB'ye yazma YOK.
 *   uygula → yalnız `agents/<id>/kaynak/{presign-multipart,tamamla,birak}` gerçek API'ye iletilir;
 *            kira bırakma (`release`), sonuç, nabız YUTULUR (aynı jetonlu canlı runner'ın kirası
 *            bozulmasın).
 *
 * CLAIM: sunucudan değil, srv21 DB'sinden (salt SELECT, `ssh … pipeline-sql`) kurulur — claim
 * kurucusunun okuduğu alanlar: `pipeline_book_summaries` (başlık, yayıncı, kilit), web-stream
 * `proxy_asset_id` (setListesi, `set-listesi-claim.ts` ile aynı satır, HAM), `book_pages.short_code`
 * (kisaKod; liste boşsa üreteç Worker KV'den okur — `uretec-kaynak.listeCoz`).
 * Geçerli kaynak build'i olan set REDDEDİLİR (taban imzalı R2 GET ister — claim işi; runner'ı bekle).
 *
 * KİLİT (uygula): `kaynak_kurulum_ajan/surum/bitis` YALNIZ claim yolunda (next-job, rol 'kur',
 * book-update `kaynak-build-deposu.ts`) alınır; ajan için ayrı kilit ucu YOK. `--uygula` kilidin bu
 * ajanda (token.json agentId), süresi dolmamış ve sürümün `kaynak_kurulum_surum` olduğunu SELECT ile
 * denetler; değilse hiçbir şey kurmadan çıkar (çıkış 1). Sürüm kodu claim'inkiyle aynı biçim
 * (`2.<panel kodu>.<sayaç>`) — doğrudan kilit satırından alınır.
 *
 * Kullanım: node tools/kaynak-kur/elle-kur.js --set <id> [--uygula] [--cikti <dizin>]
 *             [--platform mac|android] [--surum 2.x.y (yalnız kuru, etiket)]
 * Çıkış: 0 kuru kapı GEÇTİ / uygula tamam · 1 kapı RED, ertelendi, hata, kullanım.
 * Jeton yalnız runner'ın `loadToken`'ıyla okunur; içeriği hiçbir yere basılmaz.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ISARET = '[elle-kur]';
const VARSAYILAN_CIKTI_KOKU = '/private/tmp/claude-501/-Users-nadir/'
  + '006cff11-8d65-4460-944b-a19c21ec727c/scratchpad/elle-kur';
/** run-agent.sh'taki r2-kur zinciri bayrakları (yalnız tanımsızsa konur; runner require'dan ÖNCE). */
const ZINCIR_ORTAMI = Object.freeze({
  EMPP_ARSIV_MERDIVEN: '1',
  EMPP_SET_UYELIK_EK: '1',
  EMPP_SET_KABUK_TAZELE: '1',
  EMPP_SET_MENU: '1',
  EMPP_SET_LISTESI_DIZINI: path.join(os.homedir(), '.empp-agent', 'set-listesi'),
});
const PLATFORMLAR = Object.freeze(['mac', 'android']);
const KURU_SURUM = '2.0.0';
const KURU_KILIT_MS = 6 * 60 * 60 * 1000;
/** uygula'da geçide gelen ve gerçek API'ye İLETİLEN tek yollar. */
const ILETILEN_YOL = /^\/agents\/[A-Za-z0-9_-]{1,64}\/kaynak\/(presign-multipart|tamamla|birak)$/;
const SURUM_DESENI = /^2\.\d+\.\d+$/;

/** Zinciri durduran işaret (paketleyiciye gidilmez). */
class ElleKurDurdu extends Error {
  constructor(neden) {
    super(`${ISARET} durdu: ${neden}`);
    this.neden = neden;
  }
}

// ─── Saf yardımcılar ──────────────────────────────────────────────────────────────────────

/** Komut satırı. SAF. @returns {{set, uygula, cikti, platform, surum, yardim?, hata?}} */
function argAyristir(argv) {
  const o = { set: null, uygula: false, cikti: null, platform: 'mac', surum: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const deger = () => {
      const v = argv[i + 1];
      if (v == null || String(v).startsWith('--')) return '';
      i += 1;
      return String(v);
    };
    if (a === '--set') o.set = deger();
    else if (a === '--uygula') o.uygula = true;
    else if (a === '--cikti') o.cikti = deger();
    else if (a === '--platform') o.platform = deger();
    else if (a === '--surum') o.surum = deger();
    else if (a === '--yardim' || a === '-h' || a === '--help') o.yardim = true;
    else return { ...o, hata: `bilinmeyen argüman: ${a}` };
  }
  if (o.yardim) return o;
  if (!o.set || !/^\d{1,12}$/.test(o.set)) return { ...o, hata: '--set <sayısal kimlik> zorunlu' };
  if (!PLATFORMLAR.includes(o.platform)) {
    return { ...o, hata: `--platform ${PLATFORMLAR.join('|')} olmalı` };
  }
  if (o.cikti === '') return { ...o, hata: '--cikti <dizin> değer ister' };
  if (o.surum !== null && !SURUM_DESENI.test(o.surum)) {
    return { ...o, hata: '--surum 2.<panel kodu>.<sayaç> olmalı' };
  }
  if (o.uygula && o.surum !== null) {
    return { ...o, hata: '--uygula sürümü kilit satırından alır; --surum verilmez' };
  }
  return o;
}

/**
 * Tek SELECT (salt okuma). Metin `;`, `"`, `$`, ters tırnak taşımaz (uzak kabukta
 * `pipeline-sql "…"`). Metin alanları HEX — TSV kaçışı / çok satırlı liste bozulmasın. SAF.
 */
function sqlKur(setId) {
  if (!/^\d{1,12}$/.test(String(setId))) throw new Error('sqlKur: sayısal set kimliği gerekli');
  const sql = 'SELECT s.book_id, HEX(s.book_title) AS baslik_hex,'
    + ' HEX(s.publisher_name) AS yayinci_hex,'
    + ' (SELECT bp.short_code FROM book_pages bp WHERE bp.book_id = s.book_id'
    + ' AND bp.short_code IS NOT NULL AND bp.short_code <> \'\' LIMIT 1) AS kisa_kod,'
    + ' HEX(w.proxy_asset_id) AS liste_hex,'
    + ' s.kaynak_kurulum_ajan AS kilit_ajan, s.kaynak_kurulum_surum AS kilit_surum,'
    + ' UNIX_TIMESTAMP(s.kaynak_kurulum_bitis) AS kilit_bitis, UNIX_TIMESTAMP(NOW(3)) AS simdi,'
    + ' (SELECT k.surum FROM kaynak_build_surumleri k WHERE k.set_id = s.book_id'
    + ' AND k.durum = \'gecerli\' LIMIT 1) AS gecerli_surum'
    + ' FROM pipeline_book_summaries s'
    + ' LEFT JOIN pipeline_platform_summaries w ON w.book_id = s.book_id'
    + ' AND w.platform = \'web-stream\' AND w.deleted_at IS NULL'
    + ` WHERE s.book_id = '${setId}' AND s.deleted_at IS NULL LIMIT 1`;
  if (/[;"$`\\]/.test(sql)) throw new Error('sqlKur: güvensiz karakter');
  return sql;
}

const bosMu = (v) => v == null || v === '' || v === 'NULL';
const hexMetin = (h) => (bosMu(h) ? null : Buffer.from(h, 'hex').toString('utf8'));

/** `pipeline-sql` TSV (başlıklı) → set satırı ya da null. SAF. */
function satirAyristir(tsv) {
  const satirlar = String(tsv || '').split('\n').map((s) => s.replace(/\r$/, '')).filter(Boolean);
  if (satirlar.length < 2) return null;
  const baslik = satirlar[0].split('\t');
  const h = satirlar[1].split('\t');
  const al = (ad) => {
    const i = baslik.indexOf(ad);
    return i < 0 ? null : h[i];
  };
  const ms = (v) => (bosMu(v) || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 1000));
  return {
    bookId: al('book_id'),
    bookTitle: hexMetin(al('baslik_hex')),
    publisherName: hexMetin(al('yayinci_hex')),
    kisaKod: bosMu(al('kisa_kod')) ? null : al('kisa_kod'),
    setListesi: hexMetin(al('liste_hex')),
    kilit: {
      ajan: bosMu(al('kilit_ajan')) ? null : al('kilit_ajan'),
      surum: bosMu(al('kilit_surum')) ? null : al('kilit_surum'),
      bitisMs: ms(al('kilit_bitis')),
      simdiMs: ms(al('simdi')),
    },
    gecerliSurum: bosMu(al('gecerli_surum')) ? null : al('gecerli_surum'),
  };
}

/** uygula ön koşulu: kilit bu ajanda, süresi dolmamış, sürüm kayıtlı. SAF. */
function kilitDenetle(satir, agentId) {
  const k = (satir && satir.kilit) || {};
  const ipucu = 'kilit yalnız claim yolunda (next-job, rol kur) alınır — runner dışı kilit ucu yok';
  if (!k.ajan) return { tamam: false, neden: `kurma kilidi yok (${ipucu})` };
  if (k.ajan !== agentId) {
    return { tamam: false, neden: `kilit başka ajanda (${k.ajan}) — bu jeton ${agentId}` };
  }
  if (!k.surum || !SURUM_DESENI.test(k.surum)) {
    return { tamam: false, neden: `kilit sürümü yok/biçim dışı (${k.surum})` };
  }
  if (!k.bitisMs || !k.simdiMs || k.bitisMs <= k.simdiMs) {
    return { tamam: false, neden: 'kilit süresi dolmuş' };
  }
  return { tamam: true, surum: k.surum, kalanDk: Math.round((k.bitisMs - k.simdiMs) / 60000) };
}

/**
 * Ham r2-kur claim'i (tabanUrl YOK: taban arşiv ya da üreteç — runner `kaynakKarari` seçer). SAF.
 * Dönüş runner'ın `parseNextJob`'una verilir; iş nesnesi runner'ınkiyle birebir olur.
 */
function claimKur({ satir, platform, kaynakSurumu, kurulumBitisMs }) {
  return {
    bookId: String(satir.bookId),
    platform,
    kaynakTuru: 'r2-kur',
    kaynakSurumu,
    kurulumBitis: new Date(kurulumBitisMs).toISOString(),
    ...(satir.bookTitle ? { bookTitle: satir.bookTitle } : {}),
    ...(satir.publisherName ? { publisherName: satir.publisherName } : {}),
    ...(satir.setListesi && satir.setListesi.trim() ? { setListesi: satir.setListesi } : {}),
    ...(satir.kisaKod ? { kisaKod: satir.kisaKod } : {}),
  };
}

/** Zip kök özeti (`unzip -l` yerine runner'ın zip okuyucusuyla): kök klasör → dosya/bayt. SAF. */
function zipKokOzeti(zipDizini) {
  const kok = new Map();
  for (const g of zipDizini.values()) {
    if (g.dizin) continue;
    const parca = g.ad.split('/');
    const ad = parca.length > 1 ? `${parca[0]}/` : parca[0];
    const o = kok.get(ad) || { ad, dosya: 0, bayt: 0 };
    o.dosya += 1;
    o.bayt += Number(g.boyut) || 0;
    kok.set(ad, o);
  }
  return [...kok.values()].sort((a, b) => a.ad.localeCompare(b.ad, 'tr', { numeric: true }));
}

// ─── Geçit (yerel HTTP) ───────────────────────────────────────────────────────────────────

async function varsayilanIlet({ url, yontem, govde, jeton }) {
  const r = await fetch(url, {
    method: yontem,
    headers: { 'Content-Type': 'application/json', ...(jeton ? { 'X-Agent-Token': jeton } : {}) },
    body: yontem === 'GET' ? undefined : govde,
    signal: AbortSignal.timeout(130000),
  });
  return { status: r.status, govde: await r.text() };
}

/**
 * Yerel geçit: kuru'da hiçbir şey iletilmez; uygula'da yalnız ILETILEN_YOL. Kayıtta jeton YOK.
 * @param {{kip: 'kuru'|'uygula', hedefApi: string, ilet?: Function}} o
 * @returns {{baslat: () => Promise<string>, kapat: () => Promise<void>, kayit: object[]}}
 */
function gecitKur({ kip, hedefApi, ilet = varsayilanIlet }) {
  const kayit = [];
  const sunucu = http.createServer((req, res) => {
    const parca = [];
    req.on('data', (x) => parca.push(x));
    req.on('end', async () => {
      const govde = Buffer.concat(parca).toString('utf8');
      const yol = String(req.url || '').split('?')[0];
      const iletilir = kip === 'uygula' && ILETILEN_YOL.test(yol);
      const k = { yontem: req.method, yol, iletildi: iletilir, status: 200 };
      kayit.push(k);
      if (!iletilir) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, elleKur: 'yutuldu' }));
        return;
      }
      try {
        const r = await ilet({
          url: `${hedefApi}${yol}`, yontem: req.method, govde,
          jeton: String(req.headers['x-agent-token'] || ''),
        });
        k.status = r.status;
        res.writeHead(r.status, { 'Content-Type': 'application/json' });
        res.end(r.govde);
      } catch (e) {
        k.status = 502;
        k.hata = String((e && e.message) || e).slice(0, 200);
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'elle_kur_gecit', message: k.hata }));
      }
    });
  });
  return {
    kayit,
    baslat: () => new Promise((ok) => {
      sunucu.listen(0, '127.0.0.1', () => ok(`http://127.0.0.1:${sunucu.address().port}`));
    }),
    kapat: () => new Promise((ok) => { sunucu.close(() => ok()); }),
  };
}

// ─── Yayın seam'leri ──────────────────────────────────────────────────────────────────────

/** Kapı sonucunun rapora giden (sır taşımayan) özeti. */
function kapiOzeti(k, kaynakR2, ekWebz = []) {
  const v = k || {};
  return {
    gecti: Boolean(v.gecti),
    nedenler: v.nedenler || [],
    nedenKodlari: v.nedenKodlari || [],
    notlar: v.notlar || [],
    boyutGerekce: v.boyutGerekce || null,
    kitaplar: kaynakR2.tamamlaKitaplari(v.kitaplar),
    webzVarliklari: kaynakR2.tamamlaWebzVarliklari([...(v.webzVarliklari || []), ...(ekWebz || [])]),
  };
}

/** KURU: yalnız yazma kapısı (r2KurYayinla'nın ilk adımı, aynı girdi) + özet + kopya. Yayın YOK. */
function kuruYayinKur({ sonuc, ciktiZip, kaynakR2 }) {
  return async (o) => {
    const k = kaynakR2.yazmaKapisiSor(o);
    sonuc.kapi = kapiOzeti(k, kaynakR2, o.ekWebzVarliklari);
    sonuc.setListesiKapi = o.setListesi || null;
    sonuc.tamamlaEki = o.tamamlaEki || {};
    sonuc.vsler = o.vsler || {};
    sonuc.ozet = await o.ozet(o.zipYolu);
    await fsp.mkdir(path.dirname(ciktiZip), { recursive: true });
    await fsp.copyFile(o.zipYolu, ciktiZip, fs.constants.COPYFILE_FICLONE);
    sonuc.zip = ciktiZip;
    throw new ElleKurDurdu(k.gecti ? 'kuru-kapi-gecti' : 'kuru-kapi-red');
  };
}

/** UYGULA: gerçek r2KurYayinla (geçit üzerinden) + arşiv önbelleği (runner'ın yayın sonrası adımı). */
function uygulaYayinKur({ sonuc, gercekYayin, arsiveYaz, kaynakR2, uyari }) {
  return async (o) => {
    const y = await gercekYayin(o);
    sonuc.yayin = {
      surum: y.surum, sha256: y.sha256, boyut: y.boyut, r2ObjectKey: y.r2ObjectKey,
      kitaplar: y.kitaplar, degismedi: Boolean(y.degismedi),
    };
    sonuc.ozet = y.ozet;
    sonuc.kapi = { gecti: true, kitaplar: kaynakR2.tamamlaKitaplari(y.kitaplar) };
    await arsiveYaz(o.job.bookId, o.zipYolu, { surum: y.surum, ...y.ozet, uyari });
    throw new ElleKurDurdu('uygula-tamam');
  };
}

// ─── Akış ─────────────────────────────────────────────────────────────────────────────────

function komutKostur(cmd, args, { zamanAsimiMs = 90000 } = {}) {
  return new Promise((resolve) => {
    let p;
    try {
      p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      resolve({ code: -1, stdout: '', stderr: String(e && e.message) });
      return;
    }
    let out = '';
    let err = '';
    const z = setTimeout(() => p.kill('SIGKILL'), zamanAsimiMs);
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => {
      clearTimeout(z);
      resolve({ code: -1, stdout: out, stderr: `${err}${e.message}` });
    });
    p.on('close', (code) => {
      clearTimeout(z);
      resolve({ code, stdout: out, stderr: err });
    });
  });
}

/** Varsayılan bağımlılıklar (testler değiştirir; runner tembel — ZINCIR_ORTAMI önce kurulur). */
function varsayilanBag(env = process.env) {
  const ekUret = () => require('../set-kabuk/ek-uret');
  return {
    env,
    log: (...a) => console.log(new Date().toISOString(), ...a),
    dbOku: async (setId) => {
      const r = await komutKostur('ssh', [...ekUret().sshHedefi(env), `pipeline-sql "${sqlKur(setId)}"`]);
      const s = ekUret().sqlSonucu(r);
      if (s.durum === 'bos') return null;
      if (s.durum === 'hata') throw new Error(`DB okunamadı (çıkış ${s.kod}): ${s.hata}`);
      return satirAyristir(s.stdout);
    },
    runner: () => require('../../src/agent/runner'),
    helpers: () => require('../../src/agent/runner-helpers'),
    kaynakR2: () => require('../../src/agent/kaynak-r2'),
    arsiveYaz: (...a) => require('../../src/agent/kaynak-arsivi').r2ArsiveYaz(...a),
    zipDizini: (z) => require('../../src/agent/icerik-merdiven').zipDizini(z),
    simdi: () => Date.now(),
  };
}

/** Zincir ortamını kur (yalnız tanımsız bayraklar). */
function ortamHazirla(env) {
  for (const [k, v] of Object.entries(ZINCIR_ORTAMI)) {
    if (env[k] == null || env[k] === '') env[k] = v;
  }
}

/** Rapor alanları (sır yok: imKeys kodları, jeton rapora girmez). SAF. */
function raporDoldur(rapor, { job, sonuc, gecit }) {
  const kt = job.kabukTazeleme;
  const ik = sonuc.imKeys;
  const ir = ik && ik.rapor;
  Object.assign(rapor, {
    gecit,
    uretec: job.uretecOzeti || null,
    kabuk: kt ? {
      durum: kt.durum, kod: kt.kod || null, neden: kt.neden || null, girdiSha: kt.girdiSha || null,
      kitaplar: kt.kitaplar || null, dosyaSayisi: kt.dosyaSayisi ?? null,
    } : null,
    merdiven: sonuc.merdiven ? (sonuc.merdiven.satirlar || []).map((s) => ({
      kitap: s.kitap, id: s.id, surum: s.surum ?? null, vs: s.vs ?? null, durum: s.durum, not: s.not || null,
    })) : null,
    aktivasyon: ik ? {
      kapi: ik.kapi ? { gecti: ik.kapi.gecti, nedenler: ik.kapi.nedenler } : null,
      paketAnahtarli: ir ? ir.paketAnahtarli : null,
      kapakSayisi: ir ? ir.kapakSayisi : null,
      anahtarliKapak: ir && Array.isArray(ir.anahtarli) ? ir.anahtarli.length : null,
      yazilan: ir && ir.yazilan ? ir.yazilan.length : null,
      kodSayisi: ir ? ir.kodSayisi : null,
    } : null,
    icerikSurumleri: job.icerikSurumleri || null,
    kapi: sonuc.kapi || null,
    ozet: sonuc.ozet ? { sha256: sonuc.ozet.sha256, boyut: sonuc.ozet.boyut, md5: sonuc.ozet.md5 } : null,
    zip: sonuc.zip || null,
    yayin: sonuc.yayin || null,
  });
}

/**
 * Tek set: DB → claim → processJob (seam'li) → rapor. Dönüş {kod, rapor}.
 * @param {ReturnType<typeof argAyristir>} args
 */
async function elleKur(args, bag = varsayilanBag()) {
  const { log } = bag;
  const cikti = args.cikti || path.join(VARSAYILAN_CIKTI_KOKU, String(args.set));
  const kip = args.uygula ? 'uygula' : 'kuru';
  const rapor = {
    set: String(args.set), kip, platform: args.platform, cikti, basla: new Date().toISOString(),
  };
  const bitir = async (kod, ek = {}) => {
    Object.assign(rapor, ek, { kod, bitis: new Date().toISOString() });
    try {
      await fsp.mkdir(cikti, { recursive: true });
      await fsp.writeFile(path.join(cikti, `rapor-${kip}.json`), `${JSON.stringify(rapor, null, 2)}\n`);
    } catch (e) {
      log(`${ISARET} rapor yazılamadı: ${e.message}`);
    }
    return { kod, rapor };
  };

  const satir = await bag.dbOku(args.set);
  if (!satir) return bitir(1, { hata: `set ${args.set} pipeline_book_summaries'te yok` });
  Object.assign(rapor, {
    baslik: satir.bookTitle, yayinci: satir.publisherName, kisaKod: satir.kisaKod,
    listeSatiri: satir.setListesi ? satir.setListesi.split('\n').filter((s) => s.trim()).length : 0,
  });
  if (satir.gecerliSurum) {
    return bitir(1, {
      hata: `geçerli kaynak build'i var (${satir.gecerliSurum}) — taban imzalı R2 GET ister; `
        + 'bu araç yalnız kaynaksız seti kurar, runner claim\'ini bekle',
    });
  }

  const runner = bag.runner();
  let auth;
  let kaynakSurumu;
  let kurulumBitisMs;
  if (args.uygula) {
    auth = await runner.loadToken();
    if (!auth || !auth.agentId || !auth.token) {
      return bitir(1, { hata: 'ajan jetonu okunamadı (runner loadToken)' });
    }
    const kd = kilitDenetle(satir, auth.agentId);
    rapor.kilit = { ...kd, ajan: satir.kilit.ajan };
    if (!kd.tamam) return bitir(1, { hata: `uygula reddedildi: ${kd.neden}` });
    kaynakSurumu = kd.surum;
    kurulumBitisMs = satir.kilit.bitisMs;
  } else {
    auth = { agentId: 'elle-kur-kuru', token: 'kuru' };
    kaynakSurumu = args.surum || satir.kilit.surum || KURU_SURUM;
    kurulumBitisMs = bag.simdi() + KURU_KILIT_MS;
    rapor.kilit = { ajan: satir.kilit.ajan, surum: satir.kilit.surum, not: 'kuru: kilit gerekmez' };
  }
  rapor.kaynakSurumu = kaynakSurumu;

  const job = bag.helpers().parseNextJob(200, claimKur({
    satir, platform: args.platform, kaynakSurumu, kurulumBitisMs,
  }));
  if (!job || job.kaynakGecersiz) {
    return bitir(1, { hata: `claim geçersiz: ${(job && job.kaynakGecersiz) || 'parseNextJob null'}` });
  }

  const kaynakR2 = bag.kaynakR2();
  const { CONFIG, kaynakAdim } = runner;
  const gecit = gecitKur({ kip, hedefApi: CONFIG.apiBase, ...(bag.ilet ? { ilet: bag.ilet } : {}) });
  const sonuc = {};
  const eski = {
    apiBase: CONFIG.apiBase, serbest: CONFIG.kaynakKurSerbestFlag, kaynakKur: CONFIG.kaynakKur,
    yayin: kaynakAdim.r2KurYayinla, merdiven: kaynakAdim.merdiven, imKeys: kaynakAdim.imKeys,
  };
  await fsp.mkdir(cikti, { recursive: true });
  const serbestDosyasi = path.join(cikti, '.kaynak-kur-serbest.istek');
  await fsp.writeFile(serbestDosyasi, `${ISARET} yalnız bu süreç (CONFIG kopyası)\n`);
  let donus;
  let hata = null;
  try {
    CONFIG.apiBase = await gecit.baslat();
    // Bant kapısı (kaynakKurIzinli): bu süreç için açık izin — canlı runner'ın bayrağına DOKUNULMAZ.
    CONFIG.kaynakKurSerbestFlag = serbestDosyasi;
    CONFIG.kaynakKur = true;
    kaynakAdim.merdiven = async (o) => {
      const r = await eski.merdiven(o);
      sonuc.merdiven = r;
      return r;
    };
    kaynakAdim.imKeys = async (o) => {
      const r = await eski.imKeys(o);
      sonuc.imKeys = r;
      return r;
    };
    kaynakAdim.r2KurYayinla = args.uygula
      ? uygulaYayinKur({ sonuc, gercekYayin: eski.yayin, arsiveYaz: bag.arsiveYaz, kaynakR2, uyari: log })
      : kuruYayinKur({ sonuc, ciktiZip: path.join(cikti, 'build.zip'), kaynakR2 });
    log(`${ISARET} ${job.bookId} ${kip}: r2-kur zinciri (processJob) başlıyor — sürüm ${kaynakSurumu}`);
    donus = await runner.processJob(auth, job);
  } catch (e) {
    if (e instanceof ElleKurDurdu) sonuc.durdu = e.neden;
    else hata = e;
  } finally {
    CONFIG.apiBase = eski.apiBase;
    CONFIG.kaynakKurSerbestFlag = eski.serbest;
    CONFIG.kaynakKur = eski.kaynakKur;
    kaynakAdim.r2KurYayinla = eski.yayin;
    kaynakAdim.merdiven = eski.merdiven;
    kaynakAdim.imKeys = eski.imKeys;
    await gecit.kapat();
  }

  raporDoldur(rapor, { job, sonuc, gecit: gecit.kayit });
  if (sonuc.zip) {
    try {
      rapor.zipKok = zipKokOzeti(bag.zipDizini(sonuc.zip));
    } catch (e) {
      rapor.zipKok = { hata: e.message };
    }
  }
  if (hata) return bitir(1, { hata: String((hata && hata.message) || hata).slice(0, 600) });
  if (!sonuc.durdu) {
    // processJob yayına varmadan döndü (erteleme): failed yok, kilit/kira geçitte (kuru: yutuldu).
    return bitir(1, { hata: `zincir yayına varmadı: ${(donus && donus.sebep) || JSON.stringify(donus)}` });
  }
  if (sonuc.durdu === 'kuru-kapi-red') return bitir(1, { hata: 'yazma kapısı RED — yayın yok' });
  return bitir(0);
}

/** Rapor → kısa Türkçe tablo (konsol). SAF. */
function raporMetni(r) {
  const mb = (b) => (b == null ? '-' : `${(b / 1e6).toFixed(1)} MB`);
  const s = ['| Alan | Değer |', '|---|---|'];
  s.push(`| Set | ${r.set} ${r.baslik || ''} (${r.yayinci || '-'}) |`);
  s.push(`| Kip / sürüm | ${r.kip} / ${r.kaynakSurumu || '-'} |`);
  s.push(`| Sonuç | ${r.kod === 0 ? 'TAMAM' : `HATA: ${r.hata || '-'}`} |`);
  if (r.kapi) {
    s.push(`| Yazma kapısı | ${r.kapi.gecti ? 'GEÇTİ' : `RED: ${(r.kapi.nedenler || []).join(' / ')}`} |`);
  }
  if (r.ozet) s.push(`| Boyut / sha256 | ${mb(r.ozet.boyut)} / ${r.ozet.sha256} |`);
  if (r.zip) s.push(`| Zip | ${r.zip} |`);
  if (r.uretec) {
    s.push(`| Üreteç | liste ${r.uretec.liste || '-'}, kalıp ${r.uretec.kalip}, `
      + `${r.uretec.kitap} kitap, ${r.uretec.linkKarti} link |`);
  }
  if (r.kabuk) {
    s.push(`| Kabuk tazele | ${r.kabuk.durum}${r.kabuk.kod ? ` (${r.kabuk.kod})` : ''}, `
      + `imza ${String(r.kabuk.girdiSha || '-').slice(0, 16)} |`);
  }
  if (r.aktivasyon) {
    s.push(`| Aktivasyon | anahtarlı paket ${r.aktivasyon.paketAnahtarli ? 'EVET' : 'HAYIR'}, `
      + `anahtarlı kapak ${r.aktivasyon.anahtarliKapak ?? '-'} |`);
  }
  if (r.yayin) s.push(`| R2 | ${r.yayin.surum} → ${r.yayin.r2ObjectKey} |`);
  if (r.kapi && r.kapi.kitaplar && r.kapi.kitaplar.length) {
    s.push('', '| n | id | vs | içerik | kapak |', '|---|---|---|---|---|');
    for (const k of r.kapi.kitaplar) {
      s.push(`| book${k.n} | ${k.id ?? '-'} | ${k.vs ?? '-'} | ${k.icerik ? 'var' : '-'} | ${k.kapak ? 'var' : '-'} |`);
    }
  }
  if (r.kapi && r.kapi.webzVarliklari && r.kapi.webzVarliklari.length) {
    s.push('', `Web-Z/link: ${r.kapi.webzVarliklari.map((w) => `${w.n}:${w.id}(${w.yol})`).join(', ')}`);
  }
  if (r.merdiven) {
    s.push('', '| merdiven | id | sürüm | vs | durum |', '|---|---|---|---|---|');
    for (const m of r.merdiven) {
      s.push(`| ${m.kitap} | ${m.id ?? '-'} | ${m.surum ?? '-'} | ${m.vs ?? '-'} | ${m.durum} |`);
    }
  }
  if (Array.isArray(r.zipKok)) {
    s.push('', '| zip kökü | dosya | boyut |', '|---|---|---|');
    for (const z of r.zipKok) s.push(`| ${z.ad} | ${z.dosya} | ${mb(z.bayt)} |`);
  }
  if (r.gecit && r.gecit.length) {
    const g = r.gecit.map((x) => `${x.yontem} ${x.yol.replace(/^\/agents\/[^/]+\//, '')}`
      + `${x.iletildi ? ` →${x.status}` : ' (yutuldu)'}`);
    s.push('', `Geçit: ${g.join(', ')}`);
  }
  return s.join('\n');
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const args = argAyristir(argv);
  if (args.yardim) {
    console.log('node tools/kaynak-kur/elle-kur.js --set <id> [--uygula] [--cikti <dizin>] '
      + '[--platform mac|android] [--surum 2.x.y]');
    return 0;
  }
  if (args.hata) {
    console.error(`${ISARET} ${args.hata}`);
    return 1;
  }
  ortamHazirla(env);
  try {
    const { kod, rapor } = await elleKur(args, varsayilanBag(env));
    console.log(`\n${raporMetni(rapor)}\n\nrapor: ${path.join(rapor.cikti, `rapor-${rapor.kip}.json`)}`);
    return kod;
  } catch (e) {
    console.error(`${ISARET} hata: ${String((e && e.message) || e).slice(0, 600)}`);
    return 1;
  }
}

if (require.main === module) {
  main().then((k) => process.exit(k), (e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = {
  ISARET, ZINCIR_ORTAMI, ILETILEN_YOL, ElleKurDurdu,
  argAyristir, sqlKur, satirAyristir, kilitDenetle, claimKur, zipKokOzeti, gecitKur,
  kuruYayinKur, uygulaYayinKur, kapiOzeti, ortamHazirla, raporDoldur, elleKur, raporMetni,
  varsayilanBag, main,
};

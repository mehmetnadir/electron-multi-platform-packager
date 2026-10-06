#!/usr/bin/env node
'use strict';

/**
 * KABUK EKİ ÜRETİCİ (Mac, Parça C) — 06.10.
 * Tasarım: `~/.empp-agent/arastirma/set-kabuk-0510/kabuk-eki-tasarim.md` §1, §2, §4, §5 C.
 *
 * Akış (set başına):
 *   geçerli build (Mac kaynak arşivi → kabuk-ek önbelleği → `rclone copyto` indirme;
 *   sha256 doğrulanır)
 *   → merdiven + set eki (runner `kaynakAdim`, r2-kur zinciriyle AYNI JS, aynı env bayrakları)
 *   → `kabukTazele({kabukKaynagi:'ikili', ekCikti})` (Swift ikilisi + mevcut kapı)
 *   → `manifestKur` + `ekPaketle` → tavan denetimi
 *   → `rclone copyto` ek → `kabuk-ek/<id>/<girdiSha>.zip`, SONRA `kabuk-ek/<id>/son.json`.
 *   Kalıcı ret (kapı RED, eşleme, kapak) + girdiSha biliniyorsa →
 *   `kabuk-ek/<id>/<girdiSha>.ret.json`.
 *
 * Kipler: `--set <id>[,<id>…]` (elle) · `--bekleyen` (srv21 DB, tek SELECT, SSH/Tailscale).
 * Seçenekler: `--kuru` (R2'ye HİÇBİR şey yazılmaz) · `--cikti <dizin>` (ek yerelde de bırakılır).
 * Tek kopya kilidi `~/.empp-agent/kabuk-ek.kilit` (mkdir; sahip süreç ölünce bayat sayılır).
 * `~/.empp-agent/duraklat.istek` varsa hiç çalışmaz.
 *
 * SİLME YOK: geçici dizinler `os.tmpdir()` altında mkdtemp ile açılır ve bırakılır (OS temizler);
 * kilit bırakılırken os.tmpdir altına TAŞINIR.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const ISARET = '[kabuk-ek]';
const SSH_HEDEF = ['-o', 'ConnectTimeout=20', '-o', 'BatchMode=yes', '-p', '2222',
  'root@100.117.187.26'];
const R2_UZAK = 'ydsr2';
/** Ekin yazıldığı TEK bucket: ProBook eki `cdn.ydspublishing.com/<yol>` adresinden okur (G6). */
const EK_BUCKET = 'ydsdigital';
const RCLONE_AYAR = ['--contimeout', '30s', '--timeout', '5m', '--retries', '3',
  '--low-level-retries', '10'];
/** Kalıcı ret sayılan kabukTazele nedenleri (tasarım §2): eşleme, kapak, kapı RED. */
const KALICI_RET = [/kapı RED/, /eşlenemeyen Web-Z üyesi/, /kapak geçersiz/];
/** Aynı istek + taban için yeniden denenmeyen "uygun değil" nedenleri (kabukTazele uygunluk). */
const UYGUN_DEGIL = /bookN düzeni yok|tek kitaplı paket|dokunulmaz|Web-Z listesinde kitap yok/;

// ─── Saf yardımcılar ──────────────────────────────────────────────────────────────────────

/** Komut satırı. SAF. @returns {{kip, setler, kuru, cikti, hata?}} */
function argAyristir(argv) {
  const o = { kip: null, setler: [], kuru: false, cikti: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--kuru') o.kuru = true;
    else if (a === '--bekleyen') o.kip = o.kip ? 'cift' : 'bekleyen';
    else if (a === '--set' || a === '--cikti') {
      const v = argv[i + 1];
      if (!v || v.startsWith('--')) return { ...o, hata: `${a} değer ister` };
      i += 1;
      if (a === '--cikti') o.cikti = path.resolve(v);
      else {
        o.kip = o.kip ? 'cift' : 'set';
        o.setler = v.split(',').map((s) => s.trim()).filter(Boolean);
      }
    } else return { ...o, hata: `bilinmeyen argüman: ${a}` };
  }
  if (!o.kip) return { ...o, hata: '--set <id>[,<id>…] ya da --bekleyen gerekli' };
  if (o.kip === 'cift') return { ...o, hata: '--set ve --bekleyen birlikte kullanılmaz' };
  if (o.kip === 'set' && (!o.setler.length || o.setler.some((s) => !/^\d+$/.test(s)))) {
    return { ...o, hata: `--set yalnız sayısal kimlik alır: ${o.setler.join(',')}` };
  }
  return o;
}

const SQL_SECIM = 'SELECT s.book_id, (SELECT bp.short_code FROM book_pages bp'
  + ' WHERE bp.book_id = s.book_id AND bp.short_code IS NOT NULL AND bp.short_code <> \'\''
  + ' LIMIT 1) AS kisa_kod, k.surum, k.r2_anahtar, k.sha256, k.boyut, r.bucket,'
  + ' HEX(w.proxy_asset_id) AS liste_hex, s.kaynak_kur_istegi_at'
  + ' FROM pipeline_book_summaries s'
  + ' JOIN kaynak_build_surumleri k ON k.set_id = s.book_id AND k.durum = \'gecerli\''
  + ' LEFT JOIN r2_configs r ON r.id = k.r2_config_id'
  + ' LEFT JOIN pipeline_platform_summaries w ON w.book_id = s.book_id'
  + ' AND w.platform = \'web-stream\' AND w.deleted_at IS NULL'
  + ' WHERE s.deleted_at IS NULL';

/**
 * Tek SELECT. `--bekleyen`: kaynakRoluKarar'ın 'kur' koşulu (book-update lib/kaynak-rolu.ts):
 * istek > geçerli build oluşturma, mod manuel değil, son ret istekten eski (Ö4); yalnız
 * ydsdigital bucket'ı (YDS). Kilit (başka ajan kuruyor) süzülmez: ek kurulumdan ÖNCE hazır olmalı.
 * Metin `;`, `"`, `$`, ters tırnak taşımaz (uzak kabukta `pipeline-sql "…"` içinde koşar). SAF.
 */
function sqlKur({ kip, setler = [] }) {
  let sql = SQL_SECIM;
  if (kip === 'bekleyen') {
    sql += ` AND r.bucket = '${EK_BUCKET}' AND COALESCE(s.kaynak_modu, 'otomatik') <> 'manuel'`
      + ' AND s.kaynak_kur_istegi_at > k.olusturma'
      + ' AND (s.kaynak_kur_ret_at IS NULL OR s.kaynak_kur_ret_at < s.kaynak_kur_istegi_at)'
      + ' ORDER BY s.kaynak_kur_istegi_at';
  } else {
    if (!setler.length || setler.some((s) => !/^\d+$/.test(String(s)))) {
      throw new Error('sqlKur: sayısal set kimliği gerekli');
    }
    sql += ` AND s.book_id IN (${setler.join(', ')})`;
  }
  if (/[;"$`\\]/.test(sql)) throw new Error('sqlKur: güvensiz karakter');
  return sql;
}

/** `pipeline-sql` TSV çıktısı (başlık satırlı, NULL metni) → set satırları; book_id tekil. SAF. */
function satirlariAyristir(tsv) {
  const satirlar = String(tsv || '').split('\n').map((s) => s.replace(/\r$/, '')).filter(Boolean);
  if (!satirlar.length) return [];
  const baslik = satirlar[0].split('\t');
  const sutun = (ad) => baslik.indexOf(ad);
  const gerekli = ['book_id', 'kisa_kod', 'surum', 'r2_anahtar', 'sha256', 'boyut', 'bucket',
    'liste_hex', 'kaynak_kur_istegi_at'];
  const eksik = gerekli.filter((g) => sutun(g) < 0);
  if (eksik.length) throw new Error(`SQL çıktısında sütun yok: ${eksik.join(',')}`);
  const deger = (h, ad) => {
    const v = h[sutun(ad)];
    return v === undefined || v === 'NULL' ? null : v;
  };
  const gorulen = new Set();
  const out = [];
  for (const s of satirlar.slice(1)) {
    const h = s.split('\t');
    const bookId = deger(h, 'book_id');
    if (!bookId || gorulen.has(bookId)) continue;
    gorulen.add(bookId);
    const hex = deger(h, 'liste_hex');
    out.push({
      bookId,
      kisaKod: deger(h, 'kisa_kod'),
      surum: deger(h, 'surum'),
      anahtar: deger(h, 'r2_anahtar'),
      sha256: String(deger(h, 'sha256') || '').toLowerCase(),
      boyut: Number(deger(h, 'boyut')),
      bucket: deger(h, 'bucket'),
      setListesi: hex ? Buffer.from(hex, 'hex').toString('utf8') : null,
      istekAt: deger(h, 'kaynak_kur_istegi_at'),
    });
  }
  return out;
}

/** Satır üretilebilir mi (taban okunabilir, ek yazılabilir). SAF. @returns {string|null} neden */
function satirEngeli(s) {
  if (s.bucket !== EK_BUCKET) return `bucket ${s.bucket || '-'} (yalnız ${EK_BUCKET}: YDS)`;
  if (!s.kisaKod) return 'kisaKod yok (book_pages.short_code)';
  if (!/^kaynak\/\d+\/[^/\s]+\/build\.zip$/.test(String(s.anahtar || ''))) {
    return `taban anahtarı beklenen biçimde değil: ${s.anahtar}`;
  }
  if (!/^[0-9a-f]{64}$/.test(s.sha256) || !(s.boyut > 0)) return 'taban sha256/boyut yok';
  return null;
}

/** kabukTazele nedeni kalıcı ret mi. SAF. */
function kaliciRetMi(neden) {
  return KALICI_RET.some((d) => d.test(String(neden || '')));
}

/** `webz-kabuk-uret.surum` satırı (`kaynak=… sha256=…`) → {kaynak, sha256}. SAF. */
function aracSurumuAyristir(metin) {
  const al = (ad) => {
    const m = new RegExp(`(?:^|\\s)${ad}=(\\S+)`).exec(String(metin || ''));
    return m ? m[1] : null;
  };
  return { kaynak: al('kaynak'), sha256: al('sha256') };
}

/** --bekleyen: aynı istek + aynı taban için kesin sonuç kaydı varsa yeniden üretilmez. SAF. */
function zatenIslendi(durum, s) {
  const d = durum && durum[s.bookId];
  return Boolean(d && d.istekAt === s.istekAt && d.tabanSurum === s.surum);
}

/** Sonuç durum dosyasına yazılır mı (kesin sonuç; geçici hata yeniden denenir). SAF. */
function kesinSonucMu(sonuc, kuru) {
  if (kuru) return false;
  if (['yuklendi', 'tavan', 'ret'].includes(sonuc.durum)) return true;
  return sonuc.durum === 'atlandi' && UYGUN_DEGIL.test(String(sonuc.neden || ''));
}

// ─── IO yardımcıları ─────────────────────────────────────────────────────────────────────

function komutKostur(cmd, args, { zamanAsimiMs = 30 * 60 * 1000 } = {}) {
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
    let doldu = false;
    const z = setTimeout(() => { doldu = true; p.kill('SIGKILL'); }, zamanAsimiMs);
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => {
      clearTimeout(z);
      resolve({ code: -1, stdout: out, stderr: `${err}${e.message}` });
    });
    p.on('close', (code) => {
      clearTimeout(z);
      resolve({ code: doldu ? -2 : code, stdout: out, stderr: doldu ? `${err}zaman aşımı` : err });
    });
  });
}

async function sha256Dosya(dosya) {
  const h = crypto.createHash('sha256');
  for await (const parca of fs.createReadStream(dosya)) h.update(parca);
  return h.digest('hex');
}

function okuSessiz(dosya) {
  try { return fs.readFileSync(dosya, 'utf8'); } catch (_) { return null; }
}

function canliMi(pid) {
  if (!(pid > 0)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return Boolean(e && e.code === 'EPERM');
  }
}

/** Dizini os.tmpdir altına taşır (silmez; OS temizler). Taşınamazsa false. */
function kenaraAl(dizin) {
  try {
    const hedef = fs.mkdtempSync(path.join(os.tmpdir(), 'kabuk-ek-kilit-'));
    fs.renameSync(dizin, path.join(hedef, 'kilit'));
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Tek kopya kilidi (mkdir atomik). Sahip pid ölmüşse kilit bayattır: kenara alınır, yeniden
 * denenir.
 * pid dosyası henüz yazılmamış taze kilit (<30 sn) MEŞGUL sayılır.
 * @returns {null | (() => void)} null = başka kopya çalışıyor; fonksiyon = bırak
 */
function kilitAl(kilit, { pid = process.pid, canli = canliMi, simdi = Date.now } = {}) {
  const pidDosyasi = path.join(kilit, 'pid');
  const yaz = () => {
    fs.writeFileSync(pidDosyasi, `${pid}\n`);
    let birakildi = false;
    return () => {
      if (birakildi) return;
      birakildi = true;
      if (Number(okuSessiz(pidDosyasi)) !== pid) return;
      // Taşınamazsa pid boşaltılır: sonraki kopya kilidi bayat sayar.
      if (!kenaraAl(kilit)) {
        try { fs.writeFileSync(pidDosyasi, ''); } catch (_) { /* yok */ }
      }
    };
  };
  fs.mkdirSync(path.dirname(kilit), { recursive: true });
  try {
    fs.mkdirSync(kilit);
    return yaz();
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }
  const sahipMetni = okuSessiz(pidDosyasi);
  const sahip = Number(sahipMetni);
  if (sahip && canli(sahip)) return null;
  if (sahipMetni == null) {
    let yas = Infinity;
    try { yas = simdi() - fs.statSync(kilit).mtimeMs; } catch (_) { /* yok */ }
    if (yas < 30000) return null;
  }
  if (!kenaraAl(kilit)) return yaz(); // taşınamadı: bayat kilit devralınır
  try {
    fs.mkdirSync(kilit);
  } catch (e) {
    if (e.code === 'EEXIST') return null;
    throw e;
  }
  return yaz();
}

/** Varsayılan bağımlılıklar (testler hepsini değiştirir; require tembel). */
function varsayilanBag(env = process.env) {
  const ev = env.EMPP_AGENT_DIZINI || path.join(os.homedir(), '.empp-agent');
  const kabuk = () => require('../../src/agent/set-kabuk-tazele');
  return {
    env,
    ev,
    log: (...a) => console.log(new Date().toISOString(), ...a),
    warn: (...a) => console.warn(new Date().toISOString(), ...a),
    ssh: (sql) => komutKostur('ssh', [...SSH_HEDEF, `pipeline-sql "${sql}"`],
      { zamanAsimiMs: 90000 }),
    rclone: (args) => komutKostur('rclone', [...args, ...RCLONE_AYAR]),
    bildir: (metin) => komutKostur('bildir', ['kosucu', metin], { zamanAsimiMs: 20000 }),
    ek: () => require('../../src/agent/kabuk-ek'),
    kabukTazele: (o) => kabuk().kabukTazele(o),
    kaynakAdim: () => require('../../src/agent/runner').kaynakAdim,
    r2Onbellek: (...a) => require('../../src/agent/kaynak-arsivi').r2Onbellek(...a),
    merdivenAcik: () => require('../../src/agent/icerik-merdiven').merdivenAcik(env),
    setEki: () => require('../../src/agent/set-uyelik-ek'),
    aracSurumu: () => aracSurumuAyristir(okuSessiz(`${kabuk().ikiliYolu(env)}.surum`)),
  };
}

// ─── Adımlar ─────────────────────────────────────────────────────────────────────────────

/**
 * Taban build'i iş kopyasına koyar: (1) Mac kaynak arşivi (r2Surum + sha256 aynı) →
 * (2) `kabuk-ek-onbellek/<id>/<sürüm>.zip` (boyut + sha damgası) → (3) rclone indirme + sha256.
 * Kaynak dosyalar DEĞİŞMEZ (klon kopya).
 */
async function tabanHazirla(bag, s, calisma) {
  const hedef = path.join(calisma, 'build.zip');
  const klon = (kaynak) => fsp.copyFile(kaynak, hedef, fs.constants.COPYFILE_FICLONE);
  const onb = await bag.r2Onbellek(s.bookId, {
    surum: s.surum, sha256: s.sha256, boyut: s.boyut, bilgi: bag.log,
  });
  if (onb) {
    await klon(onb.zip);
    return { zip: hedef, kaynak: 'arsiv' };
  }
  const dizin = path.join(bag.ev, 'kabuk-ek-onbellek', String(s.bookId));
  const dosya = path.join(dizin, `${s.surum}.zip`);
  const damgaDosyasi = `${dosya}.sha256`;
  const damga = (st) => `${s.sha256} ${st.size} ${Math.floor(st.mtimeMs)}`;
  if (fs.existsSync(dosya)) {
    const st = fs.statSync(dosya);
    if (st.size === s.boyut && (String(okuSessiz(damgaDosyasi) || '').trim() === damga(st)
      || await sha256Dosya(dosya) === s.sha256)) {
      fs.writeFileSync(damgaDosyasi, `${damga(st)}\n`);
      await klon(dosya);
      return { zip: hedef, kaynak: 'onbellek' };
    }
    bag.warn(`${ISARET} ${s.bookId}: önbellek ${s.surum}.zip tutmuyor — yeniden indirilecek`);
  }
  await fsp.mkdir(dizin, { recursive: true });
  const parca = `${dosya}.indiriliyor`;
  const basla = Date.now();
  bag.log(`${ISARET} ${s.bookId}: taban indiriliyor ${s.bucket}/${s.anahtar} `
    + `(${(s.boyut / 1e6).toFixed(0)} MB)`);
  const r = await bag.rclone(['copyto', `${R2_UZAK}:${s.bucket}/${s.anahtar}`, parca]);
  if (r.code !== 0) {
    const hata = String(r.stderr).trim().slice(-200);
    throw new Error(`taban indirilemedi (rclone ${r.code}): ${hata}`);
  }
  const st = fs.statSync(parca);
  const oz = await sha256Dosya(parca);
  if (st.size !== s.boyut || oz !== s.sha256) {
    throw new Error(`taban doğrulanamadı: ${st.size} bayt, sha256 ${oz.slice(0, 12)} `
      + `≠ ${s.boyut}/${s.sha256.slice(0, 12)}`);
  }
  await fsp.rename(parca, dosya);
  fs.writeFileSync(damgaDosyasi, `${damga(fs.statSync(dosya))}\n`);
  bag.log(`${ISARET} ${s.bookId}: taban indirildi ${((Date.now() - basla) / 1000).toFixed(0)} sn`);
  await klon(dosya);
  return { zip: hedef, kaynak: 'indirme' };
}

/** Merdiven + set eki (runner r2-kur zinciri; aynı env bayrakları, aynı fonksiyonlar). */
async function kaynakAdimlari(bag, s, zip, calisma) {
  const adim = bag.kaynakAdim();
  const setEk = bag.setEki();
  const job = { bookId: s.bookId, kisaKod: s.kisaKod, platform: 'kabuk-ek' };
  if (s.setListesi && s.setListesi.trim()) job.setListesi = s.setListesi;
  const ortak = {
    zip, calisma, bookId: s.bookId, platform: job.platform, log: bag.log, warn: bag.warn,
  };
  if (bag.merdivenAcik()) await adim.merdiven({ ...ortak });
  if (setEk.ekAcik(bag.env)) {
    const liste = setEk.setListesiCoz({ job, env: bag.env });
    if (!liste) {
      bag.log(`${setEk.ISARET} set listesi yok (DB web-stream, EMPP_SET_LISTESI_DIZINI) — atlandı`);
    } else {
      try {
        await adim.setEki({ ...ortak, liste: liste.ham, listeKaynagi: liste.kaynak });
      } catch (e) {
        bag.warn(`${setEk.ISARET} beklenmeyen hata, mevcut bileşimle devam: ${e && e.message}`);
      }
    }
  }
  return job;
}

async function rcloneYaz(bag, yerel, anahtar) {
  const r = await bag.rclone(['copyto', yerel, `${R2_UZAK}:${EK_BUCKET}/${anahtar}`]);
  if (r.code !== 0) throw new Error(`rclone ${r.code}: ${String(r.stderr).trim().slice(-200)}`);
}

async function retYaz(bag, s, ek, girdiSha, neden, o) {
  const govde = `${JSON.stringify({
    neden: String(neden), bookId: String(s.bookId), girdiSha, uretildi: new Date().toISOString(),
  }, null, 2)}\n`;
  const anahtar = ek.retAnahtari(String(s.bookId), girdiSha);
  const dizin = await fsp.mkdtemp(path.join(os.tmpdir(), `kabuk-ek-ret-${s.bookId}-`));
  const dosya = path.join(dizin, path.basename(anahtar));
  await fsp.writeFile(dosya, govde);
  if (o.cikti) {
    await fsp.mkdir(path.join(o.cikti, String(s.bookId)), { recursive: true });
    await fsp.writeFile(path.join(o.cikti, String(s.bookId), path.basename(anahtar)), govde);
  }
  if (o.kuru) {
    bag.log(`${ISARET} ${s.bookId}: ret işareti ${anahtar} (--kuru, yazılmadı)`);
    return;
  }
  try {
    await rcloneYaz(bag, dosya, anahtar);
    bag.log(`${ISARET} ${s.bookId}: ret işareti yazıldı ${anahtar}`);
  } catch (e) {
    bag.warn(`${ISARET} ${s.bookId}: ret işareti yazılamadı — ${e.message}`);
  }
}

/**
 * Bir seti işler. FIRLATMAZ.
 * @returns {Promise<{bookId, durum: 'yuklendi'|'kuru'|'tavan'|'ret'|'atlandi'|'hata', neden,
 *   girdiSha?, bayt?, dosyaSayisi?, anahtar?, sureMs}>}
 */
async function setIsle(bag, s, o) {
  const basla = Date.now();
  const sonuc = { bookId: s.bookId, durum: 'hata', neden: null };
  const bitir = (durum, neden, ek = {}) => {
    Object.assign(sonuc, ek, { durum, neden, sureMs: Date.now() - basla });
    const alanlar = ['girdiSha', 'kip', 'bayt', 'dosyaSayisi', 'anahtar', 'taban']
      .filter((k) => sonuc[k] != null).map((k) => `${k}=${sonuc[k]}`).join(' ');
    const satir = `${ISARET} SONUÇ ${s.bookId} durum=${durum} ${alanlar} sure=${sonuc.sureMs}ms`
      + `${neden ? ` — ${neden}` : ''}`;
    (['hata', 'tavan', 'ret'].includes(durum) ? bag.warn : bag.log)(satir);
    return sonuc;
  };
  try {
    const engel = satirEngeli(s);
    if (engel) return bitir('atlandi', engel);
    const ek = bag.ek();
    const calisma = await fsp.mkdtemp(path.join(os.tmpdir(), `kabuk-ek-${s.bookId}-`));
    const taban = await tabanHazirla(bag, s, calisma);
    sonuc.taban = `${s.surum}/${taban.kaynak}`;
    const job = await kaynakAdimlari(bag, s, taban.zip, calisma);

    let cikti = null;
    const kt = await bag.kabukTazele({
      zip: taban.zip, calisma, job, log: bag.log, warn: bag.warn, kabukKaynagi: 'ikili',
      ekCikti: async (v) => { cikti = v; },
    });
    const girdiSha = (cikti && cikti.girdiSha) || (kt && kt.girdiSha) || null;
    if (girdiSha) sonuc.girdiSha = girdiSha;
    const ktDurum = kt && kt.durum;
    if (!cikti || !['uygulandi', 'guncel'].includes(ktDurum)) {
      const neden = `kabuk ${ktDurum || '?'}: ${(kt && kt.neden) || 'ek çıktısı yok'}`;
      if (ktDurum === 'atlandi' && kaliciRetMi(kt.neden)) {
        if (girdiSha) await retYaz(bag, s, ek, girdiSha, kt.neden, o);
        const notu = girdiSha ? '' : ' (girdiSha yok, ret işareti yazılmadı)';
        const kisa = String(kt.neden).slice(0, 160);
        await bag.bildir(`kabuk-ek ${s.bookId}: KALICI RET${notu} — ${kisa}`);
        return bitir('ret', neden);
      }
      return bitir('atlandi', neden);
    }
    const { dosyalar } = cikti;
    const kip = cikti.kip || (kt.kip === 'a1' ? 'a1' : 'bookN');
    sonuc.kip = kip;
    sonuc.dosyaSayisi = dosyalar.size;
    const arac = bag.aracSurumu();
    const manifest = ek.manifestKur({
      bookId: String(s.bookId), kisaKod: s.kisaKod, kip, girdiSha,
      webzSettingsSha: cikti.webzSettingsSha, tabanSurum: s.surum, tabanSha256: s.sha256,
      arac: { kaynak: arac.kaynak, sha256: arac.sha256 }, dosyalar,
    });
    // Beyaz liste klasörleri (images/<klasör>.png) — ProBook ekAc ile AYNI küme.
    const kitaplar = cikti.girdi && Array.isArray(cikti.girdi.kitaplar)
      ? cikti.girdi.kitaplar : null;
    const secenek = kitaplar ? { klasorler: new Set(kitaplar.map((k) => String(k.klasor))) } : {};
    let paket = null;
    try {
      paket = ek.ekPaketle({ manifest, dosyalar }, secenek);
    } catch (e) {
      if (!(e && e.kod === 'tavan')) throw e;
    }
    const tavan = ek.EK_TAVAN_BAYT;
    if (!paket || paket.length > tavan) {
      const bayt = paket ? paket.length : null;
      if (bayt != null) sonuc.bayt = bayt;
      await bag.bildir(`kabuk-ek ${s.bookId}: ek TAVANI aştı (${bayt ?? '?'} > ${tavan} bayt)`
        + ' — yüklenmedi');
      return bitir('tavan', `ek ${bayt ?? '?'} bayt > tavan ${tavan}`);
    }
    sonuc.bayt = paket.length;
    const ekSha = crypto.createHash('sha256').update(paket).digest('hex');
    const anahtar = ek.ekAnahtari(String(s.bookId), girdiSha);
    const sonAnahtar = ek.sonAnahtari(String(s.bookId));
    sonuc.anahtar = anahtar;
    const son = {
      bookId: String(s.bookId), girdiSha, kip, uretildi: new Date().toISOString(),
      tabanSurum: s.surum,
    };
    const sonMetni = `${JSON.stringify(son, null, 2)}\n`;
    const ekDosyasi = path.join(calisma, `${girdiSha}.zip`);
    const sonDosyasi = path.join(calisma, 'son.json');
    await fsp.writeFile(ekDosyasi, paket);
    await fsp.writeFile(sonDosyasi, sonMetni);
    bag.log(`${ISARET} ${s.bookId}: ek ${paket.length} bayt, ${dosyalar.size} dosya, `
      + `girdiSha ${girdiSha}, ek sha256 ${ekSha.slice(0, 12)}, kabuk ${ktDurum}`);
    if (o.cikti) {
      const yerel = path.join(o.cikti, String(s.bookId));
      await fsp.mkdir(yerel, { recursive: true });
      await fsp.writeFile(path.join(yerel, `${girdiSha}.zip`), paket);
      await fsp.writeFile(path.join(yerel, 'son.json'), sonMetni);
      bag.log(`${ISARET} ${s.bookId}: yerel çıktı ${yerel}`);
    }
    if (o.kuru) return bitir('kuru', 'R2 yazılmadı (--kuru)');
    // SIRA: önce ek (içerik adresli), SONRA son.json — son.json yalnız var olan eki gösterir.
    try {
      await rcloneYaz(bag, ekDosyasi, anahtar);
    } catch (e) {
      await bag.bildir(`kabuk-ek ${s.bookId}: ek yüklenemedi — ${e.message.slice(0, 160)}`);
      return bitir('hata', `ek yüklenemedi: ${e.message}`);
    }
    try {
      await rcloneYaz(bag, sonDosyasi, sonAnahtar);
    } catch (e) {
      await bag.bildir(`kabuk-ek ${s.bookId}: son.json yüklenemedi — ${e.message.slice(0, 160)}`);
      return bitir('hata', `son.json yüklenemedi (ek yüklendi): ${e.message}`);
    }
    return bitir('yuklendi', null);
  } catch (e) {
    return bitir('hata', String((e && e.message) || e).slice(0, 300));
  }
}

function durumOku(dosya) {
  try { return JSON.parse(fs.readFileSync(dosya, 'utf8')) || {}; } catch (_) { return {}; }
}

function durumYaz(dosya, durum) {
  const gecici = `${dosya}.${process.pid}.yaziliyor`;
  fs.writeFileSync(gecici, `${JSON.stringify(durum, null, 2)}\n`);
  fs.renameSync(gecici, dosya);
}

/**
 * Giriş. Çıkış kodu: 0 (iş yok / meşgul / duraklatıldı / hepsi tamam), 1 (en az bir set hata
 * ya da DB okunamadı), 2 (kullanım).
 */
async function main(argv, bag = varsayilanBag()) {
  const o = argAyristir(argv);
  if (o.hata) {
    bag.warn(`${ISARET} kullanım: ek-uret.js (--set <id>[,<id>…] | --bekleyen) [--kuru]`
      + ` [--cikti <dizin>] — ${o.hata}`);
    return 2;
  }
  const duraklat = path.join(bag.ev, 'duraklat.istek');
  if (fs.existsSync(duraklat)) {
    bag.log(`${ISARET} duraklat.istek var — çalışılmadı`);
    return 0;
  }
  const birak = kilitAl(path.join(bag.ev, 'kabuk-ek.kilit'));
  if (!birak) {
    bag.log(`${ISARET} başka kopya çalışıyor (kabuk-ek.kilit) — çıkıldı`);
    return 0;
  }
  const isleyiciler = [['SIGTERM', 143], ['SIGINT', 130]]
    .map(([ad, kod]) => [ad, () => { birak(); process.exit(kod); }]);
  const dinle = bag.sinyalDinle !== false;
  if (dinle) for (const [ad, f] of isleyiciler) process.on(ad, f);
  try {
    const r = await bag.ssh(sqlKur(o));
    if (r.code !== 0) {
      bag.warn(`${ISARET} DB sorgusu başarısız (ssh ${r.code}): `
        + `${String(r.stderr).trim().slice(-200)}`);
      return 1;
    }
    let satirlar = satirlariAyristir(r.stdout);
    if (o.kip === 'set') {
      const bulunan = new Set(satirlar.map((s) => s.bookId));
      for (const id of o.setler.filter((x) => !bulunan.has(x))) {
        bag.warn(`${ISARET} ${id}: geçerli build kaydı yok — atlandı`);
      }
    }
    const durumDosyasi = path.join(bag.ev, 'kabuk-ek-durum.json');
    const durum = durumOku(durumDosyasi);
    if (o.kip === 'bekleyen') {
      const once = satirlar.length;
      satirlar = satirlar.filter((s) => !zatenIslendi(durum, s));
      bag.log(`${ISARET} bekleyen ${once} set, ${once - satirlar.length} zaten işlendi`
        + `${satirlar.length ? `: ${satirlar.map((s) => s.bookId).join(',')}` : ''}`);
    }
    let hata = 0;
    for (const s of satirlar) {
      if (fs.existsSync(duraklat)) {
        bag.log(`${ISARET} duraklat.istek geldi — kalan setler bırakıldı`);
        break;
      }
      const sonuc = await setIsle(bag, s, o);
      if (sonuc.durum === 'hata') hata += 1;
      if (kesinSonucMu(sonuc, o.kuru)) {
        durum[s.bookId] = {
          istekAt: s.istekAt, tabanSurum: s.surum, durum: sonuc.durum,
          girdiSha: sonuc.girdiSha || null, zaman: new Date().toISOString(),
        };
        durumYaz(durumDosyasi, durum);
      }
    }
    return hata ? 1 : 0;
  } finally {
    birak();
    if (dinle) for (const [ad, f] of isleyiciler) process.removeListener(ad, f);
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).then((kod) => { process.exitCode = kod; }, (e) => {
    console.error(new Date().toISOString(), `${ISARET} ölümcül:`, (e && e.stack) || e);
    process.exitCode = 1;
  });
}

module.exports = {
  ISARET, EK_BUCKET, argAyristir, sqlKur, satirlariAyristir, satirEngeli, kaliciRetMi,
  aracSurumuAyristir, zatenIslendi, kesinSonucMu, kilitAl, canliMi, tabanHazirla, setIsle, main,
  varsayilanBag,
};

#!/usr/bin/env node
'use strict';

/**
 * KABUK EKİ ÜRETİCİ (Mac, Parça C) — 06.10.
 * Tasarım: `~/.empp-agent/arastirma/set-kabuk-0510/kabuk-eki-tasarim.md` §1, §2, §4, §5 C.
 *
 * Akış (set başına):
 *   araç denetimi (Swift ikilisi, zip, rclone) — tabandan ÖNCE
 *   → geçerli build (Mac kaynak arşivi → `kabuk-ek-onbellek/<id>/taban.zip` → `rclone copyto`;
 *     sha256 doğrulanır)
 *   → merdiven + set eki (runner `kaynakAdim`, r2-kur zinciriyle AYNI JS, aynı env bayrakları)
 *   → `kabukTazele({kabukKaynagi:'ikili', ekCikti})` (Swift ikilisi + mevcut kapı)
 *   → `manifestKur` + `ekPaketle` → tavan (A `tavanAl()`) → ed25519 imza (`ekImzala`)
 *   → yükleme sırası: `<girdiSha>.zip` → `<girdiSha>.imza` → `son.json` (`kabuk-ek/<id>/`).
 *   Kalıcı ret (kapı RED, eşleme, kapak 404/küçük gövde) + girdiSha biliniyorsa →
 *   `kabuk-ek/<id>/<girdiSha>.ret.json`.
 *
 * Kipler: `--set <id>[,<id>…]` (elle) · `--bekleyen` (srv21 DB, tek SELECT, SSH/Tailscale) ·
 * `--anahtar-uret` (ed25519 çifti `~/.empp-agent/kabuk-ek-imza/`; var olanı EZMEZ).
 * Seçenekler: `--kuru` (R2'ye HİÇBİR şey yazılmaz) · `--cikti <dizin>` (ek yerelde de bırakılır).
 * Tek kopya kilidi `~/.empp-agent/kabuk-ek.kilit` (mkdir; sahip süreç ölünce bayat sayılır).
 * `~/.empp-agent/duraklat.istek` varsa hiç çalışmaz.
 *
 * DİSK: çalışma dizini sabittir (`~/.empp-agent/kabuk-ek-calisma/<id>/`), her koşu dosyaların
 * ÜZERİNE yazar; taban önbelleği set başına TEK dosyadır (`taban.zip` + `taban.json`), yeni sürüm
 * rename ile eskisinin üzerine gelir. Bu dosya hiçbir şey SİLMEZ (rm/rmdir/unlink yok); kilit
 * bırakılırken os.tmpdir altına taşınır. Not: çağrılan mevcut adımlar (set-kabuk-tazele,
 * icerik-merdiven, set-uyelik-ek) KENDİ açtıkları sahne/aday dosyalarını çalışma dizininde
 * `fsp.rm` ile kaldırır; bu onların bugünkü davranışıdır, bu dosya silme EKLEMEZ.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const ISARET = '[kabuk-ek]';
const SSH_SECENEK = ['-o', 'ConnectTimeout=20', '-o', 'BatchMode=yes'];
const SSH_VARSAYILAN = '-p 2222 root@100.117.187.26';
const R2_UZAK = 'ydsr2';
/** Ekin yazıldığı TEK bucket: ProBook eki `cdn.ydspublishing.com/<yol>` adresinden okur (G6). */
const EK_BUCKET = 'ydsdigital';
const RCLONE_AYAR = ['--contimeout', '30s', '--timeout', '5m', '--retries', '3',
  '--low-level-retries', '10'];
/** Aynı istek + taban için yeniden denenmeyen "uygun değil" nedenleri (kabukTazele uygunluk). */
const UYGUN_DEGIL = new RegExp('bookN düzeni yok|tek kitaplı paket|dokunulmaz'
  + '|Web-Z listesinde kitap yok|üreteç tabanı');
/** Geçici hatada geri çekilme: 15 dk → 30 → 60 → 120 …, tavan 6 sa. */
const GERI_TABAN_MS = 15 * 60 * 1000;
const GERI_TAVAN_MS = 6 * 60 * 60 * 1000;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) '
  + 'Chrome/126.0 Safari/537.36';

// ─── Saf yardımcılar ──────────────────────────────────────────────────────────────────────

/** Komut satırı. SAF. @returns {{kip, setler, kuru, cikti, hata?}} */
function argAyristir(argv) {
  const o = { kip: null, setler: [], kuru: false, cikti: null };
  const kipKoy = (k) => { o.kip = o.kip ? 'cift' : k; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--kuru') o.kuru = true;
    else if (a === '--bekleyen') kipKoy('bekleyen');
    else if (a === '--anahtar-uret') kipKoy('anahtar');
    else if (a === '--set' || a === '--cikti') {
      const v = argv[i + 1];
      if (!v || v.startsWith('--')) return { ...o, hata: `${a} değer ister` };
      i += 1;
      if (a === '--cikti') o.cikti = path.resolve(v);
      else {
        kipKoy('set');
        o.setler = v.split(',').map((s) => s.trim()).filter(Boolean);
      }
    } else return { ...o, hata: `bilinmeyen argüman: ${a}` };
  }
  if (!o.kip) return { ...o, hata: '--set <id>[,<id>…], --bekleyen ya da --anahtar-uret gerekli' };
  if (o.kip === 'cift') {
    return { ...o, hata: 'kipler (--set, --bekleyen, --anahtar-uret) birlikte kullanılmaz' };
  }
  if (o.kip === 'set' && (!o.setler.length || o.setler.some((s) => !/^\d+$/.test(s)))) {
    return { ...o, hata: `--set yalnız sayısal kimlik alır: ${o.setler.join(',')}` };
  }
  return o;
}

/** SSH argümanları: `EMPP_SRV21_SSH` (boşlukla ayrık, ör. `-p 2222 root@host`) ya da varsayılan. */
function sshHedefi(env = {}) {
  const ham = String(env.EMPP_SRV21_SSH || '').trim() || SSH_VARSAYILAN;
  return [...SSH_SECENEK, ...ham.split(/\s+/)];
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

/**
 * kabukTazele nedeni kalıcı ret mi. SAF.
 * Kalıcı: kapı RED, eşlenemeyen Web-Z üyesi, kapak 404 ya da 200 + geçersiz/küçük gövde.
 * Geçici: kapak HTTP 5xx/diğer, ağ hatası ("alınamadı"), Web-Z settings hatası.
 */
function kaliciRetMi(neden) {
  const n = String(neden || '');
  if (/kapı RED|eşlenemeyen Web-Z üyesi/.test(n)) return true;
  const m = /kapak geçersiz \([^)]*\): HTTP (\S+?),/.exec(n);
  return Boolean(m && (m[1] === '404' || m[1] === '200'));
}

/** `webz-kabuk-uret.surum` satırı (`kaynak=… sha256=…`) → {kaynak, sha256}. SAF. */
function aracSurumuAyristir(metin) {
  const al = (ad) => {
    const m = new RegExp(`(?:^|\\s)${ad}=(\\S+)`).exec(String(metin || ''));
    return m ? m[1] : null;
  };
  return { kaynak: al('kaynak'), sha256: al('sha256') };
}

/** Geri çekilme aralığı: n. ardışık geçici hatadan sonra. SAF. */
function geriCekilmeMs(hataSayisi) {
  const n = Math.max(1, Number(hataSayisi) || 1);
  return Math.min(GERI_TABAN_MS * 2 ** (n - 1), GERI_TAVAN_MS);
}

/**
 * --bekleyen: set bu turda atlanır mı. SAF.
 * Kesin kayıt + aynı istek + aynı taban + Web-Z settings sha'sı değişmemiş → 'islendi'.
 * Geçici kayıt + aynı istek + geri çekilme süresi dolmamış → 'geri'.
 * `webzSha` null (okunamadı) → settings değişimi bilinmez, kesin kayıt korunur.
 * @returns {null|'islendi'|'geri'}
 */
function atlamaNedeni(kayit, s, { webzSha = null, simdi = Date.now() } = {}) {
  if (!kayit || kayit.istekAt !== s.istekAt) return null;
  if (kayit.kesin) {
    if (kayit.tabanSurum !== s.surum) return null;
    if (webzSha && kayit.webzSettingsSha !== webzSha) return null;
    return 'islendi';
  }
  const son = Date.parse(kayit.sonDeneme || '');
  if (Number.isFinite(son) && simdi - son < geriCekilmeMs(kayit.hataSayisi)) return 'geri';
  return null;
}

/** Sonuç kesin mi (durum dosyasında yeniden denenmez). Kuru koşu hiç kaydedilmez. SAF. */
function kesinSonucMu(sonuc) {
  if (['yuklendi', 'mevcut', 'tavan'].includes(sonuc.durum)) return true;
  if (sonuc.durum === 'ret') return sonuc.retYazildi === true;
  return sonuc.durum === 'atlandi' && UYGUN_DEGIL.test(String(sonuc.neden || ''));
}

/** Durum kaydı (kesin ya da geçici). SAF. */
function durumKaydi(onceki, s, sonuc, { simdi = new Date() } = {}) {
  const kesin = kesinSonucMu(sonuc);
  const ayniIstek = onceki && onceki.istekAt === s.istekAt;
  return {
    istekAt: s.istekAt, tabanSurum: s.surum, webzSettingsSha: sonuc.webzSettingsSha || null,
    durum: sonuc.durum, girdiSha: sonuc.girdiSha || null, kesin,
    hataSayisi: kesin ? 0 : (ayniIstek && !onceki.kesin ? Number(onceki.hataSayisi) || 0 : 0) + 1,
    sonDeneme: simdi.toISOString(),
  };
}

/** Açık anahtarın parmak izi: SPKI DER'in sha256'sı. SAF (anahtar nesnesi verilir). */
function parmakIzi(acikAnahtar) {
  const der = acikAnahtar.export({ type: 'spki', format: 'der' });
  return `sha256:${crypto.createHash('sha256').update(der).digest('hex')}`;
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

/** JSON'u geçici adla yazıp rename eder (üzerine yazma; silme yok). */
function jsonYaz(dosya, veri) {
  const gecici = `${dosya}.${process.pid}.yaziliyor`;
  fs.writeFileSync(gecici, `${JSON.stringify(veri, null, 2)}\n`);
  fs.renameSync(gecici, dosya);
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

/** Dizini os.tmpdir altına taşır (silmez; OS temizler). @returns {string|null} yeni yol */
function kenaraAl(dizin) {
  try {
    const hedef = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kabuk-ek-kilit-')), 'kilit');
    fs.renameSync(dizin, hedef);
    return hedef;
  } catch (_) {
    return null;
  }
}

/**
 * Tek kopya kilidi (mkdir atomik). Sahip pid ölmüşse kilit bayattır: kenara alınır, yeniden
 * denenir. pid dosyası henüz yazılmamış taze kilit (<30 sn) MEŞGUL sayılır. Bayat kilit kenara
 * alınamazsa (yarış) MEŞGUL sayılır. Taşınan dizindeki pid okunan bayat pid değilse (arada başka
 * kopya kilidi devraldı) dizin GERİ taşınır ve MEŞGUL dönülür.
 * @returns {null | (() => void)} null = başka kopya çalışıyor; fonksiyon = bırak
 */
function kilitAl(kilit, {
  pid = process.pid, canli = canliMi, simdi = Date.now, kenar = kenaraAl,
} = {}) {
  const pidDosyasi = path.join(kilit, 'pid');
  const yaz = () => {
    fs.writeFileSync(pidDosyasi, `${pid}\n`);
    let birakildi = false;
    return () => {
      if (birakildi) return;
      birakildi = true;
      if (Number(okuSessiz(pidDosyasi)) !== pid) return;
      // Taşınamazsa pid boşaltılır: sonraki kopya kilidi bayat sayar.
      if (!kenar(kilit)) {
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
  const tasinan = kenar(kilit);
  if (!tasinan) return null;
  if (okuSessiz(path.join(tasinan, 'pid')) !== sahipMetni) {
    try { fs.renameSync(tasinan, kilit); } catch (_) { /* yeni sahip zaten kurdu */ }
    return null;
  }
  try {
    fs.mkdirSync(kilit);
  } catch (e) {
    if (e.code === 'EEXIST') return null;
    throw e;
  }
  return yaz();
}

/**
 * ed25519 anahtar çifti üretir. Özel anahtar VARSA EZİLMEZ (yalnız açık anahtar türetilip
 * eksikse yazılır). Özel anahtar hiçbir yere basılmaz.
 * @returns {{durum: 'uretildi'|'var', parmakIzi: string, acik: string}}
 */
function anahtarUret(dizin) {
  fs.mkdirSync(dizin, { recursive: true, mode: 0o700 });
  const ozel = path.join(dizin, 'ozel.pem');
  const acik = path.join(dizin, 'acik.pem');
  if (fs.existsSync(ozel)) {
    const acikAnahtar = crypto.createPublicKey(fs.readFileSync(ozel));
    if (!fs.existsSync(acik)) {
      fs.writeFileSync(acik, acikAnahtar.export({ type: 'spki', format: 'pem' }), { mode: 0o644 });
    }
    return { durum: 'var', parmakIzi: parmakIzi(acikAnahtar), acik };
  }
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  fs.writeFileSync(ozel, privateKey.export({ type: 'pkcs8', format: 'pem' }),
    { mode: 0o600, flag: 'wx' });
  fs.chmodSync(ozel, 0o600);
  fs.writeFileSync(acik, publicKey.export({ type: 'spki', format: 'pem' }), { mode: 0o644 });
  return { durum: 'uretildi', parmakIzi: parmakIzi(publicKey), acik };
}

/** Web-Z settings.json gövdesinin sha256'sı (B `webzSettingsSha` ile aynı ölçü); hata → null. */
async function webzSettingsShaGetir(webzKoku, kisaKod) {
  try {
    const r = await fetch(`${webzKoku}/go/${kisaKod}/web-stream/config/settings.json`, {
      redirect: 'follow', headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000),
    });
    if (r.status !== 200) return null;
    return crypto.createHash('sha256').update(Buffer.from(await r.arrayBuffer())).digest('hex');
  } catch (_) {
    return null;
  }
}

function komutVarMi(ad, env) {
  return String(env.PATH || '').split(':').filter(Boolean).some((d) => {
    try {
      fs.accessSync(path.join(d, ad), fs.constants.X_OK);
      return true;
    } catch (_) {
      return false;
    }
  });
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
    ssh: (sql) => komutKostur('ssh', [...sshHedefi(env), `pipeline-sql "${sql}"`],
      { zamanAsimiMs: 90000 }),
    rclone: (args) => komutKostur('rclone', [...args, ...RCLONE_AYAR]),
    bildir: (metin) => komutKostur('bildir', ['kosucu', metin], { zamanAsimiMs: 20000 }),
    ek: () => require('../../src/agent/kabuk-ek'),
    kabukTazele: (o) => kabuk().kabukTazele(o),
    kaynakAdim: () => require('../../src/agent/runner').kaynakAdim,
    r2Onbellek: (...a) => require('../../src/agent/kaynak-arsivi').r2Onbellek(...a),
    merdivenAcik: () => require('../../src/agent/icerik-merdiven').merdivenAcik(env),
    setEki: () => require('../../src/agent/set-uyelik-ek'),
    // ProBook r2-kur'un üreteç kararı: runner'ın kullandığı AYNI modül işlevleri (kopya yok).
    uretec: () => require('../../src/agent/uretec-kaynak'),
    panelMenu: () => require('../../src/agent/panel-menu-hizala'),
    aracSurumu: () => aracSurumuAyristir(okuSessiz(`${kabuk().ikiliYolu(env)}.surum`)),
    webzSha: (kisaKod) => webzSettingsShaGetir(kabuk().WEBZ_KOKU, kisaKod),
    /** Swift ikilisi + zip + rclone; eksikse neden döner. */
    aracDenetle: () => {
      const ikili = kabuk().ikiliYolu(env);
      try {
        fs.accessSync(ikili, fs.constants.X_OK);
      } catch (_) {
        return `Swift ikilisi yok: ${ikili} (tools/set-kabuk/kur-webz-kabuk-uret.sh)`;
      }
      const eksik = ['zip', 'rclone'].filter((k) => !komutVarMi(k, env));
      return eksik.length ? `komut yok: ${eksik.join(', ')}` : null;
    },
  };
}

// ─── Adımlar ─────────────────────────────────────────────────────────────────────────────

/**
 * `kaynak` dosyasını `hedef`'e klonlar. Klon her zaman VAR OLMAYAN bir ada yapılır (APFS clone;
 * var olan hedefe kopya tam veri yazar), sonra rename ile hedefin ÜZERİNE gelir.
 */
async function klonla(kaynak, hedef) {
  const yeni = `${hedef}.yeni`;
  if (fs.existsSync(yeni)) await fsp.rename(yeni, hedef); // yarım kalmış koşu: üzerine yaz
  await fsp.copyFile(kaynak, yeni, fs.constants.COPYFILE_FICLONE);
  await fsp.rename(yeni, hedef);
}

/**
 * Taban build'i iş kopyasına koyar: (1) Mac kaynak arşivi (r2Surum + sha256 aynı) →
 * (2) `kabuk-ek-onbellek/<id>/taban.zip` (+ `taban.json`: sürüm, sha256, boyut, mtime) →
 * (3) rclone indirme + sha256; yeni taban rename ile eskisinin ÜZERİNE gelir (set başına tek
 * dosya).
 */
async function tabanHazirla(bag, s, calisma) {
  const hedef = path.join(calisma, 'build.zip');
  const onb = await bag.r2Onbellek(s.bookId, {
    surum: s.surum, sha256: s.sha256, boyut: s.boyut, bilgi: bag.log,
  });
  if (onb) {
    await klonla(onb.zip, hedef);
    return { zip: hedef, kaynak: 'arsiv', indirilenBayt: 0 };
  }
  const dizin = path.join(bag.ev, 'kabuk-ek-onbellek', String(s.bookId));
  const dosya = path.join(dizin, 'taban.zip');
  const kayitDosyasi = path.join(dizin, 'taban.json');
  const kayitYaz = (st) => jsonYaz(kayitDosyasi, {
    surum: s.surum, sha256: s.sha256, boyut: st.size, mtimeMs: Math.floor(st.mtimeMs),
  });
  if (fs.existsSync(dosya)) {
    const st = fs.statSync(dosya);
    let kayit = null;
    try { kayit = JSON.parse(okuSessiz(kayitDosyasi)); } catch (_) { /* yok */ }
    const kayitTutar = kayit && kayit.sha256 === s.sha256 && kayit.boyut === st.size
      && kayit.mtimeMs === Math.floor(st.mtimeMs);
    if (st.size === s.boyut && (kayitTutar || await sha256Dosya(dosya) === s.sha256)) {
      if (!kayitTutar) kayitYaz(st);
      await klonla(dosya, hedef);
      return { zip: hedef, kaynak: 'onbellek', indirilenBayt: 0 };
    }
    bag.log(`${ISARET} ${s.bookId}: önbellek tabanı ${kayit && kayit.surum || '?'} ≠ ${s.surum}`
      + ' — yenisi indirilip üzerine yazılacak');
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
  kayitYaz(fs.statSync(dosya));
  bag.log(`${ISARET} ${s.bookId}: taban indirildi ${((Date.now() - basla) / 1000).toFixed(0)} sn`);
  await klonla(dosya, hedef);
  return { zip: hedef, kaynak: 'R2', indirilenBayt: st.size };
}

/** `kabuk-ek-onbellek` altındaki dosyaların toplam baytı (yoksa 0). */
function onbellekBoyutu(ev) {
  const kok = path.join(ev, 'kabuk-ek-onbellek');
  let top = 0;
  const gez = (d) => {
    let girdiler = [];
    try { girdiler = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
    for (const e of girdiler) {
      const y = path.join(d, e.name);
      if (e.isDirectory()) gez(y);
      else if (e.isFile()) { try { top += fs.statSync(y).size; } catch (_) { /* yarış */ } }
    }
  };
  gez(kok);
  return top;
}

/**
 * ProBook r2-kur tabanı ÜRETEÇLE yeniden kurar mı (runner `r2KurTabanHazirla` + TABAN KAPSAMA ile
 * aynı karar, aynı modül işlevleri). Kurarsa Mac'in geçerli R2 build'inden ürettiği ekin
 * girdiSha'sı
 * ProBook'unkiyle tutmaz → set atlanır. `asama`: 'taban' (merdivenden önce, `tabanUretecMi`) |
 * 'kapsama' (set ekinden sonra, `tabanKitapEksik` + panel içerik istisnası).
 * @returns {string|null} neden
 */
function uretecTabaniNedeni({ U, P, zip, setListesi = null, asama, env }) {
  if (!U.uretecAcik(env)) return null;
  if (asama === 'taban') {
    const d = U.tabanUretecMi(zip);
    return d.atla ? `ProBook tabanı üreteçle kurar (${d.sebep})` : null;
  }
  const e = U.tabanKitapEksik(zip, setListesi);
  if (!e.atla) return null;
  const duran = e.eksik.filter((id) => P.kokIcerikVarMi(zip, id));
  if (duran.length && duran.length === e.eksik.length) return null; // runner istisnası
  return `set eki sonrası eksik: ${e.eksik.join(', ')} (${e.sebep}) — ProBook üreteçle kurar`;
}

/**
 * R2'de bu girdiSha için doğrulanmış ek var mı: son.json (girdiSha + webzSettingsSha eşit) +
 * ek zip `ekAc` + imza açık anahtarla geçerli. Herhangi bir adım düşerse false (yüklenir).
 */
async function r2EkGecerliMi(bag, ek, o) {
  const { bookId, girdiSha, kip, webzSettingsSha, klasorler, acikAnahtar, calisma } = o;
  const al = async (anahtar, yerel) => {
    const r = await bag.rclone(['copyto', `${R2_UZAK}:${EK_BUCKET}/${anahtar}`, yerel]);
    return r.code === 0 ? fs.readFileSync(yerel) : null;
  };
  try {
    const sonHam = await al(ek.sonAnahtari(bookId), path.join(calisma, 'r2-son.json'));
    if (!sonHam) return false;
    const son = JSON.parse(sonHam.toString('utf8'));
    if (son.girdiSha !== girdiSha || !webzSettingsSha || son.webzSettingsSha !== webzSettingsSha) {
      return false;
    }
    const zip = await al(ek.ekAnahtari(bookId, girdiSha), path.join(calisma, 'r2-ek.zip'));
    const imza = await al(ek.imzaAnahtari(bookId, girdiSha), path.join(calisma, 'r2-ek.imza'));
    if (!zip || !imza) return false;
    ek.ekAc(zip, { bookId, girdiSha, kip, ...(klasorler ? { klasorler } : {}) });
    return ek.ekImzaDogrula(zip, imza.toString('utf8'), acikAnahtar);
  } catch (_) {
    return false;
  }
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

/** Ret işaretini yazar. @returns {Promise<boolean>} R2'ye yazıldı mı */
async function retYaz(bag, s, ek, girdiSha, neden, o, calisma) {
  const govde = `${JSON.stringify({
    neden: String(neden), bookId: String(s.bookId), girdiSha, uretildi: new Date().toISOString(),
  }, null, 2)}\n`;
  const anahtar = ek.retAnahtari(String(s.bookId), girdiSha);
  const dosya = path.join(calisma, 'ret.json');
  await fsp.writeFile(dosya, govde);
  if (o.cikti) {
    await fsp.mkdir(path.join(o.cikti, String(s.bookId)), { recursive: true });
    await fsp.writeFile(path.join(o.cikti, String(s.bookId), path.basename(anahtar)), govde);
  }
  if (o.kuru) {
    bag.log(`${ISARET} ${s.bookId}: ret işareti ${anahtar} (--kuru, yazılmadı)`);
    return false;
  }
  try {
    await rcloneYaz(bag, dosya, anahtar);
    bag.log(`${ISARET} ${s.bookId}: ret işareti yazıldı ${anahtar}`);
    return true;
  } catch (e) {
    bag.warn(`${ISARET} ${s.bookId}: ret işareti yazılamadı — ${e.message}`);
    return false;
  }
}

/**
 * Bir seti işler. FIRLATMAZ.
 * @param {{kuru: boolean, cikti?: string, ozelAnahtar?: string|null}} o  ozelAnahtar = PEM
 *   (kuru koşu dışında ZORUNLU; main denetler)
 * @returns {Promise<{bookId, durum: 'yuklendi'|'mevcut'|'kuru'|'tavan'|'ret'|'atlandi'|'hata',
 *   neden, girdiSha?, bayt?, dosyaSayisi?, anahtar?, webzSettingsSha?, retYazildi?, taban?,
 *   indirilenBayt?, onbellekBayt?, sureMs}>}
 */
async function setIsle(bag, s, o) {
  const basla = Date.now();
  const sonuc = { bookId: s.bookId, durum: 'hata', neden: null };
  const bitir = (durum, neden, ek = {}) => {
    Object.assign(sonuc, ek, { durum, neden, sureMs: Date.now() - basla });
    if (sonuc.taban) sonuc.onbellekBayt = onbellekBoyutu(bag.ev);
    const alanlar = ['girdiSha', 'kip', 'bayt', 'dosyaSayisi', 'anahtar', 'taban', 'indirilenBayt',
      'onbellekBayt'].filter((k) => sonuc[k] != null).map((k) => `${k}=${sonuc[k]}`).join(' ');
    const satir = `${ISARET} SONUÇ ${s.bookId} durum=${durum} ${alanlar} sure=${sonuc.sureMs}ms`
      + `${neden ? ` — ${neden}` : ''}`;
    (['hata', 'tavan', 'ret'].includes(durum) ? bag.warn : bag.log)(satir);
    return sonuc;
  };
  try {
    const engel = satirEngeli(s);
    if (engel) return bitir('atlandi', engel);
    const ek = bag.ek();
    const calisma = path.join(bag.ev, 'kabuk-ek-calisma', String(s.bookId));
    await fsp.mkdir(calisma, { recursive: true });
    const taban = await tabanHazirla(bag, s, calisma);
    sonuc.taban = `${s.surum}/${taban.kaynak}`;
    sonuc.indirilenBayt = taban.indirilenBayt;
    // ProBook bu tabanı üreteçle yeniden kuracaksa ek girdiSha'sı tutmaz: üretme, bildir (kesin).
    const uretecAtla = async (neden) => {
      await bag.bildir(`kabuk-ek ${s.bookId}: üreteç tabanı — ek üretilmedi (${neden})`);
      return bitir('atlandi', `üreteç tabanı: ${neden}`);
    };
    const U = bag.uretec();
    const P = bag.panelMenu();
    const n1 = uretecTabaniNedeni({ U, P, zip: taban.zip, asama: 'taban', env: bag.env });
    if (n1) return uretecAtla(n1);
    const job = await kaynakAdimlari(bag, s, taban.zip, calisma);
    const liste = bag.setEki().setListesiCoz({ job, env: bag.env });
    const n2 = uretecTabaniNedeni({
      U, P, zip: taban.zip, setListesi: liste ? liste.ham : null, asama: 'kapsama', env: bag.env,
    });
    if (n2) return uretecAtla(n2);

    let cikti = null;
    const kt = await bag.kabukTazele({
      zip: taban.zip, calisma, job, log: bag.log, warn: bag.warn, kabukKaynagi: 'ikili',
      ekCikti: async (v) => { cikti = v; },
    });
    const girdiSha = (cikti && cikti.girdiSha) || (kt && kt.girdiSha) || null;
    if (girdiSha) sonuc.girdiSha = girdiSha;
    if (cikti && cikti.webzSettingsSha) sonuc.webzSettingsSha = cikti.webzSettingsSha;
    const ktDurum = kt && kt.durum;
    if (!cikti || !['uygulandi', 'guncel'].includes(ktDurum)) {
      const neden = `kabuk ${ktDurum || '?'}: ${(kt && kt.neden) || 'ek çıktısı yok'}`;
      if (ktDurum === 'atlandi' && kaliciRetMi(kt.neden)) {
        if (girdiSha) sonuc.retYazildi = await retYaz(bag, s, ek, girdiSha, kt.neden, o, calisma);
        const notu = sonuc.retYazildi ? '' : ' (ret işareti yazılmadı)';
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
    // Tavan çağrı anında A'dan okunur (EMPP_KABUK_EK_TAVAN; ProBook ile eşit olmalı).
    const tavan = typeof ek.tavanAl === 'function' ? ek.tavanAl() : ek.EK_TAVAN_BAYT;
    let paket = null;
    try {
      paket = ek.ekPaketle({ manifest, dosyalar }, secenek);
    } catch (e) {
      if (!(e && e.kod === 'tavan')) throw e;
    }
    if (!paket || paket.length > tavan) {
      const bayt = paket ? paket.length : null;
      if (bayt != null) sonuc.bayt = bayt;
      await bag.bildir(`kabuk-ek ${s.bookId}: ek TAVANI aştı (${bayt ?? '?'} > ${tavan} bayt)`
        + ' — yüklenmedi');
      return bitir('tavan', `ek ${bayt ?? '?'} bayt > tavan ${tavan}`);
    }
    sonuc.bayt = paket.length;
    // Kuru koşuda A'nın imza arayüzü henüz yoksa ek imzasız üretilir (gerçek kipte main denetler).
    const imzalanir = Boolean(o.ozelAnahtar) && typeof ek.ekImzala === 'function'
      && typeof ek.imzaAnahtari === 'function';
    const imza = imzalanir ? ek.ekImzala(paket, o.ozelAnahtar) : null;
    const ekSha = crypto.createHash('sha256').update(paket).digest('hex');
    const anahtar = ek.ekAnahtari(String(s.bookId), girdiSha);
    const imzaAnahtar = imza ? ek.imzaAnahtari(String(s.bookId), girdiSha) : null;
    const sonAnahtar = ek.sonAnahtari(String(s.bookId));
    sonuc.anahtar = anahtar;
    const son = {
      bookId: String(s.bookId), girdiSha, kip, uretildi: new Date().toISOString(),
      tabanSurum: s.surum, webzSettingsSha: cikti.webzSettingsSha || null,
    };
    const sonMetni = `${JSON.stringify(son, null, 2)}\n`;
    const ekDosyasi = path.join(calisma, 'ek.zip');
    const imzaDosyasi = path.join(calisma, 'ek.imza');
    const sonDosyasi = path.join(calisma, 'son.json');
    await fsp.writeFile(ekDosyasi, paket);
    if (imza) await fsp.writeFile(imzaDosyasi, imza);
    await fsp.writeFile(sonDosyasi, sonMetni);
    bag.log(`${ISARET} ${s.bookId}: ek ${paket.length} bayt, ${dosyalar.size} dosya, `
      + `girdiSha ${girdiSha}, ek sha256 ${ekSha.slice(0, 12)}, imza ${imza ? 'VAR' : 'YOK'}, `
      + `kabuk ${ktDurum}`);
    if (o.cikti) {
      const yerel = path.join(o.cikti, String(s.bookId));
      await fsp.mkdir(yerel, { recursive: true });
      await fsp.writeFile(path.join(yerel, `${girdiSha}.zip`), paket);
      if (imza) await fsp.writeFile(path.join(yerel, path.basename(imzaAnahtar)), imza);
      await fsp.writeFile(path.join(yerel, 'son.json'), sonMetni);
      bag.log(`${ISARET} ${s.bookId}: yerel çıktı ${yerel}`);
    }
    if (o.kuru) return bitir('kuru', 'R2 yazılmadı (--kuru)');
    if (!imza) {
      await bag.bildir(`kabuk-ek ${s.bookId}: özel anahtar yok — ek yüklenmedi`);
      return bitir('hata', 'özel anahtar yok — yükleme yok');
    }
    // Anahtar girdiSha ile adreslenir ama bayt aynı DEĞİL (manifest `uretildi` saati taşır). R2'de
    // aynı girdiSha + aynı Web-Z settings için doğrulanmış (ekAc + imza) ek varsa yüklenmez:
    // ProBook'un okuduğu nesne yarış sırasında değişmez (TOCTOU penceresi daralır).
    if (await r2EkGecerliMi(bag, ek, {
      bookId: String(s.bookId), girdiSha, kip, webzSettingsSha: cikti.webzSettingsSha,
      klasorler: secenek.klasorler, acikAnahtar: crypto.createPublicKey(o.ozelAnahtar), calisma,
    })) {
      return bitir('mevcut', 'R2\'de aynı girdiSha ve Web-Z settings için doğrulanmış ek var');
    }
    // SIRA: ek → imza → son.json; son.json yalnız imzalı, var olan eki gösterir.
    const yuklemeler = [
      [ekDosyasi, anahtar, 'ek'], [imzaDosyasi, imzaAnahtar, 'imza'],
      [sonDosyasi, sonAnahtar, 'son.json'],
    ];
    for (const [yerel, uzak, ad] of yuklemeler) {
      try {
        await rcloneYaz(bag, yerel, uzak);
      } catch (e) {
        await bag.bildir(`kabuk-ek ${s.bookId}: ${ad} yüklenemedi — ${e.message.slice(0, 160)}`);
        return bitir('hata', `${ad} yüklenemedi: ${e.message}`);
      }
    }
    return bitir('yuklendi', null);
  } catch (e) {
    return bitir('hata', String((e && e.message) || e).slice(0, 300));
  }
}

/**
 * `ssh … pipeline-sql` sonucu. SAF. srv21 `pipeline-sql` SIFIR satırda çıkış 1 verir ve stdout +
 * stderr boş kalır (ölçüm 06.10, 11845): bu "0 satır"dır, hata DEĞİL. Diğer sıfır dışı çıkış
 * (ssh 255, SQL hatası: stderr dolu) hatadır.
 * @returns {{durum: 'satir', stdout: string} | {durum: 'bos'} | {durum: 'hata', kod, hata}}
 */
function sqlSonucu(r) {
  const out = String((r && r.stdout) || '');
  const err = String((r && r.stderr) || '').trim();
  if (r && r.code === 0) return { durum: 'satir', stdout: out };
  if (r && r.code === 1 && !out.trim() && !err) return { durum: 'bos' };
  return { durum: 'hata', kod: r ? r.code : null, hata: err.slice(-200) || 'stderr boş' };
}

function durumOku(dosya) {
  try { return JSON.parse(fs.readFileSync(dosya, 'utf8')) || {}; } catch (_) { return {}; }
}

/**
 * Giriş. Çıkış kodu (OKU.md "Çıkış kodu"):
 *   0 — tamam: işlenen setlerde hata yok; ya da iş yok (--bekleyen 0 satır), meşgul, duraklatıldı.
 *   1 — hata: en az bir set hata, DB/ssh hatası, araç ya da imza anahtarı yok, kullanım hatası.
 *   2 — eylem yok: --set ile istenen setlerin HİÇBİRİNDE geçerli kaynak build'i yok.
 */
async function main(argv, bag = varsayilanBag()) {
  const o = argAyristir(argv);
  if (o.hata) {
    bag.warn(`${ISARET} kullanım: ek-uret.js (--set <id>[,<id>…] | --bekleyen | --anahtar-uret)`
      + ` [--kuru] [--cikti <dizin>] — ${o.hata}`);
    return 1;
  }
  const imzaDizini = path.join(bag.ev, 'kabuk-ek-imza');
  if (o.kip === 'anahtar') {
    const r = anahtarUret(imzaDizini);
    bag.log(`${ISARET} imza anahtarı ${r.durum === 'var' ? 'ZATEN VAR (ezilmedi)' : 'üretildi'}: `
      + `açık ${r.acik}, parmak izi ${r.parmakIzi}`);
    return 0;
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
    const aracEksik = bag.aracDenetle();
    if (aracEksik) {
      bag.warn(`${ISARET} araç denetimi: ${aracEksik} — taban indirilmedi`);
      return 1;
    }
    const ozelAnahtar = okuSessiz(path.join(imzaDizini, 'ozel.pem'));
    if (!o.kuru) {
      const ek = bag.ek();
      const eksik = !ozelAnahtar ? `özel anahtar yok (${imzaDizini}/ozel.pem; --anahtar-uret)`
        : (typeof ek.ekImzala !== 'function' || typeof ek.imzaAnahtari !== 'function')
          ? 'kabuk-ek modülünde ekImzala/imzaAnahtari yok' : null;
      if (eksik) {
        bag.warn(`${ISARET} ${eksik} — yükleme yapılmaz`);
        await bag.bildir(`kabuk-ek: ${eksik} — yükleme yapılmadı`);
        return 1;
      }
    } else if (!ozelAnahtar) {
      bag.log(`${ISARET} --kuru: özel anahtar yok, ek imzasız üretilecek`);
    }
    // --kuru yalnız rapordur: bildirim telefona gitmez, loga düşer.
    if (o.kuru) {
      const log = bag.log;
      const bildir = async (m) => { log(`${ISARET} (--kuru, bildirim gönderilmedi) ${m}`); };
      bag = { ...bag, bildir };
    }
    const sorgu = sqlSonucu(await bag.ssh(sqlKur(o)));
    if (sorgu.durum === 'hata') {
      bag.warn(`${ISARET} DB sorgusu başarısız (ssh ${sorgu.kod}): ${sorgu.hata}`);
      return 1;
    }
    let satirlar = sorgu.durum === 'bos' ? [] : satirlariAyristir(sorgu.stdout);
    if (o.kip === 'bekleyen' && !satirlar.length) {
      bag.log(`${ISARET} bekleyen set yok (0 satır)`);
      return 0;
    }
    if (o.kip === 'set') {
      const bulunan = new Set(satirlar.map((s) => s.bookId));
      for (const id of o.setler.filter((x) => !bulunan.has(x))) {
        const metin = `${id}: geçerli kaynak build'i yok (kaynak_build_surumleri) — ek üretilemez`;
        bag.warn(`${ISARET} ${metin}`);
        await bag.bildir(`kabuk-ek ${metin}`);
      }
      if (!satirlar.length) return 2;
    }
    const durumDosyasi = path.join(bag.ev, 'kabuk-ek-durum.json');
    const durum = durumOku(durumDosyasi);
    if (o.kip === 'bekleyen') {
      const kalan = [];
      const atlanan = [];
      for (const s of satirlar) {
        const kayit = durum[s.bookId];
        // Web-Z settings yalnız kesin kayıtlı sette çekilir (küçük GET): değiştiyse yeniden üret.
        const webzSha = kayit && kayit.kesin && kayit.istekAt === s.istekAt && s.kisaKod
          ? await bag.webzSha(s.kisaKod) : null;
        const neden = atlamaNedeni(kayit, s, { webzSha });
        if (neden) atlanan.push(`${s.bookId}:${neden}`);
        else kalan.push(s);
      }
      bag.log(`${ISARET} bekleyen ${satirlar.length} set; atlanan ${atlanan.join(',') || '-'};`
        + ` işlenecek ${kalan.map((s) => s.bookId).join(',') || '-'}`);
      satirlar = kalan;
    }
    let hata = 0;
    for (const s of satirlar) {
      if (fs.existsSync(duraklat)) {
        bag.log(`${ISARET} duraklat.istek geldi — kalan setler bırakıldı`);
        break;
      }
      const sonuc = await setIsle(bag, s, { ...o, ozelAnahtar });
      if (sonuc.durum === 'hata') hata += 1;
      if (!o.kuru) {
        if (!sonuc.webzSettingsSha && s.kisaKod) {
          sonuc.webzSettingsSha = await bag.webzSha(s.kisaKod);
        }
        durum[s.bookId] = durumKaydi(durum[s.bookId], s, sonuc);
        jsonYaz(durumDosyasi, durum);
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
  ISARET, EK_BUCKET, argAyristir, sshHedefi, sqlKur, satirlariAyristir, satirEngeli,
  kaliciRetMi, aracSurumuAyristir, sqlSonucu, uretecTabaniNedeni, onbellekBoyutu, kenaraAl,
  geriCekilmeMs, atlamaNedeni, kesinSonucMu,
  durumKaydi, parmakIzi, anahtarUret, kilitAl, canliMi, klonla, tabanHazirla, setIsle, main,
  varsayilanBag,
};

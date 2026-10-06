'use strict';

/**
 * WINDOWS-KASA DİSK TEMİZLİK BEKÇİSİ — "disk dolu → işi durdurma, yer aç" (Nadir 06.10).
 *
 * Kural: kasada C: (üretim birimi) dar diye üretim/kabul/imza DURMAZ. Boş alan hedefin altındaysa
 * BİZİM ürettiğimiz/indirdiğimiz dosyalar EN ESKİDEN başlayarak silinir; hedefe ulaşınca durulur.
 * Silme yalnız ProBook ve windows-kasa'da serbesttir; bu betik win32 dışında (Mac, srv21) KOŞMAZ
 * (CLI platform kapısı; testler `calistir`'ı sahte köklerle doğrudan çağırır).
 *
 * BAĞIMLILIKSIZ (yalnız node yerleşikleri): kasada `C:\empp-ajan\disk-temizlik.js` kopyası da koşar.
 * İnce sarmalayıcı: disk-temizlik.ps1 · zamanlanmış görev: disk-temizlik-gorev-kur.ps1.
 *
 * SIRA (katman içinde en eski önce — ağacın EN YENİ mtime'ı: "en son dokunulan"):
 *   K1 artık/test/paket: veri\tmp\* (statik kapı empp-kapi-* çıkarımları, bitmiş iş dizinleri),
 *      paketleyici çıktısı (packager-tool\config\output|temp), yedek-paketleyici-* / kasa-guncel-*.tar
 *      (en yeni 3 kalır), C:\kabul (akt-profil-*, kabul-profil-*, exe önbelleği, .empp-yedek-*\*),
 *      Silinecekler, Downloads paketleri, kabulün kurduğu uygulamalar (Programs, C:\DijiTap)
 *   K2 kuyruk arşivi/önbellek/kanıt: windows-hazir\{yayinlandi,reddedildi,eskiler,bayat,olculemedi}
 *      (her birinde en yeni 10 kalır), icerik-onbellek\*, veri\cache\*, kabul-kanit\* (7 günden eski)
 *   K3 SON ÇARE: kaynak arşivi (veri\kaynak-arsivi\<id>; R2'den yeniden iner)
 * KORUMA: koruma listesi (windows-hazir'in BEKLEYEN kayıtları, imza-oncelik.txt, token.json,
 *   ortam.ps1, aktivasyon-test-kodu.txt, paketleyici, araçlar, log); çalışan sürecin exe yolu ya da
 *   komut satırı adayı içeriyorsa ATLA; ağaçta son 120 dk içinde değişen dosya varsa ATLA (--ek hariç);
 *   silmeden önce ad değiştirme sınaması (kilitli dosya → ATLA, yarım silme yok). Belirsizse SİLME.
 * Günlük: C:\empp-ajan\log\disk-temizlik.log — tarih · yol · boyut · neden.
 *
 * CLI: node disk-temizlik.js [--kuru] [--ek <yol>]... [--hedef-gb N]
 * Çıkış: 0 hedef sağlandı · 3 adaylar bitti hâlâ dar · 2 kullanım hatası · 4 kilit dolu.
 * Son satır: SONUC bos_gb=.. silinen_mb=.. kalem=.. atlanan=.. hedef=tamam|dar
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const GB = 1e9;
/** kabul.py KORUNAN ile aynı: makinenin kendi programları (Programs altında). */
const PROGRAMS_KORUNAN = new Set(['common', 'ollama', 'opera', 'python', 'waypoint9-shell']);
const HAZIR_ARSIVLER = ['yayinlandi', 'reddedildi', 'eskiler', 'bayat', 'olculemedi'];
const PAKET_UZANTI = /\.(impark|yds|ydsdigital|appimage|deb|zip|7z|exe|msi|apk|dmg|part)$/i;

/** Yapılandırma — TEK blok. Kökler env ile ezilebilir (testler sahte kök verir). */
function yapilandirma(env = process.env, home = os.homedir()) {
  const K = env.EMPP_AJAN_KOK || 'C:\\empp-ajan';
  const ajan = env.EMPP_AJAN_DIZINI || path.join(home, '.empp-agent');
  const veri = path.join(K, 'veri');
  const kabulKok = env.KABUL_KOK || 'C:\\kabul';
  const hazir = env.EMPP_WIN_HAZIR_KOK || path.join(ajan, 'windows-hazir');
  const localAppData = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const hedefGb = Number(env.DT_HEDEF_GB || 40);
  const uretMin = Number(env.EMPP_WIN_URET_MIN_BOS_GB === undefined ? 15 : env.EMPP_WIN_URET_MIN_BOS_GB);
  return {
    surucu: env.DT_SURUCU || path.parse(K).root || 'C:\\',
    hedefGb: Math.max(hedefGb, Number.isFinite(uretMin) ? uretMin : 0),
    koruDk: Number(env.DT_KORU_DK || 120),
    kanitGun: Number(env.DT_KANIT_GUN || 7),
    hazirTut: 10,
    yedekTut: 3,
    log: env.DT_LOG || path.join(K, 'log', 'disk-temizlik.log'),
    kok: K, ajan, veri, kabulKok, hazir,
    tmp: path.join(veri, 'tmp'),
    paketleyiciCikti: [path.join(veri, 'packager-tool', 'config', 'output'), path.join(veri, 'packager-tool', 'config', 'temp')],
    kaynakArsivi: env.EMPP_KAYNAK_ARSIVI || path.join(veri, 'kaynak-arsivi'),
    cache: env.EMPP_SOURCE_CACHE || path.join(veri, 'cache'),
    silinecekler: [path.join(path.parse(K).root || 'C:\\', 'Silinecekler'), path.join(K, 'Silinecekler')],
    downloads: path.join(home, 'Downloads'),
    programs: path.join(localAppData, 'Programs'),
    dijitap: env.DT_DIJITAP || path.join(path.parse(K).root || 'C:\\', 'DijiTap'),
    // Kendisi, altı ve ATASI silinmez.
    koruAgac: [
      path.join(ajan, 'token.json'), path.join(ajan, 'imza-oncelik.txt'), path.join(ajan, 'kabuk'),
      path.join(ajan, 'motor'), path.join(ajan, 'yuklemeler'), path.join(ajan, 'imza-istek'),
      path.join(ajan, 'windows-kanit'), path.join(ajan, 'kaynak-yok-bildirim.json'),
      path.join(K, 'ortam.ps1'), path.join(K, 'paketleyici'), path.join(K, 'araclar'), path.join(K, 'log'),
      path.join(K, 'vpn'), path.join(K, 'kabul'), path.join(veri, 'npm-cache'),
      path.join(veri, 'tmp', 'node-compile-cache'),
    ],
  };
}

// ------------------------------------------------------------------ dosya sistemi yardımcıları
function lstat(p) { try { return fs.lstatSync(p); } catch (_) { return null; } }
function altlar(d) { try { return fs.readdirSync(d).map((a) => path.join(d, a)); } catch (_) { return []; } }

/** Ağacı yürür: en yeni mtime + toplam boyut. `esikMs` verilirse ondan yeni ilk girdide durur. */
function agacOlc(p, esikMs = null) {
  let enYeni = 0;
  let boyut = 0;
  const yigin = [p];
  while (yigin.length) {
    const y = yigin.pop();
    const st = lstat(y);
    if (!st) continue;
    if (st.mtimeMs > enYeni) enYeni = st.mtimeMs;
    if (esikMs !== null && st.mtimeMs > esikMs) return { enYeni, boyut, yeni: true };
    if (st.isDirectory()) yigin.push(...altlar(y));
    else boyut += st.size;
  }
  return { enYeni, boyut, yeni: false };
}

function ayniVeyaAlti(a, kok) {
  const A = process.platform === 'win32' ? a.toLowerCase() : a;
  const B = process.platform === 'win32' ? kok.toLowerCase() : kok;
  return A === B || A.startsWith(B.endsWith(path.sep) ? B : B + path.sep);
}

// ------------------------------------------------------------------ çalışan süreçler
/** win32: tüm süreçlerin exe yolu + komut satırı (kendimiz ve atalarımız hariç). */
function surecMetinleri() {
  if (process.platform !== 'win32') return [];
  let cikti = '';
  try {
    cikti = cp.execFileSync('powershell.exe', ['-NoProfile', '-Command',
      'Get-CimInstance Win32_Process | % { "$($_.ProcessId)`t$($_.ParentProcessId)`t$($_.ExecutablePath)`t$($_.CommandLine)" }'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120000, windowsHide: true });
  } catch (_) {
    return null; // ölçülemedi → çağıran HİÇBİR şey silmez
  }
  const satirlar = cikti.split(/\r?\n/).filter(Boolean).map((s) => s.split('\t'));
  const ebeveyn = new Map(satirlar.map(([pid, ppid]) => [pid, ppid]));
  const atalar = new Set();
  let p = String(process.pid);
  while (p && !atalar.has(p)) { atalar.add(p); p = ebeveyn.get(p); }
  return satirlar.filter(([pid]) => !atalar.has(pid))
    .flatMap(([, , exe, cmd]) => [exe, cmd]).filter(Boolean).map((s) => s.toLowerCase());
}

function kullanimda(yol, metinler) {
  // Önek eşleşmesi bilerek GENİŞ: `...\empp-kapi-M7` adayı `...\empp-kapi-M7x` kullanımında da korunur.
  // Bağlantı (junction) üzerinden de bakılır: kasada ~\.empp-agent → C:\empp-ajan\ev (06.10 ölçüldü);
  // süreç satırı iki yoldan biriyle yazılmış olabilir.
  const yollar = [yol.toLowerCase()];
  try { const g = fs.realpathSync.native(yol).toLowerCase(); if (g !== yollar[0]) yollar.push(g); } catch (_) { /* yok */ }
  return metinler.some((m) => yollar.some((y) => m.includes(y)));
}

// ------------------------------------------------------------------ aday listesi
/**
 * Katmanlı aday listesi. Saf değil (dizin okur) ama silmez.
 * @returns {Array<{yol:string, katman:number, neden:string}>}
 */
function adaylar(cfg) {
  const o = [];
  const ekle = (yol, katman, neden) => o.push({ yol, katman, neden });
  const enYeniHaric = (liste, tut) => liste
    .map((y) => ({ y, m: (lstat(y) || { mtimeMs: 0 }).mtimeMs }))
    .sort((a, b) => b.m - a.m).slice(tut).map((x) => x.y);

  // K1
  for (const y of altlar(cfg.tmp)) ekle(y, 1, 'gecici dizin (veri\\tmp)');
  for (const d of cfg.paketleyiciCikti) for (const y of altlar(d)) ekle(y, 1, 'paketleyici ciktisi');
  const kokAltlar = altlar(cfg.kok);
  for (const y of enYeniHaric(kokAltlar.filter((y) => /^yedek-paketleyici-/.test(path.basename(y))), cfg.yedekTut)) {
    ekle(y, 1, 'eski paketleyici yedegi (en yeni 3 kalir)');
  }
  for (const y of enYeniHaric(kokAltlar.filter((y) => /^kasa-guncel-.*\.tar$/i.test(path.basename(y))), cfg.yedekTut)) {
    ekle(y, 1, 'eski kasa-guncel tar (en yeni 3 kalir)');
  }
  for (const y of altlar(cfg.kabulKok)) {
    const ad = path.basename(y);
    if (/^(akt|kabul)-profil-/i.test(ad)) ekle(y, 1, 'kabul profili');
    else if (/\.exe$/i.test(ad)) ekle(y, 1, 'kabul exe onbellegi');
    else if (/^\.empp-yedek-/i.test(ad)) for (const z of altlar(y)) ekle(z, 1, 'kabul kurulum yedegi');
  }
  for (const d of cfg.silinecekler) for (const y of altlar(d)) ekle(y, 1, 'Silinecekler');
  for (const y of altlar(cfg.downloads)) {
    const st = lstat(y);
    if (st && st.isFile() && PAKET_UZANTI.test(y)) ekle(y, 1, 'indirilen paket (Downloads)');
  }
  for (const y of altlar(cfg.programs)) {
    const st = lstat(y);
    if (!st || !st.isDirectory() || PROGRAMS_KORUNAN.has(path.basename(y).toLowerCase())) continue;
    const asar = lstat(path.join(y, 'resources', 'app.asar'));
    const exeVar = altlar(y).some((z) => /\.exe$/i.test(z));
    if (asar || !exeVar) ekle(y, 1, 'kabulun kurdugu uygulama (Programs)');
  }
  for (const alan of altlar(cfg.dijitap)) for (const y of altlar(alan)) ekle(y, 1, 'kabulun kurdugu uygulama (DijiTap)');

  // K2
  for (const alt of HAZIR_ARSIVLER) {
    for (const y of enYeniHaric(altlar(path.join(cfg.hazir, alt)), cfg.hazirTut)) {
      ekle(y, 2, `windows-hazir/${alt} (en yeni ${cfg.hazirTut} kalir)`);
    }
  }
  for (const y of altlar(path.join(cfg.ajan, 'icerik-onbellek'))) ekle(y, 2, 'icerik onbellegi');
  for (const y of altlar(cfg.cache)) ekle(y, 2, 'kaynak onbellegi');
  const kanitEsik = Date.now() - cfg.kanitGun * 86400000;
  for (const y of altlar(path.join(cfg.ajan, 'kabul-kanit'))) {
    if (!agacOlc(y, kanitEsik).yeni) ekle(y, 2, `kabul kaniti (>${cfg.kanitGun} gun)`);
  }

  // K3
  for (const y of altlar(cfg.kaynakArsivi)) ekle(y, 3, 'kaynak arsivi (SON CARE; R2den yeniden iner)');
  return o;
}

/** Koruma kararı. Saf. @returns {string|null} neden ya da null (silinebilir) */
function korunuyor(yol, cfg) {
  if (!path.isAbsolute(yol)) return 'mutlak yol degil';
  if (path.normalize(yol) !== yol.replace(/[\\/]+$/, '')) return 'normal olmayan yol';
  const parca = yol.split(/[\\/]+/).filter(Boolean);
  if (parca.length < 2) return 'kok dizin';
  for (const k of cfg.koruAgac) {
    if (ayniVeyaAlti(yol, k)) return `koruma: ${k}`;
    if (ayniVeyaAlti(k, yol)) return `koruma (alti): ${k}`;
  }
  // windows-hazir: yalnız arşiv alt dizinlerinin İÇİ silinebilir; bekleyen kayıtlar ve kökler ASLA.
  if (ayniVeyaAlti(yol, cfg.hazir)) {
    const goreli = path.relative(cfg.hazir, yol).split(/[\\/]+/);
    if (goreli.length < 2 || !HAZIR_ARSIVLER.includes(goreli[0])) return 'windows-hazir bekleyen kayit/kok';
  }
  if (ayniVeyaAlti(cfg.hazir, yol)) return 'windows-hazir koku altinda';
  const kaplar = [cfg.kok, cfg.ajan, cfg.veri, cfg.tmp, cfg.kabulKok, cfg.downloads, cfg.programs, cfg.dijitap,
    cfg.kaynakArsivi, cfg.cache, ...cfg.silinecekler, ...cfg.paketleyiciCikti, path.dirname(cfg.programs),
    os.homedir()];
  for (const k of kaplar) if (k && ayniVeyaAlti(k, yol)) return `koruma (kap): ${k}`;
  return null;
}

// ------------------------------------------------------------------ silme
/** Kilitli dosya varsa ATLA: önce ad değiştir (Windows açık dosyalı dizini yeniden adlandırmaz). */
function sil(yol) {
  const st = lstat(yol);
  if (!st) return { ok: true };
  let hedef = yol;
  if (st.isDirectory()) {
    hedef = `${yol}.siliniyor-${process.pid}`;
    try { fs.renameSync(yol, hedef); } catch (e) { return { ok: false, kilitli: true, hata: e.code || e.message }; }
  }
  try {
    fs.rmSync(hedef, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
  } catch (e) {
    return { ok: false, hata: e.code || e.message, kalan: hedef };
  }
  return lstat(hedef) ? { ok: false, hata: 'silindikten sonra hala var', kalan: hedef } : { ok: true };
}

function bosOlc(surucu) {
  try {
    const st = fs.statfsSync(surucu);
    return st.bavail * st.bsize;
  } catch (_) {
    return null;
  }
}

// ------------------------------------------------------------------ ana akış
/**
 * @param {object} o
 * @param {object} o.cfg yapilandirma()
 * @param {boolean} [o.kuru]
 * @param {string[]} [o.ekler] kullanıcının açık yolları (hedefe bakmadan, yenilik kuralı yok)
 * @param {string[]|null} [o.surecler] küçük harfli süreç metinleri; null = ölçülemedi → silme yok
 * @param {() => number|null} [o.bosOlcer] bayt
 * @param {number} [o.simdi]
 * @param {(s:string)=>void} [o.yaz]
 */
function calistir({ cfg, kuru = false, ekler = [], surecler = [], bosOlcer, simdi = Date.now(), yaz = console.log }) {
  const olc = bosOlcer || (() => bosOlc(cfg.surucu));
  fs.mkdirSync(path.dirname(cfg.log), { recursive: true });
  // Yerel saat (kasa saati; ProBook günlüğüyle aynı biçim). toISOString UTC verirdi (06.10 ölçüldü).
  const zaman = () => { const t = new Date(); return new Date(t - t.getTimezoneOffset() * 60000).toISOString().slice(0, 19); };
  const gunluk = (yol, boyut, neden) => fs.appendFileSync(cfg.log, `${zaman()} · ${yol} · ${boyut} · ${neden}\n`);
  const mb = (b) => `${Math.ceil(b / 1e6)} MB`;
  const sonuc = { silinen: [], atlanan: [], silinenBayt: 0 };
  let bos = olc();
  const hedef = cfg.hedefGb * GB;
  const kuruEtiket = kuru ? ' KURU' : '';
  yaz(`disk-temizlik: ${cfg.surucu} bos ${bos === null ? '?' : (bos / GB).toFixed(1)} GB · hedef ${cfg.hedefGb} GB${kuruEtiket}`);
  gunluk('-', bos === null ? '?' : mb(bos) + ' bos', `BASLA hedef ${cfg.hedefGb} GB${kuruEtiket} ek=${ekler.length}`);
  if (surecler === null) {
    gunluk('-', '-', 'DUR: surec listesi olculemedi — hicbir sey silinmedi');
    yaz('surec listesi olculemedi — silme yok');
    return { ...sonuc, bos, durum: 'dar', olculemedi: true };
  }
  const hedefte = () => bos !== null && bos >= hedef;
  const atla = (yol, neden) => { gunluk(yol, '-', `ATLANDI: ${neden}`); yaz(`ATLANDI ${yol} (${neden})`); sonuc.atlanan.push({ yol, neden }); };

  const isle = (yol, neden, ek) => {
    if (!lstat(yol)) { if (ek) atla(yol, 'yok'); return; }
    const k = korunuyor(yol, cfg);
    if (k) return atla(yol, k);
    if (kullanimda(yol, surecler)) return atla(yol, 'kullanimda (calisan surec)');
    const olcum = agacOlc(yol, ek ? null : simdi - cfg.koruDk * 60000);
    if (olcum.yeni) return atla(yol, `son ${cfg.koruDk} dk icinde degisti`);
    if (kuru) {
      gunluk(yol, mb(olcum.boyut), `KURU: ${neden}`);
      yaz(`KURU ${mb(olcum.boyut)} ${yol} (${neden})`);
    } else {
      const s = sil(yol);
      if (!s.ok) {
        gunluk(yol, mb(olcum.boyut), `${s.kilitli ? 'ATLANDI: kilitli' : 'HATA'} (${s.hata}) ${neden}`);
        yaz(`${s.kilitli ? 'ATLANDI (kilitli)' : 'HATA'} ${yol} ${s.hata}`);
        sonuc.atlanan.push({ yol, neden: s.kilitli ? 'kilitli' : `hata ${s.hata}` });
        return;
      }
      gunluk(yol, mb(olcum.boyut), neden);
      yaz(`SILINDI ${mb(olcum.boyut)} ${yol} (${neden})`);
    }
    sonuc.silinen.push({ yol, bayt: olcum.boyut, neden });
    sonuc.silinenBayt += olcum.boyut;
    if (bos !== null) bos += olcum.boyut;
  };

  for (const e of ekler) isle(path.resolve(e), 'kullanici acikca verdi (--ek)', true);

  if (!hedefte()) {
    const liste = adaylar(cfg).map((a) => ({ ...a, m: agacOlc(a.yol).enYeni }))
      .sort((a, b) => a.katman - b.katman || a.m - b.m);
    for (const a of liste) {
      if (hedefte()) {
        // İzlenen sayaç (du toplamı) hedefi gösterdi; GERÇEK ölçüm de doğrulamalı (06.10 kasa: sayaç 40 GB
        // dedi, sürücü 39,6 GB'tı — eşzamanlı üretim yazıyor). Kuru koşu tahminle yetinir.
        if (kuru) break;
        const b = olc();
        if (b !== null) bos = b;
        if (hedefte()) break;
      }
      isle(a.yol, a.neden, false);
    }
  }
  if (!kuru) { const b = olc(); if (b !== null) bos = b; }
  const durum = hedefte() ? 'tamam' : 'dar';
  gunluk('-', bos === null ? '?' : mb(bos) + ' bos',
    `BITTI silinen ${mb(sonuc.silinenBayt)} · ${sonuc.silinen.length} kalem · atlanan ${sonuc.atlanan.length} · hedef ${durum}${kuruEtiket}`);
  yaz(`SONUC bos_gb=${bos === null ? '?' : Math.floor(bos / GB)} silinen_mb=${Math.ceil(sonuc.silinenBayt / 1e6)} `
    + `kalem=${sonuc.silinen.length} atlanan=${sonuc.atlanan.length} hedef=${durum}`);
  return { ...sonuc, bos, durum };
}

/** mkdir kilidi; sahibi ölüyse devralınır. @returns {(() => void)|null} bırakıcı */
function kilitAl(dizin) {
  const k = path.join(dizin, '.disk-temizlik.kilit');
  fs.mkdirSync(dizin, { recursive: true });
  try { fs.mkdirSync(k); } catch (_) {
    let pid = null;
    try { pid = Number(fs.readFileSync(path.join(k, 'pid'), 'utf8')); } catch (_e) { /* pid yok */ }
    let canli = false;
    if (pid) { try { process.kill(pid, 0); canli = true; } catch (_e) { canli = false; } }
    if (canli) return null;
    fs.rmSync(k, { recursive: true, force: true });
    try { fs.mkdirSync(k); } catch (_e) { return null; }
  }
  fs.writeFileSync(path.join(k, 'pid'), String(process.pid));
  return () => fs.rmSync(k, { recursive: true, force: true });
}

function argumanlar(argv) {
  const o = { kuru: false, ekler: [], hedefGb: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--kuru') o.kuru = true;
    else if (a === '--ek' && argv[i + 1]) o.ekler.push(argv[++i]);
    else if (a === '--hedef-gb' && /^\d+$/.test(argv[i + 1] || '')) o.hedefGb = Number(argv[++i]);
    else throw new Error(`bilinmeyen/eksik argüman: ${a}`);
  }
  return o;
}

if (require.main === module) {
  if (process.platform !== 'win32' && process.env.DT_TEST !== '1') {
    console.error('disk-temizlik.js yalnız windows-kasa\'da koşar (Mac/srv21\'de silme YASAK)');
    process.exit(2);
  }
  let a;
  try { a = argumanlar(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(2); }
  const cfg = yapilandirma();
  if (a.hedefGb !== null) cfg.hedefGb = Math.max(cfg.hedefGb, a.hedefGb);
  const birak = kilitAl(path.dirname(cfg.log));
  if (!birak) { console.log('kilit dolu'); process.exit(4); }
  let r;
  try {
    r = calistir({ cfg, kuru: a.kuru, ekler: a.ekler, surecler: process.env.DT_TEST === '1' ? [] : surecMetinleri() });
  } finally { birak(); }
  process.exit(r.durum === 'tamam' ? 0 : 3);
}

module.exports = { yapilandirma, adaylar, korunuyor, kullanimda, calistir, sil, agacOlc, kilitAl, argumanlar };

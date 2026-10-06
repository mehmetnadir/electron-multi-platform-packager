'use strict';

/**
 * WINDOWS-KASA DİSK TEMİZLİK BEKÇİSİ — "disk dolu → işi durdurma, yer aç" (Nadir 06.10).
 *
 * Kural: kasada C: (üretim birimi) dar diye üretim/kabul/imza DURMAZ. Boş alan hedefin altındaysa
 * BİZİM ürettiğimiz/indirdiğimiz dosyalar EN ESKİDEN başlayarak silinir; hedefe ulaşınca durulur.
 * Silme yalnız ProBook ve windows-kasa'da serbesttir. KORKULUKLAR:
 *   - CLI win32 dışında (Mac, srv21) HER DURUMDA çıkış 2 — test anahtarı yok; testler `calistir`'ı çağırır.
 *   - İzin dosyası `<kok>\disk-temizlik.izin` yoksa hiçbir şey silinmez (görev kurulumu yazar).
 *
 * BAĞIMLILIKSIZ (yalnız node yerleşikleri): kasada `C:\empp-ajan\disk-temizlik.js` kopyası da koşar.
 * İnce sarmalayıcı: disk-temizlik.ps1 · zamanlanmış görev: disk-temizlik-gorev-kur.ps1.
 *
 * SIRA (katman içinde en eski önce — ağacın EN YENİ mtime'ı: "en son dokunulan"):
 *   K1 artık/test/paket: veri\tmp\*, paketleyici çıktısı, yedek-paketleyici-* / kasa-guncel-*.tar
 *      (en yeni 3 kalır), C:\kabul (profiller, exe önbelleği, .empp-yedek-*\*), Silinecekler,
 *      Downloads paketleri, kabulün kurduğu uygulamalar (İZİN LİSTESİ: Programs altında yalnız
 *      resources\app\paket.json'u bizim manifestimiz olan; DijiTap altında ZKitap)
 *   K2 windows-hazir\{yayinlandi,reddedildi,eskiler,bayat,olculemedi} (en yeni 10 kalır), icerik-onbellek,
 *      kaynak önbelleği, kabul-kanit (7 günden eski)
 *   K3 SON ÇARE kaynak arşivi: YALNIZ boş alan SERT eşiğin (vars. EMPP_WIN_URET_MIN_BOS_GB=15) altındayken,
 *      sert eşiğe kadar.
 * KORUMA (belirsizse SİLME):
 *   - koruma listesi + --koru; aday ve korunan kökler düz VE gerçek yol biçimiyle (junction:
 *     ~\.empp-agent → C:\empp-ajan\ev) karşılaştırılır;
 *   - aday (gerçek yolu) yalnız İZİNLİ KÖKLER altında olabilir; env yanlışsa (ör. EMPP_SOURCE_CACHE=C:\)
 *     kök dışı aday reddedilir;
 *   - çalışan sürecin exe yolu / komut satırı adayı içeriyorsa ATLA; süreç listesi alınamazsa HİÇ silme;
 *   - .empp-sahip.pid sahibi canlı dizin (runner iş dizini) ATLA;
 *   - ağaçta son 120 dk içinde değişen dosya varsa ATLA (--ek hariç);
 *   - silmeden önce ad değiştirme sınaması (kilitli → ATLA, yarım silme yok).
 * DİSK TAM DOLUYKEN ÇALIŞIR: kilit adlandırılmış boru (dosya oluşturmaz), aday listesi bellekte,
 *   günlük yazılamazsa satır stdout'a düşer.
 * Günlük: C:\empp-ajan\log\disk-temizlik.log — tarih · yol · boyut · neden.
 *
 * CLI: node disk-temizlik.js [--kuru] [--ek <yol>]... [--koru <yol>]... [--hedef-gb N] [--sert-gb N]
 *   --hedef-gb VERİLİRSE varsayılan rahatlık hedefinin (40) YERİNE geçer (ProBook betiğiyle aynı davranış;
 *   runner kapının gerekli GB'sini verir).
 * Çıkış: 0 hedef sağlandı · 3 adaylar bitti hâlâ dar · 2 kullanım/korkuluk · 4 kilit dolu · 1 beklenmeyen hata.
 * Son satır: SONUC bos_gb=.. silinen_mb=.. kalem=.. atlanan=.. hedef=tamam|dar tarama=tamam|bozuk
 */

const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const cp = require('child_process');

const GB = 1024 ** 3; // GiB: Windows (Get-PSDrive) ve ProBook betiği (df KB/1048576) ile aynı birim
const HAZIR_ARSIVLER = ['yayinlandi', 'reddedildi', 'eskiler', 'bayat', 'olculemedi'];
const PAKET_UZANTI = /\.(impark|yds|ydsdigital|appimage|deb|zip|7z|exe|msi|apk|dmg|part)$/i;
/** kabul.py KORUNAN ile aynı: makinenin kendi programları (Programs altında) — izin listesinden önce elenir. */
const PROGRAMS_KORUNAN = new Set(['common', 'ollama', 'opera', 'python', 'waypoint9-shell']);
const SAHIP_DOSYASI = '.empp-sahip.pid';
const KILIT_BORUSU = '\\\\.\\pipe\\empp-disk-temizlik';

/** Yapılandırma — TEK blok. Kökler env ile ezilebilir (testler sahte kök verir). */
function yapilandirma(env = process.env, home = os.homedir()) {
  const K = env.EMPP_AJAN_KOK || 'C:\\empp-ajan';
  const kokSurucu = path.parse(K).root || 'C:\\';
  const ajan = env.EMPP_AJAN_DIZINI || path.join(home, '.empp-agent');
  const veri = path.join(K, 'veri');
  const kabulKok = env.KABUL_KOK || 'C:\\kabul';
  const hazir = env.EMPP_WIN_HAZIR_KOK || path.join(ajan, 'windows-hazir');
  const localAppData = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const uretMin = Number(env.EMPP_WIN_URET_MIN_BOS_GB === undefined ? 15 : env.EMPP_WIN_URET_MIN_BOS_GB);
  const sertGb = Number.isFinite(uretMin) && uretMin > 0 ? uretMin : 15;
  const downloads = path.join(home, 'Downloads');
  const programs = path.join(localAppData, 'Programs');
  const dijitap = env.DT_DIJITAP || path.join(kokSurucu, 'DijiTap');
  const silinecekler = [path.join(kokSurucu, 'Silinecekler'), path.join(K, 'Silinecekler')];
  return {
    surucu: env.DT_SURUCU || kokSurucu,
    hedefGb: Math.max(Number(env.DT_HEDEF_GB || 40), sertGb),
    sertGb,
    koruDk: Number(env.DT_KORU_DK || 120),
    kanitGun: Number(env.DT_KANIT_GUN || 7),
    hazirTut: 10,
    yedekTut: 3,
    log: path.join(K, 'log', 'disk-temizlik.log'),
    izin: path.join(K, 'disk-temizlik.izin'),
    kilit: KILIT_BORUSU,
    kok: K, ajan, veri, kabulKok, hazir, downloads, programs, dijitap, silinecekler,
    tmp: path.join(veri, 'tmp'),
    paketleyiciCikti: [path.join(veri, 'packager-tool', 'config', 'output'), path.join(veri, 'packager-tool', 'config', 'temp')],
    kaynakArsivi: env.EMPP_KAYNAK_ARSIVI || path.join(veri, 'kaynak-arsivi'),
    cache: env.EMPP_SOURCE_CACHE || path.join(veri, 'cache'),
    // Adayın gerçek yolu YALNIZ bunların altında olabilir.
    izinliKokler: [K, kabulKok, dijitap, downloads, ...silinecekler, ajan, programs],
    // Kendisi, altı ve ATASI silinmez.
    koruAgac: [
      path.join(ajan, 'token.json'), path.join(ajan, 'imza-oncelik.txt'), path.join(ajan, 'kabuk'),
      path.join(ajan, 'motor'), path.join(ajan, 'yuklemeler'), path.join(ajan, 'imza-istek'),
      path.join(ajan, 'windows-kanit'), path.join(ajan, 'kaynak-yok-bildirim.json'),
      path.join(K, 'ortam.ps1'), path.join(K, 'paketleyici'), path.join(K, 'araclar'), path.join(K, 'log'),
      path.join(K, 'vpn'), path.join(K, 'kabul'), path.join(K, 'disk-temizlik.izin'), path.join(K, 'disk-temizlik.js'),
      path.join(K, 'disk-temizlik.ps1'), path.join(veri, 'npm-cache'), path.join(veri, 'tmp', 'node-compile-cache'),
    ],
  };
}

// ------------------------------------------------------------------ dosya sistemi yardımcıları
function lstat(p) { try { return fs.lstatSync(p); } catch (_) { return null; } }
function altlar(d) { try { return fs.readdirSync(d).map((a) => path.join(d, a)); } catch (_) { return []; } }

/** Gerçek yol: üst dizin çözülür (junction/sembolik bağ), ad aynen eklenir. Çözülemezse null. */
function gercekYol(p) {
  const n = path.resolve(p);
  const ad = path.basename(n);
  if (!ad || ad === '.' || ad === '..') return null;
  try { return path.join(fs.realpathSync.native(path.dirname(n)), ad); } catch (_) { return null; }
}
/** Kökün iki biçimi: düz + (varsa) tam gerçek yol. */
function ikiBicim(k) {
  const o = [path.resolve(k)];
  try { const g = fs.realpathSync.native(k); if (!o.includes(g)) o.push(g); } catch (_) { /* yok */ }
  const g2 = gercekYol(k);
  if (g2 && !o.includes(g2)) o.push(g2);
  return o;
}

/** Ağacı yürür: en yeni mtime + toplam boyut + dosya sayısı. `esikMs` verilirse ondan yeni ilk girdide durur. */
function agacOlc(p, esikMs = null) {
  let enYeni = 0;
  let boyut = 0;
  let dosya = 0;
  const yigin = [p];
  while (yigin.length) {
    const y = yigin.pop();
    const st = lstat(y);
    if (!st) continue;
    if (st.mtimeMs > enYeni) enYeni = st.mtimeMs;
    if (esikMs !== null && st.mtimeMs > esikMs) return { enYeni, boyut, dosya, yeni: true };
    if (st.isDirectory()) yigin.push(...altlar(y));
    else { boyut += st.size; dosya += 1; }
  }
  return { enYeni, boyut, dosya, yeni: false };
}

function ayniVeyaAlti(a, kok) {
  const A = process.platform === 'win32' ? a.toLowerCase() : a;
  const B = process.platform === 'win32' ? kok.toLowerCase() : kok;
  return A === B || A.startsWith(B.endsWith(path.sep) ? B : B + path.sep);
}

// ------------------------------------------------------------------ çalışan süreçler
/** win32: tüm süreçlerin exe yolu + komut satırı (kendimiz ve atalarımız hariç). null = ölçülemedi. */
function surecMetinleri() {
  if (process.platform !== 'win32') return null;
  let cikti = '';
  try {
    cikti = cp.execFileSync('powershell.exe', ['-NoProfile', '-Command',
      'Get-CimInstance Win32_Process | % { "$($_.ProcessId)`t$($_.ParentProcessId)`t$($_.ExecutablePath)`t$($_.CommandLine)" }'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120000, windowsHide: true });
  } catch (_) {
    return null; // ölçülemedi → çağıran HİÇBİR şey silmez
  }
  const satirlar = cikti.split(/\r?\n/).filter(Boolean).map((s) => s.split('\t'));
  if (satirlar.length < 5) return null; // boş liste ölçüm hatasıdır, "kimse kullanmıyor" değil
  const ebeveyn = new Map(satirlar.map(([pid, ppid]) => [pid, ppid]));
  const atalar = new Set();
  let p = String(process.pid);
  while (p && !atalar.has(p)) { atalar.add(p); p = ebeveyn.get(p); }
  return satirlar.filter(([pid]) => !atalar.has(pid))
    .flatMap(([, , exe, cmd]) => [exe, cmd]).filter(Boolean).map((s) => s.toLowerCase());
}

function kullanimda(yol, metinler) {
  // Önek eşleşmesi bilerek GENİŞ: `...\empp-kapi-M7` adayı `...\empp-kapi-M7x` kullanımında da korunur.
  // Junction üzerinden de bakılır: süreç satırı iki yoldan biriyle yazılmış olabilir.
  const yollar = ikiBicim(yol).map((s) => s.toLowerCase());
  return metinler.some((m) => yollar.some((y) => m.includes(y)));
}

function sahibiCanli(dizin) {
  let ham;
  try { ham = fs.readFileSync(path.join(dizin, SAHIP_DOSYASI), 'utf8'); } catch (e) {
    return e.code !== 'ENOENT' && e.code !== 'ENOTDIR'; // okunamadı → belirsiz → canlı say
  }
  if (String(ham).trim() === '') return false; // boş işaret (yazım yarım kaldı, runner kaldırır) → yok
  const pid = Number(String(ham).trim());
  if (!Number.isInteger(pid) || pid <= 0) return true;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

// ------------------------------------------------------------------ izin listesi (Ö5)
function jsonOku(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return null; } }
/**
 * Programs altındaki dizin BİZİM mi? YALNIZ resources\app\paket.json manifestimiz (setId + setIdKaynagi;
 * paket-manifesti.js yazar). Boş kalıntılar aday DEĞİL: yer kazandırmaz, sahibi belirsiz (ör. "Common").
 * Makinenin kendi programları (kabul.py KORUNAN) her durumda dışarıda.
 */
function programBizim(dizin) {
  if (PROGRAMS_KORUNAN.has(path.basename(dizin).toLowerCase())) return null;
  const pj = jsonOku(path.join(dizin, 'resources', 'app', 'paket.json'));
  if (pj && typeof pj.setId === 'string' && typeof pj.setIdKaynagi === 'string') return 'paket.json manifesti';
  return null;
}
/** DijiTap altındaki kurulum BİZİM kabulün mü? (sfx: ZKitap) */
function dijitapBizim(dizin) {
  if (lstat(path.join(dizin, 'ZKitap.exe'))) return 'ZKitap';
  const pj = jsonOku(path.join(dizin, 'resources', 'app', 'package.json'));
  if (pj && pj.name === 'zkitap') return 'zkitap package.json';
  return null;
}

// ------------------------------------------------------------------ aday listesi
/** Katmanlı aday listesi (bellekte). Silmez. @returns {Array<{yol, katman, neden}>} */
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
    if (!st || !st.isDirectory() || st.isSymbolicLink()) continue;
    const neden = programBizim(y);
    if (neden) ekle(y, 1, `kabulun kurdugu uygulama (Programs, ${neden})`);
  }
  for (const alan of altlar(cfg.dijitap)) {
    for (const y of altlar(alan)) {
      const st = lstat(y);
      if (!st || !st.isDirectory() || st.isSymbolicLink()) continue;
      const neden = dijitapBizim(y);
      if (neden) ekle(y, 1, `kabulun kurdugu uygulama (DijiTap, ${neden})`);
    }
  }

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
  for (const y of altlar(cfg.kaynakArsivi)) ekle(y, 3, 'kaynak arsivi (SON CARE, sert esik altinda)');
  return o;
}

/**
 * Koruma kararı. Aday düz ve gerçek biçimiyle; koruma kökleri de iki biçimiyle karşılaştırılır.
 * @param {string} yol
 * @param {object} cfg
 * @param {string[]} [koruEk] bu koşunun ek korumaları (--koru)
 * @returns {string|null} neden ya da null (silinebilir)
 */
function korunuyor(yol, cfg, koruEk = []) {
  if (!path.isAbsolute(yol)) return 'mutlak yol degil';
  if (/(^|[\\/])\.\.?([\\/]|$)/.test(yol.slice(path.parse(yol).root.length))) return 'goreli parca (. / ..)';
  const g = gercekYol(yol);
  if (!g) return 'gercek yol cozulemedi';
  const adayBicim = [path.resolve(yol), g].filter((v, i, a) => a.indexOf(v) === i);
  for (const a of adayBicim) {
    if (a.split(/[\\/]+/).filter(Boolean).length < 2) return 'kok dizin';
  }
  // İzinli kök: GERÇEK yol izinli köklerden birinin (iki biçimiyle) ALTINDA olmalı.
  const izinli = cfg.izinliKokler.flatMap(ikiBicim);
  if (!izinli.some((k) => ayniVeyaAlti(g, k) && g.length > k.replace(/[\\/]+$/, '').length)) {
    return `izinli kok disinda: ${g}`;
  }
  const agac = [...cfg.koruAgac, ...koruEk].flatMap(ikiBicim);
  const hazir = ikiBicim(cfg.hazir);
  const kaplar = [cfg.kok, cfg.ajan, cfg.veri, cfg.tmp, cfg.kabulKok, cfg.downloads, cfg.programs, cfg.dijitap,
    cfg.kaynakArsivi, cfg.cache, ...cfg.silinecekler, ...cfg.paketleyiciCikti, path.dirname(cfg.programs),
    os.homedir()].filter(Boolean).flatMap(ikiBicim);
  for (const a of adayBicim) {
    for (const k of agac) {
      if (ayniVeyaAlti(a, k)) return `koruma: ${k}`;
      if (ayniVeyaAlti(k, a)) return `koruma (alti): ${k}`;
    }
    // windows-hazir: yalnız arşiv alt dizinlerinin İÇİ silinebilir; bekleyen kayıtlar ve kökler ASLA.
    for (const h of hazir) {
      if (ayniVeyaAlti(a, h)) {
        const goreli = path.relative(h, a).split(/[\\/]+/);
        if (goreli.length < 2 || !HAZIR_ARSIVLER.includes(goreli[0])) return 'windows-hazir bekleyen kayit/kok';
      }
      if (ayniVeyaAlti(h, a)) return 'windows-hazir koku altinda';
    }
    for (const k of kaplar) if (ayniVeyaAlti(k, a)) return `koruma (kap): ${k}`;
  }
  return null;
}

// ------------------------------------------------------------------ silme
/** Kilitli dosya varsa ATLA: önce ad değiştir (Windows açık dosyalı dizini yeniden adlandırmaz). */
function sil(yol) {
  const st = lstat(yol);
  if (!st) return { ok: true };
  let hedef = yol;
  if (st.isDirectory() && !st.isSymbolicLink()) {
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
 * @param {string[]} [o.koru] bu koşunun ek korumaları
 * @param {string[]|null} [o.surecler] küçük harfli süreç metinleri; null = ölçülemedi → silme yok
 * @param {() => number|null} [o.bosOlcer] bayt
 * @param {number} [o.simdi]
 * @param {(s:string)=>void} [o.yaz]
 */
function calistir({ cfg, kuru = false, ekler = [], koru = [], surecler = [], bosOlcer, simdi = Date.now(), yaz = console.log }) {
  const olc = bosOlcer || (() => bosOlc(cfg.surucu));
  try { fs.mkdirSync(path.dirname(cfg.log), { recursive: true }); } catch (_) { /* disk dolu: stdout'a düşülür */ }
  // Yerel saat (kasa saati; ProBook günlüğüyle aynı biçim).
  const zaman = () => { const t = new Date(); return new Date(t - t.getTimezoneOffset() * 60000).toISOString().slice(0, 19); };
  const gunluk = (yol, boyut, neden) => {
    const s = `${zaman()} · ${yol} · ${boyut} · ${neden}`;
    try { fs.appendFileSync(cfg.log, `${s}\n`); } catch (_) { yaz(`GUNLUK-YAZILAMADI ${s}`); }
  };
  const mb = (b) => `${Math.ceil(b / 1e6)} MB`;
  const sonuc = { silinen: [], atlanan: [], silinenBayt: 0 };
  let bos = olc();
  const hedef = cfg.hedefGb * GB;
  const sert = Math.min(cfg.sertGb, cfg.hedefGb) * GB;
  const kuruEtiket = kuru ? ' KURU' : '';
  const gbYaz = (b) => (b === null ? '?' : (b / GB).toFixed(1));
  yaz(`disk-temizlik: ${cfg.surucu} bos ${gbYaz(bos)} GB · hedef ${cfg.hedefGb} GB · sert ${cfg.sertGb} GB${kuruEtiket}`);
  if (!lstat(cfg.izin)) {
    yaz(`${cfg.izin} yok — izinsiz makinede SILME YOK`);
    return { ...sonuc, bos, durum: 'dar', izinYok: true };
  }
  gunluk('-', bos === null ? '?' : `${mb(bos)} bos`, `BASLA hedef ${cfg.hedefGb} GB sert ${cfg.sertGb} GB${kuruEtiket} ek=${ekler.length}`);
  if (surecler === null) {
    gunluk('-', '-', 'DUR: surec listesi olculemedi — hicbir sey silinmedi');
    yaz('surec listesi olculemedi — silme yok');
    yaz(`SONUC bos_gb=${bos === null ? '?' : Math.floor(bos / GB)} silinen_mb=0 kalem=0 atlanan=0 hedef=dar tarama=bozuk`);
    return { ...sonuc, bos, durum: 'dar', olculemedi: true };
  }
  const hedefte = () => bos !== null && bos >= hedef;
  const sertUstunde = () => bos !== null && bos >= sert;
  const gercekOlc = () => { if (!kuru) { const b = olc(); if (b !== null) bos = b; } };
  const atla = (yol, neden) => { gunluk(yol, '-', `ATLANDI: ${neden}`); yaz(`ATLANDI ${yol} (${neden})`); sonuc.atlanan.push({ yol, neden }); };

  const isle = (yol, neden, ek) => {
    if (!lstat(yol)) { if (ek) atla(yol, 'yok'); return; }
    const k = korunuyor(yol, cfg, koru);
    if (k) return atla(yol, k);
    if (kullanimda(yol, surecler)) return atla(yol, 'kullanimda (calisan surec)');
    const st = lstat(yol);
    if (st.isDirectory() && !st.isSymbolicLink() && sahibiCanli(yol)) return atla(yol, `sahibi canli (${SAHIP_DOSYASI})`);
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
      // Sayaç (toplanan boyut) hedefi gösterse de GERÇEK ölçüm doğrular (eşzamanlı üretim yazıyor).
      if (a.katman === 3) {
        if (hedefte() || sertUstunde()) { gercekOlc(); if (hedefte() || sertUstunde()) break; }
      } else if (hedefte()) {
        gercekOlc();
        if (hedefte()) continue;
      }
      isle(a.yol, a.neden, false);
    }
  }
  gercekOlc();
  const durum = hedefte() ? 'tamam' : 'dar';
  gunluk('-', bos === null ? '?' : `${mb(bos)} bos`,
    `BITTI silinen ${mb(sonuc.silinenBayt)} · ${sonuc.silinen.length} kalem · atlanan ${sonuc.atlanan.length} · hedef ${durum}${kuruEtiket}`);
  yaz(`SONUC bos_gb=${bos === null ? '?' : Math.floor(bos / GB)} silinen_mb=${Math.ceil(sonuc.silinenBayt / 1e6)} `
    + `kalem=${sonuc.silinen.length} atlanan=${sonuc.atlanan.length} hedef=${durum} tarama=tamam`);
  return { ...sonuc, bos, durum };
}

/**
 * Tek kopya kilidi — DOSYA OLUŞTURMAZ (disk tam doluyken de çalışır): adlandırılmış boru dinlenir.
 * İkinci kopya EADDRINUSE alır. Süreç ölünce boru kendiliğinden kalkar.
 * @returns {Promise<(() => void)|null>} bırakıcı ya da null (kilit dolu)
 */
function kilitAl(ad = KILIT_BORUSU) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(null));
    s.listen(ad, () => resolve(() => s.close()));
  });
}

function argumanlar(argv) {
  const o = { kuru: false, ekler: [], koru: [], hedefGb: null, sertGb: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--kuru') o.kuru = true;
    else if (a === '--ek' && argv[i + 1]) o.ekler.push(argv[++i]);
    else if (a === '--koru' && argv[i + 1]) o.koru.push(argv[++i]);
    else if (a === '--hedef-gb' && /^\d+$/.test(argv[i + 1] || '')) o.hedefGb = Number(argv[++i]);
    else if (a === '--sert-gb' && /^\d+$/.test(argv[i + 1] || '')) o.sertGb = Number(argv[++i]);
    else throw new Error(`bilinmeyen/eksik argüman: ${a}`);
  }
  return o;
}

/**
 * CLI ortamı: DT_* test anahtarları ÜRETİMDE okunmaz (inceleme K2) — yapılandırmaya girmeden süzülür.
 * Saf. @returns {object} env kopyası
 */
function cliOrtami(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([k]) => !/^DT_/i.test(k)));
}

/** --hedef-gb verilirse varsayılan rahatlık hedefinin YERİNE geçer (ProBook betiğiyle aynı). Saf. */
function cfgUygula(cfg, a) {
  const c = { ...cfg };
  if (a.hedefGb !== null) c.hedefGb = a.hedefGb;
  if (a.sertGb !== null) c.sertGb = a.sertGb;
  return c;
}

async function cli(argv) {
  if (process.platform !== 'win32') {
    console.error('disk-temizlik.js yalnız windows-kasa\'da koşar (Mac/srv21\'de silme YASAK)');
    return 2;
  }
  let a;
  try { a = argumanlar(argv); } catch (e) { console.error(e.message); return 2; }
  const cfg = cfgUygula(yapilandirma(cliOrtami(process.env)), a);
  const birak = await kilitAl(cfg.kilit);
  if (!birak) { console.log('kilit dolu'); return 4; }
  try {
    const r = calistir({ cfg, kuru: a.kuru, ekler: a.ekler, koru: a.koru, surecler: surecMetinleri() });
    if (r.izinYok) return 2;
    return r.durum === 'tamam' ? 0 : 3;
  } catch (e) {
    console.error(`disk-temizlik beklenmeyen hata: ${e && e.stack ? e.stack : e}`);
    return 1;
  } finally { birak(); }
}

if (require.main === module) {
  cli(process.argv.slice(2)).then((k) => { process.exitCode = k; });
}

module.exports = {
  yapilandirma, cliOrtami, adaylar, korunuyor, kullanimda, calistir, sil, agacOlc, kilitAl, argumanlar, cfgUygula, cli,
  gercekYol, programBizim, dijitapBizim, sahibiCanli,
};

'use strict';
/**
 * Başsız kabul kapısı — paket türüne göre uygulama ağacını GÖRÜNMEZ biçimde açar.
 *
 *   mac DMG     : `hdiutil attach -nobrowse -readonly -noautoopen -mountpoint <kendi dizin>`
 *                 (Finder'da görünmez, otomatik açılmaz; iş bitince detach). Ağaç
 *                 kopyalanmaz, asar bağlama noktasından okunur.
 *   Windows NSIS: 7z ile `$PLUGINSDIR/app-32.7z` → içindeki ağaç; ayrıca NSIS'in DIŞINDA
 *                 tutulan `resources/app/**` (videolar, splash.mp4) aynı köke eklenir.
 *   Pardus      : .impark = ELF + squashfs (ofset 193728). `unsquashfs` yoksa 7zz
 *                 squashfs'i ofsetle kendisi bulur (ölçüldü: "Offset = 193728").
 *                 Yalnız `resources/app.asar|app` + Electron ikilisi çıkarılır.
 *   Android APK : unzip → `assets/public`.
 *   dizin / zip : önceden açılmış ağaç ya da web build zip'i (test ve elle kullanım).
 *
 * Paketlenmiş uygulama ASLA çalıştırılmaz; yalnız içeriği okunur.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { yedizListeCoz, yukSec, arsivYolunuYerelYap } = require('../../scripts/windows-paket-kapisi');
const { ikilidenSurum, macUygulamaSurumu, versionDosyasi } = require('./calisma-zamani');
const { findEngineDirsInPathList, SKIP_DIR_NAMES } = require('../../src/packaging/sub-book-dirs');

const PLATFORMLAR = ['mac', 'android', 'windows', 'pardus', 'dizin', 'zip'];

/** Dosya uzantısından platform tahmini. Saf (yalnız ad + dizin mi bilgisi). */
function platformTahmin(yol, dizinMi = false) {
  if (dizinMi) return 'dizin';
  const u = path.extname(String(yol || '')).toLowerCase();
  if (u === '.dmg') return 'mac';
  if (u === '.apk') return 'android';
  if (u === '.exe') return 'windows';
  if (u === '.impark' || u === '.appimage') return 'pardus';
  if (u === '.zip') return 'zip';
  return null;
}

/** Platform takma adlarını tek biçime indirir (runner 'macos' der). Saf. */
function platformNormalize(p) {
  const s = String(p || '').toLowerCase().trim();
  if (s === 'macos' || s === 'darwin' || s === 'dmg') return 'mac';
  if (s === 'linux' || s === 'impark') return 'pardus';
  if (s === 'win' || s === 'nsis' || s === 'exe') return 'windows';
  if (s === 'apk') return 'android';
  return s;
}

function calistir(komut, argumanlar, secenek = {}) {
  return spawnSync(komut, argumanlar, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...secenek });
}

function yedizBul() {
  for (const aday of ['/opt/homebrew/bin/7zz', '/usr/local/bin/7zz', '7zz', '/usr/local/bin/7z', '7z']) {
    const r = calistir('which', [aday]);
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
    if (aday.startsWith('/') && fs.existsSync(aday)) return aday;
  }
  return null;
}

/**
 * Bir ağaçta uygulama kökünü bulur (index.html'in bulunduğu yer).
 * Sıra: asar (Electron okuyabilir) → açık `app/` → kök. Saf değil (fs), yan etkisiz.
 */
function uygulamaKokunuBul(taban) {
  const adaylar = [
    path.join(taban, 'resources', 'app.asar'),
    path.join(taban, 'resources', 'app'),
    path.join(taban, 'Contents', 'Resources', 'app.asar'),
    path.join(taban, 'Contents', 'Resources', 'app'),
    path.join(taban, 'assets', 'public'),
    path.join(taban, 'build'),
    taban,
  ];
  for (const a of adaylar) {
    const giris = path.join(a, 'index.html');
    if (a.endsWith('.asar')) {
      if (fs.existsSync(a)) return { kok: a, asar: true };
    } else if (fs.existsSync(giris)) {
      return { kok: a, asar: false };
    }
  }
  return null;
}

/**
 * Kök İÇİNDE (kök hariç, en fazla 2 seviye aşağı) `index.html` + `app.config.js`
 * dosyalarına BİRLİKTE sahip her dizini kök-göreli, POSIX yollu, sıralı bir dizi
 * olarak listeler. AD DESENİ (`^book\d+$`) KULLANMAZ — motor imzası (K8,
 * `.claude/docs/set-paketi-know-how.md`). `findEngineDirsInPathList` ile AYNI
 * kanonik algoritma (`src/packaging/sub-book-dirs.js`); burada yalnız girdi
 * (tam bir POSIX yol listesi) gerçek `fs.readdirSync` ile üretilir çünkü
 * `SKIP_DIR_NAMES` altına asla inilmez (performans + yanlış-pozitif önleme).
 */
function dizinYolListesi(kok, maxDepth = 2) {
  const l = [];
  const walk = (dir, rel, derinlik) => {
    let girisler;
    try { girisler = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of girisler) {
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      l.push(childRel);
      if (e.isDirectory() && !SKIP_DIR_NAMES.has(e.name) && derinlik < maxDepth) {
        walk(path.join(dir, e.name), childRel, derinlik + 1);
      }
    }
  };
  walk(kok, '', 0);
  return l;
}

/**
 * Uygulama kökünün envanteri: SET mi, hangi alt-kitap dizinleri motor imzası
 * (`index.html`+`app.config.js`) taşıyor, set-menu.json, kök index.html metni.
 * asar ise @electron/asar ile okunur. SET tanıma AD DESENİNDEN BAĞIMSIZ (K8) —
 * `src/packaging/sub-book-dirs.js` `findEngineDirsInPathList` kanonik fonksiyonuna
 * bağlıdır; Tudem tarzı (`fasikuller-01/`, `okula-basladim/`) adlar da tanınır.
 */
function kokEnvanteri(kok, asarMi) {
  let listele;
  let oku;
  if (asarMi) {
    // eslint-disable-next-line global-require
    const asar = require('@electron/asar');
    const tum = asar.listPackage(kok).map((p) => p.replace(/^[\\/]+/, '').replace(/\\/g, '/'));
    const kume = new Set(tum);
    listele = () => tum;
    oku = (rel) => {
      if (!kume.has(rel)) return null;
      try { return asar.extractFile(kok, rel).toString('utf8'); } catch (_) { return null; }
    };
  } else {
    listele = () => dizinYolListesi(kok);
    oku = (rel) => {
      try { return fs.readFileSync(path.join(kok, rel), 'utf8'); } catch (_) { return null; }
    };
  }
  const liste = listele();
  const kitapDizinleri = findEngineDirsInPathList(liste, { maxDepth: 2 });
  let setMenu = null;
  const sm = oku('set-menu.json');
  if (sm) { try { setMenu = JSON.parse(sm); } catch (_) { setMenu = null; } }
  // Menüde çizilen LİNK kartları (Web-Z `type:'link'`, set-listesi `linkN`) set-menu.json
  // `kitaplar`ında YOKTUR (webz-tema-kabuk tanımdan süzer) ama menüde kart olarak görünür.
  let linkKartSayisi = 0;
  const st = oku('config/settings.json');
  if (st) {
    try {
      const b = (JSON.parse(st) || {}).books;
      if (b && typeof b === 'object') {
        linkKartSayisi = Object.values(b).filter((k) => k && k.type === 'link').length;
      }
    } catch (_) { linkKartSayisi = 0; }
  }
  const indexHtml = oku('index.html') || '';
  const kokAppConfig = liste.includes('app.config.js');
  return {
    kitapDizinleri,
    setMi: kitapDizinleri.length > 0,
    setMenu,
    linkKartSayisi,
    indexHtml,
    kokAppConfig,
    setBookIsareti: liste.includes('SET_BOOK.txt'),
  };
}

// ---------------------------------------------------------------------------
// Platform açıcıları. Her biri {taban, kok, asar, electronSurumu, surumKaynagi,
// ek, kapat()} döner; kapat() iş bitince çağrılır (DMG detach). Hata → throw.
// ---------------------------------------------------------------------------

function macAc(paket, calisma, log) {
  const baglama = path.join(calisma, 'dmg-baglama');
  fs.mkdirSync(baglama, { recursive: true });
  const r = calistir('hdiutil', ['attach', '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', baglama, paket],
    { input: '' });
  if (r.status !== 0) throw new Error(`hdiutil attach rc=${r.status}: ${(r.stderr || r.stdout || '').slice(-300)}`);
  log(`DMG bağlandı (Finder'da görünmez): ${baglama}`);
  const kapat = () => {
    let d = calistir('hdiutil', ['detach', baglama]);
    if (d.status !== 0) d = calistir('hdiutil', ['detach', '-force', baglama]);
    if (d.status === 0) log('DMG ayrıldı');
    else log(`UYARI: DMG ayrılamadı (${baglama}): ${(d.stderr || '').slice(-200)}`);
    return d.status === 0;
  };
  try {
    const app = fs.readdirSync(baglama).find((a) => a.endsWith('.app'));
    if (!app) throw new Error(`DMG içinde .app yok (${fs.readdirSync(baglama).join(', ')})`);
    const appYolu = path.join(baglama, app);
    const bulunan = uygulamaKokunuBul(appYolu);
    if (!bulunan) throw new Error(`${app} içinde app.asar / app/index.html yok`);
    const s = macUygulamaSurumu(appYolu);
    return {
      taban: appYolu,
      ...bulunan,
      electronSurumu: s ? s.surum : null,
      surumKaynagi: s ? s.kaynak : 'Electron Framework Info.plist okunamadı',
      ek: { appYolu, baglama },
      kapat,
    };
  } catch (e) {
    kapat();
    throw e;
  }
}

function androidAc(paket, calisma) {
  const hedef = path.join(calisma, 'apk');
  fs.mkdirSync(hedef, { recursive: true });
  const r = calistir('unzip', ['-q', '-o', paket, 'assets/public/*', '-d', hedef]);
  if (r.status !== 0 && r.status !== 1) throw new Error(`unzip rc=${r.status}: ${(r.stderr || '').slice(-300)}`);
  const kok = path.join(hedef, 'assets', 'public');
  if (!fs.existsSync(path.join(kok, 'index.html'))) throw new Error('APK içinde assets/public/index.html yok');
  return {
    taban: hedef, kok, asar: false, electronSurumu: null,
    surumKaynagi: 'APK Electron taşımaz (Capacitor WebView)', ek: {}, kapat: () => true,
  };
}

function pardusAc(paket, calisma, log) {
  const yediz = yedizBul();
  if (!yediz) throw new Error('7zz/7z yok — squashfs açılamadı (unsquashfs de yok)');
  const liste = calistir(yediz, ['l', '-slt', paket]);
  if (liste.status !== 0) throw new Error(`7z listeleyemedi: ${(liste.stderr || '').slice(-200)}`);
  const ofset = /Offset = (\d+)/.exec(liste.stdout);
  log(`impark squashfs ofseti: ${ofset ? ofset[1] : '?'} (${path.basename(yediz)})`);
  // Kökteki en büyük ELF benzeri dosya Electron ikilisidir (uygulama adıyla adlandırılır).
  const girdiler = [];
  let cari = null;
  for (const satir of liste.stdout.split('\n')) {
    const m = /^(Path|Size|Folder) = (.*)$/.exec(satir.trim());
    if (!m) continue;
    if (m[1] === 'Path') { cari = { yol: m[2] }; girdiler.push(cari); }
    if (cari && m[1] === 'Size') cari.boyut = Number(m[2]) || 0;
    if (cari && m[1] === 'Folder') cari.dizin = m[2] === '+';
  }
  const ikili = girdiler
    .filter((g) => !g.dizin && !g.yol.includes('/') && !/\.(so|pak|dat|bin|html|json|png|txt)$|^(AppRun|chrome-sandbox|chrome_crashpad_handler)$|\.so\./.test(g.yol))
    .sort((a, b) => (b.boyut || 0) - (a.boyut || 0))[0];
  const hedef = path.join(calisma, 'impark');
  const desenler = ['resources/app.asar', 'resources/app.asar.unpacked', 'resources/app'];
  if (ikili) desenler.push(ikili.yol);
  const r = calistir(yediz, ['x', '-y', `-o${hedef}`, paket, ...desenler, '-r']);
  if (r.status !== 0) throw new Error(`7z çıkaramadı rc=${r.status}: ${(r.stderr || '').slice(-300)}`);
  const bulunan = uygulamaKokunuBul(hedef);
  if (!bulunan) throw new Error('impark içinde resources/app.asar ya da resources/app yok');
  const surum = ikili ? ikilidenSurum(path.join(hedef, ikili.yol)) : null;
  return {
    taban: hedef, ...bulunan, electronSurumu: surum,
    surumKaynagi: ikili ? `ikili ${ikili.yol} içinde "Electron/x.y.z"` : 'Electron ikilisi bulunamadı',
    ek: { ofset: ofset ? Number(ofset[1]) : null, ikili: ikili ? ikili.yol : null }, kapat: () => true,
  };
}

function windowsAc(paket, calisma, log) {
  const yediz = yedizBul();
  if (!yediz) throw new Error('7z yok — NSIS açılamadı');
  const liste = calistir(yediz, ['l', '-slt', paket]);
  if (liste.status !== 0) throw new Error(`7z listeleyemedi: ${(liste.stderr || '').slice(-200)}`);
  const adlar = yedizListeCoz(liste.stdout);
  const yuk = yukSec(adlar);
  if (!yuk) throw new Error(`NSIS içinde app-*.7z yükü yok (${adlar.length} girdi)`);
  const d1 = path.join(calisma, 'nsis');
  const r1 = calistir(yediz, ['x', '-y', `-o${d1}`, paket, yuk]);
  const yukYolu = arsivYolunuYerelYap(d1, yuk);
  if (r1.status !== 0 || !fs.existsSync(yukYolu)) throw new Error(`yük açılamadı (${yuk}): ${(r1.stderr || '').slice(-200)}`);
  log(`NSIS yükü: ${yuk}`);
  const d2 = path.join(calisma, 'win');
  const r2 = calistir(yediz, ['x', '-y', `-o${d2}`, yukYolu]);
  if (r2.status !== 0) throw new Error(`yük içeriği açılamadı: ${(r2.stderr || '').slice(-200)}`);
  // NSIS dışında (yükün yanında) duran resources/app parçaları — üzerine yazmadan ekle.
  if (adlar.some((a) => /^resources[\\/]app[\\/]/i.test(a))) {
    calistir(yediz, ['x', '-aos', `-o${d2}`, paket, 'resources/app', '-r']);
  }
  const bulunan = uygulamaKokunuBul(d2);
  if (!bulunan) throw new Error('NSIS yükünde resources/app.asar ya da resources/app yok');
  const exeler = fs.readdirSync(d2)
    .filter((a) => a.toLowerCase().endsWith('.exe') && !/^uninstall/i.test(a))
    .map((a) => ({ a, b: fs.statSync(path.join(d2, a)).size }))
    .sort((x, y) => y.b - x.b);
  const surum = exeler.length ? ikilidenSurum(path.join(d2, exeler[0].a)) : versionDosyasi(d2);
  return {
    taban: d2, ...bulunan, electronSurumu: surum,
    surumKaynagi: exeler.length ? `ikili ${exeler[0].a} içinde "Electron/x.y.z"` : 'version dosyası',
    ek: { yuk }, kapat: () => true,
  };
}

function dizinAc(paket) {
  const bulunan = uygulamaKokunuBul(paket);
  if (!bulunan) throw new Error(`dizinde index.html / app.asar yok: ${paket}`);
  return {
    taban: paket, ...bulunan, electronSurumu: versionDosyasi(paket),
    surumKaynagi: 'dizin (sürüm bilgisi yok)', ek: {}, kapat: () => true,
  };
}

function zipAc(paket, calisma) {
  const hedef = path.join(calisma, 'zip');
  fs.mkdirSync(hedef, { recursive: true });
  const r = calistir('unzip', ['-q', '-o', paket, '-d', hedef]);
  if (r.status !== 0 && r.status !== 1) throw new Error(`unzip rc=${r.status}: ${(r.stderr || '').slice(-300)}`);
  return dizinAc(hedef);
}

/**
 * @param {{paket:string, platform:string, calisma:string, log?:Function}} p
 */
function paketiAc({ paket, platform, calisma, log = () => {} }) {
  fs.mkdirSync(calisma, { recursive: true });
  switch (platform) {
    case 'mac': return macAc(paket, calisma, log);
    case 'android': return androidAc(paket, calisma, log);
    case 'pardus': return pardusAc(paket, calisma, log);
    case 'windows': return windowsAc(paket, calisma, log);
    case 'dizin': return dizinAc(paket, calisma, log);
    case 'zip': return zipAc(paket, calisma, log);
    default: throw new Error(`bilinmeyen platform: ${platform}`);
  }
}

module.exports = {
  PLATFORMLAR,
  platformTahmin,
  platformNormalize,
  uygulamaKokunuBul,
  kokEnvanteri,
  paketiAc,
  yedizBul,
};

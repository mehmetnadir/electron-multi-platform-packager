'use strict';
/**
 * Başsız kabul kapısının Electron ÇALIŞMA ZAMANI: paketin kendi Electron sürümünü bulur,
 * eşleşen macOS çalışma zamanını ODAK ÇALMAYACAK biçimde hazırlar.
 *
 * Sürüm nereden okunur (paket türüne göre, ölçüldü 2026-09-26):
 *   • mac   : `<App>.app/Contents/Frameworks/Electron Framework.framework/Resources/Info.plist`
 *             → CFBundleVersion.
 *   • pardus/windows: Electron ikilisinin içindeki kullanıcı-ajanı şablonu
 *             "Chrome/%s Electron/27.3.11" (73768 .impark ELF'inde 2 eşleşme).
 *   • Electron zip/dist düzeni: kökteki `version` dosyası.
 *   • APK Electron TAŞIMAZ (Capacitor WebView) → sürüm yok, varsayılana düşülür.
 *
 * Çalışma zamanı nereden gelir:
 *   1. `~/Library/Caches/electron/**\/electron-v<sürüm>-darwin-<mimari>.zip` (electron/get önbelleği)
 *   2. yoksa odaksız KANITLI sürüm (27.3.11) → UYARI.
 *   3. node_modules/electron (39) yalnız EMPP_KABUL_KANITSIZ_ZAMAN=1 ile: 26.09'da odak çaldığı ölçüldü.
 *
 * ODAK: kopyanın Info.plist'ine LSUIElement=YES yazılır (Dock simgesi yok, açılışta
 * etkinleşmez), kimliği ayrı bir paket kimliğine çevrilir ve ad-hoc yeniden imzalanır.
 * node_modules'taki özgün Electron'a DOKUNULMAZ — her zaman KOPYA yamalanır.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const KIMLIK = 'net.yayincilik.empp.basliksiz-kabul';
const HAZIR_ISARETI = '.empp-kabul-hazir.json';
const LSREGISTER = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
const SURUM_DESENI = /Electron\/(\d+\.\d+\.\d+)/;

function varsayilanKok() {
  return process.env.EMPP_KABUL_CALISMA_ZAMANI
    || path.join(os.homedir(), '.empp-agent', 'kabul-kanit', '_calisma-zamani');
}

function varsayilanOnbellekler() {
  const l = [];
  if (process.env.electron_config_cache) l.push(process.env.electron_config_cache);
  l.push(path.join(os.homedir(), 'Library', 'Caches', 'electron'));
  return l;
}

/** Bir metin/tampon içinden "Electron/x.y.z" sürümünü ayıklar. Saf. */
function surumMetindenAyikla(metin) {
  const m = SURUM_DESENI.exec(String(metin || ''));
  return m ? m[1] : null;
}

/**
 * Büyük bir ikilide (ELF/PE, 150+ MB) "Electron/x.y.z" arar — 8 MB'lık parçalarla,
 * parça sınırında kesilmesin diye 64 bayt örtüşmeyle. Bulamazsa null.
 */
function ikilidenSurum(dosya) {
  let fd;
  try { fd = fs.openSync(dosya, 'r'); } catch (_) { return null; }
  try {
    const PARCA = 8 * 1024 * 1024;
    const ORTUSME = 64;
    const tampon = Buffer.alloc(PARCA + ORTUSME);
    let konum = 0;
    let tasinan = 0;
    for (;;) {
      const okunan = fs.readSync(fd, tampon, tasinan, PARCA, konum);
      if (okunan <= 0) break;
      const toplam = tasinan + okunan;
      const s = surumMetindenAyikla(tampon.toString('latin1', 0, toplam));
      if (s) return s;
      konum += okunan;
      tasinan = Math.min(ORTUSME, toplam);
      tampon.copy(tampon, 0, toplam - tasinan, toplam);
    }
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

/** mac uygulama paketinden (`.app`) Electron sürümü. */
function macUygulamaSurumu(appYolu) {
  const adaylar = [
    path.join(appYolu, 'Contents', 'Frameworks', 'Electron Framework.framework', 'Resources', 'Info.plist'),
    path.join(appYolu, 'Contents', 'Frameworks', 'Electron Framework.framework', 'Versions', 'A', 'Resources', 'Info.plist'),
  ];
  for (const plist of adaylar) {
    if (!fs.existsSync(plist)) continue;
    const r = spawnSync('plutil', ['-extract', 'CFBundleVersion', 'raw', '-o', '-', plist], { encoding: 'utf8' });
    const v = String(r.stdout || '').trim();
    if (r.status === 0 && /^\d+\.\d+\.\d+/.test(v)) return { surum: v, kaynak: plist };
  }
  return null;
}

/** Bir dizinde (Electron dağıtım kökü) `version` dosyası varsa oku. */
function versionDosyasi(dizin) {
  try {
    const v = fs.readFileSync(path.join(dizin, 'version'), 'utf8').trim().replace(/^v/, '');
    return /^\d+\.\d+\.\d+/.test(v) ? v : null;
  } catch (_) {
    return null;
  }
}

/** Önbellek dizinlerinde (iki düzey derinliğe kadar) eşleşen zip'i arar. */
function onbellekZipBul(surum, mimari, onbellekler = varsayilanOnbellekler()) {
  const ad = `electron-v${surum}-darwin-${mimari}.zip`;
  for (const kok of onbellekler) {
    const dogrudan = path.join(kok, ad);
    if (fs.existsSync(dogrudan)) return dogrudan;
    let altlar = [];
    try { altlar = fs.readdirSync(kok, { withFileTypes: true }).filter((e) => e.isDirectory()); } catch (_) { continue; }
    for (const a of altlar) {
      const y = path.join(kok, a.name, ad);
      if (fs.existsSync(y)) return y;
    }
  }
  return null;
}

function calistir(komut, argumanlar) {
  const r = spawnSync(komut, argumanlar, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (r.status !== 0) {
    throw new Error(`${komut} ${argumanlar.slice(0, 3).join(' ')} rc=${r.status}: ${(r.stderr || r.stdout || '').slice(-300)}`);
  }
  return r;
}

/** Kopyanın Info.plist'ini odaksız çalışacak biçimde yamalar ve ad-hoc imzalar. */
function odaksizYap(appYolu) {
  const plist = path.join(appYolu, 'Contents', 'Info.plist');
  calistir('plutil', ['-replace', 'LSUIElement', '-bool', 'YES', plist]);
  calistir('plutil', ['-replace', 'CFBundleIdentifier', '-string', KIMLIK, plist]);
  calistir('plutil', ['-replace', 'CFBundleName', '-string', 'EMPP Basliksiz Kabul', plist]);
  spawnSync('xattr', ['-dr', 'com.apple.quarantine', appYolu]);
  // Yalnız dış paket yeniden imzalanır (--deep DEĞİL): iç yardımcılara dokunulmadı, imzaları
  // geçerli. npm'in açtığı node_modules/electron'da çerçeve sembolik bağları düz dosyaya
  // dönmüş olabiliyor; --deep orada "bundle format is ambiguous" ile düşüyor (ölçüldü, v39).
  calistir('codesign', ['--force', '--sign', '-', appYolu]);
  // LaunchServices kaydını AÇMADAN önceden yap: kayıt ilk açılışa kalmasın.
  spawnSync(LSREGISTER, ['-f', appYolu]);
}

function ikiliYolu(kok) {
  return path.join(kok, 'Electron.app', 'Contents', 'MacOS', 'Electron');
}

function hazirMi(hedef) {
  return fs.existsSync(path.join(hedef, HAZIR_ISARETI)) && fs.existsSync(ikiliYolu(hedef));
}

function hazirIsaretle(hedef, bilgi) {
  fs.writeFileSync(path.join(hedef, HAZIR_ISARETI), JSON.stringify({ ...bilgi, zaman: new Date().toISOString() }, null, 2));
}

/**
 * Odak çalmadığı ÖLÇÜLEREK kanıtlanmış çalışma zamanları (lsappinfo 300 ms örnekleme +
 * koşumun `did-become-active` sayacı). 27.3.11: 26.09'da 5 gerçek paket koşusu, 0 odak
 * değişimi. Paketin kendi sürümü yoksa ya da işaretliyse bunlara düşülür.
 */
const ODAKSIZ_KANITLI = Object.freeze(['27.3.11']);

/** Bu çalışma zamanı daha önce odak çaldı mı? (işaret dosyası kalıcıdır, elle kaldırılır) */
const ODAK_CALDI_ISARETI = '.empp-kabul-odak-caldi.json';
function odakCaldiMi(dizin) {
  return fs.existsSync(path.join(dizin, ODAK_CALDI_ISARETI));
}

/** Kapı, koşum sırasında odak çalındığını ölçerse bu çalışma zamanını kalıcı işaretler. */
function odakCaldiIsaretle(dizin, kanit) {
  try {
    fs.writeFileSync(path.join(dizin, ODAK_CALDI_ISARETI),
      JSON.stringify({ zaman: new Date().toISOString(), ...kanit }, null, 2));
    return true;
  } catch (_) {
    return false;
  }
}

/** Zip'ten ya da dist'ten KOPYA hazırlar (yarım deneme silinmez, kenara alınır). */
function hazirla(hedef, kaynak, surum, log) {
  log(`çalışma zamanı hazırlanıyor: ${kaynak}`);
  const gecici = `${hedef}.hazirlaniyor-${process.pid}`;
  fs.mkdirSync(gecici, { recursive: true });
  if (kaynak.endsWith('.zip')) {
    calistir('ditto', ['-x', '-k', kaynak, gecici]);
  } else {
    calistir('ditto', [path.join(kaynak, 'Electron.app'), path.join(gecici, 'Electron.app')]);
    fs.copyFileSync(path.join(kaynak, 'version'), path.join(gecici, 'version'));
  }
  odaksizYap(path.join(gecici, 'Electron.app'));
  hazirIsaretle(gecici, { surum, kaynak });
  if (fs.existsSync(hedef)) fs.renameSync(hedef, `${hedef}.eski-${Date.now()}`);
  fs.renameSync(gecici, hedef);
}

/**
 * Paketin sürümüne uygun, odaksız bir Electron çalışma zamanı hazırlar.
 *
 * Aday sırası: (1) paketin kendi sürümü (önbellekte zip'i varsa) → (2) odaksız kanıtlı
 * sürümler → (3) node_modules/electron YALNIZ `EMPP_KABUL_KANITSIZ_ZAMAN=1` ile.
 * (3) varsayılan KAPALI, çünkü ölçüldü (2026-09-26 11:04): node_modules'taki v39 kopyası,
 * LSUIElement=YES olmasına rağmen açılışta ~3 sn ön plana geçti (lsappinfo front
 * pid 18787). Odak çaldığı ölçülen her çalışma zamanı kalıcı işaretlenir ve atlanır.
 *
 * @param {{surum?: string|null, kok?: string, mimari?: string, onbellekler?: string[],
 *          yedekDist?: string, kanitsizIzin?: boolean, log?: Function}} p
 * @returns {{ikili:string, surum:string, eslesti:boolean, kaynak:string, dizin:string, uyari:string|null, atlananlar:string[]}}
 */
function calismaZamaniHazirla(p = {}) {
  const log = p.log || (() => {});
  const kok = p.kok || varsayilanKok();
  const mimari = p.mimari || (process.arch === 'arm64' ? 'arm64' : 'x64');
  const kanitsizIzin = p.kanitsizIzin !== undefined ? p.kanitsizIzin : process.env.EMPP_KABUL_KANITSIZ_ZAMAN === '1';
  fs.mkdirSync(kok, { recursive: true });
  const atlananlar = [];

  const surumler = [];
  if (p.surum) surumler.push(p.surum);
  for (const v of ODAKSIZ_KANITLI) if (!surumler.includes(v)) surumler.push(v);

  const sonuc = (surum, hedef, kaynak) => {
    const eslesti = Boolean(p.surum) && surum === p.surum;
    let uyari = null;
    if (!eslesti) {
      uyari = p.surum
        ? `UYARI: paketin Electron sürümü v${p.surum} için odaksız çalışma zamanı yok — v${surum} ile koşuldu`
        : `paket Electron taşımıyor — odaksız kanıtlı v${surum} ile koşuldu`;
    }
    return { ikili: ikiliYolu(hedef), surum, eslesti, kaynak, dizin: hedef, uyari, atlananlar };
  };

  for (const surum of surumler) {
    const hedef = path.join(kok, `electron-v${surum}-darwin-${mimari}`);
    if (odakCaldiMi(hedef)) { atlananlar.push(`v${surum}: daha önce odak çaldı (işaretli)`); continue; }
    if (hazirMi(hedef)) return sonuc(surum, hedef, hedef);
    const zip = onbellekZipBul(surum, mimari, p.onbellekler);
    if (zip) { hazirla(hedef, zip, surum, log); return sonuc(surum, hedef, zip); }
    atlananlar.push(`v${surum}: önbellekte darwin-${mimari} zip'i yok`);
  }

  const dist = p.yedekDist || path.join(__dirname, '..', '..', 'node_modules', 'electron', 'dist');
  const yedekSurum = versionDosyasi(dist);
  if (kanitsizIzin && yedekSurum && fs.existsSync(path.join(dist, 'Electron.app'))) {
    const hedef = path.join(kok, `electron-v${yedekSurum}-darwin-${mimari}`);
    if (!odakCaldiMi(hedef)) {
      if (!hazirMi(hedef)) hazirla(hedef, dist, yedekSurum, log);
      const r = sonuc(yedekSurum, hedef, dist);
      r.uyari = `UYARI: odaksız kanıtı OLMAYAN v${yedekSurum} ile koşuldu (EMPP_KABUL_KANITSIZ_ZAMAN=1)`;
      return r;
    }
    atlananlar.push(`v${yedekSurum}: daha önce odak çaldı (işaretli)`);
  }
  throw new Error(`odaksız Electron çalışma zamanı yok (${atlananlar.join('; ')}`
    + `${kanitsizIzin ? '' : '; node_modules yedeği kanıtsız, EMPP_KABUL_KANITSIZ_ZAMAN=1 olmadan kullanılmaz'})`);
}

module.exports = {
  KIMLIK,
  SURUM_DESENI,
  surumMetindenAyikla,
  ikilidenSurum,
  macUygulamaSurumu,
  versionDosyasi,
  onbellekZipBul,
  calismaZamaniHazirla,
  varsayilanKok,
  ODAKSIZ_KANITLI,
  odakCaldiMi,
  odakCaldiIsaretle,
};

#!/usr/bin/env node
'use strict';

/**
 * ÜRETİM ÖN KONTROLÜ — set güncelleme kanallı Windows exe'si üretilmeden ÖNCE koşar.
 *
 * NEDEN (2026-09-21, ölçülmüş arızalar):
 *  1) KAÇAK / BAYAT PAKETLEYİCİ. `/api/health` bir zamanlar YALNIZ canlılık ölçüyordu;
 *     elle başlatılmış yetim bir süreç porta oturunca temiz kopya hiç başlamadı
 *     (bkz. `src/server/saglik-kimligi.js` başlığı). Kimlik alanları eklendi ama
 *     `bayatMi` YALNIZ 7 kritik modülü izler: `saglik-kimligi.js`, `windows-asarsiz.js`,
 *     `packagingService.js`, `WindowsPackagingService.js` o listede DEĞİLDİR.
 *     ÖLÇÜLDÜ (bugün): canlı süreç 11:14:34Z'de başladı, üretim davranışını değiştiren
 *     dosyalar 11:22–11:40Z arasında düzenlendi — `bayatMi:false` olmasına RAĞMEN
 *     süreç bayattı. Bu yüzden burada İKİNCİ, bağımsız bir tazelik ölçümü var:
 *     kritik dosyaların mtime'ı süreç başlangıcından YENİ mi?
 *  2) KAPI LİSTESİ KİMLİKTİR. `asar:false` (EMPP_WINDOWS_ASARSIZ) üretim davranışı
 *     kapısıdır ve `kapilariOku()`ya eklendi. Canlı süreç `kapilar.windowsAsarsiz`
 *     ALANINI HİÇ DÖNDÜRMÜYORSA, o süreç kapı listesinin eski sürümünü yüklemiştir —
 *     yani asar değişikliğini de taşımıyordur. Alanın YOKLUĞU bayatlık KANITIDIR.
 *  3) DİSK. Mac'te veri birimi %97 dolu. 1,3 GB exe + açılmış ZIP + electron-builder
 *     ara ürünleri + kapı çıkarımı aynı birime sığmak zorunda; sığmazsa üretim saatler
 *     sonra ENOSPC ile düşer.
 *  4) `windows-kasa` ŞERİDİ. `vm-kapi.js hazir` MAKİNESİZ çağrılırsa eski tek-makine
 *     kalbini okur ve "ölü" der (ölçüldü: aynı anda makinesiz "olu", `--makine
 *     windows-kasa` "ayakta"). Ölçüm doğru yerden yapılmalıdır.
 *
 * FELSEFE: ÖLÇEMEDİĞİNİ GEÇTİ SAYMA. Üç durum var — GEÇTİ · KALDI · UYARI.
 * Ölçülemeyen bir önkoşul "GEÇTİ" değildir; ya KALDI'dır (üretimi durdurur) ya da
 * UYARI'dır (bilinçli kabul edilen belirsizlik, çıkış kodunu etkilemez).
 *
 * Kullanım:
 *   node scripts/uretim-on-kontrol.js            # insan okunur
 *   node scripts/uretim-on-kontrol.js --json     # makine okunur
 *   node scripts/uretim-on-kontrol.js --disk-gb 30
 *
 * Çıkış kodu: KALDI varsa 1 · yoksa 0 (UYARI çıkış kodunu DEĞİŞTİRMEZ).
 *
 * Bağımlılık YOK — yalnız Node stdlib.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawnSync } = require('child_process');

const KOK = path.resolve(__dirname, '..');

// ——— durum sabitleri ————————————————————————————————————————————————
const GECTI = 'GEÇTİ';
const KALDI = 'KALDI';
const UYARI = 'UYARI';

// ——— üretim sabitleri (defterle BİREBİR: .claude/docs/set-exe-uretim-defteri.md) ———
const KAYNAK_ZIP = path.join(process.env.HOME || '', 'Downloads', 'yds-pketler', 'sm4.zip');
const KAYNAK_ZIP_BAYT = 1433105846;
const LOGO_ID = 'f89d2e30-c4c1-4ba9-bca6-b561f114627b';
const PAKETLEYICI = process.env.EMPP_PAKETLEYICI || 'http://127.0.0.1:3001';
const VARSAYILAN_DISK_GB = 20;

/**
 * ÜRETİM DAVRANIŞINI DEĞİŞTİREN DOSYALAR — tazelik ölçümünün kapsamı.
 * `surec-kimligi.js`'in izlediği 7 modülle KASITLI olarak ÖRTÜŞMEZ: oradaki liste
 * require-cache parmak izi karşılaştırır (bellek↔disk), burası süreç başlangıç
 * ZAMANINI karşılaştırır. İkisi farklı kör noktaları kapatır.
 */
const KRITIK_DOSYALAR = [
  'src/server/app.js',
  'src/server/saglik-kimligi.js',
  'src/server/surec-kimligi.js',
  'src/packaging/packagingService.js',
  'src/packaging/windows-asarsiz.js',
  'src/packaging/set-kimligi.js',
  'src/packaging/set-kabuk.js',
  'src/packaging/guncelleyici-enjekte.js',
  'src/platforms/windows/WindowsPackagingService.js',
];

// ===========================================================================
// 1. SAF KARAR KATMANI — I/O YOK. Her fonksiyon ölçülmüş olguyu alır, sonuç döner.
//    Testler YALNIZ bu katmanı çağırır; sürücü (aşağıda) olguları toplar.
// ===========================================================================

/** @returns {{ad:string, durum:string, sebep:string, olcum?:Object}} */
function sonucYap(ad, durum, sebep, olcum) {
  const s = { ad, durum, sebep };
  if (olcum !== undefined) s.olcum = olcum;
  return s;
}

/**
 * 1) PAKETLEYİCİ CANLI VE KİMLİĞİ OKUNUYOR MU?
 * @param {{saglik:Object|null, hata:string|null}} olgu
 */
function kontrolPaketleyiciCanli(olgu) {
  const o = olgu || {};
  if (!o.saglik) {
    return sonucYap('paketleyici-canli', KALDI,
      `/api/health cevap vermedi: ${o.hata || 'bilinmeyen sebep'}`);
  }
  if (typeof o.saglik.commit !== 'string' || !o.saglik.commit) {
    return sonucYap('paketleyici-canli', KALDI,
      'sağlık cevabında `commit` yok — bu uç kimlik bildirmiyor, eski sürüm koşuyor');
  }
  return sonucYap('paketleyici-canli', GECTI,
    `commit ${o.saglik.commit}, pid ${o.saglik.pid == null ? '?' : o.saglik.pid}`,
    { commit: o.saglik.commit, pid: o.saglik.pid == null ? null : o.saglik.pid });
}

/**
 * 2) SÜREÇ TAZE Mİ? Üç bağımsız kanıt aranır:
 *    a) `bayatMi` (require-cache ↔ disk, 7 modül)
 *    b) `kapilar.windowsAsarsiz` alanının VARLIĞI (kapı listesi sürümü)
 *    c) kritik dosya mtime'ı ↔ süreç başlangıcı (bayatMi'nin kör noktası)
 * Üçünden biri bile bayatlık gösteriyorsa KALDI. Şüphede GEÇTİ YOK.
 * @param {{saglik:Object|null, damgalar:Array<{yol:string, mtimeMs:number|null}>}} olgu
 */
function kontrolSurecTazeligi(olgu) {
  const o = olgu || {};
  const s = o.saglik;
  if (!s) {
    return sonucYap('surec-tazeligi', KALDI, 'sağlık cevabı yok — tazelik ÖLÇÜLEMEDİ');
  }
  const sebepler = [];

  if (s.bayatMi === true) {
    const b = Array.isArray(s.bayatSebepleri) ? s.bayatSebepleri.join('; ') : '';
    sebepler.push(`bayatMi:true${b ? ` (${b})` : ''}`);
  } else if (s.bayatMi !== false) {
    sebepler.push('cevapta `bayatMi` alanı YOK — süreç kimlik ölçmeyen eski koddan');
  }

  const kapilar = s.kapilar && typeof s.kapilar === 'object' ? s.kapilar : null;
  if (!kapilar) {
    sebepler.push('cevapta `kapilar` YOK — kapı listesi okunamıyor');
  } else if (!Object.prototype.hasOwnProperty.call(kapilar, 'windowsAsarsiz')) {
    sebepler.push('`kapilar.windowsAsarsiz` alanı YOK — süreç, asar kapısı eklenmeden '
      + 'önceki kapı listesini yüklemiş (asar:false değişikliğini taşımıyor)');
  }

  const basMs = Date.parse(s.startedAt);
  if (!Number.isFinite(basMs)) {
    sebepler.push('`startedAt` okunamadı — mtime kıyası YAPILAMADI');
  } else {
    const yeniler = [];
    for (const d of (o.damgalar || [])) {
      if (d.mtimeMs == null) {
        sebepler.push(`${d.yol}: mtime okunamadı — kıyas YAPILAMADI`);
        continue;
      }
      if (d.mtimeMs > basMs) {
        yeniler.push(`${d.yol} (+${Math.round((d.mtimeMs - basMs) / 1000)} sn)`);
      }
    }
    if (yeniler.length) {
      sebepler.push(`süreç başladıktan SONRA düzenlenmiş: ${yeniler.join(', ')}`);
    }
  }

  if (sebepler.length) {
    return sonucYap('surec-tazeligi', KALDI, sebepler.join(' | '), { sebepAdedi: sebepler.length });
  }
  return sonucYap('surec-tazeligi', GECTI,
    `bayatMi:false, kapı listesi güncel, ${(o.damgalar || []).length} kritik dosya süreçten eski`);
}

/**
 * 3) KAYNAK ZIP — var mı ve BAYT BAYT beklenen boyutta mı?
 * @param {{varMi:boolean, boyut:number|null, yol:string, beklenen:number}} olgu
 */
function kontrolKaynakZip(olgu) {
  const o = olgu || {};
  const beklenen = o.beklenen == null ? KAYNAK_ZIP_BAYT : o.beklenen;
  if (!o.varMi) {
    return sonucYap('kaynak-zip', KALDI, `kaynak ZIP yok: ${o.yol}`);
  }
  if (o.boyut !== beklenen) {
    return sonucYap('kaynak-zip', KALDI,
      `boyut uyuşmuyor: ${o.boyut} bayt, beklenen ${beklenen} bayt — yanlış/yarım dosya`,
      { boyut: o.boyut, beklenen });
  }
  return sonucYap('kaynak-zip', GECTI, `${o.yol} — ${beklenen} bayt`, { boyut: o.boyut });
}

/**
 * 4) DİSK — 1,3 GB paket + ara ürünler sığacak mı?
 * @param {{bosBayt:number|null, gerekenBayt:number, birim:string}} olgu
 */
function kontrolDisk(olgu) {
  const o = olgu || {};
  const gb = (n) => (n / (1024 ** 3)).toFixed(1);
  if (o.bosBayt == null) {
    return sonucYap('disk-yeri', KALDI, `boş alan ÖLÇÜLEMEDİ (${o.birim || '?'})`);
  }
  if (o.bosBayt < o.gerekenBayt) {
    return sonucYap('disk-yeri', KALDI,
      `boş ${gb(o.bosBayt)} GiB < gereken ${gb(o.gerekenBayt)} GiB — üretim ENOSPC ile düşer`,
      { bosBayt: o.bosBayt, gerekenBayt: o.gerekenBayt });
  }
  return sonucYap('disk-yeri', GECTI, `boş ${gb(o.bosBayt)} GiB (gereken ${gb(o.gerekenBayt)} GiB)`,
    { bosBayt: o.bosBayt, gerekenBayt: o.gerekenBayt });
}

/**
 * 5) windows-kasa ŞERİDİ — izleyici ayakta VE iş akıyor mu?
 * `serit:'bilinmiyor'` = guest eski izleyici; ayakta ama akış ÖLÇÜLEMİYOR → UYARI.
 * `serit:'tikali'` = süreç yaşıyor, iş akmıyor → KALDI ("online ama ölü").
 * @param {{durum:Object|null, hata:string|null}} olgu
 */
function kontrolKasaSeridi(olgu) {
  const o = olgu || {};
  if (!o.durum) {
    return sonucYap('windows-kasa', KALDI,
      `vm-kapi hazir okunamadı: ${o.hata || 'bilinmeyen sebep'} `
      + '(HATIRLATMA: `--makine windows-kasa` şart, makinesiz çağrı eski kalbi okur)');
  }
  const d = o.durum;
  if (d.durum !== 'ayakta') {
    return sonucYap('windows-kasa', KALDI,
      `izleyici "${d.durum}" — ${d.sebep || 'sebep bildirilmedi'}`, d);
  }
  if (d.serit === 'tikali') {
    return sonucYap('windows-kasa', KALDI,
      `izleyici ayakta ama ŞERİT TIKALI (${d.seritGorevi || 'görev bildirilmedi'}, `
      + `yaş ${d.seritYasSn} sn) — kalp atıyor, iş akmıyor`, d);
  }
  if (d.serit === 'bilinmiyor') {
    return sonucYap('windows-kasa', UYARI,
      `ayakta (yaş ${d.yasSn} sn) ama guest ESKİ izleyici: şerit akışı ölçülemiyor — `
      + 'kurulum adımında ilerleme körlüğü riski var', d);
  }
  return sonucYap('windows-kasa', GECTI, `ayakta, şerit "${d.serit}" (yaş ${d.yasSn} sn)`, d);
}

/**
 * 6) LOGO — istekteki logoId paketleyicide gerçekten kayıtlı mı?
 * @param {{logolar:Array|null, logoId:string, hata:string|null}} olgu
 */
function kontrolLogo(olgu) {
  const o = olgu || {};
  if (!Array.isArray(o.logolar)) {
    return sonucYap('logo', KALDI, `logo listesi okunamadı: ${o.hata || 'bilinmeyen sebep'}`);
  }
  const bulundu = o.logolar.some((l) => l && (l.id === o.logoId || l.logoId === o.logoId));
  if (!bulundu) {
    return sonucYap('logo', KALDI,
      `logoId ${o.logoId} kayıtlı değil (${o.logolar.length} logo var) — paket logosuz doğar`);
  }
  return sonucYap('logo', GECTI, `logoId ${o.logoId} kayıtlı`);
}

/**
 * 7) 7z — paket KAPISI NSIS gövdesini bununla açar; yoksa kapı maddeleri
 *    "ÖLÇÜLEMEDİ" döner, yani üretim doğrulanamaz.
 * @param {{yol:string|null}} olgu
 */
function kontrol7z(olgu) {
  const o = olgu || {};
  if (!o.yol) {
    return sonucYap('7z', KALDI,
      '7z/7za/7zz/7zr sistemde YOK — paket kapısı NSIS gövdesini açamaz, '
      + 'tüm içerik maddeleri ÖLÇÜLEMEDİ döner');
  }
  return sonucYap('7z', GECTI, o.yol);
}

/**
 * 8) TESLİM DİZİNİ — yazılabilir mi? (Üretim bittikten SONRA fark edilirse
 *    1,3 GB'lık çıktı elde kalır.)
 * @param {{yol:string, yazilabilir:boolean, sebep:string|null}} olgu
 */
function kontrolTeslimDizini(olgu) {
  const o = olgu || {};
  if (!o.yazilabilir) {
    return sonucYap('teslim-dizini', KALDI,
      `${o.yol} yazılabilir değil: ${o.sebep || 'sebep bildirilmedi'}`);
  }
  return sonucYap('teslim-dizini', GECTI, `${o.yol} yazılabilir`);
}

/**
 * Nihai karar. UYARI çıkış kodunu DEĞİŞTİRMEZ (bilinçli kabul edilen belirsizlik),
 * KALDI 1 döndürür.
 * @param {Array<{durum:string}>} sonuclar
 */
function karar(sonuclar) {
  const liste = Array.isArray(sonuclar) ? sonuclar : [];
  const kaldi = liste.filter((s) => s && s.durum === KALDI);
  const uyari = liste.filter((s) => s && s.durum === UYARI);
  const gecti = liste.filter((s) => s && s.durum === GECTI);
  return {
    cikisKodu: kaldi.length ? 1 : 0,
    kaldi: kaldi.length,
    uyari: uyari.length,
    gecti: gecti.length,
    uretimeBaslanabilir: kaldi.length === 0,
  };
}

// ===========================================================================
// 2. SÜRÜCÜ — olguları toplar (I/O), saf katmana verir.
// ===========================================================================

function httpJson(url, zamanAsimiMs = 8000) {
  return new Promise((coz) => {
    const istek = http.get(url, { timeout: zamanAsimiMs }, (cevap) => {
      let govde = '';
      cevap.on('data', (p) => { govde += p; });
      cevap.on('end', () => {
        if (cevap.statusCode !== 200) return coz({ veri: null, hata: `HTTP ${cevap.statusCode}` });
        try { coz({ veri: JSON.parse(govde), hata: null }); }
        catch (e) { coz({ veri: null, hata: `JSON çözülemedi: ${e.message}` }); }
      });
    });
    istek.on('timeout', () => { istek.destroy(); coz({ veri: null, hata: `zaman aşımı ${zamanAsimiMs} ms` }); });
    istek.on('error', (e) => coz({ veri: null, hata: e.message }));
  });
}

function damgalariTopla(kok, liste) {
  return liste.map((rel) => {
    try { return { yol: rel, mtimeMs: fs.statSync(path.join(kok, rel)).mtimeMs }; }
    catch { return { yol: rel, mtimeMs: null }; }
  }).filter((d) => d.mtimeMs !== null || fs.existsSync(path.join(kok, d.yol)));
}

function zipOlgusu(yol, beklenen) {
  try {
    const st = fs.statSync(yol);
    return { varMi: true, boyut: st.size, yol, beklenen };
  } catch {
    return { varMi: false, boyut: null, yol, beklenen };
  }
}

function diskOlgusu(birim, gerekenBayt) {
  try {
    const st = fs.statfsSync(birim);
    return { bosBayt: Number(st.bavail) * Number(st.bsize), gerekenBayt, birim };
  } catch (e) {
    return { bosBayt: null, gerekenBayt, birim: `${birim} (${e.message})` };
  }
}

function kasaOlgusu() {
  const r = spawnSync(process.execPath,
    [path.join(KOK, 'tools', 'windows', 'vm-kapi.js'), 'hazir', '--makine', 'windows-kasa'],
    { encoding: 'utf8', timeout: 30000, cwd: KOK });
  if (r.error) return { durum: null, hata: r.error.message };
  try { return { durum: JSON.parse(r.stdout), hata: null }; }
  catch { return { durum: null, hata: `çıktı çözülemedi: ${(r.stdout || r.stderr || '').slice(0, 200)}` }; }
}

function yedizOlgusu() {
  for (const ad of ['7z', '7za', '7zz', '7zr']) {
    const r = spawnSync('which', [ad], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim()) return { yol: r.stdout.trim() };
  }
  return { yol: null };
}

// ÖN KONTROL YAN ETKİ ÜRETMEZ: teslim klasörünü BURADA AÇMAZ (üretim adımı açar).
// Klasör varsa kendisi, yoksa ÜST dizini (Desktop) yazılabilirlik için ölçülür.
function teslimOlgusu(yol) {
  const hedef = fs.existsSync(yol) ? yol : path.dirname(yol);
  try {
    fs.accessSync(hedef, fs.constants.W_OK);
    return { yol: hedef, yazilabilir: true, sebep: null };
  } catch (e) {
    return { yol: hedef, yazilabilir: false, sebep: e.message };
  }
}

async function topla(secenek = {}) {
  const gerekenBayt = (secenek.diskGb || VARSAYILAN_DISK_GB) * (1024 ** 3);
  const saglikCevap = await httpJson(`${PAKETLEYICI}/api/health`);
  const logoCevap = await httpJson(`${PAKETLEYICI}/api/logos`);
  const logolar = Array.isArray(logoCevap.veri) ? logoCevap.veri
    : (logoCevap.veri && Array.isArray(logoCevap.veri.logos) ? logoCevap.veri.logos : null);

  return [
    kontrolPaketleyiciCanli({ saglik: saglikCevap.veri, hata: saglikCevap.hata }),
    kontrolSurecTazeligi({ saglik: saglikCevap.veri, damgalar: damgalariTopla(KOK, KRITIK_DOSYALAR) }),
    kontrolKaynakZip(zipOlgusu(KAYNAK_ZIP, KAYNAK_ZIP_BAYT)),
    kontrolDisk(diskOlgusu(KOK, gerekenBayt)),
    kontrolKasaSeridi(kasaOlgusu()),
    kontrolLogo({ logolar, logoId: LOGO_ID, hata: logoCevap.hata }),
    kontrol7z(yedizOlgusu()),
    kontrolTeslimDizini(teslimOlgusu(path.join(process.env.HOME || '', 'Desktop', 'SM4-Set-Windows'))),
  ];
}

function argumanCoz(argv) {
  const s = { json: false, diskGb: VARSAYILAN_DISK_GB };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--json') s.json = true;
    else if (argv[i] === '--disk-gb') s.diskGb = Number(argv[++i]) || VARSAYILAN_DISK_GB;
  }
  return s;
}

async function anaAkis(argv, yazici) {
  const yaz = yazici || ((m) => process.stdout.write(`${m}\n`));
  const s = argumanCoz(argv);
  const sonuclar = await topla(s);
  const k = karar(sonuclar);

  if (s.json) {
    yaz(JSON.stringify({ sonuclar, karar: k }, null, 2));
  } else {
    yaz('ÜRETİM ÖN KONTROLÜ — set güncelleme kanallı Windows exe');
    yaz('='.repeat(72));
    for (const r of sonuclar) {
      const im = r.durum === GECTI ? '✓' : (r.durum === UYARI ? '!' : '✗');
      yaz(`${im} [${r.durum}] ${r.ad}`);
      yaz(`    ${r.sebep}`);
    }
    yaz('='.repeat(72));
    yaz(`GEÇTİ ${k.gecti} · UYARI ${k.uyari} · KALDI ${k.kaldi}`);
    yaz(k.uretimeBaslanabilir
      ? 'SONUÇ: üretime başlanabilir.'
      : 'SONUÇ: ÜRETİME BAŞLAMA — yukarıdaki KALDI maddeleri giderilmeli.');
  }
  return k.cikisKodu;
}

module.exports = {
  GECTI, KALDI, UYARI,
  KAYNAK_ZIP, KAYNAK_ZIP_BAYT, LOGO_ID, KRITIK_DOSYALAR, VARSAYILAN_DISK_GB,
  sonucYap,
  kontrolPaketleyiciCanli,
  kontrolSurecTazeligi,
  kontrolKaynakZip,
  kontrolDisk,
  kontrolKasaSeridi,
  kontrolLogo,
  kontrol7z,
  kontrolTeslimDizini,
  karar,
  argumanCoz,
  topla,
  anaAkis,
};

if (require.main === module) {
  anaAkis(process.argv.slice(2)).then((kod) => { process.exitCode = kod; });
}

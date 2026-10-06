'use strict';

/**
 * DİSK KAPISI → ÖNCE YER AÇ (Nadir 06.10): "pardus'ta asla disk doldu diye işlemlerin durması kabul
 * edilemez … bu kural windows için de geçerli."
 *
 * Runner'ın disk kapıları (pardus erken disk kapısı, windows üretim kapısı) kapanmadan ÖNCE bu
 * yardımcıyı çağırır: platforma göre temizlik bekçisini koşturur (en eski BİZİM dosyamızdan başlar),
 * sonucu loglar. Kapı ancak temizlikten sonra hâlâ darsa kapanır.
 *
 *   linux (ProBook)  → bash tools/probook/disk-temizlik.sh --hedef-gb N
 *                      (repo kopyası yoksa ~/empp-serit/araclar/disk-temizlik.sh)
 *   win32 (kasa)     → node tools/windows/kasa-ajan/disk-temizlik.js --hedef-gb N
 *                      (repo kopyası yoksa C:\empp-ajan\disk-temizlik.js)
 *   darwin / diğer   → HİÇBİR ŞEY (Mac'te silme YASAK)
 *
 * AÇIK RIZA BAYRAĞI: `EMPP_DISK_TEMIZLIK=1` yalnız ProBook (serit-ortam.sh) ve kasa (ortam.ps1)
 * ortamında açıktır. srv21 de linux'tur ve orada silme YASAKTIR — bayrak olmadan hiçbir şey koşmaz.
 * Bekleme: son koşu "adaylar bitti, hâlâ dar" dediyse BEKLEME_MS (15 dk) içinde yeniden koşmaz (zorla hariç).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..');
const BEKLEME_MS = 15 * 60 * 1000;
const ZAMAN_ASIMI_MS = 30 * 60 * 1000;

let _son = null; // { zaman, sonuc }

/** SONUC satırını çözer. Saf. */
function sonucCoz(cikti) {
  const satir = String(cikti || '').split(/\r?\n/).reverse().find((s) => s.startsWith('SONUC '));
  if (!satir) return null;
  const o = {};
  for (const p of satir.slice(6).trim().split(/\s+/)) {
    const i = p.indexOf('=');
    if (i <= 0) continue;
    const v = p.slice(i + 1);
    o[p.slice(0, i)] = /^\d+$/.test(v) ? Number(v) : v;
  }
  return Object.keys(o).length ? o : null;
}

/**
 * Hangi komut koşar? Saf (dosya varlığı `varMi` ile sorulur).
 * @returns {{komut:string, arg:string[]}|{atla:string}}
 */
function komutSec({ platform = process.platform, env = process.env, hedefGb, koru = [], home = os.homedir(),
  varMi = fs.existsSync, node = process.execPath } = {}) {
  if (platform === 'darwin') return { atla: 'mac: silme yasak' };
  if (env.EMPP_DISK_TEMIZLIK !== '1') return { atla: 'EMPP_DISK_TEMIZLIK kapali (yalniz ProBook/kasa acar)' };
  // Runner kapısı YALNIZ gereken GB'yi ister: --hedef-gb varsayılan rahatlık hedefinin YERİNE geçer (iki betikte
  // aynı), sert eşik de aynı değer (K3 = kaynak arşivi yalnız bunun altında açılır). Çalışan işin yolları --koru.
  const gb = Number.isFinite(hedefGb) && hedefGb > 0 ? String(Math.ceil(hedefGb)) : null;
  const hedef = gb ? ['--hedef-gb', gb, '--sert-gb', gb] : [];
  const koruArg = (Array.isArray(koru) ? koru : []).filter(Boolean).flatMap((k) => ['--koru', String(k)]);
  if (platform === 'linux') {
    const adaylar = [path.join(REPO, 'tools', 'probook', 'disk-temizlik.sh'),
      path.join(home, 'empp-serit', 'araclar', 'disk-temizlik.sh')];
    const b = adaylar.find((a) => varMi(a));
    return b ? { komut: 'bash', arg: [b, ...hedef, ...(gb ? ['--hedef-yuzde', '0'] : []), ...koruArg] } : { atla: 'disk-temizlik.sh bulunamadi' };
  }
  if (platform === 'win32') {
    const adaylar = [path.join(REPO, 'tools', 'windows', 'kasa-ajan', 'disk-temizlik.js'),
      path.join(env.EMPP_AJAN_KOK || 'C:\\empp-ajan', 'disk-temizlik.js')];
    const b = adaylar.find((a) => varMi(a));
    return b ? { komut: node, arg: [b, ...hedef, ...koruArg] } : { atla: 'disk-temizlik.js bulunamadi' };
  }
  return { atla: `platform ${platform} desteklenmiyor` };
}

function varsayilanKostur(komut, arg) {
  return new Promise((resolve) => {
    execFile(komut, arg, { timeout: ZAMAN_ASIMI_MS, maxBuffer: 32 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => resolve({ kod: err ? (typeof err.code === 'number' ? err.code : -1) : 0,
        cikti: String(stdout || ''), hata: String(stderr || '') }));
  });
}

/**
 * Yer aç. FIRLATMAZ.
 * @param {object} p
 * @param {number} [p.gerekliGb] kapının istediği boş GB (betiğin hedefi en az bu olur)
 * @param {(s:string)=>void} [p.log]
 * @param {(s:string)=>void} [p.warn] tarama bozuksa (SONUC tarama=bozuk) uyarı buraya; yoksa log
 * @param {string[]} [p.koru] çalışan işin yolları (arşiv dizini, iş dizini) — betiğe --koru ile geçer
 * @param {boolean} [p.zorla] bekleme süresini yok say
 * @returns {Promise<{calisti:boolean, atla?:string, kod?:number, sonuc?:object|null}>}
 */
async function yerAc({ gerekliGb, koru = [], log = () => {}, warn = null, zorla = false, platform, env, kostur = varsayilanKostur,
  simdi = Date.now(), varMi } = {}) {
  const sec = komutSec({ platform, env, hedefGb: gerekliGb, koru, varMi });
  if (sec.atla) return { calisti: false, atla: sec.atla };
  if (!zorla && _son && simdi - _son.zaman < BEKLEME_MS) return { ..._son.sonuc, tekrar: true };
  log(`disk temizlik başlıyor (hedef >= ${gerekliGb || '-'} GB): ${sec.komut} ${sec.arg.join(' ')}`);
  let r;
  try { r = await kostur(sec.komut, sec.arg); } catch (e) { r = { kod: -1, cikti: '', hata: e.message }; }
  const sonuc = { calisti: true, kod: r.kod, sonuc: sonucCoz(r.cikti) };
  const silinenler = String(r.cikti).split(/\r?\n/).filter((s) => s.startsWith('SILINDI ')).length;
  log(`disk temizlik bitti: rc=${r.kod} silinen kalem=${silinenler} `
    + (sonuc.sonuc ? `bos=${sonuc.sonuc.bos_gb} GB hedef=${sonuc.sonuc.hedef}` : `(SONUC yok) ${String(r.hata).slice(-300)}`));
  // Bekleme YALNIZ "adaylar bitti, hâlâ dar" (rc 3 + SONUC) sonucunu önbelleğe alır: 15 dk içinde yeniden
  // koşmak boşunadır. Hata (SONUC yok / başka rc) ya da hedefe ulaşılmış koşu önbelleğe ALINMAZ.
  // Süreç taraması bozuksa betik fail-closed davranır (hiçbir şey silinmez) — bu SESSİZ kalmamalı (Ö-B).
  if (sonuc.sonuc && sonuc.sonuc.tarama === 'bozuk') {
    (warn || log)('disk temizlik: süreç taraması BOZUK — fail-closed, hiçbir aday silinmedi (ProBook: sudo -n bash denetle)');
  }
  _son = r.kod === 3 && sonuc.sonuc && sonuc.sonuc.hedef === 'dar' ? { zaman: simdi, sonuc } : null;
  return sonuc;
}

/** Testler için. */
function _sifirla() { _son = null; }

module.exports = { yerAc, komutSec, sonucCoz, BEKLEME_MS, _sifirla };

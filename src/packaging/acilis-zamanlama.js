'use strict';

/**
 * AÇILIŞ ZAMANLAMA + İMPARK DEVRALMA ENJEKSİYONU (Windows paketleme sözleşmesi,
 * madde 6 "boş ekran" ölçümü + G6).
 *
 * Paketin ana süreç dosyasının (package.json `main`, yoksa main.js) EN BAŞINA iki
 * korumalı satır ekler ve çalışma anı modüllerini yanına kopyalar:
 *   • `empp-acilis-zamanlama.js`  ← src/runtime/acilis-zamanlama.js
 *   • `empp-impark-kaldir.js`     ← src/runtime/impark-kaldir.js (yalnız Windows'ta iş yapar)
 *
 * DİSİPLİN (guncelleyici-enjekte.js ile aynı):
 *   • ATOMİK — dosya bir Electron ana süreci değilse (require('electron') yoksa)
 *     ne yama ne modül konur.
 *   • İDEMPOTENT — işaret varsa dokunulmaz.
 *   • AÇILIŞI DÜŞÜRMEZ — her çağrı try/catch; modül yoksa uygulama normal açılır.
 *   • EN BAŞTA — "süreç başladı → ana betik yüklendi" farkı yayıncı kodunun
 *     require süresini de ölçsün diye.
 *
 * Kapılar: `EMPP_ACILIS_ZAMANLAMA=0` tümünü, `EMPP_IMPARK_KALDIR=0` yalnız İmpark
 * devralmayı kapatır (ikisi de varsayılan AÇIK). Çalışma anında da
 * `EMPP_IMPARK_KALDIR=0` ortam değişkeni devralmayı durdurur.
 */

const path = require('path');
const fs = require('fs-extra');

const ISARET = 'EMPP_ACILIS_ZAMANLAMA';
const IMPARK_ISARET = 'EMPP_IMPARK_KALDIR';
const ZAMANLAMA_MODUL = 'empp-acilis-zamanlama.js';
const IMPARK_MODUL = 'empp-impark-kaldir.js';
const KAYNAK_ZAMANLAMA = path.join(__dirname, '..', 'runtime', 'acilis-zamanlama.js');
const KAYNAK_IMPARK = path.join(__dirname, '..', 'runtime', 'impark-kaldir.js');
const ELECTRON_RE = /require\(\s*['"]electron['"]\s*\)/;

function kapiAcik(env, ad) {
  return String(env[ad] == null ? '' : env[ad]) !== '0';
}
function acikMi(env = process.env) { return kapiAcik(env, ISARET); }
function imparkAcikMi(env = process.env) { return kapiAcik(env, IMPARK_ISARET); }

/** Eklenecek blok. Saf. */
function blokUret({ impark = true } = {}) {
  const satirlar = [
    `/* ${ISARET}: açılış zamanlama günlüğü (userData/acilis-zamanlama.log) — ölçüm, uygulamayı etkilemez */`,
    `var __emppZaman = null; try { __emppZaman = require('./${ZAMANLAMA_MODUL}'); __emppZaman.baslat({ kok: __dirname }); } catch (e) {}`,
  ];
  if (impark) {
    satirlar.push(
      `/* ${IMPARK_ISARET}: aynı kitabın İmpark kurulumunu devral + kaldır (sözleşme G6, yalnız Windows) */`,
      `try { require('./${IMPARK_MODUL}').baslat({ kok: __dirname, yaz: function (e, a) { try { __emppZaman && __emppZaman.yaz(e, a); } catch (x) {} } }); } catch (e) {}`,
    );
  }
  return `${satirlar.join('\n')}\n`;
}

/** Saf dönüşüm. @returns {{icerik:string, uygulandi:boolean, sebep:string}} */
function icerigeEnjekteEt(icerik, secenek = {}) {
  const giris = String(icerik == null ? '' : icerik);
  if (giris.includes(ISARET)) return { icerik: giris, uygulandi: false, sebep: 'zaten-yamali' };
  if (!ELECTRON_RE.test(giris)) return { icerik: giris, uygulandi: false, sebep: 'electron-ana-sureci-degil' };
  // 'use strict' ya da shebang varsa onların ALTINA; yoksa en başa.
  const m = giris.match(/^(#![^\n]*\n)?(\s*(['"])use strict\3;?[^\n]*\n)?/);
  const bas = m ? m[0] : '';
  return { icerik: bas + blokUret(secenek) + giris.slice(bas.length), uygulandi: true, sebep: 'enjekte-edildi' };
}

async function anaDosyaBul(paketKoku) {
  try {
    const pj = await fs.readJson(path.join(paketKoku, 'package.json'));
    if (pj && typeof pj.main === 'string' && pj.main) return path.join(paketKoku, pj.main);
  } catch (e) { /* yok */ }
  return path.join(paketKoku, 'main.js');
}

/**
 * Pakete uygular. Sıra: önce modüller kopyalanır, SONRA yama yazılır (yama tutup modül
 * eksik kalırsa bile blok try/catch'li — ama yetim yama bırakmamak için kopya hatasında
 * yama yazılmaz).
 * @returns {Promise<{dosya:string, uygulandi:boolean, sebep:string, impark:boolean}>}
 */
async function paketeUygula(paketKoku, { log = () => {}, env = process.env } = {}) {
  const dosya = await anaDosyaBul(paketKoku);
  const goreli = path.relative(paketKoku, dosya);
  if (!(await fs.pathExists(dosya))) {
    log(`   açılış zamanlama: ${goreli} yok — atlandı`);
    return { dosya: goreli, uygulandi: false, sebep: 'ana-dosya-yok', impark: false };
  }
  const impark = imparkAcikMi(env);
  const r = icerigeEnjekteEt(await fs.readFile(dosya, 'utf8'), { impark });
  if (r.uygulandi) {
    const hedefDizin = path.dirname(dosya);
    try {
      await fs.copy(KAYNAK_ZAMANLAMA, path.join(hedefDizin, ZAMANLAMA_MODUL), { overwrite: true });
      if (impark) await fs.copy(KAYNAK_IMPARK, path.join(hedefDizin, IMPARK_MODUL), { overwrite: true });
    } catch (e) {
      log(`   açılış zamanlama: modül kopyalanamadı (${e.message}) — yama YAZILMADI`);
      return { dosya: goreli, uygulandi: false, sebep: 'modul-kopyalanamadi', impark: false };
    }
    await fs.writeFile(dosya, r.icerik, 'utf8');
  }
  log(`   açılış zamanlama: ${goreli} — ${r.sebep}${r.uygulandi ? ` (+${ZAMANLAMA_MODUL}${impark ? ` +${IMPARK_MODUL}` : ''})` : ''}`);
  return { dosya: goreli, uygulandi: r.uygulandi, sebep: r.sebep, impark: r.uygulandi && impark };
}

module.exports = {
  ISARET,
  IMPARK_ISARET,
  ZAMANLAMA_MODUL,
  IMPARK_MODUL,
  KAYNAK_ZAMANLAMA,
  KAYNAK_IMPARK,
  acikMi,
  imparkAcikMi,
  blokUret,
  icerigeEnjekteEt,
  anaDosyaBul,
  paketeUygula,
};

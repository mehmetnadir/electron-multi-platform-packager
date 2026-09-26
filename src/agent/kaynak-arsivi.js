'use strict';

/**
 * Kaynak arşivi — kuyruğun İmpark exe'si yerine kullandığı onaylı build zip (2026-09-26).
 *
 * Nadir 26.09: "yds'nin yeni arayüzü ile üretilmesini bekliyorum. Neden eski build
 * kullanılıyor?" → Üretim Masası'nın 25.09 yeni arayüzlü build zip'leri dört platformun
 * kaynağıdır (kitap-kaynak-sozlesmesi.md); pipeline'ın İmpark exe'si yalnız geri dönüş.
 * Runner bu arşivde kitabın kaydı varsa exe indirmez, yayıncı güncellemesi uygulamaz
 * (arşiv zip'i son hâldir), srv21 şeridinin hazır pardus paketini devralmaz (o paket
 * İmpark kaynağından üretildi).
 *
 * Düzen: `<kok>/<bookId>/kaynak.json` + zip dosyası.
 *   { "dosya": "build.zip", "md5": "<32 hex>", "boyut": <bayt>, "etiket": "<kısa ad>" }
 * Kök: `EMPP_KAYNAK_ARSIVI` ya da `~/.empp-agent/kaynak-arsivi`.
 *
 * Kayıt var ama zip eksik/boyut ya da md5 tutmuyorsa HATA fırlatılır — sessizce İmpark
 * exe'sine düşmek eski arayüzü yayınlamak demektir (bugünkü arızanın kendisi). md5 her
 * (boyut, mtime) için bir kez hesaplanır, sonucu `.md5-dogrulandi` damgasında durur.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

function arsivKoku(env = process.env) {
  return env.EMPP_KAYNAK_ARSIVI || path.join(os.homedir(), '.empp-agent', 'kaynak-arsivi');
}

function md5Hesapla(dosya) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('md5');
    fs.createReadStream(dosya)
      .on('error', reject)
      .on('data', (p) => h.update(p))
      .on('end', () => resolve(h.digest('hex')));
  });
}

/**
 * @param {number|string} bookId
 * @param {{ kok?: string }} [secenekler]
 * @returns {Promise<null | { zip: string, md5: string, boyut: number, etiket: string, srcVersion: string }>}
 *   Kayıt yoksa null; kayıt bozuksa hata.
 */
async function arsivKaynagi(bookId, { kok = arsivKoku() } = {}) {
  const dizin = path.join(kok, String(bookId));
  const kayitYolu = path.join(dizin, 'kaynak.json');
  let ham;
  try { ham = await fsp.readFile(kayitYolu, 'utf8'); } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
  let kayit;
  try { kayit = JSON.parse(ham); } catch (e) {
    throw new Error(`kaynak arşivi: ${kayitYolu} okunamadı (JSON): ${e.message}`);
  }
  const md5 = String(kayit.md5 || '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(md5)) throw new Error(`kaynak arşivi: ${kayitYolu} md5 alanı geçersiz`);
  if (!kayit.dosya || path.basename(kayit.dosya) !== kayit.dosya) {
    throw new Error(`kaynak arşivi: ${kayitYolu} dosya alanı geçersiz (yalnız dosya adı)`);
  }
  const zip = path.join(dizin, kayit.dosya);
  let st;
  try { st = await fsp.stat(zip); } catch (e) {
    throw new Error(`kaynak arşivi: ${bookId} kaydı var ama zip yok (${zip}) — İmpark exe'sine düşülmedi`);
  }
  if (Number(kayit.boyut) !== st.size) {
    throw new Error(`kaynak arşivi: ${bookId} boyut tutmuyor (${st.size} != ${kayit.boyut})`);
  }
  const damga = path.join(dizin, '.md5-dogrulandi');
  const damgaDegeri = `${st.size}:${Math.floor(st.mtimeMs)}:${md5}`;
  let dogrulandi = false;
  try { dogrulandi = (await fsp.readFile(damga, 'utf8')).trim() === damgaDegeri; } catch (_) { /* damga yok */ }
  if (!dogrulandi) {
    const gercek = await md5Hesapla(zip);
    if (gercek !== md5) throw new Error(`kaynak arşivi: ${bookId} md5 tutmuyor (${gercek} != ${md5})`);
    try { await fsp.writeFile(damga, damgaDegeri + '\n'); } catch (_) { /* damga yazılamazsa her iş yeniden hesaplar */ }
  }
  return { zip, md5, boyut: st.size, etiket: String(kayit.etiket || ''), srcVersion: `arsiv-${md5.slice(0, 12)}` };
}

module.exports = { arsivKaynagi, arsivKoku, md5Hesapla };

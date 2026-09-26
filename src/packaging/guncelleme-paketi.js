'use strict';

/**
 * SET GÜNCELLEME PAKETİ — sunucu tarafı sözleşmenin parça 1 (paketleyici).
 *
 * Kaynak: `.claude/docs/kitap-guncelleme-sozlesmesi.md` §"Sunucu tarafı — TASARIM
 * (2026-09-23)". Üç parçalı akışın 1.'i budur: `packagingService`, `setKimligi`
 * verilen işte, TÜM yamalardan sonra (empp-set.json ile aynı anda) bu modülü
 * çağırır; `src/agent/runner.js` (parça 3, BAŞKA AJANIN İŞİ — burada değiştirilmez)
 * çıktıyı indirip R2'ye yükler.
 *
 * KOPYA MANTIK YOK: kabuk tarama + manifest/sürüm üretimi tamamen
 * `scripts/guncelleme-manifesti-uret.js`'in dışa açık `main(argv, {gunluk})`
 * çekirdeğine devredilir (o dosyanın CLI davranışı ve testleri BOZULMAZ — burada
 * yalnız programatik çağrılır, argv diziden kurulur).
 *
 * ÇIKTI: `<cikti>/set/<setKimligi>/{surum.json, manifest.json, dosya/…}` +
 * aynı dizinde `guncelleme.tar.gz` (üreticinin çıktısının tek arşivi — runner
 * bunu indirip açar). Arşivleme Node stdlib DIŞINDA bağımlılık EKLEMEDEN sistem
 * `tar` ile yapılır (`child_process.execFile`).
 *
 * KAPI: `EMPP_SET_GUNCELLEME` — `./guncelleyici-enjekte.js`'teki `acikMi` ile
 * AYNI kapı (buradan yeniden ihraç edilir; ikinci bir kopya YAZILMAZ).
 *
 * `setKimligi` yoksa NO-OP — ama SESSİZ değil: `log` ile "güncelleme paketi
 * atlandı: setKimligi yok" satırı yazılır (görünürlük kuralı, sözleşme §Kimlik).
 */

const path = require('path');
const fsp = require('fs/promises');
const { execFile } = require('child_process');

const uretici = require('../../scripts/guncelleme-manifesti-uret');
const { acikMi } = require('./guncelleyici-enjekte');

/** `execFile`'ı Promise'e çevirir — ek bağımlılık yok. */
function execFileP(komut, argumanlar, secenekler) {
  return new Promise((resolve, reject) => {
    execFile(komut, argumanlar, secenekler, (hata, stdout, stderr) => {
      if (hata) {
        hata.stdout = stdout;
        hata.stderr = stderr;
        reject(hata);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

/**
 * `<ciktiDizini>/set` klasörünü `<ciktiDizini>/guncelleme.tar.gz` olarak arşivler.
 * Arşiv kökü `set/<setKimligi>/...` olur (tüketici/runner'ın beklediği yapı —
 * sözleşme §Sunucu tarafı adım 3: "önce dosya/*, sonra manifest.json, en son
 * surum.json" sırasıyla yüklenecek dosyalar buradan çıkar).
 * @returns {Promise<number>} tar.gz boyutu (bayt)
 */
async function tarUret(ciktiDizini, tarYolu) {
  await execFileP('tar', ['-czf', tarYolu, '-C', ciktiDizini, 'set']);
  const { size } = await fsp.stat(tarYolu);
  return size;
}

/**
 * SET güncelleme paketini üretir.
 *
 * @param {string} workingPath paketlenen ağacın kökü (electron-builder çağrılmadan
 *   önceki hâli — tüm yamalardan sonra)
 * @param {{setKimligi?:*, jobId?:string, cikti?:string, log?:(s:string)=>void,
 *          kitaplarJson?:string|null, imzaAnahtari?:string|null, env?:object}} secenekler
 *   `cikti` verilmezse `temp/<jobId>/windows/guncelleme` varsayılır (sözleşmedeki
 *   sabit yol). `kitaplarJson` üreticinin `--kitaplar` argümanına birebir geçer.
 *   `imzaAnahtari` (sözleşme G4): ed25519 ÖZEL anahtar dosyasının YOLU (PKCS8 PEM);
 *   verilmezse `EMPP_GUNCELLEME_IMZA_ANAHTARI` ortam değişkeni. İkisi de yoksa manifest
 *   İMZASIZ üretilir ve güncelleyici onu REDDEDER — dönüşte `imzali:false` görünür.
 * @returns {Promise<{atlandi:true, sebep:string} | {surum:string,
 *   kabukDosyaSayisi:number, tarYolu:string, boyut:number}>}
 */
async function paketeUret(workingPath, secenekler = {}) {
  const {
    setKimligi, jobId, cikti, log = () => {}, kitaplarJson = null,
    imzaAnahtari = null, env = process.env,
  } = secenekler;

  if (setKimligi === undefined || setKimligi === null || setKimligi === '') {
    log('güncelleme paketi atlandı: setKimligi yok');
    return { atlandi: true, sebep: 'setKimligi yok' };
  }

  const ciktiDizini = cikti || path.join('temp', String(jobId), 'windows', 'guncelleme');
  await fsp.mkdir(ciktiDizini, { recursive: true });

  const argv = [
    '--set-koku', workingPath,
    '--set-kimligi', String(setKimligi),
    '--cikti', ciktiDizini,
  ];
  if (kitaplarJson) argv.push('--kitaplar', kitaplarJson);
  const anahtarYolu = imzaAnahtari || (env && env.EMPP_GUNCELLEME_IMZA_ANAHTARI) || null;
  if (anahtarYolu) argv.push('--imza-anahtari', String(anahtarYolu));

  const rapor = await uretici.main(argv, { gunluk: log });

  const tarYolu = path.join(ciktiDizini, 'guncelleme.tar.gz');
  const boyut = await tarUret(ciktiDizini, tarYolu);

  log(`güncelleme paketi üretildi: set ${rapor.setKimligi}, ${rapor.kabukDosyaSayisi} `
    + `kabuk dosyası, sürüm ${String(rapor.surum).slice(0, 12)}…, tar ${boyut} bayt, `
    + `manifest ${rapor.imzali ? 'İMZALI' : 'İMZASIZ (güncelleyici reddeder)'}`);

  return {
    surum: rapor.surum,
    kabukDosyaSayisi: rapor.kabukDosyaSayisi,
    tarYolu,
    boyut,
    imzali: rapor.imzali === true,
  };
}

module.exports = { acikMi, paketeUret, tarUret };

'use strict';
/**
 * 43e23 MOTOR KANONİĞİ — iki Pardus şeridinin (Mac docker `pardus-packager-build.sh`, ProBook
 * `pardus-yerel-build.sh`) ORTAK denetçisi (2026-09-26, kanıt E3 · karar D-1).
 *
 * NEDEN: kanonik `~/.empp-agent/motor/kanonik.json` makine-yerel. Docker'a bağlanmadığında ve
 * ProBook'ta yokken paketleyici `motorDegistir` "bilinmiyor" deyip motora dokunmuyordu; bu satır
 * yalnız konteynerin packager.log'unda kalıyordu, ajan log'unda görünmüyordu. D-1: önce UYARI
 * (RED değil) — derleme durmaz, ama kanonik yoksa ya da paket motoru kanonik değilse ajan
 * log'unda açık `UYARI motor:` satırı olur.
 *
 * Kullanım:
 *   motor-kanonik.js on  <kanonik.json>   derlemeden önce: rc 0 = doğrulandı, rc 3 = yok/bozuk
 *   motor-kanonik.js son <packager.log>   derlemeden sonra: `EMPP_MOTOR` damga satırını aktarır
 * Doğrulama tek kaynaktan: `src/packaging/motor-surumu.js`
 * (`kanonikOzetEsz`, `damgaSatiriAyristir`).
 */
const fs = require('fs');
const path = require('path');
const M = require(path.join(__dirname, '..', '..', 'src', 'packaging', 'motor-surumu.js'));

/** Derleme öncesi denetim (diski okur). Dönüş: {rc, sha12, satirlar}. */
function onDenetim(kanonikYol) {
  const k = M.kanonikOzetEsz(kanonikYol);
  if (k) {
    const satir = `motor: kanonik ${k.sha12} ${k.surum} (${kanonikYol})`;
    return { rc: 0, sha12: k.sha12, satirlar: [satir] };
  }
  return {
    rc: 3,
    sha12: null,
    satirlar: [`UYARI motor: kanonik yok ya da doğrulanamadı (${kanonikYol}) — paketteki 43e23 `
      + 'motoru DEĞİŞMEYECEK (motorSurumu.durum=bilinmiyor)'],
  };
}

/** Derleme sonrası: packager.log metninden damgayı okur, ajan log'u satırları üretir. SAF. */
function sonDenetim(logMetni) {
  const d = M.damgaSatiriAyristir(logMetni);
  if (!d) {
    const satir = 'UYARI motor: paketleyici EMPP_MOTOR damgası basmadı — motor ölçülemedi';
    return { durum: null, satirlar: [satir] };
  }
  const sha = d.sha12 || '-';
  const kan = d.kanonik || 'YOK';
  const degisen = d.degisen !== undefined ? ` degisen=${d.degisen}` : '';
  const satirlar = [`motor: paket durum=${d.durum} sha12=${sha} kanonik=${kan}${degisen}`];
  if (d.durum !== 'guncel') {
    satirlar.push(`UYARI motor: paket motoru kanonik DEĞİL (durum=${d.durum}, sha12=${sha}, `
      + `kanonik=${kan})`);
  }
  return { durum: d.durum, satirlar };
}

function main(argv = process.argv.slice(2)) {
  const [komut, yol] = argv;
  if (komut === 'on' && yol) {
    const r = onDenetim(yol);
    process.stdout.write(`${r.satirlar.join('\n')}\n`);
    return r.rc;
  }
  if (komut === 'son' && yol) {
    let metin = '';
    try { metin = fs.readFileSync(yol, 'utf8'); } catch { metin = ''; }
    process.stdout.write(`${sonDenetim(metin).satirlar.join('\n')}\n`);
    return 0;
  }
  process.stderr.write('kullanim: motor-kanonik.js on <kanonik.json> | son <packager.log>\n');
  return 2;
}

if (require.main === module) process.exitCode = main();

module.exports = { onDenetim, sonDenetim, main };

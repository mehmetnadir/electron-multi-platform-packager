'use strict';
/**
 * OKUYUCU KABUĞU KANONİĞİ — iki Pardus şeridinin ortak denetçisi (2026-10-04; `motor-kanonik.js`
 * ile aynı desen). ProBook'ta kabuk kanoniği hiç yoktu, log'da tek "Okuyucu kabuğu" satırı yoktu.
 *
 * Kullanım:
 *   kabuk-kanonik.js on  <kanonik.json>   derlemeden önce: rc 0 = doğrulandı, rc 3 = yok/bozuk
 *   kabuk-kanonik.js son <packager.log>   derlemeden sonra: paketleyicinin "Okuyucu kabuğu" satırı
 * Doğrulama tek kaynaktan: `src/packaging/okuyucu-kabugu.js` (`kanonikKabukYukle`; göreli/taşınmış
 * dizin çözümü dahil).
 */
const fs = require('fs');
const path = require('path');
const K = require(path.join(__dirname, '..', '..', 'src', 'packaging', 'okuyucu-kabugu.js'));

async function onDenetim(kanonikYol) {
  const k = await K.kanonikKabukYukle(kanonikYol);
  if (k) return { rc: 0, satirlar: [`kabuk: kanonik ${k.surum} (${kanonikYol})`] };
  return {
    rc: 3,
    satirlar: [`UYARI kabuk: kanonik yok ya da doğrulanamadı (${kanonikYol}) — okuyucu kabuğu `
      + 'DEĞİŞMEYECEK (eski formatla paket üretilmez)'],
  };
}

function sonDenetim(logMetni) {
  const satir = String(logMetni || '').split(/\r?\n/).filter((l) => /Okuyucu kabuğu:/.test(l)).pop();
  if (!satir) {
    return { satirlar: ['UYARI kabuk: paketleyici "Okuyucu kabuğu" satırı basmadı — kabuk ölçülemedi'] };
  }
  const govde = satir.replace(/^.*?Okuyucu kabuğu:\s*/, '');
  const satirlar = [`kabuk: paket ${govde}`];
  if (!/^guncel/.test(govde)) satirlar.push(`UYARI kabuk: paket kabuğu kanonik DEĞİL (${govde})`);
  return { satirlar };
}

async function main(argv = process.argv.slice(2)) {
  const [komut, yol] = argv;
  if (komut === 'on' && yol) {
    const r = await onDenetim(yol);
    process.stdout.write(`${r.satirlar.join('\n')}\n`);
    return r.rc;
  }
  if (komut === 'son' && yol) {
    let metin = '';
    try { metin = fs.readFileSync(yol, 'utf8'); } catch { metin = ''; }
    process.stdout.write(`${sonDenetim(metin).satirlar.join('\n')}\n`);
    return 0;
  }
  process.stderr.write('kullanim: kabuk-kanonik.js on <kanonik.json> | son <packager.log>\n');
  return 2;
}

if (require.main === module) main().then((rc) => { process.exitCode = rc; });

module.exports = { onDenetim, sonDenetim, main };

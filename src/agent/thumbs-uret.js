const fsp = require('fs/promises');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

async function thumbsUret(hedef, log = console.warn) {
  const pagesDir = path.join(hedef, 'pages');
  const thumbsDir = path.join(hedef, 'thumbs');

  try {
    const pagesStat = await fsp.stat(pagesDir);
    if (!pagesStat.isDirectory()) return;
  } catch (e) {
    return; // pages yok
  }

  const sayfalar = await fsp.readdir(pagesDir);
  const sayfaDosyalari = sayfalar.filter(s => !s.startsWith('.'));
  if (sayfaDosyalari.length === 0) return;

  const sifreliVar = sayfaDosyalari.some(s => s.toLowerCase().endsWith('.mod1'));
  
  if (sifreliVar) {
    log('UYARI: Şifreli (mod1) sayfalar var. Çözücü yok. Yalnız ilk sayfa kopyalanacak.');
    // İlk sayfa kopyalama davranışı `index-ureteci.js` içinde zaten var,
    // o yüzden burada sadece dönebiliriz. Ya da biz yapabiliriz.
    // Biz yapalım:
    await fsp.mkdir(thumbsDir, { recursive: true });
    let thumbVar = false;
    try {
      const ts = await fsp.readdir(thumbsDir);
      if (ts.includes('1.jpg')) thumbVar = true;
    } catch(e) {}
    if (!thumbVar) {
      const ilk = sayfaDosyalari.find(s => /^1\./.test(s));
      if (ilk) {
        await fsp.copyFile(path.join(pagesDir, ilk), path.join(thumbsDir, '1.jpg'));
      }
    }
    return;
  }

  if (sayfaDosyalari.length > 2000) {
    log(`UYARI: 2000'den fazla sayfa var (${sayfaDosyalari.length}). Hepsine thumb üretilecek.`);
  }

  await fsp.mkdir(thumbsDir, { recursive: true });
  
  let varOlanThumbs = new Set();
  try {
    const ts = await fsp.readdir(thumbsDir);
    for (const t of ts) varOlanThumbs.add(t);
  } catch (e) {}

  let sipsVarMi = false;
  try {
    cp.execSync('which sips', { stdio: 'ignore' });
    sipsVarMi = true;
  } catch (e) {}

  for (const sayfa of sayfaDosyalari) {
    const m = sayfa.match(/^(\d+)\./);
    if (!m) continue;
    const n = m[1];
    const thumbAd = `${n}.jpg`;
    if (varOlanThumbs.has(thumbAd)) continue;

    const girdi = path.join(pagesDir, sayfa);
    const cikti = path.join(thumbsDir, thumbAd);

    if (process.platform === 'darwin' && sipsVarMi) {
      try {
        cp.execSync(`sips -Z 180 -s format jpeg "${girdi}" --out "${cikti}"`, { stdio: 'ignore' });
      } catch (e) {
        log(`UYARI: sips hatası (${sayfa}), kopyalanıyor.`);
        await fsp.copyFile(girdi, cikti);
      }
    } else {
      const ext = path.extname(sayfa).toLowerCase();
      if (ext !== '.jpg' && ext !== '.jpeg') {
        log(`UYARI: sips yok ve ${sayfa} jpg değil, aynen kopyalanıyor.`);
      }
      await fsp.copyFile(girdi, cikti);
    }
  }
}

module.exports = { thumbsUret };

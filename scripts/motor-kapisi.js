#!/usr/bin/env node
'use strict';
/**
 * MOTOR KAPISI (Faz 3b) — üretilmiş paketi DOSYADAN ölçer (OCR yok):
 *   1. her 43e23fce…js kopyası kanonikle AYNI ya da kanonikten YENİ mi (motorKapisi),
 *   2. paket.json.motorSurumu damgası var mı ve kanonikle tutarlı mı,
 *   3. "sağ alt sürüm rozeti" = okuyucu KABUĞUNUN sürümü (her bookN) ≥ kanonik kabuk
 *      (okuyucu-kabugu.js kabukKapisi) + paket.json.kabukSurumu tutarlı mı.
 *      Rozet motordan GELMEZ — motor değişse de rozet değişmez (ölçüldü 2026-09-24).
 *
 * Girdi: açılmış paket dizini ya da `app.asar` (yalnız gerekli dosyalar mktemp'e çıkarılır;
 * cwd'ye ASLA dökülmez). Çıkış kodu: 0 ikisi de geçti · 1 motor düştü · 3 kabuk düştü ·
 * 4 ikisi de düştü · 2 kanonik (motor ya da kabuk) bilinmiyor.
 * Kullanım: node scripts/motor-kapisi.js <dizin|app.asar> [--json]
 */
const path = require('path');
const os = require('os');
const fs = require('fs-extra');
const M = require('../src/packaging/motor-surumu');
const K = require('../src/packaging/okuyucu-kabugu');

/** asar'dan motor + index.html + kök/kitap düzeyi .js dosyalarını geçici dizine çıkarır. */
function asarCikar(asarYolu) {
  const asar = require('@electron/asar');
  const hedef = fs.mkdtempSync(path.join(os.tmpdir(), 'motor-kapisi-'));
  const liste = asar.listPackage(asarYolu).map((p) => p.replace(/^[\\/]+/, '').split(path.sep).join('/'));
  const gerekli = liste.filter((p) => !p.startsWith('node_modules/') && (
    p.endsWith(`/${M.MOTOR_DOSYA_ADI}`) || p === M.MOTOR_DOSYA_ADI || p === 'paket.json'
    || /^(book\d+\/)?index\.html$/.test(p) || /^(book\d+\/)?[0-9a-f]{20}\.[^/]+\.js$/.test(p)));
  // core/ varlıkları yalnız VARLIK için yoklanır (kabukKapisi eksikCekirdek) — içerik çıkarılmaz,
  // boş yer tutucu yazılır (637 KB'lık svg'yi kopyalamaya gerek yok).
  for (const p of liste.filter((x) => /^(book\d+\/)?core\/.+\.[a-z0-9]+$/i.test(x))) {
    fs.outputFileSync(path.join(hedef, p), '');
  }
  for (const p of gerekli) {
    try {
      const buf = asar.extractFile(asarYolu, p);
      fs.outputFileSync(path.join(hedef, p), buf);
    } catch { /* dizin girdisi */ }
  }
  return hedef;
}

async function olc(girdi) {
  const kok = girdi.endsWith('.asar') ? asarCikar(girdi) : girdi;
  const kanonik = await M.kanonikYukle();
  const kapi = await M.motorKapisi(kok, kanonik);
  let pj = {};
  try { pj = JSON.parse(await fs.readFile(path.join(kok, 'paket.json'), 'utf8')); } catch { pj = {}; }
  const damga = pj.motorSurumu || null;
  const kabukKanonik = await K.kanonikKabukYukle();
  const kabuk = await K.kabukKapisi(kok, kabukKanonik);
  const kabukDamgaTutarli = !!(pj.kabukSurumu && kabukKanonik
    && pj.kabukSurumu.kanonikSurum === kabukKanonik.surum);
  const rozetler = {};
  const dizinler = ['', ...(await fs.readdir(kok)).filter((d) => /^book\d+$/.test(d)).sort()];
  for (const d of dizinler) rozetler[d || '.'] = (await M.rozetSurumuOku(path.join(kok, d))).surum;
  const damgaTutarli = !!(damga && kanonik && damga.kanonikSha12 === kanonik.sha12);
  return { kok, kanonik: kanonik && { sha12: kanonik.sha12, surum: kanonik.surum }, kapi, damga: damga
    && { durum: damga.durum, kanonikSha12: damga.kanonikSha12, degisen: damga.degisen }, damgaTutarli, rozetler,
    kabuk, kabukKanonik: kabukKanonik && kabukKanonik.surum, kabukDamgaTutarli };
}

if (require.main === module) {
  const girdi = process.argv[2];
  if (!girdi) { console.error('kullanım: motor-kapisi.js <dizin|app.asar> [--json]'); process.exit(2); }
  olc(path.resolve(girdi)).then((r) => {
    if (process.argv.includes('--json')) console.log(JSON.stringify(r, null, 2));
    else {
      console.log(`kanonik: ${r.kanonik ? `${r.kanonik.sha12} ${r.kanonik.surum}` : 'BİLİNMİYOR'}`);
      for (const k of r.kapi.kopyalar) console.log(`  ${k.karar.padEnd(10)} ${k.sha12}  ${k.dosya}`);
      console.log(`damga: ${r.damga ? `${r.damga.durum} (${r.damga.kanonikSha12})` : 'YOK'}`
        + ` · tutarlı: ${r.damgaTutarli}`);
      console.log(`rozet (kabuk sürümü): ${Object.entries(r.rozetler).map(([d, v]) => `${d}=${v}`).join(' ')}`);
      console.log(`KABUK KAPISI: ${r.kabuk.gecti === null ? 'BİLİNMİYOR' : r.kabuk.gecti ? 'GEÇTİ' : 'DÜŞTÜ'}`
        + ` — kanonik ${r.kabukKanonik || 'YOK'}, ${r.kabuk.sebep}, damga tutarlı: ${r.kabukDamgaTutarli}`);
      console.log(`MOTOR KAPISI: ${r.kapi.gecti === null ? 'BİLİNMİYOR' : r.kapi.gecti ? 'GEÇTİ' : 'DÜŞTÜ'}`
        + ` — ${r.kapi.sebep}`);
    }
    process.exit(cikisKodu(r));
  }).catch((e) => { console.error(`HATA: ${e.message}`); process.exit(2); });
}

/** 0 geçti · 1 motor · 3 kabuk · 4 ikisi · 2 kanonik bilinmiyor. SAF. */
function cikisKodu(r) {
  if (r.kapi.gecti === null || r.kabuk.gecti === null) return 2;
  const motorOk = r.kapi.gecti && r.damgaTutarli;
  const kabukOk = r.kabuk.gecti && r.kabukDamgaTutarli;
  if (motorOk && kabukOk) return 0;
  if (!motorOk && !kabukOk) return 4;
  return motorOk ? 3 : 1;
}

module.exports = { olc, cikisKodu };

#!/usr/bin/env node
'use strict';
/**
 * Test sunucusunun senaryo dosyasını yazar (sunucu her istekte yeniden okur).
 *   node tools/g-android/g-canli-senaryo.js <ad> --kok <yayın kökü> --senaryo <json>
 * Adlar: bos (her şey 404) · yabanci-a (B, dürüst surum.json) · yabanci-b (B, kimliksiz yalan surum.json)
 *        kabul (A + kitap arşivi) · eski-a (C) · eski-b (C, yalan 2.51.9) · esit-a (D) · esit-b (D, yalan 2.51.9)
 *        kabul-win (W: kaynak ağacı biçiminde kitap arşivi) · bozuk-imza (X: A'nın imzasında tek bit)
 *        bozuk-dosya (E: 2.51.6 geçerli imza, sunulan index.html baytı değişmiş)
 */
const fs = require('fs');
const path = require('path');

const ad = process.argv[2];
const i = (k) => { const j = process.argv.indexOf(`--${k}`); return j > 0 ? process.argv[j + 1] : null; };
const kok = i('kok');
const hedef = i('senaryo');
const y = JSON.parse(fs.readFileSync(path.join(kok, 'yayinlar.json'), 'utf8'));
const ON = '/guncelleme/set/73768/';
const and = (k) => ({ onek: `${ON}android/`, dizin: y[k].android });
const yalan = (surum, setKimligi) => ({ surum, uretim: new Date().toISOString(), ...(setKimligi ? { setKimligi } : {}) });
const S = {
  bos: { esleme: [] },
  'yabanci-a': { esleme: [and('B')] },
  'yabanci-b': { esleme: [and('B')], surumJson: yalan('2.51.5', null) },
  kabul: { esleme: [and('A'), { onek: `${ON}kitap/`, dizin: y.A.kitap }] },
  'kabul-win': y.W && { esleme: [and('W'), { onek: `${ON}kitap/`, dizin: y.W.kitap }] },
  'bozuk-imza': y.X && { esleme: [and('X')], surumJson: yalan('2.51.9', '73768') },
  'bozuk-dosya': y.E && { esleme: [and('E')] },
  'eski-a': { esleme: [and('C')] },
  'eski-b': { esleme: [and('C')], surumJson: yalan('2.51.9', '73768') },
  'esit-a': { esleme: [and('D')] },
  'esit-b': { esleme: [and('D')], surumJson: yalan('2.51.9', '73768') },
};
if (!S[ad]) { console.error(`bilinmeyen senaryo: ${ad}`); process.exit(2); }
fs.writeFileSync(hedef, JSON.stringify({ ad, ...S[ad] }, null, 1));
console.log(`senaryo=${ad}`);

#!/usr/bin/env node
'use strict';

/**
 * WEB-Z TEMA EŞİTLE — Worker'ın set teması (book-update `SET_UI_FILES_BY_THEME`) → bu depodaki
 * çevrimdışı tema kopyası (`src/agent/webz-tema/<tema>/`). 2026-10-02, Flashy offline kök menüsü.
 *
 * NEDEN: Flashy setlerinin (74430, 59480, 60114) offline kök menüsü web'deki set index'inin
 * AYNISI olacak (Nadir 02.10). Kaynak = Worker'ın `web-proxy-modern` teması
 * (`services/cloudflare-worker/src/set-ui-templates.ts`). Runner o 7 MB'lık TS dosyasını çalışma
 * anında AYRIŞTIRMAZ; bu araç temayı BAYT BAYT buraya kopyalar + `KAYNAK.json` (sha256, commit)
 * yazar. `webz-tema-kabuk.test.js` "kaynak paritesi" testi book-update varsa kopyanın hâlâ aynı
 * olduğunu ölçer (Worker'da tema değişince test kırmızı → bu araç yeniden koşulur).
 *
 * KULLANIM:
 *   node tools/webz-tema-esitle.js                       # web-proxy-modern, varsayılan yollar
 *   node tools/webz-tema-esitle.js --tema web-proxy-modern --kaynak <set-ui-templates.ts>
 *   node tools/webz-tema-esitle.js --vendor              # FA 6.5.2 + Google Fonts yerel kopyası
 *
 * Ağ: yalnız `--vendor` (cdnjs + fonts.googleapis/gstatic, tek seferlik). Tema eşitleme ağsız.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const KOK = path.join(__dirname, '..', 'src', 'agent', 'webz-tema');
// EMPP_WEBZ_TEMA_KAYNAK: ana ağaç commit edilmemiş değişiklik taşırken temiz kaynak (worktree) ver.
const VARSAYILAN_KAYNAK = process.env.EMPP_WEBZ_TEMA_KAYNAK || path.join(process.env.HOME || '',
  '01dev', 'book-update', 'services', 'cloudflare-worker', 'src', 'set-ui-templates.ts');
const TEMA_SATIRI = /^ {2}'([a-z0-9-]+)': \{\s*$/;

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

/**
 * TS kaynağından tek temanın dosyalarını çıkarır. SAF (metin girer, Map çıkar).
 * Tema gövdesi düz JS'tir (şablon dizgileri + `Uint8Array.from(atob(...))`); vm'de değerlendirilir.
 * @returns {{dosyalar: Map<string, Buffer>, satirlar: [number, number]}}
 */
function temaCikar(tsMetni, tema) {
  const satirlar = String(tsMetni).split('\n');
  const bas = satirlar.findIndex((s) => {
    const m = TEMA_SATIRI.exec(s);
    return m && m[1] === tema;
  });
  if (bas < 0) throw new Error(`tema bulunamadı: ${tema}`);
  // Tema sonu = sonraki tema anahtarı. CSS/JS gövdelerinde sütun-0 `}` satırları VAR (yanlış
  // son olur); son tema için nesnenin kapanışı (`} as const;` / `};`) sondan aranır.
  let son = satirlar.findIndex((s, i) => i > bas && TEMA_SATIRI.test(s));
  if (son < 0) {
    for (let i = satirlar.length - 1; i > bas; i--) {
      if (/^\}( as const)?;\s*$/.test(satirlar[i])) {
        son = i;
        break;
      }
    }
  }
  if (son < 0) throw new Error(`tema sonu bulunamadı: ${tema}`);
  const govde = satirlar.slice(bas + 1, son).join('\n').replace(/\s*\},?\s*$/, '');
  const nesne = vm.runInNewContext(`({${govde}})`, { atob, Uint8Array }, { timeout: 10000 });
  const dosyalar = new Map();
  for (const [ad, v] of Object.entries(nesne)) {
    if (!v || v.content == null) throw new Error(`${tema}/${ad}: content yok`);
    dosyalar.set(ad, typeof v.content === 'string'
      ? Buffer.from(v.content, 'utf8') : Buffer.from(v.content));
  }
  return { dosyalar, satirlar: [bas + 1, son] };
}

function gitCommit(dosya) {
  try {
    return execFileSync('git', ['-C', path.dirname(dosya), 'log', '-1', '--format=%h %cs', '--',
      path.basename(dosya)], { encoding: 'utf8' }).trim();
  } catch (_) {
    return null;
  }
}

function esitle({ tema = 'web-proxy-modern', kaynak = VARSAYILAN_KAYNAK, hedefKok = KOK } = {}) {
  const ts = fs.readFileSync(kaynak, 'utf8');
  const { dosyalar, satirlar } = temaCikar(ts, tema);
  const hedef = path.join(hedefKok, tema);
  const manifest = {};
  for (const [ad, buf] of [...dosyalar].sort(([a], [b]) => a.localeCompare(b))) {
    const y = path.join(hedef, ad);
    fs.mkdirSync(path.dirname(y), { recursive: true });
    fs.writeFileSync(y, buf);
    manifest[ad] = { boyut: buf.length, sha256: sha256(buf) };
  }
  const kayit = {
    tema,
    kaynak: 'book-update services/cloudflare-worker/src/set-ui-templates.ts',
    satirlar,
    commit: gitCommit(kaynak),
    eslenme: new Date().toISOString().slice(0, 10),
    dosyalar: manifest,
  };
  fs.writeFileSync(path.join(hedef, 'KAYNAK.json'), `${JSON.stringify(kayit, null, 2)}\n`);
  return kayit;
}

// ─── Vendor (tek seferlik ağ) ───────────────────────────────────────────────────────────────

const FA_SURUM = '6.5.2';
const FA_KOK = `https://cdnjs.cloudflare.com/ajax/libs/font-awesome/${FA_SURUM}`;
const GF_CSS = 'https://fonts.googleapis.com/css2?family=Fraunces:wght@600;800'
  + '&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap';
const CHROME_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/130.0 Safari/537.36';

async function indir(url) {
  const r = await fetch(url, { headers: { 'User-Agent': CHROME_UA } });
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

async function vendor(hedefKok = KOK) {
  const v = path.join(hedefKok, 'vendor');
  // Font Awesome: all.min.css + yalnız woff2 (Chromium/Electron woff2 okur; ttf yedekleri atılır).
  const faCss = (await indir(`${FA_KOK}/css/all.min.css`)).toString('utf8');
  const woff2 = [...new Set([...faCss.matchAll(/\.\.\/webfonts\/([a-z0-9-]+\.woff2)/g)]
    .map((m) => m[1]))];
  fs.mkdirSync(path.join(v, 'fontawesome', 'css'), { recursive: true });
  fs.mkdirSync(path.join(v, 'fontawesome', 'webfonts'), { recursive: true });
  const faYerel = faCss.replace(
    /,\s*url\(\.\.\/webfonts\/[a-z0-9-]+\.ttf\)\s*format\("truetype"\)/g, '');
  fs.writeFileSync(path.join(v, 'fontawesome', 'css', 'all.min.css'), faYerel);
  for (const f of woff2) {
    fs.writeFileSync(path.join(v, 'fontawesome', 'webfonts', f),
      await indir(`${FA_KOK}/webfonts/${f}`));
  }
  // Google Fonts: css2 (woff2) → yerel dosya adları.
  let gf = (await indir(GF_CSS)).toString('utf8');
  fs.mkdirSync(path.join(v, 'fonts'), { recursive: true });
  const urller = [...new Set([...gf.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)]
    .map((m) => m[1]))];
  for (const u of urller) {
    const ad = `${sha256(Buffer.from(u)).slice(0, 12)}.woff2`;
    fs.writeFileSync(path.join(v, 'fonts', ad), await indir(u));
    gf = gf.split(u).join(ad);
  }
  fs.writeFileSync(path.join(v, 'fonts', 'fonts.css'), gf);
  const kayit = {
    fontawesome: { surum: FA_SURUM, kaynak: FA_KOK, woff2 },
    googleFonts: { kaynak: GF_CSS, dosya: urller.length },
    indirme: new Date().toISOString().slice(0, 10),
    lisans: 'FA Free: ikon CC BY 4.0, font OFL 1.1, kod MIT; Fraunces/Plus Jakarta Sans: OFL 1.1',
  };
  fs.writeFileSync(path.join(v, 'KAYNAK.json'), `${JSON.stringify(kayit, null, 2)}\n`);
  return kayit;
}

if (require.main === module) {
  const arg = process.argv.slice(2);
  const al = (ad) => {
    const i = arg.indexOf(ad);
    return i >= 0 ? arg[i + 1] : undefined;
  };
  (async () => {
    if (arg.includes('--vendor')) {
      console.log(JSON.stringify(await vendor(), null, 2));
      return;
    }
    const k = esitle({ tema: al('--tema') || undefined, kaynak: al('--kaynak') || undefined });
    console.log(`${k.tema}: ${Object.keys(k.dosyalar).length} dosya, satır `
      + `${k.satirlar.join('-')}, ${k.commit}`);
  })().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}

module.exports = { temaCikar, esitle, vendor, VARSAYILAN_KAYNAK, KOK };

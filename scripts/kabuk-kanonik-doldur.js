#!/usr/bin/env node
'use strict';
/**
 * KANONİK OKUYUCU KABUĞU ÖNBELLEĞİNİ DOLDURUR — `~/.empp-agent/kabuk/<surum>/` + `kanonik.json`.
 *
 * Kaynak: Web-Z'nin servis ettiği yayıncı `WebZKitap/` kabuğu (book-stream worker
 * `index.ts:1278-1297` kök .js/.css'i `<yayinciOrigin>/WebZKitap/<dosya>`'dan vekil eder).
 * SALT OKUMA: yalnız HTTP GET; hiçbir yere yazmaz (yerel önbellek hariç).
 *
 * Kabuk dosya kümesi (ölçüm 2026-09-24, YDS 1.13.3):
 *   `<h>.main.js` (+ .LICENSE.txt) · `<h>.main.css` · main.js içindeki iki parça haritasının
 *   (js + css, `{id:"hash"}`) her girdisi `<hash>.<id>.js|css` (+ varsa .LICENSE.txt) ·
 *   index.html'in yüklediği kabuk betikleri `icons.js`, `images.js`, `tour.js`, `i18n/tr.js`.
 *   + ÇEKİRDEK VARLIKLAR (`cekirdek`): kabuk JS'lerinin başvurduğu `core/*.png|svg|…` dosyaları.
 *   Pakete YALNIZ EKSİKSE eklenir, var olan asla ezilmez (kurum logosu vb.). Ölçüm 73768:
 *   75 başvurudan 2'si pakette yok — core/icons/ButtonCollab.svg, core/jump-to-page-icon.png.
 *   HARİÇ: index.html (paketteki şablon korunur, yalnız main referansları yeniden yazılır),
 *   `app.config.js` (kitaba/platforma özgü; Web-Z onu isWeb:true ile yamalıyor), motor
 *   `43e23fce…js` (motor-surumu.js'in işi), `core/` (kurum logosu), kitap içeriği.
 *
 * Kullanım: node scripts/kabuk-kanonik-doldur.js [--url <book index.html URL>] [--hedef <dir>]
 */
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const fs = require('fs-extra');

const VARSAYILAN_URL = 'https://webz.ydspublishing.com/go/ei4wf/web-stream/book1/index.html'
  + '?version=0&bookId=73454&defaultPageNo=1';
const VARSAYILAN_HEDEF = path.join(os.homedir(), '.empp-agent', 'kabuk');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/140.0 Safari/537.36';
/** index.html'in yüklediği, main.js ile birlikte sürümlenen kabuk betikleri. */
const EK_BETIKLER = ['icons.js', 'images.js', 'tour.js', 'i18n/tr.js'];

/** index.html'den main.js / main.css adları. SAF. */
function mainAdlari(html) {
  const js = (html.match(/src="\.?\/?([0-9a-f]{20}\.main\.js)"/) || [])[1] || null;
  const css = (html.match(/href="\.?\/?([0-9a-f]{20}\.main\.css)"/) || [])[1] || null;
  return { js, css };
}

/**
 * main.js'teki parça haritalarından dosya adları. İlk harita js, sonrakiler css
 * (webpack 5 `miniCssF` sırası; ölçüldü: 15 js + 3 css). SAF.
 */
function parcaAdlari(mainMetni) {
  const haritalar = [...mainMetni.matchAll(/\{(\d+:"[0-9a-f]{20}"(?:,\d+:"[0-9a-f]{20}")*)\}/g)]
    .map((m) => [...m[1].matchAll(/(\d+):"([0-9a-f]{20})"/g)].map((x) => [x[1], x[2]]));
  const adlar = [];
  haritalar.forEach((h, i) => {
    const uzanti = i === 0 ? 'js' : 'css';
    for (const [id, hash] of h) adlar.push(`${hash}.${id}.${uzanti}`);
  });
  return [...new Set(adlar)];
}

/** Kabuk metinlerinden core/ varlık başvuruları. SAF. */
function cekirdekBasvurulari(metinler) {
  const kume = new Set();
  for (const m of metinler) {
    for (const x of m.matchAll(/core\/[A-Za-z0-9_./-]+\.(?:png|svg|jpe?g|gif|webp|mp4)/g)) {
      if (!x[0].includes('..')) kume.add(x[0]);
    }
  }
  return [...kume].sort();
}

function sha12(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 12);
}

async function getir(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
  if (!r.ok) return null;
  return Buffer.from(await r.arrayBuffer());
}

async function ana(argv) {
  const al = (ad, vars) => { const i = argv.indexOf(ad); return i >= 0 ? argv[i + 1] : vars; };
  const url = al('--url', VARSAYILAN_URL);
  const hedefKok = al('--hedef', VARSAYILAN_HEDEF);
  const taban = new URL('./', url).href;

  const html = (await getir(url) || Buffer.alloc(0)).toString('utf8');
  const { js, css } = mainAdlari(html);
  if (!js) throw new Error('index.html\'de *.main.js yok');
  const mainBuf = await getir(taban + js);
  if (!mainBuf) throw new Error(`${js} indirilemedi`);
  const surum = (mainBuf.toString('latin1').match(/e\.exports=\{i8:"([0-9.]+)"\}/) || [])[1] || null;

  const istenen = [js, `${js}.LICENSE.txt`, ...(css ? [css] : []),
    ...parcaAdlari(mainBuf.toString('latin1')), ...EK_BETIKLER];
  const parcalar = parcaAdlari(mainBuf.toString('latin1')).filter((a) => a.endsWith('.js'));
  for (const p of parcalar) istenen.push(`${p}.LICENSE.txt`);

  const gecici = await fs.mkdtemp(path.join(os.tmpdir(), 'kabuk-doldur-'));
  const dosyalar = [];
  let bulunanSurum = surum;
  for (const ad of [...new Set(istenen)]) {
    const buf = ad === js ? mainBuf : await getir(taban + ad);
    if (!buf) {
      if (ad.endsWith('.LICENSE.txt')) continue; // her parçada yok — beklenen
      throw new Error(`kabuk dosyası indirilemedi: ${ad}`);
    }
    if (!bulunanSurum) bulunanSurum = (buf.toString('latin1').match(/e\.exports=\{i8:"([0-9.]+)"\}/) || [])[1] || null;
    await fs.outputFile(path.join(gecici, ad), buf);
    dosyalar.push({ ad, sha12: sha12(buf), bayt: buf.length });
  }
  const metinler = [];
  for (const d of dosyalar) {
    if (d.ad.endsWith('.js')) metinler.push((await fs.readFile(path.join(gecici, d.ad))).toString('latin1'));
  }
  const cekirdek = [];
  for (const ad of cekirdekBasvurulari(metinler)) {
    const buf = await getir(taban + ad);
    if (!buf) { console.warn(`uyarı: çekirdek varlık kaynakta yok: ${ad}`); continue; }
    await fs.outputFile(path.join(gecici, ad), buf);
    cekirdek.push({ ad, sha12: sha12(buf), bayt: buf.length });
  }
  if (!bulunanSurum || !/^\d+(\.\d+)*$/.test(bulunanSurum)) {
    throw new Error('kabuk sürümü (i8) bulunamadı — önbellek YAZILMADI');
  }
  const dizin = path.join(hedefKok, bulunanSurum);
  await fs.ensureDir(hedefKok);
  if (await fs.pathExists(dizin)) {
    await fs.move(dizin, `${dizin}.onceki-${Date.now()}`); // silme yok
  }
  await fs.move(gecici, dizin);
  const manifest = { surum: bulunanSurum, main: js, mainCss: css, kaynak: url,
    zaman: new Date().toISOString(), dosyalar, cekirdek };
  await fs.writeFile(path.join(dizin, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await fs.writeFile(path.join(hedefKok, 'kanonik.json'),
    `${JSON.stringify({ surum: bulunanSurum, dizin, kaynak: url, zaman: manifest.zaman }, null, 2)}\n`);
  console.log(`kanonik kabuk: ${bulunanSurum} (${dosyalar.length} dosya, main ${js}) → ${dizin}`);
  return manifest;
}

if (require.main === module) {
  ana(process.argv.slice(2)).catch((e) => { console.error(`HATA: ${e.message}`); process.exit(1); });
}

module.exports = { mainAdlari, parcaAdlari, cekirdekBasvurulari, EK_BETIKLER };

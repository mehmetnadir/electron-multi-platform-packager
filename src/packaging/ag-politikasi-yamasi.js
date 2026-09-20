/*
 * K21 — Açılış ağ politikasının pakete enjeksiyonu.
 *
 * NE YAPAR: `platforms/common/ag-politikasi.js` dosyasını paket köküne
 * `empp-ag-politikasi.js` adıyla kopyalar ve kök + `bookN/` index.html'lerine
 * `<head>`in hemen başına <script> olarak enjekte eder. Motorun kendi
 * paketlenmiş kodu DEĞİŞMEZ — davranış yalnız `window.fetch` sarmalıyla gelir.
 *
 * NEDEN BURADA, motor bundle'ında değil: bundle 20-hex içerik-hash'li ve
 * yayıncı sürümüne göre değişiyor; regex ile yamamak K16'da sessiz NO-OP
 * üretmişti. index.html tek ve sabit bir kanca noktası.
 *
 * Alt-kitaplarda dosya KOPYALANMAZ; göreli src ('../empp-ag-politikasi.js')
 * verilir — file:// altında script src sayfanın kendi konumuna göre çözülür
 * (fs-shim'in K9 dersinin aynısı).
 */
const path = require('path');
const fs = require('fs-extra');

const DOSYA_ADI = 'empp-ag-politikasi.js';
const KAYNAK = path.join(__dirname, '../platforms/common/ag-politikasi.js');
const BOOK_RE = /^book\d+$/i;

function betikEtiketi(src) {
  return `<script src="${src}"></script>`;
}

// Saf: HTML'e enjeksiyon. Zaten varsa DOKUNMAZ (yeniden paketlemede çoğalmasın).
function icerigeEnjekteEt(html, src) {
  if (typeof html !== 'string') return { durum: 'html-yok', html };
  if (html.includes(DOSYA_ADI)) return { durum: 'zaten-var', html };
  const etiket = betikEtiketi(src);
  if (html.includes('<head>')) {
    return { durum: 'enjekte', html: html.replace('<head>', '<head>' + etiket) };
  }
  return { durum: 'enjekte', html: etiket + html };
}

async function dosyayaEnjekteEt(indexYolu, src) {
  if (!(await fs.pathExists(indexYolu))) return { durum: 'index-yok' };
  const html = await fs.readFile(indexYolu, 'utf8');
  const r = icerigeEnjekteEt(html, src);
  if (r.durum !== 'enjekte') return { durum: r.durum };
  const gecici = indexYolu + '.empp-tmp';
  await fs.writeFile(gecici, r.html);
  await fs.rename(gecici, indexYolu);   // atomik: yarım index.html = beyaz ekran
  return { durum: 'enjekte' };
}

async function altKitapDizinleri(kokDizin) {
  const girdiler = await fs.readdir(kokDizin, { withFileTypes: true });
  return girdiler.filter((g) => g.isDirectory() && BOOK_RE.test(g.name)).map((g) => g.name).sort();
}

async function paketeUygula(kokDizin, opts = {}) {
  const gunluk = opts.gunluk || (() => {});
  const sonuc = { kopyalandi: false, enjekte: [], atlanan: [] };

  const kokIndex = path.join(kokDizin, 'index.html');
  const altlar = await altKitapDizinleri(kokDizin);
  if (!(await fs.pathExists(kokIndex)) && altlar.length === 0) {
    sonuc.sebep = 'index-yok';
    return sonuc;
  }

  await fs.copy(KAYNAK, path.join(kokDizin, DOSYA_ADI));
  sonuc.kopyalandi = true;

  const hedefler = [{ ad: '(kök)', index: kokIndex, src: DOSYA_ADI }];
  for (const b of altlar) {
    hedefler.push({ ad: b, index: path.join(kokDizin, b, 'index.html'), src: '../' + DOSYA_ADI });
  }
  for (const h of hedefler) {
    const r = await dosyayaEnjekteEt(h.index, h.src);
    if (r.durum === 'enjekte') { sonuc.enjekte.push(h.ad); gunluk(`✅ ağ politikası: ${h.ad}`); }
    else { sonuc.atlanan.push({ ad: h.ad, sebep: r.durum }); }
  }
  return sonuc;
}

function acikMi(env = process.env) { return env.EMPP_AG_POLITIKASI !== '0'; }

module.exports = { paketeUygula, icerigeEnjekteEt, dosyayaEnjekteEt, acikMi, DOSYA_ADI };

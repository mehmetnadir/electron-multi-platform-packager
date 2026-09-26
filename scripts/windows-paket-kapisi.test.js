'use strict';

/**
 * windows-paket-kapisi testleri — TAMAMI SENTETİK baytlarla koşar.
 * Gerçek 1,3 GB exe teste sokulmaz: fixture'lar burada üretilir (PE, .rsrc, ICO,
 * PNG, DIB, asar, NSIS korpusu).
 *
 * Testlerin ana yükü "ölçemediğini PASS sayma" kuralını çivilemektir:
 *   · dış NSIS PE'sinden mimari PASS'ı ÜRETİLEMEZ (NSIS daima 0x014c'dir)
 *   · kanıt penceresi yoksa yokluk ölçümü PASS değil ÖLÇÜLEMEDİ'dir
 *   · kare çözülemiyorsa ikon PASS değil ÖLÇÜLEMEDİ'dir
 *   · boyut yeterli ama içerik boşsa FAIL'dir (SM4 CSS 71 KB dersi)
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const K = require('./windows-paket-kapisi');

// ===========================================================================
// Fixture üreticileri
// ===========================================================================

let CRC_TABLO = null;
function crc32(buf) {
  if (!CRC_TABLO) {
    CRC_TABLO = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLO[n] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLO[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngParca(tip, govde) {
  const bas = Buffer.alloc(8);
  bas.writeUInt32BE(govde.length, 0);
  bas.write(tip, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(tip, 'latin1'), govde])), 0);
  return Buffer.concat([bas, govde, crc]);
}

/** w*h RGBA PNG; `alfaFn(x,y)` alfa döner (varsayılan 0 = tamamen saydam). */
function pngUret(w, h, alfaFn) {
  const a = alfaFn || (() => 0);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  const satirlar = [];
  for (let y = 0; y < h; y++) {
    const s = Buffer.alloc(1 + w * 4);
    s[0] = 0; // filtre None
    for (let x = 0; x < w; x++) {
      s[1 + x * 4] = 200;
      s[2 + x * 4] = 200;
      s[3 + x * 4] = 200;
      s[4 + x * 4] = a(x, y);
    }
    satirlar.push(s);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngParca('IHDR', ihdr),
    pngParca('IDAT', zlib.deflateSync(Buffer.concat(satirlar))),
    pngParca('IEND', Buffer.alloc(0))
  ]);
}

/** ICO içi 32 bpp DIB karesi (alttan üste dizilim). */
function dibUret(w, h, alfaFn) {
  const a = alfaFn || (() => 0);
  const bas = Buffer.alloc(40);
  bas.writeUInt32LE(40, 0);
  bas.writeInt32LE(w, 4);
  bas.writeInt32LE(h * 2, 8);
  bas.writeUInt16LE(1, 12);
  bas.writeUInt16LE(32, 14);
  const piksel = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (h - 1 - y) * w * 4 + x * 4;
      piksel[i] = 200;
      piksel[i + 1] = 200;
      piksel[i + 2] = 200;
      piksel[i + 3] = a(x, y);
    }
  }
  return Buffer.concat([bas, piksel]);
}

function icoUret(kareler) {
  const bas = Buffer.alloc(6 + kareler.length * 16);
  bas.writeUInt16LE(0, 0);
  bas.writeUInt16LE(1, 2);
  bas.writeUInt16LE(kareler.length, 4);
  let ofset = bas.length;
  kareler.forEach((k, i) => {
    const g = 6 + i * 16;
    bas[g] = 16;
    bas[g + 1] = 16;
    bas.writeUInt32LE(k.length, g + 8);
    bas.writeUInt32LE(ofset, g + 12);
    ofset += k.length;
  });
  return Buffer.concat([bas, ...kareler]);
}

/**
 * Asgari PE. `ikon` verilirse tek RT_ICON taşıyan bir `.rsrc` kurulur.
 * `kuyruk` ham bayt taraması testleri için sona eklenir.
 */
function peUret(makine, secenek = {}) {
  const ikon = secenek.ikon || null;
  const kuyruk = secenek.kuyruk || Buffer.alloc(0);
  const RSRC_OFSET = 0x200;
  const RSRC_RVA = 0x1000;

  const bas = Buffer.alloc(RSRC_OFSET);
  bas.write('MZ', 0, 'latin1');
  bas.writeUInt32LE(0x40, 0x3c);
  bas.write('PE\u0000\u0000', 0x40, 'latin1');
  bas.writeUInt16LE(makine, 0x44);
  bas.writeUInt16LE(ikon ? 1 : 0, 0x46); // bölüm sayısı
  bas.writeUInt16LE(0, 0x44 + 16); // sizeOfOptionalHeader = 0

  if (!ikon) return Buffer.concat([bas, kuyruk]);

  // .rsrc: üç seviyeli kaynak ağacı → tek RT_ICON (tip 3).
  const dizin = (altAdet, girdiler) => {
    const b = Buffer.alloc(16 + girdiler.length * 8);
    b.writeUInt16LE(0, 12); // adlı girdi yok
    b.writeUInt16LE(girdiler.length, 14);
    girdiler.forEach((g, i) => {
      b.writeUInt32LE(g.id, 16 + i * 8);
      b.writeUInt32LE(g.ofset, 16 + i * 8 + 4);
    });
    return b;
  };
  const d1 = dizin(1, [{ id: 3, ofset: 0x80000000 + 24 }]);
  const d2 = dizin(1, [{ id: 1, ofset: 0x80000000 + 48 }]);
  const d3 = dizin(1, [{ id: 1033, ofset: 72 }]);
  const veriGirdi = Buffer.alloc(16);
  veriGirdi.writeUInt32LE(RSRC_RVA + 88, 0);
  veriGirdi.writeUInt32LE(ikon.length, 4);
  const rsrc = Buffer.concat([d1, d2, d3, veriGirdi, ikon]);

  const bolum = Buffer.alloc(40);
  bolum.write('.rsrc', 0, 'latin1');
  bolum.writeUInt32LE(rsrc.length, 8);
  bolum.writeUInt32LE(RSRC_RVA, 12);
  bolum.writeUInt32LE(rsrc.length, 16);
  bolum.writeUInt32LE(RSRC_OFSET, 20);
  bolum.copy(bas, 0x58);

  return Buffer.concat([bas, rsrc, kuyruk]);
}

/** @param {Record<string,string|Buffer>} dosyalar yol → içerik */
function asarUret(dosyalar) {
  const govdeler = [];
  let ofset = 0;
  const kok = { files: {} };
  for (const yol of Object.keys(dosyalar)) {
    const icerik = Buffer.isBuffer(dosyalar[yol]) ? dosyalar[yol] : Buffer.from(dosyalar[yol]);
    let dugum = kok;
    const parcalar = yol.split('/');
    for (let i = 0; i < parcalar.length - 1; i++) {
      dugum.files[parcalar[i]] = dugum.files[parcalar[i]] || { files: {} };
      dugum = dugum.files[parcalar[i]];
    }
    dugum.files[parcalar[parcalar.length - 1]] = { size: icerik.length, offset: String(ofset) };
    govdeler.push(icerik);
    ofset += icerik.length;
  }
  // GERÇEK asar düzeni (node asar/Pickle). Eski fixture 12 baytlık yanlış bir
  // başlık üretiyordu ve okuyucunun aynı hatasını maskeliyordu: testler yeşil,
  // gerçek app.asar'ların HİÇBİRİ açılmıyordu (2026-09-21, SM4 baytlarıyla doğrulandı).
  const json = Buffer.from(JSON.stringify(kok), 'utf8');
  const dolgu = (4 - (json.length % 4)) % 4;
  const yukBoy = 4 + json.length + dolgu; // dize pickle'ının yük boyu
  const headerBoy = 4 + yukBoy;           // başlık pickle'ının tamamı
  const bas = Buffer.alloc(16);
  bas.writeUInt32LE(4, 0);
  bas.writeUInt32LE(headerBoy, 4);
  bas.writeUInt32LE(yukBoy, 8);
  bas.writeUInt32LE(json.length, 12);
  return Buffer.concat([bas, json, Buffer.alloc(dolgu), ...govdeler]);
}

function geciciDizin() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'empp-kapi-test-'));
  test.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}

const ANA_JS_TAM = `
  const { BrowserWindow } = require('electron');
  // EMPP_READY_TO_SHOW
  let win;
  win = new BrowserWindow({ show: false, fullscreen: true });
  win.once('ready-to-show', () => win.show());
  setTimeout(() => win.show(), 8000);
  // EMPP_GUNCELLEME_OTELEME  timeout 15000
  // EMPP_ON_GETIRME
`;

// ===========================================================================
// 1) PE / mimari
// ===========================================================================

test('1 · peMakineOku ia32 PE\'yi 0x014c okur', () => {
  const r = K.peMakineOku(peUret(K.MAKINE_IA32));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.makine, 0x014c);
  assert.strictEqual(r.ad, 'ia32');
});

test('2 · peMakineOku x64 PE\'yi 0x8664 okur (ia32 ile karışmaz)', () => {
  const r = K.peMakineOku(peUret(K.MAKINE_X64));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.makine, 0x8664);
  assert.strictEqual(r.ad, 'x64');
});

test('3 · peMakineOku bozuk/kısa tamponda ok:false döner, tahmin etmez', () => {
  assert.strictEqual(K.peMakineOku(Buffer.alloc(10)).ok, false);
  assert.strictEqual(K.peMakineOku(Buffer.alloc(200)).ok, false); // MZ yok
  const mz = peUret(K.MAKINE_IA32);
  mz.write('XX', 0x40, 'latin1'); // PE imzasını boz
  assert.strictEqual(K.peMakineOku(mz).ok, false);
});

test('4 · TUZAK: dış NSIS PE\'si 0x014c olsa bile mimari PASS ÜRETMEZ', () => {
  const disPe = K.peMakineOku(peUret(K.MAKINE_IA32));
  const m = K.mimariKarar({ icPe: null, yukAdi: null, disPe });
  assert.strictEqual(m.durum, K.OLCULEMEDI);
  assert.match(m.detay, /NSIS daima 32-bit/);
});

test('5 · mimariKarar iç exe ia32 ise PASS, x64 ise FAIL', () => {
  const pass = K.mimariKarar({ icPe: K.peMakineOku(peUret(K.MAKINE_IA32)) });
  assert.strictEqual(pass.durum, K.PASS);
  assert.match(pass.detay, /0x014c/);
  const fail = K.mimariKarar({ icPe: K.peMakineOku(peUret(K.MAKINE_X64)) });
  assert.strictEqual(fail.durum, K.FAIL);
  assert.match(fail.detay, /ia32 değil/);
});

test('6 · yük adı dolaylı kanıttır: app-32.7z PASS, app-64.7z FAIL', () => {
  assert.strictEqual(K.yukAdindanMimari('app-32.7z'), 'ia32');
  assert.strictEqual(K.yukAdindanMimari('app-64.7z'), 'x64');
  assert.strictEqual(K.yukAdindanMimari('rastgele.7z'), null);
  assert.strictEqual(K.mimariKarar({ yukAdi: 'app-32.7z' }).durum, K.PASS);
  assert.strictEqual(K.mimariKarar({ yukAdi: 'app-64.7z' }).durum, K.FAIL);
});

// ===========================================================================
// 2) İkon köşe alfası
// ===========================================================================

test('7 · dibKoseAlfa 32 bpp DIB\'in dört köşesini alttan-üste dizilimle okur', () => {
  const r = K.dibKoseAlfa(dibUret(4, 4, () => 0));
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.alfalar, [0, 0, 0, 0]);
  const kirli = K.dibKoseAlfa(dibUret(4, 4, (x, y) => (x === 3 && y === 0 ? 255 : 0)));
  assert.deepStrictEqual(kirli.alfalar, [0, 255, 0, 0]);
});

test('8 · dibKoseAlfa 24 bpp ikonu PASS saymaz, ölçülemez der', () => {
  const b = dibUret(4, 4, () => 0);
  b.writeUInt16LE(24, 14);
  const r = K.dibKoseAlfa(b);
  assert.strictEqual(r.ok, false);
  assert.match(r.sebep, /alfa kanalı yok/);
});

test('9 · pngKoseAlfa RGBA PNG köşelerini çözer (zlib + unfilter)', () => {
  const temiz = K.pngKoseAlfa(pngUret(8, 8, () => 0));
  assert.strictEqual(temiz.ok, true);
  assert.deepStrictEqual(temiz.alfalar, [0, 0, 0, 0]);
  const kutulu = K.pngKoseAlfa(pngUret(8, 8, () => 255));
  assert.deepStrictEqual(kutulu.alfalar, [255, 255, 255, 255]);
});

test('10 · maddeIkon: tüm kareler temizse PASS', () => {
  const kareler = [dibUret(4, 4, () => 0), pngUret(8, 8, () => 0), dibUret(16, 16, () => 0)];
  const m = K.maddeIkon(kareler, 'test');
  assert.strictEqual(m.durum, K.PASS);
  assert.match(m.detay, /3\/3/);
});

test('11 · maddeIkon: TEK kare bile opak köşeliyse FAIL (beyaz kutu)', () => {
  const kareler = [dibUret(4, 4, () => 0), dibUret(4, 4, () => 255)];
  const m = K.maddeIkon(kareler, 'test');
  assert.strictEqual(m.durum, K.FAIL);
  assert.match(m.detay, /köşe opak/);
});

test('12 · maddeIkon: kare yoksa PASS DEĞİL, ÖLÇÜLEMEDİ', () => {
  assert.strictEqual(K.maddeIkon([], 'çıkarım yok').durum, K.OLCULEMEDI);
  const cozulemeyen = K.maddeIkon([Buffer.from('bozuk-kare-baytlari')], 'test');
  assert.strictEqual(cozulemeyen.durum, K.OLCULEMEDI);
});

test('13 · icoKareleri ICONDIR\'i karelere ayırır', () => {
  const k1 = dibUret(4, 4, () => 0);
  const k2 = pngUret(8, 8, () => 0);
  const kareler = K.icoKareleri(icoUret([k1, k2]));
  assert.strictEqual(kareler.length, 2);
  assert.ok(kareler[0].equals(k1));
  assert.ok(kareler[1].equals(k2));
  assert.deepStrictEqual(K.icoKareleri(Buffer.from('ico değil')), []);
});

test('14 · peKaynakIkonlari .rsrc içindeki RT_ICON\'u bulur, yoksa sebep döner', () => {
  const ikon = dibUret(4, 4, () => 0);
  const r = K.peKaynakIkonlari(peUret(K.MAKINE_IA32, { ikon }));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.kareler.length, 1);
  assert.ok(r.kareler[0].equals(ikon));
  const yok = K.peKaynakIkonlari(peUret(K.MAKINE_IA32));
  assert.strictEqual(yok.ok, false);
  assert.match(yok.sebep, /\.rsrc/);
});

// ===========================================================================
// 3) version.txt — bilinen açık arıza
// ===========================================================================

test('15 · surumParcalari parça sayısı ve sayısallığı ayırır', () => {
  assert.deepStrictEqual(K.surumParcalari('1.13.1').parcalar, ['1', '13', '1']);
  assert.strictEqual(K.surumParcalari('1.13.1.3').parcalar.length, 4);
  assert.strictEqual(K.surumParcalari('1.13.x').sayisal, false);
  assert.deepStrictEqual(K.surumParcalari('  ').parcalar, []);
});

test('16 · maddeSurum: 4 parçalı "1.13.1.3" FAIL — 350 MB tuzağı', () => {
  const m = K.maddeSurum({ asarOkundu: true, bulundu: true, metin: '1.13.1.3\n' });
  assert.strictEqual(m.durum, K.FAIL);
  assert.match(m.detay, /4 parça/);
  assert.match(m.detay, /350 MB/);
});

test('17 · maddeSurum: 3 parçalı "1.13.1" PASS', () => {
  const m = K.maddeSurum({ asarOkundu: true, bulundu: true, metin: '1.13.1\n' });
  assert.strictEqual(m.durum, K.PASS);
});

test('18 · maddeSurum: asar okunamadı → ÖLÇÜLEMEDİ; okundu ama dosya yok → FAIL', () => {
  assert.strictEqual(K.maddeSurum({ asarOkundu: false, bulundu: false }).durum, K.OLCULEMEDI);
  const yok = K.maddeSurum({ asarOkundu: true, bulundu: false });
  assert.strictEqual(yok.durum, K.FAIL);
  assert.match(yok.detay, /version\.txt YOK/);
  assert.strictEqual(K.maddeSurum({ asarOkundu: true, bulundu: true, metin: '' }).durum, K.FAIL);
  const harfli = K.maddeSurum({ asarOkundu: true, bulundu: true, metin: '1.13.x' });
  assert.strictEqual(harfli.durum, K.FAIL);
});

// ===========================================================================
// 4) Kanıt penceresi (NSIS yokluk ölçümleri)
// ===========================================================================

test('19 · parcadaAra hem ASCII hem UTF-16LE eşleşmesi bulur', () => {
  const ascii = Buffer.from('xx DetailPrint yy');
  assert.ok(K.parcadaAra(ascii, ['DetailPrint']).has('DetailPrint'));
  const utf16 = Buffer.concat([Buffer.alloc(3), Buffer.from('Yayınevi:', 'utf16le')]);
  assert.ok(K.parcadaAra(utf16, ['Yayınevi:']).has('Yayınevi:'));
  assert.strictEqual(K.parcadaAra(Buffer.from('bos'), ['DetailPrint']).size, 0);
});

test('20 · KANIT PENCERESİ: çapa yoksa "yasaklı yok" PASS DEĞİL, ÖLÇÜLEMEDİ', () => {
  const m = K.maddeSahteIlerleme(new Set()); // hiçbir şey bulunamadı
  assert.strictEqual(m.durum, K.OLCULEMEDI);
  assert.match(m.detay, /YOKLUĞU doğrulanamaz/);
});

test('21 · çapa varken yasaklı metin yoksa PASS, varsa FAIL', () => {
  const temiz = K.maddeSahteIlerleme(new Set(['DetailPrint', 'Yayınevi:', 'Kurulum dizini:']));
  assert.strictEqual(temiz.durum, K.PASS);
  const kirli = K.maddeSahteIlerleme(
    new Set(['DetailPrint', 'Yayınevi:', 'Kurulum dizini:', '[10%]', '[95%]']));
  assert.strictEqual(kirli.durum, K.FAIL);
  assert.match(kirli.detay, /\[10%\]/);
});

test('22 · çapa varken gerekli metin eksikse FAIL (gerçek eksiklik)', () => {
  // Madde 5 üzerinden: çapa ("Yayınevi:") görülmüş ama gerekli metin yok.
  const m = K.maddeYokluk({
    no: 5, ad: 'x', bulunan: new Set(['Yayınevi:']),
    pozitif: ['Yayınevi:'], yasakli: [], gerekli: ['Kurulum dizini:']
  });
  assert.strictEqual(m.durum, K.FAIL);
  assert.match(m.detay, /Kurulum dizini:/);
});

test('23 · maddeKuruluysaAc HER ZAMAN ÖLÇÜLEMEDİ — ve sebebi sıkıştırma DEĞİL', () => {
  const m = K.maddeKuruluysaAc();
  assert.strictEqual(m.durum, K.OLCULEMEDI);
  assert.match(m.detay, /opcode/, 'yanlış teşhis ("sıkıştırılmış başlık") geri gelmemeli');
  // Bu tokenlar derlenmiş NSIS exe'sinde METİN olarak bulunmaz; korpus listesinde
  // aranmaları bir gün SAHTE FAIL üretirdi.
  for (const k of ['customInit', 'CRCCheck', 'SetOutPath', 'Exec', 'IfSilent',
    'INSTALL_REGISTRY_KEY', 'customInstall']) {
    assert.ok(!K.NSIS_KELIMELER.includes(k), `${k} korpusta aranmamalı (opcode/makro adı)`);
  }
});

test('24 · dosyadaAra parça sınırına denk gelen metni kaçırmaz', () => {
  const d = geciciDizin();
  const yol = path.join(d, 'korpus.bin');
  fs.writeFileSync(yol, Buffer.concat([
    Buffer.alloc(1000, 0x41),
    Buffer.from('DetailPrint', 'utf16le'),
    Buffer.alloc(1000, 0x42)
  ]));
  const r = K.dosyadaAra(yol, ['DetailPrint', 'YokBoyleBirSey'], { parcaBoyu: 1004 });
  assert.strictEqual(r.ok, true);
  assert.ok(r.bulunan.has('DetailPrint'));
  assert.ok(!r.bulunan.has('YokBoyleBirSey'));
});

// ===========================================================================
// 5) Diller, yamalar, WebP, boyut+içerik
// ===========================================================================

test('25 · maddeDiller: tam olarak tr+en-US PASS, fazlası FAIL, okunamayan ÖLÇÜLEMEDİ', () => {
  assert.strictEqual(K.maddeDiller(['tr.pak', 'en-US.pak']).durum, K.PASS);
  const fazla = K.maddeDiller(['tr.pak', 'en-US.pak', 'de.pak', 'fr.pak']);
  assert.strictEqual(fazla.durum, K.FAIL);
  assert.match(fazla.detay, /budanmamış: 2/);
  assert.strictEqual(K.maddeDiller(['en-US.pak']).durum, K.FAIL);
  assert.strictEqual(K.maddeDiller(null).durum, K.OLCULEMEDI);
  assert.strictEqual(K.maddeDiller([]).durum, K.FAIL);
});

test('26 · maddeAcilisYamasi ATOMİKLİK: kısmi FAIL, hiç yok FAIL, okunamadı ÖLÇÜLEMEDİ', () => {
  assert.strictEqual(K.maddeAcilisYamasi(ANA_JS_TAM).durum, K.PASS);
  const kismi = K.maddeAcilisYamasi('win = new BrowserWindow({ show: false })');
  assert.strictEqual(kismi.durum, K.FAIL);
  assert.match(kismi.detay, /ATOMİKLİK BOZUK/);
  const hic = K.maddeAcilisYamasi('const a = 1;');
  assert.strictEqual(hic.durum, K.FAIL);
  assert.match(hic.detay, /HİÇ uygulanmamış/);
  assert.strictEqual(K.maddeAcilisYamasi(null).durum, K.OLCULEMEDI);
});

test('27 · maddeGuncellemeOteleme ve maddeOnIsitma işaretleri ölçer', () => {
  assert.strictEqual(K.maddeGuncellemeOteleme(ANA_JS_TAM).durum, K.PASS);
  assert.match(K.maddeGuncellemeOteleme(ANA_JS_TAM).detay, /15 sn/);
  assert.strictEqual(K.maddeGuncellemeOteleme('bos').durum, K.FAIL);
  assert.strictEqual(K.maddeGuncellemeOteleme(null).durum, K.OLCULEMEDI);
  assert.strictEqual(K.maddeOnIsitma(undefined).durum, K.OLCULEMEDI);
});

test('28 · sayfaSinifi mod1 şifreli WebP/PNG\'yi tanır', () => {
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]);
  assert.strictEqual(K.sayfaSinifi(webp), 'webp');
  assert.strictEqual(K.sayfaSinifi(K.mod1(webp)), 'webp-sifreli');
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(16)]);
  assert.strictEqual(K.sayfaSinifi(png), 'png');
  assert.strictEqual(K.sayfaSinifi(K.mod1(png)), 'png-sifreli');
  assert.strictEqual(K.sayfaSinifi(Buffer.alloc(32, 7)), 'bilinmiyor');
});

test('29 · maddeWebp yalnız RAPOR üretir — asla FAIL (karar OKU.md\'de değil)', () => {
  const acik = K.maddeWebp(['webp-sifreli', 'webp', 'png']);
  assert.strictEqual(acik.durum, K.RAPOR);
  assert.match(acik.detay, /kapı AÇIK/);
  const kapali = K.maddeWebp(['png', 'png-sifreli']);
  assert.strictEqual(kapali.durum, K.RAPOR);
  assert.match(kapali.detay, /kapı KAPALI/);
  assert.strictEqual(K.maddeWebp([]).durum, K.OLCULEMEDI);
});

test('30 · boyutIcerikKapisi: BÜYÜK AMA BOŞ = FAIL (SM4 CSS 71 KB dersi)', () => {
  const buyukBos = K.boyutIcerikKapisi({
    ad: 'styles.css', boyut: 71 * 1024, asgariBoyut: 1024,
    icerikVar: false, icerikAciklama: 'kural bloğu'
  });
  assert.strictEqual(buyukBos.durum, K.FAIL);
  assert.match(buyukBos.detay, /içerik boş/);
  assert.strictEqual(K.boyutIcerikKapisi({
    ad: 'a', boyut: 100, asgariBoyut: 1024, icerikVar: true, icerikAciklama: 'x'
  }).durum, K.FAIL);
  assert.strictEqual(K.boyutIcerikKapisi({
    ad: 'a', boyut: 5000, asgariBoyut: 1024, icerikVar: null, icerikAciklama: 'x'
  }).durum, K.OLCULEMEDI);
  assert.strictEqual(K.boyutIcerikKapisi({
    ad: 'a', boyut: null, asgariBoyut: 1024, icerikVar: true, icerikAciklama: 'x'
  }).durum, K.OLCULEMEDI);
  assert.strictEqual(K.boyutIcerikKapisi({
    ad: 'a', boyut: 5000, asgariBoyut: 1024, icerikVar: true, icerikAciklama: '3 girdi'
  }).durum, K.PASS);
});

// ===========================================================================
// 6) asar okuma ve 7z liste çözümü
// ===========================================================================

test('31 · asarBaslikCoz + asarYollariniDuzle + asarYolBul', () => {
  const buf = asarUret({ 'version.txt': '1.13.1.3', 'electron.js': 'kod', 'a/b/pages/1.png': 'X' });
  const c = K.asarBaslikCoz(buf);
  assert.strictEqual(c.ok, true);
  const girdiler = K.asarYollariniDuzle(c.baslik);
  assert.strictEqual(girdiler.length, 3);
  const v = K.asarYolBul(girdiler, 'version.txt');
  assert.strictEqual(v.yol, 'version.txt');
  assert.strictEqual(buf.toString('utf8', c.veriOfseti + v.ofset, c.veriOfseti + v.ofset + v.boyut),
    '1.13.1.3');
  assert.strictEqual(K.asarYolBul(girdiler, 'yok.txt'), null);
  assert.strictEqual(K.asarBaslikCoz(Buffer.alloc(8)).ok, false);
});

test('32 · yedizListeCoz + yukSec NSIS yükünü seçer', () => {
  const ciktı = ['Path = paket.exe', 'Size = 1', '', 'Path = $PLUGINSDIR/nsis7z.dll',
    'Path = app-32.7z', 'Path = Uninstall.exe'].join('\n');
  const adlar = K.yedizListeCoz(ciktı);
  assert.ok(adlar.includes('app-32.7z'));
  assert.ok(!adlar.includes('paket.exe'));
  assert.strictEqual(K.yukSec(adlar), 'app-32.7z');
  assert.strictEqual(K.yukSec(['a.dll', 'b.txt']), null);
});

// ===========================================================================
// 7) Çıkış kodu + uçtan uca
// ===========================================================================

test('33 · cikisKodu: FAIL→1, ÖLÇÜLEMEDİ→3 (--gevsek ile 0), temiz→0', () => {
  const p = K.madde(1, 'a', K.PASS, '');
  const f = K.madde(2, 'b', K.FAIL, '');
  const o = K.madde(3, 'c', K.OLCULEMEDI, '');
  const r = K.madde(4, 'd', K.RAPOR, '');
  assert.strictEqual(K.cikisKodu([p, r]), 0);
  assert.strictEqual(K.cikisKodu([p, o, f]), 1);
  assert.strictEqual(K.cikisKodu([p, o]), 3);
  assert.strictEqual(K.cikisKodu([p, o], { gevsek: true }), 0);
  assert.match(K.ozetSatiri([p, f], 1), /KAPI KAPALI/);
});

test('34 · UÇTAN UCA: temiz ağaç → mimari/dil/yama PASS, 4 parçalı sürüm FAIL, kod 1', () => {
  const d = geciciDizin();
  const kok = path.join(d, 'agac');
  fs.mkdirSync(path.join(kok, 'locales'), { recursive: true });
  fs.mkdirSync(path.join(kok, 'resources'), { recursive: true });
  fs.writeFileSync(path.join(kok, 'locales', 'tr.pak'), 'x');
  fs.writeFileSync(path.join(kok, 'locales', 'en-US.pak'), 'x');
  fs.writeFileSync(path.join(kok, 'Kitap.exe'),
    peUret(K.MAKINE_IA32, { ikon: dibUret(8, 8, () => 0) }));
  const sayfa = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]);
  fs.writeFileSync(path.join(kok, 'resources', 'app.asar'), asarUret({
    'version.txt': '1.13.1.3',
    'electron.js': ANA_JS_TAM,
    'package.json': JSON.stringify({ main: 'electron.js' }),
    'assets/pages/001.png': K.mod1(sayfa),
    'assets/pages/002.png': sayfa,
    'book1/app.config.js': 'window.cfg=1;',
    'book1/index.html': `<html><body><script>/*${'EMPP_ON_GETIRME'}*/</script></body></html>`,
    'dolgu.bin': Buffer.alloc(80 * 1024, 1)
  }));

  const exe = path.join(d, 'paket.exe');
  fs.writeFileSync(exe, peUret(K.MAKINE_IA32, {
    kuyruk: Buffer.from('customInit INSTALL_REGISTRY_KEY SetOutPath Exec IfSilent ' +
      'CRCCheck off DetailPrint Yayınevi: Kurulum dizini: customInstall')
  }));

  const satirlar = [];
  const { kod, maddeler } = K.calis([exe, '--cikarim', kok], (s) => satirlar.push(s));
  const al = (no) => maddeler.find((m) => m.no === no);

  assert.strictEqual(al(1).durum, K.PASS, 'mimari iç exe\'den ölçülmeli');
  assert.strictEqual(al(2).durum, K.PASS, 'ikon köşeleri saydam');
  assert.strictEqual(al(3).durum, K.OLCULEMEDI, 'betik metni derlenmiş exe\'de yok');
  assert.strictEqual(al(4).durum, K.OLCULEMEDI, 'sentetik exe\'de NSIS firstheader yok');
  assert.strictEqual(al(5).durum, K.PASS);
  assert.strictEqual(al(6).durum, K.PASS, 'tr + en-US');
  assert.strictEqual(al(7).durum, K.PASS);
  assert.strictEqual(al(8).durum, K.PASS);
  assert.strictEqual(al(9).durum, K.RAPOR);
  assert.match(al(9).detay, /kapı AÇIK/);
  assert.strictEqual(al(10).durum, K.PASS);
  assert.strictEqual(al(11).durum, K.FAIL, '1.13.1.3 → 4 parça, 350 MB tuzağı');
  assert.strictEqual(al(12).durum, K.PASS);
  assert.strictEqual(kod, 1, 'tek FAIL bile kapıyı kapatır');
  assert.strictEqual(al(11).detay.includes('1.13.1.3'), true,
    'version.txt GERÇEKTEN okunmalı — asar başlığı çözülemezse bu satır ölçüm değildir');
});

test('35 · UÇTAN UCA: çıkarım yapılamayan pakette hiçbir madde körlükten PASS almaz', () => {
  const d = geciciDizin();
  const exe = path.join(d, 'cikarilamaz.exe');
  // NSIS betiği sıkıştırılmış varsayılır: korpusta hiçbir çapa yok.
  fs.writeFileSync(exe, peUret(K.MAKINE_IA32, { kuyruk: Buffer.alloc(4096, 0x5a) }));

  const { kod, maddeler } = K.calis([exe, '--cikarim', path.join(d, 'yok-boyle-dizin')], () => {});
  const al = (no) => maddeler.find((m) => m.no === no);

  assert.strictEqual(al(1).durum, K.OLCULEMEDI, 'dış PE 0x014c PASS üretmemeli');
  assert.strictEqual(al(2).durum, K.OLCULEMEDI);
  assert.strictEqual(al(3).durum, K.OLCULEMEDI);
  assert.strictEqual(al(4).durum, K.OLCULEMEDI);
  assert.strictEqual(al(5).durum, K.OLCULEMEDI);
  // madde 3/4 artık korpus kelimelerine bağlı değil; yine de PASS üretmemeli.
  assert.strictEqual(al(6).durum, K.OLCULEMEDI);
  assert.strictEqual(al(7).durum, K.OLCULEMEDI);
  assert.strictEqual(al(11).durum, K.OLCULEMEDI);
  assert.strictEqual(maddeler.filter((m) => m.durum === K.PASS).length, 0,
    'ölçülemeyen pakette tek bir PASS bile olmamalı');
  assert.notStrictEqual(kod, 0, 'ölçülemedi sessizce yeşile dönmemeli');
});

// ===========================================================================
// 8) NSIS yük yolu — GERİLEME KAPISI (2026-09-21, SM4 1,24 GB paketinde ölçüldü)
//
// Arıza: electron-builder yükü `$PLUGINSDIR/app-32.7z` altına koyar. `yukSec` yolu
// basename'e kırpıyordu; 7z'ye kök seviyesinde eşleşmeyen bir desen gidiyor, 7z
// HİÇBİR ŞEY ÇIKARMADAN ÇIKIŞ 0 dönüyordu. Sonuç: gerçek her pakette ağaç
// ölçümlerinin tamamı (ikon, dil, ana süreç, WebP, version.txt, asar) sessizce
// ÖLÇÜLEMEDİ'ye düşüyor, kapı GERÇEK BİR PAKETTE HİÇBİR ŞEY ÖLÇMÜYORDU.
// ===========================================================================

/**
 * Gerçek 7z'yi taklit eden sahte ikili. Kritik davranış: desen eşleşmese bile
 * ÇIKIŞ 0 döner (7z'nin gerçek davranışı) — yani "status 0" başarı kanıtı değildir.
 * @param {{yukYolu:string, uret:boolean}} p arşivde yükün göründüğü yol; `uret`
 *   false ise `x` hiçbir dosya üretmez ama yine 0 döner.
 */
function sahteYedizKur(p) {
  const d = geciciDizin();
  const bin = path.join(d, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const betik = `#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const a = process.argv.slice(2);
const YUK = ${JSON.stringify(p.yukYolu)};
const URET = ${p.uret ? 'true' : 'false'};
if (a[0] === 'l') {
  process.stdout.write('Path = ' + a[2] + '\\n');
  process.stdout.write('Path = $PLUGINSDIR/System.dll\\n');
  process.stdout.write('Path = ' + YUK + '\\n');
  process.exit(0);
}
if (a[0] === 'x') {
  const cikti = a.find((x) => x.startsWith('-o')).slice(2);
  const arsiv = a[3];
  const desenler = a.slice(4).filter((x) => !x.startsWith('-'));
  if (/\\.exe$/i.test(arsiv)) {
    // NSIS'ten yük çıkarımı: desen arşivdeki TAM yolla eşleşmek zorunda.
    if (URET && desenler.indexOf(YUK) !== -1) {
      const hedef = path.join(cikti, ...YUK.split('/'));
      fs.mkdirSync(path.dirname(hedef), { recursive: true });
      fs.writeFileSync(hedef, 'STUB7Z');
    }
    process.exit(0); // eşleşme olmasa DA çıkış 0 — gerçek 7z böyle davranır
  }
  // Yük arşivinden uygulama ağacı.
  fs.mkdirSync(path.join(cikti, 'locales'), { recursive: true });
  fs.writeFileSync(path.join(cikti, 'locales', 'tr.pak'), 'x');
  process.exit(0);
}
process.exit(1);
`;
  const yol = path.join(bin, '7z');
  fs.writeFileSync(yol, betik);
  fs.chmodSync(yol, 0o755);
  return { d, bin };
}

function pathIle(bin, fn) {
  const eski = process.env.PATH;
  process.env.PATH = `${bin}:${eski}`;
  try {
    return fn();
  } finally {
    process.env.PATH = eski;
  }
}

test('36 · GERİLEME: yukSec TAM arşiv yolunu döner ($PLUGINSDIR kırpılmaz)', () => {
  assert.strictEqual(
    K.yukSec(['paket.exe', '$PLUGINSDIR/System.dll', '$PLUGINSDIR/app-32.7z']),
    '$PLUGINSDIR/app-32.7z',
    'basename\'e kırpmak 7z desenini eşleşmez yapar — ağaç ölçümleri tamamen çöker');
  assert.strictEqual(K.yukSec(['app-32.7z']), 'app-32.7z', 'kök seviyesi bozulmamalı');
  assert.strictEqual(K.yukSec(['$PLUGINSDIR\\app-64.7z']), '$PLUGINSDIR\\app-64.7z');
  // Mimari kanıtı tam yolda da okunabilmeli, yoksa madde 1 dolaylı kanıtı kaybeder.
  assert.strictEqual(K.yukAdindanMimari('$PLUGINSDIR/app-32.7z'), 'ia32');
  assert.strictEqual(K.yukAdindanMimari('$PLUGINSDIR\\app-64.7z'), 'x64');
});

test('37 · arsivYolunuYerelYap arşiv yolunu yerel yola çevirir (\\ ve / birlikte)', () => {
  assert.strictEqual(K.arsivYolunuYerelYap('/t', '$PLUGINSDIR/app-32.7z'),
    path.join('/t', '$PLUGINSDIR', 'app-32.7z'));
  assert.strictEqual(K.arsivYolunuYerelYap('/t', '$PLUGINSDIR\\app-32.7z'),
    path.join('/t', '$PLUGINSDIR', 'app-32.7z'));
  assert.strictEqual(K.arsivYolunuYerelYap('/t', 'app-32.7z'), path.join('/t', 'app-32.7z'));
});

test('38 · GERİLEME: $PLUGINSDIR altındaki yük GERÇEKTEN açılır (ağaç ölçülebilir)', () => {
  const { bin } = sahteYedizKur({ yukYolu: '$PLUGINSDIR/app-32.7z', uret: true });
  const d = geciciDizin();
  const exe = path.join(d, 'paket.exe');
  fs.writeFileSync(exe, 'MZ');
  const gecici = path.join(d, 'gecici');
  fs.mkdirSync(gecici, { recursive: true });

  const r = pathIle(bin, () => K.cikar(exe, gecici, () => {}));
  assert.strictEqual(r.ok, true, `yük açılamadı: ${r.sebep}`);
  assert.strictEqual(r.yuk, '$PLUGINSDIR/app-32.7z');
  assert.ok(fs.existsSync(path.join(r.kok, 'locales', 'tr.pak')),
    'uygulama ağacı çıkmalı — çıkmıyorsa bütün içerik maddeleri körleşir');
});

test('39 · GERİLEME: 7z çıkış 0 verip dosya ÜRETMEZSE bu başarı sayılmaz', () => {
  const { bin } = sahteYedizKur({ yukYolu: '$PLUGINSDIR/app-32.7z', uret: false });
  const d = geciciDizin();
  const exe = path.join(d, 'paket.exe');
  fs.writeFileSync(exe, 'MZ');
  const gecici = path.join(d, 'gecici');
  fs.mkdirSync(gecici, { recursive: true });

  const r = pathIle(bin, () => K.cikar(exe, gecici, () => {}));
  assert.strictEqual(r.ok, false);
  assert.match(r.sebep, /ÜRETİLMEDİ/,
    'sessiz 0 çıkışı 1. adımda yakalanmalı — arıza 2. adıma yıkılmamalı');
  assert.strictEqual(r.yuk, '$PLUGINSDIR/app-32.7z', 'teşhis için yük adı taşınmalı');
});

// ===========================================================================
// 9) Gerçek dosya düzenleri — GERİLEME KAPILARI (2026-09-21, SM4'te ölçüldü)
// ===========================================================================

test('40 · GERİLEME: asar başlığı GERÇEK baytlarla çözülür (JSON +16\'da, +12\'de değil)', () => {
  // SM4 app.asar'ının ilk 16 baytı, dosyadan birebir alındı:
  //   04000000 ccf62f00 c8f62f00 c1f62f00  →  "{\"files\"..."
  // Eski okuyucu jsonBoy'u +8'den okuyup dizeyi +12'den kesiyordu; JSON'un başına
  // 4 baytlık uzunluk öneki karışıyor ve gerçek HİÇBİR asar açılmıyordu.
  const json = Buffer.from(JSON.stringify({ files: { 'a.txt': { size: 2, offset: '0' } } }));
  const dolgu = (4 - (json.length % 4)) % 4;
  const yukBoy = 4 + json.length + dolgu;
  const bas = Buffer.alloc(16);
  bas.writeUInt32LE(4, 0);
  bas.writeUInt32LE(4 + yukBoy, 4);
  bas.writeUInt32LE(yukBoy, 8);
  bas.writeUInt32LE(json.length, 12);
  const buf = Buffer.concat([bas, json, Buffer.alloc(dolgu), Buffer.from('XY')]);

  const c = K.asarBaslikCoz(buf);
  assert.strictEqual(c.ok, true, `gerçek düzen çözülemedi: ${c.sebep}`);
  const g = K.asarYolBul(K.asarYollariniDuzle(c.baslik), 'a.txt');
  assert.strictEqual(buf.toString('utf8', c.veriOfseti + g.ofset, c.veriOfseti + g.ofset + 2),
    'XY', 'veri ofseti gövdeyi göstermiyor');

  // Eski (yanlış) 12 baytlık düzen artık çözülmemeli — mutasyon kapısı.
  const eskiBas = Buffer.alloc(12);
  eskiBas.writeUInt32LE(4, 0);
  eskiBas.writeUInt32LE(yukBoy, 4);
  eskiBas.writeUInt32LE(json.length, 8);
  const eski = Buffer.concat([eskiBas, json, Buffer.alloc(dolgu), Buffer.from('XY')]);
  assert.strictEqual(K.asarBaslikCoz(eski).ok, false,
    'yanlış düzen çözülüyorsa okuyucu hâlâ eski hatayı taşıyor');
});

test('41 · GERİLEME: peRsrcAralik .rsrc\'yi 64 MB ötesinde de bulur', () => {
  // SM4 uygulama exe'si 139,6 MB, .rsrc ham ofseti 141.445.120 → eski sabit 64 MB
  // tavan ikonu kalıcı olarak ölçülemez yapıyordu.
  const uzak = 70 * 1024 * 1024;
  const buf = peUret(K.MAKINE_IA32, { ikon: dibUret(8, 8, () => 0) });
  const a = K.peRsrcAralik(buf);
  assert.strictEqual(a.ok, true, `.rsrc bulunamadı: ${a.sebep}`);
  assert.ok(a.ofset > 0 && a.boy > 0);
  assert.strictEqual(K.peRsrcAralik(Buffer.from('ZZ')).ok, false, 'PE değilse tahmin üretme');
  assert.ok(uzak > 64 * 1024 * 1024, 'bu senaryo 64 MB tavanının ötesindedir');
});

test('42 · GERİLEME: 64 MB tavan sabiti geri gelmemeli (ikon körlüğü)', () => {
  const kaynak = fs.readFileSync(path.join(__dirname, 'windows-paket-kapisi.js'), 'utf8');
  assert.ok(!/Math\.min\(exe\.boyut,\s*64 \* 1024 \* 1024\)/.test(kaynak),
    'sabit 64 MB okuma tavanı geri konmuş — 139 MB\'lık exe\'de .rsrc tamponun dışında kalır');
  assert.ok(/peRsrcAralik\(bas\)/.test(kaynak), '.rsrc penceresi bölüm tablosundan hedeflenmeli');
});

test('43 · NSIS firstheader: CRCCheck off ÖLÇÜLEBİLİR (flags bayrağı sıkıştırılmaz)', () => {
  const fhUret = (flags, onek, kuyruk) => {
    const fh = Buffer.alloc(28);
    fh.writeUInt32LE(flags, 0);
    fh.writeUInt32LE(0xdeadbeef, 4);
    fh.write('NullsoftInst', 8, 'latin1');
    fh.writeUInt32LE(1234, 20);
    fh.writeUInt32LE(28 + kuyruk, 24); // length_of_all_following_data
    return Buffer.concat([Buffer.alloc(onek, 0x41), fh, Buffer.alloc(kuyruk, 0x42)]);
  };
  const kapali = fhUret(K.FH_FLAGS_NO_CRC, 64, 500);
  const r1 = K.nsisIlkBaslik(kapali, kapali.length);
  assert.strictEqual(r1.ok, true);
  assert.strictEqual(r1.ofset, 64);
  assert.strictEqual(r1.noCrc, true);
  assert.strictEqual(K.maddeOnTarama(r1).durum, K.PASS);

  const acik = fhUret(0, 64, 500);
  const r2 = K.nsisIlkBaslik(acik, acik.length);
  assert.strictEqual(r2.noCrc, false);
  const m2 = K.maddeOnTarama(r2);
  assert.strictEqual(m2.durum, K.FAIL);
  assert.match(m2.detay, /CRCCheck on/);

  const zorla = fhUret(K.FH_FLAGS_FORCE_CRC, 64, 500);
  assert.match(K.maddeOnTarama(K.nsisIlkBaslik(zorla, zorla.length)).detay, /CRCCheck force/);

  // BOYUT TUTARLILIĞI ZORUNLU: imza eşleşse bile boyut tutmuyorsa aday atlanır,
  // 1,3 GB gövdede rastgele eşleşme "ölçüm" sayılmaz.
  const sahte = fhUret(K.FH_FLAGS_NO_CRC, 64, 500);
  assert.strictEqual(K.nsisIlkBaslik(sahte, sahte.length + 777).ok, false,
    'boyut tutarsızken firstheader kabul edilmemeli');
  assert.strictEqual(K.maddeOnTarama(K.nsisIlkBaslik(Buffer.alloc(64), 64)).durum, K.OLCULEMEDI);
});

test('44 · GERİLEME: version.txt OKUNAMADI ise FAIL değil ÖLÇÜLEMEDİ', () => {
  const m = K.maddeSurum({ asarOkundu: true, bulundu: true, metin: null, nerede: 'app.asar' });
  assert.strictEqual(m.durum, K.OLCULEMEDI, 'unpacked girdi "boş dosya" diye FAIL edilemez');
  assert.match(m.detay, /OKUNAMADI/);
  // Gerçekten boş dosya hâlâ FAIL.
  assert.strictEqual(K.maddeSurum({ asarOkundu: true, bulundu: true, metin: '' }).durum, K.FAIL);
});

test('45 · GERİLEME: ön-ısıtma KİTAP KÖKÜNÜN index.html\'inde ölçülür, main.js\'te değil', () => {
  // SM4'te ölçüldü: EMPP_ON_GETIRME 5 kitap kökünün 5'inde de VARDI, main.js'te
  // ise HİÇ yoktu. Eski kapı main.js'e bakıp SAĞLAM pakete FAIL veriyordu.
  const kokler = K.kitapKokleri([
    'book1/index.html', 'book1/app.config.js',
    'book2/index.html', 'book2/app.config.js',
    'index.html',                                  // SET menüsü: app.config.js yok
    'book1/assets/45516/htmletk/index.html'        // alt etkinlik: app.config.js yok
  ]);
  assert.deepStrictEqual(kokler, ['book1', 'book2'],
    'kitap kökü motor imzasıyla bulunmalı (index.html + app.config.js), ad desenine göre değil');

  assert.strictEqual(K.maddeOnIsitma({ kokler, isaretli: ['book1', 'book2'] }).durum, K.PASS);
  const hic = K.maddeOnIsitma({ kokler, isaretli: [] });
  assert.strictEqual(hic.durum, K.FAIL);
  assert.match(hic.detay, /HİÇBİRİNDE/);
  const kismi = K.maddeOnIsitma({ kokler, isaretli: ['book1'] });
  assert.strictEqual(kismi.durum, K.FAIL);
  assert.match(kismi.detay, /KARDEŞ KÖR NOKTASI/, 'SET\'te atlanan alt kitap görünmeli');
  // Kök bulunamadıysa "işaret yok" DENEMEZ.
  assert.strictEqual(K.maddeOnIsitma({ kokler: [], isaretli: [] }).durum, K.OLCULEMEDI);

  // Kaynak kapısı: ana süreç betiğinden ölçme yöntemi geri gelmemeli.
  const kaynak = fs.readFileSync(path.join(__dirname, 'windows-paket-kapisi.js'), 'utf8');
  assert.ok(!/maddeOnIsitma\(toplam \? toplam\.anaJs/.test(kaynak),
    'ön-ısıtma yeniden main.js üzerinden ölçülüyor — sağlam paket FAIL alır');
});

// ===========================================================================
// 10) SET güncelleme kanalı — KARAR #11 (madde 13)
//
// ÖLÇÜM KAYNAĞI YALNIZ ÜRETİLEN PAKETTİR: kaynak kod, paketleyici config'i ve
// `EMPP_SET_GUNCELLEME` ortam değişkeni ölçüme GİRMEZ. "Config'in beyan etmesi
// ≠ çıktının taşıması" (karar 6 dersi).
//
// Enjeksiyon hedefi `src/packaging/guncelleyici-enjekte.js`'ten doğrulandı:
// işaret ANA SÜREÇ GİRİŞİNE (electron.js/main.js) girer, index.html'e DEĞİL;
// modül girişin YANINA `empp-set-guncelleyici.js` olarak kopyalanır.
// ===========================================================================

const TEST_ACIK_ANAHTAR = require('crypto').generateKeyPairSync('ed25519').publicKey
  .export({ type: 'spki', format: 'der' }).toString('base64');

/** Paketleyicinin yazdığı tutarlı `empp-set.json` gövdesi (set-kimligi.js düzeni). */
const SET_HARITA_TAM = {
  sema: 2,
  setKimligi: 'sm4-set',
  setKimligiKaynagi: 'acik',
  sebep: null,
  taban: 'https://panel.ornek.test/set-guncelleme',
  tabanKaynagi: 'istek',
  damga: '2026-09-21T00:00:00.000Z',
  // Kabuk tanımı TEK kaynaktan gelir; fixture imzayı SABİT YAZMAZ — yazsaydı
  // tanım değiştiğinde test "yeşil yalan" söylerdi (C3 sapma ölçümü kör olurdu).
  kabukTanimi: K.SET_KABUK_IMZASI,
  kabukDosyaSayisi: 6,
  kabukDosyalari: [
    '43e23fce2b7009474555a77.js', 'a8f43f74c72b65a3dd05.main.js', 'assets2/app.css',
    'core/kurumLogo.png', 'i18n/tr.js', 'index.html'
  ],
  kapsamDisiDallar: [],
  kitapSayisi: 2,
  kitapDizinleri: ['book1', 'book2'],
  // G4 (2026-09-26): manifest imzasını doğrulayacak açık anahtar (gerçek ed25519 SPKI).
  imza: { alg: 'ed25519', acikAnahtar: TEST_ACIK_ANAHTAR, kaynak: 'env' }
};

/** `guncelleyici-enjekte.js` blokUret()'in pakete yazdığı şeklin aynısı. */
const ANA_JS_SET_ENJEKTE = `${ANA_JS_TAM}
/* EMPP_SET_GUNCELLEME: set güncelleyici — ötelenmiş, ateşle-unut */
try {
  (function () {
    var __emppApp = require('electron').app;
    __emppApp.whenReady().then(function () {
      setTimeout(function () {
        var __emppGunc = require('./empp-set-guncelleyici.js');
        Promise.resolve(__emppGunc.guncellemeyiBaslat({ kok: __dirname })).catch(function () {});
      }, 6000);
    }).catch(function () {});
  })();
} catch (e) {}
`;

/** Ölçüm girdisi: her şeyi doğru olan paket; `yama` ile tek tek bozulur. */
function setGirdi(yama = {}) {
  return {
    asarOkundu: true,
    setBulundu: true,
    setMetin: JSON.stringify(SET_HARITA_TAM),
    setNerede: 'app.asar:empp-set.json',
    anaJs: ANA_JS_SET_ENJEKTE,
    anaJsYolu: 'app.asar:electron.js',
    anaJsDizini: '',
    setModulYollari: ['empp-set-guncelleyici.js'],
    setModulIcerik: 'function manifestImzasiGecerliMi(govde, imza, anahtar) {}',
    ...yama
  };
}

test('46 · setHaritasiCoz: OKUNAMADI ≠ BOŞ ≠ BOZUK (üçü ayrı sonuç üretir)', () => {
  const okunamadi = K.setHaritasiCoz(null);
  assert.strictEqual(okunamadi.ok, false);
  assert.strictEqual(okunamadi.okunamadi, true,
    'unpacked girdi "boş dosya" diye FAIL\'e çevrilemez');
  assert.strictEqual(K.setHaritasiCoz(undefined).okunamadi, true);

  const bos = K.setHaritasiCoz('   \n');
  assert.strictEqual(bos.ok, false);
  assert.ok(!bos.okunamadi, 'gerçekten boş dosya ölçülmüştür — ÖLÇÜLEMEDİ değil');

  const bozuk = K.setHaritasiCoz('{ bu json değil');
  assert.strictEqual(bozuk.ok, false);
  assert.ok(!bozuk.okunamadi);
  assert.match(bozuk.sebep, /JSON çözülemedi/);

  assert.strictEqual(K.setHaritasiCoz('[1,2]').ok, false, 'dizi bir set haritası değildir');
  const iyi = K.setHaritasiCoz(JSON.stringify(SET_HARITA_TAM));
  assert.strictEqual(iyi.ok, true);
  assert.strictEqual(iyi.harita.setKimligi, 'sm4-set');
});

test('47 · setHaritasiKusurlari dört tutarlılık şartını AYRI AYRI yakalar', () => {
  assert.deepStrictEqual(K.setHaritasiKusurlari(SET_HARITA_TAM), [],
    'tutarlı harita kusursuz olmalı');

  const kimliksiz = K.setHaritasiKusurlari(
    { ...SET_HARITA_TAM, setKimligi: null, sebep: 'istekte setKimligi verilmedi' });
  assert.strictEqual(kimliksiz.length, 1);
  assert.match(kimliksiz[0], /setKimligi boş\/null/);
  assert.match(kimliksiz[0], /istekte setKimligi verilmedi/, 'pakete yazılan sebep raporlanmalı');
  assert.strictEqual(K.setHaritasiKusurlari({ ...SET_HARITA_TAM, setKimligi: '   ' }).length, 1,
    'yalnız boşluktan ibaret kimlik de boştur');

  for (const kotuTaban of [null, '', 'panel.ornek.test/x', 'ftp://panel/x', 42]) {
    const r = K.setHaritasiKusurlari({ ...SET_HARITA_TAM, taban: kotuTaban });
    assert.strictEqual(r.length, 1, `taban=${JSON.stringify(kotuTaban)} kusur üretmeli`);
    assert.match(r[0], /taban http\(s\) ile başlamıyor/);
  }
  assert.deepStrictEqual(
    K.setHaritasiKusurlari({ ...SET_HARITA_TAM, taban: 'http://panel.ornek.test/x' }), [],
    'http da kabul (yalnız https şartı yok)');

  assert.match(K.setHaritasiKusurlari({ ...SET_HARITA_TAM, kabukDosyalari: [] })[0],
    /kabukDosyalari\[\] boş/);
  assert.match(K.setHaritasiKusurlari({ ...SET_HARITA_TAM, kitapDizinleri: [] })[0],
    /kitapDizinleri\[\] boş/);
  assert.strictEqual(
    K.setHaritasiKusurlari({ ...SET_HARITA_TAM, kabukDosyalari: null, kitapDizinleri: null })
      .length, 2, 'dizi olmayan alanlar da boş sayılır');
});

test('48 · kabukSizintilari: kabuk geçer, KABUK DIŞI girdi sızma sayılır', () => {
  // 2026-09-21: tanım `src/packaging/set-kabuk.js`'e taşındı ve ÖLÇÜMLE genişledi —
  // kök dosyaları + assets2/ + core/ + i18n/. Eski tanım (index.html + set_app.config
  // + assets2/**) gerçek SET ağacında index.html'in yüklediği 12 varlığın 0'ını
  // kapsıyordu; kapı bu kopyayı taşıdığı için üreticinin hatasını GÖREMİYORDU.
  assert.deepStrictEqual(
    K.kabukSizintilari([
      'index.html', 'set_app.config', 'assets2/x/y.png', 'core/kurumLogo.png',
      'i18n/tr.js', 'a8f43f74c72b65a3dd05.main.js', 'package.json'
    ]), [],
    'kabuk tanımı: kök dosyaları + assets2/ + core/ + i18n/');

  const sizan = K.kabukSizintilari([
    'index.html', 'book1/index.html', 'assets2/a.css',
    'book6/assets/pages/001.png', 'book2/app.config.js'
  ]);
  assert.deepStrictEqual(sizan,
    ['book1/index.html', 'book6/assets/pages/001.png', 'book2/app.config.js']);

  // `assets2`/`core` alt ağacı DIŞINDA kalan benzer adlar kabuk değildir.
  assert.deepStrictEqual(K.kabukSizintilari(['assets/app.css']), ['assets/app.css']);
  // Paketleyici/çalışma-anı artefaktları da sızmadır (gerçek ağaçta temp/ 1,8 GB).
  assert.deepStrictEqual(
    K.kabukSizintilari(['node_modules/electron/package.json', 'temp/macos/a.icns']),
    ['node_modules/electron/package.json', 'temp/macos/a.icns']);
  assert.deepStrictEqual(K.kabukSizintilari(['assets2']), ['assets2'],
    'yalnız dizin adı bir kabuk DOSYASI değildir');
  assert.deepStrictEqual(K.kabukSizintilari([null, '']), [null, ''],
    'dize olmayan girdi temiz sayılamaz');
});

test('49 · maddeSetGuncelleme: üç ölçüm de temizse PASS (ve üçü de detayda görünür)', () => {
  const m = K.maddeSetGuncelleme(setGirdi());
  assert.strictEqual(m.durum, K.PASS);
  assert.strictEqual(m.no, 13);
  assert.match(m.detay, /A\) empp-set\.json tutarlı/);
  assert.match(m.detay, /B\) app\.asar:electron\.js işaret \+ require taşıyor/);
  assert.match(m.detay, /C1\) sızma yok/);
  assert.match(m.detay, /C2\) kapsam tam/);
  assert.match(m.detay, /C3\) tanım aynı/);
});

test('50 · maddeSetGuncelleme: ÖLÇEMEDİĞİNİ ASLA PASS SAYMAZ', () => {
  // Ağaç hiç açılmadı.
  const acilmadi = K.maddeSetGuncelleme({ asarOkundu: false });
  assert.strictEqual(acilmadi.durum, K.OLCULEMEDI);
  assert.match(acilmadi.detay, /uygulama içeriği okunamadı/);

  // Dosya var ama asar'da "unpacked" — içeriği okunamadı. BOŞ DEĞİL.
  const unpacked = K.maddeSetGuncelleme(setGirdi({ setMetin: null }));
  assert.strictEqual(unpacked.durum, K.OLCULEMEDI);
  assert.match(unpacked.detay, /OKUNAMADI/);
  assert.match(unpacked.detay, /SÖYLENEMEZ/);

  // Ana süreç betiği okunamadı → enjeksiyon yarısı ölçülemez.
  const girissiz = K.maddeSetGuncelleme(setGirdi({ anaJs: null }));
  assert.strictEqual(girissiz.durum, K.OLCULEMEDI);
  assert.match(girissiz.detay, /ana süreç giriş betiği/);

  // Ağaç listesi yok → modül varlığı ölçülemez.
  assert.strictEqual(K.maddeSetGuncelleme(setGirdi({ setModulYollari: null })).durum,
    K.OLCULEMEDI);

  // FAIL bir KANITTIR: ölçülemeyen başka yarım onu silemez.
  const karisik = K.maddeSetGuncelleme(setGirdi({ setBulundu: false, anaJs: null }));
  assert.strictEqual(karisik.durum, K.FAIL, 'kanıtlanmış eksik, ölçülemeyen yarım yüzünden ' +
    'ÖLÇÜLEMEDİ\'ye düşürülemez');
  assert.match(karisik.detay, /ÖLÇÜLEMEYEN:/, 'ölçülemeyen yarım yine de raporlanmalı');
});

test('51 · maddeSetGuncelleme: empp-set.json yoksa / tutarsızsa FAIL', () => {
  const yok = K.maddeSetGuncelleme(setGirdi({ setBulundu: false, setMetin: null }));
  assert.strictEqual(yok.durum, K.FAIL);
  assert.match(yok.detay, /empp-set\.json pakette YOK/);

  const bozuk = K.maddeSetGuncelleme(setGirdi({ setMetin: '{yarim' }));
  assert.strictEqual(bozuk.durum, K.FAIL);
  assert.match(bozuk.detay, /JSON çözülemedi/);

  const kimliksiz = K.maddeSetGuncelleme(setGirdi({
    setMetin: JSON.stringify({ ...SET_HARITA_TAM, setKimligi: null })
  }));
  assert.strictEqual(kimliksiz.durum, K.FAIL);
  assert.match(kimliksiz.detay, /kanal KAPALI/);

  const tabansiz = K.maddeSetGuncelleme(setGirdi({
    setMetin: JSON.stringify({ ...SET_HARITA_TAM, taban: 'panel-yok' })
  }));
  assert.strictEqual(tabansiz.durum, K.FAIL);
  assert.match(tabansiz.detay, /taban http\(s\)/);

  const bosEnvanter = K.maddeSetGuncelleme(setGirdi({
    setMetin: JSON.stringify({ ...SET_HARITA_TAM, kabukDosyalari: [], kitapDizinleri: [] })
  }));
  assert.strictEqual(bosEnvanter.durum, K.FAIL);
  assert.match(bosEnvanter.detay, /kabukDosyalari\[\] boş/);
  assert.match(bosEnvanter.detay, /kitapDizinleri\[\] boş/);
});

test('52 · TUZAK: işaret ANA SÜREÇ GİRİŞİNDE aranır — yetim modül/yetim yama FAIL', () => {
  // Modül pakette duruyor ama giriş onu hiç çağırmıyor: çalışma anında KOŞMAZ.
  // (Modülün KENDİSİ de "EMPP_SET_GUNCELLEME" taşır — "ağaçta var mı" sorusu
  //  bunu sahte GEÇTİ'ye çevirirdi.)
  const yetimModul = K.maddeSetGuncelleme(setGirdi({ anaJs: ANA_JS_TAM }));
  assert.strictEqual(yetimModul.durum, K.FAIL);
  assert.match(yetimModul.detay, /YETİM MODÜL/);

  // İşaret index.html'e konmuş, girişe konmamış (madde 10'un tuzağının aynası).
  const yanlisHedef = K.maddeSetGuncelleme(setGirdi({
    anaJs: ANA_JS_TAM,
    setModulYollari: ['empp-set-guncelleyici.js']
  }));
  assert.strictEqual(yanlisHedef.durum, K.FAIL,
    'index.html\'de işaret görmek girişin yamalı olduğu anlamına GELMEZ');

  // Ne işaret ne modül: enjeksiyon adımı hiç koşmamış.
  const hic = K.maddeSetGuncelleme(setGirdi({ anaJs: ANA_JS_TAM, setModulYollari: [] }));
  assert.strictEqual(hic.durum, K.FAIL);
  assert.match(hic.detay, /enjeksiyon HİÇ uygulanmamış/);

  // Giriş çağırıyor ama modül pakette yok → require açılışta düşer.
  const yetimYama = K.maddeSetGuncelleme(setGirdi({ setModulYollari: [] }));
  assert.strictEqual(yetimYama.durum, K.FAIL);
  assert.match(yetimYama.detay, /YETİM YAMA/);

  const yanlisDizin = K.maddeSetGuncelleme(setGirdi({
    setModulYollari: ['book1/empp-set-guncelleyici.js']
  }));
  assert.strictEqual(yanlisDizin.durum, K.FAIL);
  assert.match(yanlisDizin.detay, /YETİM YAMA/);
  assert.match(yanlisDizin.detay, /book1\/empp-set-guncelleyici\.js/);

  // Giriş alt dizindeyse modül de orada aranmalı (sahte FAIL üretmemeli).
  const altDizin = K.maddeSetGuncelleme(setGirdi({
    anaJsYolu: 'app.asar:build/electron.js',
    anaJsDizini: 'build',
    setModulYollari: ['build/empp-set-guncelleyici.js']
  }));
  assert.strictEqual(altDizin.durum, K.PASS);
});

test('53 · maddeSetGuncelleme: kabuk envanterine KİTAP İÇERİĞİ sızmışsa FAIL', () => {
  const m = K.maddeSetGuncelleme(setGirdi({
    setMetin: JSON.stringify({
      ...SET_HARITA_TAM,
      kabukDosyalari: ['index.html', 'set_app.config', 'assets2/a.css',
        'book1/index.html', 'book6/assets/pages/001.png']
    })
  }));
  assert.strictEqual(m.durum, K.FAIL);
  assert.match(m.detay, /KABUK DIŞI GİRDİ SIZMIŞ/);
  assert.match(m.detay, /book1\/index\.html/);
  assert.match(m.detay, /book6\/assets\/pages\/001\.png/);
  assert.match(m.detay, /2 girdi/);
});

test('54 · UÇTAN UCA: kanal GERÇEK asar\'dan ölçülür — taşıyan PASS, taşımayan FAIL', () => {
  const d = geciciDizin();

  const agacKur = (adi, ekDosyalar) => {
    const kok = path.join(d, adi);
    fs.mkdirSync(path.join(kok, 'locales'), { recursive: true });
    fs.mkdirSync(path.join(kok, 'resources'), { recursive: true });
    fs.writeFileSync(path.join(kok, 'locales', 'tr.pak'), 'x');
    fs.writeFileSync(path.join(kok, 'locales', 'en-US.pak'), 'x');
    fs.writeFileSync(path.join(kok, 'Kitap.exe'),
      peUret(K.MAKINE_IA32, { ikon: dibUret(8, 8, () => 0) }));
    fs.writeFileSync(path.join(kok, 'resources', 'app.asar'), asarUret({
      'version.txt': '1.13.1',
      'package.json': JSON.stringify({ main: 'electron.js' }),
      'book1/app.config.js': 'window.cfg=1;',
      'book1/index.html': `<html><body><script>/*${'EMPP_ON_GETIRME'}*/</script></body></html>`,
      'dolgu.bin': Buffer.alloc(80 * 1024, 1),
      ...ekDosyalar
    }));
    return kok;
  };

  const exe = path.join(d, 'paket.exe');
  fs.writeFileSync(exe, peUret(K.MAKINE_IA32, {
    kuyruk: Buffer.from('DetailPrint Yayınevi: Kurulum dizini:')
  }));

  // (a) Kanalı TAŞIYAN paket.
  const tasiyan = agacKur('tasiyan', {
    'electron.js': ANA_JS_SET_ENJEKTE,
    'empp-set.json': JSON.stringify(SET_HARITA_TAM, null, 2),
    // G4 (2026-09-26): gerçek modül imza doğrulamasını taşır (madde 13-D bunu arar).
    'empp-set-guncelleyici.js': `/* ${'EMPP_SET_GUNCELLEME'} çalışma anı */ function manifestImzasiGecerliMi() {} module.exports={};`
  });
  const r1 = K.calis([exe, '--cikarim', tasiyan], () => {});
  const m1 = r1.maddeler.find((m) => m.no === 13);
  assert.ok(m1, 'madde 13 kapıya bağlanmamış');
  assert.strictEqual(m1.durum, K.PASS, `kanal taşıyan pakette PASS bekleniyordu: ${m1.detay}`);
  assert.match(m1.detay, /sm4-set/, 'kimlik GERÇEKTEN asar\'dan okunmalı, varsayılmamalı');

  // (b) Kanal EKLENMEDEN ÖNCE üretilmiş paket (eldeki SM4 exe\'si gibi).
  const tasimayan = agacKur('tasimayan', { 'electron.js': ANA_JS_TAM });
  const r2 = K.calis([exe, '--cikarim', tasimayan], () => {});
  const m2 = r2.maddeler.find((m) => m.no === 13);
  assert.strictEqual(m2.durum, K.FAIL, 'kanalsız paket GEÇTİ alamaz');
  assert.match(m2.detay, /empp-set\.json pakette YOK/);
  assert.match(m2.detay, /enjeksiyon HİÇ uygulanmamış/);
  assert.strictEqual(r2.kod, 1, 'FAIL kapıyı kapatmalı');

  // ÖLÇÜM KAYNAĞI KAPISI: kapı kaynak koda/config'e/env'e bakmamalı.
  const kaynak = fs.readFileSync(path.join(__dirname, 'windows-paket-kapisi.js'), 'utf8');
  assert.ok(!/require\(['"][^'"]*set-kimligi['"]\)/.test(kaynak),
    'kapı paketleyici modülünü require ediyor — ölçüm çıktıdan değil kaynaktan yapılır');
  assert.ok(!/process\.env\.EMPP_SET_GUNCELLEME/.test(kaynak),
    'kapı ortam değişkenine bakıyor — "config beyan etti" ölçüm değildir');
});

// ===========================================================================
// 55-57 · KABUK TANIMI — TEK KAYNAK + KÖR NOKTA ÖLÇÜMÜ (2026-09-21)
// Kapı eskiden tanımın KOPYASINI taşıyordu; üreticinin hatasını göremiyordu.
// ===========================================================================

test('55 · SÖZLEŞME: kapı kabuk tanımını ÜRETİCİYLE aynı modülden alır (kopya YOK)', () => {
  const tanim = require('../src/packaging/set-kabuk');
  const uretici = require('../src/packaging/set-kimligi');
  assert.strictEqual(K.SET_KABUK, tanim, 'kapı kendi kabuk tanımını taşıyor');
  assert.strictEqual(uretici.KABUK, tanim, 'üretici kendi kabuk tanımını taşıyor');
  assert.strictEqual(K.kabukSizintilari, tanim.kabukSizintilari);
  assert.strictEqual(K.SET_KABUK_IMZASI, uretici.KABUK_IMZASI,
    'iki taraf ayrışırsa kapının GEÇTİ\'si anlamsızdır');

  // ÖLÇÜM KAYNAĞI KAPISI ZAYIFLAMADI: kapı `set-kimligi` (I/O + paketleme) modülünü
  // hâlâ require ETMEZ (test 54'teki sentinel). İthal edilen `set-kabuk` SAF TANIMDIR
  // ve kendisi HİÇBİR ŞEY require etmez — üzerinden paketleyici koduna geçilemez.
  const tanimKaynagi = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'packaging', 'set-kabuk.js'), 'utf8');
  assert.ok(!/\brequire\s*\(/.test(tanimKaynagi),
    'set-kabuk.js bağımlılık çekiyor — kapının "yalnız stdlib" sözü kırılır');
  const kapiKaynagi = fs.readFileSync(path.join(__dirname, 'windows-paket-kapisi.js'), 'utf8');
  assert.match(kapiKaynagi, /require\(['"][^'"]*set-kabuk['"]\)/,
    'kapı tanımı ithal etmiyorsa kopya taşıyor demektir');
});

test('56 · C2: kabuk tanımının KAPSAMADIĞI kök dizin FAIL üretir, yokluğu ÖLÇÜLEMEDİ', () => {
  const kapsamli = K.maddeSetGuncelleme(setGirdi({
    setMetin: JSON.stringify({ ...SET_HARITA_TAM, kapsamDisiDallar: ['fonts', 'dist'] })
  }));
  assert.strictEqual(kapsamli.durum, 'FAIL');
  assert.match(kapsamli.detay, /KABUK TANIMI BU AĞACI KAPSAMIYOR/);
  assert.match(kapsamli.detay, /fonts, dist/);

  // Alan hiç yoksa "temiz" DEĞİL — eski şemadan gelen paket ölçülememiştir.
  const eskiSema = { ...SET_HARITA_TAM };
  delete eskiSema.kapsamDisiDallar;
  const olculemez = K.maddeSetGuncelleme(setGirdi({ setMetin: JSON.stringify(eskiSema) }));
  assert.strictEqual(olculemez.durum, 'ÖLÇÜLEMEDİ');
  assert.match(olculemez.detay, /kapsamDisiDallar\[\] alanı yok/);
});

test('57 · C3: üreticinin kabuk tanımı kapınınkinden FARKLIYSA FAIL (sessiz sapma yok)', () => {
  const sapik = K.maddeSetGuncelleme(setGirdi({
    setMetin: JSON.stringify({
      ...SET_HARITA_TAM,
      kabukTanimi: 'v1 dizin=assets2 artefakt= kitap=^book\\d+$ durum=empp-set.json|.empp*'
    })
  }));
  assert.strictEqual(sapik.durum, 'FAIL');
  assert.match(sapik.detay, /TANIM SAPMASI/);

  const imzasiz = { ...SET_HARITA_TAM };
  delete imzasiz.kabukTanimi;
  const olculemez = K.maddeSetGuncelleme(setGirdi({ setMetin: JSON.stringify(imzasiz) }));
  assert.strictEqual(olculemez.durum, 'ÖLÇÜLEMEDİ');
  assert.match(olculemez.detay, /kabukTanimi imzası pakette yok/);
});

// ===========================================================================
// 13) `asar: false` düzeni — madde 12'nin KABI değişir, SORUSU değişmez
//
// KARAR (2026-09-21): Windows NSIS paketinde asar kapatıldı
// (src/packaging/windows-asarsiz.js). O düzende uygulama içeriği
// `resources/app.asar` DOSYASI değil, `resources/app/` AĞACIDIR. Madde 12
// "Uygulama içeriği (boyut VE içerik birlikte)" adını taşır — "app.asar var mı"
// DEĞİL. Bu yüzden madde GEÇERLİDİR ve yeni düzende GEÇMELİDİR; ÖLÇÜLEMEDİ'ye
// bağlamak BOŞ bir resources/app ağacını da ölçülemez sayardı (sahte-yeşilin
// diğer yüzü).
// ===========================================================================

function acikAppAgaci(opts = {}) {
  const kok = geciciDizin();
  const app = path.join(kok, 'resources', 'app');
  if (opts.bos) {
    fs.mkdirSync(app, { recursive: true });
    return { kok, app };
  }
  fs.mkdirSync(path.join(app, 'assets', 'book1', 'pages'), { recursive: true });
  fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({ main: 'electron.js' }));
  fs.writeFileSync(path.join(app, 'electron.js'), ANA_JS_TAM);
  fs.writeFileSync(path.join(app, 'version.txt'), '1.13.1');
  fs.writeFileSync(path.join(app, 'index.html'), '<html><!-- EMPP_ON_GETIRME --></html>');
  // 64 KiB asgari boyutu aşacak tek bir dolgu + gerçek PNG imzalı sayfalar.
  fs.writeFileSync(path.join(app, 'dolgu.bin'), Buffer.alloc(128 * 1024, 7));
  const pngBas = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(56, 1)]);
  for (let i = 1; i <= 5; i++) {
    fs.writeFileSync(path.join(app, 'assets', 'book1', 'pages', `${i}.png`), pngBas);
  }
  return { kok, app };
}

test('58 · asar: false düzeni — madde 12 GEÇER ve kabı AÇIKÇA söyler', () => {
  const { kok } = acikAppAgaci();
  const toplam = K.agactanTopla(kok);
  assert.strictEqual(toplam.icerikKabi, 'resources/app',
    'açık ağaç düzeninde içerik kabı resources/app olmalı');
  assert.ok(toplam.asarBoyut > 64 * 1024, `ağaç boyutu ölçülmemiş: ${toplam.asarBoyut}`);
  assert.ok(toplam.asarGirdiSayisi >= 9, `dosya sayısı eksik: ${toplam.asarGirdiSayisi}`);

  const m = K.maddeAsar(toplam);
  assert.strictEqual(m.no, 12);
  assert.strictEqual(m.durum, K.PASS);
  assert.match(m.detay, /resources\/app\/ \(asar: false\)/,
    'rapora bakan hangi düzenin ölçüldüğünü GÖRMELİ');
  assert.match(m.detay, /dosya yerinde/);
  assert.ok(!/app\.asar:/.test(m.detay), 'olmayan bir kabın adı raporda geçmemeli');
});

test('59 · SAHTE-YEŞİL FRENİ: BOŞ resources/app ağacı FAIL — ÖLÇÜLEMEDİ değil', () => {
  const { kok } = acikAppAgaci({ bos: true });
  const toplam = K.agactanTopla(kok);
  assert.strictEqual(toplam.icerikKabi, 'resources/app');
  assert.strictEqual(toplam.asarGirdiSayisi, 0);
  const m = K.maddeAsar(toplam);
  assert.strictEqual(m.durum, K.FAIL,
    'içeriksiz paket bu düzende de yakalanmalı — kapının varlık sebebi bu');

  // İçerik VAR ama boyut asgarinin altındaysa da FAIL (boyut tek başına kapı değil,
  // ama asgari boyut da düşerse paket gerçek içerik taşımıyordur).
  const kucuk = K.maddeAsar({ icerikKabi: 'resources/app', asarBoyut: 1024, asarGirdiSayisi: 3 });
  assert.strictEqual(kucuk.durum, K.FAIL);
});

test('60 · İKİ KAP DA YOKSA madde 12 ÖLÇÜLEMEDİ (yokluk PASS değildir)', () => {
  const kok = geciciDizin();
  fs.mkdirSync(path.join(kok, 'resources'), { recursive: true });
  const toplam = K.agactanTopla(kok);
  assert.strictEqual(toplam.icerikKabi, null);
  const m = K.maddeAsar(toplam);
  assert.strictEqual(m.durum, K.OLCULEMEDI);
  assert.match(m.detay, /içerik kabı yok/);

  // calis() akışındaki "çıkarım yapılamadı" yedeği de ÖLÇÜLEMEDİ üretmeli.
  const yok = K.maddeAsar({ icerikKabi: null, asarBoyut: null, asarGirdiSayisi: null });
  assert.strictEqual(yok.durum, K.OLCULEMEDI);
});

test('61 · asar: false düzeninde madde 9 (WebP kapısı) KÖRLEŞMEZ — sayfalar örneklenir', () => {
  const { kok } = acikAppAgaci();
  const toplam = K.agactanTopla(kok);
  assert.ok(toplam.sayfaSiniflari.length > 0,
    'açık ağaçta sayfa örneklenmiyorsa madde 9 bu düzende sessizce körelir');
  const m = K.maddeWebp(toplam.sayfaSiniflari);
  assert.strictEqual(m.no, 9);
  assert.strictEqual(m.durum, K.RAPOR);
  assert.match(m.detay, /kapı KAPALI/, 'düz PNG imzalı sayfalar → kapı KAPALI raporlanmalı');

  // version.txt ve ana JS de açık ağaçtan okunabilmeli (madde 11 ve 7/8 körleşmesin).
  assert.strictEqual(toplam.surumNerede, 'resources/app/version.txt');
  assert.strictEqual(toplam.anaJsYolu, 'resources/app/electron.js');
});

test('62 · ÖLÇÜM: 7z çıkarım desenleri resources/app AĞACININ TAMAMINI açar', (t) => {
  const { spawnSync } = require('child_process');
  const yediz = ['7z', '7zz', '7za', '7zr']
    .map((ad) => spawnSync('which', [ad], { encoding: 'utf8' }))
    .find((r) => r.status === 0 && r.stdout.trim());
  if (!yediz) {
    // ÖLÇEMEDİĞİNİ PASS SAYMA: sessizce geçme, atlandığını SÖYLE.
    t.skip('7z sistemde yok — çıkarım deseni ölçülemedi');
    return;
  }
  const yedizYolu = yediz.stdout.trim();
  const d = geciciDizin();
  const kaynak = path.join(d, 'kaynak');
  const derin = path.join(kaynak, 'resources', 'app', 'assets', 'book1', 'pages');
  fs.mkdirSync(derin, { recursive: true });
  fs.mkdirSync(path.join(kaynak, 'locales'), { recursive: true });
  fs.writeFileSync(path.join(derin, '1.png'), 'sayfa');
  fs.writeFileSync(path.join(kaynak, 'resources', 'app', 'package.json'), '{}');
  fs.writeFileSync(path.join(kaynak, 'resources', 'app', 'version.txt'), '1.13.1');
  fs.writeFileSync(path.join(kaynak, 'locales', 'tr.pak'), 'tr');
  fs.writeFileSync(path.join(kaynak, 'SM4.exe'), 'MZ');
  // Çıkarımın DIŞINDA kalması gereken dal (deseni gereğinden geniş yazmadığımızın kanıtı).
  fs.mkdirSync(path.join(kaynak, 'resources', 'baskaklasor'), { recursive: true });
  fs.writeFileSync(path.join(kaynak, 'resources', 'baskaklasor', 'x.txt'), 'x');

  const arsiv = path.join(d, 'app-32.7z');
  const a = spawnSync(yedizYolu, ['a', '-t7z', arsiv, '.'], { cwd: kaynak, encoding: 'utf8' });
  assert.strictEqual(a.status, 0, `7z arşiv üretemedi: ${a.stderr}`);

  const cikti = path.join(d, 'cikti');
  const x = spawnSync(yedizYolu,
    ['x', '-y', `-o${cikti}`, arsiv, ...K.CIKARIM_DESENLERI, '-r'], { encoding: 'utf8' });
  assert.strictEqual(x.status, 0, `7z çıkaramadı: ${x.stderr}`);

  const app = path.join(cikti, 'resources', 'app');
  for (const g of ['package.json', 'version.txt', 'assets/book1/pages/1.png']) {
    assert.ok(fs.existsSync(path.join(app, ...g.split('/'))),
      `çıkarım eksik: resources/app/${g} — asar: false düzeninde kapı kör kalırdı`);
  }
  assert.ok(fs.existsSync(path.join(cikti, 'locales', 'tr.pak')), 'locales çıkmadı');
  assert.ok(fs.existsSync(path.join(cikti, 'SM4.exe')), 'iç exe çıkmadı');

  // Ölçüm zinciri gerçekten kapanıyor mu: açılan ağaçtan madde 12 üretilebiliyor mu?
  const toplam = K.agactanTopla(cikti);
  assert.strictEqual(toplam.icerikKabi, 'resources/app');
  assert.strictEqual(toplam.asarGirdiSayisi, 3);
});

test('63 · agacOlcusu: stat edilemeyen girdi SAYIMA GİRMEZ (şüphede eksik say)', () => {
  const d = geciciDizin();
  fs.mkdirSync(path.join(d, 'alt'), { recursive: true });
  fs.writeFileSync(path.join(d, 'a.txt'), 'abc');
  fs.writeFileSync(path.join(d, 'alt', 'b.txt'), 'de');
  fs.symlinkSync(path.join(d, 'yok-boyle-bir-sey'), path.join(d, 'kirik-bag'));
  const o = K.agacOlcusu(d);
  assert.strictEqual(o.dosyaSayisi, 2, 'kırık sembolik bağ dosya sayılmamalı');
  assert.strictEqual(o.baytlar, 5);

  // Derinlik tavanı: asar tarafıyla simetri için geniş; 6 katmandan derin içerik de sayılır.
  const derin = path.join(d, 'a/b/c/d/e/f/g/h');
  fs.mkdirSync(derin, { recursive: true });
  fs.writeFileSync(path.join(derin, 'derin.txt'), 'xyz');
  assert.strictEqual(K.agacOlcusu(d).dosyaSayisi, 3,
    'derin dosya sayılmıyorsa boyut ölçümü sessizce eksik kalır');
});

// ===========================================================================
// 13) Giriş dosyası TEK KAYNAK (2026-09-21 onarımı — Super Monsters 4 vakası)
//
// Ölçülmüş kusur: açık ağaç dalı package.json.main'i hiç okumuyor, sabit
// ['electron.js','main.js'] listesini deniyordu. Gerçek pakette main=main.js
// idi ve yama yalnız main.js'teydi; kapı electron.js'i (yamasız orijinal kaynak)
// seçip "yama HİÇ uygulanmamış" diye YALAN FAIL üretti. Bu blok o vakayı ve
// üç kaçış yolunu (paket.json yok / main hedefi eksik / iki dal aynı hükmü
// vermeli) sabitler.
// ===========================================================================

/** asar:false ağacı — giriş dosyası yerleşimini test başına özelleştirir. */
function acikAppAgaciGiris({ main, dosyalar }) {
  const kok = geciciDizin();
  const app = path.join(kok, 'resources', 'app');
  fs.mkdirSync(app, { recursive: true });
  if (main !== undefined) {
    fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({ main }));
  }
  for (const [ad, icerik] of Object.entries(dosyalar || {})) {
    fs.writeFileSync(path.join(app, ad), icerik);
  }
  // madde 12'nin asgari boyutunu bu testlerde ölçmüyoruz ama agactanTopla'nın
  // diğer alanları patlamasın diye küçük bir dolgu yeterli.
  fs.writeFileSync(path.join(app, 'dolgu.bin'), Buffer.alloc(1024, 7));
  return { kok, app };
}

test('64 · GİRİŞ TEK KAYNAK: main.js + electron.js birlikte, main="main.js", ' +
  'yama yalnız main.js\'te → PASS (SM4 regresyonu, açık ağaç)', () => {
  const { kok } = acikAppAgaciGiris({
    main: 'main.js',
    dosyalar: {
      'electron.js': 'const x = 1; // yayıncının yamasız orijinal kaynağı',
      'main.js': ANA_JS_TAM
    }
  });
  const toplam = K.agactanTopla(kok);
  assert.strictEqual(toplam.girisKaynagi, 'package.json',
    'main alanı geçerliyse kaynak package.json olmalı');
  assert.strictEqual(toplam.anaJsYolu, 'resources/app/main.js',
    'package.json.main="main.js" iken electron.js seçilmemeli');
  const m = K.maddeAcilisYamasi(toplam.anaJs);
  assert.strictEqual(m.durum, K.PASS,
    `SM4 regresyonu geri geldi: ${m.detay}`);
});

test('65 · SAHTE-YEŞİL FRENİ: yama GİRİŞ OLMAYAN dosyada (electron.js) ise, ' +
  'gerçek girişte (main.js) yoksa FAIL sayılır', () => {
  const { kok } = acikAppAgaciGiris({
    main: 'main.js',
    dosyalar: {
      // Yama YANLIŞ dosyada — gerçek giriş main.js yamasız.
      'electron.js': ANA_JS_TAM,
      'main.js': 'const x = 1; // yamasız gerçek giriş'
    }
  });
  const toplam = K.agactanTopla(kok);
  assert.strictEqual(toplam.anaJsYolu, 'resources/app/main.js');
  const m = K.maddeAcilisYamasi(toplam.anaJs);
  assert.strictEqual(m.durum, K.FAIL,
    'giriş OLMAYAN dosyadaki yama sayılmamalı — kapı burada gevşerse sahte-yeşil geri gelir');
});

test('66 · package.json YOK → sabit listeye düşer, girisKaynagi bunu GÖRÜNÜR kılar', () => {
  const { kok } = acikAppAgaciGiris({ dosyalar: { 'main.js': ANA_JS_TAM } });
  const toplam = K.agactanTopla(kok);
  assert.strictEqual(toplam.girisKaynagi, 'varsayilan-liste');
  assert.strictEqual(toplam.anaJsYolu, 'resources/app/main.js');
  assert.match(toplam.girisDusmeNotu || '', /yok\/okunamadı/,
    'düşme sebebi raporda görünür olmalı');
});

test('67 · main var ama gösterdiği dosya YOK → anlaşılır düşme, çökme değil', () => {
  const { kok } = acikAppAgaciGiris({
    main: 'main.js', // main.js YAZILMADI — pakette yok
    dosyalar: { 'electron.js': ANA_JS_TAM }
  });
  const toplam = K.agactanTopla(kok);
  assert.strictEqual(toplam.girisKaynagi, 'varsayilan-liste',
    'main hedefi eksikse sabit listeye düşülmeli, çökme değil');
  assert.strictEqual(toplam.anaJsYolu, 'resources/app/electron.js');
  assert.match(toplam.girisDusmeNotu || '', /main\.js.*bulunamadı/,
    'düşme sebebi "main.js pakette yok" olmalı');
  // Maddeler bu düşmede de anlaşılır sonuç üretir (çökme değil, gerçek FAIL/PASS).
  const m = K.maddeAcilisYamasi(toplam.anaJs);
  assert.strictEqual(m.durum, K.PASS);
});

test('68 · SÖZLEŞME: asar dalı ile açık ağaç dalı AYNI fixture içerikte AYNI ' +
  'girişi seçer ve AYNI hükmü verir', () => {
  const dosyalar = {
    'package.json': JSON.stringify({ main: 'main.js' }),
    'electron.js': 'const x = 1; // yamasız kopya',
    'main.js': ANA_JS_TAM
  };

  // Açık ağaç dalı.
  const kokAcik = geciciDizin();
  const appAcik = path.join(kokAcik, 'resources', 'app');
  fs.mkdirSync(appAcik, { recursive: true });
  for (const [ad, icerik] of Object.entries(dosyalar)) {
    fs.writeFileSync(path.join(appAcik, ad), icerik);
  }
  const toplamAcik = K.agactanTopla(kokAcik);

  // asar dalı — AYNI dosyalar, gerçek asar başlığı içinde.
  const kokAsar = geciciDizin();
  fs.mkdirSync(path.join(kokAsar, 'resources'), { recursive: true });
  fs.writeFileSync(path.join(kokAsar, 'resources', 'app.asar'), asarUret(dosyalar));
  const toplamAsar = K.agactanTopla(kokAsar);

  assert.strictEqual(toplamAcik.girisKaynagi, 'package.json');
  assert.strictEqual(toplamAsar.girisKaynagi, 'package.json');
  assert.strictEqual(toplamAcik.anaJsYolu, 'resources/app/main.js');
  assert.strictEqual(toplamAsar.anaJsYolu, 'app.asar:main.js');

  const mAcik = K.maddeAcilisYamasi(toplamAcik.anaJs);
  const mAsar = K.maddeAcilisYamasi(toplamAsar.anaJs);
  assert.strictEqual(mAcik.durum, K.PASS);
  assert.strictEqual(mAsar.durum, K.PASS);
  assert.strictEqual(mAcik.durum, mAsar.durum,
    'iki dal aynı fixture içerikte FARKLI hüküm verirse tek-kaynak sözleşmesi bozulmuştur');
});

test('69 · girisDosyasiCoz saf fonksiyon: kaynak/düşme sözleşmesi', () => {
  const varMi = (ler) => (ad) => ler.includes(ad);

  const a = K.girisDosyasiCoz('main.js', varMi(['electron.js', 'main.js']));
  assert.deepStrictEqual([a.ad, a.kaynak], ['main.js', 'package.json']);

  const b = K.girisDosyasiCoz('main.js', varMi(['electron.js']));
  assert.deepStrictEqual([b.ad, b.kaynak], ['electron.js', 'varsayilan-liste']);
  assert.match(b.not, /bulunamadı/);

  const c = K.girisDosyasiCoz(null, varMi(['main.js']));
  assert.deepStrictEqual([c.ad, c.kaynak], ['main.js', 'varsayilan-liste']);
  assert.match(c.not, /yok\/okunamadı/);

  const d = K.girisDosyasiCoz(null, varMi([]));
  assert.deepStrictEqual([d.ad, d.kaynak], [null, null]);

  // Göreli yol ('./main.js') da basename'e indirgenmeli.
  const e = K.girisDosyasiCoz('./main.js', varMi(['main.js']));
  assert.deepStrictEqual([e.ad, e.kaynak], ['main.js', 'package.json']);
});

// ===========================================================================
// WINDOWS SÖZLEŞMESİ (2026-09-26): madde 11 Ş işareti, 13-D imza, 14 G1, 15 G2
// ===========================================================================

const { KANAL_S_ISARET } = require('../src/packaging/icerik-guncelleme');

test('S1 · madde 11: kanal Ş KAPALI işareti varsa version.txt parça sayısından bağımsız PASS', () => {
  const kapali = `const { app } = require("electron");\nconst checkForUpdates = async () => { return; /* ${KANAL_S_ISARET} */ const AdmZip = require("adm-zip") }`;
  const m = K.maddeSurum({ asarOkundu: true, bulundu: true, metin: '1.13.1.3', anaJs: kapali });
  assert.strictEqual(m.durum, K.PASS);
  assert.match(m.detay, /kanal Ş kapalı/);
  assert.match(m.detay, /"1\.13\.1\.3" \(4 parça\)/);
  // işaret yok → eski ölçüt (4 parça FAIL)
  const acik = 'const checkForUpdates = async () => { const AdmZip = require("adm-zip") }';
  assert.strictEqual(K.maddeSurum({ asarOkundu: true, bulundu: true, metin: '1.13.1.3', anaJs: acik }).durum, K.FAIL);
  // okunamayan ağaçta işaret aranmaz
  assert.strictEqual(K.maddeSurum({ asarOkundu: false, anaJs: kapali }).durum, K.OLCULEMEDI);
});

test('S2 · madde 13-D: imza alanı yok / RSA / doğrulamasız modül FAIL; modül okunamazsa ÖLÇÜLEMEDİ', () => {
  const tam = K.maddeSetGuncelleme(setGirdi());
  assert.strictEqual(tam.durum, K.PASS);
  assert.match(tam.detay, /D\) manifest imzası zorunlu/);
  const imzasiz = { ...SET_HARITA_TAM };
  delete imzasiz.imza;
  const a = K.maddeSetGuncelleme(setGirdi({ setMetin: JSON.stringify(imzasiz) }));
  assert.strictEqual(a.durum, K.FAIL);
  assert.match(a.detay, /imza alanı YOK/);
  const rsa = require('crypto').generateKeyPairSync('rsa', { modulusLength: 1024 }).publicKey
    .export({ type: 'spki', format: 'der' }).toString('base64');
  const b = K.maddeSetGuncelleme(setGirdi({ setMetin: JSON.stringify({ ...SET_HARITA_TAM, imza: { alg: 'ed25519', acikAnahtar: rsa } }) }));
  assert.strictEqual(b.durum, K.FAIL);
  assert.match(b.detay, /ed25519 SPKI değil/);
  const c = K.maddeSetGuncelleme(setGirdi({ setModulIcerik: 'module.exports = {}' }));
  assert.strictEqual(c.durum, K.FAIL);
  assert.match(c.detay, /imza DOĞRULAMASI taşımıyor/);
  const d = K.maddeSetGuncelleme(setGirdi({ setModulIcerik: null }));
  assert.strictEqual(d.durum, K.OLCULEMEDI);
});

function sozlesmeAgaci(yama = {}) {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'empp-kapi-soz-'));
  const yaz = (g, icerik) => {
    const t = path.join(kok, ...g.split('/'));
    fs.mkdirSync(path.dirname(t), { recursive: true });
    fs.writeFileSync(t, icerik);
  };
  const dosyalar = {
    'empp-vendor/adm-zip/package.json': JSON.stringify({ name: 'adm-zip', version: '0.5.16', main: 'adm-zip.js' }),
    'empp-vendor/adm-zip/adm-zip.js': 'module.exports = {}',
    'empp-icerik-guncelleme.js': 'function anaSurecKur(){}',
    'empp-fs-shim.js': '// EMPP_FS_SHIM_WINDOWS_ETKIN',
    'empp-icerik-durum.json': JSON.stringify({ etkin: { windows: true } }),
    'book1/index.html': '<html></html>',
    ...yama,
  };
  for (const [g, icerik] of Object.entries(dosyalar)) if (icerik != null) yaz(g, icerik);
  return { kok, yollar: K.agacYollari(kok) };
}
const ANA_SOZ = 'process.env.EMPP_WORK_DIR = x; /* EMPP_ICERIK_GUNCELLEME */';

test('S3 · madde 14 (G1): adm-zip + etkin modül + WORK yolu → PASS; her eksik ayrı FAIL', () => {
  const { kok, yollar } = sozlesmeAgaci();
  const soz = K.sozlesmeKanitiTopla(kok, yollar);
  assert.strictEqual(K.maddeIcerikKanali({ asarOkundu: true, sozlesme: soz, anaJs: ANA_SOZ }).durum, K.PASS);
  for (const [yama, desen] of [
    [{ 'empp-vendor/adm-zip/package.json': null, 'empp-vendor/adm-zip/adm-zip.js': null }, /adm-zip YOK/],
    [{ 'empp-vendor/adm-zip/adm-zip.js': null }, /adm-zip paketi eksik/],
    [{ 'empp-icerik-guncelleme.js': "return { durum: 'windows-kapsam-disi' }" }, /kapsam dışı/],
    [{ 'empp-fs-shim.js': "if (proc && proc.platform === 'win32') return null;" }, /PASİF/],
    [{ 'empp-icerik-durum.json': JSON.stringify({ etkin: { windows: false } }) }, /etkin\.windows ≠ true/],
  ]) {
    const t = sozlesmeAgaci(yama);
    const m = K.maddeIcerikKanali({ asarOkundu: true, sozlesme: K.sozlesmeKanitiTopla(t.kok, t.yollar), anaJs: ANA_SOZ });
    assert.strictEqual(m.durum, K.FAIL, String(desen));
    assert.match(m.detay, desen);
  }
  assert.match(K.maddeIcerikKanali({ asarOkundu: true, sozlesme: soz, anaJs: 'x' }).detay, /EMPP_ICERIK_GUNCELLEME bloğu yok/);
  assert.strictEqual(K.maddeIcerikKanali({ asarOkundu: false }).durum, K.OLCULEMEDI);
});

test('S4 · madde 15 (G2): pakette storage.im varsa ya da shim pasifse FAIL', () => {
  const temiz = sozlesmeAgaci();
  assert.strictEqual(K.maddeKurulumDiziniYazma({ asarOkundu: true, sozlesme: K.sozlesmeKanitiTopla(temiz.kok, temiz.yollar), anaJs: ANA_SOZ }).durum, K.PASS);
  const kirli = sozlesmeAgaci({ 'book2/temp/data/storage.im': 'X' });
  const m = K.maddeKurulumDiziniYazma({ asarOkundu: true, sozlesme: K.sozlesmeKanitiTopla(kirli.kok, kirli.yollar), anaJs: ANA_SOZ });
  assert.strictEqual(m.durum, K.FAIL);
  assert.match(m.detay, /book2\/temp\/data\/storage\.im/);
  const pasif = sozlesmeAgaci({ 'empp-fs-shim.js': "if (proc && proc.platform === 'win32') return null;" });
  assert.strictEqual(K.maddeKurulumDiziniYazma({ asarOkundu: true, sozlesme: K.sozlesmeKanitiTopla(pasif.kok, pasif.yollar), anaJs: ANA_SOZ }).durum, K.FAIL);
  assert.match(K.maddeKurulumDiziniYazma({ asarOkundu: true, sozlesme: K.sozlesmeKanitiTopla(temiz.kok, temiz.yollar), anaJs: 'x' }).detay, /EMPP_WORK_DIR tanımlamıyor/);
});

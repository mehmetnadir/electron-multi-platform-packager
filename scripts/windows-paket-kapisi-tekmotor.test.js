'use strict';

/**
 * Windows statik kapısı madde 13 — TEK-MOTOR (aktivasyonlu set) düzeni.
 * Kök neden (03.10, 45449): kapı yalnız bookN set düzenini tanıyordu; üreteçle kurulan
 * tek-motor set (kökte bookN yok, kitaplar assets/<ID>/, üyelik menüde) A + C2'de düşüyordu.
 * Sentetik fikstür; mutasyonla çivilenir. Set (bookN) düzeninin kontrolleri DEĞİŞMEDİ.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const K = require('./windows-paket-kapisi');
const IG = require('../src/runtime/icerik-guncelleme');

const ANA_JS = `/* main */\n/* EMPP_SET_GUNCELLEME: x */\nrequire('./empp-set-guncelleyici.js');\n`;
const MODUL = 'function manifestImzasiGecerliMi() {} /* EMPP_SET_GUNCELLEME */';
const { generateKeyPairSync } = require('crypto');
const ACIK = generateKeyPairSync('ed25519').publicKey
  .export({ type: 'spki', format: 'der' }).toString('base64');

const IDLER = ['31456', '31458', '31459'];

function menuXml({ activation = 'true', key = '', idler = IDLER } = {}) {
  const kap = idler.map((id) => `<cover ID="${id}" version="3" URL="https://x/${id}-3.zip" ` +
    `xmlSource="assets/${id}/data/BookContent.xml" Tip="kitap" activation="false"></cover>`).join('');
  return '<?xml version="1.0"?><main activation="' + activation + '" key="' + key +
    '" type="1" ID="45449"><Group ID="45449"><Tab ID="1">' + kap + '</Tab></Group></main>';
}

function yollarUret({ idler = IDLER, imKeys = true, eksikIcerik = [], ek = [] } = {}) {
  const y = ['index.html', 'electron.js', 'empp-set.json', 'empp-set-guncelleyici.js',
    'core/a.png', 'i18n/tr.js', 'classlibraries/ImWin32.dll', 'abc.main.js'];
  for (const id of idler) {
    if (!eksikIcerik.includes(id)) y.push(`assets/${id}/data/BookContent.xml`);
    y.push(`assets/${id}/pages/1.jpg`);
    if (imKeys) y.push(`assets/${id}/imKeys.dll`);
  }
  return y.concat(ek);
}

function kanit(o = {}) {
  return K.tekMotorKanitiTopla({
    yollar: o.yollar || yollarUret(o.yol),
    menuHam: o.menuHam === undefined ? IG.menuKodla(menuXml(o.menu)) : o.menuHam,
    isaretMetin: o.isaretMetin === undefined ? null : o.isaretMetin,
  });
}

function harita(yama = {}) {
  return {
    sema: 2, setKimligi: '45449', setKimligiKaynagi: 'acik', sebep: null,
    taban: 'https://panel.ornek.test/set-guncelleme', tabanKaynagi: 'istek',
    damga: '2026-10-03T00:00:00.000Z', kabukTanimi: K.SET_KABUK_IMZASI,
    kabukDosyaSayisi: 3, kabukDosyalari: ['abc.main.js', 'core/a.png', 'index.html'],
    kapsamDisiDallar: ['assets', 'classlibraries'], kitapSayisi: 0, kitapDizinleri: [],
    imza: { alg: 'ed25519', acikAnahtar: ACIK, kaynak: 'env' }, ...yama,
  };
}

function girdi(o = {}) {
  return {
    asarOkundu: true, setBulundu: true,
    setMetin: JSON.stringify(o.harita || harita()),
    setNerede: 'resources/app/empp-set.json',
    anaJs: ANA_JS, anaJsYolu: 'resources/app/electron.js', anaJsDizini: '',
    setModulYollari: ['empp-set-guncelleyici.js'], setModulIcerik: MODUL,
    tekMotor: o.tekMotor === undefined ? kanit() : o.tekMotor,
  };
}

test('T1 · tek-motor (yapısal: işaret yok, bookN yok, menüde 3 kapak): PASS', () => {
  const m = K.maddeSetGuncelleme(girdi());
  assert.strictEqual(m.durum, K.PASS, m.detay);
  assert.match(m.detay, /tek-motor/);
  assert.match(m.detay, /E\) tek-motor sözleşmesi tamam/);
  assert.match(m.detay, /3\/3 kapağın içeriği yerinde/);
});

test('T2 · tek-motor (üreteç işareti duzen=tek-motor): PASS; işaret bookN derse tek-motor DEĞİL', () => {
  const tm = kanit({ isaretMetin: JSON.stringify({ kaynak: 'uretec', duzen: 'tek-motor' }) });
  assert.strictEqual(K.maddeSetGuncelleme(girdi({ tekMotor: tm })).durum, K.PASS);
  const bk = kanit({ isaretMetin: JSON.stringify({ kaynak: 'uretec', duzen: 'bookN' }) });
  assert.strictEqual(K.tekMotorMu(bk), false);
  const m = K.maddeSetGuncelleme(girdi({ tekMotor: bk }));
  assert.strictEqual(m.durum, K.FAIL, 'bookN düzeninde kitapDizinleri[] boş → eski kural geçerli');
  assert.match(m.detay, /kitapDizinleri\[\] boş/);
});

test('T3 · MUTASYON: kapağın BookContent.xml\'i yok → FAIL (kitap içeriği eksik)', () => {
  const tm = kanit({ yol: { eksikIcerik: ['31458'] } });
  const m = K.maddeSetGuncelleme(girdi({ tekMotor: tm }));
  assert.strictEqual(m.durum, K.FAIL);
  assert.match(m.detay, /kitap içeriği EKSİK: 1\/3/);
  assert.match(m.detay, /31458/);
});

test('T4 · MUTASYON: aktivasyon tutarsızlıkları FAIL', () => {
  const keyDolu = K.maddeSetGuncelleme(girdi({ tekMotor: kanit({ menu: { key: 'GIZLI' } }) }));
  assert.strictEqual(keyDolu.durum, K.FAIL);
  assert.match(keyDolu.detay, /main\.key dolu/);

  const imkeysYok = K.maddeSetGuncelleme(girdi({ tekMotor: kanit({ yol: { imKeys: false } }) }));
  assert.strictEqual(imkeysYok.durum, K.FAIL);
  assert.match(imkeysYok.detay, /imKeys\.dll yazılı değil/);

  const bozuk = K.maddeSetGuncelleme(girdi({ tekMotor: kanit({ menu: { activation: 'evet' } }) }));
  assert.strictEqual(bozuk.durum, K.FAIL);
  assert.match(bozuk.detay, /true\/false değil/);

  // aktivasyonsuz tek-motor: imKeys şart değil
  const aktsiz = K.maddeSetGuncelleme(girdi({
    tekMotor: kanit({ menu: { activation: 'false' }, yol: { imKeys: false } }) }));
  assert.strictEqual(aktsiz.durum, K.PASS, aktsiz.detay);
});

test('T5 · MUTASYON: tek-motor gevşemesi yalnız `assets` içindir', () => {
  const fonts = K.maddeSetGuncelleme(girdi({
    harita: harita({ kapsamDisiDallar: ['assets', 'classlibraries', 'fonts'] }) }));
  assert.strictEqual(fonts.durum, K.FAIL);
  assert.match(fonts.detay, /C2\) KABUK TANIMI BU AĞACI KAPSAMIYOR — .*fonts/);
  assert.doesNotMatch(fonts.detay.split('C2)')[1].split(' · ')[0], /assets|classlibraries/);

  const dolu = K.maddeSetGuncelleme(girdi({
    harita: harita({ kitapDizinleri: ['book1'], kitapSayisi: 1 }) }));
  assert.strictEqual(dolu.durum, K.FAIL);
  assert.match(dolu.detay, /tek-motor düzeninde kitapDizinleri\[\] dolu/);
});

test('T6 · ağaçta bookN varsa tek-motor DEĞİL: set düzeni kuralları AYNEN (assets/ sızması C2 FAIL)', () => {
  const tm = kanit({ yol: { ek: ['book1/index.html'] } });
  assert.strictEqual(K.tekMotorMu(tm), false);
  const bos = K.maddeSetGuncelleme(girdi({ tekMotor: tm }));
  assert.strictEqual(bos.durum, K.FAIL);
  assert.match(bos.detay, /kitapDizinleri\[\] boş/);
  assert.match(bos.detay, /C2\) KABUK TANIMI BU AĞACI KAPSAMIYOR — .*assets/);

  // tam bookN seti hâlâ PASS
  const set = K.maddeSetGuncelleme(girdi({
    harita: harita({ kapsamDisiDallar: [], kitapDizinleri: ['book1', 'book2'], kitapSayisi: 2 }),
    tekMotor: kanit({ yol: { idler: [], ek: ['book1/index.html', 'book2/index.html'] },
      menuHam: null }),
  }));
  assert.strictEqual(set.durum, K.PASS, set.detay);
  assert.match(set.detay, /2 kitap üye/);
  // tekMotor kanıtı hiç yoksa (eski çağrı biçimi) da değişmez
  const eski = K.maddeSetGuncelleme(girdi({
    harita: harita({ kapsamDisiDallar: [], kitapDizinleri: ['book1'], kitapSayisi: 1 }),
    tekMotor: null }));
  assert.strictEqual(eski.durum, K.PASS, eski.detay);
});

test('T7 · işaret tek-motor ama menü çözülemiyor → ÖLÇÜLEMEDİ (PASS değil); menü hiç yok → FAIL', () => {
  const isaret = JSON.stringify({ duzen: 'tek-motor' });
  const bozukMenu = kanit({ isaretMetin: isaret, menuHam: Buffer.from('çöp çöp') });
  const m = K.maddeSetGuncelleme(girdi({ tekMotor: bozukMenu }));
  assert.strictEqual(m.durum, K.OLCULEMEDI, m.detay);

  const menusuz = kanit({
    isaretMetin: isaret, menuHam: null,
    yollar: yollarUret().filter((y) => y !== 'classlibraries/ImWin32.dll') });
  const m2 = K.maddeSetGuncelleme(girdi({ tekMotor: menusuz }));
  assert.strictEqual(m2.durum, K.FAIL);
  assert.match(m2.detay, /menüsü YOK/);
});

test('T8 · UÇTAN UCA: açık resources/app ağacı agactanTopla ile ölçülür (PASS, sonra mutasyon FAIL)', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tekmotor-'));
  const app = path.join(d, 'resources', 'app');
  const yaz = (g, v) => {
    const t = path.join(app, ...g.split('/'));
    fs.mkdirSync(path.dirname(t), { recursive: true });
    fs.writeFileSync(t, v);
  };
  yaz('package.json', JSON.stringify({ main: 'electron.js' }));
  yaz('electron.js', ANA_JS);
  yaz('empp-set-guncelleyici.js', MODUL);
  yaz('empp-set.json', JSON.stringify(harita()));
  yaz('index.html', '<html></html>');
  yaz('classlibraries/ImWin32.dll', IG.menuKodla(menuXml()));
  for (const id of IDLER) {
    yaz(`assets/${id}/data/BookContent.xml`, '<x/>');
    yaz(`assets/${id}/imKeys.dll`, 'k');
  }
  const olc = (t) => K.maddeSetGuncelleme({
    asarOkundu: t.asarOkundu, setBulundu: t.setBulundu, setMetin: t.setMetin,
    setNerede: t.setNerede, anaJs: t.anaJs, anaJsYolu: t.anaJsYolu, anaJsDizini: t.anaJsDizini,
    setModulYollari: t.setModulYollari, setModulIcerik: t.setModulIcerik, tekMotor: t.tekMotor,
  });
  const iyi = olc(K.agactanTopla(d));
  assert.strictEqual(iyi.durum, K.PASS, iyi.detay);

  fs.unlinkSync(path.join(app, 'assets', '31459', 'data', 'BookContent.xml'));
  const kotu = olc(K.agactanTopla(d));
  assert.strictEqual(kotu.durum, K.FAIL);
  assert.match(kotu.detay, /kitap içeriği EKSİK: 1\/3/);
  fs.rmSync(d, { recursive: true, force: true });
});

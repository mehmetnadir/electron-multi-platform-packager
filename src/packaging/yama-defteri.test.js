'use strict';

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const m = require('./yama-defteri.js');

function createMockFs(options = {}) {
  const cagrilar = [];
  const mock = {
    cagrilar,
    async writeFile(yol, icerik) {
      cagrilar.push({ metod: 'writeFile', yol, icerik });
      if (options.writeFileHata) throw options.writeFileHata;
    },
    async rename(eskiYol, yeniYol) {
      cagrilar.push({ metod: 'rename', eskiYol, yeniYol });
      if (options.renameHata) throw options.renameHata;
    },
    async open(yol, bayraklar) {
      cagrilar.push({ metod: 'open', yol, bayraklar });
      if (options.openHata) throw options.openHata;
      return {
        async sync() {
          cagrilar.push({ metod: 'sync' });
          if (options.syncHata) throw options.syncHata;
        },
        async close() {
          cagrilar.push({ metod: 'close' });
        },
      };
    },
    async unlink(yol) {
      cagrilar.push({ metod: 'unlink', yol });
    },
  };
  mock.promises = mock;
  return mock;
}

const GECERLI_SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f901a2b3c4d5e6f708192a3b4c5d6e7f890';

test('defteriDogrula: geçerli bir defter nesnesi verildiğinde gecerli:true döner', () => {
  const defter = {
    surum: '1.0.0',
    dosyalar: [
      { yol: 'lib/cekirdek.js', sha256: GECERLI_SHA, bayt: 1024 },
    ],
  };
  const sonuc = m.defteriDogrula(defter);
  assert.strictEqual(sonuc.gecerli, true);
  assert.strictEqual(sonuc.sebep, 'ok');
  assert.deepStrictEqual(sonuc.defter, defter);
});

test('defteriDogrula: surum eksik veya yanlış tipte olduğunda gecerli:false döner', () => {
  assert.deepStrictEqual(m.defteriDogrula({ dosyalar: [] }), { gecerli: false, sebep: 'gecersiz-surum' });
  assert.deepStrictEqual(m.defteriDogrula({ surum: '', dosyalar: [] }), { gecerli: false, sebep: 'gecersiz-surum' });
  assert.deepStrictEqual(m.defteriDogrula({ surum: '   ', dosyalar: [] }), { gecerli: false, sebep: 'gecersiz-surum' });
  assert.deepStrictEqual(m.defteriDogrula({ surum: 123, dosyalar: [] }), { gecerli: false, sebep: 'gecersiz-surum' });
  assert.deepStrictEqual(m.defteriDogrula({ surum: null, dosyalar: [] }), { gecerli: false, sebep: 'gecersiz-surum' });
});

test('defteriDogrula: dosyalar alanı dizi olmadığında gecerli:false döner', () => {
  assert.deepStrictEqual(m.defteriDogrula({ surum: '1.0.0' }), { gecerli: false, sebep: 'dosyalar-dizi-olmalidir' });
  assert.deepStrictEqual(m.defteriDogrula({ surum: '1.0.0', dosyalar: 'dizi-degil' }), { gecerli: false, sebep: 'dosyalar-dizi-olmalidir' });
  assert.deepStrictEqual(m.defteriDogrula({ surum: '1.0.0', dosyalar: {} }), { gecerli: false, sebep: 'dosyalar-dizi-olmalidir' });
  assert.deepStrictEqual(m.defteriDogrula({ surum: '1.0.0', dosyalar: null }), { gecerli: false, sebep: 'dosyalar-dizi-olmalidir' });
});

test('defteriDogrula: tek bir kayıtta bozuk sha256 tüm defteri geçersiz kılar (kısmi kabul yok)', () => {
  const kisaSha = 'a'.repeat(63);
  const uzunSha = 'a'.repeat(65);
  const gecersizKarakterSha = 'z'.repeat(64);

  const defterKisa = {
    surum: '1.0.0',
    dosyalar: [
      { yol: 'dosya1.js', sha256: GECERLI_SHA, bayt: 100 },
      { yol: 'dosya2.js', sha256: kisaSha, bayt: 200 },
    ],
  };
  const sonucKisa = m.defteriDogrula(defterKisa);
  assert.strictEqual(sonucKisa.gecerli, false);
  assert.strictEqual(sonucKisa.sebep, 'gecersiz-sha256');

  const defterUzun = {
    surum: '1.0.0',
    dosyalar: [
      { yol: 'dosya1.js', sha256: GECERLI_SHA, bayt: 100 },
      { yol: 'dosya2.js', sha256: uzunSha, bayt: 200 },
    ],
  };
  assert.deepStrictEqual(m.defteriDogrula(defterUzun), { gecerli: false, sebep: 'gecersiz-sha256' });

  const defterGecersizKarakter = {
    surum: '1.0.0',
    dosyalar: [
      { yol: 'dosya1.js', sha256: GECERLI_SHA, bayt: 100 },
      { yol: 'dosya2.js', sha256: gecersizKarakterSha, bayt: 200 },
    ],
  };
  assert.deepStrictEqual(m.defteriDogrula(defterGecersizKarakter), { gecerli: false, sebep: 'gecersiz-sha256' });
});

test('defteriDogrula: bir dosya kaydında bayt negatif veya sonlu sayı değilse gecerli:false döner', () => {
  const defterNegatif = {
    surum: '1.0.0',
    dosyalar: [{ yol: 'a.js', sha256: GECERLI_SHA, bayt: -1 }],
  };
  assert.deepStrictEqual(m.defteriDogrula(defterNegatif), { gecerli: false, sebep: 'gecersiz-bayt' });

  const defterSonsuz = {
    surum: '1.0.0',
    dosyalar: [{ yol: 'a.js', sha256: GECERLI_SHA, bayt: Infinity }],
  };
  assert.deepStrictEqual(m.defteriDogrula(defterSonsuz), { gecerli: false, sebep: 'gecersiz-bayt' });

  const defterStringBayt = {
    surum: '1.0.0',
    dosyalar: [{ yol: 'a.js', sha256: GECERLI_SHA, bayt: '100' }],
  };
  assert.deepStrictEqual(m.defteriDogrula(defterStringBayt), { gecerli: false, sebep: 'gecersiz-bayt' });
});

test('defteriDogrula: bozuk JSON string throw etmez, json-parse-hatasi döner', () => {
  assert.doesNotThrow(() => {
    const sonuc = m.defteriDogrula('{ bozuk json :');
    assert.deepStrictEqual(sonuc, { gecerli: false, sebep: 'json-parse-hatasi' });
  });
});

test('defteriDogrula: dosyalar:[] olan boş defter geçerlidir', () => {
  const sonuc = m.defteriDogrula({ surum: '1.0.0', dosyalar: [] });
  assert.strictEqual(sonuc.gecerli, true);
  assert.strictEqual(sonuc.sebep, 'ok');
  assert.deepStrictEqual(sonuc.defter.dosyalar, []);
});

test('indirilecekler: yerelde aynı sha256 bulunan dosyalar atlanır ve atlananSayisi artar', () => {
  const sha1 = '1'.repeat(64);
  const sha2 = '2'.repeat(64);
  const defter = {
    dosyalar: [
      { yol: 'dosya1.txt', sha256: sha1, bayt: 100 },
      { yol: 'dosya2.txt', sha256: sha2, bayt: 200 },
    ],
  };

  const yereldeVarOlan = new Map([
    ['dosya1.txt', sha1.toUpperCase()],
  ]);

  const sonuc = m.indirilecekler(defter, yereldeVarOlan);
  assert.strictEqual(sonuc.atlananSayisi, 1);
  assert.strictEqual(sonuc.asildi, false);
  assert.strictEqual(sonuc.indirilecek.length, 1);
  assert.deepStrictEqual(sonuc.indirilecek[0], { yol: 'dosya2.txt', sha256: sha2, bayt: 200 });
});

test('indirilecekler: azamiToplamBayt aşılınca listeyi büyütmez, o dosyada kesilir ve asildi:true döner', () => {
  const defter = {
    dosyalar: [
      { yol: 'dosya1.bin', sha256: GECERLI_SHA, bayt: 40 },
      { yol: 'dosya2.bin', sha256: GECERLI_SHA, bayt: 70 },
      { yol: 'dosya3.bin', sha256: GECERLI_SHA, bayt: 20 },
    ],
  };

  const sonuc = m.indirilecekler(defter, new Map(), { azamiToplamBayt: 100 });
  assert.strictEqual(sonuc.asildi, true);
  assert.strictEqual(sonuc.indirilecek.length, 1);
  assert.deepStrictEqual(sonuc.indirilecek[0], { yol: 'dosya1.bin', sha256: GECERLI_SHA, bayt: 40 });
});

test('indirilecekler: toplam bayt bütçeyi aşmazsa asildi:false döner', () => {
  const defter = {
    dosyalar: [
      { yol: 'dosya1.bin', sha256: GECERLI_SHA, bayt: 30 },
      { yol: 'dosya2.bin', sha256: GECERLI_SHA, bayt: 50 },
    ],
  };

  const sonuc = m.indirilecekler(defter, new Map(), { azamiToplamBayt: 100 });
  assert.strictEqual(sonuc.asildi, false);
  assert.strictEqual(sonuc.indirilecek.length, 2);
});

test('yoluGuvenliMi: .. segmenti ve mutlak yollar reddedilir (false)', () => {
  assert.strictEqual(m.yoluGuvenliMi('../gizli'), false);
  assert.strictEqual(m.yoluGuvenliMi('dizin/../gizli'), false);
  assert.strictEqual(m.yoluGuvenliMi('/etc/passwd'), false);
  assert.strictEqual(m.yoluGuvenliMi('\\Windows\\System32'), false);
  assert.strictEqual(m.yoluGuvenliMi('C:\\autoexec.bat'), false);
  assert.strictEqual(m.yoluGuvenliMi('dosya\0.txt'), false);
  assert.strictEqual(m.yoluGuvenliMi(''), false);
  assert.strictEqual(m.yoluGuvenliMi(null), false);
  assert.strictEqual(m.yoluGuvenliMi(123), false);

  assert.strictEqual(m.yoluGuvenliMi('duzgun/dosya.txt'), true);
  assert.strictEqual(m.yoluGuvenliMi('paket.json'), true);
});

test('indirilecekler: güvensiz yollu bir dosya defterde olsa listeye hiç girmez', () => {
  const defter = {
    dosyalar: [
      { yol: '../tehlike.js', sha256: GECERLI_SHA, bayt: 10 },
      { yol: '/etc/passwd', sha256: GECERLI_SHA, bayt: 20 },
      { yol: 'guvenli.js', sha256: GECERLI_SHA, bayt: 30 },
    ],
  };

  const sonuc = m.indirilecekler(defter, new Map());
  assert.strictEqual(sonuc.indirilecek.length, 1);
  assert.strictEqual(sonuc.indirilecek[0].yol, 'guvenli.js');
  assert.strictEqual(sonuc.atlananSayisi, 0);
});

test('atomikYaz: sahte fs ile önce geçici ada writeFile sonra hedef ada rename çağrılır', async () => {
  const mockFs = createMockFs();
  const hedef = 'ayarlar.json';
  const tampon = Buffer.from('merhaba');

  await m.atomikYaz(mockFs, hedef, tampon);

  assert.strictEqual(mockFs.cagrilar[0].metod, 'writeFile');
  assert.match(mockFs.cagrilar[0].yol, /^ayarlar\.json\.tmp-[0-9a-f]{16}$/);
  assert.deepStrictEqual(mockFs.cagrilar[0].icerik, tampon);

  const sonCagri = mockFs.cagrilar[mockFs.cagrilar.length - 1];
  assert.strictEqual(sonCagri.metod, 'rename');
  assert.strictEqual(sonCagri.eskiYol, mockFs.cagrilar[0].yol);
  assert.strictEqual(sonCagri.yeniYol, hedef);
});

test('dogrulaVeYaz: sha256 uyuşmazlığında yazmaz ve fs metodlarını hiç çağırmaz', async () => {
  const mockFs = createMockFs();
  const icerik = Buffer.from('deneme icerigi');
  const yanlisSha = 'f'.repeat(64);

  const sonuc = await m.dogrulaVeYaz(mockFs, 'dosya.txt', icerik, yanlisSha);
  assert.deepStrictEqual(sonuc, { yazildi: false, sebep: 'sha-uyusmazligi' });
  assert.strictEqual(mockFs.cagrilar.length, 0);
});

test('dogrulaVeYaz: sha256 uyuşunca atomikYaz çağırır ve yazıldı döner', async () => {
  const mockFs = createMockFs();
  const icerik = Buffer.from('dogru icerik verisi');
  const dogruSha = crypto.createHash('sha256').update(icerik).digest('hex');

  const sonuc = await m.dogrulaVeYaz(mockFs, 'dosya.txt', icerik, dogruSha);
  assert.deepStrictEqual(sonuc, { yazildi: true, sebep: 'yazildi' });
  assert(mockFs.cagrilar.some((c) => c.metod === 'writeFile'));
  assert(mockFs.cagrilar.some((c) => c.metod === 'rename'));
});

test('defteriGetir: hiç çözülmeyen Promise ile zaman aşımına uğrar ve throw etmez', async () => {
  const sonuc = await m.defteriGetir(
    () => new Promise(() => {}),
    { zamanAsimiMs: 20 }
  );
  assert.deepStrictEqual(sonuc, { uygulandi: false, sebep: 'zaman-asimi' });
});

test('defteriGetir: getirFn reddeden Promise dönerse unhandled rejection olmadan hata döner', async () => {
  const sonuc = await m.defteriGetir(
    () => Promise.reject(new Error('Ağ bağlantısı koptu')),
    { zamanAsimiMs: 50 }
  );
  assert.deepStrictEqual(sonuc, { uygulandi: false, sebep: 'getirme-hatasi' });
});

test('defteriGetir: getirFn geçerli bir JSON string ile resolve ederse uygulandi:true döner', async () => {
  const defterStr = JSON.stringify({
    surum: '1.0.0',
    dosyalar: [{ yol: 'a.js', sha256: GECERLI_SHA, bayt: 100 }],
  });
  const sonuc = await m.defteriGetir(() => Promise.resolve(defterStr));
  assert.strictEqual(sonuc.uygulandi, true);
  assert.strictEqual(sonuc.sebep, 'ok');
  assert.strictEqual(sonuc.defter.surum, '1.0.0');
});

test('defteriGetir: getirFn geçerli bir nesne ile resolve ederse uygulandi:true döner', async () => {
  const defterObj = {
    surum: '2.0.0',
    dosyalar: [{ yol: 'b.js', sha256: GECERLI_SHA, bayt: 50 }],
  };
  const sonuc = await m.defteriGetir(() => Promise.resolve(defterObj));
  assert.strictEqual(sonuc.uygulandi, true);
  assert.strictEqual(sonuc.sebep, 'ok');
  assert.deepStrictEqual(sonuc.defter, defterObj);
});

test('defteriGetir: getirFn geçersiz bir defter ile resolve ederse defteriDogrula sebebini taşır', async () => {
  const gecersizDefter = { surum: '1.0.0', dosyalar: 'gecersiz-dizi' };
  const sonuc = await m.defteriGetir(() => Promise.resolve(gecersizDefter));
  assert.deepStrictEqual(sonuc, { uygulandi: false, sebep: 'dosyalar-dizi-olmalidir' });
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const a = require('./anahtar');
const kg = require('../../src/runtime/kitap-guncelleyici');

function geciciDizin() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'g-anahtar-'));
}

function pem(k) {
  return k.export({ type: 'pkcs8', format: 'pem' });
}

/** Sahte `security`: gerçek süreç yerine verilen çıktıyı döner; çağrıyı kaydeder. */
function sahteCalistir(cikti, ek = {}) {
  const cagri = [];
  const f = async (komut, argumanlar) => {
    cagri.push({ komut, argumanlar });
    return { kod: 0, stdout: Buffer.from(cikti), stderr: '', zamanAsimi: false, ...ek };
  };
  f.cagri = cagri;
  return f;
}

test('üretim açık anahtarının parmak izi Şef\'in verdiği 31b8663b…2cf6', () => {
  assert.equal(a.parmakIzi(a.URETIM_ACIK_ANAHTAR), a.URETIM_PARMAK_IZI);
  assert.ok(a.URETIM_PARMAK_IZI.startsWith('31b8663b') && a.URETIM_PARMAK_IZI.endsWith('2cf6'));
  assert.ok(kg.acikAnahtarCoz(a.URETIM_ACIK_ANAHTAR), 'istemci üretim anahtarını çözebilmeli');
});

test('dosya kaynağı: ed25519 okunur; RSA ve bozuk dosya RED, hata metninde içerik yok', () => {
  const d = geciciDizin();
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  fs.writeFileSync(path.join(d, 'test.key'), pem(privateKey));
  const k = a.dosyadanOku(path.join(d, 'test.key'));
  assert.equal(k.asymmetricKeyType, 'ed25519');

  const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 }).privateKey;
  fs.writeFileSync(path.join(d, 'rsa.key'), pem(rsa));
  assert.throws(() => a.dosyadanOku(path.join(d, 'rsa.key')), /ed25519/);
  fs.writeFileSync(path.join(d, 'bozuk.key'), 'GIZLI-DEGER-123');
  assert.throws(() => a.dosyadanOku(path.join(d, 'bozuk.key')), (e) => !e.message.includes('GIZLI-DEGER-123'));
  assert.throws(() => a.dosyadanOku(path.join(d, 'yok.key')), /okunamadı/);
  // Üretim anahtarı dosyada duramaz (üretim açık anahtarı yerine bu anahtar enjekte edilir).
  assert.throws(() => a.dosyadanOku(path.join(d, 'test.key'), { uretimAcik: a.acikAnahtarB64(privateKey) }),
    /ÜRETİM anahtarı dosyada/);
});

test('Anahtar Zinciri kaynağı: doğru komut, base64(PEM) çözülür, beklenen açık anahtar denetlenir', async () => {
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  const deger = Buffer.from(pem(privateKey)).toString('base64') + '\n';
  const c = sahteCalistir(deger);
  const acik = a.acikAnahtarB64(privateKey);
  const k = await a.anahtarZincirindenOku({ calistir: c, beklenenAcik: acik });
  assert.equal(a.acikAnahtarB64(k), acik);
  assert.equal(c.cagri[0].komut, '/usr/bin/security');
  assert.deepEqual(c.cagri[0].argumanlar,
    ['find-generic-password', '-s', 'empp-guncelleme-ed25519-uretim', '-a', 'nadir', '-w']);

  // Varsayılan beklenen = ÜRETİM anahtarı → rastgele anahtar RED; hata metninde değer yok.
  await assert.rejects(a.anahtarZincirindenOku({ calistir: sahteCalistir(deger) }),
    (e) => /eşleşmiyor/.test(e.message) && !e.message.includes(deger.trim().slice(10, 40)));
});

test('Anahtar Zinciri hataları: kayıt yok, zaman aşımı, bozuk değer — sır sızmaz', async () => {
  await assert.rejects(a.anahtarZincirindenOku({ calistir: sahteCalistir('', { kod: 44, stderr: 'The specified item could not be found in the keychain.' }) }),
    /okunamadı.*çıkış 44/);
  await assert.rejects(a.anahtarZincirindenOku({ calistir: sahteCalistir('', { zamanAsimi: true }) }), /yanıt vermedi/);
  await assert.rejects(a.anahtarZincirindenOku({ calistir: sahteCalistir('U0VDUkVULVNJUi1ERUdFUg==') }),
    (e) => /PKCS8/.test(e.message) && !e.message.includes('U0VDUkVU'));
});

test('anahtarYukle: tam olarak bir kaynak; üretim anahtarı dosyadan RED', async () => {
  await assert.rejects(a.anahtarYukle({}), /tam olarak bir/);
  await assert.rejects(a.anahtarYukle({ zincir: true, dosya: '/x' }), /tam olarak bir/);
  const d = geciciDizin();
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  fs.writeFileSync(path.join(d, 't.key'), pem(privateKey));
  const y = await a.anahtarYukle({ dosya: path.join(d, 't.key') });
  assert.equal(y.acik, a.acikAnahtarB64(privateKey));
  assert.equal(y.parmakIzi, a.parmakIzi(y.acik));
  assert.match(y.kaynak, /^dosya:/);
});

test('imzala/dogrula: istemcinin doğrulayıcısıyla tutar, tek bayt değişince tutmaz', () => {
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  const acik = a.acikAnahtarB64(privateKey);
  const govde = Buffer.from('{"surum":"2.51.4"}');
  const imza = a.imzala(govde, privateKey, acik);
  assert.equal(a.dogrula(govde, imza, acik), true);
  assert.equal(kg.manifestImzasiGecerliMi(govde, imza, acik), true);
  assert.equal(a.dogrula(Buffer.from('{"surum":"2.51.5"}'), imza, acik), false);
  assert.equal(a.dogrula(govde, imza, a.URETIM_ACIK_ANAHTAR), false);
});

test('kuruImza: yalnız üretim anahtarıyla GEÇER; başka anahtar KALDI', async () => {
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  const deger = Buffer.from(pem(privateKey)).toString('base64');
  const s = await a.kuruImza({ calistir: sahteCalistir(deger) });
  assert.equal(s.gecti, false);
  assert.match(s.sebep, /eşleşmiyor/);
});

'use strict';

/**
 * İmza şeridi hızlandırma (06.10, Nadir: "geri okumayı atla · imzayı paralel yapalım"):
 * HAZIR-KANIT ayrıştırma, `_hazir` uzak yolu, `onKopyaKarari` (saf) ve imzaliYayinZinciri'nin
 * `hazirlaAtla` / `hazirlandi` sözleşmesi. Gerçek yuvaya/SMB'ye dokunmaz: imza betiği sahte node betiğidir.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const W = require('./windows-serit');
const H = require('./windows-hazir');

const tmp = (ad) => fs.mkdtempSync(path.join(os.tmpdir(), `onkopya-${ad}-`));

test('hazirKanitiAyristir: son HAZIR-KANIT satırı; yoksa/bozuksa null (bash betiği yazmaz)', () => {
  const k = { ad: 'a.exe', boyut: 12, sha256: 'ab'.repeat(32), geriOkuma: false };
  assert.deepEqual(W.hazirKanitiAyristir(`12:00:00 hazırla: a.exe\n12:00:09 HAZIR-KANIT ${JSON.stringify(k)}\n`), k);
  assert.equal(W.hazirKanitiAyristir('HAZIR — boyut+sha256 DOĞRULANDI: /x'), null);
  assert.equal(W.hazirKanitiAyristir('12:00:00 HAZIR-KANIT {bozuk'), null);
  assert.equal(W.hazirKanitiAyristir(''), null);
});

test('hazirKopyaYolu: <yuva kökü>/_hazir/<exe adı>; kök yoksa null', () => {
  assert.equal(W.hazirKopyaYolu({ winImzaYuvaKoku: '/k' }, '/is/runner-1-T-2.0.1-Setup.exe'),
    path.join('/k', '_hazir', 'runner-1-T-2.0.1-Setup.exe'));
  assert.equal(W.hazirKopyaYolu({ winImzaYuvaKoku: '' }, '/is/a.exe'), null);
});

test('onKopyaKarari: yalnız aynı exe + aynı boyut + aynı sha + uzak boyut eşitse geçerli', () => {
  const m = { exe: 'a.exe', boyut: 100, sha256: 'x1', onKopya: { ad: 'a.exe', boyut: 100, sha256: 'x1' } };
  assert.equal(H.onKopyaKarari(m, { exeAdi: 'a.exe', uzakBoyut: 100 }).gecerli, true);
  assert.match(H.onKopyaKarari({ ...m, onKopya: undefined }, { exeAdi: 'a.exe', uzakBoyut: 100 }).sebep, /kaydı yok/);
  assert.equal(H.onKopyaKarari(m, { exeAdi: 'b.exe', uzakBoyut: 100 }).gecerli, false, 'başka exe');
  assert.equal(H.onKopyaKarari({ ...m, boyut: 101 }, { exeAdi: 'a.exe', uzakBoyut: 100 }).gecerli, false, 'kayıt boyutu farklı');
  assert.equal(H.onKopyaKarari({ ...m, sha256: 'x2' }, { exeAdi: 'a.exe', uzakBoyut: 100 }).gecerli, false, 'sha farklı');
  const yok = H.onKopyaKarari(m, { exeAdi: 'a.exe', uzakBoyut: null });
  assert.equal(yok.gecerli, false, 'uzak kopya yok (takas yuvaya taşıdı)');
  assert.match(yok.sebep, /uzak _hazir kopyası yok/);
  assert.equal(H.onKopyaKarari(m, { exeAdi: 'a.exe', uzakBoyut: 50 }).gecerli, false, 'yarım uzak kopya');
});

/** Sahte imza betiği: argv[2]'yi günlüğe yazar; hazirla → HAZIR-KANIT + 0; bekle-ve-tak → 3 (tavan). */
function sahteZincir() {
  const d = tmp('zincir');
  const gunluk = path.join(d, 'gunluk.txt');
  const betik = path.join(d, 'imza.js');
  fs.writeFileSync(betik, `const fs = require('fs');
fs.appendFileSync(${JSON.stringify(gunluk)}, process.argv[2] + '\\n');
if (process.argv[2] === 'hazirla') {
  console.log('12:00:00 HAZIR-KANIT ' + JSON.stringify({ ad: 'a.exe', boyut: 4, sha256: 'ab', geriOkuma: false }));
  process.exit(0);
}
process.exit(3);
`);
  const exe = path.join(d, 'a.exe');
  fs.writeFileSync(exe, 'MZxx');
  const cfg = {
    ...W.varsayilanAyarlar(), winImzaBetigi: betik, winImzaKabuk: process.execPath, winImzaYuvaKoku: path.join(d, 'yuva'),
    winImzaIstekDizini: '', winImzaKilit: path.join(d, 'imza-yuva.kilit'), winImzaYabanciDesen: '',
    winImzaKilitBeklemeMs: 5000, winImzaKilitAralikMs: 50, winImzaHazirlaTimeoutMs: 30000, winImzaTimeoutMs: 30000,
  };
  const oku = () => (fs.existsSync(gunluk) ? fs.readFileSync(gunluk, 'utf8').trim().split('\n') : []);
  return { d, exe, cfg, oku };
}

test('imzaHazirla: betiğin HAZIR-KANIT\'ını döndürür', async () => {
  const z = sahteZincir();
  const k = await W.imzaHazirla({ exe: z.exe, work: z.d, cfg: z.cfg, log: () => {} });
  assert.deepEqual(k, { ad: 'a.exe', boyut: 4, sha256: 'ab', geriOkuma: false });
  assert.deepEqual(z.oku(), ['hazirla']);
});

test('imzaliYayinZinciri: varsayılan → hazirla, SONRA hazirlandi, sonra bekle-ve-tak (yuva tekil)', async () => {
  const z = sahteZincir();
  const sira = [];
  await assert.rejects(W.imzaliYayinZinciri({
    imzasiz: z.exe, job: { bookId: '1' }, work: z.d, cfg: z.cfg, log: () => {}, sleep: async () => {}, kanit: {},
    hazirlandi: () => sira.push(`hazirlandi@${z.oku().join(',')}`),
  }), /2 denemede imzalamadı/);
  assert.deepEqual(z.oku(), ['hazirla', 'bekle-ve-tak']);
  assert.deepEqual(sira, ['hazirlandi@hazirla'], 'ileri kopya tetiği hazırlıktan sonra, imzadan önce');
});

test('imzaliYayinZinciri hazirlaAtla: _hazir kopyası YAPILMAZ, hazirlandi yine çağrılır, imza adımı aynen', async () => {
  const z = sahteZincir();
  const loglar = [];
  let cagri = 0;
  await assert.rejects(W.imzaliYayinZinciri({
    imzasiz: z.exe, job: { bookId: '1' }, work: z.d, cfg: z.cfg, log: (...a) => loglar.push(a.join(' ')),
    sleep: async () => {}, kanit: {}, hazirlaAtla: true, hazirlandi: () => { cagri += 1; },
  }), /2 denemede imzalamadı/);
  assert.deepEqual(z.oku(), ['bekle-ve-tak'], 'hazirla koşmadı');
  assert.equal(cagri, 1);
  assert.match(loglar.join('\n'), /imza hazırlığı ATLANDI — _hazir kopyası ön-kopyada hazır/);
});

test('imzaliYayinZinciri: hazirlandi fırlatsa da zincir sürer (yalnız uyarı)', async () => {
  const z = sahteZincir();
  const loglar = [];
  await assert.rejects(W.imzaliYayinZinciri({
    imzasiz: z.exe, job: { bookId: '1' }, work: z.d, cfg: z.cfg, log: (...a) => loglar.push(a.join(' ')),
    sleep: async () => {}, kanit: {}, hazirlandi: () => { throw new Error('boom'); },
  }), /2 denemede imzalamadı/);
  assert.deepEqual(z.oku(), ['hazirla', 'bekle-ve-tak']);
  assert.match(loglar.join('\n'), /UYARI hazırlandı geri çağrısı: boom/);
});

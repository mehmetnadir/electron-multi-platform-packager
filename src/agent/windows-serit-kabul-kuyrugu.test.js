'use strict';

/**
 * KABUL KUYRUĞU (05.10) — windows-serit `yayinOncesiZincir` kuyruk kipi + saf üretim kapısı.
 * Gerçek kapı/kabul/imza/kasa YOK: statik kapı ve başsız kabul sahte betik, imza betiği sahte betik,
 * hazır kök ve kanıt dizini mkdtemp altında.
 *
 *  (A) kuyruk kipi: statik kapı koşar; kabulKos ve imza ÇAĞRILMAZ; kayıt kabul-bekliyor; dönüş kabulKuyrugu
 *  (B) kuyruk kipi + kapı RED: fırlatır, kayıt YOK
 *  (C) satır içi kip (varsayılan): kabul koşar (eski davranış)
 *  (D) uretimKapisi karar tablosu
 */

const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { izoleOrtam } = require('./test-yalitim');
const YALITIM = izoleOrtam();
after(() => YALITIM.temizle());

const W = require('./windows-serit');
const H = require('./windows-hazir');
const { uretimKapisi } = require('./runner-helpers');

const tmp = (ad) => fs.mkdtempSync(path.join(os.tmpdir(), `serit-kk-${ad}-`));

function ortam({ kapiRed = false } = {}) {
  const d = tmp('o');
  const node = process.execPath;
  const gunluk = path.join(d, 'gunluk.txt');
  const yaz = (ad, govde) => { const p = path.join(d, ad); fs.writeFileSync(p, govde, { mode: 0o755 }); return p; };
  const kaydet = `const kaydet=(s)=>require('fs').appendFileSync(${JSON.stringify(gunluk)},s+'\\n');`;
  const kapi = yaz('kapi.js', `#!${node}
${kaydet}
const fs=require('fs'),os=require('os'),path=require('path');
kaydet('kapi');
const g=fs.mkdtempSync(path.join(os.tmpdir(),'serit-kk-kapi-'));
fs.mkdirSync(path.join(g,'app','resources','app'),{recursive:true});
fs.writeFileSync(path.join(g,'app','resources','app','index.html'),'<html>k</html>');
console.log('Çıkarım: '+g);
const m=[];for(let no=1;no<=15;no+=1){m.push({no,ad:'m'+no,durum:(no===3||no===5)?'ÖLÇÜLEMEDİ':'PASS',detay:'d'});}
if(${kapiRed}){m[12].durum='FAIL';}
console.log(JSON.stringify({maddeler:m},null,2));process.exit(m.some((x)=>x.durum==='FAIL')?1:3);
`);
  const kabul = yaz('kabul.js', `#!${node}\n${kaydet}\nkaydet('kabul');console.log('[kabul] SONUÇ: GEÇTİ');process.exit(0);\n`);
  const imza = yaz('imza.sh', `#!/bin/bash\necho "imza $1" >> ${JSON.stringify(gunluk)}\nexit 9\n`);
  const cfg = {
    ...W.varsayilanAyarlar(), winKapiBetigi: kapi, winKabulCli: kabul, winAgirSh: '',
    winImzaBetigi: imza, winImzaKabuk: 'bash', winImzaYuvaKoku: path.join(d, 'yok'),
    winHazirKoku: path.join(d, 'windows-hazir'), winKanitDizini: path.join(d, 'kanit'), winKasaKabul: false,
  };
  const exe = path.join(d, 'runner-74390-T-2.51.3-Setup.exe');
  fs.writeFileSync(exe, Buffer.concat([Buffer.from('MZ'), crypto.randomBytes(4000)]));
  const oku = () => (fs.existsSync(gunluk) ? fs.readFileSync(gunluk, 'utf8') : '');
  const zincir = (ek) => W.yayinOncesiZincir({
    artifactPath: exe, job: { bookId: '74390', platform: 'windows', bookTitle: 'T', surum: '2.51.3' },
    plan: { surum: '2.51.3', setKimligi: '74390' }, work: tmp('w'), jobId: 'j1', cfg, log: () => {},
    sleep: async () => {}, aktivasyon: false, imzaKipi: 'hazir', r2Hedef: async () => ({ r2ObjectKey: 'k' }), ...ek,
  });
  return { cfg, exe, oku, zincir };
}

test('(A) kuyruk kipi: statik kapı koşar, kabul ve imza ÇAĞRILMAZ, kayıt kabul-bekliyor, bekçi listesi boş', async () => {
  const o = ortam();
  const r = await o.zincir({ kabulKipi: 'kuyruk' });
  assert.equal(r.kabulKuyrugu, true);
  assert.equal(r.kanit.durum, 'kabul-bekliyor');
  assert.match(o.oku(), /^kapi$/m);
  assert.doesNotMatch(o.oku(), /^kabul$/m, 'imzasız kabul işçiye bırakıldı');
  assert.doesNotMatch(o.oku(), /^imza /m, 'imza yok');
  const k = await H.hazirBul(o.cfg, '74390', '2.51.3');
  assert.equal(k.manifest.durum, 'kabul-bekliyor');
  assert.equal(k.manifest.r2Hedef.r2ObjectKey, 'k');
  assert.equal(k.manifest.kabulKapi, null);
  assert.deepEqual(await H.hazirListesi(o.cfg), [], 'imza bekçisi kabulsüz kaydı görmez');
  assert.equal((await H.kabulListesi(o.cfg)).length, 1);
  const kanit = JSON.parse(fs.readFileSync(W.kanitYolu(o.cfg, '74390', '2.51.3'), 'utf8'));
  assert.equal(kanit.durum, 'kabul-bekliyor');
  assert.equal(kanit.kabulImzasiz, undefined, 'kabul sonucu kanıta yazılmadı (koşmadı)');
});

test('(B) kuyruk kipi + statik kapı RED: fırlatır, kabul-bekliyor kaydı YOK', async () => {
  const o = ortam({ kapiRed: true });
  await assert.rejects(o.zincir({ kabulKipi: 'kuyruk' }), /statik kapı RED/);
  assert.equal(await H.hazirBul(o.cfg, '74390', '2.51.3'), null);
  assert.deepEqual(await H.kabulListesi(o.cfg), []);
  assert.doesNotMatch(o.oku(), /^kabul$/m);
});

test('(C) satır içi kip (varsayılan): kabul koşar, kayıt imza-bekliyor (eski davranış değişmedi)', async () => {
  const o = ortam();
  const r = await o.zincir({});
  assert.equal(r.kabulKuyrugu, undefined);
  assert.match(o.oku(), /^kabul$/m);
  const k = await H.hazirBul(o.cfg, '74390', '2.51.3');
  assert.equal(k.manifest.durum, 'imza-bekliyor');
  assert.equal(k.manifest.kabulKapi, 'basliksiz');
});

test('(D) uretimKapisi karar tablosu: kuyruk derinliği, disk alt sınırı, ölçülemeyen disk', () => {
  const t = (p) => uretimKapisi({ kuyrukSayisi: 0, derinlik: 1, bosGb: 100, minGb: 15, ...p });
  assert.deepEqual(t({}), { acik: true });
  assert.equal(t({ kuyrukSayisi: 1 }).acik, false, '1 bekleyen, derinlik 1 → kapalı');
  assert.match(t({ kuyrukSayisi: 1 }).sebep, /kabul kuyruğu dolu \(1 bekleyen >= derinlik 1\)/);
  assert.equal(t({ kuyrukSayisi: 1, derinlik: 2 }).acik, true);
  assert.equal(t({ kuyrukSayisi: 2, derinlik: 2 }).acik, false);
  assert.equal(t({ kuyrukSayisi: 0, derinlik: 0 }).acik, true, 'derinlik 0 → 1 sayılır');
  assert.equal(t({ kuyrukSayisi: 1, derinlik: 0 }).acik, false);
  assert.equal(t({ bosGb: 14 }).acik, false);
  assert.match(t({ bosGb: 14 }).sebep, /üretim diski dar \(14 GB boş < 15 GB\)/);
  assert.equal(t({ bosGb: 15 }).acik, true, 'sınır dahil açık');
  assert.equal(t({ bosGb: null }).acik, true, 'ölçülemeyen disk kapıyı kapatmaz (fail-open)');
  assert.equal(t({ bosGb: 1, minGb: 0 }).acik, true, 'minGb 0 → disk ölçütü kapalı');
  assert.match(t({ kuyrukSayisi: 3, bosGb: 1 }).sebep, /kabul kuyruğu dolu/, 'kuyruk önce');
});

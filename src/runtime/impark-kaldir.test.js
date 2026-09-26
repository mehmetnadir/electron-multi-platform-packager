'use strict';

/**
 * İmpark devralma/kaldırma testleri (sözleşme G6) — gerçek dosya sistemi (mkdtemp).
 * Silme çağrıları (rmSync/unlinkSync) SARILIR: gerçekten silmek yerine "silindi/"
 * altına taşınır ve kaydedilir — testin kendisi hiçbir şey silmez.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ik = require('./impark-kaldir');

function gecici() { return fs.mkdtempSync(path.join(os.tmpdir(), 'empp-impark-')); }

function yazDosya(tam, icerik = 'x') {
  fs.mkdirSync(path.dirname(tam), { recursive: true });
  fs.writeFileSync(tam, icerik);
}

/** SM2 benzeri SET kökü: kurum 60, book1..3 → 58336/73456/58237 */
function setKoku(kok, { kurum = '60', kitaplar = { book1: '58336', book2: '73456', book3: '58237' } } = {}) {
  yazDosya(path.join(kok, 'kurum.txt'), kurum);
  yazDosya(path.join(kok, 'index.html'), '<html></html>');
  for (const [k, id] of Object.entries(kitaplar)) {
    yazDosya(path.join(kok, k, 'assets', id, 'data', 'BookContent.xml'), '<x/>');
    yazDosya(path.join(kok, k, 'classlibraries', 'ImWin32.dll'), 'PAKETTEKI-BOS');
  }
  return kok;
}

/** C:\DijiTap\<vhost>\<ad> benzeri İmpark kurulumu */
function imparkKur(dijitap, vhost, ad, secenek = {}) {
  const klasor = path.join(dijitap, vhost, ad);
  if (secenek.exe !== false) yazDosya(path.join(klasor, 'ZKitap.exe'), 'MZ');
  yazDosya(path.join(klasor, 'resources', 'app', 'package.json'), JSON.stringify({ name: secenek.paketAdi || 'zkitap' }));
  const build = setKoku(path.join(klasor, 'resources', 'app', 'build'), secenek);
  yazDosya(path.join(build, 'book1', 'classlibraries', 'ImWin32.dll'), 'AKTIF-ANAHTAR-DEPOSU');
  yazDosya(path.join(build, 'book1', 'assets', '58336', 'imKeys.dll'), 'IMKEYS');
  yazDosya(path.join(build, 'book2', 'temp', 'data', 'storage.im'), 'KULLANICI-VERISI');
  return klasor;
}

/** Silmeyi taşımaya çeviren fs sargısı. */
function kayitliFs(cop) {
  const kayit = { rm: [], unlink: [] };
  let n = 0;
  const f = Object.create(fs);
  f.rmSync = (p) => { kayit.rm.push(p); fs.renameSync(p, path.join(cop, `rm-${n++}`)); };
  f.unlinkSync = (p) => { kayit.unlink.push(p); fs.renameSync(p, path.join(cop, `unlink-${n++}`)); };
  return { f, kayit };
}

function ortam() {
  const kok = gecici();
  const dijitap = path.join(kok, 'DijiTap');
  const bizim = setKoku(path.join(kok, 'bizim-app'));
  const userData = path.join(kok, 'userData');
  const workKok = path.join(userData, 'work');
  const profil = path.join(kok, 'profil');
  fs.mkdirSync(path.join(profil, 'Desktop'), { recursive: true });
  const cop = path.join(kok, 'silindi');
  fs.mkdirSync(cop);
  fs.mkdirSync(userData, { recursive: true });
  return { kok, dijitap, bizim, userData, workKok, profil, cop };
}

test('kimlikOku / kimlikEsitMi: kurum + kitap→assets id kümesi; tek kitap; belirsiz → null', () => {
  const k = setKoku(gecici());
  assert.deepStrictEqual(ik.kimlikOku(k), { kurum: '60', kitaplar: { book1: '58336', book2: '73456', book3: '58237' } });
  const tek = gecici();
  yazDosya(path.join(tek, 'kurum.txt'), '60\n');
  yazDosya(path.join(tek, 'assets', '70001', 'data', 'x.xml'));
  assert.deepStrictEqual(ik.kimlikOku(tek), { kurum: '60', kitaplar: { '.': '70001' } });
  const iki = setKoku(gecici());
  fs.mkdirSync(path.join(iki, 'book1', 'assets', '99999'));
  assert.strictEqual(ik.kimlikOku(iki), null, 'bir kitapta iki assets id → emin değil');
  assert.strictEqual(ik.kimlikOku(gecici()), null, 'kurum.txt yok');
  const a = ik.kimlikOku(k);
  assert.ok(ik.kimlikEsitMi(a, ik.kimlikOku(setKoku(gecici()))));
  assert.ok(!ik.kimlikEsitMi(a, ik.kimlikOku(setKoku(gecici(), { kurum: '61' }))));
  assert.ok(!ik.kimlikEsitMi(a, ik.kimlikOku(setKoku(gecici(), { kitaplar: { book1: '58336', book2: '73456' } }))));
  assert.ok(!ik.kimlikEsitMi(a, ik.kimlikOku(setKoku(gecici(), { kitaplar: { book1: '58336', book2: '73456', book3: '11111' } }))));
});

test('hazirla: Windows değilse / DijiTap yoksa / kapı 0 ise hiçbir şey yapmaz', () => {
  const o = ortam();
  imparkKur(o.dijitap, 'akillitahta.ydspublishing.com', 'SM2-v50');
  assert.strictEqual(ik.hazirla({ kok: o.bizim, userData: o.userData, workKok: o.workKok, platform: 'darwin', dijitap: o.dijitap }).plan, 'windows-degil');
  assert.strictEqual(ik.hazirla({ kok: o.bizim, userData: o.userData, workKok: o.workKok, platform: 'win32', dijitap: path.join(o.kok, 'yok'), env: {} }).plan, 'dijitap-yok');
  assert.strictEqual(ik.hazirla({ kok: o.bizim, userData: o.userData, workKok: o.workKok, platform: 'win32', dijitap: o.dijitap, env: { EMPP_IMPARK_KALDIR: '0' } }).plan, 'kapali');
  assert.strictEqual(fs.existsSync(o.workKok), false);
});

test('hazirla: YALNIZ kimliği eşleşen İmpark klasörü seçilir; aktivasyon + kullanıcı verisi WORK\'e taşınır, üzerine yazılmaz', () => {
  const o = ortam();
  const dogru = imparkKur(o.dijitap, 'akillitahta.ydspublishing.com', 'SM2-v50');
  imparkKur(o.dijitap, 'akillitahta.ydspublishing.com', 'SM3-v12', { kitaplar: { book1: '11111', book2: '22222', book3: '33333' } });
  imparkKur(o.dijitap, 'baska.com', 'KurumFarkli', { kurum: '61' });
  imparkKur(o.dijitap, 'baska.com', 'ExeYok', { exe: false });
  imparkKur(o.dijitap, 'baska.com', 'BizimEski', { paketAdi: 'super-monsters-2-set' });
  // WORK'te zaten olan dosya korunur
  yazDosya(path.join(o.workKok, 'book2', 'temp', 'data', 'storage.im'), 'BIZIM-YENI-VERI');
  const satir = [];
  const h = ik.hazirla({ kok: o.bizim, userData: o.userData, workKok: o.workKok, platform: 'win32', dijitap: o.dijitap, env: {}, yaz: (e, a) => satir.push(`${e} | ${a}`) });
  assert.strictEqual(h.plan, 'kaldir');
  assert.deepStrictEqual(h.eslesen.map((x) => x.klasor), [dogru]);
  assert.strictEqual(fs.readFileSync(path.join(o.workKok, 'book1', 'classlibraries', 'ImWin32.dll'), 'utf8'), 'AKTIF-ANAHTAR-DEPOSU');
  assert.strictEqual(fs.readFileSync(path.join(o.workKok, 'book1', 'assets', '58336', 'imKeys.dll'), 'utf8'), 'IMKEYS');
  assert.strictEqual(fs.readFileSync(path.join(o.workKok, 'book2', 'temp', 'data', 'storage.im'), 'utf8'), 'BIZIM-YENI-VERI');
  assert.ok(satir.some((x) => x.startsWith('impark: veri taşındı')), satir.join('\n'));
});

test('hazirla: kendi kimliğimiz okunamazsa hiçbir şeye dokunulmaz', () => {
  const o = ortam();
  imparkKur(o.dijitap, 'v', 'SM2');
  const bozuk = gecici();
  const h = ik.hazirla({ kok: bozuk, userData: o.userData, workKok: o.workKok, platform: 'win32', dijitap: o.dijitap, env: {} });
  assert.strictEqual(h.plan, 'kimlik-yok');
  assert.strictEqual(fs.existsSync(o.workKok), false);
});

test('kaldir: ZKitap çalışmıyorsa klasör kaldırılır, YALNIZ o klasörü gösteren kısayol silinir; zkitap userData\'sına dokunulmaz', () => {
  const o = ortam();
  const klasor = imparkKur(o.dijitap, 'akillitahta.ydspublishing.com', 'SM2-v50');
  const baska = imparkKur(o.dijitap, 'akillitahta.ydspublishing.com', 'SM3-v12', { kitaplar: { book1: '1', book2: '2', book3: '3' } });
  const lnkBizim = path.join(o.profil, 'Desktop', 'SM2-v50.lnk');
  const lnkBaska = path.join(o.profil, 'Desktop', 'SM3-v12.lnk');
  fs.writeFileSync(lnkBizim, Buffer.concat([Buffer.from('L\0\0\0'), Buffer.from(path.join(klasor, 'ZKitap.exe'), 'utf16le')]));
  fs.writeFileSync(lnkBaska, Buffer.concat([Buffer.from('L\0\0\0'), Buffer.from(path.join(baska, 'ZKitap.exe'), 'utf16le')]));
  const zkitapUserData = path.join(o.kok, 'AppData', 'Roaming', 'zkitap');
  yazDosya(path.join(zkitapUserData, 'Local Storage', 'leveldb', '000003.log'), 'PAYLASILAN');
  const { f, kayit } = kayitliFs(o.cop);
  const h = ik.hazirla({ kok: o.bizim, userData: o.userData, workKok: o.workKok, platform: 'win32', dijitap: o.dijitap, env: {}, fsMod: f });
  const satir = [];
  const r = ik.kaldir(h.eslesen, {
    userData: o.userData, env: { USERPROFILE: o.profil }, fsMod: f,
    execFileSync: () => 'INFO: No tasks are running which match the specified criteria.\r\n',
    yaz: (e, a) => satir.push(`${e} | ${a}`),
  });
  assert.strictEqual(r.length, 1);
  assert.match(r[0].sonuc, /^kaldırıldı \+ kısayol: SM2-v50\.lnk$/);
  assert.deepStrictEqual(kayit.rm, [klasor + ik.SILINECEK_EKI]);
  assert.deepStrictEqual(kayit.unlink, [lnkBizim]);
  assert.strictEqual(fs.existsSync(klasor), false);
  assert.ok(fs.existsSync(baska), 'başka kitabın İmpark kurulumu durur');
  assert.ok(fs.existsSync(lnkBaska), 'başka kitabın kısayolu durur');
  assert.ok(fs.existsSync(path.join(zkitapUserData, 'Local Storage', 'leveldb', '000003.log')), 'zkitap userData dokunulmaz');
  const durum = JSON.parse(fs.readFileSync(path.join(o.userData, ik.DURUM_DOSYASI), 'utf8'));
  assert.match(durum.klasorler[klasor].sonuc, /^kaldırıldı/);
  assert.ok(satir.some((x) => x.startsWith('impark: kaldırma')));
});

test('kaldir: ZKitap çalışıyorsa / süreç listesi alınamazsa / yetki yoksa SİLMEZ, günlüğe yazar', () => {
  for (const [ad, exec, renameHata, beklenen] of [
    ['çalışıyor', () => '"ZKitap.exe","4242","Console","1","200,000 K"\r\n', null, /çalışıyor/],
    ['liste yok', () => { throw new Error('tasklist yok'); }, null, /süreç listesi alınamadı/],
    ['yetki yok', () => 'INFO: No tasks\r\n', 'EPERM', /yetki\/kilit \(EPERM\) — yükseltme istenmedi/],
  ]) {
    const o = ortam();
    const klasor = imparkKur(o.dijitap, 'v', 'SM2');
    const { f, kayit } = kayitliFs(o.cop);
    if (renameHata) f.renameSync = () => { const e = new Error('izin yok'); e.code = renameHata; throw e; };
    const h = ik.hazirla({ kok: o.bizim, userData: o.userData, workKok: o.workKok, platform: 'win32', dijitap: o.dijitap, env: {}, fsMod: f });
    const r = ik.kaldir(h.eslesen, { userData: o.userData, env: {}, fsMod: f, execFileSync: exec });
    assert.match(r[0].sonuc, beklenen, ad);
    assert.deepStrictEqual(kayit.rm, [], ad);
    assert.ok(fs.existsSync(path.join(klasor, 'ZKitap.exe')), ad);
  }
});

test('kisayolKlasoreMiAit: UTF-16LE, kaymış UTF-16, ANSI; büyük/küçük harf duyarsız; başka yol → hayır', () => {
  const k = 'C:\\DijiTap\\akillitahta.ydspublishing.com\\SM2-v50';
  assert.ok(ik.kisayolKlasoreMiAit(Buffer.from(`${k}\\ZKitap.exe`, 'utf16le'), k));
  assert.ok(ik.kisayolKlasoreMiAit(Buffer.concat([Buffer.from([0]), Buffer.from(k.toUpperCase(), 'utf16le')]), k));
  assert.ok(ik.kisayolKlasoreMiAit(Buffer.from(`xx${k}\\ZKitap.exe`, 'latin1'), k));
  assert.ok(!ik.kisayolKlasoreMiAit(Buffer.from('C:\\DijiTap\\akillitahta.ydspublishing.com\\SM3-v12\\ZKitap.exe', 'utf16le'), k));
});

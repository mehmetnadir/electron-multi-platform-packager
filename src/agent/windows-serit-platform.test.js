'use strict';

/**
 * Windows şeridinin platform uyumu (windows-kasa ajanı, 2026-10-02): runner kasa'da (win32) koşarken
 * yuva probu `ping -c` / `/bin/test` kullanamaz. macOS komutları AYNEN kalmalı.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('./windows-serit');

const cfg = { winImzaYuvaSunucu: '172.17.2.21', winImzaYuvaKoku: '/Users/x/Impark/Storage7/KitapTekExe' };

test('yuva probu macOS: ping -c 1 -W 2000 + /bin/test -d + SMB bağlama kanıtı (df kaynağı //)', () => {
  assert.deepEqual(W.yuvaProbKomutlari(cfg, 'darwin', '/node'), [
    ['ping', '-c', '1', '-W', '2000', '172.17.2.21'],
    ['/bin/test', '-d', cfg.winImzaYuvaKoku],
    ['/bin/sh', '-c', 'df -P "$1" | tail -1 | grep -q "^//"', 'sh', cfg.winImzaYuvaKoku],
  ]);
});

test('GERİLEME 04.10: yerel dizin (SMB değil) yuva sayılmaz — Storage7 düşükken ~/Impark yerel kalır', async () => {
  if (process.platform === 'win32') return;
  const yerel = { winImzaYuvaSunucu: '', winImzaYuvaKoku: __dirname };
  const k = W.yuvaProbKomutlari(yerel, process.platform, process.execPath);
  assert.equal((await W.komutKos(k[0], { zamanAsimiMs: 8000 })).kod, 0, 'dizin var');
  assert.notEqual((await W.komutKos(k[1], { zamanAsimiMs: 8000 })).kod, 0, 'ama SMB bağlaması değil');
  assert.equal(await W.imzaYuvasiErisilirMi(yerel), false);
});

test('yuva probu Windows: ping -n 1 -w 2000 + node statSync (bash/test yok)', () => {
  const k = W.yuvaProbKomutlari({ ...cfg, winImzaYuvaKoku: '\\\\172.17.2.21\\yuva' }, 'win32', 'D:\\node.exe');
  assert.deepEqual(k[0], ['ping', '-n', '1', '-w', '2000', '172.17.2.21']);
  assert.equal(k[1][0], 'D:\\node.exe');
  assert.equal(k[1][1], '-e');
  assert.equal(k[1][3], '\\\\172.17.2.21\\yuva');
});

test('yuva probu: sunucu boşsa ping atlanır', () => {
  assert.equal(W.yuvaProbKomutlari({ ...cfg, winImzaYuvaSunucu: '' }, 'win32', 'n').length, 1);
});

test('Windows yuva probu FAIL-CLOSED: kök listelenebilmeli; 66902 yoksa da erişilir (04.10 exe-remove klasörü siler)', async () => {
  const fs = require('fs'); const os = require('os'); const path = require('path');
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'yuva-prob-'));
  const kos = async (k) => {
    const [, prob] = W.yuvaProbKomutlari({ ...cfg, winImzaYuvaKoku: k }, 'win32', process.execPath);
    return (await W.komutKos(prob, { zamanAsimiMs: 8000 })).kod;
  };
  assert.equal(await kos(kok), 0, 'kök var + 66902 yok → erişilir (exe-create klasörü açar)');
  fs.mkdirSync(path.join(kok, W.YUVA_ID));
  assert.equal(await kos(kok), 0, 'kök + 66902 listelenebilir → erişilir');
  assert.notEqual(await kos(path.join(kok, 'yok-boyle-dizin')), 0, 'kök yok → erişilemez');
  const dosya = path.join(kok, 'dosya.txt'); fs.writeFileSync(dosya, 'x');
  assert.notEqual(await kos(dosya), 0, 'kök listelenemez (dosya) → erişilemez');
});

test('imzaYuvasiErisilirMi win32 dışı sahte: yerel/yarım UNC kök → erişilemez (fail-closed korunur)', () => {
  assert.equal(W.yuvaKokuUncMu('C:\\yerel\\yuva'), false);
  assert.equal(W.yuvaKokuUncMu('\\\\sunucu'), false);
});

test('yuvaKokuUncMu: yalnız \\\\sunucu\\paylaşım kabul; yerel yol ve yarım UNC red', () => {
  assert.equal(W.yuvaKokuUncMu(W.WIN_YUVA_KOKU), true);
  assert.equal(W.yuvaKokuUncMu('\\\\172.17.2.23\\Storage7'), true);
  assert.equal(W.yuvaKokuUncMu('C:\\Users\\Administrator\\yuva'), false);
  assert.equal(W.yuvaKokuUncMu('D:\\empp-ajan\\Storage7'), false);
  assert.equal(W.yuvaKokuUncMu('\\\\sunucu'), false);
  assert.equal(W.yuvaKokuUncMu(''), false);
});

test('win32 varsayılanları: Node gözcü + istek dosyası + Authenticode; yuva kökü kapılı (boş → hazır kip)', async () => {
  const c = W.varsayilanAyarlar('win32', {});
  assert.match(c.winImzaBetigi, /imza-yuva-win\.js$/);
  assert.equal(c.winImzaKabuk, process.execPath);
  assert.equal(c.winImzaDogrulama, 'authenticode');
  assert.ok(c.winImzaIstekDizini.endsWith('imza-istek'));
  assert.equal(c.winImzaYabanciDesen, '');
  assert.equal(c.winImzaYuvaKoku, '', 'iki makine arası yuva kilidi yokken kasa yuvaya yazmaz');
  assert.equal(await W.imzaYuvasiErisilirMi({ ...c, winImzaYuvaSunucu: '' }), false);
  assert.equal((await W.imzaKipiSec({ ...c, winImzaYuvaSunucu: '', winHazirAcik: true })).kip, 'hazir');
  const acik = W.varsayilanAyarlar('win32', { EMPP_IMZA_YUVA_KOKU: W.WIN_YUVA_KOKU });
  assert.ok(acik.winImzaYuvaKoku.startsWith('\\\\172.17.2.23\\Storage7\\'));
});

test('macOS varsayılanları değişmedi: bash betiği, osslsigncode, yayincilikadm doğrudan, ~/Impark yuvası', () => {
  const c = W.varsayilanAyarlar('darwin', {});
  assert.match(c.winImzaBetigi, /scripts[\\/]imza-yuva-smb\.sh$/);
  assert.equal(c.winImzaKabuk, 'bash');
  assert.equal(c.winImzaDogrulama, 'osslsigncode');
  assert.equal(c.winImzaIstekDizini, '');
  assert.match(c.winImzaYuvaKoku, /Impark[\\/]Storage7[\\/]/);
  assert.deepEqual(c.winImzaTetik, ['yayincilikadm', 'book', 'exe-create', '66902', '--wait', '0']);
  assert.deepEqual(W.imzaEnv('/w', c), { SMB_SHA: '0', TETIK: '1', IMZALI_DIZIN: require('path').join('/w', 'imzali') });
});

test('win32 tetik ve imzaEnv: tetik İSTEK dosyası olur (yayincilikadm çağrılmaz), env istek dizinini taşır', () => {
  const fs = require('fs'); const os = require('os'); const path = require('path');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tetik-'));
  const cfg = { winImzaIstekDizini: d, winImzaYuvaKoku: 'Y', winImzaTetik: ['/bin/false-olmamali'] };
  const loglar = [];
  W.tetikCek(cfg, d, (...a) => loglar.push(a.join(' ')), 'C:\\is\\a.exe');
  const ist = fs.readdirSync(d).filter((a) => /exe-create/.test(a));
  assert.equal(ist.length, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(d, ist[0]), 'utf8')).exe, 'a.exe');
  assert.match(loglar.join('\n'), /İSTEK olarak bırakıldı/);
  assert.deepEqual(W.imzaEnv('/w', cfg), { SMB_SHA: '0', TETIK: '1', IMZALI_DIZIN: path.join('/w', 'imzali'), EMPP_IMZA_ISTEK_DIZINI: d, EMPP_IMZA_YUVA_KOKU: 'Y' });
});

test('win32 dosya kilidi: ikinci alma 75; sahibi ölmüş kilit devralınır; bırakınca yeniden alınır', async () => {
  const fs = require('fs'); const os = require('os'); const path = require('path');
  const yol = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kilit-')), 'k');
  const a = await W.dosyaKilidiDene(yol);
  assert.ok(a.tutucu);
  assert.equal((await W.dosyaKilidiDene(yol)).kod, 75);
  await W.kilitBirak(a.tutucu);
  const b = await W.dosyaKilidiDene(yol);
  assert.ok(b.tutucu);
  fs.writeFileSync(yol, JSON.stringify({ pid: 999999999, zaman: new Date().toISOString() }));
  const c = await W.dosyaKilidiDene(yol, { pidYasiyor: () => false });
  assert.ok(c.tutucu, 'ölü sahibin kilidi devralındı');
  assert.ok(fs.readdirSync(path.dirname(yol)).some((x) => x.startsWith('k.bayat-')), 'bayat kilit silinmedi, kenara alındı');
});

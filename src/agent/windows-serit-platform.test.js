'use strict';

/**
 * Windows şeridinin platform uyumu (windows-kasa ajanı, 2026-10-02): runner kasa'da (win32) koşarken
 * yuva probu `ping -c` / `/bin/test` kullanamaz. macOS komutları AYNEN kalmalı.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('./windows-serit');

const cfg = { winImzaYuvaSunucu: '172.17.2.21', winImzaYuvaKoku: '/Users/x/Impark/Storage7/KitapTekExe' };

test('yuva probu macOS: ping -c 1 -W 2000 + /bin/test -d (değişmedi)', () => {
  assert.deepEqual(W.yuvaProbKomutlari(cfg, 'darwin', '/node'), [
    ['ping', '-c', '1', '-W', '2000', '172.17.2.21'],
    ['/bin/test', '-d', cfg.winImzaYuvaKoku],
  ]);
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

test('Windows dizin probu gerçekten çalışır: var olan dizin 0, olmayan ≠0 (bu makinenin node\'u ile)', async () => {
  const [, prob] = W.yuvaProbKomutlari({ ...cfg, winImzaYuvaKoku: __dirname }, 'win32', process.execPath);
  assert.equal((await W.komutKos(prob, { zamanAsimiMs: 8000 })).kod, 0);
  const [, yok] = W.yuvaProbKomutlari({ ...cfg, winImzaYuvaKoku: `${__dirname}/yok-boyle-dizin` }, 'win32', process.execPath);
  assert.notEqual((await W.komutKos(yok, { zamanAsimiMs: 8000 })).kod, 0);
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

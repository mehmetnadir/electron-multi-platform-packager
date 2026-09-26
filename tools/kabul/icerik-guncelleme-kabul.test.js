'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const AdmZip = require('adm-zip');
const runtimeIcerik = require('../../src/runtime/icerik-guncelleme');
const m = require('./icerik-guncelleme-kabul');
const O = require('./olcutler');

const tmp = (ad) => fs.mkdtempSync(path.join(os.tmpdir(), `k-kabul-${ad}-`));

/**
 * SENTETİK (ağsız) ama YAPISAL OLARAK GERÇEK bir ZKitapZipH: kökte `data/BookContent.xml`
 * + `pages/<n>.png`, `acmaDogrula`nın beklediği ile birebir (bkz. runtime modülü).
 */
function ornekZip(hedefYolu, { sayfa = 3, bookContent } = {}) {
  fs.mkdirSync(path.dirname(hedefYolu), { recursive: true });
  const z = new AdmZip();
  const bc = bookContent || '<?xml version="1.0"?><Book kitapId="test"></Book>';
  z.addFile('data/BookContent.xml', Buffer.from(bc, 'utf8'));
  for (let i = 1; i <= sayfa; i += 1) z.addFile(`pages/${i}.png`, Buffer.from(`PNG-${i}`));
  z.writeZip(hedefYolu);
  return hedefYolu;
}

test('adlaTuret: "<id>-<v>.zip" ayrıştırır; başka desende null', () => {
  assert.deepStrictEqual(m.adlaTuret('/x/y/57806-4.zip'), { id: '57806', surum: 4 });
  assert.deepStrictEqual(m.adlaTuret('57806-4.zip'), { id: '57806', surum: 4 });
  assert.strictEqual(m.adlaTuret('kitap.zip'), null);
  assert.strictEqual(m.adlaTuret('57806.zip'), null);
  assert.strictEqual(m.adlaTuret('12-4.zip'), null, '2 haneli sahte id kabul edilmemeli (asgari 3 hane)');
  assert.deepStrictEqual(m.adlaTuret('123-4.zip'), { id: '123', surum: 4 }, '3 hane sınırında kabul edilmeli');
});

test('menuXml/encodeMenu: gerçek motor kodlamasıyla round-trip, kapak sürümü okunur', () => {
  const kodlu = m.encodeMenu('57806', 4);
  const xml = runtimeIcerik.menuCoz(kodlu);
  assert.match(xml, /<main /);
  const kapak = runtimeIcerik.kapaklar(xml).find((c) => c.ID === '57806');
  assert.strictEqual(kapak.version, 4);
});

test('kokKur: BASE + WORK dizinleri, ImWin32.dll decode edilebilir, empp-vendor/adm-zip GERÇEK paket', () => {
  const calisma = tmp('kok');
  const { base, work } = m.kokKur({ calisma, id: '57806', eskiSurum: 2 });
  assert.ok(fs.existsSync(path.join(base, 'classlibraries', 'ImWin32.dll')));
  assert.ok(fs.existsSync(work));
  assert.strictEqual(m.workMenuSurumu(work, base, '57806'), 2);
  const admZipJs = path.join(base, 'empp-vendor', 'adm-zip', 'adm-zip.js');
  assert.ok(fs.existsSync(admZipJs), 'empp-vendor/adm-zip gerçek paketten kopyalanmalı');
  // Kopyalanan gerçekten ÇALIŞAN bir adm-zip mi? (yalnız dosya var demek yetmez)
  // eslint-disable-next-line global-require, import/no-dynamic-require
  const Kopya = require(path.join(base, 'empp-vendor', 'adm-zip'));
  assert.strictEqual(typeof Kopya, 'function');
  fs.rmSync(calisma, { recursive: true, force: true });
});

test('rendererBaglamKur: win.require("adm-zip") sarmalı (__empp), win.require("fs") menü-süzgeçli (__emppIcerik)', () => {
  const calisma = tmp('renderer');
  const { base, work } = m.kokKur({ calisma, id: '57806', eskiSurum: 2 });
  const { win, ctx } = m.rendererBaglamKur({ base, work, log: () => {} });
  assert.ok(win.require('adm-zip').__empp);
  assert.ok(win.require('fs').__emppIcerik);
  assert.deepStrictEqual(ctx.dogrulanan, {});
  fs.rmSync(calisma, { recursive: true, force: true });
});

test('bozukZipUret: data/BookContent.xml GERÇEKTEN çıkarılmış, diğer girdiler korunur', () => {
  const calisma = tmp('bozuk');
  const gercek = ornekZip(path.join(calisma, 'gercek.zip'), { sayfa: 2 });
  const bozuk = m.bozukZipUret(gercek, path.join(calisma, 'bozuk.zip'));
  const z = new AdmZip(bozuk);
  assert.strictEqual(z.getEntry('data/BookContent.xml'), null);
  assert.ok(z.getEntry('pages/1.png'), 'diğer girdiler dokunulmadan kalmalı');
  fs.rmSync(calisma, { recursive: true, force: true });
});

test('argumanCoz: pozisyonel zip + tüm bayraklar', () => {
  const s = m.argumanCoz(['a.zip', '--kitap-id', '99', '--eski-surum', '1', '--yeni-surum', '2', '--bozuk', '--tut']);
  assert.strictEqual(s.zip, 'a.zip');
  assert.strictEqual(s.kitapId, '99');
  assert.strictEqual(s.eskiSurum, 1);
  assert.strictEqual(s.yeniSurum, 2);
  assert.strictEqual(s.bozuk, true);
  assert.strictEqual(s.tut, true);
});

test('argumanCoz: zip verilmezse yardım isteği gibi ele alınır (calis kod=2 döner)', async () => {
  const r = await m.calis([], () => {});
  assert.strictEqual(r.kod, 2);
});

test('calis: zip yoksa (yanlış yol) kod=2', async () => {
  const r = await m.calis(['/olmayan/yol/57806-4.zip'], () => {});
  assert.strictEqual(r.kod, 2);
});

// ─── UÇTAN UCA (sentetik zip, GERÇEK adm-zip + GERÇEK runtime kodu) ──────────────────

test('calis: GERÇEK içerik → doğrulanır, menü sürümü ilerler, sayfa sayısı ölçülür (GEÇTİ)', async () => {
  const calisma = tmp('e2e-basari');
  try {
    const zip = ornekZip(path.join(calisma, 'girdi', '57806-4.zip'), { sayfa: 5 });
    const r = await m.calis([zip, '--calisma', path.join(calisma, 'kosum'), '--tut'], () => {});
    assert.strictEqual(r.kod, O.CIKIS_KODU.GECTI, JSON.stringify(r.rapor));
    assert.strictEqual(r.rapor.kitapId, '57806');
    assert.strictEqual(r.rapor.eskiSurum, 3);
    assert.strictEqual(r.rapor.yeniSurum, 4);
    assert.strictEqual(r.rapor.surumOnce, 3);
    assert.strictEqual(r.rapor.surumSonra, 4, 'gerçek açma sonrası menü sürümü İLERLEMELİ');
    assert.strictEqual(r.rapor.acildi, true);
    assert.strictEqual(r.rapor.sayfaSayisi, 5);
    assert.strictEqual(
      r.rapor.bookContentMd5,
      crypto.createHash('md5').update(new AdmZip(zip).getEntry('data/BookContent.xml').getData()).digest('hex'),
      'diskteki BookContent.xml zip\'tekiyle AYNI md5\'e sahip olmalı (gerçekten açıldığının kanıtı)',
    );
    assert.ok(fs.existsSync(path.join(r.rapor.kanit, 'karar.json')));
  } finally { fs.rmSync(calisma, { recursive: true, force: true }); }
});

test('calis: doğrulandı ama sayfasız içerik (0 sayfa) → RED', async () => {
  const calisma = tmp('e2e-sayfasiz');
  try {
    const zip = ornekZip(path.join(calisma, 'girdi', '57806-4.zip'), { sayfa: 0 });
    const r = await m.calis([zip, '--calisma', path.join(calisma, 'kosum'), '--tut'], () => {});
    assert.strictEqual(r.kod, O.CIKIS_KODU.RED, JSON.stringify(r.rapor));
    assert.strictEqual(r.rapor.acildi, true, 'içerik yine de doğrulanmış olmalı (yalnız boş)');
    assert.match(r.rapor.sebepler.join(' | '), /pages\/ altında hiç sayfa yok/);
  } finally { fs.rmSync(calisma, { recursive: true, force: true }); }
});

test('calis: BOZUK zip (BookContent.xml yok) → menü süzgeci sahte ilerlemeyi REDDEDER, sonuç yine de GEÇTİ (kabul kapısı doğru çalıştı)', async () => {
  const calisma = tmp('e2e-bozuk');
  try {
    const zip = ornekZip(path.join(calisma, 'girdi', '57806-4.zip'), { sayfa: 5 });
    const r = await m.calis([zip, '--bozuk', '--calisma', path.join(calisma, 'kosum'), '--tut'], () => {});
    assert.strictEqual(r.kod, O.CIKIS_KODU.GECTI, JSON.stringify(r.rapor));
    assert.strictEqual(r.rapor.acildi, false, 'bozuk içerik doğrulanmamalı');
    assert.strictEqual(r.rapor.surumSonra, 3, 'menü sürümü İLERLEMEMELİ (sahte "güncellendi" olmamalı)');
    assert.strictEqual(r.rapor.sayfaSayisi, 0);
  } finally { fs.rmSync(calisma, { recursive: true, force: true }); }
});

// ─── MUTASYON KANITI ─────────────────────────────────────────────────────────────
// Aşağıdaki test menü SÜZGECİNİN (menuSuz / korumaliFs) rolünü kanıtlar: aynı bozuk
// içerikle, motorun sürüm yazma çağrısı korumalı fs YERİNE ÇIPLAK fs ile yapılsaydı
// (yani süzgeç devre dışı kalsaydı) sahte "güncellendi" durumu OLUŞURDU. Bu, testin
// gerçekten "menü süzgeci çalışıyor mu" sorusunu ölçtüğünü — yalnız uygulamanın kendi
// mutlu senaryosunu tekrar etmediğini — kanıtlar (bir regresyon menuSuz'u atlarsa bu
// test farkı gösterir).
test('MUTASYON KANITI: menü süzgeci YOKSA (çıplak fs ile yazım) bozuk içerik sahte ilerleme ÜRETİRDİ', () => {
  const calisma = tmp('mutasyon');
  try {
    const { base, work } = m.kokKur({ calisma, id: '57806', eskiSurum: 3 });
    const { win, ctx } = m.rendererBaglamKur({ base, work, log: () => {} });
    const zip = ornekZip(path.join(calisma, '57806-4.zip'), { sayfa: 2 });
    const bozuk = m.bozukZipUret(zip, path.join(calisma, 'bozuk.zip'));
    const AdmZipSarili = win.require('adm-zip');
    assert.throws(() => new AdmZipSarili(bozuk).extractAllTo(path.join(base, 'assets', '57806'), true));
    assert.strictEqual(ctx.dogrulanan['57806'], undefined, 'doğrulanmamalı');

    // KORUMALI yol (üretimde motorun kullandığı): süzgeç REDDEDER.
    win.require('fs').writeFileSync(path.join(base, 'classlibraries', 'ImWin32.dll'), m.encodeMenu('57806', 4));
    assert.strictEqual(m.workMenuSurumu(work, base, '57806'), 3, 'korumalı fs ile sahte ilerleme ENGELLENMELİ');

    // ÇIPLAK fs (süzgeç YOKMUŞ gibi) — bu, süzgecin GERÇEKTEN bir şey yaptığını kanıtlar:
    // aynı bozuk içerikle süzgeçsiz yazım sürümü GERÇEKTEN ilerletir.
    fs.mkdirSync(path.join(work, 'classlibraries'), { recursive: true });
    fs.writeFileSync(path.join(work, 'classlibraries', 'ImWin32.dll'), m.encodeMenu('57806', 5));
    assert.strictEqual(m.workMenuSurumu(work, base, '57806'), 5, 'çıplak fs süzülmez — bu satır süzgecin gerçekten iş yaptığını kanıtlar');
  } finally { fs.rmSync(calisma, { recursive: true, force: true }); }
});

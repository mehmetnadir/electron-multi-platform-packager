'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { butunlukKarari, kosuSuruyor, ALARMLI } = require('./butunluk-karar.js');

const SAAT = 3600000;
const T = (s) => new Date(s).toISOString();

function satirKur(ek = {}) {
  return {
    platform: 'windows',
    status: 'completed',
    progress: 100,
    currentPhase: null,
    lastResult: 'uploaded',
    lastRunAt: T('2026-09-19T13:59:17Z'),
    r2ObjectKey: 'softwares/59834/x.exe',
    ...ek,
  };
}
function headKur(ek = {}) {
  return {
    status: 200,
    contentLength: 1032321168,
    etag: '"7cfc3e433428189d9d5741984629d949-99"',
    lastModified: Date.parse('2026-09-19T13:59:20Z'),
    ...ek,
  };
}

test('SAHA VAKASI 59834: defter "yükledim" derken nesne 3 saat eski -> bayat', () => {
  // Gercek olculen degerler: lastRunAt 13:59:17Z, nesne last-modified 10:56:53Z.
  const k = butunlukKarari({
    satir: satirKur({ progress: 100, currentPhase: null }),
    head: headKur({ lastModified: Date.parse('2026-09-19T10:56:53Z') }),
  });
  assert.strictEqual(k.durum, 'bayat');
  assert.match(k.sebep, /18[0-9] dk eski/);
});

test('koşu sürerken eski nesne ALARM DEĞİL (uretimde)', () => {
  // 59834'un o andaki gercek hali: completed etiketli ama faz=downloading, %84.
  const k = butunlukKarari({
    satir: satirKur({ progress: 84, currentPhase: 'downloading' }),
    head: headKur({ lastModified: Date.parse('2026-09-19T10:56:53Z') }),
  });
  assert.strictEqual(k.durum, 'uretimde');
  assert.strictEqual(ALARMLI.has(k.durum), false);
});

test('nesne koşudan yeni -> tamam', () => {
  assert.strictEqual(butunlukKarari({ satir: satirKur(), head: headKur() }).durum, 'tamam');
});

test('tolerans: nesne koşudan 10 dk eski ise alarm verilmez', () => {
  const k = butunlukKarari({
    satir: satirKur(),
    head: headKur({ lastModified: Date.parse('2026-09-19T13:49:17Z') }),
  });
  assert.strictEqual(k.durum, 'tamam');
});

test('tolerans sınırı aşılınca bayat', () => {
  const k = butunlukKarari({
    satir: satirKur(),
    head: headKur({ lastModified: Date.parse('2026-09-19T13:39:17Z') }),
  });
  assert.strictEqual(k.durum, 'bayat');
});

test('404 -> eksik', () => {
  assert.strictEqual(butunlukKarari({ satir: satirKur(), head: headKur({ status: 404 }) }).durum, 'eksik');
});

test('403 -> erisilemedi, "eksik" DEĞİL (paket duruyor olabilir)', () => {
  const k = butunlukKarari({ satir: satirKur(), head: headKur({ status: 403 }) });
  assert.strictEqual(k.durum, 'erisilemedi');
  assert.strictEqual(ALARMLI.has(k.durum), true);
});

test('SAHA VAKASI cdn.yayincilik.net: bot koruması -> engellendi, "eksik" DEĞİL', () => {
  // 2026-09-20 olculdu: alan adi dosya yerine Cloudflare "Just a moment..." veriyor.
  // "eksik" etiketi insani OLMAYAN paketi aramaya yollar — ayri etiket sart.
  const k = butunlukKarari({ satir: satirKur(), head: headKur({ status: 403, engel: true }) });
  assert.strictEqual(k.durum, 'engellendi');
  assert.strictEqual(ALARMLI.has(k.durum), true);
});

test('bot koruması 404 ile geldiğinde bile engellendi (eksik DEĞİL)', () => {
  // Olculen: ayni challenge Node fetch'e 404, curl'e 403 donuyor. Durum koduna
  // bakip "paket yok" demek yanlis; engel isareti HER ZAMAN once gelir.
  const k = butunlukKarari({ satir: satirKur(), head: headKur({ status: 404, engel: true }) });
  assert.strictEqual(k.durum, 'engellendi');
});

test('bot koruması 503 ile de gelse engellendi der', () => {
  assert.strictEqual(
    butunlukKarari({ satir: satirKur(), head: headKur({ status: 503, engel: true }) }).durum,
    'engellendi');
});

test('engel işareti yoksa 503 yalnızca olculemedi', () => {
  assert.strictEqual(butunlukKarari({ satir: satirKur(), head: headKur({ status: 503 }) }).durum, 'olculemedi');
});

test('0 bayt -> bos', () => {
  assert.strictEqual(butunlukKarari({ satir: satirKur(), head: headKur({ contentLength: 0 }) }).durum, 'bos');
});

test('aynı koşuda etag değişmiş -> degisti (sessiz değişim)', () => {
  const k = butunlukKarari({
    satir: satirKur(),
    head: headKur({ etag: '"bambaska-99"' }),
    onceki: { etag: '"7cfc3e433428189d9d5741984629d949-99"', lastRunAt: T('2026-09-19T13:59:17Z') },
  });
  assert.strictEqual(k.durum, 'degisti');
});

test('yeni koşu olduğunda etag değişimi NORMAL -> degisti demez', () => {
  const k = butunlukKarari({
    satir: satirKur({ lastRunAt: T('2026-09-19T15:00:00Z') }),
    head: headKur({ etag: '"yeni-99"', lastModified: Date.parse('2026-09-19T15:00:10Z') }),
    onceki: { etag: '"eski-99"', lastRunAt: T('2026-09-19T13:59:17Z') },
  });
  assert.strictEqual(k.durum, 'tamam');
});

test('HEAD yapılamadıysa alarm değil, ölçülemedi', () => {
  const k = butunlukKarari({ satir: satirKur(), head: null });
  assert.strictEqual(k.durum, 'olculemedi');
  assert.strictEqual(ALARMLI.has(k.durum), false);
});

test('5xx -> olculemedi (CDN hıçkırığı alarm üretmez)', () => {
  assert.strictEqual(butunlukKarari({ satir: satirKur(), head: headKur({ status: 502 }) }).durum, 'olculemedi');
});

test('completed olmayan satır atlanır', () => {
  assert.strictEqual(butunlukKarari({ satir: satirKur({ status: 'failed' }), head: headKur() }).durum, 'atlandi');
  assert.strictEqual(butunlukKarari({ satir: satirKur({ status: 'queued' }), head: headKur() }).durum, 'atlandi');
});

test('r2 anahtarı olmayan satır atlanır (HEAD hiç yapılmaz)', () => {
  assert.strictEqual(butunlukKarari({ satir: satirKur({ r2ObjectKey: null }), head: null }).durum, 'atlandi');
});

test('alarm kümesi: sessiz kalması gerekenler dışarıda', () => {
  assert.deepStrictEqual([...ALARMLI].sort(),
    ['bayat', 'bos', 'degisti', 'eksik', 'engellendi', 'erisilemedi']);
  for (const d of ['tamam', 'uretimde', 'olculemedi', 'atlandi']) assert.strictEqual(ALARMLI.has(d), false);
});

test('kosuSuruyor: ara faz + %100 ise koşu bitmiş sayılır', () => {
  assert.strictEqual(kosuSuruyor({ status: 'completed', progress: 100, currentPhase: 'uploading' }), false);
  assert.strictEqual(kosuSuruyor({ status: 'completed', progress: 99, currentPhase: 'uploading' }), true);
  assert.strictEqual(kosuSuruyor({ status: 'running' }), true);
});

test('lastRunAt okunamazsa bayat suçlaması yapılmaz', () => {
  const k = butunlukKarari({ satir: satirKur({ lastRunAt: null }), head: headKur() });
  assert.strictEqual(k.durum, 'tamam');
});

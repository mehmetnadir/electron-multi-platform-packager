'use strict';
/**
 * Girdi keşfi + canlıya bağlanan ölçümler (fd62a4d) — AĞSIZ. Her kaldırılan bayat gerekçe için
 * davranış testi: adım artık ölçer ya da gerekçesi ölçülmüş gerçek engeldir.
 *   bayat 1  "g-electron / g-yayin dalları agent-mode'a birleşmedi"      → g-dogrula (uzakDogrula)
 *   bayat 2  "probook-kabul.sh yalnız kurulum+pencere+piksel (:363-367)" → kabul-kapisi E6/E7 kanıtı
 *   bayat 3  "mac K kapısı KAPALI"                                      → k-icerik/kapi canlı ortamdan
 *   bayat 4  "başsız kabulde K senaryosu yok"                           → k-icerik/uygula gerçek araç
 *   bayat 5  "srv21 işçi düzeltmesi 96860dd deploy"                     → runner-is-kaydi build_method
 *   bayat 6  "ProBook şeridi (420f21e) runner'a bağlı değil"            → uretim-yeri build_agents
 *   bayat 7  "74390 pipeline satırı YOK" (elle yazılmış)               → kesif.js ölçer
 *   bayat 8  "paketleme raporundan okuma bağlanmadı" / "salt-okuma kuyruk sorgusu bağlanmadı" /
 *            "t5-tetik + t5-yeniden-kuyruk bağlanınca"                  → ortak-temizlik, t5-*
 *   bayat 9  "girdi yok: … verilmedi (--paket / --url)" (keşif varken) → keşfin CDN URL'leri
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const S = require('./sentetik');

const D = S.geciciDizin('kesif-baglama');
process.env.EMPP_E2E_DIZIN = path.join(D, 'rapor');
process.env.EMPP_E2E_CALISMA = path.join(D, 'calisma');
process.env.EMPP_E2E_AGIR = '0';
const KO = S.kesifOrtami(path.join(D, 'kesif'));
Object.assign(process.env, KO.env);

const K = require('./adimlar/kesif');
const KK = require('./adimlar/kabul-kaniti');
const U = require('./uctan-uca');
const PD = require('./adimlar/paket-denetle');
const ig = require('../../src/runtime/icerik-guncelleme');

const adim = (ad) => require(`./adimlar/${ad}`);
const BASLIK =
  'platform\tstatus\tr2_object_key\tlast_run_at\tlast_queued_at\tbuild_method\tajan\tfile_size_bytes\tintegrity_status';
const tsv = (satirlar) => `${[BASLIK, ...satirlar.map((s) => s.join('\t'))].join('\n')}\n`;
const BAYAT = [
  /agent-mode'a birleşmedi/,
  /yalnız kurulum\+pencere\+piksel/,
  /mac K kapısı KAPALI/,
  /başsız kabulde K senaryosu yok/,
  /96860dd/,
  /runner'a bağlı değil/,
  /26\.09: pipeline satırı YOK/,
  /okuma bağlanmadı|kuyruk sorgusu bağlanmadı|bağlanınca/,
];

function kesifSahte(satirlar, probook = []) {
  return (sql) => {
    if (/FROM build_agents WHERE/.test(sql)) {
      return probook.length
        ? {
            status: 0,
            stdout: `name\thostname\tstatus\tlast_seen_at\trevoked\n${probook.join('\n')}\n`,
            stderr: '',
          }
        : { status: 1, stdout: '', stderr: '' };
    }
    return satirlar.length
      ? { status: 0, stdout: tsv(satirlar), stderr: '' }
      : { status: 1, stdout: '', stderr: '' };
  };
}

const kesifYok = () => K.kesfet({ kitap: '74390', calistir: kesifSahte([]) });

async function sessiz(fn) {
  const eski = console.log;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.log = eski;
  }
}

/* ------------------------------------------------------------------- keşif */

test('pipeline-sql davranışı: satır → TSV, 0 satır rc1+boş, SQL hatası stdout ERROR, ssh düşmesi', () => {
  const ok = K.pipelineSorgu('SELECT 1', {
    calistir: () => ({ status: 0, stdout: 'a\tb\nx\tNULL\n', stderr: '' }),
  });
  assert.deepEqual(ok, { durum: 'tamam', satirlar: [{ a: 'x', b: null }] });
  assert.deepEqual(
    K.pipelineSorgu('SELECT 1', { calistir: () => ({ status: 1, stdout: '', stderr: '' }) }),
    { durum: 'tamam', satirlar: [] },
  );
  const hata = K.pipelineSorgu('SELECT 1', {
    calistir: () => ({
      status: 0,
      stdout: '----\nERROR 1146 (42S02) at line 1: yok\n',
      stderr: '',
    }),
  });
  assert.equal(hata.durum, 'hata');
  assert.match(hata.sebep, /ERROR 1146/);
  const ssh = K.pipelineSorgu('SELECT 1', {
    calistir: () => ({
      status: 255,
      stdout: '',
      stderr: 'ssh: connect to host x port 2222: Operation timed out',
    }),
  });
  assert.equal(ssh.durum, 'hata');
  assert.match(ssh.sebep, /rc=255.*timed out/);
  assert.equal(
    K.pipelineSorgu('SELECT "x"', { calistir: () => assert.fail('koşmamalı') }).durum,
    'hata',
  );
  assert.ok(K.sqlGuvenliMi(K.platformSql('74390')) && K.sqlGuvenliMi(K.PROBOOK_SQL));
  assert.throws(() => K.platformSql("1' OR '1"), /sayı/);
});

test('keşif: 4 paket platformu CDN URL olur (web-stream/NULL anahtar hariç), kodlama probook-teslim ile aynı', () => {
  const r = K.kesfet({
    kitap: '74390',
    calistir: kesifSahte(
      [
        [
          'windows',
          'completed',
          'softwares/74390/Kitap (YDS) - A.exe',
          '2026-09-26 03:26:49',
          '2026-09-26 03:25:00',
          'build',
          'NULL',
          'NULL',
          'healthy',
        ],
        [
          'pardus',
          'queued',
          'NULL',
          'NULL',
          '2026-09-26 03:25:00',
          'build',
          'NULL',
          'NULL',
          'unknown',
        ],
        ['web-stream', 'completed', 'x/y', 'NULL', 'NULL', 'NULL', 'NULL', 'NULL', 'unknown'],
        [
          'mac',
          'completed',
          "softwares/74390/Kitap's!.dmg",
          'NULL',
          'NULL',
          'build',
          'Nadir-MacBook-Pro.local',
          'NULL',
          'unknown',
        ],
      ],
      ['probook-serit\tetap\tonline\t2026-09-26 20:00:00\t0'],
    ),
  });
  assert.equal(r.durum, 'tamam');
  assert.deepEqual(
    r.urller.map((u) => [u.platform, u.url]),
    [
      ['windows', 'https://cdn.ydspublishing.com/softwares/74390/Kitap%20%28YDS%29%20-%20A.exe'],
      ['mac', 'https://cdn.ydspublishing.com/softwares/74390/Kitap%27s%21.dmg'],
    ],
  );
  assert.equal(r.probook.durum, 'kayitli');
  assert.match(
    K.girdiYokSebebi(r, ['pardus'], 'T2 için Pardus'),
    /pardus r2_object_key yok \(status=queued\)/,
  );
  assert.equal(K.satirYokSebebi(r, 'android'), 'pipeline satırı yok: 74390 android');
});

test('bayat 7: 74390 satırı elle yazılmaz — keşif ölçer; satır yok / erişilemez ayrı gerekçe', () => {
  const yok = kesifYok();
  assert.equal(yok.durum, 'satir-yok');
  assert.match(yok.sebep, /^pipeline satırı yok: 74390/);
  assert.equal(yok.probook.durum, 'kayitsiz');
  assert.match(yok.probook.sebep, /kayıt sırrı bekliyor/);
  const erisim = K.kesfet({
    kitap: '74390',
    calistir: () => ({ status: 255, stdout: '', stderr: 'ssh: Could not resolve hostname' }),
  });
  assert.equal(erisim.durum, 'olculemedi');
  assert.match(erisim.sebep, /^pipeline okunamadı: rc=255/);
  // varsayılan yol: EMPP_E2E_PIPELINE_SQL sahtesi (ağ yok) → 0 satır
  const v = K.kesfet({ kitap: '74390' });
  assert.equal(v.durum, 'satir-yok');
  assert.match(fs.readFileSync(KO.kayit, 'utf8'), /book_id = '74390'/);
});

test('canlı kapılar: yalnız beyaz listedeki bayraklar okunur (sır satırı ayrıştırılmaz), son atama geçerli', () => {
  const f = path.join(D, 'run-agent-ornek.sh');
  fs.writeFileSync(
    f,
    [
      'export AGENT_CAPS="mac,android,pardus"',
      'export BOOKUPDATE_TOKEN=gizli-deger',
      'export EMPP_ICERIK_GUNCELLEME=windows,macos   # yorum',
      'export AGENT_CAPS="mac,android,pardus,windows"',
      'export EMPP_RUNNER_WINDOWS=1',
    ].join('\n'),
  );
  const k = K.canliKapilar({ EMPP_E2E_RUN_AGENT: f });
  assert.deepEqual(k.degerler, {
    AGENT_CAPS: 'mac,android,pardus,windows',
    EMPP_ICERIK_GUNCELLEME: 'windows,macos',
    EMPP_RUNNER_WINDOWS: '1',
  });
  assert.ok(!JSON.stringify(k).includes('gizli-deger'));
  assert.match(K.canliKapilar({ EMPP_E2E_RUN_AGENT: path.join(D, 'yok.sh') }).hata, /ENOENT/);
});

/* --------------------------------------------------------------- T1 runner */

test('bayat 5: runner-is-kaydi build_method ölçer — satır yok ÖLÇÜLEMEDİ, passthrough KALDI, kanıtla GEÇTİ', async () => {
  const m = adim('runner-is-kaydi');
  const kapilar = { dosya: 'x', degerler: { EMPP_RUNNER_WINDOWS: '1', AGENT_CAPS: 'mac,windows' } };
  const [yok] = await m.kos({ test: 'T1', kitap: '74390', kesif: kesifYok(), kapilar });
  assert.equal(yok.durum, 'OLCULEMEDI');
  assert.match(yok.kanit.olcum.sebep, /^pipeline satırı yok: 74390/);
  assert.match(yok.kanit.olcum.not, /Windows şeridi AÇIK/);
  const kesif = (bm) =>
    K.kesfet({
      kitap: '74390',
      calistir: kesifSahte([
        [
          'windows',
          'completed',
          'softwares/74390/a.exe',
          'NULL',
          'NULL',
          bm,
          'NULL',
          'NULL',
          'healthy',
        ],
      ]),
    });
  const [pt] = await m.kos({ test: 'T1', kitap: '74390', kesif: kesif('NULL'), kapilar });
  assert.equal(pt.durum, 'KALDI');
  assert.match(pt.kanit.olcum.sebep, /build_method=NULL.*passthrough/);
  const [sari] = await m.kos({
    test: 'T1',
    kitap: '74390',
    kesif: kesif('build'),
    kapilar,
    windowsKaniti: { dizin: '/k', kanit: null },
  });
  assert.equal(sari.durum, 'SARI');
  const kanit = {
    durum: 'yayinlandi',
    surum: '2.7.3',
    imzali: { md5: 'a'.repeat(32), imzaci: 'IMPARK' },
  };
  const [gec] = await m.kos({
    test: 'T1',
    kitap: '74390',
    kesif: kesif('build'),
    kapilar,
    windowsKaniti: { dizin: '/k', kanit, yol: '/k/2.7.3.json' },
  });
  assert.equal(gec.durum, 'GECTI');
  assert.equal(gec.kanit.olcum.md5, 'a'.repeat(32));
  assert.equal(gec.kanit.dosya, '/k/2.7.3.json');
});

test('cdn-md5-kiyas: Windows girdisinde üretilen md5 runner iş kanıtından (tam md5 kıyası)', async () => {
  const m = adim('cdn-md5-kiyas');
  const s = {
    girdi: { tur: 'url', deger: 'https://cdn/x.exe', platform: 'windows' },
    ozet: { aile: 'nsis', md5: 'b'.repeat(32) },
  };
  const wk = {
    kanit: { imzali: { md5: 'b'.repeat(32), sha256: 'c'.repeat(64), boyut: 9 } },
    yol: '/k/1.json',
  };
  const [r] = await m.kos({
    test: 'T1',
    paketSonuclari: [s],
    testeUygun: () => true,
    windowsKaniti: wk,
    beklenen: {},
  });
  assert.equal(r.durum, 'GECTI');
  assert.equal(r.kanit.olcum.sinif, 'tam-md5');
  assert.equal(r.kanit.olcum.uretilen_kaynak, '/k/1.json');
  const [yok] = await m.kos({
    test: 'T2',
    paketSonuclari: [],
    testeUygun: () => true,
    kesif: kesifYok(),
    beklenen: {},
  });
  assert.match(yok.kanit.olcum.sebep, /^girdi yok: pipeline satırı yok: 74390/);
});

/* ------------------------------------------------------------ T2 üretim yeri */

test('bayat 6: uretim-yeri build_agents ölçer — satır yok + kayıtsız ProBook iki gerçek engel; satır varken düşme SARI', async () => {
  const m = adim('uretim-yeri');
  const [yok] = await m.kos({
    test: 'T2',
    kitap: '74390',
    kesif: kesifYok(),
    kapilar: { degerler: {} },
  });
  assert.equal(yok.durum, 'OLCULEMEDI');
  assert.match(yok.kanit.olcum.sebep, /pipeline satırı yok: 74390.*kayıt sırrı bekliyor/);
  const satir = [
    [
      'pardus',
      'completed',
      'softwares/74390/a.impark',
      'NULL',
      'NULL',
      'build',
      'NULL',
      'NULL',
      'unknown',
    ],
  ];
  const [dus] = await m.kos({
    test: 'T2',
    kitap: '74390',
    kesif: K.kesfet({ kitap: '74390', calistir: kesifSahte(satir) }),
  });
  assert.equal(dus.durum, 'SARI');
  assert.match(dus.kanit.olcum.sebep, /^düşme: .*Mac docker/);
  const kira = [
    ['pardus', 'running', 'NULL', 'NULL', 'NULL', 'build', 'probook-serit', 'NULL', 'unknown'],
  ];
  const [pb] = await m.kos({
    test: 'T2',
    kitap: '74390',
    kesif: K.kesfet({
      kitap: '74390',
      calistir: kesifSahte(kira, ['probook-serit\tetap\tonline\tx\t0']),
    }),
  });
  assert.equal(pb.durum, 'GECTI');
});

/* ------------------------------------------------------------- kabul kanıtı */

// 26.09 canlı ProBook kabul koşusunun (canli-45482-ayri-ev.log) satır biçimi, agent.log önekiyle
const KABUL_BLOK = (id, e6, e7, son) =>
  [
    `2026-09-26T10:00:00.000Z [agent] pardus: ProBook kabul kapısı başlıyor — /x/probook-kabul.sh`,
    `2026-09-26T10:00:01.000Z [agent]   [kabul] [kabul] E6/E7: CDP ProBook:9337 (baglanti 127.0.0.1:9437) — ilk kitaba giriliyor`,
    `2026-09-26T10:00:02.000Z [agent]   [kabul] [kabul] E6: ${e6}`,
    `2026-09-26T10:00:03.000Z [agent]   [kabul] [kabul] E6 kitap olcumu 1/2: surec=1 sapma=0.19 koyu=0.93 renk=72935`,
    `2026-09-26T10:00:04.000Z [agent]   [kabul] [kabul] E7: ${e7}`,
    ...son.map((x) => `2026-09-26T10:00:05.000Z [agent]   [kabul] [kabul] ${x}`),
    `2026-09-26T10:00:09.000Z [agent] job done: ${id} pardus`,
  ].join('\n');

test('bayat 2: pardus K3/K4 ProBook kabulünün E6/E7 kanıtından (KABUL_CDP=1) okunur', () => {
  const log = [
    '2026-09-26T09:00:00.000Z [agent] job done: 74390 android',
    KABUL_BLOK('45482', 'GECTI — set: okuyucu açıldı', 'BOS — 45482 v36 güncel', [
      'kabul dayanagi: E6 set',
      'KABUL: Shall We 8',
    ]),
    KABUL_BLOK(
      '74390',
      'GECTI — okuyucu açıldı (sayfa izi 4, 6 sn)',
      'DOLU — 74390 v14 < İmpark v15 (Data=https://x/74390-15.zip)',
      ['GUNCEL-DEGIL: E7 74390 v14 < İmpark v15'],
    ),
  ].join('\n');
  const blok = KK.pardusBlogu(log, '74390');
  assert.ok(blok.kabulKostu);
  assert.equal(blok.zaman, '2026-09-26T10:00:09.000Z');
  const o = KK.pardusOzet(blok.satirlar);
  assert.equal(o.e6, 'GECTI');
  assert.equal(o.e7, 'DOLU');
  assert.equal(o.karar, 'GUNCEL-DEGIL');
  assert.equal(KK.k3Pardus(o).durum, 'GECTI');
  const k4 = KK.k4Pardus(o);
  assert.equal(k4.durum, 'KALDI');
  assert.match(k4.sebep, /GÜNCEL DEĞİL: 74390 v14 < İmpark v15/);
  // piksel düşürmesi: E6 satırı GECTI yazsa da karar RED → K3 KALDI
  const red = KK.pardusOzet(
    KABUL_BLOK('1', 'GECTI — açıldı', 'BOS — güncel', [
      'RED: E6 kitap acildi ama ekranda ICERIK YOK',
    ]).split('\n'),
  );
  assert.equal(KK.k3Pardus(red).durum, 'KALDI');
  assert.equal(KK.k4Pardus(red).durum, 'GECTI');
  // E6 satırı yok → CDP kapalı koşmuş (eski kapı): ÖLÇÜLEMEDİ, "GEÇTİ" değil
  const eski = KK.pardusOzet(['[kabul] KABUL: X']);
  assert.equal(KK.k3Pardus(eski).durum, 'OLCULEMEDI');
  assert.match(KK.k3Pardus(eski).sebep, /KABUL_CDP=0/);
  // gerçek HOME (ayrı ev kapalı) → E7 güvenilmez
  const ev = KK.pardusOzet([
    '[kabul] E7: BOS — x',
    '[kabul] OLCULEMEDI: E7 yalniz ayri evde guvenilir: …',
  ]);
  assert.equal(KK.k4Pardus(ev).durum, 'OLCULEMEDI');
});

test('kabul-kapisi: kanıt yoksa gerekçe keşiften (pipeline satırı yok — üretim+kabul koşmadı); mac karar.json K4 KALDI', async () => {
  const m = adim('kabul-kapisi');
  const t3 = await m.kos({ test: 'T3', kitap: '74390', kesif: kesifYok(), paylasim: {} });
  assert.deepEqual(
    t3.map((s) => s.adim),
    [
      'K3/pardus',
      'K4/pardus',
      'K3/mac',
      'K4/mac',
      'K3/android',
      'K4/android',
      'K3/windows',
      'K4/windows',
    ].map((x) => `kabul-kapisi/${x}`),
  );
  for (const s of t3) {
    assert.equal(s.durum, 'OLCULEMEDI');
    assert.match(s.kanit.olcum.sebep, /^pipeline satırı yok: 74390 .*üretim \+ kabul koşmadı$/);
    for (const re of BAYAT) assert.doesNotMatch(JSON.stringify(s), re);
  }
  assert.match(t3.find((s) => s.adim.endsWith('/windows')).kanit.olcum.not, /açık karar 1/);
  // mac başsız kabul kanıtı: içerik + kitap GEÇTİ → K3 GEÇTİ; güncellik katmanı yok → K4 KALDI
  // (ayrı, sabit kök: KO kökü boş kalır — diğer testler ve sonraki koşular etkilenmez)
  const kok = path.join(D, 'kabul-kanit-mac');
  const dz = path.join(kok, '74390-mac-20260926-120000');
  fs.mkdirSync(dz, { recursive: true });
  fs.writeFileSync(
    path.join(dz, 'karar.json'),
    JSON.stringify({
      karar: 'GECTI',
      katmanlar: { icerik: { durum: 'GECTI', sebepler: [], kitap: { baslik: 'YDS', tuval: 1 } } },
    }),
  );
  const eskiKok = process.env.EMPP_KABUL_KANIT_KOK;
  process.env.EMPP_KABUL_KANIT_KOK = kok;
  let t4;
  try {
    t4 = await m.kos({ test: 'T4', kitap: '74390', kesif: kesifYok(), paylasim: {} });
  } finally {
    process.env.EMPP_KABUL_KANIT_KOK = eskiKok;
  }
  const k3 = t4.find((s) => s.adim === 'kabul-kapisi/K3/mac');
  const k4 = t4.find((s) => s.adim === 'kabul-kapisi/K4/mac');
  assert.equal(k3.durum, 'GECTI');
  assert.equal(k3.kanit.dosya, path.join(dz, 'karar.json'));
  assert.equal(k4.durum, 'KALDI');
  assert.match(k4.kanit.olcum.sebep, /güncelliği sormuyor/);
  // pardus: agent.log bloğu okunur
  fs.writeFileSync(
    KO.env.EMPP_E2E_AGENT_LOG,
    KABUL_BLOK('74390', 'GECTI — açıldı', 'BOS — 74390 v15 güncel', ['KABUL: Y']),
  );
  const t2 = await m.kos({ test: 'T2', kitap: '74390', kesif: kesifYok(), paylasim: {} });
  assert.deepEqual(
    t2.map((s) => s.durum),
    ['GECTI', 'GECTI'],
  );
  fs.writeFileSync(KO.env.EMPP_E2E_AGENT_LOG, '');
});

/* ------------------------------------------------------------------ T4 G / K */

test('bayat 1: g-dogrula canlı manifesti uzakDogrula ile ölçer; yayın yoksa gerekçe yazan adım', async () => {
  const m = adim('g-dogrula');
  const kos = (u) =>
    m.kos({ test: 'T4', kitap: '74390', beklenen: {}, gUzakDogrula: async () => u });
  const [g] = await kos({ gecti: true, hatalar: [], surum: '2.7.4', dosya: 2, kitaplar: 1 });
  assert.equal(g.durum, 'GECTI');
  assert.equal(g.kanit.olcum.surum, '2.7.4');
  const [yok] = await kos({
    gecti: false,
    hatalar: ['HTTP 404: https://cdn.ydspublishing.com/guncelleme/set/74390/surum.json'],
  });
  assert.equal(yok.durum, 'OLCULEMEDI');
  assert.match(yok.kanit.olcum.sebep, /G manifesti yok .*yayinla\.js e2e 74390 --onayli/);
  const [imza] = await kos({ gecti: false, hatalar: ['imza doğrulanmadı (anahtar 31b8…)'] });
  assert.equal(imza.durum, 'KALDI');
  const [ag] = await m.kos({ test: 'T4', kitap: '74390', ag: false });
  assert.match(ag.kanit.olcum.sebep, /EMPP_E2E_AG=0/);
  // uzakDogrula gerçek fonksiyonu enjekte getir ile: imzasız 404 zinciri → hatalar[0] 404
  const Y = require('../../tools/g-yayin/yayinla');
  const u = await Y.uzakDogrula({
    taban: 'https://cdn.ydspublishing.com/guncelleme',
    setKimligi: '74390',
    acik: require('../../tools/g-yayin/anahtar').URETIM_ACIK_ANAHTAR,
    getir: async () => ({ durum: 404, govde: Buffer.alloc(0) }),
  });
  assert.match(u.hatalar[0], /^HTTP 404: .*\/set\/74390\/surum\.json$/);
  const plan = U.plan(['T4'])[0].adimlar;
  assert.equal(plan.find((a) => a.adim === 'g-dogrula').durum, 'hazır');
  assert.doesNotMatch(plan.find((a) => a.adim === 'g-uygula').durum, /birleşmedi/);
});

function istekSahte(vs, boyut, lm = 'Sat, 26 Sep 2026 17:19:32 GMT') {
  return async (url, o = {}) => {
    if (/GetKitapGuncellemeBilgi/.test(url)) {
      return {
        status: 200,
        headers: {},
        govde: Buffer.from(
          JSON.stringify({
            Success: true,
            Data: `https://akillitahta.test/Uploads/ZKitapZipH/74390-${vs}.zip`,
            Vs: vs,
          }),
        ),
      };
    }
    assert.equal(o.method, 'HEAD');
    return {
      status: 200,
      headers: { 'content-length': String(boyut), 'last-modified': lm },
      govde: Buffer.alloc(0),
    };
  };
}

test('bayat 3+4: k-icerik canlı K kapısını okur ve İmpark içeriğini GERÇEK istemci aracıyla uygular (+ bozuk zip mutasyonu)', async () => {
  const m = adim('k-icerik');
  const zip = S.zipYaz(path.join(D, 'kaynak-74390-15.zip'), {
    'data/BookContent.xml': '<?xml version="1.0"?><Book kitapId="74390"></Book>',
    'pages/1.png': 'PNG-1',
  });
  const boyut = fs.statSync(zip).size;
  const b = {
    test: 'T4',
    kitap: '74390',
    paylasim: {},
    calisma: path.join(D, 'calisma'),
    kapilar: { dosya: 'run-agent.sh', degerler: { EMPP_ICERIK_GUNCELLEME: 'windows,macos' } },
    istek: istekSahte(15, boyut),
    indir: async (url, hedef) => {
      assert.match(url, /74390-15\.zip$/);
      fs.copyFileSync(zip, hedef);
      return { yol: hedef };
    },
  };
  const r = await m.kos(b);
  const bul = (a) => r.find((s) => s.adim === `k-icerik/${a}`);
  assert.equal(bul('kapi').durum, 'GECTI');
  assert.equal(bul('uygula').durum, 'GECTI', JSON.stringify(bul('uygula').kanit));
  assert.match(bul('uygula').kanit.olcum.ayrinti, /14 → 15 \(beklenen 15\) · açıldı=true/);
  assert.equal(bul('bozuk-zip').durum, 'GECTI', JSON.stringify(bul('bozuk-zip').kanit));
  assert.match(bul('bozuk-zip').kanit.olcum.ayrinti, /reddedildi, menü ilerlemedi \(14 → 14/);
  // kapı macos'a kapalıysa KALDI (eski bayat gerekçe artık ölçülen bir sonuç)
  const [kapali, agsiz] = await m.kos({
    ...b,
    paylasim: {},
    istek: undefined,
    kapilar: { degerler: { EMPP_ICERIK_GUNCELLEME: 'windows' } },
    ag: false,
  });
  assert.match(agsiz.kanit.olcum.sebep, /EMPP_E2E_AG=0/);
  assert.equal(kapali.durum, 'KALDI');
  assert.match(kapali.kanit.olcum.sebep, /macos için KAPALI/);
  // araç yorumu: bağımlılık yoksa KALDI değil ÖLÇÜLEMEDİ; mutasyon kaçarsa KALDI
  assert.equal(
    m.aracYorumla({ rc: 1, stdout: '', stderr: "Error: Cannot find module 'adm-zip'" }).durum,
    'OLCULEMEDI',
  );
  const kacan = m.aracYorumla(
    {
      rc: 1,
      stdout:
        '[k-kabul] sürüm: 14 → 15 (beklenen 14)\n[k-kabul] SONUÇ: RED — SAHTE İLERLEME: x (kanıt: /k)\n',
      stderr: '',
    },
    { bozuk: true },
  );
  assert.equal(kacan.durum, 'KALDI');
  assert.match(kacan.sebep, /mutasyon yakalanmadı: SAHTE İLERLEME/);
});

/* ------------------------------------------------------------------------ T5 */

test('bayat 8a: t5-yeniden-kuyruk — İmpark Last-Modified sonrası ilk 06:20 cron; önce ÖLÇÜLEMEDİ, sonra last_queued_at kıyası', async () => {
  const m = adim('t5-yeniden-kuyruk');
  const L = Date.parse('2026-09-26T17:19:32Z'); // 20:19 +03 → cron ertesi gün 06:20 +03 = 03:20Z
  assert.equal(new Date(m.sonrakiCron(L)).toISOString(), '2026-09-27T03:20:00.000Z');
  assert.equal(
    new Date(m.sonrakiCron(Date.parse('2026-09-26T02:00:00Z'))).toISOString(),
    '2026-09-26T03:20:00.000Z',
  );
  const istek = istekSahte(15, 10);
  const [yok] = await m.kos({ test: 'T5', kitap: '74390', kesif: kesifYok(), istek, paylasim: {} });
  assert.match(yok.kanit.olcum.sebep, /^pipeline satırı yok: 74390/);
  const satirlar = (q) =>
    ['windows', 'mac', 'android', 'pardus'].map((pl) => [
      pl,
      'queued',
      'k',
      'NULL',
      q[pl],
      'build',
      'NULL',
      'NULL',
      'unknown',
    ]);
  const kesif = (q) => K.kesfet({ kitap: '74390', calistir: kesifSahte(satirlar(q)) });
  const hepsi = {
    windows: '2026-09-27 06:20:05',
    mac: '2026-09-27 06:20:05',
    android: '2026-09-27 06:20:06',
    pardus: '2026-09-27 06:20:06',
  };
  const [erken] = await m.kos({
    test: 'T5',
    kitap: '74390',
    kesif: kesif(hepsi),
    istek,
    paylasim: {},
    simdi: Date.parse('2026-09-26T19:00:00Z'),
  });
  assert.equal(erken.durum, 'OLCULEMEDI');
  assert.match(erken.kanit.olcum.sebep, /henüz gelmedi/);
  const sonra = Date.parse('2026-09-27T04:30:00Z');
  const [gec] = await m.kos({
    test: 'T5',
    kitap: '74390',
    kesif: kesif(hepsi),
    istek,
    paylasim: {},
    simdi: sonra,
  });
  assert.equal(gec.durum, 'GECTI');
  const [kal] = await m.kos({
    test: 'T5',
    kitap: '74390',
    kesif: kesif({ ...hepsi, pardus: '2026-09-25 06:20:00' }),
    istek,
    paylasim: {},
    simdi: sonra,
  });
  assert.equal(kal.durum, 'KALDI');
  assert.match(kal.kanit.olcum.sebep, /pardus \(last_queued_at 2026-09-25 06:20:00\)/);
});

test('bayat 8b: t5-sabah-damga paket içi menü sürümünü İmpark Vs ile kıyaslar; menuKapaklari gerçek kodlamayı çözer', async () => {
  const m = adim('t5-sabah-damga');
  const kod = ig.menuKodla(
    '<?xml version="1.0"?><main><Group ID="0"><Tab ID="0"><cover ID="74390" version="15" URL="/u"/></Tab></Group></main>',
  );
  const kap = PD.menuKapaklari(
    new Map([['classlibraries/ImWin32.dll', Buffer.from(kod, 'latin1')]]),
    '',
  );
  assert.deepEqual(kap, [{ ID: '74390', version: 15 }]);
  const paket = (kapaklar) => ({
    girdi: { tur: 'url', deger: 'https://cdn/x.apk', platform: 'android' },
    ozet: { aile: 'apk' },
    satirlar: [
      {
        adim: 'paket-denetle/icerik-ac',
        durum: 'GECTI',
        kanit: { olcum: { menu_kapaklar: kapaklar } },
      },
    ],
  });
  const kos = (p) =>
    m.kos({
      test: 'T5',
      kitap: '74390',
      paketSonuclari: p,
      istek: istekSahte(15, 10),
      paylasim: {},
      kesif: kesifYok(),
    });
  assert.equal((await kos([paket([{ ID: '74390', version: 15 }])]))[0].durum, 'GECTI');
  const [eski] = await kos([paket([{ ID: '74390', version: 14 }])]);
  assert.equal(eski.durum, 'KALDI');
  assert.equal(eski.adim, 't5-sabah-damga/android');
  assert.equal((await kos([paket(undefined)]))[0].durum, 'OLCULEMEDI');
  const [yok] = await kos([]);
  assert.match(yok.kanit.olcum.sebep, /^girdi yok: pipeline satırı yok: 74390/);
});

test('bayat 8c: ortak-temizlik paket listesini TEK KAYNAK paket-disi-liste ile ölçer', async () => {
  const tz = PD.temizlikOlc(
    [
      'index.html',
      'temp/x',
      'book1/temp/data/storage.im',
      'node_modules/a/i.js',
      'book1/aaaaaaaaaaaaaaaaaaaa.main.js',
      'book1/bbbbbbbbbbbbbbbbbbbb.main.js',
      'book2/cccccccccccccccccccc.main.js',
      'book3/temp/pages/1.png',
    ],
    'apk',
  );
  assert.equal(tz.platform, 'android');
  assert.deepEqual(tz.paket_disi.maddeler, { temp: 1, 'storage.im': 1, node_modules: 1 });
  assert.deepEqual(tz.olu_motor, { 'book1/': 2, 'book2/': 1 });
  const m = adim('ortak-temizlik');
  const s = (temizlik) => ({
    girdi: { tur: 'url', deger: 'https://cdn/x.apk' },
    ozet: { aile: 'apk' },
    satirlar: [{ adim: 'paket-denetle/icerik-ac', durum: 'GECTI', kanit: { olcum: { temizlik } } }],
  });
  const kirli = await m.kos({ test: 'T4', paketSonuclari: [s(tz)] });
  assert.deepEqual(
    kirli.map((r) => [r.adim, r.durum]),
    [
      ['ortak-temizlik/paket-disi', 'KALDI'],
      ['ortak-temizlik/olu-motor', 'KALDI'],
    ],
  );
  const temiz = await m.kos({
    test: 'T4',
    paketSonuclari: [
      s(PD.temizlikOlc(['index.html', 'book1/aaaaaaaaaaaaaaaaaaaa.main.js'], 'dmg')),
    ],
  });
  assert.deepEqual(
    temiz.map((r) => r.durum),
    ['GECTI', 'GECTI'],
  );
  const [yok] = await m.kos({ test: 'T4', paketSonuclari: [], kesif: kesifYok() });
  assert.match(yok.kanit.olcum.sebep, /^girdi yok: pipeline satırı yok: 74390/);
});

/* ------------------------------------------------------ koşucu uçtan uca */

test('bayat 9: argüman yoksa girdiler keşiften (CDN URL) — kuru + --indir birlikte, salt-okuma adımlar koşar', async () => {
  const agac = {
    ...S.androidAgaci({}),
    'classlibraries/ImWin32.dll': Buffer.from(
      ig.menuKodla('<?xml version="1.0"?><main><cover ID="74390" version="15" URL="/u"/></main>'),
      'latin1',
    ),
  };
  const apk = S.apkYap(path.join(D, 'kesif.apk'), agac);
  const veri = fs.readFileSync(apk);
  // CDN gibi: HEAD + Range (206) + tam GET
  const srv = http.createServer((req, res) => {
    const m = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range || '');
    if (m && req.method === 'GET') {
      const p = veri.subarray(Number(m[1]), Math.min(Number(m[2]), veri.length - 1) + 1);
      res.writeHead(206, {
        'Content-Length': p.length,
        'Content-Range': `bytes ${m[1]}-${Number(m[1]) + p.length - 1}/${veri.length}`,
        'Accept-Ranges': 'bytes',
      });
      res.end(p);
      return;
    }
    res.writeHead(200, { 'Content-Length': veri.length, 'Accept-Ranges': 'bytes' });
    res.end(req.method === 'HEAD' ? undefined : veri);
  });
  await new Promise((c) => srv.listen(0, '127.0.0.1', c));
  const url = `http://127.0.0.1:${srv.address().port}/softwares/74390/a.apk`;
  const kesif = {
    durum: 'tamam',
    sebep: null,
    kitap: '74390',
    satirlar: [
      { platform: 'android', status: 'completed', r2_object_key: 'softwares/74390/a.apk' },
    ],
    urller: [{ platform: 'android', url }],
    probook: { durum: 'kayitsiz', sebep: 'ProBook ajanı yok — kayıt sırrı bekliyor' },
  };
  assert.deepEqual(U.girdileriKur({ paketler: [], urller: [] }, kesif), [
    { tur: 'url', deger: url, platform: 'android', kaynak: 'kesif' },
  ]);
  assert.deepEqual(
    U.girdileriKur({ paketler: [], urller: ['https://x/y.exe'] }, kesif).map((g) => g.kaynak),
    ['arguman'],
  );
  let r;
  try {
    r = await sessiz(() =>
      U.kos({
        test: 'T4,T5',
        kitap: '74390',
        kuru: true,
        indir: true,
        paketler: [],
        urller: [],
        beklenen: {},
        kesif,
        istek: istekSahte(15, 10),
        indirFn: async () => {
          throw new Error('ağ yok (test)');
        },
      }),
    );
  } finally {
    srv.close();
  }
  assert.equal(r.girdi_kaynagi, 'kesif');
  assert.equal(r.kesif.durum, 'tamam');
  assert.equal(r.girdiler[0].platform, 'android');
  assert.ok(r.girdiler[0].indirilen > 0 || r.girdiler[0].boyut > 0);
  const bul = (a) => r.sonuclar.find((s) => s.adim === a);
  assert.equal(bul('paket-denetle/aile').durum, 'GECTI');
  assert.equal(bul('ortak-temizlik/paket-disi').durum, 'GECTI');
  assert.equal(
    bul('t5-sabah-damga/android').durum,
    'GECTI',
    JSON.stringify(bul('t5-sabah-damga/android').kanit),
  );
  // kuru: yalnız yazan adımlar atlanır; ilk gerekçe kuru koşu
  for (const ad of ['g-uygula', 't5-tetik']) {
    const s = bul(ad);
    assert.equal(s.durum, 'OLCULEMEDI');
    assert.match(U.kanitKisa(s), /^kuru koşu \(E2E_KURU=1\) — yazma\/tetik ATILMADI/);
  }
  const md = fs.readFileSync(r.dosyalar.md, 'utf8');
  assert.match(
    md,
    /Keşif: tamam · android=completed · ProBook ajanı kayitsiz · girdi kaynağı kesif/,
  );
});

test('kuru koşu (keşif 0 satır): hiçbir ÖLÇÜLEMEDİ satırı bayat gerekçe taşımaz; her biri ölçülmüş engel ya da kuru', async () => {
  const r = await sessiz(() =>
    U.kos({
      test: 'T1,T2,T3,T4,T5',
      kitap: '74390',
      kuru: true,
      paketler: [],
      urller: [],
      beklenen: {},
    }),
  );
  assert.equal(r.kesif.durum, 'satir-yok');
  for (const s of r.sonuclar) {
    const metin = JSON.stringify(s.kanit);
    for (const re of BAYAT) assert.doesNotMatch(metin, re, `${s.test} ${s.adim}: ${metin}`);
    if (s.durum !== 'OLCULEMEDI') continue;
    const k = U.kanitKisa(s);
    assert.match(
      k,
      /pipeline satırı yok: 74390|kuru koşu \(E2E_KURU=1\)|EMPP_E2E_AG=0/,
      `${s.test} ${s.adim}: ${k}`,
    );
  }
  // K kapısı ağ gerektirmez: sahte run-agent'ta windows,macos → GEÇTİ
  assert.equal(r.sonuclar.find((s) => s.adim === 'k-icerik/kapi').durum, 'GECTI');
});

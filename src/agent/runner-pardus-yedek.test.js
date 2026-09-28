'use strict';

/**
 * SÜRELİ KONTEYNER YEDEK KABUL (2026-09-27, Nadir: "ProBook elektrik kesintisiyle kapandı,
 * yarına kadar bu Mac'teki docker üzerinden fallback'i devreye al"). ProBook'un YERİNE
 * GEÇMEZ — yalnız süreli bayrak (`~/.empp-agent/pardus-konteyner-kabul.istek`) AKTİFKEN ve
 * ProBook'a erişilemediğinde kabul bu Mac'teki Docker konteyner kapısından
 * (tools/pardus/konteyner-kabul.sh → konteyner-kapi.sh, imaj pardus-kapi:3) yapılır.
 *
 * Üç katman: (1) saf fonksiyon `pardusYedekKabulDurumu`, (2) `pardusKabulErisimUygula`
 * yedekAktif dalı, (3) runner entegrasyonu — GERÇEK spawn ile sahte ProBook/konteyner
 * betikleri (repo stiliyle tutarlı, mock kütüphanesi yok).
 */

const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

// TEST YALITIMI (2026-09-28, agent-test-borcu-20260928 — ortak yardımcı, bkz. test-yalitim.js).
// Bu dosyanın kendi `bayrakla()`/`betiklerle()` yardımcıları pardusYedekKabulFlag/Kayit ve
// EMPP_KABUL_KANIT_KOK'u ZATEN test-başı izole ediyordu; global YALITIM bunu bir üst katmanda
// güvenceye alır (varsayılan artık gerçek yol değil, temp — bayrakla/betiklerle hâlâ kendi
// per-test temp'ine geçip DOĞRU geri dönüyor). Asıl kapattığı boşluk: `guncelYetenekler()`
// çağıran testlerin macSerbestFlag/macDurdurFlag için hiç izolasyonu YOKTU.
const { izoleOrtam } = require('./test-yalitim');
const YALITIM = izoleOrtam();

const runner = require('./runner.js');
const {
  CONFIG, pardusKabulKapisi, _probookErisimAyarla, _yedekLogSifirla,
} = runner;
const {
  pardusYedekKabulDurumu, pardusKabulErisimUygula, ertelenebilirKaynakHatasi, PROBOOK_KAPISI_ISARETI,
} = require('./runner-helpers');

YALITIM.configUygula(CONFIG);
after(() => YALITIM.temizle());

const SRC = fs.readFileSync(path.join(__dirname, 'runner.js'), 'utf8');

// ---------------------------------------------------------------------------
// (1) pardusYedekKabulDurumu — saf fonksiyon
// ---------------------------------------------------------------------------

test('pardusYedekKabulDurumu: gelecek tarih → aktif, bitis aynen döner', () => {
  const gelecek = new Date(Date.now() + 3600000).toISOString();
  assert.deepEqual(pardusYedekKabulDurumu(gelecek, Date.now()), { aktif: true, bitis: gelecek });
});

test('pardusYedekKabulDurumu: geçmiş tarih → pasif, sebep suresi-doldu (bitis korunur)', () => {
  const gecmis = new Date(Date.now() - 3600000).toISOString();
  assert.deepEqual(pardusYedekKabulDurumu(gecmis, Date.now()), { aktif: false, bitis: gecmis, sebep: 'suresi-doldu' });
});

test('pardusYedekKabulDurumu: boş/null/undefined içerik → pasif, gecersiz (dosya yoksa çağıran böyle geçer)', () => {
  for (const girdi of ['', null, undefined]) {
    assert.deepEqual(pardusYedekKabulDurumu(girdi, Date.now()), { aktif: false, sebep: 'gecersiz' }, String(girdi));
  }
});

test('pardusYedekKabulDurumu: çöp metin (tarih değil) → pasif, gecersiz', () => {
  assert.deepEqual(pardusYedekKabulDurumu('bu bir tarih degil ki', Date.now()), { aktif: false, sebep: 'gecersiz' });
});

test('pardusYedekKabulDurumu: yalnız boşluk/satır sonu → pasif, gecersiz', () => {
  assert.deepEqual(pardusYedekKabulDurumu('   \n\n  \r\n \t \n', Date.now()), { aktif: false, sebep: 'gecersiz' });
});

test('pardusYedekKabulDurumu: baştaki boş satırlar atlanır, ilk dolu satır tarih + kırpılır', () => {
  const gelecek = new Date(Date.now() + 3600000).toISOString();
  const r = pardusYedekKabulDurumu(`\n\n  ${gelecek}  \nbaşka bir açıklama satırı\n`, Date.now());
  assert.equal(r.aktif, true);
  assert.equal(r.bitis, gelecek);
});

test('pardusYedekKabulDurumu: tam sınırda (bitiş == şimdi) aktif SAYILMAZ', () => {
  const simdi = Date.now();
  const damga = new Date(simdi).toISOString();
  const r = pardusYedekKabulDurumu(damga, Date.parse(damga));
  assert.equal(r.aktif, false, 'eşitlik gelecek sayılmaz — kesin gelecek şart');
});

// ---------------------------------------------------------------------------
// (2) pardusKabulErisimUygula: yedekAktif dalı
// ---------------------------------------------------------------------------

test('pardusKabulErisimUygula: yedekAktif=true → erişilemezlik pardus\'u DÜŞÜRMEZ', () => {
  const caps = ['android', 'pardus'];
  const r = pardusKabulErisimUygula(caps, {
    kabulAcik: true, kapiAcik: true, host: 'etapadmin@x', erisilir: false, yedekAktif: true,
  });
  assert.deepEqual(r, ['android', 'pardus']);
});

test('pardusKabulErisimUygula: yedekAktif=false → eski davranış (erişilemezse pardus düşer)', () => {
  const caps = ['android', 'pardus'];
  const r = pardusKabulErisimUygula(caps, {
    kabulAcik: true, kapiAcik: true, host: 'etapadmin@x', erisilir: false, yedekAktif: false,
  });
  assert.deepEqual(r, ['android']);
});

test('pardusKabulErisimUygula: yedekAktif verilmezse (undefined) eski davranış korunur', () => {
  const caps = ['pardus'];
  const r = pardusKabulErisimUygula(caps, { kabulAcik: true, kapiAcik: true, host: 'x', erisilir: false });
  assert.deepEqual(r, []);
});

// ---------------------------------------------------------------------------
// (3) Runner entegrasyonu — GERÇEK spawn, sahte ProBook/konteyner betikleri
// ---------------------------------------------------------------------------

/** Bayrak dosyasını geçici bir dizine yazar (içerik=null → dosya hiç oluşturulmaz), CONFIG'i ona yönlendirir. */
async function bayrakla(icerik, fn) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'yedek-bayrak-'));
  const dosya = path.join(dir, 'pardus-konteyner-kabul.istek');
  if (icerik !== null) await fsp.writeFile(dosya, icerik);
  const prev = CONFIG.pardusYedekKabulFlag;
  CONFIG.pardusYedekKabulFlag = dosya;
  _yedekLogSifirla();
  try {
    return await fn(dosya);
  } finally {
    CONFIG.pardusYedekKabulFlag = prev;
    _yedekLogSifirla();
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

/** Sahte ProBook + konteyner kabul betiklerini kurar, CONFIG'i onlara yönlendirir. */
async function betiklerle({ probook, konteyner, acik = true } = {}, fn) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'yedek-betik-'));
  const probookPath = path.join(dir, 'probook-kabul.sh');
  const konteynerPath = path.join(dir, 'konteyner-kabul.sh');
  await fsp.writeFile(probookPath, probook || '#!/bin/bash\nexit 0\n', { mode: 0o755 });
  await fsp.writeFile(konteynerPath, konteyner || '#!/bin/bash\nmkdir -p "$2"\nexit 0\n', { mode: 0o755 });
  const prev = {
    acik: CONFIG.pardusKabul,
    probook: CONFIG.pardusKabulScript,
    konteyner: CONFIG.pardusKonteynerKabulScript,
    kayit: CONFIG.pardusYedekKabulKayit,
  };
  CONFIG.pardusKabul = acik;
  CONFIG.pardusKabulScript = probookPath;
  CONFIG.pardusKonteynerKabulScript = konteynerPath;
  CONFIG.pardusYedekKabulKayit = path.join(dir, 'kayit.log');
  const prevKok = process.env.EMPP_KABUL_KANIT_KOK;
  const kok = await fsp.mkdtemp(path.join(os.tmpdir(), 'yedek-kanit-kok-'));
  process.env.EMPP_KABUL_KANIT_KOK = kok;
  try {
    return await fn(dir);
  } finally {
    CONFIG.pardusKabul = prev.acik;
    CONFIG.pardusKabulScript = prev.probook;
    CONFIG.pardusKonteynerKabulScript = prev.konteyner;
    CONFIG.pardusYedekKabulKayit = prev.kayit;
    if (prevKok === undefined) delete process.env.EMPP_KABUL_KANIT_KOK; else process.env.EMPP_KABUL_KANIT_KOK = prevKok;
    await fsp.rm(dir, { recursive: true, force: true });
    await fsp.rm(kok, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// (3a) guncelYetenekler + GERÇEK bayrak dosyası (2026-09-28, agent-test-borcu-20260928)
//
// Önceki test turunda bulunan gözlem: yukarıdaki (2)'deki `pardusKabulErisimUygula` saf
// fonksiyon testleri `yedekAktif` parametresini ELLE true/false geçiyor — `guncelYetenekler()`
// entegrasyonunun GERÇEK bayrak dosyasını (`pardusYedekKabul()` → `CONFIG.pardusYedekKabulFlag`)
// okuyup bu parametreyi doğru ürettiğini uçtan uca sınayan bir çalışma-zamanı testi YOKTU
// (yalnız satır 328'deki kaynak-sentinel metin arıyordu, davranışı ÇALIŞTIRMIYORDU). runner.js'e
// dokunulmadı — `bayrakla()` (yukarıda, satır 104) zaten bu iş için var, CONFIG.pardusYedekKabulFlag'i
// geçici bir dosyaya yönlendiriyor.
test('guncelYetenekler: bayrak GEÇERLİ (gelecek tarih) + ProBook erişilemez → pardus YETENEKTE KALIR', async () => {
  const gelecek = new Date(Date.now() + 3600000).toISOString();
  const eskiCaps = runner.CONFIG.caps;
  const eskiPardusKabul = runner.CONFIG.pardusKabul;
  const eskiEnvErisim = process.env.EMPP_PARDUS_KABUL_ERISIM;
  await bayrakla(gelecek, async () => {
    runner.CONFIG.caps = ['android', 'pardus'];
    runner.CONFIG.pardusKabul = true;
    delete process.env.EMPP_PARDUS_KABUL_ERISIM;
    try {
      runner._probookErisimAyarla({ t: Date.now(), erisilir: false, suruyor: false });
      assert.deepEqual(
        runner.guncelYetenekler(),
        ['android', 'pardus'],
        'bayrak geçerliyken (süresi dolmamış) ProBook erişilemez olsa da konteyner yedeği pardus\'u korur',
      );
    } finally {
      runner.CONFIG.caps = eskiCaps;
      runner.CONFIG.pardusKabul = eskiPardusKabul;
      if (eskiEnvErisim === undefined) delete process.env.EMPP_PARDUS_KABUL_ERISIM; else process.env.EMPP_PARDUS_KABUL_ERISIM = eskiEnvErisim;
      runner._probookErisimAyarla({ t: 0, erisilir: undefined, suruyor: false });
    }
  });
});

test('guncelYetenekler: bayrak SÜRESİ DOLMUŞ (geçmiş tarih) + ProBook erişilemez → pardus DÜŞER (yedeksiz davranışla aynı)', async () => {
  const gecmis = new Date(Date.now() - 3600000).toISOString();
  const eskiCaps = runner.CONFIG.caps;
  const eskiPardusKabul = runner.CONFIG.pardusKabul;
  const eskiEnvErisim = process.env.EMPP_PARDUS_KABUL_ERISIM;
  await bayrakla(gecmis, async () => {
    runner.CONFIG.caps = ['android', 'pardus'];
    runner.CONFIG.pardusKabul = true;
    delete process.env.EMPP_PARDUS_KABUL_ERISIM;
    try {
      runner._probookErisimAyarla({ t: Date.now(), erisilir: false, suruyor: false });
      assert.deepEqual(
        runner.guncelYetenekler(),
        ['android'],
        'bayrak süresi dolunca (dosya SİLİNMEDİ, yalnız yok sayıldı) yedek pasif sayılır — davranış "hiç bayrak yokmuş" ile AYNI: erişilemez → pardus düşer',
      );
    } finally {
      runner.CONFIG.caps = eskiCaps;
      runner.CONFIG.pardusKabul = eskiPardusKabul;
      if (eskiEnvErisim === undefined) delete process.env.EMPP_PARDUS_KABUL_ERISIM; else process.env.EMPP_PARDUS_KABUL_ERISIM = eskiEnvErisim;
      runner._probookErisimAyarla({ t: 0, erisilir: undefined, suruyor: false });
    }
  });
});

test('pardusKabulKapisi: yedek aktif + ProBook erişilemez ÖLÇÜLDÜ → ProBook betiği HİÇ ÇAĞRILMAZ, konteyner GEÇTİ', async () => {
  const gelecek = new Date(Date.now() + 3600000).toISOString();
  await bayrakla(gelecek, async () => {
    await betiklerle({
      probook: '#!/bin/bash\ntouch "$(dirname "$0")/PROBOOK_CAGRILDI"\nexit 0\n',
      konteyner: '#!/bin/bash\nmkdir -p "$2"\necho "[kkabul] GECTI sapma=0.148 koyu=0.02 renk=24160"\nexit 0\n',
    }, async (dir) => {
      _probookErisimAyarla({ t: Date.now(), erisilir: false, suruyor: false });
      try {
        const outDir = path.join(dir, 'out');
        await fsp.mkdir(outDir, { recursive: true });
        await pardusKabulKapisi(path.join(dir, 'artifact.impark'), outDir, 'Test Kitap', '77001');
        assert.equal(fs.existsSync(path.join(dir, 'PROBOOK_CAGRILDI')), false, 'ProBook betiği çağrılmamalı');
        const kayit = await fsp.readFile(CONFIG.pardusYedekKabulKayit, 'utf8');
        assert.match(kayit, /\tGECTI\t/);
        assert.match(kayit, /77001/);
        assert.match(kayit, /Test Kitap/);
      } finally {
        _probookErisimAyarla({ t: 0, erisilir: undefined, suruyor: false });
      }
    });
  });
});

test('pardusKabulKapisi: konteyner RED (rc=1) → paket kusuru hatası, ERTELENEBİLİR SAYILMAZ', async () => {
  const gelecek = new Date(Date.now() + 3600000).toISOString();
  await bayrakla(gelecek, async () => {
    await betiklerle({
      konteyner: '#!/bin/bash\nmkdir -p "$2"\necho "[kkabul] RED: pencere acildi ama ICERIK YOK"\nexit 1\n',
    }, async (dir) => {
      _probookErisimAyarla({ t: Date.now(), erisilir: false, suruyor: false });
      try {
        const outDir = path.join(dir, 'out');
        await fsp.mkdir(outDir, { recursive: true });
        let hata = null;
        try {
          await pardusKabulKapisi(path.join(dir, 'artifact.impark'), outDir, 'Test Kitap', '77002');
        } catch (e) { hata = e; }
        assert.ok(hata, 'RED fırlatmalı');
        assert.match(hata.message, /KONTEYNER kabul kapısından geçemedi \(rc=1\)/);
        assert.equal(ertelenebilirKaynakHatasi(hata), false, 'gerçek paket kusuru ertelenmemeli');
        const kayit = await fsp.readFile(CONFIG.pardusYedekKabulKayit, 'utf8');
        assert.match(kayit, /\tRED\t/);
      } finally {
        _probookErisimAyarla({ t: 0, erisilir: undefined, suruyor: false });
      }
    });
  });
});

test('pardusKabulKapisi: konteyner ÖLÇÜLEMEDİ (rc=2) → ertelenebilir işaretli hata, TSV\'ye OLCULEMEDI', async () => {
  const gelecek = new Date(Date.now() + 3600000).toISOString();
  await bayrakla(gelecek, async () => {
    await betiklerle({
      konteyner: '#!/bin/bash\necho "[kkabul] OLCULEMEDI: docker erisilemiyor"\nexit 2\n',
    }, async (dir) => {
      _probookErisimAyarla({ t: Date.now(), erisilir: false, suruyor: false });
      try {
        const outDir = path.join(dir, 'out');
        await fsp.mkdir(outDir, { recursive: true });
        let hata = null;
        try {
          await pardusKabulKapisi(path.join(dir, 'artifact.impark'), outDir, 'Test Kitap', '77003');
        } catch (e) { hata = e; }
        assert.ok(hata, 'ÖLÇÜLEMEDİ de fırlatmalı (paket kusuru değil ama iş ertelenmeli)');
        assert.match(hata.message, new RegExp(PROBOOK_KAPISI_ISARETI.replace(/[[\]]/g, '\\$&')));
        assert.equal(ertelenebilirKaynakHatasi(hata), true, 'kapı kusuru ertelenebilir sayılmalı');
        const kayit = await fsp.readFile(CONFIG.pardusYedekKabulKayit, 'utf8');
        assert.match(kayit, /\tOLCULEMEDI\t/);
      } finally {
        _probookErisimAyarla({ t: 0, erisilir: undefined, suruyor: false });
      }
    });
  });
});

test('pardusKabulKapisi: konteyner betiği GERÇEK timeout → ölçülemedi sayılır (SIGKILL, hızlı fail)', async () => {
  const gelecek = new Date(Date.now() + 3600000).toISOString();
  await bayrakla(gelecek, async () => {
    await betiklerle({
      konteyner: '#!/bin/bash\nsleep 30\nexit 0\n',
    }, async (dir) => {
      const prevTimeout = CONFIG.pardusKabulTimeoutMs;
      CONFIG.pardusKabulTimeoutMs = 400;
      _probookErisimAyarla({ t: Date.now(), erisilir: false, suruyor: false });
      try {
        const outDir = path.join(dir, 'out');
        await fsp.mkdir(outDir, { recursive: true });
        const t0 = Date.now();
        let hata = null;
        try {
          await pardusKabulKapisi(path.join(dir, 'artifact.impark'), outDir, 'Test Kitap', '77004');
        } catch (e) { hata = e; }
        assert.ok(hata);
        assert.equal(ertelenebilirKaynakHatasi(hata), true);
        assert.ok(Date.now() - t0 < 10000, 'timeout uygulanmalı, asılı kalmamalı');
      } finally {
        CONFIG.pardusKabulTimeoutMs = prevTimeout;
        _probookErisimAyarla({ t: 0, erisilir: undefined, suruyor: false });
      }
    });
  });
});

test('pardusKabulKapisi: ProBook ölçümde erişilir ama betik erişilemezlikle düştü + yedek aktif → konteynere düşülür', async () => {
  const gelecek = new Date(Date.now() + 3600000).toISOString();
  await bayrakla(gelecek, async () => {
    await betiklerle({
      probook: '#!/bin/bash\necho "[kabul] RED: ProBook\'a baglanilamadi"\nexit 1\n',
      konteyner: '#!/bin/bash\nmkdir -p "$2"\necho "[kkabul] GECTI"\nexit 0\n',
    }, async (dir) => {
      _probookErisimAyarla({ t: Date.now(), erisilir: true, suruyor: false }); // ölçümde ERİŞİLİR
      try {
        const outDir = path.join(dir, 'out');
        await fsp.mkdir(outDir, { recursive: true });
        await pardusKabulKapisi(path.join(dir, 'artifact.impark'), outDir, 'Test Kitap', '77005');
        const kayit = await fsp.readFile(CONFIG.pardusYedekKabulKayit, 'utf8');
        assert.match(kayit, /\tGECTI\t/, 'ProBook betiği düşse bile yedek konteynere düşüp GEÇTİ vermeli');
      } finally {
        _probookErisimAyarla({ t: 0, erisilir: undefined, suruyor: false });
      }
    });
  });
});

test('pardusKabulKapisi: süresi dolmuş bayrak → ProBook betiği çağrılır, konteyner ÇAĞRILMAZ (eskisi gibi ertelenir)', async () => {
  const gecmis = new Date(Date.now() - 3600000).toISOString();
  await bayrakla(gecmis, async () => {
    await betiklerle({
      probook: '#!/bin/bash\necho "[kabul] RED: ProBook\'a baglanilamadi"\nexit 1\n',
      konteyner: '#!/bin/bash\ntouch "$(dirname "$0")/KONTEYNER_CAGRILDI"\nmkdir -p "$2"\nexit 0\n',
    }, async (dir) => {
      _probookErisimAyarla({ t: Date.now(), erisilir: false, suruyor: false });
      try {
        const outDir = path.join(dir, 'out');
        await fsp.mkdir(outDir, { recursive: true });
        let hata = null;
        try {
          await pardusKabulKapisi(path.join(dir, 'artifact.impark'), outDir, 'Test Kitap', '77006');
        } catch (e) { hata = e; }
        assert.ok(hata, 'ProBook erişilemezliği yine fırlatmalı (eski davranış)');
        assert.equal(ertelenebilirKaynakHatasi(hata), true, 'ProBook erişilemezliği hâlâ ertelenebilir');
        assert.equal(fs.existsSync(path.join(dir, 'KONTEYNER_CAGRILDI')), false, 'süresi dolmuş bayrakta konteyner ÇAĞRILMAMALI');
      } finally {
        _probookErisimAyarla({ t: 0, erisilir: undefined, suruyor: false });
      }
    });
  });
});

test('pardusKabulKapisi: bayrak hiç yoksa (dosya yok) davranış eskisiyle BİREBİR aynı — ProBook çağrılır', async () => {
  await bayrakla(null, async () => {
    await betiklerle({
      probook: '#!/bin/bash\ntouch "$(dirname "$0")/PROBOOK_CAGRILDI"\nmkdir -p "$2"\nexit 0\n',
      konteyner: '#!/bin/bash\ntouch "$(dirname "$0")/KONTEYNER_CAGRILDI"\nexit 0\n',
    }, async (dir) => {
      _probookErisimAyarla({ t: Date.now(), erisilir: false, suruyor: false });
      try {
        const outDir = path.join(dir, 'out');
        await fsp.mkdir(outDir, { recursive: true });
        await pardusKabulKapisi(path.join(dir, 'artifact.impark'), outDir, 'Test Kitap', '77007');
        assert.equal(fs.existsSync(path.join(dir, 'PROBOOK_CAGRILDI')), true, 'bayrak yokken ProBook betiği HER ZAMANKİ gibi çağrılmalı');
        assert.equal(fs.existsSync(path.join(dir, 'KONTEYNER_CAGRILDI')), false);
      } finally {
        _probookErisimAyarla({ t: 0, erisilir: undefined, suruyor: false });
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Kaynak sentinel — kod yollarının gerçekten gömülü olduğunu doğrular
// ---------------------------------------------------------------------------

test('kaynak sentinel: guncelYetenekler yedekAktif geçiyor', () => {
  const fn = SRC.slice(SRC.indexOf('function guncelYetenekler()'), SRC.indexOf('async function fetchNextJob'));
  assert.match(fn, /yedekAktif: yedek\.aktif/);
  assert.match(fn, /pardusYedekKabul\(\)/);
});

test('kaynak sentinel: pardusKabulKapisi konteyner yoluna sahip (bypass + hata-düşüşü)', () => {
  const fn = SRC.slice(SRC.indexOf('async function pardusKabulKapisi'), SRC.indexOf('async function konteynerKabulKapisi'));
  assert.match(fn, /pardusYedekKabul\(\)/);
  // İki farklı çağrı noktası: (a) ProBook betiği hiç çağrılmadan bypass, (b) betik düştükten sonra düşüş.
  assert.equal((fn.match(/await konteynerKabulKapisi\(/g) || []).length, 2);
});

test('kaynak sentinel: konteynerKabulKapisi rc eşlemesi (0 GEÇTİ, 1 RED, 2/timeout ÖLÇÜLEMEDİ)', () => {
  const fn = SRC.slice(SRC.indexOf('async function konteynerKabulKapisi'), SRC.indexOf('async function pardusKonteynerKayitYaz'));
  assert.match(fn, /kabul\.timedOut \|\| kabul\.code === 2/);
  assert.match(fn, /PROBOOK_KAPISI_ISARETI\} konteyner kabulü ÖLÇÜLEMEDİ/);
  assert.match(fn, /KONTEYNER kabul kapısından geçemedi \(rc=\$\{kabul\.code\}\)/);
  assert.match(fn, /KONTEYNER yedek kabulü GEÇTİ/);
});

// ---------------------------------------------------------------------------
// MUTASYON KANITI (elle doğrulandı — 2026-09-27): pardusKabulKapisi'nin ProBook-erişilemez
// bypass koşulu `if (yedek.aktif && kabulHost !== 'yerel') {` geçici olarak `if (false) {`e
// çevrilip yalnızca yukarıdaki ilk entegrasyon testi ("ProBook betiği HİÇ ÇAĞRILMAZ") tekrar
// koşuldu: PROBOOK_CAGRILDI dosyası oluştu ve assert.equal(..., false) İFADESİ KIRILDI
// (AssertionError). Mutasyon geri alınıp test yeniden yeşile döndü — bu satırlar testin
// gerçekten o dalı sınadığının kanıtıdır (kalıcı kod bu dosyada YOKTUR, elle koşuldu).
// ---------------------------------------------------------------------------

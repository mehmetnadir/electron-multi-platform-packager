'use strict';

/**
 * stapler retry + görünür hata (2026-09-21, ölçümle).
 *
 * KÖK NEDEN: `xcrun stapler` başarısızlıkta TÜM tanı çıktısını (CloudKit sorgusu,
 * "Record not found", "Error 65") stdout'a yazar — stderr HER ZAMAN boştur (gerçek
 * `xcrun stapler staple` ile bu Mac'te doğrulandı). Eski kod (`runner.js`) yalnız
 * `staple.stderr`yi logluyordu, bu yüzden 2026-09-18'den beri 8/8 mac işinde
 * "stapler failed: " BOŞ mesaj görünüyordu (Silent Catch Gate ihlali).
 *
 * AYRICA GERÇEK ARIZA: notarytool --wait "Accepted" dönse bile Apple'ın CloudKit
 * ticket-delivery veritabanına yayılması az gecikmelidir — ilk staple denemesi
 * dokümante edilmiş bir yarış durumuyla düşebilir (Apple Developer Forums thread
 * 115670/123806, electron/notarize#120). Çözüm: kısa bekleyip yeniden dene.
 *
 * Testler GERÇEK spawn ile çalışır (repo stili — runner-pardus.test.js `withFakeBin`
 * ile aynı desen): sahte `xcrun`/`codesign` PATH'e eklenir, `xcrun stapler staple`
 * çağrı sayısına göre N. denemeye kadar stdout'a hata basıp Error 65 ile düşer.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const {
  CONFIG,
  signAndNotarizeMac,
  STAPLE_KAPISI_ISARETI,
  agStapleCikti,
} = require('./runner.js');

async function withFakeBin(scripts, fn) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fake-bin-'));
  for (const [name, body] of Object.entries(scripts)) {
    const p = path.join(dir, name);
    await fsp.writeFile(p, body, { mode: 0o755 });
  }
  const prevPath = process.env.PATH;
  process.env.PATH = `${dir}:${prevPath}`;
  try {
    return await fn(dir);
  } finally {
    process.env.PATH = prevPath;
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

// Sahte `xcrun`: `notarytool` her zaman OK; `stapler staple` FAKE_STAPLE_FAIL_UNTIL'e
// kadar STDOUT'a (stderr'e DEĞİL — gerçek stapler davranışı) hata basıp Error 65
// döner, sonra 0 döner.
const FAKE_XCRUN = `#!/bin/bash
if [ "$1" = "notarytool" ]; then
  echo "notarytool: Accepted"
  exit 0
fi
if [ "$1" = "stapler" ]; then
  STATE="$FAKE_STAPLE_STATE"
  COUNT=0
  [ -f "$STATE" ] && COUNT=$(cat "$STATE")
  COUNT=$((COUNT+1))
  echo "$COUNT" > "$STATE"
  FAILUNTIL="\${FAKE_STAPLE_FAIL_UNTIL:-0}"
  if [ "$COUNT" -le "$FAILUNTIL" ]; then
    echo "Processing: fake.dmg"
    echo "CloudKit query for fake.dmg (deneme $COUNT) failed due to \\"Record not found\\"."
    echo "The staple and validate action failed! Error 65."
    exit 65
  fi
  echo "The validate action worked!"
  exit 0
fi
exit 0
`;
const FAKE_CODESIGN = '#!/bin/bash\nexit 0\n';

async function withMacSigningEnv(fn) {
  const prevIdentity = CONFIG.signIdentity;
  const prevProfile = CONFIG.notaryProfile;
  const prevMax = CONFIG.stapleRetryMax;
  const prevDelay = CONFIG.stapleRetryDelayMs;
  const prevState = process.env.FAKE_STAPLE_STATE;
  const prevFailUntil = process.env.FAKE_STAPLE_FAIL_UNTIL;
  CONFIG.signIdentity = 'Test Identity (TEAM123)';
  CONFIG.notaryProfile = 'test-profile';
  CONFIG.stapleRetryDelayMs = 5; // gerçek zaman beklemeden koş
  const stateDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'staple-state-'));
  const statePath = path.join(stateDir, 'count');
  process.env.FAKE_STAPLE_STATE = statePath;
  try {
    return await fn({ statePath });
  } finally {
    CONFIG.signIdentity = prevIdentity;
    CONFIG.notaryProfile = prevProfile;
    CONFIG.stapleRetryMax = prevMax;
    CONFIG.stapleRetryDelayMs = prevDelay;
    if (prevState === undefined) delete process.env.FAKE_STAPLE_STATE; else process.env.FAKE_STAPLE_STATE = prevState;
    if (prevFailUntil === undefined) delete process.env.FAKE_STAPLE_FAIL_UNTIL; else process.env.FAKE_STAPLE_FAIL_UNTIL = prevFailUntil;
    await fsp.rm(stateDir, { recursive: true, force: true });
  }
}

function captureConsole() {
  const calls = { warn: [], log: [] };
  const prevWarn = console.warn;
  const prevLog = console.log;
  console.warn = (...args) => calls.warn.push(args.map(String).join(' '));
  console.log = (...args) => calls.log.push(args.map(String).join(' '));
  return {
    calls,
    restore() { console.warn = prevWarn; console.log = prevLog; },
  };
}

// ---------------------------------------------------------------------------
// agStapleCikti — birim testi: eski kusuru doğrudan kanıtlar (stderr boşken
// stdout'taki gerçek hata mesajı KAYBOLMAMALI).
// ---------------------------------------------------------------------------

test('agStapleCikti: stderr BOŞ olsa da stdout içindeki gerçek hata mesajı görünür kalır (eski kusurun tersi)', () => {
  const res = { code: 65, stdout: 'CloudKit query ... failed due to "Record not found".\nThe staple and validate action failed! Error 65.', stderr: '' };
  const ozet = agStapleCikti(res);
  assert.match(ozet, /Record not found/);
  assert.notEqual(ozet, '', 'eski kusur: stderr okununca bu BOŞ dönerdi');
});

test('agStapleCikti: hem stdout hem stderr boşsa rc ile birlikte anlaşılır bir işaret döner (asla sessiz boşluk değil)', () => {
  const ozet = agStapleCikti({ code: 65, stdout: '', stderr: '' });
  assert.match(ozet, /rc=65/);
});

// ---------------------------------------------------------------------------
// signAndNotarizeMac — uçtan uca, GERÇEK spawn + sahte xcrun/codesign.
// ---------------------------------------------------------------------------

test('signAndNotarizeMac: ilk staple denemesi CloudKit yarışıyla düşer, 2. denemede GEÇER — iş "notarized + stapled" ile biter', async () => {
  await withMacSigningEnv(async ({ statePath }) => {
    process.env.FAKE_STAPLE_FAIL_UNTIL = '1'; // 1. deneme düşer, 2. geçer
    CONFIG.stapleRetryMax = 3;
    const cap = captureConsole();
    try {
      await withFakeBin({ xcrun: FAKE_XCRUN, codesign: FAKE_CODESIGN }, async () => {
        await signAndNotarizeMac('/tmp/fake.dmg');
      });
    } finally {
      cap.restore();
    }
    const denemeSayisi = Number(fs.readFileSync(statePath, 'utf8').trim());
    assert.equal(denemeSayisi, 2, 'stapler tam olarak 2 kez çağrılmalı (1 fail + 1 success)');
    assert.ok(cap.calls.log.some((l) => l.includes('notarized + stapled')), 'başarı logu görünmeli');
    assert.ok(cap.calls.warn.some((l) => l.includes('CloudKit') || l.includes('Record not found')),
      'ara-deneme uyarısı gerçek hata metnini İÇERMELİ (boş olmamalı)');
  });
});

test('signAndNotarizeMac: TÜM denemeler tükenirse fırlatmaz (best-effort) ama GÖRÜNÜR işaretle uyarır, mesaj BOŞ değildir', async () => {
  await withMacSigningEnv(async ({ statePath }) => {
    process.env.FAKE_STAPLE_FAIL_UNTIL = '999'; // hiçbir zaman geçmez
    CONFIG.stapleRetryMax = 2;
    const cap = captureConsole();
    try {
      await withFakeBin({ xcrun: FAKE_XCRUN, codesign: FAKE_CODESIGN }, async () => {
        await assert.doesNotReject(() => signAndNotarizeMac('/tmp/fake.dmg'));
      });
    } finally {
      cap.restore();
    }
    const denemeSayisi = Number(fs.readFileSync(statePath, 'utf8').trim());
    assert.equal(denemeSayisi, 2, 'CONFIG.stapleRetryMax=2 ise tam 2 deneme yapılmalı, ne az ne çok');
    const sonUyari = cap.calls.warn.find((l) => l.includes(STAPLE_KAPISI_ISARETI));
    assert.ok(sonUyari, `nihai uyarı ${STAPLE_KAPISI_ISARETI} işaretini taşımalı (izleyici bunu grep'ler)`);
    assert.match(sonUyari, /Record not found|Error 65/, 'nihai uyarı BOŞ olmamalı, gerçek Apple hata metnini içermeli');
  });
});

test('signAndNotarizeMac: notarytool BAŞARISIZ olursa stapler HİÇ çağrılmaz (eski davranış korunur)', async () => {
  await withMacSigningEnv(async ({ statePath }) => {
    const cap = captureConsole();
    try {
      await withFakeBin({
        xcrun: '#!/bin/bash\nif [ "$1" = "notarytool" ]; then echo "kimlik hatasi" 1>&2; exit 1; fi\nexit 0\n',
        codesign: FAKE_CODESIGN,
      }, async () => {
        await signAndNotarizeMac('/tmp/fake.dmg');
      });
    } finally {
      cap.restore();
    }
    assert.equal(fs.existsSync(statePath), false, 'notarytool düşerse stapler dosyaya HİÇ dokunmamalı (hiç çağrılmadı)');
    assert.ok(cap.calls.warn.some((l) => l.includes('notarytool failed')));
  });
});

// ---------------------------------------------------------------------------
// CONFIG — varsayılanlar ve env override.
// ---------------------------------------------------------------------------

test('CONFIG.stapleRetryMax/stapleRetryDelayMs: varsayılanlar tanımlı ve pozitif', () => {
  assert.ok(Number.isFinite(CONFIG.stapleRetryMax) && CONFIG.stapleRetryMax >= 1);
  assert.ok(Number.isFinite(CONFIG.stapleRetryDelayMs) && CONFIG.stapleRetryDelayMs >= 0);
});

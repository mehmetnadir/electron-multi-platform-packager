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
const { after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

// TEST YALITIMI (2026-09-28, agent-test-borcu-20260928 — bkz. test-yalitim.js).
const { izoleOrtam } = require('./test-yalitim');
const YALITIM = izoleOrtam();

const {
  CONFIG,
  signAndNotarizeMac,
  STAPLE_KAPISI_ISARETI,
  agStapleCikti,
} = require('./runner.js');
const { ertelenebilirKaynakHatasi } = require('./runner-helpers');

YALITIM.configUygula(CONFIG);
after(() => YALITIM.temizle());

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

test('NOTER KAPISI: TÜM staple denemeleri tükenirse FIRLATIR (DMG yüklenmez), CloudKit yarışı ERTELENEBİLİR', async () => {
  await withMacSigningEnv(async ({ statePath }) => {
    process.env.FAKE_STAPLE_FAIL_UNTIL = '999'; // hiçbir zaman geçmez
    CONFIG.stapleRetryMax = 2;
    const cap = captureConsole();
    let hata = null;
    try {
      await withFakeBin({ xcrun: FAKE_XCRUN, codesign: FAKE_CODESIGN }, async () => {
        await signAndNotarizeMac('/tmp/fake.dmg').catch((e) => { hata = e; });
      });
    } finally {
      cap.restore();
    }
    const denemeSayisi = Number(fs.readFileSync(statePath, 'utf8').trim());
    assert.equal(denemeSayisi, 2, 'CONFIG.stapleRetryMax=2 ise tam 2 deneme yapılmalı, ne az ne çok');
    assert.ok(hata, 'staple yapılamayan DMG yüklenmemeli — signAndNotarizeMac fırlatmalı');
    assert.match(hata.message, /^noter onayı alınamadı — DMG yüklenmedi: /);
    assert.match(hata.message, /Record not found|Error 65/, 'mesaj gerçek Apple hata metnini içermeli');
    assert.equal(ertelenebilirKaynakHatasi(hata), true, 'CloudKit yayılma yarışı geçici — failed yazılmamalı');
  });
});

test('NOTER KAPISI kapalı (AGENT_NOTER_ZORUNLU=0): staple tükenince eski best-effort davranış — fırlatmaz, GÖRÜNÜR işaret', async () => {
  await withMacSigningEnv(async () => {
    process.env.FAKE_STAPLE_FAIL_UNTIL = '999';
    CONFIG.stapleRetryMax = 2;
    const onceki = CONFIG.noterZorunlu;
    CONFIG.noterZorunlu = false;
    const cap = captureConsole();
    try {
      await withFakeBin({ xcrun: FAKE_XCRUN, codesign: FAKE_CODESIGN }, async () => {
        await assert.doesNotReject(() => signAndNotarizeMac('/tmp/fake.dmg'));
      });
    } finally {
      cap.restore();
      CONFIG.noterZorunlu = onceki;
    }
    const sonUyari = cap.calls.warn.find((l) => l.includes(STAPLE_KAPISI_ISARETI));
    assert.ok(sonUyari, `nihai uyarı ${STAPLE_KAPISI_ISARETI} işaretini taşımalı (izleyici bunu grep'ler)`);
    assert.match(sonUyari, /Record not found|Error 65/, 'nihai uyarı BOŞ olmamalı, gerçek Apple hata metnini içermeli');
  });
});

test('NOTER KAPISI: notarytool BAŞARISIZ → FIRLATIR ve stapler HİÇ çağrılmaz', async () => {
  await withMacSigningEnv(async ({ statePath }) => {
    const cap = captureConsole();
    let hata = null;
    try {
      await withFakeBin({
        xcrun: '#!/bin/bash\nif [ "$1" = "notarytool" ]; then echo "kimlik hatasi" 1>&2; exit 1; fi\nexit 0\n',
        codesign: FAKE_CODESIGN,
      }, async () => {
        await signAndNotarizeMac('/tmp/fake.dmg').catch((e) => { hata = e; });
      });
    } finally {
      cap.restore();
    }
    assert.equal(fs.existsSync(statePath), false, 'notarytool düşerse stapler dosyaya HİÇ dokunmamalı (hiç çağrılmadı)');
    assert.ok(hata, 'notarytool düşünce DMG yüklenmemeli');
    assert.match(hata.message, /^noter onayı alınamadı — DMG yüklenmedi: kimlik hatasi/);
  });
});

// 26.09 06:11/06:14 UTC (59834 mac, 73768 mac) agent.log'undaki BİREBİR çıktı.
const XCRUN_ANAHTARLIK = `#!/bin/bash
if [ "$1" = "notarytool" ]; then
  echo "Conducting pre-submission checks for artifact.dmg and initiating connection to the Apple notary service..."
  echo "Error: No Keychain password item found for profile: empp-notary" 1>&2
  exit 69
fi
if [ "$1" = "stapler" ]; then echo x > "$FAKE_STAPLE_STATE"; exit 0; fi
exit 0
`;
const XCRUN_INVALID_RC0 = `#!/bin/bash
if [ "$1" = "notarytool" ]; then
  echo "Conducting pre-submission checks for artifact.dmg and initiating connection to the Apple notary service..."
  echo "Processing complete"
  echo "  id: 11111111-2222-3333-4444-555555555555"
  echo "  status: Invalid"
  exit 0
fi
if [ "$1" = "stapler" ]; then echo x > "$FAKE_STAPLE_STATE"; exit 0; fi
exit 0
`;
const XCRUN_CEVRIMDISI = `#!/bin/bash
if [ "$1" = "notarytool" ]; then
  echo "Error: The Internet connection appears to be offline. NSURLErrorDomain Code=-1009" 1>&2
  exit 1
fi
exit 0
`;

async function noterKos(xcrun, codesign = FAKE_CODESIGN) {
  let hata = null;
  await withMacSigningEnv(async ({ statePath }) => {
    const cap = captureConsole();
    try {
      await withFakeBin({ xcrun, codesign }, async () => {
        await signAndNotarizeMac('/tmp/fake.dmg').catch((e) => { hata = e; });
      });
    } finally {
      cap.restore();
    }
    if (hata) hata.stapleCagrildi = fs.existsSync(statePath);
  });
  return hata;
}

test('NOTER KAPISI: anahtarlık öğesi yok (26.09 vakası) → DMG yüklenmez, ERTELENEBİLİR (failed yazılmaz)', async () => {
  const hata = await noterKos(XCRUN_ANAHTARLIK);
  assert.ok(hata, 'fırlatmalı');
  assert.match(hata.message,
    /^noter onayı alınamadı — DMG yüklenmedi: Error: No Keychain password item found for profile: empp-notary/);
  assert.equal(ertelenebilirKaynakHatasi(hata), true);
  assert.equal(hata.stapleCagrildi, false);
});

test('NOTER KAPISI: çevrimdışı/ağ hatası → ERTELENEBİLİR', async () => {
  const hata = await noterKos(XCRUN_CEVRIMDISI);
  assert.ok(hata);
  assert.equal(ertelenebilirKaynakHatasi(hata), true);
});

test('NOTER KAPISI: Apple "status: Invalid" (rc=0 olsa bile) → KALICI, stapler çağrılmaz', async () => {
  const hata = await noterKos(XCRUN_INVALID_RC0);
  assert.ok(hata, 'Invalid rc=0 dönse de DMG yüklenmemeli');
  assert.match(hata.message, /^noter onayı alınamadı — DMG yüklenmedi: status: Invalid/);
  assert.equal(ertelenebilirKaynakHatasi(hata), false, 'Apple reddi kalıcı hatadır');
  assert.equal(hata.stapleCagrildi, false);
});

test('NOTER KAPISI: codesign (imza) hatası → KALICI', async () => {
  const hata = await noterKos(FAKE_XCRUN,
    '#!/bin/bash\necho "fake.dmg: The specified item could not be signed: bad signature" 1>&2\nexit 1\n');
  assert.ok(hata);
  assert.match(hata.message, /^noter onayı alınamadı — DMG yüklenmedi: .*signed.*\(codesign, rc=1\)/);
  assert.equal(ertelenebilirKaynakHatasi(hata), false);
});

test('NOTER KAPISI: codesign errSecInternalComponent (kilitli anahtarlık) → ERTELENEBİLİR, zincir durur', async () => {
  const hata = await noterKos(FAKE_XCRUN,
    '#!/bin/bash\necho "/tmp/fake.dmg: errSecInternalComponent" 1>&2\nexit 1\n');
  assert.ok(hata, 'imzalanamayan DMG yüklenmemeli');
  assert.match(hata.message, /^noter onayı alınamadı — DMG yüklenmedi: .*errSecInternalComponent \(codesign, rc=1\)/);
  assert.equal(ertelenebilirKaynakHatasi(hata), true, 'kilitli anahtarlık geçici — failed yazılmamalı');
  assert.equal(hata.stapleCagrildi, false);
});

test('NOTER KAPISI: imza kimliği tanımsız → DMG imzasız yüklenmez (KALICI)', async () => {
  const onceki = CONFIG.signIdentity;
  CONFIG.signIdentity = '';
  const cap = captureConsole();
  try {
    await assert.rejects(() => signAndNotarizeMac('/tmp/fake.dmg'),
      (e) => /^noter onayı alınamadı — DMG yüklenmedi: APPLE_SIGN_IDENTITY/.test(e.message)
        && ertelenebilirKaynakHatasi(e) === false);
  } finally {
    cap.restore();
    CONFIG.signIdentity = onceki;
  }
});

test('kaynak-sentinel: processJob noter adımını try/catch ile SARMAZ ve yüklemeden ÖNCE çağırır', () => {
  const src = fs.readFileSync(path.join(__dirname, 'runner.js'), 'utf8');
  const i = src.indexOf('await signAndNotarizeMac(artifactPath);');
  const j = src.indexOf('const yayin = await postResultSuccess(auth, job, yayinYolu);');
  assert.ok(i > 0 && j > i, 'noter adımı yüklemeden önce olmalı');
  const onu = src.slice(src.lastIndexOf('// 4. macOS', i), j);
  assert.doesNotMatch(onu, /catch|try\s*\{/, 'noter hatası yutulmamalı');
});

// ---------------------------------------------------------------------------
// CONFIG — varsayılanlar ve env override.
// ---------------------------------------------------------------------------

test('CONFIG.stapleRetryMax/stapleRetryDelayMs: varsayılanlar tanımlı ve pozitif', () => {
  assert.ok(Number.isFinite(CONFIG.stapleRetryMax) && CONFIG.stapleRetryMax >= 1);
  assert.ok(Number.isFinite(CONFIG.stapleRetryDelayMs) && CONFIG.stapleRetryDelayMs >= 0);
});

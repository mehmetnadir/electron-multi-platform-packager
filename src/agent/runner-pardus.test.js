'use strict';

/**
 * Pardus (.impark) yapım dalı — runner.js'e eklenen üçüncü platform (2026-09-10).
 *
 * Android/macOS aksine bu dal yerel HTTP paketleyiciyi (3001) HİÇ kullanmaz:
 * `pardus-packager-build.sh` srv21'in `packageLinux`'ını Docker'da BİREBİR koşturur.
 * Testler mümkün olduğunca GERÇEK spawn ile çalışır (mock kütüphanesi yok, repo
 * stiliyle tutarlı): sahte `docker`/`open` ikilileri PATH'e eklenir, sahte
 * pardus-packager-build.sh CONFIG.pardusBuildScript'e yazılır — böylece gerçek
 * child_process davranışı (timeout/kill, stdout/stderr, exit code) test edilir.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const SRC = fs.readFileSync(path.join(__dirname, 'runner.js'), 'utf8');
const {
  CONFIG,
  ensureDockerReady,
  buildPardusArtifact,
} = require('./runner.js');
const { mapPlatform, artifactExtension } = require('./runner-helpers');

// ---------------------------------------------------------------------------
// Kaynak-sentinel: processJob pardus'ta HTTP packager'ı hiç çağırmaz.
// ---------------------------------------------------------------------------

test('processJob: pardus dalı buildPardusArtifact çağırır, HTTP packager adımlarını ATLAR', () => {
  const fn = SRC.slice(SRC.indexOf('async function processJob'), SRC.indexOf('// ---------------------------------------------------------------------------\n// Main loops'));
  const ifBlock = fn.slice(fn.indexOf("packagerPlatform === 'pardus'"), fn.indexOf('} else {'));
  assert.match(ifBlock, /buildPardusArtifact\(/);
  assert.doesNotMatch(ifBlock, /packagerUploadBuild\(/);
  assert.doesNotMatch(ifBlock, /packagerStartPackage\(/);
  assert.doesNotMatch(ifBlock, /packagerPoll\(/);
  assert.doesNotMatch(ifBlock, /packagerDownload\(/);
  // jobId pardus dalında null kalır (packagerReleaseJob(null) zaten no-op — ayrı test var)
  assert.match(fn, /let jobId = null;/);
});

test('processJob: pardus da macOS imzalama/noterleme dalına GİRMEZ (yalnız macos)', () => {
  const fn = SRC.slice(SRC.indexOf('async function processJob'), SRC.indexOf('// ---------------------------------------------------------------------------\n// Main loops'));
  assert.match(fn, /if \(packagerPlatform === 'macos'\) \{\s*\n\s*await signAndNotarizeMac/);
});

test('heartbeat: capabilities alanı gönderilir (build_agents.capabilities güncel kalsın, 2026-09-10)', () => {
  const fn = SRC.slice(SRC.indexOf('async function heartbeat'), SRC.indexOf('/** Ask the server for a presigned'));
  assert.match(fn, /capabilities:\s*guncelYetenekler\(\)/);
});

test('CONFIG.caps varsayılanı pardus içerir', () => {
  assert.match(SRC, /process\.env\.AGENT_CAPS \|\| 'android,macos,pardus'/);
});

test('CONFIG.pardusBuildScript varsayılanı repo-içi tools/pardus yoluna türetilir (2026-09-10 tasima — Nadir\'in kisisel /Users/nadir/01dev/pardus yolu HARDCODE degil)', () => {
  assert.match(SRC, /path\.join\(__dirname, '\.\.', '\.\.', 'tools', 'pardus', 'pardus-packager-build\.sh'\)/);
  assert.doesNotMatch(SRC, /'\/Users\/nadir\/01dev\/pardus\/tools\/pardus-packager-build\.sh'/);
  if (!process.env.PARDUS_BUILD_SCRIPT) {
    assert.equal(CONFIG.pardusBuildScript, path.join(__dirname, '..', '..', 'tools', 'pardus', 'pardus-packager-build.sh'));
    assert.equal(fs.existsSync(CONFIG.pardusBuildScript), true, 'tasinan betik gercekten bu yolda olmali');
  }
});

// ---------------------------------------------------------------------------
// mapPlatform / artifactExtension — helpers.test.js'te de var, burada uçtan uca
// tutarlılık: runner.js'in kullandığı artifactExtension(mapPlatform('pardus')).
// ---------------------------------------------------------------------------

test('mapPlatform + artifactExtension zinciri: pardus -> pardus -> .impark', () => {
  const platform = mapPlatform('pardus');
  assert.equal(platform, 'pardus');
  assert.equal(artifactExtension(platform), '.impark');
});

// ---------------------------------------------------------------------------
// ensureDockerReady — GERÇEK spawn, sahte `docker`/`open` PATH'te.
// ---------------------------------------------------------------------------

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

test('ensureDockerReady: docker zaten hazırsa open ÇAĞRILMAZ, hemen döner', async () => {
  const openCalls = path.join(os.tmpdir(), `open-calls-${process.pid}-${Date.now()}.log`);
  await withFakeBin({
    docker: '#!/bin/bash\nexit 0\n',
    open: `#!/bin/bash\necho "$@" >> ${openCalls}\nexit 0\n`,
  }, async () => {
    await ensureDockerReady(); // fırlamamalı
  });
  assert.equal(fs.existsSync(openCalls), false, 'docker hazırken open çağrılmamalı');
});

test('ensureDockerReady: docker kapalı -> open ile açar, hazır olunca döner', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'docker-state-'));
  const readyFlag = path.join(dir, 'ready');
  const openCalls = path.join(dir, 'open-calls.log');
  const prevTimeout = CONFIG.dockerReadyTimeoutMs;
  const prevPoll = CONFIG.dockerReadyPollMs;
  CONFIG.dockerReadyTimeoutMs = 2000;
  CONFIG.dockerReadyPollMs = 80;
  try {
    await withFakeBin({
      // İlk 2 yoklamada "hazır değil", open çağrıldıktan sonraki 3. yoklamada hazır.
      docker: `#!/bin/bash\n[ -f ${readyFlag} ] && exit 0 || exit 1\n`,
      open: `#!/bin/bash\necho "$@" >> ${openCalls}\n(sleep 0.15; touch ${readyFlag}) &\nexit 0\n`,
    }, async () => {
      await ensureDockerReady(); // fırlamamalı: 80ms aralıkla yoklar, ~150ms sonra hazır olur
    });
    assert.equal(fs.existsSync(openCalls), true, 'docker kapalıyken open çağrılmalı');
    const args = fs.readFileSync(openCalls, 'utf8');
    assert.match(args, /-g/);
    assert.match(args, /-j/);
    assert.match(args, /-a/);
    assert.match(args, /Docker/);
  } finally {
    CONFIG.dockerReadyTimeoutMs = prevTimeout;
    CONFIG.dockerReadyPollMs = prevPoll;
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('ensureDockerReady: hiç hazır olmuyorsa timeout içinde net hatayla FIRLAR', async () => {
  const prevTimeout = CONFIG.dockerReadyTimeoutMs;
  const prevPoll = CONFIG.dockerReadyPollMs;
  CONFIG.dockerReadyTimeoutMs = 200;
  CONFIG.dockerReadyPollMs = 60;
  try {
    await withFakeBin({
      docker: '#!/bin/bash\nexit 1\n',
      open: '#!/bin/bash\nexit 0\n',
    }, async () => {
      await assert.rejects(() => ensureDockerReady(), /docker/i);
    });
  } finally {
    CONFIG.dockerReadyTimeoutMs = prevTimeout;
    CONFIG.dockerReadyPollMs = prevPoll;
  }
});

// MUTASYON KANITI (ensureDockerReady): timeout kontrolü kaldırılırsa test SONSUZA
// kadar asılı kalır değil ama "hiç hazır olmuyor" testi hiç fırlamaz (Promise hiç
// resolve/reject etmeden dursa test-runner'ın kendi timeout'una çarpar). Burada
// pozitif mutasyon kanıtı: dockerReadyTimeoutMs'i normalden BÜYÜK verip aynı sahte
// "hiç hazır olmayan" docker ile testin süresinin gerçekten timeout'a bağlı
// olduğunu ölç (küçük timeout -> hızlı fail; büyük timeout verilse test bu kez
// yaşanmaz çünkü ayrı bir it — burada sadece küçük olanın gerçekten süre sınırına
// göre döndüğünü zaman ölçerek kanıtlıyoruz).
test('ensureDockerReady: MUTASYON KANITI — hata gerçekten timeout süresine bağlı (kısa timeout hızlı fail eder)', async () => {
  const prevTimeout = CONFIG.dockerReadyTimeoutMs;
  const prevPoll = CONFIG.dockerReadyPollMs;
  CONFIG.dockerReadyTimeoutMs = 150;
  CONFIG.dockerReadyPollMs = 50;
  try {
    await withFakeBin({
      docker: '#!/bin/bash\nexit 1\n',
      open: '#!/bin/bash\nexit 0\n',
    }, async () => {
      const t0 = Date.now();
      await assert.rejects(() => ensureDockerReady());
      const elapsed = Date.now() - t0;
      // En az bir poll aralığı geçmiş olmalı (yani hemen değil, bekleyerek fail etti)
      assert.ok(elapsed >= 40, `çok hızlı fail etti (${elapsed}ms) — timeout/poll mantığı çalışmıyor olabilir`);
      // Timeout'un çok üstünde de olmamalı (asılı kalma yok)
      assert.ok(elapsed < 2000, `çok yavaş (${elapsed}ms) — timeout sınırı işlemiyor`);
    });
  } finally {
    CONFIG.dockerReadyTimeoutMs = prevTimeout;
    CONFIG.dockerReadyPollMs = prevPoll;
  }
});

// ---------------------------------------------------------------------------
// buildPardusArtifact — GERÇEK spawn, sahte pardus-packager-build.sh.
// ---------------------------------------------------------------------------

const OFFSET = 193728;

/** offset 193728'de 'hsqs' imzalı, verilen bytes_used'lı sahte squashfs blob'u. */
function fakeSquashfsBuffer(totalSize, claimedBytesUsed) {
  const buf = Buffer.alloc(Math.max(totalSize, OFFSET + 96));
  buf.write('hsqs', OFFSET, 'ascii');
  buf.writeBigUInt64LE(BigInt(claimedBytesUsed), OFFSET + 40);
  return buf.subarray(0, totalSize);
}

async function withFakePardusScript(scriptBody, fn) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'pardus-script-'));
  const scriptPath = path.join(dir, 'pardus-packager-build.sh');
  await fsp.writeFile(scriptPath, scriptBody, { mode: 0o755 });
  const prevScript = CONFIG.pardusBuildScript;
  const prevDockerTimeout = CONFIG.dockerReadyTimeoutMs;
  CONFIG.pardusBuildScript = scriptPath;
  try {
    // docker zaten "hazır" (fake docker info exit 0) — ensureDockerReady'yi hızlı geçir.
    return await withFakeBin({ docker: '#!/bin/bash\nexit 0\n' }, () => fn(dir));
  } finally {
    CONFIG.pardusBuildScript = prevScript;
    CONFIG.dockerReadyTimeoutMs = prevDockerTimeout;
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

test('buildPardusArtifact: TAM (bütün) paket üretilirse artifactPath\'e kopyalanır', async () => {
  await withFakePardusScript(
    // $1=zip $2=appName $3=outDir $4=version
    `#!/bin/bash
set -e
mkdir -p "$3/dogrula"
node -e "
const fs=require('fs');
const OFFSET=193728;
const buf=Buffer.alloc(OFFSET+96+1000);
buf.write('hsqs', OFFSET, 'ascii');
buf.writeBigUInt64LE(BigInt(500), OFFSET+40); // bytes_used küçük -> beklenen=offset+500, dosya bundan büyük -> TAM
fs.writeFileSync(process.argv[1], buf);
" "$3/$2.impark"
printf 'file: %s\\nAppRun: sürüm-farkındalıklı yeniden kurulum bloğu OK\\nasar has: package.json OK\\n' "$2" > "$3/dogrula/rapor.txt"
exit 0
`,
    async (dir) => {
      const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'pardus-work-'));
      try {
        const artifactPath = path.join(work, 'artifact.impark');
        await buildPardusArtifact('/tmp/fake-build.zip', 'test-app', '1.0.0', artifactPath, work);
        assert.equal(fs.existsSync(artifactPath), true);
        assert.ok(fs.statSync(artifactPath).size > 0);
      } finally {
        await fsp.rm(work, { recursive: true, force: true });
      }
    },
  );
});

test('buildPardusArtifact: KESİK (bütünlük başarısız) paket YÜKLENMEZ — fırlar', async () => {
  await withFakePardusScript(
    `#!/bin/bash
set -e
mkdir -p "$3"
node -e "
const fs=require('fs');
const OFFSET=193728;
const buf=Buffer.alloc(OFFSET+96);
buf.write('hsqs', OFFSET, 'ascii');
buf.writeBigUInt64LE(BigInt(OFFSET+999999999), OFFSET+40);
fs.writeFileSync(process.argv[1], buf);
" "$3/$2.impark"
exit 0
`,
    async (dir) => {
      const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'pardus-work-'));
      try {
        const artifactPath = path.join(work, 'artifact.impark');
        await assert.rejects(
          () => buildPardusArtifact('/tmp/fake-build.zip', 'test-app', '1.0.0', artifactPath, work),
          /bütünlük/i,
        );
        assert.equal(fs.existsSync(artifactPath), false, 'kesik paket artifactPath\'e kopyalanmamalı');
      } finally {
        await fsp.rm(work, { recursive: true, force: true });
      }
    },
  );
});

// MUTASYON KANITI: yukarıdaki "KESİK" testinin gerçekten bütünlük denetimine bağlı
// olduğunu göstermek için AYNI kesik dosyayı TAM'a çeviren tek satır değişiklikle
// (bytes_used'ı gerçek boyuta indir) test'in artık PASS olduğunu doğruluyoruz.
test('buildPardusArtifact: MUTASYON KANITI — bytes_used gerçek boyuta indirilince KESİK->TAM olur, artık geçer', async () => {
  await withFakePardusScript(
    `#!/bin/bash
set -e
mkdir -p "$3"
node -e "
const fs=require('fs');
const OFFSET=193728;
const buf=Buffer.alloc(OFFSET+96);
buf.write('hsqs', OFFSET, 'ascii');
buf.writeBigUInt64LE(BigInt(96), OFFSET+40); // beklenen=offset+96==dosya boyutu (>=) -> TAM
fs.writeFileSync(process.argv[1], buf);
" "$3/$2.impark"
exit 0
`,
    async (dir) => {
      const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'pardus-work-'));
      try {
        const artifactPath = path.join(work, 'artifact.impark');
        await buildPardusArtifact('/tmp/fake-build.zip', 'test-app', '1.0.0', artifactPath, work);
        assert.equal(fs.existsSync(artifactPath), true, 'bytes_used düzeltilince (TAM) artık geçmeli');
      } finally {
        await fsp.rm(work, { recursive: true, force: true });
      }
    },
  );
});

test('buildPardusArtifact: script rc!=0 -> stderr içeren hata ile fırlar', async () => {
  await withFakePardusScript(
    `#!/bin/bash
echo "sahte hata: disk kapisi: 5 GB bos < 20 GB" >&2
exit 1
`,
    async (dir) => {
      const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'pardus-work-'));
      try {
        const artifactPath = path.join(work, 'artifact.impark');
        await assert.rejects(
          () => buildPardusArtifact('/tmp/fake-build.zip', 'test-app', '1.0.0', artifactPath, work),
          /disk kapisi/,
        );
      } finally {
        await fsp.rm(work, { recursive: true, force: true });
      }
    },
  );
});

test('buildPardusArtifact: rc=0 ama .impark üretilmediyse net hata ile fırlar', async () => {
  await withFakePardusScript(
    `#!/bin/bash
mkdir -p "$3"
exit 0
`,
    async (dir) => {
      const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'pardus-work-'));
      try {
        const artifactPath = path.join(work, 'artifact.impark');
        await assert.rejects(
          () => buildPardusArtifact('/tmp/fake-build.zip', 'test-app', '1.0.0', artifactPath, work),
          /impark üretilmedi/,
        );
      } finally {
        await fsp.rm(work, { recursive: true, force: true });
      }
    },
  );
});

test('buildPardusArtifact: timeout aşılırsa süreç öldürülür ve timeout hatası fırlar', async () => {
  const prevTimeout = CONFIG.pardusTimeoutMs;
  CONFIG.pardusTimeoutMs = 150;
  try {
    await withFakePardusScript(
      `#!/bin/bash
mkdir -p "$3"
sleep 30
`,
      async (dir) => {
        const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'pardus-work-'));
        try {
          const artifactPath = path.join(work, 'artifact.impark');
          const t0 = Date.now();
          await assert.rejects(
            () => buildPardusArtifact('/tmp/fake-build.zip', 'test-app', '1.0.0', artifactPath, work),
            /timeout|bitmedi/i,
          );
          const elapsed = Date.now() - t0;
          assert.ok(elapsed < 5000, `timeout mekanizması çalışmadı, çok uzun sürdü (${elapsed}ms)`);
        } finally {
          await fsp.rm(work, { recursive: true, force: true });
        }
      },
    );
  } finally {
    CONFIG.pardusTimeoutMs = prevTimeout;
  }
});

test('bütünlük denetimi sahte TAM/KESİK dosyaları doğru sınıflar', async () => {
  const { denetle } = require('./impark-butunluk');
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'butunluk-'));
  try {
    const tam = path.join(dir, 'tam.impark');
    const kesik = path.join(dir, 'kesik.impark');
    await fsp.writeFile(tam, fakeSquashfsBuffer(OFFSET + 96 + 1000, 500));
    await fsp.writeFile(kesik, fakeSquashfsBuffer(OFFSET + 96, 999999));

    assert.equal(denetle(tam).durum, 'TAM');
    assert.equal(denetle(kesik).durum, 'KESIK');
    assert.equal(denetle(kesik).beklenen, OFFSET + 999999);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

// GERİLEME: 2026-09-16 — bu kapı `/usr/bin/python3` ile koşuyordu. Xcode lisansı
// sıfırlanınca shim rc=69 verdi (Python hiç çalışmadı, stdout boş) ve KUSURSUZ bir
// paket "bütünlük denetiminden geçemedi" diye düştü (45480). Üretim kapısı dış
// yorumlayıcıya bağlanamaz: ne interpreter yolu, ne lisans, ne TCC izni.
test('GERİLEME: bütünlük kapısı dış yorumlayıcı ÇAĞIRMAZ (python/xcrun bağımlılığı yok)', async () => {
  const kaynak = await fsp.readFile(path.join(__dirname, 'runner.js'), 'utf8');
  // Açıklama satırları ELENİR: yorumda eski (python'lu) biçim anlatıldığı için ham
  // metni taramak testi kendi belgesine takar (`kaynak-tarayan-test-tuzagi`).
  const govde = kaynak.split('\n').filter((s) => !s.trim().startsWith('//') && !s.trim().startsWith('*')).join('\n');
  const bas = govde.indexOf('const integrity');
  assert.notEqual(bas, -1, 'bütünlük kapısı bulunamadı');
  const kapi = govde.slice(bas, bas + 600);
  assert.doesNotMatch(kapi, /python/i, 'bütünlük kapısında python çağrısı olmamalı');
  assert.doesNotMatch(kapi, /xcrun|execFile|spawn/i, 'bütünlük kapısı alt süreç açmamalı');
  assert.match(kapi, /imparkDenetle\(/);
});

// Bozuk/kesik paketin ASLA yüklenmemesi mutasyon kapanı: denetim 'TAM' dışında bir
// şey dönerse akış hata fırlatmalı. `durum !== 'TAM'` yerine `durum === 'KESIK'`
// yazılırsa BOZUK paket sessizce geçerdi.
test('GERİLEME: yalnız TAM durumu geçer (BOZUK da düşer)', async () => {
  const { denetle } = require('./impark-butunluk');
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'butunluk-bozuk-'));
  try {
    const bozuk = path.join(dir, 'bozuk.impark');
    await fsp.writeFile(bozuk, Buffer.alloc(OFFSET + 4096, 0x41));
    assert.equal(denetle(bozuk).durum, 'BOZUK');
    const kaynak = await fsp.readFile(path.join(__dirname, 'runner.js'), 'utf8');
    assert.match(kaynak, /integrity\.durum !== 'TAM'/);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

// --- mac araç zinciri probu (runner tarafı) ----------------------------------
// Saf fonksiyon testi `runner-helpers.test.js`'te; burada RUNNER'ın probu gerçekten
// kurup yetenek kapısına bağladığı çivilenir. Kaynak metni taranıyor çünkü prob
// `xcrun`'ı gerçekten çağırır ve testte Xcode durumuna bağımlı olmak istemiyoruz.
test('GERİLEME: runner mac yeteneğini araç zinciri probuna bağlar', async () => {
  const kaynak = await fsp.readFile(path.join(__dirname, 'runner.js'), 'utf8');
  const govde = kaynak.split('\n').filter((s) => !s.trim().startsWith('//') && !s.trim().startsWith('*')).join('\n');

  // Prob var ve xcrun+notarytool'u sınıyor.
  assert.match(govde, /function macAraciSaglamMi\(\)/);
  assert.match(govde, /'xcrun',\s*\['--find',\s*'notarytool'\]/);

  // Yetenek kapısına BAĞLI — prob var ama guncelYetenekler'e geçilmezse arıza sürer.
  const bas = govde.indexOf('function guncelYetenekler');
  assert.notEqual(bas, -1);
  assert.match(govde.slice(bas, bas + 700), /macAraci:\s*CONFIG\.caps\.some/);

  // Hata/zaman aşımı BOZUK sayılmalı: saglam yalnız try'ın sonunda true olur.
  const pb = govde.indexOf('function macAraciSaglamMi');
  const prob = govde.slice(pb, pb + 900);
  assert.match(prob, /let saglam = false;/);
  assert.match(prob, /timeout: \d+/);
  assert.doesNotMatch(prob, /catch \([^)]*\) \{\s*saglam = true/);
});

// ---------------------------------------------------------------------------
// ProBook KABUL KAPISI (2026-09-17, Nadir: "her yaptığını pardus'ta aç,
// doğrulayıp öyle yükle"). Kapı buildPardusArtifact'ın SONUNDA koşar; geçmezse
// fırlar → processJob yükleme/postResultSuccess adımına HİÇ ulaşmaz.
//
// Sahte kabul betiği ile GERÇEK spawn: rc, stdout aktarımı ve gerçek timeout
// (spawn seçeneği `timeout` — `timeoutMs` sessizce yok sayılırdı) ölçülür.
// ---------------------------------------------------------------------------

const TAM_IMPARK_BETIK = `#!/bin/bash
set -e
mkdir -p "$3"
node -e "
const fs=require('fs');
const OFFSET=193728;
const buf=Buffer.alloc(OFFSET+96+1000);
buf.write('hsqs', OFFSET, 'ascii');
buf.writeBigUInt64LE(BigInt(500), OFFSET+40);
fs.writeFileSync(process.argv[1], buf);
" "$3/$2.impark"
exit 0
`;

/** Sahte ProBook kabul betiğini kurar, kapıyı açar, sonra eski hâline döndürür. */
async function withFakeKabul(scriptBody, fn, { acik = true } = {}) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'kabul-'));
  const scriptPath = path.join(dir, 'probook-kabul.sh');
  await fsp.writeFile(scriptPath, scriptBody, { mode: 0o755 });
  const prevAcik = CONFIG.pardusKabul;
  const prevScript = CONFIG.pardusKabulScript;
  CONFIG.pardusKabul = acik;
  CONFIG.pardusKabulScript = scriptPath;
  try {
    return await fn(dir);
  } finally {
    CONFIG.pardusKabul = prevAcik;
    CONFIG.pardusKabulScript = prevScript;
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

test('kabul kapısı: KAPALI iken betik hiç çağrılmaz (varsayılan davranış korunur)', async () => {
  await withFakePardusScript(TAM_IMPARK_BETIK, async () => {
    await withFakeKabul(`#!/bin/bash\ntouch "$(dirname "$0")/CAGRILDI"\nexit 0\n`, async (kdir) => {
      const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'pardus-work-'));
      try {
        const artifactPath = path.join(work, 'artifact.impark');
        await buildPardusArtifact('/tmp/fake.zip', 'test-app', '1.0.0', artifactPath, work);
        assert.equal(fs.existsSync(artifactPath), true);
        assert.equal(fs.existsSync(path.join(kdir, 'CAGRILDI')), false, 'kapı kapalıyken betik çağrılmamalı');
      } finally {
        await fsp.rm(work, { recursive: true, force: true });
      }
    }, { acik: false });
  });
});

test('kabul kapısı: AÇIK + kabul (rc=0) — paket artifactPath\'te kalır, betiğe impark yolu geçilir', async () => {
  await withFakePardusScript(TAM_IMPARK_BETIK, async () => {
    await withFakeKabul(`#!/bin/bash\necho "KABUL: $1" > "$(dirname "$0")/CAGRILDI"\nmkdir -p "$2"\nexit 0\n`, async (kdir) => {
      const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'pardus-work-'));
      try {
        const artifactPath = path.join(work, 'artifact.impark');
        await buildPardusArtifact('/tmp/fake.zip', 'test-app', '1.0.0', artifactPath, work);
        assert.equal(fs.existsSync(artifactPath), true);
        const kanit = await fsp.readFile(path.join(kdir, 'CAGRILDI'), 'utf8');
        assert.match(kanit, /KABUL: .*artifact\.impark/, 'kapıya üretilen .impark yolu geçmeli');
      } finally {
        await fsp.rm(work, { recursive: true, force: true });
      }
    });
  });
});

test('kabul kapısı: RED (rc!=0) — fırlar, paket YÜKLENMEZ (beyaz ekran sınıfı burada durur)', async () => {
  await withFakePardusScript(TAM_IMPARK_BETIK, async () => {
    await withFakeKabul(`#!/bin/bash\necho "[kabul] RED: uygulama acilmadi (surec yok)"\nexit 1\n`, async () => {
      const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'pardus-work-'));
      try {
        const artifactPath = path.join(work, 'artifact.impark');
        await assert.rejects(
          () => buildPardusArtifact('/tmp/fake.zip', 'test-app', '1.0.0', artifactPath, work),
          /kabul kapısından geçemedi.*uygulama acilmadi/s,
        );
      } finally {
        await fsp.rm(work, { recursive: true, force: true });
      }
    });
  });
});

test('kabul kapısı: GERÇEK timeout — asılı kalan betik SIGKILL edilir (spawn seçeneği `timeout`)', async () => {
  await withFakePardusScript(TAM_IMPARK_BETIK, async () => {
    await withFakeKabul(`#!/bin/bash\nsleep 30\nexit 0\n`, async () => {
      const prev = CONFIG.pardusKabulTimeoutMs;
      CONFIG.pardusKabulTimeoutMs = 400;
      const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'pardus-work-'));
      try {
        const artifactPath = path.join(work, 'artifact.impark');
        const t0 = Date.now();
        await assert.rejects(
          () => buildPardusArtifact('/tmp/fake.zip', 'test-app', '1.0.0', artifactPath, work),
          /kabul kapısından geçemedi/,
        );
        const gecen = Date.now() - t0;
        assert.ok(gecen < 10000, `kapı asılı kaldı (${gecen}ms) — timeout uygulanmıyor (timeoutMs yazılmış olabilir)`);
      } finally {
        CONFIG.pardusKabulTimeoutMs = prev;
        await fsp.rm(work, { recursive: true, force: true });
      }
    });
  });
});

test('GERİLEME: kapı spawn\'ın gerçek `timeout` seçeneğini kullanır, `timeoutMs` DEĞİL', () => {
  const bas = SRC.indexOf('async function pardusKabulKapisi');
  assert.notEqual(bas, -1, 'kabul kapısı fonksiyonu runner.js\'te olmalı');
  const blok = SRC.slice(bas, bas + 1400);
  assert.match(blok, /runKabulBetigi\(/);
  assert.doesNotMatch(blok, /timeoutMs: CONFIG\.pardusKabulTimeoutMs/, 'spawn `timeoutMs` diye bir seçenek bilmez — sessizce yok sayılır');
  assert.match(blok, /throw new Error\(`pardus paketi ProBook kabul kapısından geçemedi/);
  // Yardımcı süreç GRUBUNU öldürmeli: ssh/scp çocukları boruyu açık tutar, `close` gelmez.
  const yardimci = SRC.slice(SRC.indexOf('function runKabulBetigi'), SRC.indexOf('function runKabulBetigi') + 1400);
  assert.match(yardimci, /detached: true/);
  assert.match(yardimci, /process\.kill\(-p\.pid, 'SIGKILL'\)/);
  assert.match(yardimci, /p\.on\('exit'/);
});

test('GERİLEME: kapı HER İKİ yolda da (derleme + hazır paket) artifact kopyalandıktan SONRA koşar', () => {
  const fn = SRC.slice(SRC.indexOf('async function buildPardusArtifact'), SRC.indexOf('async function pardusKabulKapisi'));
  // Hazır (srv21) yolu: kopyala → kapı → return
  const hazirBas = fn.indexOf('const hazir = await hazirPardusPaketi');
  const hazirKopya = fn.indexOf('await fsp.copyFile(hazir.dosya, artifactPath)');
  const hazirKapi = fn.indexOf('await pardusKabulKapisi(artifactPath, outDir', hazirBas);
  assert.ok(hazirBas !== -1 && hazirKopya !== -1 && hazirKapi > hazirKopya, 'hazır yolda kapı kopyalamadan sonra olmalı');
  // Derleme yolu: kopyala → kapı
  const kopya = fn.indexOf('await fsp.copyFile(builtPath, artifactPath)');
  const kapi = fn.indexOf('await pardusKabulKapisi(artifactPath, outDir', kopya);
  assert.ok(kopya !== -1 && kapi > kopya, 'derleme yolunda kapı kopyalamadan sonra olmalı');
  // processJob: yükleme/sonuç kapıdan sonra gelir → kapı fırlarsa yükleme olmaz.
  const pj = SRC.slice(SRC.indexOf('async function processJob'));
  assert.ok(pj.indexOf('buildPardusArtifact(') < pj.indexOf('postResultSuccess('), 'yükleme/sonuç kapıdan sonra olmalı');
});

// ---------------------------------------------------------------------------
// HAZIR PAKET ŞERİDİ (srv21) — derleme başka makinede, kapı + yükleme burada.
// ---------------------------------------------------------------------------

test('hazirPardusPaketi: dizin tanımsızsa null (varsayılan davranış değişmez)', async () => {
  const { hazirPardusPaketi } = require('./runner.js');
  const prev = CONFIG.pardusHazirDir;
  CONFIG.pardusHazirDir = '';
  try {
    assert.equal(await hazirPardusPaketi({ bookId: '45704', srcVersion: 'X-v1.exe' }), null);
  } finally { CONFIG.pardusHazirDir = prev; }
});

test('hazirPardusPaketi: kaynak sürümü AYNI ise devralınır, FARKLI ise yok sayılır', async () => {
  const { hazirPardusPaketi } = require('./runner.js');
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'hazir-'));
  const prev = CONFIG.pardusHazirDir;
  CONFIG.pardusHazirDir = dir;
  try {
    await fsp.writeFile(path.join(dir, '45704.impark'), Buffer.alloc(200000, 1));
    await fsp.writeFile(path.join(dir, '45704.json'), JSON.stringify({ srcVersion: 'MP8-v49.exe' }));
    const bulundu = await hazirPardusPaketi({ bookId: '45704', srcVersion: 'MP8-v49.exe' });
    assert.ok(bulundu && bulundu.dosya.endsWith('45704.impark'));
    assert.equal(await hazirPardusPaketi({ bookId: '45704', srcVersion: 'MP8-v50.exe' }), null,
      'kaynak sürümü tutmayan hazır paket YÜKLENMEMELİ (sessiz sürüm karışması)');
    // .json yoksa güvenli taraf: devralma yok
    await fsp.rm(path.join(dir, '45704.json'));
    assert.equal(await hazirPardusPaketi({ bookId: '45704', srcVersion: 'MP8-v49.exe' }), null);
  } finally {
    CONFIG.pardusHazirDir = prev;
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('buildPardusArtifact: HAZIR paket varsa Docker derlemesi HİÇ çağrılmaz, kapı yine koşar', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'hazir-'));
  const prevDir = CONFIG.pardusHazirDir;
  CONFIG.pardusHazirDir = dir;
  // TAM squashfs imzalı sahte paket (offset 193728, bytes_used küçük)
  const OFF = 193728;
  const buf = Buffer.alloc(OFF + 96 + 1000);
  buf.write('hsqs', OFF, 'ascii');
  buf.writeBigUInt64LE(BigInt(500), OFF + 40);
  await fsp.writeFile(path.join(dir, '45704.impark'), buf);
  await fsp.writeFile(path.join(dir, '45704.json'), JSON.stringify({ srcVersion: 'MP8-v49.exe' }));
  try {
    await withFakePardusScript(`#!/bin/bash\ntouch "$(dirname "$0")/DERLENDI"\nexit 1\n`, async (sdir) => {
      await withFakeKabul(`#!/bin/bash\necho "KABUL: $1" > "$(dirname "$0")/CAGRILDI"\nexit 0\n`, async (kdir) => {
        const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'pardus-work-'));
        try {
          const artifactPath = path.join(work, 'artifact.impark');
          await buildPardusArtifact('/tmp/yok.zip', 'test-app', '1.0.0', artifactPath, work,
            { bookId: '45704', srcVersion: 'MP8-v49.exe' });
          assert.equal(fs.existsSync(artifactPath), true, 'hazır paket artifactPath\'e kopyalanmalı');
          assert.equal(fs.existsSync(path.join(sdir, 'DERLENDI')), false, 'Docker derleme betiği çağrılmamalı');
          assert.match(await fsp.readFile(path.join(kdir, 'CAGRILDI'), 'utf8'), /KABUL: .*artifact\.impark/);
          assert.equal(fs.existsSync(path.join(dir, '45704.impark')), false, 'devralınan dosya diskte bırakılmamalı');
        } finally { await fsp.rm(work, { recursive: true, force: true }); }
      });
    });
  } finally {
    CONFIG.pardusHazirDir = prevDir;
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

// ŞERİT: scp port bayrağı (ölçüm 2026-09-17, 45695 devri) — SSH dizisi ('-p 2222')
// scp'ye verilince scp portu 22 sanar, indirme sessizce düşer ("No such file").
test('serit-uret.js scp çağrısında BÜYÜK -P kullanır, SSH dizisini vermez', () => {
  const kaynak = require('fs').readFileSync(
    require('path').join(__dirname, '..', '..', 'tools', 'agent', 'serit-uret.js'), 'utf8');
  const scpSatiri = kaynak.split('\n').find((s) => s.includes("spawnSync('scp'"));
  assert.ok(scpSatiri, 'scp çağrısı bulunamadı');
  assert.match(scpSatiri, /\.\.\.SCP/);
  assert.doesNotMatch(scpSatiri, /\.\.\.SSH/);
  assert.match(kaynak, /const SCP = \[[^\]]*'-P', '2222'\]/);
});

// ProBook disk kapısı (2026-09-17): yer yoksa kurulum yarım kalıyor ve kapı
// "pencere açılmadı" diye YANILTICI red üretiyordu. Ölçüm önce, sebep net olsun.
// Yorumlar SİLİNEREK ölçülür (yorum metni testi geçiremez).
test('probook-kabul.sh kopyalamadan ÖNCE ProBook diskini ölçer', () => {
  const kaynak = require('fs').readFileSync(
    require('path').join(__dirname, '..', '..', 'tools', 'pardus', 'probook-kabul.sh'), 'utf8')
    .split('\n').filter((s) => !s.trim().startsWith('#')).join('\n');
  assert.match(kaynak, /GEREKLI_MB=/);
  assert.match(kaynak, /df -Pk/);
  assert.match(kaynak, /RED: ProBook diskinde yer yok/);
  const diskIdx = kaynak.indexOf('BOS_MB=');
  const scpIdx = kaynak.indexOf('scp -q -o ConnectTimeout=10');
  assert.ok(diskIdx > 0 && scpIdx > diskIdx, 'disk ölçümü scp çağrısından ÖNCE olmalı');
});

// HAZIR paket kısa devresi (2026-09-17): kontrol İNDİRMEDEN ÖNCE yapılmalı; yoksa
// devralınan her kitapta ~1,5 GB kaynak boşuna iniyor (dar diskte üretim durur).
test('processJob: hazır paket kontrolü kaynak indirmeden ÖNCE ve indirme blokunu kapatır', () => {
  const kaynak = require('fs').readFileSync(require('path').join(__dirname, 'runner.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const hazirIdx = kaynak.indexOf('const hazirDevir = packagerPlatform === \'pardus\'');
  const indirIdx = kaynak.indexOf('let cacheHit = false;');
  const dalIdx = kaynak.indexOf('if (!hazirDevir) await injectPardusIcon(');
  assert.ok(hazirIdx > 0, 'hazirDevir kısa devresi yok');
  assert.ok(indirIdx > hazirIdx, 'hazır kontrolü indirme/cache blokundan ÖNCE olmalı');
  assert.match(kaynak.slice(indirIdx, indirIdx + 120), /if \(!hazirDevir\) \{/);
  assert.ok(dalIdx > 0, 'ikon enjeksiyonu hazır pakette atlanmalı');
});

// Açılış süresi paket boyutuyla ölçeklenmeli (ölçüm 2026-09-17, 45695): 1,5 GB SET
// paketi ProBook'ta 420 sn'de kurulamadı, süreç öldürülüp YANLIŞ red verildi.
test('probook-kabul.sh açılış üst sınırını paket boyutuna göre büyütür', () => {
  const kaynak = require('fs').readFileSync(
    require('path').join(__dirname, '..', '..', 'tools', 'pardus', 'probook-kabul.sh'), 'utf8')
    .split('\n').filter((s) => !s.trim().startsWith('#')).join('\n');
  assert.match(kaynak, /OLCEKLI=\$\(\( 300 \+ BOYUT_MB \/ 2 \)\)/);
  assert.match(kaynak, /if \[ "\$OLCEKLI" -gt "\$BEKLE" \]/);
  assert.match(kaynak, /BEKLE="\$OLCEKLI"/);
});

// Hazır kaynak SİLME sırası (2026-09-17, 45695 kaybı): kapı GEÇMEDEN silinirse,
// srv21'deki iş dizini de temizlenmiş olduğu için paket tamamen kaybolur.
test('hazır paket kaynağı ANCAK kabul kapısından sonra silinir', () => {
  const kaynak = require('fs').readFileSync(require('path').join(__dirname, 'runner.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const kapiIdx = kaynak.indexOf('await pardusKabulKapisi(artifactPath, outDir');
  const silIdx = kaynak.indexOf('await fsp.rm(hazir.dosya');
  assert.ok(kapiIdx > 0 && silIdx > 0, 'kapı/silme satırları bulunamadı');
  assert.ok(silIdx > kapiIdx, 'silme kapıdan SONRA olmalı');
});

// ---------------------------------------------------------------------------
// ERKEN DİSK KAPISI (2026-09-18) — hazır paket yokken, kaynak İNDİRİLMEDEN önce
// disk sorulur. Gece 11 iş 1,5 GB'lık kaynağı indirip kapıda düştü; kapı indirme
// çağrısının ÜSTÜNDE durmalı. Bu test kaynağı okur: sıralama bozulursa kırılır.
// ---------------------------------------------------------------------------
test('GERİLEME: pardus disk kapısı kaynak indirmeden ÖNCE sorulur', () => {
  const kaynak = fs.readFileSync(path.join(__dirname, 'runner.js'), 'utf8');
  const kapi = kaynak.indexOf('pardus disk kapısı —');
  const indirme = kaynak.indexOf('source cache MISS');
  assert.ok(kapi > 0, 'erken disk kapısı metni yok');
  assert.ok(indirme > 0, 'indirme günlüğü bulunamadı');
  assert.ok(kapi < indirme, 'disk kapısı indirmeden SONRA geliyor');
});

// ---------------------------------------------------------------------------
// BOYUT ORANTILI KAPI (2026-09-19) — Nadir: "3 GB boş varken 1,5 GB'lık dosya
// neden reddediliyor? sıraya yapsın ve sonrakine geçsin." Eski kapı düz sabitti
// (PARDUS_MIN_FREE_GB=45) ve reddettiği işe 'failed' yazıyordu.
// ---------------------------------------------------------------------------
test('GERİLEME: kapı eşiği kaynağın boyutundan türer, düz sabit DEĞİL', () => {
  const kaynak = fs.readFileSync(path.join(__dirname, 'runner.js'), 'utf8');
  assert.match(kaynak, /pardusGerekliDiskGb\(\{/, 'orantılı hesap çağrılmalı');
  assert.match(kaynak, /kaynakBoyutuTahmin\(/, 'kaynak boyutu indirmeden ölçülmeli');
  // Eşik doğrudan env'den okunup karşılaştırmaya girmemeli (eski düz sabit kalıbı).
  assert.ok(
    !/const gerekliGb = Number\(process\.env\.PARDUS_MIN_FREE_GB/.test(kaynak),
    'düz sabit eşik kalıbı geri gelmiş',
  );
});

test('GERİLEME: disk kapısı düşünce satıra failed YAZILMAZ (erteleme dalı)', () => {
  const kaynak = fs.readFileSync(path.join(__dirname, 'runner.js'), 'utf8');
  const ertele = kaynak.indexOf('ertelenebilirKaynakHatasi(e)');
  const failed = kaynak.indexOf('await postResultFailure(auth, job, e.message)');
  assert.ok(ertele > 0, 'erteleme dalı yok — disk darlığı paket kusuru sayılır');
  assert.ok(failed > 0, 'failure bildirimi bulunamadı');
  assert.ok(ertele < failed, 'erteleme dalı failed yazımından ÖNCE gelmeli');
  // Hata metni işaretli olmalı, yoksa erteleme dalı onu tanıyamaz.
  assert.match(kaynak, /\$\{DISK_KAPISI_ISARETI\} pardus disk kapısı/, 'kapı hatası işaretsiz');
});

test('diskBosGb: statfs sonucunu GB tam sayısına çevirir, hata durumunda null', () => {
  const kaynak = fs.readFileSync(path.join(__dirname, 'runner.js'), 'utf8');
  assert.match(kaynak, /function diskBosGb\(/, 'diskBosGb yardımcısı yok');
  assert.match(kaynak, /statfsSync/, 'statfsSync kullanılmalı');
  assert.match(kaynak, /return null;/, 'ölçülemezse null dönmeli');
});

test('GERİLEME: kabul kapısı yabancı (elle açılmış) DijiTap süreçlerini ölçmez', () => {
  // 2026-09-18: 45487 ve 45472 birebir aynı piksel sayılarıyla reddedildi — kapı
  // Nadir'in ProBook'ta elle açtığı kitabın penceresini ölçmüştü. İki ek şart girdi.
  const k = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'pardus', 'probook-kabul.sh'), 'utf8');
  assert.match(k, /\*\.kabulgizli-\*\) continue/, 'gizlenmiş eski kurulum elenmeli');
  assert.match(k, /ps -o etimes=/, 'süreç yaşı sorulmalı');
  assert.match(k, /yas.*-gt.*gecen \+ 60/s, 'kapıdan önce doğan süreç elenmeli');
});

test('GERİLEME: aktivasyon kodlu seriler kapıda renk eşiğinden muaf', () => {
  // Nadir kuralı 2026-09-18: Privilege/Marvel/Impact/Influence/Power/YKS-DİL kitapları
  // açılışta aktivasyon kodu ister; bu motorun çalıştığının kanıtıdır. Ölçüm (45487, 45472):
  // sapma 0.148 · koyu 0.906 · renk 384 — yalnız renk eşiğine (500) takılıp reddediliyordu.
  const k = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'pardus', 'probook-kabul.sh'), 'utf8');
  assert.match(k, /EMPP_AKTIVASYON_BEKLENIR/);
  assert.match(k, /RENK_ESIGI=0/, 'aktivasyon kitabında renk eşiği düşmeli');
  assert.match(k, /s\+0 >= 0\.05 && k\+0 >= 0\.005/, 'sapma ve koyu şartları KALMALI');
  assert.match(k, /KABUL \(aktivasyon ekrani\)/, 'sonuç ayrı işaretlenmeli');

  const r = fs.readFileSync(path.join(__dirname, 'runner.js'), 'utf8');
  assert.match(r, /AKTIVASYON_SERILERI/);
  assert.match(r, /EMPP_AKTIVASYON_BEKLENIR: aktivasyon \? '1' : '0'/);
});

test('aktivasyonBeklenir: yalnız kodlu seriler için doğru döner', () => {
  const r = fs.readFileSync(path.join(__dirname, 'runner.js'), 'utf8');
  const m = r.match(/const AKTIVASYON_SERILERI = (\/.+\/i);/);
  assert.ok(m, 'desen bulunmalı');
  const desen = new RegExp(m[1].slice(1, -2), 'i');
  for (const ad of ['Marvel Grade 12', 'YDT Power 12 Set', 'YKS-DİL Dergi Seti',
                    'Privilege Grade 11', 'Impact Grade 11', 'Influence Grade 12']) {
    assert.ok(desen.test(ad), `${ad} aktivasyon kodlu sayılmalı`);
  }
  for (const ad of ['Lingoland Grade 3', 'Shall We?! 7 Set', 'English Up 8 Set', 'Super Monsters 3']) {
    assert.ok(!desen.test(ad), `${ad} aktivasyon kodlu SAYILMAMALI`);
  }
});

// ---------------------------------------------------------------------------
// KAPI GEÇİŞİ (2026-09-19) — sayfa-webp ve ölü-motor-temizliği kapıları
// packagingService içinde, yani KONTEYNERİN İÇİNDE okunuyor. Host'ta
// `EMPP_SAYFA_WEBP=1 pardus-packager-build.sh …` demek hiçbir şey yapmıyordu:
// değişken docker'a geçirilmediği için kapı sessizce kapalı kalıyordu. Yani
// WebP kapısı pardus yolunda HİÇ denenememişti.
// ---------------------------------------------------------------------------
test('GERİLEME: kapı değişkenleri docker konteynerine aktarılır', () => {
  const k = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'pardus', 'pardus-packager-build.sh'), 'utf8');
  const dockerRun = k.slice(k.indexOf('docker run --rm --platform linux/amd64'));
  for (const ad of ['EMPP_SET_MENU', 'EMPP_SAYFA_WEBP', 'EMPP_OLU_TEMIZLIK']) {
    assert.ok(new RegExp(`-e ${ad}=`).test(dockerRun), `${ad} docker'a aktarılmıyor — kapı sessizce kapalı kalır`);
  }
  // Varsayılanlar KORUNMALI: webp kapalı, ölü temizlik ve SET menüsü açık.
  assert.match(dockerRun, /EMPP_SAYFA_WEBP="\$\{EMPP_SAYFA_WEBP:-0\}"/, 'webp varsayılanı açılmış');
  assert.match(dockerRun, /EMPP_OLU_TEMIZLIK="\$\{EMPP_OLU_TEMIZLIK:-1\}"/, 'ölü temizlik varsayılanı kapanmış');
});

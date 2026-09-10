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
  assert.match(fn, /capabilities:\s*CONFIG\.caps/);
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

test('bütünlük betiği: gerçek impark-butunluk.py (rule: /usr/bin/python3) sahte TAM/KESİK dosyaları doğru sınıflar', async () => {
  const { execFileSync } = require('node:child_process');
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'butunluk-'));
  try {
    const tam = path.join(dir, 'tam.impark');
    const kesik = path.join(dir, 'kesik.impark');
    await fsp.writeFile(tam, fakeSquashfsBuffer(OFFSET + 96 + 1000, 500));
    await fsp.writeFile(kesik, fakeSquashfsBuffer(OFFSET + 96, 999999));

    let threw = false;
    try {
      execFileSync('/usr/bin/python3', [CONFIG.imparkButunlukPy, tam], { stdio: 'pipe' });
    } catch (e) { threw = true; }
    assert.equal(threw, false, 'TAM paket rc=0 vermeli');

    assert.throws(() => execFileSync('/usr/bin/python3', [CONFIG.imparkButunlukPy, kesik], { stdio: 'pipe' }));
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

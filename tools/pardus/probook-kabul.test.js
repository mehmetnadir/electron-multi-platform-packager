const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const BETIK = path.join(__dirname, 'probook-kabul.sh');
const kaynak = () => fs.readFileSync(BETIK, 'utf8');

/**
 * NEDEN BU TEST VAR (ölçüldü 2026-09-21):
 * Kabul kapısının varsayılan adresi `etapadmin@192.168.1.55` (ofis LAN) idi.
 * Nadir ofis dışındayken ya da paketleyici başka ağdayken kapı
 * "ProBook'a baglanilamadi" verip işi bekletiyordu — 6 pardus paketi
 * (45481/45482/45487/45541/45549/73581) bu yüzden kuyrukta kaldı, oysa
 * paketlerin hepsi bit düzeyinde TAM çıktı. Aynı makine Tailscale'de
 * 100.73.161.76 adresinde ve her iki ağdan da erişilebilir.
 */
test('kabul kapisinin VARSAYILAN adresi LAN-only olamaz', () => {
  const satir = kaynak().split('\n').find((s) => s.trimStart().startsWith('HOST='));
  assert.ok(satir, 'HOST= varsayilan satiri bulunamadi');
  assert.doesNotMatch(
    satir,
    /(?:^|[^0-9.])(?:192\.168|10\.|172\.(?:1[6-9]|2\d|3[01]))\./,
    `Varsayilan LAN adresi olmamali (yalniz ofisten calisir): ${satir}`
  );
});

test('varsayilan adres Tailscale CGNAT araliginda (100.64.0.0/10)', () => {
  const satir = kaynak().split('\n').find((s) => s.trimStart().startsWith('HOST='));
  const ip = (satir.match(/@(\d+\.\d+\.\d+\.\d+)/) || [])[1];
  assert.ok(ip, `HOST satirinda IP yok: ${satir}`);
  const [a, b] = ip.split('.').map(Number);
  assert.equal(a, 100, `Tailscale araligi degil: ${ip}`);
  assert.ok(b >= 64 && b <= 127, `Tailscale araligi degil: ${ip}`);
});

test('PROBOOK_HOST ile elle gecersiz kilinabilir (LAN-a donus yolu acik)', () => {
  assert.match(kaynak(), /HOST="\$\{PROBOOK_HOST:-/);
});

test('bash sozdizimi gecerli', () => {
  const { spawnSync } = require('node:child_process');
  const r = spawnSync('bash', ['-n', BETIK], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

// ---------------------------------------------------------------------------
// YEREL KIP (2026-09-24, ProBook şeridi plan C6): ajan ProBook'un kendisinde
// koşarken PROBOOK_HOST=yerel -> ssh/scp YOK, paket yerinde açılır ve SİLİNMEZ.
// Testler betiği gerçekten koşturur: sahte $HOME, PATH başına ssh/scp/setsid
// sahteleri (ssh/scp çağrılırsa iz dosyasına yazar -> test düşer).
// ---------------------------------------------------------------------------
const os = require('node:os');
const { spawnSync, spawn } = require('node:child_process');

function yerelOrtam() {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'kabul-yerel-'));
  const home = path.join(kok, 'home');
  const bin = path.join(kok, 'bin');
  const isaret = path.join(kok, 'isaret');
  const iz = path.join(kok, 'uzak-cagri.iz');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(bin);
  fs.mkdirSync(isaret);
  for (const ad of ['ssh', 'scp']) {
    fs.writeFileSync(path.join(bin, ad), `#!/bin/bash\necho "${ad} $*" >> "${iz}"\nexit 255\n`, { mode: 0o755 });
  }
  fs.writeFileSync(path.join(bin, 'setsid'), '#!/bin/bash\nexec "$@"\n', { mode: 0o755 });
  const paket = path.join(kok, 'out', 'Deneme-1.0.0.impark');
  fs.mkdirSync(path.dirname(paket));
  fs.writeFileSync(paket, '#!/bin/bash\nsleep 1\n', { mode: 0o755 });
  const env = {
    ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`,
    PROBOOK_HOST: 'yerel', KABUL_ISARET_DIZIN: isaret, PROBOOK_BEKLE: '10',
    KABUL_BOSLUK_ARALIK: '1', PROBOOK_BEKLE_TABAN: '0',
    // Paralel koşan diğer test dosyaları sahte probook-kabul.sh başlatır; hermetik kal.
    KABUL_SUREC_DESENI: `[y]ok-${path.basename(kok)}`,
  };
  return { kok, home, isaret, iz, paket, env };
}

test('yerel kip: ProBook mesgulken bekler, tavan dolunca RED — ssh yok, baskasinin uygulamasina dokunmaz', () => {
  const o = yerelOrtam();
  // Başkasının açık DijiTap uygulaması (öğretmen / uzak kabul) — öldürülmemeli.
  const appDir = path.join(o.home, 'DijiTap', 'alan', 'Kitap');
  fs.mkdirSync(appDir, { recursive: true });
  const app = path.join(appDir, 'app.sh');
  fs.writeFileSync(app, '#!/bin/bash\nsleep 30\n', { mode: 0o755 });
  const cocuk = spawn('bash', [app], { stdio: 'ignore', detached: true });
  try {
    spawnSync('sleep', ['0.3']);
    const r = spawnSync('bash', [BETIK, o.paket, path.join(o.kok, 'kanit')], {
      encoding: 'utf8', env: { ...o.env, KABUL_BOSLUK_TAVAN: '2' }, timeout: 30000,
    });
    assert.notEqual(r.status, 0, r.stdout);
    assert.match(r.stdout, /ProBook mesgul/);
    assert.match(r.stdout, /DijiTap uygulamasi acik/);
    assert.equal(fs.existsSync(o.iz), false, 'yerel kipte ssh/scp cagrilmamali');
    assert.doesNotThrow(() => process.kill(cocuk.pid, 0), 'baskasinin uygulamasi olduruldu');
    assert.ok(fs.existsSync(o.paket), 'paket silinmemeli');
  } finally {
    try { process.kill(-cocuk.pid, 'SIGKILL'); } catch (_) { /* bitti */ }
  }
});

test('yerel kip: baska kabulun /tmp isareti (60 dk icinde) mesgul sayilir', () => {
  const o = yerelOrtam();
  fs.writeFileSync(path.join(o.isaret, 'kabul-onceki-123.txt'), '');
  const r = spawnSync('bash', [BETIK, o.paket, path.join(o.kok, 'kanit')], {
    encoding: 'utf8', env: { ...o.env, KABUL_BOSLUK_TAVAN: '1' }, timeout: 30000,
  });
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /baska kabul suruyor \(kabul-onceki-123\.txt\)/);
  assert.equal(fs.existsSync(o.iz), false);
});

test('yerel kip: uzak kabulun scp ile gelen /tmp/kabul-<damga>.impark kopyasi mesgul sayilir', () => {
  const o = yerelOrtam();
  fs.writeFileSync(path.join(o.isaret, 'kabul-d73768-1790260727.impark'), 'yari'); // ad kalıbı ajana göre değişiyor
  const r = spawnSync('bash', [BETIK, o.paket, path.join(o.kok, 'kanit')], {
    encoding: 'utf8', env: { ...o.env, KABUL_BOSLUK_TAVAN: '1' }, timeout: 30000,
  });
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /uzak kabul paketi aktariliyor\/test ediliyor \(kabul-d73768-1790260727\.impark\)/);
});

test('yerel kip: acilmayan paket RED, gizlenen kurulum geri konur, paket SILINMEZ, ssh/scp yok', () => {
  const o = yerelOrtam();
  const eski = path.join(o.home, 'DijiTap', 'DijiTap', 'Eski Set');
  fs.mkdirSync(eski, { recursive: true });
  fs.writeFileSync(path.join(eski, 'isaret.txt'), 'ogretmen kurulumu');
  const kanit = path.join(o.kok, 'kanit');
  const r = spawnSync('bash', [BETIK, o.paket, kanit], { encoding: 'utf8', env: o.env, timeout: 60000 });
  assert.notEqual(r.status, 0, r.stdout);
  assert.match(r.stdout, /yerel kip: Deneme-1\.0\.0\.impark/);
  assert.match(r.stdout, /uygulama penceresi .* acilmadi/);
  assert.equal(fs.existsSync(o.iz), false, `ssh/scp cagrildi: ${fs.existsSync(o.iz) ? fs.readFileSync(o.iz, 'utf8') : ''}`);
  assert.ok(fs.existsSync(o.paket), 'yerel kipte paket temizlikte silinmemeli (yukleme ona muhtac)');
  assert.equal(fs.readFileSync(path.join(eski, 'isaret.txt'), 'utf8'), 'ogretmen kurulumu', 'gizlenen kurulum geri konmali');
  const kalan = fs.readdirSync(path.join(o.home, 'DijiTap', 'DijiTap')).filter((d) => d.includes('kabulgizli'));
  assert.deepEqual(kalan, [], '.kabulgizli-* kalmamali');
  assert.match(fs.readFileSync(path.join(kanit, 'temizlik.log'), 'utf8'), /geri konuldu: DijiTap\/Eski Set/);
});

test('uzak kip korunur: yerel dal yalniz PROBOOK_HOST=yerel ile acilir', () => {
  const s = kaynak();
  assert.match(s, /if \[ "\$HOST" = "yerel" \]; then/);
  assert.match(s, /SSH=\(ssh -o ConnectTimeout=10 -o BatchMode=yes -o StrictHostKeyChecking=accept-new -i "\$KEY" "\$HOST"\)/);
});

test('ortak kilit: baska kapinin ~/.kabul.lock kilidi varken yerel kapi BEKLER, kurulumlara dokunmaz', () => {
  const o = yerelOrtam();
  fs.writeFileSync(path.join(o.home, '.kabul.lock'), 'pid=1 damga=uzak kaynak=nadir-mac zaman=1\n');
  const eski = path.join(o.home, 'DijiTap', 'DijiTap', 'Eski Set');
  fs.mkdirSync(eski, { recursive: true });
  const r = spawnSync('bash', [BETIK, o.paket, path.join(o.kok, 'kanit')], {
    encoding: 'utf8', env: { ...o.env, KABUL_BOSLUK_TAVAN: '1' }, timeout: 30000,
  });
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /kabul kilidi: pid=1 damga=uzak kaynak=nadir-mac/);
  assert.ok(fs.existsSync(eski), 'kilit alinmadan gizleme yapilmamali');
  assert.match(fs.readFileSync(path.join(o.home, '.kabul.lock'), 'utf8'), /damga=uzak/, 'baskasinin kilidi birakilmamali');
});

test('ortak kilit: yerel kapi bitince kendi kilidini birakir ve manifest kalmaz', () => {
  const o = yerelOrtam();
  spawnSync('bash', [BETIK, o.paket, path.join(o.kok, 'kanit')], { encoding: 'utf8', env: o.env, timeout: 60000 });
  assert.equal(fs.existsSync(path.join(o.home, '.kabul.lock')), false);
  assert.deepEqual(fs.readdirSync(o.home).filter((f) => f.startsWith('.kabul-')), []);
});

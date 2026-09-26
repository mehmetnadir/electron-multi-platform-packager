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

test('kanıt arşivi (B.1): EMPP_KANIT_ARSIV verilirse kanıt kopyalanır, 14 günden eski kabul-* kaldırılır', () => {
  const o = yerelOrtam();
  const arsiv = path.join(o.kok, 'kanit-arsiv');
  const eski = path.join(arsiv, 'kabul-20260901-000000-1');
  const baska = path.join(arsiv, 'kuru-73581');
  fs.mkdirSync(eski, { recursive: true });
  fs.mkdirSync(baska, { recursive: true });
  const yirmiGun = (Date.now() - 20 * 86400 * 1000) / 1000;
  fs.utimesSync(eski, yirmiGun, yirmiGun);
  fs.utimesSync(baska, yirmiGun, yirmiGun);
  const kanit = path.join(o.kok, 'kanit');
  const r = spawnSync('bash', [BETIK, o.paket, kanit], { encoding: 'utf8', env: { ...o.env, EMPP_KANIT_ARSIV: arsiv }, timeout: 60000 });
  assert.notEqual(r.status, 0);
  const yeni = fs.readdirSync(arsiv).filter((d) => d.startsWith('kabul-') && d !== path.basename(eski));
  assert.equal(yeni.length, 1, fs.readdirSync(arsiv).join(','));
  assert.ok(fs.existsSync(path.join(arsiv, yeni[0], 'temizlik.log')));
  assert.match(fs.readFileSync(path.join(arsiv, yeni[0], 'paket.txt'), 'utf8'), /paket=.*Deneme-1\.0\.0\.impark/);
  assert.equal(fs.existsSync(eski), false, '14 günden eski kabul kanıtı kaldırılır');
  assert.ok(fs.existsSync(baska), 'kabul-* dışı dizine dokunulmaz');
});

test('kanıt arşivi verilmezse davranış aynı (arşiv yazılmaz)', () => {
  assert.match(kaynak(), /\[ -n "\$\{EMPP_KANIT_ARSIV:-\}" \] \|\| return 0/);
});

// ---------------------------------------------------------------------------
// CANLI YARI (2026-09-26): E8 ayrı ev dizini + E6/E7 CDP portu + ÖLÇÜLEMEDİ.
// Mac'te /proc yok → pencere aşamasına varılmaz (RED "pencere acilmadi"); testler
// uygulamanın NE İLE başlatıldığını (HOME/XDG/port) sahte paketin iz dosyasından okur.
// ---------------------------------------------------------------------------
const net = require('node:net');

/** Başlatıldığı ortamı ve argümanları iz dosyasına yazan sahte paket. */
function izliPaket(o) {
  const iz = path.join(o.kok, 'paket-ortam.iz');
  fs.writeFileSync(o.paket, [
    '#!/bin/bash',
    `{ echo "HOME=$HOME"; echo "XDG_CONFIG_HOME=\${XDG_CONFIG_HOME:-}"; echo "XDG_CACHE_HOME=\${XDG_CACHE_HOME:-}";`
      + ` echo "XDG_DATA_HOME=\${XDG_DATA_HOME:-}"; echo "ARGS=$*"; } > "${iz}"`,
    // Ayrı evde motorun K indirmesini taklit et: work/book1/<zip> + work/empp-icerik.log.
    'if [ -n "${XDG_CONFIG_HOME:-}" ]; then W="$XDG_CONFIG_HOME/deneme-set/work"; mkdir -p "$W/book1/pages";'
      + ' printf zipverisi > "$W/book1/44187-36.zip"; printf sayfa > "$W/book1/pages/1.png";'
      + ' printf gunluk > "$W/empp-icerik.log"; printf yarim > "$W/indiriliyor.zip"; fi',
    'sleep 1', '',
  ].join('\n'), { mode: 0o755 });
  return iz;
}
function izOku(iz) {
  const v = {};
  for (const s of fs.readFileSync(iz, 'utf8').split('\n')) { const i = s.indexOf('='); if (i > 0) v[s.slice(0, i)] = s.slice(i + 1); }
  return v;
}
function temizEnv(env) {
  const e = { ...env };
  for (const k of ['XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'KABUL_CDP', 'KABUL_AYRI_EV', 'KABUL_EV',
    'KABUL_EV_KOK', 'KABUL_AKTIVASYON_OLCULEMEDI']) delete e[k];
  return e;
}
async function bosPortTut(taban) {
  for (let p = taban; p < taban + 50; p += 1) {
    const s = net.createServer();
    const ok = await new Promise((r) => { s.once('error', () => r(false)); s.listen(p, '127.0.0.1', () => r(true)); });
    if (ok) return { port: p, s };
  }
  throw new Error('boş port yok');
}

test('bayraklar varsayilan KAPALI: CDP/E8/aktivasyon-olculemedi yalniz acikca 1 ile', () => {
  const s = kaynak();
  assert.match(s, /CDP="\$\{KABUL_CDP:-0\}"/);
  assert.match(s, /if \[ -n "\$\{KABUL_AYRI_EV:-\}" \]; then AYRI_EV="\$KABUL_AYRI_EV"; else AYRI_EV="\$CDP"; fi/,
    'ayrı ev yalnız CDP ile varsayılan açılır; CDP kapalıyken kapalı');
  assert.match(s, /EV_GUN="\$\{KABUL_EV_GUN:-1\}"/);
  assert.match(s, /AKT_OLC="\$\{KABUL_AKTIVASYON_OLCULEMEDI:-0\}"/);
});

test('bayraklar kapaliyken paket ESKISI GIBI baslar: gercek HOME, XDG yok, --remote-debugging-port yok', () => {
  const o = yerelOrtam();
  const iz = izliPaket(o);
  const kanit = path.join(o.kok, 'kanit');
  const r = spawnSync('bash', [BETIK, o.paket, kanit], { encoding: 'utf8', env: temizEnv(o.env), timeout: 60000 });
  assert.equal(r.status, 1, r.stdout);
  const v = izOku(iz);
  assert.equal(v.HOME, o.home);
  assert.equal(v.XDG_CONFIG_HOME, '');
  assert.doesNotMatch(v.ARGS, /remote-debugging/);
  assert.match(fs.readFileSync(path.join(kanit, 'ortam.txt'), 'utf8'), /KABUL_EV=yok \(gercek HOME; E8 kapali\)/);
  assert.match(r.stdout, /eski kurulumlar gizleniyor \+ paket baslatiliyor/);
});

test('CDP acik → ayri ev VARSAYILAN (KABUL_AYRI_EV verilmeden): HOME+XDG, bos CDP portu, ogretmen kurulumu GIZLENMEZ, indirilen K icerigi tutulmaz (liste+md5), 1 gunden eski ev budanir', async () => {
  const o = yerelOrtam();
  const iz = izliPaket(o);
  const ogretmen = path.join(o.home, 'DijiTap', 'DijiTap', 'Eski Set');
  fs.mkdirSync(ogretmen, { recursive: true });
  fs.writeFileSync(path.join(ogretmen, 'isaret.txt'), 'ogretmen kurulumu');
  fs.mkdirSync(path.join(o.home, '.config', 'shall-we-8-set', 'work'), { recursive: true });
  const evKok = path.join(o.home, 'empp-serit', 'kabul-ev');
  const eskiEv = path.join(evKok, 'ev-1-1');
  const baska = path.join(evKok, 'baska');
  const dunkuEv = path.join(evKok, 'ev-2-2');
  const tazeEv = path.join(evKok, 'ev-3-3');
  for (const [d, saat] of [[eskiEv, 240], [baska, 240], [dunkuEv, 30], [tazeEv, 12]]) {
    fs.mkdirSync(d, { recursive: true });
    const on = (Date.now() - saat * 3600 * 1000) / 1000;
    fs.utimesSync(d, on, on);
  }
  const tut = await bosPortTut(9337);
  try {
    const kanit = path.join(o.kok, 'kanit');
    const r = await new Promise((coz) => {
      const p = spawn('bash', [BETIK, o.paket, kanit], {
        env: { ...temizEnv(o.env), KABUL_CDP: '1', KABUL_CDP_PORT_TABAN: String(tut.port) },
      });
      let out = '';
      p.stdout.on('data', (d) => { out += d; });
      p.stderr.on('data', (d) => { out += d; });
      p.on('exit', (status) => coz({ status, stdout: out }));
    });
    assert.equal(r.status, 1, r.stdout); // Mac'te pencere ölçülemez → RED "pencere acilmadi"
    const v = izOku(iz);
    assert.ok(v.HOME.startsWith(`${evKok}/ev-`), `HOME ayri ev olmali: ${v.HOME}`);
    assert.equal(v.XDG_CONFIG_HOME, `${v.HOME}/.config`);
    assert.equal(v.XDG_CACHE_HOME, `${v.HOME}/.cache`);
    assert.equal(v.XDG_DATA_HOME, `${v.HOME}/.local/share`);
    const port = Number((/--remote-debugging-port=(\d+)/.exec(v.ARGS) || [])[1]);
    assert.ok(port > tut.port && port !== 3000, `bos port secilmeli (dolu ${tut.port} atlanir): ${v.ARGS}`);
    // Kanıt: ev dizini yazılı; stdout'ta da.
    const ortam = fs.readFileSync(path.join(kanit, 'ortam.txt'), 'utf8');
    assert.match(ortam, new RegExp(`KABUL_EV=${v.HOME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n`));
    assert.match(ortam, /E8_ENVANTER=ayni/);
    assert.match(r.stdout, /E8: ayri ev dizini: .*\/empp-serit\/kabul-ev\/ev-/);
    // Öğretmen kurulumu hiç gizlenmedi / geri konmadı (ayrı evde koşuldu).
    assert.equal(fs.readFileSync(path.join(ogretmen, 'isaret.txt'), 'utf8'), 'ogretmen kurulumu');
    assert.doesNotMatch(fs.readFileSync(path.join(kanit, 'baslat.log'), 'utf8'), /gizlendi/);
    assert.doesNotMatch(fs.readFileSync(path.join(kanit, 'temizlik.log'), 'utf8'), /geri konuldu/);
    // Manifest ayrı evde yazıldı ve temizlendi; gerçek HOME'da manifest/kilit kalmadı.
    assert.deepEqual(fs.readdirSync(v.HOME).filter((f) => f.startsWith('.kabul-')), []);
    assert.deepEqual(fs.readdirSync(o.home).filter((f) => f.startsWith('.kabul-') || f === '.kabul.lock'), []);
    // Bu koşunun evi kanıt olarak kalır; 3 günden eski ev-* budanır, başka dizine dokunulmaz.
    assert.ok(fs.existsSync(v.HOME), 'kabul evi kanıt olarak kalmalı');
    assert.equal(fs.existsSync(eskiEv), false, 'eski ev-* budanmalı');
    assert.ok(fs.existsSync(baska), 'ev-* dışı dizine dokunulmaz');
    assert.equal(fs.existsSync(dunkuEv), false, 'varsayılan saklama 1 gün: 30 saatlik ev budanır');
    assert.ok(fs.existsSync(tazeEv), '12 saatlik ev kalır');
    // Kabulde indirilen K içeriği tutulmaz; yalnız liste + boyut + md5. Günlük kalır.
    const w = path.join(v.HOME, '.config', 'deneme-set', 'work');
    assert.deepEqual(fs.readdirSync(w), ['empp-icerik.log'], 'work altında yalnız *.log kalmalı');
    const liste = fs.readFileSync(path.join(kanit, 'work-liste.txt'), 'utf8').trim().split('\n').sort();
    const md5 = (x) => require('node:crypto').createHash('md5').update(x).digest('hex');
    assert.deepEqual(liste, [
      `${md5('zipverisi')} 9 .config/deneme-set/work/book1/44187-36.zip`,
      `${md5('sayfa')} 5 .config/deneme-set/work/book1/pages/1.png`,
      `${md5('yarim')} 5 .config/deneme-set/work/indiriliyor.zip`,
    ].sort());
    assert.match(ortam, /WORK_INDIRILEN=3 dosya, 19 B/);
    assert.doesNotMatch(fs.readFileSync(path.join(kanit, 'ev-bitis.log'), 'utf8'), /^WORK /m);
    assert.match(ortam, /EV_KULLANILAN=.*\/empp-serit\/kabul-ev\/ev-.* \(ayri\)/);
  } finally {
    tut.s.close();
  }
});

test('E8: KABUL_EV bos degilse ONCEDEN OLCULEMEDI (cikis 4), paket hic baslatilmaz, kilit birakilir', () => {
  const o = yerelOrtam();
  const iz = izliPaket(o);
  const ev = path.join(o.kok, 'dolu-ev');
  fs.mkdirSync(path.join(ev, '.config', 'x', 'work'), { recursive: true });
  const r = spawnSync('bash', [BETIK, o.paket, path.join(o.kok, 'kanit')], {
    encoding: 'utf8', env: { ...temizEnv(o.env), KABUL_AYRI_EV: '1', KABUL_EV: ev }, timeout: 30000,
  });
  assert.equal(r.status, 4, r.stdout);
  assert.match(r.stdout, /OLCULEMEDI: E8 kabul evi bos degil: .*dolu-ev/);
  assert.equal(fs.existsSync(iz), false, 'paket başlatılmamalı');
  assert.equal(fs.existsSync(path.join(o.home, '.kabul.lock')), false);
});

test('E8: kabul evi yolunda kabuk metakarakteri → OLCULEMEDI, hicbir sey calismaz', () => {
  const o = yerelOrtam();
  const r = spawnSync('bash', [BETIK, o.paket, path.join(o.kok, 'kanit')], {
    encoding: 'utf8', env: { ...temizEnv(o.env), KABUL_AYRI_EV: '1', KABUL_EV: '/tmp/x"; touch /tmp/pwn; "' }, timeout: 30000,
  });
  assert.equal(r.status, 4, r.stdout);
  assert.match(r.stdout, /gecersiz kabul evi yolu/);
});

test('CDP acik + acikca KABUL_AYRI_EV=0: gercek HOME ile acilir, UYARI + hangi ev kullanildigi kanita yazilir', () => {
  const o = yerelOrtam();
  const iz = izliPaket(o);
  const kanit = path.join(o.kok, 'kanit');
  const r = spawnSync('bash', [BETIK, o.paket, kanit], {
    encoding: 'utf8', env: { ...temizEnv(o.env), KABUL_CDP: '1', KABUL_AYRI_EV: '0' }, timeout: 60000,
  });
  assert.equal(r.status, 1, r.stdout); // Mac'te pencere yok → RED; karar kuralı kabul-karar.test.js'te
  const v = izOku(iz);
  assert.equal(v.HOME, o.home);
  assert.match(v.ARGS, /--remote-debugging-port=\d+/);
  assert.match(r.stdout, /UYARI: KABUL_AYRI_EV=0 — uygulama GERCEK HOME ile acilacak; E7 guvenilmez, karar OLCULEMEDI olur/);
  assert.match(fs.readFileSync(path.join(kanit, 'ortam.txt'), 'utf8'), /EV_KULLANILAN=.* \(GERCEK HOME\)/);
});

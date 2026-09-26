'use strict';
// arsiv-esle.sh — Mac kaynak arşivini ProBook'a eşler. Betik GERÇEKTEN koşar: "ProBook" sahte
// bir ev dizinidir (ARSIV_ESLE_SSH="bash -c" + HOME), rsync gerçek, özet gerçek kaynak-arsivi.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const BETIK = path.join(__dirname, 'arsiv-esle.sh');
const REPO = path.join(__dirname, '..', '..');

function kitapYaz(kok, id, icerik) {
  const d = path.join(kok, id);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'build.zip'), icerik);
  const md5 = crypto.createHash('md5').update(icerik).digest('hex');
  fs.writeFileSync(path.join(d, 'kaynak.json'), JSON.stringify({ dosya: 'build.zip', md5, boyut: Buffer.byteLength(icerik), etiket: 't' }));
}

function ortam() {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'arsiv-esle-'));
  const mac = path.join(kok, 'mac-arsiv');
  const pbEv = path.join(kok, 'probook');
  fs.mkdirSync(path.join(pbEv, '.empp-agent', 'kaynak-arsivi'), { recursive: true });
  kitapYaz(mac, '73581', 'ZIP-73581');
  kitapYaz(mac, '45482', 'ZIP-45482');
  const env = {
    ...process.env, HOME: pbEv, EMPP_KAYNAK_ARSIVI: mac,
    ARSIV_ESLE_SSH: 'bash -c', ARSIV_ESLE_HEDEF: path.join(pbEv, '.empp-agent', 'kaynak-arsivi') + '/',
    ARSIV_ESLE_UZAK_NODE: process.execPath, ARSIV_ESLE_UZAK_REPO: REPO,
    ARSIV_ESLE_KILIT: path.join(kok, 'kilit.d'), ARSIV_ESLE_LOG: path.join(kok, 'esle.log'),
  };
  return { kok, mac, pbEv, pbArsiv: path.join(pbEv, '.empp-agent', 'kaynak-arsivi'), env };
}
const kos = (o, ek = {}) => spawnSync('bash', [BETIK], { encoding: 'utf8', env: { ...o.env, ...ek }, timeout: 60000 });
const bayrak = (o) => path.join(o.pbEv, '.empp-agent', 'duraklat.istek');
const { arsivOzeti } = require('../../src/agent/kaynak-arsivi');

test('fark var: zip+kayıt aktarılır, özet eşitlenir, kendi koyduğu duraklatma kaldırılır', () => {
  const o = ortam();
  const r = kos(o);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(arsivOzeti(o.pbArsiv).ozet, arsivOzeti(o.mac).ozet);
  assert.equal(fs.readFileSync(path.join(o.pbArsiv, '73581', 'build.zip'), 'utf8'), 'ZIP-73581');
  assert.equal(fs.existsSync(bayrak(o)), false, 'duraklatma kaldırılmalı');
  const kenar = fs.readdirSync(path.join(o.pbEv, '.empp-agent')).filter((a) => a.startsWith('duraklat.istek.kaldirildi-'));
  assert.equal(kenar.length, 1, 'bayrak silinmez, kenara alınır');
  assert.match(r.stdout, /ProBook ajani duraklatildi \(bayrak: biz koyduk\)/);
});

test('özet eşitse hiçbir şey yapılmaz, bayrak konmaz', () => {
  const o = ortam();
  assert.equal(kos(o).status, 0);
  const r = kos(o);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /esit — is yok/);
  assert.equal(fs.readdirSync(path.join(o.pbEv, '.empp-agent')).filter((a) => a.startsWith('duraklat')).length, 1, 'yalnız ilk koşunun kenar dosyası');
});

test('başkasının duraklatma bayrağına dokunulmaz', () => {
  const o = ortam();
  fs.mkdirSync(path.dirname(bayrak(o)), { recursive: true });
  fs.writeFileSync(bayrak(o), 'Nadir elle\n');
  const r = kos(o);
  assert.equal(r.status, 0, r.stdout);
  assert.equal(fs.readFileSync(bayrak(o), 'utf8'), 'Nadir elle\n');
  assert.match(r.stdout, /bayrak baskasinin, dokunulmadi/);
});

test('Mac\'te kaydı olmayan kitap ProBook\'ta Silinecekler\'e taşınır (silinmez)', () => {
  const o = ortam();
  kitapYaz(o.pbArsiv, '99999', 'ESKI');
  const r = kos(o);
  assert.equal(r.status, 0, r.stdout);
  assert.equal(fs.existsSync(path.join(o.pbArsiv, '99999')), false);
  const sil = fs.readdirSync(path.join(o.pbEv, 'Silinecekler'));
  assert.equal(sil.length, 1);
  assert.equal(fs.readFileSync(path.join(o.pbEv, 'Silinecekler', sil[0], '99999', 'build.zip'), 'utf8'), 'ESKI');
  assert.equal(arsivOzeti(o.pbArsiv).ozet, arsivOzeti(o.mac).ozet);
});

test('aktarım düşerse bayrak KALIR ve rc=1 (ProBook eski arayüzü üretmesin)', () => {
  const o = ortam();
  const r = kos(o, { ARSIV_ESLE_HEDEF: path.join(o.kok, 'yok', 'olmayan') + '/' });
  assert.equal(r.status, 1, r.stdout);
  assert.equal(fs.existsSync(bayrak(o)), true, 'duraklatma kalmalı');
  assert.match(r.stdout, /ProBook DURAKLATILMIS kalir/);
});

test('kuru koşu: fark raporlanır, aktarım/bayrak yok', () => {
  const o = ortam();
  const r = spawnSync('bash', [BETIK, '--kuru'], { encoding: 'utf8', env: o.env, timeout: 60000 });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /kuru kosu/);
  assert.equal(fs.existsSync(bayrak(o)), false);
  assert.equal(arsivOzeti(o.pbArsiv).ozet, 'bos');
});

test('LAN değilse (Tailscale/röle) ProBook duraklatılır ama aktarım YAPILMAZ; --rele-izin bilerek açar', () => {
  const o = ortam();
  const env = { ...o.env };
  delete env.ARSIV_ESLE_SSH;
  // ssh'ı sahte "ProBook"a yönlendir: yerel bash + sahte HOME (gerçek ağ yok)
  const bin = path.join(o.kok, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'ssh'), '#!/bin/bash\nwhile [ "${1#-}" != "$1" ]; do [ "$1" = -i ] || [ "$1" = -o ] && shift; shift; done\nshift\nexec bash -c "$*"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'rsync'), `#!/bin/bash\necho rsync-cagrildi >> "${path.join(o.kok, 'rsync.iz')}"\nexit 0\n`, { mode: 0o755 });
  env.PATH = `${bin}:${process.env.PATH}`;
  const r = spawnSync('bash', [BETIK, '--host', 'etapadmin@100.73.161.76'], { encoding: 'utf8', env, timeout: 60000 });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /LAN yok .* aktarim yapilmadi/);
  assert.equal(fs.existsSync(path.join(o.kok, 'rsync.iz')), false, 'röle üzerinden rsync YOK');
  assert.equal(fs.existsSync(bayrak(o)), true, 'eski arayüz üretmesin diye duraklatılmış kalır');
  const r2 = spawnSync('bash', [BETIK, '--host', 'etapadmin@100.73.161.76', '--rele-izin'], { encoding: 'utf8', env, timeout: 60000 });
  assert.ok(fs.existsSync(path.join(o.kok, 'rsync.iz')), `--rele-izin ile aktarım denenir: ${r2.stdout}`);
});

test('kopan aktarım kaldığı yerden sürer: rsync --partial + zaman aşımı', () => {
  const s = fs.readFileSync(BETIK, 'utf8');
  assert.match(s, /rsync -a --partial --timeout=120 /);
});

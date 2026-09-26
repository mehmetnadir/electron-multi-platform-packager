'use strict';
// pardus-yerel-build.sh — docker'sız ProBook derlemesi (plan C4). Betik GERÇEKTEN koşar;
// packagingService ve impark-dogrula sahte (sahte depo + PARDUS_DOGRULA), gerisi gerçek:
// kilit, disk kapısı, iş dizini, girdi kopyası, bayrak aktarımı, zenity kapısı, temizlik.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BETIK = path.join(__dirname, 'pardus-yerel-build.sh');

const SAHTE_SERVIS = `
const fs = require('fs'); const p = require('path');
module.exports = { startPackaging: async (job, info) => {
  const d = p.join('temp', job, 'linux'); fs.mkdirSync(d, { recursive: true });
  if (process.env.STUB_FAIL) return { linux: { success: false, error: 'sahte' } };
  const up = p.join('uploads', info.sessionId);
  fs.writeFileSync(p.join(d, 'ozet.json'), JSON.stringify({
    deb: process.env.EMPP_LINUX_DEB, setMenu: process.env.EMPP_SET_MENU,
    icerik: process.env.EMPP_ICERIK_GUNCELLEME, setGuncelleme: process.env.EMPP_SET_GUNCELLEME,
    kabulKilidi: process.env.KABUL_KILIT ? (fs.existsSync(process.env.KABUL_KILIT) ? fs.readFileSync(process.env.KABUL_KILIT, 'utf8') : 'YOK') : null,
    cache: process.env.ELECTRON_CACHE, cwdBin: fs.existsSync('node_modules/.bin/electron-builder'),
    info, girdi: fs.readdirSync(up).sort(),
  }));
  fs.writeFileSync(p.join(up, 'index.html'), 'PAKETLEYICI DEGISTIRDI');
  fs.writeFileSync(p.join(d, 'Deneme-1.0.0.impark'), 'IMPARK');
  return { linux: { success: true } };
} };
`;

function ortam() {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'pardus-yerel-'));
  const repo = path.join(kok, 'repo');
  fs.mkdirSync(path.join(repo, 'src', 'packaging'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'node_modules', '.bin'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'package.json'), '{"name":"sahte"}');
  fs.writeFileSync(path.join(repo, 'node_modules', '.bin', 'electron-builder'), '#!/bin/sh\n', { mode: 0o755 });
  fs.writeFileSync(path.join(repo, 'src', 'packaging', 'packagingService.js'), SAHTE_SERVIS);
  const dogrula = path.join(kok, 'dogrula.sh');
  fs.writeFileSync(dogrula, '#!/bin/bash\nmkdir -p "$3"\n'
    + 'if [ -n "${STUB_ZENITY_YOK:-}" ]; then echo "zenity: YOK" > "$3/rapor.txt"; '
    + 'else echo "zenity: VAR (1 bayt)" > "$3/rapor.txt"; fi\n', { mode: 0o755 });
  const kaynak = path.join(kok, 'build');
  fs.mkdirSync(kaynak);
  fs.writeFileSync(path.join(kaynak, 'index.html'), 'ORIJINAL');
  const serit = path.join(kok, 'serit');
  const cikti = path.join(kok, 'out');
  const env = {
    ...process.env, PACKAGER_REPO: repo, EMPP_SERIT_KOK: serit, EMPP_NODE_BIN: path.join(kok, 'yok'),
    PARDUS_DOGRULA: dogrula, PARDUS_DISK_TABAN_GB: '1',
  };
  delete env.EMPP_LINUX_DEB;
  delete env.EMPP_SET_MENU;
  return { kok, repo, kaynak, serit, cikti, env };
}

const kos = (o, girdi, ekEnv = {}) => spawnSync('bash', [BETIK, girdi, 'Deneme', o.cikti, '1.0.0'], {
  encoding: 'utf8', env: { ...o.env, ...ekEnv }, timeout: 60000,
});
const log = (o) => fs.readFileSync(path.join(o.cikti, 'pardus-packager-build.log'), 'utf8');
const isDizinleri = (o) => fs.readdirSync(path.join(o.serit, 'work')).filter((d) => d.startsWith('app-'));

test('dizin girdisi: .impark ciktiya, asama damgalari, DEB varsayilan KAPALI, is dizini temizlenir', () => {
  const o = ortam();
  const r = kos(o, o.kaynak);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(fs.existsSync(path.join(o.cikti, 'Deneme-1.0.0.impark')));
  const l = log(o);
  for (const a of ['girdi', 'paketleyici', 'dogrulama']) assert.match(l, new RegExp(`ASAMA ${a} \\d+`));
  assert.match(l, /zenity kapisi: GECTI/);
  const ozet = JSON.parse(fs.readFileSync(path.join(o.cikti, 'raw', 'linux', 'ozet.json'), 'utf8'));
  assert.equal(ozet.deb, '0', 'EMPP_LINUX_DEB varsayilani 0 olmali');
  assert.equal(ozet.setMenu, '1');
  assert.equal(ozet.cache, path.join(o.serit, 'cache', 'electron'));
  assert.equal(ozet.cwdBin, true, 'cwd/node_modules/.bin/electron-builder gorunmeli (packagingService:4130)');
  assert.deepEqual(ozet.girdi, ['build-info.json', 'index.html']);
  assert.deepEqual(ozet.info.platforms, ['linux']);
  assert.equal(fs.readFileSync(path.join(o.kaynak, 'index.html'), 'utf8'), 'ORIJINAL', 'kaynak yerinde degismemeli');
  assert.deepEqual(isDizinleri(o), [], 'is dizini silinmeli');
});

test('zip girdisi de acilir', () => {
  const o = ortam();
  const zip = path.join(o.kok, 'build.zip');
  const z = spawnSync('zip', ['-q', '-r', zip, '.'], { cwd: o.kaynak });
  assert.equal(z.status, 0);
  const r = kos(o, zip);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const ozet = JSON.parse(fs.readFileSync(path.join(o.cikti, 'raw', 'linux', 'ozet.json'), 'utf8'));
  assert.deepEqual(ozet.girdi, ['build-info.json', 'index.html']);
});

test('ZENITY YOK: paket reddedilir ve silinir', () => {
  const o = ortam();
  const r = kos(o, o.kaynak, { STUB_ZENITY_YOK: '1' });
  assert.notEqual(r.status, 0);
  assert.match(log(o), /ZENITY YOK/);
  assert.equal(fs.existsSync(path.join(o.cikti, 'Deneme-1.0.0.impark')), false);
  assert.deepEqual(isDizinleri(o), []);
});

test('paketleyici basarisiz: rc!=0, is dizini yine temizlenir', () => {
  const o = ortam();
  const r = kos(o, o.kaynak, { STUB_FAIL: '1' });
  assert.notEqual(r.status, 0);
  assert.match(log(o), /paketleyici rc=1/);
  assert.deepEqual(isDizinleri(o), []);
});

test('disk kapisi: yer yoksa girdi acilmadan durur', () => {
  const o = ortam();
  const r = kos(o, o.kaynak, { PARDUS_MIN_FREE_GB: '999999' });
  assert.notEqual(r.status, 0);
  assert.match(log(o), /disk kapisi: \d+ GB bos < 999999 GB gerekli/);
  assert.doesNotMatch(log(o), /girdi hazir/);
});

test('electron-builder yoksa (npm ci yapilmamis) net hata', () => {
  const o = ortam();
  fs.rmSync(path.join(o.repo, 'node_modules', '.bin', 'electron-builder'));
  const r = kos(o, o.kaynak);
  assert.notEqual(r.status, 0);
  assert.match(log(o), /electron-builder yok/);
});

// Kapı sızıntısı (2026-09-26): iki Pardus şeridi de içerik ve SET güncelleme bayraklarını
// paketleyiciye KAPALI varsayılanla geçirmeli; geçirmezse paketleyici varsayılanı AÇIK okur.
// 2026-09-26 (a0cc28d): İçerik güncellemesi (K) Pardus'ta AÇIK (PARDUS_ICERIK_GUNCELLEME, varsayılan
// linux); SET güncelleme KAPALI. İKİ şerit AYNI paketi üretmeli: docker `-e` listesindeki HER bayrak
// yerel betikte AYNI ifadeyle dışa aktarılır (eski test K'yı 0 bekliyordu, a0cc28d'de kırmızıydı).
test('parite: docker şeridinin paketleyiciye geçtiği her EMPP_ bayrağı yerel şeritte aynı ifadeyle', () => {
  const docker = fs.readFileSync(path.join(__dirname, 'pardus-packager-build.sh'), 'utf8');
  const yerel = fs.readFileSync(BETIK, 'utf8');
  const ciftler = [...docker.matchAll(/-e (EMPP_[A-Z_]+)="(\$\{[^}]+\})"/g)].map((m) => [m[1], m[2]]);
  assert.ok(ciftler.length >= 6, `docker bayrakları okunamadı: ${ciftler.length}`);
  for (const [ad, ifade] of ciftler) {
    assert.ok(yerel.includes(`${ad}="${ifade}"`), `yerel şeritte eksik/farklı: ${ad}="${ifade}"`);
  }
  assert.match(docker, /-e EMPP_ICERIK_GUNCELLEME="\$\{PARDUS_ICERIK_GUNCELLEME:-linux\}"/);
  assert.match(docker, /-e EMPP_SET_GUNCELLEME="\$\{EMPP_SET_GUNCELLEME:-0\}"/);
});

test('davranış: Mac ortamındaki EMPP_ICERIK_GUNCELLEME=windows yerel pardus paketine sızmaz (K=linux)', () => {
  const o = ortam();
  const r = kos(o, o.kaynak, { EMPP_ICERIK_GUNCELLEME: 'windows', EMPP_SET_GUNCELLEME: '' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const oz = JSON.parse(fs.readFileSync(path.join(o.cikti, 'raw', 'linux', 'ozet.json'), 'utf8'));
  assert.equal(oz.icerik, 'linux');
  assert.equal(oz.setGuncelleme, '0');
});

test('kabul kilidi: derleme BOYUNCA tutulur, sonunda bırakılır', () => {
  const o = ortam();
  const kilit = path.join(o.kok, 'kabul.lock');
  const r = kos(o, o.kaynak, { EMPP_DERLEME_KABUL_KILIDI: '1', KABUL_KILIT: kilit });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const oz = JSON.parse(fs.readFileSync(path.join(o.cikti, 'raw', 'linux', 'ozet.json'), 'utf8'));
  assert.match(oz.kabulKilidi, /damga=derleme-\d+-\d+ /, 'paketleyici koşarken kilit bizde');
  assert.equal(fs.existsSync(kilit), false, 'derleme bitince bırakıldı');
  assert.match(log(o), /kabul kilidi alindi/);
});

test('kabul kilidi: süren kabul varsa bekler; boşalmazsa ERTELENEBİLİR işaretle çıkar, kilide dokunmaz', () => {
  const o = ortam();
  const kilit = path.join(o.kok, 'kabul.lock');
  const icerik = `pid=${process.pid} damga=1790000000 kaynak=baska-ajan zaman=${Math.floor(Date.now() / 1000)}\n`;
  fs.writeFileSync(kilit, icerik);
  const r = kos(o, o.kaynak, { EMPP_DERLEME_KABUL_KILIDI: '1', KABUL_KILIT: kilit, KABUL_BOSLUK_TAVAN: '2', KABUL_BOSLUK_ARALIK: '1' });
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /\[ertelenebilir-probook-erisimi\] kabul kilidi 2 sn bosalmadi/);
  const { ertelenebilirKaynakHatasi } = require('../../src/agent/runner-helpers');
  assert.equal(ertelenebilirKaynakHatasi(`pardus-packager-build.sh rc=1: ${r.stdout.slice(-1500)}`), true, 'runner failed YAZMAZ');
  assert.equal(fs.readFileSync(kilit, 'utf8'), icerik, 'başkasının kilidi aynen');
  assert.equal(fs.existsSync(path.join(o.cikti, 'raw', 'linux', 'ozet.json')), false, 'paketleyici hiç koşmadı');
});

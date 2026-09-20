// KAYNAK KOPYA — canlı yeri: /opt/lane-hazirla.mjs (srv21)
// srv21 ÜRETİM ŞERİDİ — hazırlık + derleme (sunucuda /opt/lane-hazirla.mjs olarak koşar).
// Buradaki değişiklik sunucuya scp ile taşınır; sunucuda elle düzenlenirse
// geri buraya kopyalanır (tek kaynak: depo).
// srv21 ŞERİDİ — kaynağı BURADA hazırlar ve .impark'ı BURADA derler.
//
// Neden burada: Mac'ten srv21'e 1,26 GB yüklemek ölçülen hatta 1,1 MB/s (Tailscale
// rölesi) = ~20 dk; oysa srv21 kaynağı köprüden (R2, aynı veri merkezi) dakikalar
// içinde çeker. Geri dönüş IPsec üzerinden ~4,8 MB/s ölçüldü (Tailscale'in 3,6 katı).
//
// Zincir ajanla AYNI: extractSfx → findBuildDir → applyPublisherUpdate → zip(içerik)
// → zip köküne ico.png → paketleyici (3093, EMPP_SET_MENU=1, K17 yamalı).
//
// Kullanım: node /opt/lane-hazirla.mjs <bookId> "<appName>" "<yayınevi>" "<kaynakUrl>"
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire('/opt/empp-packager/');
const { extractSfx, findBuildDir } = require('./src/agent/runner.js');
const { applyPublisherUpdate } = require('./src/agent/publisher-update.js');

const [bookId, appName, yayinci, kaynakUrlArg] = process.argv.slice(2);
if (!bookId || !appName) {
  console.error('kullanım: lane-hazirla.mjs <bookId> "<appName>" ["<yayınevi>"] ["<kaynakUrl>"]');
  process.exit(2);
}
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const is = `/opt/lane-work/${bookId}`;
// Yarim kalan is: build.zip duruyorsa hazirligi (indirme+acma+zip) TEKRARLAMA — yalniz derle.
const hazirZip = fs.existsSync(path.join(is, 'build.zip'));
if (!hazirZip) {
  fs.rmSync(is, { recursive: true, force: true });
  fs.mkdirSync(is, { recursive: true });
}

const kos = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 1 << 24, ...opts });
  if (r.status !== 0) throw new Error(`${cmd} rc=${r.status}: ${String(r.stderr || '').slice(-300)}`);
  return r.stdout || '';
};

// Kaynak adresi: verilmemişse ajanın next-job'ta aldığı köprü adresini BURADA çöz
// (presigned URL srv21'den hiç çıkmaz — Mac'e yalnız .impark iner).
let kaynakUrl = kaynakUrlArg;
if (!kaynakUrl) {
  const r = spawnSync('node', ['--env-file=.env.production', './kaynak-coz.mjs', String(bookId)],
    { cwd: '/home/ndr/domains/akillitahta.ndr.ist', encoding: 'utf8' });
  kaynakUrl = String(r.stdout || '').trim().split('\t')[1] || '';
  if (!/^https?:/.test(kaynakUrl)) throw new Error(`köprüde kaynak yok: ${bookId} ${String(r.stderr||'').slice(-200)}`);
}
console.log(`SRCVERSION=${decodeURIComponent(new URL(kaynakUrl).pathname.split('/').pop())}`);

const exe = path.join(is, 'source.exe');
const zip = path.join(is, 'build.zip');
if (hazirZip) log('build.zip zaten var — hazırlık atlandı, doğrudan derleme');
if (!hazirZip) {
log('kaynak indiriliyor...');
// Köprü indirmesi yarıda kopabiliyor (ölçüm 2026-09-17: 59835 ve 73768
// `curl (18) transfer closed with N bytes remaining` ile düştü, yeniden deneme YOKTU).
// --retry + -C - : kopan indirme kaldığı yerden 5 kez denenir.
kos('curl', ['-sS', '-L', '--fail', '--retry', '5', '--retry-delay', '5',
  '--retry-all-errors', '--speed-time', '60', '--speed-limit', '10240',
  '-C', '-', '-o', exe, kaynakUrl]);
log('indirildi:', (fs.statSync(exe).size / 1e6).toFixed(0), 'MB');

log('SFX açılıyor...');
const cikarim = path.join(is, 'extracted');
await extractSfx(exe, cikarim);
const buildDir = await findBuildDir(cikarim);
log('build dizini:', buildDir);

try {
  const u = applyPublisherUpdate(buildDir);
  log(`yayıncı güncellemesi: ${u.reason} (${u.from} → ${u.to || '-'}, kurum ${u.companyId || '?'})`);
} catch (e) { log('yayıncı güncellemesi uygulanamadı:', e.message); }

log('zipleniyor...');
kos('zip', ['-r', '-q', '-1', zip, '.'], { cwd: buildDir });
// İkon: ajanın injectPardusIcon'u gibi zip KÖKÜNE ico.png
if (fs.existsSync('/opt/lane-logo.png')) {
  fs.copyFileSync('/opt/lane-logo.png', path.join(is, 'ico.png'));
  kos('zip', ['-j', '-q', zip, 'ico.png'], { cwd: is });
  log('ico.png zip köküne eklendi');
}
log('zip hazır:', (fs.statSync(zip).size / 1e6).toFixed(0), 'MB');
}

log('derleme başlıyor (3093)...');
const out = path.join(is, 'out.impark');
const d = spawnSync('node', ['/opt/empp-packager/lane-build.mjs', zip, out, appName, yayinci || 'YDS Publishing'],
  { stdio: ['ignore', 'inherit', 'inherit'], cwd: '/opt/empp-packager' });
if (d.status !== 0) throw new Error(`derleme düştü rc=${d.status}`);
// Ara ürünleri sil, yalnız .impark kalsın (disk: srv21'de 41 GB boş)
fs.rmSync(cikarim, { recursive: true, force: true });
fs.rmSync(exe, { force: true });
fs.rmSync(zip, { force: true });
// AppRun KAPISI (ölçüm 2026-09-17): şerit kopyasındaki eski şablon yalnız
// zkitap/zkitap.bin/electron arıyordu; electron-builder ikiliyi uygulama adıyla
// yazdığı için ProBook'ta "Executable bulunamadı: .../electron" ile kurulum
// düşüyor, pencere hiç açılmıyordu. Paket burada reddedilirse Mac'e HİÇ inmez.
const apprunDenet = spawnSync('bash', ['-c',
  `unsquashfs -q -f -d /tmp/apprun-denet-$$ -o 193728 ${JSON.stringify(out)} AppRun >/dev/null 2>&1 && ` +
  `grep -c resolve_executable /tmp/apprun-denet-$$/AppRun; rm -rf /tmp/apprun-denet-$$`],
  { encoding: 'utf8' });
const eslesme = parseInt(String(apprunDenet.stdout || '0').trim().split('\n')[0], 10) || 0;
if (eslesme < 1) {
  throw new Error('AppRun KAPISI: üretilen pakette resolve_executable YOK — ' +
    'paketleyicinin apprun-template.sh dosyası eski (ProBook kurulumu düşer)');
}
log(`AppRun kapısı GEÇTİ (resolve_executable x${eslesme})`);
log('HAZIR:', out, (fs.statSync(out).size / 1e6).toFixed(0), 'MB');

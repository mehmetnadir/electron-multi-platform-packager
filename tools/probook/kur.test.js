'use strict';
// kur.sh + empp-serit-agent.service sözleşmeleri (gerçek kurulum ProBook'ta koşar; burada
// geri dönüşü pahalı olacak kuralların kaynak düzeyinde kilidi).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const KUR = fs.readFileSync(path.join(__dirname, 'kur.sh'), 'utf8');
const BIRIM = fs.readFileSync(path.join(__dirname, 'empp-serit-agent.service'), 'utf8');

test('bash sozdizimi gecerli', () => {
  const r = spawnSync('bash', ['-n', path.join(__dirname, 'kur.sh')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

test('sir ve agir dizinler ProBook\'a TASINMAZ (rsync haric listesi)', () => {
  for (const d of ["'.env'", "'.env.*'", "'*.key'", "'*.pem'", 'node_modules', '.git', 'scratchpad', 'uploads', 'temp']) {
    assert.ok(KUR.includes(`--exclude ${d}`), `haric listesinde yok: ${d}`);
  }
});

test('node sistem paketinden DEGIL, sha256 dogrulamali resmi tarball', () => {
  assert.doesNotMatch(KUR, /apt(-get)? install/);
  assert.match(KUR, /SHASUMS256\.txt/);
  assert.match(KUR, /sha256sum -c/);
});

test('silme yok: eski surumler .kaldirildi-* olarak kenara alinir; rm -rf yalniz kendi mktemp dizinine', () => {
  const rmSatirlari = KUR.split('\n').filter((s) => /\brm -rf\b/.test(s));
  for (const s of rmSatirlari) assert.match(s, /rm -rf "\$(T|LT)"/, `beklenmeyen silme: ${s.trim()}`);
  assert.match(KUR, /\.kaldirildi-\$DAMGA/);
});

test('systemd birimi: Restart=always, jeton yoksa baslamaz, X oturumu ortami', () => {
  assert.match(BIRIM, /^Restart=always$/m);
  assert.match(BIRIM, /^ConditionPathExists=%h\/\.empp-agent\/token\.json$/m);
  assert.match(BIRIM, /^Environment=DISPLAY=:0$/m);
  assert.match(BIRIM, /^Environment=XAUTHORITY=%h\/\.Xauthority$/m);
  assert.match(BIRIM, /^WorkingDirectory=%h\/empp-serit\/repo$/m);
  assert.match(BIRIM, /^ExecStart=%h\/empp-serit\/repo\/tools\/probook\/serit-ajan\.sh$/m);
  assert.match(KUR, /loginctl enable-linger/);
});

test('kurulum kaynak arşivini eşler (eski arayüz kapısı); --arsivsiz yalnız bilerek atlar', () => {
  assert.match(KUR, /tools\/probook\/arsiv-esle\.sh" --host "\$HOST"/);
  assert.match(KUR, /--arsivsiz\) ARSIV=0/);
});

test('package-lock.json yoksa (gitignore, worktree) rsync --delete ÖNCESİ durur', () => {
  const iLock = KUR.indexOf('[ -f "$REPO/package-lock.json" ] || die');
  const iRsync = KUR.indexOf('rsync -a --delete');
  assert.ok(iLock > 0 && iLock < iRsync, 'kilit dosyası kapısı rsync --delete\'ten önce');
});

test('unrar kullanıcı düzeyinde, imza zinciriyle (InRelease gpgv → Packages.xz → .deb sha256); apt YOK', () => {
  const g = KUR.slice(KUR.indexOf('unrar_kur(){'), KUR.indexOf('probook_kur(){'));
  assert.match(g, /gpgv --keyring \/usr\/share\/keyrings\/debian-archive-keyring\.gpg/);
  assert.match(g, /Packages\.xz sha256 TUTMADI/);
  assert.match(g, /\.deb sha256 TUTMADI/);
  assert.match(g, /dpkg-deb -x/);
  assert.doesNotMatch(g, /apt(-get)? install|dpkg -i|sudo/);
  assert.match(KUR, /unrar_kur "\$S"/);
  const ortam = fs.readFileSync(path.join(__dirname, 'serit-ortam.sh'), 'utf8');
  assert.match(ortam, /export PATH="[^"]*\$SERIT\/opt\/bin/);
});

test('pipefail tuzağı: unrar_kur boruda erken kapanan süzgeç (| grep -q, | awk ...exit) KULLANMAZ', () => {
  const g = KUR.slice(KUR.indexOf('unrar_kur(){'), KUR.indexOf('probook_kur(){'));
  assert.doesNotMatch(g, /\|\s*grep -q/);
  assert.doesNotMatch(g, /xz -dc[^\n|]*\|(?!\|)/, 'xz çıktısı boruya değil dosyaya');
  assert.match(g, /ln -sfn "\$S\/opt\/unrar\/usr\/bin\/unrar-nonfree" "\$BIN\/unrar"/);
});

test('kanonik kabuk + motor: --arsivsiz olsa da eşlenir, yedekler hariç, ProBook node\'uyla doğrulanır', () => {
  const iArsiv = KUR.indexOf('if [ "$ARSIV" = "1" ]');
  const iKabuk = KUR.indexOf('rsync -a --exclude \'*.onceki-*\' --exclude kanonik.json "$KDIR/"');
  assert.ok(iKabuk > 0 && iKabuk < iArsiv, 'kabuk eşlemesi arşiv koşulundan ÖNCE (koşulsuz)');
  assert.match(KUR, /rsync -a --exclude '\*\.onceki-\*' --exclude kanonik\.json "\$MDIR\/" "\$HOST:\.empp-agent\/motor\/"/);
  // kanonik.json en son (yarım aktarım doğrulanmaz)
  assert.ok(KUR.indexOf('rsync -a "$KDIR/kanonik.json"') > KUR.indexOf('"$KDIR/" "$HOST'));
  assert.match(KUR, /kabuk-kanonik\.js on .*\.empp-agent\/kabuk\/kanonik\.json/);
  assert.match(KUR, /motor-kanonik\.js on .*\.empp-agent\/motor\/kanonik\.json/);
  assert.match(KUR, /YUKLENEMEDI[^\n]*basarisiz/);
  assert.match(KUR, /Mac'te kabuk kanoniği yok/);
});

test('kanonik doğrulama komutu ProBook yoluna göre gerçekten koşar (sahte ssh, geçerli ve bozuk kanonik)', () => {
  const crypto = require('node:crypto');
  const os = require('node:os');
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'kur-kanonik-'));
  const ev = path.join(kok, 'ev'); const kd = path.join(ev, '.empp-agent', 'kabuk', '1.13.3');
  fs.mkdirSync(kd, { recursive: true });
  const main = `${'d'.repeat(20)}.main.js`;
  fs.writeFileSync(path.join(kd, main), 'x');
  const sha = crypto.createHash('sha256').update('x').digest('hex').slice(0, 12);
  fs.writeFileSync(path.join(kd, 'manifest.json'), JSON.stringify({ surum: '1.13.3', main, dosyalar: [{ ad: main, sha12: sha }] }));
  fs.writeFileSync(path.join(ev, '.empp-agent', 'kabuk', 'kanonik.json'), JSON.stringify({ surum: '1.13.3', dizin: '1.13.3' }));
  const arac = path.join(__dirname, '..', 'pardus', 'kabuk-kanonik.js');
  const kos = () => spawnSync(process.execPath, [arac, 'on', path.join(ev, '.empp-agent', 'kabuk', 'kanonik.json')], { encoding: 'utf8' });
  assert.equal(kos().status, 0);
  fs.writeFileSync(path.join(kd, main), 'BOZUK');
  assert.equal(kos().status, 3, 'yüklenemezse kur.sh bu rc ile hata verir');
});

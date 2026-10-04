'use strict';
// pardus-packager-build.sh — Mac docker şeridi, MOTOR KANONİĞİ bağlaması (2026-09-26, E3 / T6 / D-1).
// Betik GERÇEKTEN koşar; `docker` sahte bir ikilidir: argümanları kaydeder ve "konteyneri" taklit
// eder — `-v`/`-e` eşlemesini çözüp GERÇEK `motorDegistir`i konteyner içi yola göre koşturur
// (paketleyicinin konteynerde yaptığı gibi), damga satırını packager.log'a basar. Gerçek Docker
// derlemesi YOK (bellek darlığı); kilit test dizininde (PARDUS_KILIT), canlı kilide dokunulmaz.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const BETIK = path.join(__dirname, 'pardus-packager-build.sh');
const MOTOR_SURUMU = path.join(__dirname, '..', '..', 'src', 'packaging', 'motor-surumu.js');
const MOTOR = '43e23fce2b7009474555a77.js';
const sha12 = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 12);

const SAHTE_DOCKER = `#!/bin/bash
printf '%s\\n' "$*" >> "$DOCKER_IZ"
case "$1" in
  info|image|ps) exit 0 ;;
  run)
    case " $* " in *" --privileged "*) echo binfmt-ok; exit 0 ;; esac
    case " $* " in *impark-dogrula.sh*)
      O=""; prev=""
      for a in "$@"; do [ "$prev" = "-v" ] && case "$a" in *:/o) O="\${a%:/o}" ;; esac; prev="$a"; done
      mkdir -p "$O/dogrula"; echo "zenity: VAR (1 bayt)" > "$O/dogrula/rapor.txt"; exit 0 ;;
    esac
    exec "$SAHTE_NODE" "$SAHTE_KONTEYNER" "$@" ;;
esac
exit 1
`;

// Konteyner taklidi: packagingService'in motor adımı (acikMi → motorDegistir(varsayılan yol) →
// damgaSatiri) — varsayılan yol konteynerin EMPP_MOTOR_KANONIK'i, bağlama yoksa konteyner içinde YOK.
const SAHTE_KONTEYNER = `
const fs = require('fs'); const os = require('os'); const path = require('path');
const M = require(${JSON.stringify(MOTOR_SURUMU)});
const a = process.argv.slice(2); const baglar = []; const env = {};
for (let i = 0; i < a.length; i += 1) {
  if (a[i] === '-v') { const p = a[++i].split(':'); baglar.push([p[0], p[1]]); }
  else if (a[i] === '-e') { const kv = a[++i]; const j = kv.indexOf('='); env[kv.slice(0, j)] = kv.slice(j + 1); }
}
const coz = (c) => { for (const [h, k] of baglar) if (c === k || c.startsWith(k + '/')) return h + c.slice(k.length); return null; };
(async () => {
  const out = coz('/out'); const is = fs.mkdtempSync(path.join(os.tmpdir(), 'konteyner-'));
  const up = path.join(is, 'uploads');
  fs.cpSync(fs.realpathSync(path.join(coz('/in'), 'build')), up, { recursive: true });
  const kanonikC = env.EMPP_MOTOR_KANONIK || '/root/.empp-agent/motor/kanonik.json';
  const kanonikH = coz(kanonikC) || path.join(is, 'konteyner-icinde-yok', 'kanonik.json');
  const d = M.acikMi(env) ? await M.motorDegistir(up, kanonikH) : null;
  fs.mkdirSync(path.join(out, 'linux'), { recursive: true });
  fs.writeFileSync(path.join(out, 'packager.log'), '[io:progress] paketleniyor\\n' + M.damgaSatiri(d) + '\\n');
  fs.writeFileSync(path.join(out, 'linux', 'Deneme-1.0.0.impark'), 'IMPARK');
  const pj = path.join(up, 'paket.json');
  fs.writeFileSync(path.join(out, 'linux', 'paket.json'), fs.existsSync(pj) ? fs.readFileSync(pj) : '{}');
})().catch((e) => { console.error(e); process.exit(1); });
`;

function ortam() {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'pardus-docker-motor-'));
  const bin = path.join(kok, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'docker'), SAHTE_DOCKER, { mode: 0o755 });
  const konteyner = path.join(kok, 'konteyner.js');
  fs.writeFileSync(konteyner, SAHTE_KONTEYNER);
  const build = path.join(kok, 'build');
  fs.mkdirSync(path.join(build, 'book1'), { recursive: true });
  fs.writeFileSync(path.join(build, 'index.html'), 'SET');
  fs.writeFileSync(path.join(build, 'book1', MOTOR), 'YAYINCI-ESKI');
  const ev = path.join(kok, 'ev');
  fs.mkdirSync(ev);
  const env = {
    ...process.env, PATH: `${bin}:${process.env.PATH}`, HOME: ev, PACKAGER_REPO: kok,
    PARDUS_KILIT: path.join(kok, 'kilit.d'), PARDUS_MIN_FREE_GB: '0',
    DOCKER_IZ: path.join(kok, 'docker.iz'), SAHTE_NODE: process.execPath, SAHTE_KONTEYNER: konteyner,
    EMPP_KANONIK_SART: '0', // kabuk fail-closed testleri aşağıda
  };
  delete env.EMPP_MOTOR_KANONIK;
  delete env.EMPP_MOTOR_SURUMU;
  delete env.PARDUS_PARALEL;
  return { kok, build, ev, cikti: path.join(kok, 'out'), env };
}

function kanonikKur(dizin, icerik = 'KANONIK-v2', jsonAdi = 'kanonik.json') {
  fs.mkdirSync(dizin, { recursive: true });
  fs.writeFileSync(path.join(dizin, MOTOR), icerik);
  fs.writeFileSync(path.join(dizin, jsonAdi), JSON.stringify({ sha12: sha12(icerik), surum: '2026.9.12', surumler: {} }));
  return { yol: path.join(dizin, jsonAdi), sha: sha12(icerik) };
}

const kos = (o, ek = {}) => spawnSync('bash', [BETIK, o.build, 'Deneme', o.cikti, '1.0.0'], {
  encoding: 'utf8', env: { ...o.env, ...ek }, timeout: 60000,
});
const derlemeCagrisi = (o) => fs.readFileSync(o.env.DOCKER_IZ, 'utf8').split('\n').find((l) => l.includes('--name pardus-pack-'));
const paketJson = (o) => JSON.parse(fs.readFileSync(path.join(o.cikti, 'raw', 'linux', 'paket.json'), 'utf8'));

test('motor bağlı: ~/.empp-agent/motor doğrulanırsa /motor salt-okur + EMPP_MOTOR_KANONIK; paket motoru kanonik', () => {
  const o = ortam();
  const k = kanonikKur(path.join(o.ev, '.empp-agent', 'motor'));
  const r = kos(o);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const c = derlemeCagrisi(o);
  assert.ok(c.includes(`-v ${fs.realpathSync(path.dirname(k.yol))}:/motor:ro`), c);
  assert.ok(c.includes('-e EMPP_MOTOR_KANONIK=/motor/kanonik.json'), c);
  assert.ok(c.includes('-e EMPP_MOTOR_SURUMU=1'), c);
  assert.match(r.stdout, new RegExp(`motor: kanonik ${k.sha} 2026\\.9\\.12 .*konteynere /motor olarak baglaniyor`));
  assert.match(r.stdout, new RegExp(`motor: paket durum=guncel sha12=${k.sha} kanonik=${k.sha}`));
  assert.doesNotMatch(r.stdout, /UYARI motor/);
  const pj = paketJson(o);
  assert.equal(pj.motorSurumu.sha12, k.sha, 'T6: paket.json.motorSurumu.sha12 = kanonik');
  assert.equal(pj.motorSurumu.degisen, 1);
  assert.ok(fs.existsSync(path.join(o.cikti, 'Deneme-1.0.0.impark')));
});

test('motor bağlı değil: kanonik yoksa bağlama YOK, derleme DURMAZ ama iki UYARI satırı ajan log\'una düşer', () => {
  const o = ortam();
  const r = kos(o, { EMPP_MOTOR_KANONIK: path.join(o.kok, 'yok', 'kanonik.json') });
  assert.equal(r.status, 0, `D-1: önce UYARI, RED değil\n${r.stdout}${r.stderr}`);
  const c = derlemeCagrisi(o);
  assert.ok(!c.includes(':/motor:ro'), c);
  assert.ok(!c.includes('EMPP_MOTOR_KANONIK='), c);
  assert.match(r.stdout, /UYARI motor: kanonik yok ya da doğrulanamadı .* DEĞİŞMEYECEK/);
  assert.match(r.stdout, /UYARI motor: paket motoru kanonik DEĞİL \(durum=bilinmiyor/);
  const pj = paketJson(o);
  assert.equal(pj.motorSurumu.durum, 'bilinmiyor');
  assert.equal(pj.motorSurumu.sha12, sha12('YAYINCI-ESKI'), 'eski motorun izi pakette');
  assert.match(fs.readFileSync(path.join(o.cikti, 'pardus-packager-build.log'), 'utf8'), /UYARI motor: kanonik yok/);
});

test('açık EMPP_MOTOR_KANONIK yolu (farklı dosya adı) aynen konteyner içi yola çevrilir; sha12 FARKLI kanonik', () => {
  const o = ortam();
  kanonikKur(path.join(o.ev, '.empp-agent', 'motor'), 'EV-KANONIGI');
  const k = kanonikKur(path.join(o.kok, 'paylasilan'), 'PAYLASILAN-v3', 'k.json');
  const r = kos(o, { EMPP_MOTOR_KANONIK: k.yol });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(derlemeCagrisi(o).includes('-e EMPP_MOTOR_KANONIK=/motor/k.json'));
  assert.equal(paketJson(o).motorSurumu.sha12, k.sha, 'değişken ev varsayılanını ezer');
});

test('EMPP_MOTOR_SURUMU=0 konteynere geçer (T6 negatif): motor değişmez, "kapali" UYARI', () => {
  const o = ortam();
  kanonikKur(path.join(o.ev, '.empp-agent', 'motor'));
  const r = kos(o, { EMPP_MOTOR_SURUMU: '0' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(derlemeCagrisi(o).includes('-e EMPP_MOTOR_SURUMU=0'));
  assert.match(r.stdout, /UYARI motor: paket motoru kanonik DEĞİL \(durum=kapali/);
  assert.equal(paketJson(o).motorSurumu, undefined);
});

test('PARALEL kip başkasının kilidine dokunmaz (pid ezilmez, dizin silinmez)', () => {
  const o = ortam();
  fs.mkdirSync(o.env.PARDUS_KILIT);
  fs.writeFileSync(path.join(o.env.PARDUS_KILIT, 'pid'), 'baska-build\n');
  const r = kos(o, { PARDUS_PARALEL: '1' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(fs.readFileSync(path.join(o.env.PARDUS_KILIT, 'pid'), 'utf8'), 'baska-build\n');
  const o2 = ortam();
  const r2 = kos(o2, { PARDUS_PARALEL: '1' });
  assert.equal(r2.status, 0, `kilit dizini yokken PARALEL kip düşmemeli\n${r2.stdout}${r2.stderr}`);
});

test('normal kip: kendi kilidini alır ve bırakır', () => {
  const o = ortam();
  const r = kos(o);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(fs.existsSync(o.env.PARDUS_KILIT), false);
});

// OKUYUCU KABUĞU KANONİĞİ (2026-10-04): docker şeridi kabuk kanoniğini hiç bağlamıyordu →
// konteynerde ~/.empp-agent/kabuk yoktu. Artık salt-okur /kabuk; yoksa derleme BAŞLAMADAN düşer.
function kabukKur(ev) {
  const kok = path.join(ev, '.empp-agent', 'kabuk'); const kd = path.join(kok, '1.13.3');
  fs.mkdirSync(kd, { recursive: true });
  const main = `${'d'.repeat(20)}.main.js`;
  fs.writeFileSync(path.join(kd, main), 'x');
  fs.writeFileSync(path.join(kd, 'manifest.json'),
    JSON.stringify({ surum: '1.13.3', main, dosyalar: [{ ad: main, sha12: sha12('x') }] }));
  // Mac'te yazılmış MUTLAK kayıt konteynerde yok → yerel alt dizine düşme yolu da bağlanır.
  fs.writeFileSync(path.join(kok, 'kanonik.json'),
    JSON.stringify({ surum: '1.13.3', dizin: '/Users/baska/.empp-agent/kabuk/1.13.3' }));
  return kok;
}

test('kabuk bağlı: ~/.empp-agent/kabuk doğrulanırsa /kabuk salt-okur + EMPP_KABUK_KANONIK', () => {
  const o = ortam(); const kok = kabukKur(o.ev);
  const r = kos(o, { EMPP_KANONIK_SART: '' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const c = derlemeCagrisi(o);
  assert.ok(c.includes(`-v ${fs.realpathSync(kok)}:/kabuk:ro`), c);
  assert.match(c, /-e EMPP_KABUK_KANONIK=\/kabuk\/kanonik\.json/);
});

test('kabuk yok: şart varsayılan → derleme BAŞLAMADAN düşer (docker hiç koşmaz)', () => {
  const o = ortam();
  const r = kos(o, { EMPP_KANONIK_SART: '' });
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /okuyucu kabugu kanoniği yok \(~\/\.empp-agent\/kabuk\) — eski formatla paket uretilmez/);
  const iz = fs.existsSync(o.env.DOCKER_IZ) ? fs.readFileSync(o.env.DOCKER_IZ, 'utf8') : '';
  assert.doesNotMatch(iz, /--name pardus-pack-/);
});

test('kabuk yok + EMPP_KANONIK_SART=0 → UYARI, derleme sürer, /kabuk bağlanmaz', () => {
  const o = ortam();
  const r = kos(o, { EMPP_KANONIK_SART: '0' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(derlemeCagrisi(o), /:\/kabuk:ro/);
});

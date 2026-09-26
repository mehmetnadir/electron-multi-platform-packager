'use strict';
/**
 * ProBook şeridi kuru koşu gövdesi (kuru-kosu.sh çağırır). runner.js'in GERÇEK fonksiyonları:
 * arsivKaynagi → injectPardusIcon → buildPardusArtifact → pardusKabulKapisi; iş kiralama ve
 * R2/sonuç bildirimi adımları YOK (sunucuya tek istek gitmez). Aşama süreleri ve son denetim
 * `~/empp-serit/kanit/kuru-<kitap>/ozet.json`'a yazılır.
 */
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

function argumanlar(argv) {
  const a = { asama: argv[0] };
  for (let i = 1; i < argv.length; i += 2) a[String(argv[i]).replace(/^--/, '')] = argv[i + 1];
  return a;
}

function md5Dosya(dosya) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('md5');
    fs.createReadStream(dosya).on('error', reject).on('data', (p) => h.update(p)).on('end', () => resolve(h.digest('hex')));
  });
}

function envanter(home) {
  const taban = path.join(home, 'DijiTap');
  const liste = [];
  let kokler = [];
  try { kokler = fs.readdirSync(taban); } catch (_) { return liste; }
  for (const k of kokler.sort()) {
    liste.push(k);
    try { for (const d of fs.readdirSync(path.join(taban, k)).sort()) liste.push(`${k}/${d}`); } catch (_) { /* dosya */ }
  }
  return liste;
}

async function sure(ozet, ad, fn) {
  const t0 = Date.now();
  try { return await fn(); } finally {
    ozet.sureler[ad] = Math.round((Date.now() - t0) / 100) / 10;
    console.log(`[kuru] ASAMA ${ad} ${ozet.sureler[ad]} sn`);
  }
}

async function main(argv = process.argv.slice(2)) {
  const a = argumanlar(argv);
  if (!a.kitap || !['derle', 'kabul', 'temizle'].includes(a.asama)) {
    console.error('kullanim: <derle|kabul|temizle> --kitap <id> [--baslik ..] [--yayinci ..] [--kaynak build.zip]');
    process.exit(2);
  }
  const serit = process.env.EMPP_SERIT_KOK || path.join(os.homedir(), 'empp-serit');
  const kanit = path.join(serit, 'kanit', `kuru-${a.kitap}`);
  await fsp.mkdir(kanit, { recursive: true });
  const durumYolu = path.join(kanit, 'ozet.json');
  let ozet = { kitap: a.kitap, sureler: {} };
  try { ozet = { ...ozet, ...JSON.parse(await fsp.readFile(durumYolu, 'utf8')) }; } catch (_) { /* ilk aşama */ }
  const yaz = () => fsp.writeFile(durumYolu, `${JSON.stringify(ozet, null, 1)}\n`);
  const runner = require('../../src/agent/runner.js');

  if (a.asama === 'derle') {
    const { arsivKaynagi } = require('../../src/agent/kaynak-arsivi');
    const { asciiAppName } = require('../../src/agent/runner-helpers');
    ozet = { kitap: a.kitap, baslik: a.baslik, yayinci: a.yayinci, sureler: {}, baslama: new Date().toISOString(),
      envanterOnce: envanter(os.homedir()), surum: (() => { try { return fs.readFileSync(path.join(__dirname, '..', '..', '.serit-surum'), 'utf8').trim(); } catch (_) { return '?'; } })() };
    const arsiv = a.kaynak ? null : await sure(ozet, 'arsiv-md5', () => arsivKaynagi(a.kitap));
    const kaynak = a.kaynak || (arsiv && arsiv.zip);
    if (!kaynak) throw new Error(`kaynak yok: ${a.kitap} arşivde kayıtlı değil ve --kaynak verilmedi`);
    ozet.kaynak = { yol: kaynak, boyut: fs.statSync(kaynak).size, srcVersion: arsiv ? arsiv.srcVersion : 'elle' };
    const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'empp-agent-'));
    ozet.work = work;
    const zip = path.join(work, 'build.zip');
    await sure(ozet, 'kaynak-kopya', () => fsp.copyFile(kaynak, zip, fs.constants.COPYFILE_FICLONE));
    const ikon = await sure(ozet, 'ikon', () => runner.injectPardusIcon(zip, a.yayinci, work));
    ozet.ikon = ikon;
    if (!ikon) throw new Error(`logo eşleşmedi (${a.yayinci}) — logo kuralı: üretim durur`);
    const artifact = path.join(work, 'artifact.impark');
    runner.CONFIG.pardusKabul = false; // kabul AYRI aşama (Şef'e haber verildikten sonra)
    await yaz();
    await sure(ozet, 'derleme+butunluk', () => runner.buildPardusArtifact(
      zip, asciiAppName(a.baslik, `book-${a.kitap}`), '1.0.0', artifact, work, { bookId: a.kitap, srcVersion: ozet.kaynak.srcVersion },
    ));
    ozet.artifact = { yol: artifact, boyut: fs.statSync(artifact).size, md5: await md5Dosya(artifact) };
    try {
      const log = fs.readFileSync(path.join(work, 'pardus-out', 'pardus-packager-build.log'), 'utf8');
      ozet.betikAsamalari = Object.fromEntries([...log.matchAll(/ASAMA (\S+) (\d+)/g)].map((m) => [m[1], Number(m[2])]));
      const bitti = log.match(/bitti: (\d+) sn/);
      ozet.betikToplam = bitti ? Number(bitti[1]) : null;
    } catch (_) { /* log yok */ }
    await yaz();
    console.log(`[kuru] derleme tamam: ${artifact} (${(ozet.artifact.boyut / 1e6).toFixed(0)} MB, md5 ${ozet.artifact.md5})`);
    return;
  }

  if (a.asama === 'kabul') {
    if (!ozet.artifact) throw new Error('önce derle aşaması');
    runner.CONFIG.pardusKabul = true;
    const outDir = path.join(ozet.work, 'pardus-out');
    try {
      await sure(ozet, 'kabul', () => runner.pardusKabulKapisi(ozet.artifact.yol, outDir, ozet.baslik));
      ozet.kabul = 'GECTI';
    } catch (e) {
      ozet.kabul = `RED: ${String(e.message).slice(0, 400)}`;
    }
    await fsp.cp(path.join(outDir, 'probook-kabul'), path.join(kanit, 'probook-kabul'), { recursive: true }).catch(() => {});
    await yaz();
    console.log(`[kuru] kabul: ${ozet.kabul}`);
    return;
  }

  // temizle — runner iş sonu (finally) ile aynı: iş dizini tamamen kaldırılır; sonra B.3 denetimi.
  if (ozet.work) await sure(ozet, 'temizlik', () => fsp.rm(ozet.work, { recursive: true, force: true }));
  const workKalan = fs.readdirSync(path.join(serit, 'work')).filter((d) => d.startsWith('empp-agent-') || d.startsWith('app-'));
  const home = os.homedir();
  const envSonra = envanter(home);
  const tmpKabul = fs.readdirSync('/tmp').filter((f) => /^kabul-/.test(f));
  ozet.denetim = {
    workKalan: workKalan.length,
    envanterAyni: JSON.stringify(envSonra) === JSON.stringify(ozet.envanterOnce || []),
    envanterFark: envSonra.filter((x) => !(ozet.envanterOnce || []).includes(x)),
    kabulgizli: envSonra.filter((x) => x.includes('.kabulgizli-')).length,
    tmpKabul,
    kabulKilidi: fs.existsSync(path.join(home, '.kabul.lock')),
    manifest: fs.readdirSync(home).filter((f) => /^\.kabul-.*\.manifest$/.test(f)),
    disk: (() => { const s = fs.statfsSync(serit); return { bosGb: Math.floor((s.bavail * s.bsize) / 1e9), dolulukYuzde: Math.round((1 - s.bfree / s.blocks) * 100) }; })(),
  };
  await yaz();
  console.log(`[kuru] denetim: ${JSON.stringify(ozet.denetim)}`);
}

if (require.main === module) {
  main().catch((e) => { console.error('[kuru] HATA:', e.message); process.exit(1); });
}

module.exports = { argumanlar, envanter };

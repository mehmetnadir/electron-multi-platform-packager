#!/usr/bin/env node
'use strict';
/**
 * G örtüsü (mac + Pardus) MUTASYON KANITI — her mutant tek bir kuralı bozar; ilgili testler
 * DÜŞMELİ ("öldü"). Hayatta kalan mutant = testin görmediği kural.
 *
 * Canlı ağaca DOKUNMAZ: `src/` geçici bir kopyaya alınır, mutant orada uygulanır, testler orada
 * koşar (node_modules bağla). Kullanım (ağır iş → semafor):
 *   ~/.empp-agent/agir.sh gel-e node tools/g-kanal/ortu-mutasyon.js [--calisma <dizin>] [--yalniz M3,M7]
 * Çıkış: 0 hepsi öldü · 1 hayatta kalan var · 2 mutant uygulanamadı (kaynak kaydı).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const KOK = path.resolve(__dirname, '..', '..');
const KG = 'src/runtime/kitap-guncelleyici.js';
const K = 'src/runtime/icerik-guncelleme.js';
const EN = 'src/packaging/guncelleyici-enjekte.js';
const T_ORTU = 'src/runtime/kitap-guncelleyici-ortu.test.js';
const T_E2E = 'src/runtime/kitap-guncelleyici-ortu-e2e.test.js';
const T_ESKI = 'src/runtime/kitap-guncelleyici.test.js';
const T_K = 'src/runtime/icerik-guncelleme.test.js';
const T_EN = 'src/packaging/guncelleyici-enjekte.test.js';

const MUTANTLAR = [
  { id: 'M1', ne: 'Windows da örtü kipine düşer', dosya: KG,
    eski: "if (o.platform === 'win32') return { tur: 'yerinde', sebep: 'windows' };", yeni: '', test: [T_ORTU, T_EN] },
  { id: 'M2', ne: 'mac örtüsü userData yerine .app yanına (kurulum dizini)', dosya: KG,
    eski: "return { tur: 'ortu', ortuKoku: nodePath.join(ud, ORTU_DIZIN_ADI), kaynak: 'userData' };",
    yeni: "return { tur: 'ortu', ortuKoku: nodePath.join(nodePath.dirname(asar || o.kok), ORTU_DIZIN_ADI), kaynak: 'userData' };", test: [T_ORTU] },
  { id: 'M3', ne: 'açılışta manifest imzası doğrulanmaz', dosya: KG,
    eski: "if (!manifestImzasiGecerliMi(mHam, etkin.imza, set.imzaAnahtari)) return red('imza-gecersiz');", yeni: '', test: [T_ORTU] },
  { id: 'M4', ne: 'taban kimliği (yeni paket) denetlenmez', dosya: KG,
    eski: "if (etkin.tabanKimligi !== tk) return red('taban-degisti');", yeni: '', test: [T_ORTU] },
  { id: 'M5', ne: 'örtü nesnesinin özeti doğrulanmaz', dosya: KG,
    eski: "try { gecerli = sha256(fsS.readFileSync(y)) === e.sha256; } catch (x) { gecerli = false; }",
    yeni: 'gecerli = true;', test: [T_ORTU] },
  { id: 'M6', ne: 'çıkarılan kitap gizlenmez', dosya: KG,
    eski: "if (d.cikarilan.has(dal)) return { tur: 'yok' };", yeni: '', test: [T_ORTU, T_E2E] },
  { id: 'M7', ne: 'eklenen kitapta listesiz dosya pakete düşer', dosya: KG,
    eski: "if (!e) return { tur: 'yok' };", yeni: 'if (!e) return null;', test: [T_ORTU] },
  { id: 'M8', ne: 'pakette güncel olan kabuk dosyası da indirilir', dosya: KG,
    eski: 'if (taban && taban.length === g.boyut && sha256(taban) === sha) continue; // paketteki güncel', yeni: '', test: [T_ORTU] },
  { id: 'M9', ne: 'imzalı dosya listesi olmadan kitap eklenir', dosya: KG,
    eski: '    const dosyalar = kitapDosyalariDogrula(g.dosyalar);\n    if (!dosyalar) {',
    yeni: '    const dosyalar = kitapDosyalariDogrula(g.dosyalar) || [];\n    if (false) {', test: [T_ORTU] },
  { id: 'M10', ne: 'arşivden çıkan dosyanın özeti listeyle kıyaslanmaz', dosya: KG,
    eski: "if (veri.length !== d.boyut || sha256(veri) !== d.sha256) throw new Error('dosya-ozeti-uyusmaz:' + y);",
    yeni: '', test: [T_ORTU] },
  { id: 'M11', ne: 'kabuk eksikken de örtü kesinleşir', dosya: KG,
    eski: "  if (kabukBasarisiz > 0) {\n    await temizle();\n    rapor.durum = 'kismi';",
    yeni: "  if (false) {\n    await temizle();\n    rapor.durum = 'kismi';", test: [T_ORTU] },
  { id: 'M12', ne: 'nesneler paket gövdesine yazılır', dosya: KG,
    eski: 'const nesneKoku = nodePath.join(ortuKoku, ORTU_NESNE);\n  const geciciKok',
    yeni: 'const nesneKoku = nodePath.join(kok, ORTU_NESNE);\n  const geciciKok', test: [T_ORTU, T_E2E] },
  { id: 'M13', ne: 'budama bu oturumun nesnelerini de siler', dosya: KG,
    eski: 'gereken, OTURUM.get(ortuKoku), gunluk);', yeni: 'gereken, null, gunluk);', test: [T_ORTU] },
  { id: 'M14', ne: 'örtü yokken de file: kancası kurulur', dosya: KG,
    eski: "if (!fsS.existsSync(nodePath.join(ortuKoku, ORTU_ETKIN))) return { durum: 'ortu-bos', ortuKoku };",
    yeni: '', test: [T_ORTU] },
  { id: 'M15', ne: 'gizlenen yol 404 yerine paketten sunulur', dosya: KG,
    eski: 'if (r && r.yok) { cb({ error: NET_DOSYA_YOK }); return; }', yeni: '', test: [T_ORTU, T_K] },
  { id: 'M16', ne: 'Node require ile yüklenen dosyalar örtüye yazılır', dosya: KG,
    eski: 'if (p.length === 1 && ORTU_ETKISIZ_KOK.has(p[0])) return true;', yeni: '', test: [T_ORTU] },
  { id: 'M17', ne: 'örtü kipinde yerinde (gövdeye) yazılır', dosya: KG,
    eski: '    if (ortuKoku) {\n      await ortuyaUygula({', yeni: '    if (false) {\n      await ortuyaUygula({', test: [T_ORTU, T_E2E] },
  { id: 'M18', ne: 'guncellemeyiBaslat kip kararını yok sayar', dosya: KG,
    eski: "      ortuKoku: ortuKipi ? kip.ortuKoku : '',", yeni: "      ortuKoku: '',", test: [T_ORTU, T_E2E] },
  { id: 'M19', ne: 'yarım üyelikte etkin yine yazılır', dosya: KG,
    eski: "  if (rapor.uyelikBasarisiz > 0) {\n    await temizle();", yeni: "  if (false) {\n    await temizle();", test: [T_ORTU] },
  { id: 'M20', ne: 'K zincire bağlanmaz (iki file: kaydı)', dosya: K,
    eski: "if (zincir && typeof zincir.ekle === 'function' && typeof zincir.kur === 'function') {",
    yeni: 'if (false) {', test: [T_K] },
  { id: 'M21', ne: 'K zincir yokken de zincir yoluna girer (bugünkü Pardus kaydı bozulur)', dosya: K,
    eski: 'var zincir = kapsam && kapsam.__emppDosyaOrtusu;',
    yeni: "var zincir = kapsam && (kapsam.__emppDosyaOrtusu || require('./kitap-guncelleyici.js').dosyaOrtusuZinciri(kapsam));",
    test: [T_K] },
  { id: 'M22', ne: 'enjeksiyon bloğu örtüyü kurmaz', dosya: EN,
    eski: "    try { require('./${MODUL_ADI}').ortuSunucusunuKur({ electron: __emppElectron, kok: __dirname }); } catch (e) {}\n",
    yeni: '', test: [T_EN] },
  { id: 'M23', ne: 'zincir aynı şemaya ikinci kez kayıt yapar', dosya: KG,
    eski: 'if (z.kurulu) return { yontem: z.kurulu, yeni: false };', yeni: '', test: [T_K] },
  { id: 'M24', ne: 'https dışı taban (loopback olmayan http) kabul edilir', dosya: KG,
    eski: "if (u.protocol === 'http:') return YEREL_HOSTLAR.has(u.hostname);", yeni: "if (u.protocol === 'http:') return true;",
    test: [T_ESKI] },
];

function arg(ad) { const i = process.argv.indexOf(ad); return i === -1 ? null : process.argv[i + 1]; }

/** Koşu başında `src/`'nin TEK anlık görüntüsü alınır (koşu sürerken ağaç değişse de her mutant aynı tabanda). */
function kopyala(hedef, anlik) {
  fs.rmSync(hedef, { recursive: true, force: true });
  fs.mkdirSync(hedef, { recursive: true });
  fs.cpSync(anlik, path.join(hedef, 'src'), { recursive: true });
  fs.symlinkSync(path.join(KOK, 'node_modules'), path.join(hedef, 'node_modules'));
}

function testKos(cal, testler) {
  const bas = Date.now();
  const r = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...testler], {
    cwd: cal, encoding: 'utf8', timeout: 240000, env: { ...process.env, NODE_OPTIONS: '' },
  });
  const ozet = (r.stdout || '').match(/ℹ (pass|fail) \d+/g) || [];
  return { rc: r.status, ms: Date.now() - bas, ozet: ozet.join(' '), zamanAsimi: r.error && r.error.code === 'ETIMEDOUT' };
}

function main() {
  const cal = arg('--calisma') || path.join(os.tmpdir(), `g-ortu-mutasyon-${process.pid}`);
  const yalniz = (arg('--yalniz') || '').split(',').filter(Boolean);
  const liste = MUTANTLAR.filter((m) => !yalniz.length || yalniz.includes(m.id));
  const anlik = `${cal}-anlik`;
  fs.rmSync(anlik, { recursive: true, force: true });
  fs.cpSync(path.join(KOK, 'src'), anlik, { recursive: true });
  const sonuc = [];
  let uygulanamadi = 0;
  for (const m of liste) {
    kopyala(cal, anlik);
    const dosya = path.join(cal, m.dosya);
    const s = fs.readFileSync(dosya, 'utf8');
    const adet = s.split(m.eski).length - 1;
    if (adet !== 1) {
      uygulanamadi += 1;
      console.log(`${m.id} UYGULANAMADI (eşleşme ${adet}) — ${m.ne}`);
      sonuc.push({ ...m, durum: 'uygulanamadi' });
      continue;
    }
    fs.writeFileSync(dosya, s.replace(m.eski, m.yeni));
    const r = testKos(cal, m.test);
    const durum = r.rc === 0 ? 'HAYATTA' : 'öldü';
    console.log(`${m.id} ${durum} (${r.ozet}, ${r.ms} ms${r.zamanAsimi ? ', ZAMAN AŞIMI' : ''}) — ${m.ne}`);
    sonuc.push({ id: m.id, ne: m.ne, dosya: m.dosya, durum, ozet: r.ozet });
  }
  fs.rmSync(cal, { recursive: true, force: true });
  fs.rmSync(anlik, { recursive: true, force: true });
  const olen = sonuc.filter((x) => x.durum === 'öldü').length;
  console.log(`ÖZET: ${olen}/${liste.length} mutant öldü, hayatta ${sonuc.filter((x) => x.durum === 'HAYATTA').length}, uygulanamadı ${uygulanamadi}`);
  if (uygulanamadi) process.exit(2);
  process.exit(olen === liste.length ? 0 : 1);
}

if (require.main === module) main();
module.exports = { MUTANTLAR };

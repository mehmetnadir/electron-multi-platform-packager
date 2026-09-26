#!/usr/bin/env node
'use strict';
/**
 * G ANDROID — MUTASYON KANITI (üç güvenlik kuralı: monoton sürüm · set kimliği · ya hep ya hiç).
 *
 * Her mutant kuralı koruyan TEK satırı bozar; ilgili test takımı düşmeli ("ÖLDÜ"). Yaşayan
 * mutant = o kuralı hiçbir test korumuyor demektir → çıkış kodu 1.
 *
 * GÜVENLİK: depo ağacına HİÇ yazmaz. Gerekli dosyalar geçici dizine kopyalanır, mutant orada
 * uygulanır ve koşulur; sonda depo dosyalarının sha256'sı değişmemiş olmalı (denetlenir).
 *
 *   node tools/g-android/g-mutasyon.js [--grup js|java] [--kimlik M1,M2]
 * (Java grubu javac ister; mutant başına ~20-25 sn.)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const KOK = path.resolve(__dirname, '..', '..');
const KOPYA = [
  'src/platforms/android/empp-g-istemci.js',
  'src/platforms/android/empp-g-istemci.test.js',
  'src/platforms/android/g-katmani.js',
  'src/platforms/android/g-katmani.test.js',
  'src/platforms/android/g-java.test.js',
  'src/platforms/android/g-java',
  'src/platforms/android/vendor',
  'src/packaging/set-kabuk.js',
  'src/packaging/packagingService.js',
];
const ISTEMCI = 'src/platforms/android/empp-g-istemci.js';
const KATMAN = 'src/platforms/android/g-java/com/empp/g/EmppGKatman.java';
const JS_TEST = { dosya: 'src/platforms/android/empp-g-istemci.test.js' };
const JAVA_TEST = { dosya: 'src/platforms/android/g-java.test.js', desen: 'JVM birim' };

/** [kimlik, kural, açıklama, dosya, test, [[eski, yeni], …]] — her eski metin TAM BİR KEZ geçmeli. */
const MUTANTLAR = [
  ['M1', 'monoton', 'manifest: kurulu sürüme eşit/eski imzalı manifest kabul', ISTEMCI, JS_TEST,
    [["    if (kurulu && gSurumCoz(kurulu) && gSurumKiyasla(n.surum, kurulu) <= 0) return 'surum-eski';\n", '']]],
  ['M2', 'monoton', 'surum.json tetiği: EŞİT sürüm için manifest istenir (<= → <)', ISTEMCI, JS_TEST,
    [['if (kurulu && gSurumCoz(uzakSurum) && gSurumKiyasla(uzakSurum, kurulu) <= 0) {',
      'if (kurulu && gSurumCoz(uzakSurum) && gSurumKiyasla(uzakSurum, kurulu) < 0) {']]],
  ['M3', 'monoton', 'paket sürümü kurulu tabanına girmez (yalnız son G)', ISTEMCI, JS_TEST,
    [['kurulu = enBuyukGSurum([yerelSurum, paketSurumu]);', 'kurulu = enBuyukGSurum([yerelSurum]);']]],
  ['M4', 'monoton', 'sürüm kıyası sözlük sırasıyla (2.51.10 < 2.51.9)', ISTEMCI, JS_TEST,
    [['if (x.sayac !== y.sayac) return x.sayac < y.sayac ? -1 : 1;',
      'if (x.sayac !== y.sayac) return String(x.sayac) < String(y.sayac) ? -1 : 1;']]],
  ['M5', 'monoton', 'G3 dışı (içerik-hash) manifest sürümü kabul', ISTEMCI, JS_TEST,
    [["    if (!gSurumCoz(n.surum)) return 'surum-bicimi';\n", '']]],
  ['M6', 'monoton', 'Java uygula: EŞİT sürüm kabul (<= → <)', KATMAN, JAVA_TEST,
    [['if (kiyas != null && kiyas <= 0)', 'if (kiyas != null && kiyas < 0)']]],
  ['M7', 'monoton', 'Java uygula: G3 dışı sürüm kabul', KATMAN, JAVA_TEST,
    [['        if (gSurumCoz(p.surum) == null) throw new IOException("surum-bicimi");\n', '']]],
  ['M8', 'kimlik', 'manifest.setKimligi gömülü kimlikle kıyaslanmaz (yalnız varlığı)', ISTEMCI, JS_TEST,
    [["if (mk === null || setKimligi == null || mk !== String(setKimligi)) return 'baska-set';",
      "if (mk === null) return 'baska-set';"]]],
  ['M9', 'kimlik', 'kanal G denetimi yok', ISTEMCI, JS_TEST,
    [["    if (n.kanal !== KANAL) return 'kanal-g-degil';\n", '']]],
  ['M10', 'kimlik', 'surum.json başka seti söylese de manifest istenir', ISTEMCI, JS_TEST,
    [["throw new Bitis('atlandi', 'uzak-baska-set');", 'void 0;']]],
  ['M11', 'kimlik', 'kimlik/sürüm kararı uygulanmaz (denetim çağrılıp yok sayılır)', ISTEMCI, JS_TEST,
    [["      if (kimlikRed) throw new Bitis('red', 'manifest-reddedildi:' + kimlikRed);\n", '']]],
  ['M12', 'ya-hep-ya-hic', 'inmeyen kitap atlanır, kalanıyla uygulanır', ISTEMCI, JS_TEST,
    [["throw new Bitis('atlandi', 'kitap-alinamadi:' + k.dizin + ':' + ((e && e.message) || ''));", 'return;']]],
  ['M13', 'ya-hep-ya-hic', 'inmeyen kabuk dosyası atlanır, kalanıyla uygulanır', ISTEMCI, JS_TEST,
    [["throw new Bitis('red', 'kabuk-indirilemedi:' + g.yol);", 'return;']]],
  ['M14', 'ya-hep-ya-hic', 'Java yaz: hazırlık yerine CANLI depoya yazar', KATMAN, JAVA_TEST,
    [['        dizinKur(hazirlikDepo);\n        File gecici = new File(hazirlikDepo, sha + ".yaziliyor");',
      '        dizinKur(depo);\n        File gecici = new File(depo, sha + ".yaziliyor");'],
     ['        tasi(gecici, new File(hazirlikDepo, sha));', '        tasi(gecici, new File(depo, sha));']]],
  ['M15', 'ya-hep-ya-hic', 'Java kitapKur: arşivi hazırlık yerine CANLI kitap/ altına açar', KATMAN, JAVA_TEST,
    [['            File hazir = new File(hazirlikKitap, klasor);', '            File hazir = new File(kitapKok, klasor);'],
     ['            dizinKur(indirme);\n', '            dizinKur(indirme);\n            dizinKur(kitapKok);\n']]],
];

function argumanlar(argv) {
  const a = { grup: null, kimlik: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--grup') a.grup = argv[++i];
    else if (argv[i] === '--kimlik') a.kimlik = new Set(String(argv[++i]).split(','));
  }
  return a;
}

function ozet(dosya) {
  const h = crypto.createHash('sha256');
  const gez = (p) => {
    const st = fs.statSync(p);
    if (st.isDirectory()) for (const c of fs.readdirSync(p).sort()) gez(path.join(p, c));
    else h.update(p).update(fs.readFileSync(p));
  };
  gez(dosya);
  return h.digest('hex');
}

function kos(dizin, t) {
  const arg = ['--test'];
  if (t.desen) arg.push('--test-name-pattern', t.desen);
  arg.push(t.dosya);
  const r = spawnSync(process.execPath, arg, { cwd: dizin, encoding: 'utf8', timeout: 110000 });
  const cikti = `${r.stdout || ''}${r.stderr || ''}`;
  const satirlar = cikti.split('\n').map((l) => l.trim());
  const kaldi = satirlar.filter((l) => l.startsWith('KALDI'));
  const dusenTest = satirlar.filter((l) => l.startsWith('✖ ') && !/failing tests/.test(l));
  const dusen = [...new Set(kaldi.length ? kaldi : dusenTest)].slice(0, 2).map((l) => l.slice(0, 110));
  const gecen = /ℹ pass (\d+)/.exec(cikti);
  return { gecti: r.status === 0, dusen, gecen: gecen ? Number(gecen[1]) : 0, zamanAsimi: !!r.error };
}

function main() {
  const a = argumanlar(process.argv.slice(2));
  const secili = MUTANTLAR.filter((m) => (!a.kimlik || a.kimlik.has(m[0]))
    && (!a.grup || (a.grup === 'java' ? m[4] === JAVA_TEST : m[4] === JS_TEST)));
  if (!secili.length) { console.error('seçili mutant yok'); process.exit(2); }

  const once = Object.fromEntries(KOPYA.map((p) => [p, ozet(path.join(KOK, p))]));
  const gecici = fs.mkdtempSync(path.join(os.tmpdir(), 'g-android-mut-'));
  for (const p of KOPYA) fs.cpSync(path.join(KOK, p), path.join(gecici, p), { recursive: true });

  // Taban: mutasyonsuz kopya GEÇMELİ (yoksa "öldü" kanıt değildir).
  for (const t of new Set(secili.map((m) => m[4]))) {
    const r = kos(gecici, t);
    console.log(`TABAN ${t.dosya}${t.desen ? ` [${t.desen}]` : ''}: ${r.gecti ? 'GEÇTİ' : 'DÜŞTÜ'} (${r.gecen} test)`);
    if (!r.gecti) { console.error(r.dusen.join('\n')); process.exit(2); }
  }

  let yasayan = 0;
  for (const [kimlik, kural, aciklama, dosya, t, degisiklikler] of secili) {
    const hedef = path.join(gecici, dosya);
    const asil = fs.readFileSync(hedef, 'utf8');
    let m = asil;
    for (const [eski, yeni] of degisiklikler) {
      const n = m.split(eski).length - 1;
      if (n !== 1) { console.error(`${kimlik}: hedef metin ${n} kez geçiyor — mutant geçersiz`); process.exit(2); }
      m = m.replace(eski, () => yeni);
    }
    fs.writeFileSync(hedef, m);
    let r;
    try { r = kos(gecici, t); } finally { fs.writeFileSync(hedef, asil); }
    const sonuc = r.gecti ? 'YAŞADI' : 'ÖLDÜ';
    if (r.gecti) yasayan += 1;
    console.log(`${kimlik.padEnd(4)} ${kural.padEnd(14)} ${sonuc.padEnd(7)} ${aciklama}`);
    if (!r.gecti) for (const l of r.dusen) console.log(`       ↳ ${l}`);
  }

  for (const p of KOPYA) {
    if (ozet(path.join(KOK, p)) !== once[p]) { console.error(`DEPO DEĞİŞTİ: ${p}`); process.exit(3); }
  }
  console.log(`SONUÇ: ${secili.length - yasayan}/${secili.length} mutant öldü; depo dokunulmadı (geçici: ${gecici})`);
  process.exit(yasayan ? 1 : 0);
}

main();

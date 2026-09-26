'use strict';
/**
 * KANAL K (İMPARK KİTAP İÇERİK GÜNCELLEMESİ) BAŞSIZ KABUL SENARYOSU.
 *
 * NEDEN (2026-09-26, Nadir kararı — karar defteri C4 "mac imzalı derlemede ölçülünce"):
 * `guncellik-bekci-sozlesmesi.md` "macOS · K" satırı: "Kapıyı macos'a açmak; başsız kabulde
 * K senaryosu (yok)". Bu dosya o eksik senaryo — `basliksiz-kabul.js`in içerik/imza/cihaz
 * katmanlarından AYRI, çünkü K bir paket-görünüm testi değil bir VERİ AKIŞI testidir:
 * gerçek bir `ZKitapZipH/<id>-<v>.zip` İNER, `src/runtime/icerik-guncelleme.js`'İN GERÇEK
 * kodu (adm-zip sarmalayıcı + geçici-aç-doğrula-taşı + menü süzgeci) ile AÇILIR, kitabın
 * menüdeki (`ImWin32.dll`) sürümü İLERLER ve diskteki içerik (BookContent.xml + sayfalar)
 * GERÇEKTEN değişir. Sahte "Kitap Güncellendi" (menü ilerledi ama içerik hiç açılmadı/
 * doğrulanmadı) burada RED sayılır — tıpkı üretim kodundaki `menuSuz` süzgecinin yaptığı gibi.
 *
 * Platform BAĞIMSIZ: motor mac/Pardus/Windows'ta AYNI `runtime/icerik-guncelleme.js`'i
 * kullanır (paketleme anı kopyası, bkz. `src/packaging/icerik-guncelleme.js`); bu senaryo
 * o gerçek dosyayı require eder, mock'lamaz. Yalnız Electron'un kendisi (BrowserWindow,
 * gerçek motor JS bundle'ı) burada YOK — bu bilinçli bir sınır (aşağıya bkz), tam paket
 * GUI kanıtı için `basliksiz-kabul.js`in içerik katmanı ayrıca koşmalı.
 *
 * KAPSAM VE SINIR:
 *   İÇİNDE: gerçek zip indirme (veya elle verilmiş zip), gerçek adm-zip açma, gerçek
 *           doğrulama (BookContent.xml md5 + girdi tamlığı), gerçek menü süzgeci
 *           (ImWin32.dll kodlama/çözme, sürüm ilerlemesi/reddi), gerçek sayfa dosyalarının
 *           diskte VAR olduğu ve BASE'in ÖNÜNE geçtiği (dosyaEsle/file: örtüsü ile aynı kural).
 *   DIŞINDA: motorun kendi React/JS bundle'ının GERÇEKTEN bu sayfayı render etmesi (o,
 *           `basliksiz-kabul.js`in Electron koşumu + gerçek paketlenmiş app.asar'ı ister).
 *
 * KULLANIM:
 *   node tools/kabul/icerik-guncelleme-kabul.js <zip> [--kitap-id ID] [--eski-surum N]
 *        [--yeni-surum N] [--kanit DIR] [--bozuk] [--calisma DIR] [--tut]
 *   <zip> gerçek bir ZKitapZipH indirmesi (ör. `curl -o 57806-4.zip
 *   https://akillitahta.ydspublishing.com/Uploads/ZKitapZipH/57806-4.zip`). --kitap-id/
 *   --yeni-surum verilmezse dosya adından (`<id>-<v>.zip`) türetilir.
 * ÇIKIŞ: 0 GEÇTİ · 1 RED · 2 kullanım hatası · 3 ÖLÇÜLEMEDİ (olcutler.js DURUM/CIKIS_KODU ile aynı).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const runtimeIcerik = require('../../src/runtime/icerik-guncelleme');
const { makeResolver } = require('../../src/platforms/common/fs-shim');
const O = require('./olcutler');

const KITAP_ID_ADI_RE = /^(\d{3,})-(\d+)\.zip$/i;

/** Dosya adından (`<id>-<v>.zip`) kitap id + sürümü türetir. Saf. @returns {{id:string,surum:number}|null} */
function adlaTuret(zipYolu) {
  const m = KITAP_ID_ADI_RE.exec(path.basename(String(zipYolu || '')));
  return m ? { id: m[1], surum: Number(m[2]) } : null;
}

/** Gerçek motor biçimiyle (bkz. `icerik-guncelleme.test.js` `menu()`) tek kapaklı menü XML'i. Saf. */
function menuXml(id, surum, url) {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<main activation="false" key="" label="İmpark Eğitim" bookUpdate="true" lisans="">\n'
    + '  <Group ID="0" label="">\n    <Tab ID="0" label="">\n'
    + `      <cover guId="" ID="${id}" source="assets/${id}/cover.png" URL="${url || `/Uploads/ZKitapZip/${id}-${surum}.zip`}" `
    + `version="${surum}" activation="false" xmlSource="assets/${id}/data/BookContent.xml"/>\n`
    + '    </Tab>\n  </Group>\n</main>';
}

function encodeMenu(id, surum) {
  // menuKodla rastgele dolgu kullanır — motorun KENDİ biçimiyle birebir (bkz. runtime modülü başlığı).
  return runtimeIcerik.menuKodla(menuXml(id, surum));
}

function copyDirSync(kaynak, hedef) {
  fs.mkdirSync(hedef, { recursive: true });
  for (const ad of fs.readdirSync(kaynak)) {
    const k = path.join(kaynak, ad); const h = path.join(hedef, ad);
    const st = fs.statSync(k);
    if (st.isDirectory()) copyDirSync(k, h);
    else fs.copyFileSync(k, h);
  }
}

/**
 * Paket kökü (BASE) + WORK dizinlerini kurar: `classlibraries/ImWin32.dll` (eski sürüm,
 * gerçek motor kodlamasıyla) + `empp-vendor/adm-zip` (gerçek paket, dereference kopya —
 * `src/packaging/icerik-guncelleme.js`nin `paketeUygula`sının 1. adımıyla AYNI).
 * @returns {{base:string, work:string}}
 */
function kokKur({ calisma, id, eskiSurum, admZipKaynak }) {
  const base = path.join(calisma, 'base');
  const work = path.join(calisma, 'work');
  fs.mkdirSync(path.join(base, 'classlibraries'), { recursive: true });
  fs.mkdirSync(work, { recursive: true });
  fs.writeFileSync(path.join(base, 'classlibraries', 'ImWin32.dll'), encodeMenu(id, eskiSurum));
  const vendorHedef = path.join(base, 'empp-vendor', 'adm-zip');
  copyDirSync(admZipKaynak || path.dirname(require.resolve('adm-zip/package.json')), vendorHedef);
  return { base, work };
}

/**
 * Renderer bağlamını kurar: gerçek `rendererKur` GERÇEK bir `win.require` üzerinden çağrılır
 * (mock adm-zip YOK — `empp-vendor/adm-zip`den gerçek paket okunur, `admZipYolu` ile).
 * @returns {{win:Object, ctx:Object}}
 */
function rendererBaglamKur({ base, work, log }) {
  const R = makeResolver(path, fs, work, base);
  const onceki = (ad) => {
    if (ad === 'fs') return fs;
    if (ad === 'path') return path;
    if (ad === 'crypto') return crypto;
    // eslint-disable-next-line global-require
    return require(ad);
  };
  const win = { require: onceki, __dirname: base };
  const ctx = runtimeIcerik.rendererKur(win, {
    R, realFs: fs, pathMod: path, WORK: work, realRequire: onceki,
    admZipYolu: path.join(base, 'empp-vendor', 'adm-zip'), logDizin: work,
  });
  if (log) ctx.log = (s) => { log(s); };
  return { win, ctx };
}

/** WORK'teki (yoksa BASE'teki) menüyü çözüp kapak sürümünü döner. Yalnız fs okur. */
function workMenuSurumu(work, base, id) {
  const yol = path.join(work, 'classlibraries', 'ImWin32.dll');
  const kaynakYol = fs.existsSync(yol) ? yol : path.join(base, 'classlibraries', 'ImWin32.dll');
  if (!fs.existsSync(kaynakYol)) return null;
  const xml = runtimeIcerik.menuCoz(fs.readFileSync(kaynakYol));
  if (!xml) return null;
  const kapak = runtimeIcerik.kapaklar(xml).find((c) => c.ID === String(id));
  return kapak ? kapak.version : null;
}

/** Gerçek zip'ten `data/BookContent.xml` girdisini ÇIKARIP yeniden yazar (sahte "güncellendi" fikstürü). Saf I/O. */
function bozukZipUret(gercekZipYolu, hedefYolu) {
  const z = new AdmZip(gercekZipYolu);
  const kopya = new AdmZip();
  for (const e of z.getEntries()) {
    if (e.entryName === 'data/BookContent.xml' || e.isDirectory) continue;
    kopya.addFile(e.entryName, e.getData());
  }
  kopya.writeZip(hedefYolu);
  return hedefYolu;
}

function argumanCoz(argv) {
  const s = {
    zip: null, kitapId: null, eskiSurum: null, yeniSurum: null, kanit: null, calisma: null,
    bozuk: false, tut: false, yardim: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const sonraki = () => argv[++i];
    if (a === '--kitap-id') s.kitapId = sonraki();
    else if (a === '--eski-surum') s.eskiSurum = Number(sonraki());
    else if (a === '--yeni-surum') s.yeniSurum = Number(sonraki());
    else if (a === '--kanit') s.kanit = sonraki();
    else if (a === '--calisma') s.calisma = sonraki();
    else if (a === '--bozuk') s.bozuk = true;
    else if (a === '--tut') s.tut = true;
    else if (a === '-h' || a === '--help' || a === '--yardim') s.yardim = true;
    else if (!a.startsWith('-') && !s.zip) s.zip = a;
  }
  return s;
}

/**
 * TEK SENARYO: gerçek zip → gerçek açma/doğrulama → gerçek menü yazımı (motor davranışı
 * TAKLİT edilir: her zaman sürümü ilerletmeye ÇALIŞIR — asıl soru menü süzgecinin bunu
 * doğrulanmamışsa GERİ ÇEVİRİP çevirmediği). `bozuk:true` ise zip'in BookContent.xml
 * girdisi ÇIKARILMIŞ bozuk bir kopyası kullanılır (sahte "güncellendi" RED senaryosu).
 * @returns {Promise<Object>} rapor
 */
async function calis(argv, yazici) {
  const yaz = yazici || ((s) => process.stdout.write(`${s}\n`));
  const say = (s) => yaz(`[k-kabul] ${s}`);
  const s = argumanCoz(argv);
  if (s.yardim || !s.zip) {
    yaz('Kullanım: node tools/kabul/icerik-guncelleme-kabul.js <zip> [--kitap-id ID] '
      + '[--eski-surum N] [--yeni-surum N] [--kanit DIR] [--bozuk] [--calisma DIR] [--tut]');
    return { kod: 2 };
  }
  const zipYolu = path.resolve(s.zip);
  if (!fs.existsSync(zipYolu)) { say(`HATA: zip yok — ${zipYolu}`); return { kod: 2 }; }
  const turetilen = adlaTuret(zipYolu);
  const id = s.kitapId || (turetilen && turetilen.id);
  const yeniSurum = s.yeniSurum != null ? s.yeniSurum : (turetilen && turetilen.surum);
  if (!id || yeniSurum == null) {
    say('HATA: --kitap-id/--yeni-surum verilmedi ve dosya adından türetilemedi (`<id>-<v>.zip` bekleniyordu)');
    return { kod: 2 };
  }
  const eskiSurum = s.eskiSurum != null ? s.eskiSurum : Math.max(0, yeniSurum - 1);

  const kendiCalismaDizini = !s.calisma;
  const calisma = s.calisma || fs.mkdtempSync(path.join(os.tmpdir(), 'icerik-k-kabul-'));
  fs.mkdirSync(calisma, { recursive: true });
  const kanit = s.kanit || path.join(calisma, 'kanit');
  fs.mkdirSync(kanit, { recursive: true });

  say(`kitap ${id}: paket sürümü ${eskiSurum} → gelen güncelleme sürümü ${yeniSurum}${s.bozuk ? ' (BOZUK ZİP SENARYOSU)' : ''}`);
  say(`zip: ${zipYolu} (${(fs.statSync(zipYolu).size / 1024 / 1024).toFixed(1)} MB)`);

  const gunlukSatirlari = [];
  const gunlukTut = (satir) => gunlukSatirlari.push(satir);
  const { base, work } = kokKur({ calisma, id, eskiSurum });
  const { win, ctx } = rendererBaglamKur({ base, work, log: gunlukTut });

  const surumOnce = workMenuSurumu(work, base, id);
  const kullanilacakZip = s.bozuk ? bozukZipUret(zipYolu, path.join(calisma, 'bozuk.zip')) : zipYolu;

  let acmaHatasi = null;
  const AdmZipSarili = win.require('adm-zip');
  try {
    const z = new AdmZipSarili(kullanilacakZip);
    z.extractAllTo(path.join(base, 'assets', id), true);
  } catch (e) {
    acmaHatasi = e.message;
  }
  const dogrulandiMi = !!ctx.dogrulanan[id];

  // Motor davranışı: açma başarılı da olsa başarısız da olsa, sürümü menüde İLERLETMEYE
  // ÇALIŞIR (26.09 tespiti: hata `console.log` ile yutulur, reducer sürümü yine de yazar).
  const wrappedFs = win.require('fs');
  wrappedFs.writeFileSync(path.join(base, 'classlibraries', 'ImWin32.dll'), encodeMenu(id, yeniSurum));
  const surumSonra = workMenuSurumu(work, base, id);

  const assetsDizin = path.join(work, 'assets', String(id));
  const isaretYolu = path.join(assetsDizin, runtimeIcerik.ISARET_ADI);
  const bookContentYolu = path.join(assetsDizin, 'data', 'BookContent.xml');
  const bookContentMd5 = fs.existsSync(bookContentYolu)
    ? crypto.createHash('md5').update(fs.readFileSync(bookContentYolu)).digest('hex') : null;
  const sayfaSayisi = fs.existsSync(path.join(assetsDizin, 'pages'))
    ? fs.readdirSync(path.join(assetsDizin, 'pages')).length : 0;

  fs.writeFileSync(path.join(kanit, 'gunluk.log'), `${gunlukSatirlari.join('\n')}\n`);

  // KARAR: sahte ilerleme YAKALANMALI. Açma başarısızsa/doğrulanmamışsa menü ESKİ sürümde
  // KALMALI (motor sürümü ilerletmeye çalışsa bile) — aksi RED (sahte "güncellendi").
  const beklenenSurum = dogrulandiMi ? yeniSurum : eskiSurum;
  const sahteIlerleme = !dogrulandiMi && surumSonra === yeniSurum;
  const gercekIlerlemeEksik = dogrulandiMi && surumSonra !== yeniSurum;
  const sebepler = [];
  if (sahteIlerleme) sebepler.push(`SAHTE İLERLEME: içerik doğrulanmadı (${acmaHatasi || 'açma başarısız'}) ama menü v${surumSonra}'a ilerledi`);
  if (gercekIlerlemeEksik) sebepler.push(`içerik doğrulandı ama menü sürümü ilerlemedi (${surumOnce} → ${surumSonra}, beklenen ${yeniSurum})`);
  if (s.bozuk && dogrulandiMi) sebepler.push('BOZUK zip beklenmedik şekilde doğrulandı — negatif senaryo geçersiz');
  if (!s.bozuk && !dogrulandiMi) sebepler.push(`gerçek zip doğrulanamadı: ${acmaHatasi || 'bilinmiyor'}`);
  if (!s.bozuk && sayfaSayisi === 0) sebepler.push('doğrulandı ama pages/ altında hiç sayfa yok (içerik boş)');

  const rapor = {
    kitapId: id, eskiSurum, yeniSurum, bozukSenaryo: !!s.bozuk,
    surumOnce, surumSonra, beklenenSurum,
    acildi: dogrulandiMi, acmaHatasi,
    bookContentMd5, sayfaSayisi, isaretVar: fs.existsSync(isaretYolu),
    assetsDizin, kanit, calisma,
    durum: sebepler.length ? O.DURUM.RED : O.DURUM.GECTI,
    sebepler,
  };
  fs.writeFileSync(path.join(kanit, 'karar.json'), JSON.stringify(rapor, null, 2));
  say(`sürüm: ${surumOnce} → ${surumSonra} (beklenen ${beklenenSurum}) · açıldı=${dogrulandiMi} · `
    + `BookContent md5=${bookContentMd5 || '—'} · sayfa=${sayfaSayisi}`);
  say(`SONUÇ: ${rapor.durum}${sebepler.length ? ` — ${sebepler.join(' | ')}` : ''} (kanıt: ${kanit})`);

  if (kendiCalismaDizini && !s.tut) {
    try { fs.rmSync(calisma, { recursive: true, force: true }); } catch (_) { /* kalsın */ }
  }
  return { kod: rapor.durum === O.DURUM.GECTI ? O.CIKIS_KODU.GECTI : O.CIKIS_KODU.RED, rapor };
}

module.exports = {
  adlaTuret, menuXml, encodeMenu, kokKur, rendererBaglamKur, workMenuSurumu, bozukZipUret, argumanCoz, calis,
};

if (require.main === module) {
  calis(process.argv.slice(2)).then(({ kod }) => process.exit(kod)).catch((e) => {
    process.stderr.write(`[k-kabul] BEKLENMEYEN HATA: ${(e && e.stack) || e}\n`);
    process.exit(3);
  });
}

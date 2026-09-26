'use strict';

/**
 * SET GÜNCELLEME MANİFESTİ ÜRETİCİ — sunucu tarafı, offline/CLI.
 *
 * NEDEN (2026-09-22, Nadir'in sorusuna cevap): `src/runtime/kitap-guncelleyici.js`
 * (TÜKETİCİ) `.claude/docs/kitap-guncelleme-sozlesmesi.md`'deki `surum.json` /
 * `manifest.json` / `dosya/<yol>` uçlarını GERÇEK http(s) ile çeken kodu aylardır
 * hazır — ama panel tarafında bu uçları üreten HİÇBİR ŞEY yoktu (book-update
 * deposu grep'lendi: yok). Yani "SM4 kitabında güncelleme denemesi yapmak için
 * ne yapmalıyım" sorusunun cevabı önce bu betikti: açılmış bir SET paketinin
 * kökünden tüketicinin beklediği üç uç noktayı DÜZ DOSYA olarak üretir; sonraki
 * adımda bir statik dosya sunucusu (`python3 -m http.server` vb.) bu dizini
 * `EMPP_GUNCELLEME_TABANI` olarak servis eder.
 *
 * KABUK/ÜYELİK AYRIMI TAHMİN EDİLMEDİ — `../src/packaging/set-kabuk.js` (kodun
 * TEK kaynağı, üretici ile kapı da oradan ithal eder) buradan da ithal edilir.
 * Kabuk beyaz listesi (`assets2/`, `core/`, `i18n/` + kök dosyaları) DIŞINDAKİ
 * kök dizinlere (`book\d+/`, `node_modules/`, `temp/`, `.empp-gecici/`, bilinmeyen
 * dizinler) HİÇ girilmez — GB'lerce `temp/`'i taramak yerine kök düzeyinde
 * sınıflanıp atlanır (aynı disiplin `set-kimligi.js`'te de var).
 *
 * SÜRÜM (`surum`) — kabuk dosya listesi + sha256'larının + boyutlarının
 * (yol sırasına göre sabitlenmiş) deterministik sha256'sı: aynı girdi aynı
 * sürüm, tek bayt değişirse farklı sürüm. Tüketici bu alanı `surum.json` ile
 * yerel damgayı karşılaştırıp AYNIYSA manifest'i hiç indirmiyor — bu yüzden
 * `kitaplar` (üyelik) değişse de kabuk aynıysa sürüm DEĞİŞMEZ. Bu bilinen bir
 * kapsam sınırıdır (görev tanımında `surum` yalnız kabuktan türetilecek diye
 * açıkça belirtildi); üyelik-yalnız güncellemede sürümü de bilerek bump'lamak
 * ayrı bir karar olarak Nadir'e bırakılır.
 *
 * Node stdlib DIŞINDA bağımlılık YOK — `set-kabuk.js` ve `kitap-guncelleyici.js`
 * da zaten stdlib-only'dir (ikisi de pakete olduğu gibi kopyalanan dosyalardır).
 */

const fs = require('fs/promises');
const path = require('path');

const crypto = require('crypto');
const kabuk = require('../src/packaging/set-kabuk');
const kg = require('../src/runtime/kitap-guncelleyici');

/* --------------------------------------------------------------- CLI argümanları */

/**
 * Komut satırı argümanlarını ayrıştırır. Saf (dosya sistemine dokunmaz).
 * Zorunlu: `--set-koku`, `--set-kimligi`, `--cikti`. İsteğe bağlı: `--kitaplar`.
 */
function argsAyristir(argv) {
  const a = { setKoku: null, setKimligi: null, cikti: null, kitaplarJson: null, imzaAnahtari: null };
  const liste = Array.isArray(argv) ? argv : [];
  for (let i = 0; i < liste.length; i++) {
    const bayrak = liste[i];
    const degerAl = () => {
      const d = liste[i + 1];
      if (d === undefined) throw new Error(`${bayrak} için değer verilmedi`);
      i += 1;
      return d;
    };
    if (bayrak === '--set-koku') a.setKoku = degerAl();
    else if (bayrak === '--set-kimligi') a.setKimligi = degerAl();
    else if (bayrak === '--cikti') a.cikti = degerAl();
    else if (bayrak === '--kitaplar') a.kitaplarJson = degerAl();
    else if (bayrak === '--imza-anahtari') a.imzaAnahtari = degerAl();
    else throw new Error(`bilinmeyen argüman: ${bayrak}`);
  }
  if (!a.setKoku) throw new Error('--set-koku zorunlu');
  if (!a.setKimligi) throw new Error('--set-kimligi zorunlu');
  if (!a.cikti) throw new Error('--cikti zorunlu');
  return a;
}

/* --------------------------------------------------------- kabuk tarama (I/O) */

/**
 * Bir kabuk alt dizinini (assets2/core/i18n gibi) UÇTAN UCA tarar; göreli
 * posix yol listesi döner. Sembolik bağlar ATLANIR (kök dışına kaçabilir).
 * Okunamayan dal sessizce atlanır — tüketicideki `agaciTara` ile aynı disiplin.
 */
async function altDosyalariTara(kokMutlak, kokGorAdi) {
  const cikti = [];
  const kuyruk = [kokGorAdi];
  while (kuyruk.length) {
    const on = kuyruk.pop();
    let girdiler;
    try {
      girdiler = await fs.readdir(path.join(kokMutlak, on), { withFileTypes: true });
    } catch (e) {
      continue;
    }
    for (const g of girdiler) {
      if (g.isSymbolicLink()) continue;
      const gor = on + '/' + g.name;
      if (g.isDirectory()) kuyruk.push(gor);
      else if (g.isFile()) cikti.push(gor);
    }
  }
  return cikti;
}

/**
 * Set kökünü tarar; KABUK dosyalarının göreli posix yol listesini VE kapsam
 * dışı (ne kabuk ne kitap ne bilinen artefakt) kök dizin adlarını döner.
 * `book\d+/`, `node_modules/`, `temp/`, `.empp-gecici/` dizinlerinin İÇİNE
 * HİÇ girilmez — sınıflama kök düzeyinde `set-kabuk.js` ile yapılır.
 */
async function kabukVeKapsamTopla(setKoku) {
  const kokMutlak = path.resolve(String(setKoku || ''));
  let girdiler;
  try {
    girdiler = await fs.readdir(kokMutlak, { withFileTypes: true });
  } catch (e) {
    throw new Error(`set kökü okunamadı: ${kokMutlak} (${e.message})`);
  }

  const kabukYollari = [];
  const kapsamDisi = [];
  for (const g of girdiler) {
    if (g.isSymbolicLink()) continue;
    if (g.isFile()) {
      if (kabuk.kabukYoluMu(g.name)) kabukYollari.push(g.name);
      continue;
    }
    if (!g.isDirectory()) continue;
    const sinif = kabuk.dalSinifi(g.name);
    if (sinif === 'kabuk') {
      for (const yol of await altDosyalariTara(kokMutlak, g.name)) kabukYollari.push(yol);
    } else if (sinif === 'bilinmeyen') {
      kapsamDisi.push(g.name);
    }
    // 'kitap' (book\d+) ve 'artefakt' (node_modules/temp/.empp-gecici) dizinleri
    // BİLEREK atlanır — kendi kanallarına aittir, bu üretici dokunmaz.
  }
  kabukYollari.sort();
  kapsamDisi.sort();
  return { kabukYollari, kapsamDisi };
}

/**
 * Kabuk yol listesindeki her dosya için `{yol, sha256, boyut}` hesaplar.
 * Yol yine `set-kabuk.js`'in güvenlik denetiminden geçirilir (çift koruma —
 * tüketicideki `hedefYoluCoz` ile aynı "varsayılan RET" disiplini).
 */
async function kabukGirdileriHesapla(setKoku, kabukYollari) {
  const kokMutlak = path.resolve(String(setKoku || ''));
  const girdiler = [];
  for (const yol of Array.isArray(kabukYollari) ? kabukYollari : []) {
    if (!kabuk.yolGuvenliMi(yol)) throw new Error(`kabuk yolu güvensiz: ${yol}`);
    const tam = path.join(kokMutlak, ...yol.split('/'));
    const veri = await fs.readFile(tam);
    girdiler.push({ yol, sha256: kg.sha256(veri), boyut: veri.length });
  }
  girdiler.sort((a, b) => (a.yol < b.yol ? -1 : a.yol > b.yol ? 1 : 0));
  return girdiler;
}

/* ------------------------------------------------------------------- kitaplar */

/**
 * `--kitaplar` JSON metnini ayrıştırır ve doğrular. Doğrulama tüketicinin
 * KENDİ fonksiyonuyla yapılır (`uyelikGirdisiGecerliMi`) — kopya kural yazma
 * yasak. Geçersiz girdi sessizce yutulmaz: sayılır ve `gunluk` ile bildirilir.
 * `ham` verilmezse (`--kitaplar` hiç geçilmemişse) `{kitaplar:[], reddedilen:0}`.
 */
function kitaplariAyristir(ham, gunluk) {
  const yaz = typeof gunluk === 'function' ? gunluk : () => {};
  if (ham == null) return { kitaplar: [], reddedilen: 0 };
  let dizi;
  try {
    dizi = JSON.parse(ham);
  } catch (e) {
    throw new Error(`--kitaplar geçersiz JSON: ${e.message}`);
  }
  if (!Array.isArray(dizi)) throw new Error('--kitaplar bir JSON dizisi olmalı');

  const kitaplar = [];
  let reddedilen = 0;
  for (const g of dizi) {
    if (kg.uyelikGirdisiGecerliMi(g)) {
      kitaplar.push(g);
    } else {
      reddedilen += 1;
      yaz(`[kitaplar] geçersiz girdi reddedildi: ${JSON.stringify(g)}`);
    }
  }
  return { kitaplar, reddedilen };
}

/* ---------------------------------------------------------------------- sürüm */

/**
 * Kabuk girdilerinden deterministik sürüm sha256'sı üretir. Saf — sıralama
 * içeride sabitlenir, girdi sırası sonucu etkilemez. Tek bayt/boyut/yol
 * değişirse çıktı değişir.
 */
function surumHesapla(kabukGirdileri) {
  const siraliMetin = [...(Array.isArray(kabukGirdileri) ? kabukGirdileri : [])]
    .sort((a, b) => (a.yol < b.yol ? -1 : a.yol > b.yol ? 1 : 0))
    .map((g) => `${g.yol} ${g.sha256} ${g.boyut}`)
    .join('\n');
  return kg.sha256(siraliMetin);
}

/* ------------------------------------------------------ imza (sözleşme G4) */

/**
 * ed25519 ÖZEL anahtarını PEM (PKCS#8) dosyasından okur. Anahtarın içeriği hiçbir
 * günlüğe/çıktıya yazılmaz; yalnız türü doğrulanır.
 * @returns {import('crypto').KeyObject}
 */
function imzaAnahtariOku(yol) {
  const k = crypto.createPrivateKey(require('fs').readFileSync(String(yol)));
  if (k.asymmetricKeyType !== kg.IMZA_ALG) {
    throw new Error(`imza anahtarı ${kg.IMZA_ALG} değil (${k.asymmetricKeyType})`);
  }
  return k;
}

/** Manifest baytlarını imzalar; base64 imza döner. Kendi açık anahtarıyla hemen doğrular. */
function manifestImzala(govde, ozelAnahtar) {
  const imza = crypto.sign(null, Buffer.from(govde), ozelAnahtar).toString('base64');
  const acik = crypto.createPublicKey(ozelAnahtar).export({ type: 'spki', format: 'der' }).toString('base64');
  if (!kg.manifestImzasiGecerliMi(govde, imza, acik)) throw new Error('imza öz-doğrulaması tutmadı');
  return imza;
}

/* --------------------------------------------------------------------- çıktı */

/**
 * `<cikti>/set/<setKimligi>/{surum.json,manifest.json,dosya/<yol>...}` yazar.
 * `simdiIso` test edilebilirlik için enjekte edilir (varsayılan gerçek saat).
 */
async function ciktiyaYaz({
  cikti, setKimligi, setKoku, kabukGirdileri, kitaplar, surum, simdiIso, imzaAnahtari,
}) {
  const kimlikMetni = String(setKimligi);
  const setDizini = path.join(path.resolve(String(cikti)), 'set', kimlikMetni);
  await fs.mkdir(setDizini, { recursive: true });

  const saatFn = typeof simdiIso === 'function' ? simdiIso : () => new Date().toISOString();
  const surumJson = { surum, uretim: saatFn() };
  await fs.writeFile(path.join(setDizini, 'surum.json'), JSON.stringify(surumJson));

  const manifest = { surum, kabuk: kabukGirdileri, kitaplar };
  const manifestGovde = Buffer.from(JSON.stringify(manifest), 'utf8');
  await fs.writeFile(path.join(setDizini, 'manifest.json'), manifestGovde);
  // G4: imza manifestin YAZILAN baytları üzerinde; tüketici imzasız manifesti reddeder.
  let imzali = false;
  if (imzaAnahtari) {
    await fs.writeFile(path.join(setDizini, 'manifest.json' + kg.IMZA_UZANTI),
      manifestImzala(manifestGovde, imzaAnahtari));
    imzali = true;
  }

  const kokMutlak = path.resolve(String(setKoku));
  const dosyaKoku = path.join(setDizini, 'dosya');
  for (const g of kabukGirdileri) {
    const kaynak = path.join(kokMutlak, ...g.yol.split('/'));
    const hedef = path.join(dosyaKoku, ...g.yol.split('/'));
    await fs.mkdir(path.dirname(hedef), { recursive: true });
    await fs.copyFile(kaynak, hedef);
  }

  return { setDizini, surumJson, manifest, imzali };
}

/* ----------------------------------------------------------------------- ana */

/** CLI argüman dizisinden (örn. `process.argv.slice(2)`) tüm akışı çalıştırır. */
async function main(argv, { gunluk } = {}) {
  const yaz = typeof gunluk === 'function' ? gunluk : (m) => console.warn(m);
  const a = argsAyristir(argv);

  const { kabukYollari, kapsamDisi } = await kabukVeKapsamTopla(a.setKoku);
  const kabukGirdileri = await kabukGirdileriHesapla(a.setKoku, kabukYollari);
  const { kitaplar, reddedilen } = kitaplariAyristir(a.kitaplarJson, yaz);
  const surum = surumHesapla(kabukGirdileri);
  const imzaAnahtari = a.imzaAnahtari ? imzaAnahtariOku(a.imzaAnahtari) : null;

  const { setDizini, imzali } = await ciktiyaYaz({
    cikti: a.cikti,
    setKimligi: a.setKimligi,
    setKoku: a.setKoku,
    kabukGirdileri,
    kitaplar,
    surum,
    imzaAnahtari,
  });
  if (!imzali) {
    yaz('[uyari] manifest İMZASIZ üretildi (--imza-anahtari yok) — sözleşme G4 gereği paketler '
      + 'bu manifesti REDDEDER');
  }

  if (kapsamDisi.length) {
    yaz(`[uyari] kapsam dışı kök dizin (kabuk/kitap/artefakt değil, hiç kopyalanmadı): `
      + kapsamDisi.join(', '));
  }

  const toplamBayt = kabukGirdileri.reduce((t, g) => t + g.boyut, 0);
  return {
    setKimligi: String(a.setKimligi),
    setDizini,
    kabukDosyaSayisi: kabukGirdileri.length,
    toplamBayt,
    surum,
    kitapSayisi: kitaplar.length,
    kitapReddedilen: reddedilen,
    kapsamDisiDallar: kapsamDisi,
    imzali,
  };
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then((rapor) => { console.log(JSON.stringify(rapor, null, 2)); })
    .catch((e) => {
      console.error('HATA: ' + (e && e.message ? e.message : e));
      process.exitCode = 1;
    });
}

module.exports = {
  argsAyristir,
  altDosyalariTara,
  kabukVeKapsamTopla,
  kabukGirdileriHesapla,
  kitaplariAyristir,
  surumHesapla,
  ciktiyaYaz,
  imzaAnahtariOku,
  manifestImzala,
  main,
};

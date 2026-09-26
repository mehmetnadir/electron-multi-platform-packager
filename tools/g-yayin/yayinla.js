#!/usr/bin/env node
'use strict';

/**
 * G YAYIN ARACI — uzaktan güncelleme kanalı (G) için bir SET'in yeni durumunu üretir:
 * `surum.json` + `manifest.json` + `manifest.json.sig` + değişen dosyalar + yükleme planı.
 * R2'ye YAZMAZ; çıktı R2 anahtar düzenini birebir yansıtan yerel bir dizindir.
 *
 * Kapsam (Nadir 26.09): kök `index.html`, set bileşimi (kitap ekle/çıkar), her kitabın
 * `bookN/43e23fce2b7009474555a77.js` motoru. Set bileşimi MENÜYÜ de kapsar: `--ekle`/`--cikar`
 * kurulu paketin menü dosyalarını tutarlı günceller (`menu.js`; taban `--menu-taban` ya da önceki
 * G durumu); menü biçimi tanınmazsa yayın RED. Sözleşmeler: `windows-paketleme-sozlesmesi.md`
 * G3/G4, `platform-kanallari-sozlesmesi.md` O3/O4, tasarım `g-yayin-r2-yol-tasarimi.md`.
 *
 *   Sürüm   `2.<panel>.<sayaç>`, bilinen her önceki sürümden KESİN büyük (g-surum.js).
 *   Durum   birikimli: önceki imzalı manifest + bu yayının değişiklikleri (durum.js).
 *   İmza    ed25519, manifestin YAZILAN baytları üzerinde; anahtar Anahtar Zinciri
 *           (üretim) ya da dosya (TEST) — anahtar.js.
 *   Android `--ekle` içeren yayın varsayılan RED (Android ucu kalıcı donar); bilinçli geçiş
 *           yalnız `--android-ekleme-dondurur-kabul` ile — `androidEklemeKapisi`.
 *
 * Alt komutlar:
 *   yayinla  (varsayılan)  yeni sürümü üret
 *   dogrula                çıktı dizinindeki (--cikti) ya da canlı uçtaki (--uzak <taban>) son
 *                          sürümü imza + sha256 ile denetle (varsayılan ÜRETİM açık anahtarı)
 *   kuru-imza              Anahtar Zinciri yolunu tek imzayla sına; yalnız GEÇTİ/KALDI basar
 *   yukle                  yerel imzalı durumu canlı R2'ye taşı — beyaz liste (74390) + --onayli
 *                          kapısı; onaysız yalnız plan (yukle.js)
 *   e2e <id>               kalıcı test: üret → (onaylıysa) yükle → dogrula --uzak; JSON + rc
 *
 * Node stdlib dışında bağımlılık yok.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const kg = require('../../src/runtime/kitap-guncelleyici');
const gSurum = require('./g-surum');
const anahtar = require('./anahtar');
const zip = require('./zip-yaz');
const durum = require('./durum');
const menu = require('./menu');
// Paketleyicinin alt-kitap fs-shim enjeksiyonu — TEK KAYNAK (bağımlılıksız saf modül).
const fsShimHtml = require('../../src/packaging/fs-shim-subbook-html');

/** `src/packaging/set-kimligi.js` KIMLIK_DESENI ile aynı (sentinel testte kıyaslanır). */
const KIMLIK_DESENI = /^[A-Za-z0-9._:-]{1,64}$/;
const MANIFEST_SEMASI = 1;
const KANAL = 'G';
/** R2 kovasında anahtar öneki: taban = `<publicUrl>/guncelleme` ↔ anahtar `guncelleme/…`. */
const R2_ONEKI = 'guncelleme';
const CACHE_DEGISMEZ = 'public, max-age=31536000, immutable';
const CACHE_DEGISKEN = 'no-cache';
/**
 * Android G ucu (sözleşme: `platform-kanallari-sozlesmesi.md` "Android G katmanı",
 * istemci `src/platforms/android/empp-g-istemci.js`): `<taban>/set/<id>/android/{surum.json,
 * manifest.json, manifest.json.sig, dosya/<yol>}`. TEK imza paylaşılır — Windows/mac ile AYNI
 * `govde`/`imza` baytları android/ önekinde de yayınlanır (ikinci bir imzalama YOK); kitap
 * arşivi de PAYLAŞILIR (`kitaplar[].kaynak` aynı `kitap/<ad>.zip` adresini gösterir, ayrı bir
 * Android zip'i üretilmez). Android istemcisi manifestteki kendi bilmediği alanları yok sayar.
 */
const ANDROID_ONEKI = 'android';
/**
 * ANDROID EKLEME KAPISI (26.09 — Android paketlerinde G istemcisi AÇILDI, Nadir: "tüm paketlerde
 * güncelleme istemcisi olsun"). Eklenen kitabın arşivi yalnız Electron biçimindedir (fs-shim);
 * Android istemcisi onu İNDİRDİKTEN sonra `kitap-android-hazir-degil:bookN` ile reddeder
 * (`empp-g-istemci.js`, canlıda ölçüldü) ve manifest birikimli olduğu için (`durum.js`) ekleme
 * sonraki HER yayına taşınır → o setin Android ucu KALICI donar, motor düzeltmeleri dahil hiçbir
 * G güncellemesi alamaz. Bu yüzden `--ekle` içeren yayın varsayılan RED; bilinçli geçiş yalnız
 * `ANDROID_EKLEME_ANAHTARI` ile, görünür uyarıyla (rapor `android` + manifest yanında
 * `ANDROID_DONUK_DOSYASI`). `--cikar`/`--index`/`--motor`/menü kapıdan geçmez (Android'de canlıda
 * çalıştığı ölçüldü). Kalıcı çözüm (öneri A/B: ayrı Android arşivi) Nadir kararında. Kuralı belge
 * değil kapı korur.
 */
const ANDROID_EKLEME_ANAHTARI = '--android-ekleme-dondurur-kabul';
const ANDROID_EKLEME_ONERISI =
  '~/.empp-agent/arastirma/g-android-kitap-ekleme-onerisi-20260926.md';
const ANDROID_DONUK_DOSYASI = 'ANDROID-DONUK.txt';
const GECICI_EK = '.g-yayin-gecici';
const ALT_KOMUTLAR = ['yayinla', 'dogrula', 'kuru-imza', 'yukle', 'e2e'];

const ICERIK_TURLERI = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.sig': 'text/plain; charset=us-ascii',
  '.zip': 'application/zip',
  '.txt': 'text/plain; charset=utf-8',
};

function icerikTuru(yol) {
  return ICERIK_TURLERI[path.extname(String(yol)).toLowerCase()] || 'application/octet-stream';
}

function sha256(veri) {
  return crypto.createHash('sha256').update(veri).digest('hex');
}

function dosyaSha256(yol) {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(yol, 'r');
  const tampon = Buffer.alloc(1024 * 1024);
  let boyut = 0;
  try {
    for (;;) {
      const n = fs.readSync(fd, tampon, 0, tampon.length, null);
      if (!n) break;
      h.update(tampon.subarray(0, n));
      boyut += n;
    }
  } finally {
    fs.closeSync(fd);
  }
  return { sha256: h.digest('hex'), boyut };
}

/**
 * Manifestteki imzalı `dosyalar[]` listesini arşivin GERÇEK içeriğiyle (aynı yöntemle,
 * `zip.zipIcerigi`, yeniden türetilmiş) kıyaslar. Tutuyorsa `null`, tutmuyorsa hata metni.
 */
function dosyalarKarsilastir(beklenen, gercek) {
  const b = new Map(beklenen.map((g) => [g.yol, g]));
  const gr = new Map(gercek.map((g) => [g.yol, g]));
  if (b.size !== gr.size)
    return `dosyalar listesi arşivle uyuşmuyor (liste ${b.size} ≠ arşiv ${gr.size} dosya)`;
  for (const [yol, g] of b) {
    const h = gr.get(yol);
    if (!h) return `dosyalar listesindeki yol arşivde yok: ${yol}`;
    if (h.sha256 !== g.sha256 || h.boyut !== g.boyut)
      return `dosyalar listesi arşivle uyuşmuyor: ${yol}`;
  }
  return null;
}

/* ------------------------------------------------------------------ argümanlar */

function ciftAyir(ham, bayrak) {
  const i = String(ham).indexOf('=');
  if (i <= 0 || i === String(ham).length - 1)
    throw new Error(`${bayrak} bookN=<yol> biçiminde olmalı: ${ham}`);
  return [
    String(ham).slice(0, i).trim(),
    String(ham)
      .slice(i + 1)
      .trim(),
  ];
}

/** Saf. `argv` → seçenek nesnesi. İlk konumsal argüman alt komuttur. */
function argsAyristir(argv) {
  const liste = Array.isArray(argv) ? argv.slice() : [];
  const a = {
    komut: 'yayinla',
    setKimligi: null,
    taban: null,
    cikti: null,
    panel: null,
    surum: null,
    oncekiSurum: null,
    oncekiManifest: null,
    ilk: false,
    index: null,
    motorlar: {},
    ekle: {},
    cikar: [],
    menuTaban: null,
    baslik: {},
    anahtarZinciri: false,
    anahtarDosya: null,
    acikAnahtar: null,
    uzak: null,
    arsivler: false,
    onayli: false,
    androidEklemeDondururKabul: false,
  };
  if (liste.length && !liste[0].startsWith('--')) a.komut = liste.shift();
  if (!ALT_KOMUTLAR.includes(a.komut)) throw new Error(`bilinmeyen alt komut: ${a.komut}`);
  if (a.komut === 'e2e' && liste.length && !liste[0].startsWith('--')) a.setKimligi = liste.shift();
  for (let i = 0; i < liste.length; i++) {
    const b = liste[i];
    const deger = () => {
      const d = liste[i + 1];
      if (d === undefined || d.startsWith('--')) throw new Error(`${b} için değer verilmedi`);
      i += 1;
      return d;
    };
    if (b === '--set-kimligi') a.setKimligi = deger();
    else if (b === '--taban') a.taban = deger().replace(/\/+$/, '');
    else if (b === '--cikti') a.cikti = deger();
    else if (b === '--panel') a.panel = deger();
    else if (b === '--surum') a.surum = deger();
    else if (b === '--onceki-surum') a.oncekiSurum = deger();
    else if (b === '--onceki-manifest') a.oncekiManifest = deger();
    else if (b === '--ilk') a.ilk = true;
    else if (b === '--index') a.index = deger();
    else if (b === '--motor') {
      const [k, v] = ciftAyir(deger(), b);
      a.motorlar[k] = v;
    } else if (b === '--ekle') {
      const [k, v] = ciftAyir(deger(), b);
      a.ekle[k] = v;
    } else if (b === '--cikar')
      a.cikar.push(
        ...deger()
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      );
    else if (b === '--menu-taban') a.menuTaban = deger();
    else if (b === '--baslik') {
      const [k, v] = ciftAyir(deger(), b);
      a.baslik[k] = v;
    } else if (b === '--anahtar-zinciri') a.anahtarZinciri = true;
    else if (b === '--anahtar-dosya') {
      const d = liste[i + 1];
      if (d !== undefined && !d.startsWith('--')) {
        a.anahtarDosya = d;
        i += 1;
      } else a.anahtarDosya = true;
    } else if (b === '--acik-anahtar') a.acikAnahtar = deger();
    else if (b === '--uzak') a.uzak = deger().replace(/\/+$/, '');
    else if (b === '--arsivler') a.arsivler = true;
    else if (b === '--onayli') a.onayli = true;
    else if (b === ANDROID_EKLEME_ANAHTARI) a.androidEklemeDondururKabul = true;
    else throw new Error(`bilinmeyen argüman: ${b}`);
  }
  return a;
}

function kimlikDenetle(k) {
  const s = String(k == null ? '' : k).trim();
  if (!KIMLIK_DESENI.test(s) || s === '.' || s === '..')
    throw new Error(`--set-kimligi geçersiz: ${JSON.stringify(k)}`);
  return s;
}

/* ------------------------------------------------------------------ yardımcılar */

/** Atomik yaz: geçici ada yaz → yerine taşı. */
function atomikYaz(hedef, veri) {
  fs.mkdirSync(path.dirname(hedef), { recursive: true });
  const gecici = hedef + GECICI_EK;
  fs.writeFileSync(gecici, veri);
  fs.renameSync(gecici, hedef);
}

function dosyaOku(yol, ne) {
  const y = path.resolve(String(yol));
  let st;
  try {
    st = fs.statSync(y);
  } catch (e) {
    throw new Error(`${ne} bulunamadı: ${y}`);
  }
  if (!st.isFile()) throw new Error(`${ne} dosya değil: ${y}`);
  const veri = fs.readFileSync(y);
  if (!veri.length) throw new Error(`${ne} boş: ${y}`);
  return veri;
}

function indexDenetle(veri, yol) {
  const bas = veri.subarray(0, 65536).toString('utf8');
  if (!/<html[\s>]|<!doctype html/i.test(bas))
    throw new Error(`index HTML gibi görünmüyor: ${yol}`);
}

/** `.sig` dahil manifest çiftini dosyadan ya da https adresinden getirir; yoksa null. */
async function manifestCiftiGetir(kaynak) {
  if (/^[a-z]+:\/\//i.test(kaynak)) {
    if (!kg.adresGuvenliMi(kaynak))
      throw new Error(`önceki manifest adresi https değil: ${kaynak}`);
    const m = await kg.varsayilanGetir(kaynak, { zamanAsimi: 30000 });
    if (m.durum === 404) return null;
    if (m.durum !== 200)
      throw new Error(`önceki manifest getirilemedi (HTTP ${m.durum}): ${kaynak}`);
    const s = await kg.varsayilanGetir(kaynak + kg.IMZA_UZANTI, { zamanAsimi: 30000 });
    if (s.durum !== 200)
      throw new Error(`önceki manifest imzasız (HTTP ${s.durum}): ${kaynak}${kg.IMZA_UZANTI}`);
    return { govde: Buffer.from(m.govde), imza: Buffer.from(s.govde).toString('utf8'), kaynak };
  }
  const y = path.resolve(kaynak);
  if (!fs.existsSync(y)) return null;
  const sigYolu = y + kg.IMZA_UZANTI;
  if (!fs.existsSync(sigYolu)) throw new Error(`önceki manifest imzasız: ${sigYolu} yok`);
  return { govde: fs.readFileSync(y), imza: fs.readFileSync(sigYolu, 'utf8'), kaynak: y };
}

/**
 * Önceki durumu okur ve GÜVENİR hâle getirir: imza bu yayının açık anahtarıyla doğrulanır,
 * kanal/kimlik/sürüm denetlenir. İmzasız ya da başka anahtarla imzalı durum TAŞINMAZ.
 */
async function oncekiManifestOku(kaynak, acikB64, setKimligi) {
  const cift = await manifestCiftiGetir(kaynak);
  if (!cift) return null;
  if (!anahtar.dogrula(cift.govde, cift.imza, acikB64)) {
    throw new Error(
      `önceki manifest bu anahtarla doğrulanmadı (başka anahtar ya da bozuk): ${cift.kaynak}`,
    );
  }
  let m;
  try {
    m = JSON.parse(cift.govde.toString('utf8'));
  } catch (e) {
    throw new Error(`önceki manifest JSON değil: ${cift.kaynak}`);
  }
  if (!m || m.kanal !== KANAL)
    throw new Error(`önceki manifest G kanalına ait değil (kanal=${m && m.kanal}): ${cift.kaynak}`);
  if (String(m.setKimligi) !== setKimligi) {
    throw new Error(
      `önceki manifest başka setin (${m.setKimligi} ≠ ${setKimligi}): ${cift.kaynak}`,
    );
  }
  if (!gSurum.gecerliMi(m.surum))
    throw new Error(`önceki manifest sürümü G3 değil (${m.surum}): ${cift.kaynak}`);
  return m;
}

function yerelSurumOku(setDizini) {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(setDizini, 'surum.json'), 'utf8'));
    return gSurum.gecerliMi(s && s.surum) ? s.surum : null;
  } catch (e) {
    return null;
  }
}

/** Eklenen kitabın giriş sayfası — paketleyici de yalnız `<kitap>/index.html`'e enjekte eder. */
const KITAP_INDEX = 'index.html';

/**
 * Eklenen kitabın `index.html`'ine paketleyicinin alt-kitap fs-shim etiketlerini koyar
 * (`src/packaging/fs-shim-subbook-html.js` — TEK KAYNAK, kopya kural yok).
 *
 * NEDEN: G ile EKLENEN kitap paketleme anında pakette yoktu → `bookN/index.html` shim almadı →
 * renderer `fs` okumaları örtüyü (mac/Pardus, 9529d11) ve WORK'ü (Windows yerinde) görmez,
 * yazmalar pakete gider. Paketlenmiş bir kitapla aynı sayfayı taşısın diye arşiv SONRASI değil
 * ÖNCESİ enjekte edilir; `dosyalar[]` ve arşiv sha256'sı enjekte edilmiş içerikten hesaplanır.
 * İdempotent: etiketler zaten varsa bayta dokunulmaz. Sayfada BAŞKA bir kitabın ad-alanı yazılıysa
 * (`__emppSubBook` ≠ hedef dizin — başka setten taşınmış kitap) RED: o kitap iki kitabın WORK'ünü
 * karıştırır (K6), sessizce yayınlanmaz.
 * @returns {{veri:Buffer, durum:'enjekte'|'zaten-var'}}
 */
function fsShimUygula(dizin, veri) {
  const r = fsShimHtml.injectFsShimIntoSubBookHtml(veri.toString('utf8'), dizin);
  if (r.existingSubBook !== null && r.existingSubBook !== dizin) {
    throw new Error(
      `--ekle ${dizin}: index.html başka kitabın ad-alanını taşıyor ` +
        `(__emppSubBook=${JSON.stringify(r.existingSubBook)}); hedef dizinle aynı olmalı`,
    );
  }
  if (!r.changed) return { veri, durum: 'zaten-var' };
  return { veri: Buffer.from(r.html, 'utf8'), durum: 'enjekte' };
}

/**
 * Arşiv kaynağı (dizin ya da zip) → geçici dizinde doğrulanmış zip + içerik listesi. Kök
 * `index.html` paketleyicinin fs-shim enjeksiyonundan geçer (`fsShimUygula`).
 */
function kitapArsiviHazirla(dizin, kaynak, geciciDizin) {
  const y = path.resolve(String(kaynak));
  let st;
  try {
    st = fs.statSync(y);
  } catch (e) {
    throw new Error(`--ekle ${dizin}: kaynak bulunamadı: ${y}`);
  }
  fs.mkdirSync(geciciDizin, { recursive: true });
  const gecici = path.join(geciciDizin, `${dizin}-${process.pid}-${Date.now()}.zip`);
  let fsShim = 'index-yok';
  // Menü girdisi için (menu.kitapBilgisi): kitap kimliği başına BookContent.xml'in ilk 8 KB'ı.
  const xmlBaslari = {};
  const xmlBasiAl = (yol, veriAl) => {
    const m = menu.BOOKCONTENT_RE.exec(yol);
    if (m && !(m[1] in xmlBaslari)) xmlBaslari[m[1]] = veriAl().subarray(0, 8192).toString('utf8');
  };
  if (st.isDirectory()) {
    const girdiler = zip.dizindenGirdiler(y);
    if (!girdiler.length) throw new Error(`--ekle ${dizin}: dizin boş: ${y}`);
    for (const g of girdiler) xmlBasiAl(g.yol, () => fs.readFileSync(g.tam));
    const idx = girdiler.find((g) => g.yol === KITAP_INDEX);
    if (idx) {
      const sonuc = fsShimUygula(dizin, fs.readFileSync(idx.tam));
      fsShim = sonuc.durum;
      if (sonuc.durum === 'enjekte') idx.veri = sonuc.veri;
    }
    zip.zipYaz(gecici, girdiler);
  } else if (st.isFile()) {
    fs.copyFileSync(y, gecici);
    // Önce KAYNAK istemcinin okuyucusuyla denetlenir (güvensiz yol / sarmal dizin RED) — yeniden
    // paketleme denetimsiz yazıcıyı kullanır, kötü girdiyi temize çekmemeli.
    zip.zipIcerigi(gecici);
    const girdiler = kg.arsivCozVarsayilan(fs.readFileSync(gecici));
    for (const g of girdiler) xmlBasiAl(g.yol.replace(/\\/g, '/'), () => g.veri);
    const idx = girdiler.find((g) => g.yol.replace(/\\/g, '/') === KITAP_INDEX);
    if (idx) {
      const sonuc = fsShimUygula(dizin, idx.veri);
      fsShim = sonuc.durum;
      if (sonuc.durum === 'enjekte') {
        idx.veri = sonuc.veri;
        zip.zipYaz(
          gecici,
          girdiler.map((g) => ({ yol: g.yol.replace(/\\/g, '/'), veri: g.veri })),
        );
      }
    }
  } else {
    throw new Error(`--ekle ${dizin}: kaynak dosya ya da dizin değil: ${y}`);
  }
  // İSTEMCİNİN okuyucusuyla açıp doğrular VE (yol,sha256,boyut) listesini üretir — bu liste
  // manifestin imzalı `dosyalar[]` alanına gider, istemci arşivi açmadan doğrulayabilsin diye.
  // Enjeksiyon SONRASI son arşivden türetilir: liste ile arşiv baytı birebir tutar.
  const dosyalar = zip.zipIcerigi(gecici);
  const oz = dosyaSha256(gecici);
  return {
    gecici,
    sha256: oz.sha256,
    boyut: oz.boyut,
    adet: dosyalar.length,
    dosyalar,
    fsShim,
    menuKaynak: { yollar: dosyalar.map((g) => g.yol), xmlBaslari },
  };
}

/**
 * Önceki imzalı G durumundaki bir kabuk dosyasının BAYTLARI: önce bu çıktı dizinindeki kopya,
 * yoksa/tutmuyorsa canlı uç (`<taban>/set/<id>/dosya/<yol>`); ikisinde de imzalı sha256+boyut
 * şart (menü tabanı kurcalanmış bir kopyadan kurulmaz).
 */
async function oncekiKabukVerisi(g, { setDizini, taban, setKimligi, getir }) {
  const yerel = path.join(setDizini, 'dosya', ...g.yol.split('/'));
  if (fs.existsSync(yerel)) {
    const v = fs.readFileSync(yerel);
    if (v.length === g.boyut && sha256(v) === g.sha256) return v;
  }
  const yol = g.yol.split('/').map(encodeURIComponent).join('/');
  const adres = `${taban}/set/${encodeURIComponent(setKimligi)}/dosya/${yol}`;
  const al =
    typeof getir === 'function' ? getir : (u) => kg.varsayilanGetir(u, { zamanAsimi: 30000 });
  let y = null;
  try {
    y = await al(adres);
  } catch (e) {
    y = null;
  }
  if (y && y.durum === 200) {
    const v = Buffer.from(y.govde);
    if (v.length === g.boyut && sha256(v) === g.sha256) return v;
    throw new Error(`önceki G menü dosyası imzalı sha256 ile tutmuyor: ${adres}`);
  }
  throw new Error(
    'önceki G menü dosyası bulunamadı (yerel kopya yok/tutmuyor, uç HTTP ' +
      `${y ? y.durum : 'hata'}): ${g.yol}`,
  );
}

/**
 * Kurulu menünün bilinen hâli (`menu.TABAN_YOLLARI`). Kaynak sırası dosya başına:
 * `--index` (yalnız index.html) > önceki imzalı G durumu > `--menu-taban <paketlenmiş SET kökü>`.
 * `--menu-taban`'da `empp-set.json` varsa set kimliği bu yayınınkiyle aynı olmalı.
 */
async function menuTabanlariTopla(girdi) {
  const { menuTaban, onceki, setDizini, taban, setKimligi, indexVeri, getir } = girdi;
  const tabanlar = new Map();
  const kaynaklar = {};
  const oncekiKabuk = new Map(((onceki && onceki.kabuk) || []).map((g) => [g.yol, g]));
  let dizin = null;
  if (menuTaban) {
    dizin = path.resolve(String(menuTaban));
    let st;
    try {
      st = fs.statSync(dizin);
    } catch (e) {
      throw new Error(`--menu-taban bulunamadı: ${dizin}`);
    }
    if (!st.isDirectory()) throw new Error(`--menu-taban dizin değil: ${dizin}`);
    const envanter = path.join(dizin, 'empp-set.json');
    if (fs.existsSync(envanter)) {
      let e;
      try {
        e = JSON.parse(fs.readFileSync(envanter, 'utf8'));
      } catch (h) {
        throw new Error(`--menu-taban: empp-set.json okunamadı: ${envanter}`);
      }
      if (e && e.setKimligi != null && String(e.setKimligi) !== setKimligi) {
        throw new Error(
          '--menu-taban başka setin paketi ' +
            `(empp-set.json setKimligi ${e.setKimligi} ≠ ${setKimligi})`,
        );
      }
    }
  }
  const kaydet = (yol, veri, kaynak) => {
    tabanlar.set(yol, veri);
    kaynaklar[yol] = { kaynak, sha256: sha256(veri) };
  };
  for (const yol of menu.TABAN_YOLLARI) {
    if (yol === durum.INDEX_YOLU && indexVeri) {
      kaydet(yol, indexVeri, '--index');
      continue;
    }
    const g = oncekiKabuk.get(yol);
    if (g) {
      kaydet(yol, await oncekiKabukVerisi(g, { setDizini, taban, setKimligi, getir }), 'onceki-G');
      continue;
    }
    if (!dizin) continue;
    const y = path.join(dizin, ...yol.split('/'));
    if (fs.existsSync(y) && fs.statSync(y).isFile()) {
      kaydet(yol, fs.readFileSync(y), '--menu-taban');
    }
  }
  return { tabanlar, kaynaklar };
}

/**
 * ANDROID EKLEME KAPISI — saf (bkz. `ANDROID_EKLEME_ANAHTARI`). `--ekle` içeren yayın, önceki
 * imzalı durumda devralınan ekleme olsa da olmasa da, anahtarsız RED. Girdiler ve imza anahtarı
 * okunmadan ÖNCE koşar: üretim anahtarına dokunulmaz, yüzlerce MB'lık arşiv hazırlanmaz.
 * @returns {string[]} bu yayında eklenen kitap dizinleri (sıralı; boşsa kapı ilgisiz)
 */
function androidEklemeKapisi(a) {
  const eklenen = Object.keys((a && a.ekle) || {}).sort();
  if (!eklenen.length || (a && a.androidEklemeDondururKabul === true)) return eklenen;
  throw new Error(
    `--ekle ${eklenen.join(',')} REDDEDİLDİ (Android kapısı): g-yayin eklenen kitabın arşivini ` +
      'yalnız Electron biçiminde üretir; Android istemcisi onu indirdikten sonra ' +
      `kitap-android-hazir-degil:${eklenen[0]} ile reddeder ve manifest eklemeyi sonraki her ` +
      "yayına taşıdığı için bu setin Android'i KALICI donar (motor düzeltmeleri dahil hiçbir G " +
      'güncellemesi alamaz). Kalıcı çözüm (öneri A/B) Nadir kararında: ' +
      `${ANDROID_EKLEME_ONERISI}. ` +
      '--cikar/--index/--motor bu kapıdan geçmez. Bilinçli geçiş (Android donmasını kabul): ' +
      ANDROID_EKLEME_ANAHTARI,
  );
}

/**
 * Yeni imzalı durumun Android özeti — saf. Durumda `ekle` girdisi varsa Android ucu DONUKTUR:
 * bu yayında anahtarla eklenen (`yeniEkleme`) ya da önceki imzalı durumdan devralınan
 * (`devralinanEkleme`). Yeni ekleme yoksa yayın bugünkü gibi geçer (kapı yalnız YENİ eklemeyi
 * keser; donma o eklemenin yayınlandığı anda oluşmuştur) ama uyarı her yayında görünür kalır.
 */
function androidDurumu(kitaplar, eklenen, kabul) {
  const eklemeler = (kitaplar || []).filter((k) => k && k.durum === 'ekle').map((k) => k.dizin);
  const yeniEkleme = eklemeler.filter((d) => eklenen.includes(d));
  const devralinanEkleme = eklemeler.filter((d) => !eklenen.includes(d));
  const donuk = eklemeler.length > 0;
  const parca = [];
  if (yeniEkleme.length) parca.push(`bu yayında ${ANDROID_EKLEME_ANAHTARI} ile: ${yeniEkleme}`);
  if (devralinanEkleme.length) parca.push(`önceki imzalı durumdan devralınan: ${devralinanEkleme}`);
  return {
    donuk,
    yeniEkleme,
    devralinanEkleme,
    kabul: kabul === true,
    uyari: donuk
      ? `ANDROID DONUK — imzalı durumda G ile eklenmiş kitap var (${parca.join('; ')}): Android ` +
        'istemcisi bu ve sonraki her sürümü kitap-android-hazir-degil ile reddeder (motor ' +
        `düzeltmeleri dahil); Windows/mac/Pardus etkilenmez. Öneri: ${ANDROID_EKLEME_ONERISI}`
      : null,
    dosya: null,
  };
}

function kitapAdi(dizin, sha) {
  return `${dizin}-${sha.slice(0, 16)}.zip`;
}

/* ------------------------------------------------------------------ yayınla */

/**
 * @param {object} a  `argsAyristir` çıktısı (programatik çağrıda doğrudan nesne)
 * @param {{saat?:Function, calistir?:Function, gunluk?:Function}} [ops]
 */
async function yayinla(a, ops = {}) {
  const gunluk = typeof ops.gunluk === 'function' ? ops.gunluk : (m) => console.warn(m);
  const setKimligi = kimlikDenetle(a.setKimligi);
  if (!a.taban || !kg.adresGuvenliMi(a.taban)) {
    throw new Error(`--taban https olmalı (yerel sınama için 127.0.0.1/localhost): ${a.taban}`);
  }
  const taban = String(a.taban).replace(/\/+$/, '');
  if (!a.cikti) throw new Error('--cikti zorunlu');
  if (a.surum && !gSurum.gecerliMi(a.surum))
    throw new Error(`--surum G3 biçiminde değil (2.<panel>.<sayaç>): ${a.surum}`);
  if (a.oncekiSurum && !gSurum.gecerliMi(a.oncekiSurum)) {
    throw new Error(`--onceki-surum G3 biçiminde değil: ${a.oncekiSurum}`);
  }
  if (!a.surum && a.panel == null)
    throw new Error('--panel <kod> ya da --surum 2.<panel>.<sayaç> gerekli');
  if (a.surum && a.panel != null && gSurum.panelKoduCoz(a.panel) !== gSurum.coz(a.surum).panel) {
    throw new Error(`--panel (${a.panel}) ile --surum (${a.surum}) çelişiyor`);
  }

  const cikti = path.resolve(String(a.cikti));
  const setDizini = path.join(cikti, 'set', setKimligi);
  const geciciDizin = path.join(cikti, '.g-yayin-gecici', setKimligi);
  const saat = typeof ops.saat === 'function' ? ops.saat : () => new Date().toISOString();

  // 0) Android ekleme kapısı — imza anahtarından ve girdilerden ÖNCE (anahtarsız --ekle RED).
  const eklenenKitaplar = androidEklemeKapisi(a);

  // 1) Anahtar — girdiler okunmadan önce: kaynak hatası erken düşsün.
  const an = await anahtar.anahtarYukle({
    zincir: a.anahtarZinciri,
    dosya: a.anahtarDosya,
    calistir: ops.calistir,
  });

  // 2) Önceki durum (imzası doğrulanmış).
  const oncekiKaynak = a.oncekiManifest || path.join(setDizini, 'manifest.json');
  const onceki = await oncekiManifestOku(oncekiKaynak, an.acik, setKimligi);
  if (onceki && a.ilk)
    throw new Error(`--ilk verildi ama önceki durum var (${onceki.surum}): ${oncekiKaynak}`);
  if (!onceki && !a.ilk) {
    throw new Error(
      `önceki durum bulunamadı: ${oncekiKaynak}. İlk yayınsa --ilk verin; canlıdaki ` +
        'durumdan devam için --onceki-manifest <adres>',
    );
  }
  if (a.ilk && !a.oncekiSurum && !a.surum) {
    throw new Error(
      '--ilk için kurulu paketin sürümünü verin (--onceki-surum 2.<panel>.<sayaç>) ya da ' +
        '--surum; ilk G sürümü paket sürümünden büyük olmalı (G3)',
    );
  }

  // 3) Sürüm — monoton.
  const oncekiler = [onceki && onceki.surum, a.oncekiSurum, yerelSurumOku(setDizini)].filter(
    Boolean,
  );
  const enSon = gSurum.enBuyuk(oncekiler);
  const surum = a.surum ? String(a.surum).trim() : gSurum.sonraki(a.panel, enSon);
  gSurum.monotonDenetle(surum, oncekiler);

  // 4) Girdiler.
  const degisiklik = { motorlar: {}, ekle: {}, cikar: [...new Set(a.cikar || [])] };
  const yazilacakKabuk = new Map();
  if (a.index) {
    const v = dosyaOku(a.index, '--index');
    indexDenetle(v, a.index);
    degisiklik.index = { sha256: sha256(v), boyut: v.length };
    yazilacakKabuk.set(durum.INDEX_YOLU, v);
  }
  for (const [d, y] of Object.entries(a.motorlar || {})) {
    const v = dosyaOku(y, `--motor ${d}`);
    degisiklik.motorlar[d] = { sha256: sha256(v), boyut: v.length };
    yazilacakKabuk.set(durum.motorYolu(d), v);
  }
  const arsivler = new Map();
  for (const [d, y] of Object.entries(a.ekle || {})) {
    if (!durum.KITAP_DIZIN_DESENI.test(d))
      throw new Error(`--ekle: kitap dizini book<N> olmalı: ${d}`);
    const ar = kitapArsiviHazirla(d, y, geciciDizin);
    if (ar.fsShim === 'index-yok') {
      gunluk(`[uyari] --ekle ${d}: kökte index.html yok — fs-shim enjekte edilmedi`);
    }
    const ad = kitapAdi(d, ar.sha256);
    const kaynak = `${taban}/set/${encodeURIComponent(setKimligi)}/kitap/${ad}`;
    arsivler.set(d, { ...ar, ad, kaynak });
    degisiklik.ekle[d] = { kaynak, sha256: ar.sha256, boyut: ar.boyut, dosyalar: ar.dosyalar };
  }

  // 4b) Menü: `--ekle`/`--cikar` kurulu paketin menüsüne yansır (menu.js) — biçim tanınmazsa,
  //     taban yoksa ya da eklenen kitabın menü girdisi kurulamıyorsa yayın RED (sessiz geçiş yok).
  const basliklar = a.baslik || {};
  for (const d of Object.keys(basliklar)) {
    if (!(d in (a.ekle || {})))
      throw new Error(`--baslik ${d}: yalnız --ekle edilen kitaba verilir`);
  }
  let menuRaporu = null;
  if (Object.keys(degisiklik.ekle).length || degisiklik.cikar.length) {
    const t = await menuTabanlariTopla({
      menuTaban: a.menuTaban,
      onceki,
      setDizini,
      taban,
      setKimligi,
      indexVeri: yazilacakKabuk.get(durum.INDEX_YOLU) || null,
      getir: ops.getir,
    });
    const bilgiler = {};
    for (const [d, ar] of arsivler) {
      const mk = ar.menuKaynak;
      bilgiler[d] = menu.kitapBilgisi(d, mk.yollar, mk.xmlBaslari, basliklar[d]);
    }
    const m = menu.menuGuncelle({ tabanlar: t.tabanlar, ekle: bilgiler, cikar: degisiklik.cikar });
    for (const [yol, v] of m.dosyalar) {
      yazilacakKabuk.set(yol, v);
      const oz = { sha256: sha256(v), boyut: v.length };
      if (yol === durum.INDEX_YOLU) degisiklik.index = oz;
      else (degisiklik.menu = degisiklik.menu || {})[yol] = oz;
    }
    for (const [d, b] of Object.entries(bilgiler)) {
      if (!b.ad) {
        gunluk(`[uyari] --ekle ${d}: kitap adı yok (--baslik, BookContent.xml) — varsayılan ad`);
      }
    }
    menuRaporu = {
      bicim: m.bicim,
      kitaplar: m.kitaplar,
      degisen: [...m.dosyalar.keys()].sort(),
      tabanlar: t.kaynaklar,
    };
  }

  // 5) Yeni tam durum.
  const yeni = durum.birlestir(onceki, degisiklik);
  const android = androidDurumu(yeni.kitaplar, eklenenKitaplar, a.androidEklemeDondururKabul);

  // 6) Manifest + imza.
  const uretim = saat();
  const manifest = {
    sema: MANIFEST_SEMASI,
    kanal: KANAL,
    setKimligi,
    surum,
    onceki: enSon,
    uretim,
    anahtar: an.parmakIzi,
    kabuk: yeni.kabuk,
    kitaplar: yeni.kitaplar,
  };
  const govde = Buffer.from(JSON.stringify(manifest), 'utf8');
  const imza = anahtar.imzala(govde, an.ozel, an.acik);
  const surumJson = Buffer.from(JSON.stringify({ surum, uretim, setKimligi }), 'utf8');

  // 7) Yaz — sıra R2 yükleme sırasıyla aynı: içerik → sürüm arşivi → manifest → surum.json EN SON.
  const plan = [];
  const ekle = (sira, goreli, yerel, degismez) => {
    const oz = dosyaSha256(yerel);
    plan.push({
      sira,
      anahtar: `${R2_ONEKI}/set/${setKimligi}/${goreli}`,
      yerel,
      boyut: oz.boyut,
      sha256: oz.sha256,
      contentType: icerikTuru(goreli),
      cacheControl: degismez ? CACHE_DEGISMEZ : CACHE_DEGISKEN,
    });
  };
  for (const [d, ar] of arsivler) {
    // İçerik-adresli ad: aynı sha256 aynı dosya; üstüne taşımak zararsız, geçici artık kalmaz.
    const hedef = path.join(setDizini, 'kitap', ar.ad);
    fs.mkdirSync(path.dirname(hedef), { recursive: true });
    fs.renameSync(ar.gecici, hedef);
    if (yeni.ozet.degisenKitap.includes(d)) ekle(1, `kitap/${ar.ad}`, hedef, true);
  }
  for (const yol of yeni.ozet.degisenKabuk) {
    const v = yazilacakKabuk.get(yol);
    if (!v) throw new Error(`iç tutarsızlık: değişen kabuk girdisinin verisi yok: ${yol}`);
    const hedef = path.join(setDizini, 'dosya', ...yol.split('/'));
    atomikYaz(hedef, v);
    ekle(2, `dosya/${yol}`, hedef, false);
    // Android G ucu — AYNI baytlar, ayrı R2 anahtarı (istemci kendi kökünden okur).
    const androidHedef = path.join(setDizini, ANDROID_ONEKI, 'dosya', ...yol.split('/'));
    atomikYaz(androidHedef, v);
    ekle(2, `${ANDROID_ONEKI}/dosya/${yol}`, androidHedef, false);
  }
  const arsivDizini = path.join(setDizini, 'surumler', surum);
  atomikYaz(path.join(arsivDizini, 'manifest.json'), govde);
  atomikYaz(path.join(arsivDizini, 'manifest.json' + kg.IMZA_UZANTI), imza);
  ekle(3, `surumler/${surum}/manifest.json`, path.join(arsivDizini, 'manifest.json'), true);
  ekle(
    3,
    `surumler/${surum}/manifest.json${kg.IMZA_UZANTI}`,
    path.join(arsivDizini, 'manifest.json' + kg.IMZA_UZANTI),
    true,
  );
  atomikYaz(path.join(setDizini, 'manifest.json'), govde);
  atomikYaz(path.join(setDizini, 'manifest.json' + kg.IMZA_UZANTI), imza);
  ekle(4, 'manifest.json', path.join(setDizini, 'manifest.json'), false);
  ekle(
    4,
    `manifest.json${kg.IMZA_UZANTI}`,
    path.join(setDizini, 'manifest.json' + kg.IMZA_UZANTI),
    false,
  );
  // Android G ucu — TEK imza paylaşılır: aynı govde/imza baytları android/ önekinde de durur.
  const androidDizini = path.join(setDizini, ANDROID_ONEKI);
  atomikYaz(path.join(androidDizini, 'manifest.json'), govde);
  atomikYaz(path.join(androidDizini, 'manifest.json' + kg.IMZA_UZANTI), imza);
  ekle(4, `${ANDROID_ONEKI}/manifest.json`, path.join(androidDizini, 'manifest.json'), false);
  ekle(
    4,
    `${ANDROID_ONEKI}/manifest.json${kg.IMZA_UZANTI}`,
    path.join(androidDizini, 'manifest.json' + kg.IMZA_UZANTI),
    false,
  );
  atomikYaz(path.join(setDizini, 'surum.json'), surumJson);
  ekle(5, 'surum.json', path.join(setDizini, 'surum.json'), false);
  atomikYaz(path.join(androidDizini, 'surum.json'), surumJson);
  ekle(5, `${ANDROID_ONEKI}/surum.json`, path.join(androidDizini, 'surum.json'), false);
  // Android donuksa manifestin YANINDA görünür uyarı (yüklenmez — plan dışı); durum artık donuk
  // değilse (eklenen kitap çıkarıldı) önceki yayından kalan bayat uyarı kaldırılır.
  const donukYolu = path.join(setDizini, ANDROID_DONUK_DOSYASI);
  if (android.donuk) {
    atomikYaz(
      donukYolu,
      `${android.uyari}\n\nset ${setKimligi} · G ${surum} · ${uretim}\n` +
        `yeni ekleme: ${android.yeniEkleme.join(', ') || '-'}\n` +
        `devralınan ekleme: ${android.devralinanEkleme.join(', ') || '-'}\n`,
    );
    android.dosya = donukYolu;
    gunluk(`[uyari] ${android.uyari}`);
  } else if (fs.existsSync(donukYolu)) {
    fs.unlinkSync(donukYolu);
  }

  // 8) Diskten geri oku ve doğrula.
  const denetim = ciktiDogrula({ cikti, setKimligi, acik: an.acik });
  if (!denetim.gecti || denetim.surum !== surum) {
    throw new Error(
      `yazılan çıktı doğrulanmadı: ${denetim.hatalar.join('; ') || 'sürüm uyuşmadı'}`,
    );
  }
  for (const u of denetim.uyarilar) gunluk(`[uyari] ${u}`);

  // 9) Yükleme planı + rapor (set/ ağacının DIŞINDA; yüklenmez).
  const kimlikYolu = `${taban}/set/${encodeURIComponent(setKimligi)}`;
  const rapor = {
    setKimligi,
    surum,
    onceki: enSon,
    taban,
    anahtar: {
      kaynak: an.kaynak,
      parmakIzi: an.parmakIzi,
      uretim: an.acik === anahtar.URETIM_ACIK_ANAHTAR,
    },
    kabuk: yeni.kabuk.length,
    kitaplar: yeni.kitaplar.length,
    degisenKabuk: yeni.ozet.degisenKabuk,
    dusenKabuk: yeni.ozet.dusenKabuk,
    degisenKitap: yeni.ozet.degisenKitap,
    /** Eklenen kitap → fs-shim sonucu ('enjekte' | 'zaten-var' | 'index-yok'). */
    fsShim: Object.fromEntries([...arsivler].map(([d, ar]) => [d, ar.fsShim])),
    /** `--ekle`/`--cikar`'ın menüye yansıması: biçim, kitap sonuçları, değişenler, tabanlar. */
    menu: menuRaporu,
    /** Android ekleme kapısı: {donuk, yeniEkleme, devralinanEkleme, kabul, uyari, dosya}. */
    android,
    yerelEksik: denetim.yerelEksik,
    cikti: setDizini,
    plan: null,
  };
  const planYolu = path.join(cikti, 'yayin', setKimligi, `${surum}.json`);
  atomikYaz(
    planYolu,
    JSON.stringify(
      {
        ...rapor,
        yukle: plan.sort((x, y) => x.sira - y.sira),
        dogrula: [
          { adres: `${kimlikYolu}/surum.json`, beklenenSurum: surum },
          {
            adres: `${kimlikYolu}/manifest.json`,
            imza: `${kimlikYolu}/manifest.json${kg.IMZA_UZANTI}`,
            acikAnahtar: an.acik,
          },
        ],
      },
      null,
      2,
    ) + '\n',
  );
  rapor.plan = planYolu;
  return rapor;
}

/* ------------------------------------------------------------------ doğrula */

/**
 * Çıktı dizinindeki son sürümü denetler: imza (verilen açık anahtar), kanal/kimlik/sürüm,
 * surum.json eşliği, yereldeki `dosya/` ve `kitap/` dosyalarının sha256/boyutu.
 * Yerelde olmayan taşınan dosya HATA değil uyarıdır (R2'de olmalı).
 */
function ciktiDogrula({ cikti, setKimligi, acik }) {
  const hatalar = [];
  const uyarilar = [];
  const yerelEksik = [];
  const setDizini = path.join(path.resolve(String(cikti)), 'set', String(setKimligi));
  const sonuc = (ek) => ({ gecti: hatalar.length === 0, hatalar, uyarilar, yerelEksik, ...ek });
  let govde;
  let imza;
  let m;
  try {
    govde = fs.readFileSync(path.join(setDizini, 'manifest.json'));
    imza = fs.readFileSync(path.join(setDizini, 'manifest.json' + kg.IMZA_UZANTI), 'utf8');
  } catch (e) {
    hatalar.push(`manifest ya da imza okunamadı: ${setDizini}`);
    return sonuc({ surum: null });
  }
  if (!anahtar.dogrula(govde, imza, acik)) {
    hatalar.push(`imza doğrulanmadı (anahtar ${anahtar.kisaIz(anahtar.parmakIzi(acik))})`);
    return sonuc({ surum: null });
  }
  try {
    m = JSON.parse(govde.toString('utf8'));
  } catch (e) {
    hatalar.push('manifest JSON değil');
    return sonuc({ surum: null });
  }
  if (m.kanal !== KANAL) hatalar.push(`kanal G değil: ${m.kanal}`);
  if (String(m.setKimligi) !== String(setKimligi))
    hatalar.push(`setKimligi uyuşmuyor: ${m.setKimligi}`);
  if (!gSurum.gecerliMi(m.surum)) hatalar.push(`sürüm G3 değil: ${m.surum}`);
  if (!kg.manifestiDogrula(m)) hatalar.push('manifest istemci doğrulamasından geçmedi');
  try {
    const s = JSON.parse(fs.readFileSync(path.join(setDizini, 'surum.json'), 'utf8'));
    if (s.surum !== m.surum) hatalar.push(`surum.json (${s.surum}) ≠ manifest (${m.surum})`);
  } catch (e) {
    hatalar.push('surum.json okunamadı');
  }
  for (const g of Array.isArray(m.kabuk) ? m.kabuk : []) {
    if (!kg.kabukGirdisiGecerliMi(g) || !durum.gYoluMu(g.yol)) {
      hatalar.push(`kabuk girdisi bozuk: ${g && g.yol}`);
      continue;
    }
    const y = path.join(setDizini, 'dosya', ...g.yol.split('/'));
    if (!fs.existsSync(y)) {
      yerelEksik.push(`dosya/${g.yol}`);
      continue;
    }
    const oz = dosyaSha256(y);
    if (oz.sha256 !== g.sha256 || oz.boyut !== g.boyut)
      hatalar.push(`dosya/${g.yol} sha256/boyut manifestle uyuşmuyor`);
  }
  const kitapOneki = `/set/${encodeURIComponent(String(setKimligi))}/kitap/`;
  for (const g of Array.isArray(m.kitaplar) ? m.kitaplar : []) {
    if (!kg.uyelikGirdisiGecerliMi(g)) {
      hatalar.push(`kitap girdisi bozuk: ${g && g.dizin}`);
      continue;
    }
    if (g.durum !== 'ekle') continue;
    const i = g.kaynak.indexOf(kitapOneki);
    if (i === -1) {
      uyarilar.push(`${g.dizin} arşivi bu kimlik kökünde değil: ${g.kaynak}`);
      continue;
    }
    const ad = decodeURIComponent(g.kaynak.slice(i + kitapOneki.length));
    const y = path.join(setDizini, 'kitap', ad);
    if (!fs.existsSync(y)) {
      yerelEksik.push(`kitap/${ad}`);
      continue;
    }
    const oz = dosyaSha256(y);
    if (oz.sha256 !== g.sha256 || oz.boyut !== g.boyut) {
      hatalar.push(`kitap/${ad} sha256/boyut manifestle uyuşmuyor`);
    } else if (g.dosyalar !== undefined) {
      if (!durum.dosyalarGecerliMi(g.dosyalar)) {
        hatalar.push(`kitap/${ad} dosyalar listesi bozuk`);
      } else {
        try {
          const uyusmazlik = dosyalarKarsilastir(g.dosyalar, zip.zipIcerigi(y));
          if (uyusmazlik) hatalar.push(`kitap/${ad}: ${uyusmazlik}`);
        } catch (e) {
          hatalar.push(`kitap/${ad} dosyalar listesiyle denetlenemedi: ${e.message}`);
        }
      }
    }
  }
  // Android G ucu — TEK imza paylaşılır: android/manifest.json(.sig) canonical'ın BİREBİR
  // aynısı olmalı (ayrı bir yayın/imza YOK); android/dosya/<yol> aynı sha256'yı taşımalı.
  const androidDizini = path.join(setDizini, ANDROID_ONEKI);
  try {
    const aGovde = fs.readFileSync(path.join(androidDizini, 'manifest.json'));
    const aImza = fs.readFileSync(path.join(androidDizini, 'manifest.json' + kg.IMZA_UZANTI), 'utf8');
    if (!aGovde.equals(govde) || aImza !== imza) {
      hatalar.push('android/manifest.json(.sig) canonical manifestle birebir aynı değil');
    }
  } catch (e) {
    hatalar.push(`android manifest ya da imza okunamadı: ${androidDizini}`);
  }
  for (const g of Array.isArray(m.kabuk) ? m.kabuk : []) {
    if (!kg.kabukGirdisiGecerliMi(g) || !durum.gYoluMu(g.yol)) continue;
    const y = path.join(androidDizini, 'dosya', ...g.yol.split('/'));
    if (!fs.existsSync(y)) {
      yerelEksik.push(`${ANDROID_ONEKI}/dosya/${g.yol}`);
      continue;
    }
    const oz = dosyaSha256(y);
    if (oz.sha256 !== g.sha256 || oz.boyut !== g.boyut)
      hatalar.push(`${ANDROID_ONEKI}/dosya/${g.yol} sha256/boyut manifestle uyuşmuyor`);
  }
  if (yerelEksik.length)
    uyarilar.push(`yerelde olmayan taşınan dosya (R2'de olmalı): ${yerelEksik.join(', ')}`);
  return sonuc({ surum: m.surum, kabuk: m.kabuk.length, kitaplar: (m.kitaplar || []).length });
}

/**
 * YAYIN SONRASI DOĞRULAMA — canlı uçtan (CDN/R2) indirir, istemcinin göreceği gibi denetler:
 * imza (varsayılan ÜRETİM açık anahtarı), kanal/kimlik/sürüm, surum.json eşliği, her `dosya/<yol>`
 * sha256+boyut; Android ucu (`android/{surum.json, manifest.json(.sig), dosya/<yol>}`) — eksikse
 * RED; `arsivler` ile kitap arşivleri de akışla indirilip (diske yazılmadan) özetlenir.
 * Yalnız GET yapar; hiçbir şey yazmaz.
 */
async function uzakDogrula({
  taban,
  setKimligi,
  acik,
  beklenenSurum = null,
  arsivler = false,
  getir,
  arsiviIndir,
}) {
  const bas = Date.now();
  const al = typeof getir === 'function' ? getir : kg.varsayilanGetir;
  const akisla = typeof arsiviIndir === 'function' ? arsiviIndir : kg.varsayilanArsiviIndir;
  const hatalar = [];
  const sonuc = (ek) => ({ gecti: hatalar.length === 0, hatalar, sureMs: Date.now() - bas, ...ek });
  const t = String(taban || '').replace(/\/+$/, '');
  if (!kg.adresGuvenliMi(t)) {
    hatalar.push(`taban https değil: ${t}`);
    return sonuc({ surum: null });
  }
  const kok = `${t}/set/${encodeURIComponent(String(setKimligi))}`;
  const getirB = async (adres) => {
    const y = await al(adres, { zamanAsimi: 30000 });
    if (!y || y.durum !== 200) throw new Error(`HTTP ${y ? y.durum : 'yok'}: ${adres}`);
    return Buffer.from(y.govde);
  };
  let govde;
  let imza;
  let surumJson;
  let m;
  try {
    surumJson = JSON.parse((await getirB(`${kok}/surum.json`)).toString('utf8'));
    govde = await getirB(`${kok}/manifest.json`);
    imza = (await getirB(`${kok}/manifest.json${kg.IMZA_UZANTI}`)).toString('utf8');
  } catch (e) {
    hatalar.push(e.message);
    return sonuc({ surum: null });
  }
  if (!anahtar.dogrula(govde, imza, acik)) {
    hatalar.push(`imza doğrulanmadı (anahtar ${anahtar.kisaIz(anahtar.parmakIzi(acik))})`);
    return sonuc({ surum: null });
  }
  try {
    m = JSON.parse(govde.toString('utf8'));
  } catch (e) {
    hatalar.push('manifest JSON değil');
    return sonuc({ surum: null });
  }
  if (m.kanal !== KANAL) hatalar.push(`kanal G değil: ${m.kanal}`);
  if (String(m.setKimligi) !== String(setKimligi))
    hatalar.push(`setKimligi uyuşmuyor: ${m.setKimligi}`);
  if (!gSurum.gecerliMi(m.surum)) hatalar.push(`sürüm G3 değil: ${m.surum}`);
  if (!kg.manifestiDogrula(m)) hatalar.push('manifest istemci doğrulamasından geçmedi');
  if (!surumJson || surumJson.surum !== m.surum)
    hatalar.push(`surum.json (${surumJson && surumJson.surum}) ≠ manifest (${m.surum})`);
  if (beklenenSurum && m.surum !== beklenenSurum)
    hatalar.push(`canlı sürüm ${m.surum} ≠ beklenen ${beklenenSurum}`);
  let dosya = 0;
  let arsiv = 0;
  for (const g of Array.isArray(m.kabuk) ? m.kabuk : []) {
    if (!kg.kabukGirdisiGecerliMi(g) || !durum.gYoluMu(g.yol)) {
      hatalar.push(`kabuk girdisi bozuk: ${g && g.yol}`);
      continue;
    }
    try {
      const v = await getirB(`${kok}/dosya/${g.yol.split('/').map(encodeURIComponent).join('/')}`);
      if (v.length !== g.boyut || sha256(v) !== g.sha256)
        hatalar.push(`dosya/${g.yol} sha256/boyut tutmuyor`);
      dosya += 1;
    } catch (e) {
      hatalar.push(e.message);
    }
  }
  // Android G ucu — istemci (`empp-g-istemci.js` `kimlikKoku`) surum.json, manifest.json(.sig)
  // ve dosya/<yol>'u `<taban>/set/<id>/android/` altından ister (kitap arşivi paylaşılan kitap/
  // adresinden). Eksik uç = Android istemcisi 404 → HİÇ güncelleme görmez: RED. TEK imza
  // paylaşılır: android manifest+imza canonical'ın BİREBİR aynısı olmalı.
  const aKok = `${kok}/${ANDROID_ONEKI}`;
  let androidDosya = 0;
  try {
    const aSurum = JSON.parse((await getirB(`${aKok}/surum.json`)).toString('utf8'));
    const aGovde = await getirB(`${aKok}/manifest.json`);
    const aImza = (await getirB(`${aKok}/manifest.json${kg.IMZA_UZANTI}`)).toString('utf8');
    if (!aGovde.equals(govde) || aImza !== imza)
      hatalar.push(`${ANDROID_ONEKI}/manifest.json(.sig) canonical manifestle birebir aynı değil`);
    if (!aSurum || aSurum.surum !== m.surum)
      hatalar.push(
        `${ANDROID_ONEKI}/surum.json (${aSurum && aSurum.surum}) ≠ manifest (${m.surum})`,
      );
  } catch (e) {
    hatalar.push(`${ANDROID_ONEKI} ucu: ${e.message}`);
  }
  for (const g of Array.isArray(m.kabuk) ? m.kabuk : []) {
    if (!kg.kabukGirdisiGecerliMi(g) || !durum.gYoluMu(g.yol)) continue;
    try {
      const v = await getirB(`${aKok}/dosya/${g.yol.split('/').map(encodeURIComponent).join('/')}`);
      if (v.length !== g.boyut || sha256(v) !== g.sha256)
        hatalar.push(`${ANDROID_ONEKI}/dosya/${g.yol} sha256/boyut tutmuyor`);
      androidDosya += 1;
    } catch (e) {
      hatalar.push(`${ANDROID_ONEKI} ucu: ${e.message}`);
    }
  }
  if (arsivler) {
    for (const g of (m.kitaplar || []).filter((x) => x && x.durum === 'ekle')) {
      // `dosyalar[]` varsa gerçek baytlar gerekir (kıyas için) — geçici bir dosyaya iner,
      // yoksa eskisi gibi hiçbir şey yazılmadan akışla atılır (`/dev/null`).
      const listeVar = g.dosyalar !== undefined;
      if (listeVar && !durum.dosyalarGecerliMi(g.dosyalar)) {
        hatalar.push(`${g.dizin}: dosyalar listesi bozuk`);
        arsiv += 1;
        continue;
      }
      const gecici = listeVar
        ? path.join(
            os.tmpdir(),
            `g-yayin-dogrula-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.zip`,
          )
        : null;
      try {
        const r = await akisla(
          g.kaynak,
          gecici || (process.platform === 'win32' ? 'NUL' : '/dev/null'),
          { zamanAsimi: 120000 },
        );
        if (r.durum !== 200) {
          hatalar.push(`HTTP ${r.durum}: ${g.kaynak}`);
        } else if (r.boyut !== g.boyut || r.ozet !== g.sha256) {
          hatalar.push(`${g.dizin} arşivi sha256/boyut tutmuyor`);
        } else if (gecici) {
          const uyusmazlik = dosyalarKarsilastir(g.dosyalar, zip.zipIcerigi(gecici));
          if (uyusmazlik) hatalar.push(`${g.dizin}: ${uyusmazlik}`);
        }
        arsiv += 1;
      } catch (e) {
        hatalar.push(`${g.dizin} arşivi indirilemedi: ${e.message}`);
      } finally {
        if (gecici) {
          try {
            fs.unlinkSync(gecici);
          } catch (e) {}
        }
      }
    }
  }
  return sonuc({ surum: m.surum, dosya, androidDosya, arsiv, kitaplar: (m.kitaplar || []).length });
}

/* ------------------------------------------------------------------ CLI */

async function main(argv, ops = {}) {
  const a = argsAyristir(argv);
  if (a.komut === 'kuru-imza') {
    const s = await anahtar.kuruImza({ calistir: ops.calistir });
    return { cikis: s.gecti ? 0 : 1, metin: s.gecti ? 'GEÇTİ' : `KALDI: ${s.sebep}` };
  }
  if (a.komut === 'dogrula') {
    const setKimligi = kimlikDenetle(a.setKimligi);
    let acik = a.acikAnahtar || anahtar.URETIM_ACIK_ANAHTAR;
    if (a.anahtarDosya)
      acik = anahtar.acikAnahtarB64(
        anahtar.dosyadanOku(a.anahtarDosya === true ? undefined : a.anahtarDosya),
      );
    if (a.uzak) {
      const u = await uzakDogrula({
        taban: a.uzak,
        setKimligi,
        acik,
        beklenenSurum: a.surum,
        arsivler: a.arsivler,
      });
      return { cikis: u.gecti ? 0 : 1, metin: JSON.stringify(u, null, 2) };
    }
    if (!a.cikti) throw new Error('--cikti ya da --uzak <taban> zorunlu');
    const d = ciktiDogrula({ cikti: a.cikti, setKimligi, acik });
    return { cikis: d.gecti ? 0 : 1, metin: JSON.stringify(d, null, 2) };
  }
  if (a.komut === 'yukle') {
    const r = await require('./yukle').yukle(a, ops);
    return { cikis: r.gecti ? 0 : 1, metin: JSON.stringify(r, null, 2) };
  }
  if (a.komut === 'e2e') {
    const r = await require('./yukle').e2e(a, ops);
    return { cikis: r.rc, metin: JSON.stringify(r, null, 2) };
  }
  const r = await yayinla(a, ops);
  return { cikis: 0, metin: JSON.stringify(r, null, 2) };
}

module.exports = {
  KIMLIK_DESENI,
  ANDROID_ONEKI,
  ANDROID_EKLEME_ANAHTARI,
  ANDROID_EKLEME_ONERISI,
  ANDROID_DONUK_DOSYASI,
  androidEklemeKapisi,
  androidDurumu,
  MANIFEST_SEMASI,
  KANAL,
  R2_ONEKI,
  CACHE_DEGISMEZ,
  CACHE_DEGISKEN,
  icerikTuru,
  argsAyristir,
  kimlikDenetle,
  oncekiManifestOku,
  kitapArsiviHazirla,
  kitapAdi,
  dosyalarKarsilastir,
  yayinla,
  ciktiDogrula,
  uzakDogrula,
  main,
};

// Dışa açım yukarıda: yukle.js bu modülü geri çağırır, main ondan SONRA koşmalı.
if (require.main === module) {
  main(process.argv.slice(2))
    .then((s) => {
      console.log(s.metin);
      process.exitCode = s.cikis;
    })
    .catch((e) => {
      console.error('HATA: ' + (e && e.message ? e.message : e));
      process.exitCode = 1;
    });
}

#!/usr/bin/env node
'use strict';

/**
 * G YAYIN ARACI — uzaktan güncelleme kanalı (G) için bir SET'in yeni durumunu üretir:
 * `surum.json` + `manifest.json` + `manifest.json.sig` + değişen dosyalar + yükleme planı.
 * R2'ye YAZMAZ; çıktı R2 anahtar düzenini birebir yansıtan yerel bir dizindir.
 *
 * Kapsam (Nadir 26.09): kök `index.html`, set bileşimi (kitap ekle/çıkar), her kitabın
 * `bookN/43e23fce2b7009474555a77.js` motoru. Sözleşmeler: `windows-paketleme-sozlesmesi.md`
 * G3/G4, `platform-kanallari-sozlesmesi.md` O3/O4, tasarım `g-yayin-r2-yol-tasarimi.md`.
 *
 *   Sürüm   `2.<panel>.<sayaç>`, bilinen her önceki sürümden KESİN büyük (g-surum.js).
 *   Durum   birikimli: önceki imzalı manifest + bu yayının değişiklikleri (durum.js).
 *   İmza    ed25519, manifestin YAZILAN baytları üzerinde; anahtar Anahtar Zinciri
 *           (üretim) ya da dosya (TEST) — anahtar.js.
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
const path = require('path');
const crypto = require('crypto');
const kg = require('../../src/runtime/kitap-guncelleyici');
const gSurum = require('./g-surum');
const anahtar = require('./anahtar');
const zip = require('./zip-yaz');
const durum = require('./durum');

/** `src/packaging/set-kimligi.js` KIMLIK_DESENI ile aynı (sentinel testte kıyaslanır). */
const KIMLIK_DESENI = /^[A-Za-z0-9._:-]{1,64}$/;
const MANIFEST_SEMASI = 1;
const KANAL = 'G';
/** R2 kovasında anahtar öneki: taban = `<publicUrl>/guncelleme` ↔ anahtar `guncelleme/…`. */
const R2_ONEKI = 'guncelleme';
const CACHE_DEGISMEZ = 'public, max-age=31536000, immutable';
const CACHE_DEGISKEN = 'no-cache';
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
    anahtarZinciri: false,
    anahtarDosya: null,
    acikAnahtar: null,
    uzak: null,
    arsivler: false,
    onayli: false,
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
    else if (b === '--anahtar-zinciri') a.anahtarZinciri = true;
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

/** Arşiv kaynağı (dizin ya da zip) → geçici dizinde doğrulanmış zip. */
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
  if (st.isDirectory()) {
    const girdiler = zip.dizindenGirdiler(y);
    if (!girdiler.length) throw new Error(`--ekle ${dizin}: dizin boş: ${y}`);
    zip.zipYaz(gecici, girdiler);
  } else if (st.isFile()) {
    fs.copyFileSync(y, gecici);
  } else {
    throw new Error(`--ekle ${dizin}: kaynak dosya ya da dizin değil: ${y}`);
  }
  const denetim = zip.zipDenetle(gecici);
  const oz = dosyaSha256(gecici);
  return { gecici, sha256: oz.sha256, boyut: oz.boyut, adet: denetim.adet };
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
    const ad = kitapAdi(d, ar.sha256);
    const kaynak = `${taban}/set/${encodeURIComponent(setKimligi)}/kitap/${ad}`;
    arsivler.set(d, { ...ar, ad, kaynak });
    degisiklik.ekle[d] = { kaynak, sha256: ar.sha256, boyut: ar.boyut };
  }

  // 5) Yeni tam durum.
  const yeni = durum.birlestir(onceki, degisiklik);

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
  atomikYaz(path.join(setDizini, 'surum.json'), surumJson);
  ekle(5, 'surum.json', path.join(setDizini, 'surum.json'), false);

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
    if (oz.sha256 !== g.sha256 || oz.boyut !== g.boyut)
      hatalar.push(`kitap/${ad} sha256/boyut manifestle uyuşmuyor`);
  }
  if (yerelEksik.length)
    uyarilar.push(`yerelde olmayan taşınan dosya (R2'de olmalı): ${yerelEksik.join(', ')}`);
  return sonuc({ surum: m.surum, kabuk: m.kabuk.length, kitaplar: (m.kitaplar || []).length });
}

/**
 * YAYIN SONRASI DOĞRULAMA — canlı uçtan (CDN/R2) indirir, istemcinin göreceği gibi denetler:
 * imza (varsayılan ÜRETİM açık anahtarı), kanal/kimlik/sürüm, surum.json eşliği, her `dosya/<yol>`
 * sha256+boyut; `arsivler` ile kitap arşivleri de akışla indirilip (diske yazılmadan) özetlenir.
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
  if (arsivler) {
    for (const g of (m.kitaplar || []).filter((x) => x && x.durum === 'ekle')) {
      try {
        const r = await akisla(g.kaynak, process.platform === 'win32' ? 'NUL' : '/dev/null', {
          zamanAsimi: 120000,
        });
        if (r.durum !== 200) hatalar.push(`HTTP ${r.durum}: ${g.kaynak}`);
        else if (r.boyut !== g.boyut || r.ozet !== g.sha256)
          hatalar.push(`${g.dizin} arşivi sha256/boyut tutmuyor`);
        arsiv += 1;
      } catch (e) {
        hatalar.push(`${g.dizin} arşivi indirilemedi: ${e.message}`);
      }
    }
  }
  return sonuc({ surum: m.surum, dosya, arsiv, kitaplar: (m.kitaplar || []).length });
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

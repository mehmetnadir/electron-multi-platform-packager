'use strict';

/**
 * İMPARK KURULUMUNU DEVRALMA VE KALDIRMA — çalışma anı modülü (sözleşme G6).
 * Pakete `empp-impark-kaldir.js` adıyla kopyalanır; YALNIZ Windows'ta iş yapar.
 *
 * Neden: okul tahtasında aynı kitabın hem İmpark (WinRAR SFX → C:\DijiTap\<vhost>\<ad>)
 * hem bizim kurulumumuz dururken öğretmen masaüstünde iki simge görür; eskisi
 * güncellenmez. Bizimki kurulup AÇILDIKTAN sonra eskisi kaldırılır — ama önce
 * aktivasyon ve kullanıcı verisi bizim userData'mıza taşınır.
 *
 * KESİN KURALLAR (sözleşme G6):
 *   1. Yalnız KİMLİĞİ BİREBİR eşleşen klasöre dokunulur: `C:\DijiTap\<vhost>\<ad>`,
 *      içinde `ZKitap.exe` ve `resources\app\package.json` adı `zkitap`, ve
 *      `resources\app\build` altındaki kurum.txt + her kitabın `assets/<id>` kimliği
 *      bizim paketimizinkiyle AYNI küme. Herhangi biri okunamazsa → "emin değil" → dokunma.
 *   2. Paylaşılan İmpark userData'sı (%APPDATA%\zkitap) ASLA silinmez — başka İmpark
 *      kitapları da onu kullanır. Bu modül o dizine hiç dokunmaz.
 *   3. Önce TAŞI, sonra SİL: aktivasyon (classlibraries/ImWin32.dll, assets/<id>/imKeys.dll)
 *      ve kullanıcı verisi (temp/) bizim userData/work'e kopyalanır; hedefte dosya
 *      varsa ÜZERİNE YAZILMAZ.
 *   4. Yükseltme istemez: silme yetkisi yoksa (EPERM/EACCES/EBUSY) atlar ve günlüğe yazar.
 *   5. ZKitap.exe çalışıyorsa ya da süreç listesi alınamıyorsa o açılışta silmez.
 *   6. Kısayol: yalnız İÇİNDE o klasörün yolu geçen .lnk dosyaları silinir, klasör
 *      tamamen silindikten SONRA.
 *
 * Günlük: `acilis-zamanlama.log`'a `[uygulama] ... impark ...` satırları (yaz fonksiyonu enjekte).
 */

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

const ISARET = 'EMPP_IMPARK_KALDIR';
const IMPARK_EXE = 'ZKitap.exe';
const IMPARK_PAKET_ADI = 'zkitap';
const SILINECEK_EKI = '.empp-silinecek';
const TEMP_TAVAN_BAYT = 50 * 1024 * 1024;
const DURUM_DOSYASI = 'empp-impark-kaldirma.json';
const VARSAYILAN_GECIKME_MS = 15000;

/** Paket kökünden kimlik okur: kurum + kitap dizini → assets/<id>. Okunamazsa null. */
function kimlikOku(kok, fsMod = fs, pathMod = path) {
  try {
    const kurum = String(fsMod.readFileSync(pathMod.join(kok, 'kurum.txt'), 'utf8')).trim();
    if (!/^\d+$/.test(kurum)) return null;
    const kitaplar = {};
    const assetsKimligi = (dizin) => {
      try {
        const ic = fsMod.readdirSync(pathMod.join(dizin, 'assets'), { withFileTypes: true })
          .filter((d) => d.isDirectory() && /^\d+$/.test(d.name)).map((d) => d.name);
        return ic.length === 1 ? ic[0] : null;
      } catch (e) { return null; }
    };
    for (const d of fsMod.readdirSync(kok, { withFileTypes: true })) {
      if (!d.isDirectory() || !/^book\d+$/.test(d.name)) continue;
      const id = assetsKimligi(pathMod.join(kok, d.name));
      if (!id) return null; // kitap dizini var ama kimliği tek değil → emin değil
      kitaplar[d.name] = id;
    }
    if (Object.keys(kitaplar).length === 0) {
      const tek = assetsKimligi(kok);
      if (!tek) return null;
      kitaplar['.'] = tek;
    }
    return { kurum, kitaplar };
  } catch (e) {
    return null;
  }
}

/** İki kimlik birebir aynı mı? (kurum + kitap→id kümesi) */
function kimlikEsitMi(a, b) {
  if (!a || !b || a.kurum !== b.kurum) return false;
  const ka = Object.keys(a.kitaplar).sort();
  const kb = Object.keys(b.kitaplar).sort();
  if (ka.length !== kb.length) return false;
  return ka.every((k, i) => k === kb[i] && a.kitaplar[k] === b.kitaplar[k]);
}

/** C:\DijiTap\<vhost>\<ad> adayları — yalnız İmpark izleri tam olanlar. */
function adaylariBul({ dijitap, fsMod = fs, pathMod = path }) {
  const sonuc = [];
  let vhostlar = [];
  try { vhostlar = fsMod.readdirSync(dijitap, { withFileTypes: true }); } catch (e) { return sonuc; }
  for (const v of vhostlar) {
    if (!v.isDirectory()) continue;
    let adlar = [];
    try { adlar = fsMod.readdirSync(pathMod.join(dijitap, v.name), { withFileTypes: true }); } catch (e) { continue; }
    for (const a of adlar) {
      if (!a.isDirectory() || a.name.endsWith(SILINECEK_EKI)) continue;
      const klasor = pathMod.join(dijitap, v.name, a.name);
      const aday = { vhost: v.name, ad: a.name, klasor, build: pathMod.join(klasor, 'resources', 'app', 'build'), sorun: null };
      if (!fsMod.existsSync(pathMod.join(klasor, IMPARK_EXE))) aday.sorun = `${IMPARK_EXE} yok`;
      else {
        try {
          const pj = JSON.parse(fsMod.readFileSync(pathMod.join(klasor, 'resources', 'app', 'package.json'), 'utf8'));
          if (pj.name !== IMPARK_PAKET_ADI) aday.sorun = `package.json adı '${pj.name}'`;
        } catch (e) { aday.sorun = 'package.json okunamadı'; }
      }
      sonuc.push(aday);
    }
  }
  return sonuc;
}

function dizinBoyutu(dizin, fsMod, pathMod, tavan) {
  let toplam = 0;
  const yigin = [dizin];
  while (yigin.length) {
    const d = yigin.pop();
    for (const g of fsMod.readdirSync(d, { withFileTypes: true })) {
      const t = pathMod.join(d, g.name);
      if (g.isDirectory()) yigin.push(t);
      else if (g.isFile()) { toplam += fsMod.statSync(t).size; if (toplam > tavan) return toplam; }
    }
  }
  return toplam;
}

/** Hedefte olmayan dosyaları kopyalar (üzerine YAZMAZ). Döner: kopyalanan göreli yollar. */
function eksikleriKopyala(kaynak, hedef, fsMod, pathMod, goreliOnek = '') {
  const kopyalanan = [];
  const st = fsMod.statSync(kaynak);
  if (st.isFile()) {
    if (!fsMod.existsSync(hedef)) {
      fsMod.mkdirSync(pathMod.dirname(hedef), { recursive: true });
      fsMod.copyFileSync(kaynak, hedef);
      kopyalanan.push(goreliOnek);
    }
    return kopyalanan;
  }
  for (const g of fsMod.readdirSync(kaynak, { withFileTypes: true })) {
    if (!g.isDirectory() && !g.isFile()) continue;
    kopyalanan.push(...eksikleriKopyala(pathMod.join(kaynak, g.name), pathMod.join(hedef, g.name),
      fsMod, pathMod, goreliOnek ? `${goreliOnek}/${g.name}` : g.name));
  }
  return kopyalanan;
}

/**
 * Aktivasyon + kullanıcı verisini İmpark ağacından bizim WORK'e taşır.
 * @returns {{kopyalanan:string[], atlanan:string[]}}
 */
function veriTasi({ build, workKok, kimlik, fsMod = fs, pathMod = path }) {
  const kopyalanan = [];
  const atlanan = [];
  for (const [kitap, id] of Object.entries(kimlik.kitaplar)) {
    const kaynakKok = kitap === '.' ? build : pathMod.join(build, kitap);
    const hedefKok = kitap === '.' ? workKok : pathMod.join(workKok, kitap);
    const onek = kitap === '.' ? '' : `${kitap}/`;
    const tekiller = ['classlibraries/ImWin32.dll', `assets/${id}/imKeys.dll`];
    for (const g of tekiller) {
      const k = pathMod.join(kaynakKok, ...g.split('/'));
      if (!fsMod.existsSync(k)) continue;
      kopyalanan.push(...eksikleriKopyala(k, pathMod.join(hedefKok, ...g.split('/')), fsMod, pathMod, onek + g));
    }
    const temp = pathMod.join(kaynakKok, 'temp');
    if (fsMod.existsSync(temp)) {
      const boyut = dizinBoyutu(temp, fsMod, pathMod, TEMP_TAVAN_BAYT);
      if (boyut > TEMP_TAVAN_BAYT) atlanan.push(`${onek}temp (> ${TEMP_TAVAN_BAYT / 1048576} MB)`);
      else kopyalanan.push(...eksikleriKopyala(temp, pathMod.join(hedefKok, 'temp'), fsMod, pathMod, `${onek}temp`));
    }
  }
  return { kopyalanan, atlanan };
}

/** ZKitap.exe çalışıyor mu? Bilinemezse null (→ silme yok). */
function zkitapCalisiyorMu(execFileSync = childProcess.execFileSync) {
  try {
    const cikti = String(execFileSync('tasklist', ['/FI', `IMAGENAME eq ${IMPARK_EXE}`, '/NH', '/FO', 'CSV'],
      { encoding: 'utf8', timeout: 8000, windowsHide: true }));
    return cikti.toLowerCase().includes(IMPARK_EXE.toLowerCase());
  } catch (e) {
    return null;
  }
}

/** .lnk içinde klasör yolu geçiyor mu? (UTF-16LE ya da ANSI; büyük/küçük harf duyarsız) */
function kisayolKlasoreMiAit(lnkIcerigi, klasor) {
  const hedef = String(klasor).toLowerCase();
  const u16 = lnkIcerigi.toString('utf16le').toLowerCase();
  if (u16.includes(hedef)) return true;
  // UTF-16 hizası bir bayt kaymış olabilir
  if (lnkIcerigi.length > 1 && lnkIcerigi.subarray(1).toString('utf16le').toLowerCase().includes(hedef)) return true;
  return lnkIcerigi.toString('latin1').toLowerCase().includes(hedef);
}

function masaustuDizinleri(env, pathMod = path) {
  const d = [];
  if (env.USERPROFILE) d.push(pathMod.join(env.USERPROFILE, 'Desktop'));
  if (env.OneDrive) d.push(pathMod.join(env.OneDrive, 'Desktop'));
  if (env.PUBLIC) d.push(pathMod.join(env.PUBLIC, 'Desktop'));
  if (env.APPDATA) d.push(pathMod.join(env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs'));
  return [...new Set(d)];
}

function kisayollariBul(klasor, dizinler, fsMod = fs, pathMod = path) {
  const bulunan = [];
  for (const dizin of dizinler) {
    let ic = [];
    try { ic = fsMod.readdirSync(dizin); } catch (e) { continue; }
    for (const ad of ic) {
      if (!/\.lnk$/i.test(ad)) continue;
      const t = pathMod.join(dizin, ad);
      try { if (kisayolKlasoreMiAit(fsMod.readFileSync(t), klasor)) bulunan.push(t); } catch (e) { /* okunamadı */ }
    }
  }
  return bulunan;
}

function durumOku(userData, fsMod, pathMod) {
  try { return JSON.parse(fsMod.readFileSync(pathMod.join(userData, DURUM_DOSYASI), 'utf8')); } catch (e) { return { klasorler: {} }; }
}
function durumYaz(userData, durum, fsMod, pathMod) {
  try { fsMod.writeFileSync(pathMod.join(userData, DURUM_DOSYASI), JSON.stringify(durum, null, 2)); } catch (e) { /* yok */ }
}

/**
 * EVRE 1 (senkron, açılışta, pencereden ÖNCE): eşleşenleri bul, veriyi taşı.
 * @returns {{eslesen:Array, plan:string}}
 */
function hazirla({ kok, userData, workKok, env = process.env, platform = process.platform,
  fsMod = fs, pathMod = path, yaz = () => {}, dijitap: dijitapYolu = null } = {}) {
  if (platform !== 'win32') return { eslesen: [], plan: 'windows-degil' };
  if (String(env[ISARET] == null ? '' : env[ISARET]) === '0') { yaz('impark: kapalı', `${ISARET}=0`); return { eslesen: [], plan: 'kapali' }; }
  const surucu = env.SystemDrive || 'C:';
  const dijitap = dijitapYolu || path.win32.join(`${surucu}\\`, 'DijiTap');
  if (!fsMod.existsSync(dijitap)) return { eslesen: [], plan: 'dijitap-yok' };
  const bizim = kimlikOku(kok, fsMod, pathMod);
  if (!bizim) { yaz('impark: atlandı', 'kendi kimliğimiz okunamadı — dokunulmadı'); return { eslesen: [], plan: 'kimlik-yok' }; }
  const eslesen = [];
  for (const a of adaylariBul({ dijitap, fsMod, pathMod })) {
    if (a.sorun) continue;
    const onlarin = kimlikOku(a.build, fsMod, pathMod);
    if (!kimlikEsitMi(bizim, onlarin)) continue;
    try {
      const t = veriTasi({ build: a.build, workKok, kimlik: bizim, fsMod, pathMod });
      yaz('impark: veri taşındı', `${a.klasor} → ${workKok} | ${t.kopyalanan.length} dosya${t.atlanan.length ? ` | atlanan: ${t.atlanan.join(', ')}` : ''}`);
      eslesen.push({ ...a, tasinan: t.kopyalanan.length });
    } catch (e) {
      // Taşıma yarım kaldıysa SİLME YOK — veri kaybı riski.
      yaz('impark: taşıma hatası, silinmeyecek', `${a.klasor} | ${e && (e.code || e.message)}`);
    }
  }
  if (eslesen.length === 0) yaz('impark: eşleşen kurulum yok', `kurum ${bizim.kurum} | ${Object.values(bizim.kitaplar).join(',')}`);
  return { eslesen, plan: eslesen.length ? 'kaldir' : 'eslesen-yok' };
}

/**
 * EVRE 2 (pencere açıldıktan sonra): eşleşen klasörü kaldır + kısayollarını sil.
 * @returns {Array<{klasor:string, sonuc:string}>}
 */
function kaldir(eslesen, { userData, env = process.env, fsMod = fs, pathMod = path,
  execFileSync = childProcess.execFileSync, yaz = () => {} } = {}) {
  const sonuclar = [];
  if (!eslesen || eslesen.length === 0) return sonuclar;
  const calisiyor = zkitapCalisiyorMu(execFileSync);
  const durum = durumOku(userData, fsMod, pathMod);
  for (const a of eslesen) {
    let sonuc;
    if (calisiyor !== false) {
      sonuc = calisiyor === null ? 'atlandı: süreç listesi alınamadı' : `atlandı: ${IMPARK_EXE} çalışıyor`;
    } else {
      const gecici = `${a.klasor}${SILINECEK_EKI}`;
      try {
        fsMod.renameSync(a.klasor, gecici);
        try {
          fsMod.rmSync(gecici, { recursive: true, force: true, maxRetries: 2 });
          const lnk = kisayollariBul(a.klasor, masaustuDizinleri(env, pathMod), fsMod, pathMod);
          const silinenLnk = [];
          for (const l of lnk) { try { fsMod.unlinkSync(l); silinenLnk.push(pathMod.basename(l)); } catch (e) { yaz('impark: kısayol silinemedi', `${l} | ${e.code || e.message}`); } }
          sonuc = `kaldırıldı${silinenLnk.length ? ` + kısayol: ${silinenLnk.join(', ')}` : ' (kısayol bulunamadı)'}`;
        } catch (e) {
          sonuc = `yarım: ${gecici} silinemedi (${e.code || e.message})`;
        }
      } catch (e) {
        sonuc = `atlandı: yetki/kilit (${e.code || e.message}) — yükseltme istenmedi`;
      }
    }
    durum.klasorler[a.klasor] = { sonuc, an: new Date().toISOString() };
    yaz('impark: kaldırma', `${a.klasor} | ${sonuc}`);
    sonuclar.push({ klasor: a.klasor, sonuc });
  }
  durumYaz(userData, durum, fsMod, pathMod);
  return sonuclar;
}

/**
 * Ana süreç bağlayıcı: evre 1 hemen, evre 2 `app.whenReady()` + gecikme sonra.
 */
function baslat({ kok, electron, yaz = () => {}, gecikmeMs = VARSAYILAN_GECIKME_MS, env = process.env } = {}) {
  try {
    const { app } = electron || require('electron');
    const userData = app.getPath('userData');
    const workKok = env.EMPP_WORK_DIR || path.join(userData, 'work');
    const h = hazirla({ kok, userData, workKok, env, yaz });
    if (h.plan !== 'kaldir') return h;
    app.whenReady().then(() => {
      setTimeout(() => {
        try { kaldir(h.eslesen, { userData, env, yaz }); } catch (e) { yaz('impark: kaldırma hatası', e && e.message); }
      }, gecikmeMs);
    }).catch(() => {});
    return h;
  } catch (e) {
    try { yaz('impark: hata', e && e.message); } catch (_) { /* yok */ }
    return { eslesen: [], plan: 'hata' };
  }
}

module.exports = {
  ISARET,
  IMPARK_EXE,
  IMPARK_PAKET_ADI,
  SILINECEK_EKI,
  TEMP_TAVAN_BAYT,
  DURUM_DOSYASI,
  VARSAYILAN_GECIKME_MS,
  kimlikOku,
  kimlikEsitMi,
  adaylariBul,
  veriTasi,
  zkitapCalisiyorMu,
  kisayolKlasoreMiAit,
  masaustuDizinleri,
  kisayollariBul,
  hazirla,
  kaldir,
  baslat,
};

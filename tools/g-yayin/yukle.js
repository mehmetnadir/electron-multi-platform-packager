'use strict';

/**
 * G YÜKLEME + GECE E2E — yerel imzalı durumu canlı R2'ye taşır; yalnız iki kapıdan geçerse.
 *
 *   Kapı 1 (beyaz liste): `setKimligi` YUKLEME_BEYAZ_LISTE'de olmalı (06.10: 36 YDS seti + 74390).
 *          Kova ve taban komut satırından DEĞİL listeden gelir; başka kimlik → `400` (kuralı
 *          belge değil kapı korur). Kapı kuru koşuda da uygulanır.
 *   Kapı 2 (onay): `--onayli` yoksa hiçbir şey yazılmaz, yalnız plan basılır (kuru).
 *   Ek kapı: yerel durum ÜRETİM açık anahtarıyla doğrulanmalı; TEST imzalı manifest canlıya çıkmaz.
 *
 * Android G ucu da yüklenir: istemci (`src/platforms/android/empp-g-istemci.js` `kimlikKoku`)
 * `guncelleme/set/<id>/android/{surum.json, manifest.json, manifest.json.sig, dosya/<yol>}` ister
 * (kitap arşivi paylaşılan `kitap/` adresinden) — yüklenmezse Android 404 alır, hiç güncelleme
 * görmez. Aynı sıra: android/dosya içerikle, android manifest manifestle, android surum.json
 * EN SON.
 *
 * Neyin yükleneceği plandan değil, yerel imzalı durum ile CANLI listenin kıyasından çıkar (kendini
 * onaran, tekrar koşulabilir): eksik ya da farklı olan yüklenir; değişmez anahtar (`kitap/`,
 * `surumler/`) canlıda farklıysa HİÇBİR ŞEY yüklenmez. Sıra: kitap → dosya → surumler →
 * manifest + .sig → EN SON surum.json; bir adım düşerse sonrakiler yüklenmez (yarım yayın
 * görünmez).
 * Taşıyıcı bu Mac'teki rclone uzağı (`ydsr2:`); kimlik bilgisi rclone yapılandırmasında kalır,
 * bu kod onu okumaz ve basmaz.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const anahtar = require('./anahtar');
const gSurum = require('./g-surum');
const kg = require('../../src/runtime/kitap-guncelleyici');

/** YDS Publishing hedefi: kova `ydsdigital`, taban = paketlerin claim `guncellemeTabani`'sı. */
const YDS_HEDEF = Object.freeze({
  uzakKok: 'ydsr2:ydsdigital',
  taban: 'https://cdn.ydspublishing.com/guncelleme',
});
/**
 * YDS setleri (Nadir 06.10 11:15: "kitaplar güncellenince paketler güncellensin… tam yetki").
 * 74390 = 26.09'daki ilk izin. Liste dışı kimlik yine 400 alır; başka yayınevi = yeni hedef satırı.
 */
const YDS_SETLERI = Object.freeze([
  '11811', '11845', '11859', '45100', '45448', '45449', '45469', '45472', '45477', '45478',
  '45479', '45480', '45481', '45482', '45485', '45487', '45496', '45504', '45538', '45540',
  '45541', '45549', '45550', '45551', '45695', '45792', '59834', '59835', '60014', '60015',
  '60016', '72378', '72379', '72380', '73581', '73768', '74390',
]);
/** Yüklemeye izinli setler → hedef. Yeni satır = bilinçli karar (Nadir onayı). */
const YUKLEME_BEYAZ_LISTE = Object.freeze(
  Object.fromEntries(YDS_SETLERI.map((id) => [id, YDS_HEDEF])),
);
const E2E_VARSAYILAN_CIKTI = path.join(os.homedir(), '.empp-agent', 'g-yayin');
const E2E_ISARET_DESENI = /<!-- empp-g-e2e [^>]*-->\n?/g;

function yuklemeHedefi(setKimligi) {
  // Yalnız KENDİ anahtarı: `constructor`/`toString` kimlik desenine uyar, prototipten hedef sızmasın.
  const k = String(setKimligi);
  const h = Object.prototype.hasOwnProperty.call(YUKLEME_BEYAZ_LISTE, k)
    ? YUKLEME_BEYAZ_LISTE[k]
    : null;
  if (!h) {
    const e = new Error(
      `400 — setKimligi ${JSON.stringify(String(setKimligi))} yükleme beyaz ` +
        `listesinde değil (izinli: ${Object.keys(YUKLEME_BEYAZ_LISTE).join(', ')})`,
    );
    e.durum = 400;
    throw e;
  }
  return h;
}

/** Varsayılan rclone çalıştırıcı. Çıktı yalnız bellekte; kimlik bilgisi içermez. */
function varsayilanRclone(argumanlar) {
  return new Promise((coz) => {
    const c = spawn(process.env.RCLONE || 'rclone', argumanlar, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const o = [];
    let h = '';
    c.stdout.on('data', (d) => o.push(d));
    c.stderr.on('data', (d) => {
      if (h.length < 2000) h += d.toString('utf8');
    });
    c.on('error', (e) => coz({ kod: -1, stdout: '', stderr: e.message }));
    c.on('close', (kod) => coz({ kod, stdout: Buffer.concat(o).toString('utf8'), stderr: h }));
  });
}

function md5Dosya(yol) {
  return crypto.createHash('md5').update(fs.readFileSync(yol)).digest('hex');
}

/** Canlı liste: `{göreliYol: {boyut, md5|null}}` (önek `guncelleme/set/<id>/` altından). */
async function canliListe(rclone, uzakOnek) {
  const r = await rclone(['lsjson', '-R', '--files-only', '--hash', uzakOnek]);
  if (r.kod !== 0) {
    if (/directory not found|not found/i.test(r.stderr)) return {};
    throw new Error(`canlı liste alınamadı (rclone ${r.kod}): ${r.stderr.trim().slice(0, 200)}`);
  }
  const cikti = {};
  for (const g of JSON.parse(r.stdout || '[]')) {
    cikti[g.Path] = {
      boyut: g.Size,
      md5: g.Hashes && g.Hashes.md5 ? String(g.Hashes.md5).toLowerCase() : null,
    };
  }
  return cikti;
}

/** Android ucu kendi `android/` önekinde AYNI düzeni taşır (bkz. yayinla.js ANDROID_ONEKI). */
const ANDROID_ONEK = 'android/';

function sira(ham) {
  const goreli = ham.startsWith(ANDROID_ONEK) ? ham.slice(ANDROID_ONEK.length) : ham;
  if (goreli.startsWith('kitap/')) return 1;
  if (goreli.startsWith('dosya/')) return 2;
  if (goreli.startsWith('surumler/')) return 3;
  if (goreli === 'surum.json') return 5;
  return 4;
}

/**
 * @param {{setKimligi:string, cikti:string, onayli?:boolean}} a
 * @param {{rclone?:Function, getir?:Function, arsiviIndir?:Function, beklenenAcik?:string}} [ops]
 *   `beklenenAcik` yalnız test içindir (varsayılan ÜRETİM açık anahtarı); CLI vermez.
 */
async function yukle(a, ops = {}) {
  const bas = Date.now();
  const y = require('./yayinla');
  const setKimligi = y.kimlikDenetle(a.setKimligi);
  const hedef = yuklemeHedefi(setKimligi);
  if (!a.cikti) throw new Error('--cikti zorunlu');
  const acik = ops.beklenenAcik || anahtar.URETIM_ACIK_ANAHTAR;
  const rclone = typeof ops.rclone === 'function' ? ops.rclone : varsayilanRclone;
  const setDizini = path.join(path.resolve(String(a.cikti)), 'set', setKimligi);

  const yerel = y.ciktiDogrula({ cikti: a.cikti, setKimligi, acik });
  if (!yerel.gecti) {
    throw new Error(
      `yerel durum ${acik === anahtar.URETIM_ACIK_ANAHTAR ? 'ÜRETİM' : 'beklenen'} anahtarıyla ` +
        `doğrulanmadı — yüklenmez: ${yerel.hatalar.join('; ')}`,
    );
  }
  const m = JSON.parse(fs.readFileSync(path.join(setDizini, 'manifest.json'), 'utf8'));
  const kitapOneki = `${hedef.taban}/set/${encodeURIComponent(setKimligi)}/kitap/`;
  for (const g of m.kitaplar || []) {
    if (g.durum === 'ekle' && !g.kaynak.startsWith(kitapOneki)) {
      throw new Error(`${g.dizin} arşivi bu hedefin tabanında değil (${g.kaynak}) — yüklenmez`);
    }
  }

  // İstenen nesneler: güncel manifestin gösterdiği her şey + sürüm arşivi + üç uç.
  const istenen = new Map();
  const ekleYerel = (goreli, zorunlu) => {
    const tam = path.join(setDizini, ...goreli.split('/'));
    istenen.set(goreli, { goreli, tam: fs.existsSync(tam) ? tam : null, zorunlu });
  };
  for (const g of m.kabuk) {
    ekleYerel(`dosya/${g.yol}`, false);
    ekleYerel(`${ANDROID_ONEK}dosya/${g.yol}`, false);
  }
  for (const g of m.kitaplar || [])
    if (g.durum === 'ekle')
      ekleYerel(`kitap/${decodeURIComponent(g.kaynak.slice(kitapOneki.length))}`, false);
  const surumlerDizini = path.join(setDizini, 'surumler');
  if (fs.existsSync(surumlerDizini)) {
    for (const s of fs.readdirSync(surumlerDizini)) {
      if (!gSurum.gecerliMi(s)) continue;
      for (const f of ['manifest.json', `manifest.json${kg.IMZA_UZANTI}`]) {
        if (fs.existsSync(path.join(surumlerDizini, s, f))) ekleYerel(`surumler/${s}/${f}`, true);
      }
    }
  }
  for (const f of ['manifest.json', `manifest.json${kg.IMZA_UZANTI}`, 'surum.json']) {
    ekleYerel(f, true);
    ekleYerel(`${ANDROID_ONEK}${f}`, true);
  }

  const uzakOnek = `${hedef.uzakKok}/guncelleme/set/${setKimligi}`;
  const canli = await canliListe(rclone, uzakOnek);
  const yuklenecek = [];
  const cakisma = [];
  let atlanan = 0;
  // Canlı daha yeni bir sürümdeyse (başka bir yayın) geri götürme: hiçbir şey yüklenmez.
  // İki uç da (canonical + android/) ayrı ayrı bakılır.
  for (const onek of ['', ANDROID_ONEK]) {
    if (!canli[`${onek}surum.json`]) continue;
    const r = await rclone(['cat', `${uzakOnek}/${onek}surum.json`]);
    let canliSurum = null;
    try {
      canliSurum = JSON.parse(r.stdout).surum;
    } catch (e) {
      canliSurum = null;
    }
    if (r.kod !== 0 || !gSurum.gecerliMi(canliSurum)) {
      cakisma.push(`canlı ${onek}surum.json okunamadı ya da G3 değil (${canliSurum})`);
    } else if (gSurum.kiyasla(canliSurum, m.surum) > 0) {
      cakisma.push(
        `${onek}canlı sürüm ${canliSurum} yereldekinden (${m.surum}) yeni — geri götürülmez`,
      );
    }
  }
  for (const n of istenen.values()) {
    const c = canli[n.goreli];
    const degismez = n.goreli.startsWith('kitap/') || n.goreli.startsWith('surumler/');
    if (!n.tam) {
      if (!c) cakisma.push(`${n.goreli}: yerelde yok, canlıda da yok`);
      else atlanan += 1;
      continue;
    }
    const boyut = fs.statSync(n.tam).size;
    if (c) {
      const ayni = c.boyut === boyut && (c.md5 ? c.md5 === md5Dosya(n.tam) : degismez);
      if (ayni) {
        atlanan += 1;
        continue;
      }
      if (degismez) {
        cakisma.push(`${n.goreli}: değişmez anahtar canlıda farklı — üzerine yazılmaz`);
        continue;
      }
    }
    yuklenecek.push({
      sira: sira(n.goreli),
      anahtar: `guncelleme/set/${setKimligi}/${n.goreli}`,
      yerel: n.tam,
      boyut,
      contentType: y.icerikTuru(n.goreli),
      cacheControl: degismez ? y.CACHE_DEGISMEZ : y.CACHE_DEGISKEN,
    });
  }
  yuklenecek.sort((p, q) => p.sira - q.sira || (p.anahtar < q.anahtar ? -1 : 1));
  const rapor = {
    setKimligi,
    surum: m.surum,
    hedef: `${hedef.uzakKok} → ${hedef.taban}`,
    kuru: !a.onayli,
    yuklenecek: yuklenecek.map((p) => ({ sira: p.sira, anahtar: p.anahtar, boyut: p.boyut })),
    atlanan,
    cakisma,
    yuklenen: [],
    gecti: cakisma.length === 0,
    dogrula: null,
    sureMs: 0,
  };
  if (cakisma.length || !a.onayli) {
    rapor.sureMs = Date.now() - bas;
    return rapor;
  }

  for (const p of yuklenecek) {
    const r = await rclone([
      'copyto',
      p.yerel,
      `${hedef.uzakKok}/${p.anahtar}`,
      '--ignore-times',
      '--s3-no-check-bucket',
      '--retries',
      '3',
      '--low-level-retries',
      '10',
      '--header-upload',
      `Content-Type: ${p.contentType}`,
      '--header-upload',
      `Cache-Control: ${p.cacheControl}`,
    ]);
    if (r.kod !== 0) {
      rapor.gecti = false;
      const iz = r.stderr.trim().slice(0, 200);
      rapor.hata = `${p.anahtar} yüklenemedi (rclone ${r.kod}): ${iz} — sonraki adımlar yüklenmedi`;
      rapor.sureMs = Date.now() - bas;
      return rapor;
    }
    rapor.yuklenen.push(p.anahtar);
  }
  rapor.dogrula = await y.uzakDogrula({
    taban: hedef.taban,
    setKimligi,
    acik,
    beklenenSurum: m.surum,
    getir: ops.getir,
    arsiviIndir: ops.arsiviIndir,
    arsivler: true,
  });
  rapor.gecti = rapor.dogrula.gecti;
  rapor.sureMs = Date.now() - bas;
  return rapor;
}

/* ------------------------------------------------------------------ gece e2e */

/** index'teki önceki e2e işaretini atıp yenisini `</html>` önüne koyar. */
function e2eIndexi(ham, uretim) {
  const temiz = String(ham).replace(E2E_ISARET_DESENI, '');
  const isaret = `<!-- empp-g-e2e ${uretim} -->\n`;
  const i = temiz.toLowerCase().lastIndexOf('</html>');
  return i === -1 ? temiz + isaret : temiz.slice(0, i) + isaret + temiz.slice(i);
}

/**
 * Tek komutluk kalıcı test: yeni sürüm üret → (onaylıysa) yükle → canlıdan doğrula.
 * @returns {Promise<{gecti:boolean, rc:number, ...}>}
 */
async function e2e(a, ops = {}) {
  const y = require('./yayinla');
  const bas = Date.now();
  const setKimligi = y.kimlikDenetle(a.setKimligi);
  let hedef;
  try {
    hedef = yuklemeHedefi(setKimligi);
  } catch (e) {
    return { setKimligi, gecti: false, rc: 1, durum: e.durum || 400, hata: e.message, adimlar: {} };
  }
  const cikti = path.resolve(String(a.cikti || E2E_VARSAYILAN_CIKTI));
  const setDizini = path.join(cikti, 'set', setKimligi);
  const saat = typeof ops.saat === 'function' ? ops.saat : () => new Date().toISOString();
  const sonuc = { setKimligi, kuru: !a.onayli, cikti: setDizini, adimlar: {}, gecti: false, rc: 1 };
  const kaynakSec = a.anahtarDosya ? { anahtarDosya: a.anahtarDosya } : { anahtarZinciri: true };

  // 1) Üret.
  const t1 = Date.now();
  try {
    let tabanIndex = null;
    let oncekiManifest = null;
    let oncekiSurum = a.oncekiSurum || null;
    let ilk = false;
    const yerelIndex = path.join(setDizini, 'dosya', 'index.html');
    if (fs.existsSync(path.join(setDizini, 'manifest.json')) && fs.existsSync(yerelIndex)) {
      tabanIndex = fs.readFileSync(yerelIndex, 'utf8');
    } else {
      const al = typeof ops.getir === 'function' ? ops.getir : kg.varsayilanGetir;
      const kok = `${hedef.taban}/set/${encodeURIComponent(setKimligi)}`;
      const cm = await al(`${kok}/manifest.json`, { zamanAsimi: 30000 });
      if (cm && cm.durum === 200) {
        oncekiManifest = `${kok}/manifest.json`;
        const ci = await al(`${kok}/dosya/index.html`, { zamanAsimi: 30000 });
        if (!ci || ci.durum !== 200)
          throw new Error(`canlı index.html alınamadı (HTTP ${ci && ci.durum})`);
        tabanIndex = Buffer.from(ci.govde).toString('utf8');
      } else if (a.index) {
        tabanIndex = fs.readFileSync(path.resolve(a.index), 'utf8');
        ilk = true;
        if (!oncekiSurum && !a.surum)
          throw new Error('ilk e2e yayını için --onceki-surum <paket sürümü> gerekli');
      } else {
        throw new Error(
          'önceki durum yok (yerel/canlı) — ilk koşu için --index <74390 index.html> ve ' +
            '--onceki-surum verin',
        );
      }
    }
    const yerelSurum = (() => {
      try {
        return JSON.parse(fs.readFileSync(path.join(setDizini, 'surum.json'), 'utf8')).surum;
      } catch (e) {
        return null;
      }
    })();
    const panel =
      a.panel != null ? a.panel : (gSurum.coz(yerelSurum || oncekiSurum || '') || {}).panel;
    const geciciDizin = path.join(cikti, '.g-yayin-gecici', setKimligi);
    fs.mkdirSync(geciciDizin, { recursive: true });
    const idx = path.join(geciciDizin, 'e2e-index.html');
    fs.writeFileSync(idx, e2eIndexi(tabanIndex, saat()));
    const r = await y.yayinla(
      {
        komut: 'yayinla',
        setKimligi,
        taban: hedef.taban,
        cikti,
        panel: panel == null ? a.panel : panel,
        surum: a.surum,
        oncekiSurum,
        oncekiManifest,
        ilk,
        index: idx,
        motorlar: {},
        ekle: {},
        cikar: [],
        anahtarZinciri: !!kaynakSec.anahtarZinciri,
        anahtarDosya: kaynakSec.anahtarDosya || null,
      },
      { saat, calistir: ops.calistir, gunluk: ops.gunluk || (() => {}) },
    );
    sonuc.surum = r.surum;
    sonuc.adimlar.uret = {
      gecti: true,
      surum: r.surum,
      onceki: r.onceki,
      anahtar: anahtar.kisaIz(r.anahtar.parmakIzi),
      sureMs: Date.now() - t1,
    };
  } catch (e) {
    sonuc.adimlar.uret = { gecti: false, hata: e.message, sureMs: Date.now() - t1 };
    sonuc.sureMs = Date.now() - bas;
    return sonuc;
  }

  // 2) Yükle (kuru ya da onaylı).
  try {
    const yk = await yukle({ setKimligi, cikti, onayli: !!a.onayli }, ops);
    sonuc.adimlar.yukle = {
      gecti: yk.gecti,
      kuru: yk.kuru,
      yuklenecek: yk.yuklenecek.length,
      yuklenen: yk.yuklenen.length,
      atlanan: yk.atlanan,
      cakisma: yk.cakisma,
      hata: yk.hata,
      sureMs: yk.sureMs,
    };
    if (yk.dogrula) sonuc.adimlar.dogrula = { zorunlu: true, ...yk.dogrula };
  } catch (e) {
    sonuc.adimlar.yukle = { gecti: false, kuru: !a.onayli, hata: e.message };
  }

  // 3) Canlıdan doğrula. Kuru koşuda bilgi amaçlı (canlıdaki mevcut sürüm), sonucu etkilemez.
  if (!sonuc.adimlar.dogrula) {
    const u = await y.uzakDogrula({
      taban: hedef.taban,
      setKimligi,
      acik: ops.beklenenAcik || anahtar.URETIM_ACIK_ANAHTAR,
      getir: ops.getir,
      arsiviIndir: ops.arsiviIndir,
    });
    sonuc.adimlar.dogrula = { zorunlu: !!a.onayli, ...u };
  }
  const d = sonuc.adimlar.dogrula;
  sonuc.gecti = sonuc.adimlar.uret.gecti && sonuc.adimlar.yukle.gecti && (d.gecti || !d.zorunlu);
  sonuc.rc = sonuc.gecti ? 0 : 1;
  sonuc.sureMs = Date.now() - bas;
  return sonuc;
}

module.exports = {
  YDS_SETLERI,
  YUKLEME_BEYAZ_LISTE,
  E2E_VARSAYILAN_CIKTI,
  yuklemeHedefi,
  varsayilanRclone,
  canliListe,
  yukle,
  e2eIndexi,
  e2e,
};

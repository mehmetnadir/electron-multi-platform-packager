'use strict';
/**
 * SET TÜM ALT KİTAPLAR GÜNCELLİĞİ — kabul kapılarının güncellik ölçümüne (Mac başsız K4 +
 * ProBook E7) ek. Nadir'in sorusu: "kabul, kitabın güncellemelerini alıp almadığını kontrol
 * ediyor mu" — SET'te HER alt kitap için cevap evet olmalı.
 *
 * NEDEN (ölçüldü 26.09): motor güncelleme sorusunu (`GetKitapGuncellemeBilgi`) yalnız AÇILAN
 * kitabın kapakları için sorar; iki kapı da SET'te ilk kitaba girdiği için öteki alt kitaplar hiç
 * sorulmuyordu. Super Monsters 2 Set DMG (k4-sm2set-mac-20260926-212322): motor book1 58336 v17
 * sordu (güncel) → K4 GEÇTİ; 58237 v7 HİÇ sorulmadı — İmpark v14 (7 sürüm geride).
 *
 * YÖNTEM (karar ve gerekçe):
 *   (a) her alt kitabı CDP ile sırayla açıp motorun sorusunu yakalamak — kitap başına ≈10-60 sn
 *       (okuyucu penceresi 60 sn), menüye dönüş SET tasarımına bağlı (Web-Z/yayıncı/sade menü),
 *       bir kitap takılırsa sonrakiler ölçülmez; N kitaplı sette süre N katı.
 *   (b) paketteki her alt kitabın menüsünden (classlibraries/ImWin32.dll) kimlik+sürüm okunup
 *       motorun sorusu AYNEN (`app.config.js` updateBookEndPoint, setMi=0) doğrudan sorulur —
 *       kitap başına tek GET, motor davranışından bağımsız.
 *   SEÇİLEN: ilk kitap CDP ile (motor gerçekten soruyor mu — mevcut K4/E7, aynen) + TÜM alt kitaplar
 *   (b) ile. (b)'nin alt kitap listesi, kimlik kaynağı, sorusu ve cevap yorumu içerik merdiveni S0
 *   ile TEK KAYNAK (`icerik-merdiven.s0Kaynaktan`: menuKonumlari · menuCoz/kapaklar · teklifUrl ·
 *   teklifYorumla).
 *
 * AĞAÇ: `agacTopla(fs, path, kok)` enjekte edilen fs ile çalışır ve kendi kendine yeter: CDP
 * ile ÇALIŞAN uygulamanın sayfasında (paketler nodeIntegration:true — asar'ı Electron fs okur)
 * `sayfaIfadesi` olarak koşar. ProBook (uzak/yerel kip) ve Mac başsız kabul AYNI yol:
 * `cdp-kitap-ac.js --set-tum 1`. Okunan yalnız menüler + app.config.js (kök + bir düzey alt dizin).
 *
 * KARAR SÖZLÜĞÜ — K4 ile aynı (k4-guncellik K4_DURUM/K4_KOD; kabul-karar.sh):
 *   GÜNCEL-DEĞİL (3)  herhangi bir alt kitap GERİDE → hangi kitap(lar) sebepte, öneri ZKitapZipH.
 *   ÖLÇÜLEMEDİ (4)    en az bir alt kitap ölçülemedi (uç yok, zaman aşımı, menü çözülemedi) — her
 *                     biri satır olarak; ENGELLEMEZ (Pardus: E7 ÖLÇÜLEMEDİ/YOK "karar değiştirmez",
 *                     k4Karari'nin soru-görülmedi kuralı). Sahte yeşil yok: K4 alanı GEÇTİ olmaz.
 *   GEÇTİ (0)         ölçülen her alt kitap güncel.
 *   ATLANDI           tek kitap (motor açılışta bütün kapakları sorar — E7/K4 yeter) ya da İmpark
 *                     kimliği taşıyan kapak yok.
 *   Birleştirme (`setTumBirlestir`): en kötüsü — GÜNCEL-DEĞİL > ÖLÇÜLEMEDİ > GEÇTİ; engeller = VEYA.
 *
 * Bayrak: `KABUL_SET_TUM=1` (varsayılan KAPALI; K4/CDP açık olmalı). Kapalıyken iki kapı birebir eski.
 * BOZARSAN: tools/kabul/set-guncellik.test.js kırılır (yalnız ilk kitaba bakan mutant dahil).
 */
const { s0Kaynaktan, menuKonumlari, DURUM: S0 } = require('../../src/agent/icerik-merdiven');
const { guncelDegilOneri } = require('./guncel-degil-oneri');
const atlananUye = require('./atlanan-uyeler');

const DURUM = Object.freeze({
  GECTI: 'GECTI', GUNCEL_DEGIL: 'GUNCEL_DEGIL', OLCULEMEDI: 'OLCULEMEDI', ATLANDI: 'ATLANDI',
});
const KOD = Object.freeze({ GECTI: 0, GUNCEL_DEGIL: 3, OLCULEMEDI: 4 });
const KAYNAK = 'set-tum';
/** Sayfadan taşınacak toplam bayt tavanı (menüler KB düzeyinde; tavan bozuk ağaç için). */
const AGAC_TAVANI = 16 * 1024 * 1024;

/** SET tüm alt kitaplar ölçümü açık mı? Saf. */
function setTumEtkin({ bayrak = false, env = process.env } = {}) {
  return Boolean(bayrak) || env.KABUL_SET_TUM === '1';
}

/* eslint-disable no-var, prefer-template, func-names */
/**
 * Uygulama kökünden menüler + app.config.js (kök ve bir düzey alt dizin). KENDİ KENDİNE YETER:
 * CDP ile sayfada `toString()` edilip koşar — dışarıdan hiçbir şeye başvurmaz.
 * @returns {{adlar: string[], dosyalar: Object<string,string>, hata?: string}} dosyalar base64
 */
function agacTopla(fs, path, kok, tavan) {
  var MENU = 'classlibraries/ImWin32.dll';
  var sinir = tavan || 16 * 1024 * 1024;
  var adlar = [];
  var dosyalar = {};
  var toplam = 0;
  function al(rel) {
    var tam = path.join(kok, rel);
    try { if (!fs.existsSync(tam)) return; } catch (e) { return; }
    var b;
    try { b = fs.readFileSync(tam); } catch (e) { return; }
    toplam += b.length;
    if (toplam > sinir) throw new Error('ağaç tavanı aşıldı (' + sinir + ' bayt)');
    adlar.push(rel);
    dosyalar[rel] = b.toString('base64');
  }
  var girdiler;
  try { girdiler = fs.readdirSync(kok); } catch (e) {
    return { adlar: [], dosyalar: {}, hata: 'kök okunamadı: ' + String((e && e.message) || e).slice(0, 200) };
  }
  try {
    al(MENU);
    al('app.config.js');
    al('empp-uretec.json'); // üreteç manifesti: atlananUyeler (Nadir 06.10) — yoksa sessizce yok
    girdiler.slice().sort().forEach(function (ad) {
      if (ad.charAt(0) === '.' || ad === 'classlibraries' || ad === 'node_modules') return;
      if (!fs.existsSync(path.join(kok, ad, MENU))) return;
      al(ad + '/' + MENU);
      al(ad + '/app.config.js');
    });
  } catch (e) {
    return { adlar: adlar, dosyalar: {}, hata: String((e && e.message) || e).slice(0, 200) };
  }
  return { adlar: adlar, dosyalar: dosyalar };
}
/* eslint-enable no-var, prefer-template, func-names */

/** Canlı sayfada koşacak ifade (JSON metni döner; Node yoksa gerekçe). Saf. */
function sayfaIfadesi(kok, tavan = AGAC_TAVANI) {
  return '(() => { if (typeof require !== \'function\') return JSON.stringify({ adlar: [], dosyalar: {}, '
    + 'hata: \'sayfada Node (require) yok — nodeIntegration kapalı\' }); '
    + `try { return JSON.stringify((${agacTopla.toString()})(require('fs'), require('path'), `
    + `${JSON.stringify(kok)}, ${Number(tavan)})); } catch (e) { return JSON.stringify({ adlar: [], dosyalar: {}, `
    + 'hata: String((e && e.message) || e).slice(0, 200) }); } })()';
}

/** file: URL'sinden uygulama kökü (sayfanın dizini). file: değilse null. Saf. */
function kokuUrldenBul(url) {
  let u;
  try { u = new URL(String(url || '')); } catch (_) { return null; }
  if (u.protocol !== 'file:') return null;
  const yol = decodeURIComponent(u.pathname);
  const kesme = yol.lastIndexOf('/');
  return kesme > 0 ? yol.slice(0, kesme) : null;
}

/** agacTopla çıktısından s0Kaynaktan okuyucusu. Saf. */
function agactanOkuyucu(agac) {
  const d = (agac && agac.dosyalar) || {};
  return {
    adlar: (agac && agac.adlar) || [],
    oku: (rel) => (Object.prototype.hasOwnProperty.call(d, rel) ? Buffer.from(d[rel], 'base64') : null),
  };
}

/**
 * Ağaçtaki her alt kitap için İmpark'a motorun sorusu (S0 çekirdeği). Ağ: `getir`.
 * @returns {Promise<{set:boolean, satirlar:object[], hata?:string}>}
 */
async function agacOlc(agac, { getir, zamanAsimiMs } = {}) {
  if (!agac) return { set: false, satirlar: [], hata: 'ağaç okunmadı' };
  if (agac.hata) return { set: false, satirlar: [], hata: agac.hata };
  // Tek kitap: motor açılışta bütün kapakları sorar (E7/K4) — ağa çıkılmaz.
  if (!menuKonumlari(agac.adlar || []).set) return { set: false, satirlar: [] };
  const r = await s0Kaynaktan({ ...agactanOkuyucu(agac), ...(getir ? { getir } : {}), zamanAsimiMs });
  // ATLANAN ÜYE (Nadir 06.10): manifestteki kimlik beklenenden düşer (Data boş İmpark'ta "güncel",
  // 404 "ölçülemedi" görünürdü — ikisi de yanıltıcı); karar notuna girer.
  const atlananUyeler = atlananUye.atlananUyelerOku(agactanOkuyucu(agac));
  if (!atlananUyeler.length) return { set: r.set, satirlar: r.satirlar };
  const ak = atlananUye.kume(atlananUyeler);
  return {
    set: r.set, satirlar: r.satirlar.filter((s) => !ak.has(String(s.id))), atlananUyeler,
  };
}

function satirOzeti(s) {
  const kim = `${s.kitap} ${s.id == null ? '?' : s.id} v${s.surum == null ? '?' : s.surum}`;
  if (s.durum === S0.GERIDE) return `${kim} < İmpark v${s.vs}`;
  if (s.durum === S0.GUNCEL) return `${kim} güncel`;
  return `${kim} ${s.durum === S0.ATLANDI ? 'ATLANDI' : 'ÖLÇÜLEMEDİ'}${s.not ? ` (${s.not})` : ''}`;
}

/**
 * SET ölçümünün K4 sözlüğünde kararı. Saf.
 * @param {{set?:boolean, satirlar?:object[], hata?:string}|null} olcum agacOlc çıktısı
 */
function setTumKarari(olcum) {
  const satirlar = (olcum && Array.isArray(olcum.satirlar)) ? olcum.satirlar : [];
  const ozet = satirlar.map((s) => ({
    kitap: s.kitap, id: s.id, surum: s.surum, vs: s.vs == null ? null : s.vs, durum: s.durum, not: s.not || '',
  }));
  const sonuc = (durum, sebep, ek = {}) => ({
    durum, kod: KOD[durum], sebep, oneri: '', notlar: [], engeller: false, kaynak: KAYNAK, satirlar: ozet, ...ek,
  });
  if (!olcum || olcum.hata) {
    return sonuc(DURUM.OLCULEMEDI, `SET alt kitapları ölçülemedi: ${(olcum && olcum.hata) || 'ölçüm yok'}`);
  }
  if (!olcum.set) return sonuc(DURUM.ATLANDI, 'tek kitap — motor açılışta bütün kapakları sorar (E7/K4 yeter)');
  const geride = satirlar.filter((s) => s.durum === S0.GERIDE);
  const olc = satirlar.filter((s) => s.durum === S0.OLCULEMEDI);
  const guncel = satirlar.filter((s) => s.durum === S0.GUNCEL);
  const atl = satirlar.filter((s) => s.durum === S0.ATLANDI);
  const notlar = atl.map(satirOzeti);
  if (olcum && Array.isArray(olcum.atlananUyeler) && olcum.atlananUyeler.length) {
    notlar.push(`SET: ${atlananUye.notSatiri(olcum.atlananUyeler)}`);
  }
  if (geride.length) {
    const oneri = guncelDegilOneri(geride.map((s) => `ZKitapZipH/${s.id}-${s.vs}.zip`));
    return sonuc(DURUM.GUNCEL_DEGIL, `SET alt kitap geride: ${geride.map((s) => `${s.kitap} ${s.id} paket v${s.surum} `
      + `< İmpark v${s.vs}`).join('; ')}`, { oneri, notlar: [...olc.map(satirOzeti), ...guncel.map(satirOzeti), ...notlar] });
  }
  if (olc.length) {
    return sonuc(DURUM.OLCULEMEDI, `SET alt kitap ölçülemedi: ${olc.map(satirOzeti).join('; ')}`,
      { notlar: [...guncel.map(satirOzeti), ...notlar] });
  }
  if (!guncel.length) return sonuc(DURUM.ATLANDI, 'SET: İmpark kimliği taşıyan kapak yok', { notlar });
  return sonuc(DURUM.GECTI, `SET tüm alt kitaplar güncel (${guncel.length}): ${guncel.map(satirOzeti).join('; ')}`,
    { notlar });
}

const TR = Object.freeze({
  GECTI: 'GEÇTİ', GUNCEL_DEGIL: 'GÜNCEL-DEĞİL', OLCULEMEDI: 'ÖLÇÜLEMEDİ', ATLANDI: 'ATLANDI',
});
const ozetSatiri = (k) => `${k.kaynak}: ${TR[k.durum] || k.durum} — ${k.sebep}`;

/**
 * K4 kararı (motor sorusu; k4Birlestir çıktısı) + SET kararı → tek K4 kararı. Saf.
 * En kötüsü: GÜNCEL-DEĞİL > ÖLÇÜLEMEDİ > GEÇTİ; engeller = VEYA (SET kendi başına engellemez,
 * K4'ün engeli — CDP kurulamadı / E8 — SET GEÇTİ diye kalkmaz).
 */
function setTumBirlestir(k4, st) {
  if (!st || st.durum === DURUM.ATLANDI) {
    if (!k4 || !st) return k4 || null;
    return { ...k4, notlar: [...(k4.notlar || []), ozetSatiri(st)] };
  }
  if (!k4) return { ...st, kaynaklar: [{ kaynak: st.kaynak, durum: st.durum, sebep: st.sebep }] };
  const kaynaklar = [...(k4.kaynaklar || [{ kaynak: k4.kaynak, durum: k4.durum, sebep: k4.sebep }]),
    { kaynak: st.kaynak, durum: st.durum, sebep: st.sebep }];
  const ikisi = [k4, st];
  const notlar = [...(k4.notlar || []), ...(st.notlar || [])];
  const kaynak = `${k4.kaynak}+${st.kaynak}`;
  const dg = ikisi.filter((k) => k.durum === DURUM.GUNCEL_DEGIL);
  if (dg.length) {
    const oneri = [...new Set(dg.map((k) => k.oneri).filter(Boolean))].join(' | ');
    return {
      durum: DURUM.GUNCEL_DEGIL,
      kod: KOD.GUNCEL_DEGIL,
      sebep: dg.map((k) => k.sebep).join('; '),
      oneri,
      notlar: [...notlar, ...ikisi.filter((k) => !dg.includes(k)).map(ozetSatiri)],
      engeller: false,
      kaynak,
      kaynaklar,
    };
  }
  const olc = ikisi.filter((k) => k.durum === DURUM.OLCULEMEDI);
  if (olc.length) {
    return {
      durum: DURUM.OLCULEMEDI,
      kod: KOD.OLCULEMEDI,
      sebep: olc.map((k) => `${k.kaynak}: ${k.sebep}`).join(' | '),
      oneri: '',
      notlar: [...notlar, ...ikisi.filter((k) => !olc.includes(k)).map(ozetSatiri)],
      engeller: olc.some((k) => k.engeller),
      kaynak,
      kaynaklar,
    };
  }
  return {
    ...k4, sebep: `${k4.sebep}; ${st.sebep}`, notlar, engeller: Boolean(k4.engeller), kaynak, kaynaklar,
  };
}

function tekSatir(s, sinir = 600) {
  return String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').trim().slice(0, sinir);
}

/** cdp-kitap-ac çıktısı: `SET_TUM*` satırları (probook-kabul.sh okur). */
function satirlariYaz(karar, yaz) {
  yaz(`SET_TUM=${karar.durum}`);
  yaz(`SET_TUM_AYRINTI=${tekSatir(karar.sebep, 900)}`);
  yaz(`SET_TUM_ONERI=${tekSatir(karar.oneri, 600)}`);
  yaz(`SET_TUM_NOT=${tekSatir((karar.notlar || []).join('; '), 900)}`);
}

/**
 * CDP oturumundaki canlı sayfadan ağacı okur, her alt kitabı ölçer. Fırlatmaz.
 * @param {{cdp:{degerlendir:Function}|null, kok:string|null, getir?:Function, zamanAsimiMs?:number}} p
 * @returns {Promise<{kok:string|null, adlar:string[], olcum:object, karar:object}>}
 */
async function sayfadanOlc({
  cdp, kok, getir, zamanAsimiMs,
}) {
  let agac;
  if (!cdp) agac = { adlar: [], dosyalar: {}, hata: 'CDP oturumu yok' };
  else if (!kok) agac = { adlar: [], dosyalar: {}, hata: 'uygulama kökü çözülemedi (hedef file: URL değil)' };
  else {
    try {
      agac = JSON.parse(String(await cdp.degerlendir(sayfaIfadesi(kok), 20000)));
    } catch (e) {
      agac = { adlar: [], dosyalar: {}, hata: `sayfada ağaç okunamadı: ${String(e.message).slice(0, 200)}` };
    }
  }
  let olcum;
  try {
    olcum = await agacOlc(agac, { getir, zamanAsimiMs });
  } catch (e) {
    olcum = { set: false, satirlar: [], hata: `ölçüm hatası: ${String(e.message).slice(0, 200)}` };
  }
  return {
    kok, adlar: agac.adlar || [], olcum, karar: setTumKarari(olcum),
  };
}

module.exports = {
  DURUM,
  KOD,
  KAYNAK,
  setTumEtkin,
  agacTopla,
  sayfaIfadesi,
  kokuUrldenBul,
  agactanOkuyucu,
  agacOlc,
  satirOzeti,
  setTumKarari,
  setTumBirlestir,
  satirlariYaz,
  sayfadanOlc,
};

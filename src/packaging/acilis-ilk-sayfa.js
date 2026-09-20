'use strict';

/**
 * İLK SAYFA GELDİĞİ GİBİ AÇILSIN — 5 saniyelik sabit güvenceyi devre dışı bırakır.
 *
 * SAHA ARIZASI (2026-09-20 ölçüldü, 53 çağrı yerinde birebir aynı kalıp):
 * Tek-kitap açılış ekranı ("Kitap Açılıyor..") kitabı ancak güncelleme sorgusunun
 * sonucu geldiğinde açıyor:
 *
 *     useEffect(() => {
 *       AppConfig.xml.isWeb || covers.map(c =>
 *         checkUpdates[c.id] || sorgula(c).then(y => dispatch(SET_CHECK_UPDATE, {
 *           ..., status: Boolean(y.Data) ? PENDING : NONE })))
 *     }, [...]);
 *     useEffect(() => {
 *       ...
 *       setTimeout(() => { page.pageLoaded || kitabiAc(cover) }, 4999);   // güvence
 *       const g = checkUpdates[oneBook];
 *       if (g == null || !g.status) return;                                // ← çıkış
 *       if (g.status === PENDING) { indir().then(() => kitabiAc(cover)) }
 *       else if (g.status === NONE) kitabiAc(cover);
 *     }, [checkUpdates]);
 *
 * `sorgula(c).then(...)` zincirinde **`.catch` YOK** ve zaman aşımı da yok. Ağ
 * yoksa / alan adı engelliyse istek reddedilir, `SET_CHECK_UPDATE` hiç gönderilmez,
 * `checkUpdates[oneBook]` sonsuza kadar boş kalır ve ikinci etki her seferinde
 * `return` eder. Kitabı açan tek şey 5 saniyelik `setTimeout` güvencesidir.
 * Yani ağı olmayan her okul bilgisayarında HER açılış düz 5 saniye ödüyor —
 * güvence istisna değil, NORMAL yol hâline gelmiş.
 *
 * Nadir (2026-09-20): "5 saniye muhtemelen ilk sayfanın ekrana boş gelmesini
 * önlemek için bir güvence. Kolaya kaçmışlar, ilk sayfa geldiği gibi açmak
 * daha doğru."
 *
 * ÇÖZÜM — sorgunun kendisine süre bütçesi + hata yakalama takılır:
 *   • istek reddolursa → `{Data:null}` ile çözülür  → status NONE → kitap HEMEN açılır
 *   • istek asılı kalırsa → bütçe dolunca aynı şey olur (varsayılan 2,5 sn)
 *   • istek sağlıklı dönerse → hiçbir şey değişmez, güncelleme kararı aynen işler
 * Kitap böylece güncelleme kararı BİLİNİR BİLİNMEZ açılır; 5 saniyelik güvence
 * yerinde kalır ama artık ulaşılamaz — tetikleyen koşul ortadan kalkmıştır.
 *
 * Güncelleme İPTAL EDİLMEZ: bütçe dolduğunda o oturumda atlanır, sonrakinde
 * yeniden sorulur. Açılışı bekletmek pahasına güncelleme kovalamak,
 * `acilis-guncelleme-oteleme` ile verilen kararın tersidir.
 */

const path = require('path');
const fs = require('fs-extra');

const ISARET = 'EMPP_ILK_SAYFA';
const VARSAYILAN_BUTCE_MS = 2500;

/** Kapı: varsayılan AÇIK. Kapatmak için EMPP_ILK_SAYFA=0. */
function acikMi(env = process.env) {
  return env.EMPP_ILK_SAYFA !== '0';
}

// `X.checkUpdates[e.id]||sorgula(e).then(` — küçültücü yalnız tanımlayıcıları
// değiştiriyor, iskelet 53 çağrı yerinde birebir aynı.
const SORGU_RE = /\.checkUpdates\[(\w+)\.id\]\s*\|\|\s*(\w+)\(\1\)\.then\(/g;

// Yanlış eşleşmeye karşı çapa: eşleşmenin hemen ardından bu eylem gelmeli.
const CAPA = 'SET_CHECK_UPDATE';
const CAPA_PENCERESI = 400;

/**
 * Saf dönüşüm. Dosya sistemine dokunmaz.
 * @returns {{icerik:string, uygulandi:boolean, sebep:string, yama:number}}
 */
function icerigiDuzelt(icerik, { butceMs } = {}) {
  const giris = String(icerik == null ? '' : icerik);
  if (giris.includes(ISARET)) {
    return { icerik: giris, uygulandi: false, sebep: 'zaten-yamali', yama: 0 };
  }
  if (!giris.includes(CAPA)) {
    return { icerik: giris, uygulandi: false, sebep: 'kalip-yok', yama: 0 };
  }
  const butce = Number.isFinite(butceMs) && butceMs > 0
    ? Math.floor(butceMs) : VARSAYILAN_BUTCE_MS;

  let yama = 0;
  const cikti = giris.replace(SORGU_RE, (tam, kapak, sorgu, konum, tumu) => {
    // Çapa: bu gerçekten güncelleme sorgusu mu, yoksa benzeyen başka bir zincir mi?
    if (!tumu.slice(konum, konum + CAPA_PENCERESI).includes(CAPA)) return tam;
    yama += 1;
    const bos = `{Data:null,Vs:${kapak}.version}`;
    return `.checkUpdates[${kapak}.id]||/*${ISARET}*/Promise.race([${sorgu}(${kapak}),`
      + `new Promise(function(_isp){setTimeout(function(){_isp(${bos})},${butce})})])`
      + `.catch(function(){return ${bos}}).then(`;
  });
  if (yama === 0) {
    return { icerik: giris, uygulandi: false, sebep: 'kalip-yok', yama: 0 };
  }
  return { icerik: cikti, uygulandi: true, sebep: 'duzeltildi', yama };
}

/** Bir paket ağacındaki (kök + bir seviye alt dizin) js paketlerini düzeltir. */
async function paketeUygula(paketKoku, { log = () => {}, butceMs } = {}) {
  const sonuc = [];
  const dizinler = [paketKoku];
  for (const ad of await fs.readdir(paketKoku)) {
    const tam = path.join(paketKoku, ad);
    if ((await fs.stat(tam)).isDirectory()) dizinler.push(tam);
  }
  for (const dizin of dizinler) {
    let yamaliDosya = 0;
    let yamaliCagri = 0;
    for (const ad of await fs.readdir(dizin)) {
      if (!ad.endsWith('.js')) continue;
      const tam = path.join(dizin, ad);
      if (!(await fs.stat(tam)).isFile()) continue;
      const mevcut = await fs.readFile(tam, 'utf8');
      // Hızlı eleme: dosyaların büyük çoğunluğu sorguyu hiç içermiyor.
      if (!mevcut.includes(CAPA)) continue;
      const r = icerigiDuzelt(mevcut, { butceMs });
      if (!r.uygulandi) continue;
      await fs.writeFile(tam, r.icerik, 'utf8');
      yamaliDosya += 1;
      yamaliCagri += r.yama;
    }
    if (yamaliDosya) {
      const ad = path.relative(paketKoku, dizin) || '.';
      sonuc.push({ dizin: ad, dosya: yamaliDosya, cagri: yamaliCagri });
      log(`   ilk sayfa: ${ad} — ${yamaliDosya} paket, ${yamaliCagri} sorguya süre bütçesi`);
    }
  }
  return sonuc;
}

module.exports = {
  ISARET, acikMi, icerigiDuzelt, paketeUygula, VARSAYILAN_BUTCE_MS, CAPA_PENCERESI,
};

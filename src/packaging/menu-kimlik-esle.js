'use strict';

/**
 * MENÜ KİMLİK EŞLEMESİ — okuyucu kabuğu `h()` yaması (2026-10-05, seçenek A).
 *
 * SAHA ARIZASI (45449, 18 yeşil kart): okuyucu kabuğu (kanonik 1.13.14, ana dosya
 * `1478d1f68940d2fdb30a.main.js`) çevrimiçi açılışta `GetPackageBooks?id=<main.$.ID>` ile
 * menüyü panelden baştan kurar. Her kapakta:
 *
 *     version = isDownloaded ? (h(GroupId, TabId, Id)?.$.version ?? 1) : 0
 *
 * `h(e,n,r)` YEREL menüde Group.ID==e VE Tab.ID==n VE cover.ID==r arar. Paket menüleri
 * Group ID=setId, Tab ID=1..n biçiminde (bizim index-ureteci de İmpark'ın set exe'leri de),
 * panel ise Group=683 / Tab=4294,1419… döndürür → 0/N eşleşme → indirilmiş her kitap
 * version=1 → İmpark sürümü >1 olan kitaplar "güncelleme var" (yeşil bulut) görünür.
 * Etkilenen sınıf: kök menülü tek-motor setler (15 set: 45448, 45449, 45469, …).
 *
 * YAMA: `h()` önce BUGÜNKÜ GİBİ Group/Tab/cover ile arar (gövde aynen, IIFE içinde);
 * sonuç yoksa yerel menünün TÜM ağacında (Group[].Tab[].cover[]) `parseInt(cover.$.ID)`
 * == `parseInt(r)` olan İLK kapağı döndürür. Group/Tab eşleşiyorsa davranış birebir aynı;
 * h yalnız bu üreticinin (`p`) içinde, yalnız sürüm okumak için çağrılıyor.
 *
 * KALIP YAPISAL tanınır (küçültücü adları sürüme göre değişir):
 *   `<ad>=function(<a>,<b>,<c>){var <o>,<i>;return null===(<o>=<kok>.main.Group.find(`
 * Kalıp tek değilse, gövdede `.Tab.find(` / `.cover.find(` yoksa ya da gövde dize/regex
 * taşıyorsa → 'kalip-yok' (hiçbir şey değişmez). Fail-closed DEĞİL: yama iyileştirmedir,
 * paketleme durmaz; durum paket.json'a `menuKimlikEsle` olarak düşer.
 *
 * KAPI ETKİSİ: `kabukKapisi` dosya sha'sı değil ROZET sürümü (`e.exports={i8:"X"}` + parça
 * haritası) ölçer — eklenen metin ikisine de dokunmaz, kapı yama sonrası aynen geçer.
 * Dosya ADI (content-hash) değişmez; kanonik dizin (~/.empp-agent/kabuk) hiç değişmez.
 * Eklenen kod saf ASCII'dir: rozet okuyucu main.js'i latin1 okur.
 */

const path = require('path');
const fs = require('fs-extra');
const { kitapDizinleri, indexMainReferanslari, okuyucusuzMu } = require('./okuyucu-kabugu');

const ISARET = 'EMPP_MENU_ID_ESLE';

/** Kapı: varsayılan AÇIK. `EMPP_MENU_ID_ESLE=0` kapatır. */
function acikMi(env = process.env) {
  return (env && env.EMPP_MENU_ID_ESLE) !== '0';
}

const ID = '[A-Za-z_$][\\w$]*';
// Kanonik 1.13.14'teki birebir başlangıç:
//   `h=function(e,n,r){var o,i;return null===(o=t.main.Group.find(`
const BASLANGIC_RE = new RegExp(
  `(${ID})=function\\((${ID}),(${ID}),(${ID})\\)\\{var (${ID}),(${ID});`
  + `return null===\\(\\5=(${ID})\\.main\\.Group\\.find\\(`, 'g');

/**
 * `acilis` konumundaki `{` için eşleşen `}` konumunu döndürür. Dize ve blok yorumlarını
 * atlar (yamalı gövdedeki işaret yorumu için). Bulamazsa -1. SAF.
 */
function parantezSonu(metin, acilis) {
  let derinlik = 0;
  for (let i = acilis; i < metin.length; i += 1) {
    const c = metin[i];
    if (c === '/' && metin[i + 1] === '*') {
      const s = metin.indexOf('*/', i + 2);
      if (s < 0) return -1;
      i = s + 1;
    } else if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < metin.length && metin[j] !== c) j += metin[j] === '\\' ? 2 : 1;
      i = j;
    } else if (c === '{') {
      derinlik += 1;
    } else if (c === '}') {
      derinlik -= 1;
      if (derinlik === 0) return i;
    }
  }
  return -1;
}

/**
 * Yamasız `h` fonksiyonunu yapısal olarak bulur. Tek ve sağlam eşleşme yoksa null. SAF.
 * @returns {{bas:number, son:number, ad:string, parametreler:string[], kok:string,
 *   govde:string}|null} bas..son = `ad=function(...){...}` (son dahil değil)
 */
function hFonksiyonuBul(metin) {
  const eslesmeler = [...String(metin).matchAll(BASLANGIC_RE)];
  if (eslesmeler.length !== 1) return null;
  const m = eslesmeler[0];
  const [, ad, a, b, c, o, i, kok] = m;
  // Kök tanımlayıcı parametre/yerel değişkenle gölgelenmişse yapı beklediğimiz değil.
  if ([a, b, c, o, i].includes(kok)) return null;
  const acilis = m.index + m[0].indexOf('{');
  const kapanis = parantezSonu(metin, acilis);
  if (kapanis < 0) return null;
  const govde = metin.slice(acilis + 1, kapanis);
  // Gövde savunması: dize/regex/yorum taşımamalı, üç seviye aramayı içermeli.
  if (/['"`/]/.test(govde)) return null;
  if (!govde.includes('.Tab.find(') || !govde.includes('.cover.find(')) return null;
  // Gövde IIFE'ye sarılır: `arguments`/`this` orada farklı nesneye bağlanır → yama güvensiz.
  if (/\barguments\b|\bthis\b/.test(govde)) return null;
  return { bas: m.index, son: kapanis + 1, ad, parametreler: [a, b, c], kok, govde };
}

/** Yamalı `h` metnini üretir. Eklenen kod ES5 ve saf ASCII. SAF. */
function yamaliFonksiyon({ ad, parametreler, kok, govde }) {
  const [, , r] = parametreler;
  const v = (s) => `__empp_${s}`;
  const dizi = v('d');
  const geri = [
    `var ${dizi}=function(x){return null==x?[]:[].concat(x)},${v('r')}=parseInt(${r},10),`,
    `${v('g')}=${dizi}(${kok}.main&&${kok}.main.Group);`,
    `for(var ${v('a')}=0;${v('a')}<${v('g')}.length;${v('a')}++){`,
    `var ${v('t')}=${dizi}(${v('g')}[${v('a')}]&&${v('g')}[${v('a')}].Tab);`,
    `for(var ${v('b')}=0;${v('b')}<${v('t')}.length;${v('b')}++){`,
    `var ${v('c')}=${dizi}(${v('t')}[${v('b')}]&&${v('t')}[${v('b')}].cover);`,
    `for(var ${v('k')}=0;${v('k')}<${v('c')}.length;${v('k')}++){`,
    `var ${v('x')}=${v('c')}[${v('k')}];`,
    `if(${v('x')}&&${v('x')}.$&&parseInt(${v('x')}.$.ID,10)===${v('r')})return ${v('x')}}}}`,
    `return ${v('s')}`,
  ].join('');
  return `${ad}=function(${parametreler.join(',')}){/*${ISARET}*/`
    + `var ${v('s')}=(function(){${govde}})();if(null!=${v('s')})return ${v('s')};${geri}}`;
}

/**
 * SAF yama. Dosya sistemine dokunmaz.
 * @param {string} mainJsMetni okuyucu kabuğu `*.main.js` içeriği
 * @returns {{metin:string, durum:'yamandi'|'zaten'|'kalip-yok'}}
 */
function menuKimlikEsleYamasi(mainJsMetni) {
  const metin = String(mainJsMetni == null ? '' : mainJsMetni);
  if (metin.includes(ISARET)) return { metin, durum: 'zaten' };
  const h = hFonksiyonuBul(metin);
  if (!h) return { metin, durum: 'kalip-yok' };
  return {
    metin: metin.slice(0, h.bas) + yamaliFonksiyon(h) + metin.slice(h.son),
    durum: 'yamandi',
  };
}

/** Kitap durumlarından paket durumu: biri kalıpsızsa 'kalip-yok', biri yamandıysa 'yamandi'. */
function toplamDurum(tumKitaplar) {
  // okuyucusuz bookN (yalnız PDF, index.html yok) yamanacak main.js taşımaz — toplamaya girmez
  const kitaplar = tumKitaplar.filter((k) => k.durum !== 'kabuksuz');
  if (!kitaplar.length || kitaplar.some((k) => k.durum === 'kalip-yok')) return 'kalip-yok';
  return kitaplar.some((k) => k.durum === 'yamandi') ? 'yamandi' : 'zaten';
}

/**
 * paket.json'a `menuKimlikEsle` alanını yazar (diğer alanlar korunur). Dosya YOKSA
 * yaratmaz — paket.json'un sahibi kabuk/manifest adımlarıdır.
 */
async function paketJsonaYaz(kokDizin, durum) {
  const hedef = path.join(kokDizin, 'paket.json');
  if (!(await fs.pathExists(hedef))) return;
  let govde = {};
  try { govde = JSON.parse(await fs.readFile(hedef, 'utf8')); } catch { govde = {}; }
  await fs.writeFile(hedef, `${JSON.stringify({ ...govde, menuKimlikEsle: durum }, null, 2)}\n`,
    'utf8');
}

/**
 * Paketin her kitap dizininde (setlerde bookN, tek kitapta kök) index.html'in referans
 * verdiği `*.main.js`'i yamalar. Okuyucu kabuğu kanoniğe çevrildikten SONRA çağrılır.
 * @param {string} kokDizin
 * @param {{log?:Function, paketJsonYaz?:boolean}} [opts]
 * @returns {Promise<{durum:string, kitaplar:Array<{dizin:string, main:string|null,
 *   durum:string, sebep?:string}>}>}
 */
async function paketeUygula(kokDizin, opts = {}) {
  const log = opts.log || (() => {});
  const kitaplar = [];
  for (const rel of await kitapDizinleri(kokDizin)) {
    const dir = path.join(kokDizin, rel);
    const dizin = rel || '.';
    if (await okuyucusuzMu(kokDizin, rel)) {
      kitaplar.push({ dizin, main: null, durum: 'kabuksuz', sebep: 'index-yok' });
      log(`   menü kimlik eşleme ${dizin}: okuyucusuz (index.html yok) — atlandı`);
      continue;
    }
    let html = null;
    try { html = await fs.readFile(path.join(dir, 'index.html'), 'utf8'); } catch { html = null; }
    const adlar = html ? indexMainReferanslari(html).js : [];
    if (!adlar.length) {
      kitaplar.push({ dizin, main: null, durum: 'kalip-yok', sebep: 'main-yok' });
      continue;
    }
    for (const ad of adlar) {
      const yol = path.join(dir, ad);
      if (!(await fs.pathExists(yol))) {
        kitaplar.push({ dizin, main: ad, durum: 'kalip-yok', sebep: 'main-yok' });
        continue;
      }
      // Kodlama gidiş-dönüş denetimi: utf8 olarak çözülemeyen bayt (latin1 vb.) yazımda
      // bozulur → dosyaya dokunma, 'kalip-yok(kodlama)'.
      const ham = await fs.readFile(yol);
      const okunan = ham.toString('utf8');
      if (!Buffer.from(okunan, 'utf8').equals(ham)) {
        kitaplar.push({ dizin, main: ad, durum: 'kalip-yok', sebep: 'kodlama' });
        log(`   menü kimlik eşleme ${dizin}/${ad}: kalip-yok(kodlama)`);
        continue;
      }
      const r = menuKimlikEsleYamasi(okunan);
      if (r.durum === 'yamandi') await fs.writeFile(yol, r.metin, 'utf8');
      kitaplar.push({ dizin, main: ad, durum: r.durum });
      log(`   menü kimlik eşleme ${dizin}/${ad}: ${r.durum}`);
    }
  }
  const durum = toplamDurum(kitaplar);
  if (opts.paketJsonYaz !== false) await paketJsonaYaz(kokDizin, durum);
  return { durum, kitaplar };
}

/**
 * packagingService adımı: yamayı uygular, ASLA fırlatmaz (fail-closed değil). Kalıp
 * tutmazsa uyarı + paket.json `menuKimlikEsle: "kalip-yok"`.
 * @returns {Promise<{durum:string, kitaplar:Array, hata?:string}>}
 */
async function kabukSonrasiAdim(kokDizin, { log = console.log, uyar = console.warn } = {}) {
  let sonuc;
  try {
    sonuc = await paketeUygula(kokDizin, { log });
  } catch (e) {
    sonuc = { durum: 'kalip-yok', kitaplar: [], hata: e.message };
    try { await paketJsonaYaz(kokDizin, 'kalip-yok'); } catch { /* paket.json yazılamadı */ }
  }
  const yamali = sonuc.kitaplar.filter((k) => k.durum === 'yamandi').length;
  log(`🧭 Menü kimlik eşleme: ${sonuc.durum} (${yamali}/${sonuc.kitaplar.length} main.js yamandı)`);
  if (sonuc.durum === 'kalip-yok') {
    const kalipsiz = sonuc.kitaplar.filter((k) => k.durum === 'kalip-yok')
      .map((k) => `${k.dizin}${k.sebep ? `(${k.sebep})` : ''}`).join(', ');
    uyar(`⚠️ Menü kimlik eşleme kalıbı tutmadı (paketleme devam ediyor): `
      + `${sonuc.hata || kalipsiz || 'kitap dizini yok'} — panel menüsünde yeşil bulut kalabilir`);
  }
  return sonuc;
}

module.exports = {
  ISARET,
  acikMi,
  parantezSonu,
  hFonksiyonuBul,
  menuKimlikEsleYamasi,
  toplamDurum,
  paketJsonaYaz,
  paketeUygula,
  kabukSonrasiAdim,
};

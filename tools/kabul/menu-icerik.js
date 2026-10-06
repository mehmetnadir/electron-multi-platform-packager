#!/usr/bin/env node
'use strict';
/**
 * MENÜ İÇERİK KAPISI — menüdeki her kitap kartının açılacak içerik dosyası pakette var mı (2026-10-06).
 *
 * DOĞUŞ (set 45479, 01.10 apk, kitap 14835 "The Old Man and the Sea"): menü kartı
 * `xmlSource="assets/14835/data/BookContent.xml"` gösterir, ama dosya pakette YOK; kullanıcı karta
 * basınca kitap açılmaz. İmpark'ta 14835 zip'i 404 → paket içeriksiz üretilmişti. Önceki kapılar
 * kart SAYISINI ve kapak GÖRSELİNİ ölçtü, içerik dosyasını ölçmedi (menu-kapak.js ile aynı körlük sınıfı).
 *
 * ÖLÇÜT: set düzeninde `<bookN>/classlibraries/ImWin32.dll`, tek kitapta `classlibraries/ImWin32.dll`
 * menüsü çözülür (icerik-merdiven.menuKonumlari + runtime menuCoz/kapaklar: TEK KAYNAK); her kapağın
 * `xmlSource` dosyası (`<kök><xmlSource>`) pakette VAR ve > 0 bayt değilse RED.
 * MUAF: link/oyun kartı = İmpark kitabı olmayan kimlik (0/boş/sayısal değil) ya da `externalExeUrl`'li
 * ve xmlSource'suz kapak. İmpark kimliği olup xmlSource'u olmayan kapak RED (kitap açılamaz).
 * Menü hiç yoksa ATLANDI; menü çözülemezse ÖLÇÜLEMEDİ (GEÇTİ'ye düşmez).
 *
 * Sonuç: { durum: GECTI|RED|OLCULEMEDI|ATLANDI, kartlar:[{kitap, id, baslik, xmlSource, bayt, sorun}],
 *          sebepler:[], uyarilar:[] }.
 * CLI: node tools/kabul/menu-icerik.js <paket-kökü | app.asar>
 *   Çıkış: 0 GEÇTİ/ATLANDI · 1 RED · 3 ÖLÇÜLEMEDİ · 2 kullanım hatası.
 *
 * BOZARSAN: `menu-icerik.test.js` (eksik içerik RED, tam GEÇTİ, muaflar, kip) kırılır.
 */
const fs = require('fs');
const path = require('path');
const ig = require('../../src/runtime/icerik-guncelleme');
const { menuKonumlari, imparkKimligiMi } = require('../../src/agent/icerik-merdiven');
const { kokOkuyucu } = require('./menu-kapak');
const atlananUye = require('./atlanan-uyeler');

const DURUM = Object.freeze({
  GECTI: 'GECTI', RED: 'RED', OLCULEMEDI: 'OLCULEMEDI', ATLANDI: 'ATLANDI',
});
/** `KABUL_MENU_ICERIK` kipi: uyar (varsayılan) | reddet | kapali. Saf. */
function kip(env = process.env) {
  const k = String((env && env.KABUL_MENU_ICERIK) || '').trim().toLowerCase();
  return k === 'reddet' || k === 'kapali' ? k : 'uyar';
}

const attr = (etiket, ad) => {
  const m = new RegExp(`\\s${ad}="([^"]*)"`).exec(etiket);
  return m ? m[1] : null;
};

/**
 * @param {{adlar: Iterable<string>, boyut: (rel:string)=>(number|null), oku: (rel:string)=>(Buffer|null)}} o
 *   `adlar` menü konumunu bulmak için yeterli yollar (en az `<x>/classlibraries/ImWin32.dll`).
 */
function menuIcerikOlc(o) {
  const sonuc = { durum: DURUM.GECTI, kartlar: [], sebepler: [], uyarilar: [] };
  const { konumlar } = menuKonumlari(o.adlar || []);
  if (!konumlar.length) return { ...sonuc, durum: DURUM.ATLANDI, sebepler: ['menü yok — kitap paketi değil'] };
  let olculemedi = false;
  for (const { kitap, kok } of konumlar) {
    let xml = null;
    try { xml = ig.menuCoz(o.oku(`${kok}${ig.MENU_GORELI}`)); } catch (_) { xml = null; }
    if (!xml) {
      olculemedi = true;
      sonuc.sebepler.push(`${kitap}: menü çözülemedi`);
      continue;
    }
    for (const c of ig.kapaklar(xml)) {
      const xs = attr(c.etiket, 'xmlSource');
      const ext = attr(c.etiket, 'externalExeUrl');
      const kart = {
        kitap, id: c.ID, baslik: attr(c.etiket, 'actName') || '', xmlSource: xs, bayt: null, sorun: null, muaf: false,
      };
      if (!imparkKimligiMi(c.ID) || (!xs && ext)) kart.muaf = true;
      else if (!xs) kart.sorun = 'menüde xmlSource yok';
      else {
        const rel = path.posix.normalize(`${kok}${xs.replace(/^\/+/, '')}`);
        if (rel.startsWith('..')) kart.sorun = `xmlSource paket dışına çıkıyor: ${xs}`;
        else {
          kart.bayt = o.boyut(rel);
          if (kart.bayt == null) kart.sorun = `içerik dosyası pakette yok: ${rel}`;
          else if (kart.bayt <= 0) kart.sorun = `içerik dosyası boş: ${rel}`;
        }
      }
      sonuc.kartlar.push(kart);
    }
  }
  // ATLANAN ÜYE (Nadir 06.10): manifestteki üye beklenmez; kartı menüde kalmışsa RED açıkça etiketlenir.
  const atlanan = atlananUye.atlananUyelerOku(o);
  if (atlanan.length) {
    const ak = atlananUye.kume(atlanan);
    for (const k of sonuc.kartlar) {
      if (k.sorun && ak.has(String(k.id))) k.sorun += ' (ATLANAN ÜYE — kart menüden çıkarılmalıydı)';
    }
    sonuc.atlananUyeler = atlanan;
    sonuc.notlar = [atlananUye.notSatiri(atlanan)];
  }
  const sorunlu = sonuc.kartlar.filter((k) => k.sorun);
  for (const k of sorunlu) sonuc.sebepler.push(`${k.kitap} ${k.id} "${k.baslik}": ${k.sorun}`);
  if (sorunlu.length) sonuc.durum = DURUM.RED;
  else if (olculemedi) sonuc.durum = DURUM.OLCULEMEDI;
  else if (!sonuc.kartlar.length) {
    return { ...sonuc, durum: DURUM.OLCULEMEDI, sebepler: ['menüde kapak yok'] };
  }
  return sonuc;
}

/** Üst düzey dizin adları + menü dosyası var mı: adlar listesi üretir (set: `<d>/classlibraries/ImWin32.dll`). */
function adlarUret(ustler, boyut) {
  const adlar = [];
  if (boyut(ig.MENU_GORELI) != null) adlar.push(ig.MENU_GORELI);
  for (const d of ustler) if (boyut(`${d}/${ig.MENU_GORELI}`) != null) adlar.push(`${d}/${ig.MENU_GORELI}`);
  return adlar;
}

/** Üst düzey ad listesi (dizin: readdir; asar: başlık ağacı). */
function ustDizinler(kok, asarMi) {
  try {
    if (asarMi) {
      // eslint-disable-next-line global-require
      const asar = require('@electron/asar');
      return Object.keys(asar.getRawHeader(kok).header.files || {});
    }
    return fs.readdirSync(kok, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch (_) { return []; }
}

function menuIcerikOlcKok(kok, { asar } = {}) {
  const asarMi = asar == null ? /\.asar$/i.test(String(kok)) : asar;
  const ok = kokOkuyucu(kok, asarMi);
  return menuIcerikOlc({
    adlar: adlarUret(ustDizinler(kok, asarMi), ok.boyut), boyut: ok.boyut, oku: ok.oku,
  });
}

/** Kip uygulanmış karar: kapali → null; uyar → RED/ÖLÇÜLEMEDİ yalnız uyarı. Saf. */
function kipliKarar(s, k) {
  if (k === 'kapali') return { katman: null, uyari: null };
  const kotu = s.durum === DURUM.RED || s.durum === DURUM.OLCULEMEDI;
  if (k === 'uyar' && kotu) {
    return { katman: null, uyari: `KABUL_MENU_ICERIK=uyar: menü içerik ${s.durum} (${s.sebepler.slice(0, 4).join(' | ')}) — yalnız uyarı` };
  }
  return { katman: s.durum === DURUM.ATLANDI ? null : { durum: s.durum, sebepler: s.sebepler }, uyari: null };
}

function ozetSatiri(s) {
  const tr = { GECTI: 'GEÇTİ', RED: 'RED', OLCULEMEDI: 'ÖLÇÜLEMEDİ', ATLANDI: 'ATLANDI' };
  const say = s.kartlar.filter((k) => !k.muaf).length;
  return `menü içerik: ${tr[s.durum] || s.durum} · ${say} kitap kartı`
    + `${s.sebepler.length ? ` — ${s.sebepler.slice(0, 4).join(' | ')}` : ''}`
    + `${s.notlar && s.notlar.length ? ` · NOT: ${s.notlar.join(' | ')}` : ''}`;
}

module.exports = { DURUM, kip, menuIcerikOlc, menuIcerikOlcKok, kipliKarar, ozetSatiri };

if (require.main === module) {
  const hedef = process.argv[2];
  if (!hedef) {
    process.stderr.write('Kullanım: node tools/kabul/menu-icerik.js <paket-kökü | app.asar>\n');
    process.exit(2);
  }
  const s = menuIcerikOlcKok(hedef);
  process.stdout.write(`${ozetSatiri(s)}\n`);
  process.exit({ GECTI: 0, ATLANDI: 0, RED: 1, OLCULEMEDI: 3 }[s.durum]);
}

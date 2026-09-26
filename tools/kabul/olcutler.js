'use strict';
/**
 * BAŞSIZ KABUL KAPISI — saf ölçüt ve karar fonksiyonları (fs / ağ / süreç YOK).
 *
 * NEDEN (2026-09-26): SET kökü ezilmiş Super Monsters 3 (73768) mac DMG'si ve
 * Android APK'sı kabulsüz R2'ye gitti. Kök `index.html` yayıncı güncellemesiyle
 * okuyucu sayfası olmuştu; paket sonsuza dek "yükleniyor" ekranında kaldı. Yalnız
 * Pardus'un ProBook kapısı yakaladı, mac ve Android'de kapı yoktu.
 *
 * Eşikler ProBook kapısından (`tools/pardus/probook-kabul.sh`) BİREBİR alınır:
 *   sapma  = gri tonlu görüntünün standart sapması (0..1)          >= 0.05
 *   koyu   = gri değeri %85'in altında kalan piksel oranı          >= 0.005
 *   renk   = farklı renk sayısı (ImageMagick `%k`)                 >= 500
 * ProBook'ta ölçülen ayırt edici (aynı makine):
 *   kırık (yükleniyor "…" ekranı): sapma 0.020 · koyu 0.00047 · renk 10
 *   sağlam (kitap 1/88)           : sapma 0.198 · koyu 0.51    · renk 93750
 *
 * Kapı üç sonuç verir: GECTI · RED · OLCULEMEDI. Ölçülemeyen bir şey sessizce
 * GEÇTİ'ye DÜŞMEZ (Windows paket kapısı dersi).
 *
 * BOZARSAN: `olcutler.test.js` içindeki eşik, kart, başlık ve yükleniyor testleri kırılır.
 */

const OKUYUCU_BASLIGI = 'Akıllı Tahta Uygulaması';

/** probook-kabul.sh ile aynı eşikler. */
const ESIKLER = Object.freeze({ sapma: 0.05, koyu: 0.005, renk: 500 });

/** ImageMagick `-threshold 85%`: eşiği AŞAN beyaz, geri kalanı siyah (koyu) sayılır. */
const KOYU_ESIGI = 0.85;

const DURUM = Object.freeze({ GECTI: 'GECTI', RED: 'RED', OLCULEMEDI: 'OLCULEMEDI' });

/** Çıkış kodları (CLI sözleşmesi): 0 GEÇTİ, 1 RED, 3 ÖLÇÜLEMEDİ. */
const CIKIS_KODU = Object.freeze({ GECTI: 0, RED: 1, OLCULEMEDI: 3 });

/**
 * Motor konsolunda görülünce paketin kesin kusurlu olduğu imzalar
 * (probook-kabul.sh "beyaz ekran imzaları" ile aynı sınıf, K17).
 */
const RED_IMZALARI = Object.freeze([
  { desen: /ImWin32\.dll dosyası okunamadı/i, sebep: 'kök sayfa motor kopyası gibi davranıyor (ImWin32 hatası)' },
  { desen: /assets not found in/i, sebep: 'kök sayfa motor kopyası gibi davranıyor (assets bulunamadı)' },
]);

/**
 * Ham bit eşleminden ProBook metriklerini hesaplar.
 *
 * Gri = Rec.709 luma (0.2126 R + 0.7152 G + 0.0722 B), 0..1. Standart sapma
 * nüfus sapmasıdır (ImageMagick `standard_deviation` gibi). Renk sayısı RGB
 * üzerinden (alfa yok sayılır — ekran görüntüsü opaktır).
 *
 * @param {Uint8Array|Buffer} veri  piksel dizisi (4 bayt/piksel)
 * @param {number} genislik
 * @param {number} yukseklik
 * @param {{duzen?: 'bgra'|'rgba'}} [secenek]  Electron `toBitmap()` macOS'ta BGRA verir.
 * @returns {{sapma:number, koyu:number, renk:number, ortalama:number, genislik:number, yukseklik:number}}
 */
function pikselMetrikleri(veri, genislik, yukseklik, secenek = {}) {
  const duzen = secenek.duzen || 'bgra';
  const n = genislik * yukseklik;
  if (!veri || !n || veri.length < n * 4) {
    return { sapma: 0, koyu: 0, renk: 0, ortalama: 0, genislik: genislik || 0, yukseklik: yukseklik || 0 };
  }
  const rI = duzen === 'bgra' ? 2 : 0;
  const bI = duzen === 'bgra' ? 0 : 2;
  // 2^24 renk için bit kümesi (2 MB) — Set'ten ~10 kat hızlı.
  const gorulen = new Uint8Array(1 << 21);
  let renk = 0;
  let toplam = 0;
  let kareToplam = 0;
  let koyuSayi = 0;
  for (let i = 0, p = 0; i < n; i += 1, p += 4) {
    const r = veri[p + rI];
    const g = veri[p + 1];
    const b = veri[p + bI];
    const kod = (r << 16) | (g << 8) | b;
    const bayt = kod >>> 3;
    const bit = 1 << (kod & 7);
    if (!(gorulen[bayt] & bit)) { gorulen[bayt] |= bit; renk += 1; }
    const gri = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    toplam += gri;
    kareToplam += gri * gri;
    if (gri <= KOYU_ESIGI) koyuSayi += 1;
  }
  const ortalama = toplam / n;
  const varyans = Math.max(0, kareToplam / n - ortalama * ortalama);
  return {
    sapma: Number(Math.sqrt(varyans).toFixed(6)),
    koyu: Number((koyuSayi / n).toFixed(6)),
    renk,
    ortalama: Number(ortalama.toFixed(6)),
    genislik,
    yukseklik,
  };
}

/**
 * ProBook eşikleriyle piksel kararı.
 * @param {{sapma:number,koyu:number,renk:number}|null} m
 * @param {{aktivasyon?: boolean, sapmaAranmaz?: boolean}} [secenek]
 *   aktivasyon: aktivasyon kodlu serilerde renk eşiği aranmaz (probook ile aynı).
 *   sapmaAranmaz: YALNIZ ara ekran (motor kitap rafı) için — beyaz zeminli raf 0,0494 ölçüldü
 *   (MEÇ 73714, sağlam); belirleyici ölçüm okuyucu sayfasıdır ve orada sapma TAM aranır.
 */
function pikselKarari(m, secenek = {}) {
  if (!m || typeof m.sapma !== 'number') {
    return { gecti: false, olculemedi: true, sebep: 'ekran görüntüsü alınamadı' };
  }
  const renkEsigi = secenek.aktivasyon ? 0 : ESIKLER.renk;
  const eksik = [];
  if (!secenek.sapmaAranmaz && !(m.sapma >= ESIKLER.sapma)) eksik.push(`sapma ${m.sapma} < ${ESIKLER.sapma}`);
  if (!(m.koyu >= ESIKLER.koyu)) eksik.push(`koyu ${m.koyu} < ${ESIKLER.koyu}`);
  if (!(m.renk >= renkEsigi)) eksik.push(`renk ${m.renk} < ${renkEsigi}`);
  return {
    gecti: eksik.length === 0,
    olculemedi: false,
    sebep: eksik.length ? `ekranda içerik yok (${eksik.join(', ')}) — beyaz/yükleniyor ekranı` : '',
  };
}

/** Başlık okuyucunun genel başlığı mı? (SET kökünde menü yerine okuyucu açılmış demektir.) */
function okuyucuBasligiMi(baslik) {
  return String(baslik || '').trim().toLocaleLowerCase('tr') === OKUYUCU_BASLIGI.toLocaleLowerCase('tr');
}

/**
 * Beklenen menü kartı sayısı.
 *
 * Paket menü tanımı taşıyorsa (`set-menu.json` → `kitaplar`, dolu) beklenen = o tanım:
 * kitaplar GRUPLANABİLİR (aynı `grup` adı tek kart olur), yani beklenen = grup sayısı +
 * grupsuz kitap sayısı. Tanım yoksa beklenen = motor imzası (`app.config.js`) taşıyan alt
 * kitap dizini sayısı. Elle verilen sayı (`--kitap-sayisi`) her şeyi ezer.
 *
 * Neden tanım önce: dizin sayısı "pakette hangi kitap var"dır, "menü hangi kartı gösterir"
 * değil. 45549 (Shall We?! 7 Set, 26.09): book5 = Shall We 7 Games, motor imzalı ama kaynak
 * menüsü (set-menu.json + config/settings.json) onu bilinçli listelemiyordu; kabul 5 kart
 * bekleyip 4'ü RED saydı. Menü dışı dizin RED değil, `menudeOlmayanKitapDizinleri` notudur.
 *
 * @param {{kitapDizinleri?: string[], setMenu?: object|null, elle?: number|null}} p
 * @returns {number}
 */
function beklenenKartSayisi({ kitapDizinleri = [], setMenu = null, elle = null } = {}) {
  if (Number.isInteger(elle) && elle >= 0) return elle;
  const kitaplar = setMenu && Array.isArray(setMenu.kitaplar) ? setMenu.kitaplar : null;
  if (kitaplar && kitaplar.length) {
    const gruplar = new Set();
    let grupsuz = 0;
    for (const k of kitaplar) {
      const g = String((k && k.grup) || '').trim();
      if (g) gruplar.add(g); else grupsuz += 1;
    }
    return gruplar.size + grupsuz;
  }
  return kitapDizinleri.length;
}

/**
 * Motor imzalı olup menü tanımında (`set-menu.json` → `kitaplar[].klasor`) yer almayan alt
 * kitap dizinleri. Tanım yoksa ya da hiçbir kitapta `klasor` yoksa karşılaştırılamaz → [].
 * Karar değil nottur: kaynak menüsü bir kitabı bilinçli dışarıda bırakabilir (45549 book5).
 *
 * @param {{kitapDizinleri?: string[], setMenu?: object|null}} p
 * @returns {string[]}
 */
function menudeOlmayanKitapDizinleri({ kitapDizinleri = [], setMenu = null } = {}) {
  const kitaplar = setMenu && Array.isArray(setMenu.kitaplar) ? setMenu.kitaplar : [];
  const klasorler = new Set(kitaplar
    .map((k) => String((k && k.klasor) || '').trim().replace(/^\/+|\/+$/g, ''))
    .filter(Boolean));
  if (!klasorler.size) return [];
  return kitapDizinleri.filter((d) => !klasorler.has(d));
}

/**
 * Konsol satırlarını sınıflandırır.
 * @param {Array<{seviye?:string|number, mesaj:string}>} satirlar
 */
function konsolSiniflandir(satirlar = []) {
  const dosyaBulunamadi = [];
  const jsHatalari = [];
  const redImzalari = [];
  const gorulenDosya = new Set();
  for (const s of satirlar) {
    const mesaj = String((s && s.mesaj) || '');
    const dosyaYok = /ERR_FILE_NOT_FOUND/.test(mesaj);
    if (dosyaYok) {
      // Aynı dosya hem preload'dan hem webRequest'ten gelebilir — URL başına bir kez say.
      const anahtar = (/file:\/\/\S+/.exec(mesaj) || [mesaj])[0];
      if (!gorulenDosya.has(anahtar)) { gorulenDosya.add(anahtar); dosyaBulunamadi.push(mesaj.slice(0, 300)); }
    }
    const seviye = s && s.seviye;
    const hataMi = seviye === 'error' || seviye === 3
      || /Uncaught|TypeError|ReferenceError|SyntaxError|Unhandled/.test(mesaj);
    if (hataMi && !dosyaYok) jsHatalari.push(mesaj.slice(0, 300));
    for (const imza of RED_IMZALARI) {
      if (imza.desen.test(mesaj) && !redImzalari.includes(imza.sebep)) redImzalari.push(imza.sebep);
    }
  }
  return { dosyaBulunamadi, jsHatalari, redImzalari };
}

/**
 * Bir aşamanın (menü ya da kitap) DOM + piksel ölçümünü karara çevirir.
 *
 * @param {object|null} olcum  koşumun döndürdüğü aşama ölçümü
 *   { olculemedi?, yuklenemedi?, cokme?, baslik, kartSayisi, yukleniyor:[], beklenenSn, piksel }
 * @param {{asama:'menu'|'kitaplik'|'kitap', setMi:boolean, beklenenKart:number, aktivasyon?:boolean}} beklenti
 *   menu = SET kök menüsü (başlık + kart + tam piksel) · kitaplik = tek kitap paketinde motorun
 *   kitap rafı (kapak + piksel, sapma hariç) · kitap = okuyucu (tam piksel + sayfa izi)
 * @returns {{durum:string, sebepler:string[], notlar:string[]}}
 */
function asamaKarari(olcum, beklenti) {
  const sebepler = [];
  const notlar = [];
  if (!olcum) return { durum: DURUM.OLCULEMEDI, sebepler: ['ölçüm yok'], notlar };
  if (olcum.olculemedi) return { durum: DURUM.OLCULEMEDI, sebepler: [String(olcum.olculemedi)], notlar };
  if (olcum.yuklenemedi) sebepler.push(`sayfa yüklenemedi: ${olcum.yuklenemedi}`);
  if (olcum.cokme) sebepler.push(`görüntü süreci çöktü: ${olcum.cokme}`);

  if (beklenti.asama === 'menu' && beklenti.setMi) {
    if (okuyucuBasligiMi(olcum.baslik)) {
      sebepler.push(`SET kökünde okuyucu başlığı "${OKUYUCU_BASLIGI}" — menü yerine okuyucu açılmış`);
    }
    const kart = Number(olcum.kartSayisi) || 0;
    if (kart !== beklenti.beklenenKart) {
      sebepler.push(`menü kartı ${kart} ≠ beklenen ${beklenti.beklenenKart}`);
    }
  }
  const yk = Array.isArray(olcum.yukleniyor) ? olcum.yukleniyor : [];
  if (yk.length) {
    sebepler.push(`${olcum.beklenenSn || '?'} sn sonra hâlâ yükleniyor göstergesi: ${yk.slice(0, 3).join(' | ')}`);
  }
  // Okuyucu aşaması: renkli bir açılış ekranı (logo) piksel eşiğini tek başına geçebilir;
  // "sayfa çizildi" demek için sayfa görseli / tuval / sayfa arka planı İZİ de aranır.
  if (beklenti.asama === 'kitap' && sayfaIzi(olcum) === 0) {
    sebepler.push('okuyucu sayfa çizmedi (görünür sayfa görseli / tuval yok)');
  }

  if (beklenti.asama === 'kitaplik' && !(olcum.kapaklar || []).length) {
    sebepler.push('okuyucu sayfa çizmedi ve kitap rafında kapak yok');
  }
  const pk = pikselKarari(olcum.piksel, { aktivasyon: beklenti.aktivasyon, sapmaAranmaz: beklenti.asama === 'kitaplik' });
  if (pk.olculemedi) {
    if (!sebepler.length) return { durum: DURUM.OLCULEMEDI, sebepler: [pk.sebep], notlar };
    notlar.push(pk.sebep);
  } else if (!pk.gecti) {
    sebepler.push(pk.sebep);
  }
  return { durum: sebepler.length ? DURUM.RED : DURUM.GECTI, sebepler, notlar };
}

/** Okuyucunun sayfa çizdiğine dair görünür iz sayısı (sayfa <img> + tuval + sayfa arka planı). */
function sayfaIzi(olcum) {
  if (!olcum) return 0;
  return (Number(olcum.sayfaGorseli) || 0) + (Number(olcum.tuval) || 0) + (Number(olcum.arkaPlanSayfa) || 0);
}

/**
 * Katman sonuçlarını genel karara indirger: herhangi biri RED → RED; değilse
 * herhangi biri ÖLÇÜLEMEDİ → ÖLÇÜLEMEDİ; hepsi GEÇTİ → GEÇTİ. Boş liste ÖLÇÜLEMEDİ.
 * @param {Array<{durum:string}>} katmanlar
 */
function genelKarar(katmanlar = []) {
  if (!katmanlar.length) return DURUM.OLCULEMEDI;
  if (katmanlar.some((k) => k && k.durum === DURUM.RED)) return DURUM.RED;
  if (katmanlar.some((k) => !k || k.durum !== DURUM.GECTI)) return DURUM.OLCULEMEDI;
  return DURUM.GECTI;
}

/**
 * Odak kanıtı: koşunun başında ve sonunda `lsappinfo front` eşit mi, koşu boyunca
 * öne geçen uygulama bizim süreç ağacımızdan mı?
 *
 * @param {{once:{asn:string,pid?:number}, sonra:{asn:string,pid?:number},
 *          ornekler?:Array<{asn:string,pid?:number}>, kendiPidler?:number[]}} p
 * @returns {{esit:boolean, calindi:boolean, onGecenler:string[], ozet:string}}
 */
function odakKarari({ once, sonra, ornekler = [], kendiPidler = [] } = {}) {
  const onceAsn = once && once.asn;
  const sonraAsn = sonra && sonra.asn;
  const esit = Boolean(onceAsn) && onceAsn === sonraAsn;
  const kendi = new Set(kendiPidler.filter((p) => Number.isInteger(p) && p > 0));
  const tum = [once, ...ornekler, sonra].filter(Boolean);
  const calindi = tum.some((o) => Number.isInteger(o.pid) && kendi.has(o.pid));
  const onGecenler = [...new Set(tum.map((o) => o.asn).filter(Boolean))];
  let ozet;
  if (calindi) ozet = 'ODAK ÇALINDI — kapının kendi süreci öne geçti';
  else if (esit) ozet = `odak korundu (önce=sonra=${onceAsn})`;
  else if (!onceAsn || !sonraAsn) ozet = 'odak ölçülemedi (lsappinfo çıktısı yok)';
  else ozet = `ön uygulama değişti (${onceAsn} → ${sonraAsn}) ama kapının süreci DEĞİL — kullanıcı geçişi`;
  return { esit, calindi, onGecenler, ozet };
}

/** Genel karar → çıkış kodu. */
function cikisKodu(durum) {
  return Object.prototype.hasOwnProperty.call(CIKIS_KODU, durum) ? CIKIS_KODU[durum] : CIKIS_KODU.OLCULEMEDI;
}

/**
 * `lsappinfo front` çıktısından ASN'i ayıklar ("ASN:0x0-0x75075:" → "ASN:0x0-0x75075").
 * Boş ya da biçimsiz çıktı → ''.
 */
function asnAyikla(cikti) {
  const m = /ASN:0x[0-9a-f]+-0x[0-9a-f]+/i.exec(String(cikti || ''));
  return m ? m[0] : '';
}

/** `lsappinfo info -only pid <asn>` çıktısından pid ("\"pid\"=2449" → 2449). */
function pidAyikla(cikti) {
  const m = /"pid"\s*=\s*(\d+)/.exec(String(cikti || ''));
  return m ? Number(m[1]) : null;
}

module.exports = {
  OKUYUCU_BASLIGI,
  ESIKLER,
  KOYU_ESIGI,
  DURUM,
  CIKIS_KODU,
  RED_IMZALARI,
  pikselMetrikleri,
  pikselKarari,
  okuyucuBasligiMi,
  beklenenKartSayisi,
  menudeOlmayanKitapDizinleri,
  konsolSiniflandir,
  sayfaIzi,
  asamaKarari,
  genelKarar,
  odakKarari,
  cikisKodu,
  asnAyikla,
  pidAyikla,
};

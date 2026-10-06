'use strict';
/**
 * SÜREÇ KİMLİĞİ — "/api/health yeşil" ile "doğru kod yüklü" iki AYRI şeydir.
 *
 * NEDEN (2026-09-21, aynı gün İKİ kez ısırdı): 3001 portu açık diye paketleyicinin
 * güncel kodu koştuğu sanıldı. Gerçekte süreç 2026-09-20 23:30'da ELLE başlatılmıştı
 * (terminal kapanınca PPID=1'e düştü) ve Node'un require() önbelleği o günün kodunu
 * donduruyordu. `/api/health` yalnız `{status, timestamp, commit, startedAt}` dönüyordu;
 * `commit` bile SÜREÇ BAŞLARKEN okunan değerdir — diskteki güncel kodu değil, başlangıç
 * ANINI yansıtır. Yani sağlık ucu "canlı mıyım" sorusuna cevap veriyordu, "hangi kodu
 * koşuyorum" sorusuna DEĞİL.
 *
 * Bu modül üç kanıt üretir:
 *   1. `pid`/`ppid` + `yetimMi` — PPID=1 ise süreç launchd/systemd çocuğu DEĞİL, elle
 *      başlatılıp terminalden kopmuş bir yetimdir (kaçak süreç deseninin imzası).
 *   2. `moduller` — kritik modüllerin BELLEKTEKİ (require.cache'te gerçekten yüklü olan)
 *      sürümünün içerik parmak izi. Modül yüklü değilse `null` — "yüklenmemiş" ile
 *      "her şey yolunda" ASLA aynı sayılmaz.
 *   3. `diskHash` — aynı dosyaların ŞU ANDAKİ disk hâli. `moduller` ile farklıysa
 *      `bayatMi: true`: require-cache donması tek bakışta görünür.
 *
 * MTIME KULLANILMAZ: dosya tarihini kopyalamak/checkout etmek mtime'ı değiştirir ama
 * içeriği değiştirmez (ve tersi de olur) — karar İÇERİKTEN türer.
 *
 * SIR SIZINTISI: dışarı YALNIZ dosya yolu + kısa hash çıkar. Ham `EMPP_*` env DEĞERİ
 * hiçbir alana girmez (kapı bayrakları `saglik-kimligi.kapilariOku` ile yalnız
 * açık/kapalı boolean olarak bildirilir) — 2026-09'da bir sır tam bu yoldan sızmıştı.
 *
 * KARAR MANTIĞI YENİDEN YAZILMAZ: bayatlık kıyası `saglik-kimligi.js`'teki
 * `yesilSayilirMi` (şüphede DAİMA false) + `kimlikUyusuyorMu` (insan-okunur sebep)
 * ile yapılır. Buradaki tek yenilik ÖLÇÜM (I/O), karar değil.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { kimlikUyusuyorMu, yesilSayilirMi } = require('./saglik-kimligi');

/** Depo kökü (src/server/ → ../..). */
const KOK = path.join(__dirname, '..', '..');

/**
 * Üretim davranışını belirleyen, require-cache donmasının EN ÇOK ısırdığı modüller.
 * Yol listesi depo köküne göre ve BİLEREK kısa tutuldu — health ucu bir envanter
 * dökümü değil, "doğru kod mu" kapısıdır.
 */
const KRITIK_MODULLER = [
  'src/packaging/set-kimligi.js',
  // set-kabuk.js: KABUK TANIMININ TEK KAYNAĞI. Güncelleme kanalının hangi dosyaları
  // göndereceğini bu modül belirler — yani üretim davranışını doğrudan tayin eder,
  // izlenmemesi kör nokta olurdu. Ayrıca set-kimligi.js ondan fonksiyon YENİDEN DIŞA
  // VERİR; listede olmazsa bekçi o kaynağı hiçbir yerde bulamaz ve hash'ler birebir
  // aynıyken bile "bayat" der (2026-09-21 canlı yanlış alarm).
  'src/packaging/set-kabuk.js',
  'src/packaging/guncelleyici-enjekte.js',
  // NOT: kitap-guncelleyici.js sunucuda require EDİLMEZ (pakete KOPYALANAN çalışma-anı
  // modülüdür, bkz. guncelleyici-enjekte.js KAYNAK_MODUL) → `moduller` alanında normal
  // şartlarda DAİMA null'dur; anlamlı olan `diskHash` (pakete girecek sürüm).
  'src/runtime/kitap-guncelleyici.js',
  'src/agent/surum-normallestir.js',
  // surum-kiyas.js: "bu zip daha yeni mi?" kararının tek kaynağı. Yanlış sürüm
  // kıyası ~1 GB gereksiz indirme üretir; parmak izi izlenmeli.
  'src/agent/surum-kiyas.js',
  'src/packaging/sayfa-webp.js',
  // A1 okuyucu kabuğu: paketleyici 65db3fa'da bayat kalıp Ş1 düzeltmesini taşımadı (06.10).
  'src/packaging/okuyucu-kabugu.js',
  'src/packaging/a1-duzen.js',
];

/** sha256'nın ilk 12 hane'si; string olmayan girdi için `null` (asla fırlatmaz). */
function parmakIzi(icerik) {
  if (typeof icerik !== 'string') return null;
  return crypto.createHash('sha256').update(icerik, 'utf8').digest('hex').slice(0, 12);
}

/** Dosyayı okur; okunamıyorsa (yok/izin/binary hata) `null` — fırlatmaz. */
function dosyaIcerigi(mutlakYol, oku) {
  try {
    const icerik = oku(mutlakYol);
    return typeof icerik === 'string' ? icerik : null;
  } catch (hata) {
    return null;
  }
}

const varsayilanOku = (yol) => fs.readFileSync(yol, 'utf8');

/**
 * Verilen listenin o ANDAKİ içerik parmak izlerini çıkarır.
 * @returns {Object<string, string|null>} göreli yol → kısa hash (ölçülemezse null)
 */
function anlikGoruntu({ liste = KRITIK_MODULLER, kok = KOK, oku = varsayilanOku } = {}) {
  const sonuc = {};
  for (const rel of liste) {
    sonuc[rel] = parmakIzi(dosyaIcerigi(path.join(kok, rel), oku));
  }
  return sonuc;
}

/**
 * BAŞLANGIÇ ANI: bu modül süreçle birlikte (app.js'in require geçişinde) yüklenir,
 * yani buradaki parmak izleri sürecin BELLEĞE ALDIĞI koda karşılık gelir. Sonradan
 * diskte yapılan değişiklik bu sabiti DEĞİŞTİRMEZ — bayatlık tam olarak budur.
 */
const BASLANGIC_IMZALARI = anlikGoruntu();

/** require.cache'te gerçekten bir modül kaydı var mı (getter'lı/bozuk cache'te de çökmez). */
function yuklenmisMi(mutlakYol, cache) {
  try {
    if (!cache || typeof cache !== 'object') return false;
    return Object.prototype.hasOwnProperty.call(cache, mutlakYol) && Boolean(cache[mutlakYol]);
  } catch (hata) {
    return false;
  }
}

/**
 * Yüklü modülün dış dünyaya açtığı fonksiyonların BELLEKTEKİ kaynak metinleri.
 * `Function.prototype.toString()` diskten değil, derlenmiş script'ten gelir — yani
 * gerçekten bellekte olan kodu verir. Yerleşik/bağlanmış fonksiyonlar ("[native code]")
 * kıyasa girmez.
 */
function bellekKaynaklari(mutlakYol, cache) {
  const kaynaklar = [];
  try {
    const kayit = cache[mutlakYol];
    const disaVurum = kayit && kayit.exports;
    if (!disaVurum || (typeof disaVurum !== 'object' && typeof disaVurum !== 'function')) {
      return kaynaklar;
    }
    const adlar = typeof disaVurum === 'function' ? [] : Object.keys(disaVurum);
    const adaylar = typeof disaVurum === 'function' ? [disaVurum] : adlar.map((a) => disaVurum[a]);
    for (const aday of adaylar) {
      if (typeof aday !== 'function') continue;
      const metin = Function.prototype.toString.call(aday);
      if (typeof metin !== 'string' || metin.includes('[native code]')) continue;
      kaynaklar.push(metin);
    }
  } catch (hata) {
    return kaynaklar;
  }
  return kaynaklar;
}

/**
 * Kritik modüllerin bellek ↔ disk durumu.
 *
 * @returns {{moduller: Object, diskHash: Object, bayatMi: boolean, bayatSebepleri: string[]}}
 *   `moduller[yol]`: yüklüyse bellekteki sürümün parmak izi, YÜKLÜ DEĞİLSE `null`.
 *   `diskHash[yol]`: diskteki hâlin parmak izi, okunamazsa `null`.
 *   `bayatMi`: yüklü bir modülün belleği diskten FARKLIysa ya da kıyas yapılamıyorsa
 *   `true` (şüphede daima KIRMIZI — yanlış yeşil bu arızanın ta kendisiydi).
 */
function modulDurumu(secenekler = {}) {
  const liste = secenekler.liste || KRITIK_MODULLER;
  const kok = secenekler.kok || KOK;
  const oku = secenekler.oku || varsayilanOku;
  const cache = secenekler.cache || require.cache;
  const baslangic = secenekler.baslangic || BASLANGIC_IMZALARI;

  const moduller = {};
  const diskHash = {};
  // ÖLÇÜM sebepleri (kıyas YAPILAMADI) ile KIYAS sebepleri (bellek ≠ disk) bilerek
  // ayrı tutulur: ikisi tek listede toplanırsa `yesilSayilirMi` kararı ölü kod olur
  // (2026-09-21 mutasyon bulgusu — M4 mutantı 25/25 testten kaçmıştı).
  const olcumSebepleri = [];
  const bellekteki = {};
  const beklenen = {};

  // Yeniden dışa vurum (re-export) yanlış alarmını önlemek için TÜM izlenen
  // modüllerin disk metni önceden toplanır. Bir modül başka bir modülden fonksiyon
  // yeniden dışa veriyorsa (`set-kimligi.js` → `set-kabuk.js`), o fonksiyonun kaynağı
  // kendi dosyasında BULUNMAZ; bu bayatlık DEĞİLDİR. 2026-09-21: bekçi tam bu yüzden
  // hash'ler birebir aynıyken "bayat" diyordu — sürekli kırmızı bekçi, bekçi değildir.
  const tumDiskMetinleri = {};
  for (const rel of liste) {
    tumDiskMetinleri[rel] = dosyaIcerigi(path.join(kok, rel), oku);
  }

  for (const rel of liste) {
    const mutlak = path.join(kok, rel);
    const yuklu = yuklenmisMi(mutlak, cache);
    const diskMetni = tumDiskMetinleri[rel];

    diskHash[rel] = parmakIzi(diskMetni);
    moduller[rel] = yuklu ? (Object.prototype.hasOwnProperty.call(baslangic, rel) ? baslangic[rel] : null) : null;

    if (!yuklu) continue;

    if (moduller[rel] === null) {
      // Yüklü ama başlangıç parmak izi ölçülemedi → kıyas YAPILAMAZ, yeşil sayılmaz.
      olcumSebepleri.push(`${rel}: yüklü ama bellek parmak izi ölçülemedi`);
      continue;
    }
    if (diskHash[rel] === null) {
      olcumSebepleri.push(`${rel}: yüklü ama disk okunamadı`);
      continue;
    }

    bellekteki[rel] = moduller[rel];
    beklenen[rel] = diskHash[rel];

    // İkinci, bağımsız bayatlık kanıtı: bellekteki fonksiyon kaynağı diskteki metinde
    // HİÇ geçmiyorsa modül kesinlikle eski koddur (başlangıçtan SONRA tembel yüklenmiş
    // modüller parmak izi kıyasından kaçabilir, bu kontrol onları da yakalar).
    for (const kaynak of bellekKaynaklari(mutlak, cache)) {
      if (diskMetni.includes(kaynak)) continue;
      // Kendi dosyasında yok — başka bir İZLENEN modülde var mı? Varsa bu bir
      // yeniden dışa vurumdur, bayatlık değil. Hiçbirinde yoksa modül kesinlikle
      // eski koddur (asıl yakalamak istediğimiz durum bu).
      let baskaModuldeVar = false;
      for (const digerRel of liste) {
        if (digerRel === rel) continue;
        const digerMetin = tumDiskMetinleri[digerRel];
        if (typeof digerMetin === 'string' && digerMetin.includes(kaynak)) {
          baskaModuldeVar = true;
          break;
        }
      }
      if (baskaModuldeVar) continue;
      olcumSebepleri.push(`${rel}: bellekteki fonksiyon kaynağı diskte yok`);
      break;
    }
  }

  // Kıyas ve "şüphede false" garantisi saglik-kimligi.js'in işi — burada yeniden yazılmaz.
  const uyusuyor = yesilSayilirMi(bellekteki, beklenen);
  const kiyasSebepleri = kimlikUyusuyorMu(bellekteki, beklenen).sebepler
    .map((sebep) => `${sebep} (bellek ≠ disk — require-cache bayat)`);

  return {
    moduller,
    diskHash,
    bayatMi: uyusuyor !== true || olcumSebepleri.length > 0,
    bayatSebepleri: [...olcumSebepleri, ...kiyasSebepleri],
  };
}

/**
 * `/api/health` gövdesine eklenecek kimlik alanları. HİÇBİR koşulda fırlatmaz;
 * ölçülemeyen alan SİLİNMEZ, açıkça `null` döner (alanın yokluğu "sorun yok" diye
 * okunur, oysa ölçülememek bir sorundur).
 */
function surecKimligi(secenekler = {}) {
  const proc = secenekler.proc || process;
  try {
    const pid = Number.isInteger(proc.pid) ? proc.pid : null;
    const ppid = Number.isInteger(proc.ppid) ? proc.ppid : null;
    // PPID=1 → süreci başlatan kabuk ölmüş, süreç init'e evlatlık verilmiş: launchd
    // servisi DEĞİL, elle başlatılmış kaçak kopya olma ihtimali yüksek.
    // Ölçülemiyorsa `null` — "yetim değil" diye YEŞİL SAYMA.
    const yetimMi = ppid === null ? null : ppid === 1;
    const durum = modulDurumu(secenekler);
    return {
      pid,
      ppid,
      yetimMi,
      moduller: durum.moduller,
      diskHash: durum.diskHash,
      bayatMi: durum.bayatMi,
      bayatSebepleri: durum.bayatSebepleri,
    };
  } catch (hata) {
    return {
      pid: null,
      ppid: null,
      yetimMi: null,
      moduller: null,
      diskHash: null,
      bayatMi: true,
      bayatSebepleri: ['kimlik ölçülemedi'],
    };
  }
}

module.exports = {
  KRITIK_MODULLER,
  parmakIzi,
  anlikGoruntu,
  yuklenmisMi,
  bellekKaynaklari,
  modulDurumu,
  surecKimligi,
};

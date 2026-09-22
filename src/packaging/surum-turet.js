'use strict';

/**
 * SÜRÜM TÜRETME (2026-09-22, Nadir onayı — ölçülen arıza)
 *
 * Ölçülen arıza: `.sm4-k24..k32-uret.js` + `.sm4-tumkarar-uret.js` üretim
 * tetikleyicileri `appVersion` alanını HER ZAMAN sabit `'1.0.0'` gönderiyordu
 * (`/api/upload-build` form alanı + `/api/package` gövdesi). Bu değer
 * `packagingService.js`'te `startPackaging` → `prepareElectronFiles` üzerinden
 * paketin kendi `package.json.version`'ına yazılıyor; electron-builder onu NSIS
 * `${VERSION}` / kurulum sonrası registry `DisplayVersion` olarak kaydediyor.
 * `customInit` makrosu (packagingService.js ~5191) "zaten kurulu VE
 * DisplayVersion == ${VERSION}" olduğunda kurulumu hiç başlatmadan eski exe'yi
 * `Exec` edip `Quit` ediyor. Sonuç: FARKLI İÇERİKLİ her yeni paket aynı 1.0.0
 * damgasını taşıdığı için eski (bazen aylar önceki) kurulumun arkasına
 * gizleniyordu — Nadir "sorunsuz açıldı" dedi ama gerçekte yeni paket hiç
 * kurulmadı, ekranda görünen eski `app.asar`'dı.
 *
 * TASARIM — tek üretim kapısı: sürüm çağırandan elle alınmaz, PAKETİN
 * İÇERİĞİNDEN türetilir.
 *   - Çağıran açık, dolu ve `'1.0.0'` DIŞINDA bir değer verdiyse dokunulmaz
 *     (kasıtlı sürümleme saygı görür — `acikSurumMu`).
 *   - Boş / eksik / `'1.0.0'` ise, `workingPath` ağacının içerik parmak
 *     izinden (dosya yolu + boyut, sıralı, sha256) türetilen numerik bir
 *     sürüm üretilir.
 *
 * NEDEN ZAMAN DAMGASI DEĞİL İÇERİK-HASH: `customInit`'in var oluş nedeni
 * kasıtlı bir davranış — "aynı sürüm kuruluysa SORU SORULMADAN doğrudan aç,
 * farklıysa güncelle" (packagingService.js ~5185, Nadir: "öğretmenler o kadar
 * acemi ki her seferinde kurulum dosyasına tekrar tıklayıp açmaya çalışanlar
 * çok fazla"). Üretim anına dayalı bir sürüm (`1.<YYMMDD>.<HHmm>`) AYNI paketi
 * ikinci kez üretince de her seferinde YENİ bir sürüm üretirdi — bu da her
 * çalıştırmada gereksiz ~90 sn'lik yeniden kurulumu ZORUNLU kılar, davranışı
 * düzeltmez başka yöne kırardı. İçerik-hash "aynı içerik → aynı sürüm, farklı
 * içerik → farklı sürüm" ürettiği için `customInit`'in tasarım amacını korur
 * VE bugünkü arızayı (sabit sürüm) çözer.
 *
 * KAPSAM: `startPackaging` içinde TEK noktadan çağrılır (workingPath ilk
 * doldurulduğunda), sonuç `appVersion` olarak windows/macos/linux/android/pwa
 * platformlarının HEPSİNE aynı şekilde geçer — platforma özel dal YOKTUR.
 *
 * PAKETLEYİCİ KİMLİĞİ (2026-09-22, Şef düzeltmesi — üçüncü kardeş arıza):
 * yalnız `workingPath` (girdi zip'inin içeriği) parmak izlenirse AYNI zip,
 * DEĞİŞMİŞ paketleyici koduyla (yeni bir yama, K27b gibi, ya da bir kapı
 * bayrağının ortam değişkeniyle açılıp kapanması) yine AYNI sürümü üretir —
 * customInit yeni paketi de atlar. Bu yüzden parmak izine paketleyicinin
 * KENDİ KİMLİĞİ de eklenir:
 *   (a) `src/packaging/**\/*.js`, `src/runtime/**\/*.js`, `src/platforms/**\/*.js`
 *       (test dosyaları HARİÇ) — DİSKTEKİ içerik sha256'sı, git commit'e değil
 *       (commit'lenmemiş değişiklikleri de yakalar — bu depo git deposu değil).
 *   (b) `src/server/saglik-kimligi.js`'in `kapilariOku(env)` çıktısı
 *       (`JSON.stringify` ile) — üretim davranışını değiştiren kapı
 *       bayraklarının (EMPP_SAYFA_WEBP, EMPP_SET_MENU, …) o andaki durumu.
 * `turet()`'in ÇAĞRILDIĞI YER (packagingService.js, yama adımlarından ÖNCE)
 * DEĞİŞMEDİ — bu iki girdi yama SIRASINDAN bağımsız, diskteki/ortamdaki halin
 * doğrudan okunuşu olduğu için hangi anda çağrılırsa çağrılsın aynı sonucu verir.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { kapilariOku } = require('../server/saglik-kimligi');

// surum-turet.js -> src/packaging/ -> src/ -> proje kökü
const PROJE_KOKU = path.resolve(__dirname, '..', '..');
const PAKETLEYICI_KOK_DIZINLERI = ['packaging', 'runtime', 'platforms'];

const VARSAYILAN_DAMGA = '1.0.0';

/** Çağıranın gerçekten kasıtlı bir sürüm verip vermediğini söyler. Boş, null,
 * undefined veya tam olarak '1.0.0' ise "kasıtlı değil" sayılır — bu üç durum
 * da bugün codebase'de "sürüm verilmedi" ile ayırt edilemeyen tek bir varsayılan
 * değere karşılık geliyor (bkz. src/server/app.js:396 `appVersion || '1.0.0'`). */
function acikSurumMu(appVersion) {
  if (appVersion === null || appVersion === undefined) return false;
  const s = String(appVersion).trim();
  if (s === '' || s === VARSAYILAN_DAMGA) return false;
  return true;
}

// EŞİK (2026-09-22, Şef düzeltmesi — Nadir onayı): yalnız yol+boyut bir DELİK
// bırakıyordu — aynı boyutlu bir düzenleme (version.txt "1.13.8"→"1.13.9",
// index.html'de tek karakter, bir bundle yamasının eşit uzunlukta değiştirdiği
// bayt) parmak izini DEĞİŞTİRMİYORDU; bu da bugünkü arızanın kardeşiydi —
// içerik değişse de "aynı sürüm" üretilip customInit kurulumu yine atlardı.
// Kabuk/bundle/config dosyaları (index.html, *.js, *.json, version.txt, empp-*)
// hep bu sınıfta ve KÜÇÜKTÜR — bunlar İÇERİK sha256'sı ile hashlenir. Büyük
// medya/pdf/zip dosyaları (sayfa görselleri, video, exe/apk gömülü kaynaklar)
// SAYICA az ama BAYTCA çoktur — bunlarda hâlâ yalnız yol+boyut kullanılır (I/O
// maliyeti kabul edilemez olurdu). mtime KASITLI OLARAK yok — deterministik
// değil (kopyalama/extract her seferinde farklı mtime üretebilir).
const ICERIK_ESIK_BAYT = 4 * 1024 * 1024; // 4 MB

/** Bir dosyanın parmak izi imzası: eşik altındaysa İÇERİK sha256'sı, üstündeyse
 * yalnız boyut (I/O'yu büyük dosyalarda okumadan sınırlar). */
function dosyaImzasi(tamYol, boyut) {
  if (boyut >= 0 && boyut <= ICERIK_ESIK_BAYT) {
    try {
      const icerik = fs.readFileSync(tamYol);
      return `h:${crypto.createHash('sha256').update(icerik).digest('hex')}`;
    } catch {
      return `okunamadi:${boyut}`;
    }
  }
  return `boyut:${boyut}`;
}

/**
 * `workingPath` altındaki tüm dosyaların (relatif yol + imza) sıralı
 * listesinden deterministik bir sha256 üretir. ≤4 MB dosyalarda imza İÇERİK
 * hash'idir (tek bayt değişse bile parmak izi değişir); daha büyük dosyalarda
 * imza yalnız boyuttur (paketleme akışında zaten aynı sınıf maliyette dizin
 * taramaları var: bkz. `saveFileHashes`). mtime hiçbir zaman kullanılmaz.
 */
function icerikParmakIzi(workingPath) {
  const satirlar = [];

  function gez(dizin) {
    let girdiler;
    try {
      girdiler = fs.readdirSync(dizin, { withFileTypes: true });
    } catch {
      return;
    }
    girdiler.sort((a, b) => a.name.localeCompare(b.name));
    for (const girdi of girdiler) {
      const tamYol = path.join(dizin, girdi.name);
      if (girdi.isDirectory()) {
        gez(tamYol);
      } else if (girdi.isFile()) {
        let boyut = -1;
        try {
          boyut = fs.statSync(tamYol).size;
        } catch {
          boyut = -1;
        }
        satirlar.push(`${path.relative(workingPath, tamYol)}:${dosyaImzasi(tamYol, boyut)}`);
      }
    }
  }

  gez(workingPath);
  return crypto.createHash('sha256').update(satirlar.join('\n')).digest('hex');
}

/** Hex özetten semver-geçerli (negatif olmayan, taşma yapmayan) iki sayısal
 * parça türetir. */
function hextenSayisalCift(hex) {
  const a = parseInt(hex.slice(0, 8), 16) % 100000;
  const b = parseInt(hex.slice(8, 16), 16) % 100000;
  return [a, b];
}

/** `dizin` altındaki `.js` dosyalarını (test dosyaları HARİÇ) sıralı olarak
 * bulur. `dizin` yoksa (örn. `src/runtime` bu depoda mevcut değilse) sessizce
 * boş liste döner — eksik dizin bir hata DEĞİL, kapsam dışıdır. */
function jsDosyalariniTara(dizin) {
  const sonuc = [];
  function gez(d) {
    let girdiler;
    try {
      girdiler = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    girdiler.sort((a, b) => a.name.localeCompare(b.name));
    for (const girdi of girdiler) {
      const tamYol = path.join(d, girdi.name);
      if (girdi.isDirectory()) {
        gez(tamYol);
      } else if (girdi.isFile() && girdi.name.endsWith('.js') && !girdi.name.endsWith('.test.js')) {
        sonuc.push(tamYol);
      }
    }
  }
  gez(dizin);
  return sonuc;
}

/**
 * Paketleyicinin KENDİ kaynak kodunun parmak izi: `src/packaging`,
 * `src/runtime`, `src/platforms` altındaki tüm `.js` dosyalarının (test
 * dosyaları hariç) İÇERİK sha256'sı, dosya yoluna göre sıralı birleştirilir.
 * Diskten okunur — git commit'e DEĞİL (bu depo git deposu değil; commit'lenmemiş
 * bir değişiklik de üretim davranışını değiştirir ve burada yakalanmalı).
 */
function paketleyiciKaynakParmakIzi() {
  const satirlar = [];
  for (const altDizin of PAKETLEYICI_KOK_DIZINLERI) {
    const kok = path.join(PROJE_KOKU, 'src', altDizin);
    for (const tamYol of jsDosyalariniTara(kok)) {
      let icerik;
      try {
        icerik = fs.readFileSync(tamYol);
      } catch {
        continue;
      }
      const rel = path.relative(PROJE_KOKU, tamYol);
      satirlar.push(`${rel}:${crypto.createHash('sha256').update(icerik).digest('hex')}`);
    }
  }
  satirlar.sort();
  return crypto.createHash('sha256').update(satirlar.join('\n')).digest('hex');
}

/**
 * Üretim davranışını değiştiren kapı bayraklarının (EMPP_SAYFA_WEBP,
 * EMPP_SET_MENU, …) parmak izi — `src/server/saglik-kimligi.js`'in BİREBİR
 * kaynağı (`kapilariOku`) üzerinden, kopya mantık YOK. Saf/I/O'suz bir
 * modül olduğu için çağrısı güvenlidir; yine de şüphede boş nesneye düşer.
 */
function kapilarParmakIzi(env) {
  let kapilar = {};
  try {
    kapilar = kapilariOku(env) || {};
  } catch {
    kapilar = {};
  }
  return crypto.createHash('sha256').update(JSON.stringify(kapilar)).digest('hex');
}

/**
 * Nihai paket sürümünü türetir.
 * @param {string|number|null|undefined} appVersion - çağıranın verdiği (varsa) sürüm.
 * @param {string} workingPath - içerik parmak izinin çıkarılacağı ağaç kökü.
 * @param {NodeJS.ProcessEnv|Object} [env] - kapı bayraklarının okunacağı ortam
 *   (varsayılan `process.env`) — çağrı imzası geriye dönük uyumlu, bu parametre
 *   opsiyoneldir.
 * @returns {{ surum: string, kaynak: 'acik'|'icerik-hash', parmakIzi?: string }}
 */
function turet(appVersion, workingPath, env = process.env) {
  if (acikSurumMu(appVersion)) {
    return { surum: String(appVersion).trim(), kaynak: 'acik' };
  }
  const icerikHex = icerikParmakIzi(workingPath);
  const kaynakHex = paketleyiciKaynakParmakIzi();
  const kapiHex = kapilarParmakIzi(env);
  const birlesikHex = crypto.createHash('sha256')
    .update(icerikHex).update(kaynakHex).update(kapiHex)
    .digest('hex');
  const [minor, patch] = hextenSayisalCift(birlesikHex);
  return { surum: `1.${minor}.${patch}`, kaynak: 'icerik-hash', parmakIzi: birlesikHex.slice(0, 16) };
}

module.exports = {
  turet, acikSurumMu, icerikParmakIzi, paketleyiciKaynakParmakIzi, kapilarParmakIzi,
  VARSAYILAN_DAMGA, ICERIK_ESIK_BAYT,
};

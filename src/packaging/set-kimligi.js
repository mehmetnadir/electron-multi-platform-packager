'use strict';

/**
 * SET KİMLİĞİ VE KABUK ENVANTERİ (`empp-set.json`) — paketleme anında yazılır.
 *
 * SÖZLEŞME: `.claude/docs/kitap-guncelleme-sozlesmesi.md` (2026-09-21 sürümü).
 * Bu modül o belgenin "Kimlik: SET'in kimliği" + "Paket içine yazılanlar"
 * bölümlerinin KODDAKİ karşılığıdır.
 *
 * NEDEN SET DÜZEYİ (Nadir, 2026-09-21): "O kitaplar kendi uçlarına bakarak zaten
 * güncellemelerini alıyorlar. Yani içindeki kitaplar değil önemli olan. kitap derken
 * ben set'i kastettim." Yani güncellenecek olan setin KABUĞU (uygulamanın açılması
 * için gereken her şey — tanım: `./set-kabuk.js`) ve ÜYELİĞİ'dir (hangi kitaplar var). Kitapların
 * sayfa/ses/test içeriği bu kanalın KAPSAMI DIŞIDIR — onlara DOKUNULMAZ.
 * İlk tasarımdaki kitap-başına kimlik (assets/<sayısal>'dan türetme) İPTAL.
 *
 * KİMLİK (sözleşme §Kimlik — tek kaynak):
 *   1. Paketleme isteğindeki `setKimligi` — OTORİTE budur.
 *   2. Yoksa → KANAL KAPALI. Paket adından/kurumdan TÜRETİLMEZ, tahmin yasaktır.
 *
 * GÖRÜNÜRLÜK KURALI: kimlik yoksa `empp-set.json` YİNE yazılır —
 * `"setKimligi": null` + `"sebep"` ile. Dosyayı hiç yazmamak "bu paket neden
 * güncellenmiyor?" sorusunu ölçülemez hâle getirirdi
 * (memory: `tablo-esleme-sessiz-varsayilan`, `olu-sorgu-json-not-tuzagi`).
 *
 * YOL GÜVENLİĞİ: kimlik bir URL yoluna (`<taban>/set/<setKimligi>/…`) giriyor;
 * ayraç, boşluk, `..` taşıyan değer kabul edilmez. Kitap dizini üyelik listesine
 * yalnız `^book\d+$` deseniyle girer.
 *
 * KABUK TANIMI 2026-09-21'de DÜZELTİLDİ (ölçümle): önceki tanım `index.html` +
 * `set_app.config` + `assets2/**` idi ve gerçek bir SET ağacında `index.html`in
 * yüklediği 12 varlığın SIFIRINI kapsıyordu (460 kabuk dosyasının 54'ü). Yeni tanım
 * `./set-kabuk.js`'te TEK kaynaktır; gerekçesi ve iki adayın ölçümleri orada.
 *
 * SAF / I/O AYRIMI: `setKimligiCoz`, `tabanCoz`, `kabukDosyalariTopla`,
 * `kitapDizinleriTopla`, `haritaUret` SAF fonksiyonlardır (dosya sistemine
 * dokunmazlar). Dosyaya yazan tek yer `paketeYaz`.
 */

const path = require('path');
const crypto = require('crypto');
const fs = require('fs-extra');
const kabuk = require('./set-kabuk');
const { kapiAcikMi } = require('./platform-kapisi');

const DOSYA_ADI = 'empp-set.json';
const SEMA_SURUMU = 2;   // 2: kabuk tanımı `set-kabuk.js`'e taşındı + kapsamDisiDallar

/**
 * Gömülü uç nokta tabanı — TEK YER. Panel ucu henüz yazılmadığı için varsayılan
 * bilerek ÇÖZÜLEMEYEN bir adrestir (RFC 2606 `.invalid`): kanal açık olsa bile
 * hiçbir paket yanlışlıkla üçüncü bir hosta trafik atmaz; sözleşme §"Çalışma anı 2"
 * gereği güncelleme sessizce atlanır. Panel ucu belirlenince BURASI değişir (ya da
 * `EMPP_GUNCELLEME_TABANI` / istekteki `guncellemeTabani` verilir).
 * SIR DEĞİLDİR ve sır KONULMAZ: bu bir URL; anahtar/parola buraya gömülmez.
 */
const VARSAYILAN_TABAN = 'https://panel-yok.invalid/set-guncelleme';

/**
 * KABUK TANIMI BURADA YAŞAMAZ — `./set-kabuk.js` TEK KAYNAKTIR.
 * Aynı tanımın ikinci bir kopyası `scripts/windows-paket-kapisi.js` içindeydi;
 * kapı üreticinin hatasını göremiyordu (ölçüldü 2026-09-21: eski tanım gerçek
 * SET ağacında `index.html`in yüklediği 12 varlığın 0'ını kapsıyordu).
 * Ayrışma olursa `set-kabuk.test.js` SÖZLEŞME testi düşer.
 */
const { KITAP_DIZIN_DESENI } = kabuk;

/** Kimlik deseni: tek URL yol parçası — ayraç, boşluk, `..` yok. */
const KIMLIK_DESENI = /^[A-Za-z0-9._:-]{1,64}$/;

/**
 * Kanal kapısı: varsayılan AÇIK (sözleşme §Kapılar); `0` kapatır, `1` her platformda açar.
 * Platform listesi (`windows`, `windows,macos`) yalnız işin platformlarının HEPSİ listedeyse
 * açar. Karar `./guncelleyici-enjekte.js` ile AYNI kaynaktan (`./platform-kapisi.js`) —
 * `empp-set.json` ile güncelleyici enjeksiyonu aynı işte ayrışamaz (2026-09-26).
 * @param {Object} [env]
 * @param {string[]} [platforms] işin platformları (`jobInfo.platforms`)
 * @param {{uyar?: function(string): void}} [secenek]
 */
function acikMi(env = process.env, platforms, secenek) {
  return kapiAcikMi('EMPP_SET_GUNCELLEME', env, platforms, true, secenek);
}

/** Kimlik değeri yol-güvenli mi? (boş olmayan string + tek yol parçası) */
function kimlikGecerliMi(deger) {
  if (typeof deger !== 'string') return false;
  const d = deger.trim();
  if (!d || d === '.' || d === '..') return false;
  return KIMLIK_DESENI.test(d);
}

/**
 * SET kimliğini çözer. SAF fonksiyon. Tek kaynak: paketleme isteği.
 * @param {*} acikKimlik istekteki `setKimligi` alanı (ham — her tip gelebilir)
 * @returns {{setKimligi: string|null, kaynak: 'acik'|'yok', sebep: string|null}}
 */
function setKimligiCoz(acikKimlik) {
  if (acikKimlik === undefined || acikKimlik === null) {
    return {
      setKimligi: null,
      kaynak: 'yok',
      sebep: 'paketleme isteğinde setKimligi verilmedi — set güncelleme kanalı kapalı '
        + '(kimlik tahmin edilmez)',
    };
  }
  if (kimlikGecerliMi(acikKimlik)) {
    return { setKimligi: String(acikKimlik).trim(), kaynak: 'acik', sebep: null };
  }
  return {
    setKimligi: null,
    kaynak: 'yok',
    sebep: `paketleme isteğindeki setKimligi geçersiz (${JSON.stringify(acikKimlik)}) — `
      + 'yok sayıldı, kanal kapalı',
  };
}

/**
 * Taban çözümü. Öncelik: istek > env > gömülü varsayılan.
 * GEREKÇE: istekteki `guncellemeTabani` panelin O PAKET için verdiği değerdir
 * (en özgül); `EMPP_GUNCELLEME_TABANI` paketleyici makinesinin genel ayarıdır.
 * Kaynağı da döner — "taban nereden geldi?" sorusu ölçülebilsin.
 */
function tabanCoz(env = process.env, acikTaban = null) {
  const istek = typeof acikTaban === 'string' ? acikTaban.trim() : '';
  if (istek) return { taban: istek.replace(/\/+$/, ''), kaynak: 'istek' };
  const ortam = env && typeof env.EMPP_GUNCELLEME_TABANI === 'string'
    ? env.EMPP_GUNCELLEME_TABANI.trim() : '';
  if (ortam) return { taban: ortam.replace(/\/+$/, ''), kaynak: 'env' };
  return { taban: VARSAYILAN_TABAN, kaynak: 'varsayilan' };
}

/** Yolu POSIX ayraçlı, baştaki `./` temizlenmiş hâle getirir. (tek kaynak: set-kabuk) */
const yolNormalle = kabuk.yolNormalle;

/**
 * Kök-göreli dosya yolu listesinden KABUK dosyalarını süzer. SAF fonksiyon.
 * Tanım `./set-kabuk.js`'tedir — burada KOPYASI YOK, doğrudan çağrı.
 */
const kabukDosyalariTopla = kabuk.kabukDosyalariSuz;

/**
 * Dizin adı listesinden ÜYELİK listesini süzer. SAF fonksiyon.
 * İÇERİĞE BAKILMAZ: `book6` içinde tek bir PDF olsa da üyedir — set kanalının
 * ölçtüğü şey "bu pakette hangi kitaplar var", kitabın içi değil.
 * Sıralama sayısaldır (book2 < book10; sözlük sırası book10'u book2'nin önüne atardı).
 */
function kitapDizinleriTopla(dizinAdlari) {
  const sonuc = (Array.isArray(dizinAdlari) ? dizinAdlari : [])
    .filter((d) => typeof d === 'string' && KITAP_DIZIN_DESENI.test(d));
  return [...new Set(sonuc)].sort(
    (a, b) => Number(a.slice(4)) - Number(b.slice(4)) || (a < b ? -1 : 1),
  );
}

/** Damgayı ISO 8601'e çevirir — sayı (ms), Date ya da hazır string kabul eder. */
function damgaCoz(damga) {
  if (damga == null) return new Date().toISOString();
  if (typeof damga === 'number') return new Date(damga).toISOString();
  if (damga instanceof Date) return damga.toISOString();
  return String(damga);
}

/**
 * MANİFEST İMZA ANAHTARI (sözleşme G4, 2026-09-26). Güncelleyici (`kitap-guncelleyici.js`)
 * imzasız manifesti REDDEDER; doğrulayacağı ed25519 AÇIK anahtarı pakete buradan gömülür.
 * Kaynak sırası: paketleme isteği (`imzaAcikAnahtari`) → `EMPP_GUNCELLEME_ACIK_ANAHTAR` env.
 * Değer SPKI DER base64'tür; ed25519 değilse/bozuksa GÖMÜLMEZ ve sebep yazılır (kanal kapalı).
 * Açık anahtar sır DEĞİLDİR; özel anahtar pakete ASLA girmez.
 * @returns {{imza: {alg:string, acikAnahtar:string, kaynak:string}|null, sebep: string|null}}
 */
function imzaAnahtariCoz(acik, env = process.env) {
  const aday = [[acik, 'istek'], [env && env.EMPP_GUNCELLEME_ACIK_ANAHTAR, 'env']]
    .find(([d]) => typeof d === 'string' && d.trim());
  if (!aday) return { imza: null, sebep: 'manifest imza anahtarı yok — güncelleme kanalı kapalı (G4)' };
  const deger = aday[0].trim();
  try {
    const k = crypto.createPublicKey({ key: Buffer.from(deger, 'base64'), format: 'der', type: 'spki' });
    if (k.asymmetricKeyType !== 'ed25519') throw new Error(`tür ${k.asymmetricKeyType}`);
  } catch (e) {
    return { imza: null, sebep: `manifest imza anahtarı geçersiz (${aday[1]}: ${e.message}) — gömülmedi` };
  }
  return { imza: { alg: 'ed25519', acikAnahtar: deger, kaynak: aday[1] }, sebep: null };
}

/**
 * `empp-set.json` gövdesini kurar. SAF fonksiyon (dosyaya yazmaz).
 * @param {{setKimligi?:*, taban?:string|{taban:string,kaynak?:string}, damga?:*,
 *          kabukDosyalari?:string[], kitapDizinleri?:string[]}} g
 */
function haritaUret(g = {}) {
  const cozum = setKimligiCoz(g.setKimligi);
  const t = typeof g.taban === 'object' && g.taban !== null
    ? { deger: String(g.taban.taban || ''), kaynak: g.taban.kaynak || 'verildi' }
    : { deger: String(g.taban || ''), kaynak: 'verildi' };

  const kabukListesi = kabukDosyalariTopla(g.kabukDosyalari);
  const kitaplar = kitapDizinleriTopla(g.kitapDizinleri);
  // Kabuk tanımının kapsamadığı kök dizinler — SESSİZ değil, YAZILI kör nokta.
  const kapsamDisi = [...new Set((Array.isArray(g.kapsamDisiDallar) ? g.kapsamDisiDallar : [])
    .filter((d) => typeof d === 'string' && d))].sort();
  // Dışarıdan gelen ek sebep (örn. API katmanının attığı geçersiz taban notu)
  // kimlik sebebiyle BİRLEŞTİRİLİR — biri diğerini ezmez.
  const imzaCozum = imzaAnahtariCoz(g.imzaAcikAnahtari, g.env || {});
  const surumCozum = surumCoz(g.surum);
  const sebepler = [cozum.sebep, g.sebep, surumCozum.sebep].filter((s) => typeof s === 'string' && s);

  return {
    sema: SEMA_SURUMU,
    setKimligi: cozum.setKimligi,
    setKimligiKaynagi: cozum.kaynak,
    sebep: sebepler.length ? sebepler.join('; ') : null,
    taban: t.deger,
    tabanKaynagi: t.kaynak,
    damga: damgaCoz(g.damga),
    kabukTanimi: kabuk.IMZA,
    kabukDosyaSayisi: kabukListesi.length,
    kabukDosyalari: kabukListesi,
    kapsamDisiDallar: kapsamDisi,
    kitapSayisi: kitaplar.length,
    kitapDizinleri: kitaplar,
    imza: imzaCozum.imza,
    imzaSebebi: imzaCozum.sebep,
    surum: surumCozum.surum,
  };
}

/**
 * Paketin G sürümü (claim `surum`, G3 `2.<panel>.<sayaç>`; 2026-09-26). İstemci bunu monoton
 * kıyasın TABANINA katar: pakette zaten bulunan sürümün (ya da eskisinin) imzalı manifesti
 * yeniden oynatılamaz. Yoksa `null`; G3 değilse düşürülür + sebep (sessiz değil).
 * @returns {{surum: string|null, sebep: string|null}}
 */
function surumCoz(ham) {
  if (ham == null || String(ham).trim() === '') return { surum: null, sebep: null };
  const v = String(ham).trim();
  if (!require('../runtime/kitap-guncelleyici').gSurumCoz(v)) {
    return { surum: null, sebep: `istekteki surum G3 değil (${JSON.stringify(v).slice(0, 40)}) — yok sayıldı` };
  }
  return { surum: v, sebep: null };
}

/**
 * Paket kökündeki KABUK dosyalarını bulur (I/O).
 *
 * Taranan: kök DOSYALARI + beyaz listedeki alt ağaçlar (`assets2/`, `core/`, `i18n/`).
 * Kitap dizinlerine HİÇ İNİLMEZ — hem kapsam hem performans (ölçülen SM4 Set'te
 * kitaplar 11.034 dosya; kabuk 459. Tam ağaç taraması paketlemeye dakikalar eklerdi).
 * SEMBOLİK BAĞ İZLENMEZ: bağ, ağaç dışına çıkan bir kabuk girdisi üretebilirdi.
 */
async function kabukDosyalariBul(paketKoku) {
  const liste = [];
  let kokGirisleri;
  try { kokGirisleri = await fs.readdir(paketKoku, { withFileTypes: true }); }
  catch { return []; }                    // okunamayan kök paketlemeyi durdurmaz

  for (const g of kokGirisleri) {
    if (g.isSymbolicLink() || !g.isFile()) continue;
    if (kabuk.kabukYoluMu(g.name)) liste.push(g.name);
  }

  async function in_(mutlak, goreli) {
    let girisler;
    try { girisler = await fs.readdir(mutlak, { withFileTypes: true }); }
    catch { return; }                     // okunamayan dizin paketlemeyi durdurmaz
    for (const g of girisler) {
      if (g.isSymbolicLink()) continue;
      const alt = `${goreli}/${g.name}`;
      if (g.isDirectory()) await in_(path.join(mutlak, g.name), alt);
      else if (g.isFile() && kabuk.kabukYoluMu(alt)) liste.push(alt);
    }
  }

  for (const dizin of kabuk.KABUK_DIZINLERI) {
    const giris = kokGirisleri.find((g) => g.name === dizin);
    if (!giris || giris.isSymbolicLink() || !giris.isDirectory()) continue;
    await in_(path.join(paketKoku, dizin), dizin);
  }

  return liste.sort();
}

/**
 * Kabuk tanımının KAPSAMADIĞI kök dizinleri (I/O). Ne kabuk, ne kitap, ne bilinen
 * artefakt olan her kök dizini buraya düşer.
 * NEDEN: beyaz listenin kör noktası budur. Yayıncı yarın `fonts/` eklerse kabuk
 * onu kaçırır; sessizce kaçırmasın diye pakete YAZILIR ve kapı FAIL eder.
 */
async function kapsamDisiDallariBul(paketKoku) {
  let girisler;
  try { girisler = await fs.readdir(paketKoku, { withFileTypes: true }); }
  catch { return []; }
  const dizinler = girisler.filter((g) => g.isDirectory() && !g.isSymbolicLink())
    .map((g) => g.name);
  return kabuk.dallariSinifla(dizinler).bilinmeyen;
}

/** Paket kökündeki `^book\d+$` dizinlerini bulur (I/O). İçeriğe BAKILMAZ. */
async function kitapDizinleriBul(paketKoku) {
  let girisler;
  try { girisler = await fs.readdir(paketKoku, { withFileTypes: true }); }
  catch { return []; }
  return kitapDizinleriTopla(girisler.filter((g) => g.isDirectory()).map((g) => g.name));
}

/**
 * Paket ağacını tarar, `empp-set.json` yazar.
 * Kimlik yoksa da YAZILIR (görünürlük kuralı).
 * @returns {{yazildi:boolean, sebep:string, harita:object}}
 */
async function paketeYaz(paketKoku, secenekler = {}) {
  const {
    log = () => {}, setKimligi, guncellemeTabani = null, env = process.env, damga, sebep,
    imzaAcikAnahtari = null, surum = null,
  } = secenekler;

  const kabukListesi = await kabukDosyalariBul(paketKoku);
  const kitaplar = await kitapDizinleriBul(paketKoku);
  const kapsamDisi = await kapsamDisiDallariBul(paketKoku);
  const harita = haritaUret({
    setKimligi,
    taban: tabanCoz(env, guncellemeTabani),
    damga,
    sebep,
    kabukDosyalari: kabukListesi,
    kitapDizinleri: kitaplar,
    kapsamDisiDallar: kapsamDisi,
    imzaAcikAnahtari,
    env,
    surum,
  });

  await fs.writeFile(
    path.join(paketKoku, DOSYA_ADI), `${JSON.stringify(harita, null, 2)}\n`, 'utf8',
  );
  log(`   set kimliği: ${harita.setKimligi || 'YOK'} (${harita.setKimligiKaynagi}), `
    + `${harita.kabukDosyaSayisi} kabuk dosyası, ${harita.kitapSayisi} kitap `
    + `(taban: ${harita.tabanKaynagi}, manifest imzası: ${harita.imza ? harita.imza.kaynak : 'YOK'})`
    + (harita.kapsamDisiDallar.length
      ? ` · ⚠️ KAPSAM DIŞI kök dizin: ${harita.kapsamDisiDallar.join(', ')}`
      : ''));
  return { yazildi: true, sebep: 'yazildi', harita };
}

module.exports = {
  DOSYA_ADI, SEMA_SURUMU, VARSAYILAN_TABAN,
  // KABUK TANIMI — tek kaynak `./set-kabuk.js`; buradan yalnız YENİDEN yayımlanır.
  KABUK: kabuk, KABUK_DIZINLERI: kabuk.KABUK_DIZINLERI, KABUK_IMZASI: kabuk.IMZA,
  KITAP_DIZIN_DESENI, KIMLIK_DESENI,
  acikMi, kimlikGecerliMi, setKimligiCoz, tabanCoz, yolNormalle,
  kabukDosyalariTopla, kitapDizinleriTopla, damgaCoz, haritaUret, imzaAnahtariCoz, surumCoz,
  kabukDosyalariBul, kapsamDisiDallariBul, kitapDizinleriBul, paketeYaz,
};

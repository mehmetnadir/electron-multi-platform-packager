'use strict';

/**
 * MOTOR SÜRÜM DAMGASI — paketlenen ağaçtaki `43e23fce2b7009474555a77.js`
 * (Impark etkinlik motoru) kopyalarının kanonikle kıyası.
 *
 * NEDEN (plan: `.claude/docs/tek-kabuk-ve-guncelleme-plani-2026-09-24.md` §Faz 3,
 * `player-guncelle` SKILL.md §1c): motor iki koldan gider — yayınevi sunucuları
 * (player-guncelle skill'in işi) ve BİZİM ürettiğimiz çevrimdışı paketler (bu
 * modülün işi). 2026-09-24 ölçümü: paketleyici bugün motora HİÇ dokunmuyor —
 * pakete giren motor = yayıncı kaynak exe'sindeki motor, ne kadar eski olursa
 * olsun. Bu modül önce "hangisi güncel" sorusuna dürüst bir cevap üretir
 * (KANONİK bilinmiyorsa `bilinmiyor` — asla sahte yeşil).
 *
 * KANONİK KAYNAK: srv21 `preview/build/<bundle>` bu Mac'ten erişilemeyebilir,
 * o yüzden kanonik burada YEREL bir önbellek dosyasından okunur:
 * `~/.empp-agent/motor/kanonik.json` → `{ sha12, boyut, mtime, not }`. Bu dosyayı
 * bu modül YAZMAZ (player-guncelle dağıtım akışının bir parçası, ayrı iş) —
 * yalnız OKUR; yoksa/bozuksa kıyas yapılmaz, `durum: 'bilinmiyor'`.
 *
 * SAF/I-O AYRIMI: `motorDamgasi` ve `kanonikOku` diskle konuşur (I/O). `rozet`
 * ve `paketJsonDamgasi` SAF fonksiyonlardır — girdi nesnesini MUTASYONA UĞRATMAZ.
 *
 * YAZAN TEK FONKSİYON: `motorDegistir` (Faz 3b, dosyanın sonunda) — eski kopyayı
 * kanonikle değiştirir + `paket.json.motorSurumu` yazar. Diğerleri salt okur.
 * `packagingService.js`'e bağlantı yama olarak: `scratchpad/faz3/packagingService-motor.patch`.
 */

const path = require('path');
const os = require('os');
const crypto = require('crypto');
const fs = require('fs-extra');

/** Motor dosyasının ADI — hiçbir koşulda değişmez (index.html referansı buna bağlı). */
const MOTOR_DOSYA_ADI = '43e23fce2b7009474555a77.js';

/** Motor taraması sırasında ASLA inilmeyen dizinler (performans + yanlış-pozitif önleme). */
const TARAMA_ATLA = new Set(['node_modules', '.git', '_graveyard']);

/**
 * Kanonik önbellek dosyasının varsayılan yolu. MAKİNE-YEREL (review #15): srv21 ile bu Mac'te
 * farklı dosya okunursa aynı paket iki makinede farklı rozet alır — üretim hattında
 * `EMPP_MOTOR_KANONIK` ile tek bir paylaşılan yola sabitlenmeli.
 */
const KANONIK_YOLU_VARSAYILAN = process.env.EMPP_MOTOR_KANONIK
  || path.join(os.homedir(), '.empp-agent', 'motor', 'kanonik.json');

/** Kapı: varsayılan AÇIK. Kapatmak için EMPP_MOTOR_SURUMU=0 (Şef entegrasyonu içindir;
 *  bu modül tek başına çağrılmadığı için üretimde henüz bir etkisi yoktur — PLAN). */
function acikMi(env = process.env) {
  return (env && env.EMPP_MOTOR_SURUMU) !== '0';
}

/**
 * `rootPath` içinde (kök dahil + her alt-kitapta) `MOTOR_DOSYA_ADI` adlı dosyaları
 * bulur. Kök-göreli, POSIX ayraçlı ('/') yol döner, sıralı.
 * @param {string} rootPath
 * @param {{maxDepth?: number}} [opts]
 * @returns {Promise<string[]>}
 */
async function motorDosyalariniBul(rootPath, opts = {}) {
  const maxDepth = opts.maxDepth != null ? opts.maxDepth : 8;
  const bulunanlar = [];

  async function walk(absDir, relDir, depth) {
    let girisler;
    try {
      girisler = await fs.readdir(absDir, { withFileTypes: true });
    } catch {
      return; // okunamayan dizin — sessizce atla (ölçüm durmasın)
    }
    for (const g of girisler) {
      const childRel = relDir ? `${relDir}/${g.name}` : g.name;
      if (g.isDirectory()) {
        if (TARAMA_ATLA.has(g.name)) continue;
        if (depth < maxDepth) await walk(path.join(absDir, g.name), childRel, depth + 1);
      } else if (g.isFile() && g.name === MOTOR_DOSYA_ADI) {
        bulunanlar.push(childRel);
      }
    }
  }

  await walk(rootPath, '', 0);
  bulunanlar.sort();
  return bulunanlar;
}

/** Tek dosyanın sha256 ilk-12 + boyut + mtime damgası. I/O — fırlatabilir. */
async function dosyaDamgasiHesapla(tamYol) {
  const [icerik, st] = await Promise.all([fs.readFile(tamYol), fs.stat(tamYol)]);
  return {
    sha12: crypto.createHash('sha256').update(icerik).digest('hex').slice(0, 12),
    boyut: st.size,
    mtime: st.mtime.toISOString(),
  };
}

/**
 * Kanonik önbelleği okur. Yoksa/bozuksa/şekli geçersizse `null` — ŞÜPHEDE DAİMA
 * `null` (sahte "kanonikle aynı" üretmemek için).
 * @param {string} [yol]
 * @returns {Promise<{sha12:string, boyut?:number, mtime?:string, not?:string}|null>}
 */
async function kanonikOku(yol = KANONIK_YOLU_VARSAYILAN) {
  try {
    const ham = await fs.readFile(yol, 'utf8');
    const j = JSON.parse(ham);
    if (j && typeof j === 'object' && typeof j.sha12 === 'string' && j.sha12.length === 12) {
      return j;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Bir tek dosya damgasını kanonikle kıyaslayıp `durum` ekler. SAF.
 * @param {{sha12:string}} damga
 * @param {{sha12:string}|null} kanonik
 * 'farkli' (review #15): sha farkı YÖN bildirmez — paketteki motor kanonikten YENİ de olabilir
 * (kanonik önbellek bayatsa). 'eski' demek yanlış bir kesinlik olurdu.
 * @returns {'ayni'|'farkli'|'bilinmiyor'}
 */
function durumHesapla(damga, kanonik) {
  if (!kanonik || typeof kanonik.sha12 !== 'string') return 'bilinmiyor';
  return damga.sha12 === kanonik.sha12 ? 'ayni' : 'farkli';
}

/**
 * Paketlenen ağaçtaki TÜM motor kopyalarının damgasını çıkarır (kök + her
 * alt-kitap). Her girdi kanonikle kıyaslanmış hâlde döner.
 *
 * @param {string} kokDizin  Paket kökü (örn. açılmış build.zip)
 * @param {{kanonikYolu?: string, kanonik?: object|null, maxDepth?: number}} [opts]
 *   `opts.kanonik` verilirse disk okunmaz (test/enjeksiyon için) — `undefined`
 *   verilirse `kanonikOku(opts.kanonikYolu)` çağrılır.
 * @returns {Promise<Array<{dosya:string, sha12:string, boyut:number, mtime:string,
 *            kanonikSha12:string|null, durum:'ayni'|'farkli'|'bilinmiyor'}>>}
 */
async function motorDamgasi(kokDizin, opts = {}) {
  const kanonik = opts.kanonik !== undefined ? opts.kanonik : await kanonikOku(opts.kanonikYolu);
  const bulunanlar = await motorDosyalariniBul(kokDizin, opts);

  const sonuc = [];
  for (const rel of bulunanlar) {
    let d;
    try {
      d = await dosyaDamgasiHesapla(path.join(kokDizin, rel));
    } catch {
      continue; // okunamayan dosya ölçümü durdurmaz, listeye girmez
    }
    sonuc.push({
      dosya: rel,
      sha12: d.sha12,
      boyut: d.boyut,
      mtime: d.mtime,
      kanonikSha12: (kanonik && typeof kanonik.sha12 === 'string') ? kanonik.sha12 : null,
      durum: durumHesapla(d, kanonik),
    });
  }
  return sonuc;
}

/**
 * `paket.json` gövdesine `motorSurumu` alanını SAF şekilde ekler — girdi nesnesi
 * MUTASYONA UĞRAMAZ, yeni bir nesne döner.
 *
 * @param {object} paketJson  Mevcut paket.json gövdesi (bkz. `paket-manifesti.js`)
 * @param {Array|object} damga  `motorDamgasi()` çıktısı (liste) ya da tek bir kayıt
 * @returns {object} yeni nesne — `{...paketJson, motorSurumu: damga}`
 */
function paketJsonDamgasi(paketJson, damga) {
  const taban = (paketJson && typeof paketJson === 'object') ? paketJson : {};
  return { ...taban, motorSurumu: damga };
}

/**
 * Operatör için tek satır Türkçe durum metni. SAF.
 * Tek bir damga kaydı ya da `motorDamgasi()` listesi (0 veya N eleman) kabul eder.
 *
 * @param {{sha12:string, durum:string, kanonikSha12?:string|null}|Array} damga
 * @returns {string}
 */
function rozet(damga) {
  if (Array.isArray(damga)) {
    if (damga.length === 0) return 'motor: bulunamadı';
    return damga.map((d) => rozetSatiri(d)).join('; ');
  }
  return rozetSatiri(damga);
}

/** `rozet()`'in tek-kayıt iç işi. */
function rozetSatiri(d) {
  if (!d || typeof d.sha12 !== 'string') return 'motor: ölçülemedi';
  if (d.durum === 'ayni') return `motor: ${d.sha12} (kanonikle AYNI)`;
  if (d.durum === 'farkli') return `motor: ${d.sha12} (FARKLI: kanonik ${d.kanonikSha12})`;
  return `motor: ${d.sha12} (bilinmiyor)`;
}

// ---------------------------------------------------------------------------
// FAZ 3b — "ESKİYSE DEĞİŞTİR" (2026-09-24, Nadir: "bizim derlediğimiz motor kanoniktir")
//
// SÜRÜM NEREDEN GELİR (ölçüm 2026-09-24): motor dosyasının İÇİNDE sürüm dizgesi YOK —
// ne yayıncı kopyasında (210542 B, sha ba539fb50c60) ne bizim derlememizde (548196 B,
// sha 03e8af70a0f3). Dosyaya damga gömmek sha'yı kanonikten ayırırdı. Bu yüzden
// sürüm, kanonik önbelleğin `surumler` haritasından okunur: `{sha12: surum}` —
// bizim derlediğimiz her motorun sha'sı ve sürümü. Haritada OLMAYAN sha = bizim
// hattımızdan geçmemiş yabancı/eski soy (yayıncı exe'sinden gelen kopya) →
// "eski" sayılır. Rationale: kanonik = bizim derleme (player-guncelle §1c); yabancı
// soyun kanonikten YENİ olduğunu gösteren hiçbir damga yoktur ve Nadir'in tanımı
// "hangisi güncelse" değil "bizimki" dir.
// Haritada olan ve kanonikten YÜKSEK sürümlü kopya (kanonik önbellek bayat) DEĞİŞMEZ.
// ---------------------------------------------------------------------------

/** 'a.b.c[.d]' → sayı dizisi; geçersizse null. */
function surumParcala(s) {
  if (typeof s !== 'string' || !/^\d+(\.\d+)*$/.test(s.trim())) return null;
  return s.trim().split('.').map((x) => Number(x));
}

/** Semver benzeri kıyas: a<b → -1, eşit → 0, a>b → 1; geçersiz girdi → null. SAF. */
function surumKiyasla(a, b) {
  const x = surumParcala(a);
  const y = surumParcala(b);
  if (!x || !y) return null;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i += 1) {
    const p = x[i] || 0;
    const q = y[i] || 0;
    if (p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

/** Bir kopyanın sürümü: kanonik `surumler` haritasından (sha12 → surum). Yoksa null. */
function kopyaSurumu(sha12, kanonik) {
  const harita = kanonik && kanonik.surumler && typeof kanonik.surumler === 'object'
    ? kanonik.surumler : {};
  if (kanonik && sha12 === kanonik.sha12) return kanonik.surum || null;
  return typeof harita[sha12] === 'string' ? harita[sha12] : null;
}

/**
 * Tek kopya için değiştirme kararı. SAF.
 * @returns {{karar:'ayni'|'eski'|'yeni'|'bilinmiyor', kopyaSurumu:string|null}}
 *   'eski' → değiştirilir; diğerleri dokunulmaz.
 */
function degistirmeKarari(sha12, kanonik) {
  if (!kanonik || typeof kanonik.sha12 !== 'string' || !surumParcala(kanonik.surum)) {
    return { karar: 'bilinmiyor', kopyaSurumu: null };
  }
  if (sha12 === kanonik.sha12) return { karar: 'ayni', kopyaSurumu: kanonik.surum };
  const ks = kopyaSurumu(sha12, kanonik);
  if (ks === null) return { karar: 'eski', kopyaSurumu: null }; // bizim soyda değil
  const k = surumKiyasla(ks, kanonik.surum);
  if (k === null) return { karar: 'bilinmiyor', kopyaSurumu: ks };
  return { karar: k < 0 ? 'eski' : 'yeni', kopyaSurumu: ks };
}

/**
 * Kanonik önbelleği DOĞRULAYARAK yükler: kanonik.json + yanındaki motor dosyası,
 * dosyanın sha12'si json'daki ile eşleşmeli. Herhangi bir şüphede null (sahte yeşil yok).
 * @param {string} [kanonikYol] kanonik.json yolu (varsayılan KANONIK_YOLU_VARSAYILAN)
 * @returns {Promise<{sha12:string, surum:string, dosya:string, surumler?:object}|null>}
 */
async function kanonikYukle(kanonikYol = KANONIK_YOLU_VARSAYILAN) {
  const k = await kanonikOku(kanonikYol);
  if (!k || !surumParcala(k.surum)) return null;
  const dosya = path.join(path.dirname(kanonikYol), MOTOR_DOSYA_ADI);
  try {
    const d = await dosyaDamgasiHesapla(dosya);
    if (d.sha12 !== k.sha12 || d.boyut <= 0) return null;
  } catch {
    return null;
  }
  return { ...k, dosya };
}

/**
 * `paket.json`'a `motorSurumu` alanını birleştirir (diğer alanlar korunur). Dosya yoksa
 * yalnız `{motorSurumu}` ile oluşturur. I/O.
 */
async function paketJsonaDamgaYaz(kokDizin, damga) {
  const hedef = path.join(kokDizin, 'paket.json');
  let govde = {};
  try { govde = JSON.parse(await fs.readFile(hedef, 'utf8')); } catch { govde = {}; }
  const yeni = paketJsonDamgasi(govde, damga);
  await fs.writeFile(hedef, `${JSON.stringify(yeni, null, 2)}\n`, 'utf8');
  return yeni;
}

/**
 * PAKETTEKİ HER MOTOR KOPYASINI (kök + alt kitaplar + kitap-içi gömülü `htmletk/.../etk/`)
 * kanonikle kıyaslar; ESKİ olanı kanonikle değiştirir. Eski dosya SİLİNMEZ — paket
 * ağacının DIŞINA (`<kokDizin'in üstü>/.empp-eski/<kök adı>/<göreli yol>`) taşınır;
 * ağacın içine koymak onu pakete (ve manifest parmak izine) sokardı.
 * Kanonik yok/doğrulanamıyorsa HİÇBİR ŞEY değişmez, damga `durum: 'bilinmiyor'`.
 *
 * @param {string} kokDizin paket kökü
 * @param {string} [kanonikYol] kanonik.json yolu
 * @param {{kanonik?:object|null, yedekKok?:string, paketJsonYaz?:boolean, log?:Function}} [opts]
 *   `opts.kanonik` verilirse (test) `{sha12, surum, dosya, surumler}` doğrudan kullanılır.
 * @returns {Promise<object>} damga (paket.json.motorSurumu ile aynı nesne)
 */
async function motorDegistir(kokDizin, kanonikYol = KANONIK_YOLU_VARSAYILAN, opts = {}) {
  const log = opts.log || (() => {});
  const kanonik = opts.kanonik !== undefined ? opts.kanonik : await kanonikYukle(kanonikYol);
  const yedekKok = opts.yedekKok
    || path.join(path.dirname(path.resolve(kokDizin)), '.empp-eski', path.basename(kokDizin));
  const bulunanlar = await motorDosyalariniBul(kokDizin, opts);
  const kopyalar = [];

  for (const rel of bulunanlar) {
    const tam = path.join(kokDizin, rel);
    let once;
    try { once = await dosyaDamgasiHesapla(tam); } catch { continue; }
    const { karar, kopyaSurumu: ks } = degistirmeKarari(once.sha12, kanonik);
    const kayit = { dosya: rel, onceSha12: once.sha12, onceSurum: ks, karar, sonraSha12: once.sha12 };
    if (karar === 'eski') {
      const yedek = path.join(yedekKok, rel);
      await fs.ensureDir(path.dirname(yedek));
      await fs.move(tam, yedek, { overwrite: true });
      await fs.copy(kanonik.dosya, tam);
      const sonra = await dosyaDamgasiHesapla(tam);
      if (sonra.sha12 !== kanonik.sha12) {
        // geri okuma tutmadı — eskiyi geri koy, kaydı hata olarak işaretle
        await fs.move(yedek, tam, { overwrite: true });
        kayit.karar = 'hata';
      } else {
        kayit.karar = 'degisti';
        kayit.sonraSha12 = sonra.sha12;
        kayit.yedek = yedek;
      }
      log(`   motor ${rel}: ${once.sha12} → ${kayit.sonraSha12} (${kayit.karar})`);
    }
    kopyalar.push(kayit);
  }

  let durum;
  if (!kanonik) durum = 'bilinmiyor';
  else if (kopyalar.length === 0) durum = 'motor-yok';
  else if (kopyalar.some((k) => k.karar === 'hata' || k.karar === 'bilinmiyor')) durum = 'karisik';
  else durum = kopyalar.every((k) => k.sonraSha12 === kanonik.sha12 || k.karar === 'yeni')
    ? 'guncel' : 'karisik';

  const damga = {
    durum,
    kanonikSha12: kanonik ? kanonik.sha12 : null,
    kanonikSurum: kanonik ? kanonik.surum : null,
    degisen: kopyalar.filter((k) => k.karar === 'degisti').length,
    kopyalar,
    zaman: new Date().toISOString(),
  };
  if (opts.paketJsonYaz !== false) await paketJsonaDamgaYaz(kokDizin, damga);
  return damga;
}

/**
 * KAPI (üretim sonrası, dosyadan): paketteki her motor kopyası kanonikle AYNI ya da
 * haritada kanonikten YENİ mi? `damga.durum` yerine GERÇEK dosyalar ölçülür.
 * @returns {Promise<{gecti:boolean|null, kopyalar:Array, sebep:string}>}
 *   gecti=null → kanonik bilinmiyor (yeşil sayılmaz).
 */
async function motorKapisi(kokDizin, kanonik) {
  if (!kanonik || !surumParcala(kanonik.surum)) {
    return { gecti: null, kopyalar: [], sebep: 'kanonik bilinmiyor' };
  }
  const bulunanlar = await motorDosyalariniBul(kokDizin);
  const kopyalar = [];
  for (const rel of bulunanlar) {
    const d = await dosyaDamgasiHesapla(path.join(kokDizin, rel));
    kopyalar.push({ dosya: rel, sha12: d.sha12, karar: degistirmeKarari(d.sha12, kanonik).karar });
  }
  if (kopyalar.length === 0) return { gecti: false, kopyalar, sebep: 'motor bulunamadı' };
  const kotu = kopyalar.filter((k) => k.karar !== 'ayni' && k.karar !== 'yeni');
  return {
    gecti: kotu.length === 0,
    kopyalar,
    sebep: kotu.length ? `${kotu.length} kopya kanonikten eski/bilinmiyor` : 'tümü ≥ kanonik',
  };
}

/**
 * "SAĞ ALT SÜRÜM ROZETİ" — OCR'sız, dosyadan. Rozet MOTORDAN DEĞİL okuyucu kabuğundan
 * gelir (ölçüm 2026-09-24): `index.html` → `<hash>.main.js` → parça haritası →
 * `e.exports={i8:"X"}` taşıyan parça (webpack'in package.json `version` modülü).
 * @param {string} kitapDizini index.html'in bulunduğu dizin
 * @returns {Promise<{surum:string|null, main:string|null, parca:string|null}>}
 */
async function rozetSurumuOku(kitapDizini) {
  return rozetSurumuOkuEsz(kitapDizini);
}

/**
 * `rozetSurumuOku`'nun SENKRON gövdesi — TEK KAYNAK (2026-09-26). Senkron çağıran:
 * `src/agent/publisher-update.js` (SET dalında her bookN'in okuyucu sürümü; o fonksiyon
 * üç çağıranda senkron kullanılıyor). Algoritma burada bir kez yazılır; async sürüm
 * yalnız sarmalayıcıdır — iki ayrı kopya ayrışamaz.
 * @param {string} kitapDizini
 * @returns {{surum:string|null, main:string|null, parca:string|null}}
 */
function rozetSurumuOkuEsz(kitapDizini) {
  const bos = { surum: null, main: null, parca: null };
  let html;
  try { html = fs.readFileSync(path.join(kitapDizini, 'index.html'), 'utf8'); } catch { return bos; }
  const m = html.match(/src="\.?\/?([0-9a-f]{20}\.main\.js)"/);
  if (!m) return bos;
  let main;
  try { main = fs.readFileSync(path.join(kitapDizini, m[1]), 'latin1'); } catch {
    return { ...bos, main: m[1] };
  }
  const direkt = main.match(/e\.exports=\{i8:"([0-9.]+)"\}/);
  if (direkt) return { surum: direkt[1], main: m[1], parca: m[1] };
  const parcalar = [...main.matchAll(/(\d+):"([0-9a-f]{20})"/g)];
  for (const [, id, hash] of parcalar) {
    const ad = `${hash}.${id}.js`;
    let icerik;
    try { icerik = fs.readFileSync(path.join(kitapDizini, ad), 'latin1'); } catch { continue; }
    const v = icerik.match(/e\.exports=\{i8:"([0-9.]+)"\}/);
    if (v) return { surum: v[1], main: m[1], parca: ad };
  }
  return { ...bos, main: m[1] };
}

module.exports = {
  MOTOR_DOSYA_ADI,
  KANONIK_YOLU_VARSAYILAN,
  surumParcala,
  surumKiyasla,
  kopyaSurumu,
  degistirmeKarari,
  kanonikYukle,
  paketJsonaDamgaYaz,
  motorDegistir,
  motorKapisi,
  rozetSurumuOku,
  rozetSurumuOkuEsz,
  acikMi,
  motorDosyalariniBul,
  dosyaDamgasiHesapla,
  kanonikOku,
  durumHesapla,
  motorDamgasi,
  paketJsonDamgasi,
  rozet,
};

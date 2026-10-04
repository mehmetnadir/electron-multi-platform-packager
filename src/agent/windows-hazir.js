'use strict';

/**
 * WINDOWS HAZIR KUYRUĞU — "imza bekliyor" (sözleşme exesiz-kaynak §2a, Nadir 02.10).
 *
 * "Windows her hâlükârda üretilir": imza yuvası (İmpark VPN + Storage7) erişilemese de runner paketi
 * üretir, statik kapıdan + kabul kapısından (windows-kasa, yoksa başsız) geçirir ve İMZASIZ paketi
 * buraya koyar. İmzasız paket ASLA R2'ye/yayına gitmez: buradan tek çıkış yolu imza bekçisidir
 * (`tools/windows/imza-bekcisi.js`) — yuva erişilebilir olunca windows-serit'in AYNI imza +
 * Authenticode + kabul fonksiyonlarıyla imzalatır, doğrular, yükler, `yayinlandi/`'ye TAŞIR.
 *
 * Yerleşim (`~/.empp-agent/windows-hazir/`):
 *   <bookId>-<sürüm>/            bekleyen: <exe> + manifest.json
 *   yayinlandi/<bookId>-<sürüm>-<damga>/   bekçinin yayınladığı (taşınır, silinmez)
 *   reddedildi/<bookId>-<sürüm>-<damga>/   imzalı kopya kabulden KALDI (paket kusuru)
 *   eskiler/<bookId>-<sürüm>-<damga>/      aynı sürüm yeniden üretilince yerinden edilen eski kopya
 *   bayat/<bookId>-<sürüm>-<damga>/        kaynak sürümü sunucunun geçerli kaynağından eski (04.10; imzaya GİTMEZ)
 *   .bildirim-durum.json          bekçi bildirim kısıtı (aynı sebep 3 saatte en çok bir)
 *
 * manifest.json: bookId, platform, surum, exe (dosya adı), sha256, md5, boyut, kabulKanit, kabulKapi,
 * r2Hedef (sunucu presign'ı belirler; runner'ın bildiği hedef bilgisi), job (claim alanları — bekçi
 * /result gövdesini bunlarla kurar), kanit (statik kapı özeti, kök index), zaman, durum, sebep.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const MANIFEST = 'manifest.json';
const ALT_DIZINLER = ['yayinlandi', 'reddedildi', 'eskiler', 'bayat'];
const DURUM_DOSYASI = '.bildirim-durum.json';
/** Sunucuya giden ara durum (current_phase) — book-update tasarımı rapor/OKU'da. */
const IMZA_BEKLIYOR_FAZI = 'imza-bekliyor';

function hazirAyarlari(env = process.env) {
  return {
    // EMPP_WIN_IMZA_BEKLEME=0 → eski davranış: yuva yoksa windows ilan edilmez/üretilmez.
    winHazirAcik: env.EMPP_WIN_IMZA_BEKLEME !== '0',
    winHazirKoku: env.EMPP_WIN_HAZIR_KOK || path.join(os.homedir(), '.empp-agent', 'windows-hazir'),
    // Runner'ın imza adımına ayırdığı süre (dk → ms). Dolarsa (imza kuyruğu kilidi dolu / _hazir
    // kopyası / yuva penceresi; takas BAŞLAMADAN) paket hazır kuyruğa alınır, sunucuya imza-bekliyor
    // bildirilir, runner sıradaki işe geçer; imza bekçisi yayınlar. 0 = kapalı (eski: imzayı bekle).
    // EMPP_WIN_IMZA_BEKLEME=0 (hazır kuyruk kapalı) esiği de kapatır.
    winImzaEsikMs: env.EMPP_WIN_IMZA_BEKLEME === '0' ? 0
      : Math.max(0, Number(env.EMPP_WIN_IMZA_ESIK_DK === undefined ? 5 : env.EMPP_WIN_IMZA_ESIK_DK) || 0) * 60 * 1000,
    winHazirBildirimEsikMs: 3 * 3600 * 1000,
    winHazirBildirimAralikMs: 3 * 3600 * 1000,
  };
}

function damga(t = new Date()) {
  const iki = (n) => String(n).padStart(2, '0');
  return `${t.getFullYear()}${iki(t.getMonth() + 1)}${iki(t.getDate())}-${iki(t.getHours())}${iki(t.getMinutes())}${iki(t.getSeconds())}`;
}

/** Bekleyen paketin dizin adı. Saf. */
function hazirAnahtari(bookId, surum) {
  const temiz = (s) => String(s == null ? '' : s).replace(/[^A-Za-z0-9._-]+/g, '-');
  return `${temiz(bookId)}-${temiz(surum)}`;
}

/** Runner'ın hazır kuyruğa geçtiği claim alanları (bekçinin /result gövdesi için). Saf. */
function jobOzeti(job) {
  const alan = ['bookId', 'platform', 'bookTitle', 'publisherName', 'surum', 'setKimligi', 'guncellemeTabani',
    'kaynakSurumu', 'kaynakTuru', 'icerikSurumleri', 'appVersion'];
  const o = {};
  for (const a of alan) if (job && job[a] !== undefined) o[a] = job[a];
  return o;
}

/**
 * Bildirim kararı (bekçi). Saf. Sebep anahtarı aynı kaldıkça en çok `aralikMs`'de bir; yeni sebep
 * hemen. Bildirim YALNIZ bekleyen varken ve (yuva erişilemiyorsa VEYA en eski bekleyen eşiği aştıysa).
 * @returns {{gonder:boolean, anahtar?:string, mesaj?:string}}
 */
function bildirimKarari({ bekleyenSayisi, enEskiMs, yuvaErisilir, sebep, simdiMs, durum, esikMs, aralikMs }) {
  if (!bekleyenSayisi) return { gonder: false };
  const yas = enEskiMs ? simdiMs - enEskiMs : 0;
  let anahtar = null;
  let neden = null;
  if (!yuvaErisilir) { anahtar = `yuva:${sebep || 'erisilemez'}`; neden = sebep || 'imza yuvası erişilemiyor'; }
  else if (yas > esikMs) { anahtar = `bekleme:${sebep || 'esik'}`; neden = sebep || `en eski ${Math.round(yas / 3600000)} saattir bekliyor`; }
  if (!anahtar) return { gonder: false };
  const son = durum && durum[anahtar];
  if (son && simdiMs - son < aralikMs) return { gonder: false, anahtar };
  return { gonder: true, anahtar, mesaj: `${bekleyenSayisi} Windows paketi imza bekliyor: ${neden}` };
}

async function manifestOku(dizin) {
  try { return JSON.parse(await fsp.readFile(path.join(dizin, MANIFEST), 'utf8')); } catch (_) { return null; }
}

async function manifestYaz(dizin, manifest) {
  const yol = path.join(dizin, MANIFEST);
  const gecici = `${yol}.tmp-${process.pid}`;
  await fsp.writeFile(gecici, `${JSON.stringify(manifest, null, 2)}\n`);
  await fsp.rename(gecici, yol);
}

/** Aynı bookId+sürüm için bekleyen (exe'si yerinde) paket var mı? Yoksa null. */
async function hazirBul(cfg, bookId, surum) {
  const dizin = path.join(cfg.winHazirKoku, hazirAnahtari(bookId, surum));
  const m = await manifestOku(dizin);
  if (!m || m.durum !== IMZA_BEKLIYOR_FAZI || !m.exe) return null;
  try {
    const st = await fsp.stat(path.join(dizin, m.exe));
    if (m.boyut != null && st.size !== m.boyut) return null;
  } catch (_) { return null; }
  return { dizin, manifest: m, exeYolu: path.join(dizin, m.exe) };
}

/** Yerinden edilen dizini silmeden `<alt>/<ad>-<damga>`'ya taşır. */
async function kenaraTasi(cfg, dizin, alt) {
  const hedefKok = path.join(cfg.winHazirKoku, alt);
  await fsp.mkdir(hedefKok, { recursive: true });
  let hedef = path.join(hedefKok, `${path.basename(dizin)}-${damga()}`);
  for (let i = 2; fs.existsSync(hedef); i += 1) hedef = path.join(hedefKok, `${path.basename(dizin)}-${damga()}-${i}`);
  await fsp.rename(dizin, hedef);
  return hedef;
}

/**
 * İmzasız paketi hazır kuyruğa koy. exe sabit bağlantıyla (aynı birim) ya da kopyayla gelir —
 * runner işin `work` dizinini iş sonunda siler, hazır kopya bundan etkilenmez. Önce geçici dizine
 * yazılır, manifest tamamlanınca tek `rename` ile görünür olur (yarım kayıt bekçiye görünmez).
 * @returns {Promise<{dizin:string, manifest:object}>}
 */
async function hazirKoy({ exe, job, surum, kanit, cfg, kabul, r2Hedef, sebep }) {
  const anahtar = hazirAnahtari(job.bookId, surum);
  const hedef = path.join(cfg.winHazirKoku, anahtar);
  await fsp.mkdir(cfg.winHazirKoku, { recursive: true });
  const gecici = path.join(cfg.winHazirKoku, `.${anahtar}.tmp-${process.pid}-${Date.now()}`);
  await fsp.mkdir(gecici, { recursive: true });
  const ad = path.basename(exe);
  try { await fsp.link(exe, path.join(gecici, ad)); } catch (_) { await fsp.copyFile(exe, path.join(gecici, ad)); }
  const st = await fsp.stat(path.join(gecici, ad));
  if (kanit && kanit.imzasiz && kanit.imzasiz.boyut != null && st.size !== kanit.imzasiz.boyut) {
    throw new Error(`hazır kopya boyutu (${st.size}) üretilen paketten (${kanit.imzasiz.boyut}) farklı`);
  }
  const manifest = {
    bookId: String(job.bookId), platform: 'windows', surum, exe: ad,
    sha256: kanit && kanit.imzasiz ? kanit.imzasiz.sha256 : null,
    md5: kanit && kanit.imzasiz ? kanit.imzasiz.md5 : null,
    boyut: st.size,
    kabulKapi: kabul ? kabul.kapi : null,
    kabulKanit: kabul ? (kabul.kanitDizini || null) : null,
    r2Hedef: r2Hedef || { belirleyen: 'sunucu-presign', not: 'r2ObjectKey yayın anında /result/presign yanıtından gelir' },
    job: jobOzeti(job),
    // Paket damgası (paket.json motorSurumu/kabukSurumu özeti) — bayat kararı için (04.10, 72379).
    kanonik: require('./kanonik-surum').govdeAlanlari(job.kanonikSurum),
    kanit: kanit ? { kapi: kanit.kapi || null, kokIndex: kanit.kokIndex || null, setKimligi: kanit.setKimligi || null } : null,
    zaman: new Date().toISOString(),
    durum: IMZA_BEKLIYOR_FAZI,
    sebep: sebep || null,
  };
  await manifestYaz(gecici, manifest);
  if (fs.existsSync(hedef)) await kenaraTasi(cfg, hedef, 'eskiler');
  await fsp.rename(gecici, hedef);
  return { dizin: hedef, manifest };
}

/**
 * BAYAT HAZIR KAYIT (04.10, 72378 + 72379). İki bağımsız ölçüt; biri tutarsa kayıt bayat:
 *  1. KAYNAK SÜRÜMÜ: hazır exe 2.0.7 kaynağından üretilmişti, sunucunun geçerli kaynağı 2.0.11 →
 *     imza + kabul + R2 yüklemesi yapıldı, sonra `/result` `kaynak-surumu-eski` dedi (imza yuvası boşa,
 *     R2 kanonik anahtarına bayat exe). Kayıtlı sürüm ile geçerli sürüm İKİSİ DE `2.<panel>.<sayaç>`
 *     biçimindeyse ve farklıysa bayat; biri bilinmiyor/biçim dışıysa bayat SAYILMAZ (`bilinmiyor` döner,
 *     çağıran loglar; sunucu zaten /result'ta reddeder).
 *  2. KANONİK DAMGA: 72379 imzalı paketi 02.10'da kanoniksiz üretilmiş hazır kayıttan geldi (motor durum
 *     "bilinmiyor" sha12 ba539fb50c60 ≠ kanonik 03e8af70a0f3, kabuk "bilinmiyor" 1.12.7). Ajanın kendi
 *     kanonik.json'larından (motor sha12 + kabuk sürümü) okunan GEÇERLİ kanonik en az biri biliniyorsa:
 *     kayıtta damga yoksa (eski kayıt) / motorDurum ≠ guncel / motorSha12 ≠ geçerli / kabukDurum ≠ guncel /
 *     kabukSurum ≠ geçerli → bayat ("kanoniksiz/eski kanonik"). Geçerli kanonik hiç okunamıyorsa kıyas
 *     yapılamaz → ölçüt atlanır (log çağırandadır).
 * @returns {{bayat:boolean, sebep?:string, kayitli?:string, gecerli?:string, bilinmiyor?:string}}
 */
function bayatKarari(manifest, { gecerliKaynakSurumu, gecerliKanonik } = {}) {
  const { surumGecerli } = require('./kaynak-r2');
  const kayitli = manifest && manifest.job && typeof manifest.job.kaynakSurumu === 'string' ? manifest.job.kaynakSurumu.trim() : '';
  const gecerli = typeof gecerliKaynakSurumu === 'string' ? gecerliKaynakSurumu.trim() : '';
  let bilinmiyor;
  if (kayitli && gecerli) {
    if (!surumGecerli(kayitli) || !surumGecerli(gecerli)) bilinmiyor = `kaynak sürümü biçim dışı (kayıt "${kayitli}", geçerli "${gecerli}")`;
    else if (kayitli !== gecerli) {
      return { bayat: true, kayitli, gecerli, sebep: `kaynak-surumu-eski: kayıt ${kayitli}, geçerli ${gecerli}` };
    }
  }
  const gk = gecerliKanonik || {};
  if (gk.motorSha12 || gk.kabukSurum) {
    const k = manifest && manifest.kanonik && typeof manifest.kanonik === 'object' ? manifest.kanonik : null;
    if (!k || !Object.values(k).some(Boolean)) {
      return { bayat: true, sebep: 'kanoniksiz/eski kanonik: hazır kayıtta motor/kabuk damgası yok (eski kayıt, fail-closed)' };
    }
    const fark = [];
    if (k.motorDurum !== 'guncel') fark.push(`motor durum "${k.motorDurum || '-'}"`);
    if (gk.motorSha12 && k.motorSha12 !== gk.motorSha12) fark.push(`motor ${k.motorSha12 || '-'} ≠ kanonik ${gk.motorSha12}`);
    if (k.kabukDurum !== 'guncel') fark.push(`kabuk durum "${k.kabukDurum || '-'}"`);
    if (gk.kabukSurum && k.kabukSurum !== gk.kabukSurum) fark.push(`kabuk ${k.kabukSurum || '-'} ≠ kanonik ${gk.kabukSurum}`);
    if (fark.length) return { bayat: true, sebep: `kanoniksiz/eski kanonik: ${fark.join('; ')}` };
  }
  return bilinmiyor ? { bayat: false, bilinmiyor } : { bayat: false };
}

/**
 * Bayat kararının ZAMANI (O2, 04.10): `r2-al` claim'inde claim'in kaynakSurumu = sunucunun geçerli sürümü →
 * karar hemen; `r2-kur` claim'inde sürüm ancak kaynak kurulunca bilinir (içerik değişmediyse AYNI kalır,
 * 72380) → karar ertelenir, kurulumdan sonra `yayin.surum` ile verilir; diğer claim'lerde (arşiv/manuel)
 * kaynak sürümü ölçütü yok (yalnız kanonik ölçütü).
 * @returns {{ertele:boolean, kaynakSurumu:string|null}}
 */
function bayatKararZamani(job) {
  const tur = job && job.kaynakTuru;
  if (tur === 'r2-kur') return { ertele: true, kaynakSurumu: null };
  return { ertele: false, kaynakSurumu: tur === 'r2-al' && typeof job.kaynakSurumu === 'string' ? job.kaynakSurumu : null };
}

/** Geçerli kanonik motor sha12 + kabuk sürümü (ajanın kendi kanonik.json'ları). Okunamayan alan null. */
async function gecerliKanonikOku(cfg) {
  if (cfg && typeof cfg.winKanonikYukleyici === 'function') return cfg.winKanonikYukleyici();
  const o = { motorSha12: null, kabukSurum: null };
  try {
    const m = require('../packaging/motor-surumu');
    const k = await m.kanonikOku(process.env.EMPP_MOTOR_KANONIK || m.KANONIK_YOLU_VARSAYILAN);
    if (k && typeof k.sha12 === 'string') o.motorSha12 = k.sha12;
  } catch (_) { /* bilinmiyor */ }
  try {
    const kb = require('../packaging/okuyucu-kabugu');
    const k = await kb.kanonikKabukYukle(process.env.EMPP_KABUK_KANONIK || kb.KANONIK_YOLU_VARSAYILAN);
    if (k && typeof k.surum === 'string') o.kabukSurum = k.surum;
  } catch (_) { /* bilinmiyor */ }
  return o;
}

/** Geriye uyum: yalnız kaynak sürümü ölçütü. */
function kaynakSurumuBayatMi(manifest, gecerliKaynakSurumu) {
  return bayatKarari(manifest, { gecerliKaynakSurumu });
}

/** Bayat kaydı silmeden `bayat/`'a taşır (manifest'e durum/sebep yazılır). İmza istenmez. */
async function bayatKenaraAl(cfg, giris, karar) {
  const sebep = typeof karar === 'string' ? karar : (karar && karar.sebep) || 'bayat';
  const s = await sonuclandir(cfg, giris, 'bayat', { durum: 'bayat', sebep, zamanBayat: new Date().toISOString() });
  return { ...s, sebep };
}

/** Bekleyenler, en eskiden yeniye. Alt dizinler, geçici ve manifestsiz dizinler sayılmaz. */
async function hazirListesi(cfg) {
  let girdiler = [];
  try { girdiler = await fsp.readdir(cfg.winHazirKoku, { withFileTypes: true }); } catch (_) { return []; }
  const liste = [];
  for (const g of girdiler) {
    if (!g.isDirectory() || g.name.startsWith('.') || ALT_DIZINLER.includes(g.name)) continue;
    const dizin = path.join(cfg.winHazirKoku, g.name);
    const m = await manifestOku(dizin);
    if (!m || m.durum !== IMZA_BEKLIYOR_FAZI || !m.exe || !fs.existsSync(path.join(dizin, m.exe))) continue;
    liste.push({ dizin, manifest: m, exeYolu: path.join(dizin, m.exe), zamanMs: Date.parse(m.zaman) || 0 });
  }
  return liste.sort((a, b) => a.zamanMs - b.zamanMs);
}

/** Manifest'e alan ekler/günceller (ör. bekçinin sonHata'sı). Kayıt yerinde kalır. */
async function manifestGuncelle(dizin, ek) {
  const m = await manifestOku(dizin);
  if (!m) throw new Error(`manifest yok: ${dizin}`);
  await manifestYaz(dizin, { ...m, ...ek });
}

/** Bekçi sonucu: manifest güncellenir, dizin `yayinlandi/` ya da `reddedildi/`'ye TAŞINIR. */
async function sonuclandir(cfg, giris, alt, ek) {
  const m = { ...giris.manifest, ...ek };
  await manifestYaz(giris.dizin, m);
  const hedef = await kenaraTasi(cfg, giris.dizin, alt);
  return { dizin: hedef, manifest: m };
}

async function bildirimDurumuOku(cfg) {
  try { return JSON.parse(await fsp.readFile(path.join(cfg.winHazirKoku, DURUM_DOSYASI), 'utf8')) || {}; } catch (_) { return {}; }
}

async function bildirimDurumuYaz(cfg, durum) {
  await fsp.mkdir(cfg.winHazirKoku, { recursive: true });
  const yol = path.join(cfg.winHazirKoku, DURUM_DOSYASI);
  await fsp.writeFile(`${yol}.tmp-${process.pid}`, `${JSON.stringify(durum, null, 2)}\n`);
  await fsp.rename(`${yol}.tmp-${process.pid}`, yol);
}

/**
 * Kayıt kilidi (runner devralma ↔ imza bekçisi): aynı hazır kaydı iki süreç aynı anda imzalayıp iki
 * kez yayınlamasın. flock, bloklamaz: doluysa null. Dönen fonksiyon kilidi bırakır.
 */
async function kayitKilidiDene(dizin) {
  const { kilitDene, kilitBirak } = require('./windows-serit'); // döngüsel require: çağrı anında
  const r = await kilitDene(path.join(dizin, '.kilit'));
  return r.tutucu ? () => kilitBirak(r.tutucu) : null;
}

module.exports = {
  kayitKilidiDene,
  MANIFEST, IMZA_BEKLIYOR_FAZI, ALT_DIZINLER, hazirAyarlari, hazirAnahtari, jobOzeti, bildirimKarari,
  manifestOku, manifestGuncelle, hazirBul, hazirKoy, hazirListesi, sonuclandir, kaynakSurumuBayatMi, bayatKarari, bayatKararZamani, gecerliKanonikOku, bayatKenaraAl, bildirimDurumuOku, bildirimDurumuYaz, damga,
};

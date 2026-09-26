'use strict';
/**
 * Yayıncı çalışma-zamanı güncellemesini PAKETLEME ANINDA uygular (2026-08-27).
 *
 * Windows'ta uygulama açılışta `https://www.sorucoz.tv/uploads/akillitahta/{kurum}/Update/
 * version.html` → `{version}.zip` indirip build klasörünün üstüne açar (electron.js
 * checkForUpdates). macOS/Linux paketimizde build salt-okunur (asar) olduğundan bu
 * çalışmaz; ayrıca sunucu Cloudflare JS-challenge'lı (curl/Node 403) — güncelleme zip'i
 * tarayıcıyla alınıp `EMPP_UPDATE_DIR/{kurum}/{version}.zip` olarak konur; burada en yeni
 * uygun sürüm build'e uygulanır, `version.txt` güncellenir.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { yazilacakSurum, acikMi } = require('./surum-normallestir');
// TEK KAYNAK: sürüm kıyası burada YENİDEN YAZILMAZ (bkz. isNewer/cmpVersion).
const { dahaYeniMi, parcalara } = require('./surum-kiyas');
// TEK KAYNAK: okuyucu rozeti (bookN'in gerçek okuyucu sürümü) burada YENİDEN YAZILMAZ.
const { rozetSurumuOkuEsz } = require('../packaging/motor-surumu');

const DEFAULT_DIR = path.join(os.homedir(), '.empp-agent', 'updates');

/** "60" → "060" (electron.js getCompanyId ile aynı) */
function companyIdFrom(buildDir) {
  try {
    const id = fs.readFileSync(path.join(buildDir, 'kurum.txt'), 'utf8').replace(/\r|\n/g, '').trim();
    return id ? id.padStart(3, '0') : null;
  } catch (e) { return null; }
}

/**
 * "Bu aday elimizdekinden daha yeni mi?" — KARAR. Gövdesi `surum-kiyas.js`'te.
 *
 * 2026-09-21 — KARDEŞ UÇ ONARIMI. Burada eskiden yayıncının electron.js
 * `checkVersion()` davranışının birebir kopyası vardı: "iki taraf da 3 parça
 * DEĞİLSE string farkı = yeni". Aynı gün eklenen `version.txt` normalleştirmesi
 * (commit 07f1d39, 350 MB müşteri indirmesinin kökü) build'in version.txt'sini
 * 3 parçaya indirince, zip adı 4 parçalı kaldığı için kıyas HER KOŞUDA string'e
 * düşüyor ve "yeni" diyordu. ÖLÇÜLDÜ (fixture: build 1.11.5, zip 1.13.1.3):
 * 1., 2. ve 3. `applyPublisherUpdate` çağrısının ÜÇÜ de "uygulandı" döndü —
 * yani aynı ~350 MB zip her paketleme işinde yeniden açılıyordu. Kardeşi
 * `runner.js:cachedZipIsStale` aynı sebeple her işte ~1 GB kaynak indiriyordu.
 *
 * `dahaYeniMi` normalleştirilmiş hâlini aynı sürüm sayar ("1.13.1" ≡ "1.13.1.3")
 * ve belirsiz girdide asla "yeni" demez. Ayrışma ölçüldü: yedi kıyas çiftinin
 * YALNIZ birinde ("1.13.1" ↔ "1.13.1.3") karar değişti; kalan altısı birebir
 * aynı kaldı — bu dar bir düzeltme, davranış yeniden yazımı değil.
 *
 * Ad geriye dönük uyum için korundu (dışa açık; test ve eski çağıranlar kullanır).
 */
function isNewer(current, incoming) {
  return dahaYeniMi(current, incoming);
}

/**
 * HAM ZİP DOSYA ADI sıralaması (`latestLocalUpdate` içindir) — KARAR değil.
 *
 * Ayrıştırma kuralları `surum-kiyas.parcalara`'dan gelir (tek kaynak); ama
 * kanoniklestirme (3 parçaya kırpma) BİLEREK yapılmaz: buradaki iki taraf da
 * diskteki gerçek dosya adıdır, "1.13.1.3.zip" ile "1.13.1.5.zip" AYRI iki
 * dosyadır ve 4. parça GERÇEK bilgidir. Kanonik kıyas ikisini eşit sayar,
 * "en yeni zip" seçimi `readdir` sırasına kalırdı (belirsiz seçim).
 * `dahaYeniMi` ise bir tarafı normalleştirilmiş `version.txt` olan KARAR için
 * kullanılır; orada 4. parça zaten kaybolmuştur.
 */
function cmpVersion(a, b) {
  const pa = parcalara(a) || [];
  const pb = parcalara(b) || [];
  for (let k = 0; k < Math.max(pa.length, pb.length); k++) { const d = (pa[k] || 0) - (pb[k] || 0); if (d) return d; }
  return 0;
}

/** Yerel dizindeki en yeni güncelleme: { version, zipPath } | null */
function latestLocalUpdate(companyId, updateDir = process.env.EMPP_UPDATE_DIR || DEFAULT_DIR) {
  if (!companyId) return null;
  const dir = path.join(updateDir, companyId);
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => /^\d+(\.\d+)*\.zip$/.test(f)); } catch (e) { return null; }
  if (!files.length) return null;
  const best = files.map((f) => f.replace(/\.zip$/, '')).sort(cmpVersion).pop();
  return { version: best, zipPath: path.join(dir, best + '.zip') };
}

function currentVersion(buildDir) {
  try { return fs.readFileSync(path.join(buildDir, 'version.txt'), 'utf8').trim(); } catch (e) { return '1'; }
}

function unzipla(zipPath, hedef) {
  const r = spawnSync('unzip', ['-o', '-q', zipPath, '-d', hedef], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`güncelleme açılamadı (${zipPath} → ${hedef}): ${(r.stderr || '').slice(-300)}`);
}

/**
 * version.txt'yi yazar. 2026-09-21 bug-fix: yayıncının electron.js'i version.txt 3 parça
 * değilse koşulsuz "eski" sayıp 350MB güncellemeyi tekrar tekrar indiriyordu (kök neden:
 * zip adı ham yazılıyordu, örn "1.13.1.3"). Normalize et; edilemiyorsa `onceki`
 * (unzip'ten ÖNCE okunmuş, güvenilir değer) geri yazılır — zip'in kendi içinde bozuk bir
 * version.txt varsa unzip onu zaten açmış olabilir, "dokunma" fail-safe'i bunu da kapsar.
 * `onceki` null ise (dosya hiç yoktu) ve normalleştirilemiyorsa zip'in yazdığına dokunulmaz.
 */
function surumDosyasiYaz(dizin, yeni, onceki) {
  const hedef = path.join(dizin, 'version.txt');
  if (acikMi()) {
    const { deger } = yazilacakSurum(yeni, onceki);
    if (deger !== null) fs.writeFileSync(hedef, deger);
    else if (onceki !== null && onceki !== undefined) fs.writeFileSync(hedef, onceki);
  } else {
    fs.writeFileSync(hedef, yeni);
  }
}

/**
 * Yayıncının SET dalındaki hedefler: kökün `app.config.js` taşıyan DOĞRUDAN alt klasörleri
 * (electron.js downloadUpdates: `readdirSync(dirname,{withFileTypes}).filter(isDirectory)`
 * → `existsSync(<ad>/app.config.js)`). Doğal sıra (book2 < book10).
 */
function setKitapDizinleri(buildDir) {
  let girisler = [];
  try { girisler = fs.readdirSync(buildDir, { withFileTypes: true }); } catch (e) { return []; }
  return girisler
    .filter((g) => g.isDirectory() && fs.existsSync(path.join(buildDir, g.name, 'app.config.js')))
    .map((g) => g.name)
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
}

/**
 * Bir SET kitabının KENDİ okuyucu sürümü.
 *
 * KAYNAK: okuyucu ROZETİ — `bookN/index.html` → `<hash>.main.js` → `e.exports={i8:"X"}`
 * (webpack'in package.json sürümü; sağ alttaki sürüm rozeti de budur). Okuyan:
 * `packaging/motor-surumu.rozetSurumuOkuEsz` (tek kaynak).
 *
 * `bookN/version.txt` BİLEREK KULLANILMAZ — ölçüldü 2026-09-26: 25.09 SM3 build zip'inde
 * üç bookN'in version.txt'si "1.11.5" ama okuyucusu 1.13.3'e yamalı (rozet 1.13.3,
 * bd0c1a4f650802c98ebf.main.js). version.txt'ye güvenmek 1.13.1.3 güncellemesini
 * "yeni" sanıp 1.13.3 okuyucuyu GERİ DÜŞÜRÜRDÜ. Rozet okunamıyorsa sürüm BİLİNMİYOR sayılır.
 * @returns {{surum:string|null, kaynak:string}}
 */
function kitapOkuyucuSurumu(kitapDizini) {
  const r = rozetSurumuOkuEsz(kitapDizini);
  if (parcalara(r.surum)) return { surum: r.surum, kaynak: `rozet ${r.parca}` };
  return {
    surum: null,
    kaynak: r.main ? `rozet okunamadı (${r.main})` : 'rozet okunamadı (index.html/main.js yok)',
  };
}

function varsaOku(dosya) {
  try { return fs.readFileSync(dosya, 'utf8').trim(); } catch (e) { return null; }
}

/**
 * SET DALI (2026-09-26, 73768 Pardus ProBook RED; genişletildi 2026-09-26, 59834 index
 * karışması): kökte app.config.js YOK → güncelleme yalnız app.config.js taşıyan alt
 * klasörlere açılır, köke ASLA açılmaz. Kökte app.config.js VARSA bile en az bir alt
 * kitap dizini (`setKitapDizinleri`) varsa yine bu dal çalışır — yayıncı bazı SET'lerin
 * köküne de `app.config.js` koyabiliyor (59834 v47: `set_app.config` kökte duruyordu);
 * "kökte app.config.js yok" TEK BAŞINA SET testi değildir, alt kitap varlığı esastır.
 *
 * NEDEN: kök index.html set menüsüdür (Web-Z kabuğu). Eski kod zip'i koşulsuz köke açıyor,
 * okuyucunun index.html'i (2.973 B, md5 9f8032915a19f3285dd2e3051ae5acc4) menünün üstüne
 * yazılıyordu; okuyucu SET kökünde app.config.js bulamayıp sonsuza dek "yükleniyor"da
 * kalıyordu. Yayıncının kendi electron.js'i (downloadUpdates, satır 175-186) köke hiç açmaz.
 *
 * Yayıncıdan BİLİNÇLİ SAPMA: yayıncı her bookN'e koşulsuz açar; biz kitabın kendi okuyucu
 * sürümüne bakarız — güncelleme o kitaptan yeni değilse (ya da sürüm bilinmiyorsa)
 * uygulanmaz. Sürüm düşürme yasak.
 *
 * KÖK version.txt KARARI: kitap sonuçlarından bağımsız olarak, normalleştirilmiş
 * güncelleme sürümüne ilerletilir (tek kitaptaki aynı `surumDosyasiYaz` ile). Gerekçe:
 *   1. Yayıncının davranışı: SET dalından sonra `setAppVersion(body)` KÖK version.txt'ye
 *      yazar — kök version.txt "güncelleme kanalı bu sürüme kadar işlendi" damgasıdır.
 *   2. Önbellek anahtarı: `runner.cachedZipIsStale` ve `local-build` zipStale KÖK
 *      version.txt'yi okur. İlerletilmezse (ör. tüm kitaplar 1.13.3 diye atlandığında)
 *      önbellek her işte STALE sayılır → her işte ~1 GB yeniden indirme + aynı sonuç
 *      (kitap kararı deterministik, tekrar koşmak hiçbir şeyi değiştirmez).
 *   3. Kapı m.11 ("Ş kapalı ya da version.txt 3 parçalı"): normalleştirme 3 parça yazar;
 *      Ş (checkForUpdates) pakette `icerik-guncelleme.kanalSKapat` ile kapalı olduğundan
 *      kök version.txt'nin çalışma anında indirme etkisi yoktur.
 * Kök version.txt yalnız isNewer(kök, güncelleme) doğruyken yazılır → asla GERİ gitmez.
 */
function setDaliUygula(buildDir, upd, { from, companyId, log }) {
  const kitaplar = setKitapDizinleri(buildDir);
  const uygulanan = [];
  const atlanan = [];
  for (const kitap of kitaplar) {
    const dizin = path.join(buildDir, kitap);
    const s = kitapOkuyucuSurumu(dizin);
    if (!s.surum) {
      atlanan.push({ kitap, surum: null, kaynak: s.kaynak, neden: 'sürüm bilinmiyor' });
      log(`⚠️ yayıncı güncellemesi ${upd.version} ${kitap}/ klasörüne UYGULANMADI: okuyucu `
        + `sürümü belirlenemedi (${s.kaynak}) — sürüm düşürme riski, bilinçli atlandı`);
      continue;
    }
    if (!dahaYeniMi(s.surum, upd.version)) {
      atlanan.push({
        kitap, surum: s.surum, kaynak: s.kaynak,
        neden: `kitap okuyucusu ${s.surum} ≥ güncelleme ${upd.version} (sürüm düşürme yasak)`,
      });
      continue;
    }
    const oncekiTxt = varsaOku(path.join(dizin, 'version.txt'));
    unzipla(upd.zipPath, dizin);
    surumDosyasiYaz(dizin, upd.version, oncekiTxt);
    uygulanan.push({ kitap, once: s.surum, kaynak: s.kaynak });
  }
  surumDosyasiYaz(buildDir, upd.version, from);
  if (!kitaplar.length) {
    log(`⚠️ yayıncı güncellemesi ${upd.version} HİÇBİR YERE açılmadı: kökte app.config.js yok `
      + 've app.config.js taşıyan alt klasör de yok (kök ASLA ezilmez)');
  }
  const parcaUyg = uygulanan.map((u) => `${u.kitap} ${u.once}→${upd.version}`).join(', ');
  const parcaAtl = atlanan.map((a) => `${a.kitap}: ${a.neden}${a.surum ? '' : ` [${a.kaynak}]`}`).join('; ');
  const reason = `SET (kök korunur): ${uygulanan.length}/${kitaplar.length} kitaba uygulandı`
    + (parcaUyg ? ` [${parcaUyg}]` : '')
    + (parcaAtl ? `; atlandı: ${parcaAtl}` : '');
  return {
    applied: uygulanan.length > 0, from, to: upd.version, companyId, reason,
    set: true, uygulanan, atlanan,
  };
}

/**
 * Uygular; dönüş: { applied, from, to, companyId, reason, set, uygulanan, atlanan }.
 *   - SET (alt kitap dizini VAR): bkz. `setDaliUygula` — köke asla açılmaz. Bu karar
 *     kökte `app.config.js` olup olmamasından ÖNCE gelir (2026-09-26, 59834 dersi):
 *     yayıncı bir SET'in köküne de `app.config.js` bırakabiliyor; tek başına o dosyanın
 *     varlığı "tek kitap" anlamına gelmez.
 *   - Tek kitap (alt kitap dizini YOK, kökte app.config.js VAR): zip build köküne
 *     açılır — electron.js extractAllTo(dirname, true). Bugünkü davranış aynen.
 * `uygulanan`: [{kitap, once, kaynak}] ('.' = kök/tek kitap); `atlanan`: [{kitap, surum, kaynak, neden}].
 * opts: { updateDir?, log?(satır) } — log varsayılanı console.warn (atlama GÖRÜNÜR olmalı).
 */
function applyPublisherUpdate(buildDir, opts = {}) {
  const log = typeof opts.log === 'function' ? opts.log : (satir) => console.warn(satir);
  const companyId = companyIdFrom(buildDir);
  const from = currentVersion(buildDir);
  const upd = latestLocalUpdate(companyId, opts.updateDir);
  if (!upd) return { applied: false, from, to: null, companyId, reason: companyId ? 'yerel güncelleme yok' : 'kurum.txt yok' };
  if (!isNewer(from, upd.version)) return { applied: false, from, to: upd.version, companyId, reason: 'zaten güncel' };
  const kokAppConfigYok = !fs.existsSync(path.join(buildDir, 'app.config.js'));
  const setKitaplari = setKitapDizinleri(buildDir);
  if (kokAppConfigYok || setKitaplari.length) {
    return setDaliUygula(buildDir, upd, { from, companyId, log });
  }
  unzipla(upd.zipPath, buildDir);
  surumDosyasiYaz(buildDir, upd.version, from);
  return {
    applied: true, from, to: upd.version, companyId, reason: 'uygulandı',
    set: false, uygulanan: [{ kitap: '.', once: from, kaynak: 'version.txt' }], atlanan: [],
  };
}

module.exports = {
  applyPublisherUpdate, latestLocalUpdate, isNewer, companyIdFrom, currentVersion, DEFAULT_DIR,
  setKitapDizinleri, kitapOkuyucuSurumu,
};

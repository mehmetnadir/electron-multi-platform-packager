'use strict';

/**
 * HARF KAPISI — referans ↔ dosya adı büyük/küçük harf uyuşmazlığı.
 *
 * ─────────────────────────────── NEDEN VAR ───────────────────────────────
 *
 * macOS (APFS) ve Windows (NTFS) dosya sistemleri harf DUYARSIZ; Linux (ext4)
 * DUYARLIDIR. Üretim bu Mac'te koştuğu için `core/kurumLogo.png` referansı
 * diskteki `core/kurumlogo.png` dosyasını sessizce bulur ve paketleme yeşil
 * biter. Aynı ağaç Pardus'ta (.impark / AppImage) açıldığında dosya YOKTUR.
 *
 * ÖLÇÜLDÜ (2026-09-21, HP ProBook / Pardus ETAP 23, ext4):
 *
 *   · "Shall We 6 Set - Maarif Model" .impark → `resources/app.asar` (899 MB,
 *     3822 dosya). asar indeksi bir JS nesnesidir; Electron yol çözümlemesini
 *     TAM DİZİ EŞLEŞMESİYLE yapar — yani asar içinde harf duyarlılığı her
 *     platformda geçerlidir. İndekste `kurumLogo.png` HİÇ YOK; yalnız
 *     `book1..book4/core/kurumlogo.png` ve `core/kurumlogo.png` var.
 *     `book1/index.html` ise `./core/kurumLogo.png` istiyor. → GERÇEK EKSİK.
 *
 *   · "SM4-v49" .impark (eski İmpark hattı, core.zip + book.zip) → AppRun iki
 *     zip'i AYNI dizine açıyor. Pardus'ta ölçüldü: `core/kurumLogo.png` (30718 B,
 *     md5 cb036683…, core.zip'ten) VE `core/kurumlogo.png` (13642 B, md5 8e2b3b6b…,
 *     book.zip'ten) YAN YANA duruyor. Aynı çıkarma macOS'ta TEK dosya bırakıyor
 *     (13642 B, md5 8e2b3b6b…) — yani referans aynı adla iki platformda FARKLI
 *     BAYTA çözülüyor. Bu ikinci sınıf: "çakışma" (bkz. `harfCakismalari`).
 *
 * ─────────────────────────────── HANGİ UÇ DÜZELTİLİR ───────────────────────────────
 *
 * Bu depo NE `index.html`i NE de `core/kurumlogo.png`i üretir — ikisi de
 * yayıncının kendi web derlemesinden (webpack, hash'li adlar) ve zkitap
 * içeriğinden gelir. Yani "kaynağı üretenin tarafı" bizim dışımızdadır ve
 * kaynakta İKİ UÇ ZATEN ÇELİŞİYOR: `index.html` → `kurumLogo.png`,
 * `app.config.js` → `kurumlogo.png`, diskte → `kurumlogo.png`.
 *
 * Bu yüzden düzeltme ucu REFERANSTIR, dosya değil:
 *   · Diskteki baytı değiştirmez / çoğaltmaz (kopya dosya sonraki güncellemede
 *     ıraksar ve çakışma sınıfını BÜYÜTÜR — `kardes-verb-kor-noktasi`).
 *   · Ölçüme bağlıdır: yalnız "tam yol YOK + tek harf varyantı VAR" halinde
 *     yazar. Varyant yoksa (dosya gerçekten yok) ya da birden çok varyant varsa
 *     DOKUNMAZ, rapor eder — kör yeniden adlandırma yapmaz.
 *   · Eski hattın ağaçlarında (core.zip'li, capital dosya gerçekten var)
 *     hiçbir şey yapmaz; referans zaten çözülüyordur.
 *
 * ─────────────────────────────── NEREYE BAĞLI ───────────────────────────────
 *
 * `packagingService.js` içinde, TÜM yamalardan SONRA ve platform fan-out'undan
 * ÖNCE, `workingPath` üzerinde TEK noktadan çağrılır — `yayinci-domain-yamasi`
 * ile aynı gerekçe (K16): platform başına ayrı çağrı fan-out sapması üretir.
 * `scripts/windows-paket-kapisi.js` YANLIŞ yerdir: o yalnız Windows .exe'sini
 * ölçer, Pardus/.impark ve macOS/.dmg oradan hiç geçmez.
 *
 * Kapı varsayılan AÇIK ve ONARICIDIR (`onar`). Env ile mod:
 *   EMPP_HARF_KAPISI=0       → tamamen kapalı (no-op)
 *   EMPP_HARF_KAPISI=uyar    → yalnız rapor, dosya yazma yok
 *   EMPP_HARF_KAPISI=dusur   → uyuşmazlık varsa hata fırlat (üretim düşsün)
 *   (tanımsız / başka)       → onar (varsayılan)
 *
 * BAĞIMLILIK KURALI: yalnız Node stdlib (fs/promises, path). `set-kabuk.js`
 * ile aynı söz — kapı betikleri `fs-extra` çekemez.
 */

const fs = require('fs').promises;
const path = require('path');

/** Taranan metin dosyası uzantıları. */
const TARANAN = new Set(['.html', '.htm', '.css']);

/** Referans çıkarımı: HTML src/href, CSS url(). */
const KALIP_HTML = /(?:src|href)\s*=\s*["']([^"']+)["']/gi;
const KALIP_CSS = /url\(\s*["']?([^"')]+)["']?\s*\)/gi;

/**
 * Denetim DIŞI referanslar. Bunlar dosya sistemine çözülmez:
 * şema'lı URL (http:, https:, data:, file:, mailto:, javascript:),
 * protokole bağlı (//cdn…), yalnız fragment (#x), boş.
 */
const DIS_REFERANS = /^(?:[a-z][a-z0-9+.\-]*:|\/\/|#|\s*$)/i;

/**
 * Bir referansı yola indirger: sorgu (`?v=2`) ve fragment (`#frag`) atılır,
 * yüzde kodlaması çözülür. Çözülemezse ham yol döner.
 */
function yolaIndirge(ham) {
  const yol = String(ham).split('#')[0].split('?')[0];
  try {
    return decodeURIComponent(yol);
  } catch (e) {
    return yol;
  }
}

/**
 * Denetlenmeli mi? Dış URL / mutlak yol (`/x`) / boş → hayır.
 * Mutlak yol denetlenmez: paket içinde kökün nereye düştüğü çalışma anında belirlenir.
 */
function denetlenirMi(ham) {
  if (typeof ham !== 'string') return false;
  const s = ham.trim();
  if (!s) return false;
  if (DIS_REFERANS.test(s)) return false;
  if (s.startsWith('/')) return false;
  const yol = yolaIndirge(s);
  return yol.length > 0;
}

/** Bir dosyadan (içerik + uzantı) referansları çıkarır. */
function referanslariCikar(icerik, uzanti) {
  const cikti = [];
  const ekle = (kalip) => {
    kalip.lastIndex = 0;
    let m;
    while ((m = kalip.exec(icerik)) !== null) cikti.push(m[1]);
  };
  if (uzanti === '.html' || uzanti === '.htm') {
    ekle(KALIP_HTML);
    ekle(KALIP_CSS); // gömülü <style>
  } else {
    ekle(KALIP_CSS);
  }
  return cikti;
}

/**
 * Ağacın dosya indeksi. Döner: { gercek: Set<relYol>, kucuk: Map<lowerRel, [relYol…]> }
 * Yollar POSIX ('/') ayraçlıdır. `node_modules` atlanır.
 */
async function agacIndeksi(kok) {
  const gercek = new Set();
  const kucuk = new Map();
  async function gez(dizin) {
    let girdiler;
    try {
      girdiler = await fs.readdir(dizin, { withFileTypes: true });
    } catch (e) {
      return;
    }
    for (const g of girdiler) {
      if (g.name === 'node_modules' || g.name === '.git') continue;
      const tam = path.join(dizin, g.name);
      if (g.isDirectory()) {
        await gez(tam);
      } else if (g.isFile() || g.isSymbolicLink()) {
        const rel = path.relative(kok, tam).split(path.sep).join('/');
        gercek.add(rel);
        const k = rel.toLowerCase();
        if (!kucuk.has(k)) kucuk.set(k, []);
        kucuk.get(k).push(rel);
      }
    }
  }
  await gez(kok);
  return { gercek, kucuk };
}

/**
 * Diskte yalnız harfiyle ayrışan dosya çiftleri (aynı dizinde `a.png` + `A.png`).
 * macOS/Windows'ta bunlar TEK dosyaya çöker — hangi baytın kazandığı yazma
 * sırasına bağlıdır. Linux'ta ikisi de durur. Sınıfın kendisi arızadır.
 */
function harfCakismalari(indeks) {
  const cikti = [];
  for (const [kucukAd, liste] of indeks.kucuk) {
    if (liste.length > 1) cikti.push({ kucuk: kucukAd, adlar: liste.slice().sort() });
  }
  return cikti.sort((a, b) => a.kucuk.localeCompare(b.kucuk));
}

/**
 * Tek bir referansı sınıflandırır — DİSK İNDEKSİNE karşı, harf DUYARLI.
 * (fs.existsSync kullanılmaz: macOS'ta duyarsızdır ve ölçümü yalanlar.)
 *
 * Döner: { durum, yol, hedef?, oneri? }
 *   durum ∈ 'ATLANDI' | 'TAM' | 'HARF' | 'YOK' | 'DISARI'
 */
function referansCozumle(kaynakRel, ham, indeks) {
  if (!denetlenirMi(ham)) return { durum: 'ATLANDI', yol: ham };
  const yol = yolaIndirge(ham);
  const dizin = path.posix.dirname(kaynakRel.split(path.sep).join('/'));
  const birlesik = path.posix.normalize(
    dizin === '.' ? yol : `${dizin}/${yol}`
  );
  if (birlesik.startsWith('..')) return { durum: 'DISARI', yol: birlesik };
  if (indeks.gercek.has(birlesik)) return { durum: 'TAM', yol: birlesik };
  const varyantlar = indeks.kucuk.get(birlesik.toLowerCase());
  if (varyantlar && varyantlar.length === 1) {
    return { durum: 'HARF', yol: birlesik, hedef: varyantlar[0], oneri: varyantlar[0] };
  }
  if (varyantlar && varyantlar.length > 1) {
    // Birden çok varyant: hangisinin kastedildiği ÖLÇÜLEMEZ → dokunma, rapor et.
    return { durum: 'HARF', yol: birlesik, hedef: null, varyantlar: varyantlar.slice() };
  }
  return { durum: 'YOK', yol: birlesik };
}

/** Env'den mod okur. */
function modOku(env) {
  const ham = env && env.EMPP_HARF_KAPISI;
  if (ham === undefined || ham === null || ham === '') return 'onar';
  const s = String(ham).trim().toLowerCase();
  if (s === '0' || s === 'false' || s === 'kapali' || s === 'kapalı') return 'kapali';
  if (s === 'uyar' || s === 'warn') return 'uyar';
  if (s === 'dusur' || s === 'düşür' || s === 'fail') return 'dusur';
  return 'onar';
}

function acikMi(env) {
  return modOku(env || process.env) !== 'kapali';
}

/**
 * Ağacı tarar. Dosyaya YAZMAZ — saf ölçüm.
 * Döner: { taranan, toplam, tam, atlandi, disari, harf: [...], yok: [...], cakisma: [...] }
 */
async function tara(kok) {
  const indeks = await agacIndeksi(kok);
  const sonuc = {
    taranan: 0, toplam: 0, tam: 0, atlandi: 0, disari: 0,
    harf: [], yok: [], cakisma: harfCakismalari(indeks),
  };
  for (const rel of indeks.gercek) {
    const uz = path.posix.extname(rel).toLowerCase();
    if (!TARANAN.has(uz)) continue;
    let icerik;
    try {
      icerik = await fs.readFile(path.join(kok, rel.split('/').join(path.sep)), 'utf8');
    } catch (e) {
      continue;
    }
    sonuc.taranan += 1;
    for (const ham of referanslariCikar(icerik, uz)) {
      sonuc.toplam += 1;
      const c = referansCozumle(rel, ham, indeks);
      if (c.durum === 'TAM') sonuc.tam += 1;
      else if (c.durum === 'ATLANDI') sonuc.atlandi += 1;
      else if (c.durum === 'DISARI') sonuc.disari += 1;
      else if (c.durum === 'HARF') sonuc.harf.push({ dosya: rel, referans: ham, ...c });
      else sonuc.yok.push({ dosya: rel, referans: ham, ...c });
    }
  }
  return sonuc;
}

/**
 * Bir dosyadaki referansı, yalnız o referans metnini değiştirerek onarır.
 * `eski`nin yalnız TAM eşleşmeleri değişir; sorgu/fragment korunur.
 * Döner: onarılan referans sayısı.
 */
function metniOnar(icerik, eskiReferans, yeniYolParcasi) {
  // Referansın yol kısmını değiştir, ?…/#… kuyruğunu koru.
  const kuyrukIdx = Math.min(
    ...[eskiReferans.indexOf('?'), eskiReferans.indexOf('#')]
      .map((i) => (i === -1 ? eskiReferans.length : i))
  );
  const yolKismi = eskiReferans.slice(0, kuyrukIdx);
  const kuyruk = eskiReferans.slice(kuyrukIdx);
  // Sadece yol kısmının son bileşen(ler)ini değiştiriyoruz: tam referansı yeniden kur.
  const onEk = yolKismi.startsWith('./') ? './' : (yolKismi.startsWith('../') ? yolKismi.match(/^(\.\.\/)+/)[0] : '');
  const yeniRef = onEk + yeniYolParcasi + kuyruk;
  if (yeniRef === eskiReferans) return { icerik, sayi: 0 };
  let sayi = 0;
  const kacir = eskiReferans.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Tırnak sınırları içinde tam eşleşme — rastgele alt dize yakalamayı önler.
  const yeni = icerik.replace(new RegExp(`(["'])${kacir}\\1`, 'g'), (m, q) => {
    sayi += 1;
    return `${q}${yeniRef}${q}`;
  });
  return { icerik: yeni, sayi, yeniRef };
}

/**
 * Paketleme çağrı noktası. Tarar, moda göre onarır / uyarır / düşürür.
 * `log` verilirse tek satırlık özet basar.
 */
async function paketeUygula(kok, secenekler = {}) {
  const env = secenekler.env || process.env;
  const mod = modOku(env);
  const log = secenekler.log || (() => {});
  if (mod === 'kapali') return { mod, uygulandi: false, sonuc: null };

  const sonuc = await tara(kok);
  const onarilabilir = sonuc.harf.filter((h) => h.hedef);
  const belirsiz = sonuc.harf.filter((h) => !h.hedef);
  let onarilan = 0;

  if (mod === 'onar' && onarilabilir.length) {
    // Dosya başına grupla — her dosya bir kez okunup bir kez yazılsın.
    const gruplar = new Map();
    for (const h of onarilabilir) {
      if (!gruplar.has(h.dosya)) gruplar.set(h.dosya, []);
      gruplar.get(h.dosya).push(h);
    }
    for (const [rel, liste] of gruplar) {
      const tamYol = path.join(kok, rel.split('/').join(path.sep));
      let icerik = await fs.readFile(tamYol, 'utf8');
      for (const h of liste) {
        // Referansın disk üzerindeki doğru karşılığı → kaynak dosyaya göre göreli yol.
        const dizin = path.posix.dirname(rel);
        const yeniGoreli = dizin === '.'
          ? h.hedef
          : path.posix.relative(dizin, h.hedef);
        const r = metniOnar(icerik, h.referans, yeniGoreli);
        if (r.sayi) { icerik = r.icerik; onarilan += r.sayi; h.yazilan = r.yeniRef; }
      }
      await fs.writeFile(tamYol, icerik, 'utf8');
    }
  }

  const ozet = `🔤 Harf kapısı (${mod}): ${sonuc.taranan} dosya, ${sonuc.toplam} referans — `
    + `${sonuc.tam} tam, ${sonuc.harf.length} harf farkı`
    + (onarilan ? ` (${onarilan} onarıldı)` : '')
    + (belirsiz.length ? `, ${belirsiz.length} belirsiz` : '')
    + (sonuc.cakisma.length ? `, ${sonuc.cakisma.length} disk çakışması` : '');
  log(ozet);
  for (const h of sonuc.harf) {
    log(`   · ${h.dosya}: "${h.referans}" → diskte "${h.hedef || h.varyantlar.join(' | ')}"`);
  }
  for (const c of sonuc.cakisma) {
    log(`   ⚠ disk çakışması (Linux'ta iki dosya, macOS/Windows'ta tek): ${c.adlar.join(' | ')}`);
  }

  if (mod === 'dusur' && (sonuc.harf.length || sonuc.cakisma.length)) {
    const e = new Error(
      `Harf kapısı DÜŞÜRDÜ: ${sonuc.harf.length} referans harf farkıyla kırık, `
      + `${sonuc.cakisma.length} disk çakışması. Pardus (.impark) bu ağaçta kırılır.`
    );
    e.harfSonucu = sonuc;
    throw e;
  }

  return { mod, uygulandi: true, onarilan, sonuc, ozet };
}

/* ══════════════════════════ ZIP ÇAKIŞMA KAPISI (2026-09-21) ══════════════════════════
 *
 * NEDEN AYRI BİR SINIF: Yukarıdaki kapı ÜRETİM AĞACINI ölçer. Eski İmpark hattının
 * arızası üretim ağacında YOKTUR — AppRun'ın ÇALIŞMA ANINDAKİ çok-zip çıkarmasında
 * doğar: iki (veya daha çok) zip AYNI dizine açılır, `unzip -o` ile son açılan kazanır.
 *
 * ÖLÇÜLDÜ (2026-09-21, HP ProBook / Pardus ETAP 23, ext4 — `SM4-v49.impark`):
 *
 *   AppRun:  unzip -o zkitap.zip → $zkitapPath
 *            unzip -o core.zip   → $assetsPath      (IS_SET=false iken)
 *            unzip -o book.zip   → $assetsPath      ← AYNI HEDEF
 *
 *   core.zip 186 dosya · book.zip 511 dosya
 *   · TAM YOL kesişimi              171
 *       – içerik aynı (crc+boyut)   132
 *       – içerik FARKLI              39   → sıraya bağlı; book son açıldığı için book kazanır
 *   · YALNIZ HARF farkıyla çakışma    1   → `core/kurumLogo.png` (core.zip, 30718 B,
 *                                          md5 cb036683…) ve `core/kurumlogo.png`
 *                                          (book.zip, 13642 B, md5 8e2b3b6b…)
 *
 * HANGİ ZIP KAZANMALI — ölçümle (tahminle değil):
 *   · `version.txt`  core=1.11.3, book=1.11.5                     → book daha yeni
 *   · `index.html`   core → `5c4759d5….main.js` (yalnız core'da),
 *                    book → `42c86ce0….main.js` (yalnız book'ta)  → çalışan motor book'unki;
 *                    core'un bundle'ı açıldıktan sonra ölü ağırlık kalıyor
 *   · `core/backgrounds/reals/*.jpg` core 7812×4320, book 1953×1080 → book bilinçli küçültme
 *   ⇒ TAM YOL çakışmalarında **book.zip kazanmalı** ve bugün zaten kazanıyor
 *     (core önce, book sonra, `unzip -o`). Yani sıra doğru ama KORUMASIZ.
 *
 *   · Harf çakışmasında KAZANAN YOK: tek referans (`index.html` → `./core/kurumLogo.png`,
 *     HER İKİ sürümde de büyük L) Linux'ta core.zip'in 512×355 dosyasına, harf duyarsız
 *     dosya sisteminde book.zip'in 300×200 baytına çözülür. book.zip TEK BAŞINA bu
 *     referansı karşılayamıyor — AppRun'da `IS_SET=true` iken core.zip hiç açılmaz ve
 *     dosya TAMAMEN yok olur (set paketlerinde ölçülen "kurumLogo.png asar'da HİÇ YOK"
 *     bulgusu bununla aynı kök). Bu ucun doğru düzeltmesi zip değil REFERANS'tır —
 *     yukarıdaki `paketeUygula` onu zaten `kurumlogo.png`ye çeviriyor.
 *
 * NEDEN (b) ŞIKKI, DARALTILMIŞ HALİYLE:
 *   (a) "çıkarma sırasını sabitle" tek başına kırılgandır ve harf çakışmasını HİÇ
 *       çözmez (Linux'ta sıradan bağımsız iki dosya da durur).
 *   (c) AppRun'ı raporlatmak arızayı müşteri makinesinde, kurulum anında gösterir —
 *       üretimde değil; ayrıca eski hattın AppRun'ını bu depo üretmiyor.
 *   (b) üretimde engelle — ama "kesişim boş olmalı" kuralı ÖLÇÜMLE ÇÜRÜDÜ: core.zip'in
 *       186 dosyasının 171'i zaten book.zip'te var, bu TASARIM. Boş-kesişim şartı her
 *       eski hat paketini düşürürdü. Bu yüzden kural daraltıldı:
 *         · YALNIZ HARF farkıyla çakışma  → ARIZA (sessizce yanlış bayt; düşür)
 *         · zip okunamadı                 → ÖLÇÜLEMEDİ (asla "temiz" sayılmaz; düşür)
 *         · tam yol çakışması             → RAPOR (sıra belirler; sıra ölçüldü ve doğru)
 *
 * NEREYE BAĞLI: `customizeAppImage` içinde, AppRun yazıldıktan SONRA ve `appimagetool`
 * yeniden paketlemesinden ÖNCE. Plan AppRun'ın KENDİ metninden çıkarılır (`apprunZipPlani`)
 * — hangi zip'in nereye açıldığı tahmin edilmez, okunur. Tek zip açan AppRun'da (bu deponun
 * bugünkü hattı) grup oluşmaz, kapı no-op'tur; ikinci bir zip aynı hedefe eklenirse anında
 * görünür.
 *
 * Mod: EMPP_ZIP_KAPISI=0|uyar|dusur — verilmezse EMPP_HARF_KAPISI'ndan türetilir
 * (kapali→kapali, uyar→uyar, onar/dusur/tanımsız→dusur). Zip içeriği ONARILMAZ:
 * baytı değiştirmek `kardes-verb-kor-noktasi` sınıfını büyütür.
 *
 * BAĞIMLILIK KURALI: yalnız Node stdlib. Zip merkezî dizini elle okunur (aşağıda).
 */

/** Zip imzaları. */
const EOCD_IMZA = 0x06054b50;
const Z64_LOC_IMZA = 0x07064b50;
const Z64_EOCD_IMZA = 0x06064b50;
const CD_IMZA = 0x02014b50;

/**
 * Bir zip'in MERKEZÎ DİZİNİNİ okur (içerik açılmaz — yalnız indeks).
 * Döner: Map<ad, { crc, boyut }>; dizin girdileri atlanır.
 * Okunamazsa `e.zipOkunamadi = true` işaretli hata fırlatır — çağıran bunu
 * "temiz" saymaz, "ölçülemedi" sayar.
 */
async function zipIndeksi(zipYolu) {
  const hata = (mesaj) => {
    const e = new Error(`zip okunamadı (${path.basename(zipYolu)}): ${mesaj}`);
    e.zipOkunamadi = true;
    return e;
  };
  let fh;
  try {
    fh = await fs.open(zipYolu, 'r');
  } catch (e) {
    throw hata(e.message);
  }
  try {
    const { size } = await fh.stat();
    if (size < 22) throw hata('dosya 22 bayttan küçük (EOCD sığmaz)');

    // EOCD'yi kuyruktan ara (yorum alanı en çok 65535 bayt).
    const kuyrukUzunluk = Math.min(size, 22 + 65535);
    const kuyruk = Buffer.alloc(kuyrukUzunluk);
    await fh.read(kuyruk, 0, kuyrukUzunluk, size - kuyrukUzunluk);
    let eocd = -1;
    for (let i = kuyruk.length - 22; i >= 0; i--) {
      if (kuyruk.readUInt32LE(i) === EOCD_IMZA) { eocd = i; break; }
    }
    if (eocd < 0) throw hata('EOCD imzası yok (zip değil ya da kesik)');

    let girdiSayisi = kuyruk.readUInt16LE(eocd + 10);
    let cdBoyut = kuyruk.readUInt32LE(eocd + 12);
    let cdOfset = kuyruk.readUInt32LE(eocd + 16);

    // ZIP64: alanlar doyduysa ZIP64 EOCD'ye geç.
    if (girdiSayisi === 0xffff || cdBoyut === 0xffffffff || cdOfset === 0xffffffff) {
      const locIdx = eocd - 20;
      if (locIdx < 0 || kuyruk.readUInt32LE(locIdx) !== Z64_LOC_IMZA) {
        throw hata('ZIP64 alanı dolu ama ZIP64 locator yok');
      }
      const z64Ofset = Number(kuyruk.readBigUInt64LE(locIdx + 8));
      const z64 = Buffer.alloc(56);
      await fh.read(z64, 0, 56, z64Ofset);
      if (z64.readUInt32LE(0) !== Z64_EOCD_IMZA) throw hata('ZIP64 EOCD imzası yanlış');
      girdiSayisi = Number(z64.readBigUInt64LE(32));
      cdBoyut = Number(z64.readBigUInt64LE(40));
      cdOfset = Number(z64.readBigUInt64LE(48));
    }
    if (cdOfset + cdBoyut > size) throw hata('merkezî dizin dosya sınırının dışında (kesik)');

    const cd = Buffer.alloc(cdBoyut);
    await fh.read(cd, 0, cdBoyut, cdOfset);

    const indeks = new Map();
    let p = 0;
    for (let n = 0; n < girdiSayisi; n++) {
      if (p + 46 > cd.length) throw hata(`merkezî dizin ${n}. girdide bitti`);
      if (cd.readUInt32LE(p) !== CD_IMZA) throw hata(`${n}. girdide merkezî dizin imzası yok`);
      const crc = cd.readUInt32LE(p + 16);
      let boyut = cd.readUInt32LE(p + 24);
      const adUz = cd.readUInt16LE(p + 28);
      const ekUz = cd.readUInt16LE(p + 30);
      const yorumUz = cd.readUInt16LE(p + 32);
      const ad = cd.toString('utf8', p + 46, p + 46 + adUz);
      if (boyut === 0xffffffff) {
        // ZIP64 ek alanından gerçek boyutu çek (0x0001 başlığı).
        let q = p + 46 + adUz;
        const son = q + ekUz;
        while (q + 4 <= son) {
          const bas = cd.readUInt16LE(q);
          const uz = cd.readUInt16LE(q + 2);
          if (bas === 0x0001 && uz >= 8) boyut = Number(cd.readBigUInt64LE(q + 4));
          q += 4 + uz;
        }
      }
      if (!ad.endsWith('/')) indeks.set(ad, { crc, boyut });
      p += 46 + adUz + ekUz + yorumUz;
    }
    return indeks;
  } finally {
    await fh.close().catch(() => {});
  }
}

/** Kabuk betiğinden `AD="değer"` / `AD=değer` atamalarını toplar. */
function kabukDegiskenleri(icerik) {
  const harita = new Map();
  const kalip = /^[ \t]*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/gm;
  let m;
  while ((m = kalip.exec(icerik)) !== null) {
    let ham = m[2].trim();
    if (!/^["']/.test(ham)) ham = ham.split('#')[0].trim();
    if ((ham.startsWith('"') && ham.endsWith('"') && ham.length > 1)
      || (ham.startsWith("'") && ham.endsWith("'") && ham.length > 1)) {
      ham = ham.slice(1, -1);
    }
    harita.set(m[1], ham);
  }
  return harita;
}

/** `$AD` / `${AD}` genişletir (döngüye karşı sınırlı derinlik). */
function degiskenGenislet(metin, harita, derinlik = 8) {
  let s = String(metin);
  for (let i = 0; i < derinlik; i++) {
    const yeni = s.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g,
      (tam, a, b) => {
        const ad = a || b;
        return harita.has(ad) ? harita.get(ad) : tam;
      });
    if (yeni === s) break;
    s = yeni;
  }
  return s;
}

/**
 * AppRun metninden ÇIKARMA PLANINI okur — tahmin etmez, betiğin kendisini okur.
 * Yakalanan çağrı: `unzip_and_show_progress <zip> <hedef> …` ve düz `unzip … -d <hedef>`.
 * Döner: [{ zip, zipAd, hedef }] — betikteki SIRAYLA (son açılan kazanır).
 */
function apprunZipPlani(icerik) {
  const harita = kabukDegiskenleri(icerik);
  const plan = [];
  const soy = (s) => degiskenGenislet(String(s).replace(/^["']|["']$/g, ''), harita);
  const adAl = (zip) => path.posix.basename(zip.split('\\').join('/'));

  const kalipYardimci = /^[ \t]*unzip_and_show_progress[ \t]+("[^"]*"|'[^']*'|\S+)[ \t]+("[^"]*"|'[^']*'|\S+)/gm;
  let m;
  while ((m = kalipYardimci.exec(icerik)) !== null) {
    const zip = soy(m[1]);
    plan.push({ zip, zipAd: adAl(zip), hedef: soy(m[2]) });
  }
  const kalipDuz = /^[ \t]*unzip\b[^\n]*?("[^"]*\.zip"|'[^']*\.zip'|\S+\.zip)[^\n]*?-d[ \t]+("[^"]*"|'[^']*'|\S+)/gm;
  while ((m = kalipDuz.exec(icerik)) !== null) {
    const zip = soy(m[1]);
    if (plan.some((p) => p.zip === zip)) continue;
    plan.push({ zip, zipAd: adAl(zip), hedef: soy(m[2]) });
  }
  return plan;
}

/**
 * Aynı hedefe açılan zip'lerin çakışma raporu. `yollar` ÇIKARMA SIRASINDADIR
 * (son açılan kazanır). Saf ölçüm — hiçbir dosyaya dokunmaz.
 */
async function zipCakismalari(yollar) {
  const zipler = [];
  const indeksler = [];
  for (const y of yollar) {
    const ad = path.basename(y);
    try {
      const ix = await zipIndeksi(y);
      zipler.push({ ad, yol: y, okundu: true, dosyaSayisi: ix.size });
      indeksler.push({ ad, ix });
    } catch (e) {
      zipler.push({ ad, yol: y, okundu: false, hata: e.message });
    }
  }
  const okunamayan = zipler.filter((z) => !z.okundu);

  // TAM YOL çakışmaları
  const sahipler = new Map();
  for (const { ad, ix } of indeksler) {
    for (const [yol, bilgi] of ix) {
      if (!sahipler.has(yol)) sahipler.set(yol, []);
      sahipler.get(yol).push({ zip: ad, crc: bilgi.crc, boyut: bilgi.boyut });
    }
  }
  const tam = [];
  for (const [yol, liste] of sahipler) {
    if (liste.length < 2) continue;
    const ilk = liste[0];
    const icerikAyni = liste.every((x) => x.crc === ilk.crc && x.boyut === ilk.boyut);
    tam.push({
      yol,
      kaynaklar: liste.map((x) => x.zip),
      icerikAyni,
      kazanan: liste[liste.length - 1].zip,
      ayrinti: liste,
    });
  }
  tam.sort((a, b) => a.yol.localeCompare(b.yol));

  // YALNIZ HARF farkıyla çakışma: küçük harfe indirgenince aynı, tam yol farklı.
  const kucukHarita = new Map();
  for (const { ad, ix } of indeksler) {
    for (const yol of ix.keys()) {
      const k = yol.toLowerCase();
      if (!kucukHarita.has(k)) kucukHarita.set(k, []);
      kucukHarita.get(k).push({ zip: ad, yol });
    }
  }
  const harf = [];
  for (const [kucuk, girdiler] of kucukHarita) {
    const adlar = new Set(girdiler.map((g) => g.yol));
    if (adlar.size > 1) harf.push({ kucuk, girdiler: girdiler.slice(), adlar: [...adlar].sort() });
  }
  harf.sort((a, b) => a.kucuk.localeCompare(b.kucuk));

  const icerikFarkli = tam.filter((t) => !t.icerikAyni);
  return {
    zipler,
    okunamayan,
    tam,
    tamSayi: tam.length,
    icerikAyniSayi: tam.length - icerikFarkli.length,
    icerikFarkliSayi: icerikFarkli.length,
    icerikFarkli,
    harf,
    harfSayi: harf.length,
    // "Temiz" YALNIZ her zip okunduysa ve harf çakışması yoksa. Tam yol çakışması
    // sırayla çözülür (ölçüldü) — arıza değil, rapor.
    temizMi: okunamayan.length === 0 && harf.length === 0,
  };
}

/** Zip kapısının modunu okur (EMPP_ZIP_KAPISI > EMPP_HARF_KAPISI türetmesi). */
function zipModOku(env) {
  const e = env || process.env;
  const ham = e.EMPP_ZIP_KAPISI;
  if (ham !== undefined && ham !== null && ham !== '') {
    const s = String(ham).trim().toLowerCase();
    if (s === '0' || s === 'false' || s === 'kapali' || s === 'kapalı') return 'kapali';
    if (s === 'uyar' || s === 'warn') return 'uyar';
    return 'dusur';
  }
  const t = modOku(e); // kapali | uyar | onar | dusur
  if (t === 'kapali') return 'kapali';
  if (t === 'uyar') return 'uyar';
  return 'dusur'; // onar ve dusur → zip'te onarım yoktur, düşür
}

/**
 * ZIP KAPISI — bir AppDir'de AppRun'ın aynı hedefe açtığı zip gruplarını ölçer.
 *
 * `secenekler.appRun` : AppRun metni (verilmezse `<dizin>/AppRun` okunur)
 * `secenekler.plan`   : hazır plan (test için)
 * `secenekler.env`    : mod kaynağı
 * `secenekler.log`    : tek satırlık özet basıcı
 *
 * Döner: { mod, uygulandi, gruplar, ozet }. `dusur` modunda harf çakışması ya da
 * okunamayan zip varsa hata fırlatır (`e.zipSonucu` doldurulur).
 */
async function zipKapisi(dizin, secenekler = {}) {
  const env = secenekler.env || process.env;
  const mod = zipModOku(env);
  const log = secenekler.log || (() => {});
  if (mod === 'kapali') return { mod, uygulandi: false, gruplar: [] };

  let plan = secenekler.plan;
  if (!plan) {
    let appRun = secenekler.appRun;
    if (appRun === undefined) {
      try {
        appRun = await fs.readFile(path.join(dizin, 'AppRun'), 'utf8');
      } catch (e) {
        log('🗜️ Zip kapısı: AppRun okunamadı, plan çıkarılamadı (atlandı).');
        return { mod, uygulandi: false, gruplar: [], appRunYok: true };
      }
    }
    plan = apprunZipPlani(appRun);
  }

  // Hedefe göre grupla; yalnız 2+ zip'in AYNI hedefe açıldığı gruplar ölçülür.
  const hedefler = new Map();
  for (const adim of plan) {
    if (!hedefler.has(adim.hedef)) hedefler.set(adim.hedef, []);
    hedefler.get(adim.hedef).push(adim);
  }

  const gruplar = [];
  for (const [hedef, adimlar] of hedefler) {
    if (adimlar.length < 2) continue;
    const yollar = adimlar.map((a) => path.join(dizin, a.zipAd));
    const rapor = await zipCakismalari(yollar);
    gruplar.push({ hedef, sira: adimlar.map((a) => a.zipAd), rapor });
  }

  const toplamHarf = gruplar.reduce((t, g) => t + g.rapor.harfSayi, 0);
  const toplamOkunamayan = gruplar.reduce((t, g) => t + g.rapor.okunamayan.length, 0);
  const toplamFarkli = gruplar.reduce((t, g) => t + g.rapor.icerikFarkliSayi, 0);

  const ozet = gruplar.length === 0
    ? `🗜️ Zip kapısı (${mod}): aynı hedefe açılan ikinci zip yok — çakışma imkânsız.`
    : `🗜️ Zip kapısı (${mod}): ${gruplar.length} ortak hedef — `
      + `${gruplar.reduce((t, g) => t + g.rapor.tamSayi, 0)} tam yol çakışması `
      + `(${toplamFarkli} içerik farklı), ${toplamHarf} harf çakışması`
      + (toplamOkunamayan ? `, ${toplamOkunamayan} zip ÖLÇÜLEMEDİ` : '');
  log(ozet);
  for (const g of gruplar) {
    log(`   hedef ${g.hedef} ← ${g.sira.join(' → ')} (son açılan kazanır)`);
    for (const z of g.rapor.okunamayan) log(`   ⛔ ölçülemedi: ${z.ad} — ${z.hata}`);
    for (const h of g.rapor.harf) {
      log(`   ⚠ harf çakışması: ${h.adlar.join(' | ')} — Linux'ta İKİSİ de durur, `
        + 'harf duyarsız sistemde biri diğerini EZER (sessiz yanlış bayt)');
    }
    for (const t of g.rapor.icerikFarkli.slice(0, 20)) {
      log(`   · içerik farklı: ${t.yol} (${t.kaynaklar.join(' → ')}) → kazanan ${t.kazanan}`);
    }
  }

  if (mod === 'dusur' && (toplamHarf || toplamOkunamayan)) {
    const e = new Error(
      `Zip kapısı DÜŞÜRDÜ: ${toplamHarf} harf çakışması, ${toplamOkunamayan} ölçülemeyen zip. `
      + "Aynı hedefe açılan zip'lerde yalnız harfiyle ayrışan yol, harf duyarsız dosya "
      + 'sisteminde sessizce yanlış bayta çözülür (404 değil — YANLIŞ İÇERİK).'
    );
    e.zipSonucu = { gruplar, toplamHarf, toplamOkunamayan, toplamFarkli };
    throw e;
  }

  return { mod, uygulandi: true, gruplar, ozet, toplamHarf, toplamOkunamayan, toplamFarkli };
}

module.exports = {
  acikMi,
  modOku,
  denetlenirMi,
  yolaIndirge,
  referanslariCikar,
  agacIndeksi,
  harfCakismalari,
  referansCozumle,
  metniOnar,
  tara,
  paketeUygula,
  // ── zip çakışma kapısı ──
  zipIndeksi,
  kabukDegiskenleri,
  degiskenGenislet,
  apprunZipPlani,
  zipCakismalari,
  zipModOku,
  zipKapisi,
};

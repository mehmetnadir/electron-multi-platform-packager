'use strict';
/**
 * K16 (2026-09-10, Nadir talebi) — sorucoz.tv → yayıncı domaini URL yeniden yazımı.
 *
 * KAYNAK: `~/01dev/elecron-paket/src/packaging/cevrimdisi-yama.js` (bayat kopya, K17
 * "Çevrimdışı / SET Kitap Açılış Yaması") üç parçalıydı: (1) URL yeniden yazma,
 * (2) version.txt sabitleme, (3) renderer fetch fail-open+timeout shim'i. Bu modül
 * BİLİNÇLİ olarak SADECE (1)'i taşır — Nadir'in politikası (2026-09-10, değişmez):
 * "Versiyon sabitlemesi yapma; sadece yayıncı domaini ile güncelle yeter." (2) ve (3)
 * TAŞINMADI: version.txt'e dokunulmaz, fetch-shim/fail-open eklenmez.
 *
 * NE YAPAR: build içeriğindeki (app.config.js, set_app.config, bookN/ altındakiler,
 * varsa renderer bundle) `(www.)?sorucoz.tv` host'unu, kitabın KENDİ config'inden
 * türetilen YAYINCI host'una (ör. `flashyelt.yayincilik.net`) çevirir. Yayıncı host'u
 * UYDURULMAZ — config'te bulunamazsa NO-OP (tek satır uyarı, sessiz varsayılan YOK).
 *
 * NEDEN: sorucoz.tv Cloudflare arkasında 403 (challenge) dönüyor; yayıncının kendi
 * host'u (yayincilik.net) 200 dönüyor. Bu yeniden yazma, uygulamanın update/servis
 * çağrılarının çalışan bir adrese gitmesini sağlar — sürüm/timeout/fail-open ile
 * ilgisi yok, sadece hedef adres değişir.
 *
 * ENJEKSİYON NOKTASI: `packagingService.js` `startPackaging()` — workingPath tüm
 * platform paketlerine (android/macos/linux) ORTAK olarak hazırlandıktan SONRA,
 * platform fan-out döngüsünden (`for (let i = 0; i < platforms.length ...`) ÖNCE,
 * TEK çağrı. Windows bu adımı ALMAZ (Windows kendi electron-builder hattında ayrı
 * ele alınır; Nadir kararı — bu modülün kapsamı yalnız Windows-dışı platformlardır).
 *
 * IDEMPOTENT: regex tabanlı — bir kez yazıldıktan sonra metinde `sorucoz.tv` kalmaz,
 * ikinci koşu doğal olarak no-op'tur (ayrı bir marker gerekmez; mutasyon testiyle
 * kanıtlı).
 *
 * TAŞINMAYAN PARÇALAR (bilinçli): version.txt sabitleme (SAFE_VERSION/999.0.0) ve
 * renderer fetch fail-open+timeout shim'i (`buildShimHtml`/`injectShim`) bu modülde
 * YOK — Nadir'in açık talimatı yalnız domain/URL güncellemesidir.
 *
 * @see /Users/nadir/01dev/elecron-paket/src/packaging/cevrimdisi-yama.js (kaynak, salt-okunur referans)
 */

const fs = require('fs-extra');
const path = require('path');

// sorucoz.tv (www'li/www'siz) — update ve servis host'u
const SORUCOZ_RE = /(?:www\.)?sorucoz\.tv/gi;

// Yayıncı host türetme kaynakları (config'in KENDİ içinden — UYDURULMAZ)
const APITEMPLATE_HOST_RE =
  /testSolutionVideo\s*:\s*\{[\s\S]*?apiTemplate\s*:\s*["']https?:\/\/([^/"'\s]+)/i;
const PUBLISHER_PATTERN_RE = /https?:\/\/([a-z0-9.-]*yayincilik\.net)/i;

// URL yeniden yazma için taranacak metin dosyaları (ikili dosyalara DOKUNULMAZ)
const TEXT_EXTS = new Set(['.js', '.json', '.xml', '.config', '.html', '.htm', '.txt', '.css']);

// Yürüyüşte atlanacak dizinler
const SKIP_DIRS = new Set(['node_modules', '.git', 'temp', 'uploads', 'dist', '.history']);

/**
 * Config metinlerinden yayıncı host'unu türetir (UYDURMAZ).
 * Öncelik: options.publisherHost > testSolutionVideo.apiTemplate host > *.yayincilik.net.
 * sorucoz.tv asla yayıncı host olarak seçilmez.
 * @param {string[]|string} configTexts
 * @param {{publisherHost?:string}} [options]
 * @returns {string|null}
 */
function derivePublisherHost(configTexts, options = {}) {
  if (options.publisherHost && typeof options.publisherHost === 'string') {
    return options.publisherHost.trim() || null;
  }
  const texts = Array.isArray(configTexts) ? configTexts : [configTexts];

  // 1) testSolutionVideo.apiTemplate mutlak URL host'u
  for (const t of texts) {
    if (!t) continue;
    const m = APITEMPLATE_HOST_RE.exec(t);
    if (m && m[1] && !/sorucoz\.tv$/i.test(m[1])) {
      return m[1];
    }
  }
  // 2) *.yayincilik.net kalıbı (sorucoz olmayan)
  for (const t of texts) {
    if (!t) continue;
    const m = PUBLISHER_PATTERN_RE.exec(t);
    if (m && m[1] && !/sorucoz\.tv$/i.test(m[1])) {
      return m[1];
    }
  }
  return null;
}

/**
 * Metindeki (www.)?sorucoz.tv host'unu yayıncı host'u ile değiştirir.
 * Diğer host'lar (dijitap.com, impark.com.tr, localhost) DOKUNULMAZ.
 * @param {string} text
 * @param {string} publisherHost
 * @returns {{text:string, count:number}}
 */
function rewriteHostInText(text, publisherHost) {
  if (!text || !publisherHost) return { text, count: 0 };
  let count = 0;
  const out = text.replace(SORUCOZ_RE, () => {
    count++;
    return publisherHost;
  });
  return { text: out, count };
}

/**
 * Dizini recursive gezip dosya yollarını toplar (SKIP_DIRS hariç).
 * @param {string} dir
 * @param {string[]} [acc]
 * @returns {Promise<string[]>}
 */
async function walk(dir, acc = []) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (e) {
    return acc;
  }
  for (const ent of entries) {
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name)) continue;
      await walk(path.join(dir, ent.name), acc);
    } else if (ent.isFile()) {
      acc.push(path.join(dir, ent.name));
    }
  }
  return acc;
}

/**
 * Bir build DİZİNİNE yayıncı-domain yamasını uygular (yalnız URL yeniden yazma —
 * version.txt/shim YOK). Idempotent. Yayıncı host'u türetilemezse NO-OP + uyarı.
 *
 * @param {string} buildDir
 * @param {{publisherHost?:string, log?:Function}} [options]
 * @returns {Promise<{
 *   changed:boolean, publisherHost:(string|null),
 *   rewrittenFiles:Array<{file:string,count:number}>,
 *   filesChangedCount:number, totalReplacements:number
 * }>}
 */
async function applyPublisherDomainPatch(buildDir, options = {}) {
  const log = typeof options.log === 'function' ? options.log : () => {};
  const summary = {
    changed: false,
    publisherHost: null,
    rewrittenFiles: [],
    filesChangedCount: 0,
    totalReplacements: 0
  };

  if (!buildDir || !(await fs.pathExists(buildDir))) {
    log(`[yayinci-domain-yamasi] build dizini yok: ${buildDir}`);
    return summary;
  }

  const files = await walk(buildDir);

  // --- Yayıncı host'unu config dosyalarından türet (UYDURMAZ) ---
  const configFiles = files.filter((f) => {
    const b = path.basename(f).toLowerCase();
    return b === 'app.config.js' || b === 'set_app.config' || b.endsWith('.config');
  });
  const configTexts = [];
  for (const f of configFiles) {
    try {
      configTexts.push(await fs.readFile(f, 'utf8'));
    } catch (e) {}
  }
  const publisherHost = derivePublisherHost(configTexts, options);
  summary.publisherHost = publisherHost;

  if (!publisherHost) {
    log('[yayinci-domain-yamasi] yayıncı host türetilemedi (config\'te *.yayincilik.net yok) — NO-OP, tahmini host YAZILMADI');
    return summary;
  }

  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (!TEXT_EXTS.has(ext)) continue; // ikili dosyaya dokunma

    let text;
    try {
      text = await fs.readFile(file, 'utf8');
    } catch (e) {
      continue;
    }

    SORUCOZ_RE.lastIndex = 0;
    if (!SORUCOZ_RE.test(text)) continue;
    SORUCOZ_RE.lastIndex = 0;

    const rw = rewriteHostInText(text, publisherHost);
    SORUCOZ_RE.lastIndex = 0;
    if (rw.count === 0) continue;

    try {
      await fs.writeFile(file, rw.text, 'utf8');
      summary.rewrittenFiles.push({ file, count: rw.count });
      summary.filesChangedCount++;
      summary.totalReplacements += rw.count;
      summary.changed = true;
      log(`[yayinci-domain-yamasi] ${rw.count}x sorucoz.tv -> ${publisherHost}: ${file}`);
    } catch (e) {
      log(`[yayinci-domain-yamasi] yazilamadi: ${file} — ${e.message}`);
    }
  }

  log(`[yayinci-domain-yamasi] tamam: ${summary.filesChangedCount} dosyada ${summary.totalReplacements} değişiklik → ${publisherHost}`);
  return summary;
}

module.exports = {
  applyPublisherDomainPatch,
  derivePublisherHost,
  rewriteHostInText,
  SORUCOZ_RE,
  TEXT_EXTS,
  SKIP_DIRS
};

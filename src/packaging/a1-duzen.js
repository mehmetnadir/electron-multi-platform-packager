'use strict';

/**
 * A1 DÜZENİ — 11-12 tek motorlu setler için TEK KAYNAK (2026-10-05).
 * Ölçüm ve karar: `~/.empp-agent/arastirma/set-kabuk-0510/a1-deneme-sonuc.md`.
 *
 * DÜZEN:
 *   app/index.html            ← sf425 kabuğu (kartlar)
 *   app/kapak/index.html      ← motor sayfası; <head> başında SIRAYLA:
 *                                 <base href="../">  → bütün göreli adresler köke çözülür
 *                                 kök betiği          → window.__dirname köke çekilir (Electron fs/getFilePath)
 *                                 empp-*-shim.js       → paketleyici enjekte eder (bu sıradan SONRA)
 *   app/app.config.js, *.js, core/, assets/, classlibraries/ImWin32.dll  ← tek kopya, kökte
 *   kart → kapak/index.html?kapak=<ID>&defaultPageNo=<N>
 *
 * NEDEN ALT DİZİN: motorun ev düğmesi `getParentPath()+"/index.html"`e gider = motor sayfasının
 * dizininin BİR ÜSTÜ. Motor kökte kalırsa uygulama kökünün DIŞINA gider (ölçüldü, s2/s3).
 * NEDEN `kapak/` ALT KİTAP SAYILMAZ: `sub-book-dirs.js` imzası `index.html` + `app.config.js`
 * ister; `kapak/` yalnız `index.html` taşır → `__emppSubBook` yazılmaz, WORK tek kalır.
 *
 * Üç tüketici bu modülü ithal eder (kopya tanım YASAK): `src/agent/set-kabuk-tazele.js` (üretir),
 * `src/packaging/packagingService.js` (shim + setBook), `src/packaging/kok-index-denetimi.js` (denetler).
 * BAĞIMLILIK: Node stdlib + `./set-menu` (motor sayfası imzası `motorKopyasiMi` tek kaynaktan).
 */

const fs = require('fs');
const path = require('path');

const A1_MOTOR_SAYFASI = 'kapak/index.html';
const A1_ISARET = 'data-empp-a1-kok';
const A1_BASE = '<base href="../">';
// Electron'da `window.__dirname` sayfanın dizinidir (kapak/); motor getFilePath ve fs-shim BASE'i
// kökü görsün diye bir üst dizine çekilir. Android/tarayıcıda `require` yok → dokunulmaz.
const A1_KOK_BETIGI = `<script ${A1_ISARET}>try{if(typeof require==='function'&&typeof window.__dirname==='string'`
  + '&&window.__dirname){window.__dirname=require(\'path\').resolve(window.__dirname,\'..\');}}'
  + 'catch(e){console.warn(\'[empp-a1] __dirname köke çekilemedi\',e&&e.message);}</script>';
const A1_BASLIK = A1_BASE + A1_KOK_BETIGI;
const HEAD_RE = /<head\b[^>]*>/i;
const EMPP_SCRIPT_RE = /<script\b[^>]*\bsrc\s*=\s*["'][^"']*\bempp-[a-z0-9-]+\.js["'][^>]*>\s*<\/script\s*>/gi;

/** Motor sayfasına A1 başlığını ekler. İdempotent. Sayfada zaten <base> varsa HATA. SAF. */
function baslikEkle(motorHtml) {
  const html = String(motorHtml);
  if (html.includes(A1_ISARET)) return html;
  if (/<base\b/i.test(html)) throw new Error('motor sayfasında zaten <base> var — A1 başlığı eklenemez');
  const m = HEAD_RE.exec(html);
  if (!m) return A1_BASLIK + html;
  return html.slice(0, m.index + m[0].length) + A1_BASLIK + html.slice(m.index + m[0].length);
}

/** A1 başlığını çıkarır (kaynak motor sayfasıyla kıyas için). SAF. */
function baslikCikar(html) {
  return String(html).replace(A1_BASLIK, '');
}

/**
 * Shim etiketini kök betiğinin HEMEN ardına yerleştirir (<base> sonrası → `src` köke çözülür).
 * İdempotent. A1 işareti yoksa null (A1 sayfası değil — enjekte etme). SAF.
 */
function shimEkle(html, src) {
  const s = String(html);
  const tag = `<script src="${src}"></script>`;
  if (s.includes(tag)) return s;
  const i = s.indexOf(A1_KOK_BETIGI);
  if (i === -1) return null;
  const son = i + A1_KOK_BETIGI.length;
  return s.slice(0, son) + tag + s.slice(son);
}

/**
 * `kapak/index.html` A1 kuralına uygun mu. Döner ihlal satırları ([] = uygun). SAF.
 * @param {string|null} html
 * @param {{motorMu?: (h: string) => boolean}} [o]
 */
function kapakDenetle(html, o = {}) {
  if (html == null) return [`${A1_MOTOR_SAYFASI} yok`];
  const s = String(html);
  const ihlal = [];
  const m = HEAD_RE.exec(s);
  const bas = m ? m.index + m[0].length : 0;
  if (s.slice(bas).replace(/^\s+/, '').indexOf(A1_BASLIK) !== 0) {
    ihlal.push(`${A1_MOTOR_SAYFASI}: <head> ${A1_BASE} + kök betiğiyle başlamıyor`);
  }
  if ((s.match(/<base\b/gi) || []).length !== 1) ihlal.push(`${A1_MOTOR_SAYFASI}: tam bir <base> olmalı`);
  const isaret = s.indexOf(A1_KOK_BETIGI);
  let r;
  EMPP_SCRIPT_RE.lastIndex = 0;
  while ((r = EMPP_SCRIPT_RE.exec(s))) {
    if (isaret === -1 || r.index < isaret) ihlal.push(`${A1_MOTOR_SAYFASI}: shim <base>/kök betiğinden önce`);
  }
  const motorMu = o.motorMu || require('./set-menu').motorKopyasiMi;
  if (!motorMu(baslikCikar(s).replace(EMPP_SCRIPT_RE, ''))) ihlal.push(`${A1_MOTOR_SAYFASI}: motor sayfası değil`);
  return ihlal;
}

/**
 * Dizin A1 düzeninde mi: `kapak/index.html` (A1 işaretli) + kök `classlibraries/ImWin32.dll`
 * + kök `app.config.js`. I/O (senkron, küçük).
 */
function a1DuzeniMi(kok) {
  return a1Durumu(kok).durum === 'a1';
}

/**
 * Ayrıntılı A1 durumu (Ö3, inceleme 05.10 — hata artık sessizce "A1 değil" sayılmaz). I/O.
 *   'degil' — `kapak/index.html` yok ya da A1 işareti taşımıyor (A1 değil, dokunulmaz);
 *   'a1'    — işaretli motor sayfası + kök menü + kök `app.config.js`;
 *   'bozuk' — işaretli sayfa var ama okunamıyor ya da kök menü / `app.config.js` eksik.
 * @returns {{durum: 'degil'|'a1'|'bozuk', neden?: string}}
 */
function a1Durumu(kok) {
  const kapak = path.join(kok, A1_MOTOR_SAYFASI);
  if (!fs.existsSync(kapak)) return { durum: 'degil' };
  let html;
  try { html = fs.readFileSync(kapak, 'utf8'); } catch (e) {
    return { durum: 'bozuk', neden: `${A1_MOTOR_SAYFASI} okunamadı (${e && (e.code || e.message)})` };
  }
  if (!html.includes(A1_ISARET)) return { durum: 'degil' };
  const eksik = [path.join('classlibraries', 'ImWin32.dll'), 'app.config.js']
    .filter((y) => !fs.existsSync(path.join(kok, y)));
  if (eksik.length) return { durum: 'bozuk', neden: `A1 işaretli ama kökte yok: ${eksik.join(', ')}` };
  return { durum: 'a1' };
}

/**
 * Paket ağacı A1 düzenindeyse `kapak/index.html`e shim etiketini (`src` kök-göreli ad) işaretin
 * ardına yazar (geçici dosya + rename). A1 değilse dokunmaz. I/O. Hata FIRLATMAZ (paketleme sürer),
 * ama `log.warn` ile bildirir — sessiz yutma yok.
 * @returns {Promise<{durum: 'a1-degil'|'enjekte'|'zaten-var'|'a1-isareti-yok'|'hata', hata?: string}>}
 */
async function kapakaShimEkle(kok, src, log = console) {
  const d = a1Durumu(kok);
  if (d.durum === 'degil') return { durum: 'a1-degil' };
  if (d.durum === 'bozuk') {
    log.warn(`⚠️ A1 ${A1_MOTOR_SAYFASI}: ${d.neden} — ${src} enjekte edilmedi`);
    return { durum: 'hata', hata: d.neden };
  }
  const yol = path.join(kok, ...A1_MOTOR_SAYFASI.split('/'));
  try {
    const html = fs.readFileSync(yol, 'utf8');
    if (html.includes(`<script src="${src}"></script>`)) return { durum: 'zaten-var' };
    const yeni = shimEkle(html, src);
    if (yeni == null) {
      log.warn(`⚠️ A1 ${A1_MOTOR_SAYFASI}: işaret yok, ${src} enjekte edilmedi`);
      return { durum: 'a1-isareti-yok' };
    }
    fs.writeFileSync(`${yol}.empp-tmp`, yeni);
    fs.renameSync(`${yol}.empp-tmp`, yol);
    log.log(`✅ ${src} A1 ${A1_MOTOR_SAYFASI}'e (<base> sonrası) enjekte edildi`);
    return { durum: 'enjekte' };
  } catch (e) {
    log.warn(`⚠️ A1 ${A1_MOTOR_SAYFASI}: ${src} enjeksiyonu başarısız:`, e && e.message);
    return { durum: 'hata', hata: String(e && e.message) };
  }
}

/**
 * Fail-closed sarmalayıcı (Ö3): A1 düzeninde shim motor sayfasına GİRMEDİYSE paket DÜŞER (hata
 * fırlatır). Enjeksiyondan SONRA sayfayı yeniden okur: shim etiketi var ve `kapakDenetle` temiz
 * olmalı (kök index denetimi Android'de enjeksiyondan önce koşar — sırayı bu adım kapatır).
 * A1 değilse dokunmaz.
 * @returns {Promise<{durum: string}>}
 */
async function kapakShimZorunlu(kok, src, log = console) {
  const r = await kapakaShimEkle(kok, src, log);
  if (r.durum === 'a1-degil') return r;
  if (r.durum !== 'enjekte' && r.durum !== 'zaten-var') {
    throw new Error(`A1 ${A1_MOTOR_SAYFASI}: ${src} enjekte edilemedi (${r.durum}${r.hata ? `: ${r.hata}` : ''}) `
      + '— shim\'siz motor sayfası anahtarı salt-okunur pakete yazmaya çalışır; paket düşürüldü');
  }
  const html = fs.readFileSync(path.join(kok, ...A1_MOTOR_SAYFASI.split('/')), 'utf8');
  const ihlal = A1.kapakDenetle(html);
  if (!html.includes(`<script src="${src}"></script>`)) ihlal.push(`${src} etiketi yok`);
  if (ihlal.length) {
    throw new Error(`A1 ${A1_MOTOR_SAYFASI} enjeksiyon sonrası geçersiz: ${ihlal.join('; ')} — paket düşürüldü`);
  }
  return r;
}

const A1 = {
  A1_MOTOR_SAYFASI, A1_ISARET, A1_BASE, A1_KOK_BETIGI, A1_BASLIK,
  baslikEkle, baslikCikar, shimEkle, kapakDenetle, a1DuzeniMi, a1Durumu, kapakaShimEkle, kapakShimZorunlu,
};
module.exports = A1;

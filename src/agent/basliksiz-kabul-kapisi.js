'use strict';
/**
 * BAŞSIZ KABUL KAPISI — runner bağlantısı (Nadir 2026-09-26).
 *
 * Üretilen paket (DMG · APK · NSIS · .impark) R2'ye YÜKLENMEDEN önce bu Mac'te, odak
 * çalmadan açılıp ölçülür: `tools/kabul/basliksiz-kabul.js`. Doğuş: 26.09'da SET kökü
 * ezilmiş 73768 mac/android paketleri kabulsüz R2'ye gitti.
 *
 * Bayrak: `EMPP_BASLIKSIZ_KABUL=1` (varsayılan KAPALI — kapalıyken davranış birebir eski).
 *   EMPP_BASLIKSIZ_KABUL_PLATFORMLAR  virgüllü liste (varsayılan: macos,android,windows,pardus)
 *   EMPP_BASLIKSIZ_KABUL_CIHAZ=0      Android emülatör katmanını atla (yalnız Electron katmanı)
 *   AGENT_BASLIKSIZ_KABUL_TIMEOUT_MS  kapı süre tavanı (varsayılan 20 dk)
 *
 * Sonuç → davranış:
 *   0 GEÇTİ       → yükleme sürer
 *   1 RED         → HATA fırlatılır, paket R2'ye YÜKLENMEZ (iş failed — gerçek paket kusuru)
 *   3 ÖLÇÜLEMEDİ / zaman aşımı / başlatılamadı
 *                 → HATA fırlatılır (yükleme YOK) ama `BASLIKSIZ_KABUL_ISARETI` ile: bu paket
 *                   kusuru DEĞİL (Electron/emülatör/hdiutil altyapısı), `failed` yazılmaz,
 *                   kira dolunca iş kuyruğa döner — ProBook erişilemezliğiyle aynı ayrım.
 */
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { BASLIKSIZ_KABUL_ISARETI } = require('./runner-helpers');

const VARSAYILAN_PLATFORMLAR = ['macos', 'android', 'windows', 'pardus'];
const CLI = path.join(__dirname, '..', '..', 'tools', 'kabul', 'basliksiz-kabul.js');

/** Bayrak + platform listesine göre kapı bu işte koşar mı? Saf. */
function kapiEtkinMi(platform, env = process.env) {
  if (env.EMPP_BASLIKSIZ_KABUL !== '1') return false;
  const liste = String(env.EMPP_BASLIKSIZ_KABUL_PLATFORMLAR || '')
    .split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  return (liste.length ? liste : VARSAYILAN_PLATFORMLAR).includes(String(platform || '').toLowerCase());
}

/** Kapı CLI argümanları. Saf. `cli` yalnız testlerde sahte kapı için ezilir (Windows şeridi). */
function kapiArgumanlari({ artifactPath, platform, bookId, aktivasyon, calismaDizini, env = process.env, cli = CLI }) {
  const a = [cli, artifactPath, '--platform', platform, '--calisma', calismaDizini, '--tut'];
  if (bookId !== undefined && bookId !== null && bookId !== '') a.push('--kitap-id', String(bookId));
  if (aktivasyon) a.push('--aktivasyon');
  if (platform === 'android' && env.EMPP_BASLIKSIZ_KABUL_CIHAZ === '0') a.push('--cihaz-yok');
  return a;
}

/** Çıkış → karar. Saf. @returns {{durum:'GECTI'|'RED'|'OLCULEMEDI', sebep:string}} */
function sonucYorumla({ kod, zamanAsimi, cikti, hata }, zamanAsimiMs) {
  const son = String(cikti || '').split('\n').filter((l) => /SONUÇ|^\[kabul\]\s+-/.test(l)).slice(0, 6).join(' | ')
    || String(cikti || '').split('\n').filter(Boolean).slice(-3).join(' | ');
  if (hata) return { durum: 'OLCULEMEDI', sebep: `kapı başlatılamadı: ${hata}` };
  if (zamanAsimi) return { durum: 'OLCULEMEDI', sebep: `kapı ${Math.round(zamanAsimiMs / 60000)} dk içinde bitmedi` };
  if (kod === 0) return { durum: 'GECTI', sebep: son };
  if (kod === 1) return { durum: 'RED', sebep: son };
  return { durum: 'OLCULEMEDI', sebep: `rc=${kod}: ${son}` };
}

function varsayilanCalistir(argumanlar, { zamanAsimiMs, env, satir }) {
  return new Promise((coz) => {
    const cocuk = spawn(process.execPath, argumanlar, { env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let cikti = '';
    let tampon = '';
    const isle = (d) => {
      const s = d.toString();
      cikti += s;
      tampon += s;
      const parcalar = tampon.split('\n');
      tampon = parcalar.pop();
      for (const p of parcalar) if (p.trim()) satir(p);
    };
    cocuk.stdout.on('data', isle);
    cocuk.stderr.on('data', isle);
    let zamanAsimi = false;
    const t = setTimeout(() => {
      zamanAsimi = true;
      try { process.kill(-cocuk.pid, 'SIGKILL'); } catch (_) { /* ölü */ }
    }, zamanAsimiMs);
    cocuk.on('error', (e) => { clearTimeout(t); coz({ kod: -1, hata: e.message, cikti }); });
    cocuk.on('exit', (kod) => {
      clearTimeout(t);
      if (tampon.trim()) satir(tampon);
      coz({ kod, zamanAsimi, cikti });
    });
  });
}

/**
 * Kapı olağan dışı bittiyse (zaman aşımı → SIGKILL) kendi kapatamadığı kaynakları bırakır:
 * DMG bağlama noktası ve Android emülatörü. Yalnız KAPININ KENDİ çalışma dizinindeki
 * izlere bakar — başka bir emülatöre/birime dokunmaz.
 */
function artikTemizle(kapiDizini, log = () => {}) {
  const baglama = path.join(kapiDizini, 'dmg-baglama');
  const bagli = spawnSync('mount', [], { encoding: 'utf8' });
  if (bagli.status === 0 && String(bagli.stdout).includes(` on ${baglama} (`)) {
    const d = spawnSync('hdiutil', ['detach', '-force', baglama], { encoding: 'utf8' });
    log(`başsız kabul artığı: DMG ayrıldı (${d.status === 0 ? 'ok' : `rc=${d.status}`})`);
  }
  try {
    const emu = JSON.parse(fs.readFileSync(path.join(kapiDizini, 'emulator.json'), 'utf8'));
    if (emu && emu.pid && !emu.kapandi) {
      try { process.kill(-emu.pid, 'SIGKILL'); log(`başsız kabul artığı: emülatör (${emu.seri}) kapatıldı`); } catch (_) { /* ölü */ }
    }
  } catch (_) { /* emülatör yoktu */ }
}

/**
 * Yüklemeden önce çağrılır. Kapı kapalıysa hiçbir şey yapmaz.
 * @param {{artifactPath:string, platform:string, bookId?:string|number, aktivasyon?:boolean,
 *          calismaDizini:string, log?:Function, env?:object, calistir?:Function}} p
 * @returns {Promise<{atlandi?:boolean, durum?:string}>}
 */
async function basliksizKabulKapisi(p) {
  const env = p.env || process.env;
  const log = p.log || (() => {});
  if (!kapiEtkinMi(p.platform, env)) return { atlandi: true };
  const zamanAsimiMs = Number(env.AGENT_BASLIKSIZ_KABUL_TIMEOUT_MS || 20 * 60 * 1000);
  const kapiDizini = path.join(p.calismaDizini, 'basliksiz-kabul');
  const argumanlar = kapiArgumanlari({ ...p, calismaDizini: kapiDizini, env });
  log(`${p.platform}: başsız kabul kapısı başlıyor (odak çalmadan) —`, argumanlar[0]);
  const calistir = p.calistir || varsayilanCalistir;
  const r = await calistir(argumanlar, { zamanAsimiMs, env, satir: (s) => log('  ', s) });
  const k = sonucYorumla(r, zamanAsimiMs);
  if (r.zamanAsimi || ![0, 1, 3].includes(r.kod)) artikTemizle(kapiDizini, log);
  if (k.durum === 'GECTI') {
    log(`${p.platform}: başsız kabul kapısı GEÇTİ`);
    return { durum: 'GECTI' };
  }
  if (k.durum === 'RED') {
    throw new Error(`${p.platform} paketi başsız kabul kapısından geçemedi (RED) — R2'ye YÜKLENMEDİ: ${k.sebep}`);
  }
  throw new Error(`${BASLIKSIZ_KABUL_ISARETI} başsız kabul ÖLÇÜLEMEDİ — paket kusuru DEĞİL, yükleme YOK, `
    + `iş ertelenmeli: ${k.sebep}`);
}

module.exports = {
  VARSAYILAN_PLATFORMLAR, CLI, kapiEtkinMi, kapiArgumanlari, sonucYorumla, artikTemizle, basliksizKabulKapisi,
};

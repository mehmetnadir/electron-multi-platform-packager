'use strict';
/**
 * BOŞTA KAPISI (13.10, Nadir): "macos paketlemelerini ben bilgisayarda çalışırken, sistem boşta
 * değilse ertele; ben ara verdiysem izleyici devreye girsin, paketleri üretsin. Bilgisayarı ben
 * çalışırken yoğun yük altında bırakma."
 *
 * Kural (yalnız macOS ajanı):
 *   • Kullanıcı ETKİN (son dokunuş < etkinSn) → MEŞGUL: ağır yetenekler (mac, android) ilan
 *     edilmez, yeni iş kiralanmaz. Süren iş durmaz; süreçleri arka plan önceliğine (taskpolicy -b)
 *     iner → kullanıcıya CPU/disk önceliği kalır.
 *   • Kullanıcı BOŞTA (son dokunuş ≥ bostaSn) VE makine yükü düşük → SERBEST: yetenekler ilan
 *     edilir, süren işin önceliği geri açılır (taskpolicy -B).
 *   • Arada (etkinSn..bostaSn) önceki karar korunur (histerezis: kısa duraklama işi açmaz).
 * Ofis kuralı (noter yüklemesi yalnız ofiste) AYRI kapıdır ve aynen sürer (runner-helpers).
 *
 * Bayrak: `~/.empp-agent/mesgulken-uret.istek` → kapı hiç kısmaz (eski davranış).
 * Acil kapatma: EMPP_BOSTA_KAPISI=0. Eşikler: EMPP_BOSTA_SN (600), EMPP_ETKIN_SN (60),
 * EMPP_BOSTA_YUK (çekirdek başına 1 dk yük tavanı, 0.8).
 */

const AGIR_YETENEKLER = new Set(['mac', 'macos', 'android']);

/** ioreg çıktısından HIDIdleTime (ns) → saniye. Bulunamazsa null. SAF. */
function bostaSureCoz(ioregCikti) {
  const m = /"HIDIdleTime"\s*=\s*(\d+)/.exec(String(ioregCikti || ''));
  return m ? Math.floor(Number(m[1]) / 1e9) : null;
}

/**
 * SAF karar. `onceki` = son karar ('mesgul' | 'serbest' | null).
 * @returns {{durum:'mesgul'|'serbest', sebep:string}}
 */
function bostaKarari({ bostaSn, yuk1, cekirdek, onceki = null, esik = {} }) {
  const bostaEsik = esik.bostaSn ?? 600;
  const etkinEsik = esik.etkinSn ?? 60;
  const yukTavan = esik.yukOrani ?? 0.8;
  if (bostaSn === null || bostaSn === undefined || !Number.isFinite(bostaSn)) {
    return { durum: 'serbest', sebep: 'boşta süresi ölçülemedi — kapı engellemez' };
  }
  const yukOrani = cekirdek > 0 ? yuk1 / cekirdek : 0;
  if (bostaSn < etkinEsik) return { durum: 'mesgul', sebep: `kullanıcı etkin (son dokunuş ${bostaSn} sn önce)` };
  if (bostaSn >= bostaEsik) {
    if (yukOrani > yukTavan) {
      return {
        durum: 'mesgul',
        sebep: `kullanıcı boşta ama makine yüklü (yük/çekirdek ${yukOrani.toFixed(2)} > ${yukTavan})`,
      };
    }
    return { durum: 'serbest', sebep: `kullanıcı ${Math.round(bostaSn / 60)} dk boşta, yük/çekirdek ${yukOrani.toFixed(2)}` };
  }
  const durum = onceki || 'mesgul';
  return { durum, sebep: `ara bölge (${bostaSn} sn boşta) — önceki karar: ${durum}` };
}

/** Meşgulken ağır yetenekleri süzer. SAF. */
function bostaKapisiUygula(caps, durum) {
  if (durum !== 'mesgul') return caps;
  return caps.filter((c) => !AGIR_YETENEKLER.has(c));
}

/** Paketleme süreçleri (öncelik indirme/geri açma hedefi). */
const AGIR_SUREC_DESENI = 'electron-builder|app-builder|GradleDaemon|gradlew|hdiutil|notarytool|7za';

/**
 * Durumu ölçen + süren işin önceliğini ayarlayan izleyici. Bağımlılıklar test için enjekte edilir.
 * `durum()` 30 sn önbellekli; geçişte (mesgul↔serbest) süreç önceliği değişir ve günlüğe yazılır.
 */
function bostaIzleyicisiKur(dep = {}) {
  const cp = dep.cp || require('child_process');
  const os = dep.os || require('os');
  const fs = dep.fs || require('fs');
  const log = dep.log || (() => {});
  const simdi = dep.simdi || (() => Date.now());
  const env = dep.env || process.env;
  const platform = dep.platform || process.platform;
  const bayrak = dep.bayrak
    || require('path').join(os.homedir(), '.empp-agent', 'mesgulken-uret.istek');
  let son = { t: 0, durum: null, sebep: '' };

  const bostaSnOlc = () => {
    try {
      const out = cp.execFileSync('ioreg', ['-c', 'IOHIDSystem', '-d', '4'], { timeout: 5000, encoding: 'utf8' });
      return bostaSureCoz(out);
    } catch {
      return null;
    }
  };

  const oncelikAyarla = (arkaPlan) => {
    let pidler = [];
    try {
      pidler = String(cp.execFileSync('pgrep', ['-f', AGIR_SUREC_DESENI], { timeout: 5000, encoding: 'utf8' }))
        .split('\n').map((s) => s.trim()).filter(Boolean);
    } catch {
      pidler = []; // pgrep eşleşme yoksa rc=1
    }
    for (const pid of pidler) {
      try {
        cp.execFileSync('taskpolicy', [arkaPlan ? '-b' : '-B', '-p', pid], { timeout: 5000 });
      } catch { /* süreç bitmiş olabilir */ }
    }
    return pidler.length;
  };

  function durum() {
    if (platform !== 'darwin' || env.EMPP_BOSTA_KAPISI === '0') return { durum: 'serbest', sebep: 'kapı kapalı' };
    let serbestBayrak = false;
    try { serbestBayrak = fs.existsSync(bayrak); } catch { serbestBayrak = false; }
    if (serbestBayrak) return { durum: 'serbest', sebep: 'mesgulken-uret.istek bayrağı' };
    const t = simdi();
    if (son.durum && t - son.t < 30000) return son;
    const k = bostaKarari({
      bostaSn: bostaSnOlc(),
      yuk1: os.loadavg()[0],
      cekirdek: os.cpus().length,
      onceki: son.durum,
      esik: {
        bostaSn: Number(env.EMPP_BOSTA_SN) || 600,
        etkinSn: Number(env.EMPP_ETKIN_SN) || 60,
        yukOrani: Number(env.EMPP_BOSTA_YUK) || 0.8,
      },
    });
    if (k.durum !== son.durum) {
      const ilkSerbest = son.durum === null && k.durum === 'serbest';
      const n = ilkSerbest ? 0 : oncelikAyarla(k.durum === 'mesgul');
      const ek = n ? ` · ${n} süreç ${k.durum === 'mesgul' ? 'arka plan önceliğine indi' : 'önceliği açıldı'}` : '';
      log(`[bosta] ${son.durum || 'başlangıç'} → ${k.durum}: ${k.sebep}${ek}`);
    }
    son = { t, ...k };
    return son;
  }

  return { durum };
}

module.exports = { bostaSureCoz, bostaKarari, bostaKapisiUygula, bostaIzleyicisiKur, AGIR_YETENEKLER };

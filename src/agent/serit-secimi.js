'use strict';
/**
 * Pardus şerit seçimi — ProBook birincil, Mac docker yedek (plan karar 2, 2026-09-24:
 * "otomatik, eşikli — nabız 10 dk yok ya da disk kapısı düşük → Mac docker şeridi;
 * olay + ntfy; ProBook dönünce yeni işler ona").
 *
 * İki katman:
 *  - `seritKarari` SAF karar fonksiyonu (zaman/girdi dışarıdan; yan etki yok).
 *  - `nabizOkuyucu` ProBook'un `~/empp-serit/log/nabiz.json`'unu ssh (Tailscale) ile okur,
 *    60 sn önbellekler; komut çalıştırıcı enjekte edilir (test).
 * Mac ajanına bağlantı (2026-09-26): runner.js `guncelYetenekler` → `seritDenetcisiKur`.
 * Açma anahtarı `EMPP_PROBOOK_SERIT=1` (kod varsayılanı KAPALI; run-agent.sh'ta açılır).
 * Karar olay döngüsünü BLOKLAMAZ: nabız async okunur, heartbeat son kararı kullanır.
 *
 * Neden "restart sayacı / süreç var" DEĞİL nabız zamanı: `restart-always-olmayan-dosyayi-
 * diriltir` dersi — ayakta görünen ama iş yapmayan kopya sağlık sayılmaz. Nabız, ProBook
 * ajanının sarmalayıcısı tarafından her 60 sn yazılır ve runner süreci ölünce durur.
 */

const ESIK_MS = 10 * 60 * 1000;
const DISK_MIN_GB = 25; // Bloktest 2,2 GB × 5 + 10 GB taban ≈ 21 GB (plan B.3) → yuvarlak pay
const DOLULUK_MAX = 85;

/** nabiz.json metnini güvenle ayrıştırır; bozuk/boş → null. */
function nabizAyristir(metin) {
  if (typeof metin !== 'string' || !metin.trim()) return null;
  try {
    const o = JSON.parse(metin);
    if (!o || typeof o !== 'object') return null;
    const t = Date.parse(o.zaman);
    if (!Number.isFinite(t)) return null;
    return { ...o, zamanMs: t };
  } catch (_) {
    return null;
  }
}

/**
 * @param {object} p
 * @param {object|null} p.nabiz            nabizAyristir çıktısı (null = okunamadı)
 * @param {number} p.simdi                 ms
 * @param {boolean|null} [p.oncekiMacAlir] önceki karar (olay üretimi için)
 * @param {number|null} [p.sunucuSonGorulmeMs] sunucu ajan listesindeki son görülme (varsa)
 * @param {string|null} [p.arsivOzeti]     Mac kaynak arşivinin özeti (null = kıyas yok)
 * @param {string|null} [p.motorSha12]     Mac 43e23 motor kanoniğinin doğrulanmış sha12'si
 *                                         (null = kıyas yok)
 * @returns {{macPardusAlsin:boolean, probookSaglikli:boolean, sebep:string, olay:null|'devir'|'geri-birak'}}
 */
function seritKarari({
  nabiz, simdi, oncekiMacAlir = null, sunucuSonGorulmeMs = null, arsivOzeti = null,
  motorSha12 = null,
  esikMs = ESIK_MS, diskMinGb = DISK_MIN_GB, dolulukMax = DOLULUK_MAX,
}) {
  let sebep = '';
  if (!nabiz) sebep = 'nabız okunamadı';
  else if (simdi - nabiz.zamanMs > esikMs) {
    sebep = `nabız bayat (${Math.round((simdi - nabiz.zamanMs) / 60000)} dk)`;
  } else if (nabiz.ajan && nabiz.ajan !== 'active') sebep = `ajan ${nabiz.ajan}`;
  // API (2026-09-26): ProBook ajanı kendi jetonuyla sunucuya ulaşamıyorsa iş kiralayamaz —
  // nabız taze ve süreç ayakta olsa bile şerit ölü. Alan yoksa (eski nabız) engellemez.
  else if (nabiz.api && nabiz.api !== 'ok') sebep = `ProBook API ${nabiz.api}`;
  // Kaynak arşivi (2026-09-26): ProBook'un arşivi Mac'inkinden farklıysa ProBook arşivdeki bir
  // kitabı İmpark exe'sinden (ESKİ arayüz) üretebilir. Fark varken Mac alır.
  else if (arsivOzeti && nabiz.arsivOzeti && nabiz.arsivOzeti !== arsivOzeti) {
    sebep = `kaynak arşivi farklı (ProBook ${String(nabiz.arsivOzeti).slice(0, 8)} ≠ Mac ${String(arsivOzeti).slice(0, 8)})`;
  } else if (arsivOzeti && !nabiz.arsivOzeti) sebep = 'ProBook kaynak arşivi özeti yok';
  // Motor (2026-09-26, E3): iki şeridin 43e23 kanoniği eşit değilse aynı kaynak iki makinede farklı
  // motorla paketlenir (ProBook'ta kanonik yoksa motor HİÇ değişmez). Mac kanoniği otorite; Mac'te
  // yoksa kıyas yok (Mac'e devretmek daha iyi bir motor getirmez).
  else if (motorSha12 && nabiz.motorSha12 && nabiz.motorSha12 !== motorSha12) {
    sebep = `motor kanoniği farklı (ProBook ${nabiz.motorSha12} ≠ Mac ${motorSha12})`;
  } else if (motorSha12 && !nabiz.motorSha12) sebep = 'ProBook motor kanoniği yok';
  else if (Number.isFinite(nabiz.diskBosGb) && nabiz.diskBosGb < diskMinGb) {
    sebep = `disk kapısı düşük (${nabiz.diskBosGb} GB < ${diskMinGb} GB)`;
  } else if (Number.isFinite(nabiz.dolulukYuzde) && nabiz.dolulukYuzde > dolulukMax) {
    sebep = `disk doluluğu %${nabiz.dolulukYuzde} > %${dolulukMax}`;
  } else if (Number.isFinite(sunucuSonGorulmeMs) && simdi - sunucuSonGorulmeMs > esikMs) {
    sebep = `sunucu ajanı ${Math.round((simdi - sunucuSonGorulmeMs) / 60000)} dk görmedi`;
  }
  const probookSaglikli = sebep === '';
  const macPardusAlsin = !probookSaglikli;
  let olay = null;
  if (oncekiMacAlir !== null && oncekiMacAlir !== macPardusAlsin) {
    olay = macPardusAlsin ? 'devir' : 'geri-birak';
  }
  return { macPardusAlsin, probookSaglikli, sebep: sebep || 'ProBook sağlıklı', olay };
}

/** Mac ajanının yetenek listesine kararı uygular: ProBook sağlıklıyken `pardus` düşer. */
function yetenekleriUygula(caps, karar) {
  if (!Array.isArray(caps)) return [];
  if (!karar || karar.macPardusAlsin) return caps.slice();
  return caps.filter((c) => c !== 'pardus');
}

/** Olay için tek satırlık bildirim metni (bildir kosucu). */
function olayMetni(karar) {
  if (karar.olay === 'devir') return `Pardus şeridi Mac'e devredildi — ${karar.sebep}`;
  if (karar.olay === 'geri-birak') return 'Pardus şeridi ProBook\'a döndü — ProBook sağlıklı';
  return '';
}

/**
 * ProBook nabzını ssh ile okuyan, önbellekli okuyucu. `calistir(cmd,args,opts)` →
 * {code, stdout} döndüren senkron fonksiyon (varsayılan child_process.spawnSync).
 */
function nabizOkuyucu({
  host = process.env.EMPP_PROBOOK_HOST || 'etapadmin@100.73.161.76',
  yol = '~/empp-serit/log/nabiz.json',
  onbellekMs = 60000,
  calistir = null,
  saat = () => Date.now(),
} = {}) {
  const run = calistir || ((cmd, args, opts) => {
    const r = require('child_process').spawnSync(cmd, args, { encoding: 'utf8', ...opts });
    return { code: r.status == null ? -1 : r.status, stdout: r.stdout || '' };
  });
  let son = { t: -Infinity, nabiz: null };
  return function oku() {
    const simdi = saat();
    if (simdi - son.t < onbellekMs) return son.nabiz;
    const r = run('ssh', ['-o', 'ConnectTimeout=8', '-o', 'BatchMode=yes', host, `cat ${yol}`], { timeout: 15000 });
    son = { t: simdi, nabiz: r.code === 0 ? nabizAyristir(r.stdout) : null };
    return son.nabiz;
  };
}

/** Mac'ten ProBook'a erişim adresi: açık EMPP_PROBOOK_HOST > run-agent.sh'ın PROBOOK_HOST'u > Tailscale. */
function probookHostSec(env = process.env) {
  if (env.EMPP_PROBOOK_HOST) return env.EMPP_PROBOOK_HOST;
  if (env.PROBOOK_HOST && env.PROBOOK_HOST !== 'yerel') return env.PROBOOK_HOST;
  return 'etapadmin@100.73.161.76';
}

/**
 * ASENKRON nabız okuyucu — runner'ın olay döngüsünü BLOKLAMAZ (spawnSync ssh 15 sn'ye kadar
 * heartbeat/yükleme akışını dondururdu). `dosya` verilirse ssh yerine yerel dosya okunur
 * (test ve teşhis: EMPP_PROBOOK_NABIZ_DOSYA). Hata/zaman aşımı → null (Mac alır).
 */
function nabizOkuyucuAsenkron({
  host = 'etapadmin@100.73.161.76', yol = '~/empp-serit/log/nabiz.json', dosya = '', anahtar = '',
  zamanAsimiMs = 15000, spawnImpl = null,
} = {}) {
  return async function oku() {
    if (dosya) {
      try { return nabizAyristir(await require('fs/promises').readFile(dosya, 'utf8')); } catch (_) { return null; }
    }
    const sp = spawnImpl || require('child_process').spawn;
    const args = ['-o', 'ConnectTimeout=8', '-o', 'BatchMode=yes', ...(anahtar ? ['-i', anahtar] : []), host, `cat ${yol}`];
    return new Promise((resolve) => {
      let out = '';
      let bitti = false;
      const p = sp('ssh', args, { stdio: ['ignore', 'pipe', 'ignore'] });
      const son = (v) => { if (!bitti) { bitti = true; clearTimeout(t); resolve(v); } };
      const t = setTimeout(() => { try { p.kill('SIGKILL'); } catch (_) { /* bitti */ } son(null); }, zamanAsimiMs);
      if (t.unref) t.unref();
      if (p.stdout) p.stdout.on('data', (d) => { out += d; });
      p.on('error', () => son(null));
      p.on('close', (code) => son(code === 0 ? nabizAyristir(out) : null));
    });
  };
}

/**
 * Arşiv eşleyiciyi (tools/probook/arsiv-esle.sh) ARKA PLANDA, en fazla `aralikMs`'de bir
 * başlatır. Betik ProBook ajanını duraklatır → arşivi aktarır → özeti doğrular → duraklatmayı
 * kaldırır; ajan beklemez (detached). Başlatma hatası yalnız loglanır.
 */
function arsivEsleyici({ betik, host, log = () => {}, aralikMs = 10 * 60 * 1000, saat = () => Date.now(), spawnImpl = null } = {}) {
  let son = -Infinity;
  return function tetikle(sebep) {
    const simdi = saat();
    if (!betik || simdi - son < aralikMs) return false;
    son = simdi;
    try {
      const sp = spawnImpl || require('child_process').spawn;
      const p = sp('bash', [betik, '--host', host], { detached: true, stdio: 'ignore' });
      if (p.on) p.on('error', (e) => log(`arşiv eşleme başlatılamadı: ${e.message}`));
      if (p.unref) p.unref();
      log(`kaynak arşivi ProBook'a eşleniyor (arka plan, ${sebep})`);
      return true;
    } catch (e) {
      log(`arşiv eşleme başlatılamadı: ${e.message}`);
      return false;
    }
  };
}

/**
 * Mac ajanının şerit denetçisi. `EMPP_PROBOOK_SERIT=1` DEĞİLSE ya da ajanın yeteneklerinde
 * pardus yoksa null döner (runner davranışı birebir eskisi gibi).
 * - `tazele()` async, kendini `aralikMs` ile kısar, aynı anda tek okuma; sonuç `karar()`.
 * - `uygula(caps)` SENKRON: son kararı uygular. İlk okumadan önce karar yok → Mac alır.
 * - Olay (devir / geri-bırak) → `log` + `olayBildir`. Arşiv ya da motor kanoniği farkında
 *   `arsivEsle` tetiklenir (eşleyici ikisini birlikte taşır).
 */
function seritDenetcisiKur({
  env = process.env, caps = [], okuyucu = null, saat = () => Date.now(), log = () => {},
  olayBildir = null, arsivOzetiFn = null, motorSha12Fn = null, arsivEsle = null, aralikMs = 60000,
} = {}) {
  if (env.EMPP_PROBOOK_SERIT !== '1' || !Array.isArray(caps) || !caps.includes('pardus')) return null;
  const oku = okuyucu || nabizOkuyucuAsenkron({
    host: probookHostSec(env), dosya: env.EMPP_PROBOOK_NABIZ_DOSYA || '', anahtar: env.PROBOOK_KEY || '',
  });
  let karar = null;
  let sonDeneme = -Infinity;
  let suren = null;
  async function tazele({ zorla = false } = {}) {
    // Uçuştaki okuma varsa: normal çağrı onu paylaşır; `zorla` onun BİTMESİNİ bekleyip TAZE okur
    // (uçuştaki okuma zorla çağrısından önceki durumu görmüş olabilir).
    if (suren) {
      if (!zorla) return suren;
      await suren.catch(() => {});
      if (suren) return suren;
    }
    if (!zorla && saat() - sonDeneme < aralikMs) return karar;
    sonDeneme = saat();
    suren = (async () => {
      let nabiz = null;
      try { nabiz = await oku(); } catch (_) { nabiz = null; }
      let arsivOzeti = null;
      try { arsivOzeti = arsivOzetiFn ? arsivOzetiFn() : null; } catch (_) { arsivOzeti = null; }
      let motorSha12 = null;
      try { motorSha12 = motorSha12Fn ? motorSha12Fn() : null; } catch (_) { motorSha12 = null; }
      const yeni = seritKarari({
        nabiz, simdi: saat(), oncekiMacAlir: karar ? karar.macPardusAlsin : null,
        arsivOzeti, motorSha12,
      });
      karar = yeni;
      if (yeni.olay) {
        log(olayMetni(yeni));
        if (olayBildir) { try { olayBildir(yeni); } catch (_) { /* bildirim üretimi düşürmez */ } }
      }
      // Eşleyici arşivle birlikte motor kanoniğini de taşır (arsiv-esle.sh, yalnız LAN).
      if (arsivEsle && nabiz && /kaynak arşivi|arşivi özeti yok|motor kanoniği/.test(yeni.sebep)) {
        arsivEsle(yeni.sebep);
      }
      return karar;
    })().finally(() => { suren = null; });
    return suren;
  }
  return {
    tazele,
    uygula: (c) => yetenekleriUygula(c, karar),
    karar: () => karar,
    ozet: () => (karar ? `${karar.probookSaglikli ? 'ProBook' : 'Mac'} (${karar.sebep})` : 'ölçülmedi'),
  };
}

/** Şerit olayını telefona bildirir (`bildir` ikilisi, kanal `paket`); hata yalnız log'a. */
function olayBildirici({ env = process.env, log = () => {}, spawnImpl = null } = {}) {
  return function bildir(karar) {
    if (env.EMPP_BILDIRIM === '0' || !karar || !karar.olay) return false;
    const ikili = env.EMPP_BILDIR_IKILI || require('path').join(require('os').homedir(), '.local', 'bin', 'bildir');
    try {
      const sp = spawnImpl || require('child_process').spawn;
      const p = sp(ikili, ['paket', olayMetni(karar), '-b', 'Pardus şeridi',
        '-p', karar.olay === 'devir' ? 'yuksek' : 'normal', '-e', 'arrows_counterclockwise'],
      { stdio: 'ignore', detached: true });
      if (p.on) p.on('error', (e) => log(`şerit bildirimi gönderilemedi: ${e.message}`));
      if (p.unref) p.unref();
      return true;
    } catch (e) {
      log(`şerit bildirimi gönderilemedi: ${e.message}`);
      return false;
    }
  };
}

module.exports = {
  ESIK_MS, DISK_MIN_GB, DOLULUK_MAX,
  nabizAyristir, seritKarari, yetenekleriUygula, olayMetni, nabizOkuyucu,
  probookHostSec, nabizOkuyucuAsenkron, arsivEsleyici, seritDenetcisiKur, olayBildirici,
};

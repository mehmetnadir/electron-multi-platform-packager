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
 * Mac ajanına bağlantı runner.js'e (DONDURULMUŞ) yama ile yapılır:
 *   scratchpad/probook-serit/runner-serit-secimi.patch
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
 * @returns {{macPardusAlsin:boolean, probookSaglikli:boolean, sebep:string, olay:null|'devir'|'geri-birak'}}
 */
function seritKarari({
  nabiz, simdi, oncekiMacAlir = null, sunucuSonGorulmeMs = null,
  esikMs = ESIK_MS, diskMinGb = DISK_MIN_GB, dolulukMax = DOLULUK_MAX,
}) {
  let sebep = '';
  if (!nabiz) sebep = 'nabız okunamadı';
  else if (simdi - nabiz.zamanMs > esikMs) {
    sebep = `nabız bayat (${Math.round((simdi - nabiz.zamanMs) / 60000)} dk)`;
  } else if (nabiz.ajan && nabiz.ajan !== 'active') sebep = `ajan ${nabiz.ajan}`;
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

module.exports = {
  ESIK_MS, DISK_MIN_GB, DOLULUK_MAX,
  nabizAyristir, seritKarari, yetenekleriUygula, olayMetni, nabizOkuyucu,
};

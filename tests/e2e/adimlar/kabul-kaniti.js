'use strict';
/**
 * KABUL KANITI OKUYUCU — K3 (kitap açılır, içerik ölçütü) ve K4 (güncellik sorusu) kurulu
 * uygulamada kabul kapısının ürettiği kanıttan okunur. Kapıyı yeniden KOŞMAZ, ProBook'a
 * kurulum yapmaz (salt okuma).
 *
 *   pardus       runner ProBook kapısının (tools/pardus/probook-kabul.sh, KABUL_CDP=1) satırlarını
 *                agent.log'a `[kabul] …` önekiyle yazar (runner.js pardusKabulKapisi). Kitabın SON
 *                pardus işinin bloğundan: `E6: <GECTI|RED|OLCULEMEDI|ATLANDI>` → K3,
 *                `E7: <BOS|DOLU|YOK|OLCULEMEDI|ATLANDI>` → K4, son karar satırı (`KABUL:` / `RED:` /
 *                `GUNCEL-DEGIL:` / `OLCULEMEDI:` / `KABUL (aktivasyon ekrani):`) ve piksel düşürmesi
 *                (`not: E6=RED`).
 *   mac/android  başsız kabul (tools/kabul/basliksiz-kabul.js) kanıtı
 *                ~/.empp-agent/kabul-kanit/<kitap>-<platform>-<YYYYMMDD-HHMMSS>/karar.json.
 *                K3 = katmanlar.icerik (kitap ekranı ölçüldü mü). K4: karar.json'da güncellik
 *                katmanı yoksa KALDI — kapı güncelliği SORMUYOR (T3'ün sorusu tam da bu).
 * Yollar: EMPP_E2E_AGENT_LOG · EMPP_KABUL_KANIT_KOK (basliksiz-kabul.js ile aynı ad).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const O = require('./ortak');

const { DURUM } = O;

function agentLogYolu(env = process.env) {
  return env.EMPP_E2E_AGENT_LOG || path.join(os.homedir(), '.empp-agent', 'agent.log');
}

function kanitKoku(env = process.env) {
  return env.EMPP_KABUL_KANIT_KOK || path.join(os.homedir(), '.empp-agent', 'kabul-kanit');
}

const ISI_BITTI_RE = /job (done|failed): (\S+) (\S+)/;
const KABUL_BASLADI_RE = /pardus: ProBook kabul kapısı başlıyor/;

/**
 * agent.log metninden kitabın SON pardus işinin kabul bloğu. Saf.
 * @returns {null|{satirlar:string[], bitis:string, sonuc:'done'|'failed', zaman:string|null}}
 */
function pardusBlogu(metin, kitap) {
  const l = String(metin || '').split('\n');
  let son = -1;
  for (let i = l.length - 1; i >= 0; i -= 1) {
    const m = ISI_BITTI_RE.exec(l[i]);
    if (m && m[2] === String(kitap) && m[3] === 'pardus') {
      son = i;
      break;
    }
  }
  if (son < 0) return null;
  let bas = 0;
  for (let i = son - 1; i >= 0; i -= 1) {
    if (ISI_BITTI_RE.test(l[i])) {
      bas = i + 1;
      break;
    }
  }
  let kabulBas = -1;
  for (let i = son; i >= bas; i -= 1) {
    if (KABUL_BASLADI_RE.test(l[i])) {
      kabulBas = i;
      break;
    }
  }
  const m = ISI_BITTI_RE.exec(l[son]);
  const zaman = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)/.exec(l[son]);
  return {
    satirlar: kabulBas >= 0 ? l.slice(kabulBas, son + 1) : [l[son]],
    kabulKostu: kabulBas >= 0,
    bitis: l[son],
    sonuc: m[1],
    zaman: zaman ? zaman[1] : null,
  };
}

/** Bloktaki E6/E7 ve son karar. Saf. */
function pardusOzet(satirlar) {
  const o = {
    e6: null,
    e6Sebep: '',
    e6Not: null,
    e7: null,
    e7Ayrinti: '',
    karar: null,
    kararSebep: '',
  };
  for (const s of satirlar || []) {
    let m = /\[kabul\] E6: ([A-Z-]+)(?: — (.*))?$/.exec(s);
    if (m) {
      o.e6 = m[1];
      o.e6Sebep = (m[2] || '').trim();
      continue;
    }
    m = /\[kabul\] E7: ([A-Z-]+)(?: — (.*))?$/.exec(s);
    if (m) {
      o.e7 = m[1];
      o.e7Ayrinti = (m[2] || '').trim();
      continue;
    }
    m = /\[kabul\] not: E6=([A-Z-]+)/.exec(s);
    if (m) o.e6Not = m[1];
    m = /\[kabul\] (KABUL \(aktivasyon ekrani\)|KABUL|RED|GUNCEL-DEGIL|OLCULEMEDI): ?(.*)$/.exec(s);
    if (m) {
      o.karar = m[1] === 'KABUL (aktivasyon ekrani)' ? 'KABUL-AKTIVASYON' : m[1];
      o.kararSebep = (m[2] || '').trim();
    }
  }
  return o;
}

/** Pardus K3 (E6). Saf. */
function k3Pardus(o) {
  if (o.karar === 'KABUL-AKTIVASYON')
    return { durum: DURUM.OLCULEMEDI, sebep: 'aktivasyon ekranı — kitap içeriği doğrulanmadı' };
  if (!o.e6) {
    if (o.karar === 'RED')
      return { durum: DURUM.KALDI, sebep: `kabul RED (E6'ya varmadan): ${o.kararSebep}` };
    if (o.karar === 'OLCULEMEDI') return { durum: DURUM.OLCULEMEDI, sebep: o.kararSebep };
    return {
      durum: DURUM.OLCULEMEDI,
      sebep: 'blokta E6 satırı yok — kapı KABUL_CDP=0 ile koşmuş (yalnız pencere+piksel)',
    };
  }
  if (o.e6 === 'GECTI' && o.e6Not && o.e6Not !== 'GECTI')
    return { durum: DURUM.KALDI, sebep: `E6 kitap ekranı ölçümünde düştü: E6=${o.e6Not}` };
  if (o.e6 === 'GECTI' && o.karar === 'RED')
    return { durum: DURUM.KALDI, sebep: `E6 sonrası kitap ekranında içerik yok: ${o.kararSebep}` };
  if (o.e6 === 'GECTI') return { durum: DURUM.GECTI, sebep: o.e6Sebep };
  if (o.e6 === 'RED') return { durum: DURUM.KALDI, sebep: o.e6Sebep };
  return { durum: DURUM.OLCULEMEDI, sebep: `E6 ${o.e6}: ${o.e6Sebep}` };
}

/** Pardus K4 (E7 — motorun İmpark içerik kanalına sorusu). Saf. */
function k4Pardus(o) {
  if (!o.e7)
    return {
      durum: DURUM.OLCULEMEDI,
      sebep: 'blokta E7 satırı yok (KABUL_CDP=0 ya da aktivasyon ekranı)',
    };
  // kabul-karar.sh: CDP açık + gerçek HOME → E7 güvenilmez (45482 dersi), karar OLCULEMEDI
  if (o.karar === 'OLCULEMEDI' && /ayri evde/i.test(o.kararSebep))
    return { durum: DURUM.OLCULEMEDI, sebep: o.kararSebep };
  if (o.e7 === 'BOS') return { durum: DURUM.GECTI, sebep: `güncel: ${o.e7Ayrinti}` };
  if (o.e7 === 'DOLU') return { durum: DURUM.KALDI, sebep: `GÜNCEL DEĞİL: ${o.e7Ayrinti}` };
  if (o.e7 === 'YOK')
    return { durum: DURUM.OLCULEMEDI, sebep: `motor güncelleme ucunu çağırmadı: ${o.e7Ayrinti}` };
  return { durum: DURUM.OLCULEMEDI, sebep: `E7 ${o.e7}: ${o.e7Ayrinti}` };
}

/** Kitabın en yeni başsız kabul kanıtı. */
function basliksizKanit(kitap, platform, env = process.env) {
  const kok = kanitKoku(env);
  const on = `${kitap}-${platform}-`;
  let adlar = [];
  try {
    adlar = fs
      .readdirSync(kok)
      .filter((f) => f.startsWith(on) && /-\d{8}-\d{6}$/.test(f))
      .sort();
  } catch (_) {
    return { kok, yol: null, karar: null };
  }
  for (let i = adlar.length - 1; i >= 0; i -= 1) {
    const yol = path.join(kok, adlar[i], 'karar.json');
    try {
      return { kok, yol, karar: JSON.parse(fs.readFileSync(yol, 'utf8')) };
    } catch (_) {
      /* karar.json yok/bozuk → bir öncekine */
    }
  }
  return { kok, yol: null, karar: null };
}

/** Başsız kabul K3 (içerik katmanı + kitap ekranı). Saf. */
function k3Basliksiz(karar) {
  const ic = karar && karar.katmanlar ? karar.katmanlar.icerik : null;
  if (!ic) return { durum: DURUM.OLCULEMEDI, sebep: "karar.json'da içerik katmanı yok" };
  const seb = (ic.sebepler || []).join('; ');
  if (ic.durum === 'RED') return { durum: DURUM.KALDI, sebep: seb || 'içerik RED' };
  if (ic.durum !== 'GECTI') return { durum: DURUM.OLCULEMEDI, sebep: seb || `içerik ${ic.durum}` };
  if (!ic.kitap)
    return {
      durum: DURUM.KALDI,
      sebep: 'içerik GEÇTİ ama ilk kitaba girilmedi (kitap ölçümü yok)',
    };
  return {
    durum: DURUM.GECTI,
    sebep: `kitap açıldı: ${ic.kitap.baslik || '?'} (tuval ${ic.kitap.tuval || 0}, sayfa görseli ${ic.kitap.sayfaGorseli || 0})`,
  };
}

/** Başsız kabul K4: güncellik katmanı kapının kararında var mı. Saf. */
function k4Basliksiz(karar) {
  const g = karar && karar.katmanlar ? karar.katmanlar.guncellik : null;
  if (!g)
    return {
      durum: DURUM.KALDI,
      sebep:
        "başsız kabul güncelliği sormuyor: karar.json'da güncellik (G manifesti / İmpark içerik " +
        'kanalı) katmanı yok (tools/kabul/basliksiz-kabul.js)',
    };
  if (g.durum === 'GECTI') return { durum: DURUM.GECTI, sebep: (g.sebepler || []).join('; ') };
  if (g.durum === 'RED') return { durum: DURUM.KALDI, sebep: (g.sebepler || []).join('; ') };
  return { durum: DURUM.OLCULEMEDI, sebep: (g.sebepler || []).join('; ') || String(g.durum) };
}

module.exports = {
  agentLogYolu,
  kanitKoku,
  pardusBlogu,
  pardusOzet,
  k3Pardus,
  k4Pardus,
  basliksizKanit,
  k3Basliksiz,
  k4Basliksiz,
};

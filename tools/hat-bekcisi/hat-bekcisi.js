#!/usr/bin/env node
'use strict';
/**
 * HAT BEKÇİSİ — üretim hattının kendi kendini onarması (Nadir 06.10: "sistem neden işlemiyor …
 * burasının olası tüm arıza senaryolarına karşı güçlü olması şart"). Bugün elle yapılan işleri
 * 10 dk'da bir otomatik yapar. Geçici arıza kendiliğinden onarılır; kalıcı arıza ve ölü ajan
 * bildirilir. Sözleşme bekçisi (ölçüm) ve set-yenile (kaynak yenileme) ile çakışmaz: yalnız
 * takılmış satırlara dokunur.
 *
 *   S1 askıda kur isteği   → mac satırını kuyruğun başına al (tavan: set başına 24 sa'te 2)
 *   S2 geçici hata (failed) → requeue, artan bekleme 10/30/90 dk (tavan: satır başına 24 sa'te 3)
 *   S3 kalıcı hata (failed) → requeue YOK; `bildir kosucu` özeti (aynı satır×hata 24 sa'te 1)
 *   S4 kirası dolmuş running → requeue (tavan: satır başına 24 sa'te 2)
 *   S5 ajan ölü (20 dk)     → `bildir bekci` yüksek, yalnız durum değişince
 *   S6 kasa kod sapması     → runner.js md5 Mac ≠ kasa → `bildir bekci` (dağıtım YOK)
 *   S7 üretim kapısı kapalı → kasa logu 30 dk yalnız "KAPALI" + kabul işçisi 45 dk durgun → bekci
 *   S8 ProBook sürüm        → Mac HEAD ≠ ProBook .serit-surum → kur.sh (pardus derlemesi yoksa)
 *   S9 Android şeridi       → kasa canlı+android ise bayrak 'koy' (Mac durdur), değilse 'kaldir'
 *
 * Her DB yazımından önce mariadb-dump yedeği (Dump completed + INSERT ≥1) ZORUNLU; yedek
 * doğrulanmazsa yazım yok. Eylem kaydı ~/.empp-agent/hat-bekcisi/eylem.jsonl (tavanlar buradan).
 *
 * Kullanım: node tools/hat-bekcisi/hat-bekcisi.js [--uygula | --kuru]   (varsayılan: --uygula)
 * Çıkış: 0 tamam · 1 hata (yedek/DB) · 2 kullanım · 75 kilit dolu.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const SY = require('../set-yenile/set-yenile');

const CIKIS = Object.freeze({ TAMAM: 0, HATA: 1, KULLANIM: 2, KILIT: 75 });
const DK = 60 * 1000;
const SA24 = 24 * 60 * DK;
const TAVAN = Object.freeze({ gecici: 3, kur: 2, kira: 2 });
const BEKLEME_DK = Object.freeze([10, 30, 90]);
const KUR_YAS_DK = 20;
const KIRA_TOLERANS_DK = 15;
const AJAN_ESIK_DK = 20;
const KAPI_PENCERE_DK = 30;
const KABUL_DURGUN_DK = 45;
const KILIT_ESKI_MS = 20 * DK;
const TUR = Object.freeze({ gecici: 'gecici-requeue', kur: 'kur-oncelik', kira: 'kira-requeue' });
const SSH_ORTAK = ['-o', 'ControlPath=none', '-o', 'ConnectTimeout=10', '-o', 'BatchMode=yes'];
const AJANLAR = Object.freeze([
  { ad: 'kasa', desen: /windows-kasa/i },
  { ad: 'mac', desen: /macbook/i },
  { ad: 'probook', desen: /probook/i },
]);

// ─── Hata sınıflandırıcı (SAF) — kalıp listesi TEK yerde ───────────────────────────────────

/** Kalıcı: tekrar denemek işe yaramaz. Önce bunlar denenir. */
const KALICI_KALIPLAR = Object.freeze([
  { etiket: 'kabul-kaldi', re: /\bKALDI\b/ },
  { etiket: 'kapi-red', re: /\bRED\b/ },
  { etiket: 'kaynak-iceriksiz', re: /kaynak-iceriksiz/i },
  { etiket: 'http-4xx', re: /\bHTTP (?!408\b|425\b|429\b)4\d\d\b/ },
]);
/** Geçici: ağ/sunucu dalgalanması. */
const GECICI_KALIPLAR = Object.freeze([
  { etiket: 'ag-soket', re: /\b(EADDRNOTAVAIL|ECONNRESET|ETIMEDOUT|ECONNREFUSED|ENETUNREACH|EAI_AGAIN|EPIPE)\b/ },
  { etiket: 'ag-soket', re: /socket hang up/i },
  { etiket: 'fetch', re: /\bfetch failed\b/i },
  { etiket: 'http-5xx', re: /\bHTTP (5\d\d|408|425|429)\b/ },
  { etiket: 'kaynak-r2-ag', re: /\[kaynak-r2\][^\n]*(?:^|[^\p{L}])(?:ağ|ag|network)(?![\p{L}])/iu },
]);

/** @returns {{sinif:'gecici'|'kalici'|'bilinmeyen', etiket:string}} */
function hataSinifla(metin) {
  const m = String(metin == null ? '' : metin);
  if (!m.trim()) return { sinif: 'bilinmeyen', etiket: 'bos' };
  for (const k of KALICI_KALIPLAR) if (k.re.test(m)) return { sinif: 'kalici', etiket: k.etiket };
  for (const k of GECICI_KALIPLAR) if (k.re.test(m)) return { sinif: 'gecici', etiket: k.etiket };
  return { sinif: 'bilinmeyen', etiket: 'bilinmeyen' };
}

// ─── Zaman ve tavan (SAF) ─────────────────────────────────────────────────────────────────

const DB_Z = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/;
function dbMs(s) {
  const m = DB_Z.exec(String(s || '').trim());
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}
/** DB zamanı a → b arası dakika (b − a). Biri çözülemezse null. */
function dkFark(a, b) {
  const x = dbMs(a); const y = dbMs(b);
  return x == null || y == null ? null : (y - x) / DK;
}

/** Defter: satır başına JSON. Bozuk satır atlanır. */
function defterOku(metin) {
  return String(metin || '').split(/\r?\n/).filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch (_) { return null; }
  }).filter(Boolean);
}
/** Son 24 saatte başarılı eylem sayısı (tavan sayacı). */
function son24Say(defter, nowMs, tur, set, platform) {
  return defter.filter((k) => k.tur === tur && k.sonuc === 'tamam' && k.set === String(set)
    && (platform == null || k.platform === platform) && nowMs - k.ms < SA24).length;
}

const hexMetin = (h) => (h ? Buffer.from(h, 'hex').toString('utf8') : '');
const hataOzeti = (s) => String(s || '').replace(/\s+/g, ' ').slice(0, 90);

// ─── Senaryo kararları (SAF) ──────────────────────────────────────────────────────────────

/** S2 + S3: failed satırlar. */
function planHata(satirlar, defter, nowMs, nowDb) {
  const out = { requeue: [], tavan: [], bekleyen: [], kalici: [] };
  for (const s of satirlar.filter((x) => x.status === 'failed')) {
    const c = hataSinifla(s.hata);
    if (c.sinif !== 'gecici') {
      out.kalici.push({ set: s.set, platform: s.platform, etiket: c.etiket, hata: s.hata });
      continue;
    }
    const n = son24Say(defter, nowMs, TUR.gecici, s.set, s.platform);
    if (n >= TAVAN.gecici) {
      out.tavan.push({ tur: TUR.gecici, set: s.set, platform: s.platform, etiket: c.etiket });
      continue;
    }
    const bekle = BEKLEME_DK[n];
    const gecen = dkFark(s.sonZaman, nowDb);
    if (gecen == null || gecen < bekle) {
      out.bekleyen.push({ set: s.set, platform: s.platform, kalanDk: gecen == null ? bekle : bekle - gecen });
      continue;
    }
    out.requeue.push({
      tur: TUR.gecici, set: s.set, platform: s.platform, kosul: 'bitmis',
      sebep: `${c.etiket} (deneme ${n + 1}/${TAVAN.gecici}, bekleme ${bekle} dk)`,
    });
  }
  return out;
}

/** S4: kirası dolmuş running. */
function planKira(satirlar, defter, nowMs) {
  const out = { requeue: [], tavan: [] };
  for (const s of satirlar.filter((x) => x.status === 'running' && x.kiraDoldu)) {
    const n = son24Say(defter, nowMs, TUR.kira, s.set, s.platform);
    if (n >= TAVAN.kira) {
      out.tavan.push({ tur: TUR.kira, set: s.set, platform: s.platform, etiket: 'kira' });
      continue;
    }
    out.requeue.push({
      tur: TUR.kira, set: s.set, platform: s.platform, kosul: 'kira',
      sebep: `kira ${KIRA_TOLERANS_DK} dk+ önce doldu (${s.kiraBitis || '?'}), ajan ${s.ajan || '?'}`,
    });
  }
  return out;
}

/**
 * S1: kur isteği askıda → kur yapabilen ajanın satırı öne. `kurPlatformlari` sırayla denenir; Mac
 * duraklatılmışsa (gece: Windows+Pardus önceliği, Nadir 06.10) yalnız pardus (ProBook kaynak-kur).
 */
function planKurAskida(kitaplar, satirlar, defter, nowMs, nowDb, kurPlatformlari = ['mac']) {
  const out = { requeue: [], tavan: [] };
  const gun0 = `${String(nowDb).slice(0, 10)} 00:00:00`;
  for (const k of kitaplar) {
    if (k.kaynakModu === 'manuel' || !k.istek) continue;
    const yas = dkFark(k.istek, nowDb);
    if (yas == null || yas < KUR_YAS_DK) continue;
    if (k.baslangic && dbMs(k.baslangic) > dbMs(k.istek)) continue; // kurulum başladı
    // Seçilen platformlardan biri zaten kuyrukta/koşuyorsa kur oradan gelir — eylem yok.
    const ilgili = kurPlatformlari.map((p) => satirlar.find((s) => s.set === k.set && s.platform === p)).filter(Boolean);
    if (ilgili.some((r) => r.status === 'queued' || r.status === 'running')) continue;
    const mac = ilgili.find((r) => ['completed', 'failed', 'idle'].includes(r.status)
      && !(r.status === 'failed' && hataSinifla(r.hata).sinif === 'kalici'));
    if (!mac) continue;
    if (son24Say(defter, nowMs, TUR.kur, k.set, mac.platform) >= TAVAN.kur) {
      out.tavan.push({ tur: TUR.kur, set: k.set, platform: mac.platform, etiket: 'kur-askida' });
      continue;
    }
    out.requeue.push({
      tur: TUR.kur, set: k.set, platform: mac.platform, kosul: 'bitmis', oneAl: gun0,
      sebep: `kur isteği ${Math.round(yas)} dk yaşlı, kurulum başlamadı`,
    });
  }
  return out;
}

/** Aynı satır için tek requeue: sıra = verilen liste sırası (S1, S4, S2). */
function requeueBirlestir(...listeler) {
  const gorulen = new Set(); const out = [];
  for (const l of listeler) {
    for (const r of l) {
      const a = `${r.set}|${r.platform}`;
      if (!gorulen.has(a)) { gorulen.add(a); out.push(r); }
    }
  }
  return out;
}

/** S5: ajan ölü mü; yalnız durum değişince bildir. */
function planAjan(ajanlar, onceki, probookSsh) {
  const bildirimler = []; const yeni = {};
  for (const a of AJANLAR) {
    const kayit = ajanlar.find((x) => a.desen.test(`${x.ad || ''} ${x.hostname || ''}`) && !x.iptal);
    const dk = kayit ? Number(kayit.dk) : null;
    const olu = !kayit || !Number.isFinite(dk) || dk > AJAN_ESIK_DK;
    yeni[a.ad] = olu ? 'olu' : 'ok';
    const ipucu = a.ad === 'probook' && probookSsh != null ? ` (ssh 22: ${probookSsh ? 'açık' : 'KAPALI'})` : '';
    if (olu && onceki[a.ad] !== 'olu') {
      const son = kayit && Number.isFinite(dk) ? `${dk} dk önce` : 'yok';
      bildirimler.push({ kanal: 'bekci', yuksek: true, baslik: 'Hat bekçisi', mesaj: `Ajan ölü: ${a.ad} — son görülme ${son}${ipucu}` });
    } else if (!olu && onceki[a.ad] === 'olu') {
      bildirimler.push({ kanal: 'bekci', yuksek: false, baslik: 'Hat bekçisi', mesaj: `Ajan geri geldi: ${a.ad}` });
    }
  }
  return { bildirimler, yeni };
}

/** S6: iki md5 farklıysa bir kez bildir (aynı çift için tekrar yok). */
function planKasaSurum(macMd5, kasaMd5, onceki) {
  if (!macMd5 || !kasaMd5) return { bildirim: null, yeni: onceki || null, durum: 'olculemedi' };
  if (macMd5 === kasaMd5) return { bildirim: null, yeni: null, durum: 'esit' };
  const imza = `${macMd5}:${kasaMd5}`;
  const b = onceki === imza ? null : {
    kanal: 'bekci', yuksek: false, baslik: 'Hat bekçisi',
    mesaj: `Kasa kod sapması: runner.js md5 Mac ${macMd5.slice(0, 8)} ≠ kasa ${kasaMd5.slice(0, 8)} (dağıtım elle)`,
  };
  return { bildirim: b, yeni: imza, durum: 'farkli' };
}

/**
 * S8: ProBook kod sürümü (07.10 gecesi). ProBook 06.10 14:32'den beri 87ff6bc'de kaldı: güncelleme
 * elle koşturuluyordu, LAN yolu kapalıydı → içeriksiz üye atlama kuralı Pardus'a ulaşmadı, 45479
 * her turda ertelendi. Mac HEAD ≠ ProBook `.serit-surum` öneki ve ProBook boşta → kur.sh koşar
 * (Tailscale); pardus derlemesi sürüyorsa bekler. Ölçülemezse susar.
 */
function planProbookSurum(macHead, pbSurum, pardusMesgul, onceki) {
  if (!macHead || !pbSurum) return { eylem: null, bildirim: null, yeni: onceki || null, durum: 'olculemedi' };
  const pb = String(pbSurum).trim().split('+')[0];
  if (pb === macHead || pb.startsWith(macHead) || macHead.startsWith(pb)) return { eylem: null, bildirim: null, yeni: null, durum: 'esit' };
  if (pardusMesgul) return { eylem: null, bildirim: null, yeni: onceki || null, durum: 'farkli-mesgul' };
  const imza = `${macHead}:${pb}`;
  const b = onceki === imza ? null : {
    kanal: 'bekci', yuksek: false, baslik: 'Hat bekçisi',
    mesaj: `ProBook kod sapması: Mac ${macHead} ≠ ProBook ${pb} — kur.sh koşturuluyor`,
  };
  return { eylem: 'guncelle', bildirim: b, yeni: imza, durum: 'farkli' };
}

const ISO = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)/;
const KAPALI = /kap\S{0,4}\s+KAPALI/i;
/** S7: üretim kapısı kapalı + kabul işçisi durgun. onceki: 'kapali' | null. */
function planUretimKapisi(agentSatirlari, kabulSonSatir, nowMs, onceki) {
  const pencere = agentSatirlari.map((l) => ({ l, ms: ISO.test(l) ? Date.parse(ISO.exec(l)[1]) : null }))
    .filter((x) => x.ms != null && nowMs - x.ms <= KAPI_PENCERE_DK * DK);
  const hepsiKapali = pencere.length > 0 && pencere.every((x) => KAPALI.test(x.l));
  const kms = ISO.test(kabulSonSatir || '') ? Date.parse(ISO.exec(kabulSonSatir)[1]) : null;
  const durgun = kms != null && nowMs - kms > KABUL_DURGUN_DK * DK;
  const kapali = hepsiKapali && durgun;
  const b = kapali && onceki !== 'kapali' ? {
    kanal: 'bekci', yuksek: false, baslik: 'Hat bekçisi',
    mesaj: `Üretim kapısı ${KAPI_PENCERE_DK} dk+ KAPALI, kabul işçisi ${Math.round((nowMs - kms) / DK)} dk durgun`,
  } : null;
  return { bildirim: b, yeni: kapali ? 'kapali' : null, durum: kms == null ? 'olculemedi' : (kapali ? 'kapali' : 'ok') };
}

/** S9: Android şeridi devralma. Kasa ajanı canlı + android ise Mac durdurulur. */
function planAndroidSerit(ajanlar = [], nowMs, onceki, esikDk = 15) {
  let kasaAndroid = false;
  let sessizDk = null;
  for (const a of ajanlar) {
    if (!a) continue;
    const revoked = a.revoked === '1' || a.revoked === 1 || a.revoked === true;
    if (revoked) continue;
    const caps = String(a.capabilities || '').toLowerCase();
    if (caps.includes('windows')) {
      const lsMs = typeof a.last_seen_at === 'number'
        ? a.last_seen_at
        : (a.last_seen_at instanceof Date ? a.last_seen_at.getTime() : dbMs(a.last_seen_at));
      if (lsMs != null && lsMs <= nowMs) sessizDk = Math.round((nowMs - lsMs) / DK);
      if (caps.includes('android')) {
        if (lsMs != null && lsMs <= nowMs && (nowMs - lsMs) < esikDk * DK) {
          kasaAndroid = true;
          break;
        }
      }
    }
  }
  const durum = kasaAndroid ? 'kasa' : 'mac';
  const yeni = durum;
  let bayrak = null;
  if (kasaAndroid) {
    bayrak = onceki === 'kasa' ? null : 'koy';
  } else {
    bayrak = onceki === 'mac' ? null : 'kaldir'; // ilk koşuda da kaldır: bayat bayrak temizlenir
  }
  let bildirim = null;
  if (onceki ? onceki !== durum : durum === 'kasa') {
    if (durum === 'kasa') {
      bildirim = { kanal: 'bekci', yuksek: false, baslik: 'Hat bekçisi', mesaj: 'Android şeridi: kasa devraldı — Mac android-durdur' };
    } else {
      const nStr = sessizDk != null ? `${sessizDk} dk` : '? dk';
      bildirim = { kanal: 'bekci', yuksek: false, baslik: 'Hat bekçisi', mesaj: `Android şeridi: kasa sessiz (${nStr}) — Mac devraldı` };
    }
  }
  return { bayrak, bildirim, yeni, durum };
}

/** S3 + tavan bildirimleri: aynı anahtar 24 saatte 1. Tek özet mesajı. */
function bildirimOzeti(kalici, tavanlar, damgalar, nowMs) {
  const imzaHata = (h) => crypto.createHash('sha1')
    .update(String(h).replace(/\d+/g, '#').slice(0, 120)).digest('hex').slice(0, 10);
  const yeni = []; const anahtarlar = [];
  const taze = (a) => !damgalar[a] || nowMs - damgalar[a] >= SA24;
  for (const k of kalici) {
    const a = `kalici|${k.set}|${k.platform}|${imzaHata(k.hata || k.etiket)}`;
    if (taze(a)) { yeni.push({ grup: k.etiket, ad: `${k.set}/${k.platform}` }); anahtarlar.push(a); }
  }
  for (const t of tavanlar) {
    const a = `tavan|${t.tur}|${t.set}|${t.platform}`;
    if (taze(a)) { yeni.push({ grup: `tavan-${t.etiket}`, ad: `${t.set}/${t.platform}` }); anahtarlar.push(a); }
  }
  if (!yeni.length) return null;
  const gruplar = {};
  for (const y of yeni) (gruplar[y.grup] = gruplar[y.grup] || []).push(y.ad);
  const parca = Object.entries(gruplar)
    .map(([g, l]) => `${g} ${l.slice(0, 4).join(' ')}${l.length > 4 ? ` +${l.length - 4}` : ''}`).join(' · ');
  return { kanal: 'kosucu', yuksek: false, baslik: 'Hat bekçisi', mesaj: `Hat hatası ${yeni.length}: ${parca}`.slice(0, 230), anahtarlar };
}

// ─── SQL ve yedek ─────────────────────────────────────────────────────────────────────────

const PLATFORMLAR = ['windows', 'pardus', 'mac', 'android'];
function idDogrula(id) {
  if (!/^[1-9][0-9]{0,9}$/.test(String(id))) throw new Error(`geçersiz id: ${id}`);
  return String(id);
}
function platDogrula(p) {
  if (!PLATFORMLAR.includes(p)) throw new Error(`geçersiz platform: ${p}`);
  return p;
}
const sql = {
  simdi: () => 'SELECT NOW(3) AS simdi',
  satirlar: () => "SELECT book_id, platform, status, HEX(LEFT(COALESCE(last_error, ''), 400)) AS hata_hex, "
    + "HEX(LEFT(COALESCE(last_result, ''), 300)) AS sonuc_hex, COALESCE(last_run_at, updated_at) AS son_zaman, "
    + 'lease_expires_at, leased_by_agent, '
    + `(lease_expires_at < NOW() - INTERVAL ${KIRA_TOLERANS_DK} MINUTE) AS kira_doldu `
    + 'FROM pipeline_platform_summaries WHERE deleted_at IS NULL '
    + `AND platform IN (${PLATFORMLAR.map((p) => `'${p}'`).join(',')})`,
  kitaplar: () => 'SELECT book_id, kaynak_modu, kaynak_kur_istegi_at, kaynak_kurulum_baslangic, '
    + 'kaynak_kurulum_bitis FROM pipeline_book_summaries WHERE deleted_at IS NULL '
    + 'AND kaynak_kur_istegi_at IS NOT NULL',
  ajanlar: () => 'SELECT name, hostname, revoked, last_seen_at, capabilities, '
    + 'TIMESTAMPDIFF(MINUTE, last_seen_at, NOW()) AS dk FROM build_agents',
  /** kosul: bitmis (completed/failed/idle) | kira (running + kira dolu). oneAl: eski last_queued_at. */
  requeue: (set, platform, kosul, oneAl) => [
    "UPDATE pipeline_platform_summaries SET status='queued', last_result=NULL, progress=0, "
      + 'current_phase=NULL, last_run_at=NULL, leased_by_agent=NULL, lease_expires_at=NULL, '
      + `last_queued_at=${oneAl ? `'${String(oneAl).replace(/[^0-9: -]/g, '')}'` : 'NOW(3)'} `
      + `WHERE book_id='${idDogrula(set)}' AND platform='${platDogrula(platform)}' AND deleted_at IS NULL AND `
      + (kosul === 'kira'
        ? `status='running' AND lease_expires_at < NOW() - INTERVAL ${KIRA_TOLERANS_DK} MINUTE;`
        : "status IN ('completed','failed','idle');"),
    'SELECT ROW_COUNT();',
  ].join('\n'),
};

/** İki tabloyu dump'lar; doğrulama SY.yedekDogrulandiMi ile (srv21Istemci.yedek). */
function yedekKomutu(cfg, stamp) {
  if (!/^\d{8}-\d{6}$/.test(stamp)) throw new Error(`geçersiz damga: ${stamp}`);
  const dizin = `${cfg.yedekKoku}/${stamp}-hat-bekcisi`;
  const dosya = `${dizin}/once.sql`;
  const komut = `mkdir -p '${dizin}' && mariadb-dump --defaults-extra-file=${cfg.dbCnf} ${cfg.db} `
    + `pipeline_platform_summaries pipeline_book_summaries > '${dosya}' && tail -1 '${dosya}' `
    + `&& echo "INSERT_SAYISI=$(grep -c 'INSERT INTO' '${dosya}')"`;
  return { dizin, dosya, komut };
}

// ─── Ayarlar, argümanlar, kilit ───────────────────────────────────────────────────────────

function ayarlar(env = process.env, ev = os.homedir()) {
  const temel = SY.ayarlar(env, ev);
  const dizin = env.EMPP_HAT_DIZINI || path.join(ev, '.empp-agent', 'hat-bekcisi');
  return {
    ...temel,
    durumDizini: dizin,
    eylemDefteri: path.join(dizin, 'eylem.jsonl'),
    bildirimDurumu: path.join(dizin, 'bildirim.json'),
    kilit: path.join(dizin, 'kilit'),
    macRunner: env.EMPP_MAC_RUNNER || '/Users/nadir/01dev/electron-multi-platform-packager/src/agent/runner.js',
    kasaRunner: 'C:\\empp-ajan\\paketleyici\\src\\agent\\runner.js',
    kasaAgentLog: 'C:\\empp-ajan\\log\\agent.log',
    kasaKabulLog: 'C:\\empp-ajan\\log\\kabul-iscisi.log',
    probookIp: env.EMPP_PROBOOK_IP || '100.73.161.76', // Tailscale; LAN 192.168.1.70 ofis dışında kapalı
    probookSsh: env.EMPP_PROBOOK_SSH || 'etapadmin@100.73.161.76',
    macRepo: env.EMPP_MAC_REPO || '/Users/nadir/01dev/electron-multi-platform-packager',
    macDuraklat: path.join(ev, '.empp-agent', 'duraklat.istek'),
    androidDurdurFlag: path.join(ev, '.empp-agent', 'android-durdur.istek'),
  };
}

function argAyristir(argv) {
  const o = { uygula: true };
  for (const a of argv) {
    if (a === '--uygula') o.uygula = true;
    else if (a === '--kuru') o.uygula = false;
    else return { hata: `bilinmeyen argüman: ${a}` };
  }
  return o;
}

function kilitAl(cfg, simdi) {
  fs.mkdirSync(cfg.durumDizini, { recursive: true });
  try {
    fs.writeFileSync(cfg.kilit, JSON.stringify({ pid: process.pid, ms: simdi }), { flag: 'wx' });
    return true;
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    let eski = null;
    try { eski = JSON.parse(fs.readFileSync(cfg.kilit, 'utf8')); } catch (_) { eski = null; }
    let canli = false;
    if (eski && eski.pid) { try { process.kill(eski.pid, 0); canli = true; } catch (_) { canli = false; } }
    if (canli && simdi - eski.ms < KILIT_ESKI_MS) return false;
    fs.writeFileSync(cfg.kilit, JSON.stringify({ pid: process.pid, ms: simdi }));
    return true;
  }
}
function kilitBirak(cfg) {
  try {
    const k = JSON.parse(fs.readFileSync(cfg.kilit, 'utf8'));
    if (k.pid === process.pid) fs.unlinkSync(cfg.kilit);
  } catch (_) { /* yok */ }
}

// ─── Ölçüm (G/Ç) ──────────────────────────────────────────────────────────────────────────

function kasaKos(cfg, d, komut, zamanAsimiMs = 40000) {
  return d.calistir('ssh', [...SSH_ORTAK, cfg.kasa, komut], { kodlama: 'latin1', zamanAsimiMs });
}

async function dbOku(cfg, d) {
  const srv = SY.srv21Istemci(cfg, d);
  const [{ simdi }] = await srv.oku(sql.simdi());
  const satirlar = (await srv.oku(sql.satirlar())).map((r) => ({
    set: r.book_id, platform: r.platform, status: r.status,
    hata: `${hexMetin(r.hata_hex)} ${hexMetin(r.sonuc_hex)}`.trim(),
    sonZaman: r.son_zaman, kiraDoldu: r.kira_doldu === '1', kiraBitis: r.lease_expires_at, ajan: r.leased_by_agent,
  }));
  const kitaplar = (await srv.oku(sql.kitaplar())).map((r) => ({
    set: r.book_id, kaynakModu: r.kaynak_modu, istek: r.kaynak_kur_istegi_at,
    baslangic: r.kaynak_kurulum_baslangic, bitis: r.kaynak_kurulum_bitis,
  }));
  const ajanlar = (await srv.oku(sql.ajanlar())).map((r) => ({
    name: r.name, ad: r.name, hostname: r.hostname, dk: r.dk == null ? null : Number(r.dk), iptal: r.revoked === '1',
    capabilities: r.capabilities, last_seen_at: r.last_seen_at, revoked: r.revoked,
  }));
  return { srv, simdi, satirlar, kitaplar, ajanlar };
}

async function probookOlc(cfg, d, sshAcik) {
  const sonuc = { macHead: null, pbSurum: null };
  const g = await d.calistir('/usr/bin/git', ['-C', cfg.macRepo, 'rev-parse', '--short=7', 'HEAD'], { zamanAsimiMs: 8000 });
  if (g.kod === 0) sonuc.macHead = String(g.stdout || '').trim() || null;
  if (!sshAcik) return sonuc;
  const r = await d.calistir('ssh', ['-n', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'ControlPath=none', cfg.probookSsh,
    'cat ~/empp-serit/repo/.serit-surum'], { zamanAsimiMs: 20000 });
  if (r.kod === 0) sonuc.pbSurum = String(r.stdout || '').trim() || null;
  return sonuc;
}

async function kasaOlc(cfg, d) {
  const sonuc = { kasaMd5: null, agentSatirlari: null, kabulSon: null };
  const h = await kasaKos(cfg, d, `certutil -hashfile ${cfg.kasaRunner} MD5`);
  const m = /^\s*([0-9a-f]{2}(?:\s?[0-9a-f]{2}){15})\s*$/im.exec(String(h.stdout || ''));
  if (h.kod === 0 && m) sonuc.kasaMd5 = m[1].replace(/\s/g, '').toLowerCase();
  const a = await kasaKos(cfg, d, `powershell -NoProfile -Command "Get-Content ${cfg.kasaAgentLog} -Tail 80"`);
  if (a.kod === 0) sonuc.agentSatirlari = String(a.stdout || '').split(/\r?\n/).filter(Boolean);
  const k = await kasaKos(cfg, d, `powershell -NoProfile -Command "Get-Content ${cfg.kasaKabulLog} -Tail 1"`);
  if (k.kod === 0) sonuc.kabulSon = String(k.stdout || '').split(/\r?\n/).filter(Boolean).pop() || '';
  return sonuc;
}

// ─── Eylem (G/Ç) ──────────────────────────────────────────────────────────────────────────

function defterEkle(cfg, d, kayit) {
  const onceki = d.dosyaVar(cfg.eylemDefteri) ? d.dosyaOku(cfg.eylemDefteri) : '';
  d.dosyaYaz(cfg.eylemDefteri, `${onceki}${JSON.stringify(kayit)}\n`);
}

async function yazimUygula(requeueler, db, cfg, d) {
  const sonuc = { yedek: null, durdu: null, kayitlar: [] };
  if (!requeueler.length) return sonuc;
  const y = yedekKomutu(cfg, SY.damga(d.simdi()));
  const temel = () => ({ zaman: new Date(d.simdi()).toISOString(), ms: d.simdi() });
  try {
    await db.srv.yedek(y);
    sonuc.yedek = y.dosya;
  } catch (e) {
    sonuc.durdu = `yedek doğrulanamadı → DB yazımı YOK: ${e.message}`;
    for (const r of requeueler) {
      defterEkle(cfg, d, { ...temel(), tur: r.tur, set: r.set, platform: r.platform, sonuc: 'yedek-yok' });
    }
    return sonuc;
  }
  for (const r of requeueler) {
    const k = { ...temel(), tur: r.tur, set: r.set, platform: r.platform, sebep: r.sebep, yedek: y.dosya };
    try {
      const satirlar = await db.srv.yaz(sql.requeue(r.set, r.platform, r.kosul, r.oneAl));
      const rc = Number(satirlar[satirlar.length - 1]);
      k.sonuc = rc === 1 ? 'tamam' : 'satir-yok';
      k.rowCount = rc;
    } catch (e) { k.sonuc = 'hata'; k.hata = String(e.message).slice(0, 200); }
    defterEkle(cfg, d, k);
    sonuc.kayitlar.push(k);
  }
  return sonuc;
}

async function bildirGonder(cfg, d, b) {
  const arg = [b.kanal, b.mesaj, '-b', b.baslik, ...(b.yuksek ? ['-p', 'yuksek'] : [])];
  const r = await d.calistir(cfg.bildir, arg, { zamanAsimiMs: 20000 });
  return r.kod === 0;
}

function jsonOku(d, yol, varsayilan) {
  try { return JSON.parse(d.dosyaOku(yol)); } catch (_) { return varsayilan; }
}

/** Mac duraklatıldıysa (`~/.empp-agent/duraklat.istek`) kur ProBook'tan (pardus) gelir. */
function kurPlatformlari(cfg, d) {
  return d.dosyaVar(cfg.macDuraklat) ? ['pardus'] : ['mac', 'pardus'];
}

// ─── Ana akış ─────────────────────────────────────────────────────────────────────────────

async function kos(o, cfg, d) {
  const nowMs = d.simdi();
  const durum = jsonOku(d, cfg.bildirimDurumu, {});
  const damgalar = durum.damgalar || {};
  const defter = defterOku(d.dosyaVar(cfg.eylemDefteri) ? d.dosyaOku(cfg.eylemDefteri) : '');
  const db = await dbOku(cfg, d);
  const hata = planHata(db.satirlar, defter, nowMs, db.simdi);
  const kira = planKira(db.satirlar, defter, nowMs);
  const kur = planKurAskida(db.kitaplar, db.satirlar, defter, nowMs, db.simdi, kurPlatformlari(cfg, d));
  const requeue = requeueBirlestir(kur.requeue, kira.requeue, hata.requeue);
  const tavanlar = [...hata.tavan, ...kira.tavan, ...kur.tavan];

  const nc = await d.calistir('nc', ['-z', '-G', '3', cfg.probookIp, '22'], { zamanAsimiMs: 8000 });
  const probookSsh = nc.kod === 0;
  const ajan = planAjan(db.ajanlar, durum.ajanlar || {}, probookSsh);

  const pbOlcum = await probookOlc(cfg, d, probookSsh);
  const pardusMesgul = db.satirlar.some((r) => r.platform === 'pardus' && r.status === 'running' && !r.kiraDoldu);
  const pbSurum = planProbookSurum(pbOlcum.macHead, pbOlcum.pbSurum, pardusMesgul, durum.probookSurum || null);

  const kasa = await kasaOlc(cfg, d);
  let macMd5 = null;
  try { macMd5 = d.md5Dosya(cfg.macRunner); } catch (_) { macMd5 = null; }
  const surum = planKasaSurum(macMd5, kasa.kasaMd5, durum.surumImza || null);
  const kapi = kasa.agentSatirlari && kasa.kabulSon != null
    ? planUretimKapisi(kasa.agentSatirlari, kasa.kabulSon, nowMs, durum.kapi || null)
    : { bildirim: null, yeni: durum.kapi || null, durum: 'olculemedi' };
  const androidSerit = planAndroidSerit(db.ajanlar, nowMs, durum.androidSerit || null);
  const ozet = bildirimOzeti(hata.kalici, tavanlar, damgalar, nowMs);
  const bildirimler = [...ajan.bildirimler, surum.bildirim, pbSurum.bildirim, kapi.bildirim, androidSerit.bildirim, ozet].filter(Boolean);

  const plan = {
    requeue, tavanlar, bekleyen: hata.bekleyen, kalici: hata.kalici, bildirimler, probookSsh,
    surumDurum: surum.durum, probookDurum: pbSurum.durum, kapiDurum: kapi.durum, ajanDurum: ajan.yeni,
    androidSeritDurum: androidSerit.durum,
  };
  let eylem = null;
  if (o.uygula) {
    if (androidSerit.bayrak === 'koy') {
      try {
        fs.mkdirSync(path.dirname(cfg.androidDurdurFlag), { recursive: true });
        fs.writeFileSync(cfg.androidDurdurFlag, '');
      } catch (_) {}
    } else if (androidSerit.bayrak === 'kaldir') {
      try { fs.unlinkSync(cfg.androidDurdurFlag); } catch (_) {}
    }
    eylem = { yazim: await yazimUygula(requeue, db, cfg, d), bildirim: [], probook: null };
    let pbYeni = pbSurum.yeni;
    if (pbSurum.eylem === 'guncelle') {
      const k = await d.calistir('bash', [path.join(cfg.macRepo, 'tools/probook/kur.sh'), '--arsivsiz', '--host', cfg.probookSsh],
        { zamanAsimiMs: 15 * DK });
      eylem.probook = k.kod === 0 ? 'guncellendi' : `kur.sh rc=${k.kod}`;
      if (k.kod !== 0) pbYeni = durum.probookSurum || null; // sonraki koşu yeniden dener
    }
    const yeni = { ...durum, damgalar: { ...damgalar }, ajanlar: ajan.yeni, surumImza: surum.yeni, kapi: kapi.yeni, probookSurum: pbYeni, androidSerit: androidSerit.yeni };
    for (const b of bildirimler) {
      const ok = await bildirGonder(cfg, d, b);
      eylem.bildirim.push({ mesaj: b.mesaj, ok });
      if (ok && b.anahtarlar) for (const a of b.anahtarlar) yeni.damgalar[a] = nowMs;
      if (ok) continue;
      // Gönderilemeyen durum-geçişi bildirimi bir sonraki koşuda yeniden denensin.
      const ad = AJANLAR.find((x) => b.mesaj.startsWith('Ajan') && b.mesaj.includes(` ${x.ad}`));
      if (ad) yeni.ajanlar[ad.ad] = (durum.ajanlar || {})[ad.ad];
      if (b === surum.bildirim) yeni.surumImza = durum.surumImza || null;
      if (b === kapi.bildirim) yeni.kapi = durum.kapi || null;
      if (b === androidSerit.bildirim) yeni.androidSerit = durum.androidSerit || null;
    }
    for (const a of Object.keys(yeni.damgalar)) if (nowMs - yeni.damgalar[a] > 2 * SA24) delete yeni.damgalar[a];
    d.dosyaYaz(cfg.bildirimDurumu, `${JSON.stringify(yeni, null, 1)}\n`);
  }
  return { plan, eylem, db };
}

function rapor(r, o) {
  const p = r.plan; const L = [];
  const say = (t) => p.requeue.filter((x) => x.tur === t).length;
  L.push(`# Hat bekçisi — kip ${o.uygula ? 'UYGULA' : 'KURU'} — DB ${r.db.simdi}`, '');
  L.push('| Senaryo | Karar | Sayı |', '|---|---|---|');
  L.push(`| S1 kur askıda | mac satırı öne | ${say(TUR.kur)} |`);
  L.push(`| S2 geçici hata | requeue | ${say(TUR.gecici)} (bekleyen ${p.bekleyen.length}) |`);
  L.push(`| S3 kalıcı hata | bildirim | ${p.kalici.length} |`);
  L.push(`| S4 kira dolmuş | requeue | ${say(TUR.kira)} |`);
  const aj = Object.entries(p.ajanDurum).map(([k, v]) => `${k}:${v}`).join(' ');
  L.push(`| S5 ajanlar | ${aj} | ProBook ssh22 ${p.probookSsh ? 'açık' : 'KAPALI'} |`);
  L.push(`| S6 kasa sürüm | ${p.surumDurum} | - |`);
  L.push(`| S7 üretim kapısı | ${p.kapiDurum} | - |`);
  L.push(`| S8 ProBook sürüm | ${p.probookDurum} | ${r.eylem && r.eylem.probook ? r.eylem.probook : '-'} |`);
  L.push(`| S9 Android şeridi | ${p.androidSeritDurum} | - |`, '');
  for (const x of p.requeue) L.push(`- requeue ${x.set}/${x.platform} [${x.tur}] ${x.sebep}${x.oneAl ? ` (öne: ${x.oneAl})` : ''}`);
  for (const x of p.bekleyen) L.push(`- bekle ${x.set}/${x.platform} ${Math.ceil(x.kalanDk)} dk`);
  for (const x of p.tavanlar) L.push(`- TAVAN ${x.tur} ${x.set}/${x.platform}`);
  for (const x of p.kalici) L.push(`- kalıcı ${x.set}/${x.platform} [${x.etiket}] ${hataOzeti(x.hata)}`);
  for (const b of p.bildirimler) L.push(`- bildirim ${b.kanal}${b.yuksek ? ' (yüksek)' : ''}: ${b.mesaj}`);
  if (r.eylem) {
    const y = r.eylem.yazim;
    L.push('', `Yedek: ${y.yedek || '-'}${y.durdu ? ` · DURDU: ${y.durdu}` : ''}`);
    for (const k of y.kayitlar) L.push(`- ${k.tur} ${k.set}/${k.platform}: ${k.sonuc}`);
  }
  return `${L.join('\n')}\n`;
}

function varsayilanBag() {
  const b = SY.varsayilanBag();
  return { ...b, md5Dosya: (y) => crypto.createHash('md5').update(fs.readFileSync(y)).digest('hex') };
}

const KULLANIM = 'kullanım: hat-bekcisi.js [--uygula | --kuru]';

async function ana(argv = process.argv.slice(2), d = varsayilanBag(), cfg = ayarlar()) {
  const o = argAyristir(argv);
  if (o.hata) { d.uyar(o.hata); d.log(KULLANIM); return CIKIS.KULLANIM; }
  if (!kilitAl(cfg, d.simdi())) { d.uyar('başka bir hat bekçisi koşusu sürüyor (kilit)'); return CIKIS.KILIT; }
  try {
    const r = await kos(o, cfg, d);
    d.log(rapor(r, o));
    return r.eylem && r.eylem.yazim.durdu ? CIKIS.HATA : CIKIS.TAMAM;
  } finally { kilitBirak(cfg); }
}

module.exports = {
  kurPlatformlari,
  CIKIS, TAVAN, BEKLEME_DK, TUR, KALICI_KALIPLAR, GECICI_KALIPLAR, AJANLAR,
  hataSinifla, dbMs, dkFark, defterOku, son24Say, planHata, planKira, planKurAskida, requeueBirlestir,
  planAjan, planKasaSurum, planProbookSurum, planUretimKapisi, planAndroidSerit, bildirimOzeti, sql, yedekKomutu, ayarlar, argAyristir,
  kilitAl, kilitBirak, yazimUygula, kos, rapor, varsayilanBag, ana,
};

if (require.main === module) {
  ana().then((kod) => { process.exitCode = kod; }, (e) => {
    console.error('hat bekçisi HATA:', e && e.stack ? e.stack : e);
    process.exitCode = CIKIS.HATA;
  });
}

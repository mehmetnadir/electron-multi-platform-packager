#!/usr/bin/env node
'use strict';
/**
 * SÖZLEŞME BEKÇİSİ — kullanıcıya görünen sözü ölçer (Nadir 06.10: "kitaplar güncellenince paketler
 * güncellensin, tüm işletim sistemlerinde; sistem kendi oto-kontrolünü çalıştırabilmeli").
 * Bugünkü bekçiler (imza bekçisi, kabul işçisi, gün sonu tablosu) iç adımları ölçer. Bu araç zinciri
 * uçtan uca ölçer:
 *
 *   İSTEK (Platform Ayarları) → ÜRETİLEN (build) → YAYINLANAN (R2) → KANAL (kurulu paket görür mü)
 *
 * Girdiler (hepsi SALT OKUMA):
 *   İSTEK     web-stream `proxy_asset_id` (DB) ya da Worker KV `…/go/<kisa_kod>/web-stream/config/settings.json`;
 *             kitap başına güncel sürüm = İmpark `GetKitapGuncellemeBilgi?id=<ID>&setMi=0&versiyon=0`
 *             (motorun sorusu, `icerik-merdiven.teklifUrl/teklifYorumla`); panel set listesi =
 *             `MobilService/GetPackageBooks?id=<set>` (okuyucunun çevrimiçi menü sorusu).
 *   ÜRETİLEN  `pipeline_platform_summaries` + `kaynak_build_surumleri` (durum='gecerli', `kitaplar` JSON:
 *             n/id/vs) + kanonik kabuk `~/.empp-agent/kabuk/kanonik.json`.
 *   YAYINLANAN `rclone lsl --max-depth 1 ydsr2:ydsdigital/softwares/<S>/` (yalnız lsl).
 *   KANAL     G: `<cdn>/guncelleme/set/<S>/surum.json` (+ android/surum.json).
 *
 * Hücre kararı (set × platform): GÜNCEL · BAYAT (alt: paket | kaynak) · KUYRUKTA · KOŞUYOR · FAIL ·
 * YAYIN-EKSİK · ÖLÇÜLEMEZ · İSTİSNA. Set kararı: KANAL-G-YOK · KANAL-G-ESKİ · LİSTE-FARKI ·
 * BAYAT-KAYNAK · (ÖLÇÜLEMEZ: liste/kanal).
 *
 * Eylem (`--uygula`; varsayılan KURU):
 *   - BAYAT/paket (paket kaynak build'den eski ya da kabuk kanonik değil) → satırı yeniden kuyruğa al.
 *     Önce `mariadb-dump` yedeği ("Dump completed" + ≥1 INSERT yoksa YAZMA YOK). UPDATE yalnız
 *     `status IN ('completed','failed')`. Tavan: set×platform 24 saatte 1, günlük üst sınır 48, kuyruk+koşu ≤8 geri basıncı.
 *     Kaynak kur isteği açıksa (set-yenile sürüyor) atlanır.
 *   - BAYAT/kaynak (İmpark sürümü build'dekinden büyük) → set başına TEK adım: önce kur isteği
 *     (`pipeline_book_summaries.kaynak_kur_istegi_at = NOW(3)`; manuel set hariç; zaten açıksa yazılmaz;
 *     set başına 24 saatte 1), SONRA o setin completed/failed satırları requeue (book-update
 *     `platform-ayar-kuyruk` kalıbı: üretici yeni build'i kurar). Running/queued satıra dokunulmaz.
 *     Yedek `pipeline_platform_summaries` + `pipeline_book_summaries` dump'ını kapsar.
 *   - KANAL-G-YOK/ESKİ, LİSTE-FARKI, FAIL, YAYIN-EKSİK → yalnız bildirim (`bildir bekci`), set başına
 *     günde 1; FAIL varsa `-p yuksek`. `--bildir` yalnız bildirimi açar (DB yazmaz).
 *   - Rapor her koşuda: `~/.empp-agent/sozlesme-bekcisi/son-rapor.md` + `son-rapor.json`; `--rapor` stdout.
 *
 * Kullanım:
 *   node tools/set-yenile/sozlesme-bekcisi.js [--olc] [--rapor] [--uygula | --bildir]
 *     [--setler "id id …"] [--istisnalar <yol>]
 * Çıkış: 0 ölçüm tamam · 1 hata · 2 kullanım · 75 kilit dolu (başka koşu sürüyor).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const SY = require('./set-yenile');
const setEk = require('../../src/agent/set-uyelik-ek');
const uretec = require('../../src/agent/uretec-kaynak');
const merdiven = require('../../src/agent/icerik-merdiven');
const gSurum = require('../g-yayin/g-surum');

const PLATFORMLAR = Object.freeze(['windows', 'pardus', 'mac', 'android']);
const UZANTI = Object.freeze({ windows: '.exe', pardus: '.impark', mac: '.dmg', android: '.apk' });
const VARSAYILAN_SETLER = Object.freeze(('11811 11845 11859 45100 45448 45449 45469 45472 45477 45478 '
  + '45479 45480 45481 45482 45485 45487 45496 45504 45538 45540 45541 45549 45550 45551 45695 45792 '
  + '59834 59835 60014 60015 60016 72378 72379 72380 73581 73768').split(' '));
const K = Object.freeze({
  GUNCEL: 'GÜNCEL', BAYAT: 'BAYAT', KUYRUKTA: 'KUYRUKTA', KOSUYOR: 'KOŞUYOR', FAIL: 'FAIL',
  YAYIN_EKSIK: 'YAYIN-EKSİK', OLCULEMEZ: 'ÖLÇÜLEMEZ', ISTISNA: 'İSTİSNA',
});
const SK = Object.freeze({
  G_YOK: 'KANAL-G-YOK', G_ESKI: 'KANAL-G-ESKİ', LISTE_FARKI: 'LİSTE-FARKI', BAYAT_KAYNAK: 'BAYAT-KAYNAK',
});
const CIKIS = Object.freeze({ TAMAM: 0, HATA: 1, KULLANIM: 2, KILIT: 75 });
const SA = 60 * 60 * 1000;
/** Geri basınç: kuyruk+koşu ≤ `kuyrukEsik`; günlük üst sınır `toplam` (24 sa pencere). */
const TAVAN = Object.freeze({ setPlatformMs: 24 * SA, toplamPencereMs: 24 * SA, toplam: 48, kuyrukEsik: 8 });
/** R2 nesnesi `last_run_at`'tan en çok bu kadar önce olabilir (yükleme, completed yazılmadan biter). */
const R2_TOLERANS_MS = 30 * 60 * 1000;
/** Yeni biten pakette yayın (imza bekçisi) için bildirim öncesi bekleme. */
const YAYIN_BEKLEME_MS = 2 * SA;
const KILIT_ESKI_MS = 40 * 60 * 1000;
/** DB (srv21 system_time_zone) ve rclone lsl (Mac yerel) saat dilimi: ölçüldü 06.10, ikisi de +03. */
const SAAT_DILIMI = '+03:00';
/** Sürüm kıyasına girmeyen içerik türleri (oyun/video kartı ZKitapZipH sürümü taşımaz). */
const KITAP_TURLERI = new Set(['', 'book', 'flipbook', 'kitap']);
const ID_RE = /^[1-9]\d{0,9}$/;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** Doğrulanan şema: aracın okuduğu her tablo/sütun. Koşu başında information_schema ile denetlenir. */
const SEMA = Object.freeze({
  pipeline_book_summaries: ['book_id', 'book_title', 'kaynak_kur_istegi_at', 'kaynak_modu',
    'set_paket_sayaci', 'deleted_at'],
  pipeline_platform_summaries: ['book_id', 'platform', 'status', 'last_error', 'last_run_at',
    'last_queued_at', 'kabuk_surum', 'kabuk_durum', 'motor_sha12', 'build_method', 'paket_sayaci',
    'r2_object_key', 'file_size_bytes', 'proxy_asset_id', 'deleted_at'],
  kaynak_build_surumleri: ['set_id', 'surum', 'durum', 'kaynak', 'olusturma', 'kitaplar'],
  book_pages: ['book_id', 'short_code'],
});

/** Sistemin kendi kendine ölçemediği zincir halkaları (koddan çıkarıldı; rapora sabit girer). */
const SISTEMIK_OLCULEMEZ = Object.freeze([
  'Pakete giren kitap sürümleri platform satırında kayıtlı değil. Yalnız kaynak build (`kaynak_build_surumleri.kitaplar`) kaydı var. '
    + 'Çalışma anındaki eklemeler (set-uyelik-ek, panel-menu-hizala, içerik merdiveni) kayıt bırakmaz.',
  'İmpark kitap değişiklik ZAMANI vermez, yalnız sürüm (Vs) verir. Bekçi "build zamanı ≥ son değişiklik" yerine sürüm kıyası yapar.',
  'Kurulu paketin güncellemeyi gerçekten aldığı ölçülemez: istemci telemetrisi (G/K uygulama kaydı) yok.',
  'K kanalı (okuyucunun bulut düğmesi) bayrakları build içinde; dışarıdan okunamaz.',
  'G kanalı yalnız kanonik motoru taşır (otomatik-yayin.js). Kitap içeriği ve okuyucu kabuğu G ile kurulu pakete gitmez.',
  'Windows yayını (imza bekçisi) DB\'ye yazılmaz; R2 nesne zamanından çıkarılır.',
]);

// ─── Ayarlar ve argümanlar (SAF) ───────────────────────────────────────────────────────────

function ayarlar(env = process.env, ev = os.homedir()) {
  const temel = SY.ayarlar(env, ev);
  const dizin = env.EMPP_SOZLESME_DIZINI || path.join(ev, '.empp-agent', 'sozlesme-bekcisi');
  return {
    ...temel,
    durumDizini: dizin,
    eylemDefteri: path.join(dizin, 'eylem.jsonl'),
    bildirimDurumu: path.join(dizin, 'bildirim.json'),
    raporMd: path.join(dizin, 'son-rapor.md'),
    raporJson: path.join(dizin, 'son-rapor.json'),
    kilit: path.join(dizin, 'kilit'),
    kanonikKabuk: env.EMPP_KANONIK_KABUK || path.join(ev, '.empp-agent', 'kabuk', 'kanonik.json'),
    istisnalar: path.join(__dirname, 'istisnalar.json'),
    panelTaban: env.EMPP_PANEL_TABAN || 'https://akillitahta.ydspublishing.com',
    gTaban: env.EMPP_G_TABAN || 'https://cdn.ydspublishing.com/guncelleme',
    workerKoku: env.EMPP_WORKER_KOKU || uretec.WORKER_KOKU,
    r2Kok: env.EMPP_R2_KOK || 'ydsr2:ydsdigital/softwares',
    rclone: env.EMPP_RCLONE || 'rclone',
  };
}

function argAyristir(argv) {
  const o = { olc: true, rapor: false, uygula: false, bildir: false, setler: null, istisnalar: null, hata: null };
  try {
    for (let i = 0; i < argv.length; i += 1) {
      const a = argv[i];
      const deger = () => {
        if (i + 1 >= argv.length) throw new Error(`${a} değer ister`);
        i += 1;
        return argv[i];
      };
      if (a === '--olc') o.olc = true;
      else if (a === '--rapor') o.rapor = true;
      else if (a === '--uygula') { o.uygula = true; o.bildir = true; }
      else if (a === '--bildir') o.bildir = true;
      else if (a === '--setler') o.setler = deger().split(/[\s,]+/).filter(Boolean);
      else if (a === '--istisnalar') o.istisnalar = deger();
      else throw new Error(`bilinmeyen argüman: ${a}`);
    }
  } catch (e) { return { ...o, hata: e.message }; }
  if (o.setler) {
    const bozuk = o.setler.filter((s) => !ID_RE.test(s));
    if (bozuk.length) return { ...o, hata: `set kimliği yalnız pozitif tamsayı olur: ${bozuk.join(',')}` };
    if (!o.setler.length) return { ...o, hata: '--setler boş' };
    o.setler = [...new Set(o.setler)];
  }
  return o;
}

// ─── İstisnalar (SAF) ──────────────────────────────────────────────────────────────────────

const ISTISNA_TURLERI = new Set(['set-atla', 'kanal-g-ekleme-yok', 'kabuk-set-duzeyi']);

function istisnaDogrula(j) {
  const liste = j && Array.isArray(j.istisnalar) ? j.istisnalar : null;
  if (!liste) throw new Error('istisnalar.json: "istisnalar" dizisi yok');
  for (const x of liste) {
    if (!x || !x.kimlik || !ISTISNA_TURLERI.has(x.tur)) throw new Error(`istisna türü geçersiz: ${JSON.stringify(x).slice(0, 120)}`);
    if (!x.sebep || !/^\d{4}-\d{2}-\d{2}$/.test(String(x.tarih || ''))) {
      throw new Error(`istisna ${x.kimlik}: sebep + tarih (YYYY-AA-GG) zorunlu`);
    }
    if (x.setler && (!Array.isArray(x.setler) || x.setler.some((s) => !ID_RE.test(String(s))))) {
      throw new Error(`istisna ${x.kimlik}: setler yalnız kimlik listesi`);
    }
  }
  return liste;
}

/** Bir set için geçerli istisnalar (SAF). */
function setIstisnalari(liste, setId) {
  const s = String(setId);
  const ilgili = (liste || []).filter((x) => (x.setler || []).map(String).includes(s));
  return {
    atla: ilgili.find((x) => x.tur === 'set-atla') || null,
    kabukSetDuzeyi: ilgili.find((x) => x.tur === 'kabuk-set-duzeyi') || null,
  };
}
const gEklemeYokMu = (liste, platform) => (liste || [])
  .some((x) => x.tur === 'kanal-g-ekleme-yok' && x.platform === platform);

// ─── Zaman ve ayrıştırma (SAF) ─────────────────────────────────────────────────────────────

/** DB ya da rclone yerel zamanı ("YYYY-MM-DD HH:MM:SS[.f…]") → epoch ms. Boşsa null. */
function yerelMs(s) {
  if (s == null || s === '') return null;
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d+))?$/.exec(String(s).trim());
  if (!m) return null;
  const ms = (m[3] || '').slice(0, 3).padEnd(3, '0');
  const t = Date.parse(`${m[1]}T${m[2]}.${ms}${SAAT_DILIMI}`);
  return Number.isFinite(t) ? t : null;
}
/** epoch ms → "GG.AA SS:DD" (+03). */
function kisaZaman(ms) {
  if (!Number.isFinite(ms)) return '-';
  const t = new Date(ms + 3 * SA);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(t.getUTCDate())}.${p(t.getUTCMonth() + 1)} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
}
/** Yerel (+03) takvim günü "YYYY-AA-GG". */
function yerelGun(ms) {
  return new Date(ms + 3 * SA).toISOString().slice(0, 10);
}
const hexMetin = (h) => (h ? Buffer.from(String(h), 'hex').toString('utf8') : null);

/** `rclone lsl` çıktısı → [{boyut, zamanMs, ad}] (ad boşluk taşıyabilir). */
function r2Ayristir(metin) {
  const out = [];
  for (const l of String(metin || '').split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?)\s+(.+)$/.exec(l);
    if (!m) continue;
    out.push({ boyut: Number(m[1]), zamanMs: yerelMs(m[2]), ad: m[3] });
  }
  return out;
}

/** Ayar listesi (ham "assetId | ad | kapak | contentType | grup") → kitap öğeleri. */
function listeOgeleri(ham) {
  if (!ham) return [];
  return setEk.setListesiAyristir(String(ham).replace(/\\n/g, '\n'))
    .filter((x) => !x.link && x.assetId)
    .map((x) => ({ id: String(x.assetId), ad: x.ad, tur: String(x.contentType || '').toLowerCase() }));
}
const kitapOgesiMi = (o) => ID_RE.test(o.id) && KITAP_TURLERI.has(o.tur);

/** build `kitaplar` JSON → [{id, vs}] ya da null. */
function buildKitaplari(metin) {
  if (!metin) return null;
  try {
    const j = JSON.parse(metin);
    if (!Array.isArray(j)) return null;
    return j.filter((k) => k && k.id != null).map((k) => ({
      id: String(k.id), vs: Number.isFinite(Number(k.vs)) && k.vs !== null ? Number(k.vs) : null,
    }));
  } catch (_) { return null; }
}

/** Paket sürümü `2.<panel>.<sayaç>` (otomatik-yayin.paketSurumu ile aynı kural). */
function paketSurumu(build, satirlar, kitap) {
  const c = build ? gSurum.coz(build.surum) : null;
  if (!c) return null;
  const sayaclar = [c.sayac, Number(kitap && kitap.set_paket_sayaci) || 0];
  for (const r of satirlar || []) sayaclar.push(Number(r.paket_sayaci) || 0);
  return `2.${c.panel}.${Math.max(...sayaclar)}`;
}

// ─── Karar (SAF) ───────────────────────────────────────────────────────────────────────────

/**
 * İSTEK ↔ build kitap sürüm kıyası (set düzeyi). Panel Vs > build vs → geride.
 * @returns {{geride: string[], bilinmeyen: string[], kiyaslanan: number, notlar: string[]}}
 */
function kitapKiyasla(istekOgeleri, buildKitap, surumler) {
  const sonuc = { geride: [], bilinmeyen: [], kiyaslanan: 0, notlar: [] };
  const bk = new Map((buildKitap || []).map((k) => [k.id, k]));
  for (const o of istekOgeleri) {
    const b = bk.get(o.id);
    const p = surumler.get(o.id);
    if (!b) { sonuc.bilinmeyen.push(`${o.id}: kaynak build'de yok (çalışma anı eki kayıt dışı)`); continue; }
    if (b.vs == null) { sonuc.bilinmeyen.push(`${o.id}: build vs kaydı yok`); continue; }
    if (!p || p.vs == null) { sonuc.bilinmeyen.push(`${o.id}: İmpark sürümü ölçülemedi (${p ? p.not : 'sorulmadı'})`); continue; }
    sonuc.kiyaslanan += 1;
    if (p.vs > b.vs) sonuc.geride.push(`${o.id} v${b.vs}<İmpark v${p.vs}`);
    else if (p.vs < b.vs) sonuc.notlar.push(`${o.id}: build v${b.vs} > İmpark v${p.vs}`);
  }
  return sonuc;
}

/**
 * Hücre kararı (set × platform). SAF.
 * @param {object} g  { satir, build, buildSayisi, kanonik, kiyas, r2 (null=ölçülemedi | dizi),
 *                      setId, istisna, kurIstegiAcik, simdi }
 * @returns {{karar, alt?, sebep, notlar: string[], olculemez: string[], yayinBekleme?: boolean}}
 */
function hucreKarari(g) {
  const notlar = []; const olculemez = [];
  const r = (karar, sebep, ek = {}) => ({ karar, sebep, notlar, olculemez, ...ek });
  if (g.istisna && g.istisna.atla) return r(K.ISTISNA, `${g.istisna.atla.kimlik}: ${g.istisna.atla.sebep}`);
  const s = g.satir;
  if (!s) { olculemez.push('platform satırı yok'); return r(K.OLCULEMEZ, 'platform satırı yok'); }
  if (s.status === 'queued') return r(K.KUYRUKTA, `kuyrukta (${kisaZaman(yerelMs(s.last_queued_at))})`);
  if (s.status === 'running') return r(K.KOSUYOR, 'koşuyor');
  if (s.status === 'failed') return r(K.FAIL, String(s.last_error || 'hata metni yok').slice(0, 100));
  if (s.status !== 'completed') {
    olculemez.push(`status=${s.status}`);
    return r(K.OLCULEMEZ, `status=${s.status} (üretim istenmemiş)`);
  }

  const paketSebep = []; const kaynakSebep = [];
  const runMs = yerelMs(s.last_run_at);
  if (runMs == null) olculemez.push('last_run_at boş');
  // Kabuk (A1 istisnasında da DB set düzeyi alanı ölçülür; kitap başına ölçüm yapılmaz).
  if (!g.kanonik) olculemez.push('kanonik kabuk okunamadı');
  else if (s.kabuk_surum !== g.kanonik || s.kabuk_durum !== 'guncel') {
    paketSebep.push(`kabuk ${s.kabuk_surum || '-'}/${s.kabuk_durum || '-'} ≠ ${g.kanonik}/guncel`);
  }
  if (g.istisna && g.istisna.kabukSetDuzeyi) notlar.push('A1: kabuk set düzeyinde ölçüldü');
  // Kaynak build.
  const passthrough = s.build_method !== 'build';
  if (passthrough) {
    olculemez.push(`build_method=${s.build_method || 'NULL'} (passthrough): pakete giren kitap sürümü kaydı yok`);
  } else if (!g.build) {
    olculemez.push(g.buildSayisi > 1 ? `geçerli build sayısı ${g.buildSayisi}` : 'kaynak build kaydı yok');
  } else {
    const bMs = yerelMs(g.build.olusturma);
    if (runMs != null && bMs != null && runMs < bMs) {
      paketSebep.push(`paket ${kisaZaman(runMs)} < kaynak build ${g.build.surum} ${kisaZaman(bMs)}`);
    }
    if (g.kiyas) {
      if (g.kiyas.geride.length) kaynakSebep.push(`kaynak geride: ${g.kiyas.geride.join(', ')}`);
      else if (g.kiyas.bilinmeyen.length) olculemez.push(...g.kiyas.bilinmeyen);
      notlar.push(...g.kiyas.notlar);
    } else olculemez.push('İSTEK kitap listesi yok');
  }
  if (g.kurIstegiAcik) notlar.push('kaynak kur isteği açık (set-yenile sürüyor)');
  if (paketSebep.length || kaynakSebep.length) {
    return r(K.BAYAT, [...paketSebep, ...kaynakSebep].join(' · '), {
      alt: paketSebep.length ? 'paket' : 'kaynak', kaynakGeride: kaynakSebep.length > 0,
    });
  }
  // Yayın (R2).
  if (g.r2 == null) olculemez.push('R2 listesi okunamadı');
  else {
    const y = r2Karari(g.setId, g.platform, s, g.r2, runMs);
    if (y) {
      const genc = runMs != null && g.simdi - runMs < YAYIN_BEKLEME_MS;
      return r(K.YAYIN_EKSIK, y, { yayinBekleme: genc });
    }
  }
  if (olculemez.length) return r(K.OLCULEMEZ, olculemez[0]);
  return r(K.GUNCEL, `${s.kabuk_surum} · ${kisaZaman(runMs)}`);
}

/** R2'de platform nesnesi var ve build sonrası mı. Sorun varsa sebep, yoksa null. SAF. */
function r2Karari(setId, platform, satir, nesneler, runMs) {
  const onek = `softwares/${setId}/`;
  const anahtar = satir.r2_object_key || null;
  let aday;
  if (anahtar) {
    if (!anahtar.startsWith(onek) || anahtar.slice(onek.length).includes('/')) {
      return `r2_object_key beklenen önekte değil: ${anahtar}`;
    }
    aday = nesneler.find((n) => n.ad === anahtar.slice(onek.length));
  } else {
    aday = nesneler.filter((n) => n.ad.toLowerCase().endsWith(UZANTI[platform]))
      .sort((a, b) => b.zamanMs - a.zamanMs)[0];
  }
  if (!aday) return `R2'de yok (${anahtar ? path.posix.basename(anahtar) : `*${UZANTI[platform]}`})`;
  if (runMs != null && aday.zamanMs != null && aday.zamanMs < runMs - R2_TOLERANS_MS) {
    return `R2 nesnesi ${kisaZaman(aday.zamanMs)} < paket ${kisaZaman(runMs)}`;
  }
  const dbBoyut = Number(satir.file_size_bytes);
  if (satir.file_size_bytes != null && Number.isFinite(dbBoyut) && dbBoyut > 0 && dbBoyut !== aday.boyut) {
    return `R2 boyutu ${aday.boyut} ≠ DB ${dbBoyut}`;
  }
  return null;
}

/** G kanal kararı (set düzeyi; Android ayrı). SAF. */
function gKarari(g) {
  if (!g || g.http == null) return { durum: 'ÖLÇÜLEMEZ', sebep: `G okunamadı: ${(g && g.hata) || 'cevap yok'}` };
  if (g.http === 404) return { durum: SK.G_YOK, sebep: 'surum.json 404 — kurulu paketler güncelleme görmez' };
  if (g.http !== 200) return { durum: 'ÖLÇÜLEMEZ', sebep: `surum.json HTTP ${g.http}` };
  if (!gSurum.gecerliMi(g.surum)) return { durum: 'ÖLÇÜLEMEZ', sebep: 'surum.json G3 biçiminde değil' };
  if (g.paket && gSurum.gecerliMi(g.paket) && gSurum.kiyasla(g.surum, g.paket) < 0) {
    return { durum: SK.G_ESKI, sebep: `G ${g.surum} < paket ${g.paket}` };
  }
  const uMs = Date.parse(g.uretim || '');
  if (Number.isFinite(uMs) && g.buildMs != null && uMs < g.buildMs) {
    return { durum: SK.G_ESKI, sebep: `G üretimi ${kisaZaman(uMs)} < kaynak build ${kisaZaman(g.buildMs)}` };
  }
  return { durum: 'G-GÜNCEL', sebep: `G ${g.surum}` };
}

/** Ayar listesi ↔ panel GetPackageBooks listesi. SAF. */
function listeKarari(ayarIdler, panel) {
  if (!ayarIdler) return { durum: 'ÖLÇÜLEMEZ', sebep: 'ayar listesi yok (DB proxy_asset_id + KV boş)' };
  if (!panel || panel.durum === 'OLCULEMEDI') return { durum: 'ÖLÇÜLEMEZ', sebep: `panel listesi ölçülemedi: ${(panel && panel.sebep) || '-'}` };
  if (panel.durum === 'BOS') return { durum: 'PANEL-BOŞ', sebep: 'panel set listesi boş (okuyucu paket menüsünü kullanır)' };
  const a = new Set(ayarIdler); const p = new Set(panel.idler);
  const eksik = [...a].filter((x) => !p.has(x));
  const fazla = [...p].filter((x) => !a.has(x));
  if (!eksik.length && !fazla.length) return { durum: 'AYNI', sebep: `${a.size} kitap` };
  return {
    durum: SK.LISTE_FARKI,
    sebep: `ayarda olup panelde yok: ${eksik.join(',') || '-'} · panelde olup ayarda yok: ${fazla.join(',') || '-'}`,
  };
}

// ─── Eylem planı (SAF) ─────────────────────────────────────────────────────────────────────

function defterOku(metin) {
  return String(metin || '').split(/\r?\n/).filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch (_) { return null; }
  }).filter(Boolean);
}

/**
 * Requeue + kur isteği planı. SAF.
 * Kaynak geride (BAYAT-K ya da kaynakGeride) → düz requeue ESKİ build.zip ile üretir; book-update
 * `platform-ayar-kuyruk` kalıbı: önce set başına `kaynak_kur_istegi_at = NOW(3)` (kur isteği), SONRA
 * o setin completed/failed satırları requeue. Kur isteği zaten açıksa (kurIstegiAcik) yeniden yazılmaz,
 * yalnız requeue yapılır. Kur isteği set başına 24 saatte 1. Manuel (M1) set kurulmaz.
 * Tavan: set×platform 24 saatte 1; kur isteği set başına 24 saatte 1; günlük toplam `TAVAN.toplam` (48)
 * requeue. Geri basınç: koşu başında KUYRUKTA+KOŞUYOR = Q ise bu koşuda en çok max(0, 8−Q) yeni requeue;
 * set bölünmez (sığmayan set sonraki koşuya kalır), tamamen bayat setler önce.
 * Sayılan kayıtlar: `tur='requeue'|'kur-istegi'` ve `sonuc` 'tamam' ya da 'hata' (yazma denendi).
 * running/queued hücre BAYAT olmaz (hucreKarari) → plana girmez, satıra dokunulmaz.
 * @returns {{requeue: Array<{set, platform, sebep, kur: boolean}>, kurIstegi: Array<{set, sebep}>,
 *            atlanan: Array<{set, platform, neden}>}}
 */
function eylemPlani(hucreler, defter, simdi, tavan = TAVAN) {
  const denendi = (e) => e.sonuc === 'tamam' || e.sonuc === 'hata';
  const denenen = (defter || []).filter((e) => e.tur === 'requeue' && denendi(e));
  const kurDenenen = (defter || []).filter((e) => e.tur === 'kur-istegi' && denendi(e));
  const gunluk = denenen.filter((e) => simdi - e.ms < tavan.toplamPencereMs).length;
  // Geri basınç: üretici kuyruğu doluyken yeni iş eklenmez (istisna hücreler K.ISTISNA, sayılmaz).
  const kuyruk = hucreler.filter((h) => h.karar === K.KUYRUKTA || h.karar === K.KOSUYOR).length;
  const kuyrukBos = Math.max(0, tavan.kuyrukEsik - kuyruk);
  let hak = Math.min(kuyrukBos, Math.max(0, tavan.toplam - gunluk));
  const requeue = []; const atlanan = []; const kurIstegi = [];
  // Set başına aday hücreler (set sırası: tamamen bayat setler önce, sonra ilk görülme sırası).
  const setler = new Map();
  for (const h of hucreler) {
    if (!setler.has(h.set)) setler.set(h.set, { hepsi: [], aday: [], kurIstegi: null });
    setler.get(h.set).hepsi.push(h);
  }
  for (const [set, g] of setler) {
    for (const h of g.hepsi) {
      if (h.karar !== K.BAYAT) continue;
      const k = { set: h.set, platform: h.platform };
      const kaynakMi = h.alt === 'kaynak' || h.kaynakGeride === true;
      if (kaynakMi && h.kaynakModu === 'manuel') { atlanan.push({ ...k, neden: 'manuel (M1) set: İmpark\'tan kurulmaz' }); continue; }
      if (!kaynakMi && h.kurIstegiAcik) { atlanan.push({ ...k, neden: 'kaynak kur isteği açık (set-yenile sürüyor)' }); continue; }
      if (h.status !== 'completed' && h.status !== 'failed') { atlanan.push({ ...k, neden: `status=${h.status}` }); continue; }
      const kurGerek = kaynakMi && !h.kurIstegiAcik;
      if (kurGerek) {
        const sonKur = kurDenenen.filter((e) => e.set === set && simdi - e.ms < tavan.setPlatformMs);
        if (sonKur.length) { atlanan.push({ ...k, neden: `kur isteği 24 sa tavanı: son istek ${kisaZaman(sonKur[sonKur.length - 1].ms)}` }); continue; }
        if (!g.kurIstegi) g.kurIstegi = { set, sebep: h.sebep };
      }
      const son = denenen.filter((e) => e.set === set && e.platform === h.platform && simdi - e.ms < tavan.setPlatformMs);
      if (son.length) { atlanan.push({ ...k, neden: `24 sa tavanı: son requeue ${kisaZaman(son[son.length - 1].ms)}` }); continue; }
      g.aday.push({ ...k, sebep: h.sebep, kur: kaynakMi });
    }
    g.tamBayat = g.hepsi.length > 0 && g.hepsi.every((h) => h.karar === K.BAYAT);
  }
  const sirali = [...setler.entries()].filter(([, g]) => g.aday.length)
    .sort((a, b) => Number(b[1].tamBayat) - Number(a[1].tamBayat));
  for (const [set, g] of sirali) {
    if (g.aday.length > hak) {
      const neden = gunluk >= tavan.toplam || tavan.toplam - gunluk - requeue.length <= 0
        ? `günlük toplam tavan (${tavan.toplam}) dolu`
        : `geri basınç: kuyruk+koşu ${kuyruk}/${tavan.kuyrukEsik}, set ${g.aday.length} hücre sığmıyor (set bölünmez)`;
      for (const a of g.aday) atlanan.push({ set, platform: a.platform, neden });
      continue;
    }
    hak -= g.aday.length;
    if (g.kurIstegi && g.aday.some((a) => a.kur)) kurIstegi.push(g.kurIstegi);
    requeue.push(...g.aday);
  }
  return { requeue, kurIstegi, atlanan };
}

/**
 * Bildirim planı: set başına yerel günde 1. Konular: KANAL-G-YOK/ESKİ, LİSTE-FARKI, FAIL, YAYIN-EKSİK
 * (yayın bekleme süresi geçmişse), BAYAT-KAYNAK. FAIL varsa yüksek öncelik.
 */
function bildirimPlani(setler, durum, simdi) {
  const gun = yerelGun(simdi);
  const out = []; const bastirilan = [];
  for (const s of setler) {
    if (s.istisna) continue;
    const konular = [];
    if (s.g && (s.g.durum === SK.G_YOK || s.g.durum === SK.G_ESKI)) konular.push(s.g.durum);
    if (s.liste && s.liste.durum === SK.LISTE_FARKI) konular.push(SK.LISTE_FARKI);
    const fail = s.hucreler.filter((h) => h.karar === K.FAIL).map((h) => h.platform);
    const yayin = s.hucreler.filter((h) => h.karar === K.YAYIN_EKSIK && !h.yayinBekleme).map((h) => h.platform);
    const kaynak = s.hucreler.some((h) => h.karar === K.BAYAT && h.alt === 'kaynak');
    if (fail.length) konular.push(`FAIL ${fail.join('/')}`);
    if (yayin.length) konular.push(`YAYIN-EKSİK ${yayin.join('/')}`);
    if (kaynak) konular.push(`${SK.BAYAT_KAYNAK} (bekçi kur isteği + kuyruk)`);
    if (!konular.length) continue;
    if (durum && durum[s.set] === gun) { bastirilan.push(s.set); continue; }
    const mesaj = `${s.set} ${String(s.ad || '').slice(0, 40)}: ${konular.join(' · ')}`.slice(0, 220);
    out.push({ set: s.set, mesaj, konular, yuksek: fail.length > 0 });
  }
  return { bildirimler: out, bastirilan, gun };
}

/**
 * Gönderim grupları. `OZET_ESIK`'ten çok set varsa TEK özet bildirim gider (35 set × KANAL-G-YOK
 * telefonu boğmasın); her set yine o gün "bildirildi" sayılır (set başına günde en çok 1). SAF.
 */
const OZET_ESIK = 5;
function bildirimGruplari(bildirimler, raporYolu) {
  if (bildirimler.length <= OZET_ESIK) return bildirimler.map((b) => ({ ...b, setler: [b.set] }));
  const say = {};
  for (const b of bildirimler) {
    for (const k of b.konular || []) {
      const ad = k.split(' ')[0];
      say[ad] = (say[ad] || 0) + 1;
    }
  }
  const ozet = Object.entries(say).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ');
  return [{
    setler: bildirimler.map((b) => b.set),
    yuksek: bildirimler.some((b) => b.yuksek),
    mesaj: `${bildirimler.length} set: ${ozet} — rapor ${raporYolu}`.slice(0, 220),
  }];
}

// ─── SQL (SAF) ─────────────────────────────────────────────────────────────────────────────

const idListe = (idler) => idler.map((x) => {
  if (!ID_RE.test(String(x))) throw new Error(`geçersiz kimlik: ${x}`);
  return `'${x}'`;
}).join(',');
const platformListe = () => PLATFORMLAR.map((p) => `'${p}'`).join(',');

const sql = {
  sema: () => 'SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() '
    + `AND TABLE_NAME IN (${Object.keys(SEMA).map((t) => `'${t}'`).join(',')})`,
  kitaplar: (idler) => 'SELECT s.book_id, s.book_title, s.kaynak_kur_istegi_at, s.kaynak_modu, s.set_paket_sayaci, '
    + '(SELECT bp.short_code FROM book_pages bp WHERE bp.book_id = s.book_id AND bp.short_code IS NOT NULL '
    + "AND bp.short_code <> '' LIMIT 1) AS kisa_kod FROM pipeline_book_summaries s "
    + `WHERE s.book_id IN (${idListe(idler)}) AND s.deleted_at IS NULL`,
  // last_error TSV'yi bozmasın diye HEX; ilk 100 karakter.
  platformlar: (idler) => 'SELECT book_id, platform, status, HEX(LEFT(last_error, 100)) AS hata_hex, last_run_at, '
    + 'last_queued_at, kabuk_surum, kabuk_durum, motor_sha12, build_method, paket_sayaci, r2_object_key, '
    + `file_size_bytes FROM pipeline_platform_summaries WHERE book_id IN (${idListe(idler)}) `
    + `AND platform IN (${platformListe()}) AND deleted_at IS NULL`,
  // Kapak data URI'leri (yüz KB'larca) sunucuda atılır; yalnız kimlik/ad/tür gerekir.
  listeler: (idler) => "SELECT book_id, HEX(REGEXP_REPLACE(proxy_asset_id, 'data:[^|\\n]*', '')) AS liste_hex "
    + "FROM pipeline_platform_summaries WHERE platform = 'web-stream' AND deleted_at IS NULL "
    + `AND book_id IN (${idListe(idler)})`,
  buildler: (idler) => 'SELECT set_id, surum, durum, kaynak, olusturma, HEX(kitaplar) AS kitaplar_hex '
    + `FROM kaynak_build_surumleri WHERE set_id IN (${idListe(idler)}) AND durum = 'gecerli'`,
  /** book-update `KUR_ISTEGI_SQL` ile birebir kural (manuel set kurulmaz); etkilenen satır = ROW_COUNT. */
  kurIstegi: (setId) => [
    `UPDATE pipeline_book_summaries SET kaynak_kur_istegi_at = NOW(3) WHERE book_id = ${idListe([setId])} `
      + "AND (kaynak_modu IS NULL OR kaynak_modu <> 'manuel');",
    'SELECT ROW_COUNT();',
  ].join('\n'),
  requeue: (setId, platform) => {
    if (!PLATFORMLAR.includes(platform)) throw new Error(`geçersiz platform: ${platform}`);
    return [
      "UPDATE pipeline_platform_summaries SET status='queued', last_result=NULL, progress=0, current_phase=NULL, "
        + 'last_run_at=NULL, leased_by_agent=NULL, lease_expires_at=NULL, last_queued_at=NOW(3) '
        + `WHERE book_id=${idListe([setId])} AND platform='${platform}' AND status IN ('completed','failed');`,
      'SELECT ROW_COUNT();',
    ].join('\n');
  },
};

/** Yedek komutu (görev spec'i + INSERT sayısı; set-yenile.yedekDogrulandiMi ile denetlenir). */
function yedekKomutu(cfg, stamp) {
  if (!/^\d{8}-\d{6}$/.test(stamp)) throw new Error(`geçersiz damga: ${stamp}`);
  const dizin = `${cfg.yedekKoku}/${stamp}-sozlesme-bekcisi`;
  const dosya = `${dizin}/once.sql`;
  const komut = `mkdir -p '${dizin}' && mariadb-dump --defaults-extra-file=${cfg.dbCnf} ${cfg.db} `
    + `pipeline_platform_summaries pipeline_book_summaries > '${dosya}' && tail -1 '${dosya}' `
    + `&& echo "INSERT_SAYISI=$(grep -c 'INSERT INTO' '${dosya}')"`;
  return { dizin, dosya, komut };
}

// ─── Ölçüm (G/Ç) ───────────────────────────────────────────────────────────────────────────

async function havuz(ogeler, n, fn) {
  const out = new Array(ogeler.length);
  let i = 0;
  const isci = async () => {
    while (i < ogeler.length) {
      const j = i; i += 1;
      out[j] = await fn(ogeler[j], j);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, ogeler.length) || 1 }, isci));
  return out;
}

async function ayarOku(olcSetler, db, d, cfg) {
  const kitapMap = new Map(db.kitaplar.map((r) => [String(r.book_id), r]));
  const listeMap = new Map(db.listeler.map((r) => [String(r.book_id), hexMetin(r.liste_hex)]));
  const ayar = new Map();
  await havuz(olcSetler, 6, async (s) => {
    const ham = listeMap.get(s);
    const db_ = listeOgeleri(ham);
    if (db_.length) { ayar.set(s, { kaynak: 'db', ogeler: db_ }); return; }
    const kod = kitapMap.get(s) && kitapMap.get(s).kisa_kod;
    if (!kod || !/^[a-z0-9]{3,12}$/i.test(kod)) { ayar.set(s, { kaynak: null, ogeler: null, sebep: 'DB listesi boş, kisa_kod yok' }); return; }
    const url = `${cfg.workerKoku}/go/${kod}/web-stream/config/settings.json`;
    const c = await d.getir(url);
    if (c.status !== 200) { ayar.set(s, { kaynak: null, ogeler: null, sebep: `KV ${kod}: HTTP ${c.status || c.hata}` }); return; }
    let j = null;
    try { j = JSON.parse(c.govde); } catch (_) { j = null; }
    const kv = listeOgeleri(uretec.ayarlardanListe(j));
    ayar.set(s, kv.length ? { kaynak: `kv:${kod}`, ogeler: kv } : { kaynak: null, ogeler: null, sebep: `KV ${kod}: kitap yok` });
  });
  return ayar;
}

async function olc(o, cfg, d, istisnaListe) {
  const simdi = d.simdi();
  const setler = o.setler || [...VARSAYILAN_SETLER];
  const olcSetler = setler.filter((s) => !setIstisnalari(istisnaListe, s).atla);
  const genel = [];
  const srv = SY.srv21Istemci(cfg, d);

  // Şema doğrulaması.
  const semaSatir = await srv.oku(sql.sema());
  const var_ = new Set(semaSatir.map((r) => `${r.TABLE_NAME}.${r.COLUMN_NAME}`));
  const semaEksik = [];
  for (const [t, cs] of Object.entries(SEMA)) for (const c of cs) if (!var_.has(`${t}.${c}`)) semaEksik.push(`${t}.${c}`);
  if (semaEksik.length) throw new Error(`şema doğrulanamadı, eksik sütun: ${semaEksik.join(', ')}`);

  const bos = { kitaplar: [], platformlar: [], listeler: [], buildler: [] };
  const db = olcSetler.length ? {
    kitaplar: await srv.oku(sql.kitaplar(olcSetler)),
    platformlar: await srv.oku(sql.platformlar(olcSetler)),
    listeler: await srv.oku(sql.listeler(olcSetler)),
    buildler: await srv.oku(sql.buildler(olcSetler)),
  } : bos;

  let kanonik = null;
  try { kanonik = JSON.parse(d.dosyaOku(cfg.kanonikKabuk)).surum || null; } catch (e) {
    genel.push(`kanonik kabuk okunamadı: ${cfg.kanonikKabuk}`);
  }

  // İSTEK: ayar listesi (DB → KV).
  const ayar = await ayarOku(olcSetler, db, d, cfg);
  const kitapMap = new Map((db.kitaplar || []).map((r) => [String(r.book_id), r]));

  // ÜRETİLEN: geçerli build.
  const buildMap = new Map();
  for (const b of db.buildler) {
    const s = String(b.set_id);
    if (!buildMap.has(s)) buildMap.set(s, []);
    buildMap.get(s).push({ ...b, kitaplar: buildKitaplari(hexMetin(b.kitaplar_hex)) });
  }

  // İSTEK: İmpark kitap sürümleri (ayar ∪ build kitapları, yalnız kitap türü).
  const sorulacak = new Set();
  for (const s of olcSetler) {
    for (const x of (ayar.get(s).ogeler || []).filter(kitapOgesiMi)) sorulacak.add(x.id);
    const b = buildMap.get(s);
    if (b && b.length === 1) for (const k of b[0].kitaplar || []) if (ID_RE.test(k.id)) sorulacak.add(k.id);
  }
  const icsMap = new Map();
  try {
    const icsSatirlar = await srv.oku('SELECT impark_kitap_id, vs FROM impark_icerik_surumleri');
    for (const r of icsSatirlar) {
      if (r.impark_kitap_id && r.vs != null) icsMap.set(String(r.impark_kitap_id), Number(r.vs));
    }
  } catch (e) { genel.push(`İmpark DB okunurken hata: ${e.message}`); }

  const surumler = new Map();
  const sablon = `${cfg.panelTaban}/TestlerMobil/GetKitapGuncellemeBilgi?id={bookId}&setMi={isSet}&versiyon={version}`;
  await havuz([...sorulacak], 6, async (id) => {
    const c = await d.getir(merdiven.teklifUrl(sablon, id, 0));
    const y = merdiven.teklifYorumla({ id, surum: 0 }, c.hata ? { hata: c.hata } : { status: c.status, govde: c.govde });
    
    let teklifVs = null;
    let teklifNot = y.durum === merdiven.DURUM.GUNCEL ? 'İmpark zip yok (Data boş)' : y.not;
    if (y.durum === merdiven.DURUM.GERIDE) {
      teklifVs = y.vs;
      teklifNot = 'ok';
    }
    
    const dbVs = icsMap.get(id);
    if (teklifVs != null && dbVs != null) {
      if (teklifVs > dbVs) surumler.set(id, { vs: teklifVs, not: 'ok (teklif)' });
      else surumler.set(id, { vs: dbVs, not: 'ok (db)' });
    } else if (teklifVs != null) {
      surumler.set(id, { vs: teklifVs, not: 'ok (teklif)' });
    } else if (dbVs != null) {
      surumler.set(id, { vs: dbVs, not: 'ok (db)' });
    } else {
      surumler.set(id, { vs: null, not: teklifNot });
    }
  });

  // İSTEK: panel set listesi (GetPackageBooks).
  const panel = new Map();
  await havuz(olcSetler, 6, async (s) => {
    const c = await d.getir(`${cfg.panelTaban}/MobilService/GetPackageBooks?id=${s}`);
    if (c.status !== 200) { panel.set(s, { durum: 'OLCULEMEDI', sebep: `HTTP ${c.status || c.hata}` }); return; }
    let j;
    try { j = JSON.parse(c.govde); } catch (_) { panel.set(s, { durum: 'OLCULEMEDI', sebep: 'JSON değil' }); return; }
    const kitaplar = Array.isArray(j && j.Books) ? j.Books : [];
    panel.set(s, kitaplar.length ? { durum: 'TAMAM', idler: kitaplar.map((b) => String(b.Id)) } : { durum: 'BOS', idler: [] });
  });

  // YAYINLANAN: R2.
  const r2 = new Map();
  await havuz(olcSetler, 4, async (s) => {
    const rr = await d.calistir(cfg.rclone, ['lsl', '--max-depth', '1', `${cfg.r2Kok}/${s}/`], { zamanAsimiMs: 60000 });
    r2.set(s, rr.kod === 0 ? r2Ayristir(rr.stdout) : null);
    if (rr.kod !== 0) genel.push(`R2 ${s}: rclone çıkış ${rr.kod} ${String(rr.stderr || '').slice(-120)}`);
  });

  // KANAL: G.
  const g = new Map();
  await havuz(olcSetler, 6, async (s) => {
    const c = await d.getir(`${cfg.gTaban}/set/${s}/surum.json`);
    const a = await d.getir(`${cfg.gTaban}/set/${s}/android/surum.json`);
    let j = null;
    if (c.status === 200) { try { j = JSON.parse(c.govde); } catch (_) { j = null; } }
    g.set(s, { http: c.status || null, hata: c.hata || null, surum: j && j.surum, uretim: j && j.uretim, androidHttp: a.status || null });
  });

  // Karar.
  const setSonuclari = [];
  for (const s of setler) {
    const ist = setIstisnalari(istisnaListe, s);
    if (ist.atla) {
      setSonuclari.push({
        set: s, ad: ist.atla.ad, istisna: ist.atla.kimlik,
        hucreler: PLATFORMLAR.map((p) => ({ set: s, platform: p, karar: K.ISTISNA, sebep: ist.atla.sebep, notlar: [], olculemez: [] })),
      });
      continue;
    }
    const kitap = kitapMap.get(s);
    const satirlar = db.platformlar.filter((r) => String(r.book_id) === s);
    const bl = buildMap.get(s) || [];
    const build = bl.length === 1 ? bl[0] : null;
    const a = ayar.get(s);
    const istekOgeleri = a.ogeler ? a.ogeler.filter(kitapOgesiMi)
      : (build && build.kitaplar ? build.kitaplar.map((k) => ({ id: k.id, tur: '' })) : null);
    const kiyas = build && istekOgeleri ? kitapKiyasla(istekOgeleri, build.kitaplar, surumler) : null;
    const kurIstegiAcik = Boolean(kitap && build && yerelMs(kitap.kaynak_kur_istegi_at) != null
      && yerelMs(kitap.kaynak_kur_istegi_at) > yerelMs(build.olusturma));
    const hucreler = PLATFORMLAR.map((p) => {
      const satir0 = satirlar.find((r) => r.platform === p) || null;
      const satir = satir0 ? { ...satir0, last_error: hexMetin(satir0.hata_hex) } : null;
      const h = hucreKarari({
        satir, build, buildSayisi: bl.length, kanonik, kiyas, r2: r2.get(s), setId: s, platform: p,
        istisna: ist, kurIstegiAcik, simdi,
      });
      return {
        set: s, platform: p, status: satir && satir.status, kurIstegiAcik, kaynakModu: kitap ? kitap.kaynak_modu : null, ...h,
      };
    });
    const gg = g.get(s);
    const gk = gKarari({ ...gg, paket: paketSurumu(build, satirlar, kitap), buildMs: build ? yerelMs(build.olusturma) : null });
    const ayarIdler = a.ogeler ? a.ogeler.filter((x) => ID_RE.test(x.id)).map((x) => x.id) : null;
    const lk = listeKarari(ayarIdler, panel.get(s));
    const kararlar = [];
    if (gk.durum === SK.G_YOK || gk.durum === SK.G_ESKI) kararlar.push(gk.durum);
    if (lk.durum === SK.LISTE_FARKI) kararlar.push(SK.LISTE_FARKI);
    if (hucreler.some((h) => h.karar === K.BAYAT && h.alt === 'kaynak')) kararlar.push(SK.BAYAT_KAYNAK);
    setSonuclari.push({
      set: s, ad: kitap ? kitap.book_title : '(DB satırı yok)', hucreler, g: gk,
      androidG: gEklemeYokMu(istisnaListe, 'android') ? `ekleme-yok (istisna; android/surum.json HTTP ${gg.androidHttp})` : `HTTP ${gg.androidHttp}`,
      liste: lk, ayarKaynak: a.kaynak || `yok (${a.sebep})`, build: build ? build.surum : (bl.length > 1 ? `${bl.length} geçerli` : 'yok'),
      kiyas, kararlar,
    });
  }
  return { simdi, kanonik, setler: setSonuclari, genel, sema: SEMA, istisnaSayisi: setler.length - olcSetler.length };
}

// ─── Eylem (G/Ç) ───────────────────────────────────────────────────────────────────────────

function defterEkle(cfg, d, kayit) {
  const onceki = d.dosyaVar(cfg.eylemDefteri) ? d.dosyaOku(cfg.eylemDefteri) : '';
  d.dosyaYaz(cfg.eylemDefteri, `${onceki}${JSON.stringify(kayit)}\n`);
}

async function eylemUygula(plan, bildirim, o, cfg, d) {
  const sonuc = { requeue: [], kurIstegi: [], bildirim: [], yedek: null, durdu: null };
  const srv = SY.srv21Istemci(cfg, d);
  const kurIstegi = plan.kurIstegi || [];
  const kayitTemel = () => ({ zaman: new Date(d.simdi()).toISOString(), ms: d.simdi() });
  if (o.uygula && (plan.requeue.length || kurIstegi.length)) {
    const y = yedekKomutu(cfg, SY.damga(d.simdi()));
    try {
      await srv.yedek(y);
      sonuc.yedek = y.dosya;
    } catch (e) {
      sonuc.durdu = `yedek doğrulanamadı → requeue/kur isteği YOK: ${e.message}`;
      for (const r of kurIstegi) defterEkle(cfg, d, { ...kayitTemel(), tur: 'kur-istegi', set: r.set, sonuc: 'yedek-yok' });
      for (const r of plan.requeue) defterEkle(cfg, d, { ...kayitTemel(), tur: 'requeue', set: r.set, platform: r.platform, sonuc: 'yedek-yok' });
    }
    if (sonuc.yedek) {
      // Kur isteği requeue'dan ÖNCE (ajan satırı kiralarken istek görünür olsun). Başarısızsa o setin
      // kaynak requeue'su yapılmaz: istek yoksa ajan ESKİ build.zip'ten üretir.
      const kurOlmadi = new Set();
      for (const r of kurIstegi) {
        const kayit = { ...kayitTemel(), tur: 'kur-istegi', set: r.set, sebep: r.sebep, yedek: y.dosya };
        try {
          const satirlar = await srv.yaz(sql.kurIstegi(r.set));
          const rc = Number(satirlar[satirlar.length - 1]);
          kayit.sonuc = rc >= 1 ? 'tamam' : 'kur-yok';
          kayit.rowCount = rc;
        } catch (e) {
          kayit.sonuc = 'hata';
          kayit.hata = String(e.message).slice(0, 200);
        }
        if (kayit.sonuc !== 'tamam') kurOlmadi.add(r.set);
        defterEkle(cfg, d, kayit);
        sonuc.kurIstegi.push(kayit);
      }
      for (const r of plan.requeue) {
        const kayit = { ...kayitTemel(), tur: 'requeue', set: r.set, platform: r.platform, sebep: r.sebep, yedek: y.dosya };
        if (r.kur && kurOlmadi.has(r.set)) {
          kayit.sonuc = 'kur-yok';
        } else {
          try {
            const satirlar = await srv.yaz(sql.requeue(r.set, r.platform));
            const rc = Number(satirlar[satirlar.length - 1]);
            kayit.sonuc = rc === 1 ? 'tamam' : 'satir-yok';
            kayit.rowCount = rc;
          } catch (e) {
            kayit.sonuc = 'hata';
            kayit.hata = String(e.message).slice(0, 200);
          }
        }
        defterEkle(cfg, d, kayit);
        sonuc.requeue.push(kayit);
      }
    }
  }
  if (o.bildir && bildirim.bildirimler.length) {
    let durum = {};
    try { durum = JSON.parse(d.dosyaOku(cfg.bildirimDurumu)); } catch (_) { durum = {}; }
    for (const b of bildirimGruplari(bildirim.bildirimler, cfg.raporMd)) {
      const arg = ['bekci', b.mesaj, '-b', 'Sözleşme bekçisi', ...(b.yuksek ? ['-p', 'yuksek'] : [])];
      const r = await d.calistir(cfg.bildir, arg, { zamanAsimiMs: 20000 });
      sonuc.bildirim.push({ set: b.setler.join(','), kod: r.kod });
      if (r.kod === 0) for (const s of b.setler) durum[s] = bildirim.gun;
    }
    d.dosyaYaz(cfg.bildirimDurumu, `${JSON.stringify(durum, null, 2)}\n`);
  }
  return sonuc;
}

// ─── Rapor (SAF) ───────────────────────────────────────────────────────────────────────────

const KISA = {
  [K.GUNCEL]: 'GÜNCEL', [K.KUYRUKTA]: 'KUYRUKTA', [K.KOSUYOR]: 'KOŞUYOR', [K.FAIL]: 'FAIL',
  [K.YAYIN_EKSIK]: 'YAYIN-EKSİK', [K.OLCULEMEZ]: 'ÖLÇÜLEMEZ', [K.ISTISNA]: 'İSTİSNA',
};
const hucreKisa = (h) => (h.karar === K.BAYAT ? `BAYAT-${h.alt === 'paket' ? 'P' : 'K'}` : KISA[h.karar]);

function raporMd(olcum, plan, bildirim, eylem, o) {
  const L = [];
  L.push(`# Sözleşme bekçisi — ${kisaZaman(olcum.simdi)}`, '');
  const say = {};
  for (const s of olcum.setler) for (const h of s.hucreler) say[hucreKisa(h)] = (say[hucreKisa(h)] || 0) + 1;
  const ssay = {};
  for (const s of olcum.setler) for (const k of s.kararlar || []) ssay[k] = (ssay[k] || 0) + 1;
  L.push('| Ölçü | Değer |', '|---|---|');
  L.push(`| Set | ${olcum.setler.length} (istisna ${olcum.istisnaSayisi}) |`);
  L.push(`| Hücre | ${Object.entries(say).map(([k, v]) => `${k} ${v}`).join(' · ')} |`);
  L.push(`| Set kararı | ${Object.entries(ssay).map(([k, v]) => `${k} ${v}`).join(' · ') || '-'} |`);
  L.push(`| Kanonik kabuk | ${olcum.kanonik || 'okunamadı'} |`);
  L.push(`| Kip | ${o.uygula ? 'UYGULA' : (o.bildir ? 'BİLDİR' : 'KURU')} |`, '');
  L.push('## Matris (set × platform)', '');
  L.push('| Set | Ad | windows | pardus | mac | android | G | Liste | Build |', '|---|---|---|---|---|---|---|---|---|');
  for (const s of olcum.setler) {
    const c = PLATFORMLAR.map((p) => hucreKisa(s.hucreler.find((h) => h.platform === p)));
    L.push(`| ${s.set} | ${String(s.ad || '').slice(0, 28)} | ${c.join(' | ')} | ${s.g ? s.g.durum : '-'} | ${s.liste ? s.liste.durum : '-'} | ${s.build || '-'} |`);
  }
  L.push('', 'Kısaltma: BAYAT-P = paket eski (requeue adayı) · BAYAT-K = kaynak İmpark\'tan geride (set-yenile).', '');
  L.push('## Set kararları', '');
  for (const s of olcum.setler) {
    if (!s.kararlar || !s.kararlar.length) continue;
    const det = [];
    if (s.kararlar.includes(SK.G_YOK) || s.kararlar.includes(SK.G_ESKI)) det.push(s.g.sebep);
    if (s.kararlar.includes(SK.LISTE_FARKI)) det.push(s.liste.sebep);
    if (s.kararlar.includes(SK.BAYAT_KAYNAK)) det.push(s.kiyas.geride.join(', '));
    L.push(`- ${s.set} ${s.kararlar.join(' + ')} — ${det.join(' · ')}`);
  }
  L.push('', '## Hücre ayrıntısı (GÜNCEL dışı)', '');
  for (const s of olcum.setler) {
    if (s.istisna) continue;
    for (const h of s.hucreler) {
      if (h.karar === K.GUNCEL || h.karar === K.ISTISNA) continue;
      L.push(`- ${s.set}/${h.platform} ${hucreKisa(h)}: ${h.sebep}${h.notlar.length ? ` (${h.notlar.join('; ')})` : ''}`);
    }
  }
  L.push('', '## Ölçülemeyenler', '', '### Sistemin kendi kendine ölçemediği halkalar', '');
  for (const x of SISTEMIK_OLCULEMEZ) L.push(`- ${x}`);
  const grup = new Map();
  for (const s of olcum.setler) {
    for (const h of s.hucreler) for (const x of h.olculemez || []) {
      const anahtar = x.replace(/^(\d+): /, 'kitap $1: ');
      if (!grup.has(anahtar)) grup.set(anahtar, new Set());
      grup.get(anahtar).add(`${s.set}/${h.platform}`);
    }
    if (s.liste && s.liste.durum === 'ÖLÇÜLEMEZ') {
      if (!grup.has(`liste: ${s.liste.sebep}`)) grup.set(`liste: ${s.liste.sebep}`, new Set());
      grup.get(`liste: ${s.liste.sebep}`).add(s.set);
    }
    if (s.g && s.g.durum === 'ÖLÇÜLEMEZ') {
      if (!grup.has(`G: ${s.g.sebep}`)) grup.set(`G: ${s.g.sebep}`, new Set());
      grup.get(`G: ${s.g.sebep}`).add(s.set);
    }
  }
  L.push('', '### Bu koşuda ölçülemeyen girdiler', '');
  L.push('| Sebep | Sayı | Yer |', '|---|---|---|');
  for (const [k, v] of [...grup.entries()].sort((a, b) => b[1].size - a[1].size)) {
    const yer = [...v];
    L.push(`| ${k.replace(/\|/g, '/')} | ${yer.length} | ${yer.slice(0, 12).join(' ')}${yer.length > 12 ? ' …' : ''} |`);
  }
  for (const x of olcum.genel) L.push(`- genel: ${x}`);
  L.push('', '## Eylem', '');
  L.push(`- Kur isteği planı: ${(plan.kurIstegi || []).map((r) => r.set).join(', ') || 'yok'}`);
  L.push(`- Requeue planı: ${plan.requeue.map((r) => `${r.set}/${r.platform}${r.kur ? ' (kur isteğiyle)' : ''}`).join(', ') || 'yok'}`);
  for (const a of plan.atlanan) L.push(`- atlandı ${a.set}/${a.platform}: ${a.neden}`);
  L.push(`- Bildirim planı: ${bildirim.bildirimler.length} (bugün bastırılan ${bildirim.bastirilan.length})`);
  if (!o.uygula && !o.bildir) L.push('- KURU koşu: DB yazması ve bildirim yapılmadı.');
  if (eylem) {
    if (eylem.yedek) L.push(`- Yedek: ${eylem.yedek}`);
    if (eylem.durdu) L.push(`- DURDU: ${eylem.durdu}`);
    for (const r of eylem.kurIstegi || []) L.push(`- kur isteği ${r.set}: ${r.sonuc}${r.hata ? ` ${r.hata}` : ''}`);
    for (const r of eylem.requeue) L.push(`- requeue ${r.set}/${r.platform}: ${r.sonuc}${r.hata ? ` ${r.hata}` : ''}`);
    for (const b of eylem.bildirim) L.push(`- bildirim ${b.set}: çıkış ${b.kod}`);
  }
  L.push('', '## Doğrulanan şema (information_schema)', '');
  for (const [t, cs] of Object.entries(SEMA)) L.push(`- ${t}: ${cs.join(', ')}`);
  return `${L.join('\n')}\n`;
}

// ─── Kilit ve ana akış ─────────────────────────────────────────────────────────────────────

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

const KULLANIM = 'kullanım: sozlesme-bekcisi.js [--olc] [--rapor] [--uygula | --bildir] [--setler "id id …"] [--istisnalar <yol>]';

async function kos(o, cfg, d) {
  const istisnaListe = istisnaDogrula(JSON.parse(d.dosyaOku(o.istisnalar || cfg.istisnalar)));
  const olcum = await olc(o, cfg, d, istisnaListe);
  const defter = defterOku(d.dosyaVar(cfg.eylemDefteri) ? d.dosyaOku(cfg.eylemDefteri) : '');
  const hucreler = olcum.setler.flatMap((s) => s.hucreler);
  const plan = eylemPlani(hucreler, defter, olcum.simdi);
  let bdurum = {};
  try { bdurum = JSON.parse(d.dosyaOku(cfg.bildirimDurumu)); } catch (_) { bdurum = {}; }
  const bildirim = bildirimPlani(olcum.setler, bdurum, olcum.simdi);
  const eylem = (o.uygula || o.bildir) ? await eylemUygula(plan, bildirim, o, cfg, d) : null;
  const md = raporMd(olcum, plan, bildirim, eylem, o);
  d.dosyaYaz(cfg.raporMd, md);
  d.dosyaYaz(cfg.raporJson, `${JSON.stringify({ olcum, plan, bildirim, eylem }, null, 1)}\n`);
  if (o.rapor) d.log(md);
  return { olcum, plan, bildirim, eylem, md };
}

function varsayilanBag() {
  const b = SY.varsayilanBag();
  return {
    ...b,
    async getir(url) {
      try {
        const r = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': UA, 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(20000) });
        return { status: r.status, govde: await r.text() };
      } catch (e) { return { status: null, hata: String((e && e.message) || e).slice(0, 120) }; }
    },
  };
}

async function ana(argv = process.argv.slice(2), d = varsayilanBag(), cfg = ayarlar()) {
  const o = argAyristir(argv);
  if (o.hata) { d.uyar(o.hata); d.log(KULLANIM); return CIKIS.KULLANIM; }
  if (!kilitAl(cfg, d.simdi())) { d.uyar('başka bir sözleşme bekçisi koşusu sürüyor (kilit)'); return CIKIS.KILIT; }
  try {
    const r = await kos(o, cfg, d);
    if (!o.rapor) d.log(`sözleşme bekçisi: rapor ${cfg.raporMd} · requeue planı ${r.plan.requeue.length} · bildirim ${r.bildirim.bildirimler.length}`);
    return r.eylem && r.eylem.durdu ? CIKIS.HATA : CIKIS.TAMAM;
  } finally { kilitBirak(cfg); }
}

module.exports = {
  K, SK, CIKIS, TAVAN, PLATFORMLAR, VARSAYILAN_SETLER, SEMA, SISTEMIK_OLCULEMEZ,
  ayarlar, argAyristir, istisnaDogrula, setIstisnalari, gEklemeYokMu, yerelMs, kisaZaman, yerelGun,
  r2Ayristir, listeOgeleri, buildKitaplari, paketSurumu, kitapKiyasla, hucreKarari, r2Karari, gKarari,
  listeKarari, defterOku, eylemPlani, bildirimPlani, bildirimGruplari, OZET_ESIK, sql, yedekKomutu, ayarOku, havuz, olc, eylemUygula, raporMd, kos,
  kilitAl, kilitBirak, varsayilanBag, ana,
};

if (require.main === module) {
  ana().then((kod) => { process.exitCode = kod; }, (e) => {
    console.error('sözleşme bekçisi HATA:', e && e.stack ? e.stack : e);
    process.exitCode = CIKIS.HATA;
  });
}

#!/usr/bin/env node
'use strict';

/**
 * G OTOMATİK YAYIN — bir set dört platformda yeni kabukla bitince kurulu paketlerin G kanalına
 * (uzaktan güncelleme) yayın PLANI kurar; `--uygula` ile planı koşturur.
 *
 * NEDEN (06.10, ölçüldü): pipeline paketleri yeniden üretir, R2 `softwares/<id>/`'ye koyar;
 * ama kurulu paketin G istemcisi `<taban>/set/<id>/surum.json` okur ve bütün setlerde 404
 * alır. Yani kurulu paketler yeni üretimden haberdar olmaz. Bu araç o boşluğu kapatan
 * pipeline adımıdır.
 *
 * AKIŞ:  DB (salt okuma) → süzgeç (4 platform bitti + kabuk hedefi + motor kanonik)
 *        → bileşim kapısı
 *        → canlı surum.json/manifest(.sig) → seçim → plan → (--uygula) yayinla → yukle → dogrula.
 *
 * NE YAYINLANIR — YALNIZ KANONİK MOTOR (`bookN/43e23fce2b7009474555a77.js`):
 *   - Paketleyici her pakete kanonik motoru koyar (`motor-surumu.js` motorDegistir) ve DB'ye
 *     `motor_sha12` yazar. Bu araç motoru `~/.empp-agent/motor/` kanonik dosyasından alır; dosyanın
 *     sha256 öneki DB'deki 4 platformun `motor_sha12`'siyle aynı olmalıdır. Bu "kurulu paketle
 *     birebir" kanıtıdır.
 *   - Kök `index.html` OTOMATİK YAYINLANMAZ. G'de `dosya/index.html` dört platformda paylaşılır
 *     (android/ ucu baytı baytına aynı). Paketleyici ise kök index'e platforma özel etiket koyar:
 *     Electron `empp-fs-shim.js`, Android `empp-android-shim.js` (+ fullscreen stili). Android
 *     istemcisi shim'siz index'i `index-android-shim-yok` ile RED eder. Önceki imzalı durumda index
 *     varsa (ör. e2e ile açılmış set) birikimli manifest onu taşır; araç bunu UYARI olarak yazar.
 *     Canlı index shim'siz ise set yeni sürüm almaz, "Nadir kararı" listesine girer.
 *   - Okuyucu kabuğu (bookN `<hash>.main.js` + parçalar, kabuk_surum 1.13.14) G kapsamında DEĞİL
 *     (`durum.gYoluMu`): yeni kabuk kurulu pakete G ile gitmez.
 *
 * SEÇİM ÖLÇÜTÜ (kitap-guncelleme-sozlesmesi "G istemcisi — monoton sürüm"): istemci G'yi yalnız
 * sürümü KURULU sürümden KESİN büyükse uygular; kurulu = max(paket sürümü, son uygulanan G).
 *   1. Bitmemiş: 4 platformdan biri completed değil, kabuk_surum ≠ hedef ya da kabuk_durum ≠ guncel
 *      → seçilmez (yalnız log).
 *   2. Motor: 4 platformda motor_durum='guncel' ve motor_sha12 = kanonik sha12 değilse → atla.
 *   3. Bileşim: geçerli build'in kitapları (n→id) bir önceki build'den farklıysa → "Nadir kararı".
 *      Ekleme G'de `--ekle` ister; o da Android kapısında RED'dir.
 *   4. Canlı surum.json 404 → SEÇ (`ilk`).
 *   5. Canlı var: manifest imzası ÜRETİM anahtarıyla doğrulanır. Her bookN motor girdisi kanonik
 *      sha256'yı taşıyor ve android/surum.json 200 ise → GÜNCEL; değilse → SEÇ.
 *   Yeni G sürümü = sonraki(panel, max(canlı G, paket sürümü)) → paket sürümünden kesin büyük.
 *
 * KAPILAR: yükleme beyaz listesi (`yukle.js` YUKLEME_BEYAZ_LISTE) dışındaki set `--uygula`'da
 * atlanır (kod kapısı, Nadir onayı); tek kopya kilidi; her koşu `~/.empp-agent/log/g-otomatik.log`
 * JSON satırı; hata/atlama/yayın `bildir paket …` (aynı durum 24 saatte bir).
 * TEK YAZAR: önceki durum daima CANLI manifestten (`--onceki-manifest <taban>/…/manifest.json`)
 * okunur, çıktı dizini e2e ile ortaktır (`~/.empp-agent/g-yayin`); canlı daha yeniyse `yukle`
 * reddeder.
 *
 * Kullanım:
 *   node tools/g-yayin/otomatik-yayin.js [--kuru|--uygula] (--tum-yds | <id>... | --set <id,id>)
 *        [--kabuk 1.13.14] [--cikti <dizin>] [--json] [--bildirimsiz]
 * Çıkış: 0 tamam · 1 en az bir set hatalı · 2 argüman hatası · 75 kilit dolu.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const kg = require('../../src/runtime/kitap-guncelleyici');
const gSurum = require('./g-surum');
const anahtar = require('./anahtar');
const yukleMod = require('./yukle');

const AJAN = path.join(os.homedir(), '.empp-agent');
const HEDEF_PLATFORMLAR = Object.freeze(['windows', 'pardus', 'mac', 'android']);
const VARSAYILAN_KABUK = '1.13.14';
const YDS_YAYINCI = 'YDS Publishing';
const YDS_TABAN = 'https://cdn.ydspublishing.com/guncelleme';
const MOTOR_DOSYA_ADI = '43e23fce2b7009474555a77.js';
const LOG_YOLU = path.join(AJAN, 'log', 'g-otomatik.log');
const DURUM_DIZINI = path.join(AJAN, 'g-otomatik');
const KILIT_YOLU = path.join(DURUM_DIZINI, 'kilit');
const BILDIRIM_DURUMU = path.join(DURUM_DIZINI, 'bildirim.json');
const BILDIRIM_ARALIGI_MS = 24 * 60 * 60 * 1000;
const KANONIK_MOTOR_JSON = path.join(AJAN, 'motor', 'kanonik.json');
const KANONIK_MOTOR_DOSYA = path.join(AJAN, 'motor', MOTOR_DOSYA_ADI);
const KAYNAK_ARSIVI = path.join(AJAN, 'kaynak-arsivi');
const SSH_HEDEF = ['-p', '2222', '-o', 'ControlPath=none', '-o', 'ConnectTimeout=15', '-o',
  'BatchMode=yes', 'root@100.117.187.26'];
const YAYINLA_JS = path.join(__dirname, 'yayinla.js');
const ADIM_ZAMAN_ASIMI_MS = 20 * 60 * 1000;
const CIKIS_KILIT = 75;
const KIMLIK_RE = /^[0-9]{1,12}$/;
/** `empp-g-istemci.js` androidSayfasiMi ile aynı desen. */
const ANDROID_SHIM_RE = /<script\b[^>]*\bsrc\s*=\s*["']?[^"'>]*empp-android-shim\.js/i;

/* ------------------------------------------------------------------ argümanlar */

function argsAyristir(argv) {
  const a = { kip: 'kuru', setler: [], tumYds: false, kabuk: VARSAYILAN_KABUK, cikti: null,
    json: false, bildirimsiz: false };
  const liste = Array.isArray(argv) ? argv.slice() : [];
  for (let i = 0; i < liste.length; i++) {
    const b = liste[i];
    const deger = () => {
      const d = liste[i + 1];
      if (d === undefined || d.startsWith('--')) throw new Error(`${b} için değer verilmedi`);
      i += 1;
      return d;
    };
    if (b === '--kuru') a.kip = 'kuru';
    else if (b === '--uygula') a.kip = 'uygula';
    else if (b === '--tum-yds') a.tumYds = true;
    else if (b === '--set') {
      a.setler.push(...deger().split(',').map((s) => s.trim()).filter(Boolean));
    } else if (b === '--kabuk') a.kabuk = deger();
    else if (b === '--cikti') a.cikti = deger();
    else if (b === '--json') a.json = true;
    else if (b === '--bildirimsiz') a.bildirimsiz = true;
    else if (!b.startsWith('--')) a.setler.push(b.trim());
    else throw new Error(`bilinmeyen argüman: ${b}`);
  }
  for (const s of a.setler) {
    if (!KIMLIK_RE.test(s)) throw new Error(`set kimliği sayı olmalı: ${s}`);
  }
  a.setler = [...new Set(a.setler)];
  if (!a.tumYds && !a.setler.length) throw new Error('set listesi ya da --tum-yds gerekli');
  if (!/^\d+\.\d+\.\d+$/.test(a.kabuk)) throw new Error(`--kabuk x.y.z olmalı: ${a.kabuk}`);
  return a;
}

/* ------------------------------------------------------------------ DB (salt okuma) */

/** `pipeline-sql` TSV çıktısı → nesne listesi. Başlık satırı ilk satır; `NULL` → null. */
function tsvAyristir(metin) {
  const satirlar = String(metin || '').split('\n').filter((s) => s.length);
  if (!satirlar.length) return [];
  const basliklar = satirlar[0].split('\t');
  return satirlar.slice(1).map((s) => {
    const p = s.split('\t');
    const o = {};
    basliklar.forEach((b, i) => {
      const v = p[i];
      o[b] = v === undefined || v === 'NULL' ? null : v;
    });
    return o;
  });
}

function shellTirnak(s) {
  return `'${String(s).replace(/'/g, "'\\''")}'`;
}

/** Tek SELECT, `;` yok (pipeline-sql kuralı). Kimlikler yalnız rakam (enjeksiyon kapısı). */
function sqlleriKur({ setler, tumYds }) {
  for (const s of setler || []) if (!KIMLIK_RE.test(String(s))) throw new Error(`kimlik: ${s}`);
  const kosul = tumYds
    ? `b.publisher_name = '${YDS_YAYINCI}'`
    : `b.book_id IN (${setler.join(',')})`;
  const plat = HEDEF_PLATFORMLAR.map((p) => `'${p}'`).join(',');
  return {
    kitaplar:
      'SELECT b.book_id, b.book_title, b.publisher_name, b.set_paket_sayaci ' +
      `FROM pipeline_book_summaries b WHERE ${kosul} AND b.deleted_at IS NULL`,
    platformlar:
      'SELECT p.book_id, p.platform, p.status, p.paket_sayaci, p.motor_sha12, p.motor_durum, ' +
      'p.kabuk_surum, p.kabuk_durum, p.last_run_at FROM pipeline_platform_summaries p ' +
      `JOIN pipeline_book_summaries b ON b.book_id = p.book_id WHERE ${kosul} ` +
      `AND p.platform IN (${plat}) AND p.deleted_at IS NULL`,
    buildler:
      'SELECT k.set_id, k.surum, k.sha256, k.boyut, k.durum, k.kitaplar ' +
      'FROM kaynak_build_surumleri k JOIN pipeline_book_summaries b ON b.book_id = k.set_id ' +
      `WHERE ${kosul}`,
  };
}

/** Varsayılan SQL çalıştırıcı: ssh → `pipeline-sql`. 0 satır = çıkış 1 + boş çıktı → ''. */
function varsayilanSql(sql) {
  const r = spawnSync('ssh', [...SSH_HEDEF, `pipeline-sql ${shellTirnak(sql)}`], {
    encoding: 'utf8', timeout: 60000, maxBuffer: 64 * 1024 * 1024,
  });
  const cikti = r.stdout || '';
  if (r.status === 0) return cikti;
  if (r.status === 1 && !cikti.trim() && !String(r.stderr || '').trim()) return '';
  throw new Error(`pipeline-sql başarısız (çıkış ${r.status}): ` +
    String(r.stderr || r.error || '').trim().slice(0, 200));
}

async function dbOku(a, sqlCalistir) {
  const calistir = typeof sqlCalistir === 'function' ? sqlCalistir : varsayilanSql;
  const q = sqlleriKur(a);
  const k = tsvAyristir(await calistir(q.kitaplar));
  const p = tsvAyristir(await calistir(q.platformlar));
  const b = tsvAyristir(await calistir(q.buildler));
  const gruplu = (liste, alan) => {
    const m = new Map();
    for (const r of liste) {
      const id = String(r[alan]);
      if (!m.has(id)) m.set(id, []);
      m.get(id).push(r);
    }
    return m;
  };
  return { kitaplar: new Map(k.map((r) => [String(r.book_id), r])),
    platformlar: gruplu(p, 'book_id'), buildler: gruplu(b, 'set_id') };
}

/* ------------------------------------------------------------------ saf kararlar */

/** 1. süzgeç: dört platform completed + kabuk hedefi + guncel. */
function platformSuzgeci(satirlar, hedefKabuk) {
  const eksik = [];
  for (const p of HEDEF_PLATFORMLAR) {
    const r = (satirlar || []).find((x) => x.platform === p);
    if (!r) eksik.push(`${p}:satir-yok`);
    else if (r.status !== 'completed') eksik.push(`${p}:${r.status}`);
    else if (r.kabuk_surum !== hedefKabuk) eksik.push(`${p}:kabuk-${r.kabuk_surum}`);
    else if (r.kabuk_durum !== 'guncel') eksik.push(`${p}:kabuk-durum-${r.kabuk_durum}`);
  }
  return { bitti: eksik.length === 0, eksik };
}

/** 2. motor: dört platformun motoru kanonik mi? */
function motorDenetle(satirlar, kanonik) {
  if (!kanonik) return { tamam: false, sebep: 'kanonik-motor-yok' };
  const farkli = [];
  for (const p of HEDEF_PLATFORMLAR) {
    const r = (satirlar || []).find((x) => x.platform === p) || {};
    if (r.motor_durum !== 'guncel' || r.motor_sha12 !== kanonik.sha12) {
      farkli.push(`${p}:${r.motor_sha12 || 'yok'}/${r.motor_durum || 'yok'}`);
    }
  }
  return farkli.length
    ? { tamam: false, sebep: `motor-kanonik-uyusmaz(${farkli.join(',')})` }
    : { tamam: true, sebep: null };
}

function kitaplarCoz(ham) {
  if (Array.isArray(ham)) return ham;
  try {
    const j = JSON.parse(String(ham || ''));
    return Array.isArray(j) ? j : null;
  } catch (e) {
    return null;
  }
}

/** Geçerli build + ondan bir önceki build (G3 sürüm sırasıyla). */
function buildSec(buildler) {
  const gecerliler = (buildler || []).filter(
    (b) => b.durum === 'gecerli' && gSurum.gecerliMi(b.surum),
  );
  if (gecerliler.length !== 1) {
    return { gecerli: null, onceki: null, sebep: `gecerli-build-sayisi-${gecerliler.length}` };
  }
  const gecerli = gecerliler[0];
  const oncekiler = (buildler || []).filter(
    (b) => b !== gecerli && gSurum.gecerliMi(b.surum) && gSurum.kiyasla(b.surum, gecerli.surum) < 0,
  );
  oncekiler.sort((x, y) => gSurum.kiyasla(y.surum, x.surum));
  return { gecerli, onceki: oncekiler[0] || null, sebep: null };
}

/** 3. bileşim: n→id kıyası. Önceki build yoksa kıyas yapılamaz; değişmedi sayılır, not düşülür. */
function bilesimKiyasla(gecerli, onceki) {
  const bos = { eklenen: [], cikan: [], degisen: [] };
  const g = kitaplarCoz(gecerli && gecerli.kitaplar);
  if (!g) return { degisti: true, sebep: 'gecerli-kitaplar-okunamadi', ...bos };
  if (!onceki) return { degisti: false, sebep: 'onceki-build-yok', ...bos };
  const o = kitaplarCoz(onceki.kitaplar);
  if (!o) return { degisti: true, sebep: 'onceki-kitaplar-okunamadi', ...bos };
  const gm = new Map(g.map((k) => [Number(k.n), String(k.id)]));
  const om = new Map(o.map((k) => [Number(k.n), String(k.id)]));
  const sirali = (l) => l.sort((x, y) => x - y);
  const eklenen = sirali([...gm.keys()].filter((n) => !om.has(n)));
  const cikan = sirali([...om.keys()].filter((n) => !gm.has(n)));
  const degisen = sirali([...gm.keys()].filter((n) => om.has(n) && om.get(n) !== gm.get(n)));
  const degisti = eklenen.length + cikan.length + degisen.length > 0;
  return { degisti, sebep: degisti ? 'bilesim-degisti' : null, eklenen, cikan, degisen };
}

function dizinSirala(x, y) {
  return Number(x.slice(4)) - Number(y.slice(4));
}

/** Motor yayınlanacak kitap dizinleri: yerel build listesi varsa ondan (kesin), yoksa DB n'leri. */
function motorDizinleri(gecerli, zipGirdileri) {
  if (Array.isArray(zipGirdileri)) {
    const re = new RegExp(`^(book\\d+)/${MOTOR_DOSYA_ADI.replace(/\./g, '\\.')}$`);
    const d = zipGirdileri.map((y) => (re.exec(y) || [])[1]).filter(Boolean);
    return { dizinler: [...new Set(d)].sort(dizinSirala), kaynak: 'yerel-build' };
  }
  const k = kitaplarCoz(gecerli && gecerli.kitaplar) || [];
  const d = k.map((x) => Number(x.n)).filter((n) => Number.isInteger(n) && n > 0)
    .map((n) => `book${n}`);
  return { dizinler: [...new Set(d)].sort(dizinSirala), kaynak: 'db-kitaplar' };
}

/** Paket sürümü = 2.<panel>.<en büyük sayaç> (geçerli build sürümü, set ve 4 platform sayacı). */
function paketSurumu(gecerli, satirlar, kitap) {
  const c = gSurum.coz(gecerli.surum);
  const sayaclar = [c.sayac, Number(kitap && kitap.set_paket_sayaci) || 0];
  for (const r of satirlar || []) sayaclar.push(Number(r.paket_sayaci) || 0);
  return `2.${c.panel}.${Math.max(...sayaclar)}`;
}

/* ------------------------------------------------------------------ canlı uç */

async function canliOku(taban, setKimligi, getir, acik) {
  const al = typeof getir === 'function' ? getir : kg.varsayilanGetir;
  const kok = `${taban}/set/${encodeURIComponent(setKimligi)}`;
  const sonuc = { http: null, surum: null, manifest: null, androidHttp: null,
    androidIndexShimli: null, hata: null };
  try {
    const s = await al(`${kok}/surum.json`, { zamanAsimi: 30000 });
    sonuc.http = s ? s.durum : null;
    if (sonuc.http === 404) return sonuc;
    if (sonuc.http !== 200) {
      sonuc.hata = `surum.json HTTP ${sonuc.http}`;
      return sonuc;
    }
    const sj = JSON.parse(Buffer.from(s.govde).toString('utf8'));
    sonuc.surum = sj && gSurum.gecerliMi(sj.surum) ? sj.surum : null;
    if (!sonuc.surum) {
      sonuc.hata = 'canlı surum.json G3 değil';
      return sonuc;
    }
    const m = await al(`${kok}/manifest.json`, { zamanAsimi: 30000 });
    const i = await al(`${kok}/manifest.json${kg.IMZA_UZANTI}`, { zamanAsimi: 30000 });
    if (!m || m.durum !== 200 || !i || i.durum !== 200) {
      sonuc.hata = `manifest/imza HTTP ${m && m.durum}/${i && i.durum}`;
      return sonuc;
    }
    const govde = Buffer.from(m.govde);
    if (!anahtar.dogrula(govde, Buffer.from(i.govde).toString('utf8'), acik)) {
      sonuc.hata = 'canlı manifest ÜRETİM anahtarıyla doğrulanmadı';
      return sonuc;
    }
    const mj = JSON.parse(govde.toString('utf8'));
    const kimlikTutar = String(mj.setKimligi) === String(setKimligi);
    if (mj.kanal !== 'G' || !kimlikTutar || mj.surum !== sonuc.surum) {
      sonuc.hata = `canlı manifest tutarsız (kanal ${mj.kanal}, set ${mj.setKimligi}, ` +
        `sürüm ${mj.surum})`;
      return sonuc;
    }
    sonuc.manifest = mj;
    const an = await al(`${kok}/android/surum.json`, { zamanAsimi: 30000 });
    sonuc.androidHttp = an ? an.durum : null;
    if ((mj.kabuk || []).some((g) => g && g.yol === 'index.html')) {
      const ix = await al(`${kok}/android/dosya/index.html`, { zamanAsimi: 30000 });
      sonuc.androidIndexShimli = ix && ix.durum === 200
        ? ANDROID_SHIM_RE.test(Buffer.from(ix.govde).toString('utf8'))
        : false;
    }
  } catch (e) {
    sonuc.hata = `canlı okuma: ${e && e.message ? e.message : e}`;
  }
  return sonuc;
}

/** 4-5. canlı duruma göre seçim (saf). */
function canliKarari(canli, dizinler, kanonikSha256) {
  if (canli.hata) return { karar: 'hata', sebep: canli.hata };
  if (canli.http === 404) return { karar: 'sec', sebep: 'ilk (canlı surum.json 404)' };
  const girdiler = (canli.manifest && canli.manifest.kabuk) || [];
  const kabuk = new Map(girdiler.map((g) => [g.yol, g.sha256]));
  const farkli = dizinler.filter((d) => kabuk.get(`${d}/${MOTOR_DOSYA_ADI}`) !== kanonikSha256);
  if (farkli.length) return { karar: 'sec', sebep: `motor-farki(${farkli.join(',')})` };
  if (canli.androidHttp !== 200) {
    return { karar: 'sec', sebep: `android-ucu-eksik(HTTP ${canli.androidHttp})` };
  }
  return { karar: 'guncel', sebep: `canlı ${canli.surum}: motorlar kanonik` };
}

/** Plan komutları: e2e'nin üç adımı açık hâliyle (üret → yükle --onayli → doğrula --uzak). */
function komutlariKur({ setKimligi, taban, cikti, panel, paketSurum, ilk, dizinler, motorYolu,
  tahminiSurum }) {
  const uret = ['yayinla', '--set-kimligi', setKimligi, '--taban', taban, '--cikti', cikti,
    '--panel', String(panel), '--onceki-surum', paketSurum,
    '--onceki-manifest', `${taban}/set/${setKimligi}/manifest.json`];
  if (ilk) uret.push('--ilk');
  for (const d of dizinler) uret.push('--motor', `${d}=${motorYolu}`);
  uret.push('--anahtar-zinciri');
  return [
    { ad: 'uret', arg: uret },
    { ad: 'yukle', arg: ['yukle', '--set-kimligi', setKimligi, '--cikti', cikti, '--onayli'] },
    { ad: 'dogrula', arg: ['dogrula', '--uzak', taban, '--set-kimligi', setKimligi, '--surum',
      tahminiSurum] },
  ];
}

function komutMetni(arg) {
  return ['node', 'tools/g-yayin/yayinla.js', ...arg]
    .map((p) => (/[\s'"]/.test(p) ? shellTirnak(p) : p)).join(' ');
}

/* ------------------------------------------------------------------ yerel kaynaklar */

/** Kanonik motor: kanonik.json + dosya; sha256 öneki ve boyut tutmalı. Şüphede null. */
function kanonikMotorOku(jsonYolu = KANONIK_MOTOR_JSON, dosyaYolu = KANONIK_MOTOR_DOSYA) {
  try {
    const j = JSON.parse(fs.readFileSync(jsonYolu, 'utf8'));
    const veri = fs.readFileSync(dosyaYolu);
    const sha256 = crypto.createHash('sha256').update(veri).digest('hex');
    if (typeof j.sha12 !== 'string' || j.sha12.length !== 12 || !sha256.startsWith(j.sha12)) {
      return null;
    }
    if (j.boyut != null && Number(j.boyut) !== veri.length) return null;
    return { sha12: j.sha12, sha256, boyut: veri.length, yol: dosyaYolu };
  } catch (e) {
    return null;
  }
}

/** Yerel kaynak arşivi geçerli build'le birebir mi? Öyleyse zip girdi listesi (merkez dizin). */
function yerelBuildListesi(setKimligi, gecerli) {
  try {
    const dizin = path.join(KAYNAK_ARSIVI, String(setKimligi));
    const k = JSON.parse(fs.readFileSync(path.join(dizin, 'kaynak.json'), 'utf8'));
    if (k.r2Surum !== gecerli.surum || k.sha256 !== gecerli.sha256) return null;
    const r = spawnSync('unzip', ['-Z1', path.join(dizin, k.dosya || 'build.zip')], {
      encoding: 'utf8', timeout: 60000, maxBuffer: 256 * 1024 * 1024,
    });
    return r.status === 0 ? r.stdout.split('\n').filter(Boolean) : null;
  } catch (e) {
    return null;
  }
}

/* ------------------------------------------------------------------ kilit, log, bildirim */

function surecYasiyorMu(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

/** Tek kopya kilidi. Dolu ve sahibi yaşıyorsa `{alindi:false}`; sahibi ölmüşse devralınır. */
function kilitAl(yol = KILIT_YOLU, { pid = process.pid, yasiyorMu = surecYasiyorMu } = {}) {
  fs.mkdirSync(path.dirname(yol), { recursive: true });
  const icerik = JSON.stringify({ pid, zaman: new Date().toISOString() });
  try {
    fs.writeFileSync(yol, icerik, { flag: 'wx' });
    return { alindi: true, yol, pid };
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }
  let sahip = null;
  try {
    sahip = JSON.parse(fs.readFileSync(yol, 'utf8'));
  } catch (e) {
    sahip = null;
  }
  if (sahip && Number.isInteger(sahip.pid) && yasiyorMu(sahip.pid)) {
    return { alindi: false, yol, sahip };
  }
  const gecici = `${yol}.${pid}.gecici`;
  fs.writeFileSync(gecici, icerik);
  fs.renameSync(gecici, yol);
  const son = JSON.parse(fs.readFileSync(yol, 'utf8'));
  return son.pid === pid
    ? { alindi: true, yol, pid, devralinan: sahip }
    : { alindi: false, yol, sahip: son };
}

function kilitBirak(k) {
  if (!k || !k.alindi) return;
  try {
    const s = JSON.parse(fs.readFileSync(k.yol, 'utf8'));
    if (s.pid === k.pid) fs.unlinkSync(k.yol);
  } catch (e) {
    // kilit zaten yok ya da başkasının: dokunma
  }
}

function logYaz(kayit, yol = LOG_YOLU) {
  fs.mkdirSync(path.dirname(yol), { recursive: true });
  fs.appendFileSync(yol, JSON.stringify(kayit) + '\n');
}

/** `bildir paket <mesaj>` — token/sır basmaz (bildir kendi yapılandırmasını okur). */
function varsayilanBildir(mesaj) {
  const r = spawnSync('bildir', ['paket', mesaj, '-b', 'G otomatik yayın'], {
    encoding: 'utf8', timeout: 30000,
  });
  return r.status === 0;
}

/** Aynı (set, karar, sebep) için 24 saatte bir bildirim. */
function bildirimSuzgeci(durumYolu, simdi) {
  let d = {};
  try {
    d = JSON.parse(fs.readFileSync(durumYolu, 'utf8'));
  } catch (e) {
    d = {};
  }
  return {
    gecsin(anahtarAd) {
      const son = d[anahtarAd];
      if (son && simdi - son < BILDIRIM_ARALIGI_MS) return false;
      d[anahtarAd] = simdi;
      return true;
    },
    kaydet() {
      fs.mkdirSync(path.dirname(durumYolu), { recursive: true });
      fs.writeFileSync(durumYolu, JSON.stringify(d, null, 2));
    },
  };
}

/* ------------------------------------------------------------------ uygula */

function varsayilanAdimKos(arg) {
  return new Promise((coz) => {
    const c = spawn(process.execPath, [YAYINLA_JS, ...arg], {
      cwd: path.resolve(__dirname, '..', '..'), stdio: ['ignore', 'pipe', 'pipe'],
    });
    const o = [];
    let h = '';
    const zaman = setTimeout(() => c.kill('SIGTERM'), ADIM_ZAMAN_ASIMI_MS);
    c.stdout.on('data', (b) => o.push(b));
    c.stderr.on('data', (b) => {
      if (h.length < 4000) h += b.toString('utf8');
    });
    c.on('error', (e) => {
      clearTimeout(zaman);
      coz({ kod: -1, stdout: '', stderr: e.message });
    });
    c.on('close', (kod) => {
      clearTimeout(zaman);
      coz({ kod, stdout: Buffer.concat(o).toString('utf8'), stderr: h });
    });
  });
}

function jsonCoz(metin) {
  try {
    return JSON.parse(metin);
  } catch (e) {
    return null;
  }
}

/** Plan adımlarını sırayla koşturur; düşen adımdan sonrası koşmaz. */
async function planiUygula(p, adimKos) {
  const kos = typeof adimKos === 'function' ? adimKos : varsayilanAdimKos;
  const sonuc = { gecti: false, yeniSurum: null, adimlar: {} };
  for (const k of p.komutlar) {
    const arg = k.arg.slice();
    if (k.ad === 'dogrula' && sonuc.yeniSurum) arg[arg.length - 1] = sonuc.yeniSurum;
    const r = await kos(arg);
    const j = jsonCoz(r.stdout);
    const adim = { kod: r.kod, hata: r.kod === 0 ? null : (r.stderr || '').trim().slice(0, 300) };
    if (k.ad === 'uret' && j) sonuc.yeniSurum = j.surum || null;
    if (k.ad === 'yukle' && j) {
      Object.assign(adim, { yuklenen: (j.yuklenen || []).length, cakisma: j.cakisma,
        dogrulaGecti: j.dogrula ? j.dogrula.gecti : null });
    }
    if (k.ad === 'dogrula' && j) {
      Object.assign(adim, { gecti: j.gecti, surum: j.surum,
        hatalar: (j.hatalar || []).slice(0, 5) });
    }
    sonuc.adimlar[k.ad] = adim;
    if (r.kod !== 0) return sonuc;
  }
  sonuc.gecti = true;
  return sonuc;
}

/* ------------------------------------------------------------------ ana akış */

async function setiDegerlendir(id, { a, db, kanonik, cikti, acik, ops }) {
  const kitap = db.kitaplar.get(id) || null;
  const satirlar = db.platformlar.get(id) || [];
  const s = { set: id, ad: kitap ? kitap.book_title : null, karar: null, sebep: null,
    uyarilar: [],
    beyazListe: Object.prototype.hasOwnProperty.call(yukleMod.YUKLEME_BEYAZ_LISTE, id) };
  if (!kitap) return Object.assign(s, { karar: 'atla', sebep: 'db-kaydi-yok' });
  const suz = platformSuzgeci(satirlar, a.kabuk);
  if (!suz.bitti) return Object.assign(s, { karar: 'bitmemis', sebep: suz.eksik.join(',') });
  const md = motorDenetle(satirlar, kanonik);
  if (!md.tamam) return Object.assign(s, { karar: 'atla', sebep: md.sebep });
  const bs = buildSec(db.buildler.get(id));
  if (!bs.gecerli) return Object.assign(s, { karar: 'atla', sebep: bs.sebep });
  s.kaynakSurum = bs.gecerli.surum;
  const bil = bilesimKiyasla(bs.gecerli, bs.onceki);
  s.bilesim = bil;
  if (bil.degisti) {
    return Object.assign(s, { karar: 'nadir', sebep: `${bil.sebep} (eklenen [${bil.eklenen}], ` +
      `çıkan [${bil.cikan}], değişen [${bil.degisen}]) — ekleme --ekle ister, Android kapısında ` +
      'RED; Nadir kararı' });
  }
  if (bil.sebep) s.uyarilar.push(bil.sebep);
  const yt = yukleMod.YUKLEME_BEYAZ_LISTE[id];
  const taban = yt ? yt.taban : kitap.publisher_name === YDS_YAYINCI ? YDS_TABAN : null;
  if (!taban) {
    return Object.assign(s, { karar: 'atla',
      sebep: 'taban-bilinmiyor (YDS değil, beyaz listede yok)' });
  }
  s.taban = taban;
  let zip;
  if ('zipListe' in ops) {
    zip = typeof ops.zipListe === 'function' ? ops.zipListe(id, bs.gecerli) : ops.zipListe;
  } else {
    zip = yerelBuildListesi(id, bs.gecerli);
  }
  const mdz = motorDizinleri(bs.gecerli, zip);
  s.motorDizinleri = mdz.dizinler;
  s.motorDizinKaynagi = mdz.kaynak;
  if (!mdz.dizinler.length) {
    return Object.assign(s, { karar: 'atla',
      sebep: `bookN motoru yok (${mdz.kaynak}; A1 düzeni — kök motor G kapsamı dışında)` });
  }
  s.paketSurum = paketSurumu(bs.gecerli, satirlar, kitap);
  s.canli = await canliOku(taban, id, ops.getir, acik);
  if (s.canli.androidIndexShimli === false && !s.canli.hata) {
    // Birikimli manifest shim'siz index'i her yeni sürüme taşır → Android her sürümü RED eder
    // (gerçek empp-g-istemci ölçümü 06.10: 2.25.8 red, index'siz 2.25.9 kabul). Çözüm:
    // `yayinla.js --dusur index.html` ile index'i düşüren sürüm (insan kararı; otomatik değil).
    // Kapı canlı MANIFESTE bakar: index düştükten sonra R2'de kalan eski android/dosya/index.html
    // kapıyı tetiklemez. Yeni sürüm yayınlanmaz.
    return Object.assign(s, { karar: 'nadir',
      sebep: `android-donuk-index: canlı ${s.canli.surum} ` +
      'index.html empp-android-shim taşımıyor; birikimli manifest onu her sürüme taşır, Android ' +
      'index-android-shim-yok ile RED eder. Önce index düşüren sürüm: yayinla.js --dusur ' +
      'index.html (Nadir kararı)' });
  }
  const ck = canliKarari(s.canli, mdz.dizinler, kanonik.sha256);
  s.karar = ck.karar;
  s.sebep = ck.sebep;
  if (s.karar !== 'sec') return s;
  const panel = gSurum.coz(bs.gecerli.surum).panel;
  s.tahminiSurum = gSurum.sonraki(panel, gSurum.enBuyuk([s.canli.surum, s.paketSurum]));
  s.komutlar = komutlariKur({ setKimligi: id, taban, cikti, panel, paketSurum: s.paketSurum,
    ilk: s.canli.http === 404, dizinler: mdz.dizinler, motorYolu: kanonik.yol,
    tahminiSurum: s.tahminiSurum });
  s.plan = s.komutlar.map((k) => komutMetni(k.arg));
  return s;
}

/**
 * @param {object} a argsAyristir çıktısı
 * @param {{sql?, getir?, kanonik?, zipListe?, adimKos?, bildir?, logYolu?, kilitYolu?,
 *   bildirimYolu?, simdi?, acik?, pid?, yasiyorMu?}} [ops] test enjeksiyonu
 */
async function kos(a, ops = {}) {
  const simdi = typeof ops.simdi === 'number' ? ops.simdi : Date.now();
  const zaman = new Date(simdi).toISOString();
  const logYolu = ops.logYolu || LOG_YOLU;
  const kilit = kilitAl(ops.kilitYolu || KILIT_YOLU, { pid: ops.pid || process.pid,
    yasiyorMu: ops.yasiyorMu || surecYasiyorMu });
  if (!kilit.alindi) {
    logYaz({ zaman, kip: a.kip, olay: 'kilit-dolu', sahip: kilit.sahip }, logYolu);
    return { zaman, kip: a.kip, cikis: CIKIS_KILIT, kilitDolu: true, sahip: kilit.sahip,
      setler: [], nadirKarari: [] };
  }
  const bildir = typeof ops.bildir === 'function' ? ops.bildir : varsayilanBildir;
  const suzgec = bildirimSuzgeci(ops.bildirimYolu || BILDIRIM_DURUMU, simdi);
  const bildirimAcik = !a.bildirimsiz && a.kip === 'uygula';
  const acik = ops.acik || anahtar.URETIM_ACIK_ANAHTAR;
  const cikti = path.resolve(a.cikti || yukleMod.E2E_VARSAYILAN_CIKTI);
  const rapor = { zaman, kip: a.kip, kabuk: a.kabuk, setler: [], nadirKarari: [], cikis: 0 };
  try {
    const kanonik = 'kanonik' in ops ? ops.kanonik : kanonikMotorOku();
    rapor.kanonikMotor = kanonik ? kanonik.sha12 : null;
    const db = await dbOku(a, ops.sql);
    const kimlikler = a.tumYds ? [...db.kitaplar.keys()] : a.setler.slice();
    kimlikler.sort((x, y) => Number(x) - Number(y));
    for (const id of kimlikler) {
      const s = await setiDegerlendir(id, { a, db, kanonik, cikti, acik, ops });
      if (s.karar === 'sec' && a.kip === 'uygula') {
        if (!s.beyazListe) {
          s.karar = 'atla';
          s.sebep = `beyaz-liste-disi (yukle.js YUKLEME_BEYAZ_LISTE) — seçim sebebi: ${s.sebep}`;
        } else {
          s.uygulama = await planiUygula(s, ops.adimKos);
          s.karar = s.uygulama.gecti ? 'yayinlandi' : 'hata';
          if (!s.uygulama.gecti) {
            s.sebep = `uygulama düştü: ${JSON.stringify(s.uygulama.adimlar)}`.slice(0, 400);
          }
        }
      }
      rapor.setler.push(s);
      if (s.karar === 'nadir') {
        rapor.nadirKarari.push({ set: id, sebep: s.sebep, bilesim: s.bilesim });
      }
      if (s.karar === 'hata') rapor.cikis = 1;
      const u = s.uygulama || null;
      logYaz({ zaman, kip: a.kip, set: id, karar: s.karar, sebep: s.sebep,
        http: s.canli ? s.canli.http : null, canliSurum: s.canli ? s.canli.surum : null,
        paketSurum: s.paketSurum || null,
        yeniSurum: (u && u.yeniSurum) || s.tahminiSurum || null,
        dogrula: u && u.adimlar.dogrula ? u.adimlar.dogrula.gecti : null,
        uyarilar: s.uyarilar.length ? s.uyarilar : undefined }, logYolu);
      const bildirilecek = ['hata', 'nadir', 'atla', 'yayinlandi'].includes(s.karar);
      if (bildirilecek && bildirimAcik) {
        const ad = s.karar === 'yayinlandi'
          ? `${id}:yayinlandi:${u.yeniSurum}`
          : `${id}:${s.karar}:${s.sebep}`;
        if (suzgec.gecsin(ad)) bildir(`G ${id} ${s.karar}: ${String(s.sebep).slice(0, 180)}`);
      }
    }
  } catch (e) {
    rapor.cikis = 1;
    rapor.hata = e && e.message ? e.message : String(e);
    logYaz({ zaman, kip: a.kip, olay: 'kosu-hatasi', hata: rapor.hata }, logYolu);
    if (bildirimAcik && suzgec.gecsin(`kosu:${rapor.hata}`)) {
      bildir(`G otomatik koşu hatası: ${rapor.hata.slice(0, 180)}`);
    }
  } finally {
    try {
      suzgec.kaydet();
    } catch (e) {
      // bildirim durumu yazılamazsa koşu sonucu değişmez
    }
    kilitBirak(kilit);
  }
  return rapor;
}

function ozetMetni(r) {
  if (r.kilitDolu) {
    return `KİLİT DOLU — başka koşu sürüyor (pid ${r.sahip && r.sahip.pid}); çıkış ${r.cikis}`;
  }
  const say = {};
  for (const s of r.setler) say[s.karar] = (say[s.karar] || 0) + 1;
  const satir = [`G otomatik — kip ${r.kip}, kabuk ${r.kabuk}, kanonik motor ${r.kanonikMotor}, ` +
    `${r.setler.length} set: ${Object.entries(say).map(([k, v]) => `${k} ${v}`).join(', ')}`];
  if (r.hata) satir.push(`HATA: ${r.hata}`);
  for (const s of r.setler) {
    let ek = '';
    if (s.paketSurum) {
      ek = ` [paket ${s.paketSurum}, canlı ${s.canli && (s.canli.surum || s.canli.http)}` +
        `${s.tahminiSurum ? `, yeni ${s.tahminiSurum}` : ''}, motor ${s.motorDizinleri.join('+')}` +
        ` (${s.motorDizinKaynagi}), beyaz liste ${s.beyazListe ? 'evet' : 'hayır'}]`;
    }
    satir.push(`- ${s.set} ${s.ad || ''} → ${s.karar}: ${s.sebep}${ek}`);
    for (const u of s.uyarilar || []) satir.push(`    ! ${u}`);
    for (const p of s.plan || []) satir.push(`    $ ${p}`);
  }
  if (r.nadirKarari.length) {
    satir.push(`Nadir kararı: ${r.nadirKarari.map((n) => n.set).join(', ')}`);
  }
  return satir.join('\n');
}

async function main(argv, ops = {}) {
  let a;
  try {
    a = argsAyristir(argv);
  } catch (e) {
    return { cikis: 2, metin: `HATA: ${e.message}` };
  }
  const r = await kos(a, ops);
  return { cikis: r.cikis, metin: a.json ? JSON.stringify(r, null, 2) : ozetMetni(r), rapor: r };
}

module.exports = {
  HEDEF_PLATFORMLAR,
  VARSAYILAN_KABUK,
  CIKIS_KILIT,
  LOG_YOLU,
  KILIT_YOLU,
  argsAyristir,
  tsvAyristir,
  shellTirnak,
  sqlleriKur,
  dbOku,
  platformSuzgeci,
  motorDenetle,
  buildSec,
  bilesimKiyasla,
  motorDizinleri,
  paketSurumu,
  canliOku,
  canliKarari,
  komutlariKur,
  kanonikMotorOku,
  kilitAl,
  kilitBirak,
  planiUygula,
  kos,
  main,
};

if (require.main === module) {
  main(process.argv.slice(2))
    .then((s) => {
      console.log(s.metin);
      process.exitCode = s.cikis;
    })
    .catch((e) => {
      console.error('HATA: ' + (e && e.message ? e.message : e));
      process.exitCode = 1;
    });
}

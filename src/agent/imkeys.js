'use strict';

/**
 * ÇEVRİMDIŞI AKTİVASYON ANAHTARLARI — `imKeys.dll` (güvenlik, Nadir 02.10).
 *
 * KÖK NEDEN (yayıncı okuyucusu, webpack modül 6395 + aktivasyon diyaloğu; 45550 `95bccb…main.js`,
 * 45480 pardus paketi `a8f43f74…main.js` — ikisinde de aynı mantık):
 *   - Açılışta `window.isOnline = await fetch(AppConfig.baseEndpointUrl, {method:'HEAD',
 *     mode:'no-cors', timeout:5000})` → ağ hatası = çevrimdışı (YDS: `https://akillitahta.
 *     ydspublishing.com`; ayarsızsa `https://www.sorucoz.tv`). Sonra `window.fetch` sarılır:
 *     çevrimdışıyken HER http isteği "Network is offline" fırlatır.
 *   - Kapak "anahtarlı mı" (`g(cover)`): `assets/<id>/imKeys.dll` VARSA true (ağsız); yoksa
 *     `HasZKitapKey` isteği — çevrimdışıyken catch → false → kitap KOD SORULMADAN açılır.
 *   - Aktivasyon diyaloğu (set düzeyi `main.activation="true"` ya da anahtarlı kapak):
 *     `JJ(cover.book + "/imKeys.dll")` boşsa VE çevrimdışıysa `ACTIVATE_PRODUCTION("123456")` —
 *     uygulama kendini SABİT 123456 ile aktive eder. Doluysa `SET_IM_KEYS_FOR_BOOK` ile liste
 *     yüklenir; çevrimdışı doğrulama `imKeys.findIndex(e => DR(e) == girilen.toUpperCase())`.
 *     Set diyaloğunda `cover` yoktur → okunan dosya `module.covers[0]`'ınkidir.
 *   İmpark'ın kendi exe'lerinde (ve onlardan türeyen bütün build'lerimizde) `imKeys.dll` YOK →
 *   aktivasyonlu setler çevrimdışında kodsuz açılıyordu.
 *
 * BİÇİM (okuyucunun `O()` + `_()` + `x()/S()` çözücüsünden): dosya baytları b → (256 − b) mod 256,
 * sonuç UTF-8 bir JSON dizisi; her öğe `156 − charCode` ile bellekte gizlenir ve karşılaştırmada
 * aynı dönüşümle geri açılır (iki kez uygulanınca kimlik) — yani JSON'daki öğeler DÜZ, BÜYÜK
 * HARFLİ kodlardır. Okunamayan dosya `"[]"` sayılır (= boş = 123456 kapısı açık).
 *
 * KAYNAK: key.ydspublishing.com iç API'si (`GET /ic/paket/<paket>/kodlar?sade=1&durum=gecerli`,
 * `x-jeton`; yalnız srv21'in 127.0.0.1:8801'i — dışarıya 404). Varsayılan taşıyıcı ssh: jeton
 * srv21'deki env dosyasından UZAKTA okunur, bu makineye ya da log'a hiç düşmez. Alternatif:
 * `EMPP_KEYPANEL_IC_URL` + `EMPP_KEYPANEL_IC_JETON` (srv21 üstünde koşan ajan için doğrudan HTTP).
 * "Anahtarlı mı" sorusu okuyucunun kendi sorusu: `HasZKitapKey?kitapId=<id>` (salt okuma GET).
 *
 * KAPI: anahtarlı kapakta `imKeys.dll` yoksa/boşsa paket YAYINLANMAZ (neden kodu `imkeys-yok`).
 * Anahtar çekilemezse (ağ/yetki/Cloudflare) iş ERTELENİR (`gecici`) — boş imKeys'le yayın YOK.
 * GERÇEK KOD HİÇBİR LOG/HATA METNİNE YAZILMAZ: yalnız sayılar.
 */

const fsp = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');
const M = require('./icerik-merdiven');
const ig = require('../runtime/icerik-guncelleme');

const ISARET = '[imkeys]';
const NEDEN_KODU = 'imkeys-yok';
const DOSYA_ADI = 'imKeys.dll';
const ICERIK_SONEKI = 'data/BookContent.xml';
const HAS_KEY_VARSAYILAN = 'https://akillitahta.ydspublishing.com/TestlerMobil/HasZKitapKey?kitapId={kitapId}';
const SSH_HEDEF_VARSAYILAN = 'root@100.117.187.26';
const SSH_PORT_VARSAYILAN = '2222';
const KEYPANEL_ENV_VARSAYILAN = '/root/keypanel/data/keypanel.env';
const KEYPANEL_YEREL = 'http://127.0.0.1:8801';
/** Kod deseni geniş tutulur (keypanel: 25 harf+rakam, 5 hane); okuyucu büyük harfle karşılaştırır. */
const KOD_DESENI = /^[A-Z0-9-]{3,64}$/;
/** ImWin32 menüsü yalnız kökte, `bookN/` altında ya da tek sarmalayıcı klasörde aranır. */
const MENU_DESENI = /^((?:[^/]+\/)?(?:book\d+\/)?)classlibraries\/ImWin32\.dll$/i;
const SAYISAL_ICERIK = /^((?:[^/]+\/)?(?:book\d+\/)?)assets\/([1-9]\d*)\/data\/BookContent\.xml$/;

class ImKeysHatasi extends Error {
  /** @param {string} mesaj  @param {{gecici?: boolean}} [o] gecici=true → ertele, değilse kalıcı RED */
  constructor(mesaj, { gecici = false } = {}) {
    super(mesaj);
    this.name = 'ImKeysHatasi';
    this.gecici = Boolean(gecici);
    this.nedenKodu = gecici ? null : NEDEN_KODU;
  }
}

const imparkKimligiMi = (id) => /^[1-9]\d*$/.test(String(id == null ? '' : id));
const artikMi = (ad) => ad.split('/').some((s) => s === '__MACOSX' || s.startsWith('._'));

/** Kodları okuyucunun karşılaştırdığı biçime getirir: kırp, büyük harf, tekil, sıralı; geçersizi at. */
function kodlariNormallestir(kodlar) {
  const kume = new Set();
  let atilan = 0;
  for (const k of Array.isArray(kodlar) ? kodlar : []) {
    const t = String(k == null ? '' : k).trim().toUpperCase();
    if (KOD_DESENI.test(t)) kume.add(t); else atilan += 1;
  }
  return { kodlar: [...kume].sort(), atilan };
}

/** Kod listesi → `imKeys.dll` baytları (okuyucunun `O()`'sunun tersi; işlem kendi tersidir). */
function imKeysBicimle(kodlar) {
  const { kodlar: temiz } = kodlariNormallestir(kodlar);
  const b = Buffer.from(JSON.stringify(temiz), 'utf8');
  for (let i = 0; i < b.length; i++) b[i] = (256 - b[i]) & 0xff;
  return b;
}

/**
 * `imKeys.dll` baytları → kodlar; okuyucunun `O()` + `_()` + `DR()` zincirinin birebir benzeri.
 * Okunamayan/bozuk/dizi olmayan → [] (okuyucu da `"[]"`/`[]` sayar).
 */
function imKeysCoz(veri) {
  if (veri == null) return [];
  const b = Buffer.from(veri);
  for (let i = 0; i < b.length; i++) b[i] = (256 - b[i]) & 0xff;
  let d;
  try { d = JSON.parse(new TextDecoder().decode(b)); } catch (_) { return []; }
  if (!Array.isArray(d)) return [];
  const gizle = (s) => String(s).split('').map((c) => String.fromCharCode(156 - c.charCodeAt(0))).join('');
  // JJ: bellekte gizle; DR: karşılaştırmada aç — sonuç öğenin kendisi.
  return d.filter((e) => typeof e === 'string').map((e) => gizle(gizle(e)));
}

/** Okuyucunun çevrimdışı kod kararı (simülasyon/test): 'otomatik-123456' | 'kabul' | 'red'. */
function cevrimdisiKarar(veri, girilen) {
  const liste = imKeysCoz(veri);
  if (liste.length < 1) return 'otomatik-123456';
  const r = String(girilen == null ? '' : girilen).toUpperCase();
  return liste.findIndex((e) => e === r) >= 0 ? 'kabul' : 'red';
}

function attr(etiket, ad) {
  const m = String(etiket || '').match(new RegExp(`\\b${ad}="([^"]*)"`));
  return m ? m[1] : null;
}

/**
 * Build'deki kapaklar — okuyucunun gördüğü gibi: her ImWin32 menüsü (kök / bookN / sarmalayıcı)
 * çözülür, `<cover ID xmlSource>` → imKeys yolu = menü kökü + xmlSource'ta `data/BookContent.xml`
 * yerine `imKeys.dll` (okuyucunun `g()`'si de böyle kurar). Menüsü çözülemeyen kökte sayısal
 * `assets/<id>/data/BookContent.xml` dizinleri yedek yol. İçeriği build'de olmayan kapak alınmaz.
 * @param {{dizin: Map<string, object>, oku: (girdi: object) => Buffer}} z
 * @returns {{kapaklar: Array<{id: string, imKeysYolu: string, icerikYolu: string, kok: string,
 *   ilk: boolean, kaynak: 'menu'|'dizin'}>, menuler: Array<{kok: string, setId: string|null,
 *   setAktivasyon: boolean}>, kimliksiz: string[]}}
 */
function kapaklariBul(z) {
  const kapaklar = [];
  const menuler = [];
  const kimliksiz = [];
  const cozulenKokler = new Set();
  const var_ = (ad) => { const g = z.dizin.get(ad); return Boolean(g && !g.dizin); };
  for (const [ad, g] of z.dizin) {
    const m = MENU_DESENI.exec(ad);
    if (!m || g.dizin || artikMi(ad)) continue;
    const kok = m[1];
    let xml = null;
    try { xml = ig.menuCoz(z.oku(g)); } catch (_) { xml = null; }
    if (!xml) continue;
    cozulenKokler.add(kok);
    const ana = (xml.match(/<main\b[^>]*>/) || [''])[0];
    menuler.push({ kok, setId: attr(ana, 'ID'), setAktivasyon: attr(ana, 'activation') === 'true' });
    let ilk = true;
    for (const c of ig.kapaklar(xml)) {
      const xs = attr(c.etiket, 'xmlSource');
      const id = c.ID == null ? '' : String(c.ID);
      const buIlk = ilk;
      ilk = false;
      if (!xs || !xs.endsWith(ICERIK_SONEKI)) continue;
      const icerikYolu = kok + xs.replace(/^\/+/, '');
      if (!var_(icerikYolu)) continue;
      if (!imparkKimligiMi(id)) { kimliksiz.push(icerikYolu); continue; }
      kapaklar.push({
        id, icerikYolu, imKeysYolu: icerikYolu.slice(0, -ICERIK_SONEKI.length) + DOSYA_ADI,
        kok, ilk: buIlk, kaynak: 'menu',
      });
    }
  }
  for (const ad of z.dizin.keys()) {
    const m = SAYISAL_ICERIK.exec(ad);
    if (!m || artikMi(ad) || cozulenKokler.has(m[1])) continue;
    kapaklar.push({
      id: m[2], icerikYolu: ad, imKeysYolu: ad.slice(0, -ICERIK_SONEKI.length) + DOSYA_ADI,
      kok: m[1], ilk: false, kaynak: 'dizin',
    });
  }
  return { kapaklar, menuler, kimliksiz };
}

/** Zip okuyucu (merkez dizin; Zip64; adm-zip yok). */
function zipOkuyucu(zipYolu) {
  return { dizin: M.zipDizini(zipYolu), oku: (g) => M.zipGirdiOku(zipYolu, g) };
}

/**
 * `HasZKitapKey` istemcisi — okuyucunun çevrimiçi sorusunun aynısı. Cevap JSON değilse (Cloudflare
 * challenge) ya da ağ düşerse GECİCİ hata (karar verilemedi → ertele; "anahtarsız" SAYILMAZ).
 */
function hasZKitapKeyIstemcisi({ sablon = HAS_KEY_VARSAYILAN, fetchFn = globalThis.fetch,
  zamanAsimiMs = 20000, deneme = 2, bekle = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const onbellek = new Map();
  return async function anahtarliMi(id) {
    if (!imparkKimligiMi(id)) throw new ImKeysHatasi(`HasZKitapKey: geçersiz kimlik ${id}`);
    if (onbellek.has(String(id))) return onbellek.get(String(id));
    let son = null;
    for (let i = 0; i < deneme; i++) {
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), zamanAsimiMs);
        let r;
        let metin;
        try {
          r = await fetchFn(sablon.replace('{kitapId}', String(id)), { signal: ctl.signal });
          metin = await r.text();
        } finally { clearTimeout(t); }
        let d;
        try { d = JSON.parse(metin); } catch (_) { throw new Error(`JSON değil (HTTP ${r.status})`); }
        if (!d || typeof d.Success !== 'boolean') throw new Error(`beklenmeyen cevap (HTTP ${r.status})`);
        onbellek.set(String(id), d.Success);
        return d.Success;
      } catch (e) {
        son = e;
        if (i + 1 < deneme) await bekle(1500);
      }
    }
    throw new ImKeysHatasi(`HasZKitapKey ${id} sorulamadı: ${String(son && son.message || son).slice(0, 160)}`, { gecici: true });
  };
}

function guvenliDeger(s, varsayilan) {
  const v = s == null || s === '' ? varsayilan : String(s);
  if (!/^[A-Za-z0-9_./@:-]+$/.test(v)) throw new ImKeysHatasi(`güvensiz yapılandırma değeri: ${v.slice(0, 40)}`);
  return v;
}

/** Komut çalıştırıcı (testte sahtesi verilir). @returns {Promise<{rc: number, stdout: string, stderr: string}>} */
function varsayilanCalistir(komut, argumanlar, { zamanAsimiMs = 90000, cwd } = {}) {
  return new Promise((resolve) => {
    execFile(komut, argumanlar, { cwd, timeout: zamanAsimiMs, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8' },
      (e, stdout, stderr) => resolve({
        rc: e ? (typeof e.code === 'number' ? e.code : 255) : 0, stdout: stdout || '', stderr: stderr || '',
      }));
  });
}

/** `<gövde>\n<http kodu>` cevabını ayrıştırır; gövde HİÇBİR hata metnine konmaz (kod içerebilir). */
function cevapAyristir(ham, paketId) {
  const s = String(ham || '');
  if (s.includes('IMKEYS_JETON_YOK')) throw new ImKeysHatasi('keypanel iç jetonu srv21\'de tanımsız (yetki)', { gecici: true });
  const i = s.lastIndexOf('\n');
  const kod = (i >= 0 ? s.slice(i + 1) : s).trim().slice(0, 3);
  const govde = i >= 0 ? s.slice(0, i) : '';
  if (kod === '404') throw new ImKeysHatasi(`paket ${paketId} keypanel'de tanımlı değil (404) — anahtar kaynağı yok`);
  if (kod !== '200') throw new ImKeysHatasi(`keypanel iç API HTTP ${/^\d{3}$/.test(kod) ? kod : '?'} (paket ${paketId})`, { gecici: true });
  let d;
  try { d = JSON.parse(govde); } catch (_) { throw new ImKeysHatasi(`keypanel cevabı ayrıştırılamadı (paket ${paketId})`, { gecici: true }); }
  if (!d || !Array.isArray(d.kodlar)) throw new ImKeysHatasi(`keypanel cevabında kod dizisi yok (paket ${paketId})`, { gecici: true });
  return d.kodlar.map((k) => (k && typeof k === 'object' ? k.kod : k));
}

/**
 * Paket kodlarını çeken fonksiyon. Varsayılan ssh (jeton srv21'de kalır); `EMPP_KEYPANEL_IC_URL`
 * + `EMPP_KEYPANEL_IC_JETON` verilirse doğrudan HTTP.
 * @returns {(paketId: string|number) => Promise<string[]>}
 */
function kodCekiciOlustur({ env = process.env, calistir = varsayilanCalistir, fetchFn = globalThis.fetch } = {}) {
  const url = env.EMPP_KEYPANEL_IC_URL;
  const jeton = env.EMPP_KEYPANEL_IC_JETON;
  return async function paketKodlari(paketId) {
    if (!imparkKimligiMi(paketId)) throw new ImKeysHatasi(`geçersiz paket kimliği: ${paketId}`);
    const yol = `/ic/paket/${paketId}/kodlar?sade=1&durum=gecerli`;
    if (url && jeton) {
      let r;
      let metin;
      try {
        r = await fetchFn(String(url).replace(/\/+$/, '') + yol, { headers: { 'x-jeton': jeton } });
        metin = await r.text();
      } catch (e) {
        throw new ImKeysHatasi(`keypanel iç API'ye ulaşılamadı: ${String(e && e.message || e).slice(0, 120)}`, { gecici: true });
      }
      return cevapAyristir(`${metin}\n${r.status}`, paketId);
    }
    const hedef = guvenliDeger(env.EMPP_KEYPANEL_SSH_HEDEF, SSH_HEDEF_VARSAYILAN);
    const port = guvenliDeger(env.EMPP_KEYPANEL_SSH_PORT, SSH_PORT_VARSAYILAN);
    const envDosyasi = guvenliDeger(env.EMPP_KEYPANEL_ENV, KEYPANEL_ENV_VARSAYILAN);
    // Uzak betik: jeton UZAKTA okunur, curl'e stdin'den başlık olarak verilir (süreç listesine düşmez).
    const uzak = `J=$(sed -n 's/^KEYPANEL_IC_JETON=//p' ${envDosyasi} 2>/dev/null); `
      + '[ -n "$J" ] || { echo IMKEYS_JETON_YOK; exit 0; }; '
      + `printf 'x-jeton: %s\\n' "$J" | curl -s -m 40 -H @- -w '\\n%{http_code}' '${KEYPANEL_YEREL}${yol}'`;
    const r = await calistir('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-p', port, hedef, uzak]);
    if (r.rc !== 0) throw new ImKeysHatasi(`srv21 ssh rc=${r.rc}: ${String(r.stderr || '').trim().slice(-160)}`, { gecici: true });
    return cevapAyristir(r.stdout, paketId);
  };
}

/** Az eşzamanlı eşleme (HasZKitapKey'i boğmamak için). */
async function sinirliEsle(liste, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, liste.length) }, async () => {
    while (i < liste.length) { const k = i++; await fn(liste[k]); }
  }));
}

/** Dosyaları zip'e göreli yollarıyla ekler/ezer (`zip -q -X`, Zip64; merdivenle aynı araç). */
async function zipeYaz(zipYolu, calisma, dosyalar, calistir = varsayilanCalistir) {
  const kok = await fsp.mkdtemp(path.join(calisma, 'imkeys-'));
  for (const d of dosyalar) {
    const hedef = path.join(kok, d.yol);
    if (!hedef.startsWith(kok + path.sep)) throw new ImKeysHatasi(`zip yolu kök dışına çıkıyor: ${d.yol}`);
    await fsp.mkdir(path.dirname(hedef), { recursive: true });
    await fsp.writeFile(hedef, d.veri, { mode: 0o600 });
  }
  const r = await calistir('zip', ['-q', '-X', path.resolve(zipYolu), ...dosyalar.map((d) => d.yol)],
    { cwd: kok, zamanAsimiMs: 30 * 60 * 1000 });
  if (r.rc !== 0) throw new Error(`${ISARET} zip rc=${r.rc}: ${String(r.stderr).trim().slice(-200)}`);
}

/**
 * Build'e imKeys.dll yazar (gerekiyorsa). Kapak kimliği → anahtarlı mı (HasZKitapKey); set
 * düzeyi aktivasyon (`main.activation="true"` + set anahtarlı) menünün İLK kapağını da kapsar —
 * okuyucu set diyaloğunda `module.covers[0]`'ın imKeys'ini okur.
 * @param {{zipYolu: string, paketId: string|number, mod?: 'yaz'|'eksikse', calisma: string,
 *   anahtarliMi: (id: string) => Promise<boolean>, kodCek: (paketId: string) => Promise<string[]>,
 *   log?: Function, yaz?: Function, okuyucu?: object}} o
 *   mod 'yaz' = taze kodlarla her zaman yaz (kurulan build); 'eksikse' = doluysa koru (r2-al).
 * @returns {Promise<object>} rapor (kod DEĞERİ içermez)
 */
async function imKeysHazirla({ zipYolu, paketId, mod = 'yaz', calisma, anahtarliMi, kodCek,
  log = () => {}, yaz = zipeYaz, okuyucu = null }) {
  const z = okuyucu || zipOkuyucu(zipYolu);
  const { kapaklar, menuler, kimliksiz } = kapaklariBul(z);
  const idler = [...new Set(kapaklar.map((k) => k.id).concat(
    menuler.filter((m) => m.setAktivasyon && imparkKimligiMi(m.setId)).map((m) => m.setId),
    imparkKimligiMi(paketId) ? [String(paketId)] : [],
  ))];
  const cevap = new Map();
  await sinirliEsle(idler, 4, async (id) => { cevap.set(id, await anahtarliMi(id)); });
  const setAktifKokler = new Set(menuler.filter((m) => m.setAktivasyon && cevap.get(m.setId)).map((m) => m.kok));
  const gerekli = kapaklar.filter((k) => cevap.get(k.id) || (k.ilk && setAktifKokler.has(k.kok)));
  const rapor = {
    paketId: String(paketId), kapakSayisi: kapaklar.length, kimliksiz,
    paketAnahtarli: Boolean(cevap.get(String(paketId))),
    anahtarli: gerekli.map((k) => ({ id: k.id, imKeysYolu: k.imKeysYolu })),
    anahtarsiz: kapaklar.filter((k) => !gerekli.includes(k)).map((k) => k.id),
    yazilan: [], korunan: [], kodSayisi: 0, atilanKod: 0,
  };
  if (!gerekli.length) {
    log(`${ISARET} ${paketId}: ${kapaklar.length} kapak, anahtarlı kapak yok — imKeys yazılmadı`
      + (rapor.paketAnahtarli ? ' (paket ANAHTARLI ama kapak çözülemedi → kapı RED)' : ''));
    return rapor;
  }
  let yazilacak = gerekli;
  if (mod === 'eksikse') {
    yazilacak = gerekli.filter((k) => {
      const g = z.dizin.get(k.imKeysYolu);
      let dolu = false;
      try { dolu = Boolean(g && !g.dizin && imKeysCoz(z.oku(g)).length > 0); } catch (_) { dolu = false; }
      if (dolu) rapor.korunan.push(k.imKeysYolu);
      return !dolu;
    });
  }
  if (yazilacak.length) {
    const ham = await kodCek(String(paketId));
    const { kodlar, atilan } = kodlariNormallestir(ham);
    rapor.kodSayisi = kodlar.length;
    rapor.atilanKod = atilan;
    if (!kodlar.length) {
      throw new ImKeysHatasi(`paket ${paketId} için keypanel'de geçerli kod yok (${atilan} geçersiz atıldı) — `
        + `${yazilacak.length} anahtarlı kapak çevrimdışında 123456 ile açılırdı`);
    }
    const veri = imKeysBicimle(kodlar);
    await yaz(zipYolu, calisma, yazilacak.map((k) => ({ yol: k.imKeysYolu, veri })));
    rapor.yazilan = yazilacak.map((k) => k.imKeysYolu);
  }
  log(`${ISARET} ${paketId}: ${kapaklar.length} kapak · ${gerekli.length} anahtarlı · `
    + `${rapor.yazilan.length} yazıldı · ${rapor.korunan.length} korundu · ${rapor.kodSayisi} kod`
    + (rapor.atilanKod ? ` (${rapor.atilanKod} geçersiz atıldı)` : '')
    + (kimliksiz.length ? ` · ${kimliksiz.length} kimliksiz kapak (Games/Videos) denetlenmedi` : ''));
  return rapor;
}

function redSonucu(mesaj) {
  return { gecti: false, nedenler: [`${NEDEN_KODU}: ${mesaj}`], nedenKodlari: [NEDEN_KODU] };
}

/**
 * YAYIN KAPISI (saf okuma): rapordaki her anahtarlı kapakta zip'te DOLU imKeys.dll var mı.
 * Paket anahtarlı ama hiç anahtarlı kapak çözülemediyse de RED (sessiz geçiş yok).
 * @returns {{gecti: boolean, nedenler: string[], nedenKodlari: string[]}}
 */
function imKeysKapisi({ zipYolu, rapor, okuyucu = null }) {
  if (!rapor) return redSonucu('imKeys raporu yok — anahtar denetimi yapılmadı');
  const nedenler = [];
  if (rapor.paketAnahtarli && !rapor.anahtarli.length) {
    nedenler.push(`paket ${rapor.paketId} anahtarlı ama build'de anahtarlı kapak çözülemedi`);
  }
  if (rapor.anahtarli.length) {
    const z = okuyucu || zipOkuyucu(zipYolu);
    for (const k of rapor.anahtarli) {
      const g = z.dizin.get(k.imKeysYolu);
      let n = 0;
      try { n = g && !g.dizin ? imKeysCoz(z.oku(g)).length : 0; } catch (_) { n = 0; }
      if (n < 1) nedenler.push(`${k.id}: ${k.imKeysYolu} ${g ? 'boş' : 'yok'}`);
    }
  }
  return nedenler.length
    ? { gecti: false, nedenler: nedenler.map((n) => `${NEDEN_KODU}: ${n}`), nedenKodlari: [NEDEN_KODU] }
    : { gecti: true, nedenler: [], nedenKodlari: [] };
}

/** Yazma kapısını imKeys kapısıyla birleştirir (r2-kur: RED → R2'ye yazılmaz, birak neden kodu). */
function kapiSar(yazmaKapisi, imk) {
  return (girdi) => {
    const k = yazmaKapisi(girdi);
    if (!imk || imk.gecti) return k;
    return {
      ...k,
      gecti: false,
      nedenler: [...(k.nedenler || []), ...imk.nedenler],
      nedenKodlari: [...new Set([...(k.nedenKodlari || []), ...imk.nedenKodlari])],
    };
  };
}

/**
 * Runner adımı: hazırla + kapı tek çağrıda. Geçici hata FIRLATIR (çağıran erteler); kalıcı hata
 * (paket tanımsız / kod yok) kapı RED sonucuna çevrilir.
 * @returns {Promise<{rapor: object|null, kapi: {gecti: boolean, nedenler: string[], nedenKodlari: string[]}}>}
 */
async function imKeysAdimi({ zipYolu, paketId, mod, calisma, log, bag = varsayilanBagimliliklar() }) {
  let rapor;
  try {
    rapor = await imKeysHazirla({ zipYolu, paketId, mod, calisma, log, ...bag });
  } catch (e) {
    if (e && e.gecici) throw e;
    if (e instanceof ImKeysHatasi) return { rapor: null, kapi: redSonucu(e.message) };
    throw e;
  }
  return { rapor, kapi: imKeysKapisi({ zipYolu, rapor }) };
}

/** Runner için varsayılan bağımlılıklar (env'den). */
function varsayilanBagimliliklar(env = process.env) {
  return {
    anahtarliMi: hasZKitapKeyIstemcisi({ sablon: env.EMPP_HASZKITAPKEY_URL || HAS_KEY_VARSAYILAN }),
    kodCek: kodCekiciOlustur({ env }),
  };
}

module.exports = {
  ISARET, NEDEN_KODU, DOSYA_ADI, HAS_KEY_VARSAYILAN, ImKeysHatasi,
  kodlariNormallestir, imKeysBicimle, imKeysCoz, cevrimdisiKarar, kapaklariBul, zipOkuyucu,
  hasZKitapKeyIstemcisi, kodCekiciOlustur, cevapAyristir, zipeYaz,
  imKeysHazirla, imKeysKapisi, redSonucu, kapiSar, imKeysAdimi, varsayilanBagimliliklar,
};

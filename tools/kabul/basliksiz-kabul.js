#!/usr/bin/env node
'use strict';
/**
 * BAŞSIZ KABUL KAPISI — üretilen paket (DMG · APK · NSIS · .impark) R2'ye gitmeden önce
 * BU Mac'te, ODAK ÇALMADAN açılıp ölçülür (Nadir 2026-09-26: "bu bilgisayarda odak
 * çalmadan bir kabul kapısı üretebilir misin?").
 *
 * Doğuş: 26.09'da SET kökü ezilmiş Super Monsters 3 (73768) mac DMG'si ve Android APK'sı
 * kabulsüz R2'ye gitti — kök index.html okuyucu olmuştu, paket sonsuz "yükleniyor"da
 * kaldı. Yalnız Pardus'un ProBook kapısı yakaladı.
 *
 * Katmanlar:
 *   cikarma  paket türüne göre görünmez açma (DMG -nobrowse, 7z, unzip)
 *   okuyucu  (06.10, A1 olayı) paketteki okuyucu kabuğu sürümü kanonikle EŞİT mi — ölçülen sürüm,
 *            damga değil (`okuyucu-surumu-kapisi.js`; A1'de kapak/index.html, bookN'de her kitap).
 *            Fail-closed: ölçülemezse RED; `KABUL_OKUYUCU_SURUM=uyar` yalnız uyarı. Kanonik:
 *            `--okuyucu-kanonik X.Y.Z` ya da ~/.empp-agent/kabuk/kanonik.json (EMPP_KABUK_KANONIK).
 *   menuIcerik (06.10, 45479 kitap 14835) menüdeki her kitap kartının içerik dosyası (xmlSource) pakette mı;
 *     kip KABUL_MENU_ICERIK=uyar|reddet|kapali (varsayılan uyar)
 *   menuKapak (06.10, 59835) set menüsündeki her kartın kapak dosyası pakette ve > 1 KB mı
 *            (`menu-kapak.js`, kabuğun kendi yedek kuralıyla). Kapaksız kart → RED. Set değil → yok.
 *   imza     (mac) codesign + stapler + spctl — noter/zımba yoksa RED
 *   icerik   Electron görünmez koşum: kök sayfa → DOM + piksel (ProBook eşikleri) →
 *            ilk kitap kartına tıkla → okuyucu sayfa çizdi mi
 *   cihaz    (android) pencerisiz emülatörde kur/aç/ekran/ui dökümü/kaldır
 *   odak     `lsappinfo front` önce = sonra; kapının süreci hiç öne geçmedi
 *   k4       (KABUL_K4=1 / --k4, varsayılan KAPALI) güncellik: ayrı boş profil + CDP ile ilk
 *            kitaba girilir, motorun GetKitapGuncellemeBilgi sorusu ve cevabı yakalanır
 *            (ProBook E6/E7/E8'in eşi — k4-guncellik.js). Android'de ek olarak cihaz WebView'ı.
 *            + KABUL_SET_TUM=1 / --set-tum (K4 açıkken, varsayılan KAPALI): SET'in HER alt kitabının
 *            menü sürümü İmpark'a doğrudan sorulur (motor yalnız açılan kitabı sorar — set-guncellik.js).
 *
 * Kullanım:
 *   node tools/kabul/basliksiz-kabul.js <paket> [--platform mac|android|windows|pardus|dizin|zip]
 *        [--kitap-sayisi N] [--kitap-id ID] [--kanit <dizin>] [--calisma <dizin>] [--tut]
 *        [--ag] [--aktivasyon] [--cihaz-yok] [--avd <ad>] [--menu-bekle sn] [--kitap-bekle sn] [--k4]
 *        [--set-tum] [--okuyucu-kanonik X.Y.Z]
 * Çıkış: 0 GEÇTİ · 1 RED · 3 ÖLÇÜLEMEDİ · 2 kullanım hatası.
 *   K4 AÇIKKEN sözlük ProBook kapısıyla (kabul-karar.sh) aynı: 0 GEÇTİ · 1 RED · 3 GÜNCEL-DEĞİL
 *   (stdout "GUNCEL-DEGIL: …" + "yeniden kuyruk onerisi: …") · 4 ÖLÇÜLEMEDİ.
 * Kanıt: ~/.empp-agent/kabul-kanit/<bookId>-<platform>-<tarih>/ (EMPP_KABUL_KANIT_KOK ile değişir).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const O = require('./olcutler');
const { platformTahmin, platformNormalize, paketiAc, kokEnvanteri } = require('./paket-cikar');
const { calismaZamaniHazirla, odakCaldiIsaretle } = require('./calisma-zamani');
const { onUygulama, uygulamaTuru, odakIzleyici } = require('./odak');
const { macImzaDenetle, imzaKarari } = require('./imza-denetimi');
const { motorKopyasiMi } = require('../../src/packaging/set-menu');
const K4 = require('./k4-guncellik');
const ST = require('./set-guncellik');
const { anaSurecDenetle } = require('./ana-surec-denetimi');
const OSK = require('./okuyucu-surumu-kapisi');
const MK = require('./menu-kapak');
const MI = require('./menu-icerik');

const DURUM_TR = { GECTI: 'GEÇTİ', RED: 'RED', OLCULEMEDI: 'ÖLÇÜLEMEDİ', GUNCEL_DEGIL: 'GÜNCEL-DEĞİL' };

/**
 * Aktivasyon kodlu seride motor açılışta kodu SUNUCUYA sorar (HasZKitapKey, kitap başına bir
 * istek). Ağ kapalı koşumda "Network is offline" ile yükleniyor ekranında kalır — paket kusuru
 * değil, ölçülemez ortam (27.09 45469/45472: ağ açık K4 koşumunda aynı paket diyaloğu 30 sn'de
 * gösterdi). Bu durumda içerik koşumu ağ AÇIK ama zip indirmesi kesik YENİDEN koşar (K4 ile aynı);
 * ağ kapalıyken içerik açılan aktivasyon serisi (45477: raf + okuyucu) ilk koşumla karar alır.
 * Cihazda diyalog 32 alt kitapta ~93 sn'de geldi (45469; 22'de ~35 sn) → cihaz menü beklemesi.
 */
const AKTIVASYON_CIHAZ_MENU_SN = 150;
function kosumAgi(s, { aktivasyonTuru = false } = {}) {
  if (s.ag) return { agKapali: false, indirmeKes: false };
  if (aktivasyonTuru) return { agKapali: false, indirmeKes: true };
  return { agKapali: true, indirmeKes: false };
}

/**
 * Aktivasyon kodlu seride ağ kapalı içerik koşumu RED ve motor "Network is offline" dediyse
 * ağ açık ikinci koşum gerekir (paket kusuru değil, ölçülemez ortam). Saf.
 */
function agAcikYenidenKosulmali({ aktivasyon, ag, karar, kosum }) {
  if (!aktivasyon || ag || !karar || karar.durum !== O.DURUM.RED) return false;
  return konsolSatirlari(kosum).some((l) => /Network is offline/i.test(String((l && l.mesaj) || '')));
}

function argumanCoz(argv) {
  const s = {
    paket: null, platform: null, kitapSayisi: null, kitapId: null, kanit: null, calisma: null,
    tut: false, ag: false, aktivasyon: false, cihaz: true, avd: null, menuBekle: 45, kitapBekle: 60,
    k4: false, setTum: false, okuyucuKanonik: null, yardim: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const sonraki = () => argv[++i];
    if (a === '--platform') s.platform = sonraki();
    else if (a === '--kitap-sayisi') s.kitapSayisi = Number.parseInt(sonraki(), 10);
    else if (a === '--kitap-id') s.kitapId = sonraki();
    else if (a === '--kanit') s.kanit = sonraki();
    else if (a === '--calisma') s.calisma = sonraki();
    else if (a === '--tut') s.tut = true;
    else if (a === '--ag') s.ag = true;
    else if (a === '--aktivasyon') s.aktivasyon = true;
    else if (a === '--k4') s.k4 = true;
    else if (a === '--set-tum') s.setTum = true;
    else if (a === '--okuyucu-kanonik') s.okuyucuKanonik = sonraki();
    else if (a === '--cihaz-yok') s.cihaz = false;
    else if (a === '--cihaz') s.cihaz = true;
    else if (a === '--avd') s.avd = sonraki();
    else if (a === '--menu-bekle') s.menuBekle = Number(sonraki()) || s.menuBekle;
    else if (a === '--kitap-bekle') s.kitapBekle = Number(sonraki()) || s.kitapBekle;
    else if (a === '-h' || a === '--help' || a === '--yardim') s.yardim = true;
    else if (!a.startsWith('-') && !s.paket) s.paket = a;
  }
  if (!Number.isInteger(s.kitapSayisi) || s.kitapSayisi < 0) s.kitapSayisi = null;
  return s;
}

/** Yoldan kitap kimliği: `softwares/<id>/`, `-<id>` dizini ya da 5+ haneli sayı. Saf. */
function kitapIdTuret(paketYolu) {
  const y = String(paketYolu || '');
  const m1 = /softwares[\\/](\d{3,})[\\/]/.exec(y);
  if (m1) return m1[1];
  const parcalar = y.split(/[\\/]/).reverse();
  for (const p of parcalar) {
    const m = /(?:^|[^\d])(\d{5,6})(?:[^\d]|$)/.exec(p);
    if (m) return m[1];
  }
  const ad = path.basename(y).replace(/\.[^.]+$/, '');
  return ad.normalize('NFKD').replace(/[^\w-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'bilinmiyor';
}

/** Kanıt dizini adı: <bookId>-<platform>-<YYYYMMDD-HHMMSS>. Saf. */
function kanitAdi(kitapId, platform, tarih = new Date()) {
  const iki = (n) => String(n).padStart(2, '0');
  const t = `${tarih.getFullYear()}${iki(tarih.getMonth() + 1)}${iki(tarih.getDate())}`
    + `-${iki(tarih.getHours())}${iki(tarih.getMinutes())}${iki(tarih.getSeconds())}`;
  return `${kitapId}-${platform}-${t}`;
}

function kanitKoku() {
  return process.env.EMPP_KABUL_KANIT_KOK || path.join(os.homedir(), '.empp-agent', 'kabul-kanit');
}

/** Electron koşumunu başlatır, bitmesini ya da süre dolmasını bekler. */
function kosumCalistir({ ikili, girdiYolu, calisma, kanit, agKapali, toplamSn, log }) {
  return new Promise((coz) => {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE; // Claude Code / VS Code ortamı bunu 1 yapıyor → Electron Node gibi koşar
    delete env.ELECTRON_NO_ATTACH_CONSOLE;
    // runner ortamı (run-agent.sh) NODE_OPTIONS'a Electron'un REDDETTİĞİ bayraklar koyuyor
    // (--no-network-family-autoselection → "is not allowed in NODE_OPTIONS", Electron açılmadan çıkar;
    // 26.09 73768 mac: "koşum ölçüm üretmedi"). Koşumun Node bayrağına ihtiyacı yok.
    delete env.NODE_OPTIONS;
    const ev = path.join(calisma, 'profil', 'ev');
    fs.mkdirSync(ev, { recursive: true });
    env.HOME = ev; // paket Node ile ev dizinine yazarsa (work/, .empp-work) gerçek ev kirlenmez
    env.EMPP_KOSUM_GIRDI = girdiYolu;
    env.EMPP_KABUL_AG_KAPALI = agKapali ? '1' : '0';
    const cikti = fs.openSync(path.join(kanit, 'electron-stdout.log'), 'w');
    const bas = Date.now();
    const cocuk = spawn(ikili, [path.join(__dirname, 'kosum', 'main.js')], {
      env, detached: true, stdio: ['ignore', cikti, cikti],
    });
    // LaunchServices kaydı ilk açılışta (yeni imzalanmış kopya) birkaç saniye gecikebilir:
    // tür bulunana dek 2 sn'de bir, en çok 8 kez sorulur. Beklenen: "UIElement" (Dock'ta yok).
    let tur = '';
    let turDeneme = 0;
    const turZamanlayici = setInterval(() => {
      turDeneme += 1;
      if (!tur) tur = uygulamaTuru(cocuk.pid);
      if (tur || turDeneme >= 8) clearInterval(turZamanlayici);
    }, 2000);
    let zamanAsimi = false;
    const oldur = setTimeout(() => {
      zamanAsimi = true;
      log(`koşum ${toplamSn + 15} sn içinde bitmedi — süreç grubu öldürülüyor`);
      try { process.kill(-cocuk.pid, 'SIGKILL'); } catch (_) { /* zaten ölü */ }
    }, (toplamSn + 15) * 1000);
    cocuk.on('exit', (kod, sinyal) => {
      clearTimeout(oldur);
      clearInterval(turZamanlayici);
      fs.closeSync(cikti);
      coz({ kod, sinyal, zamanAsimi, pid: cocuk.pid, sureMs: Date.now() - bas, uygulamaTuru: tur });
    });
    cocuk.on('error', (e) => {
      clearTimeout(oldur);
      clearInterval(turZamanlayici);
      coz({ kod: -1, hata: e.message, pid: cocuk.pid, sureMs: Date.now() - bas, uygulamaTuru: tur });
    });
  });
}

/**
 * İçerik katmanı kararı (saf): statik kök denetimi + menü + ileri adım + okuyucu.
 * @returns {{durum:string, sebepler:string[], notlar:string[]}}
 */
function icerikKarari({ envanter, kosum, beklenenKart, aktivasyon, ileriAdimGerekli = true }) {
  const sebepler = [];
  const notlar = [];
  if (!kosum || !kosum.asamalar || !kosum.asamalar.menu) {
    return { durum: O.DURUM.OLCULEMEDI, sebepler: [`koşum ölçüm üretmedi${kosum && kosum.hata ? `: ${kosum.hata}` : ''}`], notlar };
  }
  const setMi = envanter.setMi;
  if (setMi && motorKopyasiMi(envanter.indexHtml)) {
    sebepler.push('SET kökündeki index.html motorun tek-kitap sayfası (hash\'li *.main.js çağırıyor) — menü ezilmiş');
  }
  if (setMi && envanter.kokAppConfig === false && /src="app\.config\.js"/.test(envanter.indexHtml)) {
    notlar.push('kök sayfa app.config.js istiyor ama kökte app.config.js yok (SET\'te beklenen)');
  }
  // Tek kitap paketinde kök ya doğrudan okuyucudur (sayfa izi var) ya da motorun kitap
  // rafıdır (MEÇ 73714): rafta ilk kapağa tıklanır ve belirleyici ölçüm okuyucuda yapılır.
  const kitaplik = !setMi && !O.sayfaIzi(kosum.asamalar.menu)
    && kosum.ileriAdim && kosum.ileriAdim.tur === 'kitaplik' && Boolean(kosum.ileriAdim.kart);
  let ilkAsama = 'menu';
  if (!setMi) ilkAsama = kitaplik ? 'kitaplik' : 'kitap';
  const menuK = O.asamaKarari(kosum.asamalar.menu, { asama: ilkAsama, setMi, beklenenKart, aktivasyon });
  const ilkAd = { menu: 'menü', kitaplik: 'kitap rafı', kitap: 'okuyucu' }[ilkAsama];
  sebepler.push(...menuK.sebepler.map((s) => `${ilkAd}: ${s}`));
  notlar.push(...menuK.notlar);
  if (kitaplik) {
    const kitapK = O.asamaKarari(kosum.asamalar.kitap, { asama: 'kitap', setMi, beklenenKart, aktivasyon });
    if (kitapK.durum === O.DURUM.OLCULEMEDI) sebepler.push(`okuyucu ölçülemedi: ${kitapK.sebepler.join('; ')}`);
    else sebepler.push(...kitapK.sebepler.map((s) => `rafta kapağa tıklandı (${kosum.ileriAdim.yontem}) → okuyucu: ${s}`));
    notlar.push(...kitapK.notlar);
  }
  const konsol = O.konsolSiniflandir(konsolSatirlari(kosum));
  for (const r of konsol.redImzalari) sebepler.push(`konsol: ${r}`);

  if (setMi && ileriAdimGerekli && (kosum.asamalar.menu.kartlar || []).length) {
    const adim = kosum.ileriAdim;
    if (!adim || !adim.gezinilen || !/\/book\d+\//i.test(adim.gezinilen)) {
      sebepler.push(`ileri adım: ilk kitap kartına tıklandı (${adim ? adim.yontem : 'denenmedi'}), kitap AÇILMADI`);
    } else {
      const kitapK = O.asamaKarari(kosum.asamalar.kitap, { asama: 'kitap', setMi, beklenenKart, aktivasyon });
      if (kitapK.durum === O.DURUM.OLCULEMEDI) sebepler.push(`okuyucu ölçülemedi: ${kitapK.sebepler.join('; ')}`);
      sebepler.push(...kitapK.sebepler.map((s) => `okuyucu: ${s}`));
      notlar.push(...kitapK.notlar);
    }
  }
  if (menuK.durum === O.DURUM.OLCULEMEDI && !sebepler.length) {
    return { durum: O.DURUM.OLCULEMEDI, sebepler: menuK.sebepler, notlar };
  }
  return { durum: sebepler.length ? O.DURUM.RED : O.DURUM.GECTI, sebepler, notlar };
}

/** Konsol + alt kaynak hataları tek listede (sınıflandırma ikisini birlikte görür). */
function konsolSatirlari(kosum) {
  const l = [...((kosum && kosum.konsol) || [])];
  for (const h of (kosum && kosum.altKaynakHatalari) || []) {
    if (h.hata === 'net::ERR_ABORTED' || h.hata === 'net::ERR_BLOCKED_BY_CLIENT') continue;
    l.push({ seviye: 'error', mesaj: `${h.hata} ${h.url}`, kaynak: `webRequest:${h.tur || '?'}` });
  }
  return l;
}

function konsolGunlugu(kosum) {
  const satirlar = [];
  for (const k of (kosum && kosum.konsol) || []) {
    satirlar.push(`${new Date(k.zamanMs).toISOString()} [${k.seviye}] ${k.mesaj.replace(/\n/g, ' ⏎ ')}  (${k.kaynak})`);
  }
  for (const h of (kosum && kosum.altKaynakHatalari) || []) satirlar.push(`[alt kaynak] ${h.hata} ${h.tur || ''} ${h.url}`);
  for (const y of (kosum && kosum.yuklemeHatalari) || []) {
    satirlar.push(`[did-fail-load] ${y.kod} ${y.aciklama} ${y.url}${y.anaCerceve ? ' (ANA ÇERÇEVE)' : ''}`);
  }
  for (const a of (kosum && kosum.agEngellenen) || []) satirlar.push(`[ağ engellendi] ${a}`);
  for (const p of (kosum && kosum.engellenenPencere) || []) satirlar.push(`[window.open engellendi] ${p}`);
  return `${satirlar.join('\n')}\n`;
}

async function calis(argv, yazici) {
  const yaz = yazici || ((s) => process.stdout.write(`${s}\n`));
  const say = (s) => yaz(`[kabul] ${s}`);
  const s = argumanCoz(argv);
  if (s.yardim || !s.paket) {
    yaz('Kullanım: node tools/kabul/basliksiz-kabul.js <paket> [--platform mac|android|windows|pardus|dizin|zip] '
      + '[--kitap-sayisi N] [--kitap-id ID] [--kanit <dizin>] [--calisma <dizin>] [--tut] [--ag] '
      + '[--aktivasyon] [--cihaz-yok] [--avd <ad>] [--menu-bekle sn] [--kitap-bekle sn] [--k4] [--set-tum] '
      + '[--okuyucu-kanonik X.Y.Z]');
    return { kod: 2 };
  }
  const paket = path.resolve(s.paket);
  if (!fs.existsSync(paket)) { yaz(`HATA: paket yok — ${paket}`); return { kod: 2 }; }
  const dizinMi = fs.statSync(paket).isDirectory();
  const platform = platformNormalize(s.platform) || platformTahmin(paket, dizinMi);
  if (!platform) { yaz(`HATA: platform belirlenemedi (--platform ver): ${paket}`); return { kod: 2 }; }

  const baslangic = Date.now();
  const kitapId = s.kitapId || kitapIdTuret(paket);
  const kanit = s.kanit || path.join(kanitKoku(), kanitAdi(kitapId, platform));
  fs.mkdirSync(kanit, { recursive: true });
  const kendiCalismaDizini = !s.calisma;
  const calisma = s.calisma || fs.mkdtempSync(path.join(os.tmpdir(), 'basliksiz-kabul-'));
  fs.mkdirSync(calisma, { recursive: true });

  const odakOnce = onUygulama();
  const izleyici = odakIzleyici(300, path.join(kanit, 'odak-ornekleri.jsonl'));
  say(`paket: ${paket} (${platform}) · kitap ${kitapId}`);
  say(`kanıt: ${kanit}`);
  say(`odak önce: ${odakOnce.asn} ${odakOnce.ad} (pid ${odakOnce.pid})`);

  const rapor = {
    paket, platform, kitapId, kanit, calisma, baslangic: new Date(baslangic).toISOString(),
    katmanlar: {}, uyarilar: [], odak: null,
  };
  let acilis = null;
  let kosumSureci = null;
  const ekKosumPidleri = [];
  let kosumSonucu = null;
  let calismaZamani = null;
  const k4Acik = K4.k4Etkin({ bayrak: s.k4 });
  const setTumAcik = k4Acik && ST.setTumEtkin({ bayrak: s.setTum });
  let setTumKarar = null;
  const k4Kararlar = [];
  const k4Olcumleri = [];
  let k4Olcum = null;
  let paketSurum = null;
  const aktOlc = process.env.KABUL_AKTIVASYON_OLCULEMEDI === '1';
  try {
    // 1. Çıkarma
    try {
      acilis = paketiAc({ paket, platform, calisma, log: say });
      rapor.katmanlar.cikarma = { durum: O.DURUM.GECTI, kok: acilis.kok, asar: acilis.asar };
      say(`uygulama kökü: ${acilis.kok}${acilis.asar ? ' (asar)' : ''}`);
    } catch (e) {
      rapor.katmanlar.cikarma = { durum: O.DURUM.OLCULEMEDI, sebepler: [`paket açılamadı: ${e.message}`] };
      say(`ÖLÇÜLEMEDİ: paket açılamadı — ${e.message}`);
    }

    // 1a. Okuyucu sürümü (06.10, A1 olayı): paketteki okuyucu kabuğu kanonikle EŞİT mi? Damga değil
    // ÖLÇÜM — 45496/45485 A1 setleri paketleyicinin 'karisik' damgasıyla ESKİ okuyucuyla yayınlandı.
    // asar (mac/pardus/windows) DMG ayrılmadan, ölçüm dosyaları çalışma dizinine çıkarılarak okunur.
    if (acilis) {
      let ok;
      try {
        ok = await OSK.okuyucuSurumuOlc(acilis.kok, {
          asar: acilis.asar, kanonik: s.okuyucuKanonik, calisma, env: process.env,
        });
      } catch (e) {
        ok = {
          karar: O.DURUM.OLCULEMEDI, hamKarar: O.DURUM.OLCULEMEDI, olculen: null, kanonik: s.okuyucuKanonik,
          birimler: [], sebepler: [`ölçüm hatası: ${e.message}`],
        };
      }
      rapor.okuyucuSurumu = ok;
      rapor.katmanlar.okuyucu = O.okuyucuSurumKatmani(ok);
      if (ok.uyari) rapor.uyarilar.push(ok.uyari);
      say(OSK.ozetSatiri(ok));
    }

    // 1a'. Menü kapak (06.10, 59835 Teacher's Pack/Worksheets): set menüsündeki her kartın kabuğun
    // YÜKLEYECEĞİ kapak dosyası pakette ve > 1 KB mı (menu-kapak.js). Set değilse ATLANDI (katman
    // eklenmez). Statik ölçüm: asar/dizin, dört platform aynı. Ölçülemezse ÖLÇÜLEMEDİ (GEÇTİ değil).
    if (acilis) {
      let mk;
      try {
        mk = MK.menuKapakOlcKok(acilis.kok, { asar: acilis.asar });
      } catch (e) {
        mk = { durum: MK.DURUM.OLCULEMEDI, kartlar: [], sebepler: [`ölçüm hatası: ${e.message}`], uyarilar: [] };
      }
      rapor.menuKapak = mk;
      if (mk.durum !== MK.DURUM.ATLANDI) rapor.katmanlar.menuKapak = { durum: mk.durum, sebepler: mk.sebepler };
      for (const u of mk.uyarilar) rapor.uyarilar.push(u);
      say(MK.ozetSatiri(mk));
    }

    // 1a''. Menü içerik (06.10, 45479 kitap 14835): menüdeki her kitap kartının xmlSource dosyası
    // pakette var mı (menu-icerik.js). Kip KABUL_MENU_ICERIK = uyar (varsayılan: yalnız uyarı) |
    // reddet (katman: RED/ÖLÇÜLEMEDİ kapıyı kapatır) | kapali.
    if (acilis && MI.kip() !== 'kapali') {
      let mi;
      try {
        mi = MI.menuIcerikOlcKok(acilis.kok, { asar: acilis.asar });
      } catch (e) {
        mi = { durum: MI.DURUM.OLCULEMEDI, kartlar: [], sebepler: [`ölçüm hatası: ${e.message}`], uyarilar: [] };
      }
      rapor.menuIcerik = mi;
      const mk2 = MI.kipliKarar(mi, MI.kip());
      if (mk2.katman) rapor.katmanlar.menuIcerik = mk2.katman;
      if (mk2.uyari) rapor.uyarilar.push(mk2.uyari);
      say(MI.ozetSatiri(mi));
    }

    // 1b. Paketin KENDİ ana süreci (main.js): koşum kosum/main.js ile açıldığı için yürütülmez;
    // en azından derlenmeli (aksi halde gerçek açılışta Electron hata kutusunda kalır).
    // ATLANDI (package.json yok / android) katman eklemez — genel kararı ÖLÇÜLEMEDİ'ye çekmesin.
    if (acilis) {
      const as = anaSurecDenetle(acilis.kok, acilis.asar, { platform });
      if (as.durum === 'ATLANDI') say(`ana süreç denetimi atlandı: ${as.sebepler.join(' | ')}`);
      else {
        rapor.katmanlar.anaSurec = { durum: as.durum === 'GECTI' ? O.DURUM.GECTI : O.DURUM.RED, sebepler: as.sebepler, giris: as.giris };
        say(`ana süreç (${as.giris}): ${as.durum === 'GECTI' ? 'derlendi' : `RED — ${as.sebepler.join(' | ')}`}`);
      }
    }

    // 2. İmza (mac)
    if (acilis && platform === 'mac') {
      const ham = macImzaDenetle({ dmg: paket, appYolu: acilis.ek.appYolu });
      const k = imzaKarari(ham);
      rapor.katmanlar.imza = { ...k, ham };
      for (const [ad, r] of Object.entries(ham)) say(`imza ${ad}: rc=${r.rc} ${r.cikti.split('\n').slice(-1)[0].slice(0, 140)}`);
      say(`imza katmanı: ${DURUM_TR[k.durum]}${k.sebepler.length ? ` — ${k.sebepler.join(' | ')}` : ''}`);
    }

    // 3. İçerik (Electron görünmez koşum)
    if (acilis) {
      const envanter = kokEnvanteri(acilis.kok, acilis.asar);
      const beklenenKart = O.beklenenKartSayisi({
        kitapDizinleri: envanter.kitapDizinleri, setMenu: envanter.setMenu, elle: s.kitapSayisi,
        linkKart: envanter.linkKartSayisi, linkKartlari: envanter.linkKartlari,
      });
      const menuDisi = O.menudeOlmayanKitapDizinleri({
        kitapDizinleri: envanter.kitapDizinleri, setMenu: envanter.setMenu,
      });
      rapor.envanter = {
        setMi: envanter.setMi, kitapDizinleri: envanter.kitapDizinleri, beklenenKart, menuDisi,
        kokAppConfig: envanter.kokAppConfig, kokMotorKopyasi: motorKopyasiMi(envanter.indexHtml),
        kitapAdlari: ((envanter.setMenu && envanter.setMenu.kitaplar) || []).map((k) => k && k.ad).filter(Boolean),
        linkKartlari: envanter.linkKartlari || [],
        kokBaslik: (/<title>([^<]*)<\/title>/i.exec(envanter.indexHtml) || [])[1] || null,
      };
      say(`envanter: ${envanter.setMi ? `SET, app.config.js taşıyan ${envanter.kitapDizinleri.join(',')}` : 'tek kitap'}`
        + ` · beklenen kart ${beklenenKart} · kök <title> "${rapor.envanter.kokBaslik}"`);
      if (menuDisi.length) {
        say(`envanter notu: menü tanımında olmayan motor dizini ${menuDisi.join(',')}`
          + ' — set-menu.json listelemiyor, kart beklenmez (kaynak kararı; RED değil)');
      }

      let zaman = null;
      try {
        zaman = calismaZamaniHazirla({ surum: acilis.electronSurumu, log: say });
      } catch (e) {
        rapor.katmanlar.icerik = { durum: O.DURUM.OLCULEMEDI, sebepler: [`Electron çalışma zamanı hazırlanamadı: ${e.message}`] };
        say(`ÖLÇÜLEMEDİ: Electron çalışma zamanı hazırlanamadı — ${e.message}`);
      }
      calismaZamani = zaman;
      if (zaman) {
        rapor.electron = {
          paket: acilis.electronSurumu, paketKaynagi: acilis.surumKaynagi,
          kosulan: zaman.surum, eslesti: zaman.eslesti, calismaZamani: zaman.kaynak,
          atlananlar: zaman.atlananlar,
        };
        if (zaman.uyari) { rapor.uyarilar.push(zaman.uyari); say(zaman.uyari); }
        say(`Electron: paket ${acilis.electronSurumu || '—'} · koşulan ${zaman.surum}${zaman.eslesti ? ' (eşleşti)' : ''}`);
        const toplamSn = s.menuBekle + s.kitapBekle + 60;
        // Tek koşum: girdi yaz → Electron → kosum.json → içerik kararı. Aktivasyon kodlu seride
        // ağ kapalı koşum "Network is offline" ile yükleniyor ekranında kalırsa İKİNCİ koşum ağ
        // açık (zip kesik) yapılır; ağ kapalıyken içerik doğrulanabilen seri (45477) etkilenmez.
        const icerikKos = async (ag, kanitDizini, ek) => {
          fs.mkdirSync(kanitDizini, { recursive: true });
          const girdi = {
            giris: path.join(acilis.kok, 'index.html'),
            kanitDizin: kanitDizini,
            profilDizin: path.join(calisma, `profil${ek}`),
            sonucYolu: path.join(kanitDizini, 'kosum.json'),
            setMi: envanter.setMi,
            beklenenKart,
            ileriAdim: true,
            ...ag,
            menuBekleSn: s.menuBekle,
            kitapBekleSn: s.kitapBekle,
            toplamSn,
          };
          const girdiYolu = path.join(calisma, `kosum-girdi${ek}.json`);
          fs.mkdirSync(girdi.profilDizin, { recursive: true });
          fs.writeFileSync(girdiYolu, JSON.stringify(girdi, null, 2));
          say(`görünmez koşum başlıyor (offscreen, Dock'suz, ağ ${ag.agKapali ? 'kapalı'
            : `AÇIK${ag.indirmeKes ? ' — aktivasyon kodlu seri, zip indirmesi kesik' : ''}`})`);
          const surec = await kosumCalistir({
            ikili: zaman.ikili, girdiYolu, calisma, kanit: kanitDizini, agKapali: ag.agKapali, toplamSn, log: say,
          });
          say(`koşum bitti: ${Math.round(surec.sureMs / 1000)} sn, çıkış ${surec.kod}`
            + `${surec.zamanAsimi ? ' (ZAMAN AŞIMI)' : ''} · süreç türü ${surec.uygulamaTuru || '—'}`);
          let kosum = null;
          try { kosum = JSON.parse(fs.readFileSync(girdi.sonucYolu, 'utf8')); } catch (_) { kosum = null; }
          fs.writeFileSync(path.join(kanitDizini, 'konsol.log'), konsolGunlugu(kosum));
          return { surec, kosum, k: icerikKarari({ envanter, kosum, beklenenKart, aktivasyon: s.aktivasyon }) };
        };
        let tur = await icerikKos(kosumAgi(s), kanit, '');
        kosumSureci = tur.surec;
        if (agAcikYenidenKosulmali({ aktivasyon: s.aktivasyon, ag: s.ag, karar: tur.k, kosum: tur.kosum })) {
          say('aktivasyon kodlu seri: ağ kapalı koşum "Network is offline" ile yükleniyor ekranında kaldı'
            + ' — ağ AÇIK (zip kesik) yeniden koşuluyor; ağ kapalı kanıt korunur');
          const ilk = tur;
          tur = await icerikKos(kosumAgi(s, { aktivasyonTuru: true }), path.join(kanit, 'ag-acik'), '-ag');
          ekKosumPidleri.push(tur.surec && tur.surec.pid);
          tur.k.notlar.unshift(`ağ kapalı koşum RED'di (${ilk.k.sebepler.slice(0, 2).join(' | ')}) — `
            + 'aktivasyon kodlu seri ağ açık koşumla karara bağlandı (kanıt: ag-acik/)');
        }
        const kosum = tur.kosum;
        kosumSonucu = kosum;
        const { k } = tur;
        const konsol = O.konsolSiniflandir(konsolSatirlari(kosum));
        rapor.katmanlar.icerik = {
          ...k,
          menu: kosum && kosum.asamalar && ozetle(kosum.asamalar.menu),
          ileriAdim: kosum && kosum.ileriAdim,
          kitap: kosum && kosum.asamalar && ozetle(kosum.asamalar.kitap),
          konsol: {
            dosyaBulunamadi: konsol.dosyaBulunamadi.length,
            jsHatalari: konsol.jsHatalari.length,
            ornekDosya: konsol.dosyaBulunamadi.slice(0, 5),
            ornekJs: konsol.jsHatalari.slice(0, 5),
          },
          agEngellenen: ((kosum && kosum.agEngellenen) || []).length,
        };
        if (kosum && kosum.asamalar) {
          const m = kosum.asamalar.menu || {};
          say(`menü: başlık "${m.baslik}" · kart ${m.kartSayisi}/${beklenenKart} · yükleniyor ${JSON.stringify(m.yukleniyor || [])}`
            + ` · sapma=${m.piksel && m.piksel.sapma} koyu=${m.piksel && m.piksel.koyu} renk=${m.piksel && m.piksel.renk} (${m.beklenenSn} sn)`);
          const kt = kosum.asamalar.kitap;
          if (kosum.ileriAdim) {
            say(`ileri adım${kosum.ileriAdim.tur === 'kitaplik' ? ' (kitap rafı → ilk kapak)' : ''}: `
              + `${kosum.ileriAdim.yontem || 'kapak yok'} → ${kosum.ileriAdim.gezinilen || 'gezinme YOK'}`);
          }
          if (kt) {
            say(`okuyucu: başlık "${kt.baslik}" · sayfa izi ${O.sayfaIzi(kt)} · yükleniyor ${JSON.stringify(kt.yukleniyor || [])}`
              + ` · sapma=${kt.piksel && kt.piksel.sapma} koyu=${kt.piksel && kt.piksel.koyu} renk=${kt.piksel && kt.piksel.renk} (${kt.beklenenSn} sn)`);
          }
        }
        say(`konsol: ERR_FILE_NOT_FOUND ${konsol.dosyaBulunamadi.length} · JS hatası ${konsol.jsHatalari.length}`
          + ` · ağ engellenen ${rapor.katmanlar.icerik.agEngellenen}`);
        say(`içerik katmanı: ${DURUM_TR[k.durum]}${k.sebepler.length ? ` — ${k.sebepler.join(' | ')}` : ''}`);
      }

      // 3b. K4 güncellik (KABUL_K4=1): ayrı boş profil + CDP, motorun güncelleme sorusu ve cevabı.
      if (k4Acik) {
        paketSurum = K4.paketSurumleriOku(acilis.kok, acilis.asar, envanter.kitapDizinleri);
        say(`K4: paketteki kapak sürümleri ${JSON.stringify(paketSurum.surumler)}`
          + `${paketSurum.okunamayan.length ? ` (menü okunamadı: ${paketSurum.okunamayan.join(', ')})` : ''}`);
        k4Olcum = await K4.electronK4Olc({
          ikili: zaman && zaman.ikili,
          girisYolu: path.join(acilis.kok, 'index.html'),
          kurulumKoku: acilis.kok,
          kanit,
          calisma,
          log: say,
          kitapSn: s.kitapBekle,
          setTum: setTumAcik,
        });
        k4Olcumleri.push(k4Olcum);
        const kk = K4.k4Karari({
          olcum: k4Olcum, paketSurumleri: paketSurum.surumler, aktivasyon: s.aktivasyon,
          aktivasyonOlculemedi: aktOlc, profilBos: k4Olcum.profilBos, kaynak: 'electron',
        });
        k4Kararlar.push(kk);
        say(`K4 (electron, ${k4Olcum.sureSn} sn): E6=${k4Olcum.e6 && k4Olcum.e6.durum} E7=${k4Olcum.e7 && k4Olcum.e7.durum}`
          + ` → ${K4.K4_TR[kk.durum]} — ${kk.sebep}`);
        if (setTumAcik) {
          // SET: motor yalnız açılan kitabı sordu; her alt kitap cdp-kitap-ac --set-tum ile doğrudan.
          setTumKarar = (k4Olcum.setTum && k4Olcum.setTum.karar)
            || ST.setTumKarari({ hata: `SET ölçümü koşmadı (${(k4Olcum.e6 && k4Olcum.e6.sebep) || 'CDP sonucu yok'})` });
          for (const x of setTumKarar.satirlar || []) say(`K4 SET: ${ST.satirOzeti(x)}`);
          say(`K4 SET tüm alt kitaplar: ${K4.K4_TR[setTumKarar.durum]} — ${setTumKarar.sebep}`);
        }
      }
    }

    // 4. Android cihaz katmanı (pencerisiz emülatör)
    if (acilis && platform === 'android' && s.cihaz) {
      // eslint-disable-next-line global-require
      const { cihazKabulu } = require('./android-cihaz');
      rapor.katmanlar.cihaz = await cihazKabulu({
        apk: paket,
        kanit,
        avd: s.avd,
        beklenenKart: rapor.envanter ? rapor.envanter.beklenenKart : 0,
        setMi: rapor.envanter ? rapor.envanter.setMi : false,
        kitapAdlari: rapor.envanter ? rapor.envanter.kitapAdlari : [],
        aktivasyon: s.aktivasyon,
        ...(s.aktivasyon ? { menuBekleSn: AKTIVASYON_CIHAZ_MENU_SN } : {}),
        durumDosyasi: path.join(calisma, 'emulator.json'),
        log: say,
        k4Olc: k4Acik ? (ctx) => K4.cihazK4Olc({ ...ctx, kitapSn: s.kitapBekle }) : undefined,
      });
      const c = rapor.katmanlar.cihaz;
      if (k4Acik && c.k4) {
        k4Olcumleri.push(c.k4);
        const ck = K4.k4Karari({
          olcum: c.k4, paketSurumleri: paketSurum ? paketSurum.surumler : {}, aktivasyon: s.aktivasyon,
          aktivasyonOlculemedi: aktOlc, profilBos: true, kaynak: 'cihaz',
        });
        // Cihaz WebView ölçümü EK kanıttır: kendi başına ÖLÇÜLEMEDİ engellemez (soket yoksa kırmızı değil).
        if (ck.durum === K4.K4_DURUM.OLCULEMEDI) ck.engeller = false;
        k4Kararlar.push(ck);
        say(`K4 (cihaz WebView): E6=${c.k4.e6 && c.k4.e6.durum} E7=${c.k4.e7 && c.k4.e7.durum} → ${K4.K4_TR[ck.durum]} — ${ck.sebep}`);
      }
      say(`cihaz katmanı: ${DURUM_TR[c.durum]}${c.sebepler && c.sebepler.length ? ` — ${c.sebepler.join(' | ')}` : ''}`);
    }
  } finally {
    if (acilis && acilis.kapat) {
      try { acilis.kapat(); } catch (e) { say(`UYARI: kapatma hatası: ${e.message}`); }
    }
    const izler = await izleyici.durdur();
    const odakSonra = onUygulama();
    const kendiPidler = kosumSureci && kosumSureci.pid ? [kosumSureci.pid] : [];
    if (k4Olcum && k4Olcum.pid) kendiPidler.push(k4Olcum.pid);
    for (const pid of ekKosumPidleri) if (pid) kendiPidler.push(pid);
    const ok = O.odakKarari({ once: odakOnce, sonra: odakSonra, ornekler: izler.ornekler, kendiPidler });
    const etkinlesme = [...((kosumSonucu && kosumSonucu.etkinlesme) || []), ...((k4Olcum && k4Olcum.etkinlesme) || [])];
    rapor.odak = {
      once: odakOnce, sonra: odakSonra, ornekler: izler.ornekler, orneklemeSayisi: izler.orneklemeSayisi,
      kapiSureciPid: kosumSureci ? kosumSureci.pid : null,
      kapiSureciTuru: kosumSureci ? kosumSureci.uygulamaTuru : null,
      kosumEtkinlesme: etkinlesme,
      ...ok,
    };
    if (ok.calindi || etkinlesme.length) {
      rapor.katmanlar.odak = {
        durum: O.DURUM.OLCULEMEDI,
        sebepler: [`kapının kendi süreci öne geçti (lsappinfo: ${ok.calindi ? 'evet' : 'hayır'}, `
          + `did-become-active: ${etkinlesme.length}) — KAPI KUSURU, sonuç güvenilmez`],
      };
      if (calismaZamani && calismaZamani.dizin && odakCaldiIsaretle(calismaZamani.dizin, { etkinlesme, kanit })) {
        say(`çalışma zamanı kalıcı işaretlendi (bir daha kullanılmaz): ${calismaZamani.dizin}`);
      }
    } else {
      rapor.katmanlar.odak = { durum: O.DURUM.GECTI, sebepler: [] };
    }
    say(`odak sonra: ${odakSonra.asn} ${odakSonra.ad} · ${ok.ozet} · ${izler.orneklemeSayisi} örnek`
      + ` · kapı süreci ${rapor.odak.kapiSureciPid || '—'} (${rapor.odak.kapiSureciTuru || 'tür —'}), did-become-active ${etkinlesme.length}`);
    if (kendiCalismaDizini && !s.tut) {
      // Yalnız bu koşunun mkdtemp ile açtığı dizin; önek denetimi yanlış yolu silmeyi engeller.
      if (path.basename(calisma).startsWith('basliksiz-kabul-') && path.dirname(calisma) === os.tmpdir()) {
        try { fs.rmSync(calisma, { recursive: true, force: true }); } catch (_) { /* kalsın */ }
      }
    } else {
      say(`çalışma dizini korundu: ${calisma}`);
    }
  }

  // K4 genel karara katman listesinden DEĞİL genelKararK4 ile katılır (kendi sözlüğü: GÜNCEL-DEĞİL,
  // engellemeyen ÖLÇÜLEMEDİ). `katmanlar.guncellik` yalnız okuyucular (uçtan uca) içindir.
  const katmanListesi = Object.values(rapor.katmanlar);
  rapor.k4 = k4Acik ? k4Raporu(k4Kararlar, k4Olcumleri, paketSurum, setTumKarar)
    : { durum: K4.K4_DURUM.ATLANDI, sebep: 'KABUL_K4=1 değil (varsayılan kapalı)' };
  const genel = k4Acik ? K4.genelKararK4(O.genelKarar(katmanListesi), rapor.k4) : O.genelKarar(katmanListesi);
  const guncellik = K4.guncellikKatmani(rapor.k4);
  if (guncellik) rapor.katmanlar.guncellik = guncellik;
  rapor.karar = genel;
  rapor.sebepler = Object.entries(rapor.katmanlar)
    .flatMap(([ad, k]) => (k.sebepler || []).map((x) => `${ad}: ${x}`));
  rapor.sureSn = Math.round((Date.now() - baslangic) / 1000);
  rapor.bitis = new Date().toISOString();
  fs.writeFileSync(path.join(kanit, 'karar.json'), JSON.stringify(rapor, null, 2));
  if (k4Acik) {
    say(`K4 güncellik: ${K4.K4_TR[rapor.k4.durum]} (kod ${rapor.k4.kod}${rapor.k4.durum === K4.K4_DURUM.OLCULEMEDI
      ? `, ${rapor.k4.engeller ? 'yüklemeyi ENGELLER' : 'yüklemeyi engellemez'}` : ''}) — ${rapor.k4.sebep}`);
    for (const n of rapor.k4.notlar || []) say(`  k4 not: ${n}`);
  }
  say(`SONUÇ: ${DURUM_TR[genel]} (${rapor.sureSn} sn) — kanıt: ${kanit}`);
  if (genel === K4.K4_DURUM.GUNCEL_DEGIL) {
    // probook-kabul.sh ile AYNI iki satır — runner-helpers.pardusKabulSinifi bunları okur.
    say(`GUNCEL-DEGIL: ${rapor.k4.sebep}`);
    say(`yeniden kuyruk onerisi: ${rapor.k4.oneri || 'kaynak yenilenince yeniden kuyruga al'}`);
  }
  if (genel !== O.DURUM.GECTI) for (const x of rapor.sebepler.slice(0, 8)) say(`  - ${x}`);
  return { kod: K4.k4CikisKodu(genel, k4Acik, O.cikisKodu), rapor };
}

/**
 * karar.json `k4` alanı: birleşik karar + ölçüm özetleri (kanıt yolları, E6/E7, cevaplar).
 * SET tüm alt kitaplar (KABUL_SET_TUM=1) motor ölçümleri birleştikten SONRA en kötüsüyle katılır
 * (cihaz GEÇTİ'si ölçülemeyen alt kitabı örtmesin).
 */
function k4Raporu(kararlar, olcumler, paketSurum, setTumKarar = null) {
  const motor = K4.k4Birlestir(...kararlar);
  const k = (motor || setTumKarar ? ST.setTumBirlestir(motor, setTumKarar) : null) || {
    durum: K4.K4_DURUM.OLCULEMEDI,
    kod: K4.K4_KOD.OLCULEMEDI,
    sebep: 'K4 koşmadı (paket açılamadı)',
    oneri: '',
    notlar: [],
    engeller: true,
    kaynak: '-',
  };
  return {
    ...k,
    paketSurumleri: paketSurum ? paketSurum.surumler : null,
    setTum: setTumKarar ? {
      durum: setTumKarar.durum, sebep: setTumKarar.sebep, satirlar: setTumKarar.satirlar || [],
    } : null,
    olcumler: olcumler.map((o) => ({
      kaynak: o.kaynak, e6: o.e6, e7: o.e7, cevaplar: o.cevaplar, cdpPort: o.cdpPort || null, sureSn: o.sureSn,
      kanit: o.kanit, profil: o.profil || null, profilBos: o.profilBos, soket: o.soket || null,
      indirmeKesildi: o.indirmeKesildi || [], etkinlesme: (o.etkinlesme || []).length, kaydedici: o.kaydedici || null,
      cevrimici: o.cevrimici || null,
    })),
  };
}

function ozetle(a) {
  if (!a) return null;
  return {
    url: a.url, baslik: a.baslik, kartSayisi: a.kartSayisi, kartBicimleri: a.kartBicimleri,
    yukleniyor: a.yukleniyor, sayfaGorseli: a.sayfaGorseli, tuval: a.tuval, arkaPlanSayfa: a.arkaPlanSayfa,
    piksel: a.piksel, beklenenSn: a.beklenenSn, erkenYeterli: a.erkenYeterli, ekran: a.ekran,
    yuklenemedi: a.yuklenemedi, gorunurMetin: a.gorunurMetin,
  };
}

module.exports = {
  argumanCoz, kitapIdTuret, kanitAdi, kanitKoku, icerikKarari, calis, kosumAgi, agAcikYenidenKosulmali,
  AKTIVASYON_CIHAZ_MENU_SN,
};

if (require.main === module) {
  calis(process.argv.slice(2)).then(({ kod }) => process.exit(kod)).catch((e) => {
    process.stderr.write(`[kabul] BEKLENMEYEN HATA: ${(e && e.stack) || e}\n`);
    process.exit(3);
  });
}

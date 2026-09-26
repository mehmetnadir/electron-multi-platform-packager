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
 *   imza     (mac) codesign + stapler + spctl — noter/zımba yoksa RED
 *   icerik   Electron görünmez koşum: kök sayfa → DOM + piksel (ProBook eşikleri) →
 *            ilk kitap kartına tıkla → okuyucu sayfa çizdi mi
 *   cihaz    (android) pencerisiz emülatörde kur/aç/ekran/ui dökümü/kaldır
 *   odak     `lsappinfo front` önce = sonra; kapının süreci hiç öne geçmedi
 *
 * Kullanım:
 *   node tools/kabul/basliksiz-kabul.js <paket> [--platform mac|android|windows|pardus|dizin|zip]
 *        [--kitap-sayisi N] [--kitap-id ID] [--kanit <dizin>] [--calisma <dizin>] [--tut]
 *        [--ag] [--aktivasyon] [--cihaz-yok] [--avd <ad>] [--menu-bekle sn] [--kitap-bekle sn]
 * Çıkış: 0 GEÇTİ · 1 RED · 3 ÖLÇÜLEMEDİ · 2 kullanım hatası.
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

const DURUM_TR = { GECTI: 'GEÇTİ', RED: 'RED', OLCULEMEDI: 'ÖLÇÜLEMEDİ' };

function argumanCoz(argv) {
  const s = {
    paket: null, platform: null, kitapSayisi: null, kitapId: null, kanit: null, calisma: null,
    tut: false, ag: false, aktivasyon: false, cihaz: true, avd: null, menuBekle: 45, kitapBekle: 60,
    yardim: false,
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
      + '[--aktivasyon] [--cihaz-yok] [--avd <ad>] [--menu-bekle sn] [--kitap-bekle sn]');
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
  let kosumSonucu = null;
  let calismaZamani = null;
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
      });
      rapor.envanter = {
        setMi: envanter.setMi, kitapDizinleri: envanter.kitapDizinleri, beklenenKart,
        kokAppConfig: envanter.kokAppConfig, kokMotorKopyasi: motorKopyasiMi(envanter.indexHtml),
        kitapAdlari: ((envanter.setMenu && envanter.setMenu.kitaplar) || []).map((k) => k && k.ad).filter(Boolean),
        kokBaslik: (/<title>([^<]*)<\/title>/i.exec(envanter.indexHtml) || [])[1] || null,
      };
      say(`envanter: ${envanter.setMi ? `SET, app.config.js taşıyan ${envanter.kitapDizinleri.join(',')}` : 'tek kitap'}`
        + ` · beklenen kart ${beklenenKart} · kök <title> "${rapor.envanter.kokBaslik}"`);

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
        const girdi = {
          giris: path.join(acilis.kok, 'index.html'),
          kanitDizin: kanit,
          profilDizin: path.join(calisma, 'profil'),
          sonucYolu: path.join(kanit, 'kosum.json'),
          setMi: envanter.setMi,
          beklenenKart,
          ileriAdim: true,
          agKapali: !s.ag,
          menuBekleSn: s.menuBekle,
          kitapBekleSn: s.kitapBekle,
          toplamSn,
        };
        const girdiYolu = path.join(calisma, 'kosum-girdi.json');
        fs.mkdirSync(girdi.profilDizin, { recursive: true });
        fs.writeFileSync(girdiYolu, JSON.stringify(girdi, null, 2));
        say(`görünmez koşum başlıyor (offscreen, Dock'suz, ağ ${s.ag ? 'AÇIK' : 'kapalı'})`);
        kosumSureci = await kosumCalistir({
          ikili: zaman.ikili, girdiYolu, calisma, kanit, agKapali: !s.ag, toplamSn, log: say,
        });
        say(`koşum bitti: ${Math.round(kosumSureci.sureMs / 1000)} sn, çıkış ${kosumSureci.kod}`
          + `${kosumSureci.zamanAsimi ? ' (ZAMAN AŞIMI)' : ''} · süreç türü ${kosumSureci.uygulamaTuru || '—'}`);
        let kosum = null;
        try { kosum = JSON.parse(fs.readFileSync(girdi.sonucYolu, 'utf8')); } catch (_) { kosum = null; }
        kosumSonucu = kosum;
        fs.writeFileSync(path.join(kanit, 'konsol.log'), konsolGunlugu(kosum));
        const k = icerikKarari({ envanter, kosum, beklenenKart, aktivasyon: s.aktivasyon });
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
        durumDosyasi: path.join(calisma, 'emulator.json'),
        log: say,
      });
      const c = rapor.katmanlar.cihaz;
      say(`cihaz katmanı: ${DURUM_TR[c.durum]}${c.sebepler && c.sebepler.length ? ` — ${c.sebepler.join(' | ')}` : ''}`);
    }
  } finally {
    if (acilis && acilis.kapat) {
      try { acilis.kapat(); } catch (e) { say(`UYARI: kapatma hatası: ${e.message}`); }
    }
    const izler = await izleyici.durdur();
    const odakSonra = onUygulama();
    const kendiPidler = kosumSureci && kosumSureci.pid ? [kosumSureci.pid] : [];
    const ok = O.odakKarari({ once: odakOnce, sonra: odakSonra, ornekler: izler.ornekler, kendiPidler });
    const etkinlesme = (kosumSonucu && kosumSonucu.etkinlesme) || [];
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

  const katmanListesi = Object.values(rapor.katmanlar);
  const genel = O.genelKarar(katmanListesi);
  rapor.karar = genel;
  rapor.sebepler = Object.entries(rapor.katmanlar)
    .flatMap(([ad, k]) => (k.sebepler || []).map((x) => `${ad}: ${x}`));
  rapor.sureSn = Math.round((Date.now() - baslangic) / 1000);
  rapor.bitis = new Date().toISOString();
  fs.writeFileSync(path.join(kanit, 'karar.json'), JSON.stringify(rapor, null, 2));
  say(`SONUÇ: ${DURUM_TR[genel]} (${rapor.sureSn} sn) — kanıt: ${kanit}`);
  if (genel !== O.DURUM.GECTI) for (const x of rapor.sebepler.slice(0, 8)) say(`  - ${x}`);
  return { kod: O.cikisKodu(genel), rapor };
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

module.exports = { argumanCoz, kitapIdTuret, kanitAdi, icerikKarari, calis };

if (require.main === module) {
  calis(process.argv.slice(2)).then(({ kod }) => process.exit(kod)).catch((e) => {
    process.stderr.write(`[kabul] BEKLENMEYEN HATA: ${(e && e.stack) || e}\n`);
    process.exit(3);
  });
}

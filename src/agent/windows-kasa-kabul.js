'use strict';

/**
 * WINDOWS-KASA KABUL KAPISI — runner bağlantısı (Nadir 02.10: "windows kasa'yı kabul kapısı olarak
 * kullanmıyor musun?").
 *
 * Windows şeridinin kabulü bugüne kadar YALNIZ bu Mac'te başsız koşuyordu
 * (`basliksiz-kabul-kapisi.js` → `tools/kabul/basliksiz-kabul.js --platform windows`). İki eksik:
 *   1. Mac yük kapısına bağlı: 02.10'da yük 250–480 iken android/mac kabulleri 20 dk bekleyip
 *      ÖLÇÜLEMEDİ ile ertelendi; Windows aynı duvara çarpar.
 *   2. Gerçek Windows'ta KURULUM ve AÇILIŞ ölçülmüyor (Electron'u Mac'te açmak NSIS'i kurmaz).
 *
 * Bu modül paketi ofisteki gerçek Windows makinesinde (`windows-kasa`, Tailscale 100.99.245.17)
 * `tools/windows/kabul/kabul.py` ile ölçer: indir → kur (/S) → aç (CDP) → HER kitaba tıkla →
 * ilk sayfa + thumbnail kanıtı → ekran görüntüsü → kaldır. Kapı 22.09 gecesi 47 paketlik gerçek
 * koşuda kullanılan kapının KENDİSİDİR (davranışı değiştirilmedi; bkz. tools/windows/kabul/OKU.md).
 *
 * TAŞIMA (pull modeli, parola yok): host `~/vm-kapi/gorev/windows-kasa/` içine iş yazar
 * (`tools/windows/vm-kapi.js calistir`), kasa'daki izleyici (`vm-izleyici.ps1 -Makine windows-kasa`)
 * Mac'teki köprüden (`tools/windows/vm-kopru-sunucu.js`, 8791, yalnız VMware + Tailscale arayüzü)
 * çekip sonucu geri yazar. Paket baytları köprünün `dosya/` ucundan iner: exe `~/vm-kapi/` altına
 * sabit bağlantıyla (aynı birimde kopya yok) konur, iş bitince bağlantı kaldırılır.
 *
 * KARAR (runner şeridi):
 *   erişilemez (kalp bayat / köprü kapalı / BENDE-windows-kasa / aktivasyon kodlu seri)
 *                 → { kullanildi:false } — çağıran bugünkü BAŞSIZ kapıya düşer (yedek).
 *   GECTI         → imza yuvasına / yayına devam.
 *   KALDI         → HATA, paket R2'ye YÜKLENMEZ (iş failed — gerçek paket kusuru: kurulmadı, açılmadı,
 *                   kitap açılmadı, ilk sayfa/thumbnail yok).
 *   ÖLÇÜLEMEDİ    → HATA `WIN_KASA_KABUL_ISARETI` ile: zaman aşımı, izleyici koptu, rapor gelmedi,
 *                   indirme/aktarım hatası (INDIRILEMEDI / PE_DEGIL), kilit boşalmadı. `failed`
 *                   YAZILMAZ, kira bırakılır — başsız kapının `[ertelenebilir-basliksiz-kabul]`
 *                   davranışıyla aynı sınıf.
 *
 * KİLİT: aynı makineye iki kabul aynı anda gitmez — makine geneli flock
 * (`~/.empp-agent/windows-kasa-kabul.kilit`, ProBook kilidinin Mac karşılığı). Elle koşu
 * (`tools/windows/kabul/kosu.py`) da AYNI dosyayı kilitler.
 *
 * KANIT: `~/.empp-agent/kabul-kanit/<bookId>-windows-<damga>/` — rapor.json, menü + kitap başına
 * ekran görüntüsü, köprü çıktısı (kosu.log), karar (ozet.json).
 *
 * AKTİVASYON KODLU SERİ: kabul.py aktivasyon ekranını bilmez (taze kurulumda içerik kilitli →
 * tuval boş → sahte KALDI → kalıcı failed). Bu seride kasa kullanılmaz; başsız kapı (aktivasyon
 * ekranını tanır) koşar ve sebep loglanır.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const karar = require('../windows/vm-kapi-karar');
const { kanitAdi, kanitKoku } = require('../../tools/kabul/basliksiz-kabul');
const { WIN_KASA_KABUL_ISARETI } = require('./runner-helpers');

const MAKINE = 'windows-kasa';
const REPO_KOKU = path.join(__dirname, '..', '..');
const ALTYAPI_SEBEPLERI = new Set(['INDIRILEMEDI', 'PE_DEGIL']);

/** Runner CONFIG'ine eklenen alanlar (windows-serit varsayilanAyarlar içine yayılır). */
function kasaAyarlari(env = process.env, platform = process.platform) {
  const ev = path.join(os.homedir(), '.empp-agent');
  return {
    // YEREL KİP (2026-10-02): runner windows-kasa'nın KENDİSİNDE koşuyorsa (win32) köprü/izleyici
    // yoktur — kabul.py bu makinede doğrudan koşar. EMPP_WIN_KASA_YEREL=0/1 ile zorlanır.
    winKasaYerel: env.EMPP_WIN_KASA_YEREL ? env.EMPP_WIN_KASA_YEREL === '1' : platform === 'win32',
    winKasaPython: env.EMPP_WIN_KASA_PYTHON
      || path.win32.join(env.LOCALAPPDATA || 'C:\\Users\\Administrator\\AppData\\Local',
        'Programs', 'Python', 'Python313', 'python.exe'),
    // kabul.py KOK sabiti (D:\\kabul): paket oraya `<anahtar>.exe` adıyla konur, kabul.py ONBELLEK görür.
    winKasaYerelKok: env.EMPP_WIN_KASA_YEREL_KOK || 'D:\\kabul',
    // Aktivasyonlu seri (Nadir 03.10): geçerli test kodu dosyası (yalnız SYSTEM/Administrator okur;
    // şef yazar). Varsa kabul.py internetsiz + temiz profille a..e senaryosunu koşar; yoksa bu seride
    // kasa kullanılmaz (eski davranış: başsız kapı).
    winKasaAktivasyonKod: env.EMPP_KABUL_AKTIVASYON_KOD_DOSYASI || 'D:\\empp-ajan\\kabul\\aktivasyon-test-kodu.txt',
    // EMPP_WIN_KASA_KABUL=0 → kasa hiç denenmez (bugünkü başsız davranış). Varsayılan AÇIK.
    winKasaKabul: env.EMPP_WIN_KASA_KABUL !== '0',
    winKasaVmKok: env.EMPP_VM_KOK || path.join(os.homedir(), 'vm-kapi'),
    winKasaSurucu: path.join(REPO_KOKU, 'tools', 'windows', 'vm-kapi.js'),
    winKasaKabulPy: path.join(REPO_KOKU, 'tools', 'windows', 'kabul', 'kabul.py'),
    winKasaKilit: env.EMPP_WIN_KASA_KILIT || path.join(ev, 'windows-kasa-kabul.kilit'),
    winKasaKilitBeklemeMs: 30 * 60 * 1000,
    winKasaKilitAralikMs: 30 * 1000,
    // kosu.py varsayılanı 2400 sn; 1-2 GB indirme + kurulum + 7 kitaplık set için pay.
    winKasaKabulTimeoutMs: Number(env.EMPP_WIN_KASA_TIMEOUT_MS || 45 * 60 * 1000),
    winKasaKopruAdres: env.EMPP_KOPRU_ADRES || '',
    winKasaKopruPort: Number(env.EMPP_VM_PORT || 8791),
  };
}

// ---------------------------------------------------------------------------
// Saf kararlar
// ---------------------------------------------------------------------------

/**
 * Kasa kapısı şu an kullanılabilir mi? Saf (girdi: okunmuş kalp metni + bayraklar).
 * Kalp `durum/kalp-windows-kasa.txt`'i köprü sunucusu yazar → taze kalp hem izleyicinin hem
 * köprünün ayakta olduğunu kanıtlar (köprü kapalıyken kalp bayatlar — 22.09 dersi).
 * @returns {{erisilir:boolean, sebep:string, izleyici?:object}}
 */
function kasaErisimKarari({ etkin, kalpMetni, bende, simdiMs }) {
  if (!etkin) return { erisilir: false, sebep: 'EMPP_WIN_KASA_KABUL=0 (kapalı)' };
  if (bende) return { erisilir: false, sebep: 'BENDE-windows-kasa işareti var (makine elle kullanımda)' };
  const k = karar.kalpAyristir(kalpMetni);
  const i = karar.izleyiciDurumu(k.kalpMs, simdiMs, { dongu: k.dongu });
  if (i.durum !== 'ayakta') {
    return { erisilir: false, sebep: `izleyici ${i.durum}${i.sebep ? `: ${i.sebep}` : ''}`, izleyici: i };
  }
  if (i.serit === 'tikali') {
    return { erisilir: false, sebep: `izleyici şeridi tıkalı: ${i.uyari || ''}`.trim(), izleyici: i };
  }
  return { erisilir: true, sebep: `izleyici ayakta (kalp ${i.yasSn} sn, şerit ${i.serit})`, izleyici: i };
}

/** Kasa'ya giden tekil anahtar: dosya adı + rapor + ekran adlarında kullanılır. Saf. */
function kabulAnahtari(bookId, etiket, tarih = new Date()) {
  const iki = (n) => String(n).padStart(2, '0');
  const t = `${tarih.getFullYear()}${iki(tarih.getMonth() + 1)}${iki(tarih.getDate())}`
    + `${iki(tarih.getHours())}${iki(tarih.getMinutes())}${iki(tarih.getSeconds())}`;
  const temiz = (s) => String(s == null ? '' : s).replace(/[^A-Za-z0-9_-]+/g, '-').replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return [temiz(bookId) || 'kitap', temiz(etiket) || 'kabul', t].join('-').slice(0, 80);
}

/** PowerShell tek tırnaklı dize. Saf. */
function psTirnak(s) {
  return `'${String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').replace(/'/g, "''")}'`;
}

/**
 * Guest'te koşacak sarmalayıcı (kosu.py `kos()` ile aynı kalıp). Belirteç KOMUTTA GEÇMEZ: guest
 * `C:\vm-kapi\belirtec.txt`'ten okur. Bitince paket kopyası ve betik kopyası silinir
 * (Nadir 20.09: test makinelerinde disk temizliği açık talep; kurulum kabul.py'de kaldırılır).
 * Saf. @returns {string}
 */
function sarmalayiciPs({ anahtar, adres, port, baslik }) {
  const kok = `http://${adres}:${port}`;
  return [
    "$ErrorActionPreference='SilentlyContinue'",
    '$b=(Get-Content C:\\vm-kapi\\belirtec.txt -Raw).Trim()',
    `curl.exe -s -o C:\\vm-kapi\\kabul-${anahtar}.py ${kok}/$b/dosya/kabul-${anahtar}.py`,
    `& "$env:LOCALAPPDATA\\Programs\\Python\\Python313\\python.exe" C:\\vm-kapi\\kabul-${anahtar}.py `
      + `${psTirnak(anahtar)} "${kok}/$b/dosya/kabul-${anahtar}.exe" ${psTirnak(baslik)}`,
    `Remove-Item -Force -ErrorAction SilentlyContinue D:\\kabul\\${anahtar}.exe, C:\\vm-kapi\\kabul-${anahtar}.py`,
    '',
  ].join('\r\n');
}

/** vm-kapi.js `calistir`'a verilen tek satır komut (kosu.py ile aynı biçim). Saf. */
function guestKomutu({ anahtar, adres, port }) {
  const wad = `wrap-${anahtar}.ps1`;
  return 'powershell -NoProfile -ExecutionPolicy Bypass -Command '
    + '"$b=(Get-Content C:\\vm-kapi\\belirtec.txt -Raw).Trim(); '
    + `curl.exe -s -o C:\\vm-kapi\\${wad} http://${adres}:${port}/$b/dosya/${wad}; `
    + `powershell -NoProfile -ExecutionPolicy Bypass -File C:\\vm-kapi\\${wad}; `
    + `Remove-Item -Force -ErrorAction SilentlyContinue C:\\vm-kapi\\${wad}"`;
}

/** kabul.py'nin MACIP satırını çalışma-anı adresiyle değiştirir (kosu.py kabul_kopyala). Saf. */
function kabulPyHazirla(kaynak, adres) {
  let n = 0;
  const yeni = String(kaynak).replace(/^MACIP = "[^"]*"/m, () => { n += 1; return `MACIP = "${adres}"`; });
  if (n === 0) throw new Error("kabul.py'de MACIP satırı bulunamadı — dosya bozulmuş olabilir");
  return yeni;
}

/**
 * Köprü çıktısından kapı JSON'u (kosu.py `ciktidan_json` aynası). Kırpma ayıklamadan ÖNCE
 * yapılmaz: işaret son kez aranır. Ayıklanamazsa null, asla fırlatmaz. Saf.
 */
function ciktidanJson(cikti) {
  const s = String(cikti || '');
  const i = s.lastIndexOf('JSON>>>');
  if (i < 0) return null;
  const k = s.slice(i + 'JSON>>>'.length);
  const b = k.indexOf('{');
  const e = k.lastIndexOf('}');
  if (b < 0 || e <= b) return null;
  try { return JSON.parse(k.slice(b, e + 1)); } catch (_) { return null; }
}

/**
 * kabul.py raporu → runner kararı. Saf.
 * GEÇTİ yalnız rapor GECTI diyor VE en az bir kitap var VE her kitap GECTI ise (rapora körü körüne
 * güvenme — kabul.py'nin kendi kuralı da bu). İndirme/aktarım hatası paket kusuru DEĞİLDİR.
 * @returns {{durum:'GECTI'|'KALDI'|'OLCULEMEDI', sebep:string}}
 */
function raporKarari(rapor) {
  if (!rapor || typeof rapor !== 'object') return { durum: 'OLCULEMEDI', sebep: 'rapor yok/okunamadı' };
  const kitaplar = Array.isArray(rapor.kitaplar) ? rapor.kitaplar : [];
  const gecen = kitaplar.filter((k) => k && k.sonuc === 'GECTI').length;
  const ozet = `${gecen}/${kitaplar.length} kitap GECTI`;
  const akt = rapor.aktivasyon && rapor.aktivasyon.adimlar;
  if (akt && rapor.sonuc === 'GECTI') { // savunma: a..e'den biri GECTI değilse rapor ne derse desin KALDI
    const kotu = ['a', 'b', 'c', 'd', 'e'].find((a) => {
      const s = akt[a] && akt[a].sonuc;
      return !(s === 'GECTI' || (a === 'd' && s === 'ATLANDI'));
    });
    if (kotu) return { durum: 'KALDI', sebep: `aktivasyon-${kotu} ${(akt[kotu] && akt[kotu].sonuc) || 'ölçülmedi'}` };
  }
  if (rapor.sonuc === 'GECTI') {
    if (kitaplar.length && gecen === kitaplar.length) return { durum: 'GECTI', sebep: ozet };
    return { durum: 'KALDI', sebep: `rapor GECTI diyor ama ${ozet}` };
  }
  if (rapor.sonuc !== 'KALDI') return { durum: 'OLCULEMEDI', sebep: `bilinmeyen rapor sonucu "${rapor.sonuc}"` };
  if (ALTYAPI_SEBEPLERI.has(rapor.sebep)) {
    const d = rapor.indirme || {};
    return {
      durum: 'OLCULEMEDI',
      sebep: `paket kasa'ya inmedi (${rapor.sebep}${d.cikis != null ? `, curl ${d.cikis}` : ''})`,
    };
  }
  if (rapor.sebep) return { durum: 'KALDI', sebep: rapor.sebep };
  const kalan = kitaplar.filter((k) => !k || k.sonuc !== 'GECTI').map((k) => {
    const ad = (k && (k.id || k.ad)) || '?';
    return `${ad}:${(k && k.sebep) || `thumb=${k && k.thumbOK} tuval=${k && k.canvasDolu} sayfa=${k && k.sayfa}`}`;
  });
  return { durum: 'KALDI', sebep: `${ozet}${kalan.length ? ` — ${kalan.slice(0, 4).join('; ')}` : ''}` };
}

// ---------------------------------------------------------------------------
// I/O
// ---------------------------------------------------------------------------

function kalpYolu(cfg) {
  return path.join(cfg.winKasaVmKok, 'durum', `kalp-${MAKINE}.txt`);
}

/** Anlık erişim ölçümü (yalnız dosya okur, süreç açmaz — heartbeat'te çağrılabilir). */
function kasaErisimi(cfg, simdiMs = Date.now()) {
  if (cfg.winKasaYerel) {
    return cfg.winKasaKabul === false
      ? { erisilir: false, sebep: 'EMPP_WIN_KASA_KABUL=0 (kapalı)' }
      : { erisilir: true, sebep: 'yerel kip — runner windows-kasa\'nın kendisinde (kabul.py doğrudan)' };
  }
  let kalpMetni = '';
  try { kalpMetni = fs.readFileSync(kalpYolu(cfg), 'utf8'); } catch (_) { kalpMetni = ''; }
  const bende = fs.existsSync(karar.bendeYolu(cfg.winKasaVmKok, MAKINE));
  return kasaErisimKarari({ etkin: cfg.winKasaKabul !== false, kalpMetni, bende, simdiMs });
}

/** Mac'in köprü adresi: ayar/env, yoksa `tailscale ip -4`. Bulunamazsa null. */
function kopruAdresiCoz(cfg) {
  if (cfg.winKasaKopruAdres) return cfg.winKasaKopruAdres;
  const r = spawnSync('tailscale', ['ip', '-4'], { encoding: 'utf8', timeout: 10000 });
  const ip = r.status === 0 ? String(r.stdout || '').trim().split(/\s+/)[0] : '';
  return /^\d+\.\d+\.\d+\.\d+$/.test(ip) ? ip : null;
}

/** Paketi köprünün dosya deposuna koy: sabit bağlantı (aynı birim), olmazsa kopya. */
async function paketiSun(exe, hedef) {
  await sessizSil(hedef);
  try {
    await fsp.link(exe, hedef);
    return 'bag';
  } catch (_) {
    await fsp.copyFile(exe, hedef);
    return 'kopya';
  }
}

/** Kapının KENDİ ürettiği geçici dosyayı (sabit bağlantı / betik kopyası) kaldırır. */
async function sessizSil(yol) {
  try { await fsp.unlink(yol); } catch (_) { /* yok */ }
}

/** Kilit (makine geneli flock) — windows-serit'in imza kilidiyle aynı perl tutucu. */
async function kasaKilidiAl(cfg, { log, sleep }) {
  const { kilitDene, kilitBirak } = require('./windows-serit'); // döngüsel require: çağrı anında
  await fsp.mkdir(path.dirname(cfg.winKasaKilit), { recursive: true });
  const bitis = Date.now() + cfg.winKasaKilitBeklemeMs;
  let ilk = true;
  for (;;) {
    const r = await kilitDene(cfg.winKasaKilit);
    if (r.tutucu) return () => kilitBirak(r.tutucu);
    if (r.kod !== 75) {
      throw new Error(`${WIN_KASA_KABUL_ISARETI} windows-kasa kabul kilidi açılamadı (perl çıkış ${r.kod}) `
        + '— paket kusuru DEĞİL, iş ertelenmeli');
    }
    if (ilk) {
      log('windows: windows-kasa kabul kilidi dolu (makinede başka kabul var) — sıra bekleniyor');
      ilk = false;
    }
    if (Date.now() > bitis) {
      throw new Error(`${WIN_KASA_KABUL_ISARETI} windows-kasa kabul kilidi `
        + `${Math.round(cfg.winKasaKilitBeklemeMs / 60000)} dk boşalmadı — paket kusuru DEĞİL, yükleme YOK, `
        + 'iş ertelenmeli');
    }
    await sleep(cfg.winKasaKilitAralikMs);
  }
}

async function kanitTopla({ cfg, anahtar, kanitDizini, cikti, rapor, ozet }) {
  await fsp.mkdir(kanitDizini, { recursive: true });
  const sonucDizini = path.join(cfg.winKasaVmKok, 'sonuc', MAKINE);
  let ekranlar = [];
  try {
    ekranlar = (await fsp.readdir(sonucDizini))
      .filter((f) => f.startsWith(`${anahtar}-`) && f.endsWith('.png'));
  } catch (_) { ekranlar = []; }
  for (const f of ekranlar) {
    try {
      await fsp.copyFile(path.join(sonucDizini, f), path.join(kanitDizini, f));
    } catch (_) { /* kanıt eksik kalır; ozet.json listesi yine yazılır */ }
  }
  if (rapor) await fsp.writeFile(path.join(kanitDizini, 'rapor.json'), `${JSON.stringify(rapor, null, 2)}\n`);
  await fsp.writeFile(path.join(kanitDizini, 'kosu.log'), String(cikti || ''));
  await fsp.writeFile(path.join(kanitDizini, 'ozet.json'), `${JSON.stringify({ ...ozet, ekranlar }, null, 2)}\n`);
  return ekranlar;
}

/** Rapor gelmediyse köprü çıktısından ÖLÇÜLEMEDİ sebebini adlandır. Saf. */
function raporsuzSebep(r, tavanSn, surucuTavanMs) {
  const c = String((r && r.cikti) || '');
  const son = c.split('\n').filter(Boolean).slice(-2).join(' | ').slice(0, 200);
  if (r && r.zamanAsimi) return `köprü sürücüsü ${Math.round(surucuTavanMs / 60000)} dk içinde bitmedi`;
  if (/zaman-asimi|ZAMAN ASIMI/.test(c)) return `kabul ${Math.round(tavanSn / 60)} dk tavanında bitmedi (zaman aşımı)`;
  if (/"bozuk"|İZLEYİCİ|izleyici (olu|yok)/.test(c)) return `izleyici koptu: ${son}`;
  return `rapor gelmedi (çıkış ${r ? r.kod : '?'}): ${son}`;
}

/**
 * Kasa kapısı. Erişilemezse/kullanılamazsa `{kullanildi:false, sebep}` döner (çağıran başsız kapıya
 * düşer). GECTI → `{kullanildi:true, durum:'GECTI', kanitDizini}`. KALDI/ÖLÇÜLEMEDİ → FIRLATIR.
 * @param {{exe:string, bookId:string|number, etiket:string, baslik?:string, aktivasyon?:boolean,
 *          cfg:object, log?:Function, sleep?:Function, calistir?:Function}} p
 */
async function kasaKabulKapisi(p) {
  const { exe, bookId, etiket, cfg } = p;
  const log = p.log || (() => {});
  const sleep = p.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const e1 = kasaErisimi(cfg);
  if (!e1.erisilir) return { kullanildi: false, sebep: e1.sebep };
  if (cfg.winKasaYerel && !p.aktivasyon) return yerelKabulKapisi(p);
  if (cfg.winKasaYerel && p.aktivasyon && cfg.winKasaAktivasyonKod && fs.existsSync(cfg.winKasaAktivasyonKod)) {
    return yerelKabulKapisi(p);
  }
  if (p.aktivasyon) {
    return {
      kullanildi: false,
      sebep: 'aktivasyon kodlu seri — kabul.py aktivasyon ekranını tanımaz (başsız kapı tanır)',
    };
  }
  const adres = kopruAdresiCoz(cfg);
  if (!adres) {
    return { kullanildi: false, sebep: 'köprü adresi çözülemedi (EMPP_KOPRU_ADRES yok, tailscale ip -4 boş)' };
  }

  const birak = await kasaKilidiAl(cfg, { log, sleep });
  const anahtar = kabulAnahtari(bookId, etiket);
  const kok = cfg.winKasaVmKok;
  const port = cfg.winKasaKopruPort;
  const exeHedef = path.join(kok, `kabul-${anahtar}.exe`);
  const pyHedef = path.join(kok, `kabul-${anahtar}.py`);
  const psHedef = path.join(kok, `wrap-${anahtar}.ps1`);
  const kanitDizini = path.join(kanitKoku(), kanitAdi(bookId, 'windows'));
  const tavanSn = Math.ceil(cfg.winKasaKabulTimeoutMs / 1000);
  const surucuTavanMs = cfg.winKasaKabulTimeoutMs + 120000;
  const bas = Date.now();
  let r = null;
  let rapor = null;
  let k = null;
  try {
    // Kilidi beklerken izleyici düşmüş olabilir: yeniden ölç, kopmuşsa yedeğe düş.
    const e2 = kasaErisimi(cfg);
    if (!e2.erisilir) return { kullanildi: false, sebep: e2.sebep };
    await fsp.mkdir(kok, { recursive: true });
    const yol = await paketiSun(exe, exeHedef);
    const py = kabulPyHazirla(await fsp.readFile(cfg.winKasaKabulPy, 'utf8'), adres);
    await fsp.writeFile(pyHedef, py, 'utf8');
    await fsp.writeFile(psHedef, sarmalayiciPs({ anahtar, adres, port, baslik: p.baslik || String(bookId) }), 'utf8');
    log(`windows: windows-kasa kabul kapısı başlıyor [${etiket}] — anahtar ${anahtar}, `
      + `paket ${yol === 'bag' ? 'bağlantı' : 'kopya'}, tavan ${Math.round(tavanSn / 60)} dk `
      + '(kur → aç → her kitap → ilk sayfa + thumbnail → kaldır)');
    const argv = [process.execPath, cfg.winKasaSurucu, 'calistir', guestKomutu({ anahtar, adres, port }),
      '--makine', MAKINE, '--zaman-asimi', String(tavanSn)];
    const calistir = p.calistir || require('./windows-serit').komutKos; // döngüsel require: çağrı anında
    r = await calistir(argv, {
      env: { EMPP_VM_KOK: kok },
      zamanAsimiMs: surucuTavanMs,
      satir: (s) => { if (/^(INDIRME|KURULUM|KITAP|RAPOR|görev|çıkış)/.test(s)) log('  [kasa]', s.slice(0, 240)); },
    });
    try {
      rapor = JSON.parse(await fsp.readFile(path.join(kok, 'sonuc', MAKINE, `rapor-${anahtar}.png`), 'utf8'));
    } catch (_) {
      rapor = ciktidanJson(r && r.cikti);
    }
    k = raporKarari(rapor);
    if (!rapor) k.sebep = raporsuzSebep(r, tavanSn, surucuTavanMs);
  } catch (e) {
    // Hazırlık/köprü katmanı (disk, bağlantı, okuma) düştü: paket ÖLÇÜLMEDİ — kusur sayılmaz.
    k = { durum: 'OLCULEMEDI', sebep: `kasa kapısı hazırlığı düştü: ${(e && e.message) || e}` };
  } finally {
    await sessizSil(exeHedef);
    await sessizSil(pyHedef);
    await sessizSil(psHedef);
    if (k) {
      try {
        await kanitTopla({
          cfg, anahtar, kanitDizini, cikti: r && r.cikti, rapor,
          ozet: {
            bookId: String(bookId), etiket, anahtar, makine: MAKINE, karar: k.durum, sebep: k.sebep,
            sureSn: Math.round((Date.now() - bas) / 1000), cikis: r ? r.kod : null,
            zaman: new Date().toISOString(),
          },
        });
      } catch (e) { log('windows: UYARI windows-kasa kanıtı yazılamadı:', e.message); }
    }
    await birak();
  }
  if (k.durum === 'GECTI') {
    log(`windows: windows-kasa kabul kapısı GEÇTİ [${etiket}] — ${k.sebep}; kanıt: ${kanitDizini}`);
    return { kullanildi: true, durum: 'GECTI', sebep: k.sebep, kanitDizini };
  }
  if (k.durum === 'KALDI') {
    throw new Error(`windows paketi windows-kasa kabul kapısından geçemedi (KALDI) — R2'ye YÜKLENMEDİ: `
      + `${k.sebep}; kanıt: ${kanitDizini}`);
  }
  throw new Error(`${WIN_KASA_KABUL_ISARETI} windows-kasa kabulü ÖLÇÜLEMEDİ — paket kusuru DEĞİL, yükleme YOK, `
    + `iş ertelenmeli: ${k.sebep}; kanıt: ${kanitDizini}`);
}

// ---------------------------------------------------------------------------
// YEREL KİP — runner windows-kasa'nın kendisinde (sözleşme exesiz-kaynak §2c, Nadir 02.10)
// ---------------------------------------------------------------------------

/** kabul.py komut satırı (yerel kip). Saf. URL yerine `yerel:` — kabul.py paketi KOK'ta bulur (ONBELLEK). */
function yerelKabulArgv({ python, kabulPy, anahtar, exeHedef, baslik }) {
  return [python, kabulPy, anahtar, `yerel:${exeHedef}`, baslik];
}

/**
 * Makine geneli tek kabul kilidi (perl/flock yok): O_EXCL kilit dosyası. Bayat kilit (sahibi PID
 * yaşamıyor ya da `bayatMs`'den eski) taşınır, yerine yenisi alınır. @returns {Promise<() => Promise<void>>}
 */
async function yerelKilitAl(cfg, { log, sleep, simdi = Date.now, pidYasiyor = varsayilanPidYasiyor }) {
  await fsp.mkdir(path.dirname(cfg.winKasaKilit), { recursive: true });
  const bitis = simdi() + cfg.winKasaKilitBeklemeMs;
  const bayatMs = cfg.winKasaKabulTimeoutMs + 15 * 60 * 1000;
  let ilk = true;
  for (;;) {
    try {
      const fh = await fsp.open(cfg.winKasaKilit, 'wx');
      await fh.writeFile(JSON.stringify({ pid: process.pid, zaman: new Date(simdi()).toISOString() }));
      await fh.close();
      return async () => {
        try { await fsp.rename(cfg.winKasaKilit, `${cfg.winKasaKilit}.birakildi`); } catch (_) { /* yok */ }
      };
    } catch (e) {
      if (!e || e.code !== 'EEXIST') {
        throw new Error(`${WIN_KASA_KABUL_ISARETI} yerel kabul kilidi açılamadı (${(e && e.code) || e}) `
          + '— paket kusuru DEĞİL, iş ertelenmeli');
      }
    }
    let sahip = null;
    try { sahip = JSON.parse(await fsp.readFile(cfg.winKasaKilit, 'utf8')); } catch (_) { sahip = null; }
    const yas = sahip && sahip.zaman ? simdi() - Date.parse(sahip.zaman) : Infinity;
    if (!sahip || !pidYasiyor(sahip.pid) || yas > bayatMs) {
      log(`windows: yerel kabul kilidi bayat (pid ${sahip && sahip.pid}, yaş ${Math.round(yas / 1000)} sn) — devralınıyor`);
      try { await fsp.rename(cfg.winKasaKilit, `${cfg.winKasaKilit}.bayat-${simdi()}`); } catch (_) { /* yarış */ }
      continue;
    }
    if (ilk) { log('windows: yerel kabul kilidi dolu (makinede başka kabul var) — sıra bekleniyor'); ilk = false; }
    if (simdi() > bitis) {
      throw new Error(`${WIN_KASA_KABUL_ISARETI} yerel kabul kilidi `
        + `${Math.round(cfg.winKasaKilitBeklemeMs / 60000)} dk boşalmadı — paket kusuru DEĞİL, iş ertelenmeli`);
    }
    await sleep(cfg.winKasaKilitAralikMs);
  }
}

function varsayilanPidYasiyor(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e && e.code === 'EPERM'; }
}

/**
 * Yerel kabul kapısı: paket D:\\kabul\\<anahtar>.exe (aynı birimde sabit bağlantı) → kabul.py bu
 * makinede (kur → aç → her kitap → ilk sayfa + thumbnail → ekran → kaldır); ekranlar ve rapor
 * doğrudan kanıt dizinine yazılır (EMPP_KABUL_YEREL_DIZIN). Kararlar köprülü kapıyla AYNI
 * (`raporKarari`): GECTI döner, KALDI/ÖLÇÜLEMEDİ fırlatır.
 */
async function yerelKabulKapisi(p) {
  const { exe, bookId, etiket, cfg } = p;
  const log = p.log || (() => {});
  const sleep = p.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const birak = await (p.kilitAl || yerelKilitAl)(cfg, { log, sleep });
  const anahtar = kabulAnahtari(bookId, etiket);
  const exeHedef = path.join(cfg.winKasaYerelKok, `${anahtar}.exe`);
  const kanitDizini = path.join(kanitKoku(), kanitAdi(bookId, 'windows'));
  const tavanMs = cfg.winKasaKabulTimeoutMs;
  const bas = Date.now();
  let r = null;
  let rapor = null;
  let k = null;
  try {
    await fsp.mkdir(cfg.winKasaYerelKok, { recursive: true });
    await fsp.mkdir(kanitDizini, { recursive: true });
    const yol = await paketiSun(exe, exeHedef);
    log(`windows: windows-kasa YEREL kabul başlıyor [${etiket}] — anahtar ${anahtar}, paket `
      + `${yol === 'bag' ? 'bağlantı' : 'kopya'}, tavan ${Math.round(tavanMs / 60000)} dk `
      + '(kur → aç → her kitap → ilk sayfa + thumbnail → kaldır)');
    const argv = yerelKabulArgv({
      python: cfg.winKasaPython, kabulPy: cfg.winKasaKabulPy, anahtar, exeHedef, baslik: p.baslik || String(bookId),
    });
    const calistir = p.calistir || require('./windows-serit').komutKos; // döngüsel require: çağrı anında
    r = await calistir(argv, {
      env: {
        EMPP_KABUL_YEREL_DIZIN: kanitDizini, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1',
        ...(p.aktivasyon ? { EMPP_KABUL_AKTIVASYON: '1', EMPP_KABUL_AKTIVASYON_KOD_DOSYASI: cfg.winKasaAktivasyonKod } : {}),
      },
      zamanAsimiMs: tavanMs,
      satir: (s) => { if (/^(INDIRME|KURULUM|KITAP|AKTIVASYON|RAPOR)/.test(s)) log('  [kasa]', s.slice(0, 240)); },
    });
    rapor = ciktidanJson(r && r.cikti);
    k = raporKarari(rapor);
    if (!rapor) {
      const son = String((r && r.cikti) || '').split(/\r?\n/).filter(Boolean).slice(-2).join(' | ').slice(0, 200);
      k.sebep = r && r.zamanAsimi ? `kabul.py ${Math.round(tavanMs / 60000)} dk içinde bitmedi`
        : `rapor gelmedi (çıkış ${r ? r.kod : '?'}${r && r.hata ? `, ${r.hata}` : ''}): ${son}`;
    }
  } catch (e) {
    k = { durum: 'OLCULEMEDI', sebep: `yerel kabul hazırlığı düştü: ${(e && e.message) || e}` };
  } finally {
    await sessizSil(exeHedef);
    if (k) {
      try {
        let ekranlar = [];
        try { ekranlar = (await fsp.readdir(kanitDizini)).filter((f) => f.endsWith('.png')); } catch (_) { ekranlar = []; }
        if (rapor) await fsp.writeFile(path.join(kanitDizini, 'rapor.json'), `${JSON.stringify(rapor, null, 2)}\n`);
        await fsp.writeFile(path.join(kanitDizini, 'kosu.log'), String((r && r.cikti) || ''));
        await fsp.writeFile(path.join(kanitDizini, 'ozet.json'), `${JSON.stringify({
          bookId: String(bookId), etiket, anahtar, makine: MAKINE, kip: 'yerel', karar: k.durum, sebep: k.sebep,
          sureSn: Math.round((Date.now() - bas) / 1000), cikis: r ? r.kod : null, zaman: new Date().toISOString(),
          ekranlar,
        }, null, 2)}\n`);
      } catch (e) { log('windows: UYARI yerel kabul kanıtı yazılamadı:', e.message); }
    }
    await birak();
  }
  if (k.durum === 'GECTI') {
    log(`windows: windows-kasa YEREL kabul GEÇTİ [${etiket}] — ${k.sebep}; kanıt: ${kanitDizini}`);
    return { kullanildi: true, durum: 'GECTI', sebep: k.sebep, kanitDizini };
  }
  if (k.durum === 'KALDI') {
    throw new Error(`windows paketi windows-kasa kabul kapısından geçemedi (KALDI) — R2'ye YÜKLENMEDİ: `
      + `${k.sebep}; kanıt: ${kanitDizini}`);
  }
  throw new Error(`${WIN_KASA_KABUL_ISARETI} windows-kasa kabulü ÖLÇÜLEMEDİ — paket kusuru DEĞİL, yükleme YOK, `
    + `iş ertelenmeli: ${k.sebep}; kanıt: ${kanitDizini}`);
}

module.exports = {
  yerelKabulArgv, yerelKilitAl, yerelKabulKapisi,
  MAKINE, kasaAyarlari, kasaErisimKarari, kasaErisimi, kabulAnahtari, psTirnak, sarmalayiciPs, guestKomutu,
  kabulPyHazirla, ciktidanJson, raporKarari, raporsuzSebep, kopruAdresiCoz, kasaKilidiAl, kasaKabulKapisi,
};

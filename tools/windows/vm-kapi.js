#!/usr/bin/env node
'use strict';
/**
 * WINDOWS KABUL KAPISI — host (Mac) sürücüsü.
 *
 * Guest'te parola gerektiren hiçbir şey çalıştırmaz: köprü paylaşılan klasördür
 * (`tools/windows/vm-izleyici.ps1` guest'te bir kez elle başlatılır). Yalnız
 * kimlik GEREKTİRMEYEN `vmrun` yeteneklerini kullanır: snapshot al / geri dön / listele.
 *
 * Kullanım:
 *   node tools/windows/vm-kapi.js baslat          # başsız aç (odak çalmaz)
 *   node tools/windows/vm-kapi.js uyut            # suspend — izleyici ayakta kalır
 *   node tools/windows/vm-kapi.js hazir
 *   node tools/windows/vm-kapi.js kur <exe-yolu> [--surec "Super Monsters 4"]
 *   node tools/windows/vm-kapi.js ac   --surec "Super Monsters 4" --yol "C:\\...\\x.exe"
 *   node tools/windows/vm-kapi.js ekran [--surec ...]
 *   node tools/windows/vm-kapi.js anlik-al <ad>     # snapshot
 *   node tools/windows/vm-kapi.js geri-don <ad>
 *
 * Ortam: EMPP_VM_KOK (varsayılan ~/vm-kapi), EMPP_VMX (varsayılan tek çalışan VM).
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const karar = require('../../src/windows/vm-kapi-karar');

const VMRUN = '/Applications/VMware Fusion.app/Contents/Public/vmrun';
const KOK = process.env.EMPP_VM_KOK || path.join(os.homedir(), 'vm-kapi');

// HANGİ MAKİNE: `--makine <ad>` (varsayılan "vm" = VMware misafiri). Gerçek
// makineler (windows-kasa gibi) kendi alt dizinlerini kullanır; varsayılan makine
// KÖK dizinlerde kalır ki eski kurulum hiç değişmesin.
const MAKINE = (() => {
  const i = process.argv.indexOf('--makine');
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : (process.env.EMPP_VM_MAKINE || 'vm');
})();
const altDizin = (ad) => (MAKINE === 'vm' ? path.join(KOK, ad) : path.join(KOK, ad, MAKINE));
const D = {
  gorev: altDizin('gorev'),
  sonuc: altDizin('sonuc'),
  durum: path.join(KOK, 'durum'),
};
const KALP_DOSYASI = MAKINE === 'vm'
  ? path.join(KOK, 'durum', 'kalp.txt')
  : path.join(KOK, 'durum', `kalp-${MAKINE}.txt`);

function dizinleriKur() {
  for (const d of Object.values(D)) fs.mkdirSync(d, { recursive: true });
}

function calisanVmx() {
  const c = execFileSync(VMRUN, ['list'], { encoding: 'utf8' });
  return c.split('\n').filter((s) => s.trim().endsWith('.vmx')).map((s) => s.trim());
}

// VM KAPALIYKEN de yol gerekir (baslat komutu): çalışan yoksa varsayılan
// kütüphaneden tek .vmx aranır. Birden çok varsa tahmin ÜRETİLMEZ, EMPP_VMX istenir.
function vmx() {
  if (process.env.EMPP_VMX) return process.env.EMPP_VMX;
  const calisan = calisanVmx();
  if (calisan.length === 1) return calisan[0];
  if (calisan.length > 1) throw new Error(`${calisan.length} VM çalışıyor — EMPP_VMX ver`);
  const kutuphane = path.join(os.homedir(), 'Virtual Machines.localized');
  const adaylar = [];
  for (const d of (fs.existsSync(kutuphane) ? fs.readdirSync(kutuphane) : [])) {
    if (!d.endsWith('.vmwarevm')) continue;
    for (const f of fs.readdirSync(path.join(kutuphane, d))) {
      if (f.endsWith('.vmx')) adaylar.push(path.join(kutuphane, d, f));
    }
  }
  if (adaylar.length !== 1) throw new Error(`kütüphanede tek VM bekleniyordu, ${adaylar.length} bulundu — EMPP_VMX ver`);
  return adaylar[0];
}

function kalpMs() {
  try {
    const ham = fs.readFileSync(KALP_DOSYASI, 'utf8').trim();
    const t = Date.parse(ham);
    return Number.isFinite(t) ? t : null;
  } catch { return null; }
}

// Paylaşılan klasör bu host+misafir birleşiminde YOK (Fusion 13 / Apple Silicon /
// Win11 ARM); komut HTTP köprüsünü gösterir. Köprü ayakta değilse belirteç de yoktur.
function izleyiciKomutu() {
  let belirtec = '<köprüyü başlat: node tools/windows/vm-kopru-sunucu.js>';
  try { belirtec = fs.readFileSync(path.join(D.durum, 'belirtec.txt'), 'utf8').trim() || belirtec; } catch {}
  return `  powershell -ExecutionPolicy Bypass -File C:\\vm-kapi\\vm-izleyici.ps1 ` +
    `-Adres http://192.168.11.1:${process.env.EMPP_VM_PORT || 8791} -Belirtec ${belirtec}`;
}

function hazirMi() {
  dizinleriKur();
  const r = karar.izleyiciDurumu(kalpMs(), Date.now());
  return r;
}

function gorevYaz(govde) {
  dizinleriKur();
  const kimlik = karar.gorevKimligi(Date.now(), Math.floor(Math.random() * 10000));
  const gecici = path.join(D.gorev, `${kimlik}.tmp`);
  fs.writeFileSync(gecici, JSON.stringify(govde, null, 2), 'utf8');
  fs.renameSync(gecici, path.join(D.gorev, `${kimlik}.json`));   // atomik
  return kimlik;
}

function sonucOku(kimlik) {
  try { return JSON.parse(fs.readFileSync(path.join(D.sonuc, `${kimlik}.json`), 'utf8')); }
  catch { return null; }
}

async function bekle(kimlik, zamanAsimiSn) {
  const bas = Date.now();
  for (;;) {
    const gecen = Math.floor((Date.now() - bas) / 1000);
    const k = karar.gorevKarari(sonucOku(kimlik), gecen, zamanAsimiSn);
    if (k.durum !== 'bekleniyor') return k;
    // İzleyici bu sırada ölürse sessizce beklemeyelim. Ama görev UÇUŞTA:
    // uzun bir indirme/kurulum sırasında susması normaldir (eşik 300 sn).
    const i = karar.izleyiciDurumu(kalpMs(), Date.now(), { gorevUcusta: true });
    if (i.uyari) console.log(`   … ${i.uyari}`);
    if (i.durum !== 'ayakta') {
      return { durum: 'bozuk', sebep: `izleyici ${i.durum}: ${i.sebep || ''}`.trim() };
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
}

// ——— ÇAKIŞMA KORUMASI ———————————————————————————————————————————————
// Nadir aynı VM'i elle kullanıyor. İki işaret:
//   ~/vm-kapi/BENDE  → o koyar; kapı VM durumuna DOKUNMAZ (ölçüm komutları serbest).
//   VM penceresi açık → muhtemelen o kullanıyor; durum değiştiren hamle reddedilir.
// Karar saf modülde (src/windows/vm-kapi-karar.js → mudahaleKarari), burada yalnız
// işaretler okunur.
const BENDE = path.join(KOK, 'BENDE');

function bendeMi() { return fs.existsSync(BENDE); }

// Fusion'da VM'in KENDİ penceresi açık mı? ("Virtual Machine Library" sayılmaz.)
function pencereAcikMi() {
  try {
    const c = execFileSync('osascript',
      ['-e', 'tell application "System Events" to get name of every window of application process "VMware Fusion"'],
      { encoding: 'utf8', timeout: 10000 });
    return c.split(',').map((x) => x.trim()).filter(Boolean)
      .some((ad) => ad && ad !== 'Virtual Machine Library');
  } catch { return false; }        // Fusion arayüzü kapalıysa pencere de yoktur
}

function kapiBekcisi(komut) {
  const zorla = process.argv.includes('--zorla');
  let vmCalisiyor = true;
  try { vmCalisiyor = calisanVmx().includes(vmx()); } catch { vmCalisiyor = false; }
  const k = karar.mudahaleKarari({
    komut, bendeBayragi: bendeMi(), pencereAcik: pencereAcikMi(), vmCalisiyor, zorla,
  });
  if (k.izin) return;
  const aciklama = {
    'nadir-kullaniyor': `~/vm-kapi/BENDE işareti duruyor — VM Nadir'de. Bitince: rm ~/vm-kapi/BENDE`,
    'pencere-acik': 'VM penceresi ekranda açık — birisi kullanıyor olabilir. Yine de isteniyorsa --zorla',
    'yikici-el-degmis': 'GERİ DÖNÜLMEZ: anlık görüntüye dönmek, o tarihten sonra yapılan HER ŞEYİ siler. El değmiş bir VM\'de --zorla ile bile yapılmaz; önce Nadir\'e sor',
  }[k.sebep] || k.sebep;
  console.error(`REDDEDİLDİ (${komut}): ${aciklama}`);
  process.exit(4);
}

// BAŞSIZ ÇALIŞTIRMA (Nadir kuralı: "benden odak çalmasın").
// Ölçüldü 2026-09-20: `start ... nogui` ön plana GEÇMİYOR (öndeki uygulama değişmedi),
// ama Fusion arayüzü zaten açıksa VM için bir pencere oluşturuyor. Bu yüzden başlattıktan
// sonra Fusion süreci gizlenir (⌘H eşdeğeri) — pencere ekrandan kalkar, odak yerinde kalır.
function fusionGizle() {
  try {
    execFileSync('osascript',
      ['-e', 'tell application "System Events" to set visible of process "VMware Fusion" to false'],
      { stdio: 'ignore', timeout: 10000 });
  } catch { /* Fusion arayüzü açık değilse gizlenecek bir şey de yoktur */ }
}

function baslat() {
  const yol = vmx();
  const gizleIstendi = process.argv.includes('--gizle');
  if (calisanVmx().includes(yol)) { console.log('VM zaten çalışıyor'); if (gizleIstendi) fusionGizle(); return; }
  // nogui = pencere açılmaz, odak çalınmaz (ölçüldü). Fusion arayüzü açıksa
  // kütüphane penceresi görünür kalır — GİZLEME ARTIK OTOMATİK DEĞİL: Nadir
  // pencereyi bulamayınca "VM'imi ele geçirdin" demişti, sessiz gizleme yanlış.
  execFileSync(VMRUN, ['-T', 'fusion', 'start', yol, 'nogui'], { stdio: 'inherit' });
  if (gizleIstendi) fusionGizle();
  console.log('VM başsız başlatıldı:', path.basename(yol));
}

// "Uykuya al" = suspend: bellek diske yazılır, sonraki start kaldığı yerden sürer —
// misafirdeki izleyici de ayakta kalır, yani tek seferlik elle başlatma tekrarlanmaz.
function uyut() {
  const yol = vmx();
  if (!calisanVmx().includes(yol)) { console.log('VM zaten kapalı'); return; }
  execFileSync(VMRUN, ['-T', 'fusion', 'suspend', yol], { stdio: 'inherit' });
  console.log('VM uykuya alındı');
}

function anlikAl(ad) { execFileSync(VMRUN, ['-T', 'fusion', 'snapshot', vmx(), ad], { stdio: 'inherit' }); }
function geriDon(ad) { execFileSync(VMRUN, ['-T', 'fusion', 'revertToSnapshot', vmx(), ad], { stdio: 'inherit' }); }

function bayrak(ad, varsayilan) {
  const i = process.argv.indexOf(`--${ad}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : varsayilan;
}

async function ana() {
  const komut = process.argv[2];
  if (komut === 'hazir') {
    const r = hazirMi();
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.durum === 'ayakta' ? 0 : 3);
  }
  if (komut === 'baslat') { kapiBekcisi('baslat'); baslat(); return; }
  if (komut === 'uyut') { kapiBekcisi('uyut'); uyut(); return; }
  if (komut === 'gizle') { fusionGizle(); return; }

  const i = hazirMi();
  if (i.durum !== 'ayakta' && !['anlik-al', 'geri-don'].includes(komut)) {
    console.error(`İZLEYİCİ ${i.durum.toUpperCase()}: ${i.sebep || ''}`);
    console.error("VM'de bir kez başlat:");
    console.error(izleyiciKomutu());
    process.exit(3);
  }

  if (komut === 'kur') {
    kapiBekcisi('kur');
    const kaynak = process.argv[3];
    dizinleriKur();
    let govde;
    let aciklama;
    if (/^https?:\/\//i.test(kaynak || '')) {
      // DOĞRUDAN İNDİRME: bayt Mac'ten geçmez, makine kaynaktan kendisi çeker.
      // Nadir kuralı: ofis makinelerinin hattı bu Mac'ten hızlı.
      const ad = bayrak('ad', path.basename(new URL(kaynak).pathname) || 'kurulum.exe');
      govde = { tur: 'kur', dosya: ad, dosyaUrl: kaynak, surecAdi: bayrak('surec', 'Super Monsters 4'), bekleSn: 25 };
      aciklama = `doğrudan indirme: ${kaynak.slice(0, 80)}…`;
    } else {
      if (!kaynak || !fs.existsSync(kaynak)) { console.error('kurulum dosyası bulunamadı (yol ya da http adresi ver)'); process.exit(2); }
      const ad = path.basename(kaynak);
      fs.copyFileSync(kaynak, path.join(KOK, ad));      // dosya deposu TÜM makinelerde ortak
      govde = { tur: 'kur', dosya: ad, surecAdi: bayrak('surec', 'Super Monsters 4'), bekleSn: 25 };
      aciklama = `${(fs.statSync(kaynak).size / 1e6).toFixed(0)} MB köprüden`;
    }
    const kimlik = gorevYaz(govde);
    console.log(`görev ${kimlik} [${MAKINE}] — kuruluyor (${aciklama})`);
    const k = await bekle(kimlik, Number(bayrak('zaman-asimi', '1800')));
    console.log(JSON.stringify(k, null, 2));
    process.exit(k.durum === 'gecti' ? 0 : 1);
  }
  if (komut === 'ac' || komut === 'ekran' || komut === 'kapat') {
    const govde = { tur: komut, surecAdi: bayrak('surec', 'Super Monsters 4') };
    if (komut === 'ac') { govde.yol = bayrak('yol', null); govde.bekleSn = Number(bayrak('bekle', '25')); }
    const kimlik = gorevYaz(govde);
    const k = await bekle(kimlik, Number(bayrak('zaman-asimi', '180')));
    console.log(JSON.stringify(k, null, 2));
    process.exit(k.durum === 'gecti' ? 0 : 1);
  }
  if (komut === 'calistir') {
    // UZAK KOMUT: makine yönetimi (disk ölçümü/temizliği, sürüm sorgusu).
    // Ekran/süreç kanıtı BEKLENMEZ — izleyici bu dalda beklenenKanit=false döner.
    // Komut TEK argüman olarak gelir (tırnak içinde). Kalan argv bayraklara aittir —
    // 'hostname --zaman-asimi 90' kazası (değer komuta yapışıp `hostname 90` oldu) bu yüzden.
    const { govde, hata } = karar.calistirGovdesi(process.argv[3]);
    if (hata) { console.error(`komut reddedildi: ${hata}`); process.exit(2); }
    const kimlik = gorevYaz(govde);
    console.log(`görev ${kimlik} [${MAKINE}] — ${govde.komut.slice(0, 120)}`);
    const k = await bekle(kimlik, Number(bayrak('zaman-asimi', '600')));
    const s = sonucOku(kimlik);
    if (s) console.log(`çıkış ${s.cikis}\n${s.cikti || ''}`);
    else console.log(JSON.stringify(k, null, 2));
    process.exit(k.durum === 'gecti' ? 0 : 1);
  }
  if (komut === 'anlik-al') { anlikAl(process.argv[3] || 'kapi-oncesi'); return; }
  if (komut === 'geri-don') { kapiBekcisi('geri-don'); geriDon(process.argv[3] || 'kapi-oncesi'); return; }

  console.error('bayraklar: --zorla (koruma aş) · --gizle (baslat ile)\n' +
    'işaret: touch ~/vm-kapi/BENDE → kapı VM durumuna dokunmaz\n' +
    'komut: baslat | uyut | gizle | hazir | kur <exe|http-adres> | ac | ekran | kapat | calistir <cmd…> | anlik-al <ad> | geri-don <ad>\n' +
    'makine: --makine <ad> (varsayılan vm) — gerçek makineler için ör. --makine windows-kasa');
  process.exit(2);
}

if (require.main === module) ana().catch((e) => { console.error('HATA:', e.message); process.exit(1); });
module.exports = { hazirMi, gorevYaz, sonucOku, bekle, KOK, D };

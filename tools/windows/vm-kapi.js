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
const D = {
  gorev: path.join(KOK, 'gorev'),
  sonuc: path.join(KOK, 'sonuc'),
  durum: path.join(KOK, 'durum'),
};

function dizinleriKur() {
  for (const d of Object.values(D)) fs.mkdirSync(d, { recursive: true });
}

function vmx() {
  if (process.env.EMPP_VMX) return process.env.EMPP_VMX;
  const c = execFileSync(VMRUN, ['list'], { encoding: 'utf8' });
  const satirlar = c.split('\n').filter((s) => s.trim().endsWith('.vmx'));
  if (satirlar.length !== 1) {
    throw new Error(`tek çalışan VM bekleniyordu, ${satirlar.length} bulundu — EMPP_VMX ver`);
  }
  return satirlar[0].trim();
}

function kalpMs() {
  try {
    const ham = fs.readFileSync(path.join(D.durum, 'kalp.txt'), 'utf8').trim();
    const t = Date.parse(ham);
    return Number.isFinite(t) ? t : null;
  } catch { return null; }
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
    // İzleyici bu sırada ölürse sessizce beklemeyelim.
    const i = karar.izleyiciDurumu(kalpMs(), Date.now());
    if (i.durum !== 'ayakta') {
      return { durum: 'bozuk', sebep: `izleyici ${i.durum}: ${i.sebep || ''}`.trim() };
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
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
  const i = hazirMi();
  if (i.durum !== 'ayakta' && !['anlik-al', 'geri-don'].includes(komut)) {
    console.error(`İZLEYİCİ ${i.durum.toUpperCase()}: ${i.sebep || ''}`);
    console.error(`VM'de bir kez başlat: powershell -ExecutionPolicy Bypass -File "\\\\vmware-host\\Shared Folders\\vm-kapi\\vm-izleyici.ps1"`);
    process.exit(3);
  }

  if (komut === 'kur') {
    const exe = process.argv[3];
    if (!exe || !fs.existsSync(exe)) { console.error('kurulum dosyası bulunamadı'); process.exit(2); }
    dizinleriKur();
    const ad = path.basename(exe);
    fs.copyFileSync(exe, path.join(KOK, ad));          // paylaşılan klasöre koy
    const kimlik = gorevYaz({ tur: 'kur', dosya: ad, surecAdi: bayrak('surec', 'Super Monsters 4'), bekleSn: 25 });
    console.log(`görev ${kimlik} — kuruluyor (${(fs.statSync(exe).size / 1e6).toFixed(0)} MB)`);
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
  if (komut === 'anlik-al') { anlikAl(process.argv[3] || 'kapi-oncesi'); return; }
  if (komut === 'geri-don') { geriDon(process.argv[3] || 'kapi-oncesi'); return; }

  console.error('komut: hazir | kur <exe> | ac | ekran | kapat | anlik-al <ad> | geri-don <ad>');
  process.exit(2);
}

if (require.main === module) ana().catch((e) => { console.error('HATA:', e.message); process.exit(1); });
module.exports = { hazirMi, gorevYaz, sonucOku, bekle, KOK, D };

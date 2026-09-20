#!/usr/bin/env node
'use strict';
/**
 * VM KÖPRÜ SUNUCUSU (host, Mac) — paylaşılan klasör YOKKEN kullanılan taşıma katmanı.
 *
 * NEDEN: VMware Fusion 13'te **Apple Silicon host + Windows 11 ARM misafir** için
 * paylaşılan klasör DESTEKLENMİYOR (Broadcom belgesi; Fusion'ın Ayarlar penceresinde
 * "Sharing" paneli hiç görünmüyor — eksik yapılandırma değil, olmayan özellik).
 * Ölçüldü: Fusion 13.6.4, host arm64, vmx'te tek bir hgfs/sharedFolder satırı yok.
 *
 * ÇÖZÜM: aynı dosya protokolünü ağ üzerinden taşı. Misafir, Mac'e VMware ağından
 * ulaşıyor (ölçüldü: bridge100 = 192.168.11.1 / NAT, bridge101 = 192.168.225.1 /
 * yalnız-host). Bu sunucu SADECE o arayüzlere bağlanır — dış ağa açılmaz.
 *
 * KARAR VE SÜRÜCÜ KATMANLARI DEĞİŞMEZ: sunucu `~/vm-kapi/{gorev,sonuc,durum}`
 * dizinlerini HTTP'ye açar; `vm-kapi.js` ve `vm-kapi-karar.js` aynen çalışır.
 *
 * Kimlik: rastgele bir belirteç yol önekidir. Parola yok, hiçbir yerde sır taşınmaz.
 *
 * Uçlar (hepsi `/<belirtec>/` altında):
 *   GET  gorev              → sıradaki görev JSON'u (yoksa 204)
 *   POST kalp               → kalp atışı
 *   POST sonuc/<kimlik>     → sonuç JSON'u (atomik yazılır)
 *   POST ekran/<kimlik>     → PNG baytları
 *   GET  dosya/<ad>         → kurulum dosyasını indir
 */
// İşletim günlüğü STDOUT'a DEĞİL STDERR'e yazılır. Sebep ölçüldü (2026-09-20):
// `node --test` çocuk süreçle V8-serileştirilmiş mesajları FD 1 üzerinden konuşur;
// eşzamanlı bir HTTP işleyicisinden gelen `console.log` o akışın ortasına girip
// "Unable to deserialize cloned data" ile TÜM dosyayı düşürüyordu (3/3 koşuda).
// Operatör çıktısı terminalde aynen görünür; kanal temiz kalır.
function kayit(...p) { console.error(...p); }

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const KOK = process.env.EMPP_VM_KOK || path.join(os.homedir(), 'vm-kapi');
const PORT = Number(process.env.EMPP_VM_PORT || 8791);   // 3000 YASAK
const D = {
  gorev: path.join(KOK, 'gorev'),
  sonuc: path.join(KOK, 'sonuc'),
  durum: path.join(KOK, 'durum'),
};

// ÇOK MAKİNELİ KUYRUK (2026-09-20). Başta tek misafir vardı; artık VM + gerçek
// Windows makinesi (windows-kasa) + ileride Pardus aynı köprüye bağlanıyor. TEK
// kuyruk ve TEK kalp dosyası ile hangi makinenin ne yaptığı belirsizleşir ve
// görevi rastgele biri kapar — sessiz yanlış sonuç sınıfı. Bu yüzden her makine
// kendi kuyruğunu, kendi kalbini ve kendi sonuç dizinini kullanır.
//
// Yol: /<belirtec>/<makine>/<eylem>...   (eski /<belirtec>/<eylem> yolu, henüz
// güncellenmemiş izleyiciler kopmasın diye "vm" makinesine eşlenir.)
const VARSAYILAN_MAKINE = 'vm';
const MAKINE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
const EYLEMLER = new Set(['gorev', 'kalp', 'sonuc', 'ekran', 'dosya']);

/** Yolu makine + eylem + kalan parçalara ayırır. */
function yoluCoz(parcalar) {
  // parcalar: belirteçten SONRAKİ parçalar
  if (parcalar.length && EYLEMLER.has(parcalar[0])) {
    return { makine: VARSAYILAN_MAKINE, eylem: parcalar[0], kalan: parcalar.slice(1), eski: true };
  }
  if (parcalar.length >= 2 && MAKINE_RE.test(parcalar[0]) && EYLEMLER.has(parcalar[1])) {
    return { makine: parcalar[0], eylem: parcalar[1], kalan: parcalar.slice(2), eski: false };
  }
  return null;
}

/**
 * Bir makinenin dizinleri. `dosya` paylaşılır (kurulum dosyaları ortak).
 * VARSAYILAN makine ("vm") KÖK dizinleri kullanır: eski sürücü/izleyici ve
 * yazılmış görevler hiç dokunulmadan çalışmaya devam etsin. Yeni makineler alt
 * dizine iner. Yani geçiş kırılgan değil — tek makinelik kurulum aynen sürer.
 */
function makineDizinleri(makine) {
  if (makine === VARSAYILAN_MAKINE) {
    return { gorev: D.gorev, sonuc: D.sonuc, kalp: path.join(D.durum, 'kalp.txt') };
  }
  return {
    gorev: path.join(D.gorev, makine),
    sonuc: path.join(D.sonuc, makine),
    kalp: path.join(D.durum, `kalp-${makine}.txt`),
  };
}

/** VMware'in host tarafı adresleri — yalnız bunlara bağlanılır, 0.0.0.0'a ASLA. */
// Tailscale, 100.64.0.0/10 (CGNAT) bloğunu kullanır. Bu bloğa bağlanmak köprüyü
// TAILNET'e açar: gerçek bir Windows makinesi (ofisteki x64 tahta/PC) ya da uzaktaki
// Pardus makinesi izleyiciyi buraya bağlayabilir. Dışarıya (internete) açılmaz —
// tailnet üyeliği + 24 hex yol belirteci iki ayrı kapıdır.
function tailscaleAdresiMi(adres) {
  const p = String(adres).split('.').map(Number);
  return p.length === 4 && p[0] === 100 && p[1] >= 64 && p[1] <= 127;
}

/**
 * Bağlanılacak arayüzler. Varsayılan: VMware bridge* + Tailscale.
 * `EMPP_VM_ADRES` verilirse YALNIZ o adrese bağlanılır (ör. tek bir arayüzle
 * sınırlamak istendiğinde). 0.0.0.0 hiçbir koşulda kabul edilmez.
 */
function vmAdresleri(env = process.env, arayuzler = os.networkInterfaces()) {
  const zorunlu = (env.EMPP_VM_ADRES || '').trim();
  const bulunan = [];
  for (const [ad, liste] of Object.entries(arayuzler)) {
    for (const a of liste || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      const vmware = /^bridge\d+/.test(ad);
      const tailnet = tailscaleAdresiMi(a.address);
      if (!vmware && !tailnet) continue;
      bulunan.push({ ad: tailnet && !vmware ? `${ad} (tailscale)` : ad, adres: a.address });
    }
  }
  if (zorunlu) {
    if (zorunlu === '0.0.0.0') throw new Error('EMPP_VM_ADRES=0.0.0.0 kabul edilmez');
    return bulunan.filter((x) => x.adres === zorunlu);
  }
  return bulunan;
}

function belirtecAl() {
  fs.mkdirSync(D.durum, { recursive: true });
  const yol = path.join(D.durum, 'belirtec.txt');
  try {
    const v = fs.readFileSync(yol, 'utf8').trim();
    if (/^[a-f0-9]{16,}$/.test(v)) return v;
  } catch { /* yok — üret */ }
  const yeni = crypto.randomBytes(12).toString('hex');
  fs.writeFileSync(yol, yeni, { mode: 0o600 });
  return yeni;
}

/** Sıradaki görevi al ve dizinden KALDIR (ikinci kez dağıtılmasın). */
function siradakiGorev(dizin = D.gorev) {
  let adlar = [];
  try { adlar = fs.readdirSync(dizin).filter((f) => f.endsWith('.json')).sort(); } catch { return null; }
  if (!adlar.length) return null;
  const tam = path.join(dizin, adlar[0]);
  let govde;
  try { govde = JSON.parse(fs.readFileSync(tam, 'utf8')); } catch { fs.unlinkSync(tam); return null; }
  govde.kimlik = path.basename(adlar[0], '.json');
  fs.unlinkSync(tam);
  return govde;
}

function govdeTopla(istek, sinirBayt = 40 * 1024 * 1024) {
  return new Promise((coz, red) => {
    const parcalar = [];
    let boyut = 0;
    istek.on('data', (p) => {
      boyut += p.length;
      if (boyut > sinirBayt) { red(new Error('gövde çok büyük')); istek.destroy(); return; }
      parcalar.push(p);
    });
    istek.on('end', () => coz(Buffer.concat(parcalar)));
    istek.on('error', red);
  });
}

function atomikYaz(hedef, veri) {
  const gecici = `${hedef}.tmp`;
  fs.writeFileSync(gecici, veri);
  fs.renameSync(gecici, hedef);
}

function sunucuKur(belirtec) {
  return http.createServer(async (istek, yanit) => {
    try {
      const u = new URL(istek.url, 'http://yerel');
      const parca = u.pathname.split('/').filter(Boolean);
      if (parca[0] !== belirtec) { yanit.writeHead(404).end(); return; }
      const yol = yoluCoz(parca.slice(1));
      if (!yol) { yanit.writeHead(404).end(); return; }
      const { makine, eylem } = yol;
      for (const d of Object.values(D)) fs.mkdirSync(d, { recursive: true });
      const M = makineDizinleri(makine);
      fs.mkdirSync(M.gorev, { recursive: true });
      fs.mkdirSync(M.sonuc, { recursive: true });

      if (istek.method === 'GET' && eylem === 'gorev') {
        const g = siradakiGorev(M.gorev);
        if (!g) { yanit.writeHead(204).end(); return; }
        yanit.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(g));
        kayit(`→ [${makine}] görev verildi: ${g.kimlik} (${g.tur})`);
        return;
      }
      if (istek.method === 'POST' && eylem === 'kalp') {
        atomikYaz(M.kalp, new Date().toISOString());
        yanit.writeHead(204).end();
        return;
      }
      if (istek.method === 'POST' && eylem === 'sonuc' && yol.kalan[0]) {
        const govde = await govdeTopla(istek);
        atomikYaz(path.join(M.sonuc, `${path.basename(yol.kalan[0])}.json`), govde);
        yanit.writeHead(204).end();
        kayit(`← [${makine}] sonuç alındı: ${yol.kalan[0]}`);
        return;
      }
      if (istek.method === 'POST' && eylem === 'ekran' && yol.kalan[0]) {
        const govde = await govdeTopla(istek);
        atomikYaz(path.join(M.sonuc, `${path.basename(yol.kalan[0])}.png`), govde);
        yanit.writeHead(204).end();
        kayit(`← [${makine}] ekran alındı: ${yol.kalan[0]} (${(govde.length / 1024).toFixed(0)} KB)`);
        return;
      }
      if (istek.method === 'GET' && eylem === 'dosya' && yol.kalan[0]) {
        const ad = path.basename(decodeURIComponent(yol.kalan[0]));
        const tam = path.join(KOK, ad);
        if (!fs.existsSync(tam)) { yanit.writeHead(404).end(); return; }
        yanit.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': fs.statSync(tam).size,
        });
        fs.createReadStream(tam).pipe(yanit);
        kayit(`→ dosya veriliyor: ${ad}`);
        return;
      }
      yanit.writeHead(404).end();
    } catch (e) {
      try { yanit.writeHead(500).end(String(e.message)); } catch { /* yanıt kapandı */ }
    }
  });
}

async function ana() {
  const belirtec = belirtecAl();
  const adresler = vmAdresleri();
  if (!adresler.length) {
    kayit('VMware host arayüzü bulunamadı (bridge*). VM çalışıyor mu?');
    process.exit(3);
  }
  for (const { ad, adres } of adresler) {
    const s = sunucuKur(belirtec);
    await new Promise((coz) => s.listen(PORT, adres, coz));
    kayit(`dinleniyor: http://${adres}:${PORT}/  (${ad})`);
  }
  kayit('\nVM içinde çalıştır (tek satır, yönetici GEREKMEZ):');
  kayit(`powershell -ExecutionPolicy Bypass -File C:\\vm-kapi\\vm-izleyici.ps1 -Adres http://${adresler[0].adres}:${PORT} -Belirtec ${belirtec}\n`);
}

if (require.main === module) ana().catch((e) => { kayit('HATA:', e.message); process.exit(1); });
module.exports = {
  sunucuKur, belirtecAl, siradakiGorev, vmAdresleri, yoluCoz, makineDizinleri,
  KOK, D, PORT, VARSAYILAN_MAKINE,
};

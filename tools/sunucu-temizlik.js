#!/usr/bin/env node
'use strict';
/**
 * Sunucu artık toplayıcısı — cron'dan koşar.
 *   node tools/sunucu-temizlik.js            # KURU (hiçbir şey silmez, rapor verir)
 *   node tools/sunucu-temizlik.js --uygula   # gerçekten siler
 *   node tools/sunucu-temizlik.js --uygula --artefaktli-saat 72
 *
 * Aktif iş listesi: çalışan servisin /api/queue-status ucundan alınır. Uç cevap
 * vermezse HİÇBİR ŞEY SİLİNMEZ — "bilmiyorum" hâli silme gerekçesi değildir.
 */
const path = require('path');
const T = require('../src/services/paket-temizlik');

const argv = process.argv.slice(2);
const bayrak = (a) => argv.includes(a);
const deger = (a, v) => { const i = argv.indexOf(a); return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : v; };

const KURU = !bayrak('--uygula');
const KOK = process.env.EMPP_KOK || process.cwd();
const UC = process.env.EMPP_QUEUE_URL || 'http://127.0.0.1:3001/api/queue-status';

async function aktifIdler() {
  try {
    const r = await fetch(UC, { signal: AbortSignal.timeout(8000) });
    const tip = r.headers.get('content-type') || '';
    if (!r.ok || !tip.includes('application/json')) return null;   // HTML = yanlış uç
    const d = await r.json();
    const set = new Set();
    const topla = (liste) => (liste || []).forEach((j) => {
      if (j && j.jobId && j.status !== 'completed' && j.status !== 'failed') set.add(j.jobId);
      if (j && j.sessionId) set.add(j.sessionId);
    });
    topla(d.packagingJobs); topla(d.zipJobs); topla(d.jobs);
    return set;
  } catch (e) { return null; }
}

(async () => {
  // `--servissiz`: bu kök için ÇALIŞAN paketleyici servisi yok (ör. /opt/empp-packager).
  // AÇIK bayrak olmadan asla varsayılmaz — "uç cevap vermiyor" ile "servis yok" aynı şey
  // değildir; ilki geçici arıza olabilir ve o hâlde silmek işi öldürür.
  const servissiz = bayrak('--servissiz');
  const aktif = servissiz ? new Set() : await aktifIdler();
  if (aktif === null) {
    console.log('⛔ Kuyruk durumu okunamadı (' + UC + ') — GÜVENLİ TARAF: hiçbir şey silinmedi.');
    console.log('   Bu kök için servis GERÇEKTEN çalışmıyorsa --servissiz ile koş.');
    process.exit(3);
  }
  if (servissiz) console.log('⚠️  --servissiz: kuyruk sorulmadı, aktif iş YOK varsayıldı.');
  console.log(`🧭 Sunucu temizliği — kök: ${KOK} | mod: ${KURU ? 'KURU (silmez)' : 'UYGULA'} | aktif iş: ${aktif.size}`);
  const opts = {
    kuru: KURU,
    artefaktsizSaat: deger('--artefaktsiz-saat', T.ARTEFAKTSIZ_SAAT),
    artefaktliSaat: deger('--artefaktli-saat', T.ARTEFAKTLI_SAAT),
    log: (s) => console.log(s),
  };
  let top = 0; let adet = 0;
  for (const alt of ['temp', 'uploads']) {
    console.log(` ${alt}/`);
    const r = await T.uygula(path.join(KOK, alt), aktif, opts);
    top += r.bayt; adet += r.silinen;
  }
  console.log(`${KURU ? '🔎 [KURU] silinebilir' : '🧹 silindi'}: ${adet} girdi, ${(top / 1e6).toFixed(0)} MB`);
})();

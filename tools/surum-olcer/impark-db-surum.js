#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const SY = require('../set-yenile/set-yenile');
const SB = require('../set-yenile/sozlesme-bekcisi');

const ID_RE = /^[1-9]\d{0,9}$/;

// ─── SAF ─────────────────────────────────────────────────────────────────────────

function uyeKimlikleri(ayarMap) {
  const kimlikler = new Set();
  for (const a of ayarMap.values()) {
    for (const o of (a.ogeler || [])) {
      if (ID_RE.test(String(o.id))) kimlikler.add(String(o.id));
    }
  }
  return [...kimlikler];
}

function dbYorumla(satirlar) {
  let arr = [];
  try {
    arr = JSON.parse(satirlar);
  } catch (e) {
    throw new Error('Yayincilikadm JSON ayrıştırılamadı: ' + e.message);
  }
  const m = new Map();
  for (const row of arr) {
    if (row && typeof row === 'object' && row.KitapId && row.ZipVersiyon != null) {
      m.set(String(row.KitapId), Number(row.ZipVersiyon));
    }
  }
  return m;
}

function yazimPlani(ics, db) {
  const plan = [];
  const icsMap = new Map((ics || []).map(r => [String(r.impark_kitap_id), r]));
  for (const [kimlik, dbVs] of db.entries()) {
    const mev = icsMap.get(kimlik);
    if (!mev) {
      plan.push({ kimlik, eski: null, yeni: dbVs, tur: 'taban' });
    } else {
      const mevVs = Number(mev.vs);
      if (dbVs > mevVs) plan.push({ kimlik, eski: mevVs, yeni: dbVs, tur: 'artis' });
      else if (dbVs === mevVs) plan.push({ kimlik, eski: mevVs, yeni: dbVs, tur: 'esit' });
      else plan.push({ kimlik, eski: mevVs, yeni: dbVs, tur: 'geri' });
    }
  }
  return plan;
}

// ─── G/Ç ─────────────────────────────────────────────────────────────────────────

async function calistir(komut, argumanlar, secenekler = {}) {
  return new Promise((resolve) => {
    const cp = spawn(komut, argumanlar, { shell: false, ...secenekler });
    let stdout = ''; let stderr = '';
    if (cp.stdout) cp.stdout.on('data', (d) => { stdout += d.toString('utf8'); });
    if (cp.stderr) cp.stderr.on('data', (d) => { stderr += d.toString('utf8'); });
    cp.on('close', (kod) => resolve({ kod, stdout, stderr }));
    cp.on('error', (e) => resolve({ kod: 999, stdout: '', stderr: String(e) }));
  });
}

function argAyristir(argv) {
  const o = { uygula: false };
  for (const a of argv) {
    if (a === '--uygula') o.uygula = true;
  }
  return o;
}

async function ana(argv = process.argv.slice(2), d = SB.varsayilanBag(), cfg = SB.ayarlar()) {
  const o = argAyristir(argv);
  const ev = os.homedir();
  const dbCnf = '/root/.pipeline-db.cnf';
  const dbAdi = 'akillitahta';

  const ping = await d.calistir('ping', ['-c1', '-W2000', '172.17.2.21']);
  if (ping.kod !== 0) {
    console.log('vpn-yok');
    const rDir = path.join(ev, '.empp-agent', 'impark-db-surum');
    fs.mkdirSync(rDir, { recursive: true });
    fs.writeFileSync(path.join(rDir, 'son.json'), JSON.stringify({ vpnYok: true }));
    return 0;
  }

  const setler = SB.VARSAYILAN_SETLER;
  const srv = SY.srv21Istemci(cfg, d);
  const dbOkuma = setler.length ? {
    kitaplar: await srv.oku(SB.sql.kitaplar(setler)),
    platformlar: [], listeler: await srv.oku(SB.sql.listeler(setler)), buildler: []
  } : { kitaplar: [], platformlar: [], listeler: [], buildler: [] };

  const ayarMap = await SB.ayarOku(setler, dbOkuma, d, cfg);
  const kimlikler = uyeKimlikleri(ayarMap);
  
  if (kimlikler.length === 0) {
    console.log('kimlik yok');
    return 0;
  }

  const ics = await srv.oku('SELECT impark_kitap_id, vs, zip_url, origin, olculme, son_artis, son_sebep FROM impark_icerik_surumleri');

  const yayinCmd = '/Users/nadir/.local/bin/yayincilikadm';
  let tumSatirlar = [];
  const CHUNK = 500;
  for (let i = 0; i < kimlikler.length; i += CHUNK) {
    const parca = kimlikler.slice(i, i + CHUNK);
    const sql = `SELECT KitapId, ZipVersiyon FROM S_TestKitaplarZKitapAyar WHERE KitapId IN (${parca.join(',')})`;
    const r = await calistir(yayinCmd, ['sql', 'sorgu', sql, '--bicim', 'json'], { cwd: '/tmp' });
    if (r.kod !== 0) throw new Error(`yayincilikadm hata: ${r.stderr}`);
    if (r.stdout.trim()) {
      let parsed = [];
      try { parsed = JSON.parse(r.stdout); } catch(e) {}
      tumSatirlar = tumSatirlar.concat(parsed);
    }
  }

  const dbMap = dbYorumla(JSON.stringify(tumSatirlar));
  const plan = yazimPlani(ics, dbMap);

  const stats = { sorulan: kimlikler.length, esit: 0, artis: 0, taban: 0, geri: 0, 'impark\'ta-yok': 0 };
  const yazilacak = [];
  for (const p of plan) {
    stats[p.tur]++;
    if (p.tur === 'artis' || p.tur === 'taban') yazilacak.push(p);
  }
  stats['impark\'ta-yok'] = stats.sorulan - (stats.esit + stats.artis + stats.taban + stats.geri);

  const ozet = `sorulan: ${stats.sorulan}, eşit: ${stats.esit}, artış: ${stats.artis}, taban: ${stats.taban}, geri: ${stats.geri}, impark'ta-yok: ${stats['impark\'ta-yok']}`;

  if (!o.uygula) {
    console.log('[KURU KOSU] ' + ozet);
  } else {
    if (yazilacak.length > 0) {
      const stamp = SY.damga(d.simdi());
      const yedekDizin = `${cfg.yedekKoku}/${stamp}-impark-db`;
      const yedekDosya = `${yedekDizin}/once.sql`;
      const yedekKomut = `mkdir -p '${yedekDizin}' && mariadb-dump --defaults-extra-file=${dbCnf} --single-transaction ${dbAdi} impark_icerik_surumleri > '${yedekDosya}' && tail -n 1 '${yedekDosya}' && echo "INSERT_SAYISI=$(grep -c 'INSERT INTO' '${yedekDosya}')"`;
      
      await srv.yedek({ dosya: yedekDosya, komut: yedekKomut });
      
      const degerler = yazilacak.map(p => `('${p.kimlik}', ${p.yeni}, NOW(), 'db:taban')`).join(', ');
      const upsertSql = `INSERT INTO impark_icerik_surumleri (impark_kitap_id, vs, olculme, son_sebep) VALUES ${degerler} ON DUPLICATE KEY UPDATE son_artis=IF(VALUES(vs)>vs,NOW(),son_artis), son_sebep=IF(VALUES(vs)>vs,CONCAT('db:artis:',vs,'>',VALUES(vs)),son_sebep), olculme=NOW(), vs=GREATEST(vs,VALUES(vs));`;
      
      await srv.yaz(upsertSql);
    }
    console.log(ozet);
  }

  const rDir = path.join(ev, '.empp-agent', 'impark-db-surum');
  fs.mkdirSync(rDir, { recursive: true });
  fs.writeFileSync(path.join(rDir, 'son.json'), JSON.stringify(stats, null, 2));

  return 0;
}

module.exports = { uyeKimlikleri, dbYorumla, yazimPlani, argAyristir, ana };

if (require.main === module) {
  ana().then((kod) => { process.exitCode = kod; }, (e) => {
    console.error('HATA:', e);
    process.exitCode = 1;
  });
}

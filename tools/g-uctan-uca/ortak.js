'use strict';

/** G uçtan uca koşumunun ortak sabitleri ve ağaç yardımcıları. Saf + küçük I/O. */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SET_KIMLIGI = '99901';
const BASKA_SET = '99902';
const PANEL = 90;
const PAKET_SURUMU = '2.90.1';
const SON_SURUM = '2.90.3';
/** İstemcinin kendi durum dosyaları — ağaç kıyasında yok sayılır. */
const DURUM_DOSYALARI = ['.empp-set-guncelleme.json', '.empp-gecici'];

/**
 * `zorunlu`: true → her istemci (referans Windows dahil). 'yeni' (yalnız yeni G istemcileri
 * için zorunlu) 2026-09-26'da kalktı: referans istemci geri-alma/başka-set/kısmi-bozuk
 * açıklarını kapattı (g-electron dalı), artık HERKES için zorunlu.
 */
const SENARYOLAR = [
  {
    ad: 'gecerli',
    beklenen: 'guncellendi',
    zorunlu: true,
    not:
      '2.90.1 → 2.90.3 (2.90.2 atlanır): index v3, book1+book2 motor v2, book4 eklenir, ' +
      'book3 çıkar',
  },
  {
    ad: 'imza-bozuk',
    beklenen: 'degismez',
    zorunlu: true,
    not: 'manifest imzalandıktan sonra değişti',
  },
  { ad: 'imzasiz', beklenen: 'degismez', zorunlu: true, not: 'manifest.json.sig yok' },
  {
    ad: 'sha-uyusmaz',
    beklenen: 'degismez',
    zorunlu: true,
    not:
      'dosya/index.html manifestteki sha256 ile uyuşmuyor; eklenen/çıkarılan kitap ' +
      'geri alınmalı',
  },
  {
    ad: 'yol-kacisi',
    beklenen: 'degismez',
    zorunlu: true,
    not: 'imzalı manifestte ../kacis.txt kabuk yolu',
  },
  { ad: 'zip-kacisi', beklenen: 'degismez', zorunlu: true, not: 'book4 arşivinde ../../kacti.txt' },
  {
    ad: 'kismi-bozuk',
    beklenen: 'degismez',
    zorunlu: true,
    not: 'gecerli manifest, book2 motoru bozuk servis ediliyor: ya hep ya hiç (örtü atomik açılır)',
  },
  {
    ad: 'geri-alma',
    beklenen: 'degismez',
    zorunlu: true,
    not: 'geçerli imzalı ama 2.90.0 < paket 2.90.1',
  },
  {
    ad: 'baska-set',
    beklenen: 'degismez',
    zorunlu: true,
    not: 'geçerli imzalı ama setKimligi 99902 manifesti 99901 yolunda',
  },
  {
    ad: 'geri-alma-tetik',
    beklenen: 'degismez',
    zorunlu: true,
    not: 'geri-alma, ama imzasız surum.json 2.90.9 diyor (yalan tetik): ret İMZALI manifestten',
  },
  {
    ad: 'baska-set-tetik',
    beklenen: 'degismez',
    zorunlu: true,
    not: 'baska-set, ama surum.json 99901/2.90.9 diyor (yalan tetik): ret İMZALI manifestten',
  },
];

function sha256(veri) {
  return crypto.createHash('sha256').update(veri).digest('hex');
}

/** Ağacı `{göreliYol: sha256}` haritasına çevirir; `yoksay` kök adları atlanır. */
function agacOzeti(kok, yoksay = DURUM_DOSYALARI) {
  const k = path.resolve(kok);
  const atla = new Set(yoksay);
  const cikti = {};
  const yigin = [''];
  while (yigin.length) {
    const on = yigin.pop();
    let girdiler;
    try {
      girdiler = fs.readdirSync(on ? path.join(k, on) : k, { withFileTypes: true });
    } catch (e) {
      continue;
    }
    for (const g of girdiler) {
      const gor = on ? `${on}/${g.name}` : g.name;
      if (!on && atla.has(g.name)) continue;
      if (g.isDirectory()) yigin.push(gor);
      else if (g.isFile()) cikti[gor] = sha256(fs.readFileSync(path.join(k, gor)));
    }
  }
  return cikti;
}

/** İki özet haritasının farkı: {eksik, fazla, farkli}. */
function ozetFarki(beklenen, gercek) {
  const eksik = [];
  const fazla = [];
  const farkli = [];
  for (const [y, s] of Object.entries(beklenen)) {
    if (!(y in gercek)) eksik.push(y);
    else if (gercek[y] !== s) farkli.push(y);
  }
  for (const y of Object.keys(gercek)) if (!(y in beklenen)) fazla.push(y);
  return { eksik: eksik.sort(), fazla: fazla.sort(), farkli: farkli.sort() };
}

function farkBosMu(f) {
  return !f.eksik.length && !f.fazla.length && !f.farkli.length;
}

module.exports = {
  SET_KIMLIGI,
  BASKA_SET,
  PANEL,
  PAKET_SURUMU,
  SON_SURUM,
  DURUM_DOSYALARI,
  SENARYOLAR,
  sha256,
  agacOzeti,
  ozetFarki,
  farkBosMu,
};

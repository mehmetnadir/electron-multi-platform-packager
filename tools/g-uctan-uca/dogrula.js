#!/usr/bin/env node
'use strict';

/**
 * G UÇTAN UCA — bir istemcinin güncelleme SONRASI ağacını `beklenen.json` ile kıyaslar.
 *
 *   node tools/g-uctan-uca/dogrula.js <agac> [--dizin D] [--yalniz-g] [--degismez]
 *
 *   (varsayılan)  tam ağaç: gDosyalari + tabanDosyalari birebir, fazla dosya yok, olmamali yok
 *   --yalniz-g    örtü (O3) modeli: yalnız G'nin teslim ettiği dosyalar (gDosyalari) ağaçta ve
 *                 sha256'ları doğru; olmamali dizinleri ağaçta yok
 *   --degismez    olumsuz senaryo: ağaç kurulu paketle (beklenen.kurulu) birebir aynı
 *
 * İstemci durum dosyaları (`.empp-set-guncelleme.json`, `.empp-gecici`) yok sayılır.
 */

const fs = require('fs');
const path = require('path');
const o = require('./ortak');
const { VARSAYILAN_DIZIN } = require('./sunucu');

function beklenenOku(dizin) {
  const y = path.join(path.resolve(dizin), 'beklenen.json');
  try { return JSON.parse(fs.readFileSync(y, 'utf8')); } catch (e) {
    throw new Error(`beklenen.json okunamadı (${y}) — önce hazirla.js`);
  }
}

/**
 * @param {string} agac
 * @param {object} beklenen  beklenen.json
 * @param {'tam'|'yalniz-g'|'degismez'} kip
 * @returns {{gecti:boolean, eksik:string[], fazla:string[], farkli:string[], olmamaliVar:string[]}}
 */
function agaciDogrula(agac, beklenen, kip = 'tam') {
  const yoksay = Array.isArray(beklenen.yoksay) ? beklenen.yoksay : o.DURUM_DOSYALARI;
  const gercek = o.agacOzeti(agac, yoksay);
  let fark;
  if (kip === 'degismez') {
    fark = o.ozetFarki(beklenen.kurulu, gercek);
  } else if (kip === 'yalniz-g') {
    fark = o.ozetFarki(beklenen.gDosyalari, gercek);
    fark.fazla = [];
  } else {
    fark = o.ozetFarki({ ...beklenen.tabanDosyalari, ...beklenen.gDosyalari }, gercek);
  }
  const olmamaliVar = kip === 'degismez' ? []
    : (beklenen.olmamali || []).filter((d) => fs.existsSync(path.join(path.resolve(agac), d)));
  return { gecti: o.farkBosMu(fark) && !olmamaliVar.length, ...fark, olmamaliVar };
}

function main(argv) {
  let agac = null; let dizin = VARSAYILAN_DIZIN; let kip = 'tam';
  for (let i = 0; i < argv.length; i++) {
    const b = argv[i];
    if (b === '--dizin') dizin = argv[++i];
    else if (b === '--yalniz-g') kip = 'yalniz-g';
    else if (b === '--degismez') kip = 'degismez';
    else if (!b.startsWith('--') && !agac) agac = b;
    else throw new Error(`bilinmeyen argüman: ${b}`);
  }
  if (!agac) throw new Error('kullanım: dogrula.js <agac> [--dizin D] [--yalniz-g | --degismez]');
  const s = agaciDogrula(agac, beklenenOku(dizin), kip);
  if (s.gecti) { console.log(`GEÇTİ (${kip})`); return 0; }
  console.log(`KALDI (${kip})`);
  for (const [ad, l] of [['eksik', s.eksik], ['fazla', s.fazla], ['farklı', s.farkli], ['olmamalı ama var', s.olmamaliVar]]) {
    if (l.length) console.log(`  ${ad}: ${l.join(', ')}`);
  }
  return 1;
}

if (require.main === module) {
  try { process.exitCode = main(process.argv.slice(2)); } catch (e) { console.error('HATA: ' + e.message); process.exitCode = 2; }
}

module.exports = { beklenenOku, agaciDogrula };

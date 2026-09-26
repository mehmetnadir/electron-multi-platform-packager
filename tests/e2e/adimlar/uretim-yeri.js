'use strict';
/**
 * T2 — Pardus üretim yeri ProBook mu; Mac'e düştüyse SARI + "düşme: <neden>".
 * Salt okuma: build_agents'ta ProBook şerit ajanı (tools/probook/kaydol.js, `probook-serit`) +
 * pipeline pardus satırının kiracısı (leased_by_agent → build_agents.name) + canlı EMPP_PROBOOK_SERIT.
 * Not: leased_by_agent iş bitince boşalır ve pipeline_job_history'de ajan alanı yoktur — biten işin
 * üretim yeri ancak ProBook ajanı hiç kayıtlı değilse kesin bilinir (o zaman Mac'tir).
 */
const O = require('./ortak');
const K = require('./kesif');

const { DURUM } = O;

module.exports = {
  ad: 'uretim-yeri',
  testler: ['T2'],
  hazir: true,
  yazar: false,
  agir: false,
  olcut:
    "İş kaydında üretim yeri 'probook' (ProBook ajanı build_agents'ta kayıtlı, pardus işini o kiralar); " +
    "Mac'e düştüyse SARI ve rapora 'düşme: <neden>'",
  bekliyor: null,
  async kos(b) {
    const pb = (b.kesif && b.kesif.probook) || { durum: 'olculemedi', sebep: 'keşif yok' };
    const d = b.kapilar && !b.kapilar.hata ? b.kapilar.degerler : null;
    const not = d ? `canlı EMPP_PROBOOK_SERIT=${d.EMPP_PROBOOK_SERIT || '-'}` : null;
    const satir = (durum, olcum) =>
      O.sonuc(b.test, this.ad, durum, { olcum: { ...olcum, probook: pb.durum, not } });
    const yok = K.satirYokSebebi(b.kesif, 'pardus');
    if (yok) {
      const ek = pb.durum === 'kayitli' ? '' : ` · ${pb.sebep}`;
      return [satir(DURUM.OLCULEMEDI, { sebep: `${yok}${ek}` })];
    }
    const s = K.platformSatiri(b.kesif, 'pardus');
    const temel = { status: s.status, ajan: s.ajan, last_run_at: s.last_run_at };
    if (pb.durum === 'olculemedi')
      return [satir(DURUM.OLCULEMEDI, { ...temel, sebep: `build_agents okunamadı: ${pb.sebep}` })];
    if (pb.durum === 'kayitsiz') {
      return [
        satir(DURUM.SARI, {
          ...temel,
          sebep: `düşme: ${pb.sebep} — pardus Mac docker şeridinde üretiliyor`,
        }),
      ];
    }
    const adlar = new Set(pb.ajanlar.map((a) => a.name));
    if (s.ajan && adlar.has(s.ajan))
      return [satir(DURUM.GECTI, { ...temel, ayrinti: `iş ProBook ajanında (${s.ajan})` })];
    if (s.ajan)
      return [satir(DURUM.SARI, { ...temel, sebep: `düşme: pardus işini ${s.ajan} kiraladı` })];
    return [
      satir(DURUM.OLCULEMEDI, {
        ...temel,
        sebep:
          `üretim yeri kaydı yok: satır ${s.status}, kira boş (leased_by_agent iş bitince ` +
          "boşalır; pipeline_job_history'de ajan alanı yok)",
      }),
    ];
  },
};

'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { hataOzeti } = require('./hata-ozeti');

// KÖK NEDEN (2026-09-26): agent.log'daki "job failed" özet satırı BAŞTAN 200
// karaktere kırpılıyordu; kabul kapısı hatalarında asıl sebep ("[kabul] RED: …")
// mesajın SONUNDA olduğu için kayboluyordu. MUTASYON: `hataOzeti`'yi
// `String(m).slice(0, 200)` yapınca bu dosyadaki kök-neden testleri kırılır.

test('uzun çok satırlı hata: son anlamlı satır (RED:) öne alınır, toplam ≤ 600', () => {
  const mesaj = `windows paketi başsız kabul kapısından geçemedi (RED) — R2'ye YÜKLENMEDİ: ${'A'.repeat(500)}\n`
    + '[kabul] SONUÇ: RED (12 sn) — kanıt: /tmp/kanit/altdizin\n'
    + '[kabul] imza: RED: notarization reddedildi, stapler doğrulaması başarısız\n'
    + '[kabul] çalışma dizini korundu';
  assert.ok(mesaj.length > 600);
  const ozet = hataOzeti(mesaj);
  assert.ok(ozet.startsWith('[kabul] imza: RED: notarization reddedildi'), ozet);
  assert.ok(ozet.length <= 600, `tavan aşıldı: ${ozet.length}`);
  assert.ok(!ozet.includes('\n'), 'özet tek satır olmalı');
  assert.ok(ozet.includes('windows paketi başsız kabul kapısından geçemedi'), 'baş bağlamı kayboldu');
  assert.ok(ozet.endsWith('…'), 'kırpma işareti yok');
});

test('kısa hata: aynen döner', () => {
  const kisa = 'artifact download failed: curl exit 22 (404)';
  assert.strictEqual(hataOzeti(kisa), kisa);
});

test('boş / null / undefined / yalnız boşluk: "bilinmeyen hata"', () => {
  for (const g of ['', null, undefined, '  \n\t ']) {
    assert.strictEqual(hataOzeti(g), 'bilinmeyen hata', JSON.stringify(g));
  }
});

test('gerçek agent.log örneği (11845 pardus, 26.09): "RED:" sebebi kesilmez', () => {
  // agent.log satır 41324: "job failed: 11845 pardus - … | [kabul] RED: pencere ac…"
  // (200'de kesik). Tam mesaj = runner.js kabul throw'u + agent.log'daki son 2 kabul satırı.
  const mesaj = 'pardus paketi ProBook kabul kapısından geçemedi (rc=1): '
    + "[kabul] olcum 4/4: surec=1 pencere=1366x671 sapma=0.0185588 koyu=0.000411309 renk=32 baslik='Akıllı Tahta Uygulaması'"
    + ' | [kabul] RED: pencere acildi ama ICERIK YOK (sapma=0.0185588 koyu=0.000411309 renk=32)'
    + ' — beyaz/yukleniyor ekrani, kanit: /var/folders/c6/mm4dn0l11p5ccfj_qjwzd0vm0000gn/T/'
    + 'empp-agent-YMwduv/pardus-out/probook-kabul/ekran.png';
  const ozet = hataOzeti(mesaj);
  assert.ok(ozet.includes('RED: pencere acildi ama ICERIK YOK'), ozet);
  assert.ok(ozet.length <= 600);
});

test('BAYAT / HATA / Error işaretleri de kök satırı sayılır', () => {
  for (const kok of ['kaynak arşivi BAYAT: kayıtlı v49 → güncel v50', 'odak: HATA: kapı öne geçti',
    'Error: ENOSPC no space left on device']) {
    const ozet = hataOzeti(`${'B'.repeat(700)}\n${kok}\nson bilgi satırı`);
    assert.ok(ozet.startsWith(kok), ozet);
    assert.ok(ozet.length <= 600);
  }
});

test('işaret yoksa baştan kırpılır; hiçbir uzunlukta tavan aşılmaz', () => {
  const koksuz = hataOzeti('sıradan uzun açıklama, '.repeat(60));
  assert.strictEqual(koksuz.length, 600);
  assert.ok(koksuz.endsWith('…'));
  for (const n of [0, 1, 50, 570, 578, 599, 600, 601, 900]) {
    const ozet = hataOzeti(`${'C'.repeat(700)} | RED: ${'k'.repeat(n)}`);
    assert.ok(ozet.length <= 600, `n=${n} uzunluk=${ozet.length}`);
    assert.ok(ozet.startsWith('RED: '), `n=${n}: ${ozet.slice(0, 30)}`);
  }
});

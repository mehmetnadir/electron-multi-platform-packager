'use strict';
/**
 * Başsız kabul kapısı — runner bağlantısı testleri.
 * Kapı kapalıyken davranış birebir eski olmalı; RED alan paket yüklenmemeli; ÖLÇÜLEMEDİ
 * paket kusuru sayılmamalı (ertelenebilir). runner.js'te kapı YÜKLEMEDEN ÖNCE çağrılmalı.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const K = require('./basliksiz-kabul-kapisi');
const { ertelenebilirKaynakHatasi, BASLIKSIZ_KABUL_ISARETI } = require('./runner-helpers');

const temel = {
  artifactPath: '/tmp/artifact.dmg', platform: 'macos', bookId: 73768, calismaDizini: '/tmp/empp-agent-x',
};

function sahte(sonuc) {
  const cagrilar = [];
  const calistir = async (argumanlar, secenek) => {
    cagrilar.push({ argumanlar, secenek });
    return sonuc;
  };
  return { calistir, cagrilar };
}

test('bayrak kapalıyken (varsayılan) kapı HİÇ koşmaz', async () => {
  const s = sahte({ kod: 1, cikti: '' });
  const r = await K.basliksizKabulKapisi({ ...temel, env: {}, calistir: s.calistir });
  assert.deepEqual(r, { atlandi: true });
  assert.equal(s.cagrilar.length, 0);
});

test('bayrak açık ama platform listede değilse koşmaz', async () => {
  const s = sahte({ kod: 1, cikti: '' });
  const env = { EMPP_BASLIKSIZ_KABUL: '1', EMPP_BASLIKSIZ_KABUL_PLATFORMLAR: 'android' };
  const r = await K.basliksizKabulKapisi({ ...temel, env, calistir: s.calistir });
  assert.equal(r.atlandi, true);
  assert.equal(s.cagrilar.length, 0);
});

test('kapiEtkinMi: varsayılan liste dört platformu kapsar', () => {
  const env = { EMPP_BASLIKSIZ_KABUL: '1' };
  for (const p of ['macos', 'android', 'windows', 'pardus']) assert.equal(K.kapiEtkinMi(p, env), true, p);
  assert.equal(K.kapiEtkinMi('pwa', env), false);
  assert.equal(K.kapiEtkinMi('macos', { EMPP_BASLIKSIZ_KABUL: '0' }), false);
});

test('GEÇTİ (rc 0) → yükleme sürer', async () => {
  const s = sahte({ kod: 0, cikti: '[kabul] SONUÇ: GEÇTİ (27 sn)' });
  const r = await K.basliksizKabulKapisi({ ...temel, env: { EMPP_BASLIKSIZ_KABUL: '1' }, calistir: s.calistir });
  assert.equal(r.durum, 'GECTI');
  assert.equal(s.cagrilar.length, 1);
});

test('RED (rc 1) → hata fırlatır, ertelenebilir DEĞİL (gerçek paket kusuru)', async () => {
  const s = sahte({ kod: 1, cikti: '[kabul] SONUÇ: RED (75 sn)\n[kabul]   - icerik: menü kartı 0 ≠ beklenen 3' });
  await assert.rejects(
    K.basliksizKabulKapisi({ ...temel, env: { EMPP_BASLIKSIZ_KABUL: '1' }, calistir: s.calistir }),
    (e) => {
      assert.match(e.message, /RED/);
      assert.match(e.message, /YÜKLENMEDİ/);
      assert.match(e.message, /menü kartı 0/);
      assert.equal(ertelenebilirKaynakHatasi(e), false);
      return true;
    },
  );
});

test('ÖLÇÜLEMEDİ (rc 3) / zaman aşımı / başlatılamadı → hata, ama ertelenebilir işaretli', async () => {
  for (const sonuc of [{ kod: 3, cikti: 'SONUÇ: ÖLÇÜLEMEDİ' }, { kod: null, zamanAsimi: true, cikti: '' },
    { kod: -1, hata: 'ENOENT', cikti: '' }, { kod: 2, cikti: 'Kullanım' }]) {
    const s = sahte(sonuc);
    await assert.rejects(
      K.basliksizKabulKapisi({
        ...temel, env: { EMPP_BASLIKSIZ_KABUL: '1' }, calistir: s.calistir, calismaDizini: '/tmp/yok-empp-kapi-test',
      }),
      (e) => {
        assert.ok(e.message.includes(BASLIKSIZ_KABUL_ISARETI), e.message);
        assert.equal(ertelenebilirKaynakHatasi(e), true);
        return true;
      },
    );
  }
});

test('argümanlar: platform, kitap id, çalışma dizini işin içinde, --tut; aktivasyon ve cihaz bayrakları', () => {
  const a = K.kapiArgumanlari({ ...temel, calismaDizini: '/w/basliksiz-kabul', aktivasyon: true, env: {} });
  assert.equal(a[0], K.CLI);
  assert.deepEqual(a.slice(1, 7), ['/tmp/artifact.dmg', '--platform', 'macos', '--calisma', '/w/basliksiz-kabul', '--tut']);
  assert.ok(a.includes('--aktivasyon'));
  assert.deepEqual(a.slice(a.indexOf('--kitap-id'), a.indexOf('--kitap-id') + 2), ['--kitap-id', '73768']);
  const b = K.kapiArgumanlari({ ...temel, platform: 'android', calismaDizini: '/w', env: { EMPP_BASLIKSIZ_KABUL_CIHAZ: '0' } });
  assert.ok(b.includes('--cihaz-yok'));
  const c = K.kapiArgumanlari({ ...temel, platform: 'android', calismaDizini: '/w', env: {} });
  assert.ok(!c.includes('--cihaz-yok'));
  assert.ok(fs.existsSync(K.CLI), 'CLI yolu gerçek dosyayı göstermeli');
});

test('runner.js: kapı imzadan SONRA, R2 yüklemesinden ÖNCE çağrılır (sentinel)', () => {
  const kaynak = fs.readFileSync(path.join(__dirname, 'runner.js'), 'utf8');
  const govde = kaynak.slice(kaynak.indexOf('async function processJob('));
  const imza = govde.indexOf('await signAndNotarizeMac(artifactPath)');
  const kapi = govde.indexOf('await basliksizKabul(artifactPath, packagerPlatform, job, work)');
  const yukle = govde.indexOf('await postResultSuccess(auth, job, yayinYolu)');
  assert.ok(imza > 0 && kapi > 0 && yukle > 0, 'üç çağrı da processJob içinde olmalı');
  assert.ok(imza < kapi, 'kapı imzadan SONRA (noter/zımba denetimi imzalı paketi görmeli)');
  assert.ok(kapi < yukle, 'kapı yüklemeden ÖNCE (RED alan paket R2\'ye gitmemeli)');
  assert.match(kaynak, /require\('\.\/basliksiz-kabul-kapisi'\)/);
});

test('sonucYorumla: son satırlardan sebep derler', () => {
  const k = K.sonucYorumla({ kod: 1, cikti: 'x\n[kabul] SONUÇ: RED (5 sn)\n[kabul]   - a\n[kabul]   - b' }, 60000);
  assert.equal(k.durum, 'RED');
  assert.match(k.sebep, /SONUÇ: RED.*- a.*- b/);
});

test('kapiArgumanlari: cli varsayılanı tools/kabul CLI; yalnız verilince ezilir (Windows şeridi testleri)', () => {
  assert.equal(K.kapiArgumanlari({ ...temel, env: {} })[0], K.CLI);
  assert.equal(K.kapiArgumanlari({ ...temel, env: {}, cli: '/sahte/kabul.js' })[0], '/sahte/kabul.js');
});

// --- K4 güncellik (KABUL_K4=1; CLI ProBook sözlüğüyle çıkar: 3 GÜNCEL-DEĞİL · 4 ÖLÇÜLEMEDİ) ---------

test('K4: rc 3 + "GUNCEL-DEGIL:" satırı → "güncel değil:" hatası, YÜKLEME YOK, ertelenebilir DEĞİL (Pardus K18 rc 3 ile aynı)', async () => {
  const cikti = '[kabul] K4 güncellik: GÜNCEL-DEĞİL (kod 3) — E7 44187 v33 < İmpark v36\n'
    + '[kabul] SONUÇ: GÜNCEL-DEĞİL (80 sn) — kanıt: /k\n'
    + '[kabul] GUNCEL-DEGIL: E7 44187 v33 < İmpark v36 (Data=https://cdn.x/ZKitapZipH/44187-36.zip)\n'
    + '[kabul] yeniden kuyruk onerisi: kaynak S1 ile yenilenmeli (ZKitapZipH/44187-36.zip)\n';
  const s = sahte({ kod: 3, cikti });
  await assert.rejects(
    K.basliksizKabulKapisi({ ...temel, env: { EMPP_BASLIKSIZ_KABUL: '1', KABUL_K4: '1' }, calistir: s.calistir }),
    (e) => {
      assert.match(e.message, /^güncel değil: E7 44187 v33 < İmpark v36/);
      assert.match(e.message, /yeniden kuyruk önerisi: kaynak S1 ile yenilenmeli \(ZKitapZipH\/44187-36\.zip\)/);
      assert.equal(ertelenebilirKaynakHatasi(e), false, 'güncel değil → failed yazılmalı (ertelenmez)');
      return true;
    },
  );
});

test('K4: rc 4 → ÖLÇÜLEMEDİ (ertelenebilir); işaretsiz rc 3 eski sözlükte ÖLÇÜLEMEDİ kalır', async () => {
  for (const sonuc of [{ kod: 4, cikti: '[kabul] SONUÇ: ÖLÇÜLEMEDİ' }, { kod: 3, cikti: '[kabul] SONUÇ: ÖLÇÜLEMEDİ' }]) {
    const s = sahte(sonuc);
    await assert.rejects(
      K.basliksizKabulKapisi({
        ...temel, env: { EMPP_BASLIKSIZ_KABUL: '1' }, calistir: s.calistir, calismaDizini: '/tmp/yok-empp-kapi-test',
      }),
      (e) => {
        assert.ok(e.message.includes(BASLIKSIZ_KABUL_ISARETI), e.message);
        assert.doesNotMatch(e.message, /^güncel değil/);
        return true;
      },
    );
  }
  assert.equal(K.sonucYorumla({ kod: 3, cikti: 'GUNCEL-DEGIL: x' }, 1000).durum, 'GUNCEL_DEGIL');
  assert.equal(K.guncelDegilIsaretliMi('[kabul]   - k4: GUNCEL-DEGIL: x'), false, 'sebep satırı içindeki dizge işaret sayılmaz');
});

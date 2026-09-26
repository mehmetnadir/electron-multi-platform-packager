'use strict';
/**
 * T4 — K (İmpark kitap içerik güncellemesi). Üç satır, hepsi SALT OKUMA (kuru koşuda da koşar):
 *   kapi       canlı ajanın K kapısı (run-agent.sh EMPP_ICERIK_GUNCELLEME) windows + macos içeriyor mu
 *   uygula     İmpark'taki güncel içerik arşivi (GetKitapGuncellemeBilgi → ZKitapZipH/<id>-<Vs>.zip)
 *              GERÇEK istemci koduyla uygulanır: tools/kabul/icerik-guncelleme-kabul.js →
 *              src/runtime/icerik-guncelleme.js (adm-zip sarmalayıcı + doğrulama + menü süzgeci);
 *              menü v<Vs-1> → v<Vs> ilerler, BookContent.xml + sayfalar diskte. Geçici dizinde açılır.
 *   bozuk-zip  mutasyon: BookContent.xml'siz kopya → menü İLERLEMEMELİ (sahte "güncellendi" yakalanır)
 * İmpark'a yazan tetik (`yayincilikadm book e2e-guncelle`) t5-tetik adımındadır; burası İmpark'taki
 * güncel içeriğin istemcide gerçekten uygulandığını ölçer.
 */
const fs = require('fs');
const path = require('path');
const O = require('./ortak');
const K = require('./kesif');
const I = require('./impark');
const { indir: varsayilanIndir } = require('./okuyucu');

const { DURUM } = O;
const ARAC = path.join(__dirname, '..', '..', '..', 'tools', 'kabul', 'icerik-guncelleme-kabul.js');
const TAVAN = 50 * 1024 * 1024;
const RC_DURUM = { 0: DURUM.GECTI, 1: DURUM.KALDI, 3: DURUM.OLCULEMEDI };

/** Aracın stdout'undan karar + sürüm satırı. Saf. */
function aracCiktisi(stdout) {
  const s = String(stdout || '');
  const sonuc = /\[k-kabul\] SONUÇ: (GECTI|RED|OLCULEMEDI)(?: — (.*?))?(?: \(kanıt: .*\))?$/m.exec(
    s,
  );
  const surum = /\[k-kabul\] sürüm: (.*)$/m.exec(s);
  return {
    sonuc: sonuc ? sonuc[1] : null,
    sebep: sonuc && sonuc[2] ? sonuc[2] : '',
    ozet: surum ? surum[1].trim() : '',
  };
}

function varsayilanCalistir(argv) {
  const r = O.calistir(process.execPath, [ARAC, ...argv], { timeout: 110000 });
  return { rc: r.status, stdout: r.stdout || '', stderr: r.stderr || '', hata: r.error };
}

/** rc + çıktı → satır durumu. Bağımlılık eksikliği (adm-zip) KALDI değil ÖLÇÜLEMEDİ'dir. Saf. */
function aracYorumla(r, { bozuk = false } = {}) {
  const c = aracCiktisi(r.stdout);
  if (r.hata)
    return { durum: DURUM.OLCULEMEDI, sebep: `araç çalışmadı: ${r.hata.code || r.hata.message}` };
  if (/Cannot find module '([^']+)'/.test(r.stderr))
    return {
      durum: DURUM.OLCULEMEDI,
      sebep: `araç bağımlılığı yok: ${/Cannot find module '([^']+)'/.exec(r.stderr)[1]} (npm i)`,
    };
  if (!c.sonuc)
    return {
      durum: DURUM.OLCULEMEDI,
      sebep: `araç sonuç satırı vermedi (rc=${r.rc}): ${String(r.stderr).slice(-160)}`,
    };
  const durum = RC_DURUM[r.rc] || DURUM.OLCULEMEDI;
  if (bozuk) {
    return durum === DURUM.GECTI
      ? { durum, ayrinti: `bozuk arşiv reddedildi, menü ilerlemedi (${c.ozet})` }
      : { durum, sebep: `mutasyon yakalanmadı: ${c.sebep || c.sonuc} (${c.ozet})` };
  }
  return durum === DURUM.GECTI
    ? { durum, ayrinti: c.ozet }
    : { durum, sebep: `${c.sebep || c.sonuc} (${c.ozet})` };
}

module.exports = {
  ad: 'k-icerik',
  testler: ['T4'],
  hazir: true,
  yazar: false,
  agir: false,
  aracCiktisi,
  aracYorumla,
  olcut:
    "canlı K kapısı windows+macos · İmpark'taki güncel ZKitapZipH/<id>-<Vs>.zip gerçek istemci koduyla " +
    'uygulanır (menü v<Vs-1>→v<Vs>, BookContent + sayfalar diskte) · bozuk arşiv mutasyonu RED',
  bekliyor: null,
  async kos(b) {
    const s = (alt, r, ek = {}) =>
      O.sonuc(b.test, `${this.ad}/${alt}`, r.durum, {
        ...(ek.komut ? { komut: ek.komut } : {}),
        olcum: {
          ...ek.olcum,
          ...(r.sebep ? { sebep: r.sebep } : {}),
          ...(r.ayrinti ? { ayrinti: r.ayrinti } : {}),
        },
      });
    const cikti = [];
    // 1) canlı K kapısı
    const kp = b.kapilar;
    if (!kp || kp.hata) {
      cikti.push(
        s('kapi', {
          durum: DURUM.OLCULEMEDI,
          sebep: `canlı ajan ortamı okunamadı: ${kp ? kp.hata : 'yok'}`,
        }),
      );
    } else {
      const v = kp.degerler.EMPP_ICERIK_GUNCELLEME || '';
      const eksik = ['windows', 'macos'].filter((p) => !K.listede(v, p));
      cikti.push(
        s(
          'kapi',
          eksik.length
            ? {
                durum: DURUM.KALDI,
                sebep: `K kapısı ${eksik.join('+')} için KAPALI (EMPP_ICERIK_GUNCELLEME=${v || '-'})`,
              }
            : { durum: DURUM.GECTI, ayrinti: `EMPP_ICERIK_GUNCELLEME=${v}` },
          { olcum: { dosya: kp.dosya } },
        ),
      );
    }
    // 2-3) gerçek içerik arşivi + mutasyon
    const ikisi = (r, ek) => [s('uygula', r, ek), s('bozuk-zip', r, ek)];
    if (b.ag === false && !b.istek) {
      cikti.push(...ikisi({ durum: DURUM.OLCULEMEDI, sebep: 'ağ ölçümü kapalı (EMPP_E2E_AG=0)' }));
      return cikti;
    }
    const bilgi = await I.onbellekli(b);
    if (bilgi.durum !== 'tamam') {
      cikti.push(
        ...ikisi({ durum: DURUM.OLCULEMEDI, sebep: bilgi.sebep }, { olcum: { uc: bilgi.uc } }),
      );
      return cikti;
    }
    const olcum = { vs: bilgi.vs, arsiv: bilgi.data, boyut: bilgi.boyut };
    if (bilgi.boyut != null && bilgi.boyut > TAVAN) {
      cikti.push(
        ...ikisi(
          { durum: DURUM.OLCULEMEDI, sebep: `arşiv ${bilgi.boyut} B > ${TAVAN} B tavanı` },
          { olcum },
        ),
      );
      return cikti;
    }
    const dizin = path.join(b.calisma || O.calismaDizini(), 'k-icerik');
    fs.mkdirSync(dizin, { recursive: true });
    const zip = path.join(dizin, `${b.kitap}-${bilgi.vs}.zip`);
    try {
      const var_ =
        fs.existsSync(zip) && (bilgi.boyut == null || fs.statSync(zip).size === bilgi.boyut);
      if (!var_) await (b.indir || varsayilanIndir)(bilgi.data, zip, { zamanAsimiMs: 60000 });
    } catch (e) {
      cikti.push(
        ...ikisi({ durum: DURUM.OLCULEMEDI, sebep: `arşiv indirilemedi: ${e.message}` }, { olcum }),
      );
      return cikti;
    }
    const calistir = b.kAraci || varsayilanCalistir;
    const temel = [
      zip,
      '--kitap-id',
      b.kitap,
      '--yeni-surum',
      String(bilgi.vs),
      '--eski-surum',
      String(Math.max(0, bilgi.vs - 1)),
    ];
    const komut = `node tools/kabul/icerik-guncelleme-kabul.js ${temel.join(' ')}`;
    cikti.push(s('uygula', aracYorumla(calistir(temel)), { komut, olcum }));
    cikti.push(
      s('bozuk-zip', aracYorumla(calistir([...temel, '--bozuk']), { bozuk: true }), {
        komut: `${komut} --bozuk`,
        olcum,
      }),
    );
    return cikti;
  },
};

#!/usr/bin/env node
'use strict';
/**
 * Sessiz pencere gözcüsü — paketleyici kuyruğu (varsayılan: 127.0.0.1:3001
 * /api/queue-statistics) GERÇEKTEN boşaldığında haber verir.
 *
 * HİÇBİR ŞEYİ KENDİ BAŞINA YAPMAZ: süreç öldürmez, süreç başlatmaz, dosya
 * silmez. Sadece stdout'a yazar ve (varsa) `bildir` komutuyla telefona push
 * atar. Ne yapılması gerektiğini SÖYLER, yapmaz — kaçak paketleyici sürecinin
 * (127.0.0.1:3001) temiz kopyayla değiştirilmesi kararı ve icrası daima
 * insana aittir.
 *
 * Kullanım:
 *   node tools/sessiz-pencere-gozcusu.js                        # sürekli, 60 sn'de bir
 *   node tools/sessiz-pencere-gozcusu.js --aralik 30            # 30 sn'de bir ölç
 *   node tools/sessiz-pencere-gozcusu.js --gerekli 5            # 5 ardışık sakin ölçüm iste
 *   node tools/sessiz-pencere-gozcusu.js --job-id d4100a93-...  # bildirimde jobId anılsın
 *   node tools/sessiz-pencere-gozcusu.js --bir-kez              # TEK ölçüm, sonra çık
 *
 * --bir-kez çıkış kodu: 0 = bu tek ölçüm sakin (pencere bu ana kadar açılabilir
 * durumda), 1 = değil (meşgul ya da uç cevap vermedi). Tek ölçümde "ardışık N"
 * güvence mekanizması anlamsızdır (tanım gereği tek örnek var) — bu yüzden
 * --bir-kez modunda ardışık gereksinimi her zaman 1'dir; sürekli moddaki asıl
 * güvence (--gerekli, varsayılan 3) yalnız döngü modunda uygulanır.
 *
 * Ortam değişkeni EMPP_QUEUE_URL ile uç adresi değiştirilebilir (varsayılan
 * http://127.0.0.1:3001/api/queue-statistics).
 */

const { execFile } = require('node:child_process');
const { mesgulMu, pencereAcikMi, durumOzeti } = require('../src/server/sessiz-pencere');

const VARSAYILAN_URL = process.env.EMPP_QUEUE_URL || 'http://127.0.0.1:3001/api/queue-statistics';
const VARSAYILAN_ARALIK_SN = 60;
const VARSAYILAN_GEREKLI = 3;
const ISTEK_ZAMAN_ASIMI_MS = 5000;
const ART_ARDA_HATA_UYARI_ESIGI = 10;

// ---------------------------------------------------------------------------
// Argüman ayrıştırma (saf — İ/O yok, test edilebilir)
// ---------------------------------------------------------------------------
function argvAyristir(argv) {
  const secenekler = {
    aralikSn: VARSAYILAN_ARALIK_SN,
    gerekli: VARSAYILAN_GEREKLI,
    birKez: false,
    jobId: null,
    url: VARSAYILAN_URL,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--aralik') {
      const v = Number(argv[i + 1]);
      if (Number.isFinite(v) && v > 0) secenekler.aralikSn = v;
      i++;
    } else if (a === '--gerekli') {
      const v = Number(argv[i + 1]);
      if (Number.isFinite(v) && v > 0) secenekler.gerekli = v;
      i++;
    } else if (a === '--bir-kez') {
      secenekler.birKez = true;
    } else if (a === '--job-id') {
      secenekler.jobId = argv[i + 1] || null;
      i++;
    } else if (a === '--url') {
      if (argv[i + 1]) secenekler.url = argv[i + 1];
      i++;
    }
  }

  return secenekler;
}

// ---------------------------------------------------------------------------
// Ağ çağrısı — enjekte edilebilir (testler gerçek HTTP'ye gitmez)
// ---------------------------------------------------------------------------
async function istatistikGetirVarsayilan(url, zamanAsimiMs) {
  try {
    const cevap = await fetch(url, { signal: AbortSignal.timeout(zamanAsimiMs) });
    const govde = await cevap.text();
    if (!cevap.ok) {
      return { hata: true, sebep: `HTTP ${cevap.status}` };
    }
    return { hata: false, veri: govde };
  } catch (hata) {
    return { hata: true, sebep: (hata && hata.message) ? hata.message : String(hata) };
  }
}

// ---------------------------------------------------------------------------
// `bildir` ile telefona push — enjekte edilebilir, `bildir` yoksa SESSİZCE atlar
// ---------------------------------------------------------------------------
function bildirimGonderVarsayilan(mesaj, baslik) {
  return new Promise((resolve) => {
    execFile('command', ['-v', 'bildir'], { shell: '/bin/bash' }, (hataYokMu) => {
      if (hataYokMu) {
        resolve({ gonderildi: false, sebep: 'bildir komutu bulunamadı' });
        return;
      }
      execFile('bildir', ['kosucu', mesaj, '-b', baslik, '-p', 'yuksek'], (hata) => {
        if (hata) {
          resolve({ gonderildi: false, sebep: hata.message });
        } else {
          resolve({ gonderildi: true });
        }
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Tek bir ölçüm: uçtan veri al, karar modülüyle değerlendir. AĞ hatası da
// "meşgul" sayılır (şüphede meşgul say — spec).
// ---------------------------------------------------------------------------
async function birOlcumYap({ url, zamanAsimiMs, istatistikGetir }) {
  const sonuc = await istatistikGetir(url, zamanAsimiMs);

  if (sonuc.hata) {
    return {
      hataliOlcum: true,
      sebep: sonuc.sebep,
      meşgul: true,
      ozet: `uç cevap vermedi (${sonuc.sebep}) → meşgul say`,
    };
  }

  return {
    hataliOlcum: false,
    meşgul: mesgulMu(sonuc.veri),
    ozet: durumOzeti(sonuc.veri),
  };
}

function jobEtiketi(jobId) {
  return jobId ? ` (jobId: ${jobId})` : '';
}

// ---------------------------------------------------------------------------
// --bir-kez modu: TEK ölçüm yapar, kod döner (process.exit BURADA çağrılmaz —
// test edilebilirlik için). Ardışık gereksinimi tanım gereği 1'dir.
// ---------------------------------------------------------------------------
async function birKezCalistir({ url = VARSAYILAN_URL, zamanAsimiMs = ISTEK_ZAMAN_ASIMI_MS, jobId = null, istatistikGetir = istatistikGetirVarsayilan } = {}) {
  const olcum = await birOlcumYap({ url, zamanAsimiMs, istatistikGetir });
  const ardisikSakin = olcum.meşgul ? 0 : 1;
  const pencereAcik = pencereAcikMi(ardisikSakin, 1); // tek-ölçüm modu: N=1

  const mesaj = pencereAcik
    ? `SESSİZ PENCERE (tek ölçüm): kuyruk şu an sakin${jobEtiketi(jobId)}. ${olcum.ozet}`
    : `MEŞGUL (tek ölçüm): kuyruk şu an boş değil${jobEtiketi(jobId)}. ${olcum.ozet}`;

  return { kod: pencereAcik ? 0 : 1, mesaj, olcum };
}

// ---------------------------------------------------------------------------
// Sürekli döngü modu: ardışık N sakin ölçüme ulaşınca BİR KEZ haber verir ve
// çıkar (kararın icrası — süreç değiştirme — daima insana kalır).
// ---------------------------------------------------------------------------
async function sonsuzDongu({
  url = VARSAYILAN_URL,
  aralikSn = VARSAYILAN_ARALIK_SN,
  gerekli = VARSAYILAN_GEREKLI,
  jobId = null,
  zamanAsimiMs = ISTEK_ZAMAN_ASIMI_MS,
  istatistikGetir = istatistikGetirVarsayilan,
  bildirimGonder = bildirimGonderVarsayilan,
  uyuVar = (ms) => new Promise((r) => setTimeout(r, ms)),
  yaz = (s) => process.stdout.write(s + '\n'),
} = {}) {
  let ardisikSakin = 0;
  let ardArdaHata = 0;
  let uyariBasildi = false;

  console.log(`[sessiz-pencere-gozcusu] başladı — uç=${url} aralık=${aralikSn}sn gerekli=${gerekli}${jobEtiketi(jobId)}`);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const olcum = await birOlcumYap({ url, zamanAsimiMs, istatistikGetir });
    const zaman = new Date().toISOString();

    if (olcum.hataliOlcum) {
      ardArdaHata++;
      ardisikSakin = 0;
      yaz(`[${zaman}] UÇ CEVAP VERMEDİ (${olcum.sebep}) — meşgul say, ardışık hata: ${ardArdaHata}`);
      if (ardArdaHata >= ART_ARDA_HATA_UYARI_ESIGI && !uyariBasildi) {
        yaz(`[${zaman}] UYARI: uç ${ardArdaHata} kez üst üste cevap vermedi — sunucu ölü olabilir, bu ayrı bir bulgudur.`);
        uyariBasildi = true;
      }
    } else {
      ardArdaHata = 0;
      uyariBasildi = false;
      if (olcum.meşgul) {
        ardisikSakin = 0;
        yaz(`[${zaman}] meşgul — ${olcum.ozet}`);
      } else {
        ardisikSakin++;
        yaz(`[${zaman}] sakin (${ardisikSakin}/${gerekli}) — ${olcum.ozet}`);
      }
    }

    if (pencereAcikMi(ardisikSakin, gerekli)) {
      const mesaj = `SESSİZ PENCERE AÇIK: kuyruk ${gerekli} ardışık ölçümde sakin${jobEtiketi(jobId)}. ${olcum.ozet}. Kaçak paketleyici süreci (127.0.0.1:3001) ŞİMDİ temiz kopyayla değiştirilebilir — bu gözcü hiçbir şeyi kendi başına yapmaz, icra insana kalır.`;
      yaz(`[${zaman}] ${mesaj}`);
      // eslint-disable-next-line no-await-in-loop
      const bildirim = await bildirimGonder(mesaj, 'Sessiz Pencere Açık');
      if (bildirim.gonderildi) {
        yaz(`[${zaman}] telefona push gönderildi.`);
      } else {
        yaz(`[${zaman}] push gönderilemedi (${bildirim.sebep}) — yalnız stdout bildirimi geçerli.`);
      }
      return { durduruldu: true, sebep: 'pencere-acildi' };
    }

    // eslint-disable-next-line no-await-in-loop
    await uyuVar(aralikSn * 1000);
  }
}

module.exports = {
  argvAyristir,
  birOlcumYap,
  birKezCalistir,
  sonsuzDongu,
  istatistikGetirVarsayilan,
  bildirimGonderVarsayilan,
  VARSAYILAN_URL,
  VARSAYILAN_ARALIK_SN,
  VARSAYILAN_GEREKLI,
  ISTEK_ZAMAN_ASIMI_MS,
  ART_ARDA_HATA_UYARI_ESIGI,
};

// ---------------------------------------------------------------------------
// Doğrudan çalıştırıldıysa (require ile değil) — burada process.exit çağrılır.
// ---------------------------------------------------------------------------
if (require.main === module) {
  const secenekler = argvAyristir(process.argv.slice(2));

  if (secenekler.birKez) {
    birKezCalistir({ url: secenekler.url, jobId: secenekler.jobId }).then(({ kod, mesaj }) => {
      console.log(mesaj);
      process.exit(kod);
    });
  } else {
    sonsuzDongu({
      url: secenekler.url,
      aralikSn: secenekler.aralikSn,
      gerekli: secenekler.gerekli,
      jobId: secenekler.jobId,
    }).then(() => process.exit(0));
  }
}

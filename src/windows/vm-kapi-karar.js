'use strict';

/**
 * WINDOWS KABUL KAPISI — saf karar katmanı.
 *
 * NEDEN VAR: Pardus'ta gerçek bir kabul kapımız var (`tools/pardus/probook-kabul.sh`:
 * kurar, açar, piksel kanıtı alır). Windows'ta YOK. Bugün Windows doğrulaması statik —
 * exe açılıp `app.asar` içindeki işaretler sayılıyor. Bu, yamaların PAKETTE olduğunu
 * kanıtlar; uygulamanın AÇILDIĞINI kanıtlamaz. K18 kuralının Windows boşluğu budur.
 *
 * NEDEN DOSYA TABANLI: VMware Fusion'da guest içinde iş yapmak (`runProgramInGuest`,
 * `captureScreen`, dosya kopyalama) guest kullanıcı adı + PAROLA ister —
 * `vmrun` bunu yalnız komut satırı argümanı olarak alır, yani parola `ps` çıktısına
 * düşer. Nadir'in parolası ne sohbete girer ne süreç listesine. Bu yüzden köprü
 * PAYLAŞILAN KLASÖR: host görev dosyası yazar, guest'te bir kez elle başlatılmış
 * izleyici betiği işi yapıp sonucu aynı klasöre bırakır. Parola hiçbir yerde geçmez.
 *
 * Kimlik GEREKTİRMEYEN `vmrun` yetenekleri ölçüldü ve kullanılıyor: snapshot al /
 * geri dön / listele. Böylece her kurulum temiz zeminde koşar, VM kirlenmez.
 *
 * Bu modül YALNIZ kararı üretir; dosya sistemine ve VM'e dokunmaz (sürücü betik yapar).
 */

const KALP_TAZE_SN = 30;      // izleyici bu süreden eski kalp attıysa ölü sayılır
const VARSAYILAN_ZAMAN_ASIMI_SN = 900;

/**
 * İzleyici ayakta mı? Kalp atışı damgasına bakar.
 * @param {number|null} kalpMs kalp dosyasının damgası (ms) — okunamadıysa null
 * @param {number} simdiMs
 */
function izleyiciDurumu(kalpMs, simdiMs) {
  if (kalpMs == null || !Number.isFinite(kalpMs)) {
    return { durum: 'yok', sebep: 'kalp atışı bulunamadı — izleyici hiç başlatılmamış' };
  }
  const yasSn = Math.floor((simdiMs - kalpMs) / 1000);
  if (yasSn < 0) {
    // Guest saati ileri — köprü yine çalışır ama yaş ölçülemez.
    return { durum: 'ayakta', yasSn: 0, uyari: 'guest saati host\'tan ileri' };
  }
  if (yasSn > KALP_TAZE_SN) {
    return { durum: 'olu', yasSn, sebep: `son kalp ${yasSn} sn önce (eşik ${KALP_TAZE_SN})` };
  }
  return { durum: 'ayakta', yasSn };
}

/**
 * Bir görevin sonucunu yorumlar.
 * `sonuc`: guest'in yazdığı JSON (yoksa null), `gecenSn`: beklenen süre.
 * Durumlar: gecti / kaldi / zaman-asimi / bekleniyor / bozuk
 */
function gorevKarari(sonuc, gecenSn, zamanAsimiSn = VARSAYILAN_ZAMAN_ASIMI_SN) {
  if (sonuc == null) {
    if (gecenSn >= zamanAsimiSn) {
      return { durum: 'zaman-asimi', sebep: `${gecenSn} sn içinde sonuç yazılmadı` };
    }
    return { durum: 'bekleniyor', gecenSn };
  }
  if (typeof sonuc !== 'object' || typeof sonuc.cikis !== 'number') {
    return { durum: 'bozuk', sebep: 'sonuç dosyasında `cikis` alanı yok' };
  }
  if (sonuc.cikis !== 0) {
    return { durum: 'kaldi', sebep: `çıkış kodu ${sonuc.cikis}`, ciktiKuyrugu: sonuc.cikti };
  }
  // ÇIKIŞ KODU KANIT DEĞİL (memory: cikis-kodu-basari-kaniti-degil).
  // Kurulum için: uygulama süreci gerçekten koşuyor mu + ekran kanıtı var mı?
  if (sonuc.beklenenKanit === false) return { durum: 'gecti', sebep: 'kanıt istenmedi' };
  if (!sonuc.ekran) {
    return { durum: 'kaldi', sebep: 'çıkış 0 ama EKRAN KANITI yok' };
  }
  if (!Number.isFinite(sonuc.surecSayisi) || sonuc.surecSayisi < 1) {
    return { durum: 'kaldi', sebep: 'çıkış 0 ama uygulama süreci ayakta değil' };
  }
  return { durum: 'gecti', ekran: sonuc.ekran, surecSayisi: sonuc.surecSayisi };
}

/** Kapı sonucu alarm gerektiriyor mu? */
const ALARMLI = new Set(['kaldi', 'zaman-asimi', 'bozuk']);
function alarmliMi(durum) {
  return ALARMLI.has(durum);
}

/** Görev kimliği — çakışmasın diye damga + rastgele son ek. */
function gorevKimligi(simdiMs, rastgele) {
  const iso = new Date(simdiMs).toISOString();          // 2026-09-20T15:04:05.000Z
  const gun = iso.slice(0, 10).replace(/-/g, '');        // 20260920
  const saat = iso.slice(11, 19).replace(/:/g, '');      // 150405
  return `${gun}-${saat}-${String(rastgele).padStart(4, '0')}`;
}

module.exports = {
  izleyiciDurumu, gorevKarari, alarmliMi, gorevKimligi,
  KALP_TAZE_SN, VARSAYILAN_ZAMAN_ASIMI_SN,
};

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

const KALP_TAZE_SN = 30;
// GÖREV UÇUŞTAYKEN eşik gevşer. SAHA ARIZASI (2026-09-20, ölçüldü): izleyici
// 1,3 GB'lık kurulumu indirirken ve "aç + 40 sn bekle" görevini koşarken kalp
// atışı gönderemiyordu (atış ana döngüdeydi). Host 31. saniyede "izleyici ölü"
// deyip görevi BOZUK saydı — oysa iş iki seferde de BAŞARIYLA bitti
// (kurulum çıkış 0, açılış surec=4 + ekran görüntüsü). Yani kararın kendisi
// yanlış alarmdı. İzleyici tarafı düzeltildi (atış ayrı işte), ama host da
// tek başına dayanıklı olmalı: elinde iş olan bir izleyicinin susması normaldir,
// SÜRESİZ susması değil.
const KALP_MESGUL_SN = 300;      // izleyici bu süreden eski kalp attıysa ölü sayılır
const VARSAYILAN_ZAMAN_ASIMI_SN = 900;

/**
 * İzleyici ayakta mı? Kalp atışı damgasına bakar.
 * @param {number|null} kalpMs kalp dosyasının damgası (ms) — okunamadıysa null
 * @param {number} simdiMs
 */
function izleyiciDurumu(kalpMs, simdiMs, secenek) {
  if (kalpMs == null || !Number.isFinite(kalpMs)) {
    return { durum: 'yok', sebep: 'kalp atışı bulunamadı — izleyici hiç başlatılmamış' };
  }
  const yasSn = Math.floor((simdiMs - kalpMs) / 1000);
  if (yasSn < 0) {
    // Guest saati ileri — köprü yine çalışır ama yaş ölçülemez.
    return { durum: 'ayakta', yasSn: 0, uyari: 'guest saati host\'tan ileri' };
  }
  const mesgul = !!(secenek && secenek.gorevUcusta);
  const esik = mesgul ? KALP_MESGUL_SN : KALP_TAZE_SN;
  if (yasSn > esik) {
    return { durum: 'olu', yasSn, sebep: `son kalp ${yasSn} sn önce (eşik ${esik})` };
  }
  // Susmuş ama eşiği aşmamış meşgul izleyici: ayakta sayılır, sessizlik BİLDİRİLİR.
  if (mesgul && yasSn > KALP_TAZE_SN) {
    return { durum: 'ayakta', yasSn, uyari: `izleyici ${yasSn} sn sessiz — uzun iş sürüyor olmalı` };
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


// ——— NADİR'LE ÇAKIŞMA KORUMASI (2026-09-20) ———————————————————————————
// Nadir aynı VM'i elle de kullanıyor ("arada bir ben de exe yüklemesi yapmak
// istiyorum"). Aynı makinede iki kullanıcı olduğunda kapının üç hamlesi onun
// işini GERİ DÖNÜLMEZ biçimde bozar:
//   • geri-don (revertToSnapshot) — anlık görüntüden sonra yaptığı HER ŞEY silinir
//   • uyut (suspend)              — ekranı ortasında donar
//   • kur                          — aynı uygulamayı o da kuruyorsa NSIS çakışır
// Bu yüzden karar burada verilir, sürücüde değil (ölçülebilir ve testli olsun).
//
// İki işaret var:
//   BENDE  → Nadir koyar (`touch ~/vm-kapi/BENDE`): kapı VM'e HİÇ dokunmaz.
//   pencere açık → VM'in Fusion penceresi ekranda: muhtemelen o kullanıyor;
//                  durumu değiştiren hamleler reddedilir, ölçüm hamleleri geçer.
const DURUM_DEGISTIREN = new Set(['baslat', 'uyut', 'geri-don', 'kur', 'kapat']);
const YIKICI = new Set(['geri-don']);

/**
 * @param {{komut:string, bendeBayragi:boolean, pencereAcik:boolean, zorla:boolean}} g
 * @returns {{izin:boolean, sebep:string}}
 */
function mudahaleKarari({ komut, bendeBayragi = false, pencereAcik = false, vmCalisiyor = true, zorla = false } = {}) {
  // DURMUŞ bir VM'in Fusion penceresi ekranda KALIR (ölçüldü 2026-09-20: uyut
  // sonrası pencere duruyordu ve baslat reddedildi). Kapalı VM kimse tarafından
  // "kullanılıyor" olamaz — pencere sinyali yalnız VM ÇALIŞIRKEN anlamlıdır.
  const kullaniliyor = pencereAcik && vmCalisiyor;
  // YIKICI hamle hiçbir bayrakla otomatikleşmez: --zorla bile geçmez.
  if (YIKICI.has(komut) && (bendeBayragi || kullaniliyor)) {
    return { izin: false, sebep: 'yikici-el-degmis' };
  }
  if (bendeBayragi && DURUM_DEGISTIREN.has(komut)) {
    return { izin: zorla ? true : false, sebep: zorla ? 'zorlandi' : 'nadir-kullaniyor' };
  }
  if (kullaniliyor && DURUM_DEGISTIREN.has(komut)) {
    return { izin: zorla ? true : false, sebep: zorla ? 'zorlandi' : 'pencere-acik' };
  }
  return { izin: true, sebep: 'serbest' };
}

// ——— UZAK KOMUT ————————————————————————————————————————————————————————
// Makine yönetimi (disk ölçümü/temizliği, sürüm sorgusu) için izleyicinin
// 'komut' dalına gövde üretir. Boş/aşırı uzun satır GÖREV YAZILMADAN reddedilir —
// kuyruğa çöp girmesin, izleyici 99 ile dönüp kalp atışını meşgul etmesin.
const KOMUT_AZAMI = 2000;
function calistirGovdesi(satir) {
  const s = typeof satir === 'string' ? satir.trim() : '';
  if (!s) return { hata: 'bos-komut' };
  if (s.length > KOMUT_AZAMI) return { hata: 'komut-uzun' };
  return { govde: { tur: 'komut', komut: s } };
}

// ——— "EL DEĞMİŞ" İŞARETİ MAKİNE BAZLIDIR ————————————————————————————————
// Ölçülen kusur (2026-09-20): tek bir ~/vm-kapi/BENDE dosyası vardı; Nadir VM'i
// kullanırken konan işaret, BAŞKA bir makineye (windows-kasa) gönderilen kurulumu
// da reddetti. İşaret "şu makineye dokunma" demektir, "hiçbir makineye dokunma"
// değil. Varsayılan makine eski adı korur ki mevcut alışkanlık bozulmasın.
function bendeYolu(kok, makine = 'vm') {
  const ad = !makine || makine === 'vm' ? 'BENDE' : `BENDE-${makine}`;
  return `${kok}/${ad}`;
}

module.exports = {
  izleyiciDurumu, mudahaleKarari, gorevKarari, alarmliMi, gorevKimligi, calistirGovdesi, bendeYolu,
  KOMUT_AZAMI,
  KALP_TAZE_SN, KALP_MESGUL_SN, VARSAYILAN_ZAMAN_ASIMI_SN,
};

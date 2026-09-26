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

// ——— ŞERİT (ANA DÖNGÜ) İLERLEMESİ ——————————————————————————————————————
// SAHA ARIZASI (2026-09-21, ölçüldü): izleyicinin `komut` dalı erişilemeyen bir ağ
// sürücüsünde asıldı. Kalp atışı AYRI işte koştuğu için 5 sn'de bir atmaya devam
// etti → `hazir` "ayakta, yaş 2 sn" dedi. Oysa ANA DÖNGÜ 16+ dakika blokeydi:
// alınan görev (20260921-102107) sonuç yazamadı, sıradaki görev (…-102341) hiç
// alınmadı. Bu, bu depoda kayıtlı "online ama ölü" sınıfının birebir tekrarı —
// DURUM BİLDİRİMİ CANLILIK DEĞİLDİR; ölçü, işin kendi kanalından gelen ilerlemedir.
// Düzeltme: kalp, ana döngünün SON İLERLEME DAMGASINI taşır (sonDonguDamgasi) ve
// yanında döngünün ne yaptığını söyler (boşta mı, hangi görevin içinde mi, o görevin
// kendi tavanı kaç sn). Şerit değerlendirmesi burada, saf katmanda yapılır.
const SERIT_BOS_AZAMI_SN = 60;       // boştaki döngü ~5 sn'de bir damga basar; 60 sn = 12 kaçırılmış tur
const SERIT_PAY_SN = 60;             // görev tavanı + bu pay da aşıldıysa zaman aşımı DA tutmamış demektir
const SERIT_VARSAYILAN_TAVAN_SN = 900;   // görev kendi tavanını bildirmediyse (eski izleyici gövdesi)

// Guest tavanı host tavanından bu kadar KISA tutulur: guest kendi şeridini host pes
// etmeden ÖNCE açsın ve sonuç dosyasına gerçek sebebi ("zaman-asimi") yazsın. Eşit
// olsaydı yarış olurdu — host sessizlikten "zaman-asimi" derken guest hâlâ kilitli
// kalabilirdi, yani bugünkü arızanın aynısı.
const GUEST_PAY_SN = 30;
const GUEST_ASGARI_SN = 30;
const GUEST_VARSAYILAN_SN = 600;

/**
 * Kalp dosyasının HAM içeriğini çözer.
 *
 * İKİ BİÇİM OKUNUR — geriye dönük uyum ZORUNLU:
 *   - çıplak ISO damgası -> ESKİ izleyici/köprü (şerit bilgisi YOK)
 *   - JSON nesnesi       -> yeni izleyici: {kalp, sonDonguDamgasi, donguDurumu,
 *                           donguGorevi, donguZamanAsimiSn}
 * Çözülemeyen içerik kalpMs:null döner (host onu "yok" sayar) — çökmek YASAK.
 * @param {string|Buffer|null} ham
 * @returns {{kalpMs:number|null, dongu:{damgaMs:number,durum:string,gorev:string|null,zamanAsimiSn:number|null}|null}}
 */
function kalpAyristir(ham) {
  const metin = (ham == null ? '' : String(ham)).trim();
  if (!metin) return { kalpMs: null, dongu: null };
  if (metin[0] !== '{') {
    const t = Date.parse(metin);
    return { kalpMs: Number.isFinite(t) ? t : null, dongu: null };
  }
  let o;
  try { o = JSON.parse(metin); } catch { return { kalpMs: null, dongu: null }; }
  if (!o || typeof o !== 'object') return { kalpMs: null, dongu: null };
  const kalpT = Date.parse(o.kalp);
  const damgaT = Date.parse(o.sonDonguDamgasi);
  const sayi = Number(o.donguZamanAsimiSn);
  const dongu = Number.isFinite(damgaT) ? {
    damgaMs: damgaT,
    durum: o.donguDurumu === 'calisiyor' ? 'calisiyor' : 'bos',
    gorev: o.donguGorevi || null,
    zamanAsimiSn: Number.isFinite(sayi) && sayi > 0 ? sayi : null,
  } : null;
  return { kalpMs: Number.isFinite(kalpT) ? kalpT : null, dongu };
}

/**
 * Ana döngü ilerliyor mu? (Kalp atışından BAĞIMSIZ soru — arızanın özü buydu.)
 *
 *   dongu yok            -> 'bilinmiyor' (eski izleyici; bilmediğimizi söyleriz, "iyi" demeyiz)
 *   boşta + damga taze   -> 'akiyor'
 *   boşta + damga bayat  -> 'tikali'   (döngü görev almadan bir yerde asılı)
 *   görev içinde, tavan+pay aşılmamış -> 'calisiyor' (normal uzun iş)
 *   görev içinde, tavan+pay aşılmış   -> 'tikali'    (görevin kendi zaman aşımı DA tutmamış)
 * @returns {{serit:string, yasSn:number|null, gorev:string|null, uyari?:string}}
 */
function seritDurumu(dongu, simdiMs) {
  if (!dongu || !Number.isFinite(dongu.damgaMs)) {
    return { serit: 'bilinmiyor', yasSn: null, gorev: null };
  }
  const yasSn = Math.max(0, Math.floor((simdiMs - dongu.damgaMs) / 1000));
  const gorev = dongu.gorev || null;
  if (dongu.durum === 'calisiyor') {
    const tavan = (dongu.zamanAsimiSn || SERIT_VARSAYILAN_TAVAN_SN) + SERIT_PAY_SN;
    if (yasSn > tavan) {
      return {
        serit: 'tikali', yasSn, gorev,
        uyari: `ayakta ama şerit ${yasSn} sn'dir ilerlemiyor — görev ${gorev || '?'} kendi tavanını (${tavan} sn) aştı, zaman aşımı TUTMAMIŞ`,
      };
    }
    return { serit: 'calisiyor', yasSn, gorev };
  }
  if (yasSn > SERIT_BOS_AZAMI_SN) {
    return {
      serit: 'tikali', yasSn, gorev,
      uyari: `ayakta ama şerit ${yasSn} sn'dir ilerlemiyor — döngü boşta görünüyor ama damga basmıyor (eşik ${SERIT_BOS_AZAMI_SN} sn)`,
    };
  }
  return { serit: 'akiyor', yasSn, gorev };
}

/**
 * Host, guest'e hangi tavanı versin? Host kendi tavanından PAY kadar kısa.
 * Sebebi yukarıda (GUEST_PAY_SN): guest önce konuşsun, host sessizliği yorumlamasın.
 */
function guestZamanAsimiSn(hostSn) {
  const h = Number(hostSn);
  if (!Number.isFinite(h) || h <= 0) return GUEST_VARSAYILAN_SN;
  return Math.max(GUEST_ASGARI_SN, Math.floor(h) - GUEST_PAY_SN);
}

/**
 * İzleyici ayakta mı? Kalp atışı damgasına bakar.
 *
 * KALP TEK BAŞINA YETMEZ: kalp ayrı işte attığı için ana döngü kilitliyken de taze
 * görünür (2026-09-21 arızası). `secenek.dongu` verilirse sonuca `serit` alanı da
 * eklenir; `serit === 'tikali'` -> izleyici SÜREÇ olarak yaşıyor ama İŞ akmıyor.
 * `durum` bilerek 'ayakta' kalır: süreç gerçekten ayakta ve ölçüm komutları hâlâ
 * kuyruğa yazılabilir; şerit arızası AYRI bir eksende raporlanır (yanlış alarm
 * üretip tüm kapıyı kilitlemeyelim).
 * @param {number|null} kalpMs kalp dosyasının damgası (ms) — okunamadıysa null
 * @param {number} simdiMs
 * @param {{gorevUcusta?:boolean, dongu?:object|null}} [secenek]
 */
function izleyiciDurumu(kalpMs, simdiMs, secenek) {
  const serit = seritDurumu(secenek && secenek.dongu, simdiMs);
  const ekle = (r) => {
    r.serit = serit.serit;
    if (serit.yasSn != null) r.seritYasSn = serit.yasSn;
    if (serit.gorev) r.seritGorevi = serit.gorev;
    if (serit.uyari) r.uyari = r.uyari ? `${r.uyari}; ${serit.uyari}` : serit.uyari;
    return r;
  };
  if (kalpMs == null || !Number.isFinite(kalpMs)) {
    return ekle({ durum: 'yok', sebep: 'kalp atışı bulunamadı — izleyici hiç başlatılmamış' });
  }
  const yasSn = Math.floor((simdiMs - kalpMs) / 1000);
  if (yasSn < 0) {
    // Guest saati ileri — köprü yine çalışır ama yaş ölçülemez.
    return ekle({ durum: 'ayakta', yasSn: 0, uyari: 'guest saati host\'tan ileri' });
  }
  const mesgul = !!(secenek && secenek.gorevUcusta);
  const esik = mesgul ? KALP_MESGUL_SN : KALP_TAZE_SN;
  if (yasSn > esik) {
    return ekle({ durum: 'olu', yasSn, sebep: `son kalp ${yasSn} sn önce (eşik ${esik})` });
  }
  // Susmuş ama eşiği aşmamış meşgul izleyici: ayakta sayılır, sessizlik BİLDİRİLİR.
  if (mesgul && yasSn > KALP_TAZE_SN) {
    return ekle({ durum: 'ayakta', yasSn, uyari: `izleyici ${yasSn} sn sessiz — uzun iş sürüyor olmalı` });
  }
  return ekle({ durum: 'ayakta', yasSn });
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
  // GUEST KENDİ ZAMAN AŞIMINI BİLDİRDİ (2026-09-21): izleyici komutu kesip süreç
  // ağacını öldürdüğünde sonuç dosyasına durum:'zaman-asimi' yazar. Bunu 'kaldi'
  // (çıkış kodu 124) diye raporlamak sebebi GİZLER — görev kaybolmasın, SEBEBİ
  // kaybolmasın: asılan komut ile başarısız komut aynı şey değildir.
  if (sonuc.durum === 'zaman-asimi') {
    return {
      durum: 'zaman-asimi',
      sebep: `guest komutu kesti: ${sonuc.gecenSn != null ? `${sonuc.gecenSn} sn` : 'süre bilinmiyor'}` +
        (sonuc.komutOnEk ? ` — ${sonuc.komutOnEk}` : ''),
      gecenSn: sonuc.gecenSn,
      komutOnEk: sonuc.komutOnEk,
      ciktiKuyrugu: sonuc.cikti,
    };
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
function calistirGovdesi(satir, hostZamanAsimiSn) {
  const s = typeof satir === 'string' ? satir.trim() : '';
  if (!s) return { hata: 'bos-komut' };
  if (s.length > KOMUT_AZAMI) return { hata: 'komut-uzun' };
  // TAVAN GÖREVLE BİRLİKTE GİDER (2026-09-21): izleyici sabit bir tavana
  // gömülemez — 1,3 GB'lık kurulum dakikalarca sürer, kısa tavan üretimi bozar.
  // Her görev kendi tavanını taşır; guest tavanı host'unkinden pay kadar kısadır.
  return { govde: { tur: 'komut', komut: s, zamanAsimiSn: guestZamanAsimiSn(hostZamanAsimiSn) } };
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

// ——— BAŞLATMA KİPİ ————————————————————————————————————————————————————
// ÖLÇÜLEN KUSUR (2026-09-20): `vmrun start … nogui` ile başlatılan VM'e Fusion
// arayüzü SONRADAN pencere açamıyor. Ölçüm: vmx ayakta (vmrun list = 1) ama
// `count windows of process "VMware Fusion"` = 0; .vmwarevm'i `open` etmek,
// Fusion'ı kapatıp açmak ve "Virtual Machine Library" menüsünü tıklamak da
// pencere üretmedi. Nadir "VM'i neden açamıyorum" dedi — sebebi buydu.
// Tek çare VM'i askıya alıp `start … gui` ile yeniden başlatmak.
// Bu yüzden kip BAŞLATMA ANINDA seçilir: otomasyon başsız (odak çalmaz),
// Nadir kullanacaksa arayüzlü.
function baslatmaKipi(bayraklar = []) {
  return bayraklar.includes('--arayuz') ? 'gui' : 'nogui';
}

module.exports = {
  izleyiciDurumu, mudahaleKarari, gorevKarari, alarmliMi, gorevKimligi, calistirGovdesi, bendeYolu, baslatmaKipi,
  kalpAyristir, seritDurumu, guestZamanAsimiSn,
  KOMUT_AZAMI,
  KALP_TAZE_SN, KALP_MESGUL_SN, VARSAYILAN_ZAMAN_ASIMI_SN,
  SERIT_BOS_AZAMI_SN, SERIT_PAY_SN, SERIT_VARSAYILAN_TAVAN_SN,
  GUEST_PAY_SN, GUEST_ASGARI_SN, GUEST_VARSAYILAN_SN,
};

'use strict';

/**
 * VM İZLEYİCİ SÜRÜM KARARI — saf modül. Dosya sistemine, ağa, VM'e DOKUNMAZ.
 * İçerik (script metni, kalp dosyası metni) çağıran tarafından PARAMETRE olarak gelir.
 *
 * NEDEN VAR (2026-09-21, ölçülmüş durum): Guest (Nadir-VM) `vm-izleyici.ps1`'in
 * 7420 baytlık `bb53314` sürümünü koşuyordu — kalp atışı ana `while` döngüsünde
 * SENKRON çağrılıyordu, `kur` görevi (1,3 GB indirme + `Start-Process -Wait`)
 * döngüyü dakikalarca bloke edip kalp atışını susturuyordu. Host bunu "izleyici
 * ölü" sayıp BAŞARILI işi BOZUK işaretledi (memory: cikis-kodu-basari-kaniti-degil
 * ile aynı aile — burada tersi: iş geçti ama kapı yanlış alarm verdi).
 * Sonraki sürümler kalbi `Start-Job` ile arka plana aldı, `-Makine` (çoklu makine)
 * ve `dogrudanUrl` (host'u atlayıp doğrudan indirme) yeteneklerini ekledi.
 * Guest'e OTOMATİK dokunamıyoruz (paylaşılan klasör köprüsü, parola guest'e
 * girmez) — bu modül host tarafında "yükseltme gerekli mi, kalp bayat mı"
 * kararını doğrulanabilir/testli hale getirir; elle yükseltme adımları
 * YUKSELTME.md'de.
 *
 * ——— 2026-09-21 ÖĞLEDEN SONRA: ÇAPA KÖRLÜĞÜ ONARILDI ————————————————————————
 * Modül ilk yazıldığında ÜÇ çapa kullanıyordu (arka-plan-kalp, makine-parametresi,
 * dogrudan-url). Aynı gün `vm-izleyici.ps1`'e üç yeni yetenek eklendi: görev başına
 * KOMUT ZAMAN AŞIMI, SÜREÇ AĞACI ÖLDÜRME ve ANA DÖNGÜ İLERLEME DAMGASI. Ölçüm
 * (`git show <commit>:tools/windows/vm-izleyici.ps1` + grep -cF, her sürüm ayrı):
 *
 *   sürüm      bayt   kimlik Gorev-Al kalp Makine dogrudanUrl SurecAgaci sonDongu zamanAsimi
 *   a9091a5    5002     1       0      0     0        0          0          0        0
 *   bb53314    7420     1       2      0     0        0          0          0        0
 *   b6946ef    9026     1       2      2     0        0          0          0        0
 *   3b22c76    9389     1       2      2     1        0          0          0        0
 *   041bee8   10289     1       2      2     1        4          0          0        0   <- ESKİ
 *   çalışma   20400     1       2      2     1        4          4          3        4   <- YENİ
 *
 * Yani ESKİ (041bee8) sürümde ÜÇ ÇAPANIN ÜÇÜ DE VARDI: `surumTespit()` zaman aşımı
 * hiç olmayan, ağ sürücüsünde 16+ dakika asılan izleyiciye "guncel" diyordu — tam
 * olarak o gün üretim hattını 50+ dakika kilitleyen sürümü onaylamak. Çapa kümesi
 * altıya çıkarıldı; yeni üçü bilinen HİÇBİR eski sürümde geçmiyor (yukarıdaki
 * tablo: sütunlar tamamen 0). Donmuş gerçek eski metin:
 * `src/windows/gecmis-surumler/vm-izleyici-041bee8.ps1` (bayt-birebir; testte md5
 * ile git'e karşı doğrulanır).
 */

// ——— KİMLİK İŞARETİ: "elimdeki metin GERÇEKTEN izleyici script'i mi?" ——————————
// NEDEN (2026-09-21): tespit eskiden pratikte iki değerliydi — çapalar tamsa
// 'guncel', değilse 'eski'. Elimize BAŞKA bir metin geçtiyse (yanlış yol, kısmi
// okuma, hata sayfası, boş dönen köprü) bu sessizce 'eski' diye raporlanıyordu:
// "ölçemedim" ile "ölçtüm, eski" aynı kovaya giriyordu. Bu deponun tekrarlayan
// hata sınıfı ölçülemeyeni YEŞİL saymaktır; buradaki karşılığı da ölçülemeyeni
// ölçülmüş gibi raporlamaktır. Kimlik işaretlerinden HİÇBİRİ yoksa sonuç
// 'bilinmiyor' olur — 'guncel' ASLA olmaz (yön: şüphede yükselt).
// İkisi de yukarıdaki tabloda ölçüldü: 'VM İZLEYİCİ' bilinen TÜM sürümlerde (ilk
// commit dahil), 'Gorev-Al' bb53314'ten beri. "Herhangi biri eşleşsin" kuralı,
// başlık yeniden yazılsa da (ya da işlev adı değişse de) kör kalmamak içindir.
const KIMLIK_ISARETI = ['VM İZLEYİCİ', 'Gorev-Al'];

// ——— ALTI ÇAPA ————————————————————————————————————————————————————————————————
// Her çapa BİR yeteneği temsil eder ve o yetenek kaldırılmadan silinemeyecek bir
// belirteçtir. ÇAPA SEÇİM ÖLÇÜTÜ (tuzak iki yönlü):
//   - ÇOK DAR olmasın: tam satır / boşluk / argüman listesi çapa YAPILMAZ, yoksa
//     zararsız bir biçimlendirme güncel sürümü "eski" gösterir. Hepsi tek bir
//     tanımlayıcı ya da alan adıdır; sıra, boşluk, yorum, argüman değişimi etkilemez.
//   - ÇOK GENİŞ olmasın: her çapa TEK yeteneğe bağlıdır ve bilinen hiçbir eski
//     sürümde geçmez (yukarıdaki tabloyla ölçüldü, tahmin değil).
// AYNI YETENEĞE İKİNCİ ÇAPA KONMAZ: örneğin zaman aşımı için `WaitForExit` de
// aday görünüyordu ama `zamanAsimiSn` ile BİRLİKTE ölür — tespiti artırmaz, yalnız
// kümeyi daraltır. Aynı sebeple `Dongu-Damgala` yerine onun YAZDIĞI alan
// (`sonDonguDamgasi`) seçildi: alan adı host sözleşmesidir (vm-kapi-karar.js ->
// seritDurumu, izleyici-kurtarma.js onu okur), yani sessizce yeniden adlandırılamaz.
const SURUM_ISARETI = [
  {
    anahtar: 'arka-plan-kalp',
    capa: "Start-Job -Name 'vm-kalp'",
    eklendi: 'b6946ef',
    aciklama: 'kalp atışı Start-Job ile ayrı işte — ana döngü uzun görevde bloklanınca da atış sürer',
  },
  {
    anahtar: 'makine-parametresi',
    capa: "[string]$Makine = 'vm'",
    eklendi: '3b22c76',
    aciklama: "çoklu makineyi (vm / windows-kasa / ...) ayırt eden -Makine parametresi",
  },
  {
    anahtar: 'dogrudan-url',
    capa: '$dogrudanUrl',
    eklendi: '041bee8',
    aciklama: "kurulum dosyasını host köprüsünü atlayıp doğrudan kaynaktan çekme yeteneği",
  },
  {
    anahtar: 'komut-zaman-asimi',
    capa: 'zamanAsimiSn',
    eklendi: '2026-09-21 (commit edilmemiş)',
    aciklama:
      'görev başına komut zaman aşımı tavanı — host bu alanı görevle birlikte gönderir; ' +
      'yoksa `cmd /c` süresiz asılır (ağ sürücüsünde 16+ dk ölçüldü)',
  },
  {
    anahtar: 'surec-agaci-oldur',
    capa: 'Surec-Agaci-Oldur',
    eklendi: '2026-09-21 (commit edilmemiş)',
    aciklama:
      'zaman aşımında yalnız cmd.exe değil TÜM süreç ağacı kesilir (taskkill /T /F, ' +
      'yoksa CIM ile yinelemeli) — yoksa torun süreç dosya/ağ kilidiyle yaşar',
  },
  {
    anahtar: 'dongu-damgasi',
    capa: 'sonDonguDamgasi',
    eklendi: '2026-09-21 (commit edilmemiş)',
    aciklama:
      'ana döngü ilerleme damgası — kalp ayrı işte attığı için "kalp var" artık ' +
      'canlılık kanıtı değil; host şeridi bu damgadan ölçer (vm-kapi-karar seritDurumu)',
  },
];

/**
 * Script içeriğinde HEAD'e özgü çapaları arar.
 *
 * ÜÇ DEĞERLİ, İKİ DEĞİLDİR: 'guncel' | 'eski' | 'bilinmiyor'.
 * 'bilinmiyor' = ÖLÇEMEDİM. Asla 'guncel' ile karıştırılmaz; çağıran onu
 * "güvenli tarafta kal, yükselt" diye okumalıdır.
 *
 * @param {string} icerik ps1 dosyasının TAM metni (fs okuması ÇAĞIRANDA yapılır)
 * @returns {{surum:'guncel'|'eski'|'bilinmiyor', eksikYetenekler:string[], belirsizlikSebebi:(null|'icerik-yok'|'kimlik-eslesmedi')}}
 */
function surumTespit(icerik) {
  const tumu = () => SURUM_ISARETI.map((s) => s.anahtar);

  if (typeof icerik !== 'string' || icerik.trim() === '') {
    return { surum: 'bilinmiyor', eksikYetenekler: tumu(), belirsizlikSebebi: 'icerik-yok' };
  }
  if (!KIMLIK_ISARETI.some((k) => icerik.includes(k))) {
    // Metin var ama izleyici script'i değil (yanlış yol / kısmi okuma / hata gövdesi).
    // "Eski" DEMEK YANLIŞ OLUR: eski demek ölçtüm demektir; ölçemedik.
    return { surum: 'bilinmiyor', eksikYetenekler: tumu(), belirsizlikSebebi: 'kimlik-eslesmedi' };
  }

  const eksikYetenekler = SURUM_ISARETI.filter((s) => !icerik.includes(s.capa)).map((s) => s.anahtar);
  const surum = eksikYetenekler.length === 0 ? 'guncel' : 'eski';
  return { surum, eksikYetenekler, belirsizlikSebebi: null };
}

/**
 * Kalp atışı bayat mı? GEREKÇE: bayat kalp "izleyici ölü" demektir ve host
 * bunu gördüğünde sürmekte olan işi sessizce BOZUK sayabilir (ölçülmüş arıza,
 * yukarıdaki dosya başlığı). Bu yüzden ŞÜPHEDE her zaman BAYAT tarafına düşülür:
 * boş/bozuk/okunamayan/eksik `simdi` → true.
 * @param {string} kalpIcerigi kalp dosyasının metni (ISO-8601 UTC damgası beklenir)
 * @param {number} simdi şimdiki zaman (ms, epoch)
 * @param {number} esikSn eşik (saniye) — varsayılan 180
 * @returns {boolean}
 */
function kalpBayatMi(kalpIcerigi, simdi, esikSn = 180) {
  if (typeof kalpIcerigi !== 'string' || kalpIcerigi.trim() === '') return true;
  if (typeof simdi !== 'number' || !Number.isFinite(simdi)) return true;
  if (typeof esikSn !== 'number' || !Number.isFinite(esikSn) || esikSn < 0) return true;
  // KALP DOSYASI İKİ BİÇİMDE OLABİLİR (2026-09-21): eski izleyici çıplak ISO yazar,
  // yenisi `{kalp, sonDonguDamgasi, ...}` JSON'u yazar (şerit damgasını taşımak için).
  // JSON'u tanımazsak Date.parse NaN döner ve GÜNCEL bir izleyiciyi "bayat" sayarız —
  // tam da bu modülün önlemek için yazıldığı yanlış alarm sınıfı.
  const ham = kalpIcerigi.trim();
  let metin = ham;
  if (ham[0] === '{') {
    try {
      const o = JSON.parse(ham);
      metin = (o && typeof o === 'object' && o.kalp) ? String(o.kalp) : '';
    } catch { return true; }          // bozuk JSON → şüphede bayat
  }
  if (!metin) return true;
  const damgaMs = Date.parse(metin);
  if (!Number.isFinite(damgaMs)) return true; // bozuk tarih → bilerek bayat say
  const yasSn = (simdi - damgaMs) / 1000;
  if (yasSn < 0) return false; // guest saati host'tan ileri — vm-kapi-karar ile aynı kural: ölçülemez ama ölü DENMEZ
  return yasSn > esikSn; // tam eşikte AYAKTA (sınır dahil), aşınca BAYAT
}

/**
 * Guest'i yükseltmek gerekiyor mu? İki bağımsız sinyali birleştirir ama
 * "gerekli" bayrağını yalnız SÜRÜM kararı ile ilgilendirir — bayat kalp,
 * güncel bir sürümde BAŞKA bir arıza olabilir (çökme, ağ), yükseltme onu
 * çözmez. Bayat kalp yalnız ESKİ sürümdeyken "bilinen belirti" olarak
 * sebep listesine eklenir (teşhis kolaylığı, tekrar tekrar keşfedilmesin).
 * @param {string} guestIcerik guest'teki script'in tam metni
 * @param {string} kalpIcerigi kalp dosyasının metni
 * @param {number} simdi şimdiki zaman (ms, epoch)
 * @returns {{gerekli:boolean, sebepler:string[]}}
 */
function yukseltmeGerekliMi(guestIcerik, kalpIcerigi, simdi) {
  const tespit = surumTespit(guestIcerik);
  const bayat = kalpBayatMi(kalpIcerigi, simdi);
  const sebepler = [];

  if (tespit.surum === 'eski') {
    sebepler.push(
      `izleyici ESKİ sürüm — eksik yetenekler: ${tespit.eksikYetenekler.join(', ')}`
    );
  } else if (tespit.surum === 'bilinmiyor') {
    // İki ayrı belirsizlik SEBEBİ ayrı raporlanır: "hiç metin yok" ile "metin var
    // ama izleyici değil" farklı operatör hamlesi gerektirir (köprüyü mü onaracak,
    // yolu mu düzeltecek).
    const ek = tespit.belirsizlikSebebi === 'kimlik-eslesmedi'
      ? 'okunan metin izleyici scripti DEĞİL (yanlış yol / kısmi okuma / hata gövdesi olabilir)'
      : 'script içeriği okunamadı (boş döndü)';
    sebepler.push(`izleyici sürümü belirlenemedi — ${ek}; şüphede güvenli tarafta kal, yükselt`);
  }

  if (bayat && tespit.surum !== 'guncel') {
    sebepler.push(
      'kalp atışı da bayat — bu ESKİ sürümün bilinen belirtisidir (kalp senkron, uzun göreve kilitleniyor)'
    );
  }

  return { gerekli: sebepler.length > 0, sebepler };
}

module.exports = {
  SURUM_ISARETI,
  KIMLIK_ISARETI,
  surumTespit,
  kalpBayatMi,
  yukseltmeGerekliMi,
};

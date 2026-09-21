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
 * HEAD sürümü (10289 bayt) kalbi `Start-Job` ile arka plana aldı, ayrıca
 * `-Makine` (çoklu makine) ve `dogrudanUrl` (host'u atlayıp doğrudan indirme)
 * yeteneklerini ekledi. Guest'e OTOMATİK dokunamıyoruz (paylaşılan klasör
 * köprüsü, parola guest'e girmez) — bu modül host tarafında "yükseltme gerekli
 * mi, kalp bayat mı" kararını doğrulanabilir/testli hale getirir; elle
 * yükseltme adımları YUKSELTME.md'de.
 */

// ÜÇ AYRI ÇAPA — tek satıra bağlanmamak için. Her biri HEAD'e HEAD'i yapan ayrı
// bir yeteneği ima eder: (1) kalp atışı arka planda, (2) çoklu makine desteği,
// (3) host'u atlayan doğrudan indirme. Script'in tamamı bu üçünü BİRDEN
// içeriyorsa güncel sayılır; biri bile eksikse eski/kırık bir kopya olabilir.
const SURUM_ISARETI = [
  {
    anahtar: 'arka-plan-kalp',
    capa: "Start-Job -Name 'vm-kalp'",
    aciklama: 'kalp atışı Start-Job ile ayrı işte — ana döngü uzun görevde bloklanınca da atış sürer',
  },
  {
    anahtar: 'makine-parametresi',
    capa: "[string]$Makine = 'vm'",
    aciklama: "çoklu makineyi (vm / windows-kasa / ...) ayırt eden -Makine parametresi",
  },
  {
    anahtar: 'dogrudan-url',
    capa: '$dogrudanUrl',
    aciklama: "kurulum dosyasını host köprüsünü atlayıp doğrudan kaynaktan çekme yeteneği",
  },
];

/**
 * Script içeriğinde HEAD'e özgü üç çapayı arar.
 * @param {string} icerik ps1 dosyasının TAM metni (fs okuması ÇAĞIRANDA yapılır)
 * @returns {{surum:'guncel'|'eski'|'bilinmiyor', eksikYetenekler:string[]}}
 */
function surumTespit(icerik) {
  if (typeof icerik !== 'string' || icerik.trim() === '') {
    return { surum: 'bilinmiyor', eksikYetenekler: SURUM_ISARETI.map((s) => s.anahtar) };
  }
  const eksikYetenekler = SURUM_ISARETI.filter((s) => !icerik.includes(s.capa)).map((s) => s.anahtar);
  const surum = eksikYetenekler.length === 0 ? 'guncel' : 'eski';
  return { surum, eksikYetenekler };
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
  const damgaMs = Date.parse(kalpIcerigi.trim());
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
    sebepler.push('izleyici sürümü belirlenemedi (script içeriği okunamadı) — şüphede güvenli tarafta kal, yükselt');
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
  surumTespit,
  kalpBayatMi,
  yukseltmeGerekliMi,
};

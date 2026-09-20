'use strict';

/**
 * İkon saydamlığı — logonun ETRAFINDAKİ düz zemini saydama çevirir.
 *
 * Neden var (2026-09-20, ölçümle): yayıncı panelinden yüklenen logoların bir kısmı
 * "alfa kanalı var ama içinde hiç saydam piksel yok" biçiminde. Örnek ölçüm —
 * ydspublishing 512x512 PNG: 262.144 pikselin 0'ı saydam, dört köşe de
 * RGBA(255,255,255,255). Bizim ICO hattımız zaten `alpha: 0` ile dolgu yapıyor,
 * yani beyaz kutuyu BİZ eklemiyoruz; logonun kendisinde pişmiş geliyor ve
 * Windows görev çubuğunda/masaüstünde ikonun etrafında beyaz kare olarak görünüyor.
 *
 * Yöntem: KENARDAN taşma-doldurma (flood fill). Yalnız görselin dış kenarına
 * bağlı, zemin rengine yakın pikseller silinir — logonun İÇİNDEKİ beyazlar
 * (göz, boşluk, yazı) kenara bağlı olmadığı için korunur.
 *
 * Muhafazakâr kapılar (biri bile tutmazsa görsele DOKUNULMAZ):
 *   - görselde zaten kayda değer saydamlık varsa (tasarımcı hallettiyse)
 *   - dört köşe birbirinden farklıysa (fotoğraf/degrade zemin)
 *   - silinecek alan görselin neredeyse tamamıysa (düz renk görsel)
 *   - silinecek alan ihmal edilebilirse (zaten kutu yok)
 */

const VARSAYILAN = {
  // Zemin sayılmak için köşe rengine azami kanal sapması.
  tolerans: 24,
  // Yumuşatma bandı: bu mesafeye kadar kısmi alfa verilir (kenar tırtığı olmasın).
  yumusatmaTolerans: 72,
  // Dört köşenin birbirine azami sapması.
  koseTolerans: 12,
  // Görselde bundan çok saydamlık varsa zaten hallolmuş say.
  mevcutSaydamEsigi: 0.02,
  // Bundan fazlası silinecekse görsel düz renktir, dokunma.
  azamiTemizlemeOrani: 0.92,
  // Bundan azı siliniyorsa kayda değer bir kutu yok.
  asgariTemizlemeOrani: 0.005
};

function acikMi(env = process.env) {
  return env.EMPP_IKON_SAYDAM !== '0';
}

function pikselMesafe(rgba, a, b) {
  const dr = Math.abs(rgba[a] - rgba[b]);
  const dg = Math.abs(rgba[a + 1] - rgba[b + 1]);
  const db = Math.abs(rgba[a + 2] - rgba[b + 2]);
  return Math.max(dr, dg, db);
}

function renkMesafe(rgba, i, renk) {
  return Math.max(
    Math.abs(rgba[i] - renk[0]),
    Math.abs(rgba[i + 1] - renk[1]),
    Math.abs(rgba[i + 2] - renk[2])
  );
}

/**
 * @param {Buffer|Uint8Array} rgba  genislik*yukseklik*4 ham RGBA
 * @returns {{degisti:boolean, sebep:string, temizlenen:number, oran:number, zemin?:number[]}}
 */
function saydamlastir(rgba, genislik, yukseklik, secenekler = {}) {
  const ayar = { ...VARSAYILAN, ...secenekler };
  const toplam = genislik * yukseklik;

  if (!rgba || rgba.length !== toplam * 4) {
    return { degisti: false, sebep: 'gecersiz-tampon', temizlenen: 0, oran: 0 };
  }

  // 1) Zaten saydam mı?
  let saydamSayisi = 0;
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] < 250) saydamSayisi++;
  }
  if (saydamSayisi / toplam > ayar.mevcutSaydamEsigi) {
    return { degisti: false, sebep: 'zaten-saydam', temizlenen: 0, oran: 0 };
  }

  // 2) Dört köşe tutarlı mı?
  const koseler = [
    0,
    (genislik - 1) * 4,
    (yukseklik - 1) * genislik * 4,
    ((yukseklik - 1) * genislik + genislik - 1) * 4
  ];
  for (const k of koseler) {
    if (rgba[k + 3] < 250) {
      return { degisti: false, sebep: 'kose-saydam', temizlenen: 0, oran: 0 };
    }
  }
  for (let n = 1; n < koseler.length; n++) {
    if (pikselMesafe(rgba, koseler[0], koseler[n]) > ayar.koseTolerans) {
      return { degisti: false, sebep: 'kose-tutarsiz', temizlenen: 0, oran: 0 };
    }
  }
  const zemin = [rgba[koseler[0]], rgba[koseler[0] + 1], rgba[koseler[0] + 2]];

  // 3) Kenardan taşma-doldurma
  const temiz = new Uint8Array(toplam);
  const yigin = [];
  const it = (x, y) => {
    const p = y * genislik + x;
    if (temiz[p]) return;
    if (renkMesafe(rgba, p * 4, zemin) > ayar.tolerans) return;
    temiz[p] = 1;
    yigin.push(p);
  };
  for (let x = 0; x < genislik; x++) { it(x, 0); it(x, yukseklik - 1); }
  for (let y = 0; y < yukseklik; y++) { it(0, y); it(genislik - 1, y); }

  let temizlenen = yigin.length;
  while (yigin.length) {
    const p = yigin.pop();
    const x = p % genislik;
    const y = (p - x) / genislik;
    if (x > 0) { const o = yigin.length; it(x - 1, y); temizlenen += yigin.length - o; }
    if (x < genislik - 1) { const o = yigin.length; it(x + 1, y); temizlenen += yigin.length - o; }
    if (y > 0) { const o = yigin.length; it(x, y - 1); temizlenen += yigin.length - o; }
    if (y < yukseklik - 1) { const o = yigin.length; it(x, y + 1); temizlenen += yigin.length - o; }
  }

  const oran = temizlenen / toplam;
  if (oran > ayar.azamiTemizlemeOrani) {
    return { degisti: false, sebep: 'neredeyse-tamami', temizlenen, oran };
  }
  if (oran < ayar.asgariTemizlemeOrani) {
    return { degisti: false, sebep: 'kayda-deger-degil', temizlenen, oran };
  }

  // 4) Yumuşatma: silinen alana komşu, zemine yakın pikseller kısmi alfa alır.
  //    (Kenar tırtığı kalmasın; alfa yazmadan ÖNCE hesaplanır.)
  const bant = Math.max(1, ayar.yumusatmaTolerans - ayar.tolerans);
  const yumusak = new Map();
  for (let p = 0; p < toplam; p++) {
    if (temiz[p]) continue;
    const x = p % genislik;
    const y = (p - x) / genislik;
    const komsuTemiz =
      (x > 0 && temiz[p - 1]) ||
      (x < genislik - 1 && temiz[p + 1]) ||
      (y > 0 && temiz[p - genislik]) ||
      (y < yukseklik - 1 && temiz[p + genislik]);
    if (!komsuTemiz) continue;
    const d = renkMesafe(rgba, p * 4, zemin);
    if (d >= ayar.yumusatmaTolerans) continue;
    const alfa = Math.round(255 * Math.min(1, (d - ayar.tolerans) / bant));
    yumusak.set(p, alfa);
  }

  for (let p = 0; p < toplam; p++) {
    if (temiz[p]) rgba[p * 4 + 3] = 0;
  }
  for (const [p, alfa] of yumusak) {
    if (alfa < rgba[p * 4 + 3]) rgba[p * 4 + 3] = alfa;
  }

  return { degisti: true, sebep: 'temizlendi', temizlenen, oran, zemin };
}

/**
 * Logo dosyasını okur, zemini saydamlaştırır, PNG tamponu döndürür.
 * Dokunulmadıysa `{ tampon: null, sonuc }` döner — çağıran kaynağı aynen kullanır.
 */
async function logoyuSaydamlastir(sharp, kaynakYolu, secenekler = {}) {
  const girdi = sharp(kaynakYolu).ensureAlpha();
  const { data, info } = await girdi
    .raw()
    .toBuffer({ resolveWithObject: true });

  const sonuc = saydamlastir(data, info.width, info.height, secenekler);
  if (!sonuc.degisti) return { tampon: null, sonuc, genislik: info.width, yukseklik: info.height };

  const tampon = await sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 }
  }).png().toBuffer();

  return { tampon, sonuc, genislik: info.width, yukseklik: info.height };
}

module.exports = { acikMi, saydamlastir, logoyuSaydamlastir, VARSAYILAN };

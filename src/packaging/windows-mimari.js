'use strict';

/**
 * WINDOWS HEDEF MİMARİSİ (2026-09-20, Nadir kararı)
 *
 * Nadir: "64 değil x86 yani 32 bit olarak üretim yapmalıyız. Hâlen Windows 64 bit
 * çalıştırmayan çok cihaz var Türkiye'de, yüklenen kitaplarda."
 *
 * Neden ia32 TEK paketi çözer: 32 bit bir uygulama 64 bit Windows'ta WOW64 ile
 * çalışır; tersi çalışmaz. Yani ia32 üretmek her iki cihaz sınıfını da kapsar ve
 * ikinci bir kurulum dosyası dağıtmayı gerektirmez.
 *
 * İki paketi TEK exe'de birleştirmek (arch: ["ia32","x64"]) bu üründe yanlış:
 * electron-builder her mimari için ayrı bir açılmış ağaç gömer, içerik 1,2 GB
 * olduğundan kurulum dosyası ~2,5 GB'a çıkar. Kazanç yok, indirme iki katına çıkar.
 *
 * ÖLÇÜLEN SINIR: Electron 39 ia32 yapısı yayınlanıyor (electron-v39.0.0-win32-ia32.zip,
 * 112 MB — 2026-09-20'de GitHub sürüm varlıklarından doğrulandı) ama Electron 23'ten
 * beri Windows 7/8/8.1 DESTEKLENMİYOR. Yani ia32'ye geçmek "Windows 10/11 32 bit"
 * cihazları kazandırır; Windows 7 cihazlar mimariden bağımsız olarak kapsam dışıdır.
 */

const GECERLI = ['ia32', 'x64', 'arm64'];
const VARSAYILAN = 'ia32';

/**
 * Ortamdan hedef mimariyi çözer. Geçersiz/boş değer sessizce varsayılana düşmez —
 * sessiz düşüş, yanlış mimaride paket üretip sahada "açılmıyor" olarak geri gelir.
 */
function mimariCoz(ortam = process.env) {
  const ham = (ortam.EMPP_WIN_ARCH || '').trim();
  if (!ham) return { mimari: VARSAYILAN, kaynak: 'varsayilan' };
  if (!GECERLI.includes(ham)) {
    return { mimari: VARSAYILAN, kaynak: 'gecersiz', uyari: `EMPP_WIN_ARCH="${ham}" geçersiz; geçerli: ${GECERLI.join(', ')}` };
  }
  return { mimari: ham, kaynak: 'ortam' };
}

/** electron-builder `win.target` nesnesi. */
function hedef(ortam = process.env) {
  const { mimari } = mimariCoz(ortam);
  return { target: 'nsis', arch: [mimari] };
}

module.exports = { mimariCoz, hedef, GECERLI, VARSAYILAN };

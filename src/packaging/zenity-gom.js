'use strict';
/**
 * ZENITY ZORUNLU (Nadir, 2026-09-15): Pardus .impark'ının açılış çubuğu ("… kuruluyor")
 * pakete GÖMÜLÜ zenity ile çalışmalı; gömülemiyorsa paket ÜRETİLMEZ.
 *
 * Neden: 15 Eylül'e kadar üretilen 100/100 pakette `usr/bin` boştu — paketleyici
 * "zenity + dijitap" mesajı basıyor ama hiçbir şey kopyalamıyordu; AppRun sistem
 * zenity'sine düşüyordu (zenity'siz makinede sessiz açılış, hata diyaloğu da yok).
 *
 * Kaynak, derleme makinesinin kendi zenity'sidir (Docker imajı `packager-linux`
 * apt ile kurar; srv21'de sistem paketi). `/usr/share/zenity` (UI/yardımcı veri)
 * varsa yanına alınır; AppRun gömülü ikiliye düşerken `ZENITY_DATADIR` ile gösterir.
 */
const fs = require('fs-extra');
const path = require('path');

const VARSAYILAN_IKILI = '/usr/bin/zenity';
const VARSAYILAN_VERI = '/usr/share/zenity';

class ZenityYokHatasi extends Error {
  constructor(mesaj) {
    super(mesaj);
    this.name = 'ZenityYokHatasi';
    this.code = 'ZENITY_YOK';
  }
}

/**
 * @param {string} extractDir  AppDir kökü (squashfs-root)
 * @param {{ ikili?: string, veri?: string }} [kaynak]
 * @returns {Promise<{ bin: string, boyut: number, veri: string | null }>}
 */
async function zenityGom(extractDir, kaynak = {}) {
  const ikili = kaynak.ikili || VARSAYILAN_IKILI;
  const veri = kaynak.veri || VARSAYILAN_VERI;

  if (!(await fs.pathExists(ikili))) {
    throw new ZenityYokHatasi(
      `ZENITY ZORUNLU: derleme makinesinde ${ikili} yok — paket ÜRETİLMEDİ. ` +
        'Docker imajına/sunucuya `apt-get install zenity` kur (packager-linux imajı ≥ :2).'
    );
  }
  const st = await fs.stat(ikili);
  if (!st.isFile() || st.size === 0) {
    throw new ZenityYokHatasi(`ZENITY ZORUNLU: ${ikili} dosya değil ya da boş — paket ÜRETİLMEDİ.`);
  }

  const hedefBin = path.join(extractDir, 'usr', 'bin', 'zenity');
  await fs.ensureDir(path.dirname(hedefBin));
  await fs.copy(ikili, hedefBin, { overwrite: true, dereference: true });
  await fs.chmod(hedefBin, 0o755);

  let hedefVeri = null;
  if (await fs.pathExists(veri)) {
    hedefVeri = path.join(extractDir, 'usr', 'share', 'zenity');
    await fs.copy(veri, hedefVeri, { overwrite: true, dereference: true });
  }

  // Kapı: kopya gerçekten yerinde mi (kısmi kopya/izin kazasına karşı yeniden oku).
  const sonuc = await fs.stat(hedefBin).catch(() => null);
  if (!sonuc || sonuc.size !== st.size) {
    throw new ZenityYokHatasi('ZENITY ZORUNLU: gömme doğrulanamadı (boyut uyuşmuyor) — paket ÜRETİLMEDİ.');
  }
  return { bin: hedefBin, boyut: sonuc.size, veri: hedefVeri };
}

/** Bitmiş AppDir'de kapı: zenity gömülü değilse fırlatır. */
async function zenityKapisi(extractDir) {
  const hedefBin = path.join(extractDir, 'usr', 'bin', 'zenity');
  const st = await fs.stat(hedefBin).catch(() => null);
  if (!st || !st.isFile() || st.size === 0) {
    throw new ZenityYokHatasi(`ZENITY ZORUNLU: ${hedefBin} yok — paket ÜRETİLMEDİ.`);
  }
  return hedefBin;
}

module.exports = { zenityGom, zenityKapisi, ZenityYokHatasi, VARSAYILAN_IKILI, VARSAYILAN_VERI };

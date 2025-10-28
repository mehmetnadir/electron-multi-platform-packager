const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

class LogoService {
  constructor(configManager = null) {
    // ConfigManager'dan logo dizinini al, yoksa varsayılan kullan
    if (configManager) {
      this.logoDir = configManager.getLogoDir();
    } else {
      this.logoDir = path.join(process.cwd(), 'logos');
    }
    this.logoDbPath = path.join(this.logoDir, 'logos.json');
    this.initLogoStorage();
  }

  // Singleton için init metodu
  init(configManager) {
    if (configManager) {
      this.logoDir = configManager.getLogoDir();
      this.logoDbPath = path.join(this.logoDir, 'logos.json');
      this.initLogoStorage();
    }
  }

  async initLogoStorage() {
    try {
      await fs.ensureDir(this.logoDir);
      
      if (!await fs.pathExists(this.logoDbPath)) {
        await fs.writeJson(this.logoDbPath, { logos: [] }, { spaces: 2 });
      }
    } catch (error) {
      console.error('Logo depolama başlatma hatası:', error);
    }
  }

  async getLogosDb() {
    try {
      const db = await fs.readJson(this.logoDbPath);
      return db.logos || [];
    } catch (error) {
      console.error('Logo veritabanı okuma hatası:', error);
      return [];
    }
  }

  async saveLogosDb(logos) {
    try {
      await fs.writeJson(this.logoDbPath, { logos }, { spaces: 2 });
    } catch (error) {
      console.error('Logo veritabanı yazma hatası:', error);
      throw error;
    }
  }

  async getAvailableLogos() {
    try {
      const logos = await this.getLogosDb();
      
      // Dosya varlığını kontrol et ve temizle
      const validLogos = [];
      for (const logo of logos) {
        if (await fs.pathExists(logo.filePath)) {
          validLogos.push({
            id: logo.id,
            kurumId: logo.kurumId,
            kurumAdi: logo.kurumAdi,
            fileName: logo.fileName,
            uploadedAt: logo.uploadedAt,
            size: logo.size,
            // Güvenlik için dosya yolunu gizle
            available: true
          });
        }
      }

      // Geçersiz logoları temizle
      if (validLogos.length !== logos.length) {
        await this.saveLogosDb(validLogos.map(logo => {
          const originalLogo = logos.find(l => l.id === logo.id);
          return originalLogo;
        }));
      }

      return validLogos;
    } catch (error) {
      console.error('Logo listesi alınırken hata:', error);
      return [];
    }
  }

  async saveLogo(kurumId, kurumAdi, file) {
    try {
      if (!file) {
        throw new Error('Logo dosyası gerekli');
      }

      // Dosya formatını kontrol et
      const allowedFormats = ['.png', '.jpg', '.jpeg', '.ico', '.icns'];
      const fileExt = path.extname(file.originalname).toLowerCase();
      
      if (!allowedFormats.includes(fileExt)) {
        throw new Error(`Desteklenmeyen dosya formatı. İzin verilen formatlar: ${allowedFormats.join(', ')}`);
      }

      const logoId = uuidv4();
      const fileName = `${kurumId}_${logoId}${fileExt}`;
      const filePath = path.join(this.logoDir, fileName);

      // Dosyayı kopyala
      await fs.copy(file.path, filePath);

      // Logo bilgilerini kaydet
      const logoInfo = {
        id: logoId,
        kurumId: kurumId || 'default',
        kurumAdi: kurumAdi || 'Varsayılan Kurum',
        fileName,
        filePath,
        originalName: file.originalname,
        uploadedAt: new Date().toISOString(),
        size: file.size,
        mimeType: file.mimetype
      };

      const logos = await this.getLogosDb();
      
      // Aynı kurum için eski logoyu kaldır
      const filteredLogos = logos.filter(logo => logo.kurumId !== kurumId);
      filteredLogos.push(logoInfo);
      
      await this.saveLogosDb(filteredLogos);

      // Geçici dosyayı temizle
      if (await fs.pathExists(file.path)) {
        await fs.remove(file.path);
      }

      return {
        id: logoId,
        kurumId,
        kurumAdi,
        fileName,
        uploadedAt: logoInfo.uploadedAt,
        size: logoInfo.size
      };

    } catch (error) {
      console.error('Logo kaydetme hatası:', error);
      throw error;
    }
  }

  async getLogoById(logoId) {
    try {
      const logos = await this.getLogosDb();
      const logo = logos.find(l => l.id === logoId);
      
      if (!logo) {
        return null;
      }

      // Dosya varlığını kontrol et
      if (!await fs.pathExists(logo.filePath)) {
        console.warn(`Logo dosyası bulunamadı: ${logo.filePath}`);
        return null;
      }

      return logo;
    } catch (error) {
      console.error('Logo bilgisi alınırken hata:', error);
      return null;
    }
  }

  async getLogoByKurumId(kurumId) {
    try {
      const logos = await this.getLogosDb();
      const logo = logos.find(l => l.kurumId === kurumId);
      
      if (!logo) {
        return null;
      }

      // Dosya varlığını kontrol et
      if (!await fs.pathExists(logo.filePath)) {
        console.warn(`Logo dosyası bulunamadı: ${logo.filePath}`);
        return null;
      }

      return logo;
    } catch (error) {
      console.error('Kurum logosu alınırken hata:', error);
      return null;
    }
  }

  async deleteLogo(logoId) {
    try {
      const logos = await this.getLogosDb();
      const logoIndex = logos.findIndex(l => l.id === logoId);
      
      if (logoIndex === -1) {
        throw new Error('Logo bulunamadı');
      }

      const logo = logos[logoIndex];
      
      // Dosyayı sil
      if (await fs.pathExists(logo.filePath)) {
        await fs.remove(logo.filePath);
      }

      // Veritabanından kaldır
      logos.splice(logoIndex, 1);
      await this.saveLogosDb(logos);

      return true;
    } catch (error) {
      console.error('Logo silme hatası:', error);
      throw error;
    }
  }

  async updateLogo(logoId, kurumId, kurumAdi, newFile = null) {
    try {
      const logos = await this.getLogosDb();
      const logoIndex = logos.findIndex(l => l.id === logoId);
      
      if (logoIndex === -1) {
        throw new Error('Logo bulunamadı');
      }

      const oldLogo = logos[logoIndex];

      // Eğer yeni dosya varsa, eski dosyayı sil ve yenisini kaydet
      if (newFile) {
        // Dosya formatını kontrol et
        const allowedFormats = ['.png', '.jpg', '.jpeg', '.ico', '.icns'];
        const fileExt = path.extname(newFile.originalname).toLowerCase();
        
        if (!allowedFormats.includes(fileExt)) {
          throw new Error(`Desteklenmeyen dosya formatı. İzin verilen formatlar: ${allowedFormats.join(', ')}`);
        }

        // Eski dosyayı sil
        if (await fs.pathExists(oldLogo.filePath)) {
          await fs.remove(oldLogo.filePath);
        }

        // Yeni dosya adı oluştur
        const newFileName = `${kurumId || oldLogo.kurumId}_${logoId}${fileExt}`;
        const newFilePath = path.join(this.logoDir, newFileName);

        // Yeni dosyayı kopyala
        await fs.copy(newFile.path, newFilePath);

        // Logo bilgilerini güncelle
        logos[logoIndex].fileName = newFileName;
        logos[logoIndex].filePath = newFilePath;
        logos[logoIndex].originalName = newFile.originalname;
        logos[logoIndex].size = newFile.size;
        logos[logoIndex].mimeType = newFile.mimetype;

        // Geçici dosyayı temizle
        if (await fs.pathExists(newFile.path)) {
          await fs.remove(newFile.path);
        }
      }

      // Kurum bilgilerini güncelle
      logos[logoIndex].kurumId = kurumId || logos[logoIndex].kurumId;
      logos[logoIndex].kurumAdi = kurumAdi || logos[logoIndex].kurumAdi;
      logos[logoIndex].updatedAt = new Date().toISOString();

      await this.saveLogosDb(logos);

      return {
        id: logoId,
        kurumId: logos[logoIndex].kurumId,
        kurumAdi: logos[logoIndex].kurumAdi,
        fileName: logos[logoIndex].fileName,
        updatedAt: logos[logoIndex].updatedAt
      };
    } catch (error) {
      console.error('Logo güncelleme hatası:', error);
      throw error;
    }
  }

  // Logo dosyası için güvenli URL oluştur
  getLogoUrl(logoId) {
    return `/api/logos/${logoId}/file`;
  }

  // API endpoint için logo dosyası serve et
  async serveLogoFile(logoId, res) {
    try {
      const logo = await this.getLogoById(logoId);
      
      if (!logo) {
        return res.status(404).json({ error: 'Logo bulunamadı' });
      }

      if (!await fs.pathExists(logo.filePath)) {
        return res.status(404).json({ error: 'Logo dosyası bulunamadı' });
      }

      // Dosya tipine göre content-type ayarla
      const contentTypes = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.ico': 'image/x-icon',
        '.icns': 'image/icns'
      };

      const ext = path.extname(logo.fileName).toLowerCase();
      const contentType = contentTypes[ext] || 'application/octet-stream';

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `inline; filename="${logo.fileName}"`);
      
      const fileStream = fs.createReadStream(logo.filePath);
      fileStream.pipe(res);

    } catch (error) {
      console.error('Logo dosyası serve etme hatası:', error);
      res.status(500).json({ error: 'Logo dosyası okunamadı' });
    }
  }
}

// Singleton instance export et
module.exports = new LogoService();
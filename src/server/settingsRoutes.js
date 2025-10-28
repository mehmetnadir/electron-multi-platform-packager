const express = require('express');
const router = express.Router();
const { dialog } = require('electron');

let configManager = null;

// ConfigManager'ı set et (main.js'den çağrılacak)
function setConfigManager(manager) {
  configManager = manager;
}

// Tüm ayarları getir
router.get('/settings', (req, res) => {
  try {
    if (!configManager) {
      return res.status(503).json({ error: 'ConfigManager henüz hazır değil' });
    }
    const settings = configManager.getAllSettings();
    res.json(settings);
  } catch (error) {
    console.error('Ayarlar getirilemedi:', error);
    res.status(500).json({ error: 'Ayarlar getirilemedi' });
  }
});

// Ayarları güncelle
router.post('/settings', (req, res) => {
  try {
    const updates = req.body;
    
    Object.keys(updates).forEach(key => {
      configManager.updateSetting(key, updates[key]);
    });
    
    res.json({ success: true, message: 'Ayarlar güncellendi' });
  } catch (error) {
    console.error('Ayarlar güncellenemedi:', error);
    res.status(500).json({ error: 'Ayarlar güncellenemedi' });
  }
});

// Depo bilgilerini getir
router.get('/settings/repository-info', (req, res) => {
  try {
    if (!configManager) {
      return res.status(503).json({ error: 'ConfigManager henüz hazır değil' });
    }
    const info = configManager.getRepositoryInfo();
    res.json(info);
  } catch (error) {
    console.error('Depo bilgileri alınamadı:', error);
    res.status(500).json({ error: 'Depo bilgileri alınamadı' });
  }
});

// Klasör seç (Electron dialog) - Bu endpoint web modunda çalışmaz
router.post('/settings/select-repository', async (req, res) => {
  try {
    if (!configManager) {
      return res.status(503).json({ error: 'ConfigManager henüz hazır değil' });
    }
    
    // Bu endpoint Electron modunda dialog açmaz, sadece IPC kullanılmalı
    res.status(400).json({ 
      error: 'Bu endpoint sadece bilgi amaçlıdır. Klasör seçmek için Electron IPC kullanın.' 
    });
  } catch (error) {
    console.error('Klasör seçilemedi:', error);
    res.status(500).json({ error: error.message });
  }
});

// Ayarları sıfırla
router.post('/settings/reset', (req, res) => {
  try {
    configManager.resetToDefaults();
    res.json({ success: true, message: 'Ayarlar sıfırlandı' });
  } catch (error) {
    console.error('Ayarlar sıfırlanamadı:', error);
    res.status(500).json({ error: 'Ayarlar sıfırlanamadı' });
  }
});

// Son kullanılan projeleri getir
router.get('/settings/recent-projects', (req, res) => {
  try {
    const projects = configManager.getRecentProjects();
    res.json(projects);
  } catch (error) {
    console.error('Son projeler getirilemedi:', error);
    res.status(500).json({ error: 'Son projeler getirilemedi' });
  }
});

// Klasör yollarını getir
router.get('/settings/directories', (req, res) => {
  try {
    const directories = {
      upload: configManager.getUploadDir(),
      logo: configManager.getLogoDir(),
      temp: configManager.getTempDir(),
      output: configManager.getOutputDir()
    };
    res.json(directories);
  } catch (error) {
    console.error('Klasör yolları alınamadı:', error);
    res.status(500).json({ error: 'Klasör yolları alınamadı' });
  }
});

// ==================== YAYINEVİ YÖNETİMİ ====================

// Tüm yayınevlerini getir
router.get('/publishers', (req, res) => {
  try {
    if (!configManager) {
      return res.status(503).json({ error: 'ConfigManager henüz hazır değil' });
    }
    const publishers = configManager.getPublishers();
    res.json(publishers);
  } catch (error) {
    console.error('Yayınevleri getirilemedi:', error);
    res.status(500).json({ error: 'Yayınevleri getirilemedi' });
  }
});

// Yeni yayınevi ekle
router.post('/publishers', (req, res) => {
  try {
    if (!configManager) {
      return res.status(503).json({ error: 'ConfigManager henüz hazır değil' });
    }
    const publisher = configManager.addPublisher(req.body);
    res.json({ success: true, publisher });
  } catch (error) {
    console.error('Yayınevi eklenemedi:', error);
    res.status(500).json({ error: 'Yayınevi eklenemedi: ' + error.message });
  }
});

// Yayınevi güncelle
router.put('/publishers/:id', (req, res) => {
  try {
    if (!configManager) {
      return res.status(503).json({ error: 'ConfigManager henüz hazır değil' });
    }
    const publisher = configManager.updatePublisher(req.params.id, req.body);
    res.json({ success: true, publisher });
  } catch (error) {
    console.error('Yayınevi güncellenemedi:', error);
    res.status(500).json({ error: 'Yayınevi güncellenemedi: ' + error.message });
  }
});

// Yayınevi sil
router.delete('/publishers/:id', (req, res) => {
  try {
    if (!configManager) {
      return res.status(503).json({ error: 'ConfigManager henüz hazır değil' });
    }
    configManager.deletePublisher(req.params.id);
    res.json({ success: true, message: 'Yayınevi silindi' });
  } catch (error) {
    console.error('Yayınevi silinemedi:', error);
    res.status(500).json({ error: 'Yayınevi silinemedi: ' + error.message });
  }
});

// Varsayılan yayınevini ayarla
router.post('/publishers/:id/set-default', (req, res) => {
  try {
    if (!configManager) {
      return res.status(503).json({ error: 'ConfigManager henüz hazır değil' });
    }
    configManager.setDefaultPublisher(req.params.id);
    res.json({ success: true, message: 'Varsayılan yayınevi ayarlandı' });
  } catch (error) {
    console.error('Varsayılan yayınevi ayarlanamadı:', error);
    res.status(500).json({ error: 'Varsayılan yayınevi ayarlanamadı: ' + error.message });
  }
});

// Varsayılan yayınevini getir
router.get('/publishers/default', (req, res) => {
  try {
    if (!configManager) {
      return res.status(503).json({ error: 'ConfigManager henüz hazır değil' });
    }
    const publisher = configManager.getDefaultPublisher();
    res.json(publisher);
  } catch (error) {
    console.error('Varsayılan yayınevi getirilemedi:', error);
    res.status(500).json({ error: 'Varsayılan yayınevi getirilemedi' });
  }
});

module.exports = { router, setConfigManager };

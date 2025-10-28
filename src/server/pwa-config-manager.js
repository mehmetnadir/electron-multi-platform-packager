const fs = require('fs-extra');
const path = require('path');

/**
 * PWA Config Manager
 * PWA paketleri için config veritabanı yönetimi
 */
class PWAConfigManager {
  constructor() {
    this.configDir = path.join(__dirname, '../../pwa-configs');
    this.configFile = path.join(this.configDir, 'configs.json');
    this.ensureConfigFile();
  }

  /**
   * Config dosyasının var olduğundan emin ol
   */
  async ensureConfigFile() {
    await fs.ensureDir(this.configDir);
    
    if (!await fs.pathExists(this.configFile)) {
      const defaultData = {
        configs: [],
        templates: {
          default: {
            downloads: {
              windows: {
                setup: { enabled: true, label: "Windows Kurulum Dosyası", icon: "💻" }
              },
              linux: {
                appimage: { enabled: true, label: "Linux AppImage", icon: "🐧" },
                deb: { enabled: true, label: "Debian/Ubuntu Paketi", icon: "📦" }
              },
              macos: {
                dmg: { enabled: true, label: "macOS Kurulum", icon: "🍎" },
                appstore: { enabled: false, label: "Mac App Store", icon: "🍎" }
              },
              android: {
                apk: { enabled: true, label: "Android APK", icon: "📱" },
                playstore: { enabled: false, label: "Google Play Store", icon: "🤖" }
              },
              ios: {
                appstore: { enabled: false, label: "iOS App Store", icon: "🍎" }
              }
            },
            caching: {
              strategy: "full",
              autoUpdate: true,
              updateInterval: 21600
            },
            ui: {
              showPWAButton: true,
              buttonText: "İndir",
              buttonColor: "#fbbf24",
              popupTitle: "Kurulum Seçenekleri"
            }
          }
        },
        metadata: {
          version: "1.0.0",
          lastUpdated: new Date().toISOString(),
          totalConfigs: 0
        }
      };
      
      await fs.writeJson(this.configFile, defaultData, { spaces: 2 });
      console.log('✅ PWA config veritabanı oluşturuldu');
    }
  }

  /**
   * Tüm config'leri oku
   */
  async getAllConfigs() {
    const data = await fs.readJson(this.configFile);
    return data.configs;
  }

  /**
   * JobId'ye göre config getir
   */
  async getConfig(jobId) {
    const data = await fs.readJson(this.configFile);
    return data.configs.find(c => c.jobId === jobId);
  }

  /**
   * Yeni config oluştur
   */
  async createConfig(jobId, appName, appVersion, options = {}) {
    const data = await fs.readJson(this.configFile);
    
    // Template'den başla
    const template = data.templates.default;
    
    const newConfig = {
      jobId,
      appName,
      appVersion,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      downloads: {
        windows: {
          setup: {
            ...template.downloads.windows.setup,
            url: options.windowsSetupUrl || null,
            size: options.windowsSetupSize || 0,
            enabled: options.windowsSetupEnabled !== false
          }
        },
        linux: {
          appimage: {
            ...template.downloads.linux.appimage,
            url: options.linuxAppImageUrl || null,
            size: options.linuxAppImageSize || 0,
            enabled: options.linuxAppImageEnabled !== false
          },
          deb: {
            ...template.downloads.linux.deb,
            url: options.linuxDebUrl || null,
            size: options.linuxDebSize || 0,
            enabled: options.linuxDebEnabled !== false
          }
        },
        macos: {
          dmg: {
            ...template.downloads.macos.dmg,
            url: options.macosDmgUrl || null,
            size: options.macosDmgSize || 0,
            enabled: options.macosDmgEnabled !== false
          },
          appstore: {
            ...template.downloads.macos.appstore,
            url: options.macosAppStoreUrl || null,
            enabled: options.macosAppStoreEnabled || false
          }
        },
        android: {
          apk: {
            ...template.downloads.android.apk,
            url: options.androidApkUrl || null,
            size: options.androidApkSize || 0,
            enabled: options.androidApkEnabled !== false
          },
          playstore: {
            ...template.downloads.android.playstore,
            url: options.androidPlayStoreUrl || null,
            enabled: options.androidPlayStoreEnabled || false
          }
        },
        ios: {
          appstore: {
            ...template.downloads.ios.appstore,
            url: options.iosAppStoreUrl || null,
            enabled: options.iosAppStoreEnabled || false
          }
        }
      },
      caching: {
        strategy: options.cachingStrategy || template.caching.strategy,
        autoUpdate: options.autoUpdate !== false,
        updateInterval: options.updateInterval || template.caching.updateInterval
      },
      ui: {
        showPWAButton: options.showPWAButton !== false,
        buttonText: options.buttonText || template.ui.buttonText,
        buttonColor: options.buttonColor || template.ui.buttonColor,
        popupTitle: options.popupTitle || template.ui.popupTitle
      }
    };

    data.configs.push(newConfig);
    data.metadata.totalConfigs = data.configs.length;
    data.metadata.lastUpdated = new Date().toISOString();

    await fs.writeJson(this.configFile, data, { spaces: 2 });
    
    console.log(`✅ PWA config oluşturuldu: ${jobId} - ${appName}`);
    return newConfig;
  }

  /**
   * Config güncelle
   */
  async updateConfig(jobId, updates) {
    const data = await fs.readJson(this.configFile);
    const configIndex = data.configs.findIndex(c => c.jobId === jobId);
    
    if (configIndex === -1) {
      throw new Error(`Config bulunamadı: ${jobId}`);
    }

    // Deep merge
    const existingConfig = data.configs[configIndex];
    data.configs[configIndex] = {
      ...existingConfig,
      ...updates,
      updatedAt: new Date().toISOString(),
      downloads: {
        ...existingConfig.downloads,
        ...updates.downloads
      },
      caching: {
        ...existingConfig.caching,
        ...updates.caching
      },
      ui: {
        ...existingConfig.ui,
        ...updates.ui
      }
    };

    data.metadata.lastUpdated = new Date().toISOString();
    await fs.writeJson(this.configFile, data, { spaces: 2 });
    
    console.log(`✅ PWA config güncellendi: ${jobId}`);
    return data.configs[configIndex];
  }

  /**
   * Config sil
   */
  async deleteConfig(jobId) {
    const data = await fs.readJson(this.configFile);
    const initialLength = data.configs.length;
    
    data.configs = data.configs.filter(c => c.jobId !== jobId);
    
    if (data.configs.length === initialLength) {
      throw new Error(`Config bulunamadı: ${jobId}`);
    }

    data.metadata.totalConfigs = data.configs.length;
    data.metadata.lastUpdated = new Date().toISOString();
    
    await fs.writeJson(this.configFile, data, { spaces: 2 });
    
    console.log(`✅ PWA config silindi: ${jobId}`);
    return true;
  }

  /**
   * Config'i PWA paketine ekle
   */
  async exportConfigToPackage(jobId, pwaPath) {
    const config = await this.getConfig(jobId);
    
    if (!config) {
      throw new Error(`Config bulunamadı: ${jobId}`);
    }

    const configPath = path.join(pwaPath, 'pwa-config.json');
    await fs.writeJson(configPath, config, { spaces: 2 });
    
    console.log(`✅ Config PWA paketine eklendi: ${configPath}`);
    return configPath;
  }

  /**
   * Template güncelle
   */
  async updateTemplate(templateName, updates) {
    const data = await fs.readJson(this.configFile);
    
    if (!data.templates[templateName]) {
      throw new Error(`Template bulunamadı: ${templateName}`);
    }

    data.templates[templateName] = {
      ...data.templates[templateName],
      ...updates
    };

    data.metadata.lastUpdated = new Date().toISOString();
    await fs.writeJson(this.configFile, data, { spaces: 2 });
    
    console.log(`✅ Template güncellendi: ${templateName}`);
    return data.templates[templateName];
  }

  /**
   * İstatistikler
   */
  async getStats() {
    const data = await fs.readJson(this.configFile);
    
    return {
      totalConfigs: data.configs.length,
      lastUpdated: data.metadata.lastUpdated,
      cachingStrategies: {
        full: data.configs.filter(c => c.caching.strategy === 'full').length,
        partial: data.configs.filter(c => c.caching.strategy === 'partial').length,
        onDemand: data.configs.filter(c => c.caching.strategy === 'on-demand').length
      },
      platformsEnabled: {
        windows: data.configs.filter(c => c.downloads.windows.setup.enabled).length,
        linux: data.configs.filter(c => c.downloads.linux.appimage.enabled || c.downloads.linux.deb.enabled).length,
        macos: data.configs.filter(c => c.downloads.macos.dmg.enabled).length,
        android: data.configs.filter(c => c.downloads.android.apk.enabled).length,
        ios: data.configs.filter(c => c.downloads.ios.appstore.enabled).length
      }
    };
  }
}

module.exports = new PWAConfigManager();

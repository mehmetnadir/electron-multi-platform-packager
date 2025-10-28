/**
 * PWA Download Manager
 * Ana sayfada "İndir" butonu gösterir ve platform-sensitive download popup açar
 */

class PWADownloadManager {
  constructor() {
    this.config = null;
    this.currentOS = this.detectOS();
    this.isMainPage = this.checkIfMainPage();
    this.deferredPrompt = null;
    this.promptTimeout = null;
    this.init();
    this.setupPWAInstall();
  }

  async init() {
    // Config'i yükle
    await this.loadConfig();
    
    // Sadece ana sayfada butonu göster
    if (this.isMainPage && this.config?.ui?.showPWAButton) {
      this.createDownloadButton();
    }
  }

  async loadConfig() {
    try {
      const response = await fetch('/pwa-config.json');
      this.config = await response.json();
      console.log('[PWA Download] Config yüklendi:', this.config);
    } catch (error) {
      console.error('[PWA Download] Config yükleme hatası:', error);
    }
  }

  detectOS() {
    const userAgent = navigator.userAgent.toLowerCase();
    const platform = navigator.platform.toLowerCase();

    if (/android/.test(userAgent)) return 'android';
    if (/iphone|ipad|ipod/.test(userAgent)) return 'ios';
    if (/mac/.test(platform)) return 'macos';
    if (/win/.test(platform)) return 'windows';
    if (/linux/.test(platform)) return 'linux';
    
    return 'unknown';
  }

  checkIfMainPage() {
    const path = window.location.pathname;
    return path === '/' || path === '/index.html' || path === '';
  }

  setupPWAInstall() {
    // Service Worker mesajlarını dinle
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data.type === 'CACHE_COMPLETE') {
          console.log('[PWA Download] Offline cache tamamlandı:', event.data);
          this.showCacheCompleteNotification(event.data);
        }
      });
    }

    // beforeinstallprompt event'ini yakala (bonus özellik)
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredPrompt = e;
      console.log('[PWA Download] ✅ beforeinstallprompt yakalandı (bonus!)');
      
      // Timeout'u iptal et
      if (this.promptTimeout) {
        clearTimeout(this.promptTimeout);
        this.promptTimeout = null;
      }
    });

    // appinstalled event'ini dinle
    window.addEventListener('appinstalled', () => {
      console.log('[PWA Download] PWA başarıyla kuruldu');
      this.showInstallSuccessNotification();
    });

    // Kullanıcı etkileşimini simüle et (beforeinstallprompt için)
    // Not: Artık zorunlu değil, ama yardımcı olabilir
    setTimeout(() => {
      document.body.click();
    }, 100);

    // PWA kurulduğunda
    window.addEventListener('appinstalled', () => {
      console.log('[PWA Download] PWA başarıyla kuruldu!');
      this.deferredPrompt = null;
      
      // Başarı mesajı göster
      const modal = document.getElementById('pwa-download-modal');
      if (modal) {
        const popup = modal.querySelector('div > div');
        if (popup) {
          popup.innerHTML = `
            <div style="text-align: center; padding: 20px;">
              <div style="font-size: 64px; margin-bottom: 20px;">✅</div>
              <h2 style="margin: 0 0 15px 0; font-size: 24px; color: #10b981;">Başarıyla Kuruldu!</h2>
              <p style="color: #6b7280; margin-bottom: 25px;">Uygulama cihazınıza yüklendi. Artık offline kullanabilirsiniz.</p>
              <button onclick="document.getElementById('pwa-download-modal').remove()" 
                      style="padding: 12px 30px; background: #10b981; color: white; border: none; border-radius: 10px; font-weight: 600; cursor: pointer;">
                Harika!
              </button>
            </div>
          `;
        }
      }
    });

    // Service Worker'ın yüklenmesini bekle
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then(() => {
        console.log('[PWA Download] Service Worker hazır');
        
        // Tarayıcının engagement kriterlerini karşılamak için
        // kullanıcı etkileşimi simüle et
        this.simulateEngagement();
        
        // Biraz bekle, tarayıcı prompt'u hazırlasın
        setTimeout(() => {
          if (!this.deferredPrompt) {
            console.log('[PWA Download] beforeinstallprompt henüz tetiklenmedi');
            console.log('[PWA Download] Not: Tarayıcı, kullanıcının uygulamayı kullandığından emin olmak istiyor');
          } else {
            console.log('[PWA Download] ✅ beforeinstallprompt hazır!');
          }
        }, 5000);
      });
    }
  }

  simulateEngagement() {
    // Tarayıcıya "kullanıcı etkileşimde bulunuyor" sinyali gönder
    // Bu, beforeinstallprompt'un tetiklenmesine yardımcı olur
    
    // Scroll event simüle et
    window.dispatchEvent(new Event('scroll'));
    
    // Visibility change simüle et (kullanıcı sayfayı aktif kullanıyor)
    document.dispatchEvent(new Event('visibilitychange'));
    
    // User interaction simüle et
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    
    console.log('[PWA Download] Kullanıcı etkileşimi simüle edildi');
  }

  async handlePWAInstall() {
    // PWA zaten kurulu mu kontrol et - getInstalledRelatedApps ile
    const installed = await this.isPWAInstalled();
    if (installed) {
      this.showAlreadyInstalledMessage();
      return;
    }

    // beforeinstallprompt varsa HEMEN kullan (tüm platformlarda)
    if (this.deferredPrompt) {
      console.log('[PWA Download] ✅ beforeinstallprompt mevcut, otomatik kurulum başlatılıyor');
      return this.installWithPrompt();
    }

    // beforeinstallprompt yoksa kısa bir süre bekle
    console.log('[PWA Download] beforeinstallprompt bekleniyor...');
    this.showLoadingMessage();
    
    // Platform bazlı bekleme süresi
    const waitTime = this.getWaitTime();
    await new Promise(resolve => setTimeout(resolve, waitTime));
    
    // Tekrar kontrol et
    if (this.deferredPrompt) {
      console.log('[PWA Download] ✅ beforeinstallprompt geç geldi, otomatik kurulum başlatılıyor');
      return this.installWithPrompt();
    }

    // Hala yoksa platform bazlı talimatlar göster
    console.log('[PWA Download] ⚠️ beforeinstallprompt tetiklenmedi, manuel talimatlar gösteriliyor');
    this.showPlatformInstructions();
  }

  /**
   * PWA kurulu mu kontrol et - beforeinstallprompt'a bağımlı DEĞİL
   */
  async isPWAInstalled() {
    // Yöntem 1: getInstalledRelatedApps (en güvenilir)
    if ('getInstalledRelatedApps' in navigator) {
      try {
        const relatedApps = await navigator.getInstalledRelatedApps();
        if (relatedApps.length > 0) {
          console.log('[PWA Download] ✅ PWA kurulu (getInstalledRelatedApps)');
          return true;
        }
      } catch (error) {
        console.log('[PWA Download] getInstalledRelatedApps hatası:', error);
      }
    }
    
    // Yöntem 2: Display mode kontrolü
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
    const isIOSStandalone = window.navigator.standalone === true;
    
    if (isStandalone || isIOSStandalone) {
      console.log('[PWA Download] ✅ PWA kurulu (display-mode)');
      return true;
    }
    
    return false;
  }

  /**
   * Platform bazlı bekleme süresi
   */
  getWaitTime() {
    switch(this.currentOS) {
      case 'android': return 3000; // Android'de prompt geç gelebilir
      case 'windows': return 2000;
      case 'linux': return 2000;
      case 'macos': return 2000; // macOS'ta da bekle (bazen gelir)
      case 'ios': return 500; // iOS'ta asla gelmez, kısa bekle
      default: return 2000;
    }
  }

  /**
   * beforeinstallprompt ile kurulum
   */
  async installWithPrompt() {
    try {
      this.deferredPrompt.prompt();
      const { outcome } = await this.deferredPrompt.userChoice;
      
      if (outcome === 'accepted') {
        console.log('[PWA Download] ✅ Kurulum kabul edildi');
      } else {
        console.log('[PWA Download] ❌ Kurulum reddedildi');
        const modal = document.getElementById('pwa-download-modal');
        if (modal) modal.remove();
      }
      
      this.deferredPrompt = null;
    } catch (error) {
      console.error('[PWA Download] Kurulum hatası:', error);
      this.showPlatformInstructions();
    }
  }

  /**
   * Platform bazlı talimatlar - Her zaman çalışır
   */
  showPlatformInstructions() {
    switch(this.currentOS) {
      case 'android':
        this.showAndroidInstallInstructions();
        break;
      case 'ios':
        this.showManualInstallInstructions();
        break;
      case 'macos':
        this.showManualInstallInstructions();
        break;
      default:
        this.showManualInstallInstructions();
    }
  }

  showLoadingMessage() {
    const modal = document.getElementById('pwa-download-modal');
    if (modal) {
      const popup = modal.querySelector('div > div');
      if (popup) {
        popup.innerHTML = `
          <div style="text-align: center; padding: 40px;">
            <div style="width: 50px; height: 50px; border: 4px solid #e5e7eb; border-top-color: #667eea; border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 20px;"></div>
            <p style="color: #6b7280; margin: 0;">Kurulum hazırlanıyor...</p>
            <style>
              @keyframes spin {
                to { transform: rotate(360deg); }
              }
            </style>
          </div>
        `;
      }
    }
  }

  showAlreadyInstalledMessage() {
    const modal = document.getElementById('pwa-download-modal');
    if (modal) {
      const popup = modal.querySelector('div > div');
      if (popup) {
        popup.innerHTML = `
          <div style="text-align: center; padding: 20px;">
            <div style="font-size: 64px; margin-bottom: 20px;">✅</div>
            <h2 style="margin: 0 0 15px 0; font-size: 24px; color: #10b981;">Zaten Kurulu!</h2>
            <p style="color: #6b7280; margin-bottom: 25px;">Bu uygulama zaten cihazınızda yüklü.</p>
            <button onclick="document.getElementById('pwa-download-modal').remove()" 
                    style="padding: 12px 30px; background: #10b981; color: white; border: none; border-radius: 10px; font-weight: 600; cursor: pointer;">
              Tamam
            </button>
          </div>
        `;
      }
    }
  }

  showCacheCompleteNotification(data) {
    // Küçük bir bildirim göster
    const notification = document.createElement('div');
    notification.style.cssText = `
      position: fixed;
      bottom: 30px;
      left: 30px;
      background: #10b981;
      color: white;
      padding: 16px 24px;
      border-radius: 12px;
      box-shadow: 0 8px 24px rgba(16, 185, 129, 0.3);
      z-index: 10000;
      animation: slideInLeft 0.5s ease;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;
    
    notification.innerHTML = `
      <div style="display: flex; align-items: center; gap: 12px;">
        <div style="font-size: 24px;">✅</div>
        <div>
          <div style="font-weight: 700; margin-bottom: 4px;">Offline Kullanıma Hazır!</div>
          <div style="font-size: 13px; opacity: 0.9;">${data.cached} dosya indirildi</div>
        </div>
      </div>
    `;
    
    // Animasyon CSS'i ekle
    if (!document.getElementById('cache-notification-animations')) {
      const style = document.createElement('style');
      style.id = 'cache-notification-animations';
      style.textContent = `
        @keyframes slideInLeft {
          from {
            transform: translateX(-400px);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
      `;
      document.head.appendChild(style);
    }
    
    document.body.appendChild(notification);
    
    // 5 saniye sonra kaldır
    setTimeout(() => {
      notification.style.animation = 'slideInLeft 0.5s ease reverse';
      setTimeout(() => notification.remove(), 500);
    }, 5000);
  }

  showAndroidInstallInstructions() {
    const browser = this.detectBrowser();
    const modal = document.getElementById('pwa-download-modal');
    if (!modal) return;

    const popup = modal.querySelector('div > div');
    if (!popup) return;

    let browserSpecific = '';
    
    if (browser === 'chrome') {
      browserSpecific = `
        <div style="background: #e8f5e9; padding: 15px; border-radius: 10px; margin-bottom: 20px; border-left: 4px solid #4caf50;">
          <p style="margin: 0 0 10px 0; font-weight: 700; color: #2e7d32; font-size: 16px;">✅ Chrome Tespit Edildi</p>
          <p style="margin: 0; color: #1b5e20; font-size: 14px; line-height: 1.6;">
            Chrome'da PWA kurulumu çok kolay! Aşağıdaki adımları takip edin.
          </p>
        </div>
      `;
    } else if (browser === 'firefox') {
      browserSpecific = `
        <div style="background: #fff3cd; padding: 15px; border-radius: 10px; margin-bottom: 20px; border-left: 4px solid #ffc107;">
          <p style="margin: 0 0 10px 0; font-weight: 700; color: #f57c00; font-size: 16px;">⚠️ Firefox Tespit Edildi</p>
          <p style="margin: 0; color: #e65100; font-size: 14px; line-height: 1.6;">
            Firefox'ta PWA desteği sınırlıdır. Chrome kullanmanızı öneririz.
          </p>
        </div>
      `;
    }

    popup.innerHTML = `
      <div style="text-align: center;">
        <div style="font-size: 64px; margin-bottom: 15px;">📱</div>
        <h2 style="margin: 0 0 10px 0; font-size: 24px; color: #1f2937; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
          Android'de Uygulama Olarak Kur
        </h2>
        <p style="margin: 0 0 25px 0; color: #6b7280; font-size: 14px;">
          Tek tıkla ana ekranınıza ekleyin
        </p>
      </div>

      ${browserSpecific}

      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px; border-radius: 15px; color: white; margin-bottom: 20px;">
        <h3 style="margin: 0 0 15px 0; font-size: 18px; font-weight: 700; text-align: center;">🎯 Kolay Kurulum Adımları</h3>
        
        <div style="background: rgba(255,255,255,0.15); padding: 15px; border-radius: 10px; margin-bottom: 12px; text-align: left;">
          <div style="display: flex; align-items: start; gap: 12px;">
            <div style="background: white; color: #667eea; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; flex-shrink: 0;">1</div>
            <div style="flex: 1;">
              <p style="margin: 0 0 5px 0; font-weight: 600; font-size: 15px;">Sağ üstteki menüyü açın</p>
              <p style="margin: 0; font-size: 13px; opacity: 0.9;">Tarayıcının sağ üst köşesindeki <strong>⋮</strong> (üç nokta) simgesine dokunun</p>
            </div>
          </div>
        </div>

        <div style="background: rgba(255,255,255,0.15); padding: 15px; border-radius: 10px; margin-bottom: 12px; text-align: left;">
          <div style="display: flex; align-items: start; gap: 12px;">
            <div style="background: white; color: #667eea; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; flex-shrink: 0;">2</div>
            <div style="flex: 1;">
              <p style="margin: 0 0 5px 0; font-weight: 600; font-size: 15px;">"Ana ekrana ekle" seçeneğini bulun</p>
              <p style="margin: 0; font-size: 13px; opacity: 0.9;">Menüde <strong>"Ana ekrana ekle"</strong> veya <strong>"Uygulama olarak yükle"</strong> yazısını arayın</p>
            </div>
          </div>
        </div>

        <div style="background: rgba(255,255,255,0.15); padding: 15px; border-radius: 10px; text-align: left;">
          <div style="display: flex; align-items: start; gap: 12px;">
            <div style="background: white; color: #667eea; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; flex-shrink: 0;">3</div>
            <div style="flex: 1;">
              <p style="margin: 0 0 5px 0; font-weight: 600; font-size: 15px;">Kurulumu onaylayın</p>
              <p style="margin: 0; font-size: 13px; opacity: 0.9;">Açılan dialogda <strong>"Ekle"</strong> veya <strong>"Yükle"</strong> butonuna dokunun</p>
            </div>
          </div>
        </div>
      </div>

      <div style="background: #f3f4f6; padding: 15px; border-radius: 10px; margin-bottom: 20px; text-align: left;">
        <p style="margin: 0 0 10px 0; font-weight: 600; color: #1f2937; font-size: 14px;">💡 İpuçları:</p>
        <ul style="margin: 0; padding-left: 20px; color: #4b5563; font-size: 13px; line-height: 1.8;">
          <li>Kurulum sonrası ana ekranınızda bir ikon görünecek</li>
          <li>İkona dokunarak uygulamayı açabilirsiniz</li>
          <li>2-5 dakika içinde offline kullanıma hazır olacak</li>
          <li>"Offline Kullanıma Hazır!" bildirimi gelecek</li>
        </ul>
      </div>

      <div style="display: flex; gap: 10px;">
        <button onclick="window.location.reload()" 
                style="flex: 1; padding: 14px; background: #10b981; color: white; border: none; border-radius: 10px; font-weight: 700; font-size: 15px; cursor: pointer;">
          🔄 Sayfayı Yenile
        </button>
        <button onclick="document.getElementById('pwa-download-modal').remove()" 
                style="flex: 1; padding: 14px; background: #6b7280; color: white; border: none; border-radius: 10px; font-weight: 700; font-size: 15px; cursor: pointer;">
          Anladım
        </button>
      </div>
    `;
  }

  showManualInstallInstructions() {
    const browser = this.detectBrowser();
    const isMacOS = this.currentOS === 'macos';
    let instructions = '';

    switch (browser) {
      case 'chrome':
      case 'edge':
        // macOS için özel talimatlar
        if (isMacOS) {
          instructions = `
            <div style="text-align: center; padding: 20px;">
              <div style="font-size: 64px; margin-bottom: 20px;">⊕</div>
              <h3 style="margin: 0 0 15px 0; font-size: 22px; color: #1f2937;">macOS'ta Kurulum Çok Kolay!</h3>
              <p style="margin: 0 0 25px 0; color: #6b7280; font-size: 15px;">Adres çubuğundaki ⊕ simgesine tıklayın</p>
            </div>
            
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 25px; border-radius: 15px; color: white; margin-bottom: 20px;">
              <h4 style="margin: 0 0 15px 0; font-size: 18px; text-align: center;">🎯 Tek Tıkla Kurulum</h4>
              
              <div style="background: rgba(255,255,255,0.15); padding: 20px; border-radius: 10px; margin-bottom: 15px;">
                <div style="display: flex; align-items: center; gap: 15px; margin-bottom: 15px;">
                  <div style="background: white; color: #667eea; width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 24px; font-weight: bold; flex-shrink: 0;">⊕</div>
                  <div style="flex: 1; text-align: left;">
                    <p style="margin: 0; font-size: 16px; font-weight: 600;">Adres çubuğunun sağındaki</p>
                    <p style="margin: 5px 0 0 0; font-size: 14px; opacity: 0.9;">⊕ (artı) simgesine tıklayın</p>
                  </div>
                </div>
                <div style="background: rgba(0,0,0,0.2); padding: 15px; border-radius: 8px; text-align: center;">
                  <p style="margin: 0; font-size: 13px; opacity: 0.95;">
                    📍 Adres çubuğunun <strong>sağ tarafında</strong><br>
                    🔍 Arama simgesinin <strong>yanında</strong>
                  </p>
                </div>
              </div>
              
              <div style="background: rgba(255,255,255,0.15); padding: 15px; border-radius: 10px;">
                <p style="margin: 0 0 10px 0; font-size: 14px; font-weight: 600;">Alternatif Yöntem:</p>
                <ol style="margin: 0; padding-left: 20px; font-size: 13px; line-height: 1.8;">
                  <li>Sağ üstteki <strong>⋮</strong> (üç nokta) menüsüne tıklayın</li>
                  <li><strong>"Uygulamayı yükle"</strong> veya <strong>"Install Shall We 5"</strong> seçin</li>
                  <li><strong>"Yükle"</strong> butonuna tıklayın</li>
                </ol>
              </div>
            </div>
            
            <div style="background: #f3f4f6; padding: 15px; border-radius: 10px; margin-bottom: 20px;">
              <p style="margin: 0 0 10px 0; font-weight: 600; color: #1f2937; font-size: 14px;">✅ Kurulum Sonrası:</p>
              <ul style="margin: 0; padding-left: 20px; color: #4b5563; font-size: 13px; line-height: 1.8;">
                <li>Dock'ta uygulama ikonu görünecek</li>
                <li>Tam ekran modda açılacak</li>
                <li>2-5 dakika içinde offline kullanıma hazır</li>
                <li>"Offline Kullanıma Hazır!" bildirimi gelecek</li>
              </ul>
            </div>
          `;
        } else {
          // Diğer platformlar için normal talimatlar
          instructions = `
            <div style="text-align: left;">
              <p style="margin-bottom: 15px; font-weight: 600;">Chrome/Edge'de kurulum için:</p>
              <ol style="margin: 0; padding-left: 20px; line-height: 1.8;">
                <li>Adres çubuğunun sağındaki <strong>⋮</strong> (üç nokta) menüsüne tıklayın</li>
                <li><strong>"Ana ekrana ekle"</strong> veya <strong>"Uygulama olarak yükle"</strong> seçeneğini seçin</li>
                <li>Açılan pencerede <strong>"Ekle"</strong> veya <strong>"Yükle"</strong> butonuna tıklayın</li>
              </ol>
              <p style="margin-top: 15px; color: #6b7280; font-size: 14px;">
                💡 Alternatif: Adres çubuğundaki <strong>⊕</strong> (artı) simgesine tıklayabilirsiniz
              </p>
            </div>
          `;
        }
        break;
      case 'safari':
        instructions = `
          <div style="text-align: left;">
            <p style="margin-bottom: 15px; font-weight: 600;">Safari'de kurulum için:</p>
            <ol style="margin: 0; padding-left: 20px; line-height: 1.8;">
              <li>Alt menüdeki <strong>Paylaş</strong> butonuna (📤) tıklayın</li>
              <li><strong>"Ana Ekrana Ekle"</strong> seçeneğini seçin</li>
              <li><strong>"Ekle"</strong> butonuna tıklayın</li>
            </ol>
          </div>
        `;
        break;
      case 'firefox':
        instructions = `
          <div style="text-align: left;">
            <p style="margin-bottom: 15px; font-weight: 600; color: #f59e0b;">⚠️ Firefox masaüstünde PWA desteği sınırlıdır</p>
            
            <p style="margin-bottom: 15px; font-weight: 600;">Önerilen Yöntem 1: PWA Eklentisi</p>
            <ol style="margin: 0 0 20px 0; padding-left: 20px; line-height: 1.8;">
              <li><a href="https://addons.mozilla.org/firefox/addon/pwas-for-firefox/" target="_blank" style="color: #667eea; text-decoration: underline;">PWAs for Firefox</a> eklentisini yükleyin</li>
              <li>Eklenti yüklendikten sonra bu sayfayı PWA olarak kurabilirsiniz</li>
            </ol>
            
            <p style="margin-bottom: 15px; font-weight: 600;">Alternatif: Masaüstü Kısayolu</p>
            <ol style="margin: 0; padding-left: 20px; line-height: 1.8;">
              <li>Sayfayı <strong>yer imlerine</strong> ekleyin</li>
              <li>Yer imi çubuğundan siteyi <strong>masaüstüne sürükleyin</strong></li>
              <li>Artık masaüstünden tek tıkla açabilirsiniz</li>
            </ol>
            
            <p style="margin-top: 15px; color: #6b7280; font-size: 14px;">
              💡 <strong>Not:</strong> Chrome, Edge veya Vivaldi tarayıcılarında tam PWA desteği mevcuttur.
            </p>
          </div>
        `;
        break;
      default:
        instructions = `
          <div style="text-align: left;">
            <p style="margin-bottom: 15px;">Tarayıcınızın menüsünden <strong>"Uygulamayı Yükle"</strong> veya <strong>"Ana Ekrana Ekle"</strong> seçeneğini arayın.</p>
            <p style="color: #6b7280; font-size: 14px;">
              💡 Genellikle adres çubuğunun yanında veya tarayıcı menüsünde bulunur.
            </p>
          </div>
        `;
    }

    // Mevcut modal içeriğini güncelle
    const modal = document.getElementById('pwa-download-modal');
    if (modal) {
      const popup = modal.querySelector('div > div');
      if (popup) {
        popup.innerHTML = `
          <h2 style="margin: 0 0 20px 0; font-size: 24px; color: #1f2937; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
            📱 Tarayıcı Uygulaması Olarak Kur
          </h2>
          ${instructions}
          <button onclick="document.getElementById('pwa-download-modal').remove()" 
                  style="margin-top: 25px; padding: 12px 30px; background: #667eea; color: white; border: none; border-radius: 10px; font-weight: 600; cursor: pointer; width: 100%;">
            Anladım
          </button>
        `;
      }
    }
  }

  detectBrowser() {
    const userAgent = navigator.userAgent.toLowerCase();
    
    if (userAgent.includes('edg')) return 'edge';
    if (userAgent.includes('chrome') && !userAgent.includes('edg')) return 'chrome';
    if (userAgent.includes('safari') && !userAgent.includes('chrome')) return 'safari';
    if (userAgent.includes('firefox')) return 'firefox';
    
    return 'unknown';
  }

  isChromeBased() {
    const userAgent = navigator.userAgent.toLowerCase();
    return userAgent.includes('chrome') || userAgent.includes('chromium') || userAgent.includes('edg');
  }

  isPardus() {
    const userAgent = navigator.userAgent.toLowerCase();
    const platform = navigator.platform.toLowerCase();
    // Pardus Linux kontrolü
    return platform.includes('linux') && !userAgent.includes('android');
  }

  generatePardusNonChromeWarning() {
    const currentUrl = window.location.href;
    const chromeUrl = `google-chrome ${currentUrl}`;
    
    return `
      <div style="margin-bottom: 25px; padding: 20px; background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); border-radius: 15px; color: white;">
        <div style="display: flex; align-items: start; gap: 15px; margin-bottom: 15px;">
          <div style="font-size: 36px;">⚠️</div>
          <div style="text-align: left; flex: 1;">
            <h3 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 700;">Pardus/Linux: Chrome Tarayıcısı Gerekli</h3>
            <p style="margin: 0 0 12px 0; font-size: 14px; opacity: 0.95; line-height: 1.5;">
              PWA (Tarayıcı Uygulaması) kurulumu için <strong>Google Chrome</strong> veya <strong>Chromium</strong> tarayıcısı gereklidir.
              Şu anda <strong>${this.detectBrowser()}</strong> kullanıyorsunuz.
            </p>
            <div style="background: rgba(255,255,255,0.2); padding: 12px; border-radius: 8px; margin-bottom: 12px;">
              <p style="margin: 0 0 8px 0; font-size: 13px; font-weight: 600;">📋 Bu sayfayı Chrome'da açmak için:</p>
              <div style="background: rgba(0,0,0,0.3); padding: 8px 12px; border-radius: 6px; font-family: monospace; font-size: 12px; word-break: break-all; margin-bottom: 8px;">
                ${currentUrl}
              </div>
              <p style="margin: 0; font-size: 12px; opacity: 0.9;">Bu adresi kopyalayıp Chrome'da açın</p>
            </div>
          </div>
        </div>
        <div style="display: flex; gap: 10px; flex-wrap: wrap;">
          <button onclick="navigator.clipboard.writeText('${currentUrl}').then(() => alert('Adres kopyalandı! Chrome\\'da yapıştırın.'))" 
                  style="flex: 1; min-width: 150px; padding: 12px 20px; background: white; color: #d97706; border: none; border-radius: 10px; font-weight: 700; font-size: 14px; cursor: pointer; transition: all 0.2s ease;"
                  onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 12px rgba(0,0,0,0.2)'"
                  onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='none'">
            📋 Adresi Kopyala
          </button>
          <button onclick="window.open('https://www.google.com/chrome/', '_blank')" 
                  style="flex: 1; min-width: 150px; padding: 12px 20px; background: rgba(255,255,255,0.2); color: white; border: 2px solid white; border-radius: 10px; font-weight: 700; font-size: 14px; cursor: pointer; transition: all 0.2s ease;"
                  onmouseover="this.style.background='rgba(255,255,255,0.3)'"
                  onmouseout="this.style.background='rgba(255,255,255,0.2)'">
            🌐 Chrome İndir
          </button>
        </div>
        <p style="margin: 15px 0 0 0; font-size: 12px; opacity: 0.85; text-align: center;">
          💡 <strong>İpucu:</strong> Chrome kurduktan sonra bu sayfayı Chrome'da açın ve PWA olarak kurun
        </p>
      </div>
    `;
  }

  createDownloadButton() {
    // PWA zaten kuruluysa butonu gösterme
    if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone) {
      console.log('[PWA Download] Uygulama zaten kurulu, buton gösterilmiyor');
      return;
    }

    const button = document.createElement('button');
    button.id = 'pwa-download-btn';
    button.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
        <polyline points="7 10 12 15 17 10"></polyline>
        <line x1="12" y1="15" x2="12" y2="3"></line>
      </svg>
      ${this.config.ui.buttonText || 'İndir'}
    `;

    const buttonColor = this.config.ui.buttonColor || '#fbbf24';
    
    button.style.cssText = `
      position: fixed;
      bottom: 30px;
      right: 30px;
      padding: 16px 32px;
      background: ${buttonColor};
      color: #1f2937;
      border: none;
      border-radius: 50px;
      font-size: 18px;
      font-weight: 700;
      cursor: pointer;
      box-shadow: 0 6px 25px ${buttonColor}80;
      display: flex;
      align-items: center;
      gap: 10px;
      z-index: 9999;
      transition: all 0.3s ease;
      animation: slideIn 0.5s ease;
      letter-spacing: 0.5px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;

    // Hover efekti
    button.onmouseenter = () => {
      button.style.transform = 'translateY(-3px) scale(1.05)';
      button.style.boxShadow = `0 10px 35px ${buttonColor}CC`;
    };

    button.onmouseleave = () => {
      button.style.transform = 'translateY(0) scale(1)';
      button.style.boxShadow = `0 6px 25px ${buttonColor}80`;
    };

    button.onclick = () => this.showDownloadPopup();

    // Animasyon CSS'i ekle
    if (!document.getElementById('pwa-download-animations')) {
      const style = document.createElement('style');
      style.id = 'pwa-download-animations';
      style.textContent = `
        @keyframes slideIn {
          from {
            transform: translateX(400px);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
        
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        
        @keyframes slideUp {
          from {
            transform: translateY(20px);
            opacity: 0;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(button);
    console.log('[PWA Download] İndir butonu eklendi');
  }

  showDownloadPopup() {
    // Mevcut popup'ı kapat
    const existingModal = document.getElementById('pwa-download-modal');
    if (existingModal) {
      existingModal.remove();
    }

    const modal = document.createElement('div');
    modal.id = 'pwa-download-modal';
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(5px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      animation: fadeIn 0.3s ease;
    `;

    const popup = document.createElement('div');
    popup.style.cssText = `
      background: white;
      border-radius: 20px;
      padding: 40px;
      max-width: 600px;
      width: 90%;
      max-height: 80vh;
      overflow-y: auto;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      animation: slideUp 0.3s ease;
    `;

    popup.innerHTML = `
      <h2 style="margin: 0 0 10px 0; font-size: 28px; color: #1f2937; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
        ${this.config.ui.popupTitle || 'Kurulum Seçenekleri'}
      </h2>
      <p style="margin: 0 0 30px 0; color: #6b7280; font-size: 14px;">
        Cihazınıza uygun kurulum dosyasını seçin veya tüm seçenekleri görün
      </p>
      ${this.generateDownloadOptions()}
    `;

    modal.appendChild(popup);
    document.body.appendChild(modal);

    // Modal dışına tıklayınca kapat
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.remove();
      }
    });

    // PWA install butonuna event listener ekle
    const installBtn = document.getElementById('pwa-install-btn');
    if (installBtn) {
      installBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.handlePWAInstall();
      });
    }

    console.log('[PWA Download] Popup açıldı');
  }

  generateDownloadOptions() {
    const downloads = this.config.downloads;
    let html = '';

    // Pardus/Linux için özel kontrol
    const isPardus = this.isPardus();
    const isChrome = this.isChromeBased();

    // Pardus'ta Chrome değilse uyarı göster
    if (isPardus && !isChrome) {
      html += this.generatePardusNonChromeWarning();
    }

    // PWA Kurulum Butonu (En üstte)
    const pwaButtonDisabled = isPardus && !isChrome;
    const pwaButtonStyle = pwaButtonDisabled 
      ? 'padding: 14px 40px; background: #9ca3af; color: white; border: none; border-radius: 10px; font-weight: 700; font-size: 16px; cursor: not-allowed; box-shadow: 0 4px 12px rgba(0,0,0,0.15);'
      : 'padding: 14px 40px; background: white; color: #059669; border: none; border-radius: 10px; font-weight: 700; font-size: 16px; cursor: pointer; transition: all 0.2s ease; box-shadow: 0 4px 12px rgba(0,0,0,0.15);';

    html += `
      <div style="margin-bottom: 30px; padding: 25px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); border-radius: 15px; color: white; text-align: center;">
        <div style="display: flex; align-items: center; justify-content: center; gap: 15px; margin-bottom: 15px;">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
            <line x1="8" y1="21" x2="16" y2="21"></line>
            <line x1="12" y1="17" x2="12" y2="21"></line>
          </svg>
          <div style="text-align: left;">
            <h3 style="margin: 0 0 5px 0; font-size: 22px; font-weight: 700;">Tarayıcı Uygulaması Olarak Kur</h3>
            <p style="margin: 0; font-size: 14px; opacity: 0.9;">İnternetsiz erişim için hazır edilecek</p>
          </div>
        </div>
        <button id="pwa-install-btn" 
                ${pwaButtonDisabled ? 'disabled' : ''}
                style="${pwaButtonStyle}"
                ${!pwaButtonDisabled ? `onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 6px 20px rgba(0,0,0,0.2)'" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 12px rgba(0,0,0,0.15)'"` : ''}>
          ${pwaButtonDisabled ? '⚠️ Chrome Gerekli' : '🚀 Şimdi Kur'}
        </button>
      </div>
    `;

    // Diğer platformlar - Grid görünüm
    html += '<h3 style="margin: 0 0 20px 0; font-size: 18px; color: #1f2937; font-weight: 600;">Diğer Platformlar</h3>';
    html += '<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 15px;">';

    // Windows
    if (downloads.windows?.setup?.enabled && downloads.windows.setup.url) {
      html += this.createPlatformGridCard('Windows', '💻', downloads.windows.setup, '#0078d4');
    }

    // Linux AppImage
    if (downloads.linux?.appimage?.enabled && downloads.linux.appimage.url) {
      html += this.createPlatformGridCard('Linux AppImage', '🐧', downloads.linux.appimage, '#fcc624');
    }
    
    // Pardus (Linux DEB)
    if (downloads.linux?.deb?.enabled && downloads.linux.deb.url) {
      html += this.createPlatformGridCard('Pardus', '🦁', downloads.linux.deb, '#e74c3c');
    }

    // macOS
    if (downloads.macos?.dmg?.enabled && downloads.macos.dmg.url) {
      html += this.createPlatformGridCard('macOS', '🍎', downloads.macos.dmg, '#000000');
    }
    if (downloads.macos?.appstore?.enabled && downloads.macos.appstore.url) {
      html += this.createPlatformGridCard('Mac App Store', '🍎', downloads.macos.appstore, '#0071e3');
    }

    // Android
    if (downloads.android?.apk?.enabled && downloads.android.apk.url) {
      html += this.createPlatformGridCard('Android APK', '🤖', downloads.android.apk, '#3ddc84');
    }
    if (downloads.android?.playstore?.enabled && downloads.android.playstore.url) {
      html += this.createPlatformGridCard('Google Play', '▶️', downloads.android.playstore, '#01875f');
    }

    // iOS
    if (downloads.ios?.appstore?.enabled && downloads.ios.appstore.url) {
      html += this.createPlatformGridCard('iOS App Store', '🍎', downloads.ios.appstore, '#0071e3');
    }

    html += '</div>';
    return html;
  }

  getPriorityPlatform() {
    const downloads = this.config.downloads;
    
    switch (this.currentOS) {
      case 'windows':
        if (downloads.windows?.setup?.enabled && downloads.windows.setup.url) {
          return {
            label: 'Windows',
            icon: '💻',
            downloads: [downloads.windows.setup]
          };
        }
        break;
      case 'macos':
        if (downloads.macos?.dmg?.enabled && downloads.macos.dmg.url) {
          return {
            label: 'macOS',
            icon: '🍎',
            downloads: [downloads.macos.dmg]
          };
        }
        break;
      case 'linux':
        const linuxDownloads = [];
        if (downloads.linux?.appimage?.enabled && downloads.linux.appimage.url) {
          linuxDownloads.push(downloads.linux.appimage);
        }
        if (downloads.linux?.deb?.enabled && downloads.linux.deb.url) {
          linuxDownloads.push(downloads.linux.deb);
        }
        if (linuxDownloads.length > 0) {
          return {
            label: 'Linux',
            icon: '🐧',
            downloads: linuxDownloads
          };
        }
        break;
      case 'android':
        if (downloads.android?.apk?.enabled && downloads.android.apk.url) {
          return {
            label: 'Android',
            icon: '📱',
            downloads: [downloads.android.apk]
          };
        }
        break;
      case 'ios':
        if (downloads.ios?.appstore?.enabled && downloads.ios.appstore.url) {
          return {
            label: 'iOS',
            icon: '🍎',
            downloads: [downloads.ios.appstore]
          };
        }
        break;
    }
    
    return null;
  }

  generatePlatformButtons(downloads, isPriority = false) {
    return downloads.map(download => {
      const size = download.size ? this.formatBytes(download.size) : '';
      const sizeText = size ? ` (${size})` : '';
      
      return `
        <a href="${download.url}" 
           style="display: inline-block; padding: 12px 24px; background: ${isPriority ? 'white' : '#667eea'}; color: ${isPriority ? '#667eea' : 'white'}; text-decoration: none; border-radius: 10px; font-weight: 600; margin-right: 10px; margin-bottom: 10px; transition: all 0.2s ease;"
           onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 12px rgba(0,0,0,0.15)'"
           onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='none'">
          ${download.label || 'İndir'}${sizeText}
        </a>
      `;
    }).join('');
  }

  createPlatformGridCard(title, icon, download, color) {
    const size = download.size ? this.formatBytes(download.size) : '';
    
    return `
      <a href="${download.url}" 
         style="display: block; padding: 20px; background: white; border: 2px solid #e5e7eb; border-radius: 12px; text-decoration: none; transition: all 0.2s ease; text-align: center;"
         onmouseover="this.style.borderColor='${color}'; this.style.transform='translateY(-4px)'; this.style.boxShadow='0 8px 20px rgba(0,0,0,0.1)'"
         onmouseout="this.style.borderColor='#e5e7eb'; this.style.transform='translateY(0)'; this.style.boxShadow='none'">
        <div style="font-size: 48px; margin-bottom: 12px;">${icon}</div>
        <div style="font-weight: 700; color: #1f2937; margin-bottom: 6px; font-size: 16px;">${title}</div>
        ${size ? `<div style="font-size: 13px; color: #6b7280; margin-bottom: 12px;">${size}</div>` : ''}
        <div style="display: inline-block; padding: 8px 20px; background: ${color}; color: white; border-radius: 8px; font-weight: 600; font-size: 14px;">
          İndir
        </div>
      </a>
    `;
  }

  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  }
}

// Sayfa yüklendiğinde başlat
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    new PWADownloadManager();
  });
} else {
  new PWADownloadManager();
}

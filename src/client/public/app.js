class ElectronPackagerWizard {
    constructor() {
        this.currentStep = 1;
        this.totalSteps = 4; // 4 adım: Build → Paket Bilgileri → Platform → Paketleme Modu
        this.sessionId = null;
        this.selectedPlatforms = [];
        this.uploadedFile = null;
        this.socket = null;
        this.activeJobs = new Map();
        this.completedJobs = [];
        this.pendingJobs = new Map(); // ZIP açma bekleme
        this.isSubmitting = false;
        this.zipExtractionComplete = false;
        this.isPackaging = false;
        this.pendingPackaging = false;
        
        // LocalStorage'dan yükle
        this.loadFromStorage();
        
        this.init();
        
        // Konsol hata tespiti
        this.setupErrorMonitoring();
    }

    setupErrorMonitoring() {
        console.log('🔍 Konsol hata monitörü aktif');
        
        // SyntaxError ve diğer hataları yakala
        window.addEventListener('error', (event) => {
            console.error('🚨 JAVASCRIPT HATASI TESPİT EDİLDİ:');
            console.error('❌ Mesaj:', event.message);
            console.error('❌ Dosya:', event.filename);
            console.error('❌ Satır:', event.lineno);
            console.error('❌ Kolon:', event.colno);
            console.error('❌ Error:', event.error);
            
            // Bildirim göster
            this.showNotification(
                '🚨 JavaScript Hatası', 
                `${event.message} (${event.filename}:${event.lineno})`,
                'error'
            );
        });

        // Promise rejection'ları yakala
        window.addEventListener('unhandledrejection', (event) => {
            console.error('🚨 Promise HATASI:');
            console.error('❌ Reason:', event.reason);
            
            this.showNotification(
                '🚨 Promise Hatası',
                event.reason?.message || event.reason,
                'error'
            );
        });

        // Console.error Override
        const originalError = console.error;
        console.error = (...args) => {
            originalError.apply(console, args);
            
            // Hata mesajını kontrol et
            const message = args.join(' ');
            if (message.includes('SyntaxError') || 
                message.includes('Uncaught') ||
                message.includes('ReferenceError') ||
                message.includes('TypeError')) {
                
                this.showNotification(
                    '🚨 Konsol Hatası',
                    message.substring(0, 100) + '...',
                    'error'
                );
            }
        };

        console.log('✅ Hata monitörü kuruldu - Her açılışta aktif');
    }
    
    loadFromStorage() {
        try {
            // Aktif işleri yükle
            const savedActiveJobs = localStorage.getItem('activeJobs');
            if (savedActiveJobs) {
                const jobsArray = JSON.parse(savedActiveJobs);
                const now = Date.now();
                const maxAge = 24 * 60 * 60 * 1000; // 24 saat
                
                jobsArray.forEach(([key, value]) => {
                    // Date objelerini geri yükle
                    if (value.queuedAt) value.queuedAt = new Date(value.queuedAt);
                    
                    // 24 saatten eski job'ları atla
                    if (value.queuedAt && (now - value.queuedAt.getTime()) > maxAge) {
                        console.log('⏰ Eski job atlandı:', key, '(', Math.floor((now - value.queuedAt.getTime()) / 1000 / 60 / 60), 'saat önce)');
                        return;
                    }
                    
                    this.activeJobs.set(key, value);
                });
                console.log('✅ Aktif işler localStorage\'dan yüklendi:', this.activeJobs.size);
            }
            
            // Tamamlanan işleri yükle
            const savedCompletedJobs = localStorage.getItem('completedJobs');
            if (savedCompletedJobs) {
                this.completedJobs = JSON.parse(savedCompletedJobs);
                // Date objelerini geri yükle
                this.completedJobs.forEach(job => {
                    if (job.completedAt) job.completedAt = new Date(job.completedAt);
                });
                console.log('✅ Tamamlanan işler localStorage\'dan yüklendi:', this.completedJobs.length);
            }
        } catch (error) {
            console.error('❌ LocalStorage yükleme hatası:', error);
        }
    }
    
    saveToStorage() {
        try {
            // Aktif işleri kaydet
            const jobsArray = Array.from(this.activeJobs.entries());
            localStorage.setItem('activeJobs', JSON.stringify(jobsArray));
            
            // Tamamlanan işleri kaydet
            localStorage.setItem('completedJobs', JSON.stringify(this.completedJobs));
        } catch (error) {
            console.error('❌ LocalStorage kaydetme hatası:', error);
        }
    }

    init() {
        console.log('🎬 ElectronPackagerWizard.init() BAŞLATILDI');
        
        this.setupSocketIO();
        this.setupEventListeners();
        this.updateWizardUI();
        
        // Yayınevlerini yükle
        console.log('🏢 loadPublishers() çağrılıyor...');
        this.loadPublishers();
        
        // Yüklenen işleri göster
        if (this.activeJobs.size > 0 || this.completedJobs.length > 0) {
            this.updateSidebar();
        }
    }

    setupSocketIO() {
        this.socket = io();
        
        this.socket.on('connect', () => {
            console.log('Socket.IO bağlandı');
        });

        this.socket.on('disconnect', () => {
            console.log('Socket.IO bağlantısı kesildi');
        });

        // ZIP events
        this.socket.on('zip-extraction-started', this.handleZipExtractionStarted.bind(this));
        this.socket.on('zip-extraction-progress', this.handleZipExtractionProgress.bind(this));
        this.socket.on('zip-extraction-completed', this.handleZipExtractionCompleted.bind(this));
        this.socket.on('zip-extraction-failed', this.handleZipExtractionFailed.bind(this));

        // Packaging events
        this.socket.on('packaging-queued', this.handlePackagingQueued.bind(this));
        this.socket.on('packaging-started', this.handlePackagingStarted.bind(this));
        this.socket.on('packaging-progress', this.handlePackagingProgress.bind(this));
        this.socket.on('packaging-completed', this.handlePackagingCompleted.bind(this));
        this.socket.on('packaging-failed', this.handlePackagingFailed.bind(this));
    }

    setupEventListeners() {
        // Navigation buttons
        document.getElementById('btnNext').addEventListener('click', () => this.nextStep());
        document.getElementById('btnPrev').addEventListener('click', () => this.prevStep());

        // Upload
        const uploadArea = document.getElementById('uploadArea');
        const zipInput = document.getElementById('zipInput');

        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        });

        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('dragover');
        });

        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            const files = e.dataTransfer.files;
            if (files.length > 0 && files[0].name.endsWith('.zip')) {
                this.handleFileUpload(files[0]);
            }
        });

        zipInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.handleFileUpload(e.target.files[0]);
            }
        });

        // Platform selection
        document.querySelectorAll('.platform-card').forEach(card => {
            card.addEventListener('click', () => {
                const platform = card.dataset.platform;
                this.togglePlatform(platform, card);
            });
        });

        // Form validation
        document.getElementById('appName').addEventListener('input', () => {
            this.validateAppName();
        });

        document.getElementById('appVersion').addEventListener('input', () => {
            this.validateVersion();
        });

        // PWA URL auto-checkbox
        this.setupPWAAutoCheckbox();
    }

    setupPWAAutoCheckbox() {
        // PWA platform URL input'larını ve checkbox'larını eşleştir
        const pwaInputs = [
            { urlId: 'pwaWindowsUrl', checkboxId: 'pwaWindowsEnabled' },
            { urlId: 'pwaLinuxAppImageUrl', checkboxId: 'pwaLinuxAppImageEnabled' },
            { urlId: 'pwaLinuxDebUrl', checkboxId: 'pwaLinuxDebEnabled' },
            { urlId: 'pwaMacOSDmgUrl', checkboxId: 'pwaMacOSDmgEnabled' },
            { urlId: 'pwaMacOSAppStoreUrl', checkboxId: 'pwaMacOSAppStoreEnabled' },
            { urlId: 'pwaAndroidApkUrl', checkboxId: 'pwaAndroidApkEnabled' },
            { urlId: 'pwaAndroidPlayStoreUrl', checkboxId: 'pwaAndroidPlayStoreEnabled' },
            { urlId: 'pwaIOSAppStoreUrl', checkboxId: 'pwaIOSAppStoreEnabled' }
        ];

        pwaInputs.forEach(({ urlId, checkboxId }) => {
            const urlInput = document.getElementById(urlId);
            const checkbox = document.getElementById(checkboxId);

            if (urlInput && checkbox) {
                // URL girildiğinde checkbox'ı otomatik işaretle
                urlInput.addEventListener('input', () => {
                    const hasValue = urlInput.value.trim().length > 0;
                    checkbox.checked = hasValue;
                });

                // Checkbox kaldırıldığında URL'yi temizle
                checkbox.addEventListener('change', () => {
                    if (!checkbox.checked) {
                        urlInput.value = '';
                        // Size input'u da varsa temizle
                        const sizeInput = document.getElementById(urlId.replace('Url', 'Size'));
                        if (sizeInput) {
                            sizeInput.value = '';
                        }
                    }
                });
            }
        });
    }

    async handleFileUpload(file) {
        this.uploadedFile = file;
        const uploadArea = document.getElementById('uploadArea');
        const uploadProgress = document.getElementById('uploadProgress');
        
        uploadProgress.classList.add('show');
        
        const formData = new FormData();
        formData.append('files', file);
        formData.append('sessionId', `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`);
        formData.append('appName', 'Temp');
        formData.append('appVersion', '1.0.0');
        formData.append('description', '');

        try {
            const xhr = new XMLHttpRequest();
            
            xhr.upload.addEventListener('progress', (e) => {
                if (e.lengthComputable) {
                    const percent = Math.round((e.loaded / e.total) * 100);
                    document.getElementById('uploadProgressFill').style.width = percent + '%';
                    document.getElementById('uploadPercent').textContent = percent + '%';
                }
            });

            xhr.addEventListener('load', () => {
                if (xhr.status === 200) {
                    const response = JSON.parse(xhr.responseText);
                    this.sessionId = response.sessionId;
                    this.zipUploadComplete = true;
                    
                    uploadArea.classList.add('uploaded');
                    uploadArea.querySelector('h4').textContent = '✓ Dosya Yüklendi - ZIP Açılıyor...';
                    uploadArea.querySelector('p').textContent = file.name;
                    
                    // Progress'i gizleme, ZIP açılma durumunu göster
                    document.getElementById('uploadStatus').textContent = 'ZIP açılıyor...';
                }
            });

            xhr.open('POST', '/api/upload-build');
            xhr.send(formData);
            
        } catch (error) {
            console.error('Upload hatası:', error);
            alert('Dosya yüklenirken hata oluştu');
            uploadProgress.classList.remove('show');
        }
    }

    togglePlatform(platform, card) {
        const index = this.selectedPlatforms.indexOf(platform);
        
        console.log(`🎯 Platform toggle: ${platform}, Current: [${this.selectedPlatforms.join(', ')}]`);
        
        if (index > -1) {
            this.selectedPlatforms.splice(index, 1);
            card.classList.remove('selected');
        } else {
            this.selectedPlatforms.push(platform);
            card.classList.add('selected');
        }
        
        // PWA seçildiğinde config formunu göster/gizle
        const pwaConfigForm = document.getElementById('pwaConfigForm');
        if (platform === 'pwa') {
            if (this.selectedPlatforms.includes('pwa')) {
                pwaConfigForm.style.display = 'block';
                // Smooth scroll to form
                setTimeout(() => {
                    pwaConfigForm.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }, 100);
            } else {
                pwaConfigForm.style.display = 'none';
            }
        }
        
        this.hidePlatformError();
    }

    validateAppName() {
        const appName = document.getElementById('appName').value.trim();
        const errorEl = document.getElementById('appNameError');
        const inputEl = document.getElementById('appName');
        
        if (!appName) {
            inputEl.classList.add('error');
            errorEl.classList.add('show');
            return false;
        }
        
        inputEl.classList.remove('error');
        errorEl.classList.remove('show');
        return true;
    }

    validateVersion() {
        const version = document.getElementById('appVersion').value.trim();
        const errorEl = document.getElementById('appVersionError');
        const inputEl = document.getElementById('appVersion');
        
        // Semver regex: major.minor.patch
        const semverRegex = /^\d+\.\d+\.\d+$/;
        
        if (!version || !semverRegex.test(version)) {
            inputEl.classList.add('error');
            errorEl.classList.add('show');
            return false;
        }
        
        inputEl.classList.remove('error');
        errorEl.classList.remove('show');
        return true;
    }

    hidePlatformError() {
        document.getElementById('platformError').classList.remove('show');
    }

    canProceedFromStep(step) {
        switch (step) {
            case 1:
                // ZIP yükleme başladı mı? (tamamlanmasını bekleme)
                return this.uploadedFile !== null;
            
            case 2:
                // Paket adı, versiyon ve yayınevi girildi mi?
                const appName = document.getElementById('appName');
                const appVersion = document.getElementById('appVersion');
                const publisherSelect = document.getElementById('publisherSelect');
                
                if (!appName || !appName.value.trim()) {
                    console.warn('⚠️ Paket adı girilmedi');
                    if (appName) {
                        appName.classList.add('error');
                        document.getElementById('appNameError')?.classList.add('show');
                    }
                    return false;
                }
                
                if (!appVersion || !appVersion.value.trim()) {
                    console.warn('⚠️ Versiyon girilmedi');
                    if (appVersion) {
                        appVersion.classList.add('error');
                        document.getElementById('appVersionError')?.classList.add('show');
                    }
                    return false;
                }
                
                if (!publisherSelect || !publisherSelect.value) {
                    console.warn('⚠️ Yayınevi seçilmedi');
                    if (publisherSelect) {
                        publisherSelect.classList.add('error');
                        document.getElementById('publisherError')?.classList.add('show');
                    }
                    return false;
                }
                
                // Clear errors
                appName?.classList.remove('error');
                appVersion?.classList.remove('error');
                publisherSelect?.classList.remove('error');
                document.getElementById('appNameError')?.classList.remove('show');
                document.getElementById('appVersionError')?.classList.remove('show');
                document.getElementById('publisherError')?.classList.remove('show');
                
                return true;
            
            case 3:
                // En az bir platform seçildi mi?
                console.log(`✅ Step 3 validation - Platforms: [${this.selectedPlatforms.join(', ')}]`);
                if (this.selectedPlatforms.length === 0) {
                    console.warn('⚠️ Platform seçilmedi!');
                    document.getElementById('platformError').classList.add('show');
                    return false;
                }
                this.hidePlatformError();
                return true;
            
            case 4:
                // Paketleme modu seçildi mi?
                const packagingMode = document.querySelector('[name="packagingMode"]:checked');
                if (!packagingMode) {
                    console.warn('⚠️ Paketleme modu seçilmedi');
                    return false;
                }
                
                // Eğer "upload" modu seçildiyse, kitap bilgileri gerekli
                if (packagingMode.value === 'upload') {
                    const bookType = document.querySelector('[name="bookType"]:checked');
                    if (!bookType) {
                        console.warn('⚠️ Kitap türü seçilmedi');
                        return false;
                    }
                    
                    // Yeni kitap ise form validasyonu
                    if (bookType.value === 'new') {
                        const bookName = document.getElementById('bookName');
                        const bookVersion = document.getElementById('bookVersion');
                        if (!bookName || !bookName.value.trim()) {
                            console.warn('⚠️ Kitap adı girilmedi');
                            return false;
                        }
                        if (!bookVersion || !bookVersion.value.trim()) {
                            console.warn('⚠️ Kitap versiyonu girilmedi');
                            return false;
                        }
                    }
                }
                
                return true;
            
            default:
                return false;
        }
    }

    async nextStep() {
        console.log(`➡️ nextStep() çağrıldı - Mevcut: ${this.currentStep}, Total: ${this.totalSteps}`);
        
        if (!this.canProceedFromStep(this.currentStep)) {
            console.log(`⛔ Validation başarısız - Step ${this.currentStep} geçilemedi`);
            return;
        }

        if (this.currentStep < this.totalSteps) {
            // Mark current step as completed
            this.markStepCompleted(this.currentStep);
            
            console.log(`✅ Step ${this.currentStep} tamamlandı, ${this.currentStep + 1}'e geçiliyor`);
            this.currentStep++;
            
            // Step 2'ye geçerken yayınevlerini yükle
            if (this.currentStep === 2) {
                console.log('📚 Step 2: Yayınevleri yükleniyor...');
                await this.loadPublishers();
                this.updatePublisherDropdown();
            }
            
            this.updateWizardUI();
        } else if (this.currentStep === this.totalSteps) {
            // 3. adımdan sonra paketlemeyi başlat
            await this.startPackaging();
            
            // Bildirim göster
            this.showNotification('Kuyruğa Eklendi', 'İşlem kuyruğa alındı. Yeni iş ekleyebilirsiniz!', 'success');
            
            // 1. adıma dön ve formu sıfırla
            setTimeout(() => {
                this.resetWizard();
            }, 1500);
        }
    }
    
    resetWizard() {
        // Tüm adımları sıfırla
        this.currentStep = 1;
        this.sessionId = null;
        this.selectedPlatforms = [];
        this.uploadedFile = null;
        this.zipUploadComplete = false;
        this.zipExtractionComplete = false;
        
        // UI'ı sıfırla
        document.querySelectorAll('.wizard-step').forEach(step => {
            step.classList.remove('active', 'completed');
        });
        
        // Upload area'yı sıfırla
        const uploadArea = document.getElementById('uploadArea');
        uploadArea.classList.remove('uploaded');
        uploadArea.querySelector('h4').textContent = 'ZIP Dosyasını Buraya Sürükleyin';
        uploadArea.querySelector('p').textContent = 'veya dosya seçme butonunu kullanın';
        document.getElementById('uploadProgress').classList.remove('show');
        document.getElementById('zipInput').value = '';
        
        // Form alanlarını sıfırla
        const appNameEl = document.getElementById('appName');
        const appVersionEl = document.getElementById('appVersion');
        const appDescriptionEl = document.getElementById('appDescription');
        
        if (appNameEl) appNameEl.value = '';
        if (appVersionEl) appVersionEl.value = '';
        if (appDescriptionEl) appDescriptionEl.value = '';
        
        // Platform seçimlerini temizle
        document.querySelectorAll('.platform-card').forEach(card => {
            card.classList.remove('selected');
        });
        
        this.updateWizardUI();
    }
    
    showNotification(title, message, type) {
        // Basit bir toast notification
        const toast = document.createElement('div');
        toast.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${type === 'success' ? '#28a745' : '#667eea'};
            color: white;
            padding: 15px 20px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
            z-index: 10000;
            animation: slideIn 0.3s ease;
        `;
        toast.innerHTML = `<strong>${title}</strong><br>${message}`;
        document.body.appendChild(toast);
        
        setTimeout(() => {
            toast.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    prevStep() {
        if (this.currentStep > 1) {
            this.currentStep--;
            this.updateWizardUI();
        }
    }

    markStepCompleted(step) {
        const stepEl = document.querySelector(`.wizard-step[data-step="${step}"]`);
        if (stepEl) {
            stepEl.classList.add('completed');
            stepEl.classList.remove('active');
        }
    }

    updateWizardUI() {
        // Update step indicators
        document.querySelectorAll('.wizard-step').forEach((step, index) => {
            const stepNum = index + 1;
            if (stepNum === this.currentStep) {
                step.classList.add('active');
                step.classList.remove('completed');
            } else if (stepNum < this.currentStep) {
                step.classList.add('completed');
                step.classList.remove('active');
            } else {
                step.classList.remove('active', 'completed');
            }
        });

        // Update content
        document.querySelectorAll('.step-content').forEach((content, index) => {
            const stepNum = index + 1;
            if (stepNum === this.currentStep) {
                content.classList.add('active');
            } else {
                content.classList.remove('active');
            }
        });

        // Update buttons
        const btnPrev = document.getElementById('btnPrev');
        const btnNext = document.getElementById('btnNext');

        if (this.currentStep === 1) {
            btnPrev.style.visibility = 'hidden';
        } else {
            btnPrev.style.visibility = 'visible';
        }

        btnNext.style.display = 'inline-flex';
        
        console.log(`🔘 Button update - Step: ${this.currentStep}/${this.totalSteps}`);
        
        if (this.currentStep === this.totalSteps) {
            // Son adımda "Başlat" butonu
            btnNext.innerHTML = 'Başlat ve Kuyruğa Ekle <i class="fas fa-rocket"></i>';
            console.log('  → Buton: BAŞLAT');
        } else {
            // Diğer adımlarda "İleri" butonu
            btnNext.innerHTML = 'İleri <i class="fas fa-arrow-right"></i>';
            console.log('  → Buton: İLERİ');
        }
    }

    showSummary() {
        const appName = document.getElementById('appName').value;
        const version = document.getElementById('appVersion').value;
        const platforms = this.selectedPlatforms.map(p => {
            const names = {
                'windows': 'Windows',
                'macos': 'macOS',
                'linux': 'Linux',
                'android': 'Android',
                'pwa': 'PWA'
            };
            return names[p] || p;
        }).join(', ');

        document.getElementById('summaryAppName').textContent = appName;
        document.getElementById('summaryVersion').textContent = version;
        document.getElementById('summaryPlatforms').textContent = platforms;
        document.getElementById('summaryZip').textContent = this.uploadedFile ? this.uploadedFile.name : '-';
    }

    async startPackaging() {
        // Duplicate request önleme
        if (this.isSubmitting) {
            console.log('⚠️ Zaten bir paketleme isteği gönderildi, bekleniyor...');
            return;
        }
        
        // ZIP dosyası upload kontrolü
        if (!this.uploadedFile) {
            alert('Lütfen önce ZIP dosyası yükleyin!');
            return;
        }

        // ZIP açma tamamlandı mı kontrol et
        if (!this.zipExtractionComplete) {
            console.log('⏳ ZIP açma tamamlanmadı, kuyruğa ekleniyor...');
            this.addToPendingQueue();
            return;
        }

        this.isSubmitting = true;

        const appName = document.getElementById('appName').value;
        const version = document.getElementById('appVersion').value;
        const description = document.getElementById('appDescription')?.value || '';

        // Bilgileri sakla (form sıfırlanacak)
        this.lastJobInfo = {
            appName: appName,
            appVersion: version,
            platforms: [...this.selectedPlatforms],
            sessionId: this.sessionId
        };

        // Seçili yayınevinin logoId'sini al
        const selectedPublisher = this.publishers.find(p => p.id === this.selectedPublisherId);
        const logoId = selectedPublisher?.logoId || null;
        
        console.log('📝 Seçili yayınevi:', selectedPublisher?.name);
        console.log('🎨 Logo ID:', logoId);
        
        const packagingData = {
            sessionId: this.sessionId,
            platforms: this.selectedPlatforms,
            logoId: logoId,  // Yayınevi logosu
            appName: appName,
            appVersion: version,
            description: description,
            publisherId: this.selectedPublisherId || null
        };
        
        // PWA seçiliyse config verilerini ekle
        if (this.selectedPlatforms.includes('pwa')) {
            packagingData.pwaConfig = this.getPWAConfig();
        }

        console.log('📦 Paketleme başlatılıyor:', packagingData);

        try {
            const response = await fetch('/api/package', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(packagingData)
            });

            const result = await response.json();
            
            if (result.error) {
                throw new Error(result.error);
            }
            
            console.log('✅ Paketleme kuyruğa eklendi:', result);
            
            // Sidebar'a manuel ekle
            if (result.jobId) {
                this.activeJobs.set(result.jobId, {
                    type: 'packaging',
                    status: 'queued',
                    jobId: result.jobId,
                    sessionId: this.sessionId,
                    appName,
                    appVersion: version,
                    platforms: [...this.selectedPlatforms],
                    progress: 0,
                    message: 'Kuyruğa eklendi'
                });
                this.updateSidebar();
            }
            
        } catch (error) {
            console.error('❌ Paketleme hatası:', error);
            alert('Paketleme başlatılırken hata oluştu: ' + error.message);
        } finally {
            this.isSubmitting = false;
        }
    }

    // Bekleyen işi kuyruğa ekle
    addToPendingQueue() {
        const pendingId = 'pending_' + Date.now();
        
        const pendingJob = {
            id: pendingId,
            type: 'packaging',
            status: 'pending',
            sessionId: this.sessionId,
            appName: document.getElementById('appName').value,
            appVersion: document.getElementById('appVersion').value,
            platforms: [...this.selectedPlatforms],
            publisherId: this.selectedPublisherId || null,
            description: document.getElementById('appDescription')?.value || '',
            message: 'ZIP açma bekleniyor...',
            progress: 0,
            timestamp: new Date().toISOString()
        };

        // pendingJobs'e ekle
        this.pendingJobs.set(pendingId, pendingJob);
        
        // Sidebar'a ekle (aktif işler gibi göster)
        this.activeJobs.set(pendingId, {
            ...pendingJob,
            pending: true // Pending olduğunu belirt
        });
        
        this.updateSidebar();
        
        console.log('⏳ İş kuyruğa eklendi (ZIP açma bekleniyor):', pendingId);
        
        // Kullanıcıya bilgi ver
        this.showNotification('Kuyruğa Eklendi', 'Paketleme ZIP açma tamamlanınca başlayacak', 'success');
    }

    // Socket Event Handlers
    handleZipExtractionStarted(data) {
        this.activeJobs.set(data.sessionId, {
            type: 'zip',
            status: 'processing',
            sessionId: data.sessionId,
            appName: 'ZIP Açılıyor',
            progress: 0,
            message: 'ZIP dosyası açılıyor...'
        });
        this.updateSidebar();
    }

    handleZipExtractionProgress(data) {
        const job = this.activeJobs.get(data.sessionId);
        if (job) {
            job.progress = data.progress;
            job.message = 'ZIP açılıyor...';
            this.updateSidebar();
        }
        
        // Upload progress bar'ı güncelle
        const progress = data.progress || 0;
        document.getElementById('uploadProgressFill').style.width = progress + '%';
        document.getElementById('uploadPercent').textContent = progress + '%';
        document.getElementById('uploadStatus').textContent = `ZIP açılıyor... (${data.extractedFiles || 0} dosya)`;
    }

    handleZipExtractionCompleted(data) {
        console.log('✅ ZIP açıldı:', data.sessionId);
        this.zipExtractionComplete = true;
        this.activeJobs.delete(data.sessionId);
        this.updateSidebar();
        
        // Bekleyen işleri başlat
        this.processPendingJobs();
        
        // Upload progress'i güncelle
        const uploadArea = document.getElementById('uploadArea');
        if (uploadArea && this.currentStep === 1) {
            uploadArea.querySelector('h4').textContent = '✓ Hazır!';
            document.getElementById('uploadStatus').textContent = 'ZIP açıldı, hazır!';
            setTimeout(() => {
                document.getElementById('uploadProgress').classList.remove('show');
            }, 1000);
        }
    }

    // Bekleyen işleri işle
    async processPendingJobs() {
        console.log('🔄 Bekleyen işler işleniyor...');
        
        // Tüm pending job'ları al
        const jobsToProcess = Array.from(this.pendingJobs.values());
        
        if (jobsToProcess.length === 0) {
            console.log('⚠️ Bekleyen iş yok');
            return;
        }

        console.log(`📋 ${jobsToProcess.length} bekleyen iş bulundu`);

        // Her bir pending job'ı işle
        for (const pendingJob of jobsToProcess) {
            try {
                console.log(`🚀 Bekleyen iş başlatılıyor: ${pendingJob.id}`);
                
                // pendingJobs'ten sil
                this.pendingJobs.delete(pendingJob.id);
                
                // activeJobs'ten pending job'ı sil
                this.activeJobs.delete(pendingJob.id);
                
                // Gerçek paketlemeyi başlat
                await this.startPackagingWithJobData(pendingJob);
                
            } catch (error) {
                console.error(`❌ Bekleyen iş başlatılamadı: ${pendingJob.id}`, error);
                
                // Hata durumunda sidebar'da göster
                this.activeJobs.set(pendingJob.id, {
                    ...pendingJob,
                    status: 'failed',
                    message: 'Başlatılamadı: ' + error.message
                });
                this.updateSidebar();
            }
        }
        
        console.log('✅ Bekleyen işler tamamlandı');
    }

    // Job verileriyle paketleme başlat
    async startPackagingWithJobData(jobData) {
        const { appName, appVersion, description, platforms, publisherId } = jobData;
        
        // Geçici olarak job verilerini yükle
        this.lastJobInfo = {
            appName,
            appVersion,
            platforms,
            sessionId: this.sessionId
        };

        const packagingData = {
            sessionId: this.sessionId,
            platforms,
            logoId: null, // Yayınevi logosu bu aşamada kullanılamıyor
            appName,
            appVersion,
            description,
            publisherId
        };

        // PWA seçiliyse config verilerini ekle
        if (platforms.includes('pwa')) {
            packagingData.pwaConfig = this.getPWAConfig();
        }

        console.log('📦 Bekleyen iş paketleme başlatılıyor:', packagingData);

        const response = await fetch('/api/package', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(packagingData)
        });

        const result = await response.json();
        
        if (result.error) {
            throw new Error(result.error);
        }

        // Sidebar'a manuel ekle
        if (result.jobId) {
            this.activeJobs.set(result.jobId, {
                type: 'packaging',
                status: 'queued',
                jobId: result.jobId,
                sessionId: this.sessionId,
                appName,
                appVersion,
                platforms,
                progress: 0,
                message: 'Kuyruğa eklendi'
            });
            this.updateSidebar();
        }
        
        console.log('✅ Bekleyen iş kuyruğa eklendi:', result);
        this.showNotification('İş Başlatıldı', 'Paketleme kuyruğa eklendi', 'success');
    }

    handleZipExtractionFailed(data) {
        this.activeJobs.delete(data.sessionId);
        this.updateSidebar();
        alert('ZIP açma hatası: ' + data.error);
    }

    handlePackagingQueued(data) {
        console.log('📦 Packaging queued:', data);
        
        // Saklanan bilgileri kullan (form sıfırlanmış olabilir)
        const jobInfo = this.lastJobInfo || {};
        const appName = data.appName || jobInfo.appName || 'Paketleme';
        const platforms = data.platforms || jobInfo.platforms || [];
        
        this.activeJobs.set(data.jobId, {
            type: 'packaging',
            status: 'queued',
            jobId: data.jobId,
            appName: appName,
            platforms: platforms,
            progress: 0,
            message: 'Sırada bekliyor...',
            queuedAt: new Date()
        });
        
        this.updateSidebar();
        console.log('✅ Active jobs updated:', this.activeJobs.size);
    }

    handlePackagingStarted(data) {
        const job = this.activeJobs.get(data.jobId);
        if (job) {
            job.status = 'processing';
            job.message = 'Başlatıldı...';
            this.updateSidebar();
        }
    }

    handlePackagingProgress(data) {
        const job = this.activeJobs.get(data.jobId);
        if (job) {
            job.progress = data.progress || 0;
            job.message = data.message || `${data.platform} - ${data.status}`;
            this.updateSidebar();
        }

        // Ana progress bar'ı güncelle (sadece element varsa)
        const progressFill = document.getElementById('packagingProgressFill');
        const progressPercent = document.getElementById('packagingPercent');
        const progressStatus = document.getElementById('packagingStatus');
        
        if (progressFill) progressFill.style.width = (data.progress || 0) + '%';
        if (progressPercent) progressPercent.textContent = (data.progress || 0) + '%';
        if (progressStatus) progressStatus.textContent = data.message || 'İşleniyor...';
    }

    handlePackagingCompleted(data) {
        const activeJob = this.activeJobs.get(data.jobId);
        this.activeJobs.delete(data.jobId);
        this.isPackaging = false;
        
        // Completed jobs'a ekle - data, activeJob ve lastJobInfo'dan bilgileri al
        const completedJob = {
            jobId: data.jobId,
            appName: data.appName || activeJob?.appName || this.lastJobInfo?.appName || 'Paketleme',
            appVersion: data.appVersion || activeJob?.appVersion || this.lastJobInfo?.appVersion || '1.0.0',
            platforms: data.platforms || activeJob?.platforms || this.lastJobInfo?.platforms || [],
            sessionId: data.sessionId || activeJob?.sessionId || this.lastJobInfo?.sessionId,
            completedAt: new Date(),
            results: data.results || {},
            totalSize: this.calculateTotalSize(data.results),
            status: 'completed',
            outputPath: data.outputPath // Output klasör yolu
        };
        this.completedJobs.push(completedJob);
        
        if (data.outputPath) {
            console.log('📁 Output klasörü:', data.outputPath);
        }
        
        console.log('✅ İş tamamlandı ve completed jobs\'a eklendi:', completedJob);
        
        this.updateSidebar();
        
        // Progress bar'ı güncelle (eğer hala 1. adımda değilse)
        const progressFill = document.getElementById('packagingProgressFill');
        const progressPercent = document.getElementById('packagingPercent');
        const progressStatus = document.getElementById('packagingStatus');
        
        if (progressFill) progressFill.style.width = '100%';
        if (progressPercent) progressPercent.textContent = '100%';
        if (progressStatus) progressStatus.textContent = `Tamamlandı! (${this.formatBytes(completedJob.totalSize)})`;
        
        // Bildirim göster
        this.showNotification('Tamamlandı!', `${completedJob.appName} başarıyla paketlendi`, 'success');
    }
    
    calculateTotalSize(results) {
        let totalSize = 0;
        if (results && typeof results === 'object') {
            Object.values(results).forEach(result => {
                // Her platform result'ı packages array'i içerir
                if (result.packages && Array.isArray(result.packages)) {
                    result.packages.forEach(pkg => {
                        if (pkg.size) {
                            totalSize += pkg.size;
                        }
                    });
                } else if (result.size) {
                    // Eski format desteği
                    totalSize += result.size;
                }
            });
        }
        return totalSize;
    }
    
    formatBytes(bytes, decimals = 2) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }
    
    showCompletionSummary(job) {
        // TODO: Özet modal veya panel göster
        console.log('✅ İş tamamlandı:', job);
    }

    handlePackagingFailed(data) {
        this.activeJobs.delete(data.jobId);
        this.updateSidebar();
        alert('Paketleme hatası: ' + data.error);
    }

    updateSidebar() {
        console.log('🔄 updateSidebar çağrıldı - Active jobs:', this.activeJobs.size, 'Completed:', this.completedJobs.length);
        
        // İstatistikleri güncelle
        document.getElementById('statCompleted').textContent = this.completedJobs.length;
        document.getElementById('statActive').textContent = this.activeJobs.size;
        
        // Aktif işleri güncelle
        const sidebarJobs = document.getElementById('sidebarJobs');
        
        if (this.activeJobs.size === 0) {
            console.log('⚠️ Aktif iş yok, boş mesaj gösteriliyor');
            sidebarJobs.innerHTML = `
                <div class="sidebar-empty">
                    <i class="fas fa-inbox"></i>
                    <p>Henüz aktif işlem yok</p>
                </div>
            `;
        } else {
            console.log('✅ Aktif işler render ediliyor:', Array.from(this.activeJobs.keys()));
            this.renderActiveJobs(sidebarJobs);
        }
        
        // Tamamlanan işleri güncelle
        this.renderCompletedJobs();
        
        // LocalStorage'a kaydet
        this.saveToStorage();
    }
    
    renderActiveJobs(container) {
        let html = '';
        this.activeJobs.forEach((job, jobId) => {
            const platformIcons = {
                'windows': '<i class="fab fa-windows"></i>',
                'macos': '<i class="fab fa-apple"></i>',
                'linux': '<i class="fab fa-linux"></i>',
                'android': '<i class="fab fa-android"></i>',
                'pwa': '<i class="fas fa-globe"></i>'
            };
            
            const platforms = job.platforms || [];
            const platformsHtml = platforms.map(p => 
                `<div class="sidebar-platform-icon ${p}">${platformIcons[p] || ''}</div>`
            ).join('');
            
            const progress = job.progress || 0;
            const statusClass = job.status || 'queued';
            const isPending = job.pending || false;
            const statusText = {
                'queued': 'Sırada',
                'processing': 'İşleniyor',
                'completed': 'Tamamlandı',
                'failed': 'Başarısız',
                'pending': 'ZIP Bekleniyor'
            }[statusClass] || (isPending ? 'ZIP Bekleniyor' : statusClass);
            
            html += `
                <div class="sidebar-job">
                    <div class="sidebar-job-header" onclick="app.showJobDetails('${jobId}')" style="cursor: pointer;">
                        <div class="sidebar-job-name">${job.appName || 'Paketleme'}</div>
                        <span class="sidebar-job-status ${statusClass}">${statusText}</span>
                    </div>
                    ${platforms.length > 0 ? `
                        <div class="sidebar-job-platforms" onclick="app.showJobDetails('${jobId}')" style="cursor: pointer;">
                            ${platformsHtml}
                        </div>
                    ` : ''}
                    <div class="sidebar-job-progress" onclick="app.showJobDetails('${jobId}')" style="cursor: pointer;">
                        <div class="sidebar-progress-bar">
                            <div class="sidebar-progress-fill" style="width: ${progress}%"></div>
                        </div>
                        <div class="sidebar-progress-text">
                            <span>${job.message || 'Hazırlanıyor...'}</span>
                            <span>${progress}%</span>
                        </div>
                    </div>
                    <div class="sidebar-job-actions">
                        <button class="btn-action btn-retry" onclick="event.stopPropagation(); app.retryJob('${jobId}')" title="Yeniden İşle">
                            <i class="fas fa-redo"></i> Yeniden İşle
                        </button>
                        <button class="btn-action btn-cancel" onclick="event.stopPropagation(); app.cancelJob('${jobId}')" title="İptal Et">
                            <i class="fas fa-times"></i> İptal Et
                        </button>
                    </div>
                </div>
            `;
        });
        
        container.innerHTML = html;
    }
    
    renderCompletedJobs() {
        const completedSection = document.getElementById('completedSection');
        const sidebarCompleted = document.getElementById('sidebarCompleted');
        
        if (this.completedJobs.length === 0) {
            completedSection.style.display = 'none';
            return;
        }
        
        completedSection.style.display = 'block';
        
        const platformIcons = {
            'windows': '<i class="fab fa-windows"></i>',
            'macos': '<i class="fab fa-apple"></i>',
            'linux': '<i class="fab fa-linux"></i>',
            'android': '<i class="fab fa-android"></i>',
            'pwa': '<i class="fas fa-globe"></i>'
        };
        
        let html = '';
        this.completedJobs.forEach((job, index) => {
            const platforms = job.platforms || [];
            const platformsHtml = platforms.map(p => 
                `<div class="sidebar-platform-icon ${p}" title="${p}">${platformIcons[p] || ''}</div>`
            ).join('');
            
            const timeAgo = this.getTimeAgo(job.completedAt);
            const version = job.appVersion || '1.0.0';
            
            // İndirme linkleri oluştur
            let downloadLinks = '';
            if (job.results) {
                Object.entries(job.results).forEach(([platform, result]) => {
                    const icon = platformIcons[platform] || '<i class="fas fa-file-archive"></i>';
                    const entries = [];
                    if (result && result.packages && Array.isArray(result.packages)) {
                        result.packages.forEach(pkg => entries.push(pkg));
                    } else if (result && result.path) {
                        entries.push(result);
                    }

                    entries.forEach(pkg => {
                        const label = pkg.type || platform;
                        const title = pkg.filename || (pkg.path ? pkg.path.split('/').pop() : label);
                        downloadLinks += `
                                <a href="/${pkg.path}" download class="download-link" title="${title}">
                                    ${icon} ${label}
                                </a>
                            `;
                    });
                });
            }
            
            html += `
                <div class="completed-job">
                    <div class="completed-job-header">
                        <div class="completed-job-title">
                            <div class="completed-job-name">${job.appName}</div>
                            <div class="completed-job-version">v${version}</div>
                        </div>
                        <div class="completed-job-time">${timeAgo}</div>
                    </div>
                    
                    ${platforms.length > 0 ? `
                        <div class="completed-job-platforms">
                            ${platformsHtml}
                        </div>
                    ` : ''}
                    
                    <div class="completed-job-info">
                        <div class="completed-job-size">
                            <i class="fas fa-hdd"></i> ${this.formatBytes(job.totalSize)}
                        </div>
                    </div>
                    
                    ${downloadLinks ? `
                        <div class="completed-job-downloads">
                            ${downloadLinks}
                        </div>
                    ` : ''}
                    
                    <div class="completed-job-actions">
                        ${job.outputPath ? `
                            <button class="btn-action btn-folder" data-path="${job.outputPath.replace(/"/g, '&quot;')}" onclick="app.openOutputFolder(this.dataset.path)" title="Klasörde Göster">
                                <i class="fas fa-folder-open"></i> Klasörde Göster
                            </button>
                        ` : ''}
                        <button class="btn-action btn-download" onclick="app.showJobDetails('${job.jobId}', true)" title="Detaylar">
                            <i class="fas fa-info-circle"></i> Detay
                        </button>
                        <button class="btn-action btn-reprocess" onclick="app.reprocessJob(${index})" title="Yeniden İşle">
                            <i class="fas fa-redo"></i> Yeniden İşle
                        </button>
                        <button class="btn-action btn-delete" onclick="app.deleteJob(${index})" title="Sil">
                            <i class="fas fa-trash"></i> Sil
                        </button>
                    </div>
                </div>
            `;
        });
        
        sidebarCompleted.innerHTML = html;
    }
    
    getTimeAgo(date) {
        const seconds = Math.floor((new Date() - date) / 1000);
        
        if (seconds < 60) return 'Az önce';
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return `${minutes} dakika önce`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours} saat önce`;
        const days = Math.floor(hours / 24);
        return `${days} gün önce`;
    }
    
    // ==================== AKTİF İŞLEM YÖNETİMİ ====================
    
    async retryJob(jobId) {
        const job = this.activeJobs.get(jobId);
        
        if (!job) {
            alert('İş bulunamadı');
            return;
        }
        
        if (!confirm(`"${job.appName || 'Bu iş'}" yeniden başlatılsın mı?`)) {
            return;
        }
        
        console.log('🔄 Aktif iş yeniden başlatılıyor:', jobId);
        
        try {
            // Mevcut işi iptal et
            await this.cancelJob(jobId, false);
            
            // Yeni iş başlat
            const packagingData = {
                sessionId: job.sessionId,
                platforms: job.platforms || [],
                logoId: job.logoId || null,
                appName: job.appName,
                appVersion: job.appVersion || '1.0.0',
                description: job.description || ''
            };
            
            const response = await fetch('/api/package', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(packagingData)
            });
            
            const result = await response.json();
            
            if (result.error) {
                throw new Error(result.error);
            }
            
            console.log('✅ İş yeniden başlatıldı:', result);
            this.showToast('İş yeniden başlatıldı', 'success');
            
        } catch (error) {
            console.error('❌ Yeniden başlatma hatası:', error);
            alert('İş yeniden başlatılırken hata oluştu: ' + error.message);
        }
    }
    
    async cancelJob(jobId, showConfirm = true) {
        const job = this.activeJobs.get(jobId);
        
        if (!job) {
            alert('İş bulunamadı');
            return;
        }
        
        if (showConfirm && !confirm(`"${job.appName || 'Bu iş'}" iptal edilsin mi?`)) {
            return;
        }
        
        console.log('❌ İş iptal ediliyor:', jobId);
        
        try {
            const response = await fetch(`/api/jobs/${jobId}/cancel`, {
                method: 'POST'
            });
            
            if (!response.ok) {
                throw new Error('İptal isteği başarısız');
            }
            
            // Aktif işlerden kaldır
            this.activeJobs.delete(jobId);
            this.updateSidebar();
            
            console.log('✅ İş iptal edildi:', jobId);
            if (showConfirm) {
                this.showToast('İş iptal edildi', 'info');
            }
            
        } catch (error) {
            console.error('❌ İptal hatası:', error);
            // Hata olsa bile UI'dan kaldır
            this.activeJobs.delete(jobId);
            this.updateSidebar();
            
            if (showConfirm) {
                alert('İş iptal edilirken hata oluştu, ancak listeden kaldırıldı.');
            }
        }
    }
    
    // ==================== TAMAMLANAN İŞLEM YÖNETİMİ ====================
    
    async reprocessJob(index) {
        const job = this.completedJobs[index];
        
        if (!confirm(`"${job.appName}" işini yeniden paketlemek istediğinizden emin misiniz?`)) {
            return;
        }
        
        console.log('🔄 Yeniden işleme başlatılıyor:', job);
        
        // Session ID kontrolü
        if (!job.sessionId) {
            alert('Bu iş için session ID bulunamadı. Yeniden işlenemez.');
            return;
        }
        
        const packagingData = {
            sessionId: job.sessionId,
            platforms: job.platforms || [],
            logoId: null,
            appName: job.appName,
            appVersion: job.appVersion || '1.0.0',
            description: ''
        };
        
        try {
            const response = await fetch('/api/package', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(packagingData)
            });
            
            const result = await response.json();
            
            if (result.error) {
                throw new Error(result.error);
            }
            
            console.log('✅ Yeniden paketleme başlatıldı:', result);
            this.showNotification('Yeniden İşleme', 'İş kuyruğa eklendi', 'success');
            
        } catch (error) {
            console.error('❌ Yeniden işleme hatası:', error);
            alert('Yeniden işleme başlatılırken hata oluştu: ' + error.message);
        }
    }
    
    async deleteJob(index) {
        if (!confirm('Bu işi silmek istediğinizden emin misiniz? Oluşturulan paketler de silinecek.')) {
            return;
        }
        
        const job = this.completedJobs[index];
        
        try {
            // Sunucuya silme isteği gönder
            const response = await fetch(`/api/delete-job/${job.jobId}`, {
                method: 'DELETE'
            });
            
            if (response.ok) {
                this.completedJobs.splice(index, 1);
                this.updateSidebar();
                console.log('✅ İş silindi:', job.jobId);
            } else {
                throw new Error('Silme başarısız');
            }
        } catch (error) {
            console.error('❌ Silme hatası:', error);
            alert('İş silinirken hata oluştu');
        }
    }
    
    async clearAllCompletedJobs() {
        if (!confirm('Tüm tamamlanan işleri silmek istediğinizden emin misiniz? Oluşturulan paketler de silinecek.')) {
            return;
        }
        
        try {
            const jobIds = this.completedJobs.map(j => j.jobId);
            
            const response = await fetch('/api/delete-jobs', {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ jobIds })
            });
            
            if (response.ok) {
                this.completedJobs = [];
                this.updateSidebar();
                console.log('✅ Tüm işler silindi');
            } else {
                throw new Error('Silme başarısız');
            }
        } catch (error) {
            console.error('❌ Silme hatası:', error);
            alert('İşler silinirken hata oluştu');
        }
    }
    
    showJobDetails(jobId, isCompleted = false) {
        let job;
        if (isCompleted) {
            job = this.completedJobs.find(j => j.jobId === jobId);
        } else {
            job = this.activeJobs.get(jobId);
        }
        
        if (!job) {
            console.warn('İş bulunamadı:', jobId);
            return;
        }
        
        const platformNames = {
            'windows': 'Windows',
            'macos': 'macOS',
            'linux': 'Linux',
            'android': 'Android',
            'pwa': 'PWA'
        };
        
        const platformsList = (job.platforms || []).map(p => platformNames[p] || p).join(', ');
        const statusText = {
            'queued': 'Sırada Bekliyor',
            'processing': 'İşleniyor',
            'completed': 'Tamamlandı',
            'failed': 'Başarısız'
        }[job.status] || job.status;
        
        const timeInfo = job.queuedAt ? `Kuyruğa Eklenme: ${job.queuedAt.toLocaleString('tr-TR')}` : '';
        const isCompletedJob = isCompleted || job.status === 'completed';
        const progressValue = isCompletedJob ? 100 : (job.progress || 0);
        const progressMessage = isCompletedJob ? `Tamamlandı (${this.formatBytes(job.totalSize || 0)})` : (job.message || 'Hazırlanıyor...');
        
        // Modal oluştur
        const modal = document.createElement('div');
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
            animation: fadeIn 0.3s ease;
        `;
        
        modal.innerHTML = `
            <div style="
                background: white;
                border-radius: 16px;
                padding: 30px;
                max-width: 500px;
                width: 90%;
                box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                animation: slideUp 0.3s ease;
            ">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                    <h2 style="margin: 0; color: #333;">
                        <i class="fas fa-info-circle" style="color: #667eea;"></i> İş Detayları
                    </h2>
                    <button onclick="this.closest('div[style*=fixed]').remove()" style="
                        background: none;
                        border: none;
                        font-size: 1.5rem;
                        cursor: pointer;
                        color: #999;
                        padding: 0;
                        width: 30px;
                        height: 30px;
                    ">×</button>
                </div>
                
                <div style="margin-bottom: 15px;">
                    <div style="font-weight: 600; color: #6c757d; margin-bottom: 5px;">Uygulama Adı</div>
                    <div style="font-size: 1.1rem; color: #333;">${job.appName || 'Bilinmiyor'}</div>
                </div>
                
                <div style="margin-bottom: 15px;">
                    <div style="font-weight: 600; color: #6c757d; margin-bottom: 5px;">Job ID</div>
                    <div style="font-size: 0.85rem; color: #333; font-family: monospace; background: #f8f9fa; padding: 8px; border-radius: 6px;">${jobId}</div>
                </div>
                
                <div style="margin-bottom: 15px;">
                    <div style="font-weight: 600; color: #6c757d; margin-bottom: 5px;">Durum</div>
                    <div style="font-size: 1rem; color: #333;">
                        <span style="
                            padding: 4px 12px;
                            border-radius: 12px;
                            font-weight: 600;
                            ${job.status === 'queued' ? 'background: #fff3cd; color: #856404;' : ''}
                            ${job.status === 'processing' ? 'background: #d1ecf1; color: #0c5460;' : ''}
                            ${job.status === 'completed' ? 'background: #d4edda; color: #155724;' : ''}
                            ${job.status === 'failed' ? 'background: #f8d7da; color: #721c24;' : ''}
                        ">${statusText}</span>
                    </div>
                </div>
                
                <div style="margin-bottom: 15px;">
                    <div style="font-weight: 600; color: #6c757d; margin-bottom: 5px;">Platformlar</div>
                    <div style="font-size: 1rem; color: #333;">${platformsList || 'Seçilmemiş'}</div>
                </div>
                
                <div style="margin-bottom: 15px;">
                    <div style="font-weight: 600; color: #6c757d; margin-bottom: 5px;">İlerleme</div>
                    <div style="margin-top: 8px;">
                        <div style="height: 8px; background: #e9ecef; border-radius: 4px; overflow: hidden;">
                            <div style="height: 100%; background: linear-gradient(90deg, #667eea, #764ba2); width: ${progressValue}%; transition: width 0.3s ease;"></div>
                        </div>
                        <div style="margin-top: 5px; font-size: 0.9rem; color: #6c757d;">
                            ${progressValue}% - ${progressMessage}
                        </div>
                    </div>
                </div>
                
                ${timeInfo ? `
                    <div style="margin-bottom: 15px;">
                        <div style="font-weight: 600; color: #6c757d; margin-bottom: 5px;">Zaman</div>
                        <div style="font-size: 0.9rem; color: #333;">${timeInfo}</div>
                    </div>
                ` : ''}
                
                ${isCompletedJob && job.results ? `
                    <div style="margin-bottom: 15px;">
                        <div style="font-weight: 600; color: #6c757d; margin-bottom: 10px;">
                            <i class="fas fa-download"></i> Oluşturulan Dosyalar
                        </div>
                        <div style="display: flex; flex-direction: column; gap: 8px;">
                            ${Object.entries(job.results).map(([platform, result]) => {
                                const entries = [];
                                if (result && result.packages && Array.isArray(result.packages)) {
                                    result.packages.forEach(pkg => entries.push(pkg));
                                } else if (result && result.path) {
                                    entries.push(result);
                                }

                                return entries.map(pkg => `
                                        <a href="/${pkg.path}" download style="
                                            display: flex;
                                            align-items: center;
                                            justify-content: space-between;
                                            padding: 12px;
                                            background: #f8f9fa;
                                            border-radius: 8px;
                                            text-decoration: none;
                                            color: #333;
                                            transition: all 0.2s;
                                            border: 1px solid #e9ecef;
                                        " onmouseover="this.style.background='#e9ecef'; this.style.borderColor='#667eea';" onmouseout="this.style.background='#f8f9fa'; this.style.borderColor='#e9ecef';">
                                            <div style="display: flex; align-items: center; gap: 10px;">
                                                <i class="fas fa-file-archive" style="color: #667eea; font-size: 1.2rem;"></i>
                                                <div>
                                                    <div style="font-weight: 600;">${pkg.type || platform}</div>
                                                    <div style="font-size: 0.85rem; color: #6c757d;">${pkg.filename || pkg.path?.split('/').pop() || ''}</div>
                                                </div>
                                            </div>
                                            <div style="text-align: right;">
                                                <div style="font-weight: 600; color: #667eea;">${this.formatBytes(pkg.size || 0)}</div>
                                                <div style="font-size: 0.85rem; color: #6c757d;">
                                                    <i class="fas a-download"></i> İndir
                                                </div>
                                            </div>
                                        </a>
                                    `).join('');
                            }).join('')}
                        </div>
                    </div>
                    
                    <div style="margin-bottom: 15px; padding: 12px; background: #e7f3ff; border-radius: 8px; border-left: 4px solid #667eea;">
                        <div style="font-weight: 600; color: #333; margin-bottom: 5px;">
                            <i class="fas fa-hdd"></i> Toplam Boyut
                        </div>
                        <div style="font-size: 1.2rem; color: #667eea; font-weight: 700;">
                            ${this.formatBytes(job.totalSize || 0)}
                        </div>
                    </div>
                ` : ''}
                
                ${!isCompletedJob && job.status === 'queued' && !job.publisherId ? `
                    <div style="margin-bottom: 15px; padding: 12px; background: #fff3cd; border-radius: 8px; border-left: 4px solid #ffc107;">
                        <div style="font-weight: 600; color: #856404; margin-bottom: 5px;">
                            <i class="fas fa-exclamation-triangle"></i> Eksik Bilgi
                        </div>
                        <div style="font-size: 0.9rem; color: #856404;">
                            Bu iş için yayınevi seçilmemiş. Paketleme başlamadan önce yayınevi seçmelisiniz.
                        </div>
                    </div>
                    
                    <button onclick="app.completeJobInfo('${jobId}')" style="
                        width: 100%;
                        padding: 12px;
                        background: linear-gradient(135deg, #ffc107, #ff9800);
                        color: white;
                        border: none;
                        border-radius: 8px;
                        font-size: 1rem;
                        font-weight: 600;
                        cursor: pointer;
                        margin-bottom: 10px;
                    ">
                        <i class="fas fa-edit"></i> Eksik Bilgileri Tamamla
                    </button>
                ` : ''}
                
                <button onclick="this.closest('div[style*=fixed]').remove()" style="
                    width: 100%;
                    padding: 12px;
                    background: linear-gradient(135deg, #667eea, #764ba2);
                    color: white;
                    border: none;
                    border-radius: 8px;
                    font-size: 1rem;
                    font-weight: 600;
                    cursor: pointer;
                    margin-top: 10px;
                ">Kapat</button>
            </div>
        `;
        
        // Animasyon için CSS ekle
        if (!document.getElementById('modal-animations')) {
            const style = document.createElement('style');
            style.id = 'modal-animations';
            style.textContent = `
                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                @keyframes slideUp {
                    from { transform: translateY(20px); opacity: 0; }
                    to { transform: translateY(0); opacity: 1; }
                }
            `;
            document.head.appendChild(style);
        }
        
        document.body.appendChild(modal);
        
        // Modal dışına tıklayınca kapat
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });
    }
    
    getPWAConfig() {
        // PWA form verilerini topla
        const config = {
            downloads: {
                windows: {
                    setup: {
                        enabled: document.getElementById('pwaWindowsEnabled').checked,
                        url: document.getElementById('pwaWindowsUrl').value.trim() || null,
                        size: parseInt(document.getElementById('pwaWindowsSize').value) * 1024 * 1024 || 0 // MB to bytes
                    }
                },
                linux: {
                    appimage: {
                        enabled: document.getElementById('pwaLinuxAppImageEnabled').checked,
                        url: document.getElementById('pwaLinuxAppImageUrl').value.trim() || null,
                        size: parseInt(document.getElementById('pwaLinuxAppImageSize').value) * 1024 * 1024 || 0
                    },
                    deb: {
                        enabled: document.getElementById('pwaLinuxDebEnabled').checked,
                        url: document.getElementById('pwaLinuxDebUrl').value.trim() || null,
                        size: parseInt(document.getElementById('pwaLinuxDebSize').value) * 1024 * 1024 || 0
                    }
                },
                macos: {
                    dmg: {
                        enabled: document.getElementById('pwaMacOSDmgEnabled').checked,
                        url: document.getElementById('pwaMacOSDmgUrl').value.trim() || null,
                        size: parseInt(document.getElementById('pwaMacOSDmgSize').value) * 1024 * 1024 || 0
                    },
                    appstore: {
                        enabled: document.getElementById('pwaMacOSAppStoreEnabled').checked,
                        url: document.getElementById('pwaMacOSAppStoreUrl').value.trim() || null
                    }
                },
                android: {
                    apk: {
                        enabled: document.getElementById('pwaAndroidApkEnabled').checked,
                        url: document.getElementById('pwaAndroidApkUrl').value.trim() || null,
                        size: parseInt(document.getElementById('pwaAndroidApkSize').value) * 1024 * 1024 || 0
                    },
                    playstore: {
                        enabled: document.getElementById('pwaAndroidPlayStoreEnabled').checked,
                        url: document.getElementById('pwaAndroidPlayStoreUrl').value.trim() || null
                    }
                },
                ios: {
                    appstore: {
                        enabled: document.getElementById('pwaIOSAppStoreEnabled').checked,
                        url: document.getElementById('pwaIOSAppStoreUrl').value.trim() || null
                    }
                }
            },
            caching: {
                strategy: document.getElementById('pwaCachingStrategy').value,
                autoUpdate: document.getElementById('pwaAutoUpdate').checked,
                updateInterval: 21600 // 6 saat (saniye)
            },
            ui: {
                showPWAButton: true,
                buttonText: document.getElementById('pwaButtonText').value.trim() || 'İndir',
                buttonColor: document.getElementById('pwaButtonColor').value || '#fbbf24',
                popupTitle: document.getElementById('pwaPopupTitle').value.trim() || 'Kurulum Seçenekleri'
            }
        };
        
        console.log('📋 PWA Config toplandi:', config);
        return config;
    }

    // ==================== TOAST MESAJLARI ====================
    
    showToast(message, type = 'info') {
        // Toast container'ı bul veya oluştur
        let toastContainer = document.getElementById('toast-container');
        if (!toastContainer) {
            toastContainer = document.createElement('div');
            toastContainer.id = 'toast-container';
            toastContainer.style.cssText = 'position: fixed; top: 20px; right: 20px; z-index: 10000;';
            document.body.appendChild(toastContainer);
        }
        
        // Toast elementi oluştur
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.style.cssText = `
            padding: 12px 20px;
            margin-bottom: 10px;
            border-radius: 8px;
            color: white;
            font-size: 14px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            animation: slideIn 0.3s ease-out;
            min-width: 250px;
            max-width: 400px;
        `;
        
        // Tip'e göre renk
        const colors = {
            success: '#10b981',
            error: '#ef4444',
            info: '#3b82f6',
            warning: '#f59e0b'
        };
        toast.style.background = colors[type] || colors.info;
        
        toast.textContent = message;
        toastContainer.appendChild(toast);
        
        // 3 saniye sonra kaldır
        setTimeout(() => {
            toast.style.animation = 'slideOut 0.3s ease-in';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }
    
    // ==================== TEST FONKSİYONLARI ====================
    
    testAllButtons() {
        console.log('\n🧪 ===== BUTON TESTLERİ BAŞLIYOR =====\n');
        
        // 1. API Kontrolü
        console.log('1️⃣ API KONTROLÜ:');
        console.log('  ✅ electronAPI:', window.electronAPI ? 'Mevcut' : '❌ YOK!');
        console.log('  ✅ openFolder:', typeof window.electronAPI?.openFolder);
        
        // 2. Aktif işleri listele
        console.log('\n2️⃣ AKTİF İŞLER:');
        console.log('  Toplam:', this.activeJobs.size);
        this.activeJobs.forEach((job, jobId) => {
            console.log(`  - ${jobId}: ${job.appName} (${job.status})`);
        });
        
        // 3. Tamamlanan işleri listele
        console.log('\n3️⃣ TAMAMLANAN İŞLER:');
        console.log('  Toplam:', this.completedJobs.length);
        this.completedJobs.forEach((job, i) => {
            console.log(`  ${i}: ${job.appName} - ${job.outputPath ? '✅ Path var' : '❌ Path yok'}`);
        });
        
        // 4. Klasörde Göster testi
        if (this.completedJobs.length > 0 && this.completedJobs[0].outputPath) {
            console.log('\n4️⃣ KLASÖRDE GÖSTER TESTİ:');
            const firstJob = this.completedJobs[0];
            console.log('  Test ediliyor:', firstJob.appName);
            console.log('  Path:', firstJob.outputPath);
            this.openOutputFolder(firstJob.outputPath);
        } else {
            console.log('\n⚠️ Klasör testi atlanıyor - path yok');
        }
        
        // 5. Detay göster testi
        if (this.completedJobs.length > 0) {
            console.log('\n5️⃣ DETAY GÖSTER TESTİ:');
            console.log('  İlk işin detayı gösteriliyor...');
            setTimeout(() => {
                this.showJobDetails(this.completedJobs[0].jobId, true);
            }, 2000);
        }
        
        console.log('\n🧪 ===== TEST TAMAMLANDI =====\n');
        console.log('📊 SONUÇ:');
        console.log('  ✅ Klasörde Göster: Test edildi');
        console.log('  ✅ Detay Göster: 2 saniye sonra açılacak');
        console.log('  ℹ️ Diğer butonlar (İptal, Yeniden İşle): Manuel test gerekli\n');
    }
    
    // ==================== KLASÖRDE GÖSTER ====================
    
    async openOutputFolder(folderPath) {
        console.log('📁 Klasör açılıyor:', folderPath);
        
        if (window.electronAPI && window.electronAPI.openFolder) {
            try {
                const result = await window.electronAPI.openFolder(folderPath);
                console.log('📁 Klasör açma sonucu:', result);
                
                if (result && result.success) {
                    // this yerine app kullan - context kaybı önlenir
                    app.showToast('Klasör açıldı', 'success');
                } else {
                    const errorMsg = result?.error || 'Bilinmeyen hata';
                    console.error('❌ Klasör açılamadı:', errorMsg);
                    app.showToast('Klasör açılamadı: ' + errorMsg, 'error');
                }
            } catch (error) {
                console.error('❌ Klasör açma exception:', error);
                app.showToast('Klasör açılamadı: ' + error.message, 'error');
            }
        } else {
            // Electron API yoksa, yolu göster
            console.warn('⚠️ Electron API bulunamadı');
            alert(`Output Klasörü:\n${folderPath}`);
        }
    }

    // ==================== EKSİK BİLGİLERİ TAMAMLA ====================
    
    completeJobInfo(jobId) {
        console.log('📝 Eksik bilgileri tamamla:', jobId);
        
        const job = this.activeJobs.get(jobId);
        if (!job) {
            console.error('İş bulunamadı:', jobId);
            return;
        }
        
        // Modal'ı kapat
        document.querySelectorAll('div[style*="position: fixed"]').forEach(modal => modal.remove());
        
        // Session ID'yi ayarla
        this.currentSessionId = job.sessionId || jobId;
        localStorage.setItem('currentSessionId', this.currentSessionId);
        
        console.log('✅ Session ID ayarlandı:', this.currentSessionId);
        
        // Paketleme sekmesine geç
        this.switchTab('packaging');
        
        // Yayınevi dropdown'una scroll et
        setTimeout(() => {
            const publisherSelect = document.getElementById('publisherSelect');
            if (publisherSelect) {
                publisherSelect.scrollIntoView({ behavior: 'smooth', block: 'center' });
                publisherSelect.focus();
                
                // Dropdown'u vurgula
                publisherSelect.style.border = '2px solid #ffc107';
                publisherSelect.style.boxShadow = '0 0 10px rgba(255, 193, 7, 0.5)';
                
                setTimeout(() => {
                    publisherSelect.style.border = '';
                    publisherSelect.style.boxShadow = '';
                }, 2000);
            }
        }, 300);
        
        // Bilgilendirme toast'ı göster
        this.showToast('Lütfen yayınevi seçin ve paketlemeyi başlatın', 'info');
    }
    
    switchTab(tabName) {
        // Tüm tab'ları gizle
        document.querySelectorAll('.tab-content').forEach(tab => {
            tab.classList.remove('active');
        });
        
        // Tüm tab butonlarını pasif yap
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        
        // Seçili tab'ı göster
        const selectedTab = document.getElementById(`${tabName}Tab`);
        if (selectedTab) {
            selectedTab.classList.add('active');
        }
        
        // Seçili tab butonunu aktif yap
        const selectedBtn = document.querySelector(`[data-tab="${tabName}"]`);
        if (selectedBtn) {
            selectedBtn.classList.add('active');
        }
        
        console.log('📑 Tab değiştirildi:', tabName);
    }

    // ==================== YAYINEVİ YÖNETİMİ ====================
    
    async loadPublishers() {
        console.log('🚀 loadPublishers() ÇAĞRILDI');
        try {
            // Cache buster ekle - her zaman güncel veriyi al
            const cacheBuster = `?_=${Date.now()}`;
            console.log('📡 API çağrısı yapılıyor: /api/publishers');
            
            const response = await fetch(`/api/publishers${cacheBuster}`, {
                cache: 'no-store',
                headers: {
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache'
                }
            });
            
            console.log('📥 API yanıtı alındı, status:', response.status);
            
            this.publishers = await response.json();
            
            console.log('✅ Yayınevleri yüklendi (CACHE YOK):', this.publishers);
            console.log('📊 Yayınevi sayısı:', this.publishers.length);
            
            if (this.publishers.length === 0) {
                console.warn('⚠️ UYARI: Yayınevi listesi BOŞ!');
            }
            
            // Publisher dropdown'unu doldur
            console.log('🔄 updatePublisherDropdown() çağrılıyor...');
            this.updatePublisherDropdown();
            
        } catch (error) {
            console.error('❌ Yayınevi yükleme hatası:', error);
            console.error('Hata detayı:', error.message, error.stack);
        }
    }
    
    updatePublisherDropdown() {
        const dropdown = document.getElementById('publisherSelect');
        if (!dropdown) {
            console.warn('⚠️ publisherSelect dropdown bulunamadı! DOM hazır değil olabilir.');
            // Dropdown henüz DOM'da değilse, biraz bekleyip tekrar dene
            setTimeout(() => {
                console.log('🔄 publisherSelect dropdown için tekrar deneniyor...');
                this.updatePublisherDropdown();
            }, 500);
            return;
        }
        
        console.log('📋 Publisher dropdown güncelleniyor');
        console.log('  - Yayınevi sayısı:', this.publishers ? this.publishers.length : 0);
        console.log('  - Yayınevleri:', this.publishers ? this.publishers.map(p => p.name).join(', ') : 'yok');
        
        // Mevcut seçimi sakla
        const currentSelection = dropdown.value;
        
        // Dropdown'u temizle ve yeniden doldur
        dropdown.innerHTML = '<option value="">Yayınevi Seçin...</option>';
        
        if (!this.publishers || this.publishers.length === 0) {
            console.warn('⚠️ Yayınevi listesi boş, dropdown doldurulamadı');
            return;
        }
        
        this.publishers.forEach(publisher => {
            const option = document.createElement('option');
            option.value = publisher.id;
            option.textContent = publisher.name;
            if (publisher.isDefault) {
                option.textContent += ' (Varsayılan)';
            }
            dropdown.appendChild(option);
            console.log(`  ✓ Eklendi: ${publisher.name} (${publisher.id})`);
        });
        
        // Varsayılan yayınevini seç
        const defaultPublisher = this.publishers.find(p => p.isDefault);
        if (defaultPublisher && !currentSelection) {
            dropdown.value = defaultPublisher.id;
            this.selectedPublisherId = defaultPublisher.id;
            console.log(`✅ Varsayılan yayınevi seçildi: ${defaultPublisher.name}`);
        } else if (currentSelection) {
            dropdown.value = currentSelection;
            this.selectedPublisherId = currentSelection;
        }
        
        // Change event listener ekle
        dropdown.addEventListener('change', (e) => {
            this.selectedPublisherId = e.target.value;
            console.log('📝 Yayınevi seçildi:', e.target.value);
        });
    }
}

// Global instance
let app;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    app = new ElectronPackagerWizard();
    
    // Clear button event
    document.getElementById('btnClearCompleted')?.addEventListener('click', () => {
        app.clearAllCompletedJobs();
    });
});

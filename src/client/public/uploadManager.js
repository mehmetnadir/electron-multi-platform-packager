// Enhanced Upload Manager - Hash tabanlı resumable upload sistemi
class UploadManager {
    constructor(baseUrl, socket) {
        this.baseUrl = baseUrl;
        this.socket = socket;
        this.chunkSize = 1024 * 1024; // 1MB chunks
        this.activeUploads = new Map();
        this.backgroundUploads = new Map();
        
        this.initSocketEvents();
    }

    initSocketEvents() {
        // Upload progress dinle
        this.socket.on('upload-progress', (data) => {
            this.handleUploadProgress(data);
        });

        // Extract progress dinle
        this.socket.on('extract-progress', (data) => {
            this.handleExtractProgress(data);
        });
    }

    // Dosya hash'i hesapla (frontend'de)
    async calculateFileHash(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const arrayBuffer = e.target.result;
                    const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
                    const hashArray = Array.from(new Uint8Array(hashBuffer));
                    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
                    resolve(hashHex);
                } catch (error) {
                    reject(error);
                }
            };
            reader.onerror = reject;
            reader.readAsArrayBuffer(file);
        });
    }

    // Gelişmiş upload başlat
    async startEnhancedUpload(files, sessionId, options = {}) {
        const { appName, appVersion, description, background = false } = options;
        
        try {
            // Dosya bilgilerini hazırla
            const fileInfos = [];
            for (const file of files) {
                const hash = await this.calculateFileHash(file);
                fileInfos.push({
                    name: file.name,
                    size: file.size,
                    type: file.type,
                    hash: hash,
                    file: file
                });
            }

            // Upload session başlat
            const startResponse = await fetch(`${this.baseUrl}/api/upload/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionId,
                    appName,
                    appVersion,
                    description,
                    files: fileInfos.map(f => ({
                        name: f.name,
                        size: f.size,
                        hash: f.hash
                    }))
                })
            });

            if (!startResponse.ok) {
                throw new Error('Upload session başlatılamadı');
            }

            const uploadInfo = {
                sessionId,
                files: fileInfos,
                appName,
                appVersion,
                description,
                background,
                status: 'starting',
                progress: 0,
                startTime: Date.now()
            };

            if (background) {
                this.backgroundUploads.set(sessionId, uploadInfo);
                this.showBackgroundNotification(uploadInfo);
            } else {
                this.activeUploads.set(sessionId, uploadInfo);
            }

            // Dosyaları tek tek upload et
            for (const fileInfo of fileInfos) {
                await this.uploadSingleFile(fileInfo, sessionId, background);
            }

            return { success: true, sessionId };

        } catch (error) {
            console.error('Enhanced upload hatası:', error);
            this.showUploadError(error.message, sessionId);
            throw error;
        }
    }

    // Tek dosya upload
    async uploadSingleFile(fileInfo, sessionId, background = false) {
        const { file, hash, name } = fileInfo;

        try {
            // Resume kontrolü yap
            const resumeResponse = await fetch(`${this.baseUrl}/api/upload/check-resume`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    fileHash: hash,
                    fileName: name,
                    sessionId
                })
            });

            const resumeInfo = await resumeResponse.json();

            if (resumeInfo.completed) {
                // Dosya zaten mevcut, atla
                this.updateFileStatus(sessionId, name, 'completed', resumeInfo.message);
                return;
            }

            // Chunk'lara böl ve upload et
            const totalChunks = Math.ceil(file.size / this.chunkSize);
            const startChunk = resumeInfo.uploadedChunks || 0;

            for (let chunkIndex = startChunk; chunkIndex < totalChunks; chunkIndex++) {
                const start = chunkIndex * this.chunkSize;
                const end = Math.min(start + this.chunkSize, file.size);
                const chunk = file.slice(start, end);

                await this.uploadChunk(chunk, sessionId, name, chunkIndex, totalChunks, hash);

                // Progress güncelle
                const progress = Math.round(((chunkIndex + 1) / totalChunks) * 100);
                this.updateFileProgress(sessionId, name, progress);
            }

        } catch (error) {
            console.error(`Dosya upload hatası (${name}):`, error);
            this.updateFileStatus(sessionId, name, 'failed', error.message);
        }
    }

    // Chunk upload
    async uploadChunk(chunk, sessionId, fileName, chunkIndex, totalChunks, fileHash) {
        const formData = new FormData();
        formData.append('chunk', chunk);

        const url = `${this.baseUrl}/api/upload/chunk?sessionId=${sessionId}&fileName=${encodeURIComponent(fileName)}&chunkIndex=${chunkIndex}&totalChunks=${totalChunks}&fileHash=${fileHash}`;

        const response = await fetch(url, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Chunk upload başarısız');
        }

        return await response.json();
    }

    // Upload progress handle
    handleUploadProgress(data) {
        const { sessionId, progress, status, files } = data;
        
        const upload = this.activeUploads.get(sessionId) || this.backgroundUploads.get(sessionId);
        if (!upload) return;

        upload.progress = progress;
        upload.status = status;

        // UI güncelle
        if (this.activeUploads.has(sessionId)) {
            this.updateActiveUploadUI(data);
        } else {
            this.updateBackgroundUploadUI(data);
        }

        // Tamamlandıysa notification göster
        if (status === 'completed') {
            this.showUploadCompleted(upload);
        }
    }

    // Extract progress handle
    handleExtractProgress(data) {
        const { sessionId, fileName, progress } = data;
        this.updateExtractProgress(sessionId, fileName, progress);
    }

    // Aktif upload UI güncelle
    updateActiveUploadUI(data) {
        const { sessionId, progress, uploadedSize, totalSize, completedFiles, totalFiles, files } = data;
        
        // Ana progress bar
        const progressBar = document.getElementById('uploadProgressFill');
        const progressText = document.getElementById('uploadPercent');
        const statusText = document.getElementById('uploadStatus');

        if (progressBar) progressBar.style.width = `${progress}%`;
        if (progressText) progressText.textContent = `${progress}%`;
        if (statusText) statusText.textContent = `${completedFiles}/${totalFiles} dosya tamamlandı (${this.formatBytes(uploadedSize)}/${this.formatBytes(totalSize)})`;

        // Dosya listesi güncelle
        this.updateFileList(files);
    }

    // Background upload UI güncelle
    updateBackgroundUploadUI(data) {
        const { sessionId, progress } = data;
        this.updateBackgroundNotification(sessionId, progress);
    }

    // Background notification göster
    showBackgroundNotification(uploadInfo) {
        const notification = document.createElement('div');
        notification.id = `bg-upload-${uploadInfo.sessionId}`;
        notification.className = 'background-upload-notification';
        notification.innerHTML = `
            <div class="bg-upload-header">
                <i class="fas fa-cloud-upload-alt"></i>
                <span>Arka plan yüklemesi</span>
                <button onclick="uploadManager.dismissBackgroundUpload('${uploadInfo.sessionId}')" class="btn-close">×</button>
            </div>
            <div class="bg-upload-content">
                <div class="bg-upload-title">${uploadInfo.appName || 'Dosya Yüklemesi'}</div>
                <div class="bg-upload-progress">
                    <div class="progress">
                        <div class="progress-bar" id="bg-progress-${uploadInfo.sessionId}" style="width: 0%"></div>
                    </div>
                    <span class="progress-text" id="bg-text-${uploadInfo.sessionId}">0%</span>
                </div>
            </div>
        `;

        this.addNotificationToUI(notification);
    }

    // Background notification güncelle
    updateBackgroundNotification(sessionId, progress) {
        const progressBar = document.getElementById(`bg-progress-${sessionId}`);
        const progressText = document.getElementById(`bg-text-${sessionId}`);

        if (progressBar) progressBar.style.width = `${progress}%`;
        if (progressText) progressText.textContent = `${progress}%`;
    }

    // Upload tamamlandı notification
    showUploadCompleted(upload) {
        const message = upload.background 
            ? `Arka plan yüklemesi tamamlandı: ${upload.appName}`
            : `Dosya yüklemesi tamamlandı: ${upload.appName}`;
        
        this.showToast(message, 'success');

        if (upload.background) {
            setTimeout(() => {
                this.dismissBackgroundUpload(upload.sessionId);
            }, 5000);
        }
    }

    // Background upload'ı kapat
    dismissBackgroundUpload(sessionId) {
        const notification = document.getElementById(`bg-upload-${sessionId}`);
        if (notification) {
            notification.remove();
        }
        this.backgroundUploads.delete(sessionId);
    }

    // Dosya listesi güncelle
    updateFileList(files) {
        const container = document.getElementById('uploadFileList');
        if (!container) return;

        container.innerHTML = '';
        files.forEach(file => {
            const fileEl = document.createElement('div');
            fileEl.className = `upload-file-item ${file.status}`;
            fileEl.innerHTML = `
                <div class="file-info">
                    <i class="fas fa-file"></i>
                    <span class="file-name">${file.name}</span>
                </div>
                <div class="file-progress">
                    <div class="progress">
                        <div class="progress-bar" style="width: ${file.progress}%"></div>
                    </div>
                    <span class="progress-text">${file.progress}%</span>
                </div>
                <div class="file-status">
                    ${this.getFileStatusIcon(file.status)}
                </div>
            `;
            container.appendChild(fileEl);
        });
    }

    // Dosya durum iconu
    getFileStatusIcon(status) {
        const icons = {
            pending: '<i class="fas fa-clock text-muted"></i>',
            uploading: '<i class="fas fa-spinner fa-spin text-primary"></i>',
            completed: '<i class="fas fa-check-circle text-success"></i>',
            failed: '<i class="fas fa-times-circle text-danger"></i>'
        };
        return icons[status] || icons.pending;
    }

    // Extract progress güncelle
    updateExtractProgress(sessionId, fileName, progress) {
        const statusText = document.getElementById('uploadStatus');
        if (statusText) {
            statusText.textContent = `ZIP extract ediliyor: ${fileName} (%${progress})`;
        }
    }

    // Dosya durumu güncelle
    updateFileStatus(sessionId, fileName, status, message = '') {
        console.log(`Dosya durumu güncellendi: ${fileName} - ${status} (${message})`);
    }

    // Dosya progress güncelle
    updateFileProgress(sessionId, fileName, progress) {
        console.log(`Dosya progress: ${fileName} - %${progress}`);
    }

    // Upload hatası göster
    showUploadError(message, sessionId) {
        this.showToast(`Upload hatası: ${message}`, 'error');
    }

    // Notification UI'a ekle
    addNotificationToUI(notification) {
        let container = document.getElementById('backgroundNotifications');
        if (!container) {
            container = document.createElement('div');
            container.id = 'backgroundNotifications';
            container.className = 'background-notifications';
            document.body.appendChild(container);
        }
        container.appendChild(notification);
    }

    // Toast mesajı göster
    showToast(message, type = 'info') {
        if (window.packager && window.packager.showToast) {
            window.packager.showToast(message, type);
        } else {
            console.log(`Toast (${type}): ${message}`);
        }
    }

    // Bytes formatla
    formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    // Aktif upload'ları al
    getActiveUploads() {
        return Array.from(this.activeUploads.values());
    }

    // Background upload'ları al
    getBackgroundUploads() {
        return Array.from(this.backgroundUploads.values());
    }

    // Tüm upload'ları temizle
    cleanup() {
        this.activeUploads.clear();
        this.backgroundUploads.clear();
        
        const container = document.getElementById('backgroundNotifications');
        if (container) {
            container.remove();
        }
    }
}

// Global instance
window.uploadManager = null;
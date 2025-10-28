const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

class ChunkedUploadService {
  constructor() {
    // Chunk boyutu (5MB - optimize edilebilir)
    this.chunkSize = 5 * 1024 * 1024; // 5MB
    
    // Paralel upload sayısı (IDM tarzı)
    this.maxParallelUploads = 6;
    
    console.log('📦 Chunked Upload Servisi başlatıldı');
    console.log(`   Chunk boyutu: ${(this.chunkSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   Max paralel: ${this.maxParallelUploads}`);
  }

  /**
   * Dosyayı parçalara böl ve paralel upload et
   */
  async uploadFileInChunks(filePath, uploadUrl, onProgress) {
    try {
      const stats = await fs.stat(filePath);
      const fileSize = stats.size;
      const totalChunks = Math.ceil(fileSize / this.chunkSize);
      
      console.log(`📤 Parçalı upload başlıyor:`);
      console.log(`   Dosya: ${path.basename(filePath)}`);
      console.log(`   Boyut: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);
      console.log(`   Parça sayısı: ${totalChunks}`);
      console.log(`   Paralel: ${this.maxParallelUploads}`);
      
      // Upload session oluştur
      const sessionId = await this.createUploadSession(uploadUrl, {
        fileName: path.basename(filePath),
        fileSize: fileSize,
        totalChunks: totalChunks,
        chunkSize: this.chunkSize
      });
      
      console.log(`✅ Upload session oluşturuldu: ${sessionId}`);
      
      // Parçaları hazırla
      const chunks = [];
      for (let i = 0; i < totalChunks; i++) {
        const start = i * this.chunkSize;
        const end = Math.min(start + this.chunkSize, fileSize);
        chunks.push({
          index: i,
          start: start,
          end: end,
          size: end - start
        });
      }
      
      // Progress tracking
      let uploadedChunks = 0;
      let uploadedBytes = 0;
      
      const updateProgress = (chunkSize) => {
        uploadedChunks++;
        uploadedBytes += chunkSize;
        const progress = Math.floor((uploadedBytes / fileSize) * 100);
        
        if (onProgress) {
          onProgress({
            progress: progress,
            uploadedChunks: uploadedChunks,
            totalChunks: totalChunks,
            uploadedBytes: uploadedBytes,
            totalBytes: fileSize,
            speed: this.calculateSpeed(uploadedBytes, Date.now() - startTime)
          });
        }
        
        console.log(`📊 Progress: ${progress}% (${uploadedChunks}/${totalChunks} parça)`);
      };
      
      const startTime = Date.now();
      
      // Paralel upload (batch processing)
      for (let i = 0; i < chunks.length; i += this.maxParallelUploads) {
        const batch = chunks.slice(i, i + this.maxParallelUploads);
        
        await Promise.all(
          batch.map(chunk => 
            this.uploadChunk(filePath, chunk, sessionId, uploadUrl)
              .then(() => updateProgress(chunk.size))
          )
        );
      }
      
      const duration = Date.now() - startTime;
      const speed = (fileSize / 1024 / 1024) / (duration / 1000); // MB/s
      
      console.log(`✅ Upload tamamlandı!`);
      console.log(`   Süre: ${(duration / 1000).toFixed(2)} saniye`);
      console.log(`   Hız: ${speed.toFixed(2)} MB/s`);
      
      // Upload'u finalize et
      await this.finalizeUpload(uploadUrl, sessionId);
      
      return {
        success: true,
        sessionId: sessionId,
        duration: duration,
        speed: speed
      };
      
    } catch (error) {
      console.error('❌ Chunked upload hatası:', error.message);
      throw error;
    }
  }

  /**
   * Tek bir chunk upload et
   */
  async uploadChunk(filePath, chunk, sessionId, uploadUrl) {
    const { index, start, end } = chunk;
    
    // Dosyadan chunk oku
    const buffer = Buffer.alloc(end - start);
    const fd = await fs.open(filePath, 'r');
    await fs.read(fd, buffer, 0, end - start, start);
    await fs.close(fd);
    
    // FormData oluştur
    const form = new FormData();
    form.append('sessionId', sessionId);
    form.append('chunkIndex', index);
    form.append('chunk', buffer, {
      filename: `chunk_${index}`,
      contentType: 'application/octet-stream'
    });
    
    // Upload et (retry logic ile)
    let retries = 3;
    while (retries > 0) {
      try {
        await axios.post(`${uploadUrl}/chunk`, form, {
          headers: form.getHeaders(),
          timeout: 60000 // 60 saniye
        });
        return; // Başarılı
      } catch (error) {
        retries--;
        if (retries === 0) throw error;
        
        console.log(`⚠️ Chunk ${index} retry (${3 - retries}/3)`);
        await this.sleep(1000); // 1 saniye bekle
      }
    }
  }

  /**
   * Upload session oluştur
   */
  async createUploadSession(uploadUrl, metadata) {
    try {
      const response = await axios.post(`${uploadUrl}/session`, metadata);
      return response.data.sessionId;
    } catch (error) {
      console.error('❌ Session oluşturma hatası:', error.message);
      throw error;
    }
  }

  /**
   * Upload'u finalize et
   */
  async finalizeUpload(uploadUrl, sessionId) {
    try {
      await axios.post(`${uploadUrl}/finalize`, { sessionId });
      console.log('✅ Upload finalize edildi');
    } catch (error) {
      console.error('❌ Finalize hatası:', error.message);
      throw error;
    }
  }

  /**
   * Upload hızını hesapla
   */
  calculateSpeed(bytes, milliseconds) {
    const seconds = milliseconds / 1000;
    const mbps = (bytes / 1024 / 1024) / seconds;
    return `${mbps.toFixed(2)} MB/s`;
  }

  /**
   * Sleep utility
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = new ChunkedUploadService();

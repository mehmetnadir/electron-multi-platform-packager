const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const busboy = require('busboy');
const AdmZip = require('adm-zip');

class UploadService {
  constructor() {
    this.uploadSessions = new Map();
    this.chunkStorage = path.join(process.cwd(), 'chunks');
    this.uploadStatus = new Map();
    
    // Chunk storage klasörünü oluştur
    fs.ensureDirSync(this.chunkStorage);
  }

  // Dosya hash'i hesapla
  calculateFileHash(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      
      stream.on('data', (data) => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  // Buffer'dan hash hesapla
  calculateBufferHash(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  // Upload sessionı başlat
  async startUploadSession(sessionId, files, io, options = {}) {
    const { appName, appVersion, description } = options;
    
    const session = {
      sessionId,
      files: [],
      totalSize: 0,
      uploadedSize: 0,
      status: 'starting',
      startTime: Date.now(),
      appName,
      appVersion,
      description
    };

    // Dosya bilgilerini hazırla
    for (const file of files) {
      const fileInfo = {
        name: file.originalname || file.name,
        size: file.size,
        hash: null,
        chunks: [],
        uploadedChunks: 0,
        totalChunks: 0,
        status: 'pending'
      };
      
      session.files.push(fileInfo);
      session.totalSize += file.size;
    }

    this.uploadSessions.set(sessionId, session);
    this.uploadStatus.set(sessionId, session);

    // Real-time progress başlat
    this.emitProgress(sessionId, io);
    
    return session;
  }

  // Chunk-based upload handler
  async handleChunkedUpload(req, res, io) {
    const { sessionId, fileName, chunkIndex, totalChunks, fileHash } = req.query;
    
    if (!sessionId || !fileName || chunkIndex === undefined || !totalChunks) {
      return res.status(400).json({ error: 'Eksik parametreler' });
    }

    try {
      const session = this.uploadSessions.get(sessionId);
      if (!session) {
        return res.status(404).json({ error: 'Upload session bulunamadı' });
      }

      // Chunk klasörünü oluştur
      const chunkDir = path.join(this.chunkStorage, sessionId, fileName);
      await fs.ensureDir(chunkDir);

      // Chunk dosyasını kaydet
      const chunkPath = path.join(chunkDir, `chunk_${chunkIndex}`);
      const chunkData = req.body;
      
      await fs.writeFile(chunkPath, chunkData);

      // Session'ı güncelle
      const fileInfo = session.files.find(f => f.name === fileName);
      if (fileInfo) {
        fileInfo.uploadedChunks = parseInt(chunkIndex) + 1;
        fileInfo.totalChunks = parseInt(totalChunks);
        fileInfo.hash = fileHash;
        
        // Progress hesapla
        this.updateSessionProgress(sessionId, io);
        
        // Son chunk ise dosyayı birleştir
        if (fileInfo.uploadedChunks === fileInfo.totalChunks) {
          await this.assembleFile(sessionId, fileName, fileInfo, io);
        }
      }

      res.json({ 
        success: true, 
        chunkIndex: parseInt(chunkIndex),
        uploaded: fileInfo ? fileInfo.uploadedChunks : 0,
        total: fileInfo ? fileInfo.totalChunks : 0
      });

    } catch (error) {
      console.error('Chunk upload hatası:', error);
      res.status(500).json({ error: 'Chunk upload başarısız: ' + error.message });
    }
  }

  // Dosyayı chunk'lardan birleştir
  async assembleFile(sessionId, fileName, fileInfo, io) {
    const chunkDir = path.join(this.chunkStorage, sessionId, fileName);
    const uploadPath = path.join('uploads', sessionId);
    await fs.ensureDir(uploadPath);

    const finalPath = path.join(uploadPath, fileName);
    const writeStream = fs.createWriteStream(finalPath);

    try {
      // Chunk'ları sırayla birleştir
      for (let i = 0; i < fileInfo.totalChunks; i++) {
        const chunkPath = path.join(chunkDir, `chunk_${i}`);
        const chunkData = await fs.readFile(chunkPath);
        writeStream.write(chunkData);
      }

      writeStream.end();

      // Hash kontrolü yap
      const assembledHash = await this.calculateFileHash(finalPath);
      if (assembledHash !== fileInfo.hash) {
        throw new Error('Dosya hash uyumsuzluğu - upload bozuk');
      }

      fileInfo.status = 'completed';
      fileInfo.path = finalPath;

      // ZIP ise extract et
      if (fileName.endsWith('.zip')) {
        await this.extractZipFile(finalPath, uploadPath, fileName, io, sessionId);
      }

      // Paketleme için build-info.json oluştur (eski sistem uyumluluğu)
      await this.createBuildInfo(sessionId, uploadPath, io);

      // Chunk'ları temizle
      await fs.remove(chunkDir);

      // Progress güncelle
      this.updateSessionProgress(sessionId, io);

      console.log(`Dosya başarıyla birleştirildi: ${fileName}`);

    } catch (error) {
      fileInfo.status = 'failed';
      fileInfo.error = error.message;
      console.error('Dosya birleştirme hatası:', error);
      
      this.emitProgress(sessionId, io);
    }
  }

  // ZIP dosyasını extract et
  async extractZipFile(zipPath, uploadPath, fileName, io, sessionId) {
    try {
      console.log(`ZIP çıkarma başlatılıyor: ${fileName}`);
      
      const zip = new AdmZip(zipPath);
      const entries = zip.getEntries();

      let extractedCount = 0;
      const totalEntries = entries.filter(entry => !entry.isDirectory).length;
      
      console.log(`Toplam çıkarılacak dosya sayısı: ${totalEntries}`);

      // Başlangıç progress'i gönder
      io.emit('extract-progress', {
        sessionId,
        fileName,
        extractedCount: 0,
        totalEntries,
        progress: 0
      });

      for (const entry of entries) {
        if (!entry.isDirectory) {
          const entryPath = path.join(uploadPath, entry.entryName);
          await fs.ensureDir(path.dirname(entryPath));
          
          const data = entry.getData();
          await fs.writeFile(entryPath, data);
          
          extractedCount++;
          
          // Her dosya çıkarıldığında progress gönder
          const progress = Math.round((extractedCount / totalEntries) * 100);
          
          io.emit('extract-progress', {
            sessionId,
            fileName,
            extractedCount,
            totalEntries,
            progress
          });
          
          console.log(`Çıkarıldı: ${entry.entryName} (${extractedCount}/${totalEntries})`);
          
          // Her 10 dosyada bir kısa bekleme (UI'nın güncellenmesi için)
          if (extractedCount % 10 === 0) {
            await new Promise(resolve => setTimeout(resolve, 50));
          }
        }
      }

      // Son progress (%100) gönder
      io.emit('extract-progress', {
        sessionId,
        fileName,
        extractedCount,
        totalEntries,
        progress: 100
      });

      // Orijinal ZIP'i sil
      await fs.remove(zipPath);
      
      console.log(`ZIP dosyası başarıyla extract edildi: ${fileName}`);

    } catch (error) {
      console.error('ZIP extract hatası:', error);
      throw error;
    }
  }

  // Session progress güncelle
  updateSessionProgress(sessionId, io) {
    const session = this.uploadSessions.get(sessionId);
    if (!session) return;

    let totalUploaded = 0;
    let completedFiles = 0;

    session.files.forEach(file => {
      if (file.status === 'completed') {
        completedFiles++;
        totalUploaded += file.size;
      } else if (file.uploadedChunks && file.totalChunks) {
        const fileProgress = (file.uploadedChunks / file.totalChunks);
        totalUploaded += Math.round(file.size * fileProgress);
      }
    });

    session.uploadedSize = totalUploaded;
    session.progress = Math.round((totalUploaded / session.totalSize) * 100);
    session.completedFiles = completedFiles;

    // Tüm dosyalar tamamlandı mı?
    if (completedFiles === session.files.length) {
      session.status = 'completed';
      session.endTime = Date.now();
      session.duration = session.endTime - session.startTime;
    }

    this.emitProgress(sessionId, io);
  }

  // Progress emit et
  emitProgress(sessionId, io) {
    const session = this.uploadSessions.get(sessionId);
    if (!session) return;

    io.emit('upload-progress', {
      sessionId,
      progress: session.progress,
      uploadedSize: session.uploadedSize,
      totalSize: session.totalSize,
      completedFiles: session.completedFiles,
      totalFiles: session.files.length,
      status: session.status,
      files: session.files.map(f => ({
        name: f.name,
        status: f.status,
        progress: f.totalChunks ? Math.round((f.uploadedChunks / f.totalChunks) * 100) : 0
      }))
    });
  }

  // Resumable upload check - hash ile
  async checkResumeUpload(fileHash, fileName, sessionId) {
    // Hash ile daha önce upload edilmiş dosya var mı kontrol et
    const existingPath = await this.findFileByHash(fileHash);
    
    if (existingPath) {
      console.log(`Hash eşleşmesi bulundu, dosya atlanıyor: ${fileName}`);
      return {
        canResume: true,
        completed: true,
        path: existingPath,
        message: 'Dosya daha önce yüklenmiş, atlanıyor'
      };
    }

    // Yarım kalmış chunk'lar var mı kontrol et
    const chunkDir = path.join(this.chunkStorage, sessionId, fileName);
    if (await fs.pathExists(chunkDir)) {
      const chunks = await fs.readdir(chunkDir);
      const uploadedChunks = chunks.filter(f => f.startsWith('chunk_')).length;
      
      return {
        canResume: true,
        completed: false,
        uploadedChunks,
        message: `${uploadedChunks} chunk daha önce yüklendi, kaldığı yerden devam ediliyor`
      };
    }

    return {
      canResume: false,
      completed: false,
      uploadedChunks: 0,
      message: 'Yeni upload başlatılıyor'
    };
  }

  // Hash ile dosya ara
  async findFileByHash(targetHash) {
    try {
      const uploadsDir = path.join(process.cwd(), 'uploads');
      if (!await fs.pathExists(uploadsDir)) return null;

      const sessions = await fs.readdir(uploadsDir);
      
      for (const sessionDir of sessions) {
        const sessionPath = path.join(uploadsDir, sessionDir);
        if ((await fs.stat(sessionPath)).isDirectory()) {
          const files = await fs.readdir(sessionPath);
          
          for (const file of files) {
            const filePath = path.join(sessionPath, file);
            if ((await fs.stat(filePath)).isFile()) {
              const fileHash = await this.calculateFileHash(filePath);
              if (fileHash === targetHash) {
                return filePath;
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('Hash arama hatası:', error);
    }
    
    return null;
  }

  // Upload session bilgilerini al
  getUploadSession(sessionId) {
    return this.uploadSessions.get(sessionId);
  }

  // Tüm aktif upload'ları listele
  getActiveUploads() {
    return Array.from(this.uploadSessions.values()).filter(session => 
      session.status !== 'completed' && session.status !== 'failed'
    );
  }

  // Upload session'ı temizle
  cleanupSession(sessionId) {
    const session = this.uploadSessions.get(sessionId);
    if (session) {
      // Chunk dosyalarını temizle
      const sessionChunkDir = path.join(this.chunkStorage, sessionId);
      fs.remove(sessionChunkDir).catch(err => 
        console.error('Chunk cleanup hatası:', err)
      );
      
      this.uploadSessions.delete(sessionId);
      this.uploadStatus.delete(sessionId);
    }
  }
}

module.exports = new UploadService();

// Eski sistem uyumluluğu için build-info.json oluşturma metodu
UploadService.prototype.createBuildInfo = async function(sessionId, uploadPath, io) {
  try {
    const session = this.uploadSessions.get(sessionId);
    if (!session) return;

    // Upload edilen dosyaları tara
    const files = await fs.readdir(uploadPath);
    const fileStats = [];

    for (const file of files) {
      const filePath = path.join(uploadPath, file);
      const stat = await fs.stat(filePath);
      
      if (stat.isFile() && file !== 'build-info.json') {
        fileStats.push({
          originalName: file,
          filename: file,
          path: filePath,
          size: stat.size,
          type: file.endsWith('.zip') ? 'zip_extracted' : 'file'
        });
      }
    }

    // build-info.json oluştur (paketleme sistemi için gerekli)
    const buildInfo = {
      sessionId,
      appName: session.appName || 'Interactive Software',
      appVersion: session.appVersion || '1.0.0', 
      description: session.description || '',
      uploadedAt: new Date().toISOString(),
      files: fileStats,
      uploadMethod: 'enhanced' // Gelişmiş upload sistemi kullanıldığını belirt
    };

    const buildInfoPath = path.join(uploadPath, 'build-info.json');
    await fs.writeJson(buildInfoPath, buildInfo, { spaces: 2 });

    console.log(`build-info.json oluşturuldu: ${buildInfoPath}`);
    
    // Session'a build info ekle
    session.buildInfo = buildInfo;

  } catch (error) {
    console.error('build-info.json oluşturma hatası:', error);
  }
};
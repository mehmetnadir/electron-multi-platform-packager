/**
 * SSH Paketleme Servisi
 * Linux sunucuya SSH ile bağlanıp otomatik paketleme yapar
 */

const { NodeSSH } = require('node-ssh');
const path = require('path');
const fs = require('fs-extra');
const FormData = require('form-data');
const axios = require('axios');

class SSHPackagingService {
  constructor() {
    this.ssh = new NodeSSH();
    this.serverHost = process.env.LINUX_SERVER_HOST || '10.0.0.21';
    this.serverUser = process.env.LINUX_SERVER_USER || 'nadir';
    this.serverPath = process.env.LINUX_SERVER_PATH || '/home/nadir/elecron-paket';
    this.akillitahtaAPI = process.env.AKILLITAHTA_API || 'https://akillitahta.ndr.ist/api/v1';
    this.akillitahtaAuth = process.env.AKILLITAHTA_AUTH; // Basic auth base64
  }

  /**
   * SSH bağlantısı kur
   */
  async connect() {
    try {
      console.log('🔌 SSH bağlantısı kuruluyor:', this.serverHost);
      
      await this.ssh.connect({
        host: this.serverHost,
        username: this.serverUser,
        privateKey: process.env.SSH_PRIVATE_KEY_PATH || path.join(process.env.HOME, '.ssh/id_rsa')
      });
      
      console.log('✅ SSH bağlantısı kuruldu');
      return true;
    } catch (error) {
      console.error('❌ SSH bağlantı hatası:', error);
      throw error;
    }
  }

  /**
   * Linux sunucuda paketleme yap
   */
  async packageOnServer(options) {
    const {
      zipPath,
      appName,
      appVersion,
      publisherName,
      publisherId,
      platforms = ['linux'],
      uploadToR2 = true,
      bookId = null
    } = options;

    try {
      // SSH bağlan
      await this.connect();

      // 1. ZIP'i sunucuya gönder
      console.log('📤 ZIP sunucuya gönderiliyor...');
      const remoteZipPath = `${this.serverPath}/uploads/${path.basename(zipPath)}`;
      await this.ssh.putFile(zipPath, remoteZipPath);
      console.log('✅ ZIP gönderildi');

      // 2. Sunucuda paketleme komutunu çalıştır
      console.log('🚀 Sunucuda paketleme başlıyor...');
      
      const command = `
        cd ${this.serverPath} && \
        export FORCE_LINUX_PACKAGING=1 && \
        node -e "
          const PackagingService = require('./src/packaging/packagingService');
          const service = new PackagingService();
          const path = require('path');
          const fs = require('fs-extra');
          
          (async () => {
            try {
              // ZIP extract
              const AdmZip = require('adm-zip');
              const zip = new AdmZip('${remoteZipPath}');
              const extractPath = 'temp/ssh-job-${Date.now()}';
              await fs.ensureDir(extractPath);
              zip.extractAllTo(extractPath, true);
              
              // Paketleme
              const result = await service.packageLinux(
                extractPath,
                extractPath,
                '${appName}',
                '${appVersion}',
                null,
                {
                  description: '${appName}',
                  vendor: '${publisherName || 'DijiTap'}',
                  maintainer: '${appName} Team'
                },
                '${publisherName}',
                '${publisherId}',
                null,
                null,
                0,
                1
              );
              
              // .impark dosyasını bul
              const files = await fs.readdir(path.join(extractPath, 'linux'));
              const imparkFile = files.find(f => f.endsWith('.impark') || f.endsWith('.AppImage'));
              
              if (imparkFile) {
                console.log('SUCCESS:', path.join(extractPath, 'linux', imparkFile));
              } else {
                console.error('ERROR: .impark not found');
                process.exit(1);
              }
            } catch (error) {
              console.error('ERROR:', error.message);
              process.exit(1);
            }
          })();
        "
      `;

      const result = await this.ssh.execCommand(command, {
        cwd: this.serverPath,
        onStdout: (chunk) => {
          const output = chunk.toString('utf8');
          console.log('  Server:', output);
          
          // .impark dosya yolunu yakala
          if (output.includes('SUCCESS:')) {
            this.imparkPath = output.split('SUCCESS:')[1].trim();
          }
        },
        onStderr: (chunk) => {
          console.error('  Server Error:', chunk.toString('utf8'));
        }
      });

      if (result.code !== 0) {
        throw new Error(`Paketleme başarısız: ${result.stderr}`);
      }

      console.log('✅ Paketleme tamamlandı:', this.imparkPath);

      // 3. .impark dosyasını indir
      const localImparkPath = path.join(process.cwd(), 'output', path.basename(this.imparkPath));
      await fs.ensureDir(path.dirname(localImparkPath));
      
      console.log('📥 .impark indiriliyor...');
      await this.ssh.getFile(localImparkPath, this.imparkPath);
      console.log('✅ .impark indirildi:', localImparkPath);

      // 4. R2'ye yükle (opsiyonel)
      if (uploadToR2 && bookId) {
        console.log('☁️ R2\'ye yükleniyor...');
        await this.uploadToR2(localImparkPath, bookId, 'pardus');
        console.log('✅ R2\'ye yüklendi');
      }

      // 5. Sunucuda temizlik
      await this.ssh.execCommand(`rm -rf ${path.dirname(this.imparkPath)} ${remoteZipPath}`);
      console.log('🧹 Sunucuda temizlik yapıldı');

      // SSH bağlantısını kapat
      this.ssh.dispose();

      return {
        success: true,
        imparkPath: localImparkPath,
        uploadedToR2: uploadToR2
      };

    } catch (error) {
      console.error('❌ SSH paketleme hatası:', error);
      this.ssh.dispose();
      throw error;
    }
  }

  /**
   * R2'ye dosya yükle (akillitahta.ndr.ist API kullanarak)
   */
  async uploadToR2(filePath, bookId, platform = 'pardus') {
    try {
      const form = new FormData();
      form.append('file', fs.createReadStream(filePath));
      form.append('bookId', bookId);
      form.append('platform', platform);
      form.append('version', 'latest');

      const response = await axios.post(
        `${this.akillitahtaAPI}/upload`,
        form,
        {
          headers: {
            ...form.getHeaders(),
            'Authorization': `Basic ${this.akillitahtaAuth}`
          },
          maxContentLength: Infinity,
          maxBodyLength: Infinity
        }
      );

      return response.data;
    } catch (error) {
      console.error('❌ R2 upload hatası:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Kitap bilgilerini akillitahta.ndr.ist'den al
   */
  async getBookInfo(bookId) {
    try {
      const response = await axios.get(
        `${this.akillitahtaAPI}/book-pages/${bookId}`,
        {
          headers: {
            'Authorization': `Basic ${this.akillitahtaAuth}`
          }
        }
      );

      return response.data;
    } catch (error) {
      console.error('❌ Book info hatası:', error.response?.data || error.message);
      throw error;
    }
  }
}

module.exports = SSHPackagingService;

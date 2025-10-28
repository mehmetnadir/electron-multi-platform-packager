/**
 * Akıllı Tahta Paketleme Servisi
 * akillitahta.ndr.ist API kullanarak Linux paketleme yapar
 */

const FormData = require('form-data');
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');

class AkillitahtaPackagingService {
  constructor() {
    this.apiUrl = process.env.AKILLITAHTA_API || 'https://akillitahta.ndr.ist/api/v1';
    this.username = process.env.AKILLITAHTA_USERNAME;
    this.password = process.env.AKILLITAHTA_PASSWORD;
  }

  /**
   * Linux paketleme yap ve R2'ye yükle
   */
  async packageLinux(options) {
    const {
      zipPath,
      bookId,
      appName,
      appVersion,
      publisherName,
      publisherId,
      uploadToR2 = true,
      r2ConfigId = 'default'
    } = options;

    try {
      console.log('📤 Akıllı Tahta API\'ye gönderiliyor...');
      console.log('  - Book ID:', bookId);
      console.log('  - App:', appName, appVersion);
      console.log('  - ZIP:', zipPath);

      // Form data oluştur
      const form = new FormData();
      form.append('file', fs.createReadStream(zipPath));
      form.append('bookId', bookId);
      form.append('appName', appName);
      form.append('appVersion', appVersion);
      
      if (publisherName) form.append('publisherName', publisherName);
      if (publisherId) form.append('publisherId', publisherId);
      form.append('uploadToR2', uploadToR2.toString());
      form.append('r2ConfigId', r2ConfigId);

      // API'ye gönder
      const response = await axios.post(
        `${this.apiUrl}/package-linux`,
        form,
        {
          headers: {
            ...form.getHeaders(),
            'Authorization': `Basic ${Buffer.from(`${this.username}:${this.password}`).toString('base64')}`
          },
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
          timeout: 600000 // 10 dakika
        }
      );

      console.log('✅ Paketleme tamamlandı!');
      console.log('  - Job ID:', response.data.jobId);
      console.log('  - Dosya:', response.data.imparkFilename);
      
      if (response.data.r2Url) {
        console.log('  - R2 URL:', response.data.r2Url);
      }

      return response.data;

    } catch (error) {
      console.error('❌ Akıllı Tahta API hatası:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * API test et
   */
  async test() {
    try {
      const response = await axios.get(
        `${this.apiUrl}/package-linux/test`,
        {
          headers: {
            'Authorization': `Basic ${Buffer.from(`${this.username}:${this.password}`).toString('base64')}`
          }
        }
      );

      console.log('✅ API Test Başarılı:', response.data);
      return response.data;

    } catch (error) {
      console.error('❌ API Test Hatası:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Kitap bilgilerini al
   */
  async getBookInfo(bookId) {
    try {
      const response = await axios.get(
        `${this.apiUrl}/book-pages`,
        {
          headers: {
            'Authorization': `Basic ${Buffer.from(`${this.username}:${this.password}`).toString('base64')}`
          }
        }
      );

      // bookId ile eşleşen kitabı bul
      const book = response.data.find(b => b.bookId === bookId);
      return book;

    } catch (error) {
      console.error('❌ Book info hatası:', error.response?.data || error.message);
      throw error;
    }
  }
}

module.exports = AkillitahtaPackagingService;

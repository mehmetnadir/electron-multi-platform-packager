/**
 * Console Monitor - Server Console Loglarını Yakalar
 * 
 * Bu utility server console çıktısını yakalar ve analiz eder.
 */

const { spawn } = require('child_process');
const EventEmitter = require('events');

class ConsoleMonitor extends EventEmitter {
  constructor() {
    super();
    this.logs = [];
    this.errors = [];
    this.warnings = [];
    this.serverProcess = null;
    this.isRunning = false;
  }

  /**
   * Server'ı başlat ve logları yakala
   */
  async startServer(command = 'npm', args = ['run', 'electron'], cwd = process.cwd()) {
    return new Promise((resolve, reject) => {
      console.log('🚀 Server başlatılıyor ve loglar izleniyor...');
      
      this.serverProcess = spawn(command, args, {
        cwd,
        stdio: 'pipe',
        shell: true,
        env: {
          ...process.env,
          FORCE_COLOR: '0' // ANSI color kodlarını devre dışı bırak
        }
      });

      this.isRunning = true;

      // STDOUT'u yakala
      this.serverProcess.stdout.on('data', (data) => {
        const message = data.toString().trim();
        if (message) {
          this._processLog(message, 'stdout');
        }
      });

      // STDERR'u yakala
      this.serverProcess.stderr.on('data', (data) => {
        const message = data.toString().trim();
        if (message) {
          this._processLog(message, 'stderr');
        }
      });

      // Process events
      this.serverProcess.on('error', (error) => {
        console.error('❌ Server başlatma hatası:', error.message);
        reject(error);
      });

      this.serverProcess.on('close', (code) => {
        console.log(`🏁 Server kapandı (exit code: ${code})`);
        this.isRunning = false;
        this.emit('close', code);
      });

      // Server'ın başladığını kontrol et (5 saniye bekle)
      setTimeout(() => {
        if (this.isRunning) {
          console.log('✅ Server başlatıldı ve loglar izleniyor');
          resolve();
        } else {
          reject(new Error('Server başlatılamadı'));
        }
      }, 5000);
    });
  }

  /**
   * Log mesajını işle ve kategorize et
   */
  _processLog(message, source) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      message,
      source,
      type: this._detectLogType(message)
    };

    this.logs.push(logEntry);

    // Kategorize et
    if (logEntry.type === 'error') {
      this.errors.push(logEntry);
      this.emit('error', logEntry);
    } else if (logEntry.type === 'warning') {
      this.warnings.push(logEntry);
      this.emit('warning', logEntry);
    }

    // Özel event'ler
    if (message.includes('Electron Builder')) {
      this.emit('electron-builder', logEntry);
    }
    if (message.includes('DMG')) {
      this.emit('dmg', logEntry);
    }
    if (message.includes('Paketleme tamamlandı')) {
      this.emit('packaging-complete', logEntry);
    }
    if (message.includes('Paketleme başarısız')) {
      this.emit('packaging-failed', logEntry);
    }

    // Tüm loglar için genel event
    this.emit('log', logEntry);
  }

  /**
   * Log tipini tespit et
   */
  _detectLogType(message) {
    const lowerMessage = message.toLowerCase();
    
    if (lowerMessage.includes('error') || 
        lowerMessage.includes('❌') ||
        lowerMessage.includes('failed') ||
        lowerMessage.includes('başarısız')) {
      return 'error';
    }
    
    if (lowerMessage.includes('warning') || 
        lowerMessage.includes('⚠️') ||
        lowerMessage.includes('warn')) {
      return 'warning';
    }
    
    if (lowerMessage.includes('✅') || 
        lowerMessage.includes('success') ||
        lowerMessage.includes('başarılı')) {
      return 'success';
    }
    
    return 'info';
  }

  /**
   * Belirli bir pattern'i loglar içinde ara
   */
  searchLogs(pattern, options = {}) {
    const { type = null, source = null, since = null } = options;
    
    return this.logs.filter(log => {
      // Type filtresi
      if (type && log.type !== type) return false;
      
      // Source filtresi
      if (source && log.source !== source) return false;
      
      // Zaman filtresi
      if (since && new Date(log.timestamp) < since) return false;
      
      // Pattern match
      if (pattern instanceof RegExp) {
        return pattern.test(log.message);
      } else {
        return log.message.includes(pattern);
      }
    });
  }

  /**
   * Son N logu getir
   */
  getRecentLogs(count = 10, type = null) {
    let logs = type ? this.logs.filter(l => l.type === type) : this.logs;
    return logs.slice(-count);
  }

  /**
   * Logları temizle
   */
  clearLogs() {
    this.logs = [];
    this.errors = [];
    this.warnings = [];
  }

  /**
   * Özet rapor
   */
  getSummary() {
    return {
      total: this.logs.length,
      errors: this.errors.length,
      warnings: this.warnings.length,
      success: this.logs.filter(l => l.type === 'success').length,
      info: this.logs.filter(l => l.type === 'info').length,
      isRunning: this.isRunning
    };
  }

  /**
   * Logları dosyaya kaydet
   */
  async saveLogs(filepath) {
    const fs = require('fs-extra');
    const content = this.logs.map(log => 
      `[${log.timestamp}] [${log.type.toUpperCase()}] [${log.source}] ${log.message}`
    ).join('\n');
    
    await fs.writeFile(filepath, content, 'utf8');
    console.log(`📄 Loglar kaydedildi: ${filepath}`);
  }

  /**
   * Logları konsola yazdır
   */
  printLogs(options = {}) {
    const { type = null, count = null, pattern = null } = options;
    
    let logs = this.logs;
    
    if (type) {
      logs = logs.filter(l => l.type === type);
    }
    
    if (pattern) {
      logs = this.searchLogs(pattern, { type });
    }
    
    if (count) {
      logs = logs.slice(-count);
    }
    
    console.log('\n' + '='.repeat(80));
    console.log(`📋 CONSOLE LOGS (${logs.length} mesaj)`);
    console.log('='.repeat(80));
    
    logs.forEach(log => {
      const icon = {
        error: '❌',
        warning: '⚠️',
        success: '✅',
        info: 'ℹ️'
      }[log.type] || '📝';
      
      const time = new Date(log.timestamp).toLocaleTimeString('tr-TR');
      console.log(`${icon} [${time}] ${log.message}`);
    });
    
    console.log('='.repeat(80) + '\n');
  }

  /**
   * Server'ı durdur
   */
  async stopServer() {
    if (this.serverProcess && this.isRunning) {
      console.log('🛑 Server durduruluyor...');
      this.serverProcess.kill();
      
      return new Promise((resolve) => {
        this.once('close', () => {
          console.log('✅ Server durduruldu');
          resolve();
        });
        
        // Timeout
        setTimeout(() => {
          if (this.isRunning) {
            console.log('⚠️ Server zorla kapatılıyor...');
            this.serverProcess.kill('SIGKILL');
          }
          resolve();
        }, 5000);
      });
    }
  }

  /**
   * Belirli bir event için bekle
   */
  async waitForEvent(eventName, timeout = 30000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timeout: ${eventName} event'i ${timeout}ms içinde gelmedi`));
      }, timeout);
      
      this.once(eventName, (data) => {
        clearTimeout(timer);
        resolve(data);
      });
    });
  }

  /**
   * Belirli bir log pattern'i için bekle
   */
  async waitForLog(pattern, timeout = 30000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timeout: "${pattern}" log mesajı ${timeout}ms içinde gelmedi`));
      }, timeout);
      
      const checkLog = (log) => {
        const matches = pattern instanceof RegExp 
          ? pattern.test(log.message)
          : log.message.includes(pattern);
          
        if (matches) {
          clearTimeout(timer);
          this.removeListener('log', checkLog);
          resolve(log);
        }
      };
      
      this.on('log', checkLog);
    });
  }
}

module.exports = ConsoleMonitor;

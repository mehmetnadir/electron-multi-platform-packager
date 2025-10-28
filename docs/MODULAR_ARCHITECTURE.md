# Modüler Platform Paketleme Mimarisi

## 🎯 Hedef

Her platform için izole edilmiş, API-driven paketleme servisleri oluşturmak.

## 🏗️ Mimari Tasarım

### 1. Platform Servis Katmanı
```
src/
├── platforms/
│   ├── interfaces/
│   │   ├── IPlatformPackager.js      # Temel interface
│   │   ├── IProgressReporter.js      # Progress tracking interface
│   │   └── IErrorHandler.js          # Hata yönetimi interface
│   ├── windows/
│   │   ├── WindowsPackagingService.js
│   │   ├── WindowsValidator.js
│   │   └── WindowsErrorHandler.js
│   ├── macos/
│   │   ├── MacOSPackagingService.js
│   │   ├── MacOSValidator.js
│   │   └── MacOSErrorHandler.js
│   ├── linux/
│   │   ├── LinuxPackagingService.js
│   │   ├── LinuxValidator.js
│   │   └── LinuxErrorHandler.js
│   ├── android/
│   │   ├── AndroidPackagingService.js
│   │   ├── AndroidValidator.js
│   │   └── AndroidErrorHandler.js
│   ├── pwa/
│   │   ├── PWAPackagingService.js
│   │   ├── PWAValidator.js
│   │   └── PWAErrorHandler.js
│   └── common/
│       ├── BasePackagingService.js   # Ortak işlevler
│       ├── FileHashService.js        # Hash hesaplama
│       ├── LogoService.js            # Logo işleme
│       └── ValidationService.js      # Genel validasyon
└── registry/
    ├── PlatformRegistry.js           # Platform kayıt sistemi
    └── ServiceManager.js             # Servis yönetimi
```

### 2. API Katmanı
```
src/
├── api/
│   ├── routes/
│   │   ├── platforms.js              # Platform listesi ve bilgileri
│   │   ├── packaging.js              # Paketleme işlemleri
│   │   └── health.js                 # Sağlık kontrolü
│   └── middleware/
│       ├── authentication.js        # Kimlik doğrulama
│       ├── validation.js            # Request validasyonu
│       └── errorHandler.js          # API hata yönetimi
```

### 3. Orkestratör Katmanı
```
src/
├── orchestrator/
│   ├── PackagingOrchestrator.js      # Ana koordinatör
│   ├── JobManager.js                 # İş yönetimi
│   └── ProgressAggregator.js         # Progress toplama
```

## 🔄 Veri Akışı

1. **İstek → API → Orkestratör → Platform Servisi → Sonuç**
2. **Platform Servisi → Progress Reporter → WebSocket → İstemci**
3. **Hata → Error Handler → Orkestratör → API → İstemci**

## 🛡️ İzolasyon Stratejileri

### Platform İzolasyonu
- Her platform kendi klasöründe
- Bağımsız dependency injection
- Ayrı test suites
- Kendi error handling

### API İzolasyonu
- REST endpoint'ler per platform
- Versioning support (v1, v2)
- Rate limiting per platform
- Independent caching

### Hata İzolasyonu
- Platform-specific error types
- Graceful degradation
- Fallback mechanisms
- Circuit breaker pattern

## 📊 Servis Kayıt Sistemi

```javascript
// Platform Registry
const registry = {
  windows: {
    service: WindowsPackagingService,
    version: '1.0.0',
    health: 'healthy',
    lastCheck: '2025-01-25T10:00:00Z'
  },
  // ... diğer platformlar
}
```

## 🔧 Konfigürasyon

### Platform Konfigürasyonu
```javascript
// platform-config.js
{
  windows: {
    enabled: true,
    timeout: 300000,     // 5 dakika
    retries: 3,
    dependencies: ['electron-builder', 'nsis']
  },
  android: {
    enabled: true,
    timeout: 600000,     // 10 dakika
    retries: 2,
    dependencies: ['capacitor', 'gradle']
  }
  // ...
}
```

## 📈 Monitoring ve Health Checks

### Servis Sağlığı
- Dependency kontrolü
- Resource kullanım
- Son packaging zamanı
- Hata oranları

### Metrikler
- Platform başarı oranları
- Ortalama packaging süreleri
- Resource kullanımı
- Error rate per platform

## 🚀 Migration Stratejisi

1. **Aşama 1**: Interface'ler ve base classes
2. **Aşama 2**: Platform servislerini tek tek migrate et
3. **Aşama 3**: API layer'ı güncelle
4. **Aşama 4**: Orkestratörü yeni sisteme adapte et
5. **Aşama 5**: Eski sistemi deprecate et

## 🧪 Test Stratejisi

### Platform Test'leri
- Unit tests per platform
- Integration tests
- End-to-end scenarios
- Performance benchmarks

### Sistem Test'leri
- Multi-platform concurrent packaging
- Error recovery scenarios
- Load testing
- Regression testing

## 📚 API Dokümantasyonu

### RESTful Endpoints
```
POST /api/v1/platforms/{platform}/package
GET  /api/v1/platforms/{platform}/health
GET  /api/v1/platforms/{platform}/status/{jobId}
GET  /api/v1/platforms
```

### WebSocket Events
```
platform.packaging.started
platform.packaging.progress
platform.packaging.completed
platform.packaging.failed
```

## 🔄 Geriye Dönük Uyumluluk

- Eski API endpoints 6 ay daha desteklenecek
- Deprecation warnings
- Migration guides
- Automatic redirects where possible
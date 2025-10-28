---
description: Electron Paketleyici uygulamasını çalıştır
---

# Electron Paketleyici Uygulamasını Çalıştırma

Bu workflow, Electron Paketleyici uygulamasını Electron penceresi içinde başlatır.

## Adımlar

1. Ana dizine git: `/Users/nadir/01dev/elecron-paket`

2. Eğer çalışan bir server varsa durdur:
```bash
pkill -f "node src/server/app.js"
```

// turbo
3. Electron uygulamasını başlat:
```bash
npm run electron
```

## Notlar

- **Ana Uygulama**: Electron Paketleyici (Electron Desktop App)
- **Test Uygulaması**: `pwa-test/` klasörü sadece test amaçlı örnek kitap uygulamasıdır
- Backend otomatik olarak `http://localhost:3000` adresinde başlar
- Socket.IO bağlantısı otomatik kurulur
- Kuyruk sistemi otomatik başlatılır (Max 5 paralel paketleme, 2 paralel ZIP)

## Komut Açıklaması

- `npm run electron` → `electron src/main.js` çalıştırır
- `src/main.js`: Electron ana dosyası
- `src/server/app.js`: Backend server (otomatik başlar)

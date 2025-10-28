# 🌍 Translation Map: Turkish → English

## UI Strings

### Main Interface
| Turkish | English |
|---------|---------|
| Paketleme Servisi | Packaging Service |
| Kitap Paketleme | App Packaging |
| Yayınevi | Publisher |
| Paketleme Başlat | Start Packaging |
| Kuyruk | Queue |
| Aktif İşler | Active Jobs |
| Tamamlanan İşler | Completed Jobs |
| Başarılı | Success |
| Başarısız | Failed |
| İptal | Cancel |
| Temizle | Clear |
| İndir | Download |
| Yükle | Upload |
| Seç | Select |
| Kaydet | Save |
| Sil | Delete |

### Packaging Status
| Turkish | English |
|---------|---------|
| Paketleme başladı | Packaging started |
| Paketleme tamamlandı | Packaging completed |
| Paketleme başarısız | Packaging failed |
| Kuyruğa eklendi | Added to queue |
| İşleniyor | Processing |
| Bekliyor | Waiting |
| Hazırlanıyor | Preparing |
| ZIP açılıyor | Extracting ZIP |
| ZIP açma tamamlandı | ZIP extraction completed |
| Bağımlılıklar yükleniyor | Installing dependencies |
| Icon hazırlanıyor | Preparing icon |
| Paket oluşturuluyor | Creating package |

### Platform Names
| Turkish | English |
|---------|---------|
| Windows paketleme | Windows packaging |
| macOS paketleme | macOS packaging |
| Linux paketleme | Linux packaging |
| Android paketleme | Android packaging |
| PWA paketleme | PWA packaging |

### File Operations
| Turkish | English |
|---------|---------|
| Dosya yükleme | File upload |
| Dosya indirme | File download |
| Dosya silme | File deletion |
| Dosya bulunamadı | File not found |
| Dosya yüklendi | File uploaded |
| Dosya hazır | File ready |

### Errors
| Turkish | English |
|---------|---------|
| Hata oluştu | Error occurred |
| Bağlantı hatası | Connection error |
| Dosya hatası | File error |
| Paketleme hatası | Packaging error |
| Geçersiz dosya | Invalid file |
| Eksik bilgi | Missing information |
| İşlem başarısız | Operation failed |

---

## Console Logs

### General
| Turkish | English |
|---------|---------|
| Sunucu başlatılıyor | Starting server |
| Sunucu çalışıyor | Server running |
| Bağlantı kuruldu | Connected |
| Bağlantı kesildi | Disconnected |
| İstemci bağlandı | Client connected |
| Kuyruk sistemi başlatıldı | Queue system initialized |

### Packaging
| Turkish | English |
|---------|---------|
| Paketleme işlemi başlatılıyor | Starting packaging process |
| ZIP dosyası kuyruğa ekleniyor | Adding ZIP to queue |
| ZIP açma başladı | ZIP extraction started |
| Electron bağımlılıkları yükleniyor | Installing Electron dependencies |
| Varsayılan icon oluşturuluyor | Creating default icon |
| Logo yolu alındı | Logo path retrieved |
| Yayınevi logosu kullanılacak | Publisher logo will be used |

### Queue
| Turkish | English |
|---------|---------|
| Kuyruk boş | Queue empty |
| Hazır job yok | No ready jobs |
| Hazır job sayısı | Ready jobs count |
| İş kuyruğa eklendi | Job added to queue |
| İş başlatıldı | Job started |
| İş tamamlandı | Job completed |
| İş başarısız | Job failed |

### Cleanup
| Turkish | English |
|---------|---------|
| Temizlik başlatılıyor | Starting cleanup |
| Temizlik tamamlandı | Cleanup completed |
| Dosya silindi | File deleted |
| Klasör silindi | Folder deleted |
| Boş klasör silindi | Empty folder deleted |
| Upload klasörü temizleniyor | Cleaning upload folder |
| Temp klasörü temizleniyor | Cleaning temp folder |

---

## Code Comments

### General
| Turkish | English |
|---------|---------|
| Ayarlar | Settings |
| Yapılandırma | Configuration |
| Yardımcı fonksiyon | Helper function |
| Gerekli klasörleri oluştur | Create required directories |
| Varsayılan değerler | Default values |

### Packaging
| Turkish | English |
|---------|---------|
| Paketleme servisi | Packaging service |
| Platform işleyici | Platform handler |
| Icon oluşturucu | Icon generator |
| Bağımlılık yöneticisi | Dependency manager |
| Kuyruk yöneticisi | Queue manager |

### Error Handling
| Turkish | English |
|---------|---------|
| Hata yakalama | Error handling |
| Hata mesajı | Error message |
| Hata durumunda | On error |
| Hata logla | Log error |

---

## File Names

### Keep As-Is (Already English)
```
packagingService.js ✅
queueService.js ✅
uploadService.js ✅
logoService.js ✅
configManager.js ✅
```

### No Turkish File Names Found ✅

---

## Variable Names

### Keep Camel Case (Already English)
```javascript
sessionId ✅
appName ✅
appVersion ✅
logoPath ✅
workingPath ✅
tempPath ✅
outputPath ✅
```

### No Turkish Variables Found ✅

---

## Configuration

### Config Keys
| Turkish | English |
|---------|---------|
| ayarlar | settings |
| yapilandirma | configuration |
| yayinevi | publisher |
| varsayilan | default |

---

## Documentation

### README Sections
| Turkish | English |
|---------|---------|
| Kurulum | Installation |
| Kullanım | Usage |
| Özellikler | Features |
| Gereksinimler | Requirements |
| Katkıda Bulunma | Contributing |
| Lisans | License |
| Destek | Support |

---

## Search & Replace Commands

### For VS Code:
```regex
# Find Turkish strings in console.log
console\.log\(['"].*[çğıöşüÇĞİÖŞÜ].*['"]\)

# Find Turkish comments
//.*[çğıöşüÇĞİÖŞÜ].*

# Find Turkish strings in UI
['"].*[çğıöşüÇĞİÖŞÜ].*['"]
```

---

## Priority Translation List

### High Priority (User-facing):
1. ✅ UI strings (index.html, app.js)
2. ✅ Error messages
3. ✅ Status messages
4. ✅ Button labels

### Medium Priority:
1. ✅ Console logs
2. ✅ Comments
3. ✅ Documentation

### Low Priority:
1. ✅ Internal variable names (already English)
2. ✅ File names (already English)

---

## Automated Translation Script

```javascript
// translate.js
const translations = {
  'Paketleme başladı': 'Packaging started',
  'Paketleme tamamlandı': 'Packaging completed',
  // ... add all translations
};

function translateFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  
  for (const [tr, en] of Object.entries(translations)) {
    content = content.replace(new RegExp(tr, 'g'), en);
  }
  
  fs.writeFileSync(filePath, content);
}
```

---

**Total Translation Items:** ~150
**Estimated Time:** 2-3 hours
**Tools:** VS Code Find & Replace, regex

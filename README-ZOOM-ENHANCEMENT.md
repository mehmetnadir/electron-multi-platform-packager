# HTML Etkinlik Zoom+Pan Geliştirmesi

## Genel Bakış
Bu sistem, sürükle-bırak, eşleştirme ve diğer etkileşimli öğelerde kullanılan konum tabanlı hesaplamaları bozmadan HTML etkileşimli etkinliklerine otomatik olarak zoom ve pan işlevselliği ekler.

## Otomatik Uygulama

### Script Kullanımı
Tüm HTML etkinliklerini geliştirmek için otomasyon scriptini çalıştırın:

```bash
node apply-zoom-to-all-activities.js [dizin]
```

**Örnekler:**
```bash
# Mevcut dizindeki tüm etkinlikleri işle
node apply-zoom-to-all-activities.js

# Belirli dizindeki etkinlikleri işle
node apply-zoom-to-all-activities.js ./uploads

# Test dizinindeki etkinlikleri işle
node apply-zoom-to-all-activities.js ./test
```

## Eklenen Özellikler

✅ **Zoom Kontrolleri**
- `+` düğmesi: Yakınlaştır (maks 3x)
- `-` düğmesi: Uzaklaştır (min 0.5x)
- `1:1` düğmesi: Orijinal boyuta sıfırla

✅ **Fare Tekerleği Zoom**
- Ctrl/Cmd + kaydırma ile zoom yap
- Etkinliğin herhangi bir yerinden çalışır

✅ **Pan/Sürükleme İşlevselliği**
- Zoom > 1.1x olduğunda tıklayıp sürükleyerek pan yap
- Akıllı algılama etkileşimli öğelerle karışmayı önler
- Sadece düğmeler, sürüklenebilir öğeler vb. tıklanmadığında etkinleşir

✅ **Zoom Durumu Kalıcılığı**
- Etkinlikler arası zoom seviyesini hatırlar
- Gezinirken pan konumunu korur
- Kalıcılık için localStorage kullanır

✅ **Akıllı Etkileşim Algılama**
- Etkileşimli öğeleri otomatik olarak algılar:
  - Düğmeler, girişler, sürüklenebilir öğeler
  - onclick işleyicili öğeler
  - `cursor: pointer` olan öğeler
  - Belirli sınıflara sahip öğeler (`draggable`, `interactive`)
- Pan modu sadece etkileşimli olmayan alanlarda etkinleşir

## Manuel Kurulum

Tek bir HTML etkinliğine manuel olarak zoom işlevselliği eklemeniz gerekiyorsa:

### 1. CSS Ekle (`</head>` etiketinden önce)
```html
<style>
/* Zoom+Pan Enhancement CSS */
.zoom-controls {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  background: rgba(255, 255, 255, 0.95);
  padding: 12px;
  border-radius: 8px;
  box-shadow: 0 4px 15px rgba(0,0,0,0.2);
  backdrop-filter: blur(5px);
  min-width: 80px;
}

.zoom-btn-row {
  display: flex;
  gap: 8px;
}

.zoom-btn {
  width: 32px;
  height: 32px;
  border: 2px solid #4a90e2;
  background: white;
  cursor: pointer;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  font-size: 18px;
  color: #4a90e2;
  transition: all 0.2s ease;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.zoom-btn:hover {
  background: #4a90e2;
  color: white;
  transform: translateY(-1px);
  box-shadow: 0 4px 8px rgba(0,0,0,0.2);
}

.zoom-btn:active {
  transform: translateY(0);
}

.zoom-level {
  font-size: 12px;
  font-weight: bold;
  color: #333;
  background: rgba(74, 144, 226, 0.1);
  padding: 4px 8px;
  border-radius: 4px;
  border: 1px solid rgba(74, 144, 226, 0.3);
  min-width: 45px;
  text-align: center;
}

.zoom-reset {
  width: 60px;
  height: 28px;
  font-size: 11px;
  background: #f8f9fa;
  border: 2px solid #6c757d;
  color: #6c757d;
}

.zoom-reset:hover {
  background: #6c757d;
  color: white;
}

#activity-viewport {
  overflow: hidden;
  position: relative;
  width: 100%;
  height: 100%;
}

#root {
  transform-origin: 0 0;
  transition: transform 0.2s ease;
  cursor: grab;
}

#root:active {
  cursor: grabbing;
}

#root.dragging {
  cursor: grabbing !important;
}

#root * {
  pointer-events: auto;
}

#root.panning * {
  pointer-events: none;
}
</style>
```

### 2. Zoom Kontrollerini Ekle (toolbar bölümünde)
```html
<!-- Zoom Controls -->
<div class="zoom-controls">
  <div class="zoom-btn-row">
    <button class="zoom-btn" onclick="zoomIn()" title="Yakınlaştır">+</button>
    <button class="zoom-btn" onclick="zoomOut()" title="Uzaklaştır">-</button>
  </div>
  <div class="zoom-level" id="zoom-level">100%</div>
  <button class="zoom-btn zoom-reset" onclick="resetZoom()" title="Orijinal boyut">1:1</button>
</div>
```

### 3. Root Öğesini Sar
Değiştir:
```html
<div id="root"></div>
```
Şuna:
```html
<div id="activity-viewport"><div id="root"></div></div>
```

### 4. JavaScript Ekle (`</body>` etiketinden önce)
```html
<script>
// Zoom+Pan Enhancement JavaScript
let currentZoom = 1;
let currentPanX = 0;
let currentPanY = 0;
let isDragging = false;

function updateTransform() {
  const root = document.getElementById('root');
  const zoomLevel = document.getElementById('zoom-level');
  if (root) {
    root.style.transform = `scale(${currentZoom}) translate(${currentPanX}px, ${currentPanY}px)`;
  }
  if (zoomLevel) {
    zoomLevel.textContent = Math.round(currentZoom * 100) + '%';
  }
}

function zoomIn() {
  currentZoom = Math.min(currentZoom * 1.2, 3);
  updateTransform();
  saveZoomState();
}

function zoomOut() {
  currentZoom = Math.max(currentZoom / 1.2, 0.5);
  updateTransform();
  saveZoomState();
}

function resetZoom() {
  currentZoom = 1;
  currentPanX = 0;
  currentPanY = 0;
  updateTransform();
  saveZoomState();
}

function saveZoomState() {
  try {
    localStorage.setItem('activityZoom', JSON.stringify({
      zoom: currentZoom,
      panX: currentPanX,
      panY: currentPanY
    }));
  } catch (e) {
    console.log('Could not save zoom state:', e);
  }
}

function loadZoomState() {
  try {
    const saved = localStorage.getItem('activityZoom');
    if (saved) {
      const state = JSON.parse(saved);
      currentZoom = state.zoom || 1;
      currentPanX = state.panX || 0;
      currentPanY = state.panY || 0;
      updateTransform();
    }
  } catch (e) {
    console.log('Could not load zoom state:', e);
  }
}

function initializePan() {
  const root = document.getElementById('root');
  if (!root) return;

  let startX, startY, initialPanX, initialPanY;

  root.addEventListener('mousedown', function(e) {
    // Check if we're clicking on an interactive element
    const target = e.target;
    const isInteractive = target.tagName === 'BUTTON' || 
                         target.tagName === 'INPUT' || 
                         target.onclick || 
                         target.ondrag || 
                         target.draggable ||
                         target.classList.contains('draggable') ||
                         target.classList.contains('interactive') ||
                         target.getAttribute('data-interactive') ||
                         getComputedStyle(target).cursor === 'pointer';

    if (isInteractive || currentZoom <= 1.1) return;

    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    initialPanX = currentPanX;
    initialPanY = currentPanY;
    
    root.classList.add('panning');
    e.preventDefault();
  });

  document.addEventListener('mousemove', function(e) {
    if (!isDragging) return;

    const deltaX = e.clientX - startX;
    const deltaY = e.clientY - startY;
    
    currentPanX = initialPanX + deltaX / currentZoom;
    currentPanY = initialPanY + deltaY / currentZoom;
    
    updateTransform();
    e.preventDefault();
  });

  document.addEventListener('mouseup', function() {
    if (isDragging) {
      isDragging = false;
      root.classList.remove('panning');
      saveZoomState();
    }
  });

  // Wheel zoom
  root.addEventListener('wheel', function(e) {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const newZoom = Math.max(0.5, Math.min(3, currentZoom * delta));
      
      if (newZoom !== currentZoom) {
        currentZoom = newZoom;
        updateTransform();
        saveZoomState();
      }
    }
  });
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
  loadZoomState();
  initializePan();
});

// Also initialize after a short delay
setTimeout(function() {
  loadZoomState();
  initializePan();
}, 500);
</script>
```

## Teknik Detaylar

### Nasıl Çalışır
1. **CSS Transform Ölçeklendirme**: Tüm etkinlik alanını zoom yapmak için `transform: scale()` kullanır
2. **Koordinat Telafisi**: Pan hesaplamaları doğru hareketi korumak için zoom faktörüne bölünür
3. **Olay Filtreleme**: Akıllı algılama pan'in etkileşimli öğelerle karışmasını önler
4. **Viewport Sarmalayıcı**: `#activity-viewport` overflow kontrolü sağlar

### Zoom Sınırları
- **Minimum**: 0.5x (%50 boyut)
- **Maksimum**: 3x (%300 boyut)
- **Varsayılan**: 1x (orijinal boyut)

### Pan Etkinleştirme
- Sadece zoom > 1.1x olduğunda etkinleşir
- Etkileşimli öğelerde devre dışı
- Pointer olaylarını kontrol etmek için CSS sınıfları kullanır

### Tarayıcı Uyumluluğu
- Tüm modern tarayıcılarda çalışır
- Standart web API'lerini kullanır
- Eski tarayıcılar için zarif gerileme

## Sorun Giderme

### Yaygın Sorunlar

**Zoom kontrolleri görünmüyor**
- Zoom kontrolleri CSS'inin düzgün eklenip eklenmediğini kontrol edin
- z-index'in yeterince yüksek olduğunu doğrulayın (1000)

**Pan çalışmıyor**
- Zoom seviyesinin > 1.1x olduğundan emin olun
- Etkileşimli öğelere tıklanıp tıklanmadığını kontrol edin
- `initializePan()` fonksiyonunun çağrıldığını doğrulayın

**Etkinlik öğeleri yanıt vermiyor**
- Panning modunun takılıp takılmadığını kontrol edin (`.panning` sınıfını kaldırın)
- Pointer-events'in doğru ayarlandığını doğrulayın

**Zoom durumu kalıcı değil**
- Tarayıcı localStorage izinlerini kontrol edin
- `saveZoomState()` fonksiyonunun çağrıldığını doğrulayın

### Zorla Sıfırlama
Zoom durumunu tamamen sıfırlamak için:
```javascript
localStorage.removeItem('activityZoom');
location.reload();
```

## Gelecek Geliştirmeler

Gelecek sürümler için olası iyileştirmeler:
- Mobil cihazlar için dokunma/jest desteği
- Zoom durumunda gezinme için mini harita
- Sığdır düğmesi
- Etkinlik özelinde zoom kalıcılığı
- Klavye kısayolları (Ctrl +/-)
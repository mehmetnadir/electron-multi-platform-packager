#!/bin/bash

# PWA Test Script
# PWA paketini otomatik olarak test eder

echo "🧪 PWA Test Script"
echo "===================="
echo ""

# Renk kodları
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Test klasörünü oluştur
PWA_TEST_DIR="pwa-test"
mkdir -p "$PWA_TEST_DIR"

# En son PWA paketini bul
echo -e "${BLUE}📦 PWA paketi aranıyor...${NC}"
LATEST_PWA=$(find temp -name "*-PWA-*.zip" -type f -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -1 | cut -d' ' -f2-)

if [ -z "$LATEST_PWA" ]; then
    echo -e "${RED}❌ PWA paketi bulunamadı!${NC}"
    echo ""
    echo "Lütfen önce PWA paketi oluşturun:"
    echo "1. http://localhost:3000/index-v2.html"
    echo "2. PWA platformunu seçin"
    echo "3. Paketlemeyi başlatın"
    echo ""
    exit 1
fi

echo -e "${GREEN}✅ PWA paketi bulundu: $(basename "$LATEST_PWA")${NC}"
echo ""

# Eski dosyaları temizle
echo -e "${BLUE}🧹 Test klasörü temizleniyor...${NC}"
rm -rf "$PWA_TEST_DIR"/*

# ZIP'i çıkart
echo -e "${BLUE}📂 PWA paketi çıkartılıyor...${NC}"
unzip -q "$LATEST_PWA" -d "$PWA_TEST_DIR"

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ PWA paketi çıkartıldı${NC}"
else
    echo -e "${RED}❌ ZIP çıkartma hatası!${NC}"
    exit 1
fi

echo ""

# Dosya sayısını göster
FILE_COUNT=$(find "$PWA_TEST_DIR" -type f | wc -l)
TOTAL_SIZE=$(du -sh "$PWA_TEST_DIR" | cut -f1)
echo -e "${GREEN}📊 İstatistikler:${NC}"
echo "   • Dosya sayısı: $FILE_COUNT"
echo "   • Toplam boyut: $TOTAL_SIZE"
echo ""

# Test sunucusunu başlat
echo -e "${YELLOW}🚀 Test sunucusu başlatılıyor...${NC}"
echo ""

# Node.js var mı kontrol et
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js bulunamadı!${NC}"
    exit 1
fi

# Test sunucusunu başlat
node test-pwa-server.js

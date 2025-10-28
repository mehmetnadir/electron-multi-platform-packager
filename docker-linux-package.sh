#!/bin/bash

# Docker ile Linux Paketleme Script'i
# macOS'ta tam özellikli .impark oluşturur

set -e

echo "🐳 Docker Linux Paketleme Başlıyor..."
echo "======================================"

# Docker kurulu mu kontrol et
if ! command -v docker &> /dev/null; then
    echo "❌ Docker kurulu değil!"
    echo "Docker Desktop'ı yükleyin: https://www.docker.com/products/docker-desktop"
    exit 1
fi

# Docker çalışıyor mu kontrol et
if ! docker info &> /dev/null; then
    echo "❌ Docker çalışmıyor!"
    echo "Docker Desktop'ı başlatın"
    exit 1
fi

echo "✅ Docker hazır"

# Container image'ı build et (ilk seferde)
IMAGE_NAME="electron-packager-linux"

if ! docker images | grep -q "$IMAGE_NAME"; then
    echo "📦 Docker image oluşturuluyor (ilk seferinde biraz sürer)..."
    docker build -t $IMAGE_NAME -f Dockerfile.linux-packager .
    echo "✅ Docker image hazır"
else
    echo "✅ Docker image mevcut"
fi

# Proje dizinini container'a mount et ve paketleme yap
echo "🚀 Linux container'da paketleme başlıyor..."

docker run --rm \
    -v "$(pwd):/workspace" \
    -w /workspace \
    -e FORCE_LINUX_PACKAGING=1 \
    $IMAGE_NAME \
    bash -c "
        echo '📦 Dependencies yükleniyor...'
        npm install --quiet
        
        echo '🔧 Linux paketleme başlıyor...'
        node tests/quick-pardus-test.js
        
        echo '✅ Paketleme tamamlandı!'
        echo ''
        echo '📋 Oluşturulan dosyalar:'
        find output -name '*.impark' -o -name '*.AppImage' 2>/dev/null | head -5
    "

echo ""
echo "======================================"
echo "✅ Docker Linux Paketleme Tamamlandı!"
echo ""
echo "📦 Output klasörünü kontrol edin:"
echo "   ls -lh output/"

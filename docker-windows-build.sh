#!/bin/bash

# Docker ile Windows EXE oluşturucu
# macOS'ta Windows EXE oluşturmak için

echo "🐳 Docker ile Windows EXE oluşturuluyor..."

# Docker konteynerini çalıştır
docker run --rm -ti \
  --env ELECTRON_CACHE="/tmp/electron-cache" \
  --env ELECTRON_BUILDER_CACHE="/tmp/electron-builder-cache" \
  --volume ${PWD}/test-app:/project \
  --volume ~/.cache/electron:/tmp/electron-cache \
  --volume ~/.cache/electron-builder:/tmp/electron-builder-cache \
  electronuserland/builder:wine \
  /bin/bash -c "
    echo '📦 Windows build başlatılıyor...'
    cd /project
    npm install
    
    # Electron Builder config
    cat > electron-builder-config.json << 'EOF'
{
  \"appId\": \"com.dijitap.test\",
  \"productName\": \"Test Uygulaması\",
  \"directories\": {
    \"output\": \"dist\"
  },
  \"win\": {
    \"target\": \"nsis\",
    \"icon\": \"images/logo.png\"
  },
  \"nsis\": {
    \"oneClick\": true,
    \"installerLanguages\": [\"tr_TR\"],
    \"language\": \"1055\",
    \"displayLanguageSelector\": false
  }
}
EOF
    
    # Build komutu
    npx electron-builder --config electron-builder-config.json --win
    
    echo '✅ Windows EXE oluşturuldu: dist/ klasöründe'
    ls -la dist/
  "

echo "🎉 Docker build tamamlandı!"
echo "📂 Sonuç: test-app/dist/ klasöründe .exe dosyası"
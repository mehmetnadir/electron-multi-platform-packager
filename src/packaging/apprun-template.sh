#!/bin/bash

# DijiTap AppImage Launcher
# Eski sistem ile tam uyumlu - Zenity progress bar ile kurulum

SELF=$(readlink -f "$0")
HERE=${SELF%/*}
export PATH=$PATH:"$HERE/usr/bin/zenity"

# Zenity komutunu belirle
zenityCmd="$HERE/usr/bin/zenity"
defaultZenity="/usr/bin/zenity"

if [ -f "$defaultZenity" ]; then
    zenityCmd="$defaultZenity"
fi

# Zenity progress bar fonksiyonu (eski sistemden)
function unzip_and_show_progress {
    local src="$1"
    local dest="$2"
    local description="$3"
    
    local total_files=$(unzip -l "$src" 2>/dev/null | wc -l)
    
    (
        echo "10"
        echo "# $description"
        
        # Unzip işlemi
        unzip -o -q "$src" -d "$dest" 2>&1
        
        echo "90"
        echo "# Tamamlanıyor..."
        sleep 0.3
        
        echo "100"
        echo "# Hazır!"
    ) | "$zenityCmd" \
        --progress \
        --title="DijiTap Akıllı Tahta" \
        --text="$description" \
        --percentage=0 \
        --width=400 \
        --height=100 \
        --auto-close \
        --pulsate
}

# Uygulama bilgileri (paketleme sırasında değiştirilecek)
APP_NAME="{{APP_NAME}}"
APP_VERSION="{{APP_VERSION}}"
PUBLISHER_NAME="{{PUBLISHER_NAME}}"
PUBLISHER_ID="{{PUBLISHER_ID}}"

# Kalıcı kurulum yolu (eski sistem: ~/DijiTap/PUBLISHER/APP_NAME)
basepath=~/DijiTap/$PUBLISHER_NAME
appPath="$basepath/$APP_NAME"
# Executable: zkitap, zkitap.bin veya electron
executablePath="$appPath/zkitap"
if [ ! -f "$executablePath" ]; then
    executablePath="$appPath/zkitap.bin"
fi
if [ ! -f "$executablePath" ]; then
    executablePath="$appPath/electron"
fi
resourcesPath="$appPath/resources/app/build"
publisherFilePath="$resourcesPath/kurum.txt"

# Kurulum kontrolü - eğer executable varsa direkt çalıştır
if [ -f "$executablePath" ]; then
    # Zaten kurulu, direkt başlat
    "$executablePath" "$@" --no-sandbox
    exit 0
fi

# İLK KURULUM - Zenity ile
echo "→ İlk kurulum başlıyor..."
mkdir -p "$resourcesPath"

# AppImage içindeki tüm dosyaları kopyala
# (Electron uygulaması AppImage içinde zaten hazır)
unzip_and_show_progress "$HERE/../app.zip" "$appPath" "$APP_NAME kuruluyor..."

# Eğer app.zip yoksa, HERE klasöründen direkt kopyala
if [ ! -f "$executablePath" ]; then
    (
        echo "10"
        echo "# Uygulama dosyaları kopyalanıyor..."
        
        # Tüm dosyaları kopyala
        cp -r "$HERE"/* "$appPath/" 2>/dev/null
        
        echo "50"
        echo "# İzinler ayarlanıyor..."
        
        # Executable'ı bul ve izin ver
        find "$appPath" -name "zkitap" -o -name "*.bin" -o -name "electron" | while read exe; do
            chmod +x "$exe" 2>/dev/null
        done
        
        echo "90"
        echo "# Son ayarlamalar..."
        
        # Publisher ID kaydet
        if [ ! -z "$PUBLISHER_ID" ]; then
            echo "$PUBLISHER_ID" > "$publisherFilePath"
        fi
        
        sleep 0.5
        echo "100"
        
    ) | "$zenityCmd" \
        --progress \
        --title="$APP_NAME - Kurulum" \
        --text="$APP_NAME hazırlanıyor..." \
        --percentage=0 \
        --width=400 \
        --height=100 \
        --auto-close \
        --pulsate
fi

# Kurulum tamamlandı, uygulamayı başlat
if [ -f "$executablePath" ]; then
    "$executablePath" "$@" --no-sandbox
else
    # Executable bulunamadı, hata mesajı
    "$zenityCmd" --error --text="Kurulum başarısız!\n\nExecutable bulunamadı: $executablePath" --width=300
    exit 1
fi

exit 0

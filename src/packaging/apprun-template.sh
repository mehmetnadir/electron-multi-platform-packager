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
# Executable: zkitap, zkitap.bin, electron VEYA urunun kendi adiyla paketlenen ikili.
#
# electron-builder cikti ikilisini productName'den turetir (or. "ucan-balik-36+",
# "bloktest-okuma-yazma-2023"). Sabit uc ada bakmak bu yuzden yetmiyordu ve
# 2026-09-08'de olculdu: uretilen .impark'lar ilk acilista
# "Kurulum basarisiz! Executable bulunamadi: .../electron" veriyordu.
# Dorduncu aday olarak koklteki kutuphane/yardimci olmayan tek calistirilabilir
# dosya secilir.
resolve_executable() {
    local p d slug
    for p in "$appPath/zkitap" "$appPath/zkitap.bin" "$appPath/electron"; do
        if [ -f "$p" ]; then printf '%s' "$p"; return 0; fi
    done
    # electron-builder: ikili adi == .desktop dosya adi (executableName). Kesin eslesme.
    for d in "$appPath"/*.desktop; do
        [ -f "$d" ] || continue
        slug=${d##*/}; slug=${slug%.desktop}
        if [ -f "$appPath/$slug" ]; then printf '%s' "$appPath/$slug"; return 0; fi
    done
    # Son care: kokteki ELF calistirilabilir. Kurulum adimi `chmod +x *.bin` yaptigi icin
    # snapshot_blob.bin / v8_context_snapshot.bin de +x olur ve 2026-09-08'de find ilk
    # onlari secti ("cannot execute binary file"). Bu yuzden ad filtresi + ELF sihri sart.
    for p in "$appPath"/*; do
        [ -f "$p" ] && [ -x "$p" ] || continue
        case "${p##*/}" in
            AppRun|chrome-sandbox|chrome_crashpad_handler|*.so|*.so.*|*.sh|*.bin|*.pak|*.dat) continue;;
        esac
        if [ "$(head -c 4 "$p" 2>/dev/null)" = "$(printf '\177ELF')" ]; then printf '%s' "$p"; return 0; fi
    done
    printf '%s' "$appPath/zkitap"
}

executablePath="$(resolve_executable)"
resourcesPath="$appPath/resources/app/build"
publisherFilePath="$resourcesPath/kurum.txt"
# Kurulu sürüm işareti: kurulum doğrulanınca paketin APP_VERSION'ı buraya yazılır.
versionMarker="$appPath/.empp-version"

# $1 > $2 ise 0 döner. sort -V sayısal karşılaştırır: 1.12.10 > 1.12.9 (sözlük sırası
# bunu ters çevirirdi). sort -V desteklenmiyorsa boş çıktı → "büyük değil" → güvenli taraf.
version_gt() {
    [ "$1" != "$2" ] && [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | tail -n 1)" = "$1" ]
}

installedVersion=""
if [ -f "$versionMarker" ]; then
    installedVersion=$(head -n 1 "$versionMarker" 2>/dev/null | tr -d '[:space:]')
fi

# Kurulum kontrolü. Saha dersi (2026-09-10, Flashy set, ProBook): kuruluysa dosyaları
# tazelemeden eski kopyayı çalıştırmak, düzeltilmiş paketi indiren müşteriye hâlâ
# eskisini gösteriyordu ("Kitap Güncelleniyor %0"). Kural:
#   paket == kurulu       → dokunma, çalıştır (hızlı yol)
#   paket <  kurulu       → düşürme yok, kuruluyu çalıştır (stderr'e tek satır not)
#   işaret yok / paket >  → eski kurulumu kenara al (mv, silme YOK), yeniden kur
# Kullanıcı verisi (~/.empp-work, ~/.config) kurulum dizininin DIŞINDADIR; dokunulmaz.
backupPath=""
if [ -f "$executablePath" ]; then
    if [ -z "$APP_VERSION" ]; then
        # Sürüm bilgisi yok: eski davranış, kuruluyu çalıştır
        "$executablePath" "$@" --no-sandbox
        exit 0
    fi
    if [ -n "$installedVersion" ] && ! version_gt "$APP_VERSION" "$installedVersion"; then
        if [ "$APP_VERSION" != "$installedVersion" ]; then
            echo "Not: paket sürümü ($APP_VERSION) kurulu sürümden ($installedVersion) eski;" \
                "kurulu sürüm çalıştırılıyor, düşürme yapılmadı." >&2
        fi
        "$executablePath" "$@" --no-sandbox
        exit 0
    fi
    backupPath="$appPath.yedek-$(date +%Y%m%d-%H%M%S)"
    [ -e "$backupPath" ] && backupPath="$backupPath-$$"
    if mv "$appPath" "$backupPath"; then
        echo "→ Eski kurulum (${installedVersion:-sürümsüz}) kenara alındı: $backupPath"
    else
        backupPath=""
        echo "Uyarı: eski kurulum kenara alınamadı, üzerine yazılacak: $appPath" >&2
    fi
fi

# KURULUM / GÜNCELLEME - Zenity ile
if [ -n "$installedVersion" ]; then
    echo "→ Güncelleme başlıyor: $installedVersion → $APP_VERSION"
else
    echo "→ İlk kurulum başlıyor..."
fi
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
# Dosyalar kopyalandiktan SONRA yeniden cozumle: urun ikilisi ancak simdi var.
executablePath="$(resolve_executable)"
chmod +x "$executablePath" 2>/dev/null

if [ -f "$executablePath" ]; then
    # İşaret ancak kurulum doğrulanınca yazılır; yarım kurulum sonraki açılışta yinelenir
    if [ -n "$APP_VERSION" ]; then
        printf '%s\n' "$APP_VERSION" > "$versionMarker" 2>/dev/null
    fi
    "$executablePath" "$@" --no-sandbox
else
    # Executable bulunamadı: güncellemeyse kenara alınan eski kurulumu geri getir (silme yok)
    if [ -n "$backupPath" ] && [ -d "$backupPath" ]; then
        mv "$appPath" "$appPath.basarisiz-$(date +%Y%m%d-%H%M%S)-$$" 2>/dev/null
        mv "$backupPath" "$appPath" && echo "→ Eski kurulum geri getirildi: $appPath" >&2
    fi
    "$zenityCmd" --error --text="Kurulum başarısız!\n\nExecutable bulunamadı: $executablePath" --width=300
    exit 1
fi

exit 0

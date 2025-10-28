#!/bin/bash
# AppImage Launcher with Loading Screen
# Bu script AppImage ilk çalıştırıldığında loading ekranı gösterir

APP_NAME="{{APP_NAME}}"
COMPANY_NAME="{{COMPANY_NAME}}"

# Zenity varsa kullan (Pardus'ta varsayılan)
if command -v zenity &> /dev/null; then
    # Loading dialog göster (arkaplanda)
    (
        zenity --progress \
          --title="$APP_NAME" \
          --text="$APP_NAME Hazırlanıyor...\n\nİlk çalıştırma biraz zaman alabilir.\nLütfen bekleyin..." \
          --pulsate \
          --auto-close \
          --no-cancel \
          --width=400 \
          --height=150 &
        ZENITY_PID=$!
        
        # AppImage'ı çalıştır
        "$APPIMAGE" "$@"
        
        # Zenity'yi kapat
        kill $ZENITY_PID 2>/dev/null
    )
# notify-send varsa kullan
elif command -v notify-send &> /dev/null; then
    notify-send "$APP_NAME" "$APP_NAME hazırlanıyor, lütfen bekleyin..." -i system-software-install -t 3000
    "$APPIMAGE" "$@"
# Hiçbiri yoksa terminal'de göster
else
    echo "╔════════════════════════════════════════╗"
    echo "║  $APP_NAME Hazırlanıyor...            ║"
    echo "║                                        ║"
    echo "║  İlk çalıştırma biraz zaman alabilir  ║"
    echo "║  Lütfen bekleyin...                    ║"
    echo "╚════════════════════════════════════════╝"
    "$APPIMAGE" "$@"
fi

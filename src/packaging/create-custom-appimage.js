#!/usr/bin/env node

/**
 * Özel AppImage Oluşturucu
 * 
 * Electron Builder yerine appimagetool kullanarak
 * özel AppRun script'i ile AppImage oluşturur
 */

const { spawn } = require('child_process');
const fs = require('fs-extra');
const path = require('path');

async function createCustomAppImage(options) {
    const {
        workingPath,      // Electron uygulamasının build klasörü
        outputPath,       // AppImage'ın oluşturulacağı klasör
        appName,
        appVersion,
        publisherName,
        publisherId,
        logoPath
    } = options;
    
    console.log('🎨 Özel AppImage oluşturuluyor...');
    
    const appDirName = `${appName.replace(/\s+/g, '-')}.AppDir`;
    const appDirPath = path.join(outputPath, appDirName);
    
    try {
        // 1. AppDir yapısını oluştur
        console.log('📁 AppDir yapısı oluşturuluyor...');
        await fs.ensureDir(appDirPath);
        
        // 2. Electron uygulamasını zkitap klasörüne kopyala
        const zkitapPath = path.join(appDirPath, 'zkitap');
        await fs.copy(workingPath, zkitapPath);
        console.log('✅ Uygulama kopyalandı');
        
        // 3. AppRun script'ini oluştur
        const appRunContent = `#!/bin/bash

SELF=$(readlink -f "$0")
HERE=\${SELF%/*}

# Uygulama bilgileri
APP_NAME="${appName}"
APP_VERSION="${appVersion}"
PUBLISHER_NAME="${publisherName || 'DijiTap'}"
PUBLISHER_ID="${publisherId || ''}"

# Kalıcı kurulum yolu
basepath=~/dijitap
appPath="$basepath/$APP_NAME"
executablePath="$appPath/zkitap"

# İlk kurulum kontrolü
if [ ! -f "$executablePath" ]; then
    echo "→ İlk kurulum: $appPath"
    mkdir -p "$appPath"
    cp -r "$HERE/zkitap/"* "$appPath/"
    chmod +x "$executablePath"
fi

# Uygulamayı başlat (--no-sandbox ile)
"$executablePath" "$@" --no-sandbox --disable-gpu-sandbox
`;
        
        await fs.writeFile(path.join(appDirPath, 'AppRun'), appRunContent);
        await fs.chmod(path.join(appDirPath, 'AppRun'), 0o755);
        console.log('✅ AppRun oluşturuldu');
        
        // 4. .desktop dosyası oluştur
        const desktopContent = `[Desktop Entry]
Type=Application
Name=${appName}
Exec=AppRun
Icon=${appName.toLowerCase().replace(/\s+/g, '-')}
Categories=Education;
Comment=${appName} - ${publisherName || 'DijiTap'}
Terminal=false
`;
        
        await fs.writeFile(path.join(appDirPath, `${appName}.desktop`), desktopContent);
        console.log('✅ Desktop dosyası oluşturuldu');
        
        // 5. Icon kopyala
        if (logoPath && await fs.pathExists(logoPath)) {
            const iconName = `${appName.toLowerCase().replace(/\s+/g, '-')}.png`;
            await fs.copy(logoPath, path.join(appDirPath, iconName));
            await fs.copy(logoPath, path.join(appDirPath, '.DirIcon'));
            console.log('✅ Icon kopyalandı');
        }
        
        // 6. appimagetool ile paketle
        console.log('📦 AppImage oluşturuluyor...');
        
        const appImageName = `${appName.replace(/\s+/g, '-')}-${appVersion}.impark`;
        const appImagePath = path.join(outputPath, appImageName);
        
        // appimagetool çalıştır (sistem'de yüklü olmalı)
        await new Promise((resolve, reject) => {
            const pack = spawn('appimagetool', [appDirPath, appImagePath], {
                cwd: outputPath,
                stdio: 'inherit',
                env: { ...process.env, ARCH: 'x86_64' }
            });
            
            pack.on('close', code => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`appimagetool failed with code ${code}`));
                }
            });
        });
        
        // AppDir'i temizle
        await fs.remove(appDirPath);
        
        console.log('✅ AppImage oluşturuldu:', appImagePath);
        
        return {
            type: 'AppImage',
            filename: appImageName,
            path: appImagePath,
            size: (await fs.stat(appImagePath)).size
        };
        
    } catch (error) {
        console.error('❌ AppImage oluşturma hatası:', error);
        throw error;
    }
}

module.exports = createCustomAppImage;

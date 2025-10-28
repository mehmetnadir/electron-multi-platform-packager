#!/usr/bin/env node

/**
 * AppImage Sandbox Düzeltme
 * 
 * Electron Builder'ın ürettiği AppImage'ı extract edip
 * AppRun'a --no-sandbox parametresi ekleyip tekrar paketler
 */

const { spawn } = require('child_process');
const fs = require('fs-extra');
const path = require('path');

async function fixAppImageSandbox(appImagePath) {
    console.log('🔧 AppImage sandbox düzeltiliyor:', appImagePath);
    
    const dir = path.dirname(appImagePath);
    const basename = path.basename(appImagePath, '.AppImage');
    const extractDir = path.join(dir, `${basename}.AppDir`);
    
    try {
        // 1. AppImage'ı extract et
        console.log('📦 Extract ediliyor...');
        await new Promise((resolve, reject) => {
            const extract = spawn(appImagePath, ['--appimage-extract'], {
                cwd: dir,
                stdio: 'inherit'
            });
            extract.on('close', code => code === 0 ? resolve() : reject(new Error(`Extract failed: ${code}`)));
        });
        
        // Extract edilen klasörü yeniden adlandır
        const squashfsRoot = path.join(dir, 'squashfs-root');
        if (await fs.pathExists(squashfsRoot)) {
            await fs.move(squashfsRoot, extractDir, { overwrite: true });
        }
        
        // 2. AppRun dosyasını bul ve düzenle
        const appRunPath = path.join(extractDir, 'AppRun');
        console.log('📝 AppRun düzenleniyor...');
        
        if (await fs.pathExists(appRunPath)) {
            let appRunContent = await fs.readFile(appRunPath, 'utf8');
            
            // Son satırı bul ve --no-sandbox ekle
            // Genellikle: exec "$APPDIR/zkitap" "$@" veya benzer
            if (!appRunContent.includes('--no-sandbox')) {
                // exec satırını bul
                appRunContent = appRunContent.replace(
                    /exec\s+"([^"]+)"\s+"\$@"/g,
                    'exec "$1" "$@" --no-sandbox --disable-gpu-sandbox'
                );
                
                // Veya direkt çalıştırma varsa
                appRunContent = appRunContent.replace(
                    /"\$APPDIR\/[^"]+"\s+"\$@"$/gm,
                    '$& --no-sandbox --disable-gpu-sandbox'
                );
                
                await fs.writeFile(appRunPath, appRunContent);
                console.log('✅ AppRun güncellendi');
            }
        }
        
        // 3. appimagetool ile tekrar paketle
        console.log('📦 Yeniden paketleniyor...');
        
        // appimagetool'u indir (eğer yoksa)
        const appimagetoolPath = path.join(dir, 'appimagetool-x86_64.AppImage');
        if (!await fs.pathExists(appimagetoolPath)) {
            console.log('⬇️ appimagetool indiriliyor...');
            const https = require('https');
            const file = fs.createWriteStream(appimagetoolPath);
            
            await new Promise((resolve, reject) => {
                https.get('https://github.com/AppImage/AppImageKit/releases/download/continuous/appimagetool-x86_64.AppImage', (response) => {
                    response.pipe(file);
                    file.on('finish', () => {
                        file.close();
                        fs.chmod(appimagetoolPath, 0o755);
                        resolve();
                    });
                }).on('error', reject);
            });
        }
        
        // Yeni AppImage oluştur
        const newAppImagePath = appImagePath.replace('.AppImage', '-fixed.AppImage');
        await new Promise((resolve, reject) => {
            const pack = spawn(appimagetoolPath, [extractDir, newAppImagePath], {
                cwd: dir,
                stdio: 'inherit',
                env: { ...process.env, ARCH: 'x86_64' }
            });
            pack.on('close', code => code === 0 ? resolve() : reject(new Error(`Pack failed: ${code}`)));
        });
        
        // Eski dosyayı sil, yeniyi yeniden adlandır
        await fs.remove(appImagePath);
        await fs.move(newAppImagePath, appImagePath);
        
        // Extract klasörünü temizle
        await fs.remove(extractDir);
        
        console.log('✅ AppImage düzeltildi:', appImagePath);
        return true;
        
    } catch (error) {
        console.error('❌ Hata:', error);
        return false;
    }
}

// CLI kullanımı
if (require.main === module) {
    const appImagePath = process.argv[2];
    if (!appImagePath) {
        console.error('Kullanım: node fix-appimage-sandbox.js <appimage-path>');
        process.exit(1);
    }
    
    fixAppImageSandbox(appImagePath).then(success => {
        process.exit(success ? 0 : 1);
    });
}

module.exports = fixAppImageSandbox;

// Session Debug Tool - Upload session'ları kontrol et
const fs = require('fs-extra');
const path = require('path');

async function debugSessions() {
    const uploadsDir = path.join(__dirname, '../../uploads');
    
    console.log('=== SESSION DEBUG TOOL ===');
    console.log('Uploads klasörü:', uploadsDir);
    
    try {
        if (!await fs.pathExists(uploadsDir)) {
            console.log('❌ Uploads klasörü mevcut değil!');
            return;
        }
        
        const sessions = await fs.readdir(uploadsDir);
        console.log(`\n📁 ${sessions.length} session bulundu:`);
        
        for (const sessionId of sessions) {
            if (sessionId.startsWith('.')) continue; // .DS_Store gibi gizli dosyaları atla
            
            const sessionPath = path.join(uploadsDir, sessionId);
            const stat = await fs.stat(sessionPath);
            
            if (stat.isDirectory()) {
                const contents = await fs.readdir(sessionPath);
                const fileCount = contents.length;
                
                console.log(`\n📦 Session: ${sessionId}`);
                console.log(`   📅 Oluşturulma: ${stat.birthtime.toLocaleString('tr-TR')}`);
                console.log(`   📝 Son değişiklik: ${stat.mtime.toLocaleString('tr-TR')}`);
                console.log(`   📄 Dosya sayısı: ${fileCount}`);
                console.log(`   📍 Yol: ${sessionPath}`);
                
                if (fileCount > 0) {
                    console.log(`   📋 İçerik: ${contents.slice(0, 5).join(', ')}${fileCount > 5 ? '...' : ''}`);
                }
            }
        }
        
        console.log('\n=== SESSION KONTROL TAMAMLANDI ===');
        
    } catch (error) {
        console.error('❌ Session debug hatası:', error);
    }
}

// Eğer script doğrudan çalıştırılıyorsa
if (require.main === module) {
    debugSessions();
}

module.exports = { debugSessions };
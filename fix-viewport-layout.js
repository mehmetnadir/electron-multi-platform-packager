#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const glob = require('glob');

// Viewport düzeltme şablonu
const VIEWPORT_FIX = {
  css: `
    /* Viewport Layout Fix - 1400x900px */
    html, body {
      width: 100%;
      height: 100vh;
      margin: 0;
      padding: 0;
      overflow: hidden;
    }

    #root {
      width: 1400px;
      height: 900px;
      margin: 0;
      position: relative;
      background-position: center center !important;
      background-size: contain !important;
    }

    .player {
      display: grid;
      width: 100vw;
      height: 100vh;
      grid-template-columns: 200px 1fr;
      overflow: hidden;
    }

    .toolbar {
      flex-basis: 200px;
      display: flex;
      flex-direction: column;
      justify-content: flex-start;
      align-items: center;
      background: #ececec;
      overflow-y: auto;
      padding-top: 20px;
    }

    #activity-viewport {
      overflow: hidden;
      position: relative;
      width: 100%;
      height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
  `
};

function fixViewportLayout(htmlContent) {
  console.log('  -> Viewport layout düzeltiliyor...');
  
  let enhanced = htmlContent;

  // Mevcut problematik CSS'i kaldır
  enhanced = enhanced.replace(/<style>[\s\S]*?\/\* Zoom Container Styling \*\/[\s\S]*?<\/style>/g, '');
  enhanced = enhanced.replace(/html,[\s\S]*?#root \{[\s\S]*?\}/g, '');
  enhanced = enhanced.replace(/#root \{[\s\S]*?!\s*important;\s*\}/g, '');

  // Viewport düzeltme CSS'i ekle - head'in başına
  const headStartIndex = enhanced.indexOf('<head>') + 6;
  if (headStartIndex > 5) {
    enhanced = enhanced.slice(0, headStartIndex) + 
               '\n  <style>' + VIEWPORT_FIX.css + '  </style>\n' +
               enhanced.slice(headStartIndex);
  }

  return enhanced;
}

function processHtmlActivity(filePath) {
  try {
    console.log(`İşleniyor: ${filePath}`);
    
    const content = fs.readFileSync(filePath, 'utf8');
    const fixed = fixViewportLayout(content);
    
    fs.writeFileSync(filePath, fixed, 'utf8');
    console.log('  -> Viewport layout düzeltildi');
    return true;
    
  } catch (error) {
    console.error(`  -> Hata: ${filePath}:`, error.message);
    return false;
  }
}

function findHtmlActivities(baseDir) {
  const pattern = path.join(baseDir, '**/htmletk/**/index.html');
  return glob.sync(pattern, { absolute: true });
}

function main() {
  const baseDir = process.argv[2] || '.';
  
  console.log(`Viewport layout düzeltiliyor: ${path.resolve(baseDir)}`);
  
  const htmlFiles = findHtmlActivities(baseDir);
  
  if (htmlFiles.length === 0) {
    console.log('HTML etkinlik dosyası bulunamadı!');
    return;
  }
  
  console.log(`${htmlFiles.length} dosya bulundu:`);
  
  let processedCount = 0;
  let fixedCount = 0;
  
  htmlFiles.forEach(filePath => {
    processedCount++;
    const wasFixed = processHtmlActivity(filePath);
    if (wasFixed) fixedCount++;
  });
  
  console.log(`\nViewport düzeltme tamamlandı!`);
  console.log(`İşlenen dosya: ${processedCount}`);
  console.log(`Düzeltilen dosya: ${fixedCount}`);
  
  console.log(`\nDÜZELTMELER:`);
  console.log('✅ 1400x900px boyut ayarları düzeltildi');
  console.log('✅ Viewport overflow sorunu çözüldü');
  console.log('✅ Root element konumlandırması düzeltildi');
  console.log('✅ Grid layout optimize edildi');
}

// Gerekli bağımlılığı kontrol et
try {
  require('glob');
} catch (e) {
  console.log('Glob bağımlılığı kuruluyor...');
  require('child_process').execSync('npm install glob', { stdio: 'inherit' });
}

main();
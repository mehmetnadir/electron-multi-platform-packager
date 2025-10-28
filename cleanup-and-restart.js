#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const glob = require('glob');

// Temiz test dosyası - sadece orijinal HTML
const CLEAN_TEST_CONTENT = `<html lang="en">

<head>
  <meta charset="UTF-8">
  <title>Etkinlik</title>
  <script type="application/javascript" src="./etk/43e23fce2b7009474555a77.js"></script>

  <style>
    html,
    body {
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

    .toolbar>img {
      width: 75px;
      height: 75px;
      margin-bottom: 20px;
    }

    .toolbar img:hover {
      transform: scale(1.05);
      cursor: pointer;
    }

    .toolbar-action {
      display: flex;
      justify-content: space-between;
      width: 150px;
    }

    .toolbar-action>img {
      width: 60px;
      height: 60px;
    }

    .toolbar-action>span {
      margin: 0px 20px;
    }

    #activityInfo {
      margin-top: 20px;
      width: 100%;
      height: 50px;
      display: flex;
      align-items: center;
      justify-content: center;
      background-size: contain !important;
      text-align: center;
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
  </style>
</head>

<body>
  <div class="player">
    <div class="toolbar">
      <img onclick="location.reload()" src="player/Tema1/tekrar.png" />
      <img onclick="ImparkActivity.showResultStepByStep()" src="player/Tema1/tektekCevapGoster.png" />
      <img onclick="ImparkActivity.removeResultStepByStep()" src="player/Tema1/tektekCevapGizle.png" />
      <img onclick="ImparkActivity.showAllResults()" src="player/Tema1/TumCevaplariGoster.png" />
      <img onclick="ImparkActivity.removeAllResults()" src="player/Tema1/tumCevaplariGizle.png" />

      <div class="toolbar-action">
        <img onclick="jumpActivity(-1)" src="player/Tema1/geri.png" />
        <img onclick="jumpActivity(1)" src="player/Tema1/ileri.png" />
      </div>
      
      <div id="activityInfo" style="background: url(player/Tema1/pageNumber.png) no-repeat center center"></div>
    </div>
    
    <div id="activity-viewport">
      <div id="root"></div>
    </div>
  </div>
</body>

</html>`;

function cleanupTestFile() {
  const testPath = '/Users/nadir/01dev/elecron-paket/test/book1/assets/5907/htmletk/u1/index.html';
  
  try {
    console.log('Test dosyası temizleniyor...');
    fs.writeFileSync(testPath, CLEAN_TEST_CONTENT, 'utf8');
    console.log('✅ Test dosyası temizlendi - sadece temel HTML');
    console.log('📏 1400x900px boyutları ayarlandı');
    console.log('🎯 Viewport düzgün konumlandırıldı');
    console.log('🧹 Tüm zoom karmaşası kaldırıldı');
    return true;
  } catch (error) {
    console.error('❌ Test dosyası temizlenemedi:', error.message);
    return false;
  }
}

function main() {
  console.log('🔄 HTML etkinlik dosyası sıfırlanıyor...');
  console.log('📍 Hedef: /test/book1/assets/5907/htmletk/u1/index.html');
  
  const success = cleanupTestFile();
  
  if (success) {
    console.log('\\n✅ TEMİZLİK TAMAMLANDI!');
    console.log('🌐 Test URL: http://localhost:8080/book1/assets/5907/htmletk/u1/index.html');
    console.log('📐 Boyut: 1400x900px');
    console.log('🎨 Düzen: Düzgün grid layout');
    console.log('📱 Responsive: Evet');
    console.log('');
    console.log('Artık zoom eklemeye temiz bir dosyayla başlayabiliriz.');
  } else {
    console.log('\\n❌ Temizlik başarısız oldu!');
  }
}

main();
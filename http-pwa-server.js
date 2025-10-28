const express = require('express');
const path = require('path');

const app = express();
const PORT = 8080;

// PWA klasörünü serve et
app.use(express.static(path.join(__dirname, 'pwa-test')));

// Tüm route'ları index.html'e yönlendir
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'pwa-test/index.html'));
});

app.listen(PORT, () => {
  console.log(`\n🌐 PWA HTTP Test Sunucusu Hazır!`);
  console.log(`📱 URL: http://localhost:${PORT}`);
  console.log(`📁 Klasör: ${path.join(__dirname, 'pwa-test')}\n`);
  console.log(`🛑 Durdurmak için: Ctrl+C\n`);
});

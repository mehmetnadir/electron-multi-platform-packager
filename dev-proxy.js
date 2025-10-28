const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();

// CORS ve clipboard için header'lar
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Content-Security-Policy', '');
  next();
});

// Static dosyaları serve et
app.use(express.static('src/client/public'));

// API proxy
app.use('/api', createProxyMiddleware({
  target: 'http://localhost:3000',
  changeOrigin: true
}));

// Socket.IO proxy (basit)
app.get('/socket.io/*', (req, res) => {
  res.redirect(`http://localhost:3000${req.url}`);
});

app.listen(3002, () => {
  console.log('🌐 Development Proxy hazır: http://localhost:3002');
  console.log('📋 Clipboard ÇALIŞIR - Normal browser aç');
  console.log('🔗 DevTools: F12 → Copy/Paste SORUNSUZ');
});

// logos.json'daki Mac mutlak yollarını bu makinenin logo dizinine çevirir (dosya adı aynı kalır).
const fs = require('fs'); const path = require('path'); const os = require('os');
const dizin = path.join(os.homedir(), '.electron-packager-tool', 'config', 'logos');
const j = path.join(dizin, 'logos.json');
const v = JSON.parse(fs.readFileSync(j, 'utf8'));
let n = 0, eksik = 0;
for (const l of v.logos) { l.filePath = path.join(dizin, l.fileName); n++; if (!fs.existsSync(l.filePath)) eksik++; }
fs.writeFileSync(j, JSON.stringify(v, null, 2));
console.log(`logo kaydı: ${n}, dosyası eksik: ${eksik}, dizin: ${dizin}`);

'use strict';
/**
 * Odak kanıtı — kapı ODAK ÇALMADIĞINI kendisi ölçer (Nadir 2026-09-26).
 *
 * `lsappinfo front` ön plandaki uygulamanın ASN'ini verir. Koşunun başında ve sonunda
 * alınır, arada ~300 ms'de bir örneklenir; her farklı ASN'in pid'i de kaydedilir ki
 * "öne geçen kapının kendi süreci mi, yoksa kullanıcı mı uygulama değiştirdi" ayrılsın.
 * `osascript`/System Events KULLANILMAZ (izin istemi çıkarır ve odak çalar).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, spawn } = require('child_process');
const { asnAyikla, pidAyikla } = require('./olcutler');

function lsappinfo(argumanlar) {
  const r = spawnSync('lsappinfo', argumanlar, { encoding: 'utf8', timeout: 5000 });
  return r.status === 0 ? String(r.stdout || '') : '';
}

/** Ön plandaki uygulama: {asn, pid, ad, zaman}. */
function onUygulama() {
  const asn = asnAyikla(lsappinfo(['front']));
  if (!asn) return { asn: '', pid: null, ad: '', zaman: new Date().toISOString() };
  const bilgi = lsappinfo(['info', '-only', 'pid', '-only', 'name', asn]);
  const ad = (/"LSDisplayName"="([^"]*)"/.exec(bilgi) || [])[1] || '';
  return { asn, pid: pidAyikla(bilgi), ad, zaman: new Date().toISOString() };
}

/** Bir sürecin LaunchServices uygulama türü ("Foreground" / "UIElement" / "BackgroundOnly" / ''). */
function uygulamaTuru(pid) {
  const c = lsappinfo(['info', '-only', 'ApplicationType', String(pid)]);
  return (/"ApplicationType"="([^"]*)"/.exec(c) || [])[1] || '';
}

/**
 * Ön uygulamayı AYRI bir süreçte örnekler. Neden ayrı süreç: kapının kendisi uzun
 * eşzamanlı çağrılar yapıyor (hdiutil, 7z, `adb install` 1-2 dk) — aynı süreçteki bir
 * setInterval o sırada HİÇ çalışmaz ve tam da odak çalınabilecek anlar ölçülmezdi.
 * Aynı ASN art arda gelirse yalnız ilki tutulur (değişimler + sayaç).
 *
 * @param {number} aralikMs
 * @param {string} [dosya] örneklerin yazılacağı JSON-satır dosyası (verilmezse geçici)
 */
function odakIzleyici(aralikMs = 300, dosya = null) {
  const hedef = dosya || path.join(os.tmpdir(), `basliksiz-kabul-odak-${process.pid}-${Date.now()}.jsonl`);
  fs.writeFileSync(hedef, '');
  const cocuk = spawn(process.execPath, [__filename, '--ornekle', hedef, '--aralik', String(aralikMs)], {
    stdio: 'ignore', detached: false,
  });
  return {
    dosya: hedef,
    pid: cocuk.pid,
    async durdur() {
      const bitti = new Promise((coz) => {
        if (cocuk.exitCode !== null || cocuk.signalCode !== null) { coz(); return; }
        const t = setTimeout(coz, 2000);
        cocuk.once('exit', () => { clearTimeout(t); coz(); });
      });
      try { cocuk.kill('SIGTERM'); } catch (_) { /* ölü */ }
      await bitti;
      let satirlar = [];
      try { satirlar = fs.readFileSync(hedef, 'utf8').split('\n').filter(Boolean); } catch (_) { satirlar = []; }
      const ornekler = [];
      let orneklemeSayisi = 0;
      for (const l of satirlar) {
        let o;
        try { o = JSON.parse(l); } catch (_) { continue; }
        if (o.sayac) { orneklemeSayisi = Math.max(orneklemeSayisi, o.sayac); continue; }
        ornekler.push(o);
      }
      return { ornekler, orneklemeSayisi, dosya: hedef };
    },
  };
}

/** Çocuk süreç gövdesi: `node odak.js --ornekle <dosya> --aralik <ms>`. */
function ornekleyiciCalis(dosya, aralikMs) {
  const pidOnbellek = new Map();
  let sonAsn = '';
  let sayac = 0;
  const tik = () => {
    const asn = asnAyikla(lsappinfo(['front']));
    sayac += 1;
    if (asn && asn !== sonAsn) {
      sonAsn = asn;
      let pid = pidOnbellek.get(asn);
      if (pid === undefined) {
        pid = pidAyikla(lsappinfo(['info', '-only', 'pid', asn]));
        pidOnbellek.set(asn, pid);
      }
      fs.appendFileSync(dosya, `${JSON.stringify({ asn, pid, zaman: new Date().toISOString() })}\n`);
    }
    if (sayac % 10 === 0) fs.appendFileSync(dosya, `${JSON.stringify({ sayac })}\n`);
  };
  const bitir = () => { try { fs.appendFileSync(dosya, `${JSON.stringify({ sayac })}\n`); } catch (_) { /* yok */ } process.exit(0); };
  process.on('SIGTERM', bitir);
  process.on('SIGINT', bitir);
  // Ebeveyn ölürse (kill -9) yetim kalmasın: stdin yok, ppid değişimini izle.
  const ebeveyn = process.ppid;
  setInterval(() => {
    if (process.ppid !== ebeveyn) bitir();
    tik();
  }, aralikMs);
  tik();
}

module.exports = { onUygulama, uygulamaTuru, odakIzleyici };

if (require.main === module) {
  const i = process.argv.indexOf('--ornekle');
  const a = process.argv.indexOf('--aralik');
  if (i > 0) ornekleyiciCalis(process.argv[i + 1], Number(process.argv[a + 1]) || 300);
}

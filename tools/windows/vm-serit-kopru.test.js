'use strict';
/**
 * ŞERİT DAMGASININ UÇTAN UCA TAŞINMASI + İZLEYİCİ BETİĞİNİN YAPI DENETİMİ.
 *
 * Üç katman burada ölçülür:
 *   1) KÖPRÜ (gerçek HTTP): izleyicinin kalp gövdesinde gönderdiği şerit damgası
 *      kalp dosyasına iniyor mu, gövdesiz eski izleyici hâlâ çalışıyor mu.
 *   2) HOST SÜRÜCÜ: `hazir` ve `bekle` o damgayı okuyup "ayakta ama şerit tıkalı"
 *      diyebiliyor mu (2026-09-21 arızasının kör noktası).
 *   3) POWERSHELL BETİĞİ: Mac'te PowerShell YOK (`pwsh` kurulu değil), bu yüzden
 *      betiğin ÇALIŞTIĞI ölçülemez. Ölçülen şey YAPIdır: zaman aşımsız eski çağrı
 *      gitmiş mi, tavan WaitForExit'e bağlanmış mı, süreç AĞACI öldürülüyor mu,
 *      damga hem görev alınırken hem bitince basılıyor mu. Bu bir sözdizimi kanıtı
 *      DEĞİLDİR — sınırı rapora yazıldı.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PS_YOLU = path.join(__dirname, 'vm-izleyici.ps1');
const PS = fs.readFileSync(PS_YOLU, 'utf8');
// Yorum satırları ÇIKARILMIŞ hali: eski/arızalı çağrının GERİ GELMEDİĞİNİ ararken
// onu tarihe not düşen yorumun kendisi yanlış pozitif üretiyordu (ölçüldü).
const PS_KOD = PS.split('\n').map((s) => s.replace(/^\s*#.*$/, '')).join('\n');

function ortam(ad) {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), `${ad}-`));
  process.env.EMPP_VM_KOK = kok;
  for (const m of ['./vm-kopru-sunucu.js', './vm-kapi.js']) {
    delete require.cache[require.resolve(m)];
  }
  return kok;
}

async function kopruyuKaldir(mod, t) {
  const belirtec = mod.belirtecAl();
  const s = mod.sunucuKur(belirtec);
  await new Promise((c) => s.listen(0, '127.0.0.1', c));
  t.after(() => new Promise((c) => s.close(c)));
  return `http://127.0.0.1:${s.address().port}/${belirtec}`;
}

// ——— 1) KÖPRÜ — GERÇEK HTTP ——————————————————————————————————————————

test('köprü: kalp GÖVDESİNDEKİ şerit damgası kalp dosyasına iner', async (t) => {
  const kok = ortam('serit');
  const mod = require('./vm-kopru-sunucu.js');
  const taban = await kopruyuKaldir(mod, t);

  const damga = new Date(Date.now() - 12000).toISOString();
  const y = await fetch(`${taban}/vm/kalp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sonDonguDamgasi: damga, donguDurumu: 'calisiyor',
      donguGorevi: '20260921-102107', donguZamanAsimiSn: 570,
    }),
  });
  assert.strictEqual(y.status, 204);

  const ham = fs.readFileSync(path.join(kok, 'durum', 'kalp.txt'), 'utf8');
  const karar = require('../../src/windows/vm-kapi-karar.js');
  const c = karar.kalpAyristir(ham);
  assert.ok(Number.isFinite(c.kalpMs), 'kalp damgasını köprü kendi saatiyle yazar');
  assert.strictEqual(c.dongu.damgaMs, Date.parse(damga));
  assert.strictEqual(c.dongu.durum, 'calisiyor');
  assert.strictEqual(c.dongu.gorev, '20260921-102107');
  assert.strictEqual(c.dongu.zamanAsimiSn, 570);
});

test('köprü: GÖVDESİZ kalp (yükseltilmemiş izleyici) ESKİ biçimde yazılır', async (t) => {
  const kok = ortam('serit');
  const mod = require('./vm-kopru-sunucu.js');
  const taban = await kopruyuKaldir(mod, t);

  const y = await fetch(`${taban}/vm/kalp`, { method: 'POST' });
  assert.strictEqual(y.status, 204);
  const ham = fs.readFileSync(path.join(kok, 'durum', 'kalp.txt'), 'utf8').trim();
  assert.strictEqual(ham[0], '2', `çıplak ISO beklenir, gelen: ${ham}`);
  const karar = require('../../src/windows/vm-kapi-karar.js');
  assert.ok(Number.isFinite(karar.kalpAyristir(ham).kalpMs));
  assert.strictEqual(karar.kalpAyristir(ham).dongu, null);
});

// ——— 2) HOST SÜRÜCÜ ————————————————————————————————————————————————

function kalpYaz(kok, nesne) {
  fs.mkdirSync(path.join(kok, 'durum'), { recursive: true });
  fs.writeFileSync(path.join(kok, 'durum', 'kalp.txt'),
    typeof nesne === 'string' ? nesne : JSON.stringify(nesne));
}

test('hazir: kalp TAZE + şerit TIKALI → ayakta AMA serit:"tikali" raporlanır', () => {
  const kok = ortam('hazir');
  const mod = require('./vm-kapi.js');
  kalpYaz(kok, {
    kalp: new Date().toISOString(),
    sonDonguDamgasi: new Date(Date.now() - 1000 * 1000).toISOString(),
    donguDurumu: 'calisiyor', donguGorevi: '20260921-102107', donguZamanAsimiSn: 570,
  });
  const r = mod.hazirMi();
  assert.strictEqual(r.durum, 'ayakta');
  assert.strictEqual(r.serit, 'tikali');
  assert.strictEqual(r.seritGorevi, '20260921-102107');
  assert.match(r.uyari, /şerit .* ilerlemiyor/);
});

test('hazir: taze kalp + akan şerit TEMİZ (yanlış alarm yok)', () => {
  const kok = ortam('hazir');
  const mod = require('./vm-kapi.js');
  kalpYaz(kok, {
    kalp: new Date().toISOString(),
    sonDonguDamgasi: new Date(Date.now() - 4000).toISOString(),
    donguDurumu: 'bos',
  });
  const r = mod.hazirMi();
  assert.strictEqual(r.durum, 'ayakta');
  assert.strictEqual(r.serit, 'akiyor');
  assert.strictEqual(r.uyari, undefined);
});

test('GERİLEME: çıplak ISO kalp (eski izleyici) hâlâ okunur, serit "bilinmiyor"', () => {
  const kok = ortam('hazir');
  const mod = require('./vm-kapi.js');
  kalpYaz(kok, new Date().toISOString());
  const r = mod.hazirMi();
  assert.strictEqual(r.durum, 'ayakta');
  assert.strictEqual(r.serit, 'bilinmiyor', 'bilmediğimizi söyleriz — "iyi" demeyiz');
});

test('bekle: şerit TIKALI ise sonsuza kadar beklenmez, sebebi söylenir', async () => {
  const kok = ortam('bekle');
  const mod = require('./vm-kapi.js');
  kalpYaz(kok, {
    kalp: new Date().toISOString(),          // kalp TAZE — eski kapı buna kanardı
    sonDonguDamgasi: new Date(Date.now() - 1000 * 1000).toISOString(),
    donguDurumu: 'calisiyor', donguGorevi: 'g-eski', donguZamanAsimiSn: 570,
  });
  const kimlik = mod.gorevYaz({ tur: 'ekran' });
  const k = await mod.bekle(kimlik, 600);     // 600 sn tavan — şerit olmasa 10 dk beklerdi
  assert.strictEqual(k.durum, 'bozuk');
  assert.match(k.sebep, /ŞERİT TIKALI/);
});

// ——— 3) POWERSHELL BETİĞİ — YAPI DENETİMİ (çalıştırma DEĞİL) ————————

test('PS: zaman aşımsız `& cmd /c $g.komut` çağrısı ARTIK YOK', () => {
  assert.strictEqual(/&\s*cmd\s+\/c\s+\$g\.komut/.test(PS_KOD), false,
    'arızanın kaynağı olan tavansız çağrı geri gelmiş');
  assert.match(PS, /ESKI HALI/, 'kök neden kod yorumunda kayıtlı kalmalı');
  assert.match(PS, /Komut-Calistir \$g\.komut \$gorevTavani/);
});

test('PS: komut tavanı WaitForExit ile ZORLANIYOR ve görev başına geçiliyor', () => {
  assert.match(PS, /\$p\.WaitForExit\(\$tavanSn \* 1000\)/);
  assert.match(PS, /function Gorev-Tavani/);
  assert.match(PS, /if \(\$g\.zamanAsimiSn\) \{ return \[int\]\$g\.zamanAsimiSn \}/);
  assert.match(PS, /\$VARSAYILAN_KOMUT_TAVANI_SN = 600/);
  assert.match(PS, /\$VARSAYILAN_KUR_TAVANI_SN\s+= 1800/);
});

test('PS: ÇOCUK SÜREÇLER de öldürülüyor (taskkill /T + CIM yedeği)', () => {
  assert.match(PS, /function Surec-Agaci-Oldur/);
  assert.match(PS, /taskkill/);
  assert.match(PS, /\/PID \$sid \/T \/F/, 'tek süreç değil AĞAÇ öldürülmeli');
  assert.match(PS, /Win32_Process -Filter "ParentProcessId=\$sid"/, 'taskkill yoksa yedek yol');
  // kur dalı da aynı ağaç öldürücüyü kullanmalı
  assert.strictEqual((PS.match(/Surec-Agaci-Oldur \$p\.Id/g) || []).length, 2,
    'hem komut hem kur dalında ağaç öldürme çağrısı olmalı');
});

test('PS: zaman aşımında sonuç SESSİZCE kaybolmaz — durum/gecenSn/komutOnEk yazılır', () => {
  assert.match(PS, /zamanAsimi = \$true/);
  assert.match(PS, /cikis = 124/);
  assert.match(PS, /durum = \$durumEtiketi/);
  assert.match(PS, /gecenSn = \$gecenSn/);
  assert.match(PS, /komutOnEk = \$komutOnEk/);
  assert.match(PS, /\$KOMUT_ONEK = 160/);
  assert.match(PS, /function Komut-OnEki/);
});

test('PS: şerit damgası hem görev alınırken hem bitince basılıyor', () => {
  assert.match(PS, /function Dongu-Damgala/);
  assert.match(PS, /Dongu-Damgala 'calisiyor' \$kimlik \$gorevTavani/);
  const bos = (PS.match(/Dongu-Damgala 'bos' \$null \$null/g) || []).length;
  assert.ok(bos >= 3, `boş damga en az 3 yerde beklenir (başlangıç, her tur, görev sonrası); bulunan: ${bos}`);
  // damga ATOMİK yazılmalı — kalp işi yarım JSON okumasın
  assert.match(PS, /Move-Item -Force \$gecici \$DonguDosyasi/);
});

test('PS: kalp işi şerit damgasını GÖVDEDE taşıyor (HTTP ve klasör modu)', () => {
  assert.match(PS, /Invoke-RestMethod -Method Post -Uri "\$a\/kalp" -Body \$govde/);
  assert.match(PS, /sonDonguDamgasi\s+= \$ek\.sonDonguDamgasi/);
  // damga yoksa eski davranış korunur (gövdesiz atış)
  assert.match(PS, /Invoke-RestMethod -Method Post -Uri "\$a\/kalp" -TimeoutSec 10/);
});

test('PS: kaba yapı denetimi — süslü parantezler dengeli, dosya tam', () => {
  // Gerçek PowerShell ayrıştırıcısı YOK (Mac'te pwsh kurulu değil). Bu, kesilmiş/
  // yarım bir düzenlemeyi yakalayan kaba bir bütünlük ölçüsüdür, sözdizimi kanıtı değil.
  const ac = (PS_KOD.match(/\{/g) || []).length;
  const kapa = (PS_KOD.match(/\}/g) || []).length;
  assert.strictEqual(ac, kapa, `süslü parantez dengesiz: ${ac} açık / ${kapa} kapalı`);
  assert.match(PS, /^param\(/m);
  assert.match(PS, /\} finally \{\s*\n\s*Kalp-Isini-Durdur/);
});

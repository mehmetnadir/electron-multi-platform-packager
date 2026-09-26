'use strict';
/**
 * GÖZCÜ BETİKLERİNİN MAC'TEN ÖLÇÜLEBİLEN KISMI.
 *
 * Bu Mac'te `pwsh` YOK (ölçüldü: `which pwsh powershell` → boş). Yani PowerShell
 * gövdesi ÇALIŞTIRILAMAZ ve `Parser::ParseFile` ile gerçek sözdizimi denetimi de
 * yapılamaz. Bu yüzden burada METİN düzeyinde, ama gerçek arıza sınıflarına
 * bağlanmış değişmezler çivilenir:
 *   - eşikler JS karar modülüyle birebir mi (sapma = gözcü susar / host tıkalı der),
 *   - gözcü keyfî komut çalıştırıyor mu (asılma sınıfına giriş),
 *   - her ağ çağrısında zaman aşımı var mı (gözcünün kendisi asılmasın),
 *   - belirteç değeri dosyalara sızmış mı,
 *   - kurulum servis/port/güvenlik duvarı açıyor mu (kapsam dışı yüzey),
 *   - geri alma gerçekten kurulan her şeyi kaldırıyor mu.
 * Makinede doğrulanacaklar YUKSELTME.md'de "Makinede doğrulanacak" başlığı altında.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const karar = require('../../src/windows/izleyici-kurtarma.js');

const oku = (ad) => fs.readFileSync(path.join(__dirname, ad), 'utf8');
const GOZCU = oku('vm-gozcu.ps1');
const KUR = oku('gozcu-kur.ps1');
const KALDIR = oku('gozcu-kaldir.ps1');

/** Yalnız KOD: tam satırlık `#` yorumları atılır (yorumda geçen ad yasak sayılmasın). */
function kodu(metin) {
  return metin.split('\n').filter((s) => !/^\s*#/.test(s)).join('\n');
}
const GOZCU_KOD = kodu(GOZCU);
const KUR_KOD = kodu(KUR);

function psSabit(metin, ad) {
  const m = metin.match(new RegExp(`^\\$${ad}\\s*=\\s*(\\d+)\\s*$`, 'm'));
  return m ? Number(m[1]) : null;
}

test('gözcü eşikleri JS karar modülüyle birebir (sapma bekçisi)', () => {
  assert.strictEqual(psSabit(GOZCU, 'BOS_AZAMI_SN'), karar.BOS_AZAMI_SN);
  assert.strictEqual(psSabit(GOZCU, 'TAVAN_PAYI_SN'), karar.TAVAN_PAYI_SN);
  assert.strictEqual(psSabit(GOZCU, 'VARSAYILAN_TAVAN_SN'), karar.VARSAYILAN_TAVAN_SN);
  assert.strictEqual(psSabit(GOZCU, 'SOGUMA_SN'), karar.SOGUMA_SN);
  assert.strictEqual(psSabit(GOZCU, 'SAATLIK_TAVAN'), karar.SAATLIK_TAVAN);
  assert.strictEqual(psSabit(GOZCU, 'PENCERE_SN'), karar.PENCERE_SN);
});

test('gözcü KEYFÎ KOMUT çalıştırmaz — asılma sınıfına yapısal olarak giremez', () => {
  // İzleyiciyi 40 dakika kilitleyen şey `& cmd /c <kuyruktan gelen metin>` idi.
  assert.ok(!/Invoke-Expression/i.test(GOZCU_KOD), 'Invoke-Expression bulundu');
  assert.ok(!/\biex\b/i.test(GOZCU_KOD), 'iex bulundu');
  assert.ok(!/cmd(\.exe)?\s+\/c/i.test(GOZCU_KOD), 'cmd /c bulundu');
  assert.ok(!/\$env:ComSpec/i.test(GOZCU_KOD), 'ComSpec çağrısı bulundu');
  // Tek `&` çağrısı taskkill'dir; başka bir değişkeni çalıştırmaz.
  const cagrilar = GOZCU_KOD.split('\n').filter((s) => /^\s*&\s/.test(s) || /\s&\s\$/.test(s));
  for (const s of cagrilar) assert.match(s, /\$tk\.Source/, `beklenmeyen & çağrısı: ${s.trim()}`);
});

test('gözcünün HER ağ çağrısında zaman aşımı var (gözcü kendisi asılmasın)', () => {
  const satirlar = GOZCU.split('\n');
  const agSatirlari = [];
  satirlar.forEach((s, i) => {
    if (/Invoke-(WebRequest|RestMethod)/.test(s)) {
      // Çağrı iki satıra sarılmış olabilir (backtick devamı).
      agSatirlari.push(s + '\n' + (satirlar[i + 1] || ''));
    }
  });
  assert.ok(agSatirlari.length >= 3, `ağ çağrısı bulunamadı (${agSatirlari.length})`);
  for (const s of agSatirlari) assert.match(s, /-TimeoutSec\s+\d+/, `zaman aşımsız ağ çağrısı: ${s}`);
});

test('betiklerin hiçbirinde belirteç DEĞERİ yok (yalnız yol/yer tutucu)', () => {
  for (const [ad, metin] of [['gozcu', GOZCU], ['kur', KUR], ['kaldir', KALDIR]]) {
    assert.ok(!/\b[a-f0-9]{24}\b/.test(metin), `${ad}: 24 hex belirteç benzeri değer bulundu`);
  }
});

test('gözcü belirteci günlüğe basmaz — maskeleyici var ve hata yolunda kullanılıyor', () => {
  assert.match(GOZCU, /function Gizle-Belirtec/);
  assert.match(GOZCU, /Gizle-Belirtec \$_\.Exception\.Message/);
});

test('kurulum SERVİS kurmaz, PORT/güvenlik duvarı açmaz', () => {
  assert.ok(!/New-Service/i.test(KUR_KOD), 'New-Service bulundu');
  assert.ok(!/sc\.exe\s+create/i.test(KUR_KOD), 'sc.exe create bulundu');
  assert.ok(!/New-NetFirewallRule/i.test(KUR_KOD), 'güvenlik duvarı kuralı bulundu');
  assert.ok(!/Enable-PSRemoting|Set-Service\s+.*WinRM|sshd/i.test(KUR_KOD), 'uzak kabuk açılıyor');
});

test('kurulum MASAÜSTÜ oturumunda koşar (Oturum 0 ekran kanıtını siyah yapar)', () => {
  assert.match(KUR, /New-ScheduledTaskPrincipal[^\n]*-LogonType Interactive/);
  assert.match(KUR, /-MultipleInstances IgnoreNew/);   // iki gözcü yarışmasın
  assert.match(KUR, /RepetitionInterval/);             // gözcüyü de bekleyen olsun
});

test('geri alma kurulan HER ŞEYİ kaldırır (görev + yedek kısayol + süreç)', () => {
  assert.match(KALDIR, /Unregister-ScheduledTask/);
  assert.match(KALDIR, /Startup\\vm-gozcu\.cmd/);
  assert.match(KALDIR, /vm-gozcu\.ps1/);
  // İzleyiciye ve belirtece DOKUNMAZ: onlar gözcüden önce de vardı.
  assert.ok(!/Remove-Item[^\n]*belirtec/i.test(KALDIR), 'belirteç dosyası siliniyor');
  assert.ok(!/Stop-Process[^\n]*vm-izleyici/i.test(KALDIR), 'izleyici öldürülüyor');
});

test('geri alma KANITI (günlüğü) varsayılan olarak silmez', () => {
  assert.match(KALDIR, /\[switch\]\$GunlukleriDeSil/);
  assert.match(KALDIR, /gunluk KORUNDU/);
});

test('PowerShell dosyalarında süslü parantezler dengeli (kaba sözdizimi kapısı)', () => {
  for (const [ad, metin] of [['vm-gozcu', GOZCU], ['gozcu-kur', KUR], ['gozcu-kaldir', KALDIR]]) {
    const ac = (metin.match(/\{/g) || []).length;
    const kapa = (metin.match(/\}/g) || []).length;
    assert.strictEqual(ac, kapa, `${ad}.ps1: { ${ac} ≠ } ${kapa}`);
    assert.ok(/^param\(/m.test(metin), `${ad}.ps1: param bloğu yok`);
  }
});

test('gözcü, kestiği görevi host\'a SEBEBİYLE bildirir (sessiz kayıp yok)', () => {
  assert.match(GOZCU, /function Sonuc-Kesildi-Yaz/);
  assert.match(GOZCU, /durum\s*=\s*'zaman-asimi'/);
  assert.match(GOZCU, /Sonuc-Kesildi-Yaz \$belirtec/);
});

test('gözcünün kendisi de izlenebilir (bekçi güven gate: kalp atar)', () => {
  assert.match(GOZCU, /\$\(\$Makine\)-gozcu\/kalp/);
});

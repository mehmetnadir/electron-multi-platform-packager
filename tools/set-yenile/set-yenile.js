#!/usr/bin/env node
'use strict';
/**
 * SET YENİLE — YDS set paketlerinin Windows + Pardus yenilemesini TEK KOMUTA çevirir.
 *
 *   ön kontrol → (1) kabuk eki (Mac) → (2) kaynak kur isteği (DB) → (3) HEMEN requeue (DB)
 *   → (4) kasa imza önceliği → (5) yeni build satırını bekle (ret/tavan) → (6) izle + özet bildirim
 *   Requeue beklemeden önce gelir: sunucu kaynak kurulumunu YALNIZ kuyruktaki iş kiralanınca verir.
 *
 * Kullanım:
 *   node tools/set-yenile/set-yenile.js <bookId...> [--platform windows,pardus] [--uygula] [--izle]
 *     [--ek-atla] [--kur-atla] [--devam <durum.json>] [--ek-uret <yol>] [--kur-tavan <dk>]
 *     [--izle-tavan <sa>]
 *
 * VARSAYILAN KURU: hiçbir yazma yapılmaz (DB, kasa, bildirim, durum dosyası). Yalnız salt okuma
 * ölçümü koşar; plan ile çalıştırılacak SQL/komutlar basılır. Yazma yalnız `--uygula` ile.
 *
 * Güvenlik:
 *  - DB okuma yalnız `pipeline-sql` (tek SELECT, `;` yok). Yazma `mariadb --defaults-extra-file`.
 *  - Her yazmadan ÖNCE `mariadb-dump` yedeği alınır; "Dump completed" + en az 1 INSERT yoksa
 *    yazma YAPILMAZ.
 *  - book_id yalnız rakam; platform yalnız izinli listeden. SQL'e başka girdi girmez.
 *  - Kimlik dosyaları (.cnf, .env, jeton) okunmaz, basılmaz.
 *  - Saf mantık dışarıdan verilen `calistir/simdi/bekle/getir/dosyaVar/dosyaYaz` ile test edilir.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { spawn } = require('child_process');

const IZINLI_PLATFORMLAR = ['windows', 'pardus', 'mac', 'android', 'web-stream', 'web'];
// ControlPath=none (06.10, 15 set canlı koşusu): kullanıcı ssh ayarındaki çoğullama soketi başka
// oturumla çakıştı ("ControlSocket … already exists, disabling multiplexing" + broken pipe),
// pipeline-sql 90 sn zaman aşımına düştü. Her çağrı kendi bağlantısını açar.
const SSH_ORTAK = ['-o', 'ControlPath=none', '-o', 'ConnectTimeout=10', '-o', 'BatchMode=yes'];
/** Çıkış kodları: 0 tamam · 1 hata/durma · 2 kullanım · 3 yeni kaynak bekleme tavanı doldu (eylem yok). */
const CIKIS = { TAMAM: 0, HATA: 1, KULLANIM: 2, KUR_TAVAN: 3 };
const OLCUM_DENEME = 3;
const OLCUM_ARA_MS = 15000;
const ID_DESENI = /^[1-9][0-9]{0,9}$/;
const DB_ZAMAN = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?$/;
const TARAYICI_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const BITMIS = new Set(['tamam', 'atlandi']);

// ─── Ayarlar ve argümanlar (SAF) ───────────────────────────────────────────────────────────

function ayarlar(env = process.env, ev = os.homedir()) {
  const bol = (s) => String(s).trim().split(/\s+/).filter(Boolean);
  const repo = path.resolve(__dirname, '..', '..');
  return {
    srv21Birincil: env.EMPP_SRV21_SSH ? bol(env.EMPP_SRV21_SSH) : ['-p', '2222', 'root@100.117.187.26'],
    srv21Yedek: env.EMPP_SRV21_SSH_YEDEK ? bol(env.EMPP_SRV21_SSH_YEDEK)
      : ['-J', 'etapadmin@100.73.161.76', '-p', '2222', 'root@10.0.0.21'],
    kasa: env.EMPP_KASA_SSH || 'Administrator@100.99.245.17',
    probook: env.EMPP_PROBOOK_SSH || 'etapadmin@100.73.161.76',
    // 06.10 ölçüldü: bekçi `<home>\.empp-agent\imza-oncelik.txt` okur (windows-hazir.oncelikDosyasi);
    // kasada `.empp-agent` → C:\empp-ajan\ev bağlantısıdır. C:\empp-ajan\imza-oncelik.txt YOK.
    oncelikDosyasi: env.EMPP_KASA_ONCELIK || 'C:\\Users\\Administrator\\.empp-agent\\imza-oncelik.txt',
    bekciLog: env.EMPP_KASA_BEKCI_LOG || 'C:\\empp-ajan\\log\\imza-bekcisi.log',
    kasaBetikDizini: 'C:\\empp-ajan',
    ekUret: env.EMPP_EK_URET || path.join(repo, 'tools', 'set-kabuk', 'ek-uret.js'),
    durumDizini: path.join(ev, '.empp-agent', 'set-yenile'),
    arsivKoku: env.EMPP_KAYNAK_ARSIVI || path.join(ev, '.empp-agent', 'kaynak-arsivi'),
    bildir: env.EMPP_BILDIR || path.join(ev, '.local', 'bin', 'bildir'),
    cdnKok: 'https://cdn.ydspublishing.com/kabuk-ek',
    yedekKoku: '/root/yedek-deploy',
    dbCnf: '/root/.pipeline-db.cnf',
    db: 'akillitahta',
  };
}

function argAyristir(argv) {
  const o = {
    idler: [], platformlar: ['windows', 'pardus'], platformVerildi: false, uygula: false, izle: false,
    ekAtla: false, kurAtla: false, devam: null, ekUret: null, kurTavanDk: 120, izleTavanSa: 8, hata: null,
  };
  const deger = (i, ad) => {
    if (i + 1 >= argv.length) throw new Error(`${ad} değer ister`);
    return argv[i + 1];
  };
  try {
    for (let i = 0; i < argv.length; i += 1) {
      const a = argv[i];
      if (a === '--uygula') o.uygula = true;
      else if (a === '--izle') o.izle = true;
      else if (a === '--ek-atla') o.ekAtla = true;
      else if (a === '--kur-atla') o.kurAtla = true;
      else if (a === '--platform') {
        o.platformlar = deger(i, a).split(',').map((s) => s.trim()).filter(Boolean);
        o.platformVerildi = true; i += 1;
      } else if (a === '--devam') { o.devam = deger(i, a); i += 1; }
      else if (a === '--ek-uret') { o.ekUret = deger(i, a); i += 1; }
      else if (a === '--kur-tavan') { o.kurTavanDk = Number(deger(i, a)); i += 1; }
      else if (a === '--izle-tavan') { o.izleTavanSa = Number(deger(i, a)); i += 1; }
      else if (a.startsWith('--')) throw new Error(`bilinmeyen bayrak: ${a}`);
      else o.idler.push(a);
    }
  } catch (e) { return { ...o, hata: e.message }; }
  const bozuk = o.idler.filter((x) => !ID_DESENI.test(x));
  if (bozuk.length) return { ...o, hata: `book_id yalnız pozitif tamsayı olur: ${bozuk.join(',')}` };
  o.idler = [...new Set(o.idler)];
  const yanlis = o.platformlar.filter((p) => !IZINLI_PLATFORMLAR.includes(p));
  if (yanlis.length || !o.platformlar.length) {
    return { ...o, hata: `platform izinli değil: ${yanlis.join(',') || '(boş)'} — izinli: ${IZINLI_PLATFORMLAR.join(',')}` };
  }
  o.platformlar = [...new Set(o.platformlar)];
  if (!(o.kurTavanDk > 0) || !(o.izleTavanSa > 0)) return { ...o, hata: 'tavan değerleri pozitif sayı olur' };
  if (!o.idler.length && !o.devam) return { ...o, hata: 'en az bir bookId ya da --devam <durum.json> gerekli' };
  return o;
}

// ─── SQL üretimi (SAF; girdiler doğrulanır) ───────────────────────────────────────────────

function idDogrula(id) {
  const s = String(id);
  if (!ID_DESENI.test(s)) throw new Error(`geçersiz book_id: ${s}`);
  return s;
}
function platformDogrula(p) {
  if (!IZINLI_PLATFORMLAR.includes(p)) throw new Error(`geçersiz platform: ${p}`);
  return p;
}
const idListesi = (idler) => idler.map((x) => `'${idDogrula(x)}'`).join(',');

const sql = {
  kitaplar: (idler) => 'SELECT book_id, kaynak_modu, kaynak_kur_istegi_at, kaynak_kurulum_baslangic, '
    + 'kaynak_kurulum_bitis, kaynak_kurulum_ajan, kaynak_kurulum_surum, kaynak_kur_ret_at, kaynak_kur_ret_nedenleri '
    + `FROM pipeline_book_summaries WHERE book_id IN (${idListesi(idler)})`,
  platformlar: (idler, platformlar) => 'SELECT book_id, platform, status, last_result, progress, '
    + 'current_phase, last_run_at, last_queued_at FROM pipeline_platform_summaries '
    + `WHERE book_id IN (${idListesi(idler)}) AND platform IN `
    + `(${platformlar.map((p) => `'${platformDogrula(p)}'`).join(',')})`,
  // MAX(surum) varchar'da sözlük sırası verir (2.9 > 2.25); en yeni kayıt olusturma ile seçilir.
  tohum: (idler) => 'SELECT set_id, surum, kaynak, olusturma FROM kaynak_build_surumleri '
    + `WHERE set_id IN (${idListesi(idler)}) AND durum='gecerli' ORDER BY olusturma DESC`,
  kurIstegi: (id) => [
    'SELECT NOW(3);',
    `UPDATE pipeline_book_summaries SET kaynak_kur_istegi_at = NOW(3) WHERE book_id='${idDogrula(id)}' `
      + "AND (kaynak_modu IS NULL OR kaynak_modu <> 'manuel');",
    'SELECT ROW_COUNT();',
  ].join('\n'),
  // `status <> 'running'` yarışa karşı: okuma ile yazma arasında iş alınırsa ezilmez (ROW_COUNT 0).
  requeue: (id, platform) => [
    "UPDATE pipeline_platform_summaries SET status='queued', last_result=NULL, progress=0, "
      + 'current_phase=NULL, last_run_at=NULL, leased_by_agent=NULL, lease_expires_at=NULL, '
      + `last_queued_at=NOW(3) WHERE book_id='${idDogrula(id)}' AND platform='${platformDogrula(platform)}' `
      + "AND status <> 'running';",
    'SELECT ROW_COUNT();',
  ].join('\n'),
};

function yedekKomutu(cfg, { stamp, id, tablo, etiket }) {
  if (!/^\d{8}-\d{6}$/.test(stamp)) throw new Error(`geçersiz damga: ${stamp}`);
  if (!['pipeline_book_summaries', 'pipeline_platform_summaries'].includes(tablo)) {
    throw new Error(`tablo izinli değil: ${tablo}`);
  }
  if (!/^[a-z0-9-]+$/.test(etiket)) throw new Error(`geçersiz etiket: ${etiket}`);
  const kid = idDogrula(id);
  const dizin = `${cfg.yedekKoku}/${stamp}-set-yenile`;
  const dosya = `${dizin}/${kid}-${tablo}-${etiket}.sql`;
  const komut = `mkdir -p '${dizin}' && mariadb-dump --defaults-extra-file=${cfg.dbCnf} --single-transaction `
    + `${cfg.db} ${tablo} --where="book_id='${kid}'" > '${dosya}' && tail -n 1 '${dosya}' `
    + `&& echo "INSERT_SAYISI=$(grep -c 'INSERT INTO' '${dosya}')"`;
  return { dosya, komut };
}

/** Yedek çıktısı doğrulandı mı (SAF): "Dump completed" + en az 1 INSERT satırı. */
function yedekDogrulandiMi(r) {
  if (!r || r.kod !== 0) return false;
  const m = /INSERT_SAYISI=(\d+)/.exec(r.stdout || '');
  return /Dump completed/.test(r.stdout || '') && Boolean(m) && Number(m[1]) >= 1;
}

// ─── Ayrıştırma ve değerlendirme (SAF) ────────────────────────────────────────────────────

/** mariadb batch (TSV + başlık) → nesne listesi. 'NULL' → null. ERROR satırı → istisna. */
function tsvAyristir(metin) {
  const s = String(metin || '');
  const hata = /^ERROR \d+.*$/m.exec(s);
  if (hata) throw new Error(`DB hatası: ${hata[0].slice(0, 300)}`);
  const satirlar = s.split(/\r?\n/).filter((l) => l.length);
  if (!satirlar.length) return [];
  const baslik = satirlar[0].split('\t');
  return satirlar.slice(1).map((l) => {
    const h = l.split('\t');
    const o = {};
    baslik.forEach((b, i) => { o[b] = h[i] === undefined || h[i] === 'NULL' ? null : h[i]; });
    return o;
  });
}

/** DB zamanını (yerel saat, "YYYY-MM-DD HH:MM:SS[.fff]") kıyaslanabilir dizgeye çevirir. */
function dbZaman(s) {
  if (s == null) return null;
  const m = DB_ZAMAN.exec(String(s).trim());
  if (!m) throw new Error(`DB zamanı ayrıştırılamadı: ${s}`);
  return `${m[1]} ${m[2]}.${(m[3] || '').padEnd(6, '0')}`;
}
/** a > b (ikisi de DB zamanı). Biri boşsa false. Mac saati KULLANILMAZ. */
function dbSonra(a, b) {
  const x = dbZaman(a); const y = dbZaman(b);
  return Boolean(x && y && x > y);
}

function retNedenleri(metin) {
  if (metin == null) return [];
  try {
    const j = JSON.parse(metin);
    const dizi = Array.isArray(j) ? j : [j];
    return dizi.map((n) => (typeof n === 'string' ? n : `${n.kod || '?'}: ${n.ayrinti || JSON.stringify(n)}`));
  } catch (_) { return [String(metin)]; }
}

/** Açık kurulum kilidi (SAF, yalnız bilgi): başlangıç dolu + bitiş boş. Yoksa null. */
function kilitNotu(satir) {
  if (!satir || !satir.kaynak_kurulum_baslangic || satir.kaynak_kurulum_bitis) return null;
  return `kurulum kilidi açık, ajan: ${satir.kaynak_kurulum_ajan || '?'}, başlangıç: ${satir.kaynak_kurulum_baslangic}`;
}

/**
 * Kaynak kurulum durumu (SAF). t0 = kur isteği anındaki DB NOW(3).
 * Başarı: `kaynak_build_surumleri`'nde bu set için `durum='gecerli'` ve `olusturma > t0` olan YENİ
 * satır. `kaynak_kurulum_*` alanları canlıda hiç dolmuyor (06.10 ölçümü: 0 satır) — yalnız bilgi.
 * t0'dan önce başlamış açık kilit bekletmez; yeni satır gelirse başarı.
 * Ret: yeni satır yokken `kaynak_kur_ret_at > t0`.
 * @param {object} satir pipeline_book_summaries satırı
 * @param {object[]} surumler bu setin kaynak_build_surumleri satırları (gecerli)
 */
function kurDegerlendir(satir, surumler, t0) {
  if (!satir) return { durum: 'hata', neden: 'kitap satırı okunamadı' };
  const not = kilitNotu(satir);
  const yeni = (surumler || []).filter((s) => dbSonra(s.olusturma, t0))
    .sort((a, b) => (dbZaman(b.olusturma) > dbZaman(a.olusturma) ? 1 : -1))[0];
  if (yeni) return { durum: 'bitti', surum: yeni.surum, kaynak: yeni.kaynak || null, olusturma: yeni.olusturma, not };
  if (dbSonra(satir.kaynak_kur_ret_at, t0)) {
    return { durum: 'ret', zaman: satir.kaynak_kur_ret_at, nedenler: retNedenleri(satir.kaynak_kur_ret_nedenleri), not };
  }
  return { durum: 'bekliyor', not };
}

/** ek-uret çıktısındaki son SONUÇ satırı (SAF). */
function ekSonucAyristir(cikti) {
  const satirlar = String(cikti || '').split(/\r?\n/).filter((l) => /\[kabuk-ek\] SONUÇ /.test(l));
  if (!satirlar.length) return null;
  const l = satirlar[satirlar.length - 1];
  return {
    durum: (/ durum=(\S+)/.exec(l) || [])[1] || null,
    girdiSha: (/ girdiSha=([0-9a-f]+)/.exec(l) || [])[1] || null,
    neden: (/ — (.*)$/.exec(l) || [])[1] || null,
  };
}

/**
 * Ek adımı başarılı mı (SAF). Çıkış kodu kanıt değildir: son.json'daki `uretildi` adım başlangıcından
 * sonra olmalı; ya da ek-uret "zaten işlendi" dedi ve son.json aynı girdiSha'yı gösteriyor.
 * ek-uret çıkış kodları: 0 tamam, 1 hata, 2 eylem yok (kaynak yok).
 */
function ekDegerlendir({ kod, cikti, son, baslangicMs }) {
  if (kod === 2) return { tamam: false, neden: 'ek-uret: eylem yok (kaynak yok, çıkış 2)' };
  if (kod !== 0) return { tamam: false, neden: `ek-uret çıkış ${kod}` };
  const sonuc = ekSonucAyristir(cikti);
  const zaten = /zaten (işlendi|güncel)/.test(String(cikti || ''));
  if (sonuc && sonuc.durum && sonuc.durum !== 'yuklendi' && !zaten) {
    return { tamam: false, neden: `ek-uret durum=${sonuc.durum}${sonuc.neden ? ` — ${sonuc.neden}` : ''}` };
  }
  if (!son || typeof son !== 'object') return { tamam: false, neden: 'son.json okunamadı' };
  const shaUyar = !sonuc || !sonuc.girdiSha || !son.girdiSha || sonuc.girdiSha === son.girdiSha;
  const uretildiMs = Date.parse(son.uretildi);
  const kanit = { uretildi: son.uretildi || null, girdiSha: son.girdiSha || null, tabanSurum: son.tabanSurum || null };
  if (!shaUyar) return { tamam: false, neden: `son.json girdiSha (${son.girdiSha}) ≠ ek-uret (${sonuc.girdiSha})`, kanit };
  if (Number.isFinite(uretildiMs) && uretildiMs >= baslangicMs) return { tamam: true, kanit };
  if (zaten && son.girdiSha) return { tamam: true, kanit: { ...kanit, zaten: true } };
  return { tamam: false, neden: `son.json eski (uretildi=${son.uretildi || '?'})`, kanit };
}

/** imza-oncelik.txt başına id'leri ekler, tekrarı kaldırır (SAF). Biçim: satır başına bir id, CRLF. */
function oncelikBirlestir(eskiMetin, idler) {
  const temiz = String(eskiMetin || '').replace(/^\uFEFF/, '');
  const satirlar = temiz.length ? temiz.split(/\r?\n/) : [];
  while (satirlar.length && satirlar[satirlar.length - 1] === '') satirlar.pop();
  const yeni = [...new Set(idler.map(idDogrula))];
  const kalan = satirlar.filter((l) => !yeni.includes(l.replace(/#.*/, '').trim()));
  return `${[...yeni, ...kalan].join('\r\n')}\r\n`;
}

/** Kasada öncelik dosyasını değiştiren PowerShell betiği (SAF). Baytları birebir karşılaştırır. */
function oncelikPs({ yol, yedekYol, eskiB64, yeniB64 }) {
  const q = (s) => String(s).replace(/'/g, "''");
  const b64 = (s) => { if (!/^[A-Za-z0-9+/=]*$/.test(s)) throw new Error('base64 değil'); return s; };
  return [
    "$ErrorActionPreference = 'Stop'",
    `$yol = '${q(yol)}'`,
    `$yedek = '${q(yedekYol)}'`,
    `$eski = '${eskiB64 === null ? 'YOK' : b64(eskiB64)}'`,
    `$yeni = '${b64(yeniB64)}'`,
    "if (Test-Path -LiteralPath $yol) { $simdi = [Convert]::ToBase64String([IO.File]::ReadAllBytes($yol)) } else { $simdi = 'YOK' }",
    "if ($simdi -cne $eski) { Write-Output 'DEGISTI'; exit 4 }",
    "if ($simdi -cne 'YOK') {",
    '  Copy-Item -LiteralPath $yol -Destination $yedek -Force',
    "  if (-not (Test-Path -LiteralPath $yedek)) { Write-Output 'YEDEK-YOK'; exit 5 }",
    "  Write-Output ('YEDEK ' + $yedek)",
    '}',
    '[IO.File]::WriteAllBytes($yol, [Convert]::FromBase64String($yeni))',
    '$geri = [Convert]::ToBase64String([IO.File]::ReadAllBytes($yol))',
    "if ($geri -cne $yeni) { Write-Output 'DOGRULANAMADI'; exit 6 }",
    "Write-Output 'TAMAM'",
    '',
  ].join('\r\n');
}

/** Bekçi logunda `<ISO> ... <id>-<sürüm> ... yayinlandi` satırı (SAF). sonrakiMs sonrası en son kayıt. */
function yayinBul(metin, id, sonrakiMs) {
  let bulunan = null;
  for (const l of String(metin || '').split(/\r?\n/)) {
    const m = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s.*?\b(\d+)-(\d[0-9A-Za-z.-]*)\b.*\byayinlandi\b/.exec(l);
    if (!m || m[2] !== String(id)) continue;
    const ms = Date.parse(m[1]);
    if (Number.isFinite(ms) && ms >= sonrakiMs) bulunan = { surum: m[3], zaman: m[1] };
  }
  return bulunan;
}

function damga(ms) {
  const t = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${t.getFullYear()}${p(t.getMonth() + 1)}${p(t.getDate())}-${p(t.getHours())}${p(t.getMinutes())}${p(t.getSeconds())}`;
}

/** ssh 255 + bağlantı aşaması hatası mı (SAF). Yalnız bunda yedek rotaya geçilir. */
function baglantiHatasiMi(r) {
  if (!r || r.kod !== 255) return false;
  return /Connection timed out|Operation timed out|Connection refused|No route to host|Network is unreachable|Could not resolve|connect to host|kex_exchange|Connection closed by|UNKNOWN port/i
    .test(String(r.stderr || ''));
}
const sshGurultusuz = (s) => String(s || '').split(/\r?\n/)
  .filter((l) => l.trim() && !/post-quantum|store now, decrypt later|openssh\.com\/pq/.test(l)).join('\n');

// ─── Uzak istemciler ──────────────────────────────────────────────────────────────────────

function srv21Istemci(cfg, d) {
  let secili = null;
  async function ssh(uzakKomut, { girdi, zamanAsimiMs = 90000 } = {}) {
    const rotalar = secili ? [secili] : [cfg.srv21Birincil, cfg.srv21Yedek];
    let son = null;
    for (const rota of rotalar) {
      const r = await d.calistir('ssh', [...SSH_ORTAK, ...rota, uzakKomut], { girdi, zamanAsimiMs });
      if (baglantiHatasiMi(r)) {
        son = r;
        d.uyar(`srv21 rotası bağlanamadı (${rota.join(' ')}): ${sshGurultusuz(r.stderr).slice(-160)}`);
        continue;
      }
      if (!secili) {
        secili = rota;
        if (rota !== cfg.srv21Birincil) d.uyar(`srv21 YEDEK rota kullanılıyor: ${rota.join(' ')}`);
      }
      return r;
    }
    throw new Error(`srv21'e hiçbir rotadan bağlanılamadı: ${sshGurultusuz(son && son.stderr).slice(-200)}`);
  }
  return {
    rota: () => secili,
    async oku(sorgu) {
      if (!/^\s*SELECT\b/i.test(sorgu) || sorgu.includes(';')) throw new Error('okuma tek SELECT olur, ; içermez');
      const r = await ssh('pipeline-sql', { girdi: sorgu });
      const hata = sshGurultusuz(r.stderr);
      // pipeline-sql 0 satırda çıkış 1 verir, stdout/stderr boştur: hata değil, boş sonuç.
      if (r.kod === 1 && !String(r.stdout || '').trim() && !hata) return [];
      if (r.kod !== 0) throw new Error(`pipeline-sql çıkış ${r.kod}: ${(hata || r.stdout || '').slice(-300)}`);
      return tsvAyristir(r.stdout);
    },
    async yaz(sorgu) {
      const r = await ssh(`mariadb --defaults-extra-file=${cfg.dbCnf} ${cfg.db} -N -B`, { girdi: sorgu });
      if (r.kod !== 0 || /^ERROR \d+/m.test(`${r.stdout}\n${r.stderr}`)) {
        throw new Error(`DB yazma başarısız (çıkış ${r.kod}): ${sshGurultusuz(r.stderr || r.stdout).slice(-300)}`);
      }
      return String(r.stdout || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    },
    async yedek(y) {
      const r = await ssh(y.komut, { zamanAsimiMs: 100000 });
      if (!yedekDogrulandiMi(r)) {
        throw new Error(`yedek doğrulanamadı (${y.dosya}): çıkış ${r.kod} ${sshGurultusuz(r.stderr || r.stdout).slice(-200)}`);
      }
      return y.dosya;
    },
  };
}

function kasaIstemci(cfg, d) {
  const hedef = [...SSH_ORTAK];
  const ssh = (komut, zamanAsimiMs = 60000) => d.calistir('ssh', [...hedef, cfg.kasa, komut], { kodlama: 'latin1', zamanAsimiMs });
  return {
    async erisim() {
      const r = await ssh('echo set-yenile-ok', 20000);
      return r.kod === 0 && /set-yenile-ok/.test(r.stdout || '');
    },
    /** Dosyanın HAM baytları latin1 dizge olarak (latin1 baytları birebir korur). Dosya yoksa null. */
    async oncelikOku() {
      const y = cfg.oncelikDosyasi;
      const r = await ssh(`if exist "${y}" (type "${y}") else (exit /b 9)`);
      if (r.kod === 9) return null;
      if (r.kod !== 0) throw new Error(`kasa öncelik dosyası okunamadı (çıkış ${r.kod}): ${sshGurultusuz(r.stderr).slice(-200)}`);
      return String(r.stdout || '');
    },
    /** PowerShell kuralı: .ps1 yaz → scp → powershell -File. Çıktı latin1 çözülür. */
    async ps(ad, icerik) {
      if (!/^[a-z0-9-]+$/.test(ad)) throw new Error(`güvensiz betik adı: ${ad}`);
      const yerel = d.geciciYaz(`${ad}.ps1`, icerik);
      const uzakYol = `${cfg.kasaBetikDizini}\\${ad}.ps1`;
      const s = await d.calistir('scp', [...hedef, yerel, `${cfg.kasa}:${uzakYol.replace(/\\/g, '/')}`], { zamanAsimiMs: 60000 });
      if (s.kod !== 0) throw new Error(`scp başarısız (${s.kod}): ${sshGurultusuz(s.stderr).slice(-200)}`);
      return ssh(`powershell -NoProfile -ExecutionPolicy Bypass -File ${uzakYol}`, 90000);
    },
    async yayinSatirlari() {
      const r = await ssh(`findstr /l /c:"yayinlandi" "${cfg.bekciLog}"`);
      if (r.kod === 1 && !String(r.stdout || '').trim()) return '';
      if (r.kod !== 0) throw new Error(`bekçi logu okunamadı (çıkış ${r.kod}): ${sshGurultusuz(r.stderr).slice(-200)}`);
      return String(r.stdout || '');
    },
  };
}

// ─── Durum dosyası ────────────────────────────────────────────────────────────────────────

function yeniDurum(o, stamp) {
  return {
    surum: 1, damga: stamp, olusturma: null,
    secenekler: { platformlar: o.platformlar, ekAtla: o.ekAtla, kurAtla: o.kurAtla, izle: o.izle },
    kitaplar: {},
  };
}
function kitapDurumu(durum, id) {
  const k = idDogrula(id);
  if (!durum.kitaplar[k]) durum.kitaplar[k] = { id: k, durdu: null, uyarilar: [], platformlar: [], adimlar: {} };
  return durum.kitaplar[k];
}
const bitmis = (a) => Boolean(a && BITMIS.has(a.durum));

// ─── Akış ─────────────────────────────────────────────────────────────────────────────────

async function yurut(o, cfg, d, durum, durumYolu) {
  const kuru = !o.uygula;
  const db = srv21Istemci(cfg, d);
  const kasa = kasaIstemci(cfg, d);
  const plan = [];
  const yaz = (s) => { plan.push(s); d.log(s); };
  const iso = () => new Date(d.simdi()).toISOString();
  const kaydet = () => { if (!kuru) d.dosyaYaz(durumYolu, `${JSON.stringify(durum, null, 2)}\n`); };
  const bildir = async (mesaj, baslik) => {
    if (kuru) { yaz(`  [kuru] bildirim atılırdı: bildir paket "${mesaj}" -b "${baslik}"`); return; }
    const r = await d.calistir(cfg.bildir, ['paket', mesaj, '-b', baslik], { zamanAsimiMs: 30000 });
    if (r.kod !== 0) d.uyar(`bildirim GÖNDERİLEMEDİ (çıkış ${r.kod}): ${String(r.stderr || '').slice(-160)}`);
  };
  const durdur = async (k, adim, neden, bildirimAt = true, kod = CIKIS.HATA) => {
    k.durdu = { adim, neden, zaman: iso(), kod };
    k.adimlar[adim] = { ...(k.adimlar[adim] || {}), durum: 'hata', neden, bit: iso() };
    yaz(`  ✗ ${k.id}: ${adim} — ${neden} → bu kitap DURDU (diğerleri sürer)`);
    if (bildirimAt) await bildir(`Set yenileme ${k.id} durdu (${adim}): ${String(neden).slice(0, 200)}`, 'Set yenileme durdu');
    kaydet();
  };
  const adimBasla = (k, ad) => { k.adimlar[ad] = { ...(k.adimlar[ad] || {}), durum: 'suruyor', bas: iso(), basMs: d.simdi() }; };
  const adimBit = (k, ad, durumAdi, ek = {}) => { k.adimlar[ad] = { ...k.adimlar[ad], durum: durumAdi, bit: iso(), ...ek }; kaydet(); };
  const atla = (k, ad, neden) => {
    if (bitmis(k.adimlar[ad])) return;
    k.adimlar[ad] = { durum: 'atlandi', neden, bit: iso() };
    yaz(`  - ${k.id}: ${ad} atlandı (${neden})`);
  };
  /**
   * Bekleme/izleme ÖLÇÜMÜ: okuma hatası (zaman aşımı, ağ, ssh) ölümcül değildir. 3 deneme, 15 sn
   * arayla; yine olmazsa "ölçüm atlandı" uyarısı ve null — döngü sürer, tavanlar işlemeye devam eder.
   * YAZMA adımları (kur isteği, requeue, öncelik) bunu KULLANMAZ: ilk hatada kitap durur.
   */
  const olcum = async (etiket, fn) => {
    for (let deneme = 1; deneme <= OLCUM_DENEME; deneme += 1) {
      try {
        return await fn();
      } catch (e) {
        d.uyar(`${etiket}: okuma hatası (${deneme}/${OLCUM_DENEME}): ${String(e.message).slice(0, 200)}`);
        if (deneme < OLCUM_DENEME) await d.bekle(OLCUM_ARA_MS);
      }
    }
    d.uyar(`${etiket}: ölçüm atlandı (${OLCUM_DENEME} deneme başarısız) — döngü sürer`);
    return null;
  };
  /** Yazma adımı: hata kitabı durdurur (ilk hatada), aracı düşürmez; diğer kitaplar sürer. */
  const yazmaAdimi = async (k, adim, fn) => {
    try { await fn(); } catch (e) { await durdur(k, adim, `yazma adımı hatası: ${String(e.message).slice(0, 300)}`); }
  };
  const sonKod = () => {
    const duran = idler.map((id) => durum.kitaplar[id]).filter((k) => k.durdu);
    if (!duran.length) return CIKIS.TAMAM;
    return duran.every((k) => k.durdu.kod === CIKIS.KUR_TAVAN) ? CIKIS.KUR_TAVAN : CIKIS.HATA;
  };

  const idler = (durum.sira || Object.keys(durum.kitaplar)).filter((id) => durum.kitaplar[id]);
  yaz(`set-yenile ${kuru ? 'KURU (yazma yok)' : 'UYGULA'} · kitaplar ${idler.join(',')} · platform ${o.platformlar.join(',')}`);

  // 0) Ön kontrol (salt okuma; --devam'da da tazelenir).
  const kitapSatir = new Map((await db.oku(sql.kitaplar(idler))).map((r) => [r.book_id, r]));
  const platSatir = await db.oku(sql.platformlar(idler, o.platformlar));
  const tohumSatir = await db.oku(sql.tohum(idler));
  yaz(`ön kontrol: srv21 rota ${db.rota().join(' ')}`);
  if (o.platformlar.includes('windows')) {
    const ok = await kasa.erisim();
    yaz(`ön kontrol: kasa ${cfg.kasa} ${ok ? 'erişilir' : 'ERİŞİLEMEZ'}`);
    if (!ok) throw new Error(`kasa erişilemiyor (${cfg.kasa}); windows imza önceliği (5) yapılamaz`);
  }
  const pb = await d.calistir('ssh', [...SSH_ORTAK, cfg.probook, 'echo set-yenile-ok'], { zamanAsimiMs: 30000 });
  const pbOk = pb.kod === 0 && /set-yenile-ok/.test(pb.stdout || '');
  yaz(`ön kontrol: ProBook ${cfg.probook} ${pbOk ? 'erişilir' : 'ERİŞİLEMEZ (uyarı)'}`);
  if (!pbOk) d.uyar('ProBook erişilemiyor: srv21 yedek rotası kullanılamaz');

  for (const id of idler) {
    const k = durum.kitaplar[id];
    if (o.devam && k.durdu) { yaz(`  ↻ ${id}: önceki durma (${k.durdu.adim}) temizlendi, adım yeniden denenir`); k.durdu = null; }
    const b = kitapSatir.get(id);
    if (!b) { await durdur(k, 'onkontrol', 'pipeline_book_summaries satırı yok'); continue; }
    k.manuel = b.kaynak_modu === 'manuel';
    const satirlar = platSatir.filter((r) => r.book_id === id);
    const mevcut = satirlar.map((r) => r.platform);
    const eksik = o.platformlar.filter((p) => !mevcut.includes(p));
    if (eksik.length) { k.uyarilar.push(`platform satırı yok: ${eksik.join(',')}`); d.uyar(`${id}: platform satırı yok: ${eksik.join(',')}`); }
    k.platformlar = o.platformlar.filter((p) => mevcut.includes(p));
    const tohumDb = tohumSatir.find((r) => r.set_id === id);
    const arsiv = path.join(cfg.arsivKoku, id, 'kaynak.json');
    const arsivVar = d.dosyaVar(arsiv);
    k.adimlar.onkontrol = {
      durum: 'tamam', bit: iso(),
      kanit: {
        kaynak_modu: b.kaynak_modu, platformlar: satirlar.map((r) => `${r.platform}=${r.status}`),
        tohumDb: tohumDb ? tohumDb.surum : null, arsiv: arsivVar ? arsiv : null,
      },
    };
    yaz(`  ${id}: kaynak_modu=${b.kaynak_modu} · ${satirlar.map((r) => `${r.platform}=${r.status}`).join(' ') || 'platform yok'}`
      + ` · tohum db=${tohumDb ? tohumDb.surum : 'yok'} arşiv=${arsivVar ? 'var' : 'yok'}`);
    const kilit = kilitNotu(b);
    if (kilit) { yaz(`  ! ${id}: ${kilit} (bilgi; bekletmez)`); k.adimlar.onkontrol.kanit.kilit = kilit; }
    for (const r of satirlar) {
      if (r.status === 'running') yaz(`  ! ${id}: ${r.platform} şu an running — requeue sırasında ATLANIR (çalışan iş ezilmez)`);
    }
    if (!k.platformlar.length) { await durdur(k, 'onkontrol', 'istenen platform satırlarının hiçbiri yok'); continue; }
    if (!tohumDb && !arsivVar) {
      await durdur(k, 'onkontrol', 'tohum kaynak yok (kaynak_build_surumleri gecerli satırı da Mac arşivi de yok)');
    }
  }
  kaydet();
  const canli = () => idler.map((id) => durum.kitaplar[id]).filter((k) => !k.durdu);

  // 1) Kabuk eki (sırayla).
  const ekUret = o.ekUret || cfg.ekUret;
  for (const k of canli()) {
    if (bitmis(k.adimlar.ek)) { yaz(`  ✓ ${k.id}: ek önceden bitti`); continue; }
    if (o.ekAtla) { atla(k, 'ek', '--ek-atla'); continue; }
    if (k.manuel) { atla(k, 'ek', 'manuel kaynak'); continue; }
    const sonUrl = `${cfg.cdnKok}/${k.id}/son.json`;
    if (!d.dosyaVar(ekUret)) {
      const neden = `ek-uret bulunamadı: ${ekUret} (--ek-uret <yol> ya da EMPP_EK_URET; geçmek için --ek-atla)`;
      if (kuru) { yaz(`  ! ${k.id}: (1) ${neden} — gerçek koşuda kitap burada durur`); continue; }
      await durdur(k, 'ek', neden, false);
      continue;
    }
    if (kuru) { yaz(`  ${k.id}: (1) node ${ekUret} --set ${k.id} → ${sonUrl}?t=<ms> 'uretildi' kontrolü`); continue; }
    adimBasla(k, 'ek');
    const basMs = d.simdi();
    const r = await d.calistir('node', [ekUret, '--set', k.id], { zamanAsimiMs: 90 * 60000 });
    const cikti = `${r.stdout || ''}\n${r.stderr || ''}`;
    let ev = null;
    for (let deneme = 0; deneme < 3; deneme += 1) {
      let son = null;
      if (r.kod === 0) {
        const g = await d.getir(`${sonUrl}?t=${d.simdi()}`);
        if (g.kod === 200) {
          try { son = JSON.parse(g.govde); } catch (e) { d.uyar(`${k.id}: son.json JSON değil: ${e.message}`); }
        } else d.uyar(`${k.id}: son.json HTTP ${g.kod}`);
      }
      ev = ekDegerlendir({ kod: r.kod, cikti, son, baslangicMs: basMs });
      if (ev.tamam || r.kod !== 0) break;
      if (deneme < 2) await d.bekle(10000);
    }
    if (!ev.tamam) { await durdur(k, 'ek', ev.neden); continue; }
    adimBit(k, 'ek', 'tamam', { kanit: ev.kanit });
    yaz(`  ✓ ${k.id}: ek tamam (uretildi ${ev.kanit.uretildi}, girdiSha ${String(ev.kanit.girdiSha).slice(0, 12)})`);
  }

  // 2) Kaynak kur isteği (sırayla).
  for (const k of canli()) {
    if (bitmis(k.adimlar.kur)) { yaz(`  ✓ ${k.id}: kur isteği önceden atıldı (t0 ${k.adimlar.kur.kanit && k.adimlar.kur.kanit.t0})`); continue; }
    if (o.kurAtla) { atla(k, 'kur', '--kur-atla'); atla(k, 'bekle', '--kur-atla'); continue; }
    if (k.manuel) { atla(k, 'kur', 'manuel kaynak'); atla(k, 'bekle', 'manuel kaynak'); continue; }
    const y = yedekKomutu(cfg, { stamp: durum.damga, id: k.id, tablo: 'pipeline_book_summaries', etiket: 'kur' });
    if (kuru) {
      yaz(`  ${k.id}: (2) yedek: ${y.komut}`);
      yaz(`  ${k.id}: (2) SQL: ${sql.kurIstegi(k.id).replace(/\n/g, ' ')}`);
      k.kuruKurVar = true;
      continue;
    }
    adimBasla(k, 'kur');
    await yazmaAdimi(k, 'kur', async () => {
      let yedek;
      try { yedek = await db.yedek(y); } catch (e) { await durdur(k, 'kur', e.message); return; }
      const satirlar = await db.yaz(sql.kurIstegi(k.id));
      const t0 = satirlar[0];
      if (!DB_ZAMAN.test(t0 || '')) { await durdur(k, 'kur', `t0 okunamadı: ${satirlar.join(' | ')}`); return; }
      if (satirlar[1] !== '1') { await durdur(k, 'kur', `kur isteği UPDATE ${satirlar[1]} satır etkiledi (manuel/eksik?)`); return; }
      adimBit(k, 'kur', 'tamam', { kanit: { t0, yedek } });
      yaz(`  ✓ ${k.id}: kur isteği atıldı (t0=${t0}, yedek ${yedek})`);
    });
  }

  if (kuru) {
    for (const k of canli()) {
      for (const p of k.platformlar) {
        const y = yedekKomutu(cfg, { stamp: durum.damga, id: k.id, tablo: 'pipeline_platform_summaries', etiket: 'requeue' });
        yaz(`  ${k.id}: (3) ${p}: yedek ${y.dosya}; SQL: ${sql.requeue(k.id, p).replace(/\n/g, ' ')}`);
      }
      if (k.platformlar.includes('windows')) {
        const eski = await kasa.oncelikOku();
        const eskiUtf = eski === null ? '' : Buffer.from(eski, 'latin1').toString('utf8');
        const yeni = oncelikBirlestir(eskiUtf, [k.id]);
        const goster = (s) => s.trim().split(/\r?\n/).join(' | ') || 'yok';
        yaz(`  ${k.id}: (4) kasa ${cfg.oncelikDosyasi}: şimdi [${goster(eskiUtf)}] → [${goster(yeni)}] (önce .once-<damga> yedeği)`);
      }
      if (k.kuruKurVar) {
        yaz(`  ${k.id}: (5) bekle: kaynak_build_surumleri set_id=${k.id} durum='gecerli' olusturma > t0 YENİ satır `
          + `(tavan ${o.kurTavanDk} dk, 60 sn); ret = kaynak_kur_ret_at > t0`);
      }
    }
    if (o.izle) yaz(`  (6) izle: completed/failed olana kadar 2 dk aralık, tavan ${o.izleTavanSa} sa; windows yayını ${cfg.bekciLog} 'yayinlandi' satırıyla`);
    return { plan, kod: sonKod() };
  }

  // 3) Requeue HEMEN (kur isteği yazıldıktan sonra). 06.10 45550 dersi: sunucu r2-kur'u YALNIZ
  // kuyruktaki bir platform işi kiralanınca verir (book-update ajan-claim-sql.ts
  // kaynakBekleDislamasi). Satırlar completed iken kur isteği tek başına hiçbir şey başlatmaz.
  // İstek önce yazıldığı için kaynak-kur yeteneği olmayan ajan (kasa) işi almaz, bekler (b);
  // yeteneği olan (ProBook) alır ve kurar.
  for (const k of canli().filter((x) => bitmis(x.adimlar.kur) && !bitmis(x.adimlar.requeue))) {
    await yazmaAdimi(k, 'requeue', () => requeueAdimi(k));
  }
  // 4) Kasa imza önceliği.
  for (const k of canli().filter((x) => bitmis(x.adimlar.requeue) && !bitmis(x.adimlar.oncelik))) {
    await yazmaAdimi(k, 'oncelik', () => oncelikAdimi(k));
  }

  // 5-6) Yeni build satırını bekle (bilgi + ret yakalama) ve izle (paralel).
  const kurTavanMs = o.kurTavanDk * 60000;
  const izleTavanMs = o.izleTavanSa * 3600000;
  let sonIzleMs = -Infinity;
  for (;;) {
    const bekleyen = canli().filter((k) => bitmis(k.adimlar.kur) && !bitmis(k.adimlar.bekle));
    if (bekleyen.length) {
      const bIdler = bekleyen.map((k) => k.id);
      const okunan = await olcum('bekle ölçümü', async () => ({
        kitaplar: await db.oku(sql.kitaplar(bIdler)),
        surumler: await db.oku(sql.tohum(bIdler)),
      }));
      const satir = new Map(((okunan && okunan.kitaplar) || []).map((r) => [r.book_id, r]));
      for (const k of bekleyen) {
        if (!k.adimlar.bekle || k.adimlar.bekle.durum !== 'suruyor') adimBasla(k, 'bekle');
        const tavanDoldu = d.simdi() - k.adimlar.bekle.basMs > kurTavanMs;
        const tavanNedeni = (not) => `kaynak kurulumu ${o.kurTavanDk} dk içinde bitmedi (eylemsiz duruldu)${not ? ` — ${not}` : ''}`;
        if (!okunan) {
          if (tavanDoldu) await durdur(k, 'bekle', tavanNedeni('son ölçüm atlandı'), true, CIKIS.KUR_TAVAN);
          continue;
        }
        const ev = kurDegerlendir(satir.get(k.id), okunan.surumler.filter((s) => s.set_id === k.id), k.adimlar.kur.kanit.t0);
        if (ev.not && k.adimlar.bekle.not !== ev.not) { k.adimlar.bekle.not = ev.not; d.uyar(`${k.id}: ${ev.not}`); }
        if (ev.durum === 'bitti') {
          adimBit(k, 'bekle', 'tamam', { kanit: { surum: ev.surum, kaynak: ev.kaynak, olusturma: ev.olusturma } });
          yaz(`  ✓ ${k.id}: yeni kaynak geçerli (sürüm ${ev.surum}, kaynak ${ev.kaynak || '?'}, oluşturma ${ev.olusturma})`);
        } else if (ev.durum === 'ret') {
          // ret > istek iken claim SQL'i (kaynakBekleDislamasi) geçerli build varsa iki ajanı da
          // bekletir: kasa (b) istek > geçerli olusturma, ProBook (e) ret > istek. Kuyruğa alınan
          // satırlar eski kaynakla ÜRETİLMEZ, asılı kalır. Karar insanın: yeni istek ya da geri alma.
          await durdur(k, 'bekle', `kaynak kurulumu REDDEDİLDİ (${ev.zaman}): ${ev.nedenler.join(' · ').slice(0, 260)}`
            + ` — kuyruktaki ${k.platformlar.join(',')} satırları asılı kalır (eski kaynakla üretilmez);`
            + ' karar: düzeltip yeni kur isteği ya da requeue yedeğinden geri al');
        } else if (ev.durum === 'hata') {
          await durdur(k, 'bekle', ev.neden);
        } else if (tavanDoldu) {
          await durdur(k, 'bekle', tavanNedeni(ev.not), true, CIKIS.KUR_TAVAN);
        }
      }
      kaydet();
    }

    let izlemeSuruyor = false;
    if (o.izle) {
      const izlenen = canli().filter((k) => bitmis(k.adimlar.requeue) && !bitmis(k.adimlar.izle));
      if (izlenen.length && d.simdi() - sonIzleMs >= 120000) {
        sonIzleMs = d.simdi();
        await izleTuru(izlenen);
      }
      izlemeSuruyor = canli().some((k) => bitmis(k.adimlar.requeue) && !bitmis(k.adimlar.izle));
    }
    const kurSuruyor = canli().some((k) => bitmis(k.adimlar.kur) && !bitmis(k.adimlar.bekle));
    if (!kurSuruyor && !izlemeSuruyor) break;
    await d.bekle(kurSuruyor ? 60000 : 120000);
  }

  const ozet = ozetMetni(durum, idler);
  yaz(`ÖZET: ${ozet}`);
  if (o.izle) await bildir(ozet, 'Set yenileme bitti');
  kaydet();
  return { plan, kod: sonKod(), ozet };

  // ── iç adımlar ──
  async function requeueAdimi(k) {
    adimBasla(k, 'requeue');
    const sonuc = { ...((k.adimlar.requeue && k.adimlar.requeue.platformlar) || {}) };
    const satirlar = await db.oku(sql.platformlar([k.id], k.platformlar));
    let yedek = null;
    for (const p of k.platformlar) {
      if (sonuc[p] && sonuc[p].durum === 'tamam') continue;
      const r = satirlar.find((x) => x.platform === p);
      if (!r) { sonuc[p] = { durum: 'atlandi', neden: 'satır yok' }; continue; }
      if (r.status === 'running') {
        sonuc[p] = { durum: 'atlandi', neden: 'running — çalışan iş ezilmedi' };
        d.uyar(`${k.id}: ${p} running — requeue ATLANDI`);
        continue;
      }
      if (!yedek) {
        try {
          const etiket = `requeue-${damga(d.simdi()).slice(9)}`;
          yedek = await db.yedek(yedekKomutu(cfg, { stamp: durum.damga, id: k.id, tablo: 'pipeline_platform_summaries', etiket }));
        } catch (e) { k.adimlar.requeue.platformlar = sonuc; await durdur(k, 'requeue', e.message); return; }
      }
      const cikti = await db.yaz(sql.requeue(k.id, p));
      if (cikti[cikti.length - 1] === '1') {
        sonuc[p] = { durum: 'tamam', zaman: iso(), zamanMs: d.simdi(), yedek };
        yaz(`  ✓ ${k.id}: ${p} kuyruğa alındı`);
      } else {
        sonuc[p] = { durum: 'atlandi', neden: `UPDATE ${cikti.join(' ')} satır (arada running olmuş olabilir)` };
        d.uyar(`${k.id}: ${p} requeue 0 satır — atlandı`);
      }
    }
    const herhangi = Object.values(sonuc).some((s) => s.durum === 'tamam');
    adimBit(k, 'requeue', herhangi ? 'tamam' : 'atlandi', { platformlar: sonuc });
  }

  async function oncelikAdimi(k) {
    const w = k.adimlar.requeue.platformlar && k.adimlar.requeue.platformlar.windows;
    if (!w || w.durum !== 'tamam') { atla(k, 'oncelik', 'windows kuyruğa alınmadı'); kaydet(); return; }
    adimBasla(k, 'oncelik');
    for (let deneme = 0; deneme < 2; deneme += 1) {
      const eski = await kasa.oncelikOku();
      const eskiBayt = eski === null ? null : Buffer.from(eski, 'latin1');
      const yeni = oncelikBirlestir(eskiBayt ? eskiBayt.toString('utf8') : '', [k.id]);
      const yeniBayt = Buffer.from(yeni, 'utf8');
      if (eskiBayt && eskiBayt.equals(yeniBayt)) {
        adimBit(k, 'oncelik', 'tamam', { kanit: { zaten: true } });
        yaz(`  ✓ ${k.id}: kasa imza önceliği zaten başta`);
        return;
      }
      const yedekYol = `${cfg.oncelikDosyasi}.once-${damga(d.simdi())}`;
      const betik = oncelikPs({
        yol: cfg.oncelikDosyasi, yedekYol,
        eskiB64: eskiBayt ? eskiBayt.toString('base64') : null, yeniB64: yeniBayt.toString('base64'),
      });
      const r = await kasa.ps(`set-yenile-oncelik-${durum.damga}-${k.id}`, betik);
      if (r.kod === 0 && /TAMAM/.test(r.stdout || '')) {
        adimBit(k, 'oncelik', 'tamam', { kanit: { yedek: eskiBayt ? yedekYol : null, ilkSatirlar: yeni.split('\r\n').slice(0, 5) } });
        yaz(`  ✓ ${k.id}: kasa imza önceliği başa eklendi`);
        return;
      }
      if (r.kod === 4) { d.uyar(`${k.id}: öncelik dosyası arada değişti — yeniden okunuyor`); continue; }
      await durdur(k, 'oncelik', `kasa betiği başarısız (çıkış ${r.kod}): ${String(r.stdout || '').trim().slice(-160)} ${sshGurultusuz(r.stderr).slice(-160)}`);
      return;
    }
    await durdur(k, 'oncelik', 'öncelik dosyası iki denemede de arada değişti');
  }

  async function izleTuru(izlenen) {
    const ids = izlenen.map((k) => k.id);
    const tum = [...new Set(izlenen.flatMap((k) => k.platformlar))];
    const satirlar = await olcum('izleme ölçümü', () => db.oku(sql.platformlar(ids, tum)));
    if (!satirlar) {
      // Ölçüm atlandı: durum değişmez, yalnız izleme tavanı işler.
      for (const k of izlenen) {
        const iz = k.adimlar.izle;
        if (iz && iz.basMs !== undefined && d.simdi() - iz.basMs > izleTavanMs) {
          adimBit(k, 'izle', 'atlandi', { neden: `izleme tavanı ${o.izleTavanSa} sa doldu (son ölçüm atlandı)` });
        }
      }
      return;
    }
    let yayinMetni = null;
    let yayinOkundu = false;
    for (const k of izlenen) {
      if (!k.adimlar.izle || k.adimlar.izle.durum !== 'suruyor') adimBasla(k, 'izle');
      const iz = k.adimlar.izle;
      iz.platformlar = iz.platformlar || {};
      const rq = k.adimlar.requeue.platformlar;
      for (const p of Object.keys(rq).filter((x) => rq[x].durum === 'tamam')) {
        const onceki = iz.platformlar[p];
        if (onceki && ['yayinlandi', 'uretildi-bitti', 'basarisiz'].includes(onceki.durum)) continue;
        const r = satirlar.find((x) => x.book_id === k.id && x.platform === p);
        const st = r ? r.status : null;
        if (st === 'failed') iz.platformlar[p] = { durum: 'basarisiz', zaman: r.last_run_at };
        else if (st === 'completed') {
          if (p !== 'windows') iz.platformlar[p] = { durum: 'uretildi-bitti', zaman: r.last_run_at, sonuc: r.last_result };
          else {
            // Windows "completed" = üretildi; yayın imza bekçisinden SONRA olur (bekçi logu).
            if (!yayinOkundu) { yayinMetni = await olcum('bekçi logu ölçümü', () => kasa.yayinSatirlari()); yayinOkundu = true; }
            // Log okunamadıysa (null) yayın bilinmiyor: 'uretildi' kalır, sonraki turda yeniden bakılır.
            const y = yayinMetni === null ? null : yayinBul(yayinMetni, k.id, rq[p].zamanMs);
            iz.platformlar[p] = y ? { durum: 'yayinlandi', surum: y.surum, zaman: y.zaman } : { durum: 'uretildi', zaman: r.last_run_at };
          }
        } else iz.platformlar[p] = { durum: 'suruyor', status: st, faz: r ? r.current_phase : null, ilerleme: r ? r.progress : null };
      }
      const acik = Object.values(iz.platformlar).some((v) => ['suruyor', 'uretildi'].includes(v.durum));
      if (!acik) adimBit(k, 'izle', 'tamam');
      else if (d.simdi() - iz.basMs > izleTavanMs) adimBit(k, 'izle', 'atlandi', { neden: `izleme tavanı ${o.izleTavanSa} sa doldu` });
    }
    kaydet();
  }
}

function ozetMetni(durum, idler) {
  const ad = {
    yayinlandi: 'yayınlandı', 'uretildi-bitti': 'üretildi', uretildi: 'üretildi, yayın bekliyor (imza bekçisi)',
    basarisiz: 'BAŞARISIZ', suruyor: 'sürüyor',
  };
  return idler.map((id) => {
    const k = durum.kitaplar[id];
    if (k.durdu) return `${id}: DURDU (${k.durdu.adim}: ${String(k.durdu.neden).slice(0, 80)})`;
    const rq = (k.adimlar.requeue && k.adimlar.requeue.platformlar) || {};
    const iz = (k.adimlar.izle && k.adimlar.izle.platformlar) || {};
    const parca = Object.keys(rq).map((p) => {
      if (rq[p].durum !== 'tamam') return `${p} atlandı (${rq[p].neden})`;
      return `${p} ${iz[p] ? ad[iz[p].durum] || iz[p].durum : 'kuyrukta'}`;
    });
    return `${id}: ${parca.join(', ') || 'requeue yok'}`;
  }).join(' · ');
}

// ─── Varsayılan bağımlılıklar (IO) ────────────────────────────────────────────────────────

function varsayilanBag() {
  return {
    calistir(cmd, args, { girdi, zamanAsimiMs = 90000, kodlama = 'utf8' } = {}) {
      return new Promise((coz) => {
        const c = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
        const out = []; const err = [];
        let bitti = false;
        const zam = setTimeout(() => {
          if (!bitti) { err.push(Buffer.from(`\nzaman aşımı ${zamanAsimiMs} ms`)); c.kill('SIGTERM'); }
        }, zamanAsimiMs);
        c.stdout.on('data', (b) => out.push(b));
        c.stderr.on('data', (b) => err.push(b));
        c.on('error', (e) => { if (bitti) return; bitti = true; clearTimeout(zam); coz({ kod: -1, stdout: '', stderr: String(e.message) }); });
        c.on('close', (kod) => {
          if (bitti) return;
          bitti = true; clearTimeout(zam);
          coz({ kod: kod === null ? -1 : kod, stdout: Buffer.concat(out).toString(kodlama), stderr: Buffer.concat(err).toString(kodlama) });
        });
        c.stdin.on('error', (e) => { err.push(Buffer.from(`\nstdin: ${e.message}`)); });
        if (girdi != null) c.stdin.end(girdi); else c.stdin.end();
      });
    },
    getir(url) {
      return new Promise((coz) => {
        const r = https.get(url, { headers: { 'User-Agent': TARAYICI_UA, 'Cache-Control': 'no-cache' }, timeout: 20000 }, (res) => {
          const p = [];
          res.on('data', (b) => p.push(b));
          res.on('end', () => coz({ kod: res.statusCode, govde: Buffer.concat(p).toString('utf8') }));
        });
        r.on('timeout', () => r.destroy(new Error('zaman aşımı')));
        r.on('error', (e) => coz({ kod: -1, govde: String(e.message) }));
      });
    },
    simdi: () => Date.now(),
    bekle: (ms) => new Promise((c) => setTimeout(c, ms)),
    dosyaVar: (y) => fs.existsSync(y),
    dosyaOku: (y) => fs.readFileSync(y, 'utf8'),
    dosyaYaz(y, metin) {
      fs.mkdirSync(path.dirname(y), { recursive: true });
      const g = `${y}.${process.pid}.yaziliyor`;
      fs.writeFileSync(g, metin);
      fs.renameSync(g, y);
    },
    geciciYaz(ad, icerik) {
      const dz = fs.mkdtempSync(path.join(os.tmpdir(), 'set-yenile-'));
      const y = path.join(dz, ad);
      fs.writeFileSync(y, icerik);
      return y;
    },
    log: (...a) => console.log(...a),
    uyar: (...a) => console.error('UYARI:', ...a),
  };
}

const KULLANIM = 'kullanım: set-yenile.js <bookId...> [--platform windows,pardus] [--uygula] [--izle] '
  + '[--ek-atla] [--kur-atla] [--devam <durum.json>] [--ek-uret <yol>] [--kur-tavan <dk>] [--izle-tavan <sa>]';

async function ana(argv = process.argv.slice(2), d = varsayilanBag(), cfg = ayarlar()) {
  const o = argAyristir(argv);
  if (o.hata) { d.uyar(o.hata); d.log(KULLANIM); return CIKIS.KULLANIM; }
  let durum; let durumYolu;
  if (o.devam) {
    durumYolu = path.resolve(o.devam);
    durum = JSON.parse(d.dosyaOku(durumYolu));
    if (!durum || !durum.kitaplar || !/^\d{8}-\d{6}$/.test(durum.damga || '')) throw new Error(`durum dosyası geçersiz: ${durumYolu}`);
    for (const id of Object.keys(durum.kitaplar)) idDogrula(id);
    if (!o.platformVerildi && durum.secenekler && Array.isArray(durum.secenekler.platformlar)) {
      o.platformlar = durum.secenekler.platformlar.map(platformDogrula);
    }
  } else {
    const stamp = damga(d.simdi());
    durum = yeniDurum(o, stamp);
    durum.olusturma = new Date(d.simdi()).toISOString();
    durumYolu = path.join(cfg.durumDizini, `${stamp}.json`);
  }
  for (const id of o.idler) kitapDurumu(durum, id);
  durum.sira = [...new Set([...(durum.sira || []), ...o.idler, ...Object.keys(durum.kitaplar)])];
  const r = await yurut(o, cfg, d, durum, durumYolu);
  if (o.uygula) d.log(`durum dosyası: ${durumYolu}`);
  return r.kod;
}

module.exports = {
  CIKIS, IZINLI_PLATFORMLAR, ayarlar, argAyristir, sql, yedekKomutu, yedekDogrulandiMi, tsvAyristir, dbZaman,
  dbSonra, retNedenleri, kurDegerlendir, kilitNotu, ekSonucAyristir, ekDegerlendir, oncelikBirlestir, oncelikPs,
  yayinBul, damga, baglantiHatasiMi, srv21Istemci, kasaIstemci, yeniDurum, kitapDurumu, yurut,
  ozetMetni, varsayilanBag, ana,
};

if (require.main === module) {
  ana().then((kod) => { process.exitCode = kod; }, (e) => {
    console.error('set-yenile HATA:', e && e.stack ? e.stack : e);
    process.exitCode = 1;
  });
}

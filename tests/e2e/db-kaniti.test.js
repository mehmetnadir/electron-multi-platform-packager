'use strict';
/**
 * db-kaniti.js — pipeline-sql (ssh sarmalayıcı) ile book-update DB'sinden dosya kanıtı okuma.
 * Koşu: npm run test:e2e   (tests/e2e/*.test.js glob'u)
 *
 * ssh/pipeline-sql GERÇEK ÇALIŞMAZ — `calistirSsh` her testte SAHTELENİR (bkz. dbDosyaKanitiOku
 * ikinci parametresi). Gerçek ağ/ssh hiçbir birim testte koşmaz.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  dogrulaTanimlayici,
  pipelineSqlKomutu,
  dbSonucuAyristir,
  dbDosyaKanitiOku,
  SSH_HEDEF,
  SSH_PORT,
} = require('./adimlar/db-kaniti');

const SHA = 'c'.repeat(64);

test('dogrulaTanimlayici: harf/rakam/-/_ kabul edilir', () => {
  assert.equal(dogrulaTanimlayici('45482', 'kitapId'), '45482');
  assert.equal(dogrulaTanimlayici('android', 'platform'), 'android');
  assert.equal(dogrulaTanimlayici('sm2-set_1', 'kitapId'), 'sm2-set_1');
});

test('dogrulaTanimlayici: tırnak/boşluk/noktalı virgül İÇEREN girdi REDDEDİLİR (SQL enjeksiyonu önlemi)', () => {
  assert.throws(() => dogrulaTanimlayici("45482' OR '1'='1", 'kitapId'), /geçersiz/);
  assert.throws(() => dogrulaTanimlayici('android; DROP TABLE x', 'platform'), /geçersiz/);
  assert.throws(() => dogrulaTanimlayici('', 'kitapId'), /geçersiz/);
  assert.throws(() => dogrulaTanimlayici(null, 'kitapId'), /geçersiz/);
});

test('pipelineSqlKomutu: SELECT metni + ssh hedefi kullanılabilir tam komut üretir', () => {
  const { sql, komut } = pipelineSqlKomutu('45482', 'android');
  assert.equal(
    sql,
    "SELECT file_sha256,file_size_bytes FROM pipeline_platform_summaries WHERE book_id='45482' AND platform='android'",
  );
  assert.equal(komut, `pipeline-sql "${sql}"`);
  // parola/anahtar hiçbir yerde YOK — yalnız SELECT metni + sabit hedef.
  assert.doesNotMatch(komut, /pass|secret|token/i);
  assert.equal(SSH_HEDEF, 'root@100.117.187.26');
  assert.equal(SSH_PORT, '2222');
});

test('pipelineSqlKomutu: geçersiz kitapId/platform SQL komutunun kurulmasını ENGELLER', () => {
  assert.throws(() => pipelineSqlKomutu("45482'; --", 'android'));
  assert.throws(() => pipelineSqlKomutu('45482', 'android; --'));
});

test('dbSonucuAyristir: başlık + tek veri satırı (mysql batch TAB) → {sha256, boyut}', () => {
  const stdout = `file_sha256\tfile_size_bytes\n${SHA}\t1073741824\n`;
  assert.deepEqual(dbSonucuAyristir(stdout), { sha256: SHA, boyut: 1073741824 });
});

test('dbSonucuAyristir: büyük harfli sha256 küçük harfe normalize edilir', () => {
  const stdout = `file_sha256\tfile_size_bytes\n${SHA.toUpperCase()}\t100\n`;
  assert.deepEqual(dbSonucuAyristir(stdout), { sha256: SHA, boyut: 100 });
});

test('dbSonucuAyristir: yalnız başlık (satır yok — book_id/platform eşleşmedi) → null', () => {
  assert.equal(dbSonucuAyristir('file_sha256\tfile_size_bytes\n'), null);
});

test('dbSonucuAyristir: boş stdout → null', () => {
  assert.equal(dbSonucuAyristir(''), null);
  assert.equal(dbSonucuAyristir(undefined), null);
});

test('dbSonucuAyristir: NULL/NULL (migration uygulanmamış ya da ajan henüz kanıt göndermedi) → null', () => {
  assert.equal(dbSonucuAyristir('file_sha256\tfile_size_bytes\nNULL\tNULL\n'), null);
});

test('dbSonucuAyristir: 63 karakterli (bozuk) sha256 → null (format bozuk, güvenilmez)', () => {
  assert.equal(dbSonucuAyristir(`file_sha256\tfile_size_bytes\n${'c'.repeat(63)}\t10\n`), null);
});

test('dbSonucuAyristir: boyut 0 ya da sayısal olmayan → null', () => {
  assert.equal(dbSonucuAyristir(`file_sha256\tfile_size_bytes\n${SHA}\t0\n`), null);
  assert.equal(dbSonucuAyristir(`file_sha256\tfile_size_bytes\n${SHA}\tabc\n`), null);
});

test('dbDosyaKanitiOku: sahte ssh başarı → {sha256, boyut}, GERÇEK ssh/pipeline-sql koşmaz', async () => {
  let cagrildiKomut = null;
  const sahteSsh = (komut) => {
    cagrildiKomut = komut;
    return { status: 0, stdout: `file_sha256\tfile_size_bytes\n${SHA}\t555\n`, stderr: '' };
  };
  const r = await dbDosyaKanitiOku('45482', 'android', { calistirSsh: sahteSsh });
  assert.deepEqual(r, { sha256: SHA, boyut: 555 });
  assert.match(cagrildiKomut, /^pipeline-sql "SELECT/);
  assert.match(cagrildiKomut, /book_id='45482'/);
  assert.match(cagrildiKomut, /platform='android'/);
});

test('dbDosyaKanitiOku: ssh çıkış kodu != 0 → hata fırlatır, stderr mesajda (parola İÇERMEZ)', async () => {
  const sahteSsh = () => ({ status: 255, stdout: '', stderr: 'ssh: connect timed out' });
  await assert.rejects(
    () => dbDosyaKanitiOku('45482', 'android', { calistirSsh: sahteSsh }),
    /pipeline-sql çıkış 255/,
  );
});

test('dbDosyaKanitiOku: ssh spawn hatası (r.error) → olduğu gibi fırlatılır (sessiz yutma yok)', async () => {
  const spawnHata = new Error('spawnSync ssh ENOENT');
  const sahteSsh = () => ({ error: spawnHata });
  await assert.rejects(() => dbDosyaKanitiOku('45482', 'android', { calistirSsh: sahteSsh }), /ENOENT/);
});

test('dbDosyaKanitiOku: satır yok (kayıt bulunamadı) → null döner, FIRLATMAZ', async () => {
  const sahteSsh = () => ({ status: 0, stdout: 'file_sha256\tfile_size_bytes\n', stderr: '' });
  const r = await dbDosyaKanitiOku('45482', 'android', { calistirSsh: sahteSsh });
  assert.equal(r, null);
});

test('dbDosyaKanitiOku: kitapId/platform geçersizse ssh HİÇ ÇAĞRILMAZ (enjeksiyon riskini erken keser)', async () => {
  let cagrildi = false;
  const sahteSsh = () => {
    cagrildi = true;
    return { status: 0, stdout: '' };
  };
  await assert.rejects(() => dbDosyaKanitiOku("45482'; DROP TABLE x; --", 'android', { calistirSsh: sahteSsh }));
  assert.equal(cagrildi, false);
});

test('varsayılan çağrı keşifle aynı yoldan: EMPP_E2E_PIPELINE_SQL verilmişse SQL o komuta gider (ssh yok)', async () => {
  const path = require('node:path');
  const fs = require('node:fs');
  const S = require('./sentetik');
  const d = S.geciciDizin('db-kaniti-env');
  const kayit = path.join(d, 'sql.txt');
  const betik = S.betikYaz(path.join(d, 'pipeline-sql-sahte'), [
    `printf '%s\\n' "$1" >> "${kayit}"`,
    `printf 'file_sha256\\tfile_size_bytes\\n${SHA}\\t4242\\n'`,
  ].join('\n'));
  const eski = process.env.EMPP_E2E_PIPELINE_SQL;
  process.env.EMPP_E2E_PIPELINE_SQL = betik;
  try {
    const r = await dbDosyaKanitiOku('74390', 'android');
    assert.deepEqual(r, { sha256: SHA, boyut: 4242 });
  } finally {
    if (eski === undefined) delete process.env.EMPP_E2E_PIPELINE_SQL;
    else process.env.EMPP_E2E_PIPELINE_SQL = eski;
  }
  const sql = fs.readFileSync(kayit, 'utf8').trim().split('\n').pop();
  assert.equal(sql, pipelineSqlKomutu('74390', 'android').sql, 'komut değil, çıplak SQL gitmeli');
});

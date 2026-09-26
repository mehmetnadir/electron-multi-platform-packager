'use strict';
/**
 * DB DOSYA KANITI — book-update `pipeline_platform_summaries.file_sha256`/`file_size_bytes`
 * (migration 024_dosya_kaniti.sql) okunur; `paket-denetle.js`'in yeni 'db-kanit' adımı bunu
 * CDN nesnesiyle kıyaslayıp T2 "CDN'deki paket bizim ürettiğimiz mi?" sorusunu cevaplar.
 *
 * Okuma YALNIZ salt-okur `pipeline-sql` sarmalayıcısı üzerinden (srv21, `/root/.pipeline-db.cnf`
 * ile — parola hiçbir çıktıya/loga basılmaz): `ssh -p 2222 root@100.117.187.26
 * 'pipeline-sql "SELECT …"'`. Tek sorgu, yalnız SELECT (memory: pipeline-db-sorgusu-pipeline-sql).
 *
 * Bağımlılık enjeksiyonu: `calistirSsh` parametresi test'lerde SAHTE ssh/pipeline-sql ile
 * değiştirilir — gerçek ağ/ssh hiçbir birim testte koşmaz.
 */
const O = require('./ortak');

const SSH_PORT = '2222';
const SSH_HEDEF = 'root@100.117.187.26';
const TANIMLAYICI_DESENI = /^[A-Za-z0-9_-]{1,128}$/;

/** book_id/platform yalnız harf/rakam/-/_ — SQL'e gömülmeden ÖNCE doğrulanır (enjeksiyon yok). */
function dogrulaTanimlayici(deger, adAlan) {
  const s = String(deger == null ? '' : deger);
  if (!TANIMLAYICI_DESENI.test(s)) {
    throw new Error(`${adAlan} geçersiz (yalnız harf/rakam/-/_ kabul edilir): ${JSON.stringify(deger)}`);
  }
  return s;
}

/** Çalıştırılacak SQL + tam `pipeline-sql "…"` komut metni. SAF. */
function pipelineSqlKomutu(kitapId, platform) {
  const b = dogrulaTanimlayici(kitapId, 'kitapId');
  const p = dogrulaTanimlayici(platform, 'platform');
  const sql = `SELECT file_sha256,file_size_bytes FROM pipeline_platform_summaries WHERE book_id='${b}' AND platform='${p}'`;
  return { sql, komut: `pipeline-sql "${sql}"` };
}

/**
 * `pipeline-sql` batch çıktısını ayrıştırır: başlık satırı + tek veri satırı, TAB ayraçlı
 * (mysql `-B`/batch varsayılanı). Satır yok / NULL / bozuk format → `null` (OLCULEMEDI —
 * "kanıt yok" demek, "paket yanlış" demek DEĞİL). SAF.
 */
function dbSonucuAyristir(stdout) {
  const satirlar = String(stdout || '')
    .split('\n')
    .map((s) => s.replace(/\r$/, ''))
    .filter((s) => s.length > 0);
  if (satirlar.length < 2) return null; // yalnız başlık ya da hiç satır — kayıt yok
  const veri = satirlar[satirlar.length - 1].split('\t');
  const [shaHam, boyutHam] = veri;
  if (!shaHam || shaHam === 'NULL' || !boyutHam || boyutHam === 'NULL') return null;
  if (!/^[0-9a-f]{64}$/i.test(shaHam)) return null;
  const boyut = Number(boyutHam);
  if (!Number.isFinite(boyut) || boyut <= 0) return null;
  return { sha256: shaHam.toLowerCase(), boyut };
}

/**
 * Gerçek çağrı (varsayılan) — `O.calistir` (spawnSync sarmalı, ≤120sn). Girdi keşfiyle
 * (`kesif.js` `varsayilanCalistir`) AYNI ortam anahtarları: `EMPP_E2E_PIPELINE_SQL` verilmişse
 * o komut SQL'le çağrılır (testlerin sahte pipeline-sql'i — ağ yok), `EMPP_E2E_SRV21` /
 * `EMPP_E2E_SRV21_PORT` ssh hedefini değiştirir. Keşfin bulduğu kitap/platform db-kanit'e
 * gittiğinde iki okuma aynı yoldan geçer (2026-09-26, e2e-baglama × yukleme-kaniti).
 */
function varsayilanSshCalistir(komut, { zamanAsimiMs = 20000, sql = null, env = process.env } = {}) {
  if (env.EMPP_E2E_PIPELINE_SQL && sql) {
    return O.calistir(env.EMPP_E2E_PIPELINE_SQL, [sql], { timeout: zamanAsimiMs });
  }
  return O.calistir(
    'ssh',
    ['-o', 'ConnectTimeout=10', '-o', 'BatchMode=yes', '-p', env.EMPP_E2E_SRV21_PORT || SSH_PORT,
      env.EMPP_E2E_SRV21 || SSH_HEDEF, komut],
    { timeout: zamanAsimiMs },
  );
}

/**
 * book_id + platform için DB'deki dosya kanıtını okur.
 * @param {string} kitapId
 * @param {string} platform
 * @param {{calistirSsh?: Function}} [secenek] `calistirSsh` testlerde sahtelenir.
 * @returns {Promise<{sha256:string, boyut:number}|null>}
 */
async function dbDosyaKanitiOku(kitapId, platform, secenek = {}) {
  const calistirSsh = secenek.calistirSsh || varsayilanSshCalistir;
  const { komut, sql } = pipelineSqlKomutu(kitapId, platform);
  const r = await calistirSsh(komut, { sql });
  if (r && r.error) throw r.error;
  if (r && r.status !== 0) {
    // stderr parola İÇERMEZ (pipeline-sql --defaults-extra-file ile) — olduğu gibi loglanabilir.
    throw new Error(`pipeline-sql çıkış ${r.status}: ${String(r.stderr || '').slice(0, 300)}`);
  }
  return dbSonucuAyristir(r ? r.stdout : '');
}

module.exports = {
  dogrulaTanimlayici,
  pipelineSqlKomutu,
  dbSonucuAyristir,
  dbDosyaKanitiOku,
  SSH_PORT,
  SSH_HEDEF,
};

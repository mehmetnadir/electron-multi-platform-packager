'use strict';
/**
 * GİRDİ KEŞFİ + SALT-OKUMA CANLI KAYITLAR — `--url`/`--paket` verilmediğinde koşucu girdilerini
 * kendisi bulur; adımlar (runner-is-kaydi, uretim-yeri, kabul-kapisi, t5-*) aynı kaydı okur.
 *
 *   pipeline   srv21 `pipeline-sql` (ssh -p 2222, Tailscale) — pipeline_platform_summaries satırları
 *              + kiralayan ajanın adı (build_agents). YALNIZ SELECT; DB'ye yazmaz, kuyruğa almaz.
 *              pipeline-sql davranışı (ölçüldü 26.09): satır varsa rc 0 + başlıklı TSV · 0 satır
 *              rc 1 + boş çıktı · SQL hatası rc 0 + stdout'ta "ERROR <kod>".
 *   CDN        r2_object_key → https://cdn.ydspublishing.com/<urlencode(key)> (probook-teslim.sh ile aynı)
 *   ProBook    build_agents'ta ProBook şerit ajanı (tools/probook/kaydol.js varsayılanı `probook-serit`)
 *   Windows    runner Windows şeridinin iş kanıtı ~/.empp-agent/windows-kanit/<id>/<surum>.json
 *   kapılar    canlı ajan ortamı (~/.empp-agent/run-agent.sh) — yalnız beyaz listedeki bayrak adları
 *              okunur; sır taşıyan satırlar hiç ayrıştırılmaz.
 *
 * Test enjeksiyonu (ağ yok): `EMPP_E2E_PIPELINE_SQL=<betik>` (SQL tek argüman, pipeline-sql gibi
 * davranır) ya da `kesfet({calistir})`. Diğer yollar: EMPP_E2E_SRV21 · EMPP_E2E_SRV21_PORT ·
 * EMPP_E2E_WIN_KANIT · EMPP_E2E_RUN_AGENT. Bağımlılık: yalnız Node stdlib.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const O = require('./ortak');

const SRV21 = 'root@100.117.187.26';
const SRV21_PORT = '2222';
const CDN_KOK = 'https://cdn.ydspublishing.com';
const PAKET_PLATFORMLARI = Object.freeze(['windows', 'pardus', 'mac', 'android']);
const PROBOOK_AJANI = 'probook-serit';
/** Canlı ajan ortamından okunacak bayraklar (başka satır ayrıştırılmaz — sır sızmaz). */
const KAPI_ADLARI = Object.freeze([
  'AGENT_CAPS',
  'EMPP_RUNNER_WINDOWS',
  'EMPP_PROBOOK_SERIT',
  'EMPP_ICERIK_GUNCELLEME',
  'EMPP_SET_GUNCELLEME',
  'KABUL_CDP',
  'KABUL_AYRI_EV',
  'EMPP_PARDUS_KABUL',
  'EMPP_BASLIKSIZ_KABUL',
  'EMPP_BASLIKSIZ_KABUL_PLATFORMLAR',
]);

function kitapDogrula(kitap) {
  const k = String(kitap);
  if (!/^\d{1,10}$/.test(k)) throw new Error(`kitap kimliği sayı olmalı: ${JSON.stringify(k)}`);
  return k;
}

function platformSql(kitap) {
  const k = kitapDogrula(kitap);
  return (
    'SELECT p.platform, p.status, p.r2_object_key, p.last_run_at, p.last_queued_at, ' +
    'p.build_method, a.name AS ajan, p.file_size_bytes, p.integrity_status ' +
    'FROM pipeline_platform_summaries p LEFT JOIN build_agents a ' +
    'ON a.agent_id COLLATE utf8mb4_general_ci = p.leased_by_agent COLLATE utf8mb4_general_ci ' +
    `WHERE p.book_id = '${k}' AND p.deleted_at IS NULL`
  );
}

const PROBOOK_SQL =
  'SELECT name, hostname, status, last_seen_at, revoked FROM build_agents ' +
  `WHERE name = '${PROBOOK_AJANI}' OR name LIKE '%probook%'`;

/** mysql TSV çıktısı → nesne dizisi (`NULL` → null). Saf. */
function tsvAyristir(metin) {
  const satirlar = String(metin || '')
    .split('\n')
    .map((s) => s.replace(/\r$/, ''))
    .filter((s) => s.length);
  if (!satirlar.length) return [];
  const basliklar = satirlar[0].split('\t');
  return satirlar.slice(1).map((s) => {
    const d = s.split('\t');
    const o = {};
    basliklar.forEach((b, i) => {
      const v = d[i];
      o[b] = v === undefined || v === 'NULL' ? null : v;
    });
    return o;
  });
}

/** Uzak kabuk `pipeline-sql "<sql>"` çift tırnağı içinde koşar: kaçış gerektiren karakter yasak. */
function sqlGuvenliMi(sql) {
  return !/["$`\\\n]/.test(sql);
}

function varsayilanCalistir(sql, env = process.env) {
  if (env.EMPP_E2E_PIPELINE_SQL)
    return O.calistir(env.EMPP_E2E_PIPELINE_SQL, [sql], { timeout: 60000 });
  return O.calistir(
    'ssh',
    [
      '-o',
      'ConnectTimeout=10',
      '-o',
      'BatchMode=yes',
      '-p',
      env.EMPP_E2E_SRV21_PORT || SRV21_PORT,
      env.EMPP_E2E_SRV21 || SRV21,
      `pipeline-sql "${sql}"`,
    ],
    { timeout: 60000 },
  );
}

/** Tek SELECT. → {durum:'tamam', satirlar} | {durum:'hata', sebep}. Parola/çıktı gövdesi basılmaz. */
function pipelineSorgu(sql, { calistir = varsayilanCalistir, env = process.env } = {}) {
  if (!sqlGuvenliMi(sql)) return { durum: 'hata', sebep: 'SQL kaçış gerektiren karakter içeriyor' };
  let r;
  try {
    r = calistir(sql, env);
  } catch (e) {
    return { durum: 'hata', sebep: `çağrı atıldı: ${e.message}` };
  }
  if (!r || r.error) {
    const e = r && r.error;
    return {
      durum: 'hata',
      sebep: `ssh/pipeline-sql çalışmadı: ${(e && (e.code || e.message)) || 'sonuç yok'}`,
    };
  }
  const out = String(r.stdout || '');
  const err = String(r.stderr || '').trim();
  const hata = /^ERROR \d+.*$/m.exec(out) || /^ERROR \d+.*$/m.exec(err);
  if (hata) return { durum: 'hata', sebep: `pipeline-sql: ${hata[0].slice(0, 160)}` };
  if (r.status === 0) return { durum: 'tamam', satirlar: tsvAyristir(out) };
  if (r.status === 1 && !out.trim() && !err) return { durum: 'tamam', satirlar: [] };
  const son = err.split('\n').pop() || '';
  return {
    durum: 'hata',
    sebep: `rc=${r.status}${r.signal ? ` (${r.signal})` : ''}${son ? `: ${son.slice(0, 160)}` : ''}`,
  };
}

/** R2 anahtarı → CDN URL (Python urllib.parse.quote ile aynı: '/' korunur, !'()* kaçar). Saf. */
function cdnUrl(anahtar) {
  const kac = (s) =>
    encodeURIComponent(s).replace(
      /[!'()*]/g,
      (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
    );
  return `${CDN_KOK}/${String(anahtar).split('/').map(kac).join('/')}`;
}

/**
 * Kitabın pipeline kaydı + CDN girdileri + ProBook ajan kaydı.
 * @returns {{durum:'tamam'|'satir-yok'|'olculemedi', sebep:string|null, kitap:string,
 *   satirlar:object[], urller:{platform:string,url:string,anahtar:string}[], probook:object,
 *   komut:string}}
 */
function kesfet({ kitap, calistir, env = process.env } = {}) {
  const k = kitapDogrula(kitap);
  const komut = env.EMPP_E2E_PIPELINE_SQL
    ? `${env.EMPP_E2E_PIPELINE_SQL} "<sql>"`
    : `ssh -p ${env.EMPP_E2E_SRV21_PORT || SRV21_PORT} ${env.EMPP_E2E_SRV21 || SRV21} ` +
      'pipeline-sql "<sql>"';
  const p = pipelineSorgu(platformSql(k), { calistir, env });
  if (p.durum !== 'tamam') {
    return {
      durum: 'olculemedi',
      sebep: `pipeline okunamadı: ${p.sebep}`,
      kitap: k,
      satirlar: [],
      urller: [],
      probook: { durum: 'olculemedi', sebep: 'pipeline okunamadı' },
      komut,
    };
  }
  const urller = p.satirlar
    .filter((s) => PAKET_PLATFORMLARI.includes(s.platform) && s.r2_object_key)
    .map((s) => ({
      platform: s.platform,
      url: cdnUrl(s.r2_object_key),
      anahtar: s.r2_object_key,
    }));
  const pb = pipelineSorgu(PROBOOK_SQL, { calistir, env });
  let probook;
  if (pb.durum !== 'tamam') probook = { durum: 'olculemedi', sebep: pb.sebep };
  else {
    const etkin = pb.satirlar.filter((s) => String(s.revoked || '0') === '0');
    probook = etkin.length
      ? { durum: 'kayitli', ajanlar: etkin }
      : {
          durum: 'kayitsiz',
          sebep:
            `build_agents'ta ProBook ajanı (${PROBOOK_AJANI}) yok — kayıt sırrı bekliyor ` +
            "(tools/probook/kaydol.js, sır Nadir'de)",
        };
  }
  return {
    durum: p.satirlar.length ? 'tamam' : 'satir-yok',
    sebep: p.satirlar.length
      ? null
      : `pipeline satırı yok: ${k} (pipeline_platform_summaries, deleted_at IS NULL)`,
    kitap: k,
    satirlar: p.satirlar,
    urller,
    probook,
    komut,
  };
}

function platformSatiri(kesif, platform) {
  const l = kesif && kesif.satirlar ? kesif.satirlar : [];
  return l.find((s) => s.platform === platform) || null;
}

/** Platform satırı yoksa neden (ölçülmüş); varsa null. */
function satirYokSebebi(kesif, platform) {
  if (!kesif) return 'girdi keşfi yapılmadı';
  if (kesif.durum === 'olculemedi' || kesif.durum === 'satir-yok') return kesif.sebep;
  if (!platformSatiri(kesif, platform)) return `pipeline satırı yok: ${kesif.kitap} ${platform}`;
  return null;
}

/** "Girdi yok" gerekçesi: keşif ne buldu (argüman verilmediyse). */
function girdiYokSebebi(kesif, platformlar, ne) {
  if (!kesif) return `girdi yok: ${ne} verilmedi (--paket / --url) ve keşif kapalı`;
  if (kesif.durum !== 'tamam') return `girdi yok: ${kesif.sebep}`;
  const eksik = [];
  for (const pl of platformlar) {
    const s = platformSatiri(kesif, pl);
    if (!s) eksik.push(`${pl} satırı yok`);
    else if (!s.r2_object_key) eksik.push(`${pl} r2_object_key yok (status=${s.status || '?'})`);
  }
  return `girdi yok: ${ne} — ${eksik.join(', ') || 'uygun paket bulunamadı'} (kitap ${kesif.kitap})`;
}

/** DB zaman damgası ('YYYY-MM-DD HH:MM:SS', srv21 yerel saati) → ms. Saf. */
function dbZamani(s, tz = process.env.EMPP_E2E_DB_TZ || '+03:00') {
  if (!s) return null;
  const t = Date.parse(`${String(s).replace(' ', 'T')}${tz}`);
  return Number.isFinite(t) ? t : null;
}

/** Runner Windows şeridinin en yeni iş kanıtı (windows-serit.js kanitYaz). */
function windowsKaniti(kitap, env = process.env) {
  const dizin = path.join(
    env.EMPP_E2E_WIN_KANIT || path.join(os.homedir(), '.empp-agent', 'windows-kanit'),
    kitapDogrula(kitap),
  );
  let adlar;
  try {
    adlar = fs.readdirSync(dizin).filter((f) => /\.json$/.test(f));
  } catch (_) {
    return { dizin, kanit: null, yol: null };
  }
  const liste = [];
  for (const f of adlar) {
    try {
      const k = JSON.parse(fs.readFileSync(path.join(dizin, f), 'utf8'));
      liste.push({ yol: path.join(dizin, f), kanit: k, t: Date.parse(k.guncelleme || '') || 0 });
    } catch (_) {
      /* bozuk kanıt atlanır */
    }
  }
  liste.sort((a, b) => b.t - a.t);
  return { dizin, kanit: liste[0] ? liste[0].kanit : null, yol: liste[0] ? liste[0].yol : null };
}

/** Canlı ajan ortamındaki beyaz listeli bayraklar (son atama geçerli). */
function canliKapilar(env = process.env) {
  const dosya = env.EMPP_E2E_RUN_AGENT || path.join(os.homedir(), '.empp-agent', 'run-agent.sh');
  let metin;
  try {
    metin = fs.readFileSync(dosya, 'utf8');
  } catch (e) {
    return { dosya, hata: `okunamadı: ${e.code || e.message}`, degerler: {} };
  }
  const degerler = {};
  const re = new RegExp(
    `^\\s*export\\s+(${KAPI_ADLARI.join('|')})=("[^"]*"|'[^']*'|[^\\s#]*)`,
    'gm',
  );
  let m;
  // eslint-disable-next-line no-cond-assign
  while ((m = re.exec(metin))) degerler[m[1]] = m[2].replace(/^["']|["']$/g, '');
  return { dosya, degerler };
}

const listede = (deger, oge) =>
  String(deger || '')
    .split(',')
    .map((s) => s.trim())
    .includes(oge);

module.exports = {
  SRV21,
  CDN_KOK,
  PAKET_PLATFORMLARI,
  PROBOOK_AJANI,
  KAPI_ADLARI,
  platformSql,
  PROBOOK_SQL,
  tsvAyristir,
  sqlGuvenliMi,
  pipelineSorgu,
  cdnUrl,
  kesfet,
  platformSatiri,
  satirYokSebebi,
  girdiYokSebebi,
  dbZamani,
  windowsKaniti,
  canliKapilar,
  listede,
};

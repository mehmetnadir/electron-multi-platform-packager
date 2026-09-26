'use strict';
/**
 * ProBook şeridi NABIZ yazıcısı (plan karar 2). `serit-ajan.sh` runner'ı başlatınca bunu
 * arka planda koşturur; her 60 sn `~/empp-serit/log/nabiz.json`'u ATOMİK (tmp+rename)
 * yazar. Mac tarafı (`src/agent/serit-secimi.js`) bu dosyanın ZAMANINA ve disk alanına
 * bakarak Pardus şeridini devralır/bırakır.
 * "Cevap veriyor mu" değil "beklenen kopya mı": pid + commit + başlama zamanı taşır.
 * 2026-09-26 eklemeleri:
 *  - `api`: ajan KENDİ jetonuyla sunucuya ulaşıyor mu (salt-okur `peek?n=1`, 5 dk'da bir;
 *    iki ardışık hata → 'hata', 401/403 → 'yetkisiz', jeton yok → 'jetonsuz'). Nabız taze,
 *    süreç ayakta ama internet/jeton yoksa ProBook iş kiralayamaz — Mac devralmalı.
 *  - `arsivOzeti`: ~/.empp-agent/kaynak-arsivi özeti; Mac'inkiyle farklıysa Mac alır
 *    (ProBook arşivdeki kitabı İmpark exe'sinden, ESKİ arayüzle üretmesin).
 *  - `motorSha12`: 43e23 motor kanoniğinin (EMPP_MOTOR_KANONIK) DOĞRULANMIŞ sha12'si; yoksa null.
 *    Mac'inkiyle farklıysa Mac alır (ProBook paketinde motor değişmez ya da başka motor girer).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

function diskOlc(yol) {
  try {
    const st = fs.statfsSync(yol);
    const bos = st.bavail * st.bsize;
    const toplam = st.blocks * st.bsize;
    return { diskBosGb: Math.floor(bos / 1e9), dolulukYuzde: toplam ? Math.round((1 - st.bfree / st.blocks) * 100) : null };
  } catch (_) {
    return { diskBosGb: null, dolulukYuzde: null };
  }
}

/** ~/DijiTap altında `.kabulgizli-*` (gizli kalmış öğretmen kurulumu) sayısı — yalnız RAPOR. */
function kabulgizliSay(home) {
  const taban = path.join(home, 'DijiTap');
  let n = 0;
  let kokler = [];
  try { kokler = fs.readdirSync(taban, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch (_) { return 0; }
  for (const k of kokler) {
    try {
      n += fs.readdirSync(path.join(taban, k.name)).filter((a) => a.includes('.kabulgizli-')).length;
    } catch (_) { /* okunamadı */ }
  }
  return n;
}

function pidCanli(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

function nabizOlustur({
  simdi, runnerPid, runnerCanli, commit, baslama, disk, kabulgizli, bayraklar, api, arsivOzeti, kuyrukta,
  motorSha12,
}) {
  return {
    api: api || 'olculmedi',
    arsivOzeti: arsivOzeti || null,
    motorSha12: motorSha12 || null,
    kuyrukta: Number.isFinite(kuyrukta) ? kuyrukta : null,
    zaman: new Date(simdi).toISOString(),
    ajan: runnerCanli ? 'active' : 'olu',
    runnerPid: runnerPid || null,
    commit: commit || '?',
    baslama: baslama || null,
    diskBosGb: disk.diskBosGb,
    dolulukYuzde: disk.dolulukYuzde,
    kabulgizli: kabulgizli,
    bayraklar: bayraklar || {},
  };
}

function atomikYaz(dosya, nesne) {
  fs.mkdirSync(path.dirname(dosya), { recursive: true });
  const tmp = `${dosya}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(nesne, null, 1)}\n`);
  fs.renameSync(tmp, dosya);
}

/** ProBook'taki kaynak arşivinin özeti (kaynak-arsivi.js yoksa null — eski kurulum). */
function arsivOzetiOku(kok) {
  try {
    return require(path.join(__dirname, '..', '..', 'src', 'agent', 'kaynak-arsivi.js')).arsivOzeti(kok).ozet;
  } catch (_) {
    return null;
  }
}

/** ProBook motor kanoniğinin doğrulanmış sha12'si (motor-surumu.js yoksa null — eski kurulum). */
function motorSha12Oku(kanonikYol) {
  try {
    const m = require(path.join(__dirname, '..', '..', 'src', 'packaging', 'motor-surumu.js'));
    const o = m.kanonikOzetEsz(kanonikYol);
    return o ? o.sha12 : null;
  } catch (_) {
    return null;
  }
}

/**
 * API yoklayıcı: ajan jetonuyla salt-okur `GET {api}/agents/<id>/peek?n=1`. Tek hata durumu
 * değiştirmez (geçici dalga), `esikArdisik` ardışık hata → 'hata'. İlk başarıdan önce 'olculmedi'.
 */
function apiYoklayici({ api, tokenDosyasi, fetchImpl = (...a) => fetch(...a), esikArdisik = 2, zamanAsimiMs = 20000 }) {
  let ardisik = 0;
  let durum = 'olculmedi';
  let kuyrukta = null;
  async function yokla() {
    let tok = null;
    try { tok = JSON.parse(fs.readFileSync(tokenDosyasi, 'utf8')); } catch (_) { tok = null; }
    if (!tok || !tok.agentId || !tok.token) { durum = 'jetonsuz'; return durum; }
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), zamanAsimiMs);
    try {
      const r = await fetchImpl(`${String(api).replace(/\/+$/, '')}/agents/${tok.agentId}/peek?n=1`, {
        headers: { 'X-Agent-Token': tok.token }, signal: ctrl.signal,
      });
      if (r.status === 401 || r.status === 403) { ardisik = 0; durum = 'yetkisiz'; return durum; }
      if (r.status < 200 || r.status >= 300) throw new Error(`HTTP ${r.status}`);
      let govde = null;
      try { govde = await r.json(); } catch (_) { govde = null; }
      kuyrukta = govde && Array.isArray(govde.jobs) ? govde.jobs.length : null;
      ardisik = 0; durum = 'ok';
    } catch (_) {
      ardisik += 1;
      if (ardisik >= esikArdisik) durum = 'hata';
    } finally {
      clearTimeout(t);
    }
    return durum;
  }
  return { yokla, durum: () => durum, kuyrukta: () => kuyrukta };
}

function birKez({
  dosya, runnerPid, commit, baslama, serit, home, simdi = Date.now(), api = null, arsivKok = null,
  kuyrukta = null, motorKanonik = null,
}) {
  const n = nabizOlustur({
    api, kuyrukta, arsivOzeti: arsivOzetiOku(arsivKok || path.join(home, '.empp-agent', 'kaynak-arsivi')),
    motorSha12: motorSha12Oku(motorKanonik || process.env.EMPP_MOTOR_KANONIK
      || path.join(home, '.empp-agent', 'motor', 'kanonik.json')),
    simdi, runnerPid, runnerCanli: pidCanli(runnerPid), commit, baslama,
    disk: diskOlc(path.join(serit, 'work')), kabulgizli: kabulgizliSay(home),
    bayraklar: {
      caps: process.env.AGENT_CAPS || '', probookHost: process.env.PROBOOK_HOST || '',
      linuxDeb: process.env.EMPP_LINUX_DEB || '', kabul: process.env.EMPP_PARDUS_KABUL || '',
    },
  });
  atomikYaz(dosya, n);
  return n;
}

if (require.main === module) {
  const serit = process.env.EMPP_SERIT_KOK || path.join(os.homedir(), 'empp-serit');
  const runnerPid = Number(process.argv[2] || 0);
  let commit = '?';
  try { commit = fs.readFileSync(path.join(serit, 'repo', '.serit-surum'), 'utf8').trim(); } catch (_) { /* yok */ }
  const ops = {
    dosya: path.join(serit, 'log', 'nabiz.json'), runnerPid, commit,
    baslama: new Date().toISOString(), serit, home: os.homedir(),
  };
  const yoklayici = apiYoklayici({
    api: process.env.BOOKUPDATE_API || 'https://akillitahta.ndr.ist/api/v1',
    tokenDosyasi: process.env.AGENT_TOKEN_FILE || path.join(os.homedir(), '.empp-agent', 'token.json'),
  });
  const tik = () => {
    const n = birKez({ ...ops, api: yoklayici.durum(), kuyrukta: yoklayici.kuyrukta() });
    // Runner öldüyse son bir 'olu' nabzı yazıp çık — bayat dosya zaten Mac'i devrettirir.
    if (n.ajan !== 'active') process.exit(0);
  };
  // İlk nabızdan ÖNCE API bir kez yoklanır (en fazla 20 sn) — 'olculmedi' nabzı Mac'e "alma" dedirtmez.
  yoklayici.yokla().catch(() => {}).finally(() => {
    tik();
    setInterval(tik, Number(process.env.EMPP_NABIZ_MS || 60000));
    setInterval(() => { yoklayici.yokla().catch(() => {}); }, Number(process.env.EMPP_NABIZ_API_MS || 300000));
  });
}

module.exports = {
  diskOlc, kabulgizliSay, pidCanli, nabizOlustur, atomikYaz, birKez, apiYoklayici, arsivOzetiOku,
  motorSha12Oku,
};

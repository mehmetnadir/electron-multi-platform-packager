'use strict';
/**
 * ProBook şeridi NABIZ yazıcısı (plan karar 2). `serit-ajan.sh` runner'ı başlatınca bunu
 * arka planda koşturur; her 60 sn `~/empp-serit/log/nabiz.json`'u ATOMİK (tmp+rename)
 * yazar. Mac tarafı (`src/agent/serit-secimi.js`) bu dosyanın ZAMANINA ve disk alanına
 * bakarak Pardus şeridini devralır/bırakır.
 * "Cevap veriyor mu" değil "beklenen kopya mı": pid + commit + başlama zamanı taşır.
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

function nabizOlustur({ simdi, runnerPid, runnerCanli, commit, baslama, disk, kabulgizli, bayraklar }) {
  return {
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

function birKez({ dosya, runnerPid, commit, baslama, serit, home, simdi = Date.now() }) {
  const n = nabizOlustur({
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
  const tik = () => {
    const n = birKez(ops);
    // Runner öldüyse son bir 'olu' nabzı yazıp çık — bayat dosya zaten Mac'i devrettirir.
    if (n.ajan !== 'active') process.exit(0);
  };
  tik();
  setInterval(tik, Number(process.env.EMPP_NABIZ_MS || 60000));
}

module.exports = { diskOlc, kabulgizliSay, pidCanli, nabizOlustur, atomikYaz, birKez };

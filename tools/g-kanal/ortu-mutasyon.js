#!/usr/bin/env node
'use strict';
/**
 * G örtüsü (mac + Pardus) + G GÜVENLİK (2026-09-26: monoton sürüm, set kimliği, ya hep ya hiç,
 * yeniden indirme yok — TÜM kipler) MUTASYON KANITI — her mutant tek bir kuralı bozar; ilgili
 * testler DÜŞMELİ ("öldü"). Hayatta kalan mutant = testin görmediği kural.
 * M45–M67 (2026-09-26): Pardus Docker G anahtarı + claim kimliği, taban yoksa enjeksiyon yok,
 * paketin G sürümü tabanı, renderer fs-shim örtü okuması, imzalı dosyalar[] (arşiv saklanmaz).
 * M68–M73: HTTP yolu (mac/Windows/android) claim surum → empp-set.json / empp-g-paket.json tabanı.
 * `UU` / `UUO` test adı = G uçtan uca 11 senaryo koşumu (`tools/g-uctan-uca/kos.js`, yerinde /
 * örtü kipi) — fikstür `--uu-dizin` (varsayılan ~/.empp-agent/g-uctan-uca/g-electron, hazirla ile).
 *
 * Canlı ağaca DOKUNMAZ: `src/` geçici bir kopyaya alınır, mutant orada uygulanır, testler orada
 * koşar (node_modules bağla). Kullanım (ağır iş → semafor):
 *   ~/.empp-agent/agir.sh gel-e node tools/g-kanal/ortu-mutasyon.js [--calisma <dizin>] [--yalniz M3,M7]
 * Çıkış: 0 hepsi öldü · 1 hayatta kalan var · 2 mutant uygulanamadı (kaynak kaydı).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const KOK = path.resolve(__dirname, '..', '..');
const KG = 'src/runtime/kitap-guncelleyici.js';
const K = 'src/runtime/icerik-guncelleme.js';
const EN = 'src/packaging/guncelleyici-enjekte.js';
const T_ORTU = 'src/runtime/kitap-guncelleyici-ortu.test.js';
const T_E2E = 'src/runtime/kitap-guncelleyici-ortu-e2e.test.js';
const T_ESKI = 'src/runtime/kitap-guncelleyici.test.js';
const T_K = 'src/runtime/icerik-guncelleme.test.js';
const T_EN = 'src/packaging/guncelleyici-enjekte.test.js';
const T_GV = 'src/runtime/kitap-guncelleyici-guvenlik.test.js';
// (a) Pardus G anahtarı + claim kimliği, (b) renderer fs-shim örtü okuması, taban kapısı (2026-09-26)
const RH = 'src/agent/runner-helpers.js';
const RN = 'src/agent/runner.js';
const PB = 'tools/pardus/pardus-packager-build.sh';
const PR = 'tools/pardus/packager-run-linux.js';
const SK = 'src/packaging/set-kimligi.js';
const PS = 'src/packaging/packagingService.js';
const SH = 'src/platforms/common/fs-shim.js';
const T_PG = 'tools/pardus/pardus-g-anahtar.test.js';
const T_KR = 'src/packaging/guncelleyici-enjekte-karar.test.js';
const T_SHIM = 'src/platforms/common/fs-shim-ortu.test.js';
// Madde 3 (2026-09-26): HTTP yolu claim surum → empp-set.json / android empp-g-paket.json
const AP = 'src/server/app.js';
const GK = 'src/platforms/android/g-katmani.js';
const T_GSH = 'src/packaging/g-surum-http.test.js';
/** G uçtan uca koşumu (yerinde / örtü) — `testKos` bunları kos.js ile koşar. */
const UU = 'UU';
const UUO = 'UUO';

const MUTANTLAR = [
  { id: 'M1', ne: 'Windows da örtü kipine düşer', dosya: KG,
    eski: "if (o.platform === 'win32') return { tur: 'yerinde', sebep: 'windows' };", yeni: '', test: [T_ORTU, T_EN] },
  { id: 'M2', ne: 'mac örtüsü userData yerine .app yanına (kurulum dizini)', dosya: KG,
    eski: "return { tur: 'ortu', ortuKoku: nodePath.join(ud, ORTU_DIZIN_ADI), kaynak: 'userData' };",
    yeni: "return { tur: 'ortu', ortuKoku: nodePath.join(nodePath.dirname(asar || o.kok), ORTU_DIZIN_ADI), kaynak: 'userData' };", test: [T_ORTU] },
  { id: 'M3', ne: 'açılışta manifest imzası doğrulanmaz', dosya: KG,
    eski: "if (!manifestImzasiGecerliMi(mHam, etkin.imza, set.imzaAnahtari)) return red('imza-gecersiz');", yeni: '', test: [T_ORTU] },
  { id: 'M4', ne: 'taban kimliği (yeni paket) denetlenmez', dosya: KG,
    eski: "if (etkin.tabanKimligi !== tk) return red('taban-degisti');", yeni: '', test: [T_ORTU] },
  { id: 'M5', ne: 'örtü nesnesinin özeti doğrulanmaz', dosya: KG,
    eski: "try { gecerli = sha256(fsS.readFileSync(y)) === e.sha256; } catch (x) { gecerli = false; }",
    yeni: 'gecerli = true;', test: [T_ORTU] },
  { id: 'M6', ne: 'çıkarılan kitap gizlenmez', dosya: KG,
    eski: "if (d.cikarilan.has(dal)) return { tur: 'yok' };", yeni: '', test: [T_ORTU, T_E2E] },
  { id: 'M7', ne: 'eklenen kitapta listesiz dosya pakete düşer', dosya: KG,
    eski: "if (!e) return { tur: 'yok' };", yeni: 'if (!e) return null;', test: [T_ORTU] },
  { id: 'M8', ne: 'pakette güncel olan kabuk dosyası da indirilir', dosya: KG,
    eski: 'if (taban && taban.length === g.boyut && sha256(taban) === sha) continue; // paketteki güncel', yeni: '', test: [T_ORTU] },
  { id: 'M9', ne: 'bozuk imzalı dosya listesi reddedilmez, arşivden türetilir', dosya: KG,
    eski: 'const turetilecek = g.dosyalar === undefined;',
    yeni: 'const turetilecek = g.dosyalar === undefined || !kitapDosyalariDogrula(g.dosyalar);', test: [T_ORTU] },
  { id: 'M10', ne: 'arşivden çıkan dosyanın özeti listeyle kıyaslanmaz', dosya: KG,
    eski: "if (veri.length !== d.boyut || sha256(veri) !== d.sha256) throw new Error('dosya-ozeti-uyusmaz:' + y);",
    yeni: '', test: [T_ORTU] },
  { id: 'M11', ne: 'kabuk eksikken de örtü kesinleşir', dosya: KG,
    eski: "  if (kabukBasarisiz > 0) {\n    await temizle();\n    rapor.durum = 'kismi';",
    yeni: "  if (false) {\n    await temizle();\n    rapor.durum = 'kismi';", test: [T_ORTU] },
  { id: 'M12', ne: 'nesneler paket gövdesine yazılır', dosya: KG,
    eski: 'const nesneKoku = nodePath.join(ortuKoku, ORTU_NESNE);\n  const geciciKok',
    yeni: 'const nesneKoku = nodePath.join(kok, ORTU_NESNE);\n  const geciciKok', test: [T_ORTU, T_E2E] },
  { id: 'M13', ne: 'budama bu oturumun nesnelerini de siler', dosya: KG,
    eski: 'gereken, OTURUM.get(ortuKoku), gunluk);', yeni: 'gereken, null, gunluk);', test: [T_ORTU] },
  { id: 'M14', ne: 'örtü yokken de file: kancası kurulur', dosya: KG,
    eski: "if (!fsS.existsSync(nodePath.join(ortuKoku, ORTU_ETKIN))) return { durum: 'ortu-bos', ortuKoku };",
    yeni: '', test: [T_ORTU] },
  { id: 'M15', ne: 'gizlenen yol 404 yerine paketten sunulur', dosya: KG,
    eski: 'if (r && r.yok) { cb({ error: NET_DOSYA_YOK }); return; }', yeni: '', test: [T_ORTU, T_K] },
  { id: 'M16', ne: 'Node require ile yüklenen dosyalar örtüye yazılır', dosya: KG,
    eski: 'if (p.length === 1 && ORTU_ETKISIZ_KOK.has(p[0])) return true;', yeni: '', test: [T_ORTU] },
  { id: 'M17', ne: 'örtü kipinde yerinde (gövdeye) yazılır', dosya: KG,
    eski: '    if (ortuKoku) {\n      await ortuyaUygula({', yeni: '    if (false) {\n      await ortuyaUygula({', test: [T_ORTU, T_E2E] },
  { id: 'M18', ne: 'guncellemeyiBaslat kip kararını yok sayar', dosya: KG,
    eski: "      ortuKoku: ortuKipi ? kip.ortuKoku : '',", yeni: "      ortuKoku: '',", test: [T_ORTU, T_E2E] },
  { id: 'M19', ne: 'yarım üyelikte etkin yine yazılır', dosya: KG,
    eski: "  if (rapor.uyelikBasarisiz > 0) {\n    await temizle();", yeni: "  if (false) {\n    await temizle();", test: [T_ORTU] },
  { id: 'M20', ne: 'K zincire bağlanmaz (iki file: kaydı)', dosya: K,
    eski: "if (zincir && typeof zincir.ekle === 'function' && typeof zincir.kur === 'function') {",
    yeni: 'if (false) {', test: [T_K] },
  { id: 'M21', ne: 'K zincir yokken de zincir yoluna girer (bugünkü Pardus kaydı bozulur)', dosya: K,
    eski: 'var zincir = kapsam && kapsam.__emppDosyaOrtusu;',
    yeni: "var zincir = kapsam && (kapsam.__emppDosyaOrtusu || require('./kitap-guncelleyici.js').dosyaOrtusuZinciri(kapsam));",
    test: [T_K] },
  { id: 'M22', ne: 'enjeksiyon bloğu örtüyü kurmaz', dosya: EN,
    eski: "    try { require('./${MODUL_ADI}').ortuSunucusunuKur({ electron: __emppElectron, kok: __dirname }); } catch (e) {}\n",
    yeni: '', test: [T_EN] },
  { id: 'M23', ne: 'zincir aynı şemaya ikinci kez kayıt yapar', dosya: KG,
    eski: 'if (z.kurulu) return { yontem: z.kurulu, yeni: false };', yeni: '', test: [T_K] },
  { id: 'M24', ne: 'https dışı taban (loopback olmayan http) kabul edilir', dosya: KG,
    eski: "if (u.protocol === 'http:') return YEREL_HOSTLAR.has(u.hostname);", yeni: "if (u.protocol === 'http:') return true;",
    test: [T_ESKI] },
  // ---- G GÜVENLİK (2026-09-26) — açık (1) monoton sürüm
  { id: 'M25', ne: 'AÇIK-1: imzalı manifestte kesin-büyük sürüm denetimi yok (geri alma)', dosya: KG,
    eski: "if (kurulu && gSurumCoz(kurulu) && gSurumKiyasla(m.surum, kurulu) <= 0) return 'surum-eski';",
    yeni: '', test: [T_GV, UU, UUO] },
  { id: 'M26', ne: 'tetik kurulu sürümden büyük değilken de manifest indirilir', dosya: KG,
    eski: 'if (kurulu && gSurumCoz(uzakSurum) && gSurumKiyasla(uzakSurum, kurulu) <= 0) {',
    yeni: 'if (false) {', test: [T_GV] },
  { id: 'M27', ne: 'AÇIK-1: son uygulanan G sürümü taban sayılmaz (yalnız paket sürümü)', dosya: KG,
    eski: 'const kurulu = enBuyukGSurum([uygulanan, paketSurumu, set.surum || null]);',
    yeni: 'const kurulu = enBuyukGSurum([paketSurumu, set.surum || null]);', test: [T_GV] },
  { id: 'M28', ne: 'eski pakete ait damga (taban değişti) yine taban sayılır', dosya: KG,
    eski: 'if (damga && damga.taban && damga.taban !== tabanKimligi) {', yeni: 'if (false) {', test: [T_GV] },
  // ---- açık (2) set kimliği / kanal
  { id: 'M29', ne: 'AÇIK-2: başka setin imzalı manifesti kabul edilir', dosya: KG,
    eski: "if (m.setKimligi == null || setKimligi == null || m.setKimligi !== String(setKimligi)) return 'baska-set';",
    yeni: '', test: [T_GV, UU, UUO] },
  { id: 'M30', ne: 'kanal G olmayan manifest kabul edilir', dosya: KG,
    eski: "if (m.kanal !== KANAL) return 'kanal-g-degil';", yeni: '', test: [T_GV] },
  { id: 'M31', ne: 'örtü açılışında etkin manifestin set/kanal kimliği denetlenmez', dosya: KG,
    eski: "if (m.kanal !== KANAL || m.setKimligi !== set.setKimligi) return red('manifest-kimligi');",
    yeni: '', test: [T_GV] },
  // ---- açık (3) ya hep ya hiç
  { id: 'M32', ne: 'AÇIK-3 (Windows): bozuk kabuk dosyası atlanır, geri kalanı uygulanır', dosya: KG,
    eski: "      const ne = govde.length !== k.g.boyut ? 'boyut' : 'sha256';\n      return reddet('kabuk-' + ne + '-uyusmaz', `${ne} uyuşmadı: ${k.yol}`);",
    yeni: '      continue;', test: [T_GV, T_ESKI, UU] },
  { id: 'M33', ne: 'AÇIK-3 (örtü): bu koşuda üretilen nesne başka yolun bozuk ucunu örter', dosya: KG,
    eski: '    if (!onceden.has(ad)) return false;\n', yeni: '', test: [T_GV, T_ORTU, UUO] },
  { id: 'M34', ne: 'uygulama ortasında düşen adımdan sonra geri alma yapılmaz', dosya: KG,
    eski: 'for (let i = yapilan.length - 1; i >= 0; i--) await adimGeriAl(fsm, yapilan[i]);', yeni: '', test: [T_GV] },
  { id: 'M35', ne: 'damga (kesinleşme) yazılamasa da uygulama kalır', dosya: KG,
    eski: "    hata = new Error('damga-yazilamadi');", yeni: '', test: [T_GV] },
  { id: 'M36', ne: 'çöken uygulamanın güncesi açılışta geri sarılmaz', dosya: KG,
    eski: 'rapor.artik = (await yarimUygulamayiToparla(fsm, kok, gunluk))', yeni: 'rapor.artik = (0)', test: [T_GV] },
  { id: 'M37', ne: 'kesinleşmiş (damga yazılmış) uygulama da geri sarılır', dosya: KG,
    eski: "const kesin = !!(damga && gunce && typeof gunce.surum === 'string' && damga.surum === gunce.surum);",
    yeni: 'const kesin = false;', test: [T_GV] },
  { id: 'M38', ne: 'index.html kitaplardan ÖNCE yerine konur', dosya: KG,
    eski: 'const adimlar = kitapAdimlari.concat(\n    kabukAdimlari.filter((a) => !indexMi(a)), kabukAdimlari.filter(indexMi));',
    yeni: 'const adimlar = kabukAdimlari.filter(indexMi).concat(kitapAdimlari, kabukAdimlari.filter((a) => !indexMi(a)));',
    test: [T_GV] },
  { id: 'M39', ne: 'kanalın durum yolunu hedefleyen kabuk girdisi uygulanır', dosya: KG,
    eski: "if (yol.split('/').some((s) => s.toLowerCase().startsWith('.empp'))) {", yeni: 'if (false) {', test: [T_GV] },
  // ---- birikimli manifest: yeniden indirme yok + kural 8
  { id: 'M40', ne: 'Windows: aynı sha256 ile kurulu ekle arşivi yeniden indirilir', dosya: KG,
    eski: 'if (onceki[g.dizin] === sha && (await dizinMi(fsm, hedefDizin))) {', yeni: 'if (false) {', test: [T_GV] },
  { id: 'M41', ne: 'örtü: aynı sha256 arşiv nesnesi varken yeniden indirilir', dosya: KG,
    eski: 'if (!(await nesneVar(arsivAdi, arsivSha, g.boyut))) {', yeni: 'if (true) {', test: [T_GV] },
  { id: 'M42', ne: 'Windows kural 8: tabanda olmayan kitaba kabuk dosyası yazılır', dosya: KG,
    eski: 'if (dal && !eklenecek.has(dal) && !(await dizinMi(fsm, nodePath.join(kok, dal0)))) {', yeni: 'if (false) {', test: [T_GV] },
  { id: 'M43', ne: 'örtü kural 8: tabanda olmayan kitaba kabuk dosyası örtülür', dosya: KG,
    eski: 'if (kd && !ekDal && !(await dizinMi(fsm, nodePath.join(kok, kd)))) {', yeni: 'if (false) {', test: [T_GV] },
  { id: 'M44', ne: 'örtü: türetilmiş kitap listesi arşivden yeniden doğrulanmaz', dosya: KG,
    eski: 'if (kitap.dogrulandi === null) kitap.dogrulandi = kitapTuretilmisDogrula(f, d, kitap);',
    yeni: 'if (kitap.dogrulandi === null) kitap.dogrulandi = true;', test: [T_GV] },
  // ---- (a) Pardus Docker: G açık anahtarı
  { id: 'M45', ne: 'pardus: açık anahtar konteynere -e ile geçmez', dosya: PB,
    eski: '  -e EMPP_GUNCELLEME_ACIK_ANAHTAR="${EMPP_GUNCELLEME_ACIK_ANAHTAR:-}" \\\n', yeni: '', test: [T_PG] },
  { id: 'M46', ne: 'pardus: geçersiz/özel anahtar ortamdan düşürülmez', dosya: RH,
    eski: '  if (sebep) delete cikti.EMPP_GUNCELLEME_ACIK_ANAHTAR;\n', yeni: '  if (false) delete cikti.EMPP_GUNCELLEME_ACIK_ANAHTAR;\n', test: [T_PG] },
  { id: 'M47', ne: 'pardus: betik doğrulanmış ortam yerine ham ortamla koşar', dosya: RN,
    eski: "CONFIG.pardusBuildScript, ...args], { env: pe.env });", yeni: "CONFIG.pardusBuildScript, ...args], { env: process.env });", test: [T_PG] },
  // ---- (a-ext) claim G kimliği konteynere + taban yoksa enjeksiyon yok
  { id: 'M48', ne: 'pardus: claim setKimligi konteynere -e ile geçmez', dosya: PB,
    eski: '  -e EMPP_G_SET_KIMLIGI="${EMPP_G_SET_KIMLIGI:-}" \\\n', yeni: '', test: [T_PG] },
  { id: 'M49', ne: 'konteyner jobInfo claim tabanını almaz', dosya: PR,
    eski: "    guncellemeTabani: al('EMPP_G_GUNCELLEME_TABANI'),", yeni: '    guncellemeTabani: null,', test: [T_PG] },
  { id: 'M50', ne: 'runner yer tutucu (.invalid) tabanı geçirir', dosya: RH,
    eski: "    else if (/\\.invalid$/i.test(u.hostname)) sebepler.push('taban-yer-tutucu');\n", yeni: '', test: [T_PG] },
  { id: 'M51', ne: 'ajan ortamındaki eski EMPP_G_* değerleri konteynere sızar', dosya: RH,
    eski: '  for (const ad of Object.values(PARDUS_G_ENV)) delete cikti[ad];\n', yeni: '', test: [T_PG] },
  { id: 'M52', ne: 'buildPardusArtifact claim kimliğini betiğe geçirmez', dosya: RN,
    eski: 'runPardusScript([zipPath, appName, outDir, appVersion], kimlik);', yeni: 'runPardusScript([zipPath, appName, outDir, appVersion]);', test: [T_PG] },
  { id: 'M53', ne: 'taban yokken (yer tutucu) de G enjekte edilir', dosya: EN,
    eski: "  if (!tabanGercekMi(harita.taban, harita.tabanKaynagi)) return { enjekte: false, sebep: 'taban-yok' };\n",
    yeni: '', test: [T_KR, T_PG] },
  { id: 'M54', ne: 'istek/env ile gelen .invalid taban gerçek sayılır', dosya: EN,
    eski: '  if (/\\.invalid$/i.test(u.hostname)) return false;\n', yeni: '', test: [T_KR] },
  { id: 'M55', ne: 'imza anahtarı yokken de G enjekte edilir', dosya: EN,
    eski: "  if (!harita.imza || !harita.imza.acikAnahtar) return { enjekte: false, sebep: 'imza-anahtari-yok' };\n",
    yeni: '', test: [T_KR] },
  { id: 'M56', ne: 'kararliUygula karar olumsuzken de yamalar', dosya: EN,
    eski: '  if (!karar.enjekte) {\n', yeni: '  if (false) {\n', test: [T_KR] },
  { id: 'M57', ne: 'packagingService set haritasını karara vermez', dosya: PS,
    eski: '          setHaritasi = sh;\n', yeni: '', test: [T_KR] },
  { id: 'M58', ne: 'claim surum empp-set.json\'a yazılmaz', dosya: SK,
    eski: '    surum: surumCozum.surum,\n', yeni: '    surum: null,\n', test: [T_KR, T_PG] },
  { id: 'M59', ne: 'istemci paketin G sürümünü (set.surum) monoton tabana katmaz', dosya: KG,
    eski: 'enBuyukGSurum([uygulanan, paketSurumu, set.surum || null]);', yeni: 'enBuyukGSurum([uygulanan, paketSurumu]);', test: [T_GV] },
  // ---- (b) renderer fs-shim: örtü OKUMASI
  { id: 'M60', ne: 'fs-shim okuma yolu örtüyü atlar (pakete düşer)', dosya: SH,
    eski: '      if (ORTU) { try { var o = ORTU.yol(b); if (o) return o; } catch (e) {} }\n', yeni: '', test: [T_SHIM] },
  { id: 'M61', ne: 'fs-shim dizin listesi örtüde eklenen adları göstermez', dosya: SH,
    eski: '        if (L) ekle(L.adlar.map(function (ad) { return sanal(ad, L, opts); }));\n', yeni: '', test: [T_SHIM] },
  { id: 'M62', ne: 'fs-shim dizin listesi örtüde gizlenen kitabı gösterir', dosya: SH,
    eski: '        if (L && L.cikar.length) {\n', yeni: '        if (false) {\n', test: [T_SHIM] },
  { id: 'M63', ne: 'ana süreç renderer için örtü kökünü ortama yazmaz', dosya: KG,
    eski: '          env[ORTU_ENV_ETKIN] = ortuKoku;\n', yeni: '', test: [T_SHIM] },
  { id: 'M64', ne: 'renderer okuyucusu farklı sürümün örtüsünü de okur', dosya: KG,
    eski: '  if (o.surum && d.surum !== o.surum) return null;\n', yeni: '', test: [T_SHIM] },
  // ---- (d) imzalı dosyalar[] (yayın aracı 90d7a58 biçimi): arşiv saklanmaz
  { id: 'M65', ne: 'imzalı dosyalar[] yok sayılır, arşiv türetilip saklanır', dosya: KG,
    eski: 'const turetilecek = g.dosyalar === undefined;', yeni: 'const turetilecek = true;', test: [T_GV] },
  { id: 'M66', ne: 'imzalı listede nesneler varken arşiv yeniden iner', dosya: KG,
    eski: '        if (eksik) {\n', yeni: '        if (true) {\n', test: [T_GV] },
  { id: 'M67', ne: 'imzalı listede arşivdeki listesiz dosya kabul edilir', dosya: KG,
    eski: "            if (!d) throw new Error('arsivde-listesiz-dosya:' + y);", yeni: '            if (!d) continue;', test: [T_GV] },
  // ---- madde 3: mac/android G tabanı = claim surum (appVersion değişmeden)
  { id: 'M68', ne: 'runner claim surum\'unu paketleyici isteğine koymaz', dosya: RN,
    eski: '      ...(surum ? { surum } : {}),\n', yeni: '', test: [T_GSH] },
  { id: 'M69', ne: 'runner HTTP yolunda claim surum\'unu geçirmez', dosya: RN,
    eski: '        gSurum.surum);', yeni: '        null);', test: [T_GSH] },
  { id: 'M70', ne: '/api/package surum\'u jobInfo\'ya koymaz', dosya: AP,
    eski: '      surum: surumCozum.surum,\n', yeni: '      surum: null,\n', test: [T_GSH] },
  { id: 'M71', ne: 'claim surum düşer: empp-set.json surum yazılmaz (eski manifest reddi kırılmalı)', dosya: SK,
    eski: '    surum: surumCozum.surum,\n', yeni: '    surum: null,\n', test: [T_GSH] },
  { id: 'M72', ne: 'android empp-g-paket.json set surum\'unu yok sayar (appVersion 1.0.0)', dosya: GK,
    eski: '    if (s && kg.gSurumCoz(s.surum)) setSurumu = String(s.surum).trim();\n', yeni: '', test: [T_GSH] },
  { id: 'M73', ne: 'runner G3 olmayan claim surum\'unu da gönderir', dosya: RH,
    eski: "  if (!require('../runtime/kitap-guncelleyici').gSurumCoz(v)) return { surum: null, sebep: 'g3-degil' };\n",
    yeni: '', test: [T_GSH] },
];

function arg(ad) { const i = process.argv.indexOf(ad); return i === -1 ? null : process.argv[i + 1]; }

/** Koşu başında `src/`'nin TEK anlık görüntüsü alınır (koşu sürerken ağaç değişse de her mutant aynı tabanda). */
function kopyala(hedef, anlik) {
  fs.rmSync(hedef, { recursive: true, force: true });
  fs.mkdirSync(hedef, { recursive: true });
  fs.cpSync(path.join(anlik, 'src'), path.join(hedef, 'src'), { recursive: true });
  fs.cpSync(path.join(anlik, 'tools'), path.join(hedef, 'tools'), { recursive: true });
  fs.symlinkSync(path.join(KOK, 'node_modules'), path.join(hedef, 'node_modules'));
}

function testKos(cal, testler, uuDizin) {
  const bas = Date.now();
  const birim = testler.filter((t) => t !== UU && t !== UUO);
  const parca = [];
  let rc = 0;
  let zamanAsimi = false;
  if (birim.length) {
    const r = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...birim], {
      cwd: cal, encoding: 'utf8', timeout: 240000, env: { ...process.env, NODE_OPTIONS: '' },
    });
    parca.push(...((r.stdout || '').match(/ℹ (pass|fail) \d+/g) || []));
    if (r.status !== 0) rc = r.status || 1;
    zamanAsimi = zamanAsimi || !!(r.error && r.error.code === 'ETIMEDOUT');
  }
  // G uçtan uca: mutant kopyanın kos.js'i kopyanın istemcisini koşar (ISTEMCI __dirname'e göreli).
  for (const [ad, ek] of [[UU, []], [UUO, ['--kip', 'ortu']]]) {
    if (!testler.includes(ad)) continue;
    const r = spawnSync(process.execPath, ['tools/g-uctan-uca/kos.js', '--dizin', uuDizin, ...ek], {
      cwd: cal, encoding: 'utf8', timeout: 240000, env: { ...process.env, NODE_OPTIONS: '' },
    });
    const kalan = ((r.stdout || '').match(/^(KALDI|AÇIK)\s+\S+/gm) || []).map((s) => s.replace(/\s+/, ':'));
    parca.push(`${ad} ${r.status === 0 ? 'geçti' : 'KALDI[' + kalan.join(',') + ']'}`);
    if (r.status !== 0) rc = r.status || 1;
    zamanAsimi = zamanAsimi || !!(r.error && r.error.code === 'ETIMEDOUT');
  }
  return { rc, ms: Date.now() - bas, ozet: parca.join(' '), zamanAsimi };
}

function main() {
  const cal = arg('--calisma') || path.join(os.tmpdir(), `g-ortu-mutasyon-${process.pid}`);
  const yalniz = (arg('--yalniz') || '').split(',').filter(Boolean);
  const liste = MUTANTLAR.filter((m) => !yalniz.length || yalniz.includes(m.id));
  const anlik = `${cal}-anlik`;
  const uuDizin = arg('--uu-dizin') || path.join(os.homedir(), '.empp-agent', 'g-uctan-uca', 'g-electron');
  fs.rmSync(anlik, { recursive: true, force: true });
  fs.cpSync(path.join(KOK, 'src'), path.join(anlik, 'src'), { recursive: true });
  for (const t of ['g-uctan-uca', 'g-yayin', 'pardus']) {
    fs.cpSync(path.join(KOK, 'tools', t), path.join(anlik, 'tools', t), { recursive: true });
  }
  const sonuc = [];
  let uygulanamadi = 0;
  for (const m of liste) {
    kopyala(cal, anlik);
    const dosya = path.join(cal, m.dosya);
    const s = fs.readFileSync(dosya, 'utf8');
    const adet = s.split(m.eski).length - 1;
    if (adet !== 1) {
      uygulanamadi += 1;
      console.log(`${m.id} UYGULANAMADI (eşleşme ${adet}) — ${m.ne}`);
      sonuc.push({ ...m, durum: 'uygulanamadi' });
      continue;
    }
    fs.writeFileSync(dosya, s.replace(m.eski, m.yeni));
    const r = testKos(cal, m.test, uuDizin);
    const durum = r.rc === 0 ? 'HAYATTA' : 'öldü';
    console.log(`${m.id} ${durum} (${r.ozet}, ${r.ms} ms${r.zamanAsimi ? ', ZAMAN AŞIMI' : ''}) — ${m.ne}`);
    sonuc.push({ id: m.id, ne: m.ne, dosya: m.dosya, durum, ozet: r.ozet });
  }
  fs.rmSync(cal, { recursive: true, force: true });
  fs.rmSync(anlik, { recursive: true, force: true });
  const olen = sonuc.filter((x) => x.durum === 'öldü').length;
  console.log(`ÖZET: ${olen}/${liste.length} mutant öldü, hayatta ${sonuc.filter((x) => x.durum === 'HAYATTA').length}, uygulanamadı ${uygulanamadi}`);
  if (uygulanamadi) process.exit(2);
  process.exit(olen === liste.length ? 0 : 1);
}

if (require.main === module) main();
module.exports = { MUTANTLAR };

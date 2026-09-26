package com.empp.g;

import java.io.ByteArrayOutputStream;
import java.io.Closeable;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

/**
 * EMPP G — Android uzaktan güncelleme KATMANI (çekirdek). Sözleşme:
 * `.claude/docs/platform-kanallari-sozlesmesi.md` O3/O4 + "Android G katmanı".
 *
 * NEDEN (Nadir, 2026-09-26): "Tüm paketlerde bizim güncelleme istemcimiz (G kanalı) olacak."
 * APK assets SALT-OKUNURDUR; uygulamanın yazılabilir "kurulum klasörü" kendi veri alanıdır
 * (`filesDir/empp-g`). İmzası doğrulanmış dosyalar buraya yazılır; WebView istekleri
 * (`EmppGRota`, Capacitor RouteProcessor) önce buradan, yoksa APK'dan cevaplanır.
 *
 * KURALLAR (ihlali arıza):
 *   • Bu sınıf SAF JDK'dır (android.* YOK) — Mac JVM'inde birim sınanır (`g-java.test.js`).
 *   • Politika (ne güncellenir, imza, kapsam) JS istemcisindedir (`empp-g-istemci.js`); burası
 *     MEKANİZMADIR: https indirme, sha256 + boyut doğrulama, güvenli açma, atomik kesinleştirme.
 *   • sha256'sı tutmayan bayt hiçbir koşulda depoya girmez.
 *   • Kesinleştirme ATOMİKTİR: yeni dosyalar önce yerine taşınır, sonra `durum.txt` geçici ada
 *     yazılıp `rename` edilir, EN SON bellekteki tablo değişir. Yarıda kalan koşu eski durumu bozmaz.
 *   • APK değişince (yeni kurulum/güncelleme) eski örtü ATILIR: yeni APK'nın içeriğini eski
 *     örtü gölgelemesin (`ikili` = paket güncelleme zamanı + sürüm).
 *   • Okunamayan/bozuk `durum.txt` → örtü YOK sayılır (APK içeriği); uygulama açılmaya devam eder.
 *   • MONOTON SÜRÜM (savunma derinliği; asıl karar JS'de, Electron e07bc37 ile aynı kural):
 *     kesinleşen sürüm G3 (`2.<panel>.<sayaç>`) olmalı ve mevcut örtünün sürümünden KESİN
 *     büyük olmalı — köprüyü doğrudan çağıran biri de eski örtüyü geri getiremez.
 */
public final class EmppGKatman {

    public static final String BICIM = "EMPP-G 1";
    /** Var olmayan dosya: rota bunu verirse Capacitor 404 döner (çıkarılan kitap, güvensiz yol). */
    public static final File YOK = new File("/_empp_g_yok_");
    public static final String SHIM = "empp-android-shim.js";
    public static final String KITAP_MANIFESTI = "empp-manifest.json";

    private static final Pattern SHA256 = Pattern.compile("^[0-9a-f]{64}$");
    private static final Pattern DIZIN = Pattern.compile("^[A-Za-z0-9_-][A-Za-z0-9._-]{0,63}$");
    /** G3 sürümü — tools/g-yayin/g-surum.js ve `empp-g-istemci.js` ile AYNI desen. */
    private static final Pattern G_SURUM = Pattern.compile("^2\\.(0|[1-9]\\d{0,8})\\.(0|[1-9]\\d{0,8})$");
    private static final int ARABELLEK = 64 * 1024;
    private static final long VARSAYILAN_TAVAN = 64L * 1024 * 1024;

    /* ------------------------------------------------------------ bağımlılıklar */

    /** Uzak kaynak açıcı. Üretimde {@link #HTTPS}; birim testte sahte. */
    public interface Acici {
        Yanit ac(String adres, int zamanAsimiMs) throws IOException;
    }

    /** APK varlık okuyucu (Android AssetManager). Yoksa `null` döner. */
    public interface Varliklar {
        InputStream ac(String yol) throws IOException;
    }

    /** Günlük hattı (logcat). */
    public interface Gunluk {
        void yaz(String satir);
    }

    public static final class Yanit implements Closeable {
        public final int durum;
        public final InputStream govde;

        public Yanit(int durum, InputStream govde) {
            this.durum = durum;
            this.govde = govde;
        }

        @Override
        public void close() {
            try { if (govde != null) govde.close(); } catch (IOException e) { /* kapalı */ }
        }
    }

    public static final class GetirSonucu {
        public final int durum;
        public final byte[] veri;

        GetirSonucu(int durum, byte[] veri) {
            this.durum = durum;
            this.veri = veri;
        }
    }

    public static final class KitapSonucu {
        public String klasor;
        public int dosyaSayisi;
        public boolean indexShimli;
        public boolean shimVar;
        public boolean manifestVar;
        public boolean onbellekten;
    }

    /** `uygula` girdisi — JS istemcisinin doğruladığı plan. */
    public static final class Plan {
        public String surum;
        /** {yol, sha256} */
        public final List<String[]> dosyalar = new ArrayList<>();
        /** {dizin, klasor, sha256} */
        public final List<String[]> kitaplar = new ArrayList<>();
        public final List<String> cikarilan = new ArrayList<>();
    }

    /** Değişmez rota tablosu — okuyucu (WebView iş parçacıkları) kilitsiz okur. */
    public static final class Tablo {
        final Map<String, String> dosyalar;
        final Map<String, String[]> kitaplar;
        final Set<String> cikarilan;
        final String surum;
        final String ikili;

        Tablo(Map<String, String> d, Map<String, String[]> k, Set<String> c, String surum, String ikili) {
            this.dosyalar = Collections.unmodifiableMap(new TreeMap<>(d));
            this.kitaplar = Collections.unmodifiableMap(new TreeMap<>(k));
            this.cikarilan = Collections.unmodifiableSet(new TreeSet<>(c));
            this.surum = surum;
            this.ikili = ikili;
        }

        public boolean bos() {
            return dosyalar.isEmpty() && kitaplar.isEmpty() && cikarilan.isEmpty();
        }

        public String surum() { return surum; }
        public int dosyaSayisi() { return dosyalar.size(); }
        public int kitapSayisi() { return kitaplar.size(); }
        public int cikarSayisi() { return cikarilan.size(); }
    }

    /* ------------------------------------------------------------------ durum */

    private final File kok;
    private final File depo;
    private final File kitapKok;
    private final File hazirlik;
    private final File hazirlikDepo;
    private final File hazirlikKitap;
    private final File indirme;
    private final File durumDosyasi;
    private final String ikili;
    private final Acici acici;
    private final Gunluk gunluk;
    private final Map<String, Object> kitapKilitleri = new HashMap<>();
    private volatile Tablo tablo;

    public EmppGKatman(File kok, String ikili, Acici acici, Gunluk gunluk) {
        this.kok = kok;
        this.depo = new File(kok, "depo");
        this.kitapKok = new File(kok, "kitap");
        this.hazirlik = new File(kok, "hazirlik");
        this.hazirlikDepo = new File(hazirlik, "depo");
        this.hazirlikKitap = new File(hazirlik, "kitap");
        this.indirme = new File(hazirlik, "indirme");
        this.durumDosyasi = new File(kok, "durum.txt");
        this.ikili = ikili == null ? "" : ikili;
        this.acici = acici == null ? HTTPS : acici;
        this.gunluk = gunluk;
        this.tablo = bosTablo();
        try {
            baslangic();
        } catch (Throwable t) {
            // Çekirdek hiçbir koşulda uygulamanın açılmasını engellemez: örtüsüz (APK) devam.
            this.tablo = bosTablo();
            log("başlangıç hatası — örtü yok sayıldı: " + t);
        }
    }

    private Tablo bosTablo() {
        return new Tablo(new HashMap<String, String>(), new HashMap<String, String[]>(),
            new HashSet<String>(), null, ikili);
    }

    private void log(String s) {
        if (gunluk != null) {
            try { gunluk.yaz("[EMPP_G] " + s); } catch (Throwable t) { /* yut */ }
        }
    }

    private void baslangic() throws IOException {
        // Önceki süreçten kalan yarım hazırlık (kesilen indirme, kesinleşmemiş açma) atılır.
        sil(hazirlik);
        dizinKur(depo);
        dizinKur(kitapKok);
        Tablo t = durumOku();
        if (t != null && !ikili.equals(t.ikili)) {
            log("APK değişti (" + t.ikili + " → " + ikili + ") — eski örtü atıldı");
            durumDosyasi.delete();
            t = null;
        }
        tablo = t != null ? t : bosTablo();
        gc(tablo);
        if (t != null && !t.bos()) {
            log("örtü etkin: sürüm " + kisalt(t.surum) + ", " + t.dosyalar.size() + " dosya, "
                + t.kitaplar.size() + " kitap, " + t.cikarilan.size() + " çıkarılan");
        }
    }

    public Tablo tablo() {
        return tablo;
    }

    public String ikili() {
        return ikili;
    }

    /* ------------------------------------------------------------------ rota */

    /**
     * WebView isteğinin yolu için örtü dosyası. `null` → APK'dan cevapla. {@link #YOK} → 404.
     * SICAK YOL: her istek için çağrılır — yalnız bellek araması, dosya sistemi çağrısı yok.
     */
    public File bul(String yol) {
        Tablo t = tablo;
        if (t == null || t.bos() || yol == null) return null;
        String rel = yol.startsWith("/") ? yol.substring(1) : yol;
        if (rel.isEmpty()) return null;
        String sha = t.dosyalar.get(rel);
        if (sha != null) return new File(depo, sha);
        int i = rel.indexOf('/');
        String dal = i < 0 ? rel : rel.substring(0, i);
        String[] kitap = t.kitaplar.get(dal);
        if (kitap != null) {
            if (i < 0) return YOK;
            String geri = rel.substring(i + 1);
            if (!yolGuvenliMi(geri)) return YOK;
            return new File(new File(kitapKok, kitap[0]), geri);
        }
        if (t.cikarilan.contains(dal)) return YOK;
        return null;
    }

    /** Etkin (örtü ya da APK) dosyanın sha256'sı; yoksa/okunamazsa `null`. */
    public String ozet(String yol, Varliklar apk) {
        String rel = yol == null ? "" : (yol.startsWith("/") ? yol.substring(1) : yol);
        if (!yolGuvenliMi(rel)) return null;
        Tablo t = tablo;
        String bilinen = t.dosyalar.get(rel);
        if (bilinen != null) return bilinen;
        File f = bul(rel);
        if (f == YOK) return null;
        InputStream in = null;
        try {
            if (f != null) {
                if (!f.isFile()) return null;
                in = new FileInputStream(f);
            } else {
                if (apk == null) return null;
                in = apk.ac("public/" + rel);
                if (in == null) return null;
            }
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] tampon = new byte[ARABELLEK];
            int n;
            while ((n = in.read(tampon)) > 0) md.update(tampon, 0, n);
            return hex(md.digest());
        } catch (Exception e) {
            return null;
        } finally {
            kapat(in);
        }
    }

    /* ------------------------------------------------------------------ ağ */

    public static boolean adresGuvenliMi(String adres) {
        try {
            URL u = new URL(adres);
            return "https".equals(u.getProtocol()) && u.getHost() != null && !u.getHost().isEmpty();
        } catch (Exception e) {
            return false;
        }
    }

    /** Üretim açıcısı: YALNIZ https; yönlendirme yalnız https→https (JDK kuralı). */
    public static final Acici HTTPS = new Acici() {
        @Override
        public Yanit ac(String adres, int zamanAsimiMs) throws IOException {
            if (!adresGuvenliMi(adres)) throw new IOException("adres-https-degil");
            HttpURLConnection b = (HttpURLConnection) new URL(adres).openConnection();
            b.setInstanceFollowRedirects(true);
            b.setConnectTimeout(zamanAsimiMs);
            b.setReadTimeout(zamanAsimiMs);
            b.setUseCaches(false);
            int durum = b.getResponseCode();
            if (!"https".equals(b.getURL().getProtocol())) {
                b.disconnect();
                throw new IOException("yonlendirme-https-degil");
            }
            InputStream g = durum >= 200 && durum < 300 ? b.getInputStream() : null;
            return new Yanit(durum, g);
        }
    };

    /** Küçük gövde (surum.json, manifest, imza, kabuk dosyası). Gövde yalnız 200'de döner. */
    public GetirSonucu getir(String adres, long tavan, int zamanAsimiMs) throws IOException {
        if (!adresGuvenliMi(adres)) throw new IOException("adres-https-degil");
        long sinir = tavan > 0 ? tavan : VARSAYILAN_TAVAN;
        Yanit y = acici.ac(adres, zamanAsimiMs);
        try {
            if (y.durum != 200 || y.govde == null) return new GetirSonucu(y.durum, null);
            ByteArrayOutputStream cikti = new ByteArrayOutputStream();
            byte[] tampon = new byte[ARABELLEK];
            long top = 0;
            int n;
            while ((n = y.govde.read(tampon)) > 0) {
                top += n;
                if (top > sinir) throw new IOException("govde-tavani");
                cikti.write(tampon, 0, n);
            }
            return new GetirSonucu(200, cikti.toByteArray());
        } finally {
            y.close();
        }
    }

    /* ------------------------------------------------------------ hazırlık */

    /** Kabuk dosyasını hazırlık deposuna yazar — sha256 TUTMAZSA hiçbir şey yazılmaz. */
    public synchronized void yaz(String sha256, byte[] veri) throws IOException {
        String sha = shaNormalle(sha256);
        if (veri == null) throw new IOException("veri-yok");
        if (!sha.equals(hex(ozetAl(veri)))) throw new IOException("sha256-uyusmaz");
        if (new File(depo, sha).isFile() || new File(hazirlikDepo, sha).isFile()) return;
        dizinKur(hazirlikDepo);
        File gecici = new File(hazirlikDepo, sha + ".yaziliyor");
        OutputStream o = new FileOutputStream(gecici);
        try {
            o.write(veri);
        } finally {
            kapat(o);
        }
        tasi(gecici, new File(hazirlikDepo, sha));
    }

    public static String klasorAdi(String dizin, String sha256) {
        return dizin + "-" + sha256.substring(0, 16);
    }

    /**
     * Kitap arşivini indirir → boyut + sha256 doğrular → güvenli açar → hazırlıkta bekletir.
     * Aynı arşiv bu süreçte zaten hazırlandıysa (sayfa değişip JS koşusu yeniden başladıysa)
     * önbellekten döner; eşzamanlı ikinci çağrı birincinin bitmesini bekler.
     */
    public KitapSonucu kitapKur(String dizin, String adres, String sha256, long boyut, int zamanAsimiMs)
        throws IOException {
        if (dizin == null || !DIZIN.matcher(dizin).matches() || ".".equals(dizin) || "..".equals(dizin)) {
            throw new IOException("dizin-gecersiz");
        }
        String sha = shaNormalle(sha256);
        if (boyut < 0) throw new IOException("boyut-gecersiz");
        if (!adresGuvenliMi(adres)) throw new IOException("adres-https-degil");
        String klasor = klasorAdi(dizin, sha);
        Object kilit;
        synchronized (kitapKilitleri) {
            kilit = kitapKilitleri.get(klasor);
            if (kilit == null) {
                kilit = new Object();
                kitapKilitleri.put(klasor, kilit);
            }
        }
        synchronized (kilit) {
            File kesin = new File(kitapKok, klasor);
            File hazir = new File(hazirlikKitap, klasor);
            if (kesin.isDirectory() || hazir.isDirectory()) {
                KitapSonucu s = incele(kesin.isDirectory() ? kesin : hazir);
                s.klasor = klasor;
                s.onbellekten = true;
                return s;
            }
            dizinKur(indirme);
            dizinKur(hazirlikKitap);
            File arsiv = new File(indirme, sha + ".zip");
            File parca = new File(indirme, sha + ".zip.parca");
            File acilan = new File(hazirlikKitap, klasor + ".acilan");
            try {
                indir(adres, parca, sha, boyut, zamanAsimiMs);
                tasi(parca, arsiv);
                sil(acilan);
                int adet = ac(arsiv, acilan);
                if (adet == 0) throw new IOException("arsiv-bos");
                tasi(acilan, hazir);
            } finally {
                parca.delete();
                arsiv.delete();
                sil(acilan);
            }
            KitapSonucu s = incele(hazir);
            s.klasor = klasor;
            log("kitap hazırlandı: " + dizin + " (" + s.dosyaSayisi + " dosya, " + boyut + " bayt)");
            return s;
        }
    }

    private void indir(String adres, File hedef, String sha, long boyut, int zamanAsimiMs) throws IOException {
        Yanit y = acici.ac(adres, zamanAsimiMs);
        OutputStream o = null;
        try {
            if (y.durum != 200 || y.govde == null) throw new IOException("durum-" + y.durum);
            MessageDigest md = ozetci();
            o = new FileOutputStream(hedef);
            byte[] tampon = new byte[ARABELLEK];
            long top = 0;
            int n;
            while ((n = y.govde.read(tampon)) > 0) {
                top += n;
                if (top > boyut) throw new IOException("boyut-uyusmaz");
                md.update(tampon, 0, n);
                o.write(tampon, 0, n);
            }
            if (top != boyut) throw new IOException("boyut-uyusmaz");
            if (!sha.equals(hex(md.digest()))) throw new IOException("sha256-uyusmaz");
        } finally {
            kapat(o);
            y.close();
        }
    }

    /** Zip'i `hedef` altına açar. Kaçan (mutlak, `..`, boş segment) tek girdi → TÜM arşiv RET. */
    static int ac(File arsiv, File hedef) throws IOException {
        dizinKur(hedef);
        String kokYolu = hedef.getCanonicalPath() + File.separator;
        ZipFile zip = new ZipFile(arsiv);
        int adet = 0;
        try {
            Enumeration<? extends ZipEntry> girdiler = zip.entries();
            byte[] tampon = new byte[ARABELLEK];
            while (girdiler.hasMoreElements()) {
                ZipEntry g = girdiler.nextElement();
                String ad = g.getName().replace('\\', '/');
                boolean dizinMi = g.isDirectory() || ad.endsWith("/");
                String temiz = dizinMi ? ad.replaceAll("/+$", "") : ad;
                if (temiz.isEmpty() && dizinMi) continue;
                if (!yolGuvenliMi(temiz)) throw new IOException("arsiv-yol-kacisi:" + ad);
                File f = new File(hedef, temiz);
                if (!f.getCanonicalPath().startsWith(kokYolu)) throw new IOException("arsiv-yol-kacisi:" + ad);
                if (dizinMi) {
                    dizinKur(f);
                    continue;
                }
                dizinKur(f.getParentFile());
                InputStream in = zip.getInputStream(g);
                OutputStream o = new FileOutputStream(f);
                try {
                    int n;
                    while ((n = in.read(tampon)) > 0) o.write(tampon, 0, n);
                } finally {
                    kapat(o);
                    kapat(in);
                }
                adet += 1;
            }
        } finally {
            zip.close();
        }
        return adet;
    }

    /** Açılmış kitabın Android'e hazır olup olmadığını gösteren işaretler (karar JS'de). */
    static KitapSonucu incele(File dizin) throws IOException {
        KitapSonucu s = new KitapSonucu();
        s.dosyaSayisi = say(dizin);
        File index = new File(dizin, "index.html");
        s.indexShimli = index.isFile() && icerir(index, SHIM);
        s.shimVar = new File(dizin, SHIM).isFile();
        s.manifestVar = new File(dizin, KITAP_MANIFESTI).isFile();
        return s;
    }

    /* ---------------------------------------------------------- kesinleştirme */

    /** `"2.51.4"` → {51, 4}; G3 biçimi dışındaysa `null`. */
    static long[] gSurumCoz(String s) {
        if (s == null) return null;
        java.util.regex.Matcher m = G_SURUM.matcher(s.trim());
        if (!m.matches()) return null;
        return new long[] {Long.parseLong(m.group(1)), Long.parseLong(m.group(2))};
    }

    /** a<b → -1, a=b → 0, a>b → 1; biri G3 değilse `null` (kıyaslanamaz). JS ile aynı. */
    public static Integer gSurumKiyasla(String a, String b) {
        long[] x = gSurumCoz(a);
        long[] y = gSurumCoz(b);
        if (x == null || y == null) return null;
        if (x[0] != y[0]) return x[0] < y[0] ? -1 : 1;
        if (x[1] != y[1]) return x[1] < y[1] ? -1 : 1;
        return 0;
    }

    /**
     * Planı ATOMİK uygular: taşı → `durum.txt` (geçici + rename) → bellek tablosu → artık temizliği.
     * Çıkarılan dizin → rota 404 (APK'daki kopya da gizlenir); eklenen/değişen dizinin altındaki
     * eski tekil dosya örtüleri düşer (bu manifest yeniden vermediyse).
     */
    public synchronized Tablo uygula(Plan p) throws IOException {
        if (p == null || p.surum == null || p.surum.trim().isEmpty() || !alanGuvenliMi(p.surum)) {
            throw new IOException("surum-gecersiz");
        }
        if (gSurumCoz(p.surum) == null) throw new IOException("surum-bicimi");
        Tablo eski = tablo;
        Integer kiyas = gSurumKiyasla(p.surum, eski.surum);
        if (kiyas != null && kiyas <= 0) throw new IOException("surum-eski:" + kisalt(eski.surum));
        Map<String, String> dosyalar = new TreeMap<>(eski.dosyalar);
        Map<String, String[]> kitaplar = new TreeMap<>(eski.kitaplar);
        Set<String> cikar = new TreeSet<>(eski.cikarilan);

        for (String c : p.cikarilan) {
            if (c == null || !DIZIN.matcher(c).matches()) throw new IOException("cikar-dizin-gecersiz:" + c);
            kitaplar.remove(c);
            cikar.add(c);
            dalAltiniSil(dosyalar, c);
        }
        for (String[] k : p.kitaplar) {
            if (k == null || k.length < 3 || k[0] == null || !DIZIN.matcher(k[0]).matches()) {
                throw new IOException("kitap-dizin-gecersiz");
            }
            String sha = shaNormalle(k[2]);
            if (!klasorAdi(k[0], sha).equals(k[1])) throw new IOException("kitap-klasor-uyusmaz:" + k[0]);
            if (!new File(kitapKok, k[1]).isDirectory() && !new File(hazirlikKitap, k[1]).isDirectory()) {
                throw new IOException("kitap-hazir-degil:" + k[0]);
            }
            cikar.remove(k[0]);
            dalAltiniSil(dosyalar, k[0]);
            kitaplar.put(k[0], new String[] {k[1], sha});
        }
        for (String[] d : p.dosyalar) {
            if (d == null || d.length < 2 || !yolGuvenliMi(d[0]) || !alanGuvenliMi(d[0])) {
                throw new IOException("dosya-yolu-gecersiz");
            }
            String sha = shaNormalle(d[1]);
            if (!new File(depo, sha).isFile() && !new File(hazirlikDepo, sha).isFile()) {
                throw new IOException("dosya-hazir-degil:" + d[0]);
            }
            dosyalar.put(d[0], sha);
        }

        // 1) Yerine taşı (henüz hiçbir istek bunları görmez: tablo değişmedi).
        for (String sha : new HashSet<>(dosyalar.values())) {
            File hedef = new File(depo, sha);
            File hazir = new File(hazirlikDepo, sha);
            if (!hedef.isFile() && hazir.isFile()) tasi(hazir, hedef);
            if (!hedef.isFile()) throw new IOException("depo-eksik:" + sha);
        }
        for (String[] k : kitaplar.values()) {
            File hedef = new File(kitapKok, k[0]);
            File hazir = new File(hazirlikKitap, k[0]);
            if (!hedef.isDirectory() && hazir.isDirectory()) tasi(hazir, hedef);
            if (!hedef.isDirectory()) throw new IOException("kitap-eksik:" + k[0]);
        }

        // 2) Durum — tek rename ile.
        Tablo yeni = new Tablo(dosyalar, kitaplar, cikar, p.surum.trim(), ikili);
        durumYaz(yeni);
        // 3) Bellek — bundan sonraki istekler yeni tabloyu görür.
        tablo = yeni;
        // 4) Artık (başvurulmayan depo dosyası / kitap klasörü) temizliği.
        gc(yeni);
        log("kesinleşti: sürüm " + kisalt(yeni.surum) + ", " + yeni.dosyalar.size() + " dosya, "
            + yeni.kitaplar.size() + " kitap, " + yeni.cikarilan.size() + " çıkarılan");
        return yeni;
    }

    private static void dalAltiniSil(Map<String, String> dosyalar, String dal) {
        String on = dal + "/";
        List<String> atilacak = new ArrayList<>();
        for (String y : dosyalar.keySet()) if (y.startsWith(on)) atilacak.add(y);
        for (String y : atilacak) dosyalar.remove(y);
    }

    private void gc(Tablo t) {
        Set<String> shalar = new HashSet<>(t.dosyalar.values());
        File[] depodakiler = depo.listFiles();
        if (depodakiler != null) {
            for (File f : depodakiler) if (!shalar.contains(f.getName())) sil(f);
        }
        Set<String> klasorler = new HashSet<>();
        for (String[] k : t.kitaplar.values()) klasorler.add(k[0]);
        File[] kitaplar = kitapKok.listFiles();
        if (kitaplar != null) {
            for (File f : kitaplar) if (!klasorler.contains(f.getName())) sil(f);
        }
    }

    /* ------------------------------------------------------ durum dosyası */

    private void durumYaz(Tablo t) throws IOException {
        StringBuilder b = new StringBuilder();
        b.append(BICIM).append('\n');
        b.append("ikili\t").append(t.ikili).append('\n');
        b.append("surum\t").append(t.surum).append('\n');
        for (Map.Entry<String, String> e : t.dosyalar.entrySet()) {
            b.append("dosya\t").append(e.getKey()).append('\t').append(e.getValue()).append('\n');
        }
        for (Map.Entry<String, String[]> e : t.kitaplar.entrySet()) {
            b.append("kitap\t").append(e.getKey()).append('\t').append(e.getValue()[0]).append('\t')
                .append(e.getValue()[1]).append('\n');
        }
        for (String c : t.cikarilan) b.append("cikar\t").append(c).append('\n');
        dizinKur(kok);
        File gecici = new File(kok, "durum.txt.yeni");
        FileOutputStream o = new FileOutputStream(gecici);
        try {
            o.write(b.toString().getBytes(StandardCharsets.UTF_8));
            o.getFD().sync();
        } finally {
            kapat(o);
        }
        tasi(gecici, durumDosyasi);
    }

    /** Bozuk/eksik durum → `null` (örtü yok). Tek bozuk satır bütün durumu geçersiz kılar. */
    Tablo durumOku() {
        if (!durumDosyasi.isFile()) return null;
        try {
            String metin = new String(oku(durumDosyasi), StandardCharsets.UTF_8);
            String[] satirlar = metin.split("\n");
            if (satirlar.length < 3 || !BICIM.equals(satirlar[0])) throw new IOException("bicim");
            Map<String, String> d = new HashMap<>();
            Map<String, String[]> k = new HashMap<>();
            Set<String> c = new HashSet<>();
            String surum = null;
            String ik = null;
            for (int i = 1; i < satirlar.length; i++) {
                String s = satirlar[i];
                if (s.isEmpty()) continue;
                String[] a = s.split("\t", -1);
                if ("ikili".equals(a[0]) && a.length == 2) ik = a[1];
                else if ("surum".equals(a[0]) && a.length == 2) surum = a[1];
                else if ("dosya".equals(a[0]) && a.length == 3 && yolGuvenliMi(a[1])
                    && SHA256.matcher(a[2]).matches() && new File(depo, a[2]).isFile()) d.put(a[1], a[2]);
                else if ("kitap".equals(a[0]) && a.length == 4 && DIZIN.matcher(a[1]).matches()
                    && SHA256.matcher(a[3]).matches() && klasorAdi(a[1], a[3]).equals(a[2])
                    && new File(kitapKok, a[2]).isDirectory()) k.put(a[1], new String[] {a[2], a[3]});
                else if ("cikar".equals(a[0]) && a.length == 2 && DIZIN.matcher(a[1]).matches()) c.add(a[1]);
                else throw new IOException("satir " + i);
            }
            if (surum == null || ik == null) throw new IOException("eksik alan");
            return new Tablo(d, k, c, surum, ik);
        } catch (Exception e) {
            log("durum.txt okunamadı (" + e.getMessage() + ") — örtü yok sayıldı");
            return null;
        }
    }

    /* ------------------------------------------------------------ yardımcılar */

    /** Göreli, posix, `..`/`.`/boş segmentsiz, NUL ve satır sonu içermeyen yol. */
    public static boolean yolGuvenliMi(String yol) {
        if (yol == null || yol.isEmpty() || yol.startsWith("/") || yol.indexOf('\\') >= 0) return false;
        if (!alanGuvenliMi(yol)) return false;
        for (String p : yol.split("/", -1)) {
            if (p.isEmpty() || ".".equals(p) || "..".equals(p)) return false;
        }
        return true;
    }

    private static boolean alanGuvenliMi(String s) {
        for (int i = 0; i < s.length(); i++) {
            char ch = s.charAt(i);
            if (ch == '\t' || ch == '\n' || ch == '\r' || ch == 0) return false;
        }
        return true;
    }

    private static String shaNormalle(String sha) throws IOException {
        String s = sha == null ? "" : sha.trim().toLowerCase(java.util.Locale.ROOT);
        if (!SHA256.matcher(s).matches()) throw new IOException("sha256-gecersiz");
        return s;
    }

    private static MessageDigest ozetci() throws IOException {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (Exception e) {
            throw new IOException("sha256-yok");
        }
    }

    private static byte[] ozetAl(byte[] veri) throws IOException {
        MessageDigest md = ozetci();
        return md.digest(veri);
    }

    static String hex(byte[] b) {
        StringBuilder s = new StringBuilder(b.length * 2);
        for (byte x : b) s.append(String.format("%02x", x & 0xff));
        return s.toString();
    }

    private static String kisalt(String s) {
        return s == null ? "-" : (s.length() > 12 ? s.substring(0, 12) + "…" : s);
    }

    private static byte[] oku(File f) throws IOException {
        InputStream in = new FileInputStream(f);
        try {
            ByteArrayOutputStream o = new ByteArrayOutputStream();
            byte[] t = new byte[ARABELLEK];
            int n;
            while ((n = in.read(t)) > 0) o.write(t, 0, n);
            return o.toByteArray();
        } finally {
            kapat(in);
        }
    }

    private static boolean icerir(File f, String aranan) throws IOException {
        byte[] b = oku(f);
        return new String(b, StandardCharsets.UTF_8).contains(aranan);
    }

    private static int say(File d) {
        File[] l = d.listFiles();
        if (l == null) return 0;
        int n = 0;
        for (File f : l) n += f.isDirectory() ? say(f) : 1;
        return n;
    }

    static void dizinKur(File d) throws IOException {
        if (d.isDirectory()) return;
        if (!d.mkdirs() && !d.isDirectory()) throw new IOException("dizin-kurulamadi:" + d.getName());
    }

    private static void tasi(File a, File b) throws IOException {
        if (!a.renameTo(b)) throw new IOException("tasinamadi:" + a.getName());
    }

    /** Katmanın KENDİ dizinleri içinde özyinelemeli silme (yalnız `filesDir/empp-g` altında çağrılır). */
    static void sil(File f) {
        if (f == null || !f.exists()) return;
        File[] l = f.isDirectory() ? f.listFiles() : null;
        if (l != null) for (File c : l) sil(c);
        f.delete();
    }

    private static void kapat(Closeable c) {
        if (c == null) return;
        try { c.close(); } catch (IOException e) { /* kapalı */ }
    }
}

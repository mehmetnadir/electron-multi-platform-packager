package com.empp.g;

import com.getcapacitor.Bridge;
import com.getcapacitor.ProcessedRoute;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/**
 * EmppGKatman + EmppGRota birim testleri — Mac JVM'inde (Android'siz) koşar.
 * Çağıran: `src/platforms/android/g-java.test.js` (node --test). Çıktı: "SONUC gecti=N kaldi=M".
 */
public final class EmppGTest {

    static int gecti = 0;
    static int kaldi = 0;

    static void dogru(boolean k, String ad) {
        if (k) { gecti++; System.out.println("ok   " + ad); }
        else { kaldi++; System.out.println("KALDI " + ad); }
    }

    interface Govde { void kos() throws Exception; }

    static void atar(Govde g, String beklenen, String ad) {
        try {
            g.kos();
            dogru(false, ad + " (istisna bekleniyordu)");
        } catch (Exception e) {
            String m = String.valueOf(e.getMessage());
            dogru(beklenen == null || m.contains(beklenen), ad + " [" + m + "]");
        }
    }

    static String sha(byte[] b) throws Exception {
        return EmppGKatman.hex(MessageDigest.getInstance("SHA-256").digest(b));
    }

    static byte[] zip(Map<String, String> girdiler) throws Exception {
        ByteArrayOutputStream o = new ByteArrayOutputStream();
        ZipOutputStream z = new ZipOutputStream(o);
        for (Map.Entry<String, String> e : girdiler.entrySet()) {
            z.putNextEntry(new ZipEntry(e.getKey()));
            z.write(e.getValue().getBytes(StandardCharsets.UTF_8));
            z.closeEntry();
        }
        z.close();
        return o.toByteArray();
    }

    /** Sahte açıcı: adres → (durum, gövde). İstek sayısını tutar. */
    static final class Sahte implements EmppGKatman.Acici {
        final Map<String, byte[]> govde = new HashMap<>();
        final Map<String, Integer> durum = new HashMap<>();
        int istek = 0;
        @Override
        public EmppGKatman.Yanit ac(String adres, int z) throws IOException {
            istek++;
            Integer d = durum.get(adres);
            byte[] b = govde.get(adres);
            if (d == null) d = b == null ? 404 : 200;
            return new EmppGKatman.Yanit(d, b == null ? null : new ByteArrayInputStream(b));
        }
    }

    static File gecici() throws IOException {
        return Files.createTempDirectory("emppg").toFile();
    }

    static String oku(File f) throws IOException {
        return new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8);
    }

    public static void main(String[] a) throws Exception {
        // --- yol güvenliği ---
        dogru(EmppGKatman.yolGuvenliMi("index.html"), "yol: index.html güvenli");
        dogru(EmppGKatman.yolGuvenliMi("book1/43e23fce2b7009474555a77.js"), "yol: book1/motor güvenli");
        for (String kotu : new String[] {"", "/abs", "../x", "a/../b", "a//b", "a/./b", "a\\b", "a\tb", "a/"}) {
            dogru(!EmppGKatman.yolGuvenliMi(kotu), "yol reddi: '" + kotu.replace("\t", "\\t") + "'");
        }
        dogru(EmppGKatman.adresGuvenliMi("https://x.test/a"), "adres: https kabul");
        dogru(!EmppGKatman.adresGuvenliMi("http://127.0.0.1/a"), "adres: http (loopback dahil) RET");
        dogru(!EmppGKatman.adresGuvenliMi("file:///etc/passwd"), "adres: file RET");

        File kok = gecici();
        Sahte ag = new Sahte();
        EmppGKatman k = new EmppGKatman(kok, "ikili-1", ag, null);
        dogru(k.tablo().bos() && k.bul("/index.html") == null, "boş katman: her istek APK'ya");

        // --- getir ---
        atar(() -> k.getir("http://127.0.0.1/surum.json", 0, 1000), "adres-https-degil", "getir: http reddi (istek atılmadan)");
        dogru(ag.istek == 0, "getir: http için ağa hiç çıkılmadı");
        EmppGKatman.GetirSonucu s404 = k.getir("https://t.test/yok", 0, 1000);
        dogru(s404.durum == 404 && s404.veri == null, "getir: 404 → gövdesiz");
        ag.govde.put("https://t.test/buyuk", new byte[100]);
        atar(() -> k.getir("https://t.test/buyuk", 10, 1000), "govde-tavani", "getir: tavan aşımı RET");

        // --- yaz: sha256 tutmazsa hiçbir şey yazılmaz ---
        byte[] index = "<html><head><script src=\"empp-android-shim.js\"></script></head>YENI</html>".getBytes(StandardCharsets.UTF_8);
        String indexSha = sha(index);
        atar(() -> k.yaz(indexSha, "baska".getBytes(StandardCharsets.UTF_8)), "sha256-uyusmaz", "yaz: sha uyuşmazlığı RET");
        dogru(!new File(kok, "hazirlik/depo/" + indexSha).exists(), "yaz: uyuşmazlıkta hazırlığa dosya düşmedi");
        k.yaz(indexSha, index);
        dogru(new File(kok, "hazirlik/depo/" + indexSha).isFile(), "yaz: doğru sha hazırlıkta");
        dogru(k.bul("/index.html") == null, "yaz: kesinleşmeden rota değişmez");

        // --- uygula: eksik hazırlık → atomik RET, tablo ve durum değişmez ---
        EmppGKatman.Plan kotuPlan = new EmppGKatman.Plan();
        kotuPlan.surum = "2.51.0";
        kotuPlan.dosyalar.add(new String[] {"index.html", indexSha});
        kotuPlan.dosyalar.add(new String[] {"config/settings.json", sha("olmayan".getBytes(StandardCharsets.UTF_8))});
        atar(() -> k.uygula(kotuPlan), "dosya-hazir-degil", "uygula: hazır olmayan dosya → RET");
        dogru(k.tablo().bos() && !new File(kok, "durum.txt").exists(), "uygula: RET sonrası tablo/durum dokunulmadı");

        // --- uygula: index ---
        EmppGKatman.Plan p1 = new EmppGKatman.Plan();
        p1.surum = "2.51.1";
        p1.dosyalar.add(new String[] {"index.html", indexSha});
        k.uygula(p1);
        File f = k.bul("/index.html");
        dogru(f != null && f.isFile() && oku(f).contains("YENI"), "uygula: /index.html örtüden");
        dogru(k.bul("/book1/x.png") == null, "uygula: örtüsüz yol APK'ya");
        dogru(oku(new File(kok, "durum.txt")).startsWith("EMPP-G 1\nikili\tikili-1\nsurum\t2.51.1\n"), "uygula: durum.txt biçimi");

        // --- rota (Capacitor RouteProcessor) ---
        EmppGRota rota = new EmppGRota(k);
        ProcessedRoute r1 = rota.process("", "/index.html");
        dogru(r1.getPath().equals(Bridge.CAPACITOR_FILE_START + f.getAbsolutePath()) && r1.isAsset() && !r1.isIgnoreAssetPath(),
            "rota: dosya isteği → _capacitor_file_ öneki, isAsset=true (paylaşılan alan değişmez)");
        ProcessedRoute r2 = rota.process("public", "/index.html");
        dogru(r2.getPath().equals(f.getAbsolutePath()) && !r2.isAsset(), "rota: kök gezinme → mutlak yol, isAsset=false");
        ProcessedRoute r3 = rota.process("", "/book1/x.png");
        dogru(r3.getPath().equals("/book1/x.png") && r3.isAsset() && !r3.isIgnoreAssetPath(), "rota: örtüsüz dosya → Capacitor varsayılanı");
        ProcessedRoute r4 = rota.process("public", "/index.html".replace("index", "yok"));
        dogru(r4.getPath().equals("public/yok.html") && r4.isAsset(), "rota: örtüsüz kök → basePath+path");

        // --- yeniden başlatma: aynı APK → örtü korunur; APK değişti → atılır ---
        EmppGKatman k2 = new EmppGKatman(kok, "ikili-1", ag, null);
        dogru(k2.bul("/index.html") != null && "2.51.1".equals(k2.tablo().surum()), "yeniden başlatma: aynı APK → örtü korunur");
        new File(kok, "hazirlik/depo").mkdirs();
        new FileOutputStream(new File(kok, "hazirlik/depo/yarim")).close();
        EmppGKatman k3 = new EmppGKatman(kok, "ikili-2", ag, null);
        dogru(k3.bul("/index.html") == null && k3.tablo().surum() == null, "APK değişti → eski örtü atıldı");
        dogru(!new File(kok, "hazirlik").exists(), "başlangıç: yarım hazırlık temizlendi");
        dogru(!new File(kok, "depo/" + indexSha).exists(), "APK değişti → depo artığı temizlendi");

        // --- bozuk durum.txt → örtü yok (APK) ---
        File kok2 = gecici();
        EmppGKatman b1 = new EmppGKatman(kok2, "i", ag, null);
        b1.yaz(indexSha, index);
        EmppGKatman.Plan pb = new EmppGKatman.Plan();
        pb.surum = "2.51.1";
        pb.dosyalar.add(new String[] {"index.html", indexSha});
        b1.uygula(pb);
        Files.write(new File(kok2, "durum.txt").toPath(),
            (oku(new File(kok2, "durum.txt")) + "dosya\t../kacis\t" + indexSha + "\n").getBytes(StandardCharsets.UTF_8));
        EmppGKatman b2 = new EmppGKatman(kok2, "i", ag, null);
        dogru(b2.bul("/index.html") == null, "bozuk durum.txt (kaçan yol satırı) → örtü tümden yok sayıldı");

        // --- kitap: indir + doğrula + aç ---
        File kok3 = gecici();
        Sahte ag3 = new Sahte();
        EmppGKatman kk = new EmppGKatman(kok3, "i", ag3, null);
        Map<String, String> kitap = new HashMap<>();
        kitap.put("index.html", "<head><script src=\"empp-android-shim.js\"></script></head>KITAP7");
        kitap.put("empp-android-shim.js", "//shim");
        kitap.put("empp-manifest.json", "{}");
        kitap.put("assets/1/data/BookContent.xml", "<x/>");
        byte[] z = zip(kitap);
        String zsha = sha(z);
        String url = "https://t.test/book7.zip";
        ag3.govde.put(url, z);
        atar(() -> kk.kitapKur("book7", url, sha("baska".getBytes(StandardCharsets.UTF_8)), z.length, 1000), "sha256-uyusmaz", "kitap: sha uyuşmazlığı RET");
        atar(() -> kk.kitapKur("book7", url, zsha, z.length - 1, 1000), "boyut-uyusmaz", "kitap: boyut uyuşmazlığı RET");
        atar(() -> kk.kitapKur("book7", "http://t.test/b.zip", zsha, z.length, 1000), "adres-https-degil", "kitap: http RET");
        atar(() -> kk.kitapKur("../x", url, zsha, z.length, 1000), "dizin-gecersiz", "kitap: kaçan dizin RET");
        File hz = new File(kok3, "hazirlik/kitap");
        String[] hzl = hz.list();
        dogru(hzl == null || hzl.length == 0, "kitap: reddedilenlerden hazırlıkta klasör kalmadı");
        Map<String, String> kacan = new HashMap<>(kitap);
        kacan.put("../../kacti.txt", "x");
        byte[] zk = zip(kacan);
        ag3.govde.put("https://t.test/kacan.zip", zk);
        atar(() -> kk.kitapKur("book8", "https://t.test/kacan.zip", sha(zk), zk.length, 1000), "arsiv-yol-kacisi", "kitap: zip-slip girdisi → TÜM arşiv RET");
        dogru(!new File(kok3, "kacti.txt").exists() && !new File(kok3.getParentFile(), "kacti.txt").exists(), "kitap: zip-slip hiçbir şey yazmadı");
        EmppGKatman.KitapSonucu ks = kk.kitapKur("book7", url, zsha, z.length, 1000);
        dogru(ks.klasor.equals("book7-" + zsha.substring(0, 16)) && ks.dosyaSayisi == 4 && ks.indexShimli && ks.shimVar && ks.manifestVar,
            "kitap: hazırlandı + Android işaretleri");
        dogru(new File(kok3, "hazirlik/kitap/" + ks.klasor).isDirectory() && !new File(kok3, "kitap/" + ks.klasor).exists()
            && kk.bul("/book7/index.html") == null, "kitap: kesinleşmeden YALNIZ hazırlıkta; rota görmez (ya hep ya hiç)");
        int onceki = ag3.istek;
        EmppGKatman.KitapSonucu ks2 = kk.kitapKur("book7", url, zsha, z.length, 1000);
        dogru(ks2.onbellekten && ag3.istek == onceki, "kitap: aynı arşiv ikinci kez indirilmez (önbellek)");
        Map<String, String> ciplak = new HashMap<>();
        ciplak.put("index.html", "<head></head>WINDOWS");
        byte[] zc = zip(ciplak);
        ag3.govde.put("https://t.test/ciplak.zip", zc);
        EmppGKatman.KitapSonucu kc = kk.kitapKur("book9", "https://t.test/ciplak.zip", sha(zc), zc.length, 1000);
        dogru(!kc.indexShimli && !kc.shimVar && !kc.manifestVar, "kitap: Android'e hazırlanmamış arşiv işaretleri false (karar JS'de)");

        // --- gerileme testi: bugünkü Android reddini GERÇEK Java EmppGKatman.incele() ile yeniden üretme ---
        File sahteElectronKitap = gecici();
        File indexElectron = new File(sahteElectronKitap, "index.html");
        try (FileOutputStream os = new FileOutputStream(indexElectron)) {
            os.write("<html><body>Salt Electron Kitap</body></html>".getBytes(StandardCharsets.UTF_8));
        }
        EmppGKatman.KitapSonucu sRet = EmppGKatman.incele(sahteElectronKitap);
        dogru(!sRet.indexShimli, "incele: salt Electron dizin -> indexShimli=false (ret sinyali)");
        dogru(!sRet.shimVar, "incele: salt Electron dizin -> shimVar=false (ret sinyali)");
        dogru(!sRet.manifestVar, "incele: salt Electron dizin -> manifestVar=false");

        File shimliAndroidKitap = gecici();
        File indexShim = new File(shimliAndroidKitap, "index.html");
        try (FileOutputStream os = new FileOutputStream(indexShim)) {
            os.write("<html><head><script src=\"empp-android-shim.js\"></script></head><body>Android Kitap</body></html>".getBytes(StandardCharsets.UTF_8));
        }
        File shimDosya = new File(shimliAndroidKitap, "empp-android-shim.js");
        try (FileOutputStream os = new FileOutputStream(shimDosya)) {
            os.write("// android shim".getBytes(StandardCharsets.UTF_8));
        }
        File manifestDosya = new File(shimliAndroidKitap, "empp-manifest.json");
        try (FileOutputStream os = new FileOutputStream(manifestDosya)) {
            os.write("{}".getBytes(StandardCharsets.UTF_8));
        }
        EmppGKatman.KitapSonucu sKabul = EmppGKatman.incele(shimliAndroidKitap);
        dogru(sKabul.indexShimli, "incele: shimli dizin -> indexShimli=true");
        dogru(sKabul.shimVar, "incele: shimli dizin -> shimVar=true");
        dogru(sKabul.manifestVar, "incele: shimli dizin -> manifestVar=true");

        // engine + kitap + çıkar birlikte
        byte[] motor = "/*motor-yeni*/".getBytes(StandardCharsets.UTF_8);
        String msha = sha(motor);
        kk.yaz(msha, motor);
        EmppGKatman.Plan p2 = new EmppGKatman.Plan();
        p2.surum = "2.51.2";
        p2.dosyalar.add(new String[] {"book1/43e23fce2b7009474555a77.js", msha});
        p2.kitaplar.add(new String[] {"book7", ks.klasor, zsha});
        p2.cikarilan.add("book3");
        kk.uygula(p2);
        File km = kk.bul("/book1/43e23fce2b7009474555a77.js");
        dogru(km != null && oku(km).contains("motor-yeni"), "uygula: book1 motoru örtüden");
        File k7 = kk.bul("/book7/index.html");
        dogru(k7 != null && oku(k7).contains("KITAP7"), "uygula: eklenen book7 örtüden");
        dogru(kk.bul("/book7/assets/1/data/BookContent.xml").isFile(), "uygula: eklenen kitabın derin dosyası");
        dogru(kk.bul("/book7/yok.png") != null && !kk.bul("/book7/yok.png").exists(), "eklenen kitapta olmayan dosya APK'ya DÜŞMEZ (404)");
        dogru(kk.bul("/book7/../index.html") == EmppGKatman.YOK && kk.bul("/book7//x") == EmppGKatman.YOK, "eklenen kitapta kaçan/boş segment → 404");
        dogru(kk.bul("/book3/index.html") == EmppGKatman.YOK && kk.bul("/book3") == EmppGKatman.YOK, "çıkarılan book3 → 404");
        dogru(kk.bul("/book1/index.html") == null, "dokunulmayan book1/index.html APK'ya");
        dogru(!new File(kok3, "hazirlik/kitap/" + ks.klasor).exists() && new File(kok3, "kitap/" + ks.klasor).isDirectory(),
            "uygula: kitap hazırlıktan yerine taşındı");
        ProcessedRoute r404 = new EmppGRota(kk).process("", "/book3/x.png");
        dogru(r404.getPath().equals(Bridge.CAPACITOR_FILE_START + EmppGKatman.YOK.getAbsolutePath()), "rota: çıkarılan → var olmayan dosya (Capacitor 404)");

        // yeniden ekleme: tombstone kalkar, dal altındaki eski tekil örtü düşer
        byte[] motor2 = "/*motor-book7*/".getBytes(StandardCharsets.UTF_8);
        kk.yaz(sha(motor2), motor2);
        EmppGKatman.Plan p3 = new EmppGKatman.Plan();
        p3.surum = "2.51.3";
        p3.dosyalar.add(new String[] {"book7/43e23fce2b7009474555a77.js", sha(motor2)});
        kk.uygula(p3);
        dogru(oku(kk.bul("/book7/43e23fce2b7009474555a77.js")).contains("motor-book7"), "tekil motor örtüsü eklenen kitabın üstünde");
        EmppGKatman.Plan p4 = new EmppGKatman.Plan();
        p4.surum = "2.51.4";
        p4.kitaplar.add(new String[] {"book7", ks.klasor, zsha});
        p4.kitaplar.add(new String[] {"book3", ks.klasor.replace("book7", "book3"), zsha});
        atar(() -> kk.uygula(p4), "kitap-hazir-degil", "uygula: hazırlanmamış book3 → RET (atomik)");
        dogru("2.51.3".equals(kk.tablo().surum()) && kk.bul("/book3/x") == EmppGKatman.YOK, "RET sonrası önceki tablo aynen");
        EmppGKatman.Plan p5 = new EmppGKatman.Plan();
        p5.surum = "2.51.5";
        p5.kitaplar.add(new String[] {"book7", ks.klasor, zsha});
        kk.uygula(p5);
        File yeniden = kk.bul("/book7/43e23fce2b7009474555a77.js");
        dogru(yeniden != null && !yeniden.exists() && yeniden.getParentFile().getName().equals(ks.klasor),
            "yeniden eklenen kitabın altındaki eski tekil örtü düştü (artık arşivin kendi dosyası sorulur)");
        dogru(!new File(kok3, "depo/" + sha(motor2)).exists(), "gc: başvurulmayan depo dosyası silindi");
        EmppGKatman.Plan p6 = new EmppGKatman.Plan();
        p6.surum = "2.51.6";
        p6.cikarilan.add("book7");
        kk.uygula(p6);
        dogru(kk.bul("/book7/index.html") == EmppGKatman.YOK && !new File(kok3, "kitap/" + ks.klasor).exists(),
            "çıkarılan G kitabı: 404 + klasörü silindi");

        // --- MONOTON SÜRÜM (savunma derinliği; JS atlansa da eski örtü geri gelmez) ---
        dogru(EmppGKatman.gSurumKiyasla("2.51.10", "2.51.9") == 1 && EmppGKatman.gSurumKiyasla("2.51.4", "2.52.0") == -1
            && EmppGKatman.gSurumKiyasla("2.51.4", "2.51.4") == 0 && EmppGKatman.gSurumKiyasla("2.51.4", "e3b0c442") == null
            && EmppGKatman.gSurumKiyasla("2.051.4", "2.51.4") == null, "G3 kıyası sayısal; biçim dışı kıyaslanmaz");
        EmppGKatman.Plan esit = new EmppGKatman.Plan();
        esit.surum = "2.51.6";
        atar(() -> kk.uygula(esit), "surum-eski", "uygula: EŞİT sürüm → RET");
        EmppGKatman.Plan geri = new EmppGKatman.Plan();
        geri.surum = "2.51.5";
        geri.cikarilan.add("book1");
        atar(() -> kk.uygula(geri), "surum-eski", "uygula: ESKİ sürüm (yeniden oynatma) → RET");
        EmppGKatman.Plan hashSurum = new EmppGKatman.Plan();
        hashSurum.surum = "e3b0c44298fc1c14";
        atar(() -> kk.uygula(hashSurum), "surum-bicimi", "uygula: G3 dışı sürüm → RET");
        dogru("2.51.6".equals(kk.tablo().surum()) && kk.bul("/book1/index.html") == null
            && oku(new File(kok3, "durum.txt")).contains("surum\t2.51.6\n"), "sürüm RET'lerinden sonra tablo + durum.txt aynen");
        EmppGKatman.Plan ileri = new EmppGKatman.Plan();
        ileri.surum = "2.51.10";
        kk.uygula(ileri);
        dogru("2.51.10".equals(kk.tablo().surum()), "uygula: KESİN büyük (2.51.10 > 2.51.6, sayısal) kabul");

        // ozet: örtü tablodan, APK varlıktan, YOK → null
        EmppGKatman.Varliklar apk = new EmppGKatman.Varliklar() {
            @Override
            public InputStream ac(String yol) throws IOException {
                if ("public/book1/index.html".equals(yol)) return new ByteArrayInputStream("APK".getBytes(StandardCharsets.UTF_8));
                throw new IOException("yok");
            }
        };
        dogru(msha.equals(kk.ozet("book1/43e23fce2b7009474555a77.js", apk)), "ozet: örtü dosyası tablodan");
        dogru(sha("APK".getBytes(StandardCharsets.UTF_8)).equals(kk.ozet("book1/index.html", apk)), "ozet: APK varlığı hash'lenir");
        dogru(kk.ozet("book3/index.html", apk) == null && kk.ozet("../x", apk) == null && kk.ozet("book2/yok", apk) == null,
            "ozet: çıkarılan/kaçan/olmayan → null");

        System.out.println("SONUC gecti=" + gecti + " kaldi=" + kaldi);
        System.exit(kaldi == 0 ? 0 : 1);
    }
}

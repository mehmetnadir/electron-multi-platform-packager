package com.empp.g;

import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * EMPP G — JS istemcisinin (`empp-g-istemci.js`) yerel köprüsü. Politika JS'de; burada yalnız
 * mekanizma: https getir, hazırlığa yaz (sha256 tutmazsa RET), kitap indir+aç, atomik uygula.
 * Uzun işler kendi iş parçacığında koşar (Capacitor eklenti hattını tıkamaz).
 */
@CapacitorPlugin(name = "EmppG")
public class EmppGPlugin extends Plugin {

    private static final int ZAMAN_ASIMI = 15000;
    private static final int KITAP_ZAMAN_ASIMI = 60000;
    private final ExecutorService is = Executors.newSingleThreadExecutor();

    private EmppGKatman k() {
        return EmppGRota.katman(getContext());
    }

    private EmppGKatman.Varliklar apk() {
        return new EmppGKatman.Varliklar() {
            @Override
            public InputStream ac(String yol) throws IOException {
                return getContext().getAssets().open(yol);
            }
        };
    }

    /** APK varlığı → UTF-8 metin (örtüden DEĞİL — G bunları asla değiştiremez). */
    private String varlikMetni(String yol) throws IOException {
        InputStream in = getContext().getAssets().open(yol);
        try {
            ByteArrayOutputStream o = new ByteArrayOutputStream();
            byte[] t = new byte[8192];
            int n;
            while ((n = in.read(t)) > 0) o.write(t, 0, n);
            return new String(o.toByteArray(), StandardCharsets.UTF_8);
        } finally {
            in.close();
        }
    }

    /**
     * Pakete gömülü `empp-set.json` (ham metin — ayrıştırma ve doğrulama JS'de) + varsa
     * `empp-g-paket.json` (paketin kendi sürümü → monoton sürüm tabanı).
     */
    @PluginMethod
    public void yapilandirma(PluginCall call) {
        JSObject r = new JSObject();
        try {
            r.put("metin", varlikMetni("public/empp-set.json"));
        } catch (Throwable e) {
            call.reject("yapilandirma-yok");
            return;
        }
        try {
            r.put("paket", varlikMetni("public/empp-g-paket.json"));
        } catch (Throwable e) {
            // Paket sürümü yok → kurulu sürüm yalnız son uygulanan G'dir (JS kararı).
        }
        call.resolve(r);
    }

    @PluginMethod
    public void durum(PluginCall call) {
        EmppGKatman.Tablo t = k().tablo();
        JSObject r = new JSObject();
        r.put("surum", t.surum() == null ? JSONObject.NULL : t.surum());
        r.put("ikili", k().ikili());
        r.put("dosya", t.dosyaSayisi());
        r.put("kitap", t.kitapSayisi());
        r.put("cikar", t.cikarSayisi());
        call.resolve(r);
    }

    @PluginMethod
    public void getir(final PluginCall call) {
        final String adres = call.getString("adres");
        final long tavan = sayi(call, "tavan", 0L);
        is.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    EmppGKatman.GetirSonucu s = k().getir(adres, tavan, ZAMAN_ASIMI);
                    JSObject r = new JSObject();
                    r.put("durum", s.durum);
                    if (s.veri != null) r.put("b64", Base64.encodeToString(s.veri, Base64.NO_WRAP));
                    call.resolve(r);
                } catch (Throwable e) {
                    call.reject(mesaj(e));
                }
            }
        });
    }

    @PluginMethod
    public void ozetler(final PluginCall call) {
        final JSArray yollar = call.getArray("yollar");
        is.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    JSObject o = new JSObject();
                    for (int i = 0; yollar != null && i < yollar.length(); i++) {
                        String y = yollar.getString(i);
                        String s = k().ozet(y, apk());
                        o.put(y, s == null ? JSONObject.NULL : s);
                    }
                    JSObject r = new JSObject();
                    r.put("ozetler", o);
                    call.resolve(r);
                } catch (Throwable e) {
                    call.reject(mesaj(e));
                }
            }
        });
    }

    @PluginMethod
    public void yaz(final PluginCall call) {
        final String sha = call.getString("sha256");
        final String b64 = call.getString("b64");
        is.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    byte[] veri = Base64.decode(b64 == null ? "" : b64, Base64.DEFAULT);
                    k().yaz(sha, veri);
                    JSObject r = new JSObject();
                    r.put("tamam", true);
                    call.resolve(r);
                } catch (Throwable e) {
                    call.reject(mesaj(e));
                }
            }
        });
    }

    @PluginMethod
    public void kitapKur(final PluginCall call) {
        final String dizin = call.getString("dizin");
        final String adres = call.getString("adres");
        final String sha = call.getString("sha256");
        final long boyut = sayi(call, "boyut", -1L);
        is.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    EmppGKatman.KitapSonucu s = k().kitapKur(dizin, adres, sha, boyut, KITAP_ZAMAN_ASIMI);
                    JSObject r = new JSObject();
                    r.put("klasor", s.klasor);
                    r.put("dosyaSayisi", s.dosyaSayisi);
                    r.put("indexShimli", s.indexShimli);
                    r.put("shimVar", s.shimVar);
                    r.put("manifestVar", s.manifestVar);
                    r.put("onbellekten", s.onbellekten);
                    call.resolve(r);
                } catch (Throwable e) {
                    call.reject(mesaj(e));
                }
            }
        });
    }

    @PluginMethod
    public void uygula(final PluginCall call) {
        final JSObject g = call.getData();
        is.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    EmppGKatman.Plan p = new EmppGKatman.Plan();
                    p.surum = g.getString("surum");
                    JSONArray d = g.optJSONArray("dosyalar");
                    for (int i = 0; d != null && i < d.length(); i++) {
                        JSONObject x = d.getJSONObject(i);
                        p.dosyalar.add(new String[] {x.getString("yol"), x.getString("sha256")});
                    }
                    JSONArray kt = g.optJSONArray("kitaplar");
                    for (int i = 0; kt != null && i < kt.length(); i++) {
                        JSONObject x = kt.getJSONObject(i);
                        p.kitaplar.add(new String[] {x.getString("dizin"), x.getString("klasor"), x.getString("sha256")});
                    }
                    JSONArray c = g.optJSONArray("cikarilan");
                    for (int i = 0; c != null && i < c.length(); i++) p.cikarilan.add(c.getString(i));
                    EmppGKatman.Tablo t = k().uygula(p);
                    JSObject r = new JSObject();
                    r.put("surum", t.surum());
                    r.put("dosya", t.dosyaSayisi());
                    r.put("kitap", t.kitapSayisi());
                    r.put("cikar", t.cikarSayisi());
                    call.resolve(r);
                } catch (Throwable e) {
                    call.reject(mesaj(e));
                }
            }
        });
    }

    /**
     * Sayı alanı. `PluginCall.getLong` yalnız `Long` örneğini tanır; JSON'dan gelen küçük sayılar
     * `Integer` olduğu için varsayılana düşerdi (ölçüldü: Capacitor 7.6.7 `PluginCall.java:196`).
     */
    static long sayi(PluginCall call, String ad, long varsayilan) {
        Object v = call.getData().opt(ad);
        if (v instanceof Number) return ((Number) v).longValue();
        if (v instanceof String) {
            try { return Long.parseLong((String) v); } catch (NumberFormatException e) { return varsayilan; }
        }
        return varsayilan;
    }

    private static String mesaj(Throwable e) {
        String m = e.getMessage();
        return m == null || m.isEmpty() ? e.getClass().getSimpleName() : m;
    }
}

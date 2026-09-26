package com.empp.g;

import android.app.Activity;
import android.content.Context;
import android.content.pm.PackageInfo;
import android.util.Log;
import com.getcapacitor.Bridge;
import com.getcapacitor.ProcessedRoute;
import com.getcapacitor.RouteProcessor;
import java.io.File;

/**
 * EMPP G — WebView istekleri ÖNCE yazılabilir katmandan (`filesDir/empp-g`), yoksa APK'dan.
 *
 * Capacitor 7 `RouteProcessor`'ı (`Bridge.Builder.setRouteProcessor`, resmi kanca) her yerel
 * istekte yolu sorar. İki çağrı biçimi vardır (`WebViewLocalServer`):
 *   • `process("", "/book1/x.png")` — dosya isteği. Örtü varsa `/_capacitor_file_<mutlak>`
 *     döneriz: Capacitor bu öneki `isAsset`'e BAKMADAN dosyadan açar; `isAsset` her zaman
 *     `true` kalır (Capacitor bu alanı iş parçacıkları arasında paylaşıyor — değiştirmeyiz).
 *   • `process("public", "/index.html")` — kök gezinme (`/` ve uzantısız yollar). Burada
 *     Capacitor `isAsset`'e bakar; örtülü kök index için `false` zorunlu (tek istisna).
 * Örtü yoksa Capacitor'ın kendi davranışı birebir korunur (`basePath + path`, varlık).
 *
 * ÇÖKMEZ: rota içindeki her hata APK'ya düşer — güncelleme katmanı uygulamayı kapatamaz.
 */
public final class EmppGRota implements RouteProcessor {

    private static final String ETIKET = "EmppG";
    private static volatile EmppGKatman ortak;

    private final EmppGKatman katman;

    public EmppGRota(EmppGKatman katman) {
        this.katman = katman;
    }

    /** Süreç başına TEK katman (rota ve eklenti aynı tabloyu görsün). */
    public static synchronized EmppGKatman katman(Context c) {
        if (ortak == null) {
            Context uyg = c.getApplicationContext() != null ? c.getApplicationContext() : c;
            ortak = new EmppGKatman(new File(uyg.getFilesDir(), "empp-g"), ikiliKimligi(uyg), EmppGKatman.HTTPS,
                new EmppGKatman.Gunluk() {
                    @Override
                    public void yaz(String satir) {
                        Log.i(ETIKET, satir);
                    }
                });
        }
        return ortak;
    }

    /** APK kimliği: her kurulum/güncelleme `lastUpdateTime`'ı değiştirir → eski örtü atılır. */
    static String ikiliKimligi(Context c) {
        try {
            PackageInfo p = c.getPackageManager().getPackageInfo(c.getPackageName(), 0);
            return p.lastUpdateTime + ":" + p.versionName;
        } catch (Throwable t) {
            return "bilinmiyor";
        }
    }

    /** MainActivity'den `super.onCreate`'ten ÖNCE çağrılır. Hata → rota kurulmaz, APK olduğu gibi. */
    public static void kur(Activity a, Bridge.Builder kurucu) {
        try {
            kurucu.setRouteProcessor(new EmppGRota(katman(a)));
        } catch (Throwable t) {
            Log.w(ETIKET, "[EMPP_G] rota kurulamadı — APK içeriğiyle devam: " + t);
        }
    }

    @Override
    public ProcessedRoute process(String basePath, String path) {
        ProcessedRoute r = new ProcessedRoute();
        String taban = basePath == null ? "" : basePath;
        try {
            File f = katman.bul(path);
            if (f != null) {
                if (taban.isEmpty()) {
                    r.setPath(Bridge.CAPACITOR_FILE_START + f.getAbsolutePath());
                    r.setAsset(true);
                } else {
                    r.setPath(f.getAbsolutePath());
                    r.setAsset(false);
                }
                r.setIgnoreAssetPath(false);
                return r;
            }
        } catch (Throwable t) {
            // APK'ya düş.
        }
        r.setPath(taban + path);
        r.setAsset(true);
        r.setIgnoreAssetPath(false);
        return r;
    }
}

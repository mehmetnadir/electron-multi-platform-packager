'use strict';
/**
 * K9 — Android "ağ bilgisi" yerel eklentisi (2026-09-22).
 *
 * NEDEN: Nadir istedi — uygulama Wi-Fi'deyken kitap güncellemeleri (yeşil bulut)
 * kendiliğinden insin, mobil veride inmesin. WebView'da `navigator.connection.type`
 * "unknown" döner (telefonda ölçüldü, BES Yabancı Dil 74451) → JS bağlantı türünü
 * BİLEMEZ. Bu modül Capacitor şablonuna küçük bir yerel eklenti ekler:
 * `Capacitor.nativePromise('EmppAg','durum')` → { bagli, olculen, wifi }.
 *
 * Ölçüt "Wi-Fi" değil ÜCRETLENDİRİLMEYEN bağlantıdır (`isActiveNetworkMetered`):
 * telefondan açılan paylaşımlı Wi-Fi ölçülen bağlantıdır, orada otomatik indirme OLMAZ.
 * ACCESS_NETWORK_STATE "normal" izindir — kullanıcıya izin ekranı ÇIKMAZ.
 *
 * Saf fonksiyonlar (metin → metin); packagingService dosyaya yazar.
 * BOZARSAN: `ag-bilgisi.test.js` kırılır.
 */

const IZIN = 'android.permission.ACCESS_NETWORK_STATE';
const KAYIT = 'registerPlugin(EmppAgPlugin.class);';

function eklentiJava(pkg) {
  return `package ${pkg};

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkInfo;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** EMPP K9: bağlantı ücretlendiriliyor mu? (otomatik kitap güncellemesi için) */
@CapacitorPlugin(name = "EmppAg")
public class EmppAgPlugin extends Plugin {
    @PluginMethod
    public void durum(PluginCall call) {
        JSObject r = new JSObject();
        boolean bagli = false, wifi = false, olculen = true;
        try {
            ConnectivityManager cm =
                (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm != null) {
                olculen = cm.isActiveNetworkMetered();
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    Network n = cm.getActiveNetwork();
                    NetworkCapabilities c = n == null ? null : cm.getNetworkCapabilities(n);
                    bagli = c != null && c.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
                    wifi = c != null && c.hasTransport(NetworkCapabilities.TRANSPORT_WIFI);
                } else {
                    NetworkInfo i = cm.getActiveNetworkInfo();
                    bagli = i != null && i.isConnected();
                    wifi = bagli && i.getType() == ConnectivityManager.TYPE_WIFI;
                }
            }
        } catch (Exception e) {
            olculen = true; // bilinmiyorsa ÖLÇÜLEN say: yanlışlıkla mobil veri harcama
        }
        r.put("bagli", bagli);
        r.put("olculen", olculen);
        r.put("wifi", wifi);
        call.resolve(r);
    }
}
`;
}

/** MainActivity'de `super.onCreate`'ten ÖNCE eklenti kaydı (Capacitor 3+ kuralı). */
function mainActivityYamasi(src) {
  if (src.includes(KAYIT)) return src;
  const yeni = src.replace(/(\n([ \t]*)super\.onCreate\(savedInstanceState\);)/,
    (tam, satir, girinti) => `\n${girinti}${KAYIT}${satir}`);
  if (yeni === src) throw new Error('MainActivity: super.onCreate bulunamadı — EmppAg kaydedilemedi');
  return yeni;
}

function manifestYamasi(xml) {
  if (xml.includes(IZIN)) return xml;
  const yeni = xml.replace(/(<application\b)/, `<uses-permission android:name="${IZIN}" />\n    $1`);
  if (yeni === xml) throw new Error('AndroidManifest: <application> bulunamadı');
  return yeni;
}

module.exports = { eklentiJava, mainActivityYamasi, manifestYamasi, IZIN, KAYIT };

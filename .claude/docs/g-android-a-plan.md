# G-Android Seçenek A Planı (Nadir onayı)

## 1. Bugünkü Akış
* **Manifest Şeması (`tools/g-yayin/durum.js:142` `birlestir`):** Sadece tek arşiv bilgisi (`kaynak`, `sha256`, `boyut`) tutulur.
* **Android İstemcisinin Reddettiği Yer (`src/platforms/android/empp-g-istemci.js:412`):** Kitap arşivi İNDİRİLDİKTEN sonra `yerel.kitapKur` çağrılır ve Java'dan dönen `s.indexShimli`, `s.shimVar` ve `s.manifestVar` işaretleri eksikse `throw new Bitis('red', 'kitap-android-hazir-degil:' + k.dizin);` ile donukluğa yol açılır.
* **Electron'un İşlediği Yer (`src/runtime/kitap-guncelleyici.js:824`):** Kitaplar hedefe açılır, kabuk kopyalanır, atomik rename ile `index.html` güncellenerek işlenir (fs-shim'li arşiv çalışır).

## 2. Manifest Şema Değişikliği
* **Yeni Alanlar:** `ekle` manifest objesine `kaynak` yanına Android için `androidKaynak`, `androidSha256` ve `androidBoyut` eklenecek (`tools/g-yayin/durum.js:207`).
* **Geriye Uyum:** Electron istemcisi (`src/runtime/kitap-guncelleyici.js:680`) manifest'teki Android alanlarını aramayacağı için aynen çalışmaya devam eder.
* **İmza Kapsamı:** Yeni alanlar JSON objesine dahil edildiğinden, imza (`tools/g-yayin/yayinla.js:105` ve `empp-g-istemci.js:218`) şema genişlemesini doğrudan (ham baytlar üzerinden) korur.

## 3. Ortak Android Arşiv Üretim Modülü
* **Çıkarılacak Fonksiyonlar:** `src/packaging/packagingService.js` içindeki `normalizeBookViewerViewports` etrafında (satır ~4825-4900) bulunan `empp-android-shim.js` kopyalaması, `__webviewCompatShim` eklenmesi ve `empp-manifest.json` türetimi (K3 Kuralı) yeni modüle çıkarılacak.
* **Girdi / Çıktı:** Girdi: Pakete eklenecek ham kitap dizini. Çıktı: Android'in beklediği formatta shimlenmiş `bookN-android.zip`.
* **Boyut Tahmini:** Kitap boyutuna ek olarak sadece shim metinleri ekleneceği için +10-20KB fark olur.

## 4. Android JS İstemci Değişikliği
* **İndirmeden Reddetme:** `src/platforms/android/empp-g-istemci.js:261` (`planKur`) adımına şu kural eklenecek: `if (!k.androidKaynak) return { red: 'android-arsivi-eksik:' + k.dizin };`. İstemci, zip indirmeye HİÇ başlamadan güncellemeyi reddedecek.
* **Kalıcı Donmanın Kırılması:** Eski donuk setler (kurulu sürümden büyük `surum.json` geldiğinde tetiklenenler), yeni G yayını çıktığında eski eklemelerin de `androidKaynak` adresini alacaktır. Bu sayede doğru arşiv indirilecek ve donukluk kendiliğinden kırılacaktır.

## 5. Gerileme Testi
* **Dosya / Test:** `src/platforms/android/g-java/test/com/empp/g/EmppGTest.java`
* **Nasıl Koşar:** `node src/platforms/android/g-java.test.js`
* **Kanıt:** İçi salt Electron yapısında olan (kökte `empp-android-shim.js` olmayan) sahte bir dizin Java `EmppGKatman.incele()` metoduna verilecek. Metodun `s.indexShimli`, `s.shimVar` için `false` döndürdüğü kodla kanıtlanacak (Bugünkü reddetme yeniden üretilecek).

## 6. Yayın Atomikliği ve G-Yayın Değişikliği
* **Atomiklik:** Eğer ortak Android modülü bir kitap dizinini uyarlayamazsa (örn. eksik `index.html`), işlem `tools/g-yayin/yayinla.js` ana döngüsünde istisna atarak duracak; uyarlanamayan ekleme tüm platformları durdurur (Nadir onayı).
* **Değişiklik:** Mevcut "Android Ekleme Kapısı" (satır 541 `androidEklemeKapisi`) kaldırılarak, yerine Electron ve Android için iki ayrı ZIP oluşturulması ve oluşan bu özetlerin manifest'e yansıtılması eklenecek.

## 7. İş Bölümü (agy-filo)
* **İş 1:** Android Arşiv Ortak Modülü. `packagingService.js`'ten Android shim/manifest uyarlamasını (satır ~4825-4900) bağımsız bir saf Node.js modülüne çıkarma.
  * *Kabul / Doğrulama:* `packagingService.js` referansları yeni modüle güncellenecek; testleri `node tests/android-arsiv-uretec.test.js` ile geçmeli.
* **İş 2:** Android JS İstemcisi İndirmeden Ret. `empp-g-istemci.js:261`'e eksik `androidKaynak` için `red` dönme kuralı eklenecek.
  * *Kabul / Doğrulama:* Testler güncellenecek; `node src/platforms/android/empp-g-istemci.test.js` 0 hata vermeli.
* **İş 3:** Gerileme Testi (Java incele). `EmppGTest.java` dosyasına eksik shim durumu için test eklenecek.
  * *Kabul / Doğrulama:* `node src/platforms/android/g-java.test.js` başarılı sonuçlanmalı.
* **İş 4:** Yayın Atomikliği ve G-Yayın Değişikliği. `durum.js`'nin manifest birleştirmesi ve `yayinla.js`'nin iki ayrı ZIP çağrısı eklenip eski kapı kaldırılacak.
  * *Kabul / Doğrulama:* Başarısız uyarlama tüm yayını Error atarak kesmeli; `node tools/g-yayin/yayinla.test.js` ve CLI üzerinden `--ekle` simülasyonu çalışmalı.

## 8. Riskler ve Ölçümler
* **Risk 1:** Yeni ortak modülde okuma/yazma izin hataları (EACCES). *Ölçüm:* Modülde tüm fs çağrılarına `try/catch` sarmalı ve detaylı log eklenmesi.
* **Risk 2:** İki arşiv yüklemenin CDN/G-Yayın sürelerini uzatması. *Ölçüm:* G-Yayın anındaki zip oluşturma ve yükleme süreleri konsol çıktısından takip edilecek.
* **Varsayım:** İstemci tarafında `surum.json` tetikleyicisi Android donmasını geçersiz kılıp manifesti tekrar indirecektir. *Kanıt:* `src/platforms/android/empp-g-istemci.js:31-35` ("surum kurulu sürümden kesin büyükse manifest istenmez/istenir").

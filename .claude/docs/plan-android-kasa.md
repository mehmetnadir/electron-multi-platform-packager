# Plan — Android üretimi ve kabulü kasaya (Windows) taşınır, Mac yedek kalır

Tarih: 09.10.2026 · Durum: TASLAK, Nadir kararı bekliyor · Yazan: Şef (ölçümle)

## 1. Bugünkü durum (ölçüm 08-09.10)

| Konu | Mac (bugün) | Kasa (bugün) |
|---|---|---|
| Android yeteneği | `AGENT_CAPS=mac,android`; evde kapalı, ofiste açık | `windows,kaynak-r2`; Android yok |
| JDK | openjdk@21 | yalnız Java 1.8 |
| Android SDK | ~/Library/Android/sdk; x86_64 + arm64 android-35 imajı | yok |
| Emülatör kabulü | `Pixel_Fold_API_35` arm64, `-no-window`, RAM 11444 | yok |
| APK imzası | `~/.android/debug.keystore` (2618 B); gradle `assembleDebug` imzalar | yok |
| Donanım | M-serisi | i7-7700 4c/8t, 16 GB RAM, D: 1187 GB boş, VT-x+SLAT açık, Hyper-V KAPALI |
| Yük | aynı anda Mac + Android üretir; 5 set kabulde RED ("System UI isn't responding") | boş RAM 6,5 GB, 4 node süreci (Windows üretimi) |

Android işi Mac'te 6–13 dk sürer. Kabul RED'lerinin sebebi emülatör yükü (Mac aynı anda Mac paketi kurar).

## 2. Hedef

```
kasa canlı ──► Android üretim + emülatör kabulü KASADA (öncelik)
kasa sessiz ≥15 dk ──► Mac Android'i devralır (ofiste ya da android-serbest.istek)
kasa geri geldi ──► Mac Android'i bırakır
```

## 3. Adımlar

### A. Kasaya araç zinciri (1 gün, Windows üretimi durmaz)

| # | İş | Yer | Kanıt |
|---|---|---|---|
| A1 | JDK 21 (Temurin msi) | `D:\araclar\jdk21` | `java -version` → 21 |
| A2 | cmdline-tools + `sdkmanager "platform-tools" "build-tools;35.0.0" "platforms;android-35" "emulator" "system-images;android-35;google_apis;x86_64"` | `D:\android-sdk` | `sdkmanager --list_installed` |
| A3 | Hızlandırıcı: AEHD (`extras;google;Android_Emulator_Hypervisor_Driver` + `silent_install.bat`) | sürücü | `sc query aehd` → RUNNING |
| A4 | AVD `Pixel_Fold_API_35` x86_64, RAM 2048, 2 çekirdek | `D:\android-avd` | `emulator -list-avds` |
| A5 | `GRADLE_USER_HOME=D:\gradle` + `gradle.properties` Mac ile birebir (`-Xmx3g`, daemon=false) | D: | dosya md5 |
| A6 | Defender dışlaması: `D:\empp-ajan`, `D:\android-sdk`, `D:\gradle`, `D:\android-avd`; LongPathsEnabled=1 | kayıt defteri | PowerShell çıktısı |
| A7 | `ortam.ps1`: `AGENT_CAPS='windows,android,kaynak-r2'`, `JAVA_HOME`, `ANDROID_HOME`, `ANDROID_SDK_ROOT`, `ANDROID_AVD_HOME` | kasa | md5 kapısı |

Hyper-V kapalı ve başka sanal makine yok → AEHD doğru seçim. WHPX için Hyper-V özelliği + yeniden başlatma gerekir; kasa Windows üretimi kesilir. AEHD sürücü olarak yüklenir; yeniden başlatma ihtiyacı yükleme anında ölçülür.
**UYARI:** A3 sürücü yükler. Yeniden başlatma gerekirse Windows kuyruğu boşken yapılır (hat bekçisi S7 üretim kapısı).

### B. Kod: paketleyici Windows'ta Android kurar (yarım gün, test kapılı)

| # | Dosya | Değişiklik | Test |
|---|---|---|---|
| B1 | `packagingService.js` `runGradleBuild` | `win32` → `gradlew.bat`; `chmod` atlanır; `ANDROID_HOME` varsayılanı Mac yoluna düşmez (env zorunlu, yoksa açık hata) | birim testi: platform sahtesi |
| B2 | `packagingService.js` `getJavaHome` | `bin/java.exe` de aranır; `/usr/libexec/java_home` yalnız darwin | birim testi |
| B3 | `tools/kabul/android-cihaz.js` | `adb.exe`, `emulator.exe`; `uiautomator`/`screencap` aynı; kanıt dizini `D:\empp-kabul\android\<id>\` | sahte SDK ağacı testi |
| B4 | `runner-helpers.js etkinYetenekler` | yeni girdi `androidDevral`: Mac, kasa Android ilan ediyorsa (`build_agents.last_seen_at` < 15 dk ve caps `android`) Android'i düşürür; kasa sessizse geri alır | 4 durum testi |
| B5 | `windows-serit.js` benzeri `android-serit.js` (kasa için) | Android eşzamanlılık 1; Windows kurulumu sürerken Android kabulü beklemeye alınır (semafor) | birim testi |
| B6 | `hat-bekcisi.js` S9 | kasa Android ajanı ilan ediyor mu, AEHD çalışıyor mu, AVD var mı; sapmada ntfy `bekci` | plan fonksiyonu testi |

B4 için sunucu tarafı veri hazır: `build_agents(name, capabilities, last_seen_at)`.

### C. İmza anahtarı (NADİR KARARI)

Kasa kendi `debug.keystore`unu üretirse APK imzası değişir. Kurulu uygulama güncellenemez
(`INSTALL_FAILED_UPDATE_INCOMPATIBLE`). Seçenekler:

| Seçenek | Sonuç |
|---|---|
| C1 Mac'teki `~/.android/debug.keystore` kasaya kopyalanır (scp, `C:\Users\Administrator\.android\`) | imza aynı; "imza anahtarı Mac'ten çıkmaz" kuralına istisna gerekir |
| C2 Kasa yeni anahtar üretir | kurulu APK'lar kaldırılıp yeniden kurulur; tahtalarda elle iş |

Öneri: C1. Anahtar hata ayıklama anahtarıdır (parola standart). Yine de karar Nadir'in.

### D. Doğrulama (1 set, sonra 5 RED set)

1. 60014 (Sonic Monic 1) kasada `android` ile kuyruğa alınır.
2. Ölçüm: süre, RAM tepe, kabul sonucu, ekran görüntüsü kanıtı, APK imza parmak izi = Mac parmak izi.
3. Geçerse 60015, 60016, 45792, 45478, 45100 requeue (sırayla, eşzamanlılık 1).
4. 3 gün kasa birincil; Mac yalnız kasa sessizken. Hat bekçisi raporunda `android: kasa|mac`.

### E. Mac yedek kipi

- Mac'te `android` yeteneği kalır. B4 kapısı kasa canlıyken düşürür.
- Kasa ≥15 dk sessiz → Mac devralır; ev kuralı (`android-serbest.istek`) aynen geçerli.
- Kasa geri gelince Mac yeni iş almaz; süren işi bitirir.

## 4. Riskler

| Risk | Önlem |
|---|---|
| 16 GB RAM: Windows Electron kurulumu + gradle 3 GB + emülatör 2 GB | B5 semaforu; kabul Windows kurulumu bitince |
| İlk gradle indirmesi 1–2 GB, Defender yavaşlatır | A5 D: önbellek, A6 dışlama |
| Emülatör ilk açılış 2–3 dk | AVD `-snapshot` ile ikinci açılış hızlı; `CIHAZ_KITAP_SN=120` korunur |
| AEHD yeniden başlatma isterse | Windows kuyruğu boşken, hat bekçisi S7 |
| Kasa kodu md5 kapılı dağıtım | B1–B5 agent-mode'a merge, kasaya scp + `yeniden-baslat.istek` |

## 5. Süre

A (araç zinciri) 1 gün · B (kod) 0,5 gün · C karar · D (doğrulama) 1 gün · E ile birlikte 3 gün gözlem.

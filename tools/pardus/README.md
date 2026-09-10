# Pardus (.impark) Docker Paketleyici Araçları

Bu dizin, bu Mac'te (agent) srv21'in `packageLinux` paketleme adımını Docker
konteynerinde **BİREBİR** koşturan araç setidir. `src/agent/runner.js` içindeki
pardus dalı (`CONFIG.pardusBuildScript`) bu dizindeki `pardus-packager-build.sh`'ı
çağırır.

## Dosyalar

| Dosya | Amaç |
|---|---|
| `pardus-packager-build.sh` | Giriş noktası. `<build.zip\|build-dizini> <urun-adi> <cikti-dizini> [surum]` alır, idempotent Docker imajı kurar/kullanır, tek-build kilidi + disk kapısı uygular, Rosetta+AppImage binfmt kaydını yapar, konteyneri koşturur, `.impark`'ı doğrulayıp çıktı dizinine taşır. |
| `Dockerfile.packager-linux` | `packager-linux:1` imajının tanımı (linux/amd64, electron-builder + fpm zinciri). |
| `packager-entry.sh` | Konteyner içindeki giriş betiği (imaj `ENTRYPOINT`'i). |
| `packager-run-linux.js` | Konteyner içinde repo'nun `packageLinux`'ını çağıran Node betiği. |
| `impark-dogrula.sh` | Üretilen `.impark`'ın bütünlüğünü (squashfs offset 193728) ve AppRun/asar imzalarını kontrol eden doğrulama betiği. |
| `ref-bloktest-asar-root.txt` | `impark-dogrula.sh`'ın karşılaştırdığı referans imza dosyası. |

## Gereksinimler

- Docker Desktop (Apple Silicon Mac'te **Rosetta** ayarı açık — betik `rosetta-appimage`
  binfmt kaydını konteyner başına kendisi yapar, ama Docker Desktop'ın Rosetta
  desteği kapalıysa `linux/amd64` imaj kurulumu/koşumu başarısız olur).
- `linux/amd64` platform desteği (Apple Silicon'da Rosetta üzerinden emülasyon).
- En az `PARDUS_MIN_FREE_GB` (varsayılan 20 GB) boş disk.

## Kullanım

```bash
tools/pardus/pardus-packager-build.sh <build.zip|build-dizini> <urun-adi> <cikti-dizini> [surum]
```

Betik kendi konumundan (`TOOLS`) ve repo kökünden (`REPO`, `TOOLS/../..`) çalışır —
`PARDUS_TOOLS` / `PACKAGER_REPO` env değişkenleriyle override edilebilir. `runner.js`
normalde `PARDUS_BUILD_SCRIPT` env'i boşsa bu dizindeki betiği otomatik bulur
(`path.join(__dirname, '..', '..', 'tools', 'pardus', 'pardus-packager-build.sh')`).

## Silinirse buradan geri gelir

Bu araçlar önceden `/Users/nadir/01dev/pardus/tools/` altında, git dışı (izsiz
silinmeye açık) duruyordu. Artık bu reponun bir parçası — `git log` ile geri
gelir. Eski yol geriye dönük uyumluluk için sembolik bağ olarak duruyor:

```
/Users/nadir/01dev/pardus/tools -> /Users/nadir/01dev/electron-multi-platform-packager/tools/pardus
```

Eski yolu kullanan bir çağıran varsa kırılmaz; ama yeni çağıranlar doğrudan
`tools/pardus/...` kullanmalı.

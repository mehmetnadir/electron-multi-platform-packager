# shellcheck shell=bash
# ProBook kabul kapısı — SON KARAR (probook-kabul.sh `source` eder; test: kabul-karar.test.js).
#
# Karar sınıfları (rapor ~/.empp-agent/arastirma/e2e-kanit-pardus-kabul-20260926.md §B.1):
#   0 GEÇTİ              yükle
#   1 RED-KUSUR          failed (paket kusuru)
#   3 RED-GÜNCEL-DEĞİL   failed + "güncel değil:" + yeniden kuyruk önerisi (paket yüklenmez)
#   4 ÖLÇÜLEMEDİ         failed YAZILMAZ, kira dolunca kuyruğa döner
# Kural: bir kontrol ölçemediyse GEÇTİ sayılmaz (sahte yeşil yasak) — ama ölçmeyen kontrol
# BAYRAKLA açılır ki canlı kuyruk bir anda durmasın.
#
# Bu fonksiyona gelindiğinde pencere + menü piksel ölçümü GEÇMİŞTİR (erken RED'ler
# probook-kabul.sh içinde `red` ile çıkar). Girdi ortam değişkenleridir:
#   AKT_EKRAN  1 = aktivasyon ekranı görüldü (aktivasyon kodlu seri + renk < 500)
#   AKT_SERI   1 = aktivasyon kodlu seri (EMPP_AKTIVASYON_BEKLENIR)
#   AKT_OLC    1 = KABUL_AKTIVASYON_OLCULEMEDI (içerik ölçülemeyen aktivasyon → ÖLÇÜLEMEDİ)
#   CDP        1 = E6/E7 koşturuldu (KABUL_CDP)
#   AYRI_EV    1 = uygulama ayrı ev diziniyle açıldı (E8; CDP=1 iken varsayılan)
#   E6 E6_SEBEP      GECTI | RED | OLCULEMEDI | ATLANDI
#   E7 E7_AYRINTI E7_ONERI   DOLU | BOS | YOK | OLCULEMEDI | ATLANDI
# Çıktı: KARAR_KOD, KARAR (GECTI|RED-KUSUR|RED-GUNCEL-DEGIL|OLCULEMEDI), KARAR_SEBEP, KARAR_NOT
#
# Öncelik (gerekçeli):
#  0. CDP açık ama ayrı ev YOK (KABUL_AYRI_EV=0) → ÖLÇÜLEMEDİ, ASLA GEÇTİ. Canlı ölçüm 26.09 (45482,
#     aynı paket): gerçek HOME'daki K örtüsü (~/.config/<ad>/work, 25.09 indirmesi) motora
#     versiyon=36 sordurdu → E7 BOS → yanlış GEÇTİ; ayrı evde versiyon=33 → Data dolu → GÜNCEL-DEĞİL.
#     Örtü E6'yı da değiştirebilir (motor güncellemeyi indirirken okuyucu açılmaz) → RED de güvenilmez.
#  1. E7 DOLU → GÜNCEL-DEĞİL. E6 RED'den önce gelir: `Data` doluysa motor kitabı açmadan önce
#     güncellemeyi indirmeye kalkar ("Kitap Güncelleniyor %x"), okuyucu 60 sn'de çizilmeyebilir —
#     kök neden eskiliktir, kusur değil.
#  2. Aktivasyon ekranı → içerik ölçülemez: bayrak açıksa ÖLÇÜLEMEDİ, kapalıysa bugünkü kural
#     (motor çalıştı, GEÇTİ + "ICERIK dogrulanmadi").
#  3. CDP kapalı → bugünkü kapı (piksel) GEÇTİ.
#  4. E6 GEÇTİ → GEÇTİ.  5. Aktivasyon serisinde E6 geçmediyse (diyalog kitabı açtırmaz) → 2 gibi.
#  6. E6 RED → RED-KUSUR.  7. Geri kalan (CDP bağlanamadı, menü tanınmadı) → ÖLÇÜLEMEDİ.
kabul_karar(){
  KARAR_NOT=""
  if [ "${CDP:-0}" = "1" ] && [ "${AYRI_EV:-0}" != "1" ]; then
    KARAR_KOD=4; KARAR="OLCULEMEDI"
    KARAR_SEBEP="E7 yalniz ayri evde guvenilir: KABUL_AYRI_EV=0 ile gercek HOME'daki K ortusu motorun sordugu surumu degistirir (45482: gercek HOME v36, ayri ev v33) — GECTI verilmez"
    KARAR_NOT="gercek HOME olcumu: E6=${E6:-?} E7=${E7:-?} ${E7_AYRINTI:-}"
    return 0
  fi
  if [ "${E7:-}" = "DOLU" ]; then
    KARAR_KOD=3; KARAR="RED-GUNCEL-DEGIL"
    KARAR_SEBEP="E7 ${E7_AYRINTI:-}"
    [ -n "${E6:-}" ] && [ "${E6}" != "GECTI" ] && KARAR_NOT="E6=${E6} (${E6_SEBEP:-})"
    return 0
  fi
  if [ "${AKT_EKRAN:-0}" = "1" ]; then
    if [ "${AKT_OLC:-0}" = "1" ]; then
      KARAR_KOD=4; KARAR="OLCULEMEDI"
      KARAR_SEBEP="aktivasyon ekrani: motor acildi ama kitap ICERIGI olculemedi (KABUL_AKTIVASYON_OLCULEMEDI=1)"
    else
      KARAR_KOD=0; KARAR="GECTI"
      KARAR_SEBEP="aktivasyon ekrani — motor acildi ve kod istedi; ICERIK dogrulanmadi"
    fi
    return 0
  fi
  if [ "${CDP:-0}" != "1" ]; then
    KARAR_KOD=0; KARAR="GECTI"; KARAR_SEBEP="pencere + menu pikseli (E6/E7 kapali)"
    return 0
  fi
  if [ "${E6:-}" = "GECTI" ]; then
    KARAR_KOD=0; KARAR="GECTI"; KARAR_SEBEP="E6 ${E6_SEBEP:-}"
    return 0
  fi
  if [ "${AKT_SERI:-0}" = "1" ]; then
    if [ "${AKT_OLC:-0}" = "1" ]; then
      KARAR_KOD=4; KARAR="OLCULEMEDI"
      KARAR_SEBEP="aktivasyon kodlu seri: kitap acilamadi, ICERIK olculemedi (E6=${E6:-?}: ${E6_SEBEP:-})"
    else
      KARAR_KOD=0; KARAR="GECTI"
      KARAR_SEBEP="aktivasyon kodlu seri — menu acildi; ICERIK dogrulanmadi (E6=${E6:-?}: ${E6_SEBEP:-})"
    fi
    return 0
  fi
  if [ "${E6:-}" = "RED" ]; then
    KARAR_KOD=1; KARAR="RED-KUSUR"; KARAR_SEBEP="E6 ${E6_SEBEP:-}"
    return 0
  fi
  KARAR_KOD=4; KARAR="OLCULEMEDI"; KARAR_SEBEP="E6 ${E6:-?}: ${E6_SEBEP:-olculmedi}"
  return 0
}

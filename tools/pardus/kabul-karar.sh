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
#   SET_TUM SET_TUM_AYRINTI SET_TUM_ONERI SET_TUM_NOT   (KABUL_SET_TUM=1; yoksa boş → etkisiz)
#              GECTI | GUNCEL_DEGIL | OLCULEMEDI | ATLANDI — SET'in HER alt kitabının menü sürümü
#              İmpark'a doğrudan soruldu (cdp-kitap-ac --set-tum 1 → tools/kabul/set-guncellik.js)
# Çıktı: KARAR_KOD, KARAR (GECTI|RED-KUSUR|RED-GUNCEL-DEGIL|OLCULEMEDI), KARAR_SEBEP, KARAR_NOT,
#        KARAR_ONERI (GÜNCEL-DEĞİL'de yeniden kuyruk önerisi)
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
#  S. SET_TUM (1-7'den SONRA, kabul_karar sarmalı): motor yalnız AÇILAN kitabı sorar — SM2 Set
#     26.09: 58336 soruldu (güncel), 58237 v7 hiç sorulmadı, İmpark v14. SET_TUM paketin kendi
#     menülerinden ölçer (ev/örtüden bağımsız):
#     GUNCEL_DEGIL → GEÇTİ / ÖLÇÜLEMEDİ / GÜNCEL-DEĞİL kararı RED-GUNCEL-DEGIL (3) olur, hangi alt
#       kitap(lar) sebepte. RED-KUSUR (E6) KALIR (açılan kitap kusurlu — eskilik onu açıklamaz), not düşülür.
#     OLCULEMEDI → karar DEĞİŞMEZ (E7 ÖLÇÜLEMEDİ/YOK ile aynı politika), KARAR_NOT'a satır.
#     GECTI / ATLANDI → karar değişmez, KARAR_NOT'a satır.
kabul_karar(){
  kabul_karar_temel
  KARAR_ONERI="${E7_ONERI:-}"
  local st="${SET_TUM_AYRINTI:-}"
  case "${SET_TUM:-}" in
    GUNCEL_DEGIL)
      if [ "$KARAR_KOD" = "1" ]; then
        KARAR_NOT="${KARAR_NOT:+$KARAR_NOT; }SET_TUM GÜNCEL-DEĞİL: $st"
        return 0
      fi
      if [ "$KARAR_KOD" = "3" ]; then
        KARAR_SEBEP="$KARAR_SEBEP; $st"
        KARAR_ONERI="${E7_ONERI:+$E7_ONERI | }${SET_TUM_ONERI:-}"
      else
        [ "$KARAR_KOD" = "0" ] || KARAR_NOT="${KARAR_NOT:+$KARAR_NOT; }SET_TUM oncesi karar: $KARAR ($KARAR_SEBEP)"
        KARAR_KOD=3; KARAR="RED-GUNCEL-DEGIL"; KARAR_SEBEP="$st"; KARAR_ONERI="${SET_TUM_ONERI:-}"
      fi
      ;;
    OLCULEMEDI) KARAR_NOT="${KARAR_NOT:+$KARAR_NOT; }SET_TUM ÖLÇÜLEMEDİ (karar değişmez): $st" ;;
    GECTI|ATLANDI) KARAR_NOT="${KARAR_NOT:+$KARAR_NOT; }SET_TUM ${SET_TUM}: $st" ;;
  esac
  return 0
}
kabul_karar_temel(){
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

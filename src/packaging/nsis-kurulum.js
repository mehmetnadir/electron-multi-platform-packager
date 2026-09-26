'use strict';

/**
 * NSIS KURULUM GÖRÜNÜRLÜĞÜ + ZAMANLAMA (Windows paketleme sözleşmesi, madde 6
 * "boş ekran"; Nadir 2026-09-20: "çift tıkladıktan hemen sonra kurulumun başladığını
 * göremiyorum ... öğretmenler tekrar tıklıyor").
 *
 * Ölçülen kusurlar (electron-builder 26.0.12 şablonu, SM2: 4.090 dosya, 7z 693,7 MB,
 * açık 936,5 MB):
 *   1. Pencere çıkana kadar hiçbir işaret yok.
 *   2. SpiderBanner'da tek, DURAĞAN "installing" metni — eski sürüm kaldırma
 *      (ExecWait /S), 7z'nin $PLUGINSDIR'e yazılması, açma ve kopyalama boyunca
 *      hiçbir sayı yok.
 *   3. ÇİFT YAZMA: `extractUsing7za` önce $PLUGINSDIR\7z-out'a açar (936 MB), sonra
 *      `CopyFiles /SILENT` ile $INSTDIR'e kopyalar (936 MB daha).
 *   4. Yükleyici kendini `$LOCALAPPDATA\<ad>-updater\installer.exe`'ye kopyalar
 *      (770 MB) — yalnız electron-updater'ın fark güncellemesi için; biz kullanmıyoruz.
 *
 * Çözüm (yalnız KENDİ include dosyalarımızla; node_modules'e dokunulmaz):
 *   • customInit: en erken görünür işaret — Banner "Kurulum hazırlanıyor…" + günlük.
 *   • customCheckAppRunning (SpiderBanner açıldıktan hemen sonra, eski sürüm
 *     kaldırılmadan önce): Banner kapanır, SpiderBanner metin denetimi yakalanır,
 *     geçersiz kılma dosyası (`empp-kurulum-ovr.nsh`) include edilir, evre metni.
 *   • Geçersiz kılmalar (ovr): `extractUsing7za` → doğrudan $INSTDIR'e,
 *     `Nsis7z::ExtractWithCallback` ile GERÇEK "Dosyalar açılıyor: X / Y MB";
 *     `*_app_files` → "Kurulum dosyası hazırlanıyor…" + süre günlüğü;
 *     `copyFile "$EXEPATH"` → atlanır (derleme anında, yalnız o çağrı).
 *   • Sahte yüzde YOK: yalnız ölçülen bayt sayıları gösterilir.
 *
 * Günlük: `%APPDATA%\<userData adı>\acilis-zamanlama.log` — uygulamanın açılış
 * günlüğüyle AYNI dosya; satır `<ISO UTC> [kurulum] <evre> | <ayrıntı>`, UTF-8.
 *
 * İKİNCİ TIKLAMA: şablonun `ALLOW_ONLY_ONE_INSTALLER_INSTANCE` makrosu (.onInit,
 * customInit'ten ÖNCE) APP_GUID mutex'iyle ikinci örneği öne getirip sessizce
 * kapatıyor — ek kod gerekmiyor (bkz. OKU).
 *
 * YASAKLAR (installer-bilgilendirme.test.js): installer.nsh'ta MessageBox, Sleep,
 * ayrı Section, sahte yüzde YOK. Hata kutusu yalnız ovr dosyasında, yalnız paket
 * açılamazsa (soru değil, bilgi).
 */

const GUNLUK_ADI = 'acilis-zamanlama.log';
const OVR_ADI = 'empp-kurulum-ovr.nsh';
const WM_SETTEXT = '0x000C';

/** NSIS çift tırnaklı dize kaçışı. */
function nsisKacis(s) {
  return String(s == null ? '' : s)
    .replace(/\$/g, '$$$$')
    .replace(/"/g, '$\\"')
    .replace(/\r?\n/g, ' ');
}

/** userData dizin adı: Electron `app.getName()` = productName || name. */
function userDataAdi(pkg) {
  if (!pkg || typeof pkg !== 'object') return null;
  const ad = (typeof pkg.productName === 'string' && pkg.productName.trim())
    || (typeof pkg.name === 'string' && pkg.name.trim()) || null;
  if (!ad || /[\\/:*?"<>|]/.test(ad)) return null;
  return ad;
}

/**
 * installer.nsh'ın BAŞINA (CRCCheck'ten sonra, customInit'ten önce) gelen ortak kısım:
 * sabitler, değişkenler, fonksiyonlar. Yükleyici ve kaldırıcı derlemesi AYNI başlığı
 * paylaşır (-WX: kullanılmayan değişken/fonksiyon HATA) → bizimkiler yalnız yükleyicide.
 */
function ortakBaslik({ userData }) {
  return `
; ---- EMPP kurulum görünürlüğü + zamanlama (src/packaging/nsis-kurulum.js) ----
!define /ifndef EMPP_USERDATA_ADI "${nsisKacis(userData)}"
!define /ifndef EMPP_GUNLUK_ADI "${GUNLUK_ADI}"
; Bu başlık şablondan ÖNCE derlenir: şablonun kendi tanımları (UNINSTALL_REGISTRY_KEY —
; multiUser.nsh, APP_EXECUTABLE_FILENAME — common.nsh) henüz YOK. Fonksiyonlar yalnız
; komut satırı (-D) tanımlarından türetilmiş ÖZEL adları kullanır; şablonunkine dokunmaz.
!define EMPP_KALDIRMA_ANAHTARI "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\\${UNINSTALL_APP_KEY}"
!define EMPP_EXE "\${PRODUCT_FILENAME}.exe"

; customCheckAppRunning tanımlı olduğu için şablon bunları KENDİSİ eklemiyor
; (allowOnlyOneInstallerInstance.nsh: !ifmacrondef customCheckAppRunning).
!include "getProcessInfo.nsh"
Var pid

!macro emppGunluk METIN
  Push \`\${METIN}\`
  Call emppGunlukYaz
!macroend

!ifndef BUILD_UNINSTALLER
Var emppBanner
Var emppEskiVar
Var emppAcilan
Var emppToplam
Var emppAcilanMb
Var emppToplamMb
Var emppSonMb
Var emppAcmaSonuc
Var emppGeriCagri

; Tek satır günlük: yığından metin alır, UTC zaman damgası + "[kurulum]" ile
; UTF-8 olarak ekler. Yazmaçları ve HATA BAYRAĞINI korur (şablon IfErrors bakıyor).
Function emppGunlukYaz
  Exch $R9
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  Push $6
  Push $7
  Push $8
  Push $R8
  StrCpy $R8 0
  IfErrors 0 +2
  StrCpy $R8 1
  System::Call '*(&i2, &i2, &i2, &i2, &i2, &i2, &i2, &i2) p .r0'
  System::Call 'kernel32::GetSystemTime(p r0)'
  System::Call '*$0(&i2, &i2, &i2, &i2, &i2, &i2, &i2, &i2)(.r1, .r2, .r8, .r3, .r4, .r5, .r6, .r7)'
  System::Free $0
  IntFmt $1 "%04d" $1
  IntFmt $2 "%02d" $2
  IntFmt $3 "%02d" $3
  IntFmt $4 "%02d" $4
  IntFmt $5 "%02d" $5
  IntFmt $6 "%02d" $6
  IntFmt $7 "%03d" $7
  StrCpy $R9 "$1-$2-$3T$4:$5:$6.$7Z [kurulum] $R9$\\n"
  CreateDirectory "$APPDATA\\\${EMPP_USERDATA_ADI}"
  ClearErrors
  FileOpen $8 "$APPDATA\\\${EMPP_USERDATA_ADI}\\\${EMPP_GUNLUK_ADI}" a
  IfErrors empp_gy_son
  FileSeek $8 0 END
  System::Call 'kernel32::WideCharToMultiByte(i 65001, i 0, w R9, i -1, p 0, i 0, p 0, p 0) i .r1'
  IntCmp $1 1 empp_gy_kapat empp_gy_kapat
  System::Alloc $1
  Pop $2
  System::Call 'kernel32::WideCharToMultiByte(i 65001, i 0, w R9, i -1, p r2, i r1, p 0, p 0) i .r3'
  IntOp $3 $3 - 1
  System::Call 'kernel32::WriteFile(p r8, p r2, i r3, *i .r5, p 0)'
  System::Free $2
  empp_gy_kapat:
  FileClose $8
  empp_gy_son:
  ClearErrors
  StrCmp $R8 1 0 +2
  SetErrors
  Pop $R8
  Pop $8
  Pop $7
  Pop $6
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
  Pop $R9
FunctionEnd

; Kurulum penceresindeki (SpiderBanner) metni değiştirir. Sessiz kurulumda pencere yok.
Function emppMetin
  Exch $0
  IntCmp $emppBanner 0 +2
  SendMessage $emppBanner ${WM_SETTEXT} 0 "STR:$0"
  Pop $0
FunctionEnd

Function emppKurulumBasladi
  Push $0
  Push $1
  Push $2
  ReadEnvStr $0 PROCESSOR_ARCHITECTURE
  ReadEnvStr $1 PROCESSOR_ARCHITEW6432
  StrCmp $1 "" 0 +2
  StrCpy $1 "-"
  StrCpy $2 "pencereli"
  IfSilent 0 +2
  StrCpy $2 "sessiz (/S)"
  Push "kurulum başladı | sürüm \${VERSION} | $2 | PROCESSOR_ARCHITECTURE=$0 PROCESSOR_ARCHITEW6432=$1 | $EXEPATH"
  Call emppGunlukYaz
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

; SpiderBanner::Show'dan hemen sonra: erken Banner'ı kapat, metin denetimini yakala.
Function emppPencereHazir
  IfSilent empp_ph_son
  Banner::destroy
  Push $0
  FindWindow $0 "#32770" "" $hwndparent
  FindWindow $0 "#32770" "" $hwndparent $0
  GetDlgItem $0 $0 1000
  StrCpy $emppBanner $0
  Pop $0
  !insertmacro emppGunluk "kurulum penceresi göründü"
  empp_ph_son:
FunctionEnd

; Eski sürüm kaldırılmadan hemen önce (şablon uninstallOldVersion'dan önce).
Function emppEskiSurum
  Push $0
  StrCpy $emppEskiVar 0
  ReadRegStr $0 SHELL_CONTEXT "\${EMPP_KALDIRMA_ANAHTARI}" UninstallString
  StrCmp $0 "" empp_es_son
  StrCpy $emppEskiVar 1
  ReadRegStr $0 SHELL_CONTEXT "\${EMPP_KALDIRMA_ANAHTARI}" DisplayVersion
  Push "eski sürüm kaldırılıyor | kurulu sürüm $0"
  Call emppGunlukYaz
  Push "Eski sürüm kaldırılıyor…"
  Call emppMetin
  empp_es_son:
  Pop $0
FunctionEnd

; 7z yükleyiciden $PLUGINSDIR'e yazılmadan hemen önce. $R0 = eski kaldırıcının çıkış kodu.
Function emppKaldirmaSonrasi
  StrCmp $emppEskiVar 1 0 empp_ks_metin
  Push $1
  StrCpy $1 "eski dosyalar silindi"
  IfFileExists "$INSTDIR\\\${EMPP_EXE}" 0 +2
  StrCpy $1 "eski dosyalar YERİNDE (kaldırıcı çalışmadı ya da yarım kaldı) — üzerine yazılacak"
  Push "eski sürüm kaldırma bitti | çıkış kodu $R0 | $1"
  Call emppGunlukYaz
  Pop $1
  empp_ks_metin:
  Push "Kurulum dosyası hazırlanıyor…"
  Call emppMetin
FunctionEnd

; 7z $PLUGINSDIR'e yazıldıktan sonra: gerçek boyutu günlüğe.
Function emppDosyaHazirlandi
  Exch $0
  Push $1
  Push $2
  StrCpy $2 "?"
  ClearErrors
  FileOpen $1 "$0" r
  IfErrors empp_dh_yaz
  System::Call 'kernel32::GetFileSizeEx(p r1, *l .r2)'
  FileClose $1
  System::Int64Op $2 / 1048576
  Pop $2
  empp_dh_yaz:
  Push "kurulum dosyası hazırlandı | 7z $2 MB"
  Call emppGunlukYaz
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

; Nsis7z geri çağrısı: yığında açılan ve toplam bayt. Sıra belgelere göre
; (açılan, toplam); yine de büyük olan toplam sayılır (sıra yanlış varsayılırsa
; ekranda "900 / 12 MB" gibi saçma bir sayı çıkmasın). Metin yalnız MB değişince yazılır.
Function emppAcmaGeriCagrisi
  Pop $emppAcilan
  Pop $emppToplam
  System::Int64Op $emppAcilan > $emppToplam
  Pop $emppAcilanMb
  StrCmp $emppAcilanMb 1 0 +4
  StrCpy $emppAcilanMb $emppAcilan
  StrCpy $emppAcilan $emppToplam
  StrCpy $emppToplam $emppAcilanMb
  System::Int64Op $emppAcilan / 1048576
  Pop $emppAcilanMb
  StrCmp $emppAcilanMb $emppSonMb empp_gc_son
  StrCpy $emppSonMb $emppAcilanMb
  System::Int64Op $emppToplam / 1048576
  Pop $emppToplamMb
  IntCmp $emppBanner 0 empp_gc_son
  SendMessage $emppBanner ${WM_SETTEXT} 0 "STR:Dosyalar açılıyor: $emppAcilanMb / $emppToplamMb MB"
  empp_gc_son:
FunctionEnd

; Doğrudan açmanın öncesi/sonrası. Nsis7z çağrısının KENDİSİ ovr makrosunda: bu başlık
; electron-builder'ın !addplugindir satırlarından ÖNCE derlenebiliyor (eşzamansız başlık
; üretimi) ve Nsis7z yalnız o dizinde — fonksiyon içinde "Plugin not found" veriyordu.
Function emppAcmaOncesi
  StrCpy $emppSonMb -1
  StrCpy $emppToplamMb 0
  StrCpy $emppAcmaSonuc "hata"
  GetFunctionAddress $emppGeriCagri emppAcmaGeriCagrisi
  Push "paket açma başladı | hedef $OUTDIR"
  Call emppGunlukYaz
FunctionEnd

Function emppAcmaSonrasi
  IfFileExists "$OUTDIR\\\${EMPP_EXE}" 0 empp_as_hata
  StrCpy $emppAcmaSonuc "tamam"
  Push "paket açma bitti | $emppToplamMb MB"
  Call emppGunlukYaz
  Push "Kısayollar oluşturuluyor…"
  Call emppMetin
  Return
  empp_as_hata:
  Push "paket açma HATALI | $OUTDIR\\\${EMPP_EXE} yok"
  Call emppGunlukYaz
FunctionEnd
!endif
; ---- /EMPP ----
`;
}

/** customInit'e eklenecek iki satır: en erken günlük + görünür işaret. */
function customInitBasi() {
  return `  Call emppKurulumBasladi
  IfSilent +2
  Banner::show /set 76 "Kurulum hazırlanıyor…" "\${PRODUCT_NAME}"`;
}

/** customCheckAppRunning — SpiderBanner açıldıktan hemen sonra, eski sürümden önce. */
function customCheckAppRunningMakro(ovrYolu) {
  const yol = String(ovrYolu).replace(/\\/g, '/');
  return `
!macro customCheckAppRunning
  !ifdef BUILD_UNINSTALLER
    !insertmacro _CHECK_APP_RUNNING
  !else
    Call emppPencereHazir
    !include "${yol}"
    !insertmacro _CHECK_APP_RUNNING
    Call emppEskiSurum
  !endif
!macroend
`;
}

/** customInstall sonuna: son evre. */
function customInstallSonu() {
  return `  Push "Kurulum tamamlandı."
  Call emppMetin
  !insertmacro emppGunluk "kurulum bitti | $INSTDIR"`;
}

/** Geçersiz kılma dosyası (yalnız yükleyici derlemesinde, Section içinde include edilir). */
function ovrIcerigi() {
  const arch = (makro, ad, kaynak) => `
!macroundef ${makro}
!macro ${makro}
  Call emppKaldirmaSonrasi
  File /oname=$PLUGINSDIR\\app-${ad}.\${COMPRESSION_METHOD} "\${${kaynak}}"
  Push "$PLUGINSDIR\\app-${ad}.\${COMPRESSION_METHOD}"
  Call emppDosyaHazirlandi
!macroend
`;
  return `; EMPP kurulum geçersiz kılmaları — src/packaging/nsis-kurulum.js üretti.
; customCheckAppRunning içinden, YALNIZ yükleyici derlemesinde include edilir:
; o anda şablonun extractAppPackage.nsh ve installUtil.nsh makroları tanımlı,
; installApplicationFiles ise henüz açılmamış — yeniden tanım ona uygulanır.
${arch('ia32_app_files', '32', 'APP_32')}${arch('x64_app_files', '64', 'APP_64')}${arch('arm64_app_files', 'arm64', 'APP_ARM64')}
; Çift yazma yok: 7z DOĞRUDAN $OUTDIR (= $INSTDIR) içine açılır. Eski sürüm bu noktada
; kaldırılmış ve çalışan uygulama kapatılmıştır (şablon sırası). Açma sonrası ana exe
; yoksa kurulum yarım bırakılmaz: bilgi kutusu + hata kodu 2.
!macroundef extractUsing7za
!macro extractUsing7za FILE
  Call emppAcmaOncesi
  Nsis7z::ExtractWithCallback "\${FILE}" $emppGeriCagri
  Call emppAcmaSonrasi
  StrCmp $emppAcmaSonuc "tamam" +4
  MessageBox MB_OK|MB_ICONSTOP "Kurulum dosyaları açılamadı. Diskte yer olduğundan emin olup kurulumu yeniden başlatın." /SD IDOK
  SetErrorLevel 2
  Quit
!macroend

; Yükleyicinin kendini $LOCALAPPDATA'ya kopyalaması (770 MB) yalnız electron-updater'ın
; fark güncellemesi içindir; kullanmıyoruz. Yalnız o çağrı derleme anında atlanır.
!macroundef copyFile
!macro copyFile FROM TO
  !if "\${FROM}" == "$EXEPATH"
    !insertmacro emppGunluk "yükleyici kopyası atlandı | electron-updater yok"
  !else
    \${StdUtils.GetParentPath} $R5 \`\${TO}\`
    CreateDirectory \`$R5\`
    ClearErrors
    CopyFiles /SILENT \`\${FROM}\` \`\${TO}\`
  !endif
!macroend
`;
}

module.exports = {
  GUNLUK_ADI,
  OVR_ADI,
  nsisKacis,
  userDataAdi,
  ortakBaslik,
  customInitBasi,
  customCheckAppRunningMakro,
  customInstallSonu,
  ovrIcerigi,
};

# "empp-kabul-iscisi" Zamanlanmış Görevi — kabul işçisi (kabul kuyruğu, 05.10).
# Elle kurulur: powershell -NoProfile -ExecutionPolicy Bypass -File kabul-iscisi-gorev-kur.ps1
# Runner bayrağı (EMPP_WIN_KABUL_KUYRUK=1) ortam.ps1'e EKLENMEZ; kasada elle açılır. Görev ÖNCE kurulur,
# bayrak SONRA açılır (işçi yokken açılan bayrak kabul-bekliyor kayıtlarını biriktirir; üretim kapısı
# derinlik 1'de durur).
#
# Tasarım (bekci-gorev-kur.ps1 kalıbı):
# - Principal Administrator, LogonType Interactive, RunLevel Highest: kabul.py GUI'yi masaüstünde açar;
#   oturumsuz (S4U/servis) koşu oturum 0'da kalır, kabul ekranı olmaz.
# - Konsol GİZLİ (-WindowStyle Hidden).
# - Tetik: oturum açılışı + 5 dk'da bir. MultipleInstances IgnoreNew + işçinin .kabul-iscisi.kilit'i:
#   işçi koşarken yenisi açılmaz; ölürse en geç 5 dk sonra yeniden açılır.
# - Süre tavanı 24 sa: işçi kendi ömrünü (6 sa, kuyruk boşken) kendisi bitirir; tavan yalnız asılı
#   kalmış sürece emniyettir (kabul 45 dk + kasa kilidi beklemesi 120 dk'dan çok büyük).
$a = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File C:\empp-ajan\kabul-iscisi.ps1'
$t1 = New-ScheduledTaskTrigger -AtLogOn -User 'Administrator'
$t2 = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$p = New-ScheduledTaskPrincipal -UserId 'Administrator' -LogonType Interactive -RunLevel Highest
$s = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 24) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'empp-kabul-iscisi' -Action $a -Trigger @($t1, $t2) -Principal $p -Settings $s -Force | Out-Null
"kayitli: " + (Get-ScheduledTask -TaskName 'empp-kabul-iscisi').State + " · oturum açılışı + 5 dk · gizli konsol"

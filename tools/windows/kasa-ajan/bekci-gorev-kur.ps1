# "empp-imza-bekcisi" Zamanlanmış Görevi — imza bekçisi 30 dk'da bir (plan d, 04.10).
# KURULUM ŞARTI: ilk imzalı paket UÇTAN UCA geçmiş olmalı (Authenticode Valid · imzacı İm Park ·
# gövde eşit · imzalı kabul GEÇTİ · R2). Elle kurulur: powershell -File bekci-gorev-kur.ps1
#
# Tasarım:
# - Principal Administrator, LogonType Interactive: imzalı kabul (kabul.py) GUI'yi masaüstünde açar;
#   oturumsuz (S4U/servis) koşu oturum 0'da kalır, kabul ekranı olmaz.
# - Konsol GİZLİ (-WindowStyle Hidden): RDP'deki kullanıcı pencereyi kapatıp bekçiyi öldüremez
#   (04.10: 0xC000013A STATUS_CONTROL_C_EXIT, imzalı kabulün ortasında).
# - MultipleInstances IgnoreNew + bekçinin .bekci.kilit'i: tur sürerken yenisi açılmaz.
# - Süre tavanı 8 sa: imza penceresi 3 sa tavan + kasa kilidi beklemesi 2 sa (05.10) + kabul 45 dk, pay.
param([int]$AralikDk = 30)
$a = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File C:\empp-ajan\bekci.ps1'
$t = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes $AralikDk)
$p = New-ScheduledTaskPrincipal -UserId 'Administrator' -LogonType Interactive -RunLevel Highest
$s = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 8) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'empp-imza-bekcisi' -Action $a -Trigger $t -Principal $p -Settings $s -Force | Out-Null
"kayitli: " + (Get-ScheduledTask -TaskName 'empp-imza-bekcisi').State + " · aralik $AralikDk dk · gizli konsol"

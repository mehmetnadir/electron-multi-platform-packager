# Kullanım: tek-gorev.ps1 -Ad <gorev> -Betik <ps1 yolu>  — betiği oturumdan bağımsız, Administrator
# etkileşimli oturumunda tek seferlik Zamanlanmış Görev olarak koşturur; çıktı D:\empp-ajan\log\<ad>.log
# GİZLİ PENCERE (04.10): görünür konsol RDP'deki kullanıcı tarafından kapatıldı → imza bekçisi
# 0xC000013A (STATUS_CONTROL_C_EXIT) ile imzalı kabulün ortasında öldü. Konsol gizli; çıktı zaten logda.
param([string]$Ad, [string]$Betik)
$log = "D:\empp-ajan\log\$Ad.log"
$a = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command `"& '$Betik' *> '$log'`""
$p = New-ScheduledTaskPrincipal -UserId 'Administrator' -LogonType Interactive -RunLevel Highest
$s = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 3) -AllowStartIfOnBatteries
Register-ScheduledTask -TaskName "empp-tek-$Ad" -Action $a -Principal $p -Settings $s -Force | Out-Null
Start-ScheduledTask -TaskName "empp-tek-$Ad"
"basladi empp-tek-$Ad -> $log"

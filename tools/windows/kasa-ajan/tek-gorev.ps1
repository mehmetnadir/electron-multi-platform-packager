# Kullanım: tek-gorev.ps1 -Ad <gorev> -Betik <ps1 yolu>  — betiği oturumdan bağımsız, Administrator
# etkileşimli oturumunda tek seferlik Zamanlanmış Görev olarak koşturur; çıktı D:\empp-ajan\log\<ad>.log
param([string]$Ad, [string]$Betik)
$log = "D:\empp-ajan\log\$Ad.log"
$a = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -Command `"& '$Betik' *> '$log'`""
$p = New-ScheduledTaskPrincipal -UserId 'Administrator' -LogonType Interactive -RunLevel Highest
$s = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 3) -AllowStartIfOnBatteries
Register-ScheduledTask -TaskName "empp-tek-$Ad" -Action $a -Principal $p -Settings $s -Force | Out-Null
Start-ScheduledTask -TaskName "empp-tek-$Ad"
"basladi empp-tek-$Ad -> $log"

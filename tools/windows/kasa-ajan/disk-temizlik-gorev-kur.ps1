# "empp-disk-temizlik" Zamanlanmış Görevi — disk temizlik bekçisi saatte bir (Nadir 06.10).
# Elle kurulur: powershell -NoProfile -ExecutionPolicy Bypass -File disk-temizlik-gorev-kur.ps1
# Tasarım: GUI gerekmez → oturumsuz koşu (S4U, en yüksek yetki); S4U reddedilirse Interactive.
# Konsol GİZLİ. MultipleInstances IgnoreNew + js'in adlandırılmış boru kilidi: tur sürerken yenisi açılmaz.
# Süre tavanı 2 sa (büyük ağaç silme + süreç listesi).
param([int]$AralikDk = 60)
# İzin dosyası: disk-temizlik.js bunu görmeden hiçbir şey silmez (izinsiz makine korkuluğu).
Set-Content -LiteralPath 'C:\empp-ajan\disk-temizlik.izin' -Value "kasa disk temizlik izni (Nadir 06.10) - $(Get-Date -Format s)" -Encoding UTF8
$a = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File C:\empp-ajan\disk-temizlik.ps1'
$t = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) -RepetitionInterval (New-TimeSpan -Minutes $AralikDk)
$s = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 2) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -Hidden
$kip = 'S4U'
try {
  $p = New-ScheduledTaskPrincipal -UserId 'Administrator' -LogonType S4U -RunLevel Highest
  Register-ScheduledTask -TaskName 'empp-disk-temizlik' -Action $a -Trigger $t -Principal $p -Settings $s -Force -ErrorAction Stop | Out-Null
} catch {
  $kip = 'Interactive'
  $p = New-ScheduledTaskPrincipal -UserId 'Administrator' -LogonType Interactive -RunLevel Highest
  Register-ScheduledTask -TaskName 'empp-disk-temizlik' -Action $a -Trigger $t -Principal $p -Settings $s -Force | Out-Null
}
"kayitli: " + (Get-ScheduledTask -TaskName 'empp-disk-temizlik').State + " · aralik $AralikDk dk · $kip · gizli"

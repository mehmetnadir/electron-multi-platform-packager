# windows-kasa build ajanı — kurulum (sözleşme exesiz-kaynak §2c, 2026-10-02).
#
# Yerleşim (D:\empp-ajan): araclar\{node (v24 zip), git (PortableGit: bash/unzip/perl), 7zip (7z.exe,
# NSIS açar)} + git\usr\bin\zip.exe (MSYS2 zip-3.0, Info-ZIP) · paketleyici\ (git archive + `npm ci`,
# package-lock Mac'ten) · ev\ (C:\Users\Administrator\.empp-agent bağlantısı: token.json, duraklat.istek,
# windows-hazir\, kabul-kanit\) · veri\ (tmp, kaynak-arsivi, cache, packager-tool = .electron-packager-tool
# bağlantısı; logolar Mac'ten + logo-yol.js) · log\ (agent.log, packager.log, baslat.log).
# Kimlik: tools\probook\kaydol.js (sır STDIN'den, diske yazılmaz; enroll yalnız platform yeteneği kabul
# eder → AGENT_CAPS=windows ile kaydol, kaynak-r2 nabızla eklenir).
#
# "empp-ajan" Zamanlanmış Görevi: Administrator ETKİLEŞİMLİ oturumu (kabul.py GUI'yi masaüstünde açar),
# oturum açılışında + 5 dk'da bir (çalışıyorsa yenisi açılmaz). SSH oturumundan bağımsız (Job Object).
# Sınır: AutoAdminLogon kapalı → yeniden başlatmada oturum açılana kadar ajan koşmaz.
$a = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File D:\empp-ajan\ajan-baslat.ps1'
$t1 = New-ScheduledTaskTrigger -AtLogOn -User 'Administrator'
$t2 = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$p = New-ScheduledTaskPrincipal -UserId 'Administrator' -LogonType Interactive -RunLevel Highest
$s = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName 'empp-ajan' -Action $a -Trigger @($t1, $t2) -Principal $p -Settings $s -Force | Out-Null
"kayitli: " + (Get-ScheduledTask -TaskName 'empp-ajan').State

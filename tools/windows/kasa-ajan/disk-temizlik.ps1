# Disk temizlik bekçisi — ince sarmalayıcı (Nadir 06.10: "disk dolu → işi durdurma, yer aç").
# Mantık tools\windows\kasa-ajan\disk-temizlik.js'te (bağımlılıksız node; testli). Bu dosya yalnız
# ortamı kurar, js'i bulur ve çıktıyı log\disk-temizlik-cikti.log'a ekler.
# Kullanım: powershell -NoProfile -ExecutionPolicy Bypass -File C:\empp-ajan\disk-temizlik.ps1 [-Kuru] [-Ek <yol>,<yol>] [-HedefGb N]
# Zamanlanmış görev: disk-temizlik-gorev-kur.ps1 (saatlik, gizli). Silinenlerin günlüğü: log\disk-temizlik.log
param([switch]$Kuru, [string[]]$Ek = @(), [int]$HedefGb = 0)
. C:\empp-ajan\ortam.ps1
# Repo kopyası (agent-mode'a girdiyse) öncelikli; yoksa C:\empp-ajan altındaki kopya.
$js = Join-Path $R 'tools\windows\kasa-ajan\disk-temizlik.js'
if (-not (Test-Path $js)) { $js = Join-Path $K 'disk-temizlik.js' }
$a = @($js)
if ($Kuru) { $a += '--kuru' }
foreach ($e in $Ek) { $a += '--ek'; $a += $e }
if ($HedefGb -gt 0) { $a += '--hedef-gb'; $a += "$HedefGb" }
& "$K\araclar\node\node.exe" @a 2>&1 | Tee-Object -FilePath "$L\disk-temizlik-cikti.log" -Append
exit $LASTEXITCODE

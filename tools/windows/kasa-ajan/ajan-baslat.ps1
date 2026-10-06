# windows-kasa build ajanı — paketleyici (127.0.0.1:3001) + runner döngüsü.
# Zamanlanmış Görev "empp-ajan" (Administrator, etkileşimli oturum: kabul GUI'si masaüstünde açılır)
# bu betiği koşturur. SSH oturumundan bağımsızdır (Job Object tuzağı). Silme yok.
. C:\empp-ajan\ortam.ps1

function Damga { Get-Date -Format 'yyyy-MM-ddTHH:mm:ss' }
function PaketleyiciAyakta {
  try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 http://127.0.0.1:3001/api/health).StatusCode -eq 200 } catch { $false }
}
function PaketleyiciBaslat {
  $env:PORT = '3001'
  Start-Process -FilePath cmd.exe -ArgumentList '/d', '/c', "node src\server\app.js >> `"$L\packager.log`" 2>&1" -WindowStyle Hidden
  for ($i = 0; $i -lt 30 -and -not (PaketleyiciAyakta); $i++) { Start-Sleep 2 }
}
function BayatLog($m) { "$(Damga) paketleyici-bayat: $m" | Out-File -Append -Encoding utf8 "$L\baslat.log" }
function SaglikGetir { try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 http://127.0.0.1:3001/api/health | Select-Object -ExpandProperty Content | ConvertFrom-Json } catch { $null } }
# 06.10: paketleyici koddan bayat kaldıysa (health commit != $R\.surum ya da bayatMi) ve kuyruk boşsa runner'dan ÖNCE yeniden aç.
# Kapatma: EMPP_PAKETLEYICI_BAYAT_YENIDEN=0 (ortam.ps1 ya da makine ortamı). Meşgul = YALNIZ bitmemiş iş:
# completed/failed/error/cancelled/canceled sayılmaz (biten kayıtlar süresiz kalıp yeniden açmayı engelliyordu; Mac
# paketleyici-bayat.sh c00c7d5 ile aynı kural). Bilinmeyen/boş durum = meşgul. packagingJobs ile activePackagingJobs
# aynı işleri taşır: jobId/id ile tekilleştirilir (id'siz iş tek tek sayılır). zipJobs ayrı sayılır.
function PaketleyiciBayatYeniden {
  if ($env:EMPP_PAKETLEYICI_BAYAT_YENIDEN -eq '0') { BayatLog 'kapalı (EMPP_PAKETLEYICI_BAYAT_YENIDEN=0)'; return }
  $h = SaglikGetir
  if (-not $h) { return }
  $disk = ''
  if (Test-Path "$R\.surum") { $disk = (Get-Content -Raw "$R\.surum").Trim() }
  if (-not $disk) { BayatLog 'disk sürümü okunamadı (.surum yok); dokunulmadı'; return }
  $canli = "$($h.commit)"
  $esit = $canli -and ($canli.StartsWith($disk) -or $disk.StartsWith($canli))
  if ($esit -and -not $h.bayatMi) { BayatLog "güncel (commit=$canli); dokunulmadı"; return }
  BayatLog "BAYAT: canlı=$canli disk=$disk bayatMi=$($h.bayatMi) pid=$($h.pid)"
  try {
    $q = Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 http://127.0.0.1:3001/api/queue-status | Select-Object -ExpandProperty Content | ConvertFrom-Json
  } catch { BayatLog 'kuyruk okunamadı; dokunulmadı'; return }
  $bit = @('completed', 'failed', 'error', 'cancelled', 'canceled')
  $zip = @($q.zipJobs | Where-Object { $_ -and $bit -notcontains $_.status }).Count
  $anahtar = @{}
  $idsiz = 0
  foreach ($j in @($q.packagingJobs) + @($q.activePackagingJobs)) {
    if (-not $j -or $bit -contains $j.status) { continue }
    $id = if ($j.jobId) { "$($j.jobId)" } elseif ($j.id) { "$($j.id)" } else { '' }
    if ($id) { $anahtar[$id] = 1 } else { $idsiz++ }
  }
  $mesgul = $zip + $idsiz + $anahtar.Count
  if ($mesgul -ne 0) { BayatLog "kuyruk DOLU (mesgul=$mesgul); dokunulmadı (sonraki runner çıkışında yeniden denenir)"; return }
  $pk = [int]$h.pid
  if ($pk -le 0) {   # eski sürüm health'inde pid yok → komut satırından bul, tek eşleşme şart
    $aday = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match 'src.server.app\.js' })
    if ($aday.Count -eq 1) { $pk = [int]$aday[0].ProcessId }
  }
  $surec = Get-CimInstance Win32_Process -Filter "ProcessId=$pk" -ErrorAction SilentlyContinue
  if (-not $surec -or $surec.CommandLine -notmatch 'app\.js') { BayatLog "pid=$pk app.js değil; dokunulmadı"; return }
  $cocuk = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$pk" -ErrorAction SilentlyContinue | ForEach-Object { $_.ProcessId })
  BayatLog "kuyruk boş; kapatılıyor (pid=$pk çocuk=$($cocuk -join ','))"
  foreach ($c in $cocuk) { Stop-Process -Id $c -Force -ErrorAction SilentlyContinue }
  Stop-Process -Id $pk -Force -ErrorAction SilentlyContinue
  for ($i = 0; $i -lt 20 -and (PaketleyiciAyakta); $i++) { Start-Sleep 1 }
  if (PaketleyiciAyakta) { BayatLog 'HATA: 3001 kapanmadı'; return }
  BayatLog '3001 kapandı; yeniden açılıyor'
  PaketleyiciBaslat
  $y = SaglikGetir
  if ($y -and "$($y.commit)" -and ($disk.StartsWith("$($y.commit)") -or "$($y.commit)".StartsWith($disk))) { BayatLog "TAMAM: yeni commit=$($y.commit) = disk" }
  else { BayatLog "UYARI: yeniden açıldı ama commit=$($y.commit) disk=$disk" }
}
while ($true) {
  if (-not (PaketleyiciAyakta)) {
    "$(Damga) paketleyici başlatılıyor" | Out-File -Append -Encoding utf8 "$L\baslat.log"
    PaketleyiciBaslat
  }
  # Ortam HER runner başlangıcında yeniden okunur (04.10): ortam.ps1'e eklenen değişken (ör.
  # EMPP_IMZA_YUVA_KOKU) yeniden-baslat.istek ile devreye girer; görevi yeniden başlatmak gerekmez.
  . C:\empp-ajan\ortam.ps1
  try { PaketleyiciBayatYeniden } catch { BayatLog "hata (devam): $($_.Exception.Message)" }
  "$(Damga) runner başlıyor (paketleyici: $(PaketleyiciAyakta))" | Out-File -Append -Encoding utf8 "$L\baslat.log"
  & cmd.exe /d /c "node src\agent\runner.js >> `"$L\agent.log`" 2>&1"
  "$(Damga) runner çıktı rc=$LASTEXITCODE — 15 sn sonra yeniden" | Out-File -Append -Encoding utf8 "$L\baslat.log"
  Start-Sleep 15
}

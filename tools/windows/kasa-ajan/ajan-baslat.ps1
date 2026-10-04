# windows-kasa build ajanı — paketleyici (127.0.0.1:3001) + runner döngüsü.
# Zamanlanmış Görev "empp-ajan" (Administrator, etkileşimli oturum: kabul GUI'si masaüstünde açılır)
# bu betiği koşturur. SSH oturumundan bağımsızdır (Job Object tuzağı). Silme yok.
. D:\empp-ajan\ortam.ps1

function Damga { Get-Date -Format 'yyyy-MM-ddTHH:mm:ss' }
function PaketleyiciAyakta {
  try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 http://127.0.0.1:3001/api/health).StatusCode -eq 200 } catch { $false }
}
while ($true) {
  if (-not (PaketleyiciAyakta)) {
    "$(Damga) paketleyici başlatılıyor" | Out-File -Append -Encoding utf8 "$L\baslat.log"
    $env:PORT = '3001'
    Start-Process -FilePath cmd.exe -ArgumentList '/d', '/c', "node src\server\app.js >> `"$L\packager.log`" 2>&1" -WindowStyle Hidden
    for ($i = 0; $i -lt 30 -and -not (PaketleyiciAyakta); $i++) { Start-Sleep 2 }
  }
  # Ortam HER runner başlangıcında yeniden okunur (04.10): ortam.ps1'e eklenen değişken (ör.
  # EMPP_IMZA_YUVA_KOKU) yeniden-baslat.istek ile devreye girer; görevi yeniden başlatmak gerekmez.
  . D:\empp-ajan\ortam.ps1
  "$(Damga) runner başlıyor (paketleyici: $(PaketleyiciAyakta))" | Out-File -Append -Encoding utf8 "$L\baslat.log"
  & cmd.exe /d /c "node src\agent\runner.js >> `"$L\agent.log`" 2>&1"
  "$(Damga) runner çıktı rc=$LASTEXITCODE — 15 sn sonra yeniden" | Out-File -Append -Encoding utf8 "$L\baslat.log"
  Start-Sleep 15
}

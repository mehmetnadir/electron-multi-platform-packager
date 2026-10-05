# İmza bekçisi turu (zamanlanmış görev "empp-imza-bekcisi" koşturur). Çıktı log\imza-bekcisi.log'a
# EKLENİR. Konsol penceresi YOK (-WindowStyle Hidden ile başlatılır): 04.10'da görünür konsol RDP'den
# kapatılınca bekçi imzalı kabulün ortasında öldü. Tekil koşu bekçinin kendi .bekci.kilit'iyle.
. C:\empp-ajan\ortam.ps1
Set-Location C:\empp-ajan\paketleyici
"$(Get-Date -Format 'yyyy-MM-ddTHH:mm:ss') bekçi turu başlıyor" | Out-File -Append -Encoding utf8 "$L\imza-bekcisi.log"
& cmd.exe /d /c "node tools\windows\imza-bekcisi.js >> `"$L\imza-bekcisi.log`" 2>&1"
"$(Get-Date -Format 'yyyy-MM-ddTHH:mm:ss') bekçi turu bitti rc=$LASTEXITCODE" | Out-File -Append -Encoding utf8 "$L\imza-bekcisi.log"

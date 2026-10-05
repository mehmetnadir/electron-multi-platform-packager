# Kabul işçisi (zamanlanmış görev "empp-kabul-iscisi" koşturur; kabul kuyruğu 05.10). Uzun ömürlü
# döngü: kabul-bekliyor kayıtları en eskiden sırayla imzasız kabulden geçirir, kuyruk boşsa 60 sn
# uyur, ömrü (6 sa) dolunca kuyruk boşken temiz çıkar — görev 5 dk'da yeni kodla açar. Çıktı
# log\kabul-iscisi.log'a EKLENİR. Konsol penceresi YOK (-WindowStyle Hidden): RDP'deki kullanıcı
# pencereyi kapatıp kabulün ortasında işçiyi öldüremez (bekçi 04.10 dersi). Tekil koşu işçinin kendi
# .kabul-iscisi.kilit'iyle. Bayraktan (EMPP_WIN_KABUL_KUYRUK) BAĞIMSIZ koşar: bayrak kapatılsa da kalan
# kabul-bekliyor kayıtlarını boşaltır.
. C:\empp-ajan\ortam.ps1
Set-Location C:\empp-ajan\paketleyici
"$(Get-Date -Format 'yyyy-MM-ddTHH:mm:ss') kabul işçisi başlıyor" | Out-File -Append -Encoding utf8 "$L\kabul-iscisi.log"
& cmd.exe /d /c "node tools\windows\kabul-iscisi.js >> `"$L\kabul-iscisi.log`" 2>&1"
"$(Get-Date -Format 'yyyy-MM-ddTHH:mm:ss') kabul işçisi çıktı rc=$LASTEXITCODE" | Out-File -Append -Encoding utf8 "$L\kabul-iscisi.log"

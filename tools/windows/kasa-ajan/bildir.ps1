# bildir <kanal> <mesaj> [-b baslik] [-p dusuk|normal|yuksek|acil] [-t url] [-e etiket]
# Mac ~/.local/bin/bildir paritesi. Yapilandirma: %USERPROFILE%\.config\ntfy\{servers,token,fallback}
# Govde JSON yayin API'si (POST /): Turkce baslik/mesaj UTF-8 bozulmaz. Token ASLA basilmaz/loglanmaz.
# NTFY_URL / NTFY_TOKEN / NTFY_FALLBACK_URL ortam degiskenleri yapilandirmayi ezer.
$ErrorActionPreference = 'Stop'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}
$cfg = Join-Path $env:USERPROFILE '.config\ntfy'
function Oku($ad) { $y = Join-Path $cfg $ad; if (Test-Path $y) { (Get-Content -Raw -Encoding UTF8 $y).Trim() } else { '' } }
if ($args.Count -lt 2) { [Console]::Error.WriteLine('kullanim: bildir <kanal> <mesaj> [-b baslik] [-p dusuk|normal|yuksek|acil] [-t url] [-e etiket]'); exit 2 }
$kanal = [string]$args[0]; $msg = [string]$args[1]
$baslik = ''; $pri = 3; $tik = ''; $tag = ''
$i = 2
while ($i -lt $args.Count) {
  $a = [string]$args[$i]
  if ($i + 1 -ge $args.Count -and $a -match '^-[bptes]$') { [Console]::Error.WriteLine("eksik deger: $a"); exit 2 }
  $v = if ($i + 1 -lt $args.Count) { [string]$args[$i + 1] } else { '' }
  switch ($a) {
    '-b' { $baslik = $v }
    '-p' { $pri = switch ($v) { 'dusuk' { 2 } 'normal' { 3 } 'yuksek' { 4 } 'acil' { 5 } 'low' { 2 } 'default' { 3 } 'high' { 4 } 'urgent' { 5 } 'min' { 1 } 'max' { 5 } default { 3 } } }
    '-t' { $tik = $v }
    '-e' { $tag = $v }
    default { [Console]::Error.WriteLine("bilinmeyen: $a"); exit 2 }
  }
  $i += 2
}
$token = if ($env:NTFY_TOKEN) { $env:NTFY_TOKEN } else { Oku 'token' }
$fallback = if ($env:NTFY_FALLBACK_URL) { $env:NTFY_FALLBACK_URL } else { Oku 'fallback' }
if ($env:NTFY_URL) { $sunucular = @($env:NTFY_URL) }
else {
  $sy = Join-Path $cfg 'servers'
  if (Test-Path $sy) { $sunucular = @(Get-Content -Encoding UTF8 $sy | ForEach-Object { $_.Trim() } | Where-Object { $_ -and -not $_.StartsWith('#') }) }
  else { $sunucular = @((Oku 'server') -split "`n" | Where-Object { $_.Trim() }) }
}
function Gonder($taban, $konu, $metin, $jetonlu) {
  $o = [ordered]@{ topic = $konu; message = $metin; priority = $pri }
  if ($baslik) { $o.title = $baslik }
  if ($tik) { $o.click = $tik }
  if ($tag) { $o.tags = @($tag -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ }) }
  $gov = [Text.Encoding]::UTF8.GetBytes(($o | ConvertTo-Json -Compress))
  $h = @{}
  if ($jetonlu -and $token) { $h['Authorization'] = "Bearer $token" }
  $null = Invoke-WebRequest -Uri ($taban.TrimEnd('/') + '/') -Method Post -Body $gov -ContentType 'application/json; charset=utf-8' -Headers $h -TimeoutSec 8 -UseBasicParsing
}
foreach ($s in $sunucular) {
  if (-not $s) { continue }
  try { Gonder $s $kanal $msg $true; exit 0 } catch {}
}
if ($fallback) {
  try {
    $u = [Uri]$fallback
    $taban = $u.GetLeftPart([UriPartial]::Authority); $konu = $u.AbsolutePath.Trim('/')
    Gonder $taban $konu "[$kanal] $msg" $false
    [Console]::Error.WriteLine('bildir: kendi sunucuya ulasilamadi, ntfy.sh yedegine gitti'); exit 0
  } catch {}
}
[Console]::Error.WriteLine("bildir: gonderilemedi ($kanal)"); exit 1

$ErrorActionPreference = "Stop"
$ProjectRef = "xwzighiqmxemnblzgcrf"
$FunctionUrl = "https://xwzighiqmxemnblzgcrf.supabase.co/functions/v1/ldm-storage-maintenance"
$Root = Split-Path -Parent $PSScriptRoot
$Temp = Join-Path $env:TEMP ("ldm-storage-cron-" + [guid]::NewGuid().ToString("N") + ".env")

Write-Host "============================================================"
Write-Host "LocDailyMar V28.2.6 - Setup Storage Auto Cleanup"
Write-Host "App Supabase: $ProjectRef"
Write-Host "============================================================"
Write-Host ""
Write-Host "Sebelum lanjut, SQL-45 harus sudah dijalankan pada App Supabase."
$answer = Read-Host "Ketik LANJUT untuk membuat secret + deploy + pasang scheduler"
if ($answer.ToUpperInvariant() -ne "LANJUT") {
    Write-Host "Dibatalkan."
    exit 0
}

try {
    $bytes = New-Object byte[] 32
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $secret = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')

    Set-Content -Path $Temp -Value ("LDM_STORAGE_CRON_SECRET=" + $secret) -NoNewline -Encoding ascii

    Push-Location (Join-Path $Root "supabase")
    try {
        Write-Host ""
        Write-Host "[1/3] Menyimpan LDM_STORAGE_CRON_SECRET..."
        & npx supabase secrets set --env-file $Temp --project-ref $ProjectRef
        if ($LASTEXITCODE -ne 0) { throw "supabase secrets set gagal." }

        Write-Host ""
        Write-Host "[2/3] Deploy ldm-storage-maintenance..."
        & npx supabase functions deploy ldm-storage-maintenance --project-ref $ProjectRef
        if ($LASTEXITCODE -ne 0) { throw "Deploy Edge Function gagal." }
    }
    finally {
        Pop-Location
    }

    Write-Host ""
    Write-Host "[3/3] Memasang Supabase Cron harian..."
    $headers = @{
        "Content-Type" = "application/json"
        "x-ldm-cron-secret" = $secret
    }
    $body = @{ action = "configure-auto-cleanup" } | ConvertTo-Json -Compress
    $result = Invoke-RestMethod -Method Post -Uri $FunctionUrl -Headers $headers -Body $body -TimeoutSec 60

    if (-not $result.ok) {
        throw "Edge Function menolak konfigurasi scheduler."
    }

    Write-Host ""
    Write-Host "BERHASIL."
    Write-Host ("Scheduler: " + $result.scheduler.schedule_label)
    Write-Host "Secret tidak ditampilkan dan file sementara akan dihapus."
}
finally {
    if (Test-Path $Temp) {
        Remove-Item -Force $Temp
    }
}

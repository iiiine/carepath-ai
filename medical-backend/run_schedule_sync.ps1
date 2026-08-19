$ErrorActionPreference = "Stop"

$ProjectRoot = "C:\Users\User\OneDrive\Desktop\medical_project"
$BackendDir = Join-Path $ProjectRoot "medical-backend"
$PythonExe = Join-Path $ProjectRoot ".venv\Scripts\python.exe"
$RunnerFile = Join-Path $BackendDir "schedule_sync_runner.py"

$LogDir = Join-Path $BackendDir "logs"
$LogFile = Join-Path $LogDir "schedule_sync.log"

$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"

New-Item -ItemType Directory -Path $LogDir -Force | Out-Null

Set-Location $BackendDir

# 測試階段先清除舊的亂碼 log
Remove-Item -Path $LogFile -Force -ErrorAction SilentlyContinue

$StartTime = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

Add-Content -Path $LogFile -Value "============================================================" -Encoding UTF8
Add-Content -Path $LogFile -Value "[$StartTime] START schedule sync" -Encoding UTF8
Add-Content -Path $LogFile -Value "============================================================" -Encoding UTF8

# ============================================================
# 重要：
# 交給 cmd.exe 做 stdout / stderr 原始導向。
# 不讓 Windows PowerShell 先解析 Python 的 UTF-8。
# ============================================================

$Command = '"' + $PythonExe + '" "' + $RunnerFile + '" >> "' + $LogFile + '" 2>&1'

cmd.exe /d /s /c $Command

$ExitCode = $LASTEXITCODE

$FinishTime = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

Add-Content -Path $LogFile -Value "[$FinishTime] FINISH exit_code=$ExitCode" -Encoding UTF8
Add-Content -Path $LogFile -Value "============================================================" -Encoding UTF8

exit $ExitCode
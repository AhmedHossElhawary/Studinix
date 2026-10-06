# =====================================================================
# Studinix One-Click Automated Setup & Launcher
# Refactored: Minimalist To-Do, Gamified Points & Always-On-Top Drop Note
# =====================================================================

$ErrorActionPreference = "Continue"

Write-Host "`n=================================================================" -ForegroundColor Cyan
Write-Host " 🚀 STUDINIX: MINIMALIST TO-DO, POINTS & ALWAYS-ON-TOP DROP NOTE " -ForegroundColor White
Write-Host "=================================================================" -ForegroundColor Cyan

# 1. PURGE OBSOLETE / BLOATED ASSETS
Write-Host "`n[1/4] Purging obsolete and bloated assets..." -ForegroundColor Yellow
$ObsoleteItems = @(
    "landing-page",
    "studinix-admin-mobile",
    "downloads",
    "dist",
    "build",
    "backend/idle_monitor.py",
    "backend/os_guard.py",
    "backend/face_biometrics.py",
    "backend/omnifocus.db"
)

foreach ($item in $ObsoleteItems) {
    if (Test-Path $item) {
        Remove-Item -Recurse -Force $item -ErrorAction SilentlyContinue
        Write-Host "  [-] Purged: $item" -ForegroundColor DarkGray
    }
}
Write-Host "  [OK] Workspace clean and bloat-free!" -ForegroundColor Green

# 2. INSTALL REMAINING LIGHTWEIGHT DEPENDENCIES
Write-Host "`n[2/4] Verifying and installing required packages..." -ForegroundColor Yellow
try {
    python -m pip install -r requirements.txt --quiet --disable-pip-version-check
    Write-Host "  [OK] Python dependencies verified!" -ForegroundColor Green
} catch {
    Write-Host "  [!] Note: Ensure Python is in your PATH." -ForegroundColor DarkYellow
}

# 3. RUN DATABASE & GAMIFIED POINTS VERIFICATION
Write-Host "`n[3/4] Verifying database & points system..." -ForegroundColor Yellow
python test_suite.py
if ($LASTEXITCODE -ne 0) {
    Write-Host "  [!] Test suite failed. Please check backend files." -ForegroundColor Red
    exit 1
}

# 4. LAUNCH STUDINIX (DUAL WINDOWS: MAIN APP + DROP NOTE)
Write-Host "`n[4/4] Launching Studinix Desktop..." -ForegroundColor Cyan
Write-Host "  • Main App Window:     http://localhost:8000" -ForegroundColor White
Write-Host "  • Floating Drop Note:  http://localhost:8000/dropnote (Always-On-Top)" -ForegroundColor White
Write-Host "=================================================================`n" -ForegroundColor Cyan

# Check if npm / electron is available, otherwise run via Python runner
$hasNpm = Get-Command npm -ErrorAction SilentlyContinue

if ($hasNpm -and (Test-Path "node_modules/electron")) {
    Write-Host "Starting native Electron dual-window desktop app..." -ForegroundColor Green
    npm start
} else {
    Write-Host "Starting Studinix local engine with browser preview..." -ForegroundColor Green
    python run_app.py
}

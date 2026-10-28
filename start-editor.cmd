@echo off
setlocal
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js and npm are required. Install Node.js, then run this file again.
  pause
  exit /b 1
)

powershell -NoProfile -Command "try { $response = Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:4173/' -TimeoutSec 1; if ($response.StatusCode -eq 200) { Start-Process 'http://localhost:4173/'; exit 0 } } catch {}; exit 1"
if not errorlevel 1 exit /b 0

if not exist "node_modules\vite\bin\vite.js" (
  echo Installing the first-run dependencies...
  call npm install
  if errorlevel 1 (
    pause
    exit /b 1
  )
)

start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://localhost:4173/'"
call npm run dev -- --port 4173
pause

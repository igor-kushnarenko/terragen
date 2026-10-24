@echo off
cd /d "%~dp0"
if not exist "dist\index.html" (
  echo Build missing. Run npm install and npm run build in this folder.
  pause
  exit /b 1
)
cd /d "%~dp0dist"
python -c "import sys" >nul 2>nul
if %errorlevel%==0 (
  start "" http://localhost:8080/terrain_editor.html
  python -m http.server 8080 --bind 127.0.0.1
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start_server.ps1"
)

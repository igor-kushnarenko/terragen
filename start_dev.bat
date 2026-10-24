@echo off
cd /d "%~dp0"
if not exist "node_modules\vite" (
  echo Dependencies missing. Run npm install in this folder first.
  pause
  exit /b 1
)
call npm run dev -- --open

@echo off
REM Startet Reisli lokal unter Windows (benoetigt Node.js 20 oder neuer)
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js ist nicht installiert. Bitte von https://nodejs.org die LTS-Version installieren.
  pause
  exit /b 1
)
if "%PORT%"=="" set PORT=8081

REM Firmennetz: Windows-Zertifikate verwenden (Node.js ab 22.15), damit HTTPS-Pruefung des Proxys akzeptiert wird
set "NODEFLAGS="
node --use-system-ca -e "" >nul 2>nul && set "NODEFLAGS=--use-system-ca"
REM Ist ein Proxy als Umgebungsvariable gesetzt, soll Node.js ihn verwenden (Node.js ab 22.21 / 24.5)
if defined HTTPS_PROXY set NODE_USE_ENV_PROXY=1
if defined HTTP_PROXY set NODE_USE_ENV_PROXY=1

start "" http://localhost:%PORT%
node %NODEFLAGS% server\index.js
pause

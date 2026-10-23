@echo off
rem Double-click to play Last Card: starts a local server and opens your browser.
rem Needs Python 3 or Node.js. Close this window to stop the server.
setlocal
cd /d "%~dp0"
if not defined PORT set PORT=8000
set "URL=http://localhost:%PORT%/"

set "SERVER="
where py >nul 2>nul && set "SERVER=py -3 -m http.server %PORT% --bind 127.0.0.1"
if not defined SERVER (
  python -c "import sys; sys.exit(sys.version_info[0] != 3)" >nul 2>nul && set "SERVER=python -m http.server %PORT% --bind 127.0.0.1"
)
if not defined SERVER (
  where npx >nul 2>nul && set "SERVER=npx --yes serve -l %PORT% ."
)
if not defined SERVER (
  echo Last Card needs Python 3 ^(python.org^) or Node.js ^(nodejs.org^) to run locally.
  echo Or play the hosted version linked in README.md.
  pause
  exit /b 1
)

echo Last Card is running at %URL%
echo In Chrome or Edge, use the install icon in the address bar to add it as an app.
echo Close this window to stop the server.
if not "%NO_BROWSER%"=="1" start "" /b cmd /c "timeout /t 2 /nobreak >nul & start %URL%"
%SERVER%

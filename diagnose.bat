@echo off
rem Lantern diagnostics: runs install and start, and writes everything to diagnose-log.txt
rem Double-click this file, or run it from a Command Prompt in this folder.

setlocal
cd /d "%~dp0"
set LOG=diagnose-log.txt

echo ===== Lantern diagnostics ===== > "%LOG%"
echo Date: %DATE% %TIME% >> "%LOG%"
echo. >> "%LOG%"

echo --- machine --- >> "%LOG%"
ver >> "%LOG%" 2>&1
node -v >> "%LOG%" 2>&1
npm -v >> "%LOG%" 2>&1
where node >> "%LOG%" 2>&1
where npm >> "%LOG%" 2>&1
where python >> "%LOG%" 2>&1
echo. >> "%LOG%"

echo --- does the project look right --- >> "%LOG%"
if exist package.json (echo package.json: present >> "%LOG%") else (echo package.json: MISSING >> "%LOG%")
if exist electron\main.js (echo electron/main.js: present >> "%LOG%") else (echo electron/main.js: MISSING >> "%LOG%")
if exist node_modules (echo node_modules: present >> "%LOG%") else (echo node_modules: absent, install will run >> "%LOG%")
echo. >> "%LOG%"

echo --- npm install --- >> "%LOG%"
call npm install --no-audit --no-fund >> "%LOG%" 2>&1
echo install exit code: %ERRORLEVEL% >> "%LOG%"
echo. >> "%LOG%"

echo --- native database engine --- >> "%LOG%"
if exist node_modules\better-sqlite3\build\Release\better_sqlite3.node (
  echo better_sqlite3.node: present >> "%LOG%"
) else (
  echo better_sqlite3.node: MISSING - the rebuild step did not succeed >> "%LOG%"
)
if exist node_modules\electron\dist\electron.exe (
  echo electron.exe: present >> "%LOG%"
) else (
  echo electron.exe: MISSING - the Electron download did not complete >> "%LOG%"
)
echo. >> "%LOG%"

echo --- npm start --- >> "%LOG%"
echo If a window opens, use it, then close it to finish this log. >> "%LOG%"
call npm start >> "%LOG%" 2>&1
echo start exit code: %ERRORLEVEL% >> "%LOG%"

echo. >> "%LOG%"
echo ===== end ===== >> "%LOG%"

echo.
echo Finished. A file called diagnose-log.txt is in this folder.
echo Open it, copy everything, and send it over. The last 40 lines are the useful part.
echo.
pause
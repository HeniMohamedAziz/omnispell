@echo off
title OMNISPELL
cd /d "%~dp0"

if not exist "%~dp0node_modules\electron\dist\electron.exe" (
    echo Installing dependencies...
    call npm install
)

start "" "%~dp0node_modules\electron\dist\electron.exe" .
exit /b

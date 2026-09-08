@echo off
setlocal
REM ---------------------------------------------------------------------------
REM  Stops notifications starting themselves, and stops the one running now.
REM
REM  The counterpart to install-notification-service.cmd. It removes the startup
REM  shortcut and stops the running sender, and nothing else — the project, the
REM  logs and the key file are all left alone, and start-notifications.cmd still
REM  works by hand.
REM ---------------------------------------------------------------------------

cd /d "%~dp0"

set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "LINK=%STARTUP%\WeeklyClass Notifications.lnk"

echo.
echo   WeeklyClass LMS - remove the notification service
echo.

if exist "%LINK%" (
  del /f /q "%LINK%"
  echo   Startup shortcut removed.
) else (
  echo   No startup shortcut found - it was not installed.
)

REM The supervisor and the sender it launched are separate processes, and the
REM sender is the one actually delivering, so both have to go.
REM
REM Matched on the two script names and NOT on the project folder. Matching the
REM folder looked tidier and was wrong: the dev server runs from this same
REM folder, so uninstalling the notification service would have killed whatever
REM else the developer had running. Matched on the image name alone it would be
REM worse still and take out every node process on the machine.
REM
REM It also has to exclude itself. The command line of this PowerShell contains
REM the words it is searching for, so on the first run it matched its own
REM process and killed the matcher mid-sweep.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Get-CimInstance Win32_Process |" ^
  "  Where-Object { $_.ProcessId -ne $PID -and $_.Name -ne 'powershell.exe' -and" ^
  "                 $_.CommandLine -match 'send-push\.js|notification-service\.(cmd|vbs)' } |" ^
  "  ForEach-Object { Write-Host ('   stopped ' + $_.Name + ' (' + $_.ProcessId + ')'); Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"

echo.
echo   Done. Notifications will no longer be delivered automatically.
echo.
echo   You can still send them by hand with start-notifications.cmd,
echo   and reinstall at any time with install-notification-service.cmd.
echo.
pause

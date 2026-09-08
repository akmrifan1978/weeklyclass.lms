@echo off
setlocal
REM ---------------------------------------------------------------------------
REM  Makes notifications start themselves.
REM
REM  Double-click once. From then on the sender starts when you sign in to
REM  Windows, runs invisibly, and restarts itself if it stops.
REM
REM  WHY THE STARTUP FOLDER AND NOT A SCHEDULED TASK. A scheduled task was the
REM  obvious answer and it does not work here: creating a logon-triggered task
REM  needs administrator rights, and this failed with "Access is denied" on the
REM  machine it is meant to run on. A shortcut in your own Startup folder needs
REM  no rights at all, starts at exactly the same moment, and has the advantage
REM  that you can see it — it is a file in a folder you can open, not a setting
REM  buried in a console.
REM
REM  It starts at sign-in rather than at boot. Running before anybody signs in
REM  means storing a Windows password, and that is not a trade worth making for
REM  this.
REM
REM  Double-click uninstall-notification-service.cmd to undo it.
REM ---------------------------------------------------------------------------

cd /d "%~dp0"

set "RUNNER=%CD%\scripts\notification-service.vbs"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "LINK=%STARTUP%\WeeklyClass Notifications.lnk"

echo.
echo   WeeklyClass LMS - install the notification service
echo.

if not exist "%RUNNER%" (
  echo   Missing: %RUNNER%
  echo   Is this file still inside the project folder?
  echo.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo   Node.js is not installed on this computer.
  echo   Install it from https://nodejs.org and run this file again.
  echo.
  pause
  exit /b 1
)

if not exist "serviceAccount.json" (
  echo   serviceAccount.json is missing from this folder.
  echo   Without it the sender cannot read the notifications to send.
  echo.
  pause
  exit /b 1
)

REM Overwrites any earlier shortcut, so running this again is harmless and is
REM also how it is repointed if the project folder moves.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$s = (New-Object -ComObject WScript.Shell).CreateShortcut('%LINK%');" ^
  "$s.TargetPath = 'wscript.exe';" ^
  "$s.Arguments = '\"%RUNNER%\"';" ^
  "$s.WorkingDirectory = '%CD%';" ^
  "$s.Description = 'Delivers WeeklyClass LMS notifications to phones';" ^
  "$s.Save()"

if not exist "%LINK%" (
  echo   Could not create the startup shortcut.
  echo   Expected it at: %LINK%
  echo.
  pause
  exit /b 1
)

echo   Installed. It will start every time you sign in to Windows.
echo.
echo   Starting it now as well, so you do not have to restart...

REM Any copy left running from before, so there are never two senders pushing
REM the same notifications at each other.
taskkill /F /IM wscript.exe /FI "WINDOWTITLE eq notification-service*" >nul 2>nul

start "" wscript.exe "%RUNNER%"

echo.
echo   Done. Notifications are being delivered in the background.
echo.
echo   To check it is working:  logs\notifications.log
echo   To turn it off:          uninstall-notification-service.cmd
echo.
pause

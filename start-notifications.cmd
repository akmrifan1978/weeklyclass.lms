@echo off
REM ---------------------------------------------------------------------------
REM  WeeklyClass LMS - notification sender
REM
REM  Double-click this file to start delivering notifications to phones that
REM  have the app closed. Leave the window open. Closing it stops delivery.
REM
REM  Why this file exists: the sender is a command that has to be run from the
REM  project folder, and typing it in the wrong place fails with an error about
REM  a missing package.json that says nothing about the real problem. This finds
REM  its own folder, so there is nowhere wrong to run it from.
REM ---------------------------------------------------------------------------

REM %~dp0 is the folder this file sits in. /d also switches drive, so it works
REM from D: while the prompt happens to be on C:.
cd /d "%~dp0"

title WeeklyClass notifications - leave this window open

echo.
echo   WeeklyClass LMS - notification sender
echo   Folder: %CD%
echo.

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
  echo.
  echo   Firebase console -^> Project settings -^> Service accounts
  echo   -^> Generate new private key, and save it here as serviceAccount.json
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo   First run - installing dependencies. This takes a few minutes.
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo   Install failed. Check the messages above.
    pause
    exit /b 1
  )
)

echo   Starting. Press Ctrl-C to stop.
echo.
node scripts\send-push.js --watch

REM Only reached if the sender stopped. Hold the window open so whatever it
REM printed can actually be read, instead of the window vanishing.
echo.
echo   The sender has stopped.
pause

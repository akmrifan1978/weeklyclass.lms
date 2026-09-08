@echo off
REM ---------------------------------------------------------------------------
REM  WeeklyClass LMS - notification service (supervisor)
REM
REM  Not meant to be run by hand. Windows starts this at log on, through
REM  notification-service.vbs, which keeps it invisible. To run it yourself and
REM  watch it work, use start-notifications.cmd in the project root instead.
REM
REM  WHY A LOOP. The sender talks to Firestore and to the push services, and
REM  anything that talks to a network eventually fails: a dropped connection, a
REM  laptop waking from sleep, an expired token. Left alone the process would
REM  exit and notifications would stop silently, which is the failure mode this
REM  whole thing exists to prevent. So it is restarted, with a pause so that a
REM  fault that cannot be recovered from does not spin the CPU retrying it
REM  thousands of times a minute.
REM ---------------------------------------------------------------------------

cd /d "%~dp0.."

if not exist "logs" mkdir "logs"
set "LOG=%CD%\logs\notifications.log"

:loop

REM Keep the log from growing without limit on a machine left running for
REM months. Roughly 5 MB, then the previous one is kept and a fresh one begun,
REM so there is always at least one full log to look at.
for %%F in ("%LOG%") do if %%~zF GTR 5000000 (
  move /y "%LOG%" "%LOG%.old" >nul 2>nul
)

echo. >> "%LOG%"
echo [%DATE% %TIME%] starting sender >> "%LOG%"

node scripts\send-push.js --watch >> "%LOG%" 2>&1

echo [%DATE% %TIME%] sender exited with code %ERRORLEVEL% - restarting in 15s >> "%LOG%"

REM ping rather than timeout: timeout fails when there is no console attached,
REM which is exactly the case when Windows starts this in the background.
ping -n 16 127.0.0.1 >nul 2>nul

goto loop

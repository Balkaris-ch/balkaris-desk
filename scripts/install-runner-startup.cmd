@echo off
rem THE RUNNER STARTS ITSELF, AND NOBODY HAS TO REMEMBER IT.
rem
rem Fini, 24 September 2026, with a TikTok sitting in the queue for twelve
rem hours: "Not this again... CHECK Telegram. This is fucking annoying."
rem
rem He was right and the cause was not the code. The runner had only ever been
rem started BY HAND, in a terminal, by whoever was working that day. It died
rem with the session that started it and the desk went on taking links that
rem nothing would ever pick up. A queue whose worker is a person remembering
rem to run a command is not a queue.
rem
rem install-runner-task.cmd registers it as a proper scheduled task, which is
rem tidier -- but schtasks refuses without Administrator, and a fix that needs
rem an elevated prompt is a fix that does not get applied. This one writes the
rem current user's Run key, needs no elevation, and does the same job: at every
rem logon, hidden, forever.
rem
rem run_runner.cmd has its own restart loop, so a crash comes back in ten
rem seconds. This is only about being there after a reboot.
rem
rem Remove it again with:
rem   reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "balkaris-desk runner" /f

set KEY=HKCU\Software\Microsoft\Windows\CurrentVersion\Run
set NAME=balkaris-desk runner
set VBS=E:\Balkaris\Code\balkaris-desk\scripts\hidden.vbs
set CMD=E:\Balkaris\Code\balkaris-desk\scripts\run_runner.cmd

if not exist "%VBS%" goto missing
if not exist "%CMD%" goto missing

reg add "%KEY%" /v "%NAME%" /t REG_SZ /d "wscript.exe \"%VBS%\" \"%CMD%\"" /f >nul
if errorlevel 1 goto fail

echo Registered. The runner now starts at every logon, hidden.
echo.
echo Watch it with:  type E:\Balkaris\Code\balkaris-desk\logs\runner.log
exit /b 0

:missing
echo Cannot find %VBS% or %CMD% -- is the repo where this script thinks it is?
exit /b 1

:fail
echo Could not write the Run key.
exit /b 1

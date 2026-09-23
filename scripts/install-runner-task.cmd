@echo off
rem ONE LINE FOR FINI. Registers the runner as a logon task, the same way
rem sm-fixed's console and worker are registered, so it survives a reboot and
rem comes back without anybody remembering it.
rem
rem It runs as the logged-in user (the 4090, Ollama and yt-dlp all live in that
rem session) and in a hidden window via hidden.vbs, so no stray click closes it.
rem
rem Remove it again with:  schtasks /delete /tn "balkaris-desk runner" /f
schtasks /create /tn "balkaris-desk runner" /sc onlogon /rl limited /f ^
  /tr "wscript.exe \"E:\Balkaris\Code\balkaris-desk\scripts\hidden.vbs\" \"E:\Balkaris\Code\balkaris-desk\scripts\run_runner.cmd\""
if errorlevel 1 goto fail
echo.
echo Registered. Starting it now...
schtasks /run /tn "balkaris-desk runner"
echo.
echo Watch it with:  type E:\Balkaris\Code\balkaris-desk\logs\runner.log
exit /b 0
:fail
echo.
echo Could not register the task. Run this window as Administrator and try again.
exit /b 1

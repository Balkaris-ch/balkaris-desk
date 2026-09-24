@echo off
rem YOU PROBABLY DO NOT NEED THIS ONE. See install-runner-startup.cmd.
rem
rem schtasks refuses /sc onlogon without Administrator, so this script was
rem never actually run -- and on 24 September 2026 a link sat in the queue for
rem twelve hours because the runner had only ever been started by hand. A fix
rem that needs an elevated prompt is a fix that does not get applied.
rem
rem What keeps the runner up now, none of it needing Administrator:
rem   install-runner-startup.cmd   HKCU Run key, so it returns at every logon
rem   runner-guard.cmd             a task every 10 minutes that starts one if
rem                                none is there  (/sc minute IS allowed)
rem   run_runner.cmd               its own restart loop, ~10s after a crash
rem
rem This remains the tidier arrangement if you happen to have an elevated
rem prompt open, and it is harmless beside the others.
rem
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

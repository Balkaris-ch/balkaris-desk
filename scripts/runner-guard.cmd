@echo off
rem IS THE RUNNER THERE? IF NOT, PUT IT BACK.
rem
rem Fini, 24 September 2026, with a link that had sat in the queue for twelve
rem hours on a machine that was switched on the whole time: "Not this again...
rem This is fucking annoying."
rem
rem Three things now have to fail before that can happen again, and they fail
rem in different ways on purpose:
rem
rem   run_runner.cmd            restarts the runner ten seconds after a crash
rem   install-runner-startup    puts it back at every logon
rem   this                      catches everything else -- a process reaped by
rem                             a parent shell closing, a hung node, a machine
rem                             that woke from sleep with the loop gone
rem
rem The first two were not enough today. The loop only survives while its own
rem cmd.exe does, and the Run key only fires at logon; a runner started inside
rem some other session and reaped with it falls between them. This runs every
rem ten minutes from the Task Scheduler, owned by nothing that can take it
rem down with it, and it is the one that would have caught today.
rem
rem It is deliberately dumb: no state, no log of its own, no cleverness about
rem WHY the runner is missing. If nothing is running, start it. If something
rem is, do nothing and exit.
rem
rem   Register:  schtasks /create /tn "balkaris-desk runner guard" /sc minute /mo 10 ^
rem                /tr "wscript.exe \"...\hidden.vbs\" \"...\runner-guard.cmd\"" /f
rem   Remove:    schtasks /delete /tn "balkaris-desk runner guard" /f

setlocal

rem WMIC reads the command line, which is the only way to tell OUR node from
rem the half-dozen others this machine runs -- Next, the engine, Claude's own
rem tools. Matching on "node.exe" alone would see a runner that is not there.
set FOUND=
for /f "delims=" %%A in ('wmic process where "name='node.exe'" get commandline /format:list 2^>nul ^| find /i "src/runner.ts"') do set FOUND=1
if defined FOUND exit /b 0

rem Also catch the wrapper: the loop is up but node is between restarts, which
rem is a perfectly healthy ten-second window and not a reason to start a second.
for /f "delims=" %%A in ('wmic process where "name='cmd.exe'" get commandline /format:list 2^>nul ^| find /i "run_runner.cmd"') do exit /b 0

echo [guard] no runner found, starting one %DATE% %TIME% >> "E:\Balkaris\Code\balkaris-desk\logs\runner.log"
start "" /b wscript.exe "E:\Balkaris\Code\balkaris-desk\scripts\hidden.vbs" "E:\Balkaris\Code\balkaris-desk\scripts\run_runner.cmd"
exit /b 0

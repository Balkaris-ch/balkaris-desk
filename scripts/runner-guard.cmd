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
rem NOT WMIC. The first version of this asked wmic for command lines, and wmic
rem is GONE from Windows 11 (26200) -- and a missing wmic does not error here,
rem it returns nothing, which reads as "no runner is running". A guard built on
rem it would have started a fresh runner every ten minutes, forever, each one
rem polling and fighting for the same card. A check that cannot run must fail
rem loudly or not at all; this one uses Get-CimInstance, which is present on
rem every Windows that can run Node, and exits non-zero if the check itself
rem breaks.
rem
rem   Register:  schtasks /create /tn "balkaris-desk runner guard" /sc minute /mo 10 ^
rem                /tr "wscript.exe \"...\hidden.vbs\" \"...\runner-guard.cmd\"" /f
rem   Remove:    schtasks /delete /tn "balkaris-desk runner guard" /f

setlocal
set LOG=E:\Balkaris\Code\balkaris-desk\logs\runner.log

rem Exit code 0 = something is running, 1 = nothing is, 2 = the check failed.
rem A runner mid-restart shows only its cmd.exe wrapper for about ten seconds,
rem which is healthy and not a reason to start a second one -- so both count.
rem
rem THE NAME FILTER IS NOT AN OPTIMISATION. Without it the search finds ITSELF:
rem the strings below are in this powershell process's own command line, so it
rem matched, reported a healthy runner and started nothing -- while there were
rem none. A guard that always says "fine" is worse than no guard, because it
rem is the thing you stop checking. Only node.exe and cmd.exe can BE a runner.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "try { $p = @(Get-CimInstance Win32_Process -Filter \"Name='node.exe' OR Name='cmd.exe'\" -ErrorAction Stop | Where-Object { $_.CommandLine -and ($_.CommandLine -like '*src/runner.ts*' -or $_.CommandLine -like '*run_runner.cmd*') }); if ($p.Count -gt 0) { exit 0 } else { exit 1 } } catch { exit 2 }"

if errorlevel 2 (
  echo [guard] could not read the process list -- not starting anything %DATE% %TIME% >> "%LOG%"
  exit /b 1
)
if not errorlevel 1 exit /b 0

echo [guard] no runner found, starting one %DATE% %TIME% >> "%LOG%"
start "" /b wscript.exe "E:\Balkaris\Code\balkaris-desk\scripts\hidden.vbs" "E:\Balkaris\Code\balkaris-desk\scripts\run_runner.cmd"
exit /b 0

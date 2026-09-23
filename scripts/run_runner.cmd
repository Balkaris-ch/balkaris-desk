@echo off
rem balkaris-desk runner -- the workstation's half.
rem
rem Polls desk.balkaris.ch for work and does it on the 4090: writes articles,
rem transcribes videos, reads carousels. Started at logon by the
rem "balkaris-desk runner" scheduled task, the same shape as sm-fixed's worker.
rem
rem WHY THIS EXISTS. For a whole day the runner was only ever started by hand,
rem one job at a time, so the desk always believed the workstation was asleep
rem and told Fini so when he shared a carousel. A queue whose worker is a
rem person remembering to run a command is not a queue.
rem
rem Output goes to logs\runner.log because the task runs in a hidden window and
rem a failure is otherwise invisible -- the lesson sm-fixed's worker.cmd
rem carries, and it cost them twice.
cd /d E:\Balkaris\Code\balkaris-desk
if not exist logs mkdir logs
:loop
echo [desk] starting runner %DATE% %TIME% >> logs\runner.log
call npm run runner >> logs\runner.log 2>&1
echo [desk] runner exited -- restarting in 10s >> logs\runner.log
timeout /t 10 /nobreak >nul
goto loop

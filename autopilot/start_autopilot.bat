@echo off
REM ==========================================
REM Claude Code - AutoPilot
REM
REM Usage: start_autopilot.bat [HH:mm] [policy]
REM        Without an argument the end time comes from the
REM        end-time section of AUTOPILOT_TODO.md, else 07:00.
REM        policy is "auto" (keep finding improvements until the deadline)
REM        or "todo" (stop as soon as the TODO list is done). Without an
REM        argument it comes from the policy section of
REM        AUTOPILOT_TODO.md, else "auto".
REM
REM Logic lives in core\autopilot_loop.js. Node.js 22.12+ required.
REM Keep this file ASCII-only.
REM ==========================================

setlocal

node "%~dp0core\autopilot_loop.js" %*

if errorlevel 1 pause

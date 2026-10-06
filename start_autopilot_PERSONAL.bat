@echo off
REM ==========================================
REM Claude Code - AutoPilot (HOME mode)
REM
REM Usage: start_autopilot_PERSONAL.bat [HH:mm] [policy]
REM        Without an argument the end time comes from the
REM        "## run time" section of AUTOPILOT_TODO.md, else 07:00.
REM        policy is "auto" (keep finding improvements until the deadline)
REM        or "todo" (stop as soon as the TODO list is done). Without an
REM        argument it comes from the "## policy" section of
REM        AUTOPILOT_TODO.md, else "auto".
REM
REM Logic lives in core\autopilot_loop.ps1 (system ACP is 949, so Korean
REM text inside a .bat gets mangled by CMD). Keep this file ASCII-only.
REM ==========================================

setlocal

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0core\autopilot_loop.ps1" -ConfigDir ".claude" -Effort "xhigh" -EndTime "%~1" -Policy "%~2"

if errorlevel 1 pause

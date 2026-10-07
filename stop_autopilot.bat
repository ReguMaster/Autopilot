@echo off
REM ==========================================
REM Claude Code - AutoPilot stop request
REM
REM Usage: stop_autopilot.bat
REM        Creates progress\STOP. The loop finishes the current round,
REM        then ends normally and writes the final report. Closing the
REM        console instead cuts the round off mid-work.
REM
REM Keep this file ASCII-only (see start_autopilot_PERSONAL.bat).
REM ==========================================

type nul > "%~dp0progress\STOP"
echo AutoPilot will stop after the current round.
pause

# ==========================================
# Claude Code - AutoPilot 세션 루프
#
# 회차마다 claude 를 -p 로 새로 띄운다. 매 회차가 새 컨텍스트로 시작하므로
# 한 세션에 컨텍스트가 누적돼 auto-compact 가 반복되는 비용이 사라진다.
# 회차 간 인수인계는 autopilot/AUTOPILOT_PROGRESS.md 가 맡는다. 경로에 날짜를 넣으면
# 새 날짜의 첫 회차가 전날 상태를 못 읽고 백지에서 시작하므로 한 자리에 고정한다.
#
# 배치가 아니라 PowerShell 인 이유: 시스템 ACP 가 949 라서 CMD 가 UTF-8
# 배치 파일의 한글을 깨뜨리고, 깨진 바이트가 명령 구분자로 해석된다.
# ==========================================

param(
    [Parameter(Mandatory = $true)][string]$ConfigDir,
    [Parameter(Mandatory = $true)][string]$Effort,
    [string]$EndTime = '',
    [string]$Policy = ''
)

# 콘솔 인코딩을 UTF-8 로 고정한다. 시스템 ACP 가 949 라서 그냥 두면 PowerShell 이
# claude/git 의 UTF-8 stdout 을 CP949 로 디코딩해 한글이 물음표로 영구 유실된다.
# 이 파일 자체도 UTF-8 BOM 으로 저장돼 있어야 한다 - BOM 이 없으면 Windows PowerShell 5.1 이
# 소스를 949 로 잘못 읽어 스크립트 안의 한글 리터럴이 파싱 단계에서부터 깨진다(실측 확인됨).
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
try { [Console]::OutputEncoding = $utf8NoBom } catch { }
$OutputEncoding = $utf8NoBom

$ProjectDir       = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent   # autopilot/core 기준 리포 루트
$MaxTasksPerRound = 2      # 한 회차가 다룰 작업 수 상한 (규모가 크면 1건만 해도 정상)
$MinMinutes       = 20     # 남은 시간이 이보다 적으면 새 회차를 시작하지 않는다
$MaxRounds        = 60
$AutoCompact      = 150000

$env:CLAUDE_CONFIG_DIR = Join-Path $env:USERPROFILE $ConfigDir
Set-Location $ProjectDir

$runDate = Get-Date -Format 'yyyy-MM-dd'
$progressDir = Join-Path $ProjectDir ('autopilot\progress\' + $runDate)
if (-not (Test-Path $progressDir)) { New-Item -ItemType Directory -Path $progressDir | Out-Null }
$log = Join-Path $progressDir ('autopilot_' + (Get-Date -Format 'HHmmss') + '.log')
$progressMdRelPath = 'autopilot/AUTOPILOT_PROGRESS.md'

# 지시개선 정책에서 세션이 "예약 작업 전부 완료"를 알리는 신호. 같은 날 재실행하면
# 지난 실행의 신호가 남아 첫 회차만에 끝나므로 시작할 때 지운다.
$todoDoneMarker = Join-Path $progressDir 'TODO_COMPLETE'
$todoDoneRelPath = "autopilot/progress/$runDate/TODO_COMPLETE"
if (Test-Path $todoDoneMarker) { Remove-Item -LiteralPath $todoDoneMarker -Force }

$todoPath = Join-Path $ProjectDir 'autopilot\AUTOPILOT_TODO.md'
$todoText = if (Test-Path $todoPath) { [System.IO.File]::ReadAllText($todoPath) } else { '' }

# 종료 시각: 인자 > AUTOPILOT_TODO.md 의 "## 실행시간" > 기본값
# 날짜 표기는 일부러 무시하고 시각만 읽는다 - 소유자가 날짜 갱신을 잊었을 때
# AutoPilot 이 아무 것도 못 하고 끝나는 쪽이 더 나쁘다.
$endTimeSource = '기본값'
if ($EndTime) {
    $endTimeSource = '실행 인자'
} elseif ($todoText -match '(?ms)^##\s*실행시간\s*$(.*?)(?=^##|\z)') {
    $section = $Matches[1]
    if ($section -match '(오전|오후)?\s*(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분)?') {
        $h = [int]$Matches[2]
        $m = if ($Matches[3]) { [int]$Matches[3] } else { 0 }
        if ($Matches[1] -eq '오후' -and $h -lt 12) { $h += 12 }
        if ($Matches[1] -eq '오전' -and $h -eq 12) { $h = 0 }
        $EndTime = '{0:00}:{1:00}' -f $h, $m
        $endTimeSource = 'AUTOPILOT_TODO.md'
    } elseif ($section -match '(\d{1,2}):(\d{2})') {
        $EndTime = '{0:00}:{1:00}' -f [int]$Matches[1], [int]$Matches[2]
        $endTimeSource = 'AUTOPILOT_TODO.md'
    }
}
if (-not $EndTime) { $EndTime = '07:00' }

# 개선 정책: 인자 > AUTOPILOT_TODO.md 의 "## 정책" > 기본값(자율개선)
#   자율개선 - 예약 작업을 다 마친 뒤에도 스스로 개선점을 찾아 종료 시각까지 계속한다.
#   지시개선 - 예약 작업이 끝나면 남은 시간이 있어도 전체 실행을 끝낸다.
# 섹션의 첫 유효 줄에 값만 단독으로 적힌 경우에만 인정한다. 산문을 받아주면
# "자율개선 대신 지시개선으로" 같은 문장에서 먼저 검사한 쪽이 이겨, 에러 없이
# 반대 정책으로 밤 작업이 한 회차만에 끝난다.
$policySource = '기본값'
if ($Policy) {
    if ($Policy -match '지시|directed|todo') { $Policy = '지시개선' }
    elseif ($Policy -match '자율|auto|self') { $Policy = '자율개선' }
    else {
        Write-Output "개선 정책 값이 잘못되었습니다: '$Policy' (자율개선 | 지시개선)"
        exit 1
    }
    $policySource = '실행 인자'
} elseif ($todoText -match '(?ms)^##\s*정책\s*$(.*?)(?=^##|\z)') {
    $policyLine = $Matches[1] -split '\r?\n' | Where-Object { $_.Trim() } | Select-Object -First 1
    $policyValue = $policyLine.Trim().Trim([char[]]'`"''*')
    if ($policyValue -eq '자율개선' -or $policyValue -eq '지시개선') {
        $Policy = $policyValue
        $policySource = 'AUTOPILOT_TODO.md'
    } else {
        $policySource = "기본값 (정책 섹션 첫 줄을 해석하지 못함: '" + $policyLine.Trim() + "')"
    }
}
if (-not $Policy) { $Policy = '자율개선' }

# 절대 시각으로 고정 (이미 지난 시각이면 다음 날)
try {
    $deadline = [datetime]::ParseExact($EndTime, 'HH:mm', [cultureinfo]::InvariantCulture)
} catch {
    Write-Output "종료 시각 형식이 잘못되었습니다: '$EndTime' (예: 07:00)"
    exit 1
}
if ($deadline -le (Get-Date)) { $deadline = $deadline.AddDays(1) }

Write-Output '=========================================='
Write-Output '  Claude Code AutoPilot'
Write-Output '=========================================='
Write-Output ''
Write-Output "Project  : $ProjectDir"
Write-Output "Config   : $env:CLAUDE_CONFIG_DIR"
Write-Output 'Model    : Opus (fallback: Sonnet)'
Write-Output "Effort   : $Effort"
Write-Output "Deadline : $($deadline.ToString('yyyy-MM-dd HH:mm:ss')) (출처: $endTimeSource)"
Write-Output "Policy   : $Policy (출처: $policySource)"
Write-Output "Tasks    : 회차당 최대 ${MaxTasksPerRound}건"
Write-Output "Log      : $log"
Write-Output ''

if ($Policy -eq '지시개선') {
    $policyPrompt = "이번 실행의 개선 정책은 [지시개선]이다. autopilot/AUTOPILOT_TODO.md 에 예약된 작업만 처리하고 스스로 새 개선 작업을 찾지 마라. 예약 작업이 모두 완료되었거나 TODO 에 처리할 작업이 남아있지 않으면, 종료 예정 시각까지 시간이 남아 있어도 진행 기록을 갱신한 뒤 빈 파일 ${todoDoneRelPath} 를 생성하고 세션을 종료하라 - 실행 스크립트가 이 파일을 보고 전체 실행을 끝낸다. 아직 처리할 예약 작업이 남아 있으면 이 파일을 만들지 마라."
} else {
    $policyPrompt = "이번 실행의 개선 정책은 [자율개선]이다. autopilot/AUTOPILOT_TODO.md 의 예약 작업을 모두 마친 뒤에도 종료하지 말고, AUTOPILOT.md 의 '작업 탐색과 선택' 기준으로 스스로 개선 작업을 찾아 종료 예정 시각까지 계속 진행하라."
}

$round = 0
$fails = 0
$aborted = $false
$todoDone = $false

while ($true) {
    if ($round -ge $MaxRounds) { break }

    $remain = [int]($deadline - (Get-Date)).TotalMinutes
    if ($remain -lt $MinMinutes) { break }

    $round++
    Write-Output "[${round}회차] 시작 - 남은 시간 ${remain}분"

    $header = "`r`n==================== ROUND $round (남은 ${remain}분) ===================="
    $header | Add-Content -LiteralPath $log -Encoding UTF8

    $prompt = @"
CLAUDE.md를 기본 프로젝트 지침으로 사용하고, autopilot/core/AUTOPILOT.md의 작업 지침에 따라 자율 개발을 수행하라. 중요사항!: autopilot/core/AUTOPILOT_POLICY.md의 모든 금지사항과 안전정책을 반드시 최우선으로 준수하라. 작업을 고르기 전에 autopilot/AUTOPILOT_TODO.md 를 먼저 읽고 소유자가 예약한 작업이 있으면 작성된 순서대로 그것을 우선 처리하며, ${progressMdRelPath} 를 읽어 이전 회차가 남긴 상태와 다음 작업을 이어받아라(파일이 없으면 새로 생성하라). ${policyPrompt} 이 세션은 AutoPilot ${round}회차이고 전체 종료 예정 시각은 $($deadline.ToString('yyyy-MM-dd HH:mm')), 남은 시간은 약 ${remain}분이다. 이번 세션의 작업량은 작업 범위를 보고 스스로 정하되 최대 ${MaxTasksPerRound}건을 넘기지 말고, 규모가 큰 작업이면 1건만 처리하라. 작업을 완료·검증·commit 하고 ${progressMdRelPath} 를 갱신한 뒤 세션을 끝내라. 실행 스크립트가 새 컨텍스트로 다음 회차를 자동 실행하므로 여기서 끝내는 것이 정상이며, 남은 작업이 있다는 이유로 세션을 붙잡지 말 것. 반대로 남은 시간이 한 작업을 안전하게 마치기에 부족하면 새 작업을 시작하지 말고 진행 중인 것만 정리·기록하고 즉시 종료하라.
"@

    # --fallback-model 은 -p 에서만 동작한다 (대화형 세션에서는 무효)
    $out = & claude `
        --model opus `
        --effort $Effort `
        --fallback-model sonnet `
        --autocompact $AutoCompact `
        --dangerously-skip-permissions `
        -p $prompt
    $exitCode = $LASTEXITCODE

    $out | Add-Content -LiteralPath $log -Encoding UTF8

    if ($exitCode -ne 0) {
        $fails++
        Write-Output "[${round}회차] 비정상 종료 (exit ${exitCode}) - 연속 실패 ${fails}회"
    } else {
        $fails = 0
    }

    if ($out) { $out | Select-Object -Last 15 | ForEach-Object { Write-Output $_ } }
    Write-Output ''

    if ($Policy -eq '지시개선' -and (Test-Path $todoDoneMarker)) { $todoDone = $true; break }

    if ($fails -ge 3) { $aborted = $true; break }
}

Write-Output ''
Write-Output '=========================================='
if ($aborted) {
    Write-Output "  연속 3회 실패로 중단 (${round}회차)"
} elseif ($todoDone) {
    Write-Output "  AutoPilot 종료 - 지시개선 정책: 예약 작업 완료 (${round}회차)"
} elseif ($round -ge $MaxRounds) {
    Write-Output "  AutoPilot 종료 - 회차 상한 ${MaxRounds}회 도달"
} else {
    Write-Output "  AutoPilot 종료 - 예정 시각 $($deadline.ToString('yyyy-MM-dd HH:mm')) 도달"
}
Write-Output '=========================================='
Write-Output ''
Write-Output '--- 이번 실행 중 쌓인 commit ---'

$summary = @()
$summary += ''
$summary += '==================== 최종 요약 ===================='
$gitLog = & git -c core.quotepath=false --no-pager log --oneline -20
$gitStatus = & git -c core.quotepath=false status
$gitLog | ForEach-Object { Write-Output $_ }
Write-Output ''
$gitStatus | ForEach-Object { Write-Output $_ }
$summary += $gitLog
$summary += ''
$summary += $gitStatus
$summary | Add-Content -LiteralPath $log -Encoding UTF8

Write-Output ''
Write-Output "전체 로그: $log"

if ($aborted) { exit 1 }
exit 0

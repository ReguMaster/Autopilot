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
$MaxRoundMinutes  = 120    # 회차 강제 종료 시한. 종료 시각이 더 가까우면 종료 시각에 끊는다
$RetryWaitMinutes = 5, 15, 30   # 실패 회차 뒤 재시도 전 대기. 이 횟수를 넘겨 연속 실패하면 중단한다
$MaxIdleRounds    = 2      # 새 commit 없이 끝난 회차가 연속 이만큼이면 남은 작업이 없는 것으로 보고 끝낸다
$AutoCompact      = 150000

$env:CLAUDE_CONFIG_DIR = Join-Path $env:USERPROFILE $ConfigDir
Set-Location $ProjectDir

$claudeExe = (Get-Command claude -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1).Source
if (-not $claudeExe) { Write-Output 'PATH 에서 claude 를 찾지 못했습니다.'; exit 1 }

function Write-Log([string]$Text) {
    Write-Host $Text
    $Text | Add-Content -LiteralPath $log -Encoding UTF8
}

# stream-json 한 줄을 사람이 읽을 형태로 줄여 콘솔과 로그에 남긴다.
# 도구 결과(user)와 거대한 줄은 파싱하지 않는다 - PowerShell 5.1 의 ConvertFrom-Json 은 2MB 를 넘으면 실패한다.
function Write-StreamEvent([string]$Line) {
    if ($Line.StartsWith('{"type":"user"') -or $Line.Length -gt 1000000) { return }
    try { $e = $Line | ConvertFrom-Json } catch { return }
    if ($e.parent_tool_use_id) { return }   # 서브에이전트 내부 진행은 생략
    $now = Get-Date -Format 'HH:mm:ss'
    switch ($e.type) {
        'system' {
            if ($e.subtype -eq 'init') {
                $script:stat.Session = $e.session_id
                Write-Log "$now [세션] $($e.session_id) (claude --resume 으로 전체 기록 확인)"
            }
        }
        'assistant' {
            foreach ($c in $e.message.content) {
                if ($c.type -eq 'text' -and $c.text.Trim()) {
                    Write-Log "$now $($c.text.Trim())"
                } elseif ($c.type -eq 'tool_use') {
                    $i = $c.input
                    $arg = @($i.command, $i.file_path, $i.pattern, $i.description, $i.url, $i.path) | Where-Object { $_ } | Select-Object -First 1
                    if ($arg) {
                        $arg = ([string]$arg -split '\r?\n')[0]
                        if ($arg.Length -gt 120) { $arg = $arg.Substring(0, 120) + '...' }
                    }
                    Write-Log "$now   > $($c.name) $arg"
                }
            }
        }
        'rate_limit_event' {
            # 허용 상태에서도 매번 오므로 리셋 시각은 항상 갱신하고, allowed* 가 아닐 때만 한도 도달로 본다
            $info = $e.rate_limit_info
            if ($info.resetsAt) { $script:stat.ResetAt = [DateTimeOffset]::FromUnixTimeSeconds([long]$info.resetsAt).LocalDateTime }
            if ($info.status -notlike 'allowed*') {
                $script:stat.LimitHit = $true
                Write-Log ("$now [사용량 한도] {0} {1} · {2:HH:mm} 리셋" -f $info.rateLimitType, $info.status, $script:stat.ResetAt)
            }
        }
        'result' {
            $script:stat.IsError = [bool]$e.is_error
            $script:stat.Turns = $e.num_turns
            $script:stat.Cost = $e.total_cost_usd
            $script:stat.Summary = $e.result
            $min = [Math]::Round($e.duration_ms / 60000, 1)
            Write-Log ("$now [결과] {0} · {1}턴 · {2}분 · `${3:N2}" -f $e.subtype, $e.num_turns, $min, $e.total_cost_usd)
        }
    }
}

# & claude 로 부르면 멈춘 회차(watch 모드 테스트, 끝나지 않는 dev server 등)를 끊을 수 없어 Process 로 띄운다.
# 프롬프트는 stdin 으로 넘긴다 - npm 설치본(claude.cmd)은 인자가 cmd 를 거치며 특수문자가 해석된다.
function Invoke-Claude([string]$Prompt, [datetime]$KillAt) {
    $psi = New-Object System.Diagnostics.ProcessStartInfo $claudeExe
    # --fallback-model 은 -p 에서만 동작한다 (대화형 세션에서는 무효)
    # text 출력은 세션이 끝나야 한꺼번에 나오므로 진행 상황을 보려면 stream-json 이어야 한다 (--verbose 필수)
    $psi.Arguments = "--model opus --effort $Effort --fallback-model sonnet --autocompact $AutoCompact --dangerously-skip-permissions --output-format stream-json --verbose -p"
    $psi.WorkingDirectory = $ProjectDir   # Set-Location 은 .NET 프로세스의 현재 디렉터리를 바꾸지 않는다
    $psi.UseShellExecute = $false
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.StandardOutputEncoding = $utf8NoBom
    $psi.StandardErrorEncoding = $utf8NoBom
    $p = [System.Diagnostics.Process]::Start($psi)
    $bytes = $utf8NoBom.GetBytes($Prompt)
    $p.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)
    $p.StandardInput.Close()
    $stderr = $p.StandardError.ReadToEndAsync()

    $timedOut = $false
    $nextReport = [datetime]::MinValue
    $read = $p.StandardOutput.ReadLineAsync()
    while ($true) {
        if ((Get-Date) -ge $nextReport) {
            Write-Report "${round}회차 진행 중 · $($roundStart.ToString('HH:mm')) 시작 · 시한 $($KillAt.ToString('HH:mm'))" -Live
            $nextReport = (Get-Date).AddSeconds(30)
        }
        if (-not $read.Wait(1000)) {
            # 손자 프로세스가 파이프를 물고 있으면 EOF 가 오지 않으므로 claude 가 끝났으면 더 기다리지 않는다
            if ($p.HasExited) { break }
            if ((Get-Date) -lt $KillAt) { continue }
            $timedOut = $true
            & taskkill /PID $p.Id /T /F 2>&1 | Out-Null
            break
        }
        if ($null -eq $read.Result) { break }
        Write-StreamEvent $read.Result
        $read = $p.StandardOutput.ReadLineAsync()
    }
    [void]$p.WaitForExit(30000)
    $err = if ($stderr.Wait(5000)) { $stderr.Result.Trim() } else { '' }
    if ($err) { Write-Log "[stderr] $err" }
    @{ ExitCode = $(if ($p.HasExited) { $p.ExitCode } else { -1 }); TimedOut = $timedOut; Stderr = $err }
}

# 리포트용 회차 기록. commit 은 회차 시작 이후 시각으로 고른다 - 회차 중 ai/autopilot 으로
# 전환하면 HEAD 범위(headBefore..HEAD)에는 지난 실행의 commit 까지 섞인다.
# --since 는 초 단위라 경계가 겹칠 수 있어 이미 기록한 commit 은 건너뛴다.
$rounds = New-Object System.Collections.Generic.List[object]
$seenCommits = New-Object System.Collections.Generic.HashSet[string]
function Add-RoundRecord([string]$Outcome) {
    $commits = @(& git -c core.quotepath=false log "--since=$($roundStart.ToString('s'))" --format='%h%x09%s' HEAD 2>$null | Where-Object { $seenCommits.Add(($_ -split "`t")[0]) } | ForEach-Object {
        $hash, $subject = $_ -split "`t", 2
        [pscustomobject]@{ Hash = $hash; Subject = $subject; Stat = ((& git show --shortstat --format= $hash 2>$null) -join ' ').Trim() }
    })
    $rounds.Add([pscustomobject]@{
        Round = $round; Start = $roundStart; Minutes = [Math]::Round(((Get-Date) - $roundStart).TotalMinutes, 1)
        Outcome = $Outcome; Session = $stat.Session; Turns = $stat.Turns; Cost = $stat.Cost
        Summary = $stat.Summary; Stderr = $r.Stderr; Commits = $commits
    })
}

function Escape-Html([string]$Text) { [System.Net.WebUtility]::HtmlEncode($Text) }

# 더블클릭 실행은 성공하면 콘솔 창이 닫히므로, 아침에 볼 결과를 HTML 한 장으로 남긴다.
# -Live 는 실행 중 갱신본이다. 시작할 때 연 브라우저 탭이 30초마다 다시 읽어 진행 상황을 보여 준다.
function Write-Report([string]$Status, [bool]$Bad, [switch]$Live) {
    $css = @'
:root{--bg:#f7f7f5;--card:#fff;--fg:#1d1d1f;--muted:#6b6b70;--line:#e2e2de;--ok:#1f7a4d;--warn:#8f5d00;--bad:#b3261e;--chip:#efefeb}
@media (prefers-color-scheme:dark){:root{--bg:#161618;--card:#1f1f22;--fg:#ececee;--muted:#9a9aa2;--line:#303035;--ok:#5cc28f;--warn:#e0b04a;--bad:#f2827a;--chip:#2a2a2e;color-scheme:dark}}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.55 system-ui,"Segoe UI","Malgun Gothic",sans-serif}
main{max-width:880px;margin:0 auto;padding:32px 16px 64px;overflow-wrap:anywhere}
h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:28px 0 10px}
.sub,.meta{color:var(--muted)}.meta{font-size:12px;font-variant-numeric:tabular-nums}
.box{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px 14px;margin-bottom:10px}
.box p{margin:8px 0 0}.box.bad{border-color:var(--bad)}.box.warn{border-color:var(--warn)}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}.tiles .box{margin:0}
.tiles b{display:block;font-size:22px;font-variant-numeric:tabular-nums}
.head{display:flex;flex-wrap:wrap;gap:4px 12px;align-items:baseline}
.badge{font-size:12px;padding:1px 8px;border-radius:999px;background:var(--chip)}
.ok{color:var(--ok)}.warn{color:var(--warn)}.bad{color:var(--bad)}
ul{margin:8px 0 0;padding-left:18px}
code,pre{font:12.5px/1.5 ui-monospace,Consolas,monospace}
details{margin-top:8px}summary{cursor:pointer;color:var(--muted);font-size:12px}
pre{white-space:pre-wrap;word-break:break-word;color:var(--fg);background:var(--bg);border-radius:6px;padding:10px;margin:6px 0 0}
'@
    $commitCount = ($rounds | ForEach-Object { $_.Commits.Count } | Measure-Object -Sum).Sum
    $costSum = ($rounds | Where-Object { $null -ne $_.Cost } | Measure-Object Cost -Sum).Sum
    $span = (Get-Date) - $runStart
    $elapsed = if ($span.TotalHours -ge 1) { '{0}시간 {1}분' -f [int][Math]::Floor($span.TotalHours), $span.Minutes } else { '{0}분' -f [int]$span.TotalMinutes }
    $branch = & git rev-parse --abbrev-ref HEAD 2>$null

    $cards = foreach ($x in $rounds) {
        $cls = switch -Wildcard ($x.Outcome) { '완료' { 'ok' } '사용량 한도' { 'warn' } 'commit 없음' { '' } default { 'bad' } }
        $meta = @($x.Start.ToString('HH:mm'), "$($x.Minutes)분")
        if ($null -ne $x.Turns) { $meta += "$($x.Turns)턴" }
        if ($null -ne $x.Cost) { $meta += ('${0:N2}' -f $x.Cost) }
        $html = "<section class=`"box`"><div class=`"head`"><strong>$($x.Round)회차</strong><span class=`"badge $cls`">$(Escape-Html $x.Outcome)</span><span class=`"meta`">$($meta -join ' · ')</span></div>"
        if ($x.Commits.Count) {
            $html += '<ul>' + (($x.Commits | ForEach-Object { "<li><code>$($_.Hash)</code> $(Escape-Html $_.Subject) <span class=`"meta`">$(Escape-Html $_.Stat)</span></li>" }) -join '') + '</ul>'
        }
        if ($x.Summary) { $html += "<details><summary>세션 요약</summary><pre>$(Escape-Html $x.Summary)</pre></details>" }
        if ($x.Stderr) { $html += "<details><summary>stderr</summary><pre>$(Escape-Html $x.Stderr)</pre></details>" }
        if ($x.Session) { $html += "<p class=`"meta`">claude --resume $(Escape-Html $x.Session)</p>" }
        $html + '</section>'
    }
    if (-not $cards) { $cards = '<p class="meta">실행된 회차가 없습니다.</p>' }

    $reload = $liveNote = $tree = ''
    if ($Live) {
        # 새로고침 스크립트를 head 맨 앞에 둬서 반쯤 쓰인 파일을 읽어도 다음 주기에 복구된다. 펼친 details 가 있으면 미룬다
        $reload = '<script>setTimeout(function r(){document.querySelector("details[open]")?setTimeout(r,3e4):location.reload()},3e4)</script>'
        $liveNote = '<p class="meta">종료 예정 {0:HH:mm} · 남은 {1}분</p>' -f $deadline, [int]($deadline - (Get-Date)).TotalMinutes
        $liveNote += if (Test-Path $stopFile) { '<p class="warn">중단 요청됨 - 이번 회차를 마치면 종료합니다.</p>' } else { '<p class="meta">이번 회차를 마치고 멈추려면 autopilot/stop_autopilot.bat 을 실행하세요.</p>' }
        $tail = Get-Content -LiteralPath $log -Tail 15 -Encoding UTF8 -ErrorAction SilentlyContinue
        if ($tail) { $liveNote += '<pre>' + (Escape-Html ($tail -join "`n")) + '</pre>' }
    } else {
        # 진행 중에는 부르지 않는다 - git status 는 index.lock 을 잡아 세션의 git 명령과 부딪힐 수 있다
        $dirty = & git -c core.quotepath=false status --short 2>$null
        $tree = '<h2>작업 트리</h2>' + $(if ($dirty) { '<p class="warn">commit되지 않은 변경이 남아 있습니다.</p><pre>' + (Escape-Html ($dirty -join "`n")) + '</pre>' } else { '<p class="meta">깨끗합니다.</p>' })
    }
    $html = @"
<!doctype html>
<html lang="ko"><head><meta charset="utf-8">$reload<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AutoPilot $(if ($Live) { '진행 중' } else { '리포트' }) $($runStart.ToString('yyyy-MM-dd HH:mm'))</title><style>$css</style></head>
<body><main>
<h1>AutoPilot 리포트</h1>
<p class="sub">$(Escape-Html $ProjectDir) · $($runStart.ToString('MM-dd HH:mm')) → $((Get-Date).ToString('MM-dd HH:mm')) · $Policy · 브랜치 $(Escape-Html $branch)</p>
<div class="box $(if ($Bad) { 'bad' })">$(Escape-Html $Status)$liveNote</div>
<div class="tiles">
<div class="box"><b>$($rounds.Count)</b><span class="meta">회차</span></div>
<div class="box"><b>$([int]$commitCount)</b><span class="meta">commit</span></div>
<div class="box"><b>$elapsed</b><span class="meta">소요 시간</span></div>
<div class="box"><b>$('${0:N2}' -f [double]$costSum)</b><span class="meta">비용 (API 환산)</span></div>
</div>
<h2>회차</h2>
$($cards -join "`n")
$tree
<p class="meta">전체 로그: $(Escape-Html $log)</p>
</main></body></html>
"@
    # 브라우저가 읽는 순간과 겹쳐 실패한 진행 중 갱신은 다음 주기에 다시 쓴다
    try { [System.IO.File]::WriteAllText($report, $html, $utf8NoBom) } catch { if (-not $Live) { throw } }
}

$runDate = Get-Date -Format 'yyyy-MM-dd'
$progressDir = Join-Path $ProjectDir ('autopilot\progress\' + $runDate)
if (-not (Test-Path $progressDir)) { New-Item -ItemType Directory -Path $progressDir | Out-Null }
$runStart = Get-Date
$log = Join-Path $progressDir ('autopilot_' + $runStart.ToString('HHmmss') + '.log')
$report = Join-Path $progressDir ('report_' + $runStart.ToString('HHmmss') + '.html')
$progressMdRelPath = 'autopilot/AUTOPILOT_PROGRESS.md'

# 지시개선 정책에서 세션이 "예약 작업 전부 완료"를 알리는 신호. 같은 날 재실행하면
# 지난 실행의 신호가 남아 첫 회차만에 끝나므로 시작할 때 지운다.
$todoDoneMarker = Join-Path $progressDir 'TODO_COMPLETE'
$todoDoneRelPath = "autopilot/progress/$runDate/TODO_COMPLETE"
if (Test-Path $todoDoneMarker) { Remove-Item -LiteralPath $todoDoneMarker -Force }

# 소유자가 stop_autopilot.bat 으로 남기는 "이번 회차까지만" 신호. 창을 닫으면 회차가 중간에 끊기므로 이쪽을 쓴다.
# 날짜 폴더가 아닌 이유: bat 의 %date% 형식이 로캘마다 다르다.
$stopFile = Join-Path $ProjectDir 'autopilot\progress\STOP'
if (Test-Path $stopFile) { Remove-Item -LiteralPath $stopFile -Force }

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
Write-Output "Report   : $report"
Write-Output 'Stop     : autopilot\stop_autopilot.bat (현재 회차를 마치고 종료)'
Write-Output ''

if ($Policy -eq '지시개선') {
    $policyPrompt = "이번 실행의 개선 정책은 [지시개선]이다. autopilot/AUTOPILOT_TODO.md 에 예약된 작업만 처리하고 스스로 새 개선 작업을 찾지 마라. 예약 작업이 모두 완료되었거나 TODO 에 처리할 작업이 남아있지 않으면, 종료 예정 시각까지 시간이 남아 있어도 진행 기록을 갱신한 뒤 빈 파일 ${todoDoneRelPath} 를 생성하고 세션을 종료하라 - 실행 스크립트가 이 파일을 보고 전체 실행을 끝낸다. 아직 처리할 예약 작업이 남아 있으면 이 파일을 만들지 마라."
} else {
    $policyPrompt = "이번 실행의 개선 정책은 [자율개선]이다. autopilot/AUTOPILOT_TODO.md 의 예약 작업을 모두 마친 뒤에도 종료하지 말고, AUTOPILOT.md 의 '작업 탐색과 선택' 기준으로 스스로 개선 작업을 찾아 종료 예정 시각까지 계속 진행하라."
}

$round = 0
$fails = 0
$idle = 0
$aborted = $false
$todoDone = $false
$idleStop = $false
$limitStop = $false
$stopRequested = $false

Write-Report '시작 중' -Live
try { Start-Process -FilePath $report } catch { }

while ($true) {
    if ($round -ge $MaxRounds) { break }
    if (Test-Path $stopFile) { $stopRequested = $true; break }

    $remain = [int]($deadline - (Get-Date)).TotalMinutes
    if ($remain -lt $MinMinutes) { break }

    $round++
    Write-Output "[${round}회차] 시작 - 남은 시간 ${remain}분"

    $header = "`r`n==================== ROUND $round (남은 ${remain}분) ===================="
    $header | Add-Content -LiteralPath $log -Encoding UTF8

    $prompt = @"
CLAUDE.md를 기본 프로젝트 지침으로 사용하고, autopilot/core/AUTOPILOT.md의 작업 지침에 따라 자율 개발을 수행하라. 중요사항!: autopilot/core/AUTOPILOT_POLICY.md의 모든 금지사항과 안전정책을 반드시 최우선으로 준수하라. 정책의 작업 범위인 프로젝트 루트는 ${ProjectDir} 이다. 작업을 고르기 전에 autopilot/AUTOPILOT_TODO.md 를 먼저 읽고 소유자가 예약한 작업이 있으면 작성된 순서대로 그것을 우선 처리하며, ${progressMdRelPath} 를 읽어 이전 회차가 남긴 상태와 다음 작업을 이어받아라(파일이 없으면 새로 생성하라). ${policyPrompt} 이 세션은 AutoPilot ${round}회차이고 전체 종료 예정 시각은 $($deadline.ToString('yyyy-MM-dd HH:mm')), 남은 시간은 약 ${remain}분이다. 이번 세션의 작업량은 작업 범위를 보고 스스로 정하되 최대 ${MaxTasksPerRound}건을 넘기지 말고, 규모가 큰 작업이면 1건만 처리하라. 작업을 완료·검증·commit 하고 ${progressMdRelPath} 를 갱신한 뒤 세션을 끝내라. 실행 스크립트가 새 컨텍스트로 다음 회차를 자동 실행하므로 여기서 끝내는 것이 정상이며, 남은 작업이 있다는 이유로 세션을 붙잡지 말 것. 반대로 남은 시간이 한 작업을 안전하게 마치기에 부족하면 새 작업을 시작하지 말고 진행 중인 것만 정리·기록하고 즉시 종료하라.
"@

    $headBefore = & git rev-parse HEAD 2>$null

    $killAt = (Get-Date).AddMinutes([Math]::Min([double]$remain, $MaxRoundMinutes))   # [double] 없으면 Min(int,int) 로 잘린다
    $script:stat = @{ LimitHit = $false; ResetAt = $null; IsError = $false }
    $roundStart = Get-Date
    $r = Invoke-Claude $prompt $killAt
    $exitCode = $r.ExitCode
    if ($r.TimedOut) { Write-Log "[${round}회차] 시한 $($killAt.ToString('HH:mm')) 초과로 강제 종료" }

    # 사용량 한도는 장애가 아니라 리셋까지 기다리면 풀리므로 실패로 세지 않는다.
    # 초과 사용(overage)으로 회차가 계속 진행됐다면 기다리지 않는다.
    if ($stat.LimitHit -and ($exitCode -ne 0 -or $stat.IsError) -and $stat.ResetAt -gt (Get-Date)) {
        Add-RoundRecord '사용량 한도'
        if (($deadline - $stat.ResetAt).TotalMinutes -lt $MinMinutes) {
            Write-Log ("[${round}회차] 사용량 한도 - 리셋 {0:HH:mm} 이 종료 시각에 걸려 종료" -f $stat.ResetAt)
            $limitStop = $true
            break
        }
        Write-Log ("[${round}회차] 사용량 한도 - {0:HH:mm} 리셋까지 대기 (실패로 세지 않음)" -f $stat.ResetAt)
        Write-Report ("사용량 한도 - {0:HH:mm} 리셋까지 대기 · 지금 창을 닫아도 안전합니다" -f $stat.ResetAt) -Live
        Start-Sleep -Seconds ([int]($stat.ResetAt - (Get-Date)).TotalSeconds + 60)
        Write-Output ''
        continue
    }

    if ($exitCode -ne 0) {
        $fails++
        Write-Log "[${round}회차] 비정상 종료 (exit ${exitCode}) - 연속 실패 ${fails}회"
    } else {
        $fails = 0
        # 진행 기록만 고친 commit 은 작업으로 치지 않는다
        $changed = & git diff --name-only $headBefore HEAD -- . ':(exclude)autopilot/AUTOPILOT_PROGRESS.md' 2>$null
        if (-not $headBefore -or $changed) { $idle = 0 } else {
            $idle++
            Write-Log "[${round}회차] 새 commit 없음 (연속 ${idle}/${MaxIdleRounds})"
        }
    }
    Add-RoundRecord $(if ($r.TimedOut) { '시한 초과' } elseif ($exitCode -ne 0) { "실패 (exit $exitCode)" } elseif ($idle -gt 0) { 'commit 없음' } else { '완료' })

    Write-Output ''

    if ($Policy -eq '지시개선' -and (Test-Path $todoDoneMarker)) { $todoDone = $true; break }
    if ($idle -ge $MaxIdleRounds) { $idleStop = $true; break }

    if ($fails -gt $RetryWaitMinutes.Count) { $aborted = $true; break }
    if (Test-Path $stopFile) { $stopRequested = $true; break }
    if ($fails -gt 0) {
        $wait = $RetryWaitMinutes[$fails - 1]
        if (($deadline - (Get-Date)).TotalMinutes - $wait -lt $MinMinutes) { break }
        Write-Log "[${round}회차] ${wait}분 후 재시도"
        Write-Report ("${round}회차 실패 - {0:HH:mm} 재시도 예정 · 지금 창을 닫아도 안전합니다" -f (Get-Date).AddMinutes($wait)) $true -Live
        Start-Sleep -Seconds ($wait * 60)
    }
}

$endReason = if ($aborted) {
    "연속 ${fails}회 실패로 중단 (${round}회차)"
} elseif ($stopRequested) {
    "AutoPilot 종료 - 중단 요청 (${round}회차)"
} elseif ($todoDone) {
    "AutoPilot 종료 - 지시개선 정책: 예약 작업 완료 (${round}회차)"
} elseif ($idleStop) {
    "AutoPilot 종료 - ${MaxIdleRounds}회차 연속 새 commit 없음 (${round}회차)"
} elseif ($limitStop) {
    "AutoPilot 종료 - 사용량 한도 리셋이 종료 시각 이후 (${round}회차)"
} elseif ($round -ge $MaxRounds) {
    "AutoPilot 종료 - 회차 상한 ${MaxRounds}회 도달"
} else {
    "AutoPilot 종료 - 예정 시각 $($deadline.ToString('yyyy-MM-dd HH:mm')) 도달"
}
Write-Output ''
Write-Output '=========================================='
Write-Output "  $endReason"
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

Write-Report $endReason $aborted
Write-Output ''
Write-Output "전체 로그: $log"
Write-Output "리포트  : $report"

if ($aborted) { exit 1 }
exit 0

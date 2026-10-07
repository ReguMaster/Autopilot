# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> 이 문서는 **AutoPilot 키트 자체를 개발할 때**의 지침이다.
> 대상 프로젝트의 `autopilot/` 폴더 안에서 AutoPilot 회차로 실행 중이라면 이 문서는 무시하고 `core/AUTOPILOT.md`를 따른다.

## 개요

Claude Code를 무인으로 반복 실행해 대상 프로젝트를 자율 개선시키는 키트다. 빌드·의존성·테스트 프레임워크 없이 PowerShell 스크립트 1개와 Markdown 지침으로만 구성된다.
이 저장소는 대상 프로젝트 안에 `autopilot/` 폴더로 놓여 실행되는 것을 전제로 한다.

## 명령

```bash
# 실행 (실제 claude 세션을 --dangerously-skip-permissions 로 띄우므로 주의)
start_autopilot_PERSONAL.bat [HH:mm] [auto|todo]

# 구문 검사 - 테스트가 없으므로 ps1 수정 후 최소 검증 수단
powershell -NoProfile -Command '$e=$null; [void][System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path "core\autopilot_loop.ps1"), [ref]$null, [ref]$e); if ($e) { $e } else { "OK" }'

# BOM 유지 확인 - 결과가 ef bb bf 여야 한다
head -c 3 core/autopilot_loop.ps1 | od -An -tx1
```

루프 동작 검증은 실제 세션 대신 가짜 `claude.cmd`를 PATH 맨 앞에 두고 한다(스크립트가 `Get-Command claude`로 PATH 순서대로 찾는다).
이때 대상 프로젝트 역할을 할 임시 git 저장소에 키트를 `autopilot/`으로 복사하고, 복사본의 `$MinMinutes` · `$MaxRoundMinutes` · `$RetryWaitMinutes`를 초 단위로 줄여 돌린다.
가짜가 git을 건드린다면 **이 저장소가 아닌 cwd에서** 실행하고, 가짜 안에서도 cwd를 확인해 대상 폴더가 아니면 바로 종료시킨다.
가짜 출력은 실제처럼 공백 없는 JSON(`{"type":"assistant",...}`)이어야 `user` 이벤트 건너뛰기 경로가 검증된다.
테스트 복사본에서는 리포트 자동 열기(`Start-Process -FilePath $report`) 줄을 지운다. 리포트 화면은 Edge headless `--screenshot`으로 확인하되, 창 폭이 약 500px 아래로 줄지 않으므로 좁은 화면은 400px iframe에 넣어 찍는다.

## 구조

실행 흐름: `start_autopilot_PERSONAL.bat` → `core/autopilot_loop.ps1` → 회차마다 `claude -p` → 세션이 `core/AUTOPILOT.md` · `core/AUTOPILOT_POLICY.md`를 읽고 작업.

- **bat**: 인자 전달만 한다(`-ConfigDir`, `-Effort`, `-EndTime`, `-Policy`). 로직을 넣지 않는다.
- **ps1**: 종료 시각·정책 결정, 회차 루프, 프롬프트 조립, 실패 카운트, 로그, 아침 리포트. 전체 종료 판정은 스크립트만 한다.
  리포트는 회차마다 `Add-RoundRecord`로 쌓고 종료 시 `Write-Report`가 단일 HTML로 쓴다. 회차 commit은 `--since <회차 시작>` + 이미 본 hash 제외로 고른다(`headBefore..HEAD`는 브랜치 전환 시 지난 실행 commit이 섞인다).
- **AUTOPILOT.md**: 세션이 따르는 작업 절차. **AUTOPILOT_POLICY.md**: 안전 정책, 모든 절차보다 우선.

### 경로 모델

- `$ProjectDir`는 `core/`의 두 단계 위(= 대상 프로젝트 루트)이고 `claude`는 거기서 실행된다. 대상 프로젝트의 `CLAUDE.md`가 세션의 기본 지침이 된다.
- 그래서 문서·프롬프트 속 경로는 모두 **대상 루트 기준**(`autopilot/AUTOPILOT_TODO.md`, `autopilot/progress/...`)으로 쓴다. 이 저장소 루트의 파일을 가리킬 때도 `autopilot/` 접두어를 붙인다.
- 키트는 대상 프로젝트에 **복사**해 쓴다. 중첩 저장소로 두면 대상 프로젝트의 `git add`가 `autopilot/` 안의 파일을 오류 없이 무시한다.
- `.gitignore`는 자기 폴더 기준 패턴(`/progress/` 등)이라 복사된 `autopilot/` 안에서 그대로 동작한다. 이 저장소에서는 `AUTOPILOT_TODO.md`가 템플릿으로 이미 추적되고 있어 무시되지 않는다.

### 스크립트 ↔ 세션 계약

세션과 스크립트는 파일과 exit code로만 통신한다. 한쪽을 바꾸면 다른 쪽도 맞춘다.

- **인수인계**: `autopilot/AUTOPILOT_PROGRESS.md` 한 파일(날짜별로 나누지 않는다 - 새 날짜 첫 회차가 이전 상태를 못 읽게 됨).
- **지시개선 완료 신호**: 세션이 빈 파일 `autopilot/progress/<시작 날짜>/TODO_COMPLETE`를 만들면 루프 종료. 스크립트 시작 시 삭제한다.
- **실패**: `claude` exit code ≠ 0 이면 `$RetryWaitMinutes`(5·15·30분) 간격으로 재시도하고, 그 횟수를 넘겨 연속 실패하면 중단.
- **사용량 한도**: `rate_limit_event`는 허용 상태에서도 오므로 `resetsAt`은 늘 갱신하고, `status`가 `allowed*`가 아니면 한도 도달로 본다. 한도 도달 + 회차 실패(exit ≠ 0 또는 `is_error`)일 때만 리셋 1분 뒤까지 대기하고 실패로 세지 않는다. 실제 한도 도달 시의 `status` 값(`rejected`로 추정)은 아직 실측하지 못했다.
- **시한**: 회차는 `min(남은 시간, $MaxRoundMinutes)`에 `taskkill /T /F`로 트리째 종료되고 실패로 센다. 프롬프트는 인자가 아니라 stdin으로 넘긴다(`claude.cmd` 설치본에서 cmd가 특수문자를 해석하지 않게). `WorkingDirectory`는 반드시 `$ProjectDir`로 지정한다 - `Set-Location`은 .NET 프로세스의 cwd를 바꾸지 않는다.
- **할 일 없음**: 성공 회차인데 새 commit이 없으면(진행 기록만 고친 commit 포함) idle로 센다. 연속 2회면 종료. 회차 전후 `git diff --name-only`로 판정한다.
- **출력**: `--output-format stream-json --verbose`를 한 줄씩 읽어 `Write-StreamEvent`가 요약해 콘솔과 로그에 남긴다. text 형식은 세션이 끝나야 한꺼번에 나와 진행을 볼 수 없다. `{"type":"user"`로 시작하는 줄(도구 결과)은 파싱하지 않는다(PS 5.1 `ConvertFrom-Json`은 2MB를 넘으면 실패).
- 반환값이 있는 함수 안에서는 `Write-Output` 대신 `Write-Log`/`Write-Host`를 쓴다. `Write-Output`은 반환값에 섞인다.
- 회차 프롬프트(`$prompt`, `$policyPrompt`)에 작업 범위(`$ProjectDir`)·정책·남은 시간·작업 수 상한이 주입된다. 세션은 이 값을 스스로 추측하지 않는다.

### AUTOPILOT_TODO.md 파싱 규칙

- 우선순위: 실행 인자 > TODO 섹션 > 기본값(`07:00`, `자율개선`).
- `## 실행시간`: `(오전|오후) N시 (M분)` 또는 `HH:mm`. **날짜는 의도적으로 무시**하고, 지난 시각이면 다음 날로 본다.
- `## 정책`: 첫 비어 있지 않은 줄이 정확히 `자율개선`/`지시개선`일 때만 인정. 산문을 허용하지 않는 것은 의도된 설계다(ps1 주석 참고). 실행 인자는 `auto`/`todo` 등 별칭을 받는다.

## 여러 파일에 중복된 값

다음 값은 `autopilot_loop.ps1`, `AUTOPILOT.md`, `README.md`, bat 주석에 함께 적혀 있다. 하나를 바꾸면 모두 갱신한다.

종료 시각 기본값 `07:00` · 정책 값/기본값 · 최소 남은 시간 20분 · 최대 60회차 · 회차 시한 120분 · 재시도 대기 5·15·30분 · 연속 idle 2회 · 회차당 작업 2건 · `TODO_COMPLETE` 경로 · commit 접두어 `[ap]` · 작업 브랜치 `ai/autopilot`

## 인코딩 (중요)

- **`.bat`은 ASCII만.** 시스템 ACP가 949라 CMD가 한글 바이트를 깨뜨려 명령 구분자로 해석한다. 한글이 필요한 로직은 ps1에 둔다.
- **`autopilot_loop.ps1`은 UTF-8 BOM 필수.** BOM이 없으면 Windows PowerShell 5.1이 소스를 949로 읽어 한글 리터럴이 파싱 단계에서 깨진다. 파일을 다시 쓴 뒤에는 위의 BOM 확인 명령으로 검증한다.
- 콘솔/로그 인코딩은 스크립트 상단에서 UTF-8로 고정한다. 이 블록을 제거하지 않는다.
- 줄바꿈이 파일마다 다르다: `core/*.md` · `.gitignore` · `AUTOPILOT_PROGRESS.md`는 CRLF, 나머지는 LF. 스크립트로 문자열 치환할 때 대상 파일의 줄바꿈에 맞춘다.

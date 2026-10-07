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

## 구조

실행 흐름: `start_autopilot_PERSONAL.bat` → `core/autopilot_loop.ps1` → 회차마다 `claude -p` → 세션이 `core/AUTOPILOT.md` · `core/AUTOPILOT_POLICY.md`를 읽고 작업.

- **bat**: 인자 전달만 한다(`-ConfigDir`, `-Effort`, `-EndTime`, `-Policy`). 로직을 넣지 않는다.
- **ps1**: 종료 시각·정책 결정, 회차 루프, 프롬프트 조립, 실패 카운트, 로그. 전체 종료 판정은 스크립트만 한다.
- **AUTOPILOT.md**: 세션이 따르는 작업 절차. **AUTOPILOT_POLICY.md**: 안전 정책, 모든 절차보다 우선.

### 경로 모델

- `$ProjectDir`는 `core/`의 두 단계 위(= 대상 프로젝트 루트)이고 `claude`는 거기서 실행된다. 대상 프로젝트의 `CLAUDE.md`가 세션의 기본 지침이 된다.
- 그래서 문서·프롬프트 속 경로는 모두 **대상 루트 기준**(`autopilot/AUTOPILOT_TODO.md`, `autopilot/progress/...`)으로 쓴다. 이 저장소 루트의 파일을 가리킬 때도 `autopilot/` 접두어를 붙인다.
- `.gitignore`의 `/autopilot/...` 패턴도 대상 루트 기준이라 이 저장소 안에서는 매칭되지 않는다.
- `AUTOPILOT_POLICY.md`의 `C:\LOCATION`은 설치 시 사용자가 바꾸는 placeholder다. 키트에서는 그대로 둔다.

### 스크립트 ↔ 세션 계약

세션과 스크립트는 파일과 exit code로만 통신한다. 한쪽을 바꾸면 다른 쪽도 맞춘다.

- **인수인계**: `autopilot/AUTOPILOT_PROGRESS.md` 한 파일(날짜별로 나누지 않는다 - 새 날짜 첫 회차가 이전 상태를 못 읽게 됨).
- **지시개선 완료 신호**: 세션이 빈 파일 `autopilot/progress/<시작 날짜>/TODO_COMPLETE`를 만들면 루프 종료. 스크립트 시작 시 삭제한다.
- **실패**: `claude` exit code ≠ 0 이 연속 3회면 중단.
- **할 일 없음**: 성공 회차인데 새 commit이 없으면(진행 기록만 고친 commit 포함) idle로 센다. 연속 2회면 종료. 회차 전후 `git diff --name-only`로 판정한다.
- 회차 프롬프트(`$prompt`, `$policyPrompt`)에 정책·남은 시간·작업 수 상한이 주입된다. 세션은 이 값을 스스로 추측하지 않는다.

### AUTOPILOT_TODO.md 파싱 규칙

- 우선순위: 실행 인자 > TODO 섹션 > 기본값(`07:00`, `자율개선`).
- `## 실행시간`: `(오전|오후) N시 (M분)` 또는 `HH:mm`. **날짜는 의도적으로 무시**하고, 지난 시각이면 다음 날로 본다.
- `## 정책`: 첫 비어 있지 않은 줄이 정확히 `자율개선`/`지시개선`일 때만 인정. 산문을 허용하지 않는 것은 의도된 설계다(ps1 주석 참고). 실행 인자는 `auto`/`todo` 등 별칭을 받는다.

## 여러 파일에 중복된 값

다음 값은 `autopilot_loop.ps1`, `AUTOPILOT.md`, `README.md`, bat 주석에 함께 적혀 있다. 하나를 바꾸면 모두 갱신한다.

종료 시각 기본값 `07:00` · 정책 값/기본값 · 최소 남은 시간 20분 · 최대 60회차 · 연속 실패 3회 · 연속 idle 2회 · 회차당 작업 2건 · `TODO_COMPLETE` 경로 · commit 접두어 `[ap]` · 작업 브랜치 `ai/autopilot`

## 인코딩 (중요)

- **`.bat`은 ASCII만.** 시스템 ACP가 949라 CMD가 한글 바이트를 깨뜨려 명령 구분자로 해석한다. 한글이 필요한 로직은 ps1에 둔다.
- **`autopilot_loop.ps1`은 UTF-8 BOM 필수.** BOM이 없으면 Windows PowerShell 5.1이 소스를 949로 읽어 한글 리터럴이 파싱 단계에서 깨진다. 파일을 다시 쓴 뒤에는 위의 BOM 확인 명령으로 검증한다.
- 콘솔/로그 인코딩은 스크립트 상단에서 UTF-8로 고정한다. 이 블록을 제거하지 않는다.

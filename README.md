<p align="center">
  <img src="assets/logo.png" alt="AutoPilot" width="640">
</p>

Claude Code로 프로젝트를 무인 자율 개발시키는 실행 키트입니다.
정해 둔 종료 시각까지 Claude가 스스로 개선점을 찾아 구현하고, 검증한 뒤 commit하는 과정을 반복합니다.

## 동작 방식

`autopilot_loop.ps1`이 `claude -p`를 회차마다 새로 실행합니다.

```mermaid
flowchart LR
    A([시작]) --> B{남은 시간<br/>20분 이상?}
    B -- 예 --> C[claude -p<br/>새 컨텍스트]
    C --> D[작업 최대 2건<br/>구현 · 검증 · commit]
    D --> E[(AUTOPILOT_PROGRESS.md)]
    E --> B
    B -- 아니오 --> F([종료])
    C -. 연속 3회 실패 .-> F
```

- 매 회차가 새 컨텍스트로 시작하므로 auto-compact 누적 비용이 없습니다.
- 회차 간 인수인계는 `AUTOPILOT_PROGRESS.md`가 맡습니다.
- 한 회차는 최대 2건의 작업을 처리하고 commit한 뒤 종료합니다.
- 남은 시간이 20분 미만이면 새 회차를 시작하지 않습니다. 회차는 최대 60회입니다.
- 연속 3회 실패하면 중단합니다.

## 구성

```text
<프로젝트 루트>/
└─ autopilot/                      ← 이 저장소를 이 이름의 폴더로 둔다
   ├─ start_autopilot_PERSONAL.bat   실행 진입점 (집 PC용)
   ├─ AUTOPILOT_TODO.md              소유자가 작성하는 오늘의 작업·실행시간·정책 (git 제외)
   ├─ AUTOPILOT_PROGRESS.md          세션 간 인수인계 문서 (AutoPilot이 갱신)
   ├─ progress/                      회차 로그 (git 제외)
   ├─ recycle_bin/                   삭제 대신 이동된 파일 (git 제외)
   └─ core/
      ├─ autopilot_loop.ps1          회차 루프 본체
      ├─ AUTOPILOT.md                작업 절차 지침
      └─ AUTOPILOT_POLICY.md         안전 정책 (모든 절차보다 우선)
```

루프는 `autopilot/core`의 두 단계 위를 **프로젝트 루트**로 간주하고 거기서 `claude`를 실행합니다.
대상 프로젝트의 `CLAUDE.md`가 기본 지침으로 쓰입니다.

## 사용법

1. 이 저장소를 대상 프로젝트의 `autopilot/` 폴더로 둡니다.
2. [core/AUTOPILOT_POLICY.md](core/AUTOPILOT_POLICY.md)의 작업 범위(`C:\LOCATION`)를 실제 프로젝트 경로로 바꿉니다.
3. `AUTOPILOT_TODO.md`에 작업·실행시간·정책을 적습니다.
4. 실행합니다.

```bat
start_autopilot_PERSONAL.bat              :: TODO 파일의 설정을 따른다
start_autopilot_PERSONAL.bat 07:00        :: 종료 시각 지정
start_autopilot_PERSONAL.bat 07:00 todo   :: 종료 시각 + 정책 지정
```

> **주의**: `claude`는 `--dangerously-skip-permissions`로 실행되므로 **신뢰할 수 있는 프로젝트에서만** 사용하세요.

설정 폴더는 `%USERPROFILE%\.claude`이고, 모델은 Opus(실패 시 Sonnet), effort는 `xhigh`입니다.

## AUTOPILOT_TODO.md

```markdown
## Tasks
(소유자가 예약한 작업. 작성된 순서대로 최우선 처리)

## 실행시간
오늘 오후 4시까지   (또는 16:00)

## 정책
자율개선
```

| 항목 | 우선순위 |
|---|---|
| 종료 시각 | 실행 인자 > `## 실행시간` > `07:00` |
| 개선 정책 | 실행 인자 > `## 정책` > `자율개선` |

- 종료 시각은 **시각만** 읽고 날짜는 무시합니다. 이미 지난 시각이면 다음 날로 봅니다.
- `## 정책`은 첫 유효 줄에 값만 단독으로 적어야 합니다. 설명을 섞으면 기본값으로 떨어집니다.

### 개선 정책

| 값 | 동작 |
|---|---|
| `자율개선` | Tasks를 마친 뒤에도 스스로 개선점을 찾아 종료 시각까지 계속 |
| `지시개선` | Tasks만 처리하고, 끝나면 시간이 남아도 즉시 종료 (`progress/<날짜>/TODO_COMPLETE` 생성으로 신호) |

### 작업 우선순위 (자율개선)

버그 → 안정성 → 데이터 손상 가능성 → 성능 → 기능 완성도 → 유지보수성 → UX → 코드 정리

## 안전 정책

자세한 내용은 [core/AUTOPILOT_POLICY.md](core/AUTOPILOT_POLICY.md)를 보세요.

- 모든 작업은 `ai/autopilot` 브랜치에서만 합니다. 없으면 `main`에서 분기합니다.
- 허용 범위 밖의 파일은 수정하지 않습니다.
- 파일을 삭제하지 않고 `autopilot/recycle_bin`으로 옮깁니다.
- `git reset --hard` · `git clean` · force push · history 재작성 · stash drop 금지.
- 운영 서버·DB 조작, 인증정보 변경, 새 외부 서비스·dependency 추가 금지.
- commit은 검증을 마친 작업 단위로, 메시지에 `[ap]` 접두어를 붙입니다. 예: `[ap] fix: 상태 손실 방지`

## 참고

- `.bat`은 시스템 ACP(949)에서 한글이 깨지므로 **ASCII만** 유지하고, 로직은 PowerShell에 둡니다.
- `autopilot_loop.ps1`은 **UTF-8 BOM**으로 저장해야 합니다. BOM이 없으면 Windows PowerShell 5.1이 한글 리터럴을 잘못 읽습니다.
- 로그는 `autopilot/progress/<날짜>/autopilot_<HHmmss>.log`에 쌓입니다.

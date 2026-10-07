<p align="center">
  <img src="assets/logo.png" alt="AutoPilot" width="640">
</p>

Claude Code로 프로젝트를 무인 자율 개발시키는 실행 키트입니다.
정해 둔 종료 시각까지 Claude가 스스로 개선점을 찾아 구현하고, 검증한 뒤 commit하는 과정을 반복합니다.

## 장점

- **긴 실행에도 품질이 유지됩니다.** 회차마다 새 컨텍스트로 시작하므로 밤새 돌려도 대화가 길어져 판단이 흐려지거나 compact 비용이 쌓이지 않습니다.
- **중간에 끊겨도 이어갑니다.** 작업이 끝날 때마다 `AUTOPILOT_PROGRESS.md`를 갱신하므로, 세션이 죽거나 PC가 재시작돼도 다음 회차가 그 문서만 보고 이어받습니다.
- **되돌리기 쉽습니다.** 작업은 `ai/autopilot` 브랜치에만 쌓이고, 검증을 통과한 작업 하나가 commit 하나가 됩니다. 마음에 들지 않는 변경은 commit 단위로 골라 버릴 수 있습니다.
- **삭제가 없습니다.** 지워야 할 파일도 `recycle_bin`으로 옮기기만 하므로 원래 경로 그대로 복구할 수 있습니다.
- **모델 장애에 강합니다.** Opus가 실패하면 Sonnet으로 넘어가고, 회차가 실패하면 5 · 15 · 30분 간격으로 재시도합니다. 그래도 실패하면 헛돌지 않고 멈춥니다. 사용량 한도에 걸리면 리셋 시각까지 기다렸다가 이어갑니다.
- **시간을 지킵니다.** 종료 시각은 스크립트가 판정하고, 한 작업을 안전하게 끝낼 시간(20분)이 없으면 새 작업을 시작하지 않습니다. 종료 시각이 되거나 한 회차가 2시간을 넘기면 멈춘 세션도 강제로 끝냅니다.
- **내 작업이 먼저입니다.** `AUTOPILOT_TODO.md`에 적은 작업을 순서대로 처리하고, 정책에 따라 거기서 끝내거나(`지시개선`) 남은 시간에 스스로 개선(`자율개선`)합니다.
- **확실하지 않으면 건드리지 않습니다.** 의도를 모르는 코드, 영향 범위를 모르는 변경, 테스트할 방법이 없는 변경은 건너뛰고 다른 작업을 고릅니다.
- **추가 설치가 필요 없습니다.** PowerShell 스크립트와 Markdown 지침만으로 구성되어 있어 프로젝트에 폴더 하나를 두면 끝입니다.

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
    C -. 재시도 3회 후에도 실패 .-> F
```

- 매 회차가 새 컨텍스트로 시작하므로 auto-compact 누적 비용이 없습니다.
- 회차 간 인수인계는 `AUTOPILOT_PROGRESS.md`가 맡습니다.
- 한 회차는 최대 2건의 작업을 처리하고 commit한 뒤 종료합니다.
- 남은 시간이 20분 미만이면 새 회차를 시작하지 않습니다. 회차는 최대 60회입니다.
- 한 회차는 최대 2시간이고, 종료 시각이 더 가까우면 그때까지입니다. 시한을 넘긴 회차는 하위 프로세스까지 강제 종료하고 실패로 셉니다(commit 전 변경은 working tree에 남습니다).
- 새 commit 없이 끝난 회차가 연속 2회면 남은 작업이 없는 것으로 보고 종료합니다(진행 기록만 고친 commit은 제외).
- 실패하면 5 · 15 · 30분 간격으로 재시도하고, 연속 4회 실패하면 중단합니다. 대기가 종료 시각에 걸리면 바로 끝냅니다.
- 사용량 한도로 회차가 실패하면 실패로 세지 않고 리셋 1분 뒤까지 기다립니다. 리셋이 종료 시각에 걸리면 바로 끝냅니다.

## 구성

```text
<프로젝트 루트>/
└─ autopilot/                      ← 이 저장소를 이 이름의 폴더로 복사한다
   ├─ .gitignore                     progress/ · recycle_bin/ · TODO를 git에서 제외
   ├─ start_autopilot_PERSONAL.bat   실행 진입점 (집 PC용)
   ├─ stop_autopilot.bat             현재 회차를 마치고 종료 요청
   ├─ AUTOPILOT_TODO.md              소유자가 작성하는 오늘의 작업·실행시간·정책 (git 제외)
   ├─ AUTOPILOT_PROGRESS.md          세션 간 인수인계 문서 (AutoPilot이 갱신)
   ├─ progress/                      회차 로그 · 아침 리포트 (git 제외)
   ├─ recycle_bin/                   삭제 대신 이동된 파일 (git 제외)
   └─ core/
      ├─ autopilot_loop.ps1          회차 루프 본체
      ├─ AUTOPILOT.md                작업 절차 지침
      └─ AUTOPILOT_POLICY.md         안전 정책 (모든 절차보다 우선)
```

루프는 `autopilot/core`의 두 단계 위를 **프로젝트 루트**로 간주하고 거기서 `claude`를 실행합니다.
대상 프로젝트의 `CLAUDE.md`가 기본 지침으로 쓰입니다.

## 사용법

1. 이 저장소를 대상 프로젝트 루트에 `autopilot/` 폴더로 **복사**합니다. clone했다면 `autopilot/.git`을 지웁니다.
   중첩 Git 저장소로 두면 대상 프로젝트의 `git add`가 `autopilot/` 안의 파일을 오류 없이 무시해서, `AUTOPILOT_PROGRESS.md`가 commit되지 않습니다.
   `autopilot/.gitignore`가 `progress/` · `recycle_bin/` · `AUTOPILOT_TODO.md`를 대상 프로젝트 Git에서 제외합니다.
2. `AUTOPILOT_TODO.md`에 작업·실행시간·정책을 적습니다.
3. 실행합니다. 작업 범위(프로젝트 루트)는 스크립트가 회차마다 알려주므로 따로 설정하지 않습니다.

```bat
start_autopilot_PERSONAL.bat              :: TODO 파일의 설정을 따른다
start_autopilot_PERSONAL.bat 07:00        :: 종료 시각 지정
start_autopilot_PERSONAL.bat 07:00 todo   :: 종료 시각 + 정책 지정
```

중간에 멈추려면 `stop_autopilot.bat`을 실행합니다. 진행 중인 회차를 마친 뒤 리포트를 쓰고 종료합니다.
콘솔 창을 닫으면 회차가 중간에 끊겨 commit 전 변경이 남습니다(재시도 · 한도 대기 중에는 닫아도 안전합니다).

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
- `autopilot/` 키트 자체(지침 · 정책 · 스크립트 · TODO)는 수정하지 않습니다. 진행 기록 · 로그 · `recycle_bin`만 씁니다.
- 파일을 삭제하지 않고 `autopilot/recycle_bin`으로 옮깁니다.
- `git reset --hard` · `git clean` · force push · history 재작성 · stash drop 금지.
- 운영 서버·DB 조작, 인증정보 변경, 새 외부 서비스·dependency 추가 금지.
- commit은 검증을 마친 작업 단위로, 메시지에 `[ap]` 접두어를 붙입니다. 예: `[ap] fix: 상태 손실 방지`
- 프로젝트 고유의 보호 대상 데이터나 금지 사항은 키트 정책이 아니라 대상 프로젝트의 `CLAUDE.md`에 적습니다.

## 참고

- `.bat`은 시스템 ACP(949)에서 한글이 깨지므로 **ASCII만** 유지하고, 로직은 PowerShell에 둡니다.
- `autopilot_loop.ps1`은 **UTF-8 BOM**으로 저장해야 합니다. BOM이 없으면 Windows PowerShell 5.1이 한글 리터럴을 잘못 읽습니다.
- 회차 진행(세션 ID · 사용한 도구 · 결과 요약과 비용 · stderr)이 콘솔에 실시간으로 표시되고 `autopilot/progress/<날짜>/autopilot_<HHmmss>.log`에도 쌓입니다.
- 회차의 전체 대화는 대상 프로젝트 루트에서 `claude --resume <세션 ID>`로 열어 볼 수 있습니다.
- 실행을 시작하면 `autopilot/progress/<날짜>/report_<HHmmss>.html` 리포트를 브라우저로 엽니다. 진행 중에는 현재 회차 · 남은 시간 · 최근 로그를 30초마다 갱신하고, 끝나면 회차별 결과 · 소요 시간 · 비용(API 환산) · commit과 변경 규모 · 세션 요약 · stderr, 남은 미commit 변경을 한 장에 담은 최종본이 됩니다.

<p align="center">
  <img src="docs/logo.png" alt="AutoPilot" width="640">
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
- **세 운영체제에서 동작합니다.** Node.js 공통 엔진을 Windows·macOS·Linux에서 실행합니다. 단독 실행 파일은 Node.js 설치도 필요 없습니다. Git과 Claude CLI는 별도로 설치해야 합니다.

## 동작 방식

`autopilot/core/autopilot_loop.js`는 CLI 인자를 처리하고, `autopilot/src/services/autopilotService.js`가 `claude -p`를 회차마다 새로 실행합니다.

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
- 실행 시작 시 진행 기록이 200줄을 넘으면 원본을 `progress/<시작 날짜>/AUTOPILOT_PROGRESS_<고유 ID>.md`에 보관하고, 회차가 인수인계 정보와 최근 완료 5건을 남기도록 정리합니다. 보관 실패 시 원본을 유지합니다.
- 한 회차는 최대 2건의 작업을 처리하고 commit한 뒤 종료합니다.
- 남은 시간이 20분 미만이면 새 회차를 시작하지 않습니다. 회차는 최대 60회입니다.
- 한 회차는 최대 2시간이고, 종료 시각이 더 가까우면 그때까지입니다. 시한을 넘긴 회차는 하위 프로세스까지 강제 종료하고 실패로 셉니다(commit 전 변경은 working tree에 남습니다).
- 새 commit 없이 끝난 회차가 연속 2회면 남은 작업이 없는 것으로 보고 종료합니다(진행 기록만 고친 commit은 제외).
- 실패하면 5 · 15 · 30분 간격으로 재시도하고, 연속 4회 실패하면 중단합니다. 대기가 종료 시각에 걸리면 바로 끝냅니다.
- 사용량 한도로 회차가 실패하면 실패로 세지 않고 리셋 1분 뒤까지 기다립니다. 리셋이 종료 시각에 걸리면 바로 끝냅니다.
- 같은 프로젝트에서 AutoPilot이 이미 실행 중이면 새 실행을 거부합니다. `progress/RUNNING`에 pid를 기록하고 종료할 때 지우며, 이미 종료된 프로세스의 낡은 잠금은 덮어씁니다.

## 구성

저장소에서 대상 프로젝트로 가져가는 것은 `autopilot/` 폴더 하나뿐입니다. 나머지는 개발용입니다.

```text
<저장소>/
├─ autopilot/                      ← 키트. 이 폴더를 대상 프로젝트 루트에 그대로 복사한다
│  ├─ core/autopilot_loop.js         CLI 진입점
│  ├─ src/                           실행 엔진 (services/ 회차 실행 · utils/ 기능별 라이브러리 · utils/guideText.js 작업 지침과 안전 정책 본문)
│  ├─ start_autopilot.bat            Windows 시작
│  ├─ start_autopilot.sh             macOS/Linux 시작
│  ├─ stop_autopilot.bat             Windows 중단 요청
│  ├─ stop_autopilot.sh              macOS/Linux 중단 요청
│  ├─ AUTOPILOT_TODO.md              소유자가 작성하는 오늘의 작업·실행시간·정책 (git 제외)
│  ├─ AUTOPILOT_PROGRESS.md          세션 간 인수인계 문서 (AutoPilot이 갱신)
│  ├─ progress/                      실행하면 생김: 회차 로그 · 아침 리포트 · 실행 잠금 · model/effort 변경 (git 제외)
│  ├─ recycle_bin/                   실행하면 생김: 삭제 대신 이동된 파일 (git 제외)
│  ├─ package.json                   ESM 선언. 대상 프로젝트의 module 설정과 분리한다
│  └─ .gitignore                     progress/ · recycle_bin/ · TODO를 git에서 제외
├─ desktop/                        Electron 대시보드 (autopilot 실행 파일을 시작·종료·로그 표시)
├─ tests/                          임시 프로젝트 통합 검증
├─ tools/                          단독 실행 파일 빌드 스크립트
├─ docs/                           README · 앱에서 쓰는 로고
├─ legacy/                         보관한 PowerShell 구현
├─ .github/workflows/              CI
└─ package.json · .prettierrc · .gitignore · CLAUDE.md · AGENTS.md   개발 설정
```

루프는 `autopilot/`의 상위 폴더를 **프로젝트 루트**로 간주하고 거기서 `claude`를 실행합니다.
대상 프로젝트의 `CLAUDE.md`가 기본 지침으로 쓰입니다. 이 저장소에서 `autopilot/`을 직접 실행하면 저장소 자신이 프로젝트 루트가 됩니다.

## 사용법

1. 이 저장소의 `autopilot/` 폴더를 대상 프로젝트 루트에 **복사**합니다. 저장소 전체를 복사하지 않으며 `.git`도 가져오지 않습니다.
   중첩 Git 저장소로 두면 대상 프로젝트의 `git add`가 `autopilot/` 안의 파일을 오류 없이 무시해서, `AUTOPILOT_PROGRESS.md`가 commit되지 않습니다.
   `autopilot/.gitignore`가 `progress/` · `recycle_bin/` · `AUTOPILOT_TODO.md`를 대상 프로젝트 Git에서 제외합니다.
2. `AUTOPILOT_TODO.md`에 작업·실행시간·정책을 적습니다.
3. 소스 실행에는 Node.js 22.12 이상이 필요하고, 단독 실행 파일은 Node.js가 필요 없습니다. 아래처럼 실행합니다. 작업 범위(프로젝트 루트)는 스크립트가 회차마다 알려주므로 따로 설정하지 않습니다.

```bat
start_autopilot.bat                       :: TODO 파일의 설정을 따른다
start_autopilot.bat 07:00                 :: 종료 시각 지정
start_autopilot.bat 07:00 todo            :: 종료 시각 + 정책 지정
```

macOS/Linux에서는 아래처럼 실행합니다. 실행 위치와 무관하게 키트의 상위 폴더를 프로젝트 루트로 사용합니다.

```sh
sh autopilot/start_autopilot.sh 07:00 todo
sh autopilot/stop_autopilot.sh
```

공통 명령은 `node autopilot/core/autopilot_loop.js [HH:mm] [auto|todo]`이며, 중단은 `node autopilot/core/autopilot_loop.js stop`입니다. `--no-open`은 리포트 자동 열기를 끄고, `--config-dir`, `--model`, `--effort`, `--end-time`, `--policy`도 지원합니다.

실행 중에 model·effort를 바꾸려면 `node autopilot/core/autopilot_loop.js set --model sonnet --effort low`(단독 실행 파일은 `autopilot set ...`)를 실행합니다. 진행 중인 회차는 그대로 끝나고 **다음 회차부터** 적용되며, 회차 시작 로그에 `(model sonnet, effort low)`로 남습니다. 실행 중인 AutoPilot이 없으면 실패합니다.

단독 실행 파일은 배포 폴더 전체를 프로젝트의 `autopilot/`으로 복사한 뒤 Windows에서는 `.\autopilot\autopilot.exe 07:00 todo`, macOS/Linux에서는 `./autopilot/autopilot 07:00 todo`로 실행합니다. 중단은 같은 실행 파일에 `stop`을 전달합니다. 작업 지침과 안전 정책은 코드에 포함되어 있어 별도 파일이 필요 없습니다. 수정하려면 `autopilot/src/utils/guideText.js`를 고쳐 다시 빌드합니다.

중간에 멈추려면 Windows는 `stop_autopilot.bat`, macOS/Linux는 `sh stop_autopilot.sh`을 실행합니다. 진행 중인 회차를 마친 뒤 리포트를 쓰고 종료합니다.
콘솔 창을 닫으면 회차가 중간에 끊겨 commit 전 변경이 남습니다(재시도 · 한도 대기 중에는 닫아도 안전합니다).

> **주의**: `claude`는 `--dangerously-skip-permissions`로 실행되므로 **신뢰할 수 있는 프로젝트에서만** 사용하세요.

설정 폴더는 사용자 홈의 `.claude`입니다. 모델은 기본 Opus이고 `--model`로 `fable` · `opus` · `sonnet` · `haiku`를 고를 수 있습니다. 실패 시 Sonnet으로 넘어가며, Sonnet을 직접 고르면 fallback은 쓰지 않습니다. 기본 effort는 기존 실행 배치와 동일한 `high`입니다.

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

자세한 내용은 [autopilot/src/utils/guideText.js](autopilot/src/utils/guideText.js)를 보세요.

- 모든 작업은 `ai/autopilot` 브랜치에서만 합니다. 없으면 `main`에서 분기합니다.
- 허용 범위 밖의 파일은 수정하지 않습니다.
- `autopilot/` 키트 자체(지침 · 정책 · 스크립트 · TODO)는 수정하지 않습니다. 진행 기록 · 로그 · `recycle_bin`만 씁니다.
- 파일을 삭제하지 않고 `autopilot/recycle_bin`으로 옮깁니다.
- `git reset --hard` · `git clean` · force push · history 재작성 · stash drop 금지.
- 운영 서버·DB 조작, 인증정보 변경, 새 외부 서비스·dependency 추가 금지.
- commit은 검증을 마친 작업 단위로, 메시지에 `[ap]` 접두어를 붙입니다. 예: `[ap] fix: 상태 손실 방지`
- 프로젝트 고유의 보호 대상 데이터나 금지 사항은 키트 정책이 아니라 대상 프로젝트의 `CLAUDE.md`에 적습니다.

## 참고

- `.bat`은 ASCII로 유지하고 인자만 전달합니다. JS·Markdown·로그는 UTF-8을 사용하며, 기존 BOM 문서도 읽습니다.
- 회차 진행(세션 ID · 사용한 도구 · 결과 요약과 비용 · stderr)이 콘솔에 실시간으로 표시되고 `autopilot/progress/<날짜>/autopilot_<HHmmss>_<고유 ID>.log`에도 쌓입니다.
- 회차의 전체 대화는 대상 프로젝트 루트에서 `claude --resume <세션 ID>`로 열어 볼 수 있습니다.
- 실행을 시작하면 `autopilot/progress/<날짜>/report_<HHmmss>_<고유 ID>.html` 리포트를 브라우저로 엽니다. 진행 중에는 현재 회차 · 남은 시간 · 최근 로그를 30초마다 갱신하고, 끝나면 회차별 결과 · 소요 시간 · 비용(API 환산) · commit과 변경 규모 · 세션 요약 · stderr, 남은 미commit 변경을 한 장에 담은 최종본이 됩니다.


## 개발 · 검증 · 실행 파일 빌드

실행 엔진은 Node.js 내장 모듈만 사용합니다. 패키지 설치는 개발·패키징에만 필요합니다. Electron 대시보드(`desktop/`)는 엔진을 import하지 않고 빌드한 `autopilot` 실행 파일을 자식 프로세스로 실행합니다. 사용법은 `desktop/README.md`를 참고하세요.

```sh
npm ci
npm run test:cli
npm run format:cli
npm run format:check:cli
npm run build:cli
npm run test:desktop
```

- `.prettierrc`는 `29commerce_backend`에서 복사했습니다. ESM, 4칸 들여쓰기, 큰따옴표, 세미콜론, trailing comma 없음으로 통일합니다. 변수·함수는 camelCase, 상수는 UPPER_SNAKE_CASE, 서비스·유틸 파일은 camelCaseService.js/camelCaseUtil.js를 사용합니다. 공개 서비스는 try/catch와 오류 로그를 갖추고 `{ status: STATUS_OK, data }` 또는 `{ status: STATUS_FAILED, error: { code, msg } }`를 반환합니다. 실패한 실행의 보고서 데이터는 `data`에 함께 유지합니다. 포맷터는 수정한 JS 파일만 지정합니다.
- 검증은 임시 Git 저장소와 가짜 Claude를 사용합니다. 실제 Claude 세션이나 대상 프로젝트는 실행하지 않습니다. TODO/정책 파싱, 진행 기록 보관, 정상 commit, idle, 재시도, 사용량 한도, STOP/TODO_COMPLETE, UTF-8, 프로세스 트리 종료, SIGINT·SIGHUP 처리, 동시 실행 잠금을 확인합니다. `build:cli`는 패키징한 실행 파일도 임시 프로젝트에서 직접 검증합니다.
- `build:cli`는 현재 OS·CPU의 Node.js 런타임을 SEA 실행 파일로 패키징합니다. 빌드에는 Node.js 24를 권장합니다. 결과는 `dist/cli-<OS>-<CPU>/autopilot/`과 `dist/autopilot-<OS>-<CPU>.tar.gz`에 생성됩니다. 빌드에는 `tar`도 필요합니다. 압축 파일은 실행 권한과 `.gitignore`를 보존합니다.
- `.github/workflows/cli.yml`은 Windows x64, Linux x64, macOS arm64·x64에서 검증·빌드하고 배포 폴더를 artifact로 올립니다. 다른 OS용 빌드는 해당 러너에서 수행합니다.
- macOS 결과는 ad-hoc 서명이며, Windows 결과는 게시자 서명이 없습니다. 공개 배포용 인증서 서명·공증은 별도입니다.
- 시한 초과나 SIGINT/SIGTERM/SIGHUP(터미널 닫힘)에는 Windows에서 `taskkill /T /F`, macOS/Linux에서 회차 프로세스 그룹 종료를 사용합니다. 자식이 별도 세션으로 이탈하는 실행 방식은 추적 대상이 아닙니다. GUI 없는 Linux에서는 리포트 경로만 출력합니다.
- 진행 기록만 수정한 commit은 idle이며, exit 0이어도 결과의 `is_error`가 true이면 실패로 처리합니다. 완료 마커는 성공한 지시개선 회차에서만 인정합니다.
- 기존 PowerShell 구현(`autopilot_loop.ps1`, `check_progress_archive.ps1`)은 기록 관리용으로 `legacy/autopilot_legacy_ps1_2026-10-08.zip`에 압축해 두었습니다. 새 시작 명령과 배포물은 이 파일을 사용하지 않습니다.

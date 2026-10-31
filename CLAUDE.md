# AutoPilot 개발 지침

AutoPilot 자체를 개발할 때 적용한다. 대상 프로젝트에서 AutoPilot 회차로 실행 중이라면 이 문서 대신 회차 프롬프트에 포함된 AUTOPILOT.md와 AUTOPILOT_POLICY.md(원본은 autopilot/src/utils/guideText.js)를 따른다.

- 이 문서는 공통 규칙과 엔진(autopilot/) 규칙을 담는다.
- desktop/의 파일을 읽거나 고치기 전에 [desktop/CLAUDE.md](desktop/CLAUDE.md)를 따른다(Electron 연동·화면·계정 규칙).
- 사용자 관점의 화면 동작은 [desktop/README.md](desktop/README.md), 제품 소개와 사용법은 [README.md](README.md)에 있다.

## 구조

- 배포물은 Electron 앱이다. Windows exe(포터블과 NSIS 설치형), macOS dmg·zip(x64·arm64, ad-hoc 서명), Linux AppImage·deb(x64·arm64)를 만든다. 엔진(autopilot/)은 앱에 내장되고(electron-builder extraResources로 패키지의 resources/engine/에 복사), 앱이 자기 실행 파일을 ELECTRON_RUN_AS_NODE=1로 Node처럼 실행해 엔진 스크립트를 자식 프로세스로 돌린다. 사용자는 앱 화면에서 대상 프로젝트 폴더·작업·종료 시각·정책·model·effort를 모두 정하고 시작한다.
- 저장소 루트는 개발용이고, 엔진 소스는 autopilot/ 하나다. 개발용은 desktop/(Electron UI. 화면은 React 19이고 소스는 desktop/ui/, esbuild가 desktop/bundle/로 번들한다), tests/(검증), docs/(README 스크린샷·앱 로고·아이콘), legacy/(보관), .github/, package.json, .prettierrc다.
- legacy/의 PowerShell 구현 압축본(autopilot_loop.ps1, check_progress_archive.ps1)은 새 실행 경로에서 사용하지 않으며 수정하지 않는다. 다른 레거시 소스도 legacy/에 압축해 보관한다.

## 개발 명령과 검증

```sh
npm ci
npm run test:cli              # 엔진 검증(tests/checkAutopilot.js)
npm run build:ui              # React 화면 번들(desktop/ui → desktop/bundle). npm run dev:ui는 저장할 때마다 다시 만든다
npm run test:desktop          # 데스크톱 러너·표시·계정·기록·화면 컴포넌트·스토어 검증
npm run ui:parity             # 옛 화면과 지금 화면을 같은 장면으로 비교(tests/tools/ui). --baseline <git ref> --full
npm test                      # Electron 창·preload 스모크, 앱 번들의 엔진을 ELECTRON_RUN_AS_NODE로 --help 실행
npm run format:cli            # 엔진과 엔진 검증 파일 전체 포맷
npm run format:desktop        # desktop과 데스크톱 검증 파일 전체 포맷
npm run format:check:cli
npm run format:check:desktop
npm run build                 # dist/win-unpacked/AutoPilot.exe
npm run dist                  # 포터블·설치형 exe
npm run build:mac             # macOS에서만. dist/mac-*/AutoPilot.app
npm run dist:mac              # macOS에서만. dmg·zip(x64·arm64)
npm run build:linux           # dist/linux-unpacked/autopilot
npm run dist:linux            # AppImage·deb(x64·arm64)
```

- 스모크 테스트(`npm test`, --smoke-test)는 창을 화면에 띄우지 않는다. 숨긴 창이 화면 로드·마운트·preload 다리·엔진 응답을 확인한 뒤 종료하고, 창이 보이면 실패로 처리한다(main.cjs). 개발 중 검증을 돌릴 때마다 창이 깜빡이지 않게 하는 정책이다. 화면 모양을 눈으로 확인할 때는 창을 띄우지 말고 tests/tools/ui의 offscreen 도구(runScenes)를 쓴다.
- 검증은 임시 Git 저장소와 가짜 CLI만 사용한다. 실제 Claude 세션은 실행하지 않는다. 가짜 CLI는 cwd가 임시 프로젝트인지 확인한 뒤 Git을 사용한다.
- 검증 시간 단축은 runAutopilot()의 limits 옵션으로만 한다. 사용자 CLI에 테스트 설정을 노출하지 않는다.
- 검증은 runAutopilot의 dataDir 옵션(CLI는 APPDATA 환경 변수)으로 진행 기록 위치를 격리한다.
- 엔진 검증 파일은 tests/checkAutopilot.js(진입점)와 tests/lib/(fixtures 공용 가짜 CLI·헬퍼, unitChecks 단위 검증, scenarioChecks 시나리오·CLI 진입 검증)다. 데스크톱 검증 파일은 tests/checkDesktop*.js다.
- 패키징한 앱의 엔진까지 확인하려면 npm run build 뒤 node tests/checkAutopilot.js dist/win-unpacked/AutoPilot.exe를 실행한다(번들된 resources/engine을 앱 exe로 실행해 CLI 계약을 검증한다).
- 화면 번들(desktop/bundle/)은 커밋하지 않는다(.gitignore). start·dev·test·build·dist 스크립트가 먼저 build:ui를 실행하고, ci.yml은 npm ci 뒤에 직접 실행한다(Linux 스모크와 패키징은 npm 스크립트를 거치지 않는다). 패키지에는 번들만 들어가고 desktop/ui/ 소스는 package.json의 build.files가 뺀다. 화면 번들을 고친 뒤 Electron 없이 dev:ui만 켜 두었다면 `npx electron . --dev`로 직접 실행한다.
- VS Code 등이 ELECTRON_RUN_AS_NODE=1을 설정한 셸에서는 해제하고 npm start·npm test로 electron을 실행한다(앱이 엔진을 띄울 때는 앱이 직접 지정한다).
- npm run dist는 electron-builder로 Windows x64 포터블 exe(AutoPilot-Portable-*)와 NSIS 설치 파일(AutoPilot-Setup-*)을 함께 만든다(포터블은 실행마다 임시 폴더에 풀어 느리므로 설치형을 병행한다). 앱 asar에는 desktop/과 로고만 들어가고, 엔진은 extraResources로 resources/engine/에 복사된다. 지침 본문은 엔진 소스(guideText.js)에 있으므로 별도 파일이 필요 없다.
- macOS 빌드는 서명하지 않고 ad-hoc 서명(mac.identity "-", hardenedRuntime 끔)만 한다. 인증서가 없어도 빌드되고 Apple Silicon에서 실행되며, 사용자는 처음 한 번 격리 속성을 풀어야 한다(README). 공증은 하지 않는다. Linux 실행 파일 이름은 `autopilot`(linux.executableName)이고, deb는 설치 때 chrome-sandbox에 SUID를 준다.
- .github/workflows/ci.yml은 Windows·Ubuntu·macOS에서 CLI·데스크톱 포맷 검사, test:cli, test:desktop, Electron 스모크(Linux는 xvfb-run과 --no-sandbox), 패키징(--dir)과 번들된 엔진 검사(`node tests/checkAutopilot.js <패키지 실행 파일>`)를 실행한다. macOS 번들의 엔진은 .app/Contents/Resources/engine/에 있다.
- .github/workflows/release.yml은 v* 태그를 push하면 Windows에서 검증한 뒤 세 운영체제에서 각각 배포 파일을 만들어(Windows exe 2개, macOS dmg·zip, Linux AppImage·deb) GitHub Release로 올린다. 태그는 루트 package.json의 version과 같아야 한다.

## 엔진 CLI 계약

엔진과 앱(desktop/)의 인터페이스다. 바꾸면 양쪽을 함께 고친다.

```sh
node autopilot/core/autopilot_loop.js --project <프로젝트> [--end-time HH:mm|"yyyy-MM-dd HH:mm"] [--policy auto|todo] [--tasks-file <파일>] [--model <m|모델 ID>] [--effort <e>] [--runner claude|codex] [--config-dir <d>] [--extend-on-limit] [--max-extend-minutes <N>] [--commit-prefix <접두어>] [--branch <브랜치>] [--log-retention-days <N>] [--link-project <저장소>]... [--mode maintain|build] [--gate plan,design] [--allow deps,large,external-api,send] [--design-format md|html|figma|image] [--qa-on-fail stop|retry:N] [--security-on-fail stop|retry:N] [--main plan=claude|codex,design=...,build=...,qa=...,security=...] [--brainstorm plan[:compare|:debate],design[:compare|:debate]] [--codex-model <모델>] [--codex-effort <e>] [--debate-turns <N>] [--cross-review] [--no-open]
```

- 하위 명령은 모두 --project가 필요하다.
    - stop: 중단 요청
    - set --model <m> --effort <e> [--runner claude|codex] [--codex-model <모델>|default] [--codex-effort <e>|default]: 실행 중 회차 실행 값(실행 에이전트, Claude·Codex의 model·effort) 변경. 하나 이상 필요하고, default는 Codex 설정을 따르는 빈 값이다(인자로 빈 값을 넘길 수 없어서).
    - reset-progress: 진행 기록 초기화(신규 개발의 단계 상태 PHASE.json도 지운다)
    - status: 실행 상태 확인. 한 줄 JSON `{"running":true,"pid":N,"logFile":"..."}` 또는 `{"running":false}`. 신규 개발을 한 적 있는 프로젝트는 `"phase":{"phase":"plan|design|build|qa|security|done","awaiting":null|"plan"|"design","qaRetries":N,"securityRetries":N,"proposals":null|{"phase":"plan|design","candidates":["claude","codex"],"picked":null|"claude"|"codex"},"debate":null|{"phase":"plan|design","disputes":[{"id":"d1","title":"…","claude":"…","codex":"…"}],"resolved":null|{"d1":"claude|codex"}},"receivedProposal":null|"plan"|"design"}`가 더해진다.
    - approve [--pick claude|codex] [--resolve d1=claude|codex,...]: 확인을 기다리는 신규 개발 단계를 승인한다(awaiting을 지워 다음 실행이 다음 단계부터 한다). 여러 AI가 안을 낸 단계(proposals.candidates가 둘 이상)는 --pick이 있어야 하고 고른 안을 proposals.picked에 남긴다. 협의한 단계(debate)는 --pick 대신 --resolve로 모든 쟁점을 빠짐없이 골라야 하고(쟁점이 없으면 --resolve 없이) debate.resolved에 남긴다. 실행 중이거나 기다리는 단계가 없거나, 고를 안·쟁점이 없는데 --pick·--resolve를 주거나, 둘을 함께 주면 거부한다.
- 앱은 stdout 로그를 줄 맨 앞의 형식으로 해석한다. 엔진은 로그 기록 호출 한 번을 제어 줄 한 줄로만 쓰고(헤더도 줄마다 호출), 줄바꿈 뒤의 본문(Claude 출력·stderr·오류 메시지)은 logUtil이 4칸 들여써서 제어 줄을 흉내 내지 못하게 한다.
- 앱이 해석하는 줄은 형식을 지킨다.
    - `[N회차] 시작 - 남은 시간 N분 (model X, effort Y)`: 회차 시작. Codex가 돌린 회차는 `(Codex, model X, effort Y)`이고 Codex 설정을 따른 값은 `기본값`이다(앱 파서는 빈 값으로 읽는다).
    - `[커밋] <짧은 hash> +<추가 줄> -<삭제 줄> <제목>`: 회차가 끝나면 결과 줄보다 먼저 새 commit마다 한 줄. 앱이 열린 회차에 붙인다. 줄 수는 git show --shortstat에서 읽는다(gitUtil.getLineCounts).
    - `[N회차] <결과>`: 회차 결과.
    - `[사용량 한도] 종료 시각 연장 yyyy-MM-dd HH:mm:ss (+N분)`: 앱 파서가 이 줄로 종료 예정 시각을 갱신한다.
    - `[단계] <단계 이름> 시작|완료|확인 대기|실패`, `[단계] <테스트/QA|보안검토> 실패 - 개발로 되돌림 (N/M)`: 신규 개발의 단계 전환. 단계 이름은 config.js의 PHASE_LABELS(기획·디자인·개발·테스트/QA·보안검토)다. 헤더에는 `Mode : 신규 개발 (<단계> 단계부터)` 줄이 더해진다.
    - `[브레인스토밍] <제공자> <단계> 안|검토 받는 중|받음|건너뜀: <이유>`, `[브레인스토밍] 외부 서비스로 보내기를 허용하지 않아 다른 AI의 안을 받지 않습니다.`: 여러 AI 브레인스토밍의 진행. 제공자 이름은 config.js의 PROVIDER_LABELS(Codex)다. 받는 동안에는 AUTOPILOT_DEFAULTS.providerHeartbeatMs(1분, 검증은 limits로 줄인다)마다 `[브레인스토밍] <제공자> <단계> 안|검토 진행 N분째 (최대 M분)[: <활동>]`이 한 줄 더해진다. 활동은 providerUtil.getActivity가 stderr에서 읽은 `명령 N번 실행 · <마지막으로 한 말 80자>`이고 Codex 출력이므로 표시에만 쓴다.
    - `[협의] <단계> 시작 (최대 N번)`, `[협의] Claude: <발언>`, `[협의] Codex: <발언>`, `[협의] 합의했어요`, `[협의] 쟁점 N개를 남기고 끝냈어요`, `[협의] 건너뜀: <이유>`: Claude·Codex 협의의 진행. 발언은 엔진이 한 줄로 펴서 300자(MAX_MESSAGE_LENGTH)까지 줄이지 않고 쓴 것이다(화면이 긴 말풍선을 접고 편다). 앱 파서는 이 줄을 실시간 대화로 보여 준다.
    - `성과: <무엇> <이전> → <이후>`: 시각 뒤나 4칸 들여 쓴 줄 맨 앞. 앱이 state.gains로 모은다. Claude 출력이므로 표시에만 쓰고 제어에 쓰지 않는다.
    - 도구 줄(`HH:MM:SS   > 이름 인자`): 앱이 세어 state.work(도구 호출 수, 같은 경로는 한 번만 센 Read·Edit 계열 파일 수)로 보여준다.
- 연결 저장소(--link-project, 최대 config.js의 MAX_LINKED_REPOS=2개, 작업 프로젝트와 합쳐 3개): 작업 프로젝트(--project)에 더해 함께 다루는 Git 저장소 루트다. 엔진은 각각 Git 루트·폴더 이름 중복(작업 프로젝트 포함)을 확인하고(autopilotUtil.getLinkedRepos), 세션에 `--add-dir`로 붙이며, 프롬프트(promptUtil.getLinkedReposPrompt)에 작업 범위 확장·저장소별 commit·작업 브랜치로만 push(실패해도 회차 실패로 세지 않음)·저장소별 CLAUDE.md를 직접 읽고 그 규칙·검증을 따르기(--add-dir 폴더의 CLAUDE.md는 자동 로드가 보장되지 않는다)·접점 변경은 한 세션에서 함께 고치기·삭제 파일은 작업 프로젝트의 recycle_bin/<저장소 이름>/를 적는다. 접두어·브랜치는 공통이다. HEAD 비교(idle)와 커밋 수집은 저장소마다 하고, 연결 저장소의 `[커밋]` 줄은 형식을 그대로 두고 제목 앞에 `<저장소 이름>: `을 붙인다(앱 파서 변경 없음). `.autopilot/`·진행 기록은 작업 프로젝트에만 있고, 헤더에는 `Linked : <이름> (<경로>)` 줄이 더해진다. 단일 저장소 실행의 동작은 그대로다(push 지침도 연결 저장소가 있을 때만 들어간다).
- 형식을 바꾸면 desktop/CLAUDE.md의 "엔진 연동"에 적힌 로그 해석 세 곳과 그 검증을 함께 고친다. tests/checkAutopilot.js는 모든 시나리오에서 실제 엔진 로그를 desktop의 러너 파서로 읽어 회차 결과와 비교하므로, 형식이 어긋나면 CLI 검증이 실패한다.

## 코드 스타일

- 포맷은 루트 .prettierrc(4칸 들여쓰기·큰따옴표·세미콜론·trailing comma 없음)를 따르고 구조는 기존 서비스 코드를 기준으로 한다.
- 포맷터는 수정한 JS 파일만 지정한다(`npx prettier --write <파일>`). 기존 Electron 파일은 별도 요청 없이 전체 포맷하지 않는다(format:desktop은 요청이 있을 때만 쓴다).
- 변수·함수는 camelCase, 상수는 UPPER_SNAKE_CASE, 서비스·유틸 파일은 camelCaseService.js/camelCaseUtil.js를 사용한다. 함수는 get/run/parse/write/handle/kill 등 동작이 드러나게 이름 짓고 의미 없는 축약명을 피한다.
- const 화살표 함수를 쓴다. 엔진과 tests는 ESM(import/export)이고, desktop 메인 프로세스(.cjs)는 CommonJS(require), viewFormat.js는 ES 모듈, desktop/ui/는 ESM + JSX(esbuild 번들)이므로 각 파일의 기존 방식을 따른다.
- 공개 서비스 함수는 try/catch, 오류 로그, STATUS_OK/STATUS_FAILED 반환을 갖춘다. 성공 데이터는 data, 오류는 error: { code, msg }에 담는다. CLI 오류에 HTTP 코드나 웹 서버 의존성을 추가하지 않는다.
- 서비스 함수는 준비·실행·결과 처리 단계로 나누고 재사용할 로직은 utils의 export default 라이브러리로 분리한다. 유틸 내부 예외는 서비스 경계에서 처리하며 프로세스 종료와 finally 정리를 유지한다.
- 함수 사이와 논리 블록(변수 선언군·검증·반환) 사이에는 빈 줄을 둔다. if는 한 줄이어도 중괄호를 쓰고 중첩 삼항 연산자는 쓰지 않는다. 오브젝트 필드는 key: value로 명시하고 shorthand를 쓰지 않는다.
- 주석은 복잡한 이유에만 최소한으로 한국어로 쓴다.
- JS·Markdown·로그는 UTF-8이고 기존 BOM 문서도 읽는다. 기존 dirty 작업은 보존한다.

## 엔진 규칙 (autopilot/)

아래 .autopilot/progress/ 경로는 대상 프로젝트 안의 작업 폴더다.

### 구조

- 진입점은 autopilot/core/autopilot_loop.js다. ESM이고 런타임 외부 의존성이 없으며 Electron 44에 들어 있는 Node 24에서 실행한다.
- autopilot/package.json은 엔진이 앱·대상 프로젝트의 module 설정과 무관하게 ESM으로 읽히게 하는 선언이다. 패키지의 resources/engine/에도 복사되므로 지우지 않는다.
- 실행 서비스는 autopilot/src/services/autopilotService.js다(runAutopilot, requestStop, requestRoundOptions, getRunStatus, requestProgressReset).
- 공통 로직은 autopilot/src/utils/의 라이브러리로 분리한다(settingsUtil·cliUtil·promptUtil·progressUtil·reportUtil·gitUtil·processUtil·streamUtil·dateUtil·fileUtil·logUtil·util은 이름이 역할이다). 지침·정책 본문은 guideText.js, 프로젝트·작업 폴더·진행 기록 경로와 회차 결과는 autopilotUtil, 상수는 config.js다.

### 프로젝트와 작업 폴더

- --project는 Git 저장소의 루트 폴더여야 한다(엔진이 확인).
- 프로젝트 안의 .autopilot/은 progress/(로그·리포트·실행 신호)와 recycle_bin/을 두는 작업 폴더이며 엔진이 만들고 .gitignore(*)를 써서 프로젝트 git에서 제외한다(이미 있는 .gitignore는 건드리지 않는다). 중첩 .git은 두지 않는다.
- 실행을 시작할 때 보관 기간(기본 30일, --log-retention-days N(1~3650의 정수, 앱 설정의 "보관 기간") 또는 테스트용 limits의 logRetentionDays로 조정. limits가 우선)이 지난 날짜 폴더의 autopilot_*.log·report_*.html만 지운다. 보관한 진행 기록 원본·완료 마커·날짜가 아닌 폴더는 건드리지 않고 링크는 따라가지 않으며, 실패해도 실행은 계속한다.

### 예약 작업

- 앱이 userData/tasks/<프로젝트 키>.md(settingsStore.getProjectKey)에 쓰고 --tasks-file로 넘긴다(긴 텍스트라 인자로 넘기지 않는다. 잇달아 시작한 다른 프로젝트가 엔진이 읽기 전에 덮어쓰지 않게 프로젝트마다 따로 쓰고, 같은 프로젝트는 시작 중이면 다시 시작하지 않는다). 엔진이 시작할 때 한 번 읽어 매 회차 프롬프트의 <TASKS> 블록에 넣는다.
- 지시개선은 작업이 비어 있으면 시작하지 않는다.

### 진행 기록

- 진행 기록은 프로젝트 저장소가 아니라 앱 데이터 폴더의 %APPDATA%/AutoPilot/projects/<프로젝트 폴더명>-<실제 경로 SHA-256 앞 8자>/AUTOPILOT_PROGRESS.md 하나다(autopilotUtil.getProgressFile, 정리되는 임시 폴더는 쓰지 않는다). 같은 프로젝트의 다음 실행이 이어받는다.
- 인수인계는 이 파일 하나로 유지한다. 날짜별로 나누지 않는다.
- 첫 실행이면 엔진이 PROGRESS_TEMPLATE으로 만들어 두고, 경로는 프롬프트와 로그 헤더(Progress)로 알린다.
- 세션은 이 파일을 갱신하되 commit하지 않는다.
- 줄 수는 매 회차 시작 때 확인한다(하루 동안 문서가 커지는 것을 막기 위해서다). 100줄(PROGRESS_MAX_LINES)을 초과하면 원본을 .autopilot/progress/<시작 날짜>/AUTOPILOT_PROGRESS_<고유 ID>.md에 보관하고, 보관 성공 시에만 정리를 지시한다. 정리 지시는 현재 상태·미완료·주의사항·다음 작업과 최근 완료 5건을 유지하고 전체를 60줄(PROGRESS_TARGET_LINES) 안팎으로 줄이게 한다. 상한까지 바로 다시 차서 정리가 반복되지 않도록 목표를 상한보다 낮게 둔다.
- 정리 지시가 실패한 회차는 같은 지시를 이어가고(재보관하지 않는다), 지시 후 다음 회차에도 상한을 넘으면 줄 수가 상한 이하로 내려갈 때까지 다시 지시하지 않는다.
- 작업이 모두 끝난 실행(지시개선의 TODO_COMPLETE 인정, 연속 idle 종료)은 종료할 때 진행 기록 원본을 progress/<날짜>/AUTOPILOT_PROGRESS_<고유 ID>.md에 보관하고 초기 상태(progressUtil의 PROGRESS_TEMPLATE과 보관 경로 한 줄)로 되돌린다. 진행 기록이 저장소 밖에 있어 commit 안 된 변경이 남지 않으므로 종료 때 바로 한다. 시각 도달·회차 상한·실패·중단 종료는 이어갈 내용이 있어 그대로 둔다. 이미 초기 상태(비었거나 템플릿뿐이거나 안내 한 줄만 있음)면 아무것도 하지 않는다. reset-progress 명령(앱의 진행 기록 초기화 버튼)은 같은 동작을 지금 하며 실행 중이면 거부한다.
- 어느 경우든 보관에 실패하면 원본을 유지한다.

### 세션 실행과 프롬프트

- 실제 세션은 claude -p로 실행한다. --runner codex(앱의 모델 고르기에서 Codex 모델을 고름)면 회차를 `codex exec --json --color never --dangerously-bypass-approvals-and-sandbox [-m 모델] [-c model_reasoning_effort=값] [--add-dir 연결 저장소]... -`로 돌린다(providerUtil의 getRoundArgs, Claude 회차의 --dangerously-skip-permissions와 같은 권한). 실행 에이전트와 Codex의 model·effort는 회차마다 ROUND_OPTIONS.json을 반영해 정하므로 유지 보수는 실행 중에 Claude↔Codex를 바꿀 수 있다(신규 개발의 회차를 돌리는 AI는 그 단계의 메인이다). Codex를 쓸 수 없으면(설치·로그인 안 됨, 실행당 한 번 확인) 그 회차는 Claude로 돌리고 `[설정] Codex를 쓸 수 없어 이번 회차는 Claude로 돌립니다: <이유>`를 남긴다. 헤더에는 `Runner : Codex` 줄이 더해진다.
- Codex 회차의 JSONL(streamUtil.handleCodexEvent)은 Claude 세션과 같은 로그 형식으로 바꾼다. agent_message는 시각 뒤 본문, command_execution은 셸 감싸기를 걷은 `  > Bash <명령>`, file_change는 `  > Write|Edit|Delete <경로>`, thread.started는 `[세션] <id> (codex resume ...)`, turn.completed는 `[결과] 완료 · 입력 N · 출력 N 토큰`이다. turn.failed만 회차 실패로 세고(error 이벤트는 `[오류]` 줄만 남긴다), 실패 문구가 사용량 한도면 `[사용량 한도] Codex <문구>`를 남긴다. Codex는 리셋 시각을 주지 않아 한도는 대기하지 않고 실패 재시도로 처리한다. CLAUDE.md는 Codex 세션에 자동으로 로드되지 않으므로 Codex 회차 프롬프트의 첫 줄이 직접 읽게 한다.
- 선택 옵션(config.js의 OPTIONAL_CLAUDE_FLAGS: --effort·--fallback-model·--autocompact)은 실행을 시작할 때 `claude --help`에 있는지 확인해(processUtil.getUnsupportedFlags) 없으면 빼고 `[설정]` 줄로 알린다. 오래된 Claude Code가 모르는 옵션을 받으면 CLI가 시작하자마자 실패해 모든 회차가 실패한다. 도움말을 읽지 못하면 아무것도 빼지 않고, 사용자 지정 명령(검증용 command·commandArgs)은 확인하지 않는다. 옵션을 더하면 이 목록에도 넣는다.
- 프롬프트는 UTF-8 stdin으로 전달한다. shell에는 사용자 프롬프트를 삽입하지 않는다. Windows .cmd 래퍼 실행 인자도 검증한다.
- 세션은 대상 프로젝트의 CLAUDE.md를 기본 지침으로 사용한다. 프롬프트에 프로젝트 루트·예약 작업·진행 기록 경로·정책·남은 시간·작업 수 상한을 명시한다.
- AUTOPILOT.md·AUTOPILOT_POLICY.md 본문은 autopilot/src/utils/guideText.js에 문자열로 두고(커밋 접두어와 작업 브랜치를 받는 getAutopilotGuide·getAutopilotPolicy) 회차마다 프롬프트 끝에 넣는다. 별도 md 파일은 두지 않는다.
- guideText.js의 `진행 문장` 절은 세션이 작업 중 메시지를 1인칭 해요체로 짧게 쓰고, 검증으로 확인한 수치 변화가 있으면 `성과:` 한 줄을 남기게 한다.
- Claude 세션과 그 하위 프로세스에 ELECTRON_RUN_AS_NODE를 넘기지 않는다(autopilotUtil.getRunEnv가 지운다). 넘기면 대상 프로젝트의 electron 실행이 깨진다.
- stream-json을 줄 단위로 처리한다. stderr는 별도로 읽으며, CLI가 종료되면 손자 프로세스의 상속 파이프 EOF를 기다리지 않는다.

### 실행 신호 파일

모두 .autopilot/progress/ 안에 둔다.

- STOP: 시작 시 지우고, 있으면 현재 회차 후 종료한다. 대기 중에도 감지한다.
- TODO_COMPLETE: 실제 경로는 progress/<실행 시작 날짜>/TODO_COMPLETE다. 시작 시 이전 마커를 지우고, 성공한 지시개선 회차 뒤에만 완료 신호로 인정한다.
- ROUND_OPTIONS.json: set이 RUNNING 잠금의 pid가 살아 있을 때만 model·effort·runner·codexModel·codexEffort를 병합해 기록하고(임시 파일 교체), 매 회차 시작 때 읽어 실행 인자보다 우선 적용한다. 시작 시 이전 파일을 지운다. 허용 값은 config.js의 MODEL_CHOICES(별칭, 최신 버전)·MODEL_ID_PATTERN(특정 버전의 모델 ID, 예: claude-opus-4-8)·EFFORT_LEVELS·RUNNERS·CODEX_MODEL_PATTERN·CODEX_EFFORT_LEVELS(Codex 값은 빈 값도 받는다)이고 깨진 파일·허용되지 않은 값은 무시한다. Codex의 model·effort는 Codex 회차와 브레인스토밍 · 검토 · 협의 호출 모두에 다음 호출부터 반영된다.
- RUNNING: 첫 줄에 실행 중인 pid, 둘째 줄에 실행 파일 이름, 셋째 줄에 이번 실행의 로그 파일(로그 위치가 정해진 직후 임시 파일 교체로 덧붙인다)을 적어 같은 프로젝트의 동시 실행을 막고 앱이 연결할 수 있게 한다. status는 이 잠금을 아래 판정으로 해석한 결과다.
    - 잠금을 얻기 전에는 STOP·완료 신호 같은 실행 상태를 건드리지 않고, 잠금은 종료 때 지운다.
    - 기록된 pid가 살아 있지 않거나(강제 종료로 잠금이 남은 경우), 살아 있어도 실행 파일 이름이 다르면(다른 프로그램이 pid를 재사용) 낡은 잠금으로 보고 덮어쓴다.
    - 이름은 Windows tasklist, 그 외 ps로 조회한다. 조회에 실패하거나 이름이 없는 이전 형식이면 같은 프로세스로 보고 거부한다(두 엔진이 동시에 도는 쪽이 더 위험하므로).

### 작업 모드(신규 개발)

- --mode는 maintain(기본, 지금까지의 회차 실행)과 build(신규 개발)다. --gate·--allow·--design-format·--qa-on-fail·--security-on-fail은 build에서만 받는다(cliUtil.parseModeOptions). build는 개선 정책 대신 단계 프롬프트를 쓰고, TODO_COMPLETE를 보지 않는다.
- build의 프롬프트: 회차 프롬프트에 지금 단계(promptUtil.getPhasePrompt)와 `<PHASE>` 블록(getPhaseBlock)이 들어간다. `<PHASE>`는 단계마다 같은 틀(단계 · 관점 · 읽을 것 · 산출물(고정 목차) · 회차당 작업 · 완료 기준 · 하지 않을 것 · 완료 신호)이고 내용은 getPhaseBrief가 단계별로 정한다(기획은 brief.md를 먼저 읽고 plan.md 10절, 디자인은 공통 규칙부터 정하고 한 회차에 모든 화면을 목표로, 개발 첫 회차는 뼈대와 대상 저장소 CLAUDE.md·README, 보안검토는 점검 목록과 security.md 심각도 표, 개발로 되돌린 뒤 다시 하는 테스트/QA·보안검토는 qa.md·security.md의 앞선 실패 항목부터). 유지 보수용 `작업은 최대 N건` 줄은 build에서 빠진다. AUTOPILOT.md는 getAutopilotGuide(prefix, mode)이고 build는 유지 보수 지침에서 개선 정책·사용자 지정 작업·작업 탐색과 선택·궁극적 목표 절과 첫머리, 작업 시작 4단계만 신규 개발용으로 바꾼다(guideText의 BUILD_SECTIONS, 나머지 절은 글자 그대로). 유지 보수 지침 본문은 바뀌지 않는다(tests/lib/unitChecks.js가 확인).
- 단계는 BUILD_PHASES(plan·design·build·qa·security)이고 상태는 진행 기록 옆 PHASE.json(phaseUtil, 임시 파일 교체로 기록, 깨졌으면 기획부터)이다. 단계 산출물(docs/autopilot/plan.md·design*·qa.md·security.md)은 대상 저장소에 commit되므로 idle 규칙을 그대로 쓰고, 단계가 바뀌면 idle 수를 0으로 돌린다.
- 세션은 단계를 마치면 progress/<실행 시작 날짜>/PHASE_DONE을 만들고 첫 줄에 pass(테스트/QA는 실패가 남으면, 보안검토는 고치지 못한 심각·높음이 남으면 fail)를 쓴다. 엔진은 성공한 회차 뒤에만 읽고(중단 요청과 같은 회차여도 단계는 넘긴다) phaseUtil.getPhaseTransition으로 다음 상태를 정한다. --gate에 든 단계(plan·design)를 마치면 awaiting을 남기고 `<단계> 확인 대기`로 끝낸다(밤새 기다리지 않는다). approve가 awaiting을 지우면 다음 실행이 다음 단계부터, 승인 없이 시작하면 그 단계를 다시 하며 작업 칸 내용을 수정 요청으로 넣는다. 테스트/QA·보안검토가 fail이면 각각 --qa-on-fail·--security-on-fail(stop 또는 retry:1~5, 기본 retry:3)의 횟수까지 개발로 되돌리고(횟수는 PHASE.json의 qaRetries·securityRetries로 따로 센다. securityRetries가 없는 옛 파일은 0으로 읽는다), 넘으면 `<단계> 실패`로 끝낸다(종료 코드 0). 모든 단계를 마치면 `신규 개발: 모든 단계 완료`(작업 완료로 보아 진행 기록 초기화)이고 phase가 done이라 다시 build로 시작하면 거부한다.
- 기획 단계는 만들 것(작업)이 있어야 시작한다. --allow(deps·large·external-api·send)는 정책 끝에 `신규 개발에서 이번 실행에 허용한 것` 절로 덧붙고(guideText.getAutopilotPolicy의 allow), send가 없으면 외부 도구(Codex·MCP 등)로 보내기를 금지한다. 비밀값·운영 환경·Git 보호·파일 삭제 정책은 풀리지 않는다. 유지 보수 실행의 정책 본문은 바뀌지 않는다.
- --design-format(md·html·figma·image, 기본 html)이 figma·image인데 send를 허용하지 않았으면 html로 만들고 `[설정]` 줄로 알린다. image는 `codex exec`로 만들고 실패하면 그 이미지만 건너뛴다.

- 단계별 메인(하이브리드): 신규 개발은 단계마다 그 단계의 회차를 돌리는 메인 AI를 `--main plan=codex,design=claude,…`(단계는 BUILD_PHASES, 값은 AI_PROVIDERS)로 정한다. --main에 없는 단계는 --runner(기본 claude)가 메인이고(phaseUtil.getPhaseMains) 유지 보수에는 쓰지 않는다(앱은 다섯 단계를 모두 채워 넘긴다). 메인은 단계를 시작할 때 정하고(resolvePhaseAgents) 회차 실행기·프롬프트·로그(`[N회차] 시작 … (Codex, …)`)가 그 AI를 따르며, 메인이 Codex인데 쓸 수 없으면 `[설정] Codex를 쓸 수 없어 <단계> 단계는 Claude가 메인으로 진행합니다: <이유>`를 남기고 그 단계는 Claude가 메인이고 보조 없이 진행한다. 신규 개발의 회차는 ROUND_OPTIONS의 runner를 보지 않는다(model·effort는 그대로 반영). 헤더에는 메인에 Codex가 있으면 `Main : 기획 Codex, 디자인 Claude, …` 줄이 더해진다.
- 여러 AI 브레인스토밍: --brainstorm(plan·design)에 든 단계는 메인과 함께 그 단계의 보조(메인의 반대쪽 AI, phaseUtil.getPhaseAgents)도 따로 안을 낸다(--brainstorm-with는 없어졌다). 보조가 Codex이면 프로젝트 내용을 외부로 보내므로 --allow에 send가 있을 때만 쓰고(없으면 그 단계는 메인만으로 진행하고 `[브레인스토밍]` 줄로 알린다), 보조가 Claude(메인이 Codex)이면 내용이 이미 Codex에 가므로 send와 상관없다. Claude 보조는 `claude -p --output-format json`에 읽기 도구만(`--tools=Read,Glob,Grep`, providerUtil.askClaude의 tools) 주고 사용자 설정·MCP 없이 부른다. providerUtil이 제공자(지금 Codex: `codex login status`로 확인, `codex exec -s read-only --color never -`에 프롬프트를 stdin으로 넣고 최종 답변을 stdout으로 받는다. 경로 인자가 없어 CMD 래퍼에서도 통과한다)를 부르고, 시한은 min(전체 종료 시각, 지금 + min(회차 시한, PROVIDER_TIMEOUT_MINUTES))이며 중단 요청·SIGINT면 프로세스 트리를 끝낸다. 없거나 로그인이 안 됐거나 실패하면 `건너뜀` 줄을 남기고 메인 안으로 진행한다(회차 실패로 세지 않는다).
    - 단계 시작(그 단계의 첫 회차 전, 돌려보낸 단계는 다시)에 엔진이 같은 단계의 틀로 만든 프롬프트(promptUtil.getProposalPrompt, 파일 대신 최종 답변으로 출력. 정책 문서를 받지 않으므로 기획 안과 기획 협의의 첫 발언(getDebateOpeningPrompt)·기획 교차검토(getReviewPrompt)에는 --allow의 deps·large·external-api 허용 여부를 직접 적는다. 셋 다 새 세션이라 <TASKS>도 함께 넣는다)로 안을 받아 대상 저장소의 docs/autopilot/proposals/<단계>-<제공자>.md(디자인을 HTML로 받으면 .html)에 쓴다. 안을 받으면 PHASE.json의 receivedProposal에 그 단계를 남기고, 이어서 하는 단계(receivedProposal이 지금 단계)만 이미 있는 파일을 그대로 쓴다. 돌려보낸 단계와 진행 기록을 초기화한 뒤의 새 개발은 저장소에 남은 앞선 안을 쓰지 않고 다시 받는다. 메인의 회차 프롬프트에는 그 단계가 끝날 때까지 proposals/를 열지 말고 독립적으로 쓰라는 지시와, 받은 안을 고치지 말고 commit하라는 지시(--cross-review면 그 안을 읽고 proposals/<단계>-review-<메인>.md에 검토를 쓰라는 지시)가 들어간다.
    - 안을 받은 단계를 마치면 --gate와 상관없이 proposals {phase, candidates: [메인, 보조], picked: null}(메인이 맨 앞)을 남기고 `<단계> 확인 대기`로 끝낸다. --cross-review면 그 전에 보조가 메인의 산출물을 검토해 proposals/<단계>-review-<보조>.md에 쓴다(엔진이 쓴 이 파일과 안 파일은 다음 실행이 commit한다). approve --pick으로 고르면 다음 실행의 첫 회차 프롬프트 맨 앞에 확정 지시(promptUtil.getAdoptionPrompt: 보조 안이면 메인(proposals.candidates[0])의 안을 proposals/<단계>-<메인>.*로 옮기고 그 안을 plan.md 또는 design.md·design/index.html로 확정, 메인 안이면 남은 파일만 commit)가 들어가고, 그 회차가 성공하면 proposals를 지운다. 승인 없이 다시 시작하면 proposals를 지우고 그 단계와 다른 AI의 안을 다시 한다. 기획안을 다른 AI 것으로 골랐거나 기획 협의의 쟁점을 골랐으면 확정 전이라도 디자인 안을 받는 프롬프트가 고른 안·입장을 따르게 한다.
    - 단계마다 방식을 고른다. --brainstorm의 단계 뒤에 :compare(기본, 나란히 비교)나 :debate(협의)를 붙이고, 협의 단계는 options.debate에 담긴다. --cross-review는 나란히 비교하는 단계가 있을 때만 받는다(협의는 이미 서로 검토한다).
    - Codex의 model·effort: --codex-model(Codex가 쓰는 이름, config.js의 CODEX_MODEL_PATTERN)과 --codex-effort(CODEX_EFFORT_LEVELS)는 --brainstorm이나 --runner codex·--main에 Codex가 있을 때만 받고(그 밖에는 거부), 없으면 인자를 넘기지 않아 Codex 설정(~/.codex/config.toml)을 따른다. providerUtil의 getSettingArgs가 `-m <모델>`과 `-c model_reasoning_effort=<값>`으로 바꿔 안 · 검토 · 협의 발언(exec와 resume 모두)의 호출마다 붙이고(getProviderCheck가 호출마다 지금 값으로 만들어 ready.settingArgs에 둔다), 하나라도 있으면 헤더에 `Codex : model X, effort Y` 줄이 더해진다. 실행 중 set으로 바꾸면 다음 호출부터 쓴다. 협의의 Claude 발언은 회차 세션과 같은 model·effort(실행 중 set 반영)를 쓴다.
    - 협의(debateUtil, 엔진의 runDebate): 안을 받는 것까지는 나란히 비교와 같다. 메인이 그 단계의 PHASE_DONE을 남기면 엔진이 회차 밖에서 협의를 돌린다. 한 번은 메인이 말하고 보조가 답하는 것이고(어느 쪽이 Claude·Codex든 같다) 최대 횟수는 --debate-turns(1~DEBATE_TURNS_LIMIT=20의 정수, 기본 DEBATE_DEFAULT_TURNS=8, 협의하는 단계가 있을 때만 받고 runState.debateTurns로 로그 · 프롬프트에 쓴다)이며, 연달아 둘 다 합의(반대도 `improve`로 남긴 더 개선할 점도 없음)하면 그 번이 끝나지 않았어도 일찍 끝낸다(보조가 받아들인 것을 메인이 확인하면 보조의 다음 답을 기다리지 않는다). 개선할 점이 남은 동안은 상한까지 이어가고 상한에 닿으면 남은 반대는 쟁점으로 넘어간다. Claude 발언은 도구 · 사용자 설정 · MCP 없는 `claude -p --output-format json`이고 첫 답의 session_id로 `--resume`해 같은 대화를 잇는다(첫 발언에는 두 안을 본문으로 넣는다). Codex 발언은 첫 번이 `codex exec -s read-only`, 그다음은 stderr 머리말의 `session id`로 `codex exec resume <id> -c sandbox_mode=read-only -`이며(resume은 -s를 받지 않는다), 세션 아이디를 못 찾으면 지금까지 주고받은 말을 다시 보낸다. 답의 형식(message·agree·disagree[{point, reason}]·improve·changes·consensus)은 --json-schema·--output-schema 대신 프롬프트로 정하고 debateUtil.parseTurn이 둘레의 글을 걷어 JSON 하나를 읽어 길이를 묶는다(스키마 인자는 CMD 래퍼 인자 검사를 통과하지 못한다). 반대나 더 개선할 점이 남은 합의는 합의로 보지 않는다. 발언마다 시한은 min(전체 종료 시각, 지금 + DEBATE_TURN_MINUTES)이고 중단 요청이면 끝낸다. 어느 쪽이든 답을 못 받으면 `[협의] 건너뜀` 줄을 남기고 나란히 비교(후보 둘, --pick)로 넘어간다. 다만 중단 요청(STOP·SIGINT)으로 끊겼거나 협의 전에 이미 중단 요청이 있으면 나란히 비교로 넘기지 않고 중단으로 끝내며, 다음 실행이 그 단계와 협의를 다시 한다. 협의 호출은 회차 · idle로 세지 않는다.
    - 협의를 마치면 엔진이 협의 기록을 proposals/<단계>-debate.md에 쓰고 PHASE_DONE을 지운 뒤 다음 회차를 정리 회차로 돌린다(promptUtil.getDebateSynthesisPrompt: 합의를 반영해 산출물을 합의안으로 고치고, 못 맞춘 쟁점만 proposals/<단계>-disputes.json([{title, claude, codex}])에 쓰고, 합의안 · 협의 기록 · 쟁점 · Codex 안을 commit한 뒤 PHASE_DONE). 엔진은 쟁점 파일을 debateUtil.parseDisputes로 걸러 d1, d2…를 붙여 PHASE.json의 debate {phase, disputes, resolved: null}로 옮기고 `[협의] 합의했어요` 또는 `[협의] 쟁점 N개를 남기고 끝냈어요`를 남긴 뒤 --gate와 상관없이 `<단계> 확인 대기`로 끝낸다. approve --resolve 뒤 다음 실행의 첫 회차 프롬프트 맨 앞에 쟁점마다 고른 입장을 합의안에 확정하라는 지시(`<접두어> <단계>: 쟁점 확정`, 쟁점이 없었으면 `합의안 확정`)가 들어가고 그 회차가 성공하면 debate를 지운다. 정리 회차 전에 실행이 끝나면 다음 실행이 그 단계와 협의를 다시 한다. 승인 없이 다시 시작하면 debate도 지우고 다시 한다.

### 회차 처리

- 실패: exit code가 0이 아니거나 result.is_error가 true이면 실패다. 5·15·30분 후 재시도하고 연속 4회 실패 시 exit 1로 중단한다.
- 사용량 한도: rate_limit_event의 allowed* 상태는 정상이다. 한도 도달과 회차 실패가 함께 있고 미래 resetsAt이 있을 때만 실패로 세지 않고 리셋 1분 뒤까지 대기한다. 대기 후 작업 시간이 부족하면 종료한다.
- --extend-on-limit(앱 설정의 "사용량 한도")이면 대기하기 전에 대기 시간(초 단위 올림)만큼 종료 시각을 늦추고 `[사용량 한도] 종료 시각 연장` 줄을 남긴다. 이때는 대기 전 남은 시간이 최소 남은 시간 이상이면 계속한다. --max-extend-minutes N(1~10080의 정수, 앱 설정의 "연장 상한")이 있으면 한 실행에서 늘리는 총량이 N분으로 묶인다. 남은 상한보다 더 필요하면 남은 만큼만 늘리고(`[사용량 한도] 종료 시각 연장` 줄은 그대로) `[사용량 한도] 연장 상한 N분에 도달해 종료 시각을 더 늘리지 않습니다` 줄을 남기며, 상한 때문에 시간이 모자라 끝나면 종료 이유는 `사용량 한도 연장 상한 도달`이다. 이 줄은 앱 파서의 `까지 대기` 형식과 겹치지 않게 쓴다.
- 시한: 회차 시한은 min(전체 종료 시각, 회차 시작 + 120분)이다. 출력이 계속 와도 시한을 적용한다. 프로세스 종료는 Windows가 taskkill /T /F, macOS/Linux가 별도 프로세스 그룹 종료다. 독립 세션으로 이탈한 프로세스까지 추적하지 않는다.
- idle: 정상 회차의 전후로 HEAD의 파일 내용이 바뀌지 않았으면(새 commit이 없음) idle이다. 진행 기록은 저장소 밖이라 따로 제외하지 않는다. 연속 2회면 종료한다.
- 리포트: HTML 리포트는 실행 중 30초마다, 대기 진입과 종료 때 갱신한다. 실행 중에는 git status를 호출하지 않는다. 모든 외부 문자열을 HTML escape한다.

### 설정과 기본값

- 우선순위는 실행 인자 > 기본값이다(model·effort·runner·Codex의 model·effort는 실행 중 set > 실행 인자 > 기본값). runner 기본값은 claude(DEFAULT_RUNNER)이고 앱은 기본값이면 --runner를 생략한다.
- 기본값과 상한(종료 시각·정책·model·effort·최소 남은 시간·회차 수·회차 시한·재시도·idle·회차당 작업 수·진행 기록 줄 수·보관 기간)은 autopilot/src/utils/config.js가 원본이다. 값을 바꾸면 README·지침·검증을 함께 맞춘다.
- model은 별칭 또는 모델 ID를 그대로 --model에 넘긴다. fallback은 sonnet 별칭이며 같은 모델이면 생략한다. commit 접두어(기본 [ap], --commit-prefix)와 작업 브랜치(기본 ai/autopilot, --branch)는 실행 인자로 바꾸며 지침과 정책에 끼워 넣는다(엔진이 브랜치를 직접 다루지는 않고 세션이 지침대로 전환·생성한다). 접두어는 앞뒤 공백·백틱·제어 문자가 없고 `--`로 시작하지 않는 1~20자, 브랜치는 영문·숫자·._-와 /로 된 100자 이하 이름(`..`·`.lock`·끝 점 금지)이고, AI가 기본 브랜치에 직접 커밋하지 않도록 main·master·HEAD는 쓸 수 없다. 검증의 원본은 util.js(isValidCommitPrefix·isValidWorkBranch)이고 앱의 desktop/engineArgs.cjs가 같은 규칙을 갖는다(tests/checkDesktopRunner.js가 대조). 값이 있어도 기본값과 같으면 앱은 인자를 생략한다.
- 종료 시각은 HH:mm 또는 "yyyy-MM-dd HH:mm"이다. HH:mm만 주면 다음에 오는 그 시각(이미 지났으면 다음 날)이고, 날짜를 붙이면 그 날짜의 시각이다. 날짜를 붙인 값은 이미 지났거나 없는 날짜이거나 MAX_RUN_DAYS(7일)보다 뒤면 거부한다. 회차 상한(maxRounds)은 하루 몫이라 실행 기간의 일수(올림)만큼 곱한다(검증의 limits가 정하면 그 값 그대로). 앱은 종료 시각을 비우면 인자를 생략해 기본값을 쓴다.
- 정책 인자는 auto/self/todo/directed 별칭도 지원한다.

# AutoPilot 개발 지침

AutoPilot 자체를 개발할 때 적용한다. 대상 프로젝트에서 AutoPilot 회차로 실행 중이라면 이 문서 대신 회차 프롬프트에 포함된 AUTOPILOT.md와 AUTOPILOT_POLICY.md(원본은 autopilot/src/utils/guideText.js)를 따른다.

- 이 문서는 공통 규칙과 엔진(autopilot/) 규칙을 담는다.
- desktop/의 파일을 읽거나 고치기 전에 [desktop/CLAUDE.md](desktop/CLAUDE.md)를 따른다(Electron 연동·화면·계정 규칙).
- 사용자 관점의 화면 동작은 [desktop/README.md](desktop/README.md), 제품 소개와 사용법은 [README.md](README.md)에 있다.

## 구조

- 배포물은 Electron 앱의 Windows exe(포터블과 NSIS 설치형)다. 엔진(autopilot/)은 앱에 내장되고(electron-builder extraResources로 패키지의 resources/engine/에 복사), 앱이 자기 실행 파일을 ELECTRON_RUN_AS_NODE=1로 Node처럼 실행해 엔진 스크립트를 자식 프로세스로 돌린다. 사용자는 앱 화면에서 대상 프로젝트 폴더·작업·종료 시각·정책·model·effort를 모두 정하고 시작한다.
- 저장소 루트는 개발용이고, 엔진 소스는 autopilot/ 하나다. 개발용은 desktop/(Electron UI), tests/(검증), docs/(README 스크린샷·앱 로고·아이콘), legacy/(보관), .github/, package.json, .prettierrc다.
- legacy/의 PowerShell 구현 압축본(autopilot_loop.ps1, check_progress_archive.ps1)은 새 실행 경로에서 사용하지 않으며 수정하지 않는다. 다른 레거시 소스도 legacy/에 압축해 보관한다.

## 개발 명령과 검증

```sh
npm ci
npm run test:cli              # 엔진 검증(tests/checkAutopilot.js)
npm run test:desktop          # 데스크톱 러너·표시·계정·기록 검증
npm test                      # Electron 창·preload 스모크, 앱 번들의 엔진을 ELECTRON_RUN_AS_NODE로 --help 실행
npm run format:cli            # 엔진과 엔진 검증 파일 전체 포맷
npm run format:desktop        # desktop과 데스크톱 검증 파일 전체 포맷
npm run format:check:cli
npm run format:check:desktop
npm run build                 # dist/win-unpacked/AutoPilot.exe
npm run dist                  # 포터블·설치형 exe
```

- 검증은 임시 Git 저장소와 가짜 CLI만 사용한다. 실제 Claude 세션은 실행하지 않는다. 가짜 CLI는 cwd가 임시 프로젝트인지 확인한 뒤 Git을 사용한다.
- 검증 시간 단축은 runAutopilot()의 limits 옵션으로만 한다. 사용자 CLI에 테스트 설정을 노출하지 않는다.
- 검증은 runAutopilot의 dataDir 옵션(CLI는 APPDATA 환경 변수)으로 진행 기록 위치를 격리한다.
- 엔진 검증 파일은 tests/checkAutopilot.js(진입점)와 tests/lib/(fixtures 공용 가짜 CLI·헬퍼, unitChecks 단위 검증, scenarioChecks 시나리오·CLI 진입 검증)다. 데스크톱 검증 파일은 tests/checkDesktop*.js다.
- 패키징한 앱의 엔진까지 확인하려면 npm run build 뒤 node tests/checkAutopilot.js dist/win-unpacked/AutoPilot.exe를 실행한다(번들된 resources/engine을 앱 exe로 실행해 CLI 계약을 검증한다).
- VS Code 등이 ELECTRON_RUN_AS_NODE=1을 설정한 셸에서는 해제하고 npm start·npm test로 electron을 실행한다(앱이 엔진을 띄울 때는 앱이 직접 지정한다).
- npm run dist는 electron-builder로 Windows x64 포터블 exe(AutoPilot-Portable-*)와 NSIS 설치 파일(AutoPilot-Setup-*)을 함께 만든다(포터블은 실행마다 임시 폴더에 풀어 느리므로 설치형을 병행한다). 앱 asar에는 desktop/과 로고만 들어가고, 엔진은 extraResources로 resources/engine/에 복사된다. 지침 본문은 엔진 소스(guideText.js)에 있으므로 별도 파일이 필요 없다.
- .github/workflows/ci.yml은 Windows에서 CLI·데스크톱 포맷 검사, test:cli, test:desktop, Electron 스모크(npm test)를 실행한다.
- .github/workflows/release.yml은 v* 태그를 push하면 같은 검증 뒤 포터블 exe와 설치 파일을 GitHub Release로 올린다. 태그는 루트 package.json의 version과 같아야 한다.

## 엔진 CLI 계약

엔진과 앱(desktop/)의 인터페이스다. 바꾸면 양쪽을 함께 고친다.

```sh
node autopilot/core/autopilot_loop.js --project <프로젝트> [--end-time HH:mm] [--policy auto|todo] [--tasks-file <파일>] [--model <m>] [--effort <e>] [--config-dir <d>] [--extend-on-limit] [--no-open]
```

- 하위 명령은 모두 --project가 필요하다.
    - stop: 중단 요청
    - set --model <m> --effort <e>: 실행 중 model·effort 변경
    - reset-progress: 진행 기록 초기화
    - status: 실행 상태 확인. 한 줄 JSON `{"running":true,"pid":N,"logFile":"..."}` 또는 `{"running":false}`
- 앱은 stdout 로그를 줄 맨 앞의 형식으로 해석한다. 엔진은 로그 기록 호출 한 번을 제어 줄 한 줄로만 쓰고(헤더도 줄마다 호출), 줄바꿈 뒤의 본문(Claude 출력·stderr·오류 메시지)은 logUtil이 4칸 들여써서 제어 줄을 흉내 내지 못하게 한다.
- 앱이 해석하는 줄은 형식을 지킨다.
    - `[N회차] 시작 - 남은 시간 N분 (model X, effort Y)`: 회차 시작.
    - `[커밋] <짧은 hash> +<추가 줄> -<삭제 줄> <제목>`: 회차가 끝나면 결과 줄보다 먼저 새 commit마다 한 줄. 앱이 열린 회차에 붙인다. 줄 수는 git show --shortstat에서 읽는다(gitUtil.getLineCounts).
    - `[N회차] <결과>`: 회차 결과.
    - `[사용량 한도] 종료 시각 연장 yyyy-MM-dd HH:mm:ss (+N분)`: 앱 파서가 이 줄로 종료 예정 시각을 갱신한다.
    - `성과: <무엇> <이전> → <이후>`: 시각 뒤나 4칸 들여 쓴 줄 맨 앞. 앱이 state.gains로 모은다. Claude 출력이므로 표시에만 쓰고 제어에 쓰지 않는다.
    - 도구 줄(`HH:MM:SS   > 이름 인자`): 앱이 세어 state.work(도구 호출 수, 같은 경로는 한 번만 센 Read·Edit 계열 파일 수)로 보여준다.
- 형식을 바꾸면 desktop/CLAUDE.md의 "엔진 연동"에 적힌 로그 해석 세 곳과 그 검증을 함께 고친다. tests/checkAutopilot.js는 모든 시나리오에서 실제 엔진 로그를 desktop의 러너 파서로 읽어 회차 결과와 비교하므로, 형식이 어긋나면 CLI 검증이 실패한다.

## 코드 스타일

- 포맷은 루트 .prettierrc(4칸 들여쓰기·큰따옴표·세미콜론·trailing comma 없음)를 따르고 구조는 기존 서비스 코드를 기준으로 한다.
- 포맷터는 수정한 JS 파일만 지정한다(`npx prettier --write <파일>`). 기존 Electron 파일은 별도 요청 없이 전체 포맷하지 않는다(format:desktop은 요청이 있을 때만 쓴다).
- 변수·함수는 camelCase, 상수는 UPPER_SNAKE_CASE, 서비스·유틸 파일은 camelCaseService.js/camelCaseUtil.js를 사용한다. 함수는 get/run/parse/write/handle/kill 등 동작이 드러나게 이름 짓고 의미 없는 축약명을 피한다.
- const 화살표 함수를 쓴다. 엔진과 tests는 ESM(import/export)이고, desktop 메인 프로세스(.cjs)는 CommonJS(require), viewFormat.js·renderer.js는 브라우저 클래식 스크립트이므로 각 파일의 기존 방식을 따른다.
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
- 실행을 시작할 때 보관 기간(기본 30일, limits의 logRetentionDays로만 조정)이 지난 날짜 폴더의 autopilot_*.log·report_*.html만 지운다. 보관한 진행 기록 원본·완료 마커·날짜가 아닌 폴더는 건드리지 않고 링크는 따라가지 않으며, 실패해도 실행은 계속한다.

### 예약 작업

- 앱이 userData/tasks.md에 쓰고 --tasks-file로 넘긴다(긴 텍스트라 인자로 넘기지 않는다). 엔진이 시작할 때 한 번 읽어 매 회차 프롬프트의 <TASKS> 블록에 넣는다.
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

- 실제 세션은 claude -p로 실행한다.
- 프롬프트는 UTF-8 stdin으로 전달한다. shell에는 사용자 프롬프트를 삽입하지 않는다. Windows .cmd 래퍼 실행 인자도 검증한다.
- 세션은 대상 프로젝트의 CLAUDE.md를 기본 지침으로 사용한다. 프롬프트에 프로젝트 루트·예약 작업·진행 기록 경로·정책·남은 시간·작업 수 상한을 명시한다.
- AUTOPILOT.md·AUTOPILOT_POLICY.md 본문은 autopilot/src/utils/guideText.js에 문자열로 두고 회차마다 프롬프트 끝에 넣는다. 별도 md 파일은 두지 않는다.
- guideText.js의 `진행 문장` 절은 세션이 작업 중 메시지를 1인칭 해요체로 짧게 쓰고, 검증으로 확인한 수치 변화가 있으면 `성과:` 한 줄을 남기게 한다.
- Claude 세션과 그 하위 프로세스에 ELECTRON_RUN_AS_NODE를 넘기지 않는다(autopilotUtil.getRunEnv가 지운다). 넘기면 대상 프로젝트의 electron 실행이 깨진다.
- stream-json을 줄 단위로 처리한다. stderr는 별도로 읽으며, CLI가 종료되면 손자 프로세스의 상속 파이프 EOF를 기다리지 않는다.

### 실행 신호 파일

모두 .autopilot/progress/ 안에 둔다.

- STOP: 시작 시 지우고, 있으면 현재 회차 후 종료한다. 대기 중에도 감지한다.
- TODO_COMPLETE: 실제 경로는 progress/<실행 시작 날짜>/TODO_COMPLETE다. 시작 시 이전 마커를 지우고, 성공한 지시개선 회차 뒤에만 완료 신호로 인정한다.
- ROUND_OPTIONS.json: set이 RUNNING 잠금의 pid가 살아 있을 때만 model·effort를 병합해 기록하고(임시 파일 교체), 매 회차 시작 때 읽어 실행 인자보다 우선 적용한다. 시작 시 이전 파일을 지운다. 허용 값은 config.js의 MODEL_CHOICES·EFFORT_LEVELS이고 깨진 파일·허용되지 않은 값은 무시한다.
- RUNNING: 첫 줄에 실행 중인 pid, 둘째 줄에 실행 파일 이름, 셋째 줄에 이번 실행의 로그 파일(로그 위치가 정해진 직후 임시 파일 교체로 덧붙인다)을 적어 같은 프로젝트의 동시 실행을 막고 앱이 연결할 수 있게 한다. status는 이 잠금을 아래 판정으로 해석한 결과다.
    - 잠금을 얻기 전에는 STOP·완료 신호 같은 실행 상태를 건드리지 않고, 잠금은 종료 때 지운다.
    - 기록된 pid가 살아 있지 않거나(강제 종료로 잠금이 남은 경우), 살아 있어도 실행 파일 이름이 다르면(다른 프로그램이 pid를 재사용) 낡은 잠금으로 보고 덮어쓴다.
    - 이름은 Windows tasklist, 그 외 ps로 조회한다. 조회에 실패하거나 이름이 없는 이전 형식이면 같은 프로세스로 보고 거부한다(두 엔진이 동시에 도는 쪽이 더 위험하므로).

### 회차 처리

- 실패: exit code가 0이 아니거나 result.is_error가 true이면 실패다. 5·15·30분 후 재시도하고 연속 4회 실패 시 exit 1로 중단한다.
- 사용량 한도: rate_limit_event의 allowed* 상태는 정상이다. 한도 도달과 회차 실패가 함께 있고 미래 resetsAt이 있을 때만 실패로 세지 않고 리셋 1분 뒤까지 대기한다. 대기 후 작업 시간이 부족하면 종료한다.
- --extend-on-limit(앱 설정의 "사용량 한도")이면 대기하기 전에 대기 시간(초 단위 올림)만큼 종료 시각을 늦추고 `[사용량 한도] 종료 시각 연장` 줄을 남긴다. 이때는 대기 전 남은 시간이 최소 남은 시간 이상이면 계속한다.
- 시한: 회차 시한은 min(전체 종료 시각, 회차 시작 + 120분)이다. 출력이 계속 와도 시한을 적용한다. 프로세스 종료는 Windows가 taskkill /T /F, macOS/Linux가 별도 프로세스 그룹 종료다. 독립 세션으로 이탈한 프로세스까지 추적하지 않는다.
- idle: 정상 회차의 전후로 HEAD의 파일 내용이 바뀌지 않았으면(새 commit이 없음) idle이다. 진행 기록은 저장소 밖이라 따로 제외하지 않는다. 연속 2회면 종료한다.
- 리포트: HTML 리포트는 실행 중 30초마다, 대기 진입과 종료 때 갱신한다. 실행 중에는 git status를 호출하지 않는다. 모든 외부 문자열을 HTML escape한다.

### 설정과 기본값

- 우선순위는 실행 인자 > 기본값이다(model·effort는 실행 중 set > 실행 인자 > 기본값).
- 기본값과 상한(종료 시각·정책·model·effort·최소 남은 시간·회차 수·회차 시한·재시도·idle·회차당 작업 수·진행 기록 줄 수·보관 기간)은 autopilot/src/utils/config.js가 원본이다. 값을 바꾸면 README·지침·검증을 함께 맞춘다.
- model은 fallback이 sonnet이며 같은 모델이면 생략한다. commit 접두어는 [ap], 작업 브랜치는 ai/autopilot이다.
- 종료 시각은 HH:mm만 받는다. 날짜는 의도적으로 무시하고 이미 지난 시각이면 다음 날로 본다. 앱은 종료 시각을 비우면 인자를 생략해 기본값을 쓴다.
- 정책 인자는 auto/self/todo/directed 별칭도 지원한다.

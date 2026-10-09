# AutoPilot 키트 개발 지침

이 문서는 키트 자체를 개발할 때 적용한다. 대상 프로젝트에서 AutoPilot 회차로 실행 중이라면 이 문서 대신 회차 프롬프트에 포함된 AUTOPILOT.md와 AUTOPILOT_POLICY.md(원본은 autopilot/src/utils/guideText.js)를 따른다.

## 구조와 실행

- 저장소 루트는 개발용이고, 키트는 autopilot/ 하나다. 대상 프로젝트로 복사하는 단위도 autopilot/뿐이므로 키트에는 개발용 파일을 넣지 않는다. 개발용은 desktop/(Electron UI), tests/(검증), tools/(빌드 스크립트), docs/(README 이미지·앱 로고), legacy/(보관), .github/, package.json, .prettierrc다.
- autopilot/package.json은 대상 프로젝트의 module 설정과 무관하게 ESM으로 읽히게 하는 선언이므로 지우지 않는다.
- 런타임에 생기는 autopilot/progress/, autopilot/recycle_bin/, autopilot/AUTOPILOT_TODO.md는 autopilot/.gitignore가 제외한다.
- CLI 진입점: autopilot/core/autopilot_loop.js (Node.js 22.12 이상, ESM, 런타임 외부 의존성 없음).
- 실행 서비스: autopilot/src/services/autopilotService.js(runAutopilot, requestStop). 공통 로직은 autopilot/src/utils/의 라이브러리로 분리한다. 설정 해석 settingsUtil, CLI 인자 cliUtil, 프롬프트 promptUtil, 지침·정책 본문 guideText.js, 진행 기록 보관 progressUtil, HTML 리포트 reportUtil, git gitUtil, 프로세스 실행·종료 processUtil, stream-json 해석 streamUtil, 날짜·파일·로그·공통 함수 dateUtil·fileUtil·logUtil·util, 키트 경로·회차 결과 autopilotUtil, 상수 config.js. 검증은 tests/checkAutopilot.js(진입점)와 tests/lib/(fixtures 공용 가짜 CLI·헬퍼, unitChecks 단위 검증, scenarioChecks 시나리오·실행 파일 검증), 빌드는 tools/buildCli.js.
- 실행: node autopilot/core/autopilot_loop.js [HH:mm] [auto|todo]. 중단 요청: 같은 명령에 stop 전달. 실행 중 model·effort 변경: set --model <m> --effort <e> 전달. 실행 상태 확인: status(한 줄 JSON `{"running":true,"pid":N,"logFile":"..."}` 또는 `{"running":false}`). 버전은 --version이고 autopilot/package.json의 version을 출력하며 루트 package.json과 같아야 한다.
- 시작 배치와 sh는 인자 전달만 한다. 실제 세션은 claude -p로 실행한다.
- kitDir는 core/의 상위 폴더, projectDir는 kitDir의 상위 폴더다. 키트는 대상 Git 루트의 autopilot/으로 복사한다. 중첩 .git은 두지 않는다.
- 세션은 대상 프로젝트의 CLAUDE.md를 기본 지침으로 사용한다. 프롬프트에 프로젝트 루트·정책·남은 시간·작업 수 상한을 명시하고, AUTOPILOT.md·AUTOPILOT_POLICY.md 본문은 autopilot/src/utils/guideText.js에 문자열로 두고 회차마다 프롬프트 끝에 넣는다. 별도 md 파일은 두지 않는다.
- Electron UI는 desktop/에 있고, 빌드한 autopilot 실행 파일을 자식 프로세스로 실행한다(아래 Electron 연동).
- 기존 PowerShell 구현(autopilot_loop.ps1, check_progress_archive.ps1)은 기록 관리용으로 legacy/ 폴더에 압축해 두었다. 새 실행 경로에서 사용하지 않으며 수정하지 않는다. 다른 레거시 소스도 legacy/에 압축해 보관한다.

## 개발 명령

```sh
npm ci
npm run test:cli
npm run format:cli
npm run format:check:cli
npm run build:cli
npm run test:desktop
npm run format:desktop
```

검증은 임시 Git 저장소와 가짜 CLI만 사용한다. 실제 Claude 세션은 실행하지 않는다. 가짜 CLI는 cwd가 임시 프로젝트인지 확인한 뒤 Git을 사용한다. 검증 시간 단축은 runAutopilot()의 limits 옵션으로만 하며, 사용자 CLI에 테스트 설정을 노출하지 않는다.

build:cli는 현재 OS·CPU용 Node SEA를 생성한다. Node.js 24로 빌드하며, esbuild로 ESM을 CJS 한 파일로 묶은 뒤 postject로 런타임에 삽입한다. 지침 본문이 번들에 포함되므로 배포 폴더에 core/가 없다. 빌드는 시작할 때 출력 폴더를 비운다. tar로 실행 권한과 .gitignore를 보존한 tar.gz도 생성한다. .github/workflows/cli.yml은 Windows·Linux·macOS Intel/Apple Silicon에서 각각 CLI·데스크톱 포맷 검사, 데스크톱 러너 검증(test:desktop), 빌드(빌드 중 CLI 전체 검증 포함)를 실행하고, 별도 잡이 Windows에서 Electron 스모크(npm test)를 실행한다. .github/workflows/release.yml은 v* 태그를 push하면 같은 검증·빌드에 포터블 EXE를 더해 GitHub Release로 올린다. 태그는 루트와 autopilot/ package.json의 version과 같아야 한다.

## Electron 연동

- desktop/은 엔진 코드를 import하지 않는다. 빌드한 autopilot 실행 파일을 자식 프로세스로 띄우며, CLI 계약(인자·stdout 로그 줄 형식·exit code·stop)이 UI와의 인터페이스다. 로그 줄 형식을 바꾸면 desktop/autopilotRunner.cjs의 파서와 tests/checkDesktopRunner.js를 함께 고친다. tests/checkAutopilot.js는 모든 시나리오에서 실제 엔진 로그를 이 파서로 읽어 회차 결과와 비교하므로, 형식이 어긋나면 CLI 검증이 실패한다. 앱은 로그를 줄 맨 앞의 형식으로 해석하므로 엔진은 로그 기록 호출 한 번을 제어 줄 한 줄로만 쓰고(헤더도 줄마다 호출), 줄바꿈 뒤의 본문(Claude 출력·stderr·오류 메시지)은 logUtil이 4칸 들여써서 제어 줄을 흉내 내지 못하게 한다.
- 구성: autopilotRunner.cjs(실행·연결·종료 신호·강제 종료·로그 해석), autopilotIpc.cjs(설정 저장·대화상자·IPC), engineFinder.cjs(엔진 실행 파일 자동 탐색·엔진이 알려준 경로 검증), preload.cjs(window.autopilot 노출), viewFormat.js(DOM에 의존하지 않는 표시용 순수 함수), renderer.js·index.html·styles.css(대시보드·설정 화면). viewFormat.js는 renderer.js보다 먼저 불러오는 클래식 스크립트이고 tests/checkDesktopView.js가 단독으로 불러 검증한다. 렌더러에는 Node 권한을 주지 않는다.
- 엔진 파일은 autopilot/ 폴더 안의 파일만 허용한다. 앱을 켤 때 저장된 경로가 없거나 무효하면 포터블 실행 파일 위치·앱 위치·작업 폴더에서 상위 폴더로 올라가며 autopilot/와 dist/cli-<OS>-<CPU>/autopilot/의 실행 파일을 찾아 자동 연결하고(engineFinder.cjs), 설정의 자동 찾기 버튼이나 대화상자로도 고른다. 경로와 마지막 실행 옵션은 userData/settings.json에 저장한다. 시작은 --no-open과 종료 시각·정책·model·effort 인자, 종료 신호는 같은 실행 파일의 stop, 실행 중 model·effort 변경은 set(다음 회차부터 적용), 강제 종료는 Windows taskkill /T /F(그 외 SIGTERM)다. 대시보드는 회차 시작 로그의 (model X, effort Y)를 적용 중인 값으로, 마지막으로 set에 성공한 값을 요청 값으로 보고 둘이 다르면 적용 대기로 표시한다. 허용 값은 autopilotRunner.cjs의 MODEL_CHOICES·EFFORT_CHOICES와 index.html의 모델·Effort select이며 config.js와 함께 바꾼다. tests/checkDesktopRunner.js가 세 곳의 값과 select의 기본값 표시를 대조한다.
- 엔진 버전은 설정 화면에 앱 버전과 함께 표시하고(실행 파일의 --version, 비어 있으면 이전 엔진), 다르면 경고한다.
- 엔진이 알려준 경로는 믿지 않는다. 리포트 열기는 엔진 폴더의 progress/ 안의 report_*.html만 허용하고, 연결할 로그는 progress/ 안의 autopilot_*.log만 읽는다. 둘 다 링크를 실제 경로로 풀어 판단한다(engineFinder.cjs).
- 앱이 시작하지 않은 엔진(예: 시작 배치로 띄운 엔진)이 이미 실행 중이면 앱을 켤 때와 창에 포커스가 올 때 엔진의 status로 확인해 연결한다. 연결하면 로그 파일을 처음부터 읽어 상태를 복원하고(이때 읽은 회차는 시각을 알 수 없다) 1초마다 새 로그와 pid 생존을 확인한다. 종료 신호는 stop, 모델 변경은 set, 강제 종료는 pid로 하며 종료 코드는 알 수 없어 사유는 로그의 종료 줄에서 읽는다. 연결한 엔진은 앱 소유가 아니므로 창을 닫아도 종료하지 않는다.
- 앱이 시작한 엔진은 창을 닫으면 확인 후 강제 종료한다. 앱은 단일 인스턴스이며 두 번째 실행은 종료하고 기존 창을 앞으로 가져온다(--smoke-test는 실행 중인 앱과 무관하게 검증하도록 잠금에서 제외한다). 로그는 메인 프로세스가 최근 3000줄만 보관한다.
- 검증은 npm run test:desktop(가짜 CLI로 러너·연결·경로 검증, 표시 함수 검증)과 npm test(창·preload 스모크)다. VS Code 등이 ELECTRON_RUN_AS_NODE=1을 설정한 셸에서는 해제하고 electron을 실행한다.

## 스크립트와 세션 계약

- 인수인계는 autopilot/AUTOPILOT_PROGRESS.md 하나로 유지한다. 날짜별로 나누지 않는다.
- 진행 기록이 200줄을 초과하면 원본을 autopilot/progress/<시작 날짜>/AUTOPILOT_PROGRESS_<고유 ID>.md에 보관한다. 보관 성공 시에만 정리를 지시하며 현재 상태·미완료·주의사항·다음 작업과 최근 완료 5건을 유지한다. 보관 실패 시 원본을 유지한다.
- TODO_COMPLETE는 autopilot/progress/<실행 시작 날짜>/TODO_COMPLETE다. 시작 시 이전 마커를 지우고, 성공한 지시개선 회차 뒤에만 완료 신호로 인정한다.
- STOP은 autopilot/progress/STOP이다. 시작 시 지우고, 현재 회차 후 종료한다. 대기 중에도 감지한다.
- ROUND_OPTIONS는 autopilot/progress/ROUND_OPTIONS.json이다. set은 RUNNING 잠금의 pid가 살아 있을 때만 model·effort를 병합해 기록하고(임시 파일 교체), 매 회차 시작 때 읽어 실행 인자보다 우선 적용한다. 시작 시 이전 파일을 지운다. 허용 값은 config.js의 MODEL_CHOICES·EFFORT_LEVELS이고 깨진 파일·허용되지 않은 값은 무시한다. 회차 시작 로그는 [N회차] 시작 - 남은 시간 N분 (model X, effort Y) 형식이다.
- RUNNING은 autopilot/progress/RUNNING이다. 첫 줄에 실행 중인 pid, 둘째 줄에 실행 파일 이름, 셋째 줄에 이번 실행의 로그 파일(로그 위치가 정해진 직후 임시 파일 교체로 덧붙인다)을 적어 같은 키트의 동시 실행을 막고 앱이 연결할 수 있게 한다. status는 이 잠금을 아래 판정으로 해석한 결과다. 잠금을 얻기 전에는 STOP·완료 신호를 지우지 않고 종료 때 지운다. 기록된 pid가 살아 있지 않거나(강제 종료로 잠금이 남은 경우), 살아 있어도 실행 파일 이름이 다르면(다른 프로그램이 pid를 재사용) 낡은 잠금으로 보고 덮어쓴다. 이름은 Windows tasklist, 그 외 ps로 조회하며 조회에 실패하거나 이름이 없는 이전 형식이면 같은 프로세스로 보고 거부한다(두 엔진이 동시에 도는 쪽이 더 위험하므로).
- 실행을 시작할 때 보관 기간(기본 30일, limits의 logRetentionDays로만 조정)이 지난 날짜 폴더의 autopilot_*.log·report_*.html만 지운다. 보관한 진행 기록 원본·완료 마커·날짜가 아닌 폴더는 건드리지 않고 링크는 따라가지 않으며, 실패해도 실행은 계속한다.
- exit code가 0이 아니거나 result.is_error가 true이면 실패다. 5·15·30분 후 재시도하고 연속 4회 실패 시 exit 1로 중단한다.
- rate_limit_event의 allowed* 상태는 정상이다. 한도 도달과 회차 실패가 함께 있고 미래 resetsAt이 있을 때만 실패로 세지 않고 리셋 1분 뒤까지 대기한다. 대기 후 작업 시간이 부족하면 종료한다.
- 회차 시한은 min(전체 종료 시각, 회차 시작 + 120분)이다. Windows는 taskkill /T /F, macOS/Linux는 별도 프로세스 그룹을 종료한다. 출력이 계속 와도 시한을 적용한다. 독립 세션으로 이탈한 프로세스까지 추적하지 않는다.
- 프롬프트는 UTF-8 stdin으로 전달한다. shell에는 사용자 프롬프트를 삽입하지 않는다. Windows .cmd 래퍼 실행 인자도 검증한다.
- stream-json을 줄 단위로 처리한다. stderr는 별도로 읽으며, CLI가 종료되면 손자 프로세스의 상속 파이프 EOF를 기다리지 않는다.
- 정상 회차의 전후 git diff에서 진행 기록만 바뀌었으면 idle이다. 연속 2회면 종료한다.
- HTML 리포트는 실행 중 30초마다, 대기 진입과 종료 때 갱신한다. 실행 중에는 git status를 호출하지 않는다. 모든 외부 문자열을 HTML escape한다.

## 설정과 중복된 기본값

우선순위는 실행 인자 > TODO 섹션 > 기본값이다(model·effort는 실행 중 set > 실행 인자 > 기본값). 종료 시각은 07:00, 정책은 자율개선, model은 opus(fable·opus·sonnet·haiku, fallback은 sonnet이며 같은 모델이면 생략), effort는 high, 최소 남은 시간은 20분, 최대 60회차, 회차 시한 120분, 재시도 5·15·30분, 연속 idle 2회, 회차당 작업 최대 2건, 로그·리포트 보관 30일이다. commit 접두어는 [ap], 작업 브랜치는 ai/autopilot이다. 값 변경 시 README·지침·검증을 함께 맞춘다.

실행시간 섹션은 오전/오후 N시 M분 또는 HH:mm을 읽는다. 날짜는 의도적으로 무시하고 이미 지난 시각이면 다음 날로 본다. 정책 섹션의 첫 유효 줄이 정확히 자율개선/지시개선일 때만 인정한다. 실행 인자는 auto/self/todo/directed 별칭도 지원한다.

## 코드 스타일

29commerce_backend의 .prettierrc와 서비스 템플릿을 기준으로 한다. 변수·함수는 camelCase, 상수는 UPPER_SNAKE_CASE, 서비스·유틸 파일은 camelCaseService.js/camelCaseUtil.js를 사용한다. 함수는 get/run/parse/write/handle/kill 등 동작이 드러나게 이름 짓고 의미 없는 축약명을 피한다. 공개 서비스 함수는 try/catch, 오류 로그, STATUS_OK/STATUS_FAILED 반환을 갖춘다. 성공 데이터는 data, 오류는 error: { code, msg }에 담는다. CLI 오류에 HTTP 코드나 웹 서버 의존성을 추가하지 않는다. 유틸 내부 예외는 서비스 경계에서 처리하며 프로세스 종료와 finally 정리를 유지한다. ESM import/export, const 화살표 함수, 4칸 들여쓰기, 큰따옴표, 세미콜론, trailing comma 없음. 함수 사이와 논리 블록(변수 선언군·검증·반환) 사이에는 빈 줄을 둔다. if는 한 줄이어도 중괄호를 쓰고 중첩 삼항 연산자는 쓰지 않는다. 오브젝트 필드는 key: value로 명시하고 shorthand를 쓰지 않는다. 서비스 함수는 준비·실행·결과 처리 단계로 나누고 재사용할 로직은 utils의 export default 라이브러리로 분리한다. 포맷터는 수정한 JS 파일만 지정한다. 기존 Electron 파일은 별도 요청 없이 전체 포맷하지 않는다. 주석은 복잡한 이유에만 최소한으로 한국어로 쓴다.

JS·Markdown·로그는 UTF-8이고 기존 BOM 문서도 읽는다. .bat은 ASCII만 유지한다. 기존 dirty 작업은 보존한다.

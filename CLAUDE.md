# AutoPilot 개발 지침

이 문서는 AutoPilot 자체를 개발할 때 적용한다. 대상 프로젝트에서 AutoPilot 회차로 실행 중이라면 이 문서 대신 회차 프롬프트에 포함된 AUTOPILOT.md와 AUTOPILOT_POLICY.md(원본은 autopilot/src/utils/guideText.js)를 따른다.

## 구조와 실행

- 배포물은 Electron 앱의 Windows 포터블 exe 하나다. 엔진(autopilot/)은 앱에 내장되고(electron-builder extraResources로 패키지의 resources/engine/에 복사), 앱이 자기 실행 파일을 ELECTRON_RUN_AS_NODE=1로 Node처럼 실행해 엔진 스크립트를 자식 프로세스로 돌린다. 별도 엔진 exe·시작 bat·sh·SEA 빌드는 없다. 사용자는 앱 화면에서 대상 프로젝트 폴더·작업·종료 시각·정책·model·effort를 모두 정하고 시작한다. TODO 파일은 없다.
- 저장소 루트는 개발용이고, 엔진 소스는 autopilot/ 하나다. 개발용은 desktop/(Electron UI), tests/(검증), docs/(README 이미지·앱 로고), legacy/(보관), .github/, package.json, .prettierrc다.
- autopilot/package.json은 엔진이 앱·대상 프로젝트의 module 설정과 무관하게 ESM으로 읽히게 하는 선언이다. 패키지의 resources/engine/에도 복사되므로 지우지 않는다.
- 엔진 진입점: autopilot/core/autopilot_loop.js (ESM, 런타임 외부 의존성 없음, Electron 44에 들어 있는 Node 24에서 실행).
- 실행 서비스: autopilot/src/services/autopilotService.js(runAutopilot, requestStop, requestRoundOptions, getRunStatus, requestProgressReset). 공통 로직은 autopilot/src/utils/의 라이브러리로 분리한다. 설정 해석 settingsUtil, CLI 인자 cliUtil, 프롬프트 promptUtil, 지침·정책 본문 guideText.js, 진행 기록 보관 progressUtil, HTML 리포트 reportUtil, git gitUtil, 프로세스 실행·종료 processUtil, stream-json 해석 streamUtil, 날짜·파일·로그·공통 함수 dateUtil·fileUtil·logUtil·util, 프로젝트·작업 폴더·진행 기록 경로와 회차 결과 autopilotUtil, 상수 config.js. 검증은 tests/checkAutopilot.js(진입점)와 tests/lib/(fixtures 공용 가짜 CLI·헬퍼, unitChecks 단위 검증, scenarioChecks 시나리오·CLI 진입 검증)다.
- 실행(CLI 계약): node autopilot/core/autopilot_loop.js --project <프로젝트> [--end-time HH:mm] [--policy auto|todo] [--tasks-file <파일>] [--model <m>] [--effort <e>] [--config-dir <d>] [--no-open]. 하위 명령은 모두 --project가 필요하다. 중단 요청 stop, 실행 중 model·effort 변경 set --model <m> --effort <e>, 진행 기록 초기화 reset-progress, 실행 상태 확인 status(한 줄 JSON `{"running":true,"pid":N,"logFile":"..."}` 또는 `{"running":false}`). 위치 인자(HH:mm·정책)와 --version은 없다.
- 프로젝트: --project는 Git 저장소의 루트 폴더여야 한다(엔진이 확인). 프로젝트 안의 autopilot/은 progress/(로그·리포트·실행 신호)와 recycle_bin/을 두는 작업 폴더이며 엔진이 만들고 .gitignore(*)를 써서 프로젝트 git에서 제외한다(이미 있는 .gitignore는 건드리지 않는다). 중첩 .git은 두지 않는다.
- 예약 작업(Tasks)은 앱이 userData/tasks.md에 쓰고 --tasks-file로 넘긴다(긴 텍스트라 인자로 넘기지 않는다). 엔진이 시작할 때 한 번 읽어 매 회차 프롬프트의 <TASKS> 블록에 넣는다. 지시개선은 작업이 비어 있으면 시작하지 않는다.
- 진행 기록은 프로젝트 저장소가 아니라 앱 데이터 폴더의 %APPDATA%/AutoPilot/projects/<프로젝트 폴더명>-<실제 경로 SHA-256 앞 8자>/AUTOPILOT_PROGRESS.md 하나다(autopilotUtil.getProgressFile, 정리되는 임시 폴더는 쓰지 않는다). 같은 프로젝트의 다음 실행이 이어받는다. 첫 실행이면 엔진이 PROGRESS_TEMPLATE으로 만들어 두고, 경로는 프롬프트와 로그 헤더(Progress)로 알린다. 세션은 이 파일을 갱신하되 commit하지 않는다. 검증은 runAutopilot의 dataDir 옵션(CLI는 APPDATA 환경 변수)으로 위치를 격리한다.
- 세션은 대상 프로젝트의 CLAUDE.md를 기본 지침으로 사용한다. 프롬프트에 프로젝트 루트·예약 작업·진행 기록 경로·정책·남은 시간·작업 수 상한을 명시하고, AUTOPILOT.md·AUTOPILOT_POLICY.md 본문은 autopilot/src/utils/guideText.js에 문자열로 두고 회차마다 프롬프트 끝에 넣는다. 별도 md 파일은 두지 않는다. 실제 세션은 claude -p로 실행한다.
- 엔진은 Claude 세션과 그 하위 프로세스에 ELECTRON_RUN_AS_NODE를 넘기지 않는다(autopilotUtil.getRunEnv가 지운다). 넘기면 대상 프로젝트의 electron 실행이 깨진다.
- 기존 PowerShell 구현(autopilot_loop.ps1, check_progress_archive.ps1)은 기록 관리용으로 legacy/ 폴더에 압축해 두었다. 새 실행 경로에서 사용하지 않으며 수정하지 않는다. 다른 레거시 소스도 legacy/에 압축해 보관한다.

## 개발 명령

```sh
npm ci
npm run test:cli
npm run format:cli
npm run format:check:cli
npm run test:desktop
npm run format:desktop
npm test
npm run build
npm run dist
```

검증은 임시 Git 저장소와 가짜 CLI만 사용한다. 실제 Claude 세션은 실행하지 않는다. 가짜 CLI는 cwd가 임시 프로젝트인지 확인한 뒤 Git을 사용한다. 검증 시간 단축은 runAutopilot()의 limits 옵션으로만 하며, 사용자 CLI에 테스트 설정을 노출하지 않는다. 패키징한 앱의 엔진까지 확인하려면 npm run build 뒤 node tests/checkAutopilot.js dist/win-unpacked/AutoPilot.exe를 실행한다(번들된 resources/engine을 앱 exe로 실행해 CLI 계약을 검증한다).

npm run dist는 electron-builder로 Windows x64 포터블 exe를 만든다. 앱 asar에는 desktop/과 로고만 들어가고, 엔진은 extraResources로 resources/engine/에 복사된다. 지침 본문은 엔진 소스(guideText.js)에 있으므로 별도 파일이 필요 없다. .github/workflows/ci.yml은 Windows에서 CLI·데스크톱 포맷 검사, test:cli, test:desktop, Electron 스모크(npm test)를 실행한다. .github/workflows/release.yml은 v* 태그를 push하면 같은 검증 뒤 포터블 exe를 GitHub Release로 올린다. 태그는 루트 package.json의 version과 같아야 한다.

## Electron 연동

- desktop/은 엔진 코드를 import하지 않는다. 앱 exe를 ELECTRON_RUN_AS_NODE=1로 실행해 엔진 스크립트를 자식 프로세스로 띄우며(개발 중에는 저장소의 autopilot/core/, 패키지에서는 resources/engine/core/), CLI 계약(인자·stdout 로그 줄 형식·exit code·stop)이 UI와의 인터페이스다. 로그 줄 형식을 바꾸면 desktop/autopilotRunner.cjs의 파서와 tests/checkDesktopRunner.js를 함께 고친다. tests/checkAutopilot.js는 모든 시나리오에서 실제 엔진 로그를 이 파서로 읽어 회차 결과와 비교하므로, 형식이 어긋나면 CLI 검증이 실패한다. 앱은 로그를 줄 맨 앞의 형식으로 해석하므로 엔진은 로그 기록 호출 한 번을 제어 줄 한 줄로만 쓰고(헤더도 줄마다 호출), 줄바꿈 뒤의 본문(Claude 출력·stderr·오류 메시지)은 logUtil이 4칸 들여써서 제어 줄을 흉내 내지 못하게 한다.
- 구성: autopilotRunner.cjs(실행·연결·종료 신호·강제 종료·로그 해석), autopilotIpc.cjs(설정 저장·엔진 실행 인자·대화상자·IPC), projectFiles.cjs(대상 프로젝트 검사·엔진이 알려준 경로 검증), preload.cjs(window.autopilot 노출), viewFormat.js(DOM에 의존하지 않는 표시용 순수 함수), sky.js(시간대별 수채 하늘, 대시보드 상태와 무관), renderer.js·index.html·styles.css(대시보드 한 화면). viewFormat.js는 renderer.js보다 먼저 불러오는 클래식 스크립트이고 tests/checkDesktopView.js가 단독으로 불러 검증한다. 렌더러에는 Node 권한을 주지 않는다.
- 대상 프로젝트는 화면 아래 프로젝트 줄의 폴더 선택 대화상자로 고른다. Git 저장소의 루트(.git이 있는 폴더)만 받고(projectFiles.getProjectError), 고르기 전에는 시작 버튼이 잠기며 실행 중에는 바꿀 수 없다. 프로젝트·작업·종료 시각·정책·model·effort는 userData/settings.json에 저장해 다음 실행 때 복원한다(프로젝트는 고를 때, 나머지는 시작할 때 저장하고, model·effort는 실행 중 set에 성공해도 저장한다). 시작은 --project --no-open --tasks-file --policy --model --effort(비어 있지 않을 때만 --end-time) 인자, 종료 신호는 같은 엔진의 stop, 실행 중 model·effort 변경은 set(다음 회차부터 적용), 강제 종료는 Windows taskkill /T /F(그 외 SIGTERM)다. 대시보드는 회차 시작 로그의 (model X, effort Y)를 적용 중인 값으로, 마지막으로 set에 성공한 값을 요청 값으로 보고 둘이 다르면 적용 대기로 표시한다. 허용 값은 autopilotRunner.cjs의 MODEL_CHOICES·EFFORT_CHOICES, autopilotIpc.cjs의 POLICY_CHOICES와 index.html의 모델 라디오(name="model")·Effort 단계 목록(datalist#effort-levels의 option label)·정책 라디오(name="policy")이며 config.js와 함께 바꾼다. tests/checkDesktopRunner.js가 값과 data-default가 붙은 기본값을 대조한다. Effort는 range를 끄는 동안(input) 표시만 바꾸고 손을 뗄 때(change) 한 번만 set을 보낸다.
- 화면은 사이드바 없이 한 장이다. 가운데 버튼 하나가 상태에 따라 시작 → 종료 신호 → 종료(강제 종료, 메인 프로세스의 확인 대화상자를 거친다)로 바뀐다. 버튼 아래에 모델(마크만, 고른 모델만 이름을 펼친다)·Effort·종료 시각 한 줄과 작업 입력(textarea, 적는 만큼 늘어난다)을 두고, 실행 중에는 종료 시각·정책·작업을 잠그며 작업 칸은 숨긴다. 진행 단계 줄은 상태 문구와 겹치면 숨기고 재시도·사용량 한도·회차 결과 같은 때만 보인다. 가운데에는 최근 로그 4줄만 카드 없이 보여주고, 누르면 전체 로그(3000줄)와 회차 기록이 펼쳐진다. 자주 쓰지 않는 프로젝트 선택·개선 정책·진행 기록 초기화(확인 대화상자를 거쳐 reset-progress 실행, 실행 중에는 막는다)·리포트 열기·전체 기록·앱 버전은 헤더의 설정 버튼으로 여는 오른쪽 패널(#settings, 닫혀 있으면 inert)에 둔다. 정책 라디오는 패널에 있지만 form="run-form"으로 폼에 속한다. 서체는 desktop/fonts/의 Pretendard(OFL, 라이선스 파일 동봉)를 @font-face로 넣어 오프라인에서도 같게 보인다.
- 배경은 sky.js가 그리는 시간대별 수채 하늘이다(30초마다 시각으로 하늘색·해·달 위치를 계산, 달 모양은 날짜로, 별·별자리는 고정 씨앗, 밤에는 5~15초마다 운석). 하늘은 z-index -1로 화면 뒤에 깔고, 로고 PNG는 흰 배경을 블렌드로 지우므로 로고를 감싼 요소에 transform·opacity·filter·z-index를 걸지 않는다(블렌드가 격리된다). 글자 높이의 하늘 밝기가 0.19보다 어두우면 body.night로 밝은 잉크로 바꾸고, 새벽·노을(--twilight)에는 보조 글자를 본문 잉크에 가깝게 하고 글자 번짐을 키운다. 최근 로그 아래부터 화면 끝까지는 세 겹 backdrop-filter로 블러가 점점 짙어진다(.veil, 위치는 renderer가 --veil-top으로 정한다). CSP가 inline style 속성을 막으므로 스크립트의 스타일은 style.setProperty로만 넣는다. 애니메이션은 prefers-reduced-motion에서 모두 멈춘다.
- 창은 세로형 600×800(최소 480×640, 작업 영역보다 크면 줄인다)이고 frame 없이 띄운다. 하늘과 이어지는 투명 헤더(#titlebar, 설정·최소화·최대화·닫기 버튼만)를 index.html에서 직접 그려 경계를 두지 않으며, 헤더 전체가 끌기 영역(-webkit-app-region: drag)이고 버튼만 뺀다. 최소화·최대화·닫기는 preload의 window.appWindow가 main.cjs의 window:* IPC로 요청한 창에만 적용하고, 닫기는 일반 close라 실행 중 확인을 그대로 거친다. 최대화 상태는 window:state로 받아 아이콘을 바꾼다. 스크롤은 헤더 아래 .content만 한다(헤더가 밀려나면 창을 끌 곳이 없다). 스모크 테스트는 window.appWindow와 #titlebar도 확인한다.
- 엔진이 알려준 경로는 믿지 않는다. 리포트 열기는 시작한 프로젝트의 autopilot/progress/ 안의 report_*.html만 허용하고, 연결할 로그는 progress/ 안의 autopilot_*.log만 읽는다. 둘 다 링크를 실제 경로로 풀어 판단한다(projectFiles.cjs).
- 앱을 닫았다 켠 사이에도 엔진이 살아 있어 선택한 프로젝트에서 실행 중이면 앱을 켤 때와 창에 포커스가 올 때 엔진의 status로 확인해 연결한다. 연결하면 로그 파일을 처음부터 읽어 상태를 복원하고(이때 읽은 회차는 시각을 알 수 없다) 1초마다 새 로그와 pid 생존을 확인한다. 종료 신호는 stop, 모델 변경은 set, 강제 종료는 pid로 하며 종료 코드는 알 수 없어 사유는 로그의 종료 줄에서 읽는다. 연결한 엔진은 앱 소유가 아니므로 창을 닫아도 종료하지 않는다.
- 앱이 시작한 엔진은 창을 닫으면 확인 후 강제 종료한다. 앱은 단일 인스턴스이며 두 번째 실행은 종료하고 기존 창을 앞으로 가져온다(--smoke-test는 실행 중인 앱과 무관하게 검증하도록 잠금에서 제외한다). 로그는 메인 프로세스가 최근 3000줄만 보관한다.
- 검증은 npm run test:desktop(가짜 CLI로 러너·연결·경로 검증, 표시 함수 검증)과 npm test(창·preload 스모크, 앱 번들의 엔진을 ELECTRON_RUN_AS_NODE로 --help 실행하는 확인 포함)다. VS Code 등이 ELECTRON_RUN_AS_NODE=1을 설정한 셸에서는 해제하고 electron을 실행한다(앱이 엔진을 띄울 때는 앱이 직접 지정한다).

## 스크립트와 세션 계약

아래 autopilot/progress/ 경로는 대상 프로젝트 안의 작업 폴더다.

- 인수인계는 위 진행 기록(앱 데이터 폴더의 AUTOPILOT_PROGRESS.md) 하나로 유지한다. 날짜별로 나누지 않는다.
- 진행 기록이 100줄(PROGRESS_MAX_LINES)을 초과하면 원본을 autopilot/progress/<시작 날짜>/AUTOPILOT_PROGRESS_<고유 ID>.md에 보관한다. 줄 수는 매 회차 시작 때 확인하고(하루 동안 문서가 커지는 것을 막기 위해서다), 보관 성공 시에만 정리를 지시하며 현재 상태·미완료·주의사항·다음 작업과 최근 완료 5건을 유지하고 전체를 60줄(PROGRESS_TARGET_LINES) 안팎으로 줄이게 한다. 상한까지 바로 다시 차서 정리가 반복되지 않도록 목표를 상한보다 낮게 둔다. 정리 지시가 실패한 회차는 같은 지시를 이어가고(재보관하지 않는다), 지시 후 다음 회차에도 상한을 넘으면 줄 수가 상한 이하로 내려갈 때까지 다시 지시하지 않는다. 보관 실패 시 원본을 유지한다.
- 작업이 모두 끝난 실행(지시개선의 TODO_COMPLETE 인정, 연속 idle 종료)은 종료할 때 진행 기록 원본을 progress/<날짜>/AUTOPILOT_PROGRESS_<고유 ID>.md에 보관하고 초기 상태(progressUtil의 PROGRESS_TEMPLATE과 보관 경로 한 줄)로 되돌린다. 진행 기록이 저장소 밖에 있어 commit 안 된 변경이 남지 않으므로 종료 때 바로 한다. 시각 도달·회차 상한·실패·중단 종료는 이어갈 내용이 있어 그대로 둔다. 보관에 실패하면 원본을 유지하고, 이미 초기 상태(비었거나 템플릿뿐이거나 안내 한 줄만 있음)면 아무것도 하지 않는다. reset-progress 명령(앱의 진행 기록 초기화 버튼)은 같은 동작을 지금 하며 실행 중이면 거부한다.
- TODO_COMPLETE는 autopilot/progress/<실행 시작 날짜>/TODO_COMPLETE다. 시작 시 이전 마커를 지우고, 성공한 지시개선 회차 뒤에만 완료 신호로 인정한다.
- STOP은 autopilot/progress/STOP이다. 시작 시 지우고, 현재 회차 후 종료한다. 대기 중에도 감지한다.
- ROUND_OPTIONS는 autopilot/progress/ROUND_OPTIONS.json이다. set은 RUNNING 잠금의 pid가 살아 있을 때만 model·effort를 병합해 기록하고(임시 파일 교체), 매 회차 시작 때 읽어 실행 인자보다 우선 적용한다. 시작 시 이전 파일을 지운다. 허용 값은 config.js의 MODEL_CHOICES·EFFORT_LEVELS이고 깨진 파일·허용되지 않은 값은 무시한다. 회차 시작 로그는 [N회차] 시작 - 남은 시간 N분 (model X, effort Y) 형식이다.
- RUNNING은 autopilot/progress/RUNNING이다. 첫 줄에 실행 중인 pid, 둘째 줄에 실행 파일 이름, 셋째 줄에 이번 실행의 로그 파일(로그 위치가 정해진 직후 임시 파일 교체로 덧붙인다)을 적어 같은 프로젝트의 동시 실행을 막고 앱이 연결할 수 있게 한다. status는 이 잠금을 아래 판정으로 해석한 결과다. 잠금을 얻기 전에는 STOP·완료 신호를 지우지 않고 종료 때 지운다. 기록된 pid가 살아 있지 않거나(강제 종료로 잠금이 남은 경우), 살아 있어도 실행 파일 이름이 다르면(다른 프로그램이 pid를 재사용) 낡은 잠금으로 보고 덮어쓴다. 이름은 Windows tasklist, 그 외 ps로 조회하며 조회에 실패하거나 이름이 없는 이전 형식이면 같은 프로세스로 보고 거부한다(두 엔진이 동시에 도는 쪽이 더 위험하므로).
- 실행을 시작할 때 보관 기간(기본 30일, limits의 logRetentionDays로만 조정)이 지난 날짜 폴더의 autopilot_*.log·report_*.html만 지운다. 보관한 진행 기록 원본·완료 마커·날짜가 아닌 폴더는 건드리지 않고 링크는 따라가지 않으며, 실패해도 실행은 계속한다.
- exit code가 0이 아니거나 result.is_error가 true이면 실패다. 5·15·30분 후 재시도하고 연속 4회 실패 시 exit 1로 중단한다.
- rate_limit_event의 allowed* 상태는 정상이다. 한도 도달과 회차 실패가 함께 있고 미래 resetsAt이 있을 때만 실패로 세지 않고 리셋 1분 뒤까지 대기한다. 대기 후 작업 시간이 부족하면 종료한다.
- 회차 시한은 min(전체 종료 시각, 회차 시작 + 120분)이다. Windows는 taskkill /T /F, macOS/Linux는 별도 프로세스 그룹을 종료한다. 출력이 계속 와도 시한을 적용한다. 독립 세션으로 이탈한 프로세스까지 추적하지 않는다.
- 프롬프트는 UTF-8 stdin으로 전달한다. shell에는 사용자 프롬프트를 삽입하지 않는다. Windows .cmd 래퍼 실행 인자도 검증한다.
- stream-json을 줄 단위로 처리한다. stderr는 별도로 읽으며, CLI가 종료되면 손자 프로세스의 상속 파이프 EOF를 기다리지 않는다.
- 정상 회차의 전후로 HEAD의 파일 내용이 바뀌지 않았으면(새 commit이 없음) idle이다. 진행 기록은 저장소 밖이라 따로 제외하지 않는다. 연속 2회면 종료한다.
- HTML 리포트는 실행 중 30초마다, 대기 진입과 종료 때 갱신한다. 실행 중에는 git status를 호출하지 않는다. 모든 외부 문자열을 HTML escape한다.

## 설정과 중복된 기본값

우선순위는 실행 인자 > 기본값이다(model·effort는 실행 중 set > 실행 인자 > 기본값). 종료 시각은 07:00, 정책은 자율개선, model은 opus(fable·opus·sonnet·haiku, fallback은 sonnet이며 같은 모델이면 생략), effort는 high, 최소 남은 시간은 20분, 최대 60회차, 회차 시한 120분, 재시도 5·15·30분, 연속 idle 2회, 회차당 작업 최대 2건, 진행 기록 상한 100줄·정리 목표 60줄, 로그·리포트 보관 30일이다. commit 접두어는 [ap], 작업 브랜치는 ai/autopilot이다. 값 변경 시 README·지침·검증을 함께 맞춘다.

종료 시각은 HH:mm만 받는다. 날짜는 의도적으로 무시하고 이미 지난 시각이면 다음 날로 본다. 앱은 종료 시각을 비우면 인자를 생략해 기본값을 쓴다. 정책 인자는 auto/self/todo/directed 별칭도 지원한다.

## 코드 스타일

29commerce_backend의 .prettierrc와 서비스 템플릿을 기준으로 한다. 변수·함수는 camelCase, 상수는 UPPER_SNAKE_CASE, 서비스·유틸 파일은 camelCaseService.js/camelCaseUtil.js를 사용한다. 함수는 get/run/parse/write/handle/kill 등 동작이 드러나게 이름 짓고 의미 없는 축약명을 피한다. 공개 서비스 함수는 try/catch, 오류 로그, STATUS_OK/STATUS_FAILED 반환을 갖춘다. 성공 데이터는 data, 오류는 error: { code, msg }에 담는다. CLI 오류에 HTTP 코드나 웹 서버 의존성을 추가하지 않는다. 유틸 내부 예외는 서비스 경계에서 처리하며 프로세스 종료와 finally 정리를 유지한다. ESM import/export, const 화살표 함수, 4칸 들여쓰기, 큰따옴표, 세미콜론, trailing comma 없음. 함수 사이와 논리 블록(변수 선언군·검증·반환) 사이에는 빈 줄을 둔다. if는 한 줄이어도 중괄호를 쓰고 중첩 삼항 연산자는 쓰지 않는다. 오브젝트 필드는 key: value로 명시하고 shorthand를 쓰지 않는다. 서비스 함수는 준비·실행·결과 처리 단계로 나누고 재사용할 로직은 utils의 export default 라이브러리로 분리한다. 포맷터는 수정한 JS 파일만 지정한다. 기존 Electron 파일은 별도 요청 없이 전체 포맷하지 않는다. 주석은 복잡한 이유에만 최소한으로 한국어로 쓴다.

JS·Markdown·로그는 UTF-8이고 기존 BOM 문서도 읽는다. 기존 dirty 작업은 보존한다.

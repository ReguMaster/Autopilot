# 데스크톱 앱 지침 (desktop/)

desktop/(Electron 앱)과 tests/checkDesktop*.js를 고칠 때 적용한다. 공통 규칙(CLI 계약·로그 줄 형식·코드 스타일·검증 명령)은 [루트 CLAUDE.md](../CLAUDE.md)를 따른다. 사용자 관점의 화면 동작은 [README.md](README.md)에 있고, 아래는 코드를 고칠 때 지켜야 할 규칙이다.

## 엔진 연동

- 엔진 코드를 import하지 않는다. 앱 exe를 ELECTRON_RUN_AS_NODE=1로 실행해 엔진 스크립트를 자식 프로세스로 띄운다(개발 중에는 저장소의 autopilot/core/, 패키지에서는 resources/engine/core/). CLI 계약(인자·stdout 로그 줄 형식·exit code·stop)이 UI와의 인터페이스다.
- 엔진 로그 줄을 해석하는 곳은 셋이다. 로그 줄 형식을 바꾸면 모두 고치고 해당 검증으로 확인한다.
    - 러너: autopilotRunner.cjs의 파서 → tests/checkDesktopRunner.js
    - 지난 실행: runHistory.cjs(autopilotRunner.parseLine·isReplay를 그대로 쓴다) → tests/checkDesktopHistory.js
    - 화면: viewFormat.js(applyStoryEntry·buildTranscript·describePastRun) → tests/checkDesktopView.js
- 재연결: 앱을 닫았다 켠 사이에도 엔진이 살아 있어 선택한 프로젝트에서 실행 중이면, 앱을 켤 때와 창에 포커스가 올 때 엔진의 status로 확인해 연결한다. 연결하면 로그 파일을 처음부터 읽어 상태를 복원하고(이때 읽은 회차는 시각을 알 수 없다) 1초마다 새 로그와 pid 생존을 확인한다. 종료 신호는 stop, 모델 변경은 set, 강제 종료는 pid로 하며, 종료 코드는 알 수 없어 사유는 로그의 종료 줄에서 읽는다. 연결한 엔진은 앱 소유가 아니므로 창을 닫아도 종료하지 않는다.
- 로그는 메인 프로세스가 최근 3000줄만 보관한다.

## 보안과 경로

- 렌더러에는 Node 권한을 주지 않는다. preload.cjs가 window.autopilot·window.appWindow만 노출한다.
- CSP가 inline style 속성을 막으므로 스크립트의 스타일은 style.setProperty로만 넣는다.
- 엔진이 알려준 경로는 믿지 않는다(projectFiles.cjs). 리포트 열기는 시작한 프로젝트의 .autopilot/progress/ 안의 report_*.html만 허용하고, 연결할 로그는 progress/ 안의 autopilot_*.log만 읽는다. 둘 다 링크를 실제 경로로 풀어 판단한다.
- viewFormat.js는 DOM에 의존하지 않는 표시용 순수 함수이며 renderer.js보다 먼저 불러오는 클래식 스크립트다. tests/checkDesktopView.js가 단독으로 불러 검증한다.

## 실행 설정과 허용 값

- 대상 프로젝트는 Git 저장소의 루트(.git이 있는 폴더)만 받는다(projectFiles.getProjectError). 고르기 전에는 시작 버튼이 잠기고 실행 중에는 바꿀 수 없다.
- 프로젝트·작업·종료 시각·정책·model·effort는 userData/settings.json에 저장해 다음 실행 때 복원한다. 프로젝트는 고를 때, 나머지는 시작할 때 저장하고, model·effort는 실행 중 set에 성공해도 저장한다.
- 종료 신호는 같은 엔진의 stop, 실행 중 model·effort 변경은 set(다음 회차부터 적용), 강제 종료는 Windows taskkill /T /F(그 외 SIGTERM)다.
- 실행 중에는 model·effort를 고르는 즉시 set으로 보낸다(Effort는 팝오버의 단계를 누를 때 한 번). 전달 중에 또 바뀌면 마지막 선택만 한 번 더 보낸다(renderer의 applyRoundOptions).
- 대시보드는 회차 시작 로그의 (model X, effort Y)를 적용 중인 값으로, 마지막으로 set에 성공한 값을 요청 값으로 본다. 둘이 다르면 적용 대기로 표시한다.
- 허용 값은 autopilotRunner.cjs의 MODEL_CHOICES·EFFORT_CHOICES, autopilotIpc.cjs의 POLICY_CHOICES, index.html의 모델 라디오(name="model")·Effort 단계 목록(datalist#effort-levels의 option label)·정책 라디오(name="policy")이며 엔진 config.js와 함께 바꾼다. tests/checkDesktopRunner.js가 값과 data-default가 붙은 기본값을 대조한다.

## 계정

### 프로필과 사용량 조회

- 조회는 메인 프로세스의 claudeAccount.cjs가 계정마다 하나씩(accountIpc.cjs가 관리) 한다. 그 계정 설정 폴더의 .credentials.json 토큰으로 비공식 엔드포인트 api.anthropic.com/api/oauth/usage·/api/oauth/profile 두 곳만 부른다.
- 앱을 켤 때(startAccountWatch, 스모크 테스트 제외) 모든 계정을 한 번 읽어 메인에 보관하고 5분마다 다시 읽어 autopilot:account({id, account})로 화면에 보낸다. 새로 고침(autopilot:refresh-account)은 15초 안의 재요청을 막는다. 일부만 실패하면 성공한 쪽만 갱신하고 이전 값은 유지한다.
- 토큰은 이 모듈 밖으로 내보내거나 로그에 쓰지 않고 읽기만 한다. 앱이 refresh하지 않는다(refresh token을 쓰면 Claude Code 로그인이 깨질 수 있다).
- 액세스 토큰은 수명이 약 8시간이라 만료되면 claudeCli.renewCredentials가 가장 작은 `claude -p` 요청 한 번(haiku, effort low, 도구·사용자 설정·MCP를 빼서 입력 약 3k 토큰, 약 $0.0006)으로 CLI가 직접 갱신하게 맡기고 다시 읽는다. 실행·로그인 중에는 하지 않고 계정마다 30분에 한 번만 시도하며, 갱신이 안 되면 그때 안내를 낸다.
- 프로필에는 아바타 URL이 없다. 사용량은 limits[](session·weekly_all·weekly_scoped)를 기준으로 읽고 없으면 five_hour·seven_day로 대신한다. 형식이 바뀌어도 앱이 깨지지 않게 실패 안내만 낸다.
- 엔진·로그 형식과는 무관하다. tests/checkDesktopRunner.js가 가짜 fetch로 검증한다.

### 멀티 계정

- 기본 계정은 "Claude 데이터 폴더"(기본 .claude)에 로그인된 계정이다. 이 폴더는 설정 패널에서 고른 경로(settings.json의 claudeDir), 없으면 환경 변수 CLAUDE_CONFIG_DIR, 없으면 ~/.claude 순으로 정하고(accountStore.resolveBaseDir) 환경마다 달라도 폴더 선택·자동 감지로 맞춘다.
- 엔진의 --config-dir 기본값이 ~/.claude이므로 기본 계정이 다른 위치면 그 폴더를 --config-dir로 명시한다. 직접 고른 폴더가 없어졌으면 시작하지 않는다. 시작할 때 선택한 계정이 기본 계정이 아니면 엔진에 --config-dir <그 폴더>를 넘긴다.
- 추가한 계정은 앱 데이터 폴더의 accounts/<acct-8자리16진수>/ 설정 폴더 하나씩이다(로그인 정보·.claude.json은 계정마다 따로). settings.json에는 {id, label, shared} 목록(accounts)과 선택한 계정(accountId)만 저장하고 계정 폴더 경로나 토큰은 저장하지 않는다. 폴더는 id로만 정해서(id 형식을 검사한다) 설정 파일로 임의 경로를 가리킬 수 없게 한다.
- 계정 추가 때 "기본 .claude의 메모리·지침·스킬 함께 쓰기"(기본 켬)를 고르면 기본 폴더의 projects(메모리·세션 기록)·skills·plugins·commands·agents는 junction(관리자 권한 불필요)으로, CLAUDE.md·settings.json은 심볼릭 링크(안 되면 복사)로 연결한다(accountStore.linkSharedData). 이미 있는 실제 폴더·파일은 건드리지 않는다. 앱을 켤 때·폴더를 바꿀 때 다시 이어 주며 새 위치에 없는 항목의 낡은 링크는 끊는다.
- 계정 제거는 연결을 먼저 끊고 폴더를 지워 기본 .claude의 데이터를 지우지 않는다(테스트로 보장).
- 로그인은 claudeCli.cjs가 CLAUDE_CONFIG_DIR을 그 폴더로 지정해 `claude auth login --claudeai`를 실행한다(브라우저는 CLI가 연다). 출력에서 찾은 로그인 주소(claude.com·claude.ai·anthropic.com의 https만)를 "브라우저에서 열기"로 열 수 있게 알리고, 브라우저가 코드를 보여 주면 입력칸의 코드를 CLI의 stdin으로 전달한다. 로그인 코드는 로그에 남기지 않는다. 끝나면 `claude auth status --json`으로 로그인 상태를 확인하고, 새 계정이 실패·취소되면 만든 폴더를 지운다.
- 시작 전에는 기본 계정을 포함해 선택한 계정의 로그인을 `claude auth status --json`으로 확인한다(accountIpc.getRunAccount, 종료 코드는 보지 않는다). 안 돼 있으면 시작하지 않고 LOGIN_REQUIRED를 돌려준다. 렌더러는 이때 안내 줄(#login-banner)에 로그인 버튼을 보이고, 누르면 그 계정의 로그인을 시작해 주소·코드 입력이 있는 프로필 패널을 열며, 로그인이 성공하면 멈췄던 시작을 이어간다.
- 실행·로그인 중에는 계정 선택·추가·제거·로그인·데이터 폴더 변경을 막는다(메인도 거부한다). 한도 회피를 위한 자동 계정 전환은 하지 않는다.
- tests/checkDesktopAccounts.js가 가짜 claude로 검증한다.

### 플랫폼 범위

- 배포는 Windows exe(포터블·설치형)뿐이지만 계정 코드는 비-Windows에서도 돌도록 짠다. claudeCli.findClaude는 비-Windows에서 실행 권한을 확인하고, junction은 Windows 밖에서 디렉터리 심볼릭 링크로, 프로세스 종료는 Windows taskkill·그 외 SIGTERM으로 하며, CMD 래퍼 처리는 Windows만 한다.
- 로그인 여부는 저장 위치가 플랫폼마다 달라 파일이 아니라 `claude auth status --json`으로 확인한다.
- Windows·Linux는 로그인 정보가 설정 폴더의 .credentials.json이라 사용량·프로필 조회가 된다. macOS는 키체인이라 조회하지 못하고(UNSUPPORTED_PLATFORM 안내) 계정 전환·로그인·실행은 CLI로 된다. Linux는 WSL로 tests/checkDesktopAccounts.js·checkDesktopRunner.js·checkDesktopView.js를 확인했고 macOS는 확인하지 못했다.

## 지난 실행(기록 보기)

- 시작 화면(#recent)에 최근 3개, 설정 패널의 지난 실행 보기·#archive-all의 전체 보기가 시트(#archive)로 목록과 상세(채팅 모양 #archive-chat)를 연다.
- 원본은 대상 프로젝트의 .autopilot/progress/<날짜>/autopilot_*.log뿐이다. 별도 저장소를 두지 않는다(보관 기간은 엔진의 logRetentionDays를 따른다).
- 읽기는 메인 프로세스의 runHistory.cjs(listRuns·readRun)가 하고 IPC는 autopilot:list-runs·read-run·open-run-file이다. 렌더러가 보내는 값은 실행 id(`YYYY-MM-DD/autopilot_*.log`)뿐이고 getRunFiles가 형식을 검사해 진행 기록 폴더 안의 경로로만 바꾼다. 열기(리포트·원본 로그)는 projectFiles의 isProjectReportFile·isProjectLogFile로 실제 경로까지 검사한다. 목록의 심볼릭 링크·junction은 따라가지 않는다.
- 시작 시각은 폴더 날짜와 파일 이름의 HHmmss, 끝 시각은 파일 수정 시각이다(7일을 넘기면 알 수 없음). 요약 문장은 viewFormat.describePastRun이 만든다. 대화 변환(viewFormat.buildTranscript)은 알아볼 수 없는 줄을 건너뛰고 1500개까지만 둔다.
- 깨진 로그 대응: 잘못된 UTF-8·BOM·CRLF·제어 문자·2000자 넘는 줄을 정리한다. 16MB를 넘으면 끝부분만 읽고(isPartial) 상세는 최근 20000줄까지 보낸다. 비었거나 알아볼 줄이 없으면 isEmpty, 읽기 오류는 isUnreadable, 끝맺음 줄이 없으면 reason이 비어 `끝맺음 없음`이다. 실행 중인 엔진의 로그(isActive)는 끝맺음이 없어도 비정상으로 보지 않는다.
- 삭제(autopilot:delete-run, runHistory.deleteRun)는 메인의 확인 대화상자를 거쳐 그 실행의 로그·리포트만 지운다. 진행 중인 실행(isActive)은 거부하고 날짜 폴더는 비었을 때만 지운다(완료 마커·보관 원본은 건드리지 않는다).

## 새 버전 알림

- 메인 프로세스의 updateCheck.cjs가 앱을 켤 때(스모크 테스트 제외)와 6시간마다 GitHub `releases/latest`(공개 저장소, 토큰 없음)의 태그를 app.getVersion()과 숫자로 비교한다. 더 높으면 {version, url}을 보관하고 바뀔 때만 autopilot:update로 화면에 보낸다. 조회 실패는 조용히 넘어가고 이전 값을 유지한다.
- 열 주소는 `^v?\d+\.\d+\.\d+$`를 통과한 태그로 직접 만든다(응답의 URL은 쓰지 않는다). 렌더러는 주소를 보내지 않고 autopilot:open-update만 요청한다.
- 헤더 버튼 줄 맨 앞의 #update-chip(회색 칩, 파랑은 진행 중 표시 전용)이 누르면 그 릴리스 페이지를 연다. 자동 설치는 하지 않는다.
- tests/checkDesktopRunner.js가 가짜 fetch로 검증한다.

## 화면 구조

- 화면은 사이드바 없이 한 장이고 스크롤하지 않는다. 창 높이에 맞춰 본문이 줄어든다(헤더가 밀려나면 창을 끌 곳이 없다). 위에서부터 헤더(#titlebar), 상태 줄(.course, 아래에 회차 진행선 #track), 본문(.stage), 안내 문구(.notices: #notice·#login-banner·#project-banner, 비면 자리를 차지하지 않는다), 컴포저(#run-form.composer)를 쌓는다.
- 본문은 body[data-view]의 ready·run·done 중 하나만 보인다(viewFormat.getView). ready는 시작 전 인사(.greet)이고 상태 줄(.course)을 숨긴다. run은 이야기(.story)다. done은 실행을 마친 뒤의 정리(.finish)로, 실행이 끝난 상태가 남아 있는 동안 보이고 다른 프로젝트를 고르면 ready로 돌아간다(isFinishDismissed).
- 이야기는 renderer가 로그 줄마다 viewFormat.applyStoryEntry로 Claude의 문장(시각 + 본문 줄, 여러 줄 메시지의 4칸 들여 쓴 줄은 앞 문장에 잇는다)과 도구 줄(`HH:MM:SS   > 이름 인자`)을 묶음(beat)으로 만든다. 앱이 엔진을 시작·연결하는 [앱] 줄이 오면 이야기를 비운다.
- 문장 앞에는 그 전에 부른 도구가 칩으로 붙는다. 도구만 온 동안에는 describeTool이 지은 문장을 보여주다가 Claude의 문장이 오면 바꾼다. 사용량 한도·재시도 대기·종료 신호 뒤에는 getWaitSentence의 기다리는 이유가 지금 문장(#now-text)을 대신한다.
- 지난 문장(#story-past)은 최대 STORY_PAST_LINES개까지 쌓는다. 줄이 늘거나 지금 문장 높이가 바뀌면 renderer의 slidePast가 FLIP으로 올려 보내고 새 줄만 맺힌다.
- 진행선(getTrack)은 실행 시작부터 종료 예정 시각까지를 100으로 놓고 회차 구간·커밋 점(회차 끝)·지금 위치를 퍼센트로 그린다. 0.1% 넘게 바뀔 때만 다시 그리고, 회차 이름은 상태 줄의 N회차 진행 중과 겹쳐 그리지 않는다.
- 전체 기록(#history)은 아래에서 올라오는 흰 시트이고(닫혀 있으면 inert, 스크림을 누르거나 Esc로 닫는다) 전체 로그 줄은 content-visibility로 화면 밖을 그리지 않는다.

## 컴포저와 패널

- 실행이 시작되면 컴포저가 아래에 붙은 얇은 막대로 줄어든다(position: sticky, 좌우 여백은 그대로 두고 흰 바탕·그림자로 떠 있게 한다). 작업 칸(textarea, 높이 고정, 넘치면 칸 안에서 스크롤)은 접혀 작업 요약 한 줄 #tasks-toggle만 남고, 누르면 .fold의 grid-template-rows 0fr↔1fr 전환으로 읽기 전용 작업 칸이 펴진다. 접힌 칸은 visibility로 포커스를 막고 실행이 끝나면 접힌 상태로 돌아간다. renderer의 setTasksOpen이 body[data-tasks-open]을 다룬다.
- 주 버튼(#main-action, 글자 #main-action-label)은 시작 → 종료 신호 → 종료로 바뀐다. 종료 신호는 실수 방지로 한 번 누르면 붉게 바뀌어 4초 동안 "한 번 더 눌러 종료"를 보이고(줄어드는 채움이 남은 시간을 알린다) 그 안에 다시 눌러야 stop을 보낸다(renderer의 setStopArmed). 종료는 강제 종료이며 메인 프로세스의 확인 대화상자를 거친다.
- 알약 줄(.composer-bar)은 모델(#model-popover)·Effort(#effort-popover)·개선 정책(#policy-popover)·종료 시각(#end-time-popover)이다. Effort 파형은 renderer의 getWavePath가 path의 d를 정하고 값은 숨은 input#effort가 갖는다. 종료 시각 값은 숨은 input#end-time에 HH:mm 또는 빈 값으로 둔다.
- 정책 라디오(name="policy")는 정책 팝오버 안의 숨은 입력이고 form="run-form"으로 폼에 속하며, 팝오버 버튼은 그 값만 바꾼다. 설정 패널에는 정책이 없다.
- 실행 중에는 정책·종료 시각 알약을 숨긴다(종료 시각과 남은 시간은 상태 줄·진행선에, 정책은 작업 요약의 문구에 이미 있다). 알약 줄은 줄바꿈 없이 한 줄에 들어가야 하므로 좁은 창(560px 이하)에서는 남은 시간과 화살표를 숨긴다.
- 팝오버는 native popover와 anchor 위치를 쓰고 컴포저가 아래에 있어 위로 열린다. display는 :popover-open에만 준다(닫힌 팝오버에 display를 주면 보이지 않는 목록이 남아 클릭으로 값이 바뀐다). 모델 라디오(name="model")는 팝오버 안에 있지만 form="run-form"으로 폼에 속하고, 마크·아이콘은 svg.symbols의 symbol을 use로 쓴다.
- 프로필 패널(#profile, #profile-toggle)과 설정 패널(#settings, #settings-toggle)은 헤더 아래에 뜨는 같은 .panel 컴포넌트이며 한 번에 하나만 열린다(renderer의 setPanelOpen). 설정 패널은 닫혀 있으면 inert이고 열 때 ease-out·닫을 때 ease-in이며, 뒤에 헤더 아래만 덮는 .scrim을 깐다. 프로필 패널의 계정 목록은 #account-select 안에 renderer가 role=radio 버튼 줄로 만든다.
- 진행 기록 초기화(설정 패널)는 확인 대화상자를 거쳐 reset-progress를 실행하고 실행 중에는 막는다. 버튼은 공통 .button(primary·danger·small 조합)을 쓴다.

## 시각 규칙

- 화면은 흰 바탕 한 벌이다. 파랑(--accent) 하나를 지금 진행 중인 것(상태 점·진행선·캐럿·성과의 이후 숫자·시작 버튼)에만 쓴다.
- 글자 크기는 styles.css :root의 열 단계(--text-xs 12 ~ --display 56)만 쓴다.
- 서체는 desktop/fonts/의 Pretendard(OFL, 라이선스 파일 동봉)를 @font-face로 넣어 오프라인에서도 같게 보이게 한다. 숫자는 body의 tabular-nums(Pretendard 고정폭 숫자)로 써서 시계가 바뀌어도 흔들리지 않게 한다.
- 고정폭 서체(--mono, Windows의 Cascadia Mono)는 코드·경로·해시·전체 로그에만 쓴다(한글이 섞인 숫자 문구에 쓰면 글자 사이가 벌어진다).
- 지금 문장은 줄 순서대로 마스크를 쓸어 드러내고(renderer의 revealNowText, 글자 위치는 그대로다), 드러내는 중에 문장이 이어지면 마스크를 걷어 다 보여준다. 길이에 따라 글자 크기를 줄여(data-length) 네 줄 안에 넣는다.
- prefers-reduced-motion에서는 이동·확대 전환(패널·시트·팝오버 미끄러짐, 등장)을 끄고, 자리가 바뀌지 않는 투명도 표시(캐럿 깜빡임, 상태 점, 문장 드러내기, 문구 전환)만 남긴다.
- 창을 숨기면(document.hidden) :root.window-hidden으로 반복 애니메이션을 멈춘다. 등장 애니메이션은 서체가 준비돼 body.ready가 붙기 전까지 멈춰 둔다.

## 창과 시스템 연동

- 창은 세로형 600×800(최소 480×640, 작업 영역보다 크면 줄인다)이고 frame 없이 흰 바탕(main.cjs의 WINDOW_BACKGROUND)으로 첫 화면이 그려진 뒤(ready-to-show) 띄운다.
- 헤더(#titlebar)는 index.html에서 직접 그린다. 왼쪽에 로고, 오른쪽에 프로필·설정·최소화·최대화·닫기 버튼을 둔다(맨 앞에 #update-chip). 헤더 전체가 끌기 영역(-webkit-app-region: drag)이고 버튼만 뺀다.
- 최소화·최대화·닫기는 preload의 window.appWindow가 main.cjs의 window:* IPC로 요청한 창에만 적용한다. 닫기는 일반 close라 실행 중 확인을 그대로 거친다. 최대화 상태는 window:state로 받아 아이콘을 바꾼다.
- 앱은 단일 인스턴스이며 두 번째 실행은 종료하고 기존 창을 앞으로 가져온다(--smoke-test는 실행 중인 앱과 무관하게 검증하도록 잠금에서 제외한다).
- 앱이 시작한 엔진이 실행 중이면 창을 닫을 때 트레이로 숨기기만 하고 엔진은 계속 돈다(main.cjs의 close 처리, isOwnedEngineRunning). 종료는 트레이 메뉴의 종료로 하며 창을 띄워 confirmClose의 확인 후 강제 종료한다. 실행 중이 아니거나 연결한 엔진이면 닫을 때 앱이 종료된다.
- systemIntegration.cjs가 러너 상태 변화(onState)마다 절전 방지(powerSaveBlocker prevent-app-suspension, 엔진이 도는 동안), 작업표시줄 진행률(종료 시각까지 경과, 종료 신호·재시도·한도 대기는 paused), 트레이 툴팁, Windows 알림(포커스가 없을 때 종료·실패·사용량 한도 대기 전환만, 강제 종료 제외)을 맞춘다.
- 스모크 테스트(npm test)는 window.appWindow·#titlebar·#profile·#login-banner도 확인한다.

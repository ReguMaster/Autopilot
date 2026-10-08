# AutoPilot Desktop

Node.js 22 이상과 npm이 필요합니다. 저장소 루트에서 실행하세요.

```sh
npm install
npm start
```

| 명령 | 동작 |
| --- | --- |
| `npm start` | Electron 앱 실행 |
| `npm run dev` | 개발자 도구를 함께 열어 실행 |
| `npm run check` | 메인 프로세스 JavaScript 구문 검사 |
| `npm test` | Electron 창, preload 연결, 로컬 HTML 로드 확인 후 자동 종료 (실행 엔진은 시작하지 않음) |
| `npm run test:desktop` | 가짜 CLI로 엔진 제어(시작·종료 신호·강제 종료·로그 해석) 확인 |
| `npm run build` | Windows x64 앱 폴더 생성 (`dist/win-unpacked/AutoPilot.exe`) |
| `npm run dist` | Windows x64 포터블 EXE 생성 (`dist/AutoPilot-0.1.0-x64.exe`) |

Windows에서 빌드합니다. 최초 설치와 패키징에는 Electron 및 패키징 도구 다운로드를 위한 인터넷 연결이 필요합니다. 배포 EXE는 코드 서명하지 않으므로 Windows에서 게시자 경고가 표시될 수 있습니다.

`desktop/main.cjs`는 앱 창과 보안 설정을, `autopilotRunner.cjs`·`autopilotIpc.cjs`·`engineFinder.cjs`·`preload.cjs`는 엔진 제어와 연결을, `index.html`·`styles.css`·`renderer.js`는 대시보드 화면을 담당합니다. 별도 웹 서버나 프론트엔드 빌드 도구는 사용하지 않습니다.

## 대시보드 사용법

1. 루트 README의 `npm run build:cli`로 만든 `autopilot/` 폴더를 대상 프로젝트 루트에 복사합니다.
2. 앱을 켜면 앱 실행 위치·작업 폴더에서 상위 폴더로 올라가며 `autopilot/autopilot.exe`(개발 중에는 `dist/cli-<OS>-<CPU>/autopilot/`)를 찾아 자동으로 연결합니다. 찾지 못하면 사이드바 하단의 **설정**에서 **자동 찾기**를 누르거나 **파일 선택**으로 그 폴더의 `autopilot.exe`를 고르세요(연결 전에는 대시보드에 안내가 표시됩니다). 경로와 마지막 실행 옵션은 앱 데이터 폴더의 `settings.json`에 저장됩니다.
3. 종료 시각·개선 정책·모델·Effort를 정하고 **시작**을 누릅니다. 종료 시각과 정책을 비워 두면 `AUTOPILOT_TODO.md` 설정과 기본값을 따릅니다.

| 버튼 | 동작 |
| --- | --- |
| 시작 | `autopilot.exe --no-open --model ... --effort ...`를 자식 프로세스로 실행 |
| 종료 신호 | 같은 실행 파일에 `stop`을 전달. 현재 회차를 마친 뒤 종료 |
| 강제 종료 | 확인 후 즉시 중단. Windows는 `taskkill /T /F`로 하위 `claude`까지 종료하고, commit 전 변경은 working tree에 남음 |

- 모델(Fable·Opus·Sonnet·Haiku)과 Effort(low~max)는 실행 중에도 바꿀 수 있습니다. 바꾸는 즉시 엔진에 `set`으로 전달되고, 진행 중인 회차는 그대로 끝난 뒤 **다음 회차부터** 적용됩니다. 실행 카드 아래의 "적용 중"은 현재 회차 값, "다음 회차부터"는 대기 중인 값(적용 대기)이며, 회차 기록에는 회차마다 쓴 값이 남습니다. 종료 요청 후에는 바꿀 수 없습니다.
- 로그는 엔진의 stdout/stderr를 줄 단위로 실시간 표시합니다(최근 3000줄 유지). 회차·남은 시간·종료 예정 시각·회차별 결과는 로그 줄에서 읽습니다.
- 리포트 HTML은 자동으로 열지 않고 **리포트 열기**로 엽니다.
- 실행 중에 창을 닫으면 확인 후 강제 종료합니다. 앱을 다시 켜면 이미 실행 중인 엔진에는 다시 연결하지 않습니다.
- VS Code 등이 `ELECTRON_RUN_AS_NODE=1`을 설정한 셸에서는 해제한 뒤 `npm start`·`npm test`를 실행하세요.

`npm run test:desktop`은 가짜 CLI로 시작·종료 신호·강제 종료·로그 해석을 확인합니다. 공통 실행 엔진과 단독 CLI 배포는 루트 README의 `test:cli`·`build:cli`를 참고하세요. Electron 배포 앱에는 실행기나 작업 대상 프로젝트를 포함하지 않습니다.

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
| `npm test` | Electron 창과 로컬 HTML 로드 확인 후 자동 종료 (실행 엔진은 시작하지 않음) |
| `npm run build` | Windows x64 앱 폴더 생성 (`dist/win-unpacked/AutoPilot.exe`) |
| `npm run dist` | Windows x64 포터블 EXE 생성 (`dist/AutoPilot-0.1.0-x64.exe`) |

Windows에서 빌드합니다. 최초 설치와 패키징에는 Electron 및 패키징 도구 다운로드를 위한 인터넷 연결이 필요합니다. 배포 EXE는 코드 서명하지 않으므로 Windows에서 게시자 경고가 표시될 수 있습니다.

`desktop/main.cjs`는 앱 창과 보안 설정을, `index.html`과 `styles.css`는 화면을 담당합니다. 별도 웹 서버나 프론트엔드 빌드 도구는 사용하지 않습니다.

현재는 데스크톱 UI 기본 구성만 포함합니다. Node.js 실행 엔진 연결, 프로젝트 선택, 로그/리포트 연동은 아직 구현하지 않았습니다. 공통 실행 엔진과 단독 CLI 배포는 루트 README의 `test:cli`·`build:cli`를 참고하세요. Electron 배포 앱에는 실행기나 작업 대상 프로젝트를 포함하지 않습니다.

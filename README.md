<p align="center">
  <img src="docs/logo.png" alt="AutoPilot" width="520">
</p>

<p align="center">
  <strong>개발자가 자리를 비운 사이에도, 프로젝트는 앞으로.</strong><br>
  Claude Code로 코드 수정부터 검증, 커밋까지 반복하는 자동 개발 앱 (Windows · macOS · Linux)
</p>

<p align="center">
  <a href="https://github.com/ReguMaster/Autopilot/releases/latest"><strong>다운로드</strong></a>
  &nbsp;·&nbsp;
  <a href="#시작하기">시작하기</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/ReguMaster/Autopilot/issues">의견 남기기</a>
</p>

<p align="center">
  <img src="docs/screenshots/running.png" alt="AutoPilot 실행 화면" width="880">
</p>

## AutoPilot은 무엇인가요?

해야 할 작업과 종료 시각을 정하고 **시작**을 누르세요. AutoPilot은 Claude Code를 활용해 작업을 이어가고, 수정 사항을 검증한 뒤 Git 커밋과 리포트로 남깁니다.

작업을 직접 지정할 수도 있고, 개선할 부분을 스스로 찾도록 맡길 수도 있습니다.

**작업 선택 → 코드 수정 → 검증 → 커밋 → 기록 → 다음 작업**

## 주요 기능

- **자율 개발** — 지시한 작업을 끝낸 뒤에도 버그, 안정성, 성능 등 개선점을 찾아 작업합니다.
- **작업별 커밋** — 검증을 통과한 변경을 작업 단위로 커밋해 결과를 쉽게 검토할 수 있습니다.
- **종료 시각 설정** — 원하는 시각까지 실행하고, 앱을 닫아도 시스템 트레이에서 계속 동작합니다. 설정에서 트레이 상주를 항상 켜 두거나 로그인할 때 자동으로 켜지게 할 수 있습니다.
- **예약 시작** — 정해진 시각이나 사용량 한도가 리셋되는 때에 맞춰 자동으로 시작합니다. 남은 한도와 시작할 수 있는 시간대를 조건으로 걸 수 있어, 자는 동안에도 한도를 알뜰하게 씁니다.
- **프로젝트 탭** — 헤더 아래 탭으로 프로젝트를 최대 8개까지 열어 두고 프로젝트마다 AutoPilot을 따로 돌립니다. 탭마다 작업·종료 시각·모델·계정이 따로이고, 앱을 다시 켜도 탭이 유지됩니다.
- **전역·프로젝트별 설정** — 모델·Effort·개선 정책·작업·예약 같은 값을 모든 프로젝트의 기본값(전역)과 프로젝트별 값으로 나눠 저장합니다. 프로젝트가 따로 정하지 않은 값은 전역 값을 따라갑니다.
- **로그 보관과 설정 관리** — 지난 로그·리포트를 보관할 기간과 차지한 용량을 설정에서 관리하고, 설정을 파일로 내보내고 가져옵니다.
- **끝난 뒤 PC 절전·종료** — 밤새 돌리는 실행이 스스로 끝나면 설정에 따라 1분 뒤 PC를 절전하거나 종료합니다. 알림이 뜨는 동안 취소할 수 있고, 직접 멈춘 경우에는 하지 않습니다.
- **모델 버전 고정** — Opus·Sonnet 같은 모델 계열마다 쓸 버전을 직접 골라, 최신 버전이 바뀌어도 같은 모델로 돌릴 수 있습니다.
- **작업 이어하기** — 중단된 프로젝트를 다시 열면 기록을 바탕으로 진행을 이어갑니다.
- **실시간 진행 상황** — 현재 작업, 수정 파일, 테스트, 커밋과 결과를 화면에서 확인할 수 있습니다.
- **성과 카드와 연속 실행** — 마친 화면의 성과를 PNG 카드 한 장으로 저장해 공유하고, 시작 화면 인사에서 프로젝트를 며칠째 이어서 돌렸는지 알려 줍니다.
- **사용량 관리** — Claude 사용량과 재설정 시각을 확인하고, 한도에 걸리면 대기 후 재개합니다.

## 시작하기

**필요한 것:** Windows · macOS · Linux 데스크톱, [Git](https://git-scm.com/), [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview)

1. [최신 릴리스](https://github.com/ReguMaster/Autopilot/releases/latest)에서 내 운영체제에 맞는 파일을 다운로드합니다. ([운영체제별 참고](#운영체제별-참고))
2. AutoPilot을 실행하고 **Git 프로젝트 폴더**를 선택합니다. (최소 1개의 커밋 필요)
3. 작업 내용, 모델, 개선 방식, 종료 시각을 정하고 **시작**을 누릅니다.
4. 실행을 마치면 리포트와 `ai/autopilot` 브랜치의 커밋을 검토합니다.

> AutoPilot은 클라우드에서 실행되는 서비스가 아닙니다. 작업하는 동안 **PC가 켜져 있어야** 하며, Claude Code 사용 권한이 필요합니다.

### 운영체제별 참고

| 운영체제 | 받을 파일 | 참고 |
| --- | --- | --- |
| **Windows** 10 이상 (x64) | `AutoPilot-Setup-*.exe`(설치형), `AutoPilot-Portable-*.exe`(무설치형) | 포터블은 실행할 때마다 임시 폴더에 풀려 설치형보다 느립니다. |
| **macOS** 12 이상 (Apple Silicon·Intel) | `AutoPilot-*-mac-arm64.dmg`·`-x64.dmg` (`.zip`도 제공) | 개발자 인증서로 서명하지 않은 앱이라 처음 한 번 **우클릭 → 열기**로 실행하거나 `xattr -dr com.apple.quarantine /Applications/AutoPilot.app`을 실행해야 합니다. 로그인 정보는 키체인에서 읽어 사용량 표시와 **한도 리셋 예약**도 씁니다. 처음 사용량을 읽을 때 키체인 접근을 묻는 창이 뜨면 허용해 주세요. 앱을 Finder·Dock으로 열어도 터미널의 `PATH`(`claude` 설치 위치)를 찾아 씁니다. |
| **Linux** (x64·arm64, 데스크톱 환경) | `AutoPilot-*-linux-*.AppImage`, `AutoPilot-*-linux-*.deb` | AppImage는 `chmod +x`로 실행 권한을 준 뒤 실행합니다. 트레이 아이콘과 알림은 데스크톱 환경이 지원해야 하며(GNOME은 AppIndicator 확장 필요), Ubuntu 24.04처럼 사용자 네임스페이스를 막은 환경에서 AppImage가 시작되지 않으면 `--no-sandbox`를 붙여 실행하거나 `.deb`로 설치하세요. |

## 원하는 방식으로 작업하세요

| 모드         | 동작                                                              |
| ------------ | ----------------------------------------------------------------- |
| **자율개선** | 지정한 작업을 완료한 뒤에도 스스로 개선점을 찾아 계속 작업합니다. |
| **지시개선** | 지정한 작업만 처리하고 완료되면 종료합니다.                       |

<p align="center">
  <img src="docs/screenshots/ready.png" alt="AutoPilot 시작 화면" width="430">
  <img src="docs/screenshots/done.png" alt="AutoPilot 결과 화면" width="430">
</p>

## Git 기록을 지키며 작업합니다

- 변경 사항은 별도 **`ai/autopilot` 브랜치**에 커밋합니다(브랜치 이름과 커밋 접두어는 설정의 Git에서 바꿀 수 있습니다).
- 삭제 대상 파일은 `.autopilot/recycle_bin`으로 옮겨 복구할 수 있도록 합니다.
- 실행 기록, 커밋, 소요 시간과 비용을 리포트로 확인할 수 있습니다.
- 프로젝트의 `CLAUDE.md`에 추가 규칙을 작성할 수 있습니다.

> [!WARNING]
> AutoPilot은 Claude Code 명령 실행 시 매번 승인을 요청하지 않습니다. 중요한 데이터는 백업하고, 신뢰할 수 있는 프로젝트에서 사용하세요. 자동 생성된 변경은 병합 전에 직접 검토해야 합니다.

## 개발자를 위한 정보

소스에서 실행하거나 빌드하려면 **Node.js 22.12 이상**이 필요합니다.

```bash
npm ci
npm start       # 데스크톱 앱 실행
npm test        # 스모크 테스트
npm run dist        # Windows 설치형·포터블 빌드
npm run dist:mac    # macOS dmg·zip 빌드 (macOS에서)
npm run dist:linux  # Linux AppImage·deb 빌드
```

자세한 구조와 개발 규칙은 [CLAUDE.md](CLAUDE.md)와 [desktop/README.md](desktop/README.md)를 참고하세요.

---

<p align="center">
  버그 제보와 기능 제안은 <a href="https://github.com/ReguMaster/Autopilot/issues">GitHub Issues</a>에서 받습니다.
</p>

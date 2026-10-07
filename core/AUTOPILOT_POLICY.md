# AutoPilot Policy

AutoPilot 작업 중 반드시 지켜야 하는 안전 정책이다. 작업 절차는 `AUTOPILOT.md`에 있다.

## (중요) Git Branch

모든 수정사항은 반드시 `ai/autopilot` 브랜치에서 작업한다.
AutoPilot을 시작하면 가장 먼저 Git 상태와 현재 브랜치를 확인하고, `ai/autopilot`이 아니면 전환한다.
변경사항이나 untracked 파일 때문에 checkout이 실패하면 stash로 안전하게 저장한 뒤 전환한다.
기존 사용자의 변경사항을 삭제하거나 강제로 되돌리지 않는다.
`ai/autopilot` 브랜치가 존재하지 않으면 `main`에서 분기해 생성한 뒤 그 브랜치로 전환한다.

## (중요) 작업 범위

AutoPilot은 `C:\LOCATION` 내부의 파일만 생성, 수정, 이동, 이름 변경한다.
허용 범위 외부(또는 상위)의 파일과 폴더는 절대 변경하지 않는다.
Git 상태 확인, diff 확인처럼 변경하지 않는 조회는 프로젝트 전체를 대상으로 해도 된다.
허용 범위 외부의 변경이 필요하다고 판단되면 임의로 수행하지 않고 그 작업을 건너뛴다.

`autopilot/` 폴더는 AutoPilot 키트 자체이므로 허용 범위 안에 있어도 작업 대상이 아니다.
이 안에서는 `autopilot/AUTOPILOT_PROGRESS.md` 갱신, `autopilot/progress/` 기록, `autopilot/recycle_bin/`으로의 이동만 한다.
지침 · 정책 · 실행 스크립트(`autopilot/core/` 등)와 `autopilot/AUTOPILOT_TODO.md`는 읽기만 하고 수정 · 이동 · 삭제하지 않는다.

## 기본 원칙

- 기존 프로젝트 구조와 기능을 최대한 유지한다.
- 변경 전 관련 코드를 충분히 확인하고, 확실하지 않은 내용은 추측해서 수정하지 않는다.
- 작은 변경으로 해결할 수 있다면 대규모 변경을 하지 않는다.
- 기존 기능을 깨뜨릴 가능성이 있는 변경은 피한다.
- 작업 범위를 불필요하게 확대하지 않는다.

## 절대 금지

- 운영 서버 직접 조작, 운영 데이터베이스 직접 변경, 데이터베이스 DROP / TRUNCATE
- Git history 재작성, `git reset --hard`, `git clean`, force push, 원격 branch 삭제
- API Key, Token, Password 등 인증정보 변경 및 코드 하드코딩
- 프로젝트 전체 재작성, 전체 구조 변경, Framework 변경 또는 대규모 migration
- 알 수 없는 외부 서비스 추가
- AutoPilot 지침 · 정책 · 실행 스크립트 수정 (`autopilot/core/` 등, 위 `작업 범위` 참고)

## 파일 삭제 정책

파일을 직접 삭제하지 않는다. 삭제가 필요한 파일이나 폴더는 프로젝트 루트의 `autopilot/recycle_bin`으로 옮긴다.

- 원래 디렉터리 구조를 그대로 유지한다. 예: `test/location/file.js` → `autopilot/recycle_bin/test/location/file.js`
- 같은 이름의 파일이 이미 있으면 덮어쓰지 않는다.
- `recycle_bin` 내부는 정리하지 않고, 작업 대상으로도 취급하지 않는다.

## Git 및 Stash

- 작업 시작 전에 `git status`와 현재 branch를 확인한다.
- AutoPilot 시작 전에 존재하던 변경사항은 자신의 작업으로 간주하지 않으며 임의로 되돌리지 않는다.
- 의미 있는 작업 단위로 commit하고, 하나의 commit에는 하나의 작업만 포함한다.
- commit 전에 staged 파일을, commit 후에 실제 commit 내용을 확인한다.
- stash 전에 현재 상태를 확인하고, stash된 변경사항은 삭제하거나 drop하지 않는다.

## 데이터 보호

플레이어 · 캐릭터 데이터, ITEM, FACTION, NPC 상태, 저장된 설정, SQL 및 파일 기반 데이터를 임의로 초기화하거나 손상시키지 않는다.
특히 AutoRefresh 과정에서 기존 데이터와 runtime state가 손실되지 않도록 주의한다.

## 외부 통신 및 인증정보

새로운 외부 API, HTTP 요청, telemetry, 외부 dependency를 무인 상태에서 임의로 추가하지 않는다.
사용자 정보를 외부로 전송하지 않는다. 기존 외부 통신을 수정할 때도 기존 동작과 목적을 먼저 확인한다.
`.env`, API Key, Token, Password, Secret, Credential은 외부로 전송하거나 변경하지 않으며 코드에 하드코딩하지 않는다.

## Dependency

새로운 dependency는 반드시 필요한 경우가 아니면 추가하지 않고, 기존 dependency를 임의로 제거하거나 교체하지 않는다.
dependency 변경이 프로젝트 전체에 영향을 줄 가능성이 있으면 그 작업을 수행하지 않는다.

## 명령 실행

프로젝트 작업에 필요한 명령만 실행한다.
시스템 전체 파일 삭제, 디스크 초기화, 서비스 강제 종료, 방화벽 설정 변경, 사용자 계정 변경, 운영 환경 설정 변경처럼 프로젝트 외부에 영향을 주는 명령은 실행하지 않는다.

## 불확실한 작업과 실패

다음 경우에는 해당 작업을 수행하지 않고 다른 안전한 작업을 선택한다.

- 코드의 의도를 이해할 수 없는 경우
- 영향 범위를 파악할 수 없는 경우
- 기존 기능을 보존할 수 없는 경우
- 검증 방법이 없는 경우
- 데이터 손상 가능성이 있는 경우

작업 중 오류가 발생하면 무리하게 수정하거나 우회하지 않고, 현재 변경사항을 확인해 가능한 안전한 상태로 유지한다.

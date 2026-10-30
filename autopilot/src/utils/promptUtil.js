import { BUILD_PHASES, MODE_BUILD, PHASE_LABELS, POLICY_TODO, PROGRESS_MAX_LINES, PROGRESS_TARGET_LINES, PROPOSALS_DIR, PROVIDER_CLAUDE, PROVIDER_LABELS } from "./config.js";
import dateUtil from "./dateUtil.js";
import phaseUtil from "./phaseUtil.js";
import { getAutopilotGuide, getAutopilotPolicy } from "./guideText.js";

const getPolicyPrompt = (policy, todoDoneRelPath) => {
    if (policy === POLICY_TODO) {
        return [
            "이번 실행의 개선 정책은 [지시개선]이다.",
            "<TASKS>에 예약된 작업만 처리하고 스스로 새 개선 작업을 찾지 마라.",
            `예약 작업이 모두 완료되었으면 진행 기록을 갱신한 뒤 빈 파일 ${todoDoneRelPath} 를 생성하고 세션을 종료하라.`,
            "아직 처리할 예약 작업이 남아 있으면 이 파일을 만들지 마라."
        ].join(" ");
    }

    return "이번 실행의 개선 정책은 [자율개선]이다. 예약 작업을 모두 마친 뒤에도 AUTOPILOT.md의 작업 탐색과 선택 기준으로 스스로 개선 작업을 찾아 종료 예정 시각까지 계속 진행하라.";
};

// 디자인 산출물 형식마다 더하는 지시. 형식과 상관없이 design.md는 늘 쓴다(디자인 단계의 산출물 참고).
const DESIGN_PROMPTS = {
    md: "화면마다 ASCII 와이어프레임을 `docs/autopilot/design.md`의 그 화면 절에 함께 그린다.",
    html: "`docs/autopilot/design/`에 화면마다 정적 HTML 와이어프레임 파일을 만들고 `index.html`에서 모든 화면을 열 수 있게 한다. 외부 리소스 없이 파일만으로 열려야 한다.",
    figma: "Figma MCP 도구로 화면을 그리고 `docs/autopilot/design.md`에 Figma 링크를 남긴다. Figma 도구를 쓸 수 없으면 HTML 와이어프레임(`docs/autopilot/design/`)으로 대신하고 그 사실을 design.md에 적는다.",
    image: "`codex exec`의 이미지 생성으로 화면 시안 이미지를 만들어 `docs/autopilot/design/`에 저장한다. Codex가 없거나 실패하면 그 이미지는 건너뛰고 HTML 와이어프레임으로 대신한다(실패를 회차 실패로 만들지 않는다)."
};
const PASS_SIGNAL = "첫 줄에 `pass`를 쓴";

// 단계마다 같은 틀(관점 · 읽을 것 · 산출물 · 회차당 작업 · 완료 기준 · 하지 않을 것 · 완료 신호)로 무엇을 어디까지 할지 정한다.
const getPhaseBrief = (runState) => {
    if (runState.phase === "plan") {
        return {
            role: "제품 기획자이자 테크 리드다. 개발자가 이 문서 하나만 보고 순서대로 만들 수 있게 쓴다.",
            read: "`docs/autopilot/brief.md`(있으면 가장 먼저 읽는다), <TASKS>의 만들 것, 저장소에 이미 있는 파일.",
            output: "`docs/autopilot/plan.md`를 다음 목차 그대로 쓴다. 1) 한 줄 요약 2) 목표와 측정 가능한 성공 기준 3) 사용자와 주요 시나리오 4) 기능 목록(필수 · 있으면 좋음으로 나누고 기능마다 완료 조건) 5) 화면(또는 명령 · API) 목록 6) 데이터 구조 7) 기술 선택과 이유(새 라이브러리(패키지) · 큰 구조 · 외부 API는 AUTOPILOT_POLICY.md가 허용한 범위 안에서) 8) 이번에 하지 않는 것 9) 개발 순서(작은 단위로 나누고 단위마다 검증 방법) 10) 위험과 가정.",
            perRound: "한 회차에 초안 전체를 쓴다. 돌려보낸 단계면 수정 요청한 부분을 고치고 나머지 절과 어긋나지 않게 맞춘다.",
            criteria: [
                "목차의 모든 절이 채워져 있다.",
                "필수 기능마다 확인할 수 있는 완료 조건이 있다.",
                "개발 순서가 필수 기능을 모두 덮고 단위마다 검증 방법이 있다.",
                "정해지지 않은 것은 묻지 않고(무인 실행이다) 합리적으로 정한 뒤 `가정`이라고 표시했다."
            ],
            avoid: "제품 코드 작성, 패키지 설치, 프로젝트 뼈대 생성."
        };
    }

    if (runState.phase === "design") {
        return {
            role: "프로덕트 디자이너다. 개발자가 화면마다 무엇을 어떻게 만들지 헷갈리지 않게 설계한다.",
            read: "`docs/autopilot/plan.md`의 사용자 시나리오 · 화면 목록 · 기술 선택.",
            output: `${DESIGN_PROMPTS[runState.designFormat]} 형식과 상관없이 \`docs/autopilot/design.md\`에 화면마다 목적 · 구성 요소 · 주요 동작 · 상태(빈 상태 · 로딩 · 오류 · 권한 없음), 화면 흐름, 공통 규칙(색 · 글자 · 간격 · 컴포넌트)을 정리한다.`,
            perRound: "화면 2~4개씩 설계한다. 모든 화면을 마친 회차에 화면 흐름과 공통 규칙을 점검해 맞춘다.",
            criteria: [
                "plan.md의 화면이 모두 있다.",
                "화면마다 빈 상태 · 로딩 · 오류 상태가 있다.",
                "화면 흐름이 plan.md의 주요 시나리오와 맞다.",
                "공통 규칙(색 · 글자 · 간격 · 컴포넌트)이 정해져 있다."
            ],
            avoid: "제품 코드 작성, plan.md에 없는 화면 추가(필요하면 plan.md를 먼저 고치고 이유를 적는다)."
        };
    }

    if (runState.phase === "build") {
        const isReturned = runState.qaRetries > 0 || runState.securityRetries > 0;

        return {
            role: "시니어 개발자다. 기획서의 개발 순서를 작은 단위로 하나씩 실제로 동작하게 만든다.",
            read: "`docs/autopilot/plan.md`의 개발 순서와 완료 조건, 디자인 산출물(`docs/autopilot/design.md` · `docs/autopilot/design/`), 진행 기록, 있으면 `docs/autopilot/qa.md` · `docs/autopilot/security.md`의 실패 항목.",
            output: "동작하는 코드와 자동 테스트. 저장소에 빌드 · 테스트 · 실행 방법이 아직 없으면 첫 회차에 프로젝트 뼈대와 함께 `CLAUDE.md`(실행 · 검증 명령, 폴더 구조, 코드 규칙. 개발이 끝난 뒤 유지 보수 모드가 이 파일을 지침으로 쓴다)와 `README.md`(설치 · 실행 방법)를 만든다.",
            perRound: `개발 순서에서 아직 끝나지 않은 다음 단위 1~2개. 단위마다 구현 → 테스트 → 실제 실행으로 확인 → commit → 진행 기록 갱신 순서를 지킨다.${
                isReturned ? " 이번 개발은 테스트/QA · 보안검토가 되돌린 것이다. 새 단위보다 `qa.md`의 실패 항목과 `security.md`의 고치지 못한 심각 · 높음 항목을 먼저 고친다." : ""
            }`,
            criteria: ["개발 순서의 모든 단위가 끝났다.", "빌드와 전체 테스트가 통과한다.", "필수 기능의 완료 조건을 실제로 실행해 확인했다.", "`README.md` · `CLAUDE.md`가 지금 코드와 맞다."],
            avoid: "plan.md에 없는 기능 추가(필요하면 plan.md를 먼저 고치고 이유를 적는다), 디자인과 다른 화면으로 임의 변경, 검증하지 않은 코드 commit."
        };
    }

    if (runState.phase === "qa") {
        return {
            role: "QA 엔지니어다. 사용자가 실제로 쓰는 방식대로 기능을 확인하고 깨지는 곳을 찾는다.",
            read: "`docs/autopilot/plan.md`의 기능별 완료 조건과 주요 시나리오, 디자인 산출물, `README.md`의 실행 방법.",
            output: "`docs/autopilot/qa.md`에 기능마다 확인 방법 · 결과(통과 · 실패) · 실패면 재현 절차를 표로 남긴다. 확인한 시나리오는 자동 테스트로 추가한다.",
            perRound: "기능 묶음 하나를 확인한다. 작은 문제는 바로 고치고 다시 확인한 뒤 commit한다.",
            criteria: ["필수 기능을 모두 확인했다.", "주요 시나리오가 처음부터 끝까지 통과한다.", "빈 입력 · 잘못된 입력 · 오류 상황을 확인했다.", "전체 테스트가 통과한다."],
            avoid: "새 기능 추가, 큰 리팩터링, 실패를 숨기려고 테스트를 지우거나 느슨하게 고치기.",
            signal: "첫 줄에 필수 기능과 주요 시나리오가 모두 통과했으면 `pass`, 고치지 못한 실패가 남았으면 `fail`을 쓴"
        };
    }

    return {
        role: "보안 엔지니어다. 공격자와 실수의 눈으로 배포 전의 코드와 설정을 점검한다.",
        read: "저장소의 코드 · 설정 · 커밋 이력, `docs/autopilot/plan.md`의 기술 선택과 데이터 구조.",
        output: "`docs/autopilot/security.md`에 발견 사항을 표로 남긴다(심각도: 심각 · 높음 · 중간 · 낮음, 위치, 설명, 조치: 고침 · 남김). 고칠 수 있는 문제는 바로 고치고 검증한 뒤 commit한다. 남긴 문제는 이유와 권장 조치를 적는다.",
        perRound: "아래 점검 목록을 차례로 확인하고, 한 회차에 확인한 만큼 기록과 수정을 마친다.",
        checks: [
            "비밀값: 코드 · 설정 파일 · `git log -p` 이력의 키 · 토큰 · 비밀번호",
            "라이브러리(패키지) 취약점: 프로젝트의 audit 명령(예: `npm audit`). 네트워크를 쓸 수 없으면 lockfile 검토로 대신하고 그 사실을 적는다",
            "입력 검증과 인젝션: SQL · 명령 · 경로 · XSS",
            "인증 · 권한 · 세션",
            "파일 업로드와 경로 처리",
            "오류 메시지 · 로그에 드러나는 민감정보",
            "웹이면 CORS와 보안 헤더",
            "기본 계정 · 디버그 설정 · 개발용 설정이 남았는지"
        ],
        criteria: ["점검 목록을 모두 확인하고 결과를 security.md에 적었다.", "고친 문제는 테스트나 실행으로 확인했다.", "남긴 문제마다 이유와 권장 조치가 있다."],
        avoid: "비밀값을 문서 · 로그 · commit 메시지에 옮겨 적기(위치만 적는다), 외부 서비스로 보내기를 허용받지 않은 채 외부 스캐너 · 서비스에 코드 보내기, 점검과 상관없는 기능 변경.",
        signal: "첫 줄에 고치지 못한 심각 · 높음 문제가 남았으면 `fail`, 없으면 `pass`(중간 · 낮음은 security.md에 기록만 하고 `pass`)를 쓴"
    };
};

// 사용자가 여러 AI의 안 중 하나를 골랐으면 이번 실행의 첫 일로 그 안을 정식 산출물로 확정한다.
const getAdoptionPrompt = (runState) => {
    if (!runState.adoption) {
        return "";
    }

    const { phase, picked, file } = runState.adoption;
    const label = PHASE_LABELS[phase];
    const providerLabel = PROVIDER_LABELS[picked];
    const commitMessage = `\`${runState.commitPrefix} ${label}: ${providerLabel} 안으로 확정\``;

    if (picked === PROVIDER_CLAUDE) {
        return `사용자가 [${label}]에서 Claude 안을 골랐다. 지금 단계의 일을 하기 전에 아직 commit하지 않은 \`${PROPOSALS_DIR}/\` 파일이 있으면 commit한다(${commitMessage}).`;
    }

    const adoption =
        phase === "plan"
            ? `지금 \`docs/autopilot/plan.md\`(Claude 안)를 \`${phaseUtil.getProposalPath("plan", PROVIDER_CLAUDE)}\`로 옮기고 \`${file}\`의 내용을 \`docs/autopilot/plan.md\`로 확정한다`
            : `지금 Claude의 디자인 산출물(\`docs/autopilot/design.md\`와 \`docs/autopilot/design/\`)을 \`${PROPOSALS_DIR}/design-claude/\`로 옮기고 \`${file}\`를 정식 디자인으로 확정한다(${
                  file.endsWith(".html") ? "`docs/autopilot/design/index.html`로 옮기고 `docs/autopilot/design.md`는 그 화면에 맞게 다시 쓴다" : "`docs/autopilot/design.md`로 옮긴다"
              })`;

    return `사용자가 [${label}]에서 ${providerLabel} 안을 골랐다. 지금 단계의 일을 하기 전에 먼저 ${adoption}. 남은 제안 · 검토 파일과 함께 commit한다(${commitMessage}). 이후 단계는 확정한 안을 따른다.`;
};

// 이 단계에 다른 AI도 안을 내면 서로 독립된 안이 되게 하고, 받은 안의 보관 commit과 교차검토를 지시한다.
const getBrainstormPrompt = (runState) => {
    if (!runState.brainstorm?.includes(runState.phase) || !runState.brainstormWith?.length) {
        return "";
    }

    const label = PHASE_LABELS[runState.phase];
    const reviewPath = phaseUtil.getReviewPath(runState.phase, PROVIDER_CLAUDE);
    const readyPrompts = Object.entries(runState.proposalReady || {}).map(([provider, file]) => {
        const providerLabel = PROVIDER_LABELS[provider];
        const reviewPrompt = runState.crossReview
            ? `네 산출물을 마친 뒤 \`${file}\`(${providerLabel} 안)를 읽고 \`${reviewPath}\`에 그 안의 빈자리 · 위험 · 더 나은 점을 항목마다 한두 줄로 쓴다. `
            : "";

        return `${reviewPrompt}\`${file}\`는 고치지 말고 그대로${runState.crossReview ? " 검토와 함께" : ""} commit한다(\`${runState.commitPrefix} ${label}: ${providerLabel} 안 보관\`).`;
    });

    return [`이 단계는 다른 AI도 따로 안을 내고 사용자가 안들을 나란히 보고 고른다. 네 산출물을 다 쓰기 전에는 \`${PROPOSALS_DIR}/\`를 열지 말고 독립적으로 쓴다.`, ...readyPrompts].join(" ");
};

// 신규 개발은 개선 정책 대신 지금 단계를 알려주고, 단계의 틀은 <PHASE> 블록으로 따로 준다.
const getPhasePrompt = (runState) => {
    const label = PHASE_LABELS[runState.phase];

    return [
        getAdoptionPrompt(runState),
        `이번 실행은 [신규 개발]이고 지금 단계는 [${label}]이다. 단계는 ${BUILD_PHASES.map((phase) => PHASE_LABELS[phase]).join(" → ")} 순서이며, 이 세션은 지금 단계의 일만 하고 아래 <PHASE>의 틀을 따른다.`,
        runState.isRevision ? `이 단계는 사용자가 산출물을 확인하고 다시 하라고 돌려보낸 것이다. <TASKS>의 수정 요청을 반영해 ${label} 산출물을 고친다.` : "",
        getBrainstormPrompt(runState)
    ]
        .filter(Boolean)
        .join(" ");
};

// 다른 AI에게 같은 단계의 독립된 안을 받는다. 읽기 전용으로 돌리므로 파일 대신 최종 답변으로 받는다.
const getProposalPrompt = (runState) => {
    const brief = getPhaseBrief(runState);
    const formatPrompt =
        runState.phase === "design"
            ? runState.designFormat === "html"
                ? "디자인은 모든 화면을 담은 HTML 문서 하나(외부 리소스 없이 파일 하나로 열리는)로 낸다. design.md에 쓸 화면 설명도 그 HTML 안에 함께 넣는다."
                : "디자인은 마크다운 문서 하나로 내고 화면마다 ASCII 와이어프레임을 넣는다."
            : "";

    return [
        `너는 ${brief.role}`,
        `이 저장소(${runState.projectDir})는 읽기만 할 수 있다. 파일을 만들거나 고치지 말고, 결과는 최종 답변으로만 낸다.`,
        `읽을 것: ${brief.read}`,
        // 사용자가 다른 AI의 기획안을 골랐으면 plan.md로 옮기기 전이라도 그 안을 따른다.
        runState.adoption?.phase === "plan" && runState.adoption.picked !== PROVIDER_CLAUDE ? `기획서는 \`docs/autopilot/plan.md\` 대신 사용자가 고른 \`${runState.adoption.file}\`를 따른다.` : "",
        `산출물: ${brief.output} 단, 파일에 쓰지 말고 그 문서 전체를 최종 답변으로 출력한다.`,
        formatPrompt,
        "완료 기준:",
        ...brief.criteria.map((criterion) => `- ${criterion}`),
        "인사 · 설명 · 코드 블록 표시 없이 문서 내용만 출력한다.",
        runState.tasks ? `<TASKS>\n${runState.tasks}\n</TASKS>` : ""
    ]
        .filter(Boolean)
        .join("\n");
};

// 교차검토: 다른 AI가 Claude의 산출물을 읽고 고칠 점만 짧게 낸다.
const getReviewPrompt = (runState) => {
    const target = runState.phase === "plan" ? "`docs/autopilot/plan.md`" : "`docs/autopilot/design.md`와 `docs/autopilot/design/`";

    return [
        `너는 ${PHASE_LABELS[runState.phase]} 검토자다. 이 저장소(${runState.projectDir})는 읽기만 할 수 있다. 파일을 만들거나 고치지 마라.`,
        `${target}(다른 AI가 쓴 안)를 읽고 빈자리 · 위험 · 더 나은 점을 항목마다 한두 줄로 쓴다. 칭찬은 빼고 고칠 것 위주로 10개 이내.`,
        "인사 · 설명 없이 마크다운 목록만 최종 답변으로 출력한다."
    ].join("\n");
};

const getPhaseBlock = (runState) => {
    const brief = getPhaseBrief(runState);

    return [
        "<PHASE>",
        `단계: ${PHASE_LABELS[runState.phase]} (${BUILD_PHASES.indexOf(runState.phase) + 1}/${BUILD_PHASES.length})`,
        `관점: ${brief.role}`,
        `읽을 것: ${brief.read}`,
        `산출물: ${brief.output}`,
        `회차당 작업: ${brief.perRound}`,
        ...(brief.checks || []).map((check) => `- ${check}`),
        "완료 기준:",
        ...brief.criteria.map((criterion) => `- ${criterion}`),
        `하지 않을 것: ${brief.avoid}`,
        `완료 신호: 이 단계의 일을 모두 마치고 산출물을 commit하고 진행 기록을 갱신했으면 ${brief.signal || PASS_SIGNAL} 파일 \`${runState.phaseDoneRelPath}\` 를 만들고 세션을 끝낸다. 단계의 일이 남아 있으면 이 파일을 만들지 않는다. 만드는 순간 다음 단계로 넘어간다.`,
        "</PHASE>"
    ].join("\n");
};

const getTasksPrompt = (tasks, mode) => {
    if (!tasks) {
        return "이번 실행에는 소유자가 예약한 작업이 없다.";
    }

    if (mode === MODE_BUILD) {
        return "아래 <TASKS>에 소유자가 적은 만들 것(또는 돌려보낸 단계의 수정 요청)이 있다. 모든 단계는 이 내용을 기준으로 한다.";
    }

    return "소유자가 예약한 작업이 아래 <TASKS>에 있다. 작성된 순서대로 일반 작업보다 먼저 처리하되, 진행 기록에 이미 끝낸 것으로 남은 작업은 건너뛴다.";
};

// 작업 프로젝트와 연결 저장소는 각각 독립된 Git 저장소다. 브랜치·접두어는 공통이고, commit과 push는 저장소마다 따로 한다.
const getLinkedReposPrompt = (runState) => {
    const linkedRepos = runState.repos.filter((repo) => repo.isLinked);

    if (!linkedRepos.length) {
        return "";
    }

    return [
        "이번 실행에는 작업 프로젝트와 함께 다루는 연결 저장소가 있다. 각각 독립된 Git 저장소이며, 작업 범위는 프로젝트 루트와 아래 연결 저장소 루트의 내부 전부다.",
        `연결 저장소: ${linkedRepos.map((repo) => `${repo.name} (${repo.dir})`).join(", ")}.`,
        `모든 저장소에서 \`${runState.workBranch}\` 브랜치로 작업하고, 변경한 저장소마다 따로 commit하되 한 commit에 여러 저장소를 섞지 않는다. 접두어 \`${runState.commitPrefix}\`는 모든 저장소에 똑같이 쓴다.`,
        `commit한 저장소는 \`git push origin ${runState.workBranch}\`로 작업 브랜치만 push한다(upstream이 없으면 \`-u\`를 쓴다). main·master와 다른 브랜치로 push하거나 force push하지 않는다.`,
        "원격이 없거나 push가 실패해도 우회하거나 작업을 멈추지 말고 진행 기록에 남겨 다음 회차가 다시 시도하게 한다.",
        "작업 전에 각 연결 저장소 루트의 `CLAUDE.md`를 직접 읽고(자동으로 로드되지 않을 수 있다), 그 저장소의 파일을 고치거나 검증할 때는 그 저장소의 규칙·코드 스타일·보호할 데이터·테스트 명령을 따른다. 저장소마다 규칙이 다르면 섞어 쓰지 않고 검증도 저장소별로 따로 돌린다.",
        "백엔드·프론트처럼 저장소가 서로 맞물리는 변경(API 계약 등)은 한 작업으로 보고 같은 세션에서 양쪽을 함께 고쳐 어긋나지 않게 한다.",
        `\`.autopilot/\`은 작업 프로젝트에만 있다. 연결 저장소의 파일을 지울 때는 작업 프로젝트의 \`.autopilot/recycle_bin/<저장소 이름>/\` 아래로 원래 구조를 유지해 옮긴다.`
    ].join(" ");
};

const getProgressCleanupPrompt = (progressFile, archivePath) => {
    return [
        `작업 시작 전에 \`${progressFile}\` 를 정리하라. ${PROGRESS_MAX_LINES}줄을 초과한 원본은 \`${archivePath}\` 에 보관되어 있다.`,
        `현재 상태, 미완료·남은 작업, 검증 실패와 주의사항, 다음 작업은 빠짐없이 유지하고 완료 작업은 최근 5건만 한 줄씩 남기며, 서술을 간결하게 줄여 전체를 ${PROGRESS_TARGET_LINES}줄 안팎으로 만들어라.`,
        "본문에 보관본 경로를 명시하고 판단이 어려운 내용은 유지하라. 줄을 기계적으로 잘라내거나 파일을 비우지 마라."
    ].join(" ");
};

const getRoundPrompt = (runState, round, remainingMinutes, progressCleanupPrompt, maxTasks) => {
    const roundPrompt = [
        "CLAUDE.md를 기본 프로젝트 지침으로 사용하고, 아래 <AUTOPILOT.md>의 작업 지침에 따라 자율 개발을 수행하라.",
        "중요사항!: 아래 <AUTOPILOT_POLICY.md>의 모든 금지사항과 안전정책을 반드시 최우선으로 준수하라.",
        `정책의 작업 범위인 프로젝트 루트는 ${runState.projectDir} 이다.`,
        getLinkedReposPrompt(runState),
        getTasksPrompt(runState.tasks, runState.mode),
        `진행 기록 \`${runState.progressFile}\` 를 읽어 이전 상태와 다음 작업을 이어받아라(파일이 없으면 새로 생성하라). 이 파일은 프로젝트 밖의 앱 데이터 폴더에 있어 git 저장소에 포함되지 않으므로 commit하지 않는다.`,
        runState.mode === MODE_BUILD ? getPhasePrompt(runState) : getPolicyPrompt(runState.policy, runState.todoDoneRelPath),
        progressCleanupPrompt,
        `이 세션은 AutoPilot ${round}회차이고 전체 종료 예정 시각은 ${dateUtil.getDatetimeString(runState.deadline)}, 남은 시간은 약 ${remainingMinutes}분이다.`,
        runState.mode === MODE_BUILD ? "" : `작업은 최대 ${maxTasks}건, 규모가 크면 1건만 처리하라.`,
        `작업을 완료·검증·commit 하고 \`${runState.progressFile}\` 를 갱신한 뒤 세션을 끝내라.`,
        "AutoPilot 앱이 새 컨텍스트로 다음 회차를 자동 실행하므로 남은 작업이 있다는 이유로 세션을 붙잡지 마라.",
        "남은 시간이 한 작업을 안전하게 마치기에 부족하면 새 작업을 시작하지 말고 진행 중인 것만 정리·기록하고 즉시 종료하라."
    ]
        .filter(Boolean)
        .join(" ");
    const tasksBlock = runState.tasks ? `<TASKS>\n${runState.tasks}\n</TASKS>\n\n` : "";
    const phaseBlock = runState.mode === MODE_BUILD ? `${getPhaseBlock(runState)}\n\n` : "";

    return `${roundPrompt}\n\n${tasksBlock}${phaseBlock}<AUTOPILOT.md>\n${getAutopilotGuide(runState.commitPrefix, runState.mode)}\n</AUTOPILOT.md>\n\n<AUTOPILOT_POLICY.md>\n${getAutopilotPolicy(runState.workBranch, runState.mode === MODE_BUILD ? runState.allow : null)}\n</AUTOPILOT_POLICY.md>`;
};

export default { getProgressCleanupPrompt, getRoundPrompt, getProposalPrompt, getReviewPrompt };

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
    // 테스트/QA · 보안검토가 개발로 되돌린 뒤의 개발 · 테스트/QA는 앞선 결과 문서가 있으므로 실패 항목부터 본다.
    const isReturned = runState.qaRetries > 0 || runState.securityRetries > 0;

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
            perRound:
                "공통 규칙(색 · 글자 · 간격 · 컴포넌트)을 먼저 정하고 그 규칙으로 화면을 설계한다. 한 회차에 모든 화면과 화면 흐름을 마치는 것을 목표로 하고, 화면이 많아 남은 시간 안에 다 못 하면 마친 화면까지 commit하고 남은 화면은 다음 회차가 이어 간다.",
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
            perRound: `기능 묶음 하나를 확인한다. 작은 문제는 바로 고치고 다시 확인한 뒤 commit한다.${
                isReturned
                    ? " 이번 테스트/QA는 개발로 되돌려 고친 뒤 다시 하는 것이다. 처음부터 묶음별로 다시 하지 말고 `qa.md`의 실패 항목과 그 수정이 닿은 기능을 먼저 다시 확인한다. 이미 통과한 나머지 기능은 전체 테스트와 주요 시나리오를 한 번 실행해 확인하고, `qa.md`의 결과를 지금 상태로 고친다."
                    : ""
            }`,
            criteria: ["필수 기능을 모두 확인했다.", "주요 시나리오가 처음부터 끝까지 통과한다.", "빈 입력 · 잘못된 입력 · 오류 상황을 확인했다.", "전체 테스트가 통과한다."],
            avoid: "새 기능 추가, 큰 리팩터링, 실패를 숨기려고 테스트를 지우거나 느슨하게 고치기.",
            signal: "첫 줄에 필수 기능과 주요 시나리오가 모두 통과했으면 `pass`, 고치지 못한 실패가 남았으면 `fail`을 쓴"
        };
    }

    return {
        role: "보안 엔지니어다. 공격자와 실수의 눈으로 배포 전의 코드와 설정을 점검한다.",
        read: "저장소의 코드 · 설정 · 커밋 이력, `docs/autopilot/plan.md`의 기술 선택과 데이터 구조.",
        output: "`docs/autopilot/security.md`에 발견 사항을 표로 남긴다(심각도: 심각 · 높음 · 중간 · 낮음, 위치, 설명, 조치: 고침 · 남김). 고칠 수 있는 문제는 바로 고치고 검증한 뒤 commit한다. 남긴 문제는 이유와 권장 조치를 적는다.",
        perRound: `아래 점검 목록을 차례로 확인하고, 한 회차에 확인한 만큼 기록과 수정을 마친다.${
            runState.securityRetries > 0
                ? " 이번 보안검토는 개발로 되돌려 고친 뒤 다시 하는 것이다. `security.md`에서 `남김`으로 둔 심각 · 높음 항목이 고쳐졌는지 먼저 확인하고 조치를 고친다. 이어서 지난 보안검토 뒤에 바뀐 코드(`git log`로 확인)만 점검 목록으로 다시 보고, 바뀌지 않은 곳의 기록은 그대로 둔다."
                : ""
        }`,
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

// 단계의 정식 산출물. 협의 정리와 쟁점 확정이 고칠 대상이다.
const getArtefactText = (phase) => {
    return phase === "plan" ? "`docs/autopilot/plan.md`" : "디자인 산출물(`docs/autopilot/design.md`와 `docs/autopilot/design/`)";
};

const getChoiceText = (choices) => {
    return choices.map((choice, index) => `${index + 1}) ${choice.title} → ${PROVIDER_LABELS[choice.side]} 쪽: ${choice.position}`).join(" ");
};

// 협의를 마친 단계를 사용자가 확인했으면 이번 실행의 첫 일로 쟁점마다 고른 입장을 합의안에 확정한다.
const getDebateAdoptionPrompt = (runState) => {
    const { phase, choices } = runState.adoption;
    const label = PHASE_LABELS[phase];

    if (!choices.length) {
        return `사용자가 [${label}] 협의의 합의안을 확인했다. 지금 단계의 일을 하기 전에 아직 commit하지 않은 \`${PROPOSALS_DIR}/\` 파일이 있으면 commit한다(\`${runState.commitPrefix} ${label}: 합의안 확정\`).`;
    }

    return [
        `사용자가 [${label}] 협의에서 못 맞춘 쟁점을 정했다. 지금 단계의 일을 하기 전에 먼저 ${getArtefactText(phase)}에서 쟁점으로 표시한 부분을 아래 고른 입장으로 확정하고 쟁점 표시를 지운다. ${getChoiceText(choices)}`,
        `아직 commit하지 않은 \`${PROPOSALS_DIR}/\` 파일과 함께 commit한다(\`${runState.commitPrefix} ${label}: 쟁점 확정\`). 이후 단계는 확정한 안을 따른다.`
    ].join(" ");
};

// 사용자가 여러 AI의 안 중 하나를 골랐으면 이번 실행의 첫 일로 그 안을 정식 산출물로 확정한다.
const getAdoptionPrompt = (runState) => {
    if (!runState.adoption) {
        return "";
    }

    if (runState.adoption.choices) {
        return getDebateAdoptionPrompt(runState);
    }

    const { phase, picked, file, main } = runState.adoption;
    const label = PHASE_LABELS[phase];
    const providerLabel = PROVIDER_LABELS[picked];
    const mainLabel = PROVIDER_LABELS[main];
    const commitMessage = `\`${runState.commitPrefix} ${label}: ${providerLabel} 안으로 확정\``;

    if (picked === main) {
        return `사용자가 [${label}]에서 ${mainLabel} 안을 골랐다. 지금 단계의 일을 하기 전에 아직 commit하지 않은 \`${PROPOSALS_DIR}/\` 파일이 있으면 commit한다(${commitMessage}).`;
    }

    const designTarget = file.endsWith(".html") ? "`docs/autopilot/design/index.html`로 옮기고 `docs/autopilot/design.md`는 그 화면에 맞게 다시 쓴다" : "`docs/autopilot/design.md`로 옮긴다";
    const adoption =
        phase === "plan"
            ? `지금 \`docs/autopilot/plan.md\`(${mainLabel} 안)를 \`${phaseUtil.getProposalPath("plan", main)}\`로 옮기고 \`${file}\`의 내용을 \`docs/autopilot/plan.md\`로 확정한다`
            : `지금 ${mainLabel}의 디자인 산출물(\`docs/autopilot/design.md\`와 \`docs/autopilot/design/\`)을 \`${PROPOSALS_DIR}/design-${main}/\`로 옮기고 \`${file}\`를 정식 디자인으로 확정한다(${designTarget})`;

    return `사용자가 [${label}]에서 ${providerLabel} 안을 골랐다. 지금 단계의 일을 하기 전에 먼저 ${adoption}. 남은 제안 · 검토 파일과 함께 commit한다(${commitMessage}). 이후 단계는 확정한 안을 따른다.`;
};

// 이 단계에 다른 AI도 안을 내면 서로 독립된 안이 되게 하고, 받은 안의 보관 commit과 교차검토를 지시한다.
const getBrainstormPrompt = (runState) => {
    const { main, assistant } = runState.phaseAgents ?? {};

    if (!runState.brainstorm?.includes(runState.phase) || !assistant) {
        return "";
    }

    const label = PHASE_LABELS[runState.phase];
    const reviewPath = phaseUtil.getReviewPath(runState.phase, main);

    // 협의 단계는 앱이 협의를 진행하고 다음 회차가 결과를 정리한다. 그 전까지는 독립된 안을 쓰는 것만 한다.
    if (runState.debate?.includes(runState.phase)) {
        return `이 단계는 다른 AI도 따로 안을 내고, 네 산출물을 마치면 앱이 두 AI의 협의를 진행한다. 네 산출물을 다 쓰기 전에는 \`${PROPOSALS_DIR}/\`를 열지 말고 독립적으로 쓴다.`;
    }

    const readyPrompts = Object.entries(runState.proposalReady || {}).map(([provider, file]) => {
        const providerLabel = PROVIDER_LABELS[provider];
        const reviewPrompt = runState.crossReview
            ? `네 산출물을 마친 뒤 \`${file}\`(${providerLabel} 안)를 읽고 \`${reviewPath}\`에 그 안의 빈자리 · 위험 · 더 나은 점을 항목마다 한두 줄로 쓴다. `
            : "";

        return `${reviewPrompt}\`${file}\`는 고치지 말고 그대로${runState.crossReview ? " 검토와 함께" : ""} commit한다(\`${runState.commitPrefix} ${label}: ${providerLabel} 안 보관\`).`;
    });

    return [`이 단계는 다른 AI도 따로 안을 내고 사용자가 안들을 나란히 보고 고른다. 네 산출물을 다 쓰기 전에는 \`${PROPOSALS_DIR}/\`를 열지 말고 독립적으로 쓴다.`, ...readyPrompts].join(" ");
};

// 협의를 마친 단계의 정리 회차. 합의안을 쓰고 못 맞춘 쟁점만 파일로 남긴다(엔진이 PHASE.json으로 옮겨 사용자에게 보인다).
const getDebateSynthesisPrompt = (runState) => {
    if (runState.debateStage !== "synthesis") {
        return "";
    }

    const label = PHASE_LABELS[runState.phase];
    const assistantFile = runState.proposalReady?.[runState.phaseAgents.assistant];
    const disputesPath = phaseUtil.getDisputesPath(runState.phase);
    const retry = runState.isDisputesRetry
        ? `앞 회차가 남긴 \`${disputesPath}\`를 JSON 배열로 읽을 수 없었다(파일이 없거나 형식이 틀림). 아래에서 이미 한 일은 다시 하지 말고 쟁점 파일을 형식대로 다시 써서 commit한 뒤 완료 신호를 남긴다.`
        : "";

    return [
        `[${label}] 협의가 끝났다. 엔진이 두 AI의 협의 기록을 \`${phaseUtil.getDebatePath(runState.phase)}\`에 남겼다. 이번 회차는 <PHASE>의 산출물을 새로 쓰지 않고 협의 결과만 정리한다.`,
        retry,
        `1) 협의 기록과 두 안(${getArtefactText(runState.phase)}, \`${assistantFile}\`)을 읽고 두 AI가 합의한 내용을 반영해 ${getArtefactText(runState.phase)}을 합의안으로 고친다.`,
        `2) 끝까지 맞추지 못한 쟁점만 \`${disputesPath}\`에 JSON 배열로 쓴다. 형식: [{"title": "쟁점 제목", "claude": "Claude 쪽 입장과 이유", "codex": "Codex 쪽 입장과 이유"}]. 쟁점이 없으면 []를 쓴다. 쓴 뒤 JSON으로 읽히는지 확인한다. 합의안에서 쟁점 부분은 어느 쪽으로도 확정하지 말고 쟁점이라고 표시만 해 둔다(사용자가 고른다).`,
        `3) 합의안 · 협의 기록 · 쟁점 파일 · \`${assistantFile}\`를 함께 commit한다(\`${runState.commitPrefix} ${label}: 협의 결과\`). 그다음 <PHASE>의 완료 신호를 남긴다.`
    ]
        .filter(Boolean)
        .join(" ");
};

const DEBATE_FORMAT =
    '답은 인사 · 설명 · 코드 블록 없이 이 JSON 하나만 쓴다: {"message": "1인칭 해요체로 300자 이내의 발언", "agree": ["동의하는 점과 근거"], "disagree": [{"point": "반대하는 점", "reason": "이유"}], "improve": ["더 개선할 점"], "changes": ["네 안에서 바꾸기로 한 점"], "consensus": false}';

// 협의의 규칙과 답의 형식. 근거 없이 상대를 따라가지 않게 한다.
const DEBATE_RULES = [
    "규칙: 동의하는 점에는 근거를, 반대하는 점에는 이유를 반드시 적는다. 근거 없이 상대 주장을 받아들이거나 양보하지 않는다. 같은 생각이면 억지로 반대하지 않는다.",
    "안의 완성도에 영향을 주는 개선점이 남았으면 improve에 적는다. 표현 · 취향 차이 같은 사소한 것은 적지 않는다. 상대의 개선점은 받아들여 changes에 적거나 이유를 들어 반대한다.",
    "반대할 점이나 개선점이 하나라도 남았으면 consensus는 false다. 둘 다 더 고칠 것이 없다고 할 때까지 이어지고, 협의가 끝나면 사용자는 합의안과 못 맞춘 쟁점만 본다.",
    DEBATE_FORMAT
].join("\n");

const MAX_DEBATE_DOC_LENGTH = 60000;

const getTurnBody = (turn) => {
    return { message: turn.message, agree: turn.agree, disagree: turn.disagree, improve: turn.improve, changes: turn.changes, consensus: turn.consensus };
};

const getDebateDoc = (title, text) => {
    const body = text.length > MAX_DEBATE_DOC_LENGTH ? `${text.slice(0, MAX_DEBATE_DOC_LENGTH)}\n…(이하 생략)` : text;

    return `<${title}>\n${body}\n</${title}>`;
};

// 협의에서 그 AI의 첫 호출. 먼저 말하는 메인은 상대 안을 네 안과 비교해 말하고, 보조는 메인의 발언(lastTurn)에 답한다.
// docs는 { claude, codex } 각 AI의 안이다. Claude는 도구 없이 답하므로 두 안을 본문으로 받고, Codex는 읽기 전용으로 저장소의 파일을 직접 읽는다.
// transcript는 대화를 이을 수 없을 때(Codex의 세션 아이디를 못 찾음) 지금까지 주고받은 말을 다시 보내는 데 쓴다.
const getDebateOpeningPrompt = (runState, provider, { docs = {}, lastTurn = null, transcript = [] } = {}) => {
    const label = PHASE_LABELS[runState.phase];
    const { main, assistant } = runState.phaseAgents;
    const assistantFile = runState.proposalReady?.[assistant];
    const opponentLabel = PROVIDER_LABELS[phaseUtil.getOtherProvider(provider)];
    const intro = `너는 [${label}] 협의에 참여한 ${PROVIDER_LABELS[provider]}다. 같은 만들 것으로 ${PROVIDER_LABELS[main]}는 ${getArtefactText(runState.phase)}를, ${PROVIDER_LABELS[assistant]}는 \`${assistantFile}\`를 따로 썼다. 두 AI가 최대 ${runState.debateTurns}번 주고받으며 더 나은 안을 찾는다.`;
    const task = lastTurn ? `아래 ${opponentLabel}의 발언에 답한다.` : `먼저 ${opponentLabel} 안을 네 안과 비교해 의견을 말한다.`;
    const history = [
        transcript.length ? `지금까지 주고받은 말:\n${transcript.map((turn) => `${PROVIDER_LABELS[turn.provider]}: ${JSON.stringify(getTurnBody(turn))}`).join("\n")}` : "",
        lastTurn ? `${opponentLabel}의 발언: ${JSON.stringify(getTurnBody(lastTurn))}` : ""
    ];

    if (provider === PROVIDER_CLAUDE) {
        return [
            intro,
            task,
            DEBATE_RULES,
            getProposalScopePrompt(runState),
            runState.tasks ? `<TASKS>\n${runState.tasks}\n</TASKS>` : "",
            getDebateDoc("CLAUDE_안", docs.claude),
            getDebateDoc("CODEX_안", docs.codex),
            ...history
        ]
            .filter(Boolean)
            .join("\n\n");
    }

    // 협의는 안을 낸 세션과 다른 새 세션이고 <TASKS>는 저장소 파일이 아니므로 Codex에도 직접 준다.
    return [
        intro,
        `이 저장소(${runState.projectDir})는 읽기만 할 수 있다. 파일을 만들거나 고치지 않는다. 두 안을 읽고 ${task}`,
        DEBATE_RULES,
        getProposalScopePrompt(runState),
        runState.tasks ? `<TASKS>\n${runState.tasks}\n</TASKS>` : "",
        ...history
    ]
        .filter(Boolean)
        .join("\n\n");
};

// 이어지는 발언. 상대의 마지막 발언을 전하고 몇 번째인지 알린다.
const getDebateReplyPrompt = (runState, otherTurn, exchange) => {
    const lastPrompt = exchange === runState.debateTurns ? " 이번이 마지막 주고받기다. 남은 반대는 쟁점으로 사용자에게 넘어간다." : "";

    return [`${PROVIDER_LABELS[otherTurn.provider]}의 답: ${JSON.stringify(getTurnBody(otherTurn))}`, `지금은 ${exchange}/${runState.debateTurns}번째 주고받기다.${lastPrompt}`, DEBATE_RULES].join(
        "\n\n"
    );
};

// 답을 JSON으로 읽지 못했을 때 같은 대화에서 형식만 고쳐 다시 받는다.
const getDebateFormatPrompt = () => {
    return `방금 답은 정해진 JSON으로 읽을 수 없었다. 발언 내용은 그대로 두고 형식만 고쳐 다시 답한다. 문자열 안의 큰따옴표는 \\"로 쓴다.\n${DEBATE_FORMAT}`;
};

// 신규 개발은 개선 정책 대신 지금 단계를 알려주고, 단계의 틀은 <PHASE> 블록으로 따로 준다.
const getPhasePrompt = (runState) => {
    const label = PHASE_LABELS[runState.phase];

    return [
        getAdoptionPrompt(runState),
        getDebateSynthesisPrompt(runState),
        `이번 실행은 [신규 개발]이고 지금 단계는 [${label}]이다. 단계는 ${BUILD_PHASES.map((phase) => PHASE_LABELS[phase]).join(" → ")} 순서이며, 이 세션은 지금 단계의 일만 하고 아래 <PHASE>의 틀을 따른다.`,
        runState.isRevision ? `이 단계는 사용자가 산출물을 확인하고 다시 하라고 돌려보낸 것이다. <TASKS>의 수정 요청을 반영해 ${label} 산출물을 고친다.` : "",
        runState.debateStage === "synthesis" ? "" : getBrainstormPrompt(runState)
    ]
        .filter(Boolean)
        .join(" ");
};

// 디자인 안은 파일 하나로 받으므로 HTML이 아니면 마크다운으로 낸다.
const getProposalFormatPrompt = (runState) => {
    if (runState.phase !== "design") {
        return "";
    }

    return runState.designFormat === "html"
        ? "디자인은 모든 화면을 담은 HTML 문서 하나(외부 리소스 없이 파일 하나로 열리는)로 낸다. design.md에 쓸 화면 설명도 그 HTML 안에 함께 넣는다."
        : "디자인은 마크다운 문서 하나로 내고 화면마다 ASCII 와이어프레임을 넣는다.";
};

const ALLOW_SCOPES = { deps: "새 라이브러리(패키지) 추가", large: "새 폴더 구조 · Framework 선택 같은 큰 구조", "external-api": "외부 API 호출" };

// 안을 내거나 협의하는 AI는 정책 문서를 받지 않으므로 기획서의 기술 선택이 기댈 허용 범위를 직접 알린다.
const getProposalScopePrompt = (runState) => {
    if (runState.phase !== "plan") {
        return "";
    }

    const keys = Object.keys(ALLOW_SCOPES);
    const allowed = keys.filter((key) => runState.allow.includes(key)).map((key) => ALLOW_SCOPES[key]);
    const denied = keys.filter((key) => !runState.allow.includes(key)).map((key) => ALLOW_SCOPES[key]);

    return [
        "기술 선택의 허용 범위(AUTOPILOT_POLICY.md)는 이번 실행에서 이렇다.",
        allowed.length ? `허용함: ${allowed.join(", ")}.` : "",
        denied.length ? `허용하지 않음: ${denied.join(", ")}. 허용하지 않은 것은 꼭 필요한 경우가 아니면 기획에 넣지 않는다.` : ""
    ]
        .filter(Boolean)
        .join(" ");
};

// 디자인 안은 사용자가 고른 기획을 메인의 첫 회차가 plan.md에 확정하기 전에 받으므로 고른 내용을 직접 알린다.
const getPlanAdoptionPrompt = (adoption) => {
    if (adoption?.phase !== "plan") {
        return "";
    }

    if (adoption.choices) {
        return adoption.choices.length ? `\`docs/autopilot/plan.md\`에서 쟁점으로 표시한 부분은 사용자가 아래 입장으로 정했다(plan.md에는 아직 반영 전이다). ${getChoiceText(adoption.choices)}` : "";
    }

    return adoption.picked === adoption.main ? "" : `기획서는 \`docs/autopilot/plan.md\` 대신 사용자가 고른 \`${adoption.file}\`를 따른다.`;
};

// 다른 AI에게 같은 단계의 독립된 안을 받는다. 읽기 전용으로 돌리므로 파일 대신 최종 답변으로 받는다.
const getProposalPrompt = (runState) => {
    const brief = getPhaseBrief(runState);

    return [
        `너는 ${brief.role}`,
        `이 저장소(${runState.projectDir})는 읽기만 할 수 있다. 파일을 만들거나 고치지 말고, 결과는 최종 답변으로만 낸다.`,
        `읽을 것: ${brief.read}`,
        getPlanAdoptionPrompt(runState.adoption),
        `산출물: ${brief.output} 단, 파일에 쓰지 말고 그 문서 전체를 최종 답변으로 출력한다.`,
        getProposalScopePrompt(runState),
        getProposalFormatPrompt(runState),
        "완료 기준:",
        ...brief.criteria.map((criterion) => `- ${criterion}`),
        "인사 · 설명 · 코드 블록 표시 없이 문서 내용만 출력한다.",
        runState.tasks ? `<TASKS>\n${runState.tasks}\n</TASKS>` : ""
    ]
        .filter(Boolean)
        .join("\n");
};

// 교차검토: 보조가 메인의 산출물을 읽고 고칠 점만 짧게 낸다. 새 세션이라 빈자리를 가릴 만들 것과 허용 범위를 직접 준다.
const getReviewPrompt = (runState) => {
    const target = runState.phase === "plan" ? "`docs/autopilot/plan.md`" : "`docs/autopilot/design.md`와 `docs/autopilot/design/`";

    return [
        `너는 ${PHASE_LABELS[runState.phase]} 검토자다. 이 저장소(${runState.projectDir})는 읽기만 할 수 있다. 파일을 만들거나 고치지 마라.`,
        `${target}(다른 AI가 쓴 안)를 읽고 빈자리 · 위험 · 더 나은 점을 항목마다 한두 줄로 쓴다. 칭찬은 빼고 고칠 것 위주로 10개 이내.`,
        getProposalScopePrompt(runState),
        "인사 · 설명 없이 마크다운 목록만 최종 답변으로 출력한다.",
        runState.tasks ? `<TASKS>\n${runState.tasks}\n</TASKS>` : ""
    ]
        .filter(Boolean)
        .join("\n");
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

// runner가 codex면 CLAUDE.md가 세션에 자동으로 로드되지 않으므로 직접 읽게 한다.
const getRoundPrompt = (runState, round, remainingMinutes, progressCleanupPrompt, maxTasks, runner = PROVIDER_CLAUDE) => {
    const roundPrompt = [
        runner === PROVIDER_CLAUDE
            ? "CLAUDE.md를 기본 프로젝트 지침으로 사용하고, 아래 <AUTOPILOT.md>의 작업 지침에 따라 자율 개발을 수행하라."
            : "작업 전에 프로젝트 루트의 `CLAUDE.md`를 직접 읽어(이 세션에는 자동으로 로드되지 않는다) 기본 프로젝트 지침으로 사용하고, 아래 <AUTOPILOT.md>의 작업 지침에 따라 자율 개발을 수행하라.",
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

export default { getProgressCleanupPrompt, getRoundPrompt, getProposalPrompt, getReviewPrompt, getDebateOpeningPrompt, getDebateReplyPrompt, getDebateFormatPrompt };

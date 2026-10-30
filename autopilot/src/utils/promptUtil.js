import { MODE_BUILD, PHASE_LABELS, POLICY_TODO, PROGRESS_MAX_LINES, PROGRESS_TARGET_LINES } from "./config.js";
import dateUtil from "./dateUtil.js";
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

const DESIGN_PROMPTS = {
    md: "`docs/autopilot/design.md`에 화면마다 구성 · 흐름 · 상태(빈 상태 · 오류 포함)를 글과 ASCII 와이어프레임으로 정리한다.",
    html: "`docs/autopilot/design/`에 화면마다 정적 HTML 와이어프레임 파일을 만들고 `index.html`에서 모든 화면을 열 수 있게 한다. 외부 리소스 없이 파일만으로 열려야 한다.",
    figma: "Figma MCP 도구로 화면을 그리고 `docs/autopilot/design.md`에 Figma 링크와 화면 설명을 남긴다. Figma 도구를 쓸 수 없으면 HTML 와이어프레임(`docs/autopilot/design/`)으로 대신하고 그 사실을 design.md에 적는다.",
    image: "`codex exec`의 이미지 생성으로 화면 시안 이미지를 만들어 `docs/autopilot/design/`에 저장하고 `docs/autopilot/design.md`에 설명을 남긴다. Codex가 없거나 실패하면 그 이미지는 건너뛰고 HTML 와이어프레임으로 대신한다(실패를 회차 실패로 만들지 않는다)."
};

const getPhaseWorkPrompt = (runState) => {
    if (runState.phase === "plan") {
        return "<TASKS>의 만들 것을 바탕으로 기획서 `docs/autopilot/plan.md`를 쓴다. 목표, 사용자, 화면(또는 기능) 목록, 기술 선택과 이유, 데이터 구조, 이번에 하지 않는 것, 개발 순서를 담는다. 이 단계에서는 제품 코드를 쓰지 않는다.";
    }

    if (runState.phase === "design") {
        return `\`docs/autopilot/plan.md\`를 따라 화면을 설계한다. ${DESIGN_PROMPTS[runState.designFormat]} 이 단계에서는 제품 코드를 쓰지 않는다.`;
    }

    if (runState.phase === "build") {
        const qaPrompt = runState.qaRetries > 0 ? " 테스트/QA에서 돌아온 단계이므로 `docs/autopilot/qa.md`에 남은 실패 항목부터 고친다." : "";

        return `\`docs/autopilot/plan.md\`의 개발 순서와 디자인 산출물(\`docs/autopilot/design*\`)을 따라 코드를 짠다. 작업 단위로 검증하고 commit한다.${qaPrompt} 기획서의 모든 항목을 구현하고 검증했을 때만 단계를 마친다.`;
    }

    return "기획서의 기능을 하나씩 실제로 실행 · 테스트해 확인하고 결과를 `docs/autopilot/qa.md`에 남긴다(확인한 항목, 통과 · 실패, 재현 방법). 테스트가 없으면 만든다. 작은 문제는 바로 고치고 commit한다.";
};

// 신규 개발은 개선 정책 대신 지금 단계의 일과 단계 완료 신호를 알려준다.
const getPhasePrompt = (runState) => {
    const label = PHASE_LABELS[runState.phase];
    const resultPrompt = runState.phase === "qa" ? "첫 줄에 확인한 기능이 모두 통과했으면 `pass`, 고치지 못한 실패가 남았으면 `fail`을 쓴" : "첫 줄에 `pass`를 쓴";

    return [
        `이번 실행은 [신규 개발]이고 지금 단계는 [${label}]이다. 단계는 기획 → 디자인 → 개발 → 테스트/QA 순서이며, 이 세션은 지금 단계의 일만 한다.`,
        runState.isRevision ? `이 단계는 사용자가 산출물을 확인하고 다시 하라고 돌려보낸 것이다. <TASKS>의 수정 요청을 반영해 ${label} 산출물을 고친다.` : "",
        getPhaseWorkPrompt(runState),
        `이 단계의 일을 모두 마치고 산출물을 commit하고 진행 기록을 갱신했으면 ${resultPrompt} 파일 \`${runState.phaseDoneRelPath}\` 를 만들고 세션을 끝내라.`,
        "단계의 일이 남아 있으면 이 파일을 만들지 마라. 만드는 순간 다음 단계로 넘어간다."
    ]
        .filter(Boolean)
        .join(" ");
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
        `작업은 최대 ${maxTasks}건, 규모가 크면 1건만 처리하라.`,
        `작업을 완료·검증·commit 하고 \`${runState.progressFile}\` 를 갱신한 뒤 세션을 끝내라.`,
        "AutoPilot 앱이 새 컨텍스트로 다음 회차를 자동 실행하므로 남은 작업이 있다는 이유로 세션을 붙잡지 마라.",
        "남은 시간이 한 작업을 안전하게 마치기에 부족하면 새 작업을 시작하지 말고 진행 중인 것만 정리·기록하고 즉시 종료하라."
    ]
        .filter(Boolean)
        .join(" ");
    const tasksBlock = runState.tasks ? `<TASKS>\n${runState.tasks}\n</TASKS>\n\n` : "";

    return `${roundPrompt}\n\n${tasksBlock}<AUTOPILOT.md>\n${getAutopilotGuide(runState.commitPrefix)}\n</AUTOPILOT.md>\n\n<AUTOPILOT_POLICY.md>\n${getAutopilotPolicy(runState.workBranch, runState.mode === MODE_BUILD ? runState.allow : null)}\n</AUTOPILOT_POLICY.md>`;
};

export default { getProgressCleanupPrompt, getRoundPrompt };

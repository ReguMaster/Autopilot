import { POLICY_TODO, PROGRESS_MAX_LINES, PROGRESS_TARGET_LINES } from "./config.js";
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

const getTasksPrompt = (tasks) => {
    if (!tasks) {
        return "이번 실행에는 소유자가 예약한 작업이 없다.";
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
        getTasksPrompt(runState.tasks),
        `진행 기록 \`${runState.progressFile}\` 를 읽어 이전 상태와 다음 작업을 이어받아라(파일이 없으면 새로 생성하라). 이 파일은 프로젝트 밖의 앱 데이터 폴더에 있어 git 저장소에 포함되지 않으므로 commit하지 않는다.`,
        getPolicyPrompt(runState.policy, runState.todoDoneRelPath),
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

    return `${roundPrompt}\n\n${tasksBlock}<AUTOPILOT.md>\n${getAutopilotGuide(runState.commitPrefix)}\n</AUTOPILOT.md>\n\n<AUTOPILOT_POLICY.md>\n${getAutopilotPolicy(runState.workBranch)}\n</AUTOPILOT_POLICY.md>`;
};

export default { getProgressCleanupPrompt, getRoundPrompt };

import { POLICY_TODO, PROGRESS_MAX_LINES } from "./config.js";
import dateUtil from "./dateUtil.js";
import { AUTOPILOT_GUIDE, AUTOPILOT_POLICY } from "./guideText.js";

const getPolicyPrompt = (policy, todoDoneRelPath) => {
    if (policy === POLICY_TODO) {
        return [
            "이번 실행의 개선 정책은 [지시개선]이다.",
            "autopilot/AUTOPILOT_TODO.md 에 예약된 작업만 처리하고 스스로 새 개선 작업을 찾지 마라.",
            `예약 작업이 모두 완료되었거나 TODO 에 처리할 작업이 남아있지 않으면 진행 기록을 갱신한 뒤 빈 파일 ${todoDoneRelPath} 를 생성하고 세션을 종료하라.`,
            "아직 처리할 예약 작업이 남아 있으면 이 파일을 만들지 마라."
        ].join(" ");
    }

    return "이번 실행의 개선 정책은 [자율개선]이다. 예약 작업을 모두 마친 뒤에도 AUTOPILOT.md의 작업 탐색과 선택 기준으로 스스로 개선 작업을 찾아 종료 예정 시각까지 계속 진행하라.";
};

const getProgressCleanupPrompt = (archivePath) => {
    return [
        `작업 시작 전에 autopilot/AUTOPILOT_PROGRESS.md 를 정리하라. ${PROGRESS_MAX_LINES}줄을 초과한 원본은 ${archivePath} 에 보관되어 있다.`,
        "현재 상태, 미완료·남은 작업, 검증 실패와 주의사항, 다음 작업은 빠짐없이 유지하고 완료 작업은 최근 5건만 한 줄씩 남겨라.",
        "본문에 보관본 경로를 명시하고 판단이 어려운 내용은 유지하라. 줄을 기계적으로 잘라내거나 파일을 비우지 마라."
    ].join(" ");
};

const getRoundPrompt = (runState, round, remainingMinutes, progressCleanupPrompt, maxTasks) => {
    const roundPrompt = [
        "CLAUDE.md를 기본 프로젝트 지침으로 사용하고, 아래 <AUTOPILOT.md>의 작업 지침에 따라 자율 개발을 수행하라.",
        "중요사항!: 아래 <AUTOPILOT_POLICY.md>의 모든 금지사항과 안전정책을 반드시 최우선으로 준수하라.",
        `정책의 작업 범위인 프로젝트 루트는 ${runState.projectDir} 이다.`,
        "작업을 고르기 전에 autopilot/AUTOPILOT_TODO.md 를 먼저 읽고 예약 작업을 작성된 순서대로 우선 처리하며,",
        "autopilot/AUTOPILOT_PROGRESS.md 를 읽어 이전 상태와 다음 작업을 이어받아라(파일이 없으면 새로 생성하라).",
        getPolicyPrompt(runState.policy, runState.todoDoneRelPath),
        progressCleanupPrompt,
        `이 세션은 AutoPilot ${round}회차이고 전체 종료 예정 시각은 ${dateUtil.getDatetimeString(runState.deadline)}, 남은 시간은 약 ${remainingMinutes}분이다.`,
        `작업은 최대 ${maxTasks}건, 규모가 크면 1건만 처리하라.`,
        "작업을 완료·검증·commit 하고 autopilot/AUTOPILOT_PROGRESS.md 를 갱신한 뒤 세션을 끝내라.",
        "실행 스크립트가 새 컨텍스트로 다음 회차를 자동 실행하므로 남은 작업이 있다는 이유로 세션을 붙잡지 마라.",
        "남은 시간이 한 작업을 안전하게 마치기에 부족하면 새 작업을 시작하지 말고 진행 중인 것만 정리·기록하고 즉시 종료하라."
    ]
        .filter(Boolean)
        .join(" ");

    return `${roundPrompt}\n\n<AUTOPILOT.md>\n${AUTOPILOT_GUIDE}\n</AUTOPILOT.md>\n\n<AUTOPILOT_POLICY.md>\n${AUTOPILOT_POLICY}\n</AUTOPILOT_POLICY.md>`;
};

export default { getProgressCleanupPrompt, getRoundPrompt };

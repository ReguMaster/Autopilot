import { ALLOW_KEYS, BRAINSTORM_PHASES, CODEX_RUNNER, DEFAULT_RUNNER, DEFAULT_SECURITY_REVIEW } from "./constants.js";
import { getAssistant } from "./phaseAgents.js";

// 신규 개발 값이 서로 기대는 규칙. 값(allow·mains·brainstorm·debate·crossReview·securityReview)을 받아 바뀐 키만 돌려주는 순수 함수라
// 시작 전 컴포저와 설정 화면이 같은 규칙을 쓴다. Codex는 프로젝트 내용을 외부로 보내므로 Codex가 보조·검토자가 되려면 보내기(send)가 함께 켜져야 한다.

// 체크를 바꾼 목록. 순서는 고를 수 있는 값의 순서로 맞춰 저장 값이 흔들리지 않게 한다.
const toggleChoice = (current, choices, value) => {
    return choices.filter((choice) => (choice === value ? !current.includes(choice) : current.includes(choice)));
};

// 보내기를 허용하지 않으면 Codex가 보조인 단계(메인이 Claude)는 보조를 쓸 수 없다. 그 단계를 빼고, 협의·교차검토를 남은 단계에 맞춘다.
// 보안검토의 독립 검토도 검토자가 Codex(보안검토의 메인이 Claude)면 같다.
const dropBlockedAssistants = ({ allow, mains, brainstorm, debate, crossReview, securityReview }) => {
    const isSendAllowed = allow.includes("send");
    const next = isSendAllowed ? brainstorm : brainstorm.filter((phase) => getAssistant(mains, phase) !== CODEX_RUNNER);
    const nextDebate = debate.filter((phase) => next.includes(phase));

    return {
        brainstorm: next,
        debate: nextDebate,
        crossReview: next.some((phase) => !nextDebate.includes(phase)) ? crossReview : false,
        securityReview: isSendAllowed || getAssistant(mains, "security") !== CODEX_RUNNER ? securityReview : DEFAULT_SECURITY_REVIEW
    };
};

const addSend = (allow) => toggleChoice(allow, ALLOW_KEYS, "send");

// 허용 항목 하나를 켜거나 끈다. send를 끄면 Codex 보조가 필요한 단계는 보조를 잃는다.
const getAllowPatch = (state, key) => {
    const allow = toggleChoice(state.allow, ALLOW_KEYS, key);

    return { allow: allow, ...dropBlockedAssistants({ ...state, allow: allow }) };
};

// 단계의 메인 AI. Codex가 보조가 되는 단계(메인이 Claude)가 생기면 보내기도 함께 켠다.
const getMainPatch = (state, phase, provider) => {
    const mains = Object.fromEntries(Object.entries({ ...state.mains, [phase]: provider }).filter(([, value]) => value !== DEFAULT_RUNNER));
    const hasAssistant = state.brainstorm.includes(phase) || (phase === "security" && state.securityReview !== DEFAULT_SECURITY_REVIEW);
    const needsSend = hasAssistant && getAssistant(mains, phase) === CODEX_RUNNER && !state.allow.includes("send");

    return { mains: mains, allow: needsSend ? addSend(state.allow) : state.allow };
};

// 단계의 보조 방식(none: 보조 없이, compare: 나란히 비교, debate: 협의). 나란히 비교하는 단계가 하나도 없으면 교차검토도 끈다(협의는 이미 서로 검토한다).
const getBrainstormPatch = (state, phase, brainstormMode) => {
    const isAssisted = brainstormMode !== "none";
    const brainstorm = BRAINSTORM_PHASES.filter((item) => (item === phase ? isAssisted : state.brainstorm.includes(item)));
    const debate = BRAINSTORM_PHASES.filter((item) => (item === phase ? brainstormMode === "debate" : state.debate.includes(item) && brainstorm.includes(item)));
    const hasCompare = brainstorm.some((item) => !debate.includes(item));
    const needsSend = isAssisted && getAssistant(state.mains, phase) === CODEX_RUNNER && !state.allow.includes("send");

    return {
        brainstorm: brainstorm,
        debate: debate,
        allow: needsSend ? addSend(state.allow) : state.allow,
        crossReview: hasCompare ? state.crossReview : false
    };
};

// 보안검토의 독립 검토. 검토자는 보안검토 메인의 반대쪽 AI이고, Codex가 검토하면 보내기도 함께 켠다.
const getSecurityReviewPatch = (state, securityReview) => {
    const needsSend = securityReview !== DEFAULT_SECURITY_REVIEW && getAssistant(state.mains, "security") === CODEX_RUNNER && !state.allow.includes("send");

    return { securityReview: securityReview, allow: needsSend ? addSend(state.allow) : state.allow };
};

export { toggleChoice, getAllowPatch, getMainPatch, getBrainstormPatch, getSecurityReviewPatch };

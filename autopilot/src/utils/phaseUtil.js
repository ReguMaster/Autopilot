import fs from "node:fs";
import path from "node:path";
import { BUILD_PHASES, GATE_PHASES, PHASE_DONE, PHASE_FILE_NAME, ON_FAIL_STOP, MAX_FAIL_RETRIES, BRAINSTORM_PHASES, PROVIDER_CLAUDE, BRAINSTORM_PROVIDERS, PROPOSALS_DIR } from "./config.js";

const INITIAL_PHASE = { phase: BUILD_PHASES[0], awaiting: null, qaRetries: 0, securityRetries: 0, proposals: null };
const RETRY_PATTERN = /^retry:(\d+)$/;
// fail을 남기면 개발로 되돌리는 단계와 그 단계가 되돌린 횟수를 세는 키
const RETRY_KEYS = { qa: "qaRetries", security: "securityRetries" };

// 진행 기록과 같은 앱 데이터 폴더에 둬서 같은 프로젝트의 다음 실행이 단계를 이어받는다.
const getPhaseFile = (progressFile) => {
    return path.join(path.dirname(progressFile), PHASE_FILE_NAME);
};

const isCount = (value) => {
    return Number.isInteger(value) && value >= 0;
};

// 여러 AI가 안을 낸 단계의 후보와 사용자가 고른 안. 고르기 전에는 picked가 null이다.
const isProposals = (proposals) => {
    if (proposals === null) {
        return true;
    }

    const providers = [PROVIDER_CLAUDE, ...BRAINSTORM_PROVIDERS];
    const candidates = proposals?.candidates;

    return (
        BRAINSTORM_PHASES.includes(proposals?.phase) &&
        Array.isArray(candidates) &&
        candidates.length > 1 &&
        candidates.every((candidate) => providers.includes(candidate)) &&
        (proposals.picked === null || candidates.includes(proposals.picked))
    );
};

const isPhaseState = (state) => {
    return (
        [...BUILD_PHASES, PHASE_DONE].includes(state?.phase) &&
        (state.awaiting === null || GATE_PHASES.includes(state.awaiting)) &&
        isCount(state.qaRetries) &&
        isCount(state.securityRetries) &&
        isProposals(state.proposals)
    );
};

// 파일이 없거나 깨졌으면 처음(기획)부터다. 단계 산출물은 저장소에 commit되어 있어 다시 시작해도 잃는 것이 없다.
// 보안검토 · 브레인스토밍이 생기기 전에 쓴 파일에는 securityRetries · proposals가 없으므로 0 · null로 본다.
const readPhase = (phaseFile) => {
    try {
        const state = { securityRetries: 0, proposals: null, ...JSON.parse(fs.readFileSync(phaseFile, "utf8")) };

        return isPhaseState(state)
            ? { phase: state.phase, awaiting: state.awaiting, qaRetries: state.qaRetries, securityRetries: state.securityRetries, proposals: state.proposals }
            : { ...INITIAL_PHASE };
    } catch {
        return { ...INITIAL_PHASE };
    }
};

const writePhase = (phaseFile, state) => {
    const tempFile = `${phaseFile}.${process.pid}.tmp`;

    fs.mkdirSync(path.dirname(phaseFile), { recursive: true });
    fs.writeFileSync(tempFile, JSON.stringify(state), "utf8");
    fs.renameSync(tempFile, phaseFile);
};

// 확인을 기다리던 단계를 승인 없이 다시 시작하면 그 단계를 다시 한다(작업 칸의 내용이 수정 요청이다). 다른 AI의 안도 다시 받는다.
const getStartPhase = (state) => {
    if (!state.awaiting) {
        return { state: state, isRevision: false };
    }

    return { state: { ...state, phase: state.awaiting, awaiting: null, proposals: null }, isRevision: true };
};

// 단계를 마친 세션이 남긴 결과(테스트/QA·보안검토만 pass·fail)로 다음 상태와 일어난 일을 정한다.
// maxRetries는 단계별로 개발에 되돌릴 수 있는 횟수({ qa, security })다.
// candidates는 이 단계에 안을 낸 제공자들이다. 둘 이상이면 사용자가 골라야 하므로 확인받기 설정과 상관없이 멈춘다.
const getPhaseTransition = (state, result, gates, maxRetries, candidates = []) => {
    const retryKey = RETRY_KEYS[state.phase];

    if (retryKey && result === "fail") {
        if (state[retryKey] < maxRetries[state.phase]) {
            return { state: { ...state, phase: "build", awaiting: null, [retryKey]: state[retryKey] + 1 }, event: "retry" };
        }

        return { state: state, event: "failed" };
    }

    const nextPhase = BUILD_PHASES[BUILD_PHASES.indexOf(state.phase) + 1] ?? PHASE_DONE;

    if (nextPhase === PHASE_DONE) {
        return { state: { ...state, phase: PHASE_DONE, awaiting: null }, event: "done" };
    }

    if (candidates.length > 1) {
        return { state: { ...state, phase: nextPhase, awaiting: state.phase, proposals: { phase: state.phase, candidates: candidates, picked: null } }, event: "await" };
    }

    if (gates.includes(state.phase)) {
        return { state: { ...state, phase: nextPhase, awaiting: state.phase }, event: "await" };
    }

    return { state: { ...state, phase: nextPhase, awaiting: null }, event: "next" };
};

// 다른 AI의 안과 검토는 저장소의 docs/autopilot/proposals/에 둔다. 디자인을 HTML로 받은 안만 .html이다.
const getProposalPath = (phase, provider, isHtml = false) => {
    return `${PROPOSALS_DIR}/${phase}-${provider}.${isHtml ? "html" : "md"}`;
};

const getReviewPath = (phase, reviewer) => {
    return `${PROPOSALS_DIR}/${phase}-review-${reviewer}.md`;
};

// --qa-on-fail·--security-on-fail 값. stop은 0, retry:N은 1~MAX_FAIL_RETRIES의 N이다. 형식이 틀리면 null.
const parseOnFail = (text) => {
    if (text === ON_FAIL_STOP) {
        return 0;
    }

    const match = RETRY_PATTERN.exec(text);
    const retries = match ? Number(match[1]) : 0;

    return retries >= 1 && retries <= MAX_FAIL_RETRIES ? retries : null;
};

export default { INITIAL_PHASE, RETRY_KEYS, getPhaseFile, isPhaseState, readPhase, writePhase, getStartPhase, getPhaseTransition, getProposalPath, getReviewPath, parseOnFail };

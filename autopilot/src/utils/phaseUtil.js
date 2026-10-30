import fs from "node:fs";
import path from "node:path";
import { BUILD_PHASES, GATE_PHASES, PHASE_DONE, PHASE_FILE_NAME, QA_ON_FAIL_STOP, MAX_QA_RETRIES } from "./config.js";

const INITIAL_PHASE = { phase: BUILD_PHASES[0], awaiting: null, qaRetries: 0 };
const QA_RETRY_PATTERN = /^retry:(\d+)$/;

// 진행 기록과 같은 앱 데이터 폴더에 둬서 같은 프로젝트의 다음 실행이 단계를 이어받는다.
const getPhaseFile = (progressFile) => {
    return path.join(path.dirname(progressFile), PHASE_FILE_NAME);
};

const isPhaseState = (state) => {
    return [...BUILD_PHASES, PHASE_DONE].includes(state?.phase) && (state.awaiting === null || GATE_PHASES.includes(state.awaiting)) && Number.isInteger(state.qaRetries) && state.qaRetries >= 0;
};

// 파일이 없거나 깨졌으면 처음(기획)부터다. 단계 산출물은 저장소에 commit되어 있어 다시 시작해도 잃는 것이 없다.
const readPhase = (phaseFile) => {
    try {
        const state = JSON.parse(fs.readFileSync(phaseFile, "utf8"));

        return isPhaseState(state) ? { phase: state.phase, awaiting: state.awaiting, qaRetries: state.qaRetries } : { ...INITIAL_PHASE };
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

// 확인을 기다리던 단계를 승인 없이 다시 시작하면 그 단계를 다시 한다(작업 칸의 내용이 수정 요청이다).
const getStartPhase = (state) => {
    if (!state.awaiting) {
        return { state: state, isRevision: false };
    }

    return { state: { ...state, phase: state.awaiting, awaiting: null }, isRevision: true };
};

// 단계를 마친 세션이 남긴 결과(테스트/QA만 pass·fail)로 다음 상태와 일어난 일을 정한다.
const getPhaseTransition = (state, result, gates, maxQaRetries) => {
    if (state.phase === "qa" && result === "fail") {
        if (state.qaRetries < maxQaRetries) {
            return { state: { phase: "build", awaiting: null, qaRetries: state.qaRetries + 1 }, event: "retry" };
        }

        return { state: state, event: "qa-failed" };
    }

    const nextPhase = BUILD_PHASES[BUILD_PHASES.indexOf(state.phase) + 1] ?? PHASE_DONE;

    if (nextPhase === PHASE_DONE) {
        return { state: { ...state, phase: PHASE_DONE, awaiting: null }, event: "done" };
    }

    if (gates.includes(state.phase)) {
        return { state: { ...state, phase: nextPhase, awaiting: state.phase }, event: "await" };
    }

    return { state: { ...state, phase: nextPhase, awaiting: null }, event: "next" };
};

// stop은 0, retry:N은 1~MAX_QA_RETRIES의 N이다. 형식이 틀리면 null.
const parseQaOnFail = (text) => {
    if (text === QA_ON_FAIL_STOP) {
        return 0;
    }

    const match = QA_RETRY_PATTERN.exec(text);
    const retries = match ? Number(match[1]) : 0;

    return retries >= 1 && retries <= MAX_QA_RETRIES ? retries : null;
};

export default { INITIAL_PHASE, getPhaseFile, isPhaseState, readPhase, writePhase, getStartPhase, getPhaseTransition, parseQaOnFail };

import fs from "node:fs";
import path from "node:path";
import {
    AI_PROVIDERS,
    BRAINSTORM_PHASES,
    BUILD_PHASES,
    DEFAULT_RUNNER,
    GATE_PHASES,
    MAX_FAIL_RETRIES,
    ON_FAIL_STOP,
    PHASE_DONE,
    PHASE_FILE_NAME,
    PROPOSALS_DIR,
    PROVIDER_CLAUDE,
    PROVIDER_CODEX
} from "./config.js";
import debateUtil from "./debateUtil.js";

const INITIAL_PHASE = { phase: BUILD_PHASES[0], awaiting: null, qaRetries: 0, securityRetries: 0, proposals: null, debate: null, receivedProposal: null };
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

    const candidates = proposals?.candidates;

    return (
        BRAINSTORM_PHASES.includes(proposals?.phase) &&
        Array.isArray(candidates) &&
        candidates.length > 1 &&
        candidates.every((candidate) => AI_PROVIDERS.includes(candidate)) &&
        (proposals.picked === null || candidates.includes(proposals.picked))
    );
};

const isPhaseState = (state) => {
    return (
        [...BUILD_PHASES, PHASE_DONE].includes(state?.phase) &&
        (state.awaiting === null || GATE_PHASES.includes(state.awaiting)) &&
        isCount(state.qaRetries) &&
        isCount(state.securityRetries) &&
        isProposals(state.proposals) &&
        debateUtil.isDebateState(state.debate) &&
        [null, ...BRAINSTORM_PHASES].includes(state.receivedProposal)
    );
};

// 파일이 없거나 깨졌으면 처음(기획)부터다. 단계 산출물은 저장소에 commit되어 있어 다시 시작해도 잃는 것이 없다.
// 보안검토 · 브레인스토밍 · 협의가 생기기 전에 쓴 파일에는 securityRetries · proposals · debate · receivedProposal이 없으므로 0 · null로 본다.
// receivedProposal은 이 개발이 다른 AI의 안을 받아 둔 단계다. 저장소에 남은 안 파일이 앞선 개발의 것인지 가려 이어서 하는 단계만 그 안을 쓴다.
const readPhase = (phaseFile) => {
    try {
        const state = { securityRetries: 0, proposals: null, debate: null, receivedProposal: null, ...JSON.parse(fs.readFileSync(phaseFile, "utf8")) };

        return isPhaseState(state)
            ? {
                  phase: state.phase,
                  awaiting: state.awaiting,
                  qaRetries: state.qaRetries,
                  securityRetries: state.securityRetries,
                  proposals: state.proposals,
                  debate: state.debate,
                  receivedProposal: state.receivedProposal
              }
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

    return { state: { ...state, phase: state.awaiting, awaiting: null, proposals: null, debate: null, receivedProposal: null }, isRevision: true };
};

const SECURITY_DOC_PATH = "docs/autopilot/security.md";
const SECURITY_STATUSES = ["확인함", "해당 없음", "못 함"];
const MIN_EVIDENCE_LENGTH = 10;
// 보안검토가 security.md의 점검 결과 표에 한 행씩 남겨야 하는 항목. 프롬프트의 점검 목록과 엔진의 검사가 같은 목록을 쓴다.
const SECURITY_CHECKS = [
    { key: "비밀값", detail: "코드 · 설정 파일 · `git log -p` 이력의 키 · 토큰 · 비밀번호" },
    { key: "패키지 취약점", detail: "프로젝트의 audit 명령(예: `npm audit`, `pip-audit`, `cargo audit`). 네트워크를 쓸 수 없으면 lockfile 검토로 대신하고 그 사실을 근거에 적는다" },
    { key: "입력 검증과 인젝션", detail: "SQL · 명령 · 경로 · XSS" },
    { key: "인증 · 권한 · 세션", detail: "" },
    { key: "파일 업로드와 경로", detail: "" },
    { key: "오류 · 로그의 민감정보", detail: "오류 메시지 · 로그에 드러나는 민감정보" },
    { key: "CORS와 보안 헤더", detail: "웹이 아니면 `해당 없음`" },
    { key: "기본 · 디버그 설정", detail: "기본 계정 · 디버그 설정 · 개발용 설정이 남았는지" }
];

const normalizeCell = (text) => {
    return text.replace(/[\s·`*_]/g, "");
};

// security.md의 점검 결과 표가 점검 항목마다 상태와 근거를 갖췄는지 본다. 빠졌거나 근거 없는 항목을 문장으로 돌려준다(없으면 빈 배열).
// shortcut: 근거는 길이로만 가린다. 내용이 맞는지까지는 보지 않으므로 교차검토(독립 AI)가 생기면 그쪽으로 넘긴다.
const getSecurityDocProblems = (text) => {
    const rows = text
        .split(/\r?\n/)
        .filter((line) => line.trim().startsWith("|"))
        .map((line) =>
            line
                .trim()
                .replace(/^\||\|$/g, "")
                .split("|")
                .map((cell) => cell.trim())
        );

    return SECURITY_CHECKS.flatMap(({ key }) => {
        const row = rows.find((cells) => normalizeCell(cells[0]).includes(normalizeCell(key)));

        if (!row) {
            return [`'${key}' 행이 없다`];
        }

        const status = (row[1] ?? "")
            .replace(/[^\p{L}\p{N} ]/gu, "")
            .replace(/\s+/g, " ")
            .trim();
        const evidence = row.slice(2).join("|").trim();

        if (!SECURITY_STATUSES.includes(status)) {
            return [`'${key}'의 상태가 ${SECURITY_STATUSES.join(" · ")} 중 하나가 아니다`];
        }

        return evidence.length < MIN_EVIDENCE_LENGTH ? [`'${key}'의 근거가 없거나 너무 짧다`] : [];
    });
};

const SECURITY_REVIEW_PATH = "docs/autopilot/security-review.md";
const SECURITY_SEVERITIES = ["심각", "높음", "중간", "낮음"];
// 개발로 되돌리는 심각도. 보안검토 자신의 pass·fail 기준과 같다.
const BLOCKING_SEVERITIES = ["심각", "높음"];
const MAX_REVIEW_FINDINGS = 20;
const MAX_REVIEW_TEXT_LENGTH = 400;

// 보안검토의 독립 검토자. 메인의 반대쪽 AI다. Codex가 검토하면 프로젝트 내용을 보내야 하므로 보내기를 허용하지 않았으면 검토하지 못한다(isBlocked).
const getSecurityReviewer = ({ main, canSend = false }) => {
    const reviewer = getOtherProvider(main);

    return { reviewer: reviewer, isBlocked: reviewer === PROVIDER_CODEX && !canSend };
};

const cleanReviewText = (value) => {
    return typeof value === "string"
        ? value
              .replace(/[\u0000-\u001f\u007f]+/g, " ")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, MAX_REVIEW_TEXT_LENGTH)
        : "";
};

// 독립 검토자의 답에서 JSON 객체 하나를 꺼내 {findings: [{severity, location, description, recommendation}]}로 읽는다. 읽을 수 없거나 심각도가 틀린 항목이 있으면 null이다.
// 모르는 심각도를 낮게 읽으면 심각한 문제가 통과하므로 항목을 버리지 않고 답 전체를 거부한다.
const parseSecurityReview = (text) => {
    const source = String(text || "");
    const start = source.indexOf("{");
    const end = source.lastIndexOf("}");
    let value;

    try {
        value = JSON.parse(source.slice(start, end + 1));
    } catch {
        return null;
    }

    if (!Array.isArray(value?.findings) || value.findings.length > MAX_REVIEW_FINDINGS) {
        return null;
    }

    const findings = value.findings.map((item) => ({
        severity: cleanReviewText(item?.severity).replace(/[^\p{L}]/gu, ""),
        location: cleanReviewText(item?.location),
        description: cleanReviewText(item?.description),
        recommendation: cleanReviewText(item?.recommendation)
    }));

    return findings.every((finding) => SECURITY_SEVERITIES.includes(finding.severity) && finding.description) ? { findings: findings } : null;
};

const getBlockingFindings = (review) => {
    return review.findings.filter((finding) => BLOCKING_SEVERITIES.includes(finding.severity));
};

// 독립 검토 결과 문서. 심각도 순이고, 개발과 다시 하는 보안검토가 읽는다.
const formatSecurityReview = (review, reviewerLabel) => {
    const cell = (text) => (text || "-").replace(/\|/g, "\\|");
    const rows = [...review.findings]
        .sort((a, b) => SECURITY_SEVERITIES.indexOf(a.severity) - SECURITY_SEVERITIES.indexOf(b.severity))
        .map((finding) => `| ${finding.severity} | ${cell(finding.location)} | ${cell(finding.description)} | ${cell(finding.recommendation)} |`);

    return [
        `# 보안검토 독립 검토 (${reviewerLabel})`,
        "",
        `${reviewerLabel}가 \`security.md\`와 따로 코드를 읽고 낸 결과다. ${BLOCKING_SEVERITIES.join(" · ")}은 개발이 고쳐야 한다.`,
        "",
        ...(rows.length ? ["| 심각도 | 위치 | 설명 | 권장 조치 |", "|---|---|---|---|", ...rows] : ["찾은 문제 없음"])
    ].join("\n");
};

// 세션이 `fail`을 꾸미거나(백틱·굵게) 뒤에 이유를 붙여도 실패로 본다. 정확히 일치만 보면 실패가 통과로 넘어간다.
// \W는 한글도 꾸밈 문자로 건너뛰어 `통과 (fail 0건)`을 실패로 읽으므로 글자·숫자가 아닌 것만 건너뛴다.
const isFailResult = (result) => {
    return /^[^\p{L}\p{N}]*(?:fail|실패)/iu.test(result);
};

// 건너뛰는 단계에 서 있으면 처음으로 할 단계까지 앞으로 옮긴다. 거쳐 간 단계는 skipped에 담는다. 끝까지 건너뛰면 phase는 done이다.
const skipForward = (phase, skip = []) => {
    const skipped = [];
    let current = phase;

    while (skip.includes(current)) {
        skipped.push(current);
        current = BUILD_PHASES[BUILD_PHASES.indexOf(current) + 1] ?? PHASE_DONE;
    }

    return { phase: current, skipped: skipped };
};

// 단계를 마친 세션이 남긴 결과(테스트/QA·보안검토만 pass·fail)로 다음 상태와 일어난 일을 정한다.
// maxRetries는 단계별로 개발에 되돌릴 수 있는 횟수({ qa, security })다.
// candidates는 이 단계에 안을 낸 제공자들이다. 둘 이상이면 사용자가 골라야 하므로 확인받기 설정과 상관없이 멈춘다.
// debate는 두 AI가 협의를 마친 결과({ phase, disputes, resolved: null })다. 쟁점을 고르거나 합의안을 확인해야 하므로 늘 멈춘다.
// skip은 이번 실행에서 하지 않는 단계다. 멈추지 않고 이어 가는 전환만 건너뛰고(skipped로 알린다), 멈추는 전환은 다음 실행이 시작할 때 건너뛰도록 바로 다음 단계를 남긴다.
const getPhaseTransition = (state, result, gates, maxRetries, candidates = [], debate = null, skip = []) => {
    const retryKey = RETRY_KEYS[state.phase];

    if (retryKey && isFailResult(result)) {
        if (state[retryKey] < maxRetries[state.phase]) {
            return { state: { ...state, phase: "build", awaiting: null, [retryKey]: state[retryKey] + 1 }, event: "retry" };
        }

        return { state: state, event: "failed" };
    }

    const nextPhase = BUILD_PHASES[BUILD_PHASES.indexOf(state.phase) + 1] ?? PHASE_DONE;

    if (nextPhase === PHASE_DONE) {
        return { state: { ...state, phase: PHASE_DONE, awaiting: null }, event: "done" };
    }

    if (debate) {
        return { state: { ...state, phase: nextPhase, awaiting: state.phase, debate: debate }, event: "await" };
    }

    if (candidates.length > 1) {
        return { state: { ...state, phase: nextPhase, awaiting: state.phase, proposals: { phase: state.phase, candidates: candidates, picked: null } }, event: "await" };
    }

    if (gates.includes(state.phase)) {
        return { state: { ...state, phase: nextPhase, awaiting: state.phase }, event: "await" };
    }

    const { phase: runnablePhase, skipped } = skipForward(nextPhase, skip);
    const skippedPart = skipped.length ? { skipped: skipped } : {};

    if (runnablePhase === PHASE_DONE) {
        return { state: { ...state, phase: PHASE_DONE, awaiting: null }, event: "done", ...skippedPart };
    }

    return { state: { ...state, phase: runnablePhase, awaiting: null }, event: "next", ...skippedPart };
};

// 이번 실행에서 하는 단계들(순서대로). 프롬프트가 몇 번째 단계인지 말할 때 쓴다.
const getActivePhases = (skip = []) => {
    return BUILD_PHASES.filter((phase) => !skip.includes(phase));
};

// 메인의 반대쪽 AI. 보조는 늘 이 AI다.
const getOtherProvider = (provider) => {
    return provider === PROVIDER_CLAUDE ? PROVIDER_CODEX : PROVIDER_CLAUDE;
};

// 단계마다의 메인 AI(그 단계의 회차를 돌린다). --main에 없는 단계는 기본 실행 에이전트(--runner)다. 신규 개발은 늘 다섯 단계를 모두 채워 쓴다.
const getPhaseMains = (mains = {}, runner = DEFAULT_RUNNER) => {
    return Object.fromEntries(BUILD_PHASES.map((phase) => [phase, mains[phase] ?? runner]));
};

// 단계의 메인과 보조. 보조는 브레인스토밍하는 단계에만 있고 메인의 반대쪽 AI다.
// Codex를 보조로 쓰려면 프로젝트 내용을 보내야 하므로 보내기를 허용하지 않았으면 보조 없이 메인만 진행한다(isBlocked). 메인이 Codex면 내용이 이미 Codex에 가므로 Claude 보조는 허용과 상관없다.
const getPhaseAgents = ({ phase, mains, brainstorm = [], canSend = false }) => {
    const main = mains[phase];
    const assistant = brainstorm.includes(phase) ? getOtherProvider(main) : null;
    const isBlocked = assistant === PROVIDER_CODEX && !canSend;

    return { phase: phase, main: main, assistant: isBlocked ? null : assistant, isBlocked: isBlocked };
};

// 다른 AI의 안과 검토는 저장소의 docs/autopilot/proposals/에 둔다. 디자인을 HTML로 받은 안만 .html이다.
const getProposalPath = (phase, provider, isHtml = false) => {
    return `${PROPOSALS_DIR}/${phase}-${provider}.${isHtml ? "html" : "md"}`;
};

const getReviewPath = (phase, reviewer) => {
    return `${PROPOSALS_DIR}/${phase}-review-${reviewer}.md`;
};

// 협의 기록(엔진이 쓴다)과 합의 정리 회차가 남기는 못 맞춘 쟁점.
const getDebatePath = (phase) => {
    return `${PROPOSALS_DIR}/${phase}-debate.md`;
};

const getDisputesPath = (phase) => {
    return `${PROPOSALS_DIR}/${phase}-disputes.json`;
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

export default {
    INITIAL_PHASE,
    RETRY_KEYS,
    getPhaseFile,
    isPhaseState,
    readPhase,
    writePhase,
    getStartPhase,
    skipForward,
    SECURITY_DOC_PATH,
    SECURITY_STATUSES,
    SECURITY_CHECKS,
    getSecurityDocProblems,
    SECURITY_REVIEW_PATH,
    SECURITY_SEVERITIES,
    getSecurityReviewer,
    parseSecurityReview,
    getBlockingFindings,
    formatSecurityReview,
    isFailResult,
    getPhaseTransition,
    getActivePhases,
    getOtherProvider,
    getPhaseMains,
    getPhaseAgents,
    getProposalPath,
    getReviewPath,
    getDebatePath,
    getDisputesPath,
    parseOnFail
};

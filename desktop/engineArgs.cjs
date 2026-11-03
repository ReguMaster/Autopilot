// 엔진 CLI(autopilot_loop.js)를 시작하는 인자. 인자와 값은 엔진 CLI 계약(루트 CLAUDE.md)과 같아야 한다.
const DEFAULT_COMMIT_PREFIX = "[ap]";
const DEFAULT_WORK_BRANCH = "ai/autopilot";
const DEFAULT_LOG_RETENTION_DAYS = 30;
// 작업 프로젝트에 더할 수 있는 연결 저장소 수(엔진 config.js의 MAX_LINKED_REPOS와 같다). 작업 프로젝트를 합쳐 3개다.
const MAX_LINKED_REPOS = 2;
// 아래 두 검증은 엔진의 util.js(isValidCommitPrefix·isValidWorkBranch)와 같은 규칙이다(tests/checkDesktopRunner.js가 값을 대조한다).
const COMMIT_PREFIX_PATTERN = /^[^`\p{Cc}]{1,20}$/u;
const WORK_BRANCH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;
const MAX_WORK_BRANCH_LENGTH = 100;
const PROTECTED_BRANCHES = ["main", "master", "head"];
// 작업 모드와 신규 개발 인자. 값은 엔진 config.js(MODES·GATE_PHASES·ALLOW_KEYS·DESIGN_FORMATS·DEFAULT_*·MAX_FAIL_RETRIES)와 같다.
const MODES = ["maintain", "build"];
const BUILD_PHASES = ["plan", "design", "build", "qa", "security"];
const GATE_PHASES = ["plan", "design"];
// 이번 실행에서 하지 않기로 정할 수 있는 단계(엔진 config.js의 SKIPPABLE_PHASES와 같다). 기획과 개발은 건너뛸 수 없다.
const SKIPPABLE_PHASES = ["design", "qa", "security"];
const ALLOW_KEYS = ["deps", "large", "external-api", "send"];
const DESIGN_FORMATS = ["md", "html", "figma", "image"];
const DEFAULT_DESIGN_FORMAT = "html";
// 테스트/QA·보안검토가 fail이면 개발로 되돌리는 횟수(stop은 되돌리지 않고 멈춤). 두 단계가 같은 형식을 쓴다.
const ON_FAIL_PATTERN = /^(stop|retry:[1-5])$/;
const DEFAULT_QA_ON_FAIL = "retry:3";
const DEFAULT_SECURITY_ON_FAIL = "retry:3";
// 보안검토의 독립 검토(엔진 --security-review). off는 인자를 생략하고, on은 검토하지 못하면 메인의 판정대로 진행하며, strict는 검토하지 못한 보안검토를 통과시키지 않는다.
const SECURITY_REVIEW_CHOICES = ["off", "on", "strict"];
const DEFAULT_SECURITY_REVIEW = "off";
// 여러 AI 브레인스토밍을 켤 수 있는 단계와 회차를 돌리고 안을 내는 AI(엔진 config.js의 BRAINSTORM_PHASES·AI_PROVIDERS).
const BRAINSTORM_PHASES = ["plan", "design"];
const AI_PROVIDERS = ["claude", "codex"];
// Codex에 넘기는 model(Codex가 쓰는 이름)과 reasoning effort. 엔진 config.js의 CODEX_MODEL_PATTERN·CODEX_EFFORT_LEVELS·DEFAULT_CODEX_*와 같고, Codex 설정을 따르지 않고 늘 값을 넘긴다.
const CODEX_MODEL_PATTERN = /^[A-Za-z][A-Za-z0-9._-]{0,62}$/;
const CODEX_EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"];
const DEFAULT_CODEX_MODEL = "gpt-6.1-sol";
const DEFAULT_CODEX_EFFORT = "high";
// 회차를 실행하는 에이전트(엔진 config.js의 RUNNERS·DEFAULT_RUNNER). 기본값이면 인자를 생략한다.
const RUNNERS = ["claude", "codex"];
const DEFAULT_RUNNER = "claude";
// 협의에서 주고받는 최대 횟수(엔진 config.js의 DEBATE_DEFAULT_TURNS·DEBATE_TURNS_LIMIT와 같다). 기본값과 같으면 인자를 생략한다.
const DEBATE_DEFAULT_TURNS = 8;
const DEBATE_TURNS_LIMIT = 20;
// 종료 시각은 HH:mm(다음에 오는 그 시각) 또는 yyyy-MM-dd HH:mm(그 날짜)이다. 날짜는 엔진의 MAX_RUN_DAYS(7일) 뒤까지다.
const END_TIME_PATTERN = /^(\d{4}-\d{2}-\d{2} )?([01]\d|2[0-3]):[0-5]\d$/;
const MAX_RUN_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

const isValidCommitPrefix = (value) => {
    return typeof value === "string" && value === value.trim() && COMMIT_PREFIX_PATTERN.test(value) && !value.startsWith("--");
};

const isValidWorkBranch = (value) => {
    return (
        typeof value === "string" &&
        value.length <= MAX_WORK_BRANCH_LENGTH &&
        WORK_BRANCH_PATTERN.test(value) &&
        !value.includes("..") &&
        value.split("/").every((segment) => !segment.endsWith(".lock") && !segment.endsWith(".")) &&
        !PROTECTED_BRANCHES.includes(value.toLowerCase())
    );
};

// 종료 시각의 오류 문구. 비었거나 맞으면 빈 문자열이다. 날짜를 붙인 값은 엔진처럼 없는 날짜·지난 시각·MAX_RUN_DAYS보다 뒤를 거부한다.
const getEndTimeError = (endTime, now = Date.now()) => {
    if (!endTime) {
        return "";
    }

    if (typeof endTime !== "string" || !END_TIME_PATTERN.test(endTime)) {
        return "종료 시각 형식이 올바르지 않아요.";
    }

    if (!endTime.includes(" ")) {
        return "";
    }

    const [year, month, day, hour, minute] = endTime.split(/[- :]/).map(Number);
    const deadline = new Date(year, month - 1, day, hour, minute);

    if (deadline.getMonth() !== month - 1 || deadline.getDate() !== day) {
        return "없는 날짜예요. 종료 시각을 다시 골라 주세요.";
    }

    if (deadline.getTime() <= now) {
        return "종료 시각이 이미 지났어요. 다시 골라 주세요.";
    }

    return deadline.getTime() - now > MAX_RUN_DAYS * DAY_MS ? `종료 시각은 ${MAX_RUN_DAYS}일 뒤까지 정할 수 있어요.` : "";
};

// 단계마다 그 단계의 회차를 돌리는 메인 AI(엔진 phaseUtil.getPhaseMains와 같다). 없는 단계는 기본 실행 에이전트(claude)다.
const getMains = (mains = {}) => {
    return Object.fromEntries(BUILD_PHASES.map((phase) => [phase, mains[phase] ?? DEFAULT_RUNNER]));
};

const isMains = (value) => {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.entries(value).every(([phase, provider]) => BUILD_PHASES.includes(phase) && AI_PROVIDERS.includes(provider));
};

// 메인의 반대쪽 AI가 그 단계의 보조다.
const getOtherProvider = (provider) => {
    return provider === "claude" ? "codex" : "claude";
};

// 보조를 쓸 수 있는 브레인스토밍 단계(엔진 phaseUtil.getPhaseAgents와 같다). Codex를 보조로 쓰려면 프로젝트 내용을 보내야 하므로 보내기를 허용해야 하고, Claude 보조는 허용과 상관없다.
const getAssistedPhases = ({ mode, mains, brainstorm = [], allow = [] }) => {
    const mainMap = getMains(mains);

    return mode === "build" ? brainstorm.filter((phase) => getOtherProvider(mainMap[phase]) === "claude" || allow.includes("send")) : [];
};

// 독립 검토를 할 수 있는 실행(엔진 phaseUtil.getSecurityReviewer와 같다). 보안검토를 건너뛰면 하지 않고, 검토자가 Codex(보안검토의 메인이 Claude)면 보내기를 허용해야 한다.
const hasSecurityReview = ({ mode, mains, securityReview = DEFAULT_SECURITY_REVIEW, allow = [], skip = [] }) => {
    return mode === "build" && securityReview !== DEFAULT_SECURITY_REVIEW && !skip.includes("security") && (getOtherProvider(getMains(mains).security) === "claude" || allow.includes("send"));
};

// Codex가 관여하는 실행(회차를 돌리거나 보조로 안을 냄)에만 Codex의 model·effort를 넘긴다(엔진이 그 밖에는 거부한다).
// 유지 보수는 --runner로 회차를 돌릴 AI를 고르고, 신규 개발은 단계마다 --main이 정하므로 --runner를 보내지 않는다(저장된 실행 에이전트가 새어 들지 않게).
const getCodexArgs = ({ mode, runner = DEFAULT_RUNNER, mains, codexModel = DEFAULT_CODEX_MODEL, codexEffort = DEFAULT_CODEX_EFFORT, brainstorm = [], allow, skip = [], securityReview }) => {
    const isBuild = mode === "build";
    const args = !isBuild && runner !== DEFAULT_RUNNER ? ["--runner", runner] : [];
    const usesCodex = isBuild
        ? Object.values(getMains(mains)).includes("codex") ||
          getAssistedPhases({ mode: mode, mains: mains, brainstorm: brainstorm.filter((phase) => !skip.includes(phase)), allow: allow }).length > 0 ||
          hasSecurityReview({ mode: mode, mains: mains, securityReview: securityReview, allow: allow, skip: skip })
        : runner === "codex";

    if (usesCodex) {
        args.push("--codex-model", codexModel, "--codex-effort", codexEffort);
    }

    return args;
};

// 신규 개발 인자는 mode가 build일 때만 붙인다. 엔진 기본값(확인받기·허용 없음, html, retry:3)과 같으면 생략한다.
const getBuildArgs = ({
    mode,
    gates = [],
    skip = [],
    allow = [],
    designFormat,
    qaOnFail,
    securityOnFail,
    securityReview = DEFAULT_SECURITY_REVIEW,
    mains,
    brainstorm = [],
    crossReview = false,
    debate = [],
    debateTurns = DEBATE_DEFAULT_TURNS
}) => {
    if (mode !== "build") {
        return [];
    }

    const args = ["--mode", "build"];
    const mainMap = getMains(mains);
    const mainEntries = BUILD_PHASES.filter((phase) => mainMap[phase] !== DEFAULT_RUNNER).map((phase) => `${phase}=${mainMap[phase]}`);

    if (mainEntries.length) {
        args.push("--main", mainEntries.join(","));
    }

    // 건너뛰는 단계의 확인받기 · 보조 · 형식 · 되돌림 설정은 엔진이 거부하므로 빼고 보낸다.
    const activeGates = gates.filter((phase) => !skip.includes(phase));

    if (skip.length) {
        args.push("--skip", skip.join(","));
    }

    if (activeGates.length) {
        args.push("--gate", activeGates.join(","));
    }

    if (allow.length) {
        args.push("--allow", allow.join(","));
    }

    if (designFormat && designFormat !== DEFAULT_DESIGN_FORMAT && !skip.includes("design")) {
        args.push("--design-format", designFormat);
    }

    if (qaOnFail && qaOnFail !== DEFAULT_QA_ON_FAIL && !skip.includes("qa")) {
        args.push("--qa-on-fail", qaOnFail);
    }

    if (securityOnFail && securityOnFail !== DEFAULT_SECURITY_ON_FAIL && !skip.includes("security")) {
        args.push("--security-on-fail", securityOnFail);
    }

    if (hasSecurityReview({ mode: mode, mains: mains, securityReview: securityReview, allow: allow, skip: skip })) {
        args.push("--security-review", securityReview);
    }

    // 보조(메인의 반대쪽 AI)를 쓸 수 있는 단계만 넘긴다. 협의 단계는 :debate를 붙이고, 교차검토는 나란히 비교하는 단계가 있을 때만 넘긴다(엔진이 그 밖에는 거부한다).
    const assisted = getAssistedPhases({ mode: mode, mains: mains, brainstorm: brainstorm.filter((phase) => !skip.includes(phase)), allow: allow });

    if (assisted.length) {
        const hasCompare = assisted.some((phase) => !debate.includes(phase));

        args.push("--brainstorm", assisted.map((phase) => (debate.includes(phase) ? `${phase}:debate` : phase)).join(","), ...(crossReview && hasCompare ? ["--cross-review"] : []));

        // 엔진은 협의하는 단계가 없을 때의 --debate-turns를 거부하므로 협의 단계가 있을 때만 넘긴다.
        if (debateTurns !== DEBATE_DEFAULT_TURNS && assisted.some((phase) => debate.includes(phase))) {
            args.push("--debate-turns", String(debateTurns));
        }
    }

    return args;
};

// 종료 시각·한도 연장·연장 상한·커밋 접두어·작업 브랜치·보관 기간·연결 저장소·신규 개발·계정 폴더는 있을 때만(기본값과 다를 때만) 붙인다.
const getCliArgs = ({
    projectDir,
    tasksFile,
    endTime,
    policy,
    extendOnLimit,
    extendLimitMinutes,
    commitPrefix,
    workBranch,
    logRetentionDays,
    linkedRepos = [],
    model,
    effort,
    configDir,
    ...buildOptions
}) => {
    const args = ["--project", projectDir, "--no-open", "--tasks-file", tasksFile, "--policy", policy, "--model", model, "--effort", effort];

    if (endTime) {
        args.push("--end-time", endTime);
    }

    if (extendOnLimit) {
        args.push("--extend-on-limit");

        if (extendLimitMinutes > 0) {
            args.push("--max-extend-minutes", String(extendLimitMinutes));
        }
    }

    if (commitPrefix && commitPrefix !== DEFAULT_COMMIT_PREFIX) {
        args.push("--commit-prefix", commitPrefix);
    }

    if (workBranch && workBranch !== DEFAULT_WORK_BRANCH) {
        args.push("--branch", workBranch);
    }

    if (logRetentionDays && logRetentionDays !== DEFAULT_LOG_RETENTION_DAYS) {
        args.push("--log-retention-days", String(logRetentionDays));
    }

    for (const linkedRepo of linkedRepos) {
        args.push("--link-project", linkedRepo);
    }

    args.push(...getBuildArgs(buildOptions), ...getCodexArgs(buildOptions));

    if (configDir) {
        args.push("--config-dir", configDir);
    }

    return args;
};

module.exports = {
    getCliArgs,
    getMains,
    getOtherProvider,
    getAssistedPhases,
    isMains,
    getEndTimeError,
    isValidCommitPrefix,
    isValidWorkBranch,
    DEFAULT_COMMIT_PREFIX,
    DEFAULT_WORK_BRANCH,
    DEFAULT_LOG_RETENTION_DAYS,
    MAX_LINKED_REPOS,
    MODES,
    BUILD_PHASES,
    GATE_PHASES,
    SKIPPABLE_PHASES,
    ALLOW_KEYS,
    DESIGN_FORMATS,
    DEFAULT_DESIGN_FORMAT,
    ON_FAIL_PATTERN,
    DEFAULT_QA_ON_FAIL,
    DEFAULT_SECURITY_ON_FAIL,
    SECURITY_REVIEW_CHOICES,
    DEFAULT_SECURITY_REVIEW,
    BRAINSTORM_PHASES,
    AI_PROVIDERS,
    CODEX_MODEL_PATTERN,
    CODEX_EFFORT_LEVELS,
    DEFAULT_CODEX_MODEL,
    DEFAULT_CODEX_EFFORT,
    RUNNERS,
    DEFAULT_RUNNER,
    DEBATE_DEFAULT_TURNS,
    DEBATE_TURNS_LIMIT,
    MAX_RUN_DAYS
};

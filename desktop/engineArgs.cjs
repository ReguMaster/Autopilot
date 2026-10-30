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
const GATE_PHASES = ["plan", "design"];
const ALLOW_KEYS = ["deps", "large", "external-api", "send"];
const DESIGN_FORMATS = ["md", "html", "figma", "image"];
const DEFAULT_DESIGN_FORMAT = "html";
// 테스트/QA·보안검토가 fail이면 개발로 되돌리는 횟수(stop은 되돌리지 않고 멈춤). 두 단계가 같은 형식을 쓴다.
const ON_FAIL_PATTERN = /^(stop|retry:[1-5])$/;
const DEFAULT_QA_ON_FAIL = "retry:3";
const DEFAULT_SECURITY_ON_FAIL = "retry:3";
// 여러 AI 브레인스토밍을 켤 수 있는 단계와 Claude와 함께 안을 내는 제공자(엔진 config.js의 BRAINSTORM_PHASES·BRAINSTORM_PROVIDERS).
const BRAINSTORM_PHASES = ["plan", "design"];
const BRAINSTORM_PROVIDERS = ["codex"];
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

// 신규 개발 인자는 mode가 build일 때만 붙인다. 엔진 기본값(확인받기·허용 없음, html, retry:3)과 같으면 생략한다.
const getBuildArgs = ({ mode, gates = [], allow = [], designFormat, qaOnFail, securityOnFail, brainstorm = [], crossReview = false, debate = [] }) => {
    if (mode !== "build") {
        return [];
    }

    const args = ["--mode", "build"];

    if (gates.length) {
        args.push("--gate", gates.join(","));
    }

    if (allow.length) {
        args.push("--allow", allow.join(","));
    }

    if (designFormat && designFormat !== DEFAULT_DESIGN_FORMAT) {
        args.push("--design-format", designFormat);
    }

    if (qaOnFail && qaOnFail !== DEFAULT_QA_ON_FAIL) {
        args.push("--qa-on-fail", qaOnFail);
    }

    if (securityOnFail && securityOnFail !== DEFAULT_SECURITY_ON_FAIL) {
        args.push("--security-on-fail", securityOnFail);
    }

    // 다른 AI에게 프로젝트 내용을 보내므로 보내기를 허용했을 때만 넘긴다. 제공자는 엔진 기본값(codex)이다.
    // 협의 단계는 :debate를 붙이고, 교차검토는 나란히 비교하는 단계가 있을 때만 넘긴다(엔진이 그 밖에는 거부한다).
    if (brainstorm.length && allow.includes("send")) {
        const hasCompare = brainstorm.some((phase) => !debate.includes(phase));

        args.push("--brainstorm", brainstorm.map((phase) => (debate.includes(phase) ? `${phase}:debate` : phase)).join(","), ...(crossReview && hasCompare ? ["--cross-review"] : []));
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

    args.push(...getBuildArgs(buildOptions));

    if (configDir) {
        args.push("--config-dir", configDir);
    }

    return args;
};

module.exports = {
    getCliArgs,
    getEndTimeError,
    isValidCommitPrefix,
    isValidWorkBranch,
    DEFAULT_COMMIT_PREFIX,
    DEFAULT_WORK_BRANCH,
    DEFAULT_LOG_RETENTION_DAYS,
    MAX_LINKED_REPOS,
    MODES,
    GATE_PHASES,
    ALLOW_KEYS,
    DESIGN_FORMATS,
    DEFAULT_DESIGN_FORMAT,
    ON_FAIL_PATTERN,
    DEFAULT_QA_ON_FAIL,
    DEFAULT_SECURITY_ON_FAIL,
    BRAINSTORM_PHASES,
    BRAINSTORM_PROVIDERS,
    MAX_RUN_DAYS
};

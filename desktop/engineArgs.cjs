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

// 종료 시각·한도 연장·연장 상한·커밋 접두어·작업 브랜치·보관 기간·연결 저장소·계정 폴더는 있을 때만(기본값과 다를 때만) 붙인다.
const getCliArgs = ({ projectDir, tasksFile, endTime, policy, extendOnLimit, extendLimitMinutes, commitPrefix, workBranch, logRetentionDays, linkedRepos = [], model, effort, configDir }) => {
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

    if (configDir) {
        args.push("--config-dir", configDir);
    }

    return args;
};

module.exports = { getCliArgs, isValidCommitPrefix, isValidWorkBranch, DEFAULT_COMMIT_PREFIX, DEFAULT_WORK_BRANCH, DEFAULT_LOG_RETENTION_DAYS, MAX_LINKED_REPOS };

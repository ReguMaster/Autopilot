import {
    ALLOW_KEYS,
    BRAINSTORM_PHASES,
    BRAINSTORM_PROVIDERS,
    PROVIDER_CLAUDE,
    DESIGN_FORMATS,
    EFFORT_LEVELS,
    GATE_PHASES,
    MAX_EXTEND_MINUTES,
    MAX_LINKED_REPOS,
    MAX_LOG_RETENTION_DAYS,
    MAX_FAIL_RETRIES,
    MODE_BUILD,
    MODES,
    MODEL_CHOICES
} from "./config.js";
import phaseUtil from "./phaseUtil.js";
import settingsUtil from "./settingsUtil.js";
import util from "./util.js";

const HELP_TEXT = [
    "AutoPilot --project <dir> [--end-time HH:mm|'yyyy-MM-dd HH:mm'] [--policy auto|todo] [--tasks-file <file>] [--model opus|claude-opus-4-8] [--effort high] [--config-dir .claude] [--extend-on-limit] [--max-extend-minutes N] [--commit-prefix <접두어>] [--branch <브랜치>] [--log-retention-days N] [--link-project <dir>]... [--mode maintain|build] [--gate plan,design] [--allow deps,large,external-api,send] [--design-format md|html|figma|image] [--qa-on-fail stop|retry:N] [--security-on-fail stop|retry:N] [--brainstorm plan,design] [--brainstorm-with codex] [--cross-review] [--no-open]",
    "AutoPilot set --project <dir> [--model opus] [--effort high]",
    "AutoPilot stop|status|reset-progress --project <dir>",
    "AutoPilot approve --project <dir> [--pick claude|codex]"
].join("\n");

const PROJECT_OPTION_KEYS = { "--project": "projectDir" };
const SET_OPTION_KEYS = { ...PROJECT_OPTION_KEYS, "--model": "model", "--effort": "effort" };
const RUN_OPTION_KEYS = {
    ...SET_OPTION_KEYS,
    "--config-dir": "configDir",
    "--end-time": "endTime",
    "--policy": "policy",
    "--tasks-file": "tasksFile",
    "--max-extend-minutes": "maxExtendMinutes",
    "--commit-prefix": "commitPrefix",
    "--branch": "workBranch",
    "--log-retention-days": "logRetentionDays",
    "--mode": "mode",
    "--gate": "gates",
    "--allow": "allow",
    "--design-format": "designFormat",
    "--qa-on-fail": "qaOnFail",
    "--security-on-fail": "securityOnFail",
    "--brainstorm": "brainstorm",
    "--brainstorm-with": "brainstormWith"
};
const APPROVE_OPTION_KEYS = { ...PROJECT_OPTION_KEYS, "--pick": "pick" };
// 신규 개발에서만 뜻이 있는 인자
const BUILD_OPTION_KEYS = ["gates", "allow", "designFormat", "qaOnFail", "securityOnFail", "brainstorm", "brainstormWith", "crossReview"];
// 실패하면 개발로 되돌리는 단계의 인자와, 해석한 되돌림 횟수를 담을 옵션 키
const ON_FAIL_OPTIONS = [
    ["--qa-on-fail", "qaOnFail", "maxQaRetries"],
    ["--security-on-fail", "securityOnFail", "maxSecurityRetries"]
];
const LINK_PROJECT_OPTION = "--link-project";
const RUN_FLAGS = ["--no-open", "--extend-on-limit", "--cross-review"];

const parseOptionValue = (args, index) => {
    const value = args[index + 1];

    if (!value || value.startsWith("--")) {
        throw new Error(`${args[index]} 값이 필요합니다.`);
    }

    return value;
};

const assertModelAndEffort = (options) => {
    if (options.model && !util.isValidModel(options.model)) {
        throw new Error(`잘못된 model 값입니다 (${MODEL_CHOICES.join(" | ")} 또는 claude-로 시작하는 모델 ID).`);
    }

    if (options.effort && !EFFORT_LEVELS.includes(options.effort)) {
        throw new Error("잘못된 effort 값입니다.");
    }
};

const parseOptions = (args, optionKeys) => {
    const options = {};

    for (let index = 0; index < args.length; index++) {
        if (!Object.hasOwn(optionKeys, args[index])) {
            throw new Error(`알 수 없는 인자: ${args[index]}\n${HELP_TEXT}`);
        }

        options[optionKeys[args[index]]] = parseOptionValue(args, index);
        index++;
    }

    if (!options.projectDir) {
        throw new Error(`--project 값이 필요합니다.\n${HELP_TEXT}`);
    }

    assertModelAndEffort(options);

    return options;
};

// 사용량 한도 대기로 늘릴 수 있는 종료 시각의 총량(분)은 1 이상의 정수다.
const parseMaxExtendMinutes = (text) => {
    const minutes = Number(text);

    if (!/^\d+$/.test(text) || minutes < 1 || minutes > MAX_EXTEND_MINUTES) {
        throw new Error(`--max-extend-minutes 값은 1~${MAX_EXTEND_MINUTES} 사이의 정수여야 합니다.`);
    }

    return minutes;
};

// 로그·리포트 보관 기간(일)은 1 이상의 정수다.
const parseLogRetentionDays = (text) => {
    const days = Number(text);

    if (!/^\d+$/.test(text) || days < 1 || days > MAX_LOG_RETENTION_DAYS) {
        throw new Error(`--log-retention-days 값은 1~${MAX_LOG_RETENTION_DAYS} 사이의 정수여야 합니다.`);
    }

    return days;
};

// 쉼표로 고른 목록. 모르는 값과 중복은 거부한다.
const parseListOption = (optionName, text, choices) => {
    const items = text.split(",");

    if (items.some((item) => !choices.includes(item)) || new Set(items).size !== items.length) {
        throw new Error(`${optionName} 값은 ${choices.join(", ")} 중에서 쉼표로 고릅니다.`);
    }

    return items;
};

// 작업 모드와 신규 개발 인자. 신규 개발 인자를 유지 보수 모드에 주면 계약이 흐려지므로 거부한다.
const parseModeOptions = (options) => {
    if (options.mode !== undefined && !MODES.includes(options.mode)) {
        throw new Error(`--mode 값은 ${MODES.join(" | ")} 중 하나여야 합니다.`);
    }

    if (options.mode !== MODE_BUILD && BUILD_OPTION_KEYS.some((key) => options[key] !== undefined)) {
        throw new Error("--gate · --allow · --design-format · --qa-on-fail · --security-on-fail · --brainstorm · --brainstorm-with · --cross-review 는 --mode build 에서만 쓸 수 있습니다.");
    }

    if (options.gates !== undefined) {
        options.gates = parseListOption("--gate", options.gates, GATE_PHASES);
    }

    if (options.allow !== undefined) {
        options.allow = parseListOption("--allow", options.allow, ALLOW_KEYS);
    }

    if (options.brainstorm !== undefined) {
        options.brainstorm = parseListOption("--brainstorm", options.brainstorm, BRAINSTORM_PHASES);
    }

    if (options.brainstormWith !== undefined) {
        options.brainstormWith = parseListOption("--brainstorm-with", options.brainstormWith, BRAINSTORM_PROVIDERS);
    }

    if (!options.brainstorm && (options.brainstormWith || options.crossReview)) {
        throw new Error("--brainstorm-with · --cross-review 는 --brainstorm 과 함께 씁니다.");
    }

    if (options.designFormat !== undefined && !DESIGN_FORMATS.includes(options.designFormat)) {
        throw new Error(`--design-format 값은 ${DESIGN_FORMATS.join(" | ")} 중 하나여야 합니다.`);
    }

    for (const [optionName, key, retriesKey] of ON_FAIL_OPTIONS) {
        if (options[key] === undefined) {
            continue;
        }

        const maxRetries = phaseUtil.parseOnFail(options[key]);

        if (maxRetries === null) {
            throw new Error(`${optionName} 값은 stop 또는 retry:1~${MAX_FAIL_RETRIES} 이어야 합니다.`);
        }

        delete options[key];
        options[retriesKey] = maxRetries;
    }
};

// --link-project는 여러 번 쓸 수 있어 나머지 인자를 해석하기 전에 따로 뽑는다.
const extractLinkedProjects = (args) => {
    const linkedProjectDirs = [];
    const restArgs = [];

    for (let index = 0; index < args.length; index++) {
        if (args[index] === LINK_PROJECT_OPTION) {
            linkedProjectDirs.push(parseOptionValue(args, index));
            index++;
        } else {
            restArgs.push(args[index]);
        }
    }

    if (linkedProjectDirs.length > MAX_LINKED_REPOS) {
        throw new Error(`${LINK_PROJECT_OPTION}은 ${MAX_LINKED_REPOS}개까지 쓸 수 있습니다.`);
    }

    return { linkedProjectDirs: linkedProjectDirs, restArgs: restArgs };
};

const parseRunArgs = (args) => {
    const { linkedProjectDirs, restArgs } = extractLinkedProjects(args);
    const options = parseOptions(
        restArgs.filter((arg) => !RUN_FLAGS.includes(arg)),
        RUN_OPTION_KEYS
    );

    if (options.maxExtendMinutes !== undefined) {
        options.maxExtendMinutes = parseMaxExtendMinutes(options.maxExtendMinutes);
    }

    if (options.logRetentionDays !== undefined) {
        options.logRetentionDays = parseLogRetentionDays(options.logRetentionDays);
    }

    if (args.includes("--cross-review")) {
        options.crossReview = true;
    }

    settingsUtil.getGitSettings(options.commitPrefix, options.workBranch);
    parseModeOptions(options);

    return {
        ...options,
        ...(linkedProjectDirs.length && { linkedProjectDirs: linkedProjectDirs }),
        ...(args.includes("--no-open") && { open: false }),
        ...(args.includes("--extend-on-limit") && { extendOnLimit: true })
    };
};

// stop · status · reset-progress는 대상 프로젝트만 받는다.
const parseProjectArgs = (args) => {
    return parseOptions(args, PROJECT_OPTION_KEYS);
};

// approve는 여러 AI가 안을 낸 단계면 고른 안(--pick)도 받는다. 후보에 있는지는 단계 상태를 읽어 서비스가 확인한다.
const parseApproveArgs = (args) => {
    const options = parseOptions(args, APPROVE_OPTION_KEYS);

    if (options.pick !== undefined && ![PROVIDER_CLAUDE, ...BRAINSTORM_PROVIDERS].includes(options.pick)) {
        throw new Error(`--pick 값은 ${[PROVIDER_CLAUDE, ...BRAINSTORM_PROVIDERS].join(" | ")} 중 하나여야 합니다.`);
    }

    return options;
};

// 실행 중인 AutoPilot에 전달할 값이므로 프로젝트와 model·effort만 받는다.
const parseSetArgs = (args) => {
    const options = parseOptions(args, SET_OPTION_KEYS);

    if (!options.model && !options.effort) {
        throw new Error(`set에는 --model 또는 --effort가 필요합니다.\n${HELP_TEXT}`);
    }

    return options;
};

export default { HELP_TEXT, parseRunArgs, parseProjectArgs, parseApproveArgs, parseSetArgs };

import {
    AI_PROVIDERS,
    ALLOW_KEYS,
    BRAINSTORM_PHASES,
    BRAINSTORM_COMPARE,
    BRAINSTORM_DEBATE,
    BRAINSTORM_MODES,
    BUILD_PHASES,
    DEBATE_TURNS_LIMIT,
    CODEX_MODEL_PATTERN,
    CODEX_EFFORT_LEVELS,
    DESIGN_FORMATS,
    EFFORT_LEVELS,
    GATE_PHASES,
    MAX_EXTEND_MINUTES,
    MAX_LINKED_REPOS,
    MAX_LOG_RETENTION_DAYS,
    MAX_FAIL_RETRIES,
    MODE_BUILD,
    MODES,
    MODEL_CHOICES,
    RUNNERS,
    SECURITY_REVIEW_MODES,
    SKIPPABLE_PHASES
} from "./config.js";
import debateUtil from "./debateUtil.js";
import phaseUtil from "./phaseUtil.js";
import settingsUtil from "./settingsUtil.js";
import util from "./util.js";

const HELP_TEXT = [
    "AutoPilot --project <dir> [--end-time HH:mm|'yyyy-MM-dd HH:mm'] [--policy auto|todo] [--tasks-file <file>] [--model opus|claude-opus-4-8] [--effort high] [--runner claude|codex] [--config-dir .claude] [--codex-home <dir>] [--extend-on-limit] [--max-extend-minutes N] [--commit-prefix <접두어>] [--branch <브랜치>] [--log-retention-days N] [--link-project <dir>]... [--mode maintain|build] [--gate plan,design] [--allow deps,large,external-api,send] [--skip design,qa,security] [--design-format md|html|figma|image] [--qa-on-fail stop|retry:N] [--security-on-fail stop|retry:N] [--main plan=claude|codex,design=...,build=...,qa=...,security=...] [--brainstorm plan[:compare|:debate],design[:compare|:debate]] [--codex-model gpt-6.1-sol] [--codex-effort high] [--debate-turns N] [--cross-review] [--security-review on|strict] [--no-open]",
    "AutoPilot set --project <dir> [--model opus] [--effort high] [--runner claude|codex] [--codex-model gpt-6.1-sol] [--codex-effort high]",
    "AutoPilot stop|status|reset-progress --project <dir>",
    "AutoPilot approve --project <dir> [--pick claude|codex] [--resolve d1=claude|codex,...]",
    "AutoPilot cancel-build --project <dir> [--restore state|phase|all]"
].join("\n");

const PROJECT_OPTION_KEYS = { "--project": "projectDir" };
const SET_OPTION_KEYS = { ...PROJECT_OPTION_KEYS, "--model": "model", "--effort": "effort", "--runner": "runner", "--codex-model": "codexModel", "--codex-effort": "codexEffort" };
const RUN_OPTION_KEYS = {
    ...SET_OPTION_KEYS,
    "--config-dir": "configDir",
    "--codex-home": "codexHome",
    "--end-time": "endTime",
    "--policy": "policy",
    "--tasks-file": "tasksFile",
    "--max-extend-minutes": "maxExtendMinutes",
    "--commit-prefix": "commitPrefix",
    "--branch": "workBranch",
    "--log-retention-days": "logRetentionDays",
    "--mode": "mode",
    "--gate": "gates",
    "--skip": "skip",
    "--allow": "allow",
    "--design-format": "designFormat",
    "--qa-on-fail": "qaOnFail",
    "--security-on-fail": "securityOnFail",
    "--security-review": "securityReview",
    "--main": "mains",
    "--brainstorm": "brainstorm",
    "--debate-turns": "debateTurns"
};
const APPROVE_OPTION_KEYS = { ...PROJECT_OPTION_KEYS, "--pick": "pick", "--resolve": "resolve" };
const CANCEL_OPTION_KEYS = { ...PROJECT_OPTION_KEYS, "--restore": "scope" };
// 신규 개발에서만 뜻이 있는 인자. Codex의 model·effort는 Codex가 회차를 돌릴 때(--runner codex)도 쓴다.
const BUILD_OPTION_KEYS = ["gates", "skip", "allow", "designFormat", "qaOnFail", "securityOnFail", "mains", "brainstorm", "debateTurns", "crossReview", "securityReview"];
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

// 회차 실행 값. Codex의 model·effort는 비우지 못하고 늘 값을 지정한다.
const parseRoundOptions = (options) => {
    if (options.model && !util.isValidModel(options.model)) {
        throw new Error(`잘못된 model 값입니다 (${MODEL_CHOICES.join(" | ")} 또는 claude-로 시작하는 모델 ID).`);
    }

    if (options.effort && !EFFORT_LEVELS.includes(options.effort)) {
        throw new Error("잘못된 effort 값입니다.");
    }

    if (options.runner !== undefined && !RUNNERS.includes(options.runner)) {
        throw new Error(`--runner 값은 ${RUNNERS.join(" | ")} 중 하나여야 합니다.`);
    }

    if (options.codexModel !== undefined && !CODEX_MODEL_PATTERN.test(options.codexModel)) {
        throw new Error("--codex-model 값은 영문으로 시작하는 Codex 모델 이름이어야 합니다 (예: gpt-6.1-sol).");
    }

    if (options.codexEffort !== undefined && !CODEX_EFFORT_LEVELS.includes(options.codexEffort)) {
        throw new Error(`--codex-effort 값은 ${CODEX_EFFORT_LEVELS.join(" | ")} 중 하나여야 합니다.`);
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

    parseRoundOptions(options);

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

// 협의에서 주고받는 최대 횟수는 1 이상의 정수다.
const parseDebateTurns = (text) => {
    const turns = Number(text);

    if (!/^\d+$/.test(text) || turns < 1 || turns > DEBATE_TURNS_LIMIT) {
        throw new Error(`--debate-turns 값은 1~${DEBATE_TURNS_LIMIT} 사이의 정수여야 합니다.`);
    }

    return turns;
};

// 쉼표로 고른 목록. 모르는 값과 중복은 거부한다.
const parseListOption = (optionName, text, choices) => {
    const items = text.split(",");

    if (items.some((item) => !choices.includes(item)) || new Set(items).size !== items.length) {
        throw new Error(`${optionName} 값은 ${choices.join(", ")} 중에서 쉼표로 고릅니다.`);
    }

    return items;
};

// --brainstorm 값. 단계마다 :compare(나란히 비교, 기본) 또는 :debate(협의)를 붙인다. 협의 단계는 options.debate에 따로 담는다.
const parseBrainstormOption = (options) => {
    const entries = options.brainstorm.split(",").map((item) => item.split(":"));
    const isValid = entries.every(([phase, mode = BRAINSTORM_COMPARE, ...rest]) => BRAINSTORM_PHASES.includes(phase) && BRAINSTORM_MODES.includes(mode) && !rest.length);
    const phases = entries.map(([phase]) => phase);

    if (!isValid || new Set(phases).size !== phases.length) {
        throw new Error(`--brainstorm 값은 ${BRAINSTORM_PHASES.join(", ")} 중에서 쉼표로 고르고, 단계마다 :${BRAINSTORM_MODES.join(" 또는 :")}를 붙일 수 있습니다.`);
    }

    const debate = entries.filter(([, mode]) => mode === BRAINSTORM_DEBATE).map(([phase]) => phase);

    options.brainstorm = phases;

    if (debate.length) {
        options.debate = debate;
    }
};

// --main 값. 단계마다 그 단계의 회차를 돌릴 AI를 phase=claude|codex로 고르고, 없는 단계는 --runner(기본 claude)가 메인이다.
const parseMainOption = (options) => {
    const entries = options.mains.split(",").map((item) => item.split("="));
    const phases = entries.map(([phase]) => phase);
    const isValid = entries.every(([phase, provider, ...rest]) => BUILD_PHASES.includes(phase) && AI_PROVIDERS.includes(provider) && !rest.length);

    if (!isValid || new Set(phases).size !== phases.length) {
        throw new Error(`--main 값은 ${BUILD_PHASES.join(" | ")} 중 단계마다 =${AI_PROVIDERS.join("|")}를 붙여 쉼표로 잇습니다 (예: plan=codex,design=claude).`);
    }

    options.mains = Object.fromEntries(entries);
};

// 건너뛰는 단계에 그 단계의 확인받기 · 보조 · 형식 · 되돌림 설정을 함께 주면 계약이 흐려지므로 거부한다(앱은 건너뛰는 단계의 설정을 빼고 보낸다).
const parseSkipConflicts = (options) => {
    for (const phase of options.skip) {
        const conflicts = [
            options.gates?.includes(phase) && `--gate ${phase}`,
            options.brainstorm?.includes(phase) && `--brainstorm ${phase}`,
            phase === "design" && options.designFormat !== undefined && "--design-format",
            phase === "qa" && options.qaOnFail !== undefined && "--qa-on-fail",
            phase === "security" && options.securityOnFail !== undefined && "--security-on-fail",
            phase === "security" && options.securityReview && "--security-review"
        ].filter(Boolean);

        if (conflicts.length) {
            throw new Error(`--skip ${phase} 는 ${conflicts.join(", ")} 와 함께 쓸 수 없습니다(건너뛰는 단계는 설정하지 않습니다).`);
        }
    }
};

// 작업 모드와 신규 개발 인자. 신규 개발 인자를 유지 보수 모드에 주면 계약이 흐려지므로 거부한다.
const parseModeOptions = (options) => {
    if (options.mode !== undefined && !MODES.includes(options.mode)) {
        throw new Error(`--mode 값은 ${MODES.join(" | ")} 중 하나여야 합니다.`);
    }

    if (options.mode !== MODE_BUILD && BUILD_OPTION_KEYS.some((key) => options[key] !== undefined)) {
        throw new Error(
            "--gate · --skip · --allow · --design-format · --qa-on-fail · --security-on-fail · --main · --brainstorm · --debate-turns · --cross-review · --security-review 는 --mode build 에서만 쓸 수 있습니다."
        );
    }

    if (options.mains !== undefined) {
        parseMainOption(options);
    }

    const usesCodex = options.runner === "codex" || Object.values(options.mains ?? {}).includes("codex") || Boolean(options.brainstorm) || Boolean(options.securityReview);

    if ((options.codexModel !== undefined || options.codexEffort !== undefined) && !usesCodex) {
        throw new Error("--codex-model · --codex-effort 는 --runner codex 나 --main · --brainstorm 과 함께 씁니다.");
    }

    if (options.gates !== undefined) {
        options.gates = parseListOption("--gate", options.gates, GATE_PHASES);
    }

    if (options.allow !== undefined) {
        options.allow = parseListOption("--allow", options.allow, ALLOW_KEYS);
    }

    if (options.brainstorm !== undefined) {
        parseBrainstormOption(options);
    }

    if (options.debateTurns !== undefined) {
        options.debateTurns = parseDebateTurns(options.debateTurns);
    }

    if (!options.brainstorm && (options.debateTurns || options.crossReview)) {
        throw new Error("--debate-turns · --cross-review 는 --brainstorm 과 함께 씁니다.");
    }

    if (options.debateTurns && !options.debate) {
        throw new Error("--debate-turns 는 협의(:debate)하는 단계가 있을 때만 씁니다.");
    }

    // 협의는 이미 서로 검토하므로 교차검토는 나란히 비교하는 단계가 있을 때만 쓴다.
    if (options.crossReview && options.brainstorm.every((phase) => options.debate?.includes(phase))) {
        throw new Error("--cross-review 는 나란히 비교(compare)하는 단계가 있을 때만 씁니다.");
    }

    if (options.securityReview !== undefined && !SECURITY_REVIEW_MODES.includes(options.securityReview)) {
        throw new Error(`--security-review 값은 ${SECURITY_REVIEW_MODES.join(" | ")} 중 하나여야 합니다.`);
    }

    if (options.designFormat !== undefined && !DESIGN_FORMATS.includes(options.designFormat)) {
        throw new Error(`--design-format 값은 ${DESIGN_FORMATS.join(" | ")} 중 하나여야 합니다.`);
    }

    if (options.skip !== undefined) {
        options.skip = parseListOption("--skip", options.skip, SKIPPABLE_PHASES);
        parseSkipConflicts(options);
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

// approve는 여러 AI가 안을 낸 단계면 고른 안(--pick)을, 협의한 단계면 쟁점마다 고른 쪽(--resolve)을 받는다. 후보·쟁점에 맞는지는 단계 상태를 읽어 서비스가 확인한다.
const parseApproveArgs = (args) => {
    const options = parseOptions(args, APPROVE_OPTION_KEYS);

    if (options.pick !== undefined && !AI_PROVIDERS.includes(options.pick)) {
        throw new Error(`--pick 값은 ${AI_PROVIDERS.join(" | ")} 중 하나여야 합니다.`);
    }

    if (options.resolve !== undefined) {
        const resolutions = debateUtil.parseResolutions(options.resolve);

        if (!resolutions) {
            throw new Error(`--resolve 값은 d1=${AI_PROVIDERS.join("|")} 꼴을 쉼표로 이어 씁니다(쟁점마다 한 번).`);
        }

        options.resolve = resolutions;
    }

    if (options.pick !== undefined && options.resolve !== undefined) {
        throw new Error("--pick 과 --resolve 는 함께 쓸 수 없습니다.");
    }

    return options;
};

// cancel-build의 복구 범위(--restore, 기본 state). 값 검사는 서비스가 한다.
const parseCancelArgs = (args) => {
    return parseOptions(args, CANCEL_OPTION_KEYS);
};

// 실행 중인 AutoPilot에 전달할 값이므로 프로젝트와 회차 실행 값(실행 에이전트, Claude·Codex의 model·effort)만 받는다.
const parseSetArgs = (args) => {
    const options = parseOptions(args, SET_OPTION_KEYS);

    if (["model", "effort", "runner", "codexModel", "codexEffort"].every((key) => options[key] === undefined)) {
        throw new Error(`set에는 --model · --effort · --runner · --codex-model · --codex-effort 중 하나가 필요합니다.\n${HELP_TEXT}`);
    }

    return options;
};

export default { HELP_TEXT, parseRunArgs, parseProjectArgs, parseApproveArgs, parseCancelArgs, parseSetArgs };

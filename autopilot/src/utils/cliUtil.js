import { EFFORT_LEVELS, MAX_EXTEND_MINUTES, MAX_LINKED_REPOS, MAX_LOG_RETENTION_DAYS, MODEL_CHOICES } from "./config.js";
import settingsUtil from "./settingsUtil.js";
import util from "./util.js";

const HELP_TEXT = [
    "AutoPilot --project <dir> [--end-time HH:mm] [--policy auto|todo] [--tasks-file <file>] [--model opus|claude-opus-4-8] [--effort high] [--config-dir .claude] [--extend-on-limit] [--max-extend-minutes N] [--commit-prefix <접두어>] [--branch <브랜치>] [--log-retention-days N] [--link-project <dir>]... [--no-open]",
    "AutoPilot set --project <dir> [--model opus] [--effort high]",
    "AutoPilot stop|status|reset-progress --project <dir>"
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
    "--log-retention-days": "logRetentionDays"
};
const LINK_PROJECT_OPTION = "--link-project";
const RUN_FLAGS = ["--no-open", "--extend-on-limit"];

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

    settingsUtil.getGitSettings(options.commitPrefix, options.workBranch);

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

// 실행 중인 AutoPilot에 전달할 값이므로 프로젝트와 model·effort만 받는다.
const parseSetArgs = (args) => {
    const options = parseOptions(args, SET_OPTION_KEYS);

    if (!options.model && !options.effort) {
        throw new Error(`set에는 --model 또는 --effort가 필요합니다.\n${HELP_TEXT}`);
    }

    return options;
};

export default { HELP_TEXT, parseRunArgs, parseProjectArgs, parseSetArgs };

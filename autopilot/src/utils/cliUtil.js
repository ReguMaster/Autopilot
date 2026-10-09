import { EFFORT_LEVELS, MODEL_CHOICES } from "./config.js";

const HELP_TEXT = [
    "AutoPilot --project <dir> [--end-time HH:mm] [--policy auto|todo] [--tasks-file <file>] [--model opus] [--effort high] [--config-dir .claude] [--no-open]",
    "AutoPilot set --project <dir> [--model opus] [--effort high]",
    "AutoPilot stop|status|reset-progress --project <dir>"
].join("\n");

const PROJECT_OPTION_KEYS = { "--project": "projectDir" };
const SET_OPTION_KEYS = { ...PROJECT_OPTION_KEYS, "--model": "model", "--effort": "effort" };
const RUN_OPTION_KEYS = { ...SET_OPTION_KEYS, "--config-dir": "configDir", "--end-time": "endTime", "--policy": "policy", "--tasks-file": "tasksFile" };

const parseOptionValue = (args, index) => {
    const value = args[index + 1];

    if (!value || value.startsWith("--")) {
        throw new Error(`${args[index]} 값이 필요합니다.`);
    }

    return value;
};

const assertModelAndEffort = (options) => {
    if (options.model && !MODEL_CHOICES.includes(options.model)) {
        throw new Error(`잘못된 model 값입니다 (${MODEL_CHOICES.join(" | ")}).`);
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

const parseRunArgs = (args) => {
    const options = parseOptions(
        args.filter((arg) => arg !== "--no-open"),
        RUN_OPTION_KEYS
    );

    return args.includes("--no-open") ? { ...options, open: false } : options;
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

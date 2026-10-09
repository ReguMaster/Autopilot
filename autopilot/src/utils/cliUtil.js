import { EFFORT_LEVELS, MODEL_CHOICES } from "./config.js";

const HELP_TEXT =
    "AutoPilot [HH:mm] [auto|todo] [--config-dir .claude] [--model opus] [--effort high] [--no-open]\nAutoPilot set [--model opus] [--effort high]\nAutoPilot stop\nAutoPilot status\nAutoPilot --version";
const USAGE_TEXT = "사용법: autopilot [HH:mm] [auto|todo]";
const STOP_USAGE_TEXT = "사용법: autopilot stop";
const STATUS_USAGE_TEXT = "사용법: autopilot status";
const SET_USAGE_TEXT = "사용법: autopilot set [--model opus] [--effort high]";
const MAX_POSITIONAL_ARGS = 2;

const OPTION_KEYS = {
    "--config-dir": "configDir",
    "--model": "model",
    "--effort": "effort",
    "--end-time": "endTime",
    "--policy": "policy"
};

const SET_OPTION_KEYS = {
    "--model": "model",
    "--effort": "effort"
};

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

const parseCommandArgs = (args) => {
    const options = {};
    const positionalArgs = [];

    for (let index = 0; index < args.length; index++) {
        const arg = args[index];

        if (arg === "--no-open") {
            options.open = false;
        } else if (Object.hasOwn(OPTION_KEYS, arg)) {
            options[OPTION_KEYS[arg]] = parseOptionValue(args, index);
            index++;
        } else if (arg.startsWith("-")) {
            throw new Error(`알 수 없는 인자: ${arg}`);
        } else {
            positionalArgs.push(arg);
        }
    }

    if (positionalArgs.length > MAX_POSITIONAL_ARGS) {
        throw new Error(USAGE_TEXT);
    }

    options.endTime ??= positionalArgs[0];
    options.policy ??= positionalArgs[1];

    assertModelAndEffort(options);

    return options;
};

// 실행 중인 AutoPilot에 전달할 값이므로 model과 effort만 받는다.
const parseSetArgs = (args) => {
    const options = {};

    for (let index = 0; index < args.length; index++) {
        if (!Object.hasOwn(SET_OPTION_KEYS, args[index])) {
            throw new Error(SET_USAGE_TEXT);
        }

        options[SET_OPTION_KEYS[args[index]]] = parseOptionValue(args, index);
        index++;
    }

    if (!Object.keys(options).length) {
        throw new Error(SET_USAGE_TEXT);
    }

    assertModelAndEffort(options);

    return options;
};

export default { HELP_TEXT, STOP_USAGE_TEXT, STATUS_USAGE_TEXT, parseCommandArgs, parseSetArgs };

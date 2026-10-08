import { EFFORT_LEVELS } from "./config.js";

const HELP_TEXT = "AutoPilot [HH:mm] [auto|todo] [--config-dir .claude] [--effort high] [--no-open]\nAutoPilot stop";
const USAGE_TEXT = "사용법: autopilot [HH:mm] [auto|todo]";
const STOP_USAGE_TEXT = "사용법: autopilot stop";
const MAX_POSITIONAL_ARGS = 2;

const OPTION_KEYS = {
    "--config-dir": "configDir",
    "--effort": "effort",
    "--end-time": "endTime",
    "--policy": "policy"
};

const parseOptionValue = (args, index) => {
    const value = args[index + 1];

    if (!value || value.startsWith("--")) {
        throw new Error(`${args[index]} 값이 필요합니다.`);
    }

    return value;
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

    if (options.effort && !EFFORT_LEVELS.includes(options.effort)) {
        throw new Error("잘못된 effort 값입니다.");
    }

    return options;
};

export default { HELP_TEXT, STOP_USAGE_TEXT, parseCommandArgs };

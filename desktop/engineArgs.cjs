// 엔진 CLI(autopilot_loop.js)를 시작하는 인자. 인자와 값은 엔진 CLI 계약(루트 CLAUDE.md)과 같아야 한다.
const getCliArgs = ({ projectDir, tasksFile, endTime, policy, extendOnLimit, extendLimitMinutes, model, effort, configDir }) => {
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

    if (configDir) {
        args.push("--config-dir", configDir);
    }

    return args;
};

module.exports = { getCliArgs };

const { execFile } = require("node:child_process");

const POST_RUN_ACTIONS = ["none", "sleep", "shutdown"];
const ACTIVE_STATUSES = ["running", "stopping"];
const STOP_REQUESTED_REASON = "중단 요청";
const KILLED_REASON = "강제 종료";
const POWER_COMMAND_TIMEOUT_MS = 30000;
const WINDOWS_SLEEP_SCRIPT = "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState([System.Windows.Forms.PowerState]::Suspend, $false, $false) | Out-Null";

// 앱이 시작한 실행이 스스로 끝났을 때만 PC를 절전·종료한다. 직접 종료 신호를 보냈거나 강제 종료했거나 연결한 엔진이면 사용자가 곁에 있으므로 하지 않는다.
// 다른 프로젝트가 아직 실행 중이면(hasOtherActive) 마지막으로 끝나는 실행이 정한다.
const shouldRunPostAction = ({ previousStatus, state, action, isOwned, hasOtherActive = false }) => {
    return (
        POST_RUN_ACTIONS.includes(action) &&
        action !== "none" &&
        isOwned === true &&
        !hasOtherActive &&
        ACTIVE_STATUSES.includes(previousStatus) &&
        !ACTIVE_STATUSES.includes(state.status) &&
        state.reason !== KILLED_REASON &&
        !String(state.reason).startsWith(STOP_REQUESTED_REASON)
    );
};

// 셸을 거치지 않고 실행할 명령. Windows 절전은 SetSuspendState(Hibernate=0)가 최대 절전으로 빠질 수 있어 WinForms의 Suspend를 쓴다.
const getPowerCommand = (platform, action) => {
    const commands = {
        win32: { sleep: ["powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", WINDOWS_SLEEP_SCRIPT]], shutdown: ["shutdown.exe", ["/s", "/t", "0"]] },
        darwin: { sleep: ["pmset", ["sleepnow"]], shutdown: ["osascript", ["-e", 'tell application "System Events" to shut down']] },
        linux: { sleep: ["systemctl", ["suspend"]], shutdown: ["systemctl", ["poweroff"]] }
    };
    const found = commands[platform]?.[action];

    return found ? { command: found[0], args: found[1] } : null;
};

// 지정한 명령으로 절전·종료를 실행한다. 실패하면 이유를 담은 오류 메시지를 돌려주고, 성공하면 빈 문자열이다.
const runPowerAction = (platform, action) => {
    return new Promise((resolve) => {
        const power = getPowerCommand(platform, action);

        if (!power) {
            resolve("이 운영체제에서는 지원하지 않는 동작이에요.");

            return;
        }

        execFile(power.command, power.args, { windowsHide: true, timeout: POWER_COMMAND_TIMEOUT_MS }, (error) => resolve(error ? error.message : ""));
    });
};

// 실행이 끝난 뒤 곧바로 하지 않고 delayMs 동안 기다려 사용자가 취소할 수 있게 한다. 기다리는 동안의 상태(동작과 실행 시각)는 onChange로 알린다.
const createPostAction = ({ delayMs, run, onChange }) => {
    let pending = null;
    let timer = null;

    const clear = () => {
        clearTimeout(timer);

        timer = null;
        pending = null;
    };

    const execute = async () => {
        const { action } = pending;

        clear();
        onChange(null);

        await run(action);
    };

    const start = (action) => {
        clear();

        pending = { action: action, at: Date.now() + delayMs };
        timer = setTimeout(execute, delayMs);

        onChange(pending);
    };

    const cancel = () => {
        if (pending) {
            clear();
            onChange(null);
        }
    };

    const runNow = () => {
        if (pending) {
            clearTimeout(timer);

            return execute();
        }

        return Promise.resolve();
    };

    return { start: start, cancel: cancel, runNow: runNow, getPending: () => pending };
};

module.exports = { shouldRunPostAction, getPowerCommand, runPowerAction, createPostAction, POST_RUN_ACTIONS };

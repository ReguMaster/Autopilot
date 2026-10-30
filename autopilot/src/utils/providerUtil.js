import processUtil from "./processUtil.js";
import { PROVIDER_LABELS } from "./config.js";

// Claude와 따로 안을 내는 AI 제공자. 새 제공자는 실행 파일 이름과 인자만 더한다.
// 사용자 텍스트는 stdin으로만 넘겨 CMD 래퍼에서도 인자 검사를 통과한다. 최종 답변은 stdout으로 받는다(진행 표시는 stderr).
const PROVIDERS = {
    codex: { executable: "codex", statusArgs: ["login", "status"], askArgs: ["exec", "-s", "read-only", "--color", "never", "-"] }
};
const STATUS_TIMEOUT_MS = 15000;
const STOP_POLL_MS = 500;
// exit 뒤 stdout을 마저 읽는 시간. 손자 프로세스가 파이프를 물고 있어도 넘어간다.
const CLOSE_GRACE_MS = 1500;
const MAX_OUTPUT_LENGTH = 1000000;
const MAX_REASON_LENGTH = 160;

const getReason = (text) => {
    const lines = String(text || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

    return (lines.at(-1) || "").slice(0, MAX_REASON_LENGTH);
};

// 명령을 실행해 stdout을 모은다. 시한이 지나거나 중단 요청이 오면 프로세스 트리를 끝낸다. 실패해도 예외를 던지지 않는다.
const runCommand = (command, args, { cwd, processEnv, input = "", deadline, shouldStop = () => false, onProcessChange = () => {} }) => {
    return new Promise((resolve) => {
        let childProcess;

        try {
            childProcess = processUtil.spawnCommand(command, args, { cwd: cwd, env: processEnv, detached: process.platform !== "win32", windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
        } catch (error) {
            resolve({ error: error.message });

            return;
        }

        let stdout = "";
        let stderr = "";
        let stopReason = "";
        let exitCode = null;
        let isSettled = false;
        let graceTimer;

        const finish = (error) => {
            if (isSettled) {
                return;
            }

            isSettled = true;

            clearTimeout(deadlineTimer);
            clearInterval(stopTimer);
            clearTimeout(graceTimer);
            onProcessChange(null);
            resolve(error ? { error: error.message } : { exitCode: exitCode, stdout: stdout, stderr: stderr, stopReason: stopReason });
        };

        const stop = (reason) => {
            stopReason = stopReason || reason;

            try {
                processUtil.killProcessTree(childProcess);
            } catch {}
        };

        const deadlineTimer = setTimeout(() => stop("시간 초과"), Math.max(1, deadline - Date.now()));
        const stopTimer = setInterval(() => shouldStop() && stop("중단 요청"), STOP_POLL_MS);

        onProcessChange(childProcess);
        childProcess.stdout.setEncoding("utf8");
        childProcess.stderr.setEncoding("utf8");
        childProcess.stdout.on("data", (text) => {
            stdout = (stdout + text).slice(0, MAX_OUTPUT_LENGTH);
        });
        childProcess.stderr.on("data", (text) => {
            stderr = (stderr + text).slice(-MAX_OUTPUT_LENGTH);
        });
        childProcess.once("error", finish);
        childProcess.once("exit", (code) => {
            exitCode = code;
            graceTimer = setTimeout(() => finish(), CLOSE_GRACE_MS);
        });
        childProcess.once("close", (code) => {
            exitCode = exitCode ?? code;
            finish();
        });
        childProcess.stdin.on("error", () => {});
        childProcess.stdin.end(input, "utf8");
    });
};

// 실행 파일을 찾고 로그인돼 있는지 확인한다. 쓸 수 없으면 { error }. override는 검증용 가짜 실행 파일({ command, args })이다.
const checkProvider = async (name, { cwd, processEnv, override }) => {
    const label = PROVIDER_LABELS[name];
    let command;

    try {
        command = override?.command || processUtil.getExecutablePath(PROVIDERS[name].executable, processEnv);
    } catch {
        return { error: `${label}를 찾지 못했습니다` };
    }

    const baseArgs = override?.args || [];
    const status = await runCommand(command, [...baseArgs, ...PROVIDERS[name].statusArgs], { cwd: cwd, processEnv: processEnv, deadline: Date.now() + STATUS_TIMEOUT_MS });

    if (status.error || status.exitCode !== 0) {
        return { error: `${label} 로그인이 필요합니다` };
    }

    return { command: command, baseArgs: baseArgs };
};

// 프롬프트를 보내고 최종 답변을 받는다. 앞뒤를 감싼 코드 블록 표시 하나는 걷어낸다.
const askProvider = async (name, ready, prompt, options) => {
    const result = await runCommand(ready.command, [...ready.baseArgs, ...PROVIDERS[name].askArgs], { ...options, input: prompt });

    if (result.error || result.stopReason) {
        return { error: result.error || result.stopReason };
    }

    if (result.exitCode !== 0) {
        return { error: getReason(result.stderr) || `종료 코드 ${result.exitCode}` };
    }

    const text = result.stdout.trim().replace(/^```[\w-]*\n([\s\S]*)\n```$/, "$1");

    return text ? { text: text } : { error: "빈 답변" };
};

export default { PROVIDERS, checkProvider, askProvider };

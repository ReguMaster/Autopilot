import processUtil from "./processUtil.js";
import { PROVIDER_LABELS } from "./config.js";

// Claude와 따로 안을 내는 AI 제공자. 새 제공자는 실행 파일 이름과 인자만 더한다.
// 사용자 텍스트는 stdin으로만 넘겨 CMD 래퍼에서도 인자 검사를 통과한다. 최종 답변은 stdout으로 받는다(진행 표시는 stderr).
// 협의는 같은 대화를 이어 가야 하므로 stderr 머리말의 세션 아이디로 resume한다. resume은 -s를 받지 않아 설정 덮어쓰기로 읽기 전용을 건다.
const PROVIDERS = {
    codex: {
        executable: "codex",
        statusArgs: ["login", "status"],
        askArgs: ["exec", "-s", "read-only", "--color", "never", "-"],
        getResumeArgs: (sessionId) => ["exec", "resume", sessionId, "-c", "sandbox_mode=read-only", "-"],
        sessionPattern: /^session id: ([0-9a-f-]{36})$/im
    }
};
const SESSION_ID_PATTERN = /^[0-9a-f-]{36}$/i;
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
// sessionId를 주면 그 대화를 잇는다. 돌려주는 sessionId는 다음 발언에 쓴다(못 찾으면 null).
const askProvider = async (name, ready, prompt, options, sessionId = null) => {
    const provider = PROVIDERS[name];
    const args = sessionId && SESSION_ID_PATTERN.test(sessionId) ? provider.getResumeArgs(sessionId) : provider.askArgs;
    const result = await runCommand(ready.command, [...ready.baseArgs, ...args], { ...options, input: prompt });

    if (result.error || result.stopReason) {
        return { error: result.error || result.stopReason };
    }

    if (result.exitCode !== 0) {
        return { error: getReason(result.stderr) || `종료 코드 ${result.exitCode}` };
    }

    const text = result.stdout.trim().replace(/^```[\w-]*\n([\s\S]*)\n```$/, "$1");

    return text ? { text: text, sessionId: provider.sessionPattern.exec(result.stderr)?.[1] || null } : { error: "빈 답변" };
};

// 협의의 Claude 발언. 도구 · 사용자 설정 · MCP 없이 짧게 묻고 같은 대화를 --resume으로 잇는다. 답과 세션 아이디는 JSON 출력에서 읽는다.
const askClaude = async ({ command, baseArgs, model, extraArgs = [], sessionId }, prompt, options) => {
    const resumeArgs = sessionId && SESSION_ID_PATTERN.test(sessionId) ? ["--resume", sessionId] : [];
    const args = [
        ...baseArgs,
        "-p",
        "--output-format",
        "json",
        "--model",
        model,
        ...extraArgs,
        "--disable-slash-commands",
        "--tools=",
        "--setting-sources",
        "project",
        "--strict-mcp-config",
        ...resumeArgs
    ];
    const result = await runCommand(command, args, { ...options, input: prompt });

    if (result.error || result.stopReason) {
        return { error: result.error || result.stopReason };
    }

    let output;

    try {
        output = JSON.parse(result.stdout.trim());
    } catch {
        return { error: getReason(result.stderr) || `종료 코드 ${result.exitCode}` };
    }

    if (result.exitCode !== 0 || output?.is_error || typeof output?.result !== "string" || !output.result.trim()) {
        return { error: getReason(output?.result) || getReason(result.stderr) || `종료 코드 ${result.exitCode}` };
    }

    return { text: output.result, sessionId: typeof output.session_id === "string" ? output.session_id : null };
};

export default { PROVIDERS, checkProvider, askProvider, askClaude };

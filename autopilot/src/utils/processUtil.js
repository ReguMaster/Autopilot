import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { MAX_STDERR_LENGTH } from "./config.js";
import streamUtil from "./streamUtil.js";

const IS_WINDOWS = process.platform === "win32";
const WINDOWS_SCRIPT_PATTERN = /\.(cmd|bat)$/i;
const UNSAFE_CMD_PATH_PATTERN = /["\r\n%!]/;
const SAFE_CMD_ARG_PATTERN = /^[\w.=-]+$/;

const getSearchDirectories = (processEnv) => {
    const searchPath = Object.entries(processEnv).find(([key]) => key.toUpperCase() === "PATH")?.[1] || "";

    return searchPath.split(path.delimiter).map((directory) => directory.replace(/^"|"$/g, ""));
};

const getCandidateNames = (executableName, processEnv) => {
    if (path.extname(executableName)) {
        return [executableName];
    }

    const extensions = IS_WINDOWS ? (processEnv.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";") : [""];

    return extensions.map((extension) => executableName + extension.toLowerCase());
};

const isExecutableFile = (file) => {
    try {
        fs.accessSync(file, IS_WINDOWS ? fs.constants.F_OK : fs.constants.X_OK);

        return fs.statSync(file).isFile();
    } catch {
        return false;
    }
};

const getExecutablePath = (executableName, processEnv = process.env) => {
    const candidateNames = getCandidateNames(executableName, processEnv);

    for (const directory of getSearchDirectories(processEnv)) {
        for (const candidateName of candidateNames) {
            const executableFile = path.resolve(directory, candidateName);

            if (isExecutableFile(executableFile)) {
                return executableFile;
            }
        }
    }

    throw new Error(`PATH에서 ${executableName}를 찾지 못했습니다.`);
};

const spawnCommand = (command, args, options) => {
    if (!IS_WINDOWS || !WINDOWS_SCRIPT_PATTERN.test(command)) {
        return spawn(command, args, options);
    }

    // CMD 래퍼의 셸 해석을 피하도록 사용자 텍스트는 stdin으로만 전달한다.
    if (UNSAFE_CMD_PATH_PATTERN.test(command) || args.some((arg) => !SAFE_CMD_ARG_PATTERN.test(arg))) {
        throw new Error("CMD 실행 경로 또는 인자에 지원하지 않는 특수문자가 있습니다. 네이티브 Claude 설치본을 사용하세요.");
    }

    return spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `""${command}" ${args.join(" ")}"`], { ...options, windowsVerbatimArguments: true });
};

const killWindowsProcessTree = (childProcess) => {
    const result = spawnSync("taskkill", ["/PID", String(childProcess.pid), "/T", "/F"], { windowsHide: true, encoding: "utf8" });

    if (result.error) {
        throw result.error;
    }

    const isStillRunning = childProcess.exitCode === null && childProcess.signalCode === null;

    if (result.status && isStillRunning) {
        throw new Error(`프로세스 트리 종료 실패: PID ${childProcess.pid}: ${result.stderr?.trim()}`);
    }
};

const killPosixProcessGroup = (childProcess) => {
    try {
        process.kill(-childProcess.pid, "SIGKILL");
    } catch (error) {
        if (error.code !== "ESRCH") {
            throw error;
        }
    }
};

const killProcessTree = (childProcess) => {
    if (!childProcess?.pid) {
        return;
    }

    if (IS_WINDOWS) {
        killWindowsProcessTree(childProcess);
    } else {
        killPosixProcessGroup(childProcess);
    }
};

const isProcessRunning = (pid) => {
    if (!Number.isInteger(pid) || pid <= 0) {
        return false;
    }

    try {
        process.kill(pid, 0);

        return true;
    } catch (error) {
        return error.code === "EPERM";
    }
};

// 브라우저 등 기본 프로그램으로 파일을 연다. 열지 못해도 실행에는 영향을 주지 않는다.
const openFile = (file) => {
    if (process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
        return;
    }

    let command = "xdg-open";
    let args = [file];

    if (IS_WINDOWS) {
        command = "rundll32.exe";
        args = ["url.dll,FileProtocolHandler", file];
    } else if (process.platform === "darwin") {
        command = "open";
    }

    const childProcess = spawn(command, args, { detached: true, windowsHide: true, stdio: "ignore" });

    childProcess.on("error", () => {});
    childProcess.unref();
};

const runClaudeSession = (command, args, prompt, { projectDir, processEnv, roundDeadline, writeLog, sessionStats, onProcessChange }) => {
    return new Promise((resolve, reject) => {
        const childProcess = spawnCommand(command, args, { cwd: projectDir, env: processEnv, detached: !IS_WINDOWS, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
        let stderr = "";
        let timedOut = false;
        let isSettled = false;
        let timer;

        onProcessChange(childProcess);

        const lines = createInterface({ input: childProcess.stdout, crlfDelay: Infinity });

        lines.on("line", (line) => streamUtil.handleStreamEvent(line, sessionStats, writeLog));

        childProcess.stderr.setEncoding("utf8");
        childProcess.stderr.on("data", (text) => {
            stderr = (stderr + text).slice(-MAX_STDERR_LENGTH);
        });

        const finishSession = (error, exitCode) => {
            if (isSettled) {
                return;
            }

            isSettled = true;

            clearTimeout(timer);
            lines.close();
            childProcess.stdout.destroy();
            childProcess.stderr.destroy();
            onProcessChange(null);

            if (stderr.trim()) {
                writeLog(`[stderr] ${stderr.trim()}`);
            }

            if (error) {
                reject(error);
            } else {
                resolve({ exitCode: exitCode ?? -1, timedOut: timedOut, stderr: stderr.trim() });
            }
        };

        const handleTimeout = () => {
            timedOut = true;

            try {
                killProcessTree(childProcess);
            } catch (error) {
                finishSession(error);
            }
        };

        const handleStdinError = (error) => {
            if (error.code === "EPIPE") {
                return;
            }

            try {
                killProcessTree(childProcess);
            } finally {
                finishSession(error);
            }
        };

        timer = setTimeout(handleTimeout, Math.max(1, roundDeadline - Date.now()));

        childProcess.once("error", (error) => finishSession(error));

        // CLI가 끝나면 손자 프로세스가 상속한 파이프의 EOF를 기다리지 않는다.
        childProcess.once("exit", (exitCode) => setImmediate(() => finishSession(null, exitCode)));

        childProcess.stdin.on("error", handleStdinError);
        childProcess.stdin.end(prompt, "utf8");
    });
};

export default { getExecutablePath, spawnCommand, killProcessTree, isProcessRunning, openFile, runClaudeSession };

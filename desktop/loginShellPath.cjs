const { spawn } = require("node:child_process");
const os = require("node:os");
const path = require("node:path");

const START_MARKER = "__AUTOPILOT_PATH_START__";
const END_MARKER = "__AUTOPILOT_PATH_END__";
const SHELL_TIMEOUT_MS = 5000;
const SHELL_COMMAND = `printf '%s' ${START_MARKER}; printenv PATH; printf '%s' ${END_MARKER}`;
const PATH_PATTERN = new RegExp(`${START_MARKER}([^]*?)${END_MARKER}`);

// 셸에서 PATH를 읽지 못했을 때를 위한 Claude Code의 흔한 설치 위치(네이티브 설치·옛 로컬 설치·npm 전역·Homebrew·Volta·Bun).
const getFallbackDirectories = (homeDir) => {
    return [
        path.join(homeDir, ".local", "bin"),
        path.join(homeDir, ".claude", "local"),
        path.join(homeDir, ".npm-global", "bin"),
        path.join(homeDir, ".volta", "bin"),
        path.join(homeDir, ".bun", "bin"),
        "/opt/homebrew/bin",
        "/usr/local/bin"
    ];
};

const getShell = (processEnv, platform) => {
    if (processEnv.SHELL) {
        return processEnv.SHELL;
    }

    try {
        return os.userInfo().shell || "";
    } catch {
        return platform === "darwin" ? "/bin/zsh" : "/bin/bash";
    }
};

// rc 파일이 배너를 찍어도 표식 사이만 읽는다.
const parseShellPath = (output) => {
    return PATH_PATTERN.exec(output)?.[1].trim() ?? "";
};

const mergePath = (...pathLists) => {
    const directories = pathLists.flatMap((pathList) => String(pathList || "").split(path.delimiter)).filter(Boolean);

    return [...new Set(directories)].join(path.delimiter);
};

// 로그인 셸(-l)이면서 대화형(-i)이어야 .zprofile과 .zshrc·.bashrc에서 넣는 PATH(nvm·Homebrew 등)가 모두 들어온다.
const runLoginShell = (shell, processEnv, timeoutMs) => {
    return new Promise((resolve) => {
        let output = "";
        let isSettled = false;

        const settle = (value) => {
            if (!isSettled) {
                isSettled = true;
                clearTimeout(timer);
                resolve(value);
            }
        };

        const child = spawn(shell, ["-ilc", SHELL_COMMAND], { env: { ...processEnv, DISABLE_AUTO_UPDATE: "true" }, stdio: ["ignore", "pipe", "ignore"] });
        const timer = setTimeout(() => {
            child.kill("SIGKILL");
            settle("");
        }, timeoutMs);

        child.stdout.on("data", (chunk) => {
            output += chunk;
        });
        child.on("error", () => settle(""));
        child.on("close", () => settle(output));
    });
};

// Finder·Dock으로 연 macOS 앱과 데스크톱 아이콘으로 연 Linux 앱은 터미널의 PATH를 받지 못해 claude를 찾지 못한다.
// 앱을 켤 때 한 번 로그인 셸의 PATH와 흔한 설치 위치를 현재 PATH 뒤에 합친다. 이 PATH는 엔진과 claude를 띄우는 모든 자식 프로세스가 이어받는다.
const applyLoginShellPath = async (options = {}) => {
    const processEnv = options.processEnv || process.env;
    const platform = options.platform || process.platform;

    if (platform === "win32") {
        return processEnv.PATH;
    }

    const shell = getShell(processEnv, platform);
    const shellPath = shell ? parseShellPath(await (options.runShell || runLoginShell)(shell, processEnv, options.timeoutMs || SHELL_TIMEOUT_MS)) : "";

    processEnv.PATH = mergePath(processEnv.PATH, shellPath, getFallbackDirectories(options.homeDir || os.homedir()).join(path.delimiter));

    return processEnv.PATH;
};

module.exports = { applyLoginShellPath, parseShellPath, mergePath, getFallbackDirectories, runLoginShell };

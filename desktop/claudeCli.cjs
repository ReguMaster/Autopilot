const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const IS_WINDOWS = process.platform === "win32";
const WINDOWS_SCRIPT_PATTERN = /\.(cmd|bat)$/i;
const UNSAFE_CMD_PATH_PATTERN = /["\r\n%!]/;
const AUTH_STATUS_TIMEOUT_MS = 20000;
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;
const LOGIN_URL_PATTERN = /https:\/\/[^\s"'<>]+(?=\s)/;
const LOGIN_URL_HOSTS = ["claude.com", "claude.ai", "anthropic.com"];
const LOGIN_CODE_PATTERN = /^[\w#.~-]{4,400}$/;
const LOGIN_OUTPUT_TAIL_LENGTH = 4000;

const isExecutableFile = (file) => {
    try {
        fs.accessSync(file, IS_WINDOWS ? fs.constants.F_OK : fs.constants.X_OK);

        return fs.statSync(file).isFile();
    } catch {
        return false;
    }
};

// claude 실행 파일을 PATH에서 찾는다. 네이티브 설치본(claude.exe)과 npm 설치본(claude.cmd)을 모두 받는다.
const findClaude = (processEnv = process.env) => {
    const searchPath = Object.entries(processEnv).find(([key]) => key.toUpperCase() === "PATH")?.[1] || "";
    const names = IS_WINDOWS ? ["claude.exe", "claude.cmd", "claude.bat"] : ["claude"];

    for (const directory of searchPath.split(path.delimiter).map((entry) => entry.replace(/^"|"$/g, ""))) {
        for (const name of names) {
            const file = path.resolve(directory, name);

            if (isExecutableFile(file)) {
                return file;
            }
        }
    }

    return "";
};

// 이 파일이 넘기는 인자는 고정 값뿐이라 CMD 래퍼도 안전하게 실행할 수 있다. 경로에 CMD가 해석하는 문자가 있으면 거부한다.
const spawnClaudeProcess = (launch, args, options) => {
    if (!IS_WINDOWS || !WINDOWS_SCRIPT_PATTERN.test(launch.command)) {
        return spawn(launch.command, [...launch.prefixArgs, ...args], options);
    }

    if (UNSAFE_CMD_PATH_PATTERN.test(launch.command)) {
        throw new Error("claude 실행 경로에 지원하지 않는 특수문자가 있어요. 네이티브 Claude 설치본을 사용해 주세요.");
    }

    return spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `""${launch.command}" ${args.join(" ")}"`], { ...options, windowsVerbatimArguments: true });
};

// 계정마다 설정 폴더가 다르므로 CLAUDE_CONFIG_DIR로 가리킨다. 앱 자신의 ELECTRON_RUN_AS_NODE와 부모 Claude 세션 표식은 넘기지 않는다.
const getClaudeEnv = (configDir) => {
    const env = { ...process.env, CLAUDE_CONFIG_DIR: configDir };

    delete env.ELECTRON_RUN_AS_NODE;
    delete env.CLAUDECODE;

    return env;
};

const getLaunch = (options = {}) => {
    const command = options.command || findClaude();

    return { command: command, prefixArgs: options.prefixArgs || [] };
};

const killProcessTree = (child) => {
    if (IS_WINDOWS) {
        spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
    } else {
        child.kill("SIGTERM");
    }
};

// 해당 설정 폴더의 로그인 상태를 `claude auth status --json`으로 읽는다. 토큰이 만료돼도 이메일·조직은 읽힌다.
const getAuthStatus = (configDir, options = {}) => {
    return new Promise((resolve) => {
        const launch = getLaunch(options);

        if (!launch.command) {
            resolve({ error: "claude 실행 파일을 PATH에서 찾지 못했어요. Claude Code를 먼저 설치해 주세요." });

            return;
        }

        const child = spawnClaudeProcess(launch, ["auth", "status", "--json"], { env: getClaudeEnv(configDir), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
        const timer = setTimeout(() => killProcessTree(child), AUTH_STATUS_TIMEOUT_MS);
        let stdout = "";

        child.stdout.on("data", (chunk) => {
            stdout += chunk;
        });
        child.on("error", (error) => {
            clearTimeout(timer);
            resolve({ error: error.message });
        });
        child.on("close", () => {
            clearTimeout(timer);

            try {
                const status = JSON.parse(stdout);

                resolve({ loggedIn: status.loggedIn === true, email: String(status.email || ""), orgName: String(status.orgName || ""), subscriptionType: String(status.subscriptionType || "") });
            } catch {
                resolve({ error: "로그인 상태를 읽지 못했어요." });
            }
        });
    });
};

const isLoginUrl = (text) => {
    try {
        const { protocol, hostname } = new URL(text);

        return protocol === "https:" && LOGIN_URL_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`));
    } catch {
        return false;
    }
};

// `claude auth login`을 실행한다. 브라우저는 CLI가 직접 열고, 열리지 않았을 때를 위해 출력의 로그인 주소를 알려준다.
// 브라우저가 코드를 보여 주면 submitCode로 CLI에 전달한다. 끝나면 로그인 상태를 다시 읽어 결과를 돌려준다.
const startLogin = (configDir, handlers, options = {}) => {
    const launch = getLaunch(options);

    if (!launch.command) {
        handlers.onFinish({ ok: false, message: "claude 실행 파일을 PATH에서 찾지 못했어요. Claude Code를 먼저 설치해 주세요." });

        return { submitCode: () => false, cancel: () => {} };
    }

    const child = spawnClaudeProcess(launch, ["auth", "login", "--claudeai"], { env: getClaudeEnv(configDir), windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let outputTail = "";
    let isCancelled = false;
    let isFinished = false;
    let url = "";

    const timer = setTimeout(() => {
        isCancelled = true;
        killProcessTree(child);
    }, LOGIN_TIMEOUT_MS);

    const finish = (result) => {
        if (isFinished) {
            return;
        }

        isFinished = true;
        clearTimeout(timer);
        handlers.onFinish(result);
    };

    const handleOutput = (chunk) => {
        outputTail = (outputTail + chunk).slice(-LOGIN_OUTPUT_TAIL_LENGTH);

        const found = LOGIN_URL_PATTERN.exec(outputTail)?.[0];

        if (!url && found && isLoginUrl(found)) {
            url = found;
            handlers.onUrl(url);
        }
    };

    child.stdout.on("data", handleOutput);
    child.stderr.on("data", handleOutput);
    child.stdin.on("error", () => {});
    child.on("error", (error) => finish({ ok: false, message: error.message }));
    child.on("close", async (code) => {
        if (isCancelled) {
            finish({ ok: false, cancelled: true, message: "로그인을 취소했어요." });

            return;
        }

        const status = code === 0 ? await getAuthStatus(configDir, options) : null;

        if (status?.loggedIn) {
            finish({ ok: true, email: status.email });
        } else {
            finish({ ok: false, message: code === 0 ? "로그인이 끝났지만 로그인 상태를 확인하지 못했어요." : `로그인에 실패했어요 (종료 코드 ${code}).` });
        }
    });

    return {
        submitCode: (code) => {
            if (isFinished || !LOGIN_CODE_PATTERN.test(code)) {
                return false;
            }

            child.stdin.write(`${code}\n`);

            return true;
        },
        cancel: () => {
            isCancelled = true;
            killProcessTree(child);
        },
        getUrl: () => url
    };
};

module.exports = { findClaude, getAuthStatus, startLogin, isLoginUrl, LOGIN_CODE_PATTERN };

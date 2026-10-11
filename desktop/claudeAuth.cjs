const { exec } = require("node:child_process");
const os = require("node:os");
const path = require("node:path");
const { STATUS_OK, STATUS_FAILED } = require("./autopilotRunner.cjs");

const CLAUDE_COMMAND = "claude";
const STATUS_TIMEOUT_MS = 15000;
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

const createFailure = (code, msg) => {
    return { status: STATUS_FAILED, error: { code: code, msg: msg } };
};

// 엔진은 세션의 CLAUDE_CONFIG_DIR을 ~/.claude로 고정하므로 같은 설정 폴더를 보고 확인해야 한다.
const getClaudeEnv = () => {
    const env = { ...process.env, CLAUDE_CONFIG_DIR: path.resolve(os.homedir(), ".claude") };

    delete env.ELECTRON_RUN_AS_NODE;

    return env;
};

// .cmd 래퍼 설치도 실행되도록 셸로 돌린다. 인자는 상수뿐이라 사용자 입력이 섞이지 않는다.
const execClaude = (claude, args, timeout) => {
    return new Promise((resolve) => {
        exec(`${claude} ${args}`, { windowsHide: true, timeout: timeout, encoding: "utf8", env: getClaudeEnv() }, (error, stdout, stderr) => {
            resolve({ error: error, stdout: stdout, stderr: stderr });
        });
    });
};

// 로그인하지 않았을 때 종료 코드가 0이 아닐 수 있어 종료 코드가 아니라 JSON 출력으로 판단한다.
const getAuthStatus = async (claude = CLAUDE_COMMAND) => {
    const { stdout } = await execClaude(claude, "auth status", STATUS_TIMEOUT_MS);

    try {
        const authStatus = JSON.parse(stdout);

        return { status: STATUS_OK, data: { loggedIn: authStatus.loggedIn === true, email: authStatus.email || "" } };
    } catch {
        return createFailure("CLAUDE_NOT_FOUND", "Claude Code의 로그인 상태를 확인하지 못했어요. claude가 설치돼 있고 PATH에 있는지 확인해 주세요.");
    }
};

// 시작해도 되면 null, 아니면 이유를 담은 실패를 돌려준다.
const getLoginError = async (claude = CLAUDE_COMMAND) => {
    const authResult = await getAuthStatus(claude);

    if (authResult.status !== STATUS_OK) {
        return authResult;
    }

    return authResult.data.loggedIn ? null : createFailure("LOGIN_REQUIRED", "Claude 로그인이 필요해요. 로그인한 뒤 다시 시작해 주세요.");
};

const runLoginFlow = async (claude) => {
    const { stderr } = await execClaude(claude, "auth login", LOGIN_TIMEOUT_MS);
    const loginError = await getLoginError(claude);

    if (!loginError) {
        return { status: STATUS_OK };
    }

    if (loginError.error.code === "CLAUDE_NOT_FOUND") {
        return loginError;
    }

    return createFailure("LOGIN_FAILED", stderr.trim() || "로그인을 완료하지 못했어요. 다시 시도해 주세요.");
};

// 브라우저 로그인은 한 번에 하나만 돌리고, 끝나면 상태를 다시 확인해 성공 여부를 돌려준다.
let loginPromise = null;

const runLogin = (claude = CLAUDE_COMMAND) => {
    if (!loginPromise) {
        loginPromise = runLoginFlow(claude).finally(() => {
            loginPromise = null;
        });
    }

    return loginPromise;
};

module.exports = { getAuthStatus, getLoginError, runLogin };

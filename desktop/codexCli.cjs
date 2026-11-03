const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { findExecutable, spawnClaudeProcess, killProcessTree } = require("./claudeCli.cjs");

const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;
const COMMAND_TIMEOUT_MS = 20000;
const LOGIN_URL_PATTERN = /https:\/\/[^\s"'<>]+(?=\s)/;
const LOGIN_URL_HOSTS = ["openai.com", "chatgpt.com"];
const LOGIN_OUTPUT_TAIL_LENGTH = 4000;
const AUTH_CLAIM = "https://api.openai.com/auth";
const PLAN_NAMES = { free: "Free", go: "Go", plus: "Plus", pro: "Pro", prolite: "Pro Lite", team: "Team", business: "Business", enterprise: "Enterprise", edu: "Edu" };

// 기본 계정은 환경 변수 CODEX_HOME, 없으면 사용자 폴더의 .codex다(Codex CLI의 규칙과 같다).
const getDefaultCodexHome = (processEnv = process.env) => {
    return processEnv.CODEX_HOME || path.join(os.homedir(), ".codex");
};

// 계정마다 CODEX_HOME이 다르다. 앱 자신의 ELECTRON_RUN_AS_NODE는 넘기지 않는다.
const getCodexEnv = (codexHome) => {
    const env = { ...process.env, CODEX_HOME: codexHome };

    delete env.ELECTRON_RUN_AS_NODE;

    return env;
};

const getLaunch = (options = {}) => {
    return { command: options.command || findExecutable("codex"), prefixArgs: options.prefixArgs || [] };
};

const getPlanName = (planType) => {
    const plan = String(planType || "").toLowerCase();

    return PLAN_NAMES[plan] || (plan ? plan[0].toUpperCase() + plan.slice(1) : "");
};

// auth.json의 id_token에서 이메일·이름·요금제만 읽는다. 토큰 자체는 이 함수 밖으로 내보내지 않는다. 읽지 못하면 null이다.
const readCodexIdentity = (codexHome) => {
    try {
        const auth = JSON.parse(fs.readFileSync(path.join(codexHome, "auth.json"), "utf8"));
        const idToken = auth?.tokens?.id_token;

        if (typeof idToken !== "string") {
            return auth?.OPENAI_API_KEY ? { name: "", email: "", plan: "API 키" } : null;
        }

        const claims = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8"));

        return {
            name: String(claims.name || "").trim(),
            email: String(claims.email || "").trim(),
            plan: getPlanName(claims[AUTH_CLAIM]?.chatgpt_plan_type)
        };
    } catch {
        return null;
    }
};

const runCodex = (args, codexHome, options = {}) => {
    return new Promise((resolve) => {
        const launch = getLaunch(options);

        if (!launch.command) {
            resolve({ error: "Codex가 설치돼 있지 않아요" });

            return;
        }

        let child;

        try {
            child = spawnClaudeProcess(launch, args, { env: getCodexEnv(codexHome), windowsHide: true, stdio: "ignore" });
        } catch (error) {
            resolve({ error: error.message });

            return;
        }

        const timer = setTimeout(() => killProcessTree(child), COMMAND_TIMEOUT_MS);

        child.once("error", (error) => {
            clearTimeout(timer);
            resolve({ error: error.message });
        });
        child.once("exit", (code) => {
            clearTimeout(timer);
            resolve({ code: code });
        });
    });
};

// 그 CODEX_HOME의 로그인 상태. 설치 여부는 installed, 로그인 여부는 `codex login status`의 종료 코드(키링에 둔 로그인도 맞게 본다)다.
const getCodexLoginStatus = async (codexHome, options = {}) => {
    const result = await runCodex(["login", "status"], codexHome, options);

    if (result.error) {
        return { installed: Boolean(getLaunch(options).command), loggedIn: false, error: result.error };
    }

    return { installed: true, loggedIn: result.code === 0, identity: result.code === 0 ? readCodexIdentity(codexHome) : null };
};

const isCodexLoginUrl = (text) => {
    try {
        const { protocol, hostname } = new URL(text);

        return protocol === "https:" && LOGIN_URL_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`));
    } catch {
        return false;
    }
};

// `codex login`을 실행한다. 브라우저는 CLI가 열고 로그인이 끝나면 CLI가 스스로 끝난다(코드 입력 없음). 열리지 않았을 때를 위해 출력의 로그인 주소를 알려준다.
const startCodexLogin = (codexHome, handlers, options = {}) => {
    const launch = getLaunch(options);

    if (!launch.command) {
        handlers.onFinish({ ok: false, message: "Codex가 설치돼 있지 않아요. Codex CLI를 먼저 설치해 주세요." });

        return { cancel: () => {} };
    }

    let child;

    try {
        child = spawnClaudeProcess(launch, ["login"], { env: getCodexEnv(codexHome), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
        handlers.onFinish({ ok: false, message: error.message });

        return { cancel: () => {} };
    }

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

        if (!url && found && isCodexLoginUrl(found)) {
            url = found;
            handlers.onUrl(url);
        }
    };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", handleOutput);
    child.stderr.on("data", handleOutput);
    child.on("error", (error) => finish({ ok: false, message: error.message }));
    child.on("close", async (code) => {
        if (isCancelled) {
            finish({ ok: false, cancelled: true, message: "로그인을 취소했어요." });

            return;
        }

        const status = code === 0 ? await getCodexLoginStatus(codexHome, options) : null;

        if (status?.loggedIn) {
            finish({ ok: true, email: status.identity?.email || "" });
        } else {
            finish({
                ok: false,
                message: code === 0 ? "로그인이 끝났지만 로그인 상태를 확인하지 못했어요." : `로그인에 실패했어요 (종료 코드 ${code}). 브라우저 로그인 창을 이미 열어 둔 것은 아닌지 확인해 주세요.`
            });
        }
    });

    return {
        cancel: () => {
            isCancelled = true;
            killProcessTree(child);
        },
        getUrl: () => url
    };
};

// `codex logout`으로 그 CODEX_HOME의 로그인 정보를 지우고, 정말 로그아웃됐는지 다시 확인한다.
const logoutCodex = async (codexHome, options = {}) => {
    const result = await runCodex(["logout"], codexHome, options);

    if (result.error) {
        return { ok: false, message: result.error };
    }

    const status = await getCodexLoginStatus(codexHome, options);

    return status.loggedIn ? { ok: false, message: "로그아웃하지 못했어요. 잠시 뒤 다시 시도해 주세요." } : { ok: true };
};

module.exports = { getDefaultCodexHome, getCodexLoginStatus, readCodexIdentity, startCodexLogin, logoutCodex, isCodexLoginUrl, getPlanName };

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { getAuthStatus, logoutClaude } = require("../desktop/claudeCli.cjs");
const { getCodexLoginStatus, readCodexIdentity, startCodexLogin, logoutCodex, isCodexLoginUrl, getPlanName } = require("../desktop/codexCli.cjs");
const { createCodexAccountReader, readCodexUsage, parseRateLimitLine, getWindowLabel } = require("../desktop/codexAccount.cjs");
const { createCodexAccountStore, normalizeCodexAccounts, DEFAULT_CODEX_ACCOUNT_ID } = require("../desktop/codexAccountStore.cjs");
const { createCodexAccountIpc } = require("../desktop/codexAccountIpc.cjs");

const LOGIN_URL = "https://auth.openai.com/oauth/authorize?client_id=test&state=abc";
const NOW = Date.parse("2026-11-03T08:00:00Z");

const toBase64Url = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");

const createIdToken = (claims) => `${toBase64Url({ alg: "none" })}.${toBase64Url(claims)}.sig`;

// codex를 흉내 내는 스크립트. 로그인하면 CODEX_HOME에 auth.json을 쓰고, 로그아웃하면 지운다.
const FAKE_CODEX_SOURCE = String.raw`
const fs = require("node:fs");
const path = require("node:path");
const auth = path.join(process.env.CODEX_HOME, "auth.json");
const command = process.argv.slice(2).join(" ");

if (process.env.ELECTRON_RUN_AS_NODE) {
    process.exit(3);
}

if (command === "login status") {
    process.exit(fs.existsSync(auth) ? 0 : 1);
} else if (command === "login") {
    process.stdout.write("Starting local login server on http://localhost:1455.\nIf your browser did not open, navigate to this URL to authenticate:\n\n" + process.env.AP_FAKE_URL + "\n\n");

    setTimeout(() => {
        if (process.env.AP_FAKE_LOGIN_FAIL) {
            process.exit(1);
        }

        fs.writeFileSync(auth, process.env.AP_FAKE_AUTH);
        process.exit(0);
    }, Number(process.env.AP_FAKE_DELAY || 50));
} else if (command === "logout") {
    if (!process.env.AP_FAKE_LOGOUT_STUCK) {
        fs.rmSync(auth, { force: true });
    }
} else {
    process.exit(2);
}
`;

const FAKE_CLAUDE_SOURCE = String.raw`
const fs = require("node:fs");
const path = require("node:path");
const credentials = path.join(process.env.CLAUDE_CONFIG_DIR, ".credentials.json");
const [group, action] = process.argv.slice(2);

if (group === "auth" && action === "status") {
    console.log(JSON.stringify(fs.existsSync(credentials) ? { loggedIn: true, email: "dev@example.com" } : { loggedIn: false }));
} else if (group === "auth" && action === "logout") {
    if (!process.env.AP_FAKE_LOGOUT_STUCK) {
        fs.rmSync(credentials, { force: true });
    }
}
`;

const writeRollout = (home, day, name, lines) => {
    const dir = path.join(home, "sessions", ...day.split("-"));

    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), lines.join("\n") + "\n");
};

const createTokenCount = (timestamp, rateLimits) => JSON.stringify({ timestamp: timestamp, type: "event_msg", payload: { type: "token_count", info: null, rate_limits: rateLimits } });

const checkIdentity = (testDir) => {
    const home = path.join(testDir, "identity");

    fs.mkdirSync(home);
    assert.equal(readCodexIdentity(home), null, "auth.json이 없으면 신원을 모른다");

    fs.writeFileSync(
        path.join(home, "auth.json"),
        JSON.stringify({ auth_mode: "chatgpt", tokens: { id_token: createIdToken({ email: "dev@example.com", name: "개발자", "https://api.openai.com/auth": { chatgpt_plan_type: "prolite" } }) } })
    );
    assert.deepEqual(readCodexIdentity(home), { name: "개발자", email: "dev@example.com", plan: "Pro Lite" });

    fs.writeFileSync(path.join(home, "auth.json"), JSON.stringify({ OPENAI_API_KEY: "sk-test" }));
    assert.deepEqual(readCodexIdentity(home), { name: "", email: "", plan: "API 키" });

    fs.writeFileSync(path.join(home, "auth.json"), "not json");
    assert.equal(readCodexIdentity(home), null);
    assert.equal(getPlanName("team"), "Team");
    assert.equal(getPlanName(""), "");
};

const checkUsage = (testDir) => {
    const home = path.join(testDir, "usage");
    const resetFuture = Math.floor(NOW / 1000) + 3600;
    const resetPast = Math.floor(NOW / 1000) - 3600;

    assert.equal(readCodexUsage(home, NOW), null, "세션 기록이 없으면 한도를 모른다");

    // 가장 최근 파일의 마지막 token_count가 기준이고, rate_limits가 비었거나 형식이 다른 줄은 건너뛴다.
    writeRollout(home, "2026-11-02", "rollout-2026-11-02T10-00-00-aaa.jsonl", [
        createTokenCount("2026-11-02T10:00:00Z", { primary: { used_percent: 10, window_minutes: 10080, resets_at: resetFuture } })
    ]);
    writeRollout(home, "2026-11-03", "rollout-2026-11-03T07-00-00-bbb.jsonl", [
        createTokenCount("2026-11-03T07:00:00Z", {
            primary: { used_percent: 20, window_minutes: 300, resets_at: resetFuture },
            secondary: { used_percent: 55.5, window_minutes: 10080, resets_at: resetFuture },
            plan_type: "plus"
        }),
        createTokenCount("2026-11-03T07:30:00Z", null),
        '깨진 줄 "rate_limits"',
        JSON.stringify({
            timestamp: "2026-11-03T07:40:00Z",
            type: "event_msg",
            payload: { type: "agent_message", rate_limits: { primary: { used_percent: 99, window_minutes: 300, resets_at: resetFuture } } }
        })
    ]);

    const usage = readCodexUsage(home, NOW);

    assert.deepEqual(usage.limits, [
        { label: "5시간 한도", percent: 20, resetsAt: resetFuture * 1000 },
        { label: "주간 한도", percent: 55.5, resetsAt: resetFuture * 1000 }
    ]);
    assert.equal(usage.planType, "plus");
    assert.equal(usage.fetchedAt, Date.parse("2026-11-03T07:00:00Z"));

    // 가장 최근 파일에 쓸 만한 줄이 없으면 그 전 파일을 본다.
    writeRollout(home, "2026-11-03", "rollout-2026-11-03T09-00-00-ccc.jsonl", [createTokenCount("2026-11-03T09:00:00Z", null)]);
    assert.equal(readCodexUsage(home, NOW).limits.length, 2);

    // 창이 이미 리셋됐으면 지금은 새 창이라 0이다.
    const stale = parseRateLimitLine(createTokenCount("2026-11-01T00:00:00Z", { primary: { used_percent: 80, window_minutes: 10080, resets_at: resetPast } }), NOW);

    assert.deepEqual(stale.limits, [{ label: "주간 한도", percent: 0, resetsAt: 0 }]);
    assert.equal(parseRateLimitLine(createTokenCount("2026-11-01T00:00:00Z", { primary: { used_percent: "x", window_minutes: 300, resets_at: 1 } }), NOW), null);
    assert.equal(getWindowLabel(120), "2시간 한도");
    assert.equal(getWindowLabel(2880), "2일 한도");

    // 큰 파일도 끝부분만 읽는다.
    const bigHome = path.join(testDir, "usage-big");

    writeRollout(bigHome, "2026-11-03", "rollout-2026-11-03T07-00-00-big.jsonl", [
        "x".repeat(3 * 1024 * 1024),
        createTokenCount("2026-11-03T07:00:00Z", { primary: { used_percent: 7, window_minutes: 300, resets_at: resetFuture } })
    ]);
    assert.equal(readCodexUsage(bigHome, NOW).limits[0].percent, 7);
};

const checkCodexCli = async (testDir) => {
    const fakeFile = path.join(testDir, "fakeCodex.cjs");
    const fake = { command: process.execPath, prefixArgs: [fakeFile] };
    const home = path.join(testDir, "codex-login");
    const auth = JSON.stringify({ tokens: { id_token: createIdToken({ email: "new@example.com", "https://api.openai.com/auth": { chatgpt_plan_type: "plus" } }) } });

    fs.writeFileSync(fakeFile, FAKE_CODEX_SOURCE);
    fs.mkdirSync(home);
    process.env.AP_FAKE_URL = LOGIN_URL;
    process.env.AP_FAKE_AUTH = auth;

    try {
        assert.deepEqual(await getCodexLoginStatus(home, fake), { installed: true, loggedIn: false, identity: null });
        assert.equal((await getCodexLoginStatus(home, { command: path.join(testDir, "missing-codex") })).installed, true, "실행 파일 경로가 있으면 설치된 것으로 본다");
        assert.equal(isCodexLoginUrl(LOGIN_URL), true);
        assert.equal(isCodexLoginUrl("https://evil.example.com/auth.openai.com"), false);
        assert.equal(isCodexLoginUrl("http://auth.openai.com/x"), false);

        // 로그인: 출력의 주소를 알리고, 끝나면 신원을 읽어 돌려준다.
        const events = { url: "", result: null };
        const done = new Promise((resolve) => {
            startCodexLogin(
                home,
                {
                    onUrl: (url) => {
                        events.url = url;
                    },
                    onFinish: (result) => {
                        events.result = result;
                        resolve();
                    }
                },
                fake
            );
        });

        await done;
        assert.equal(events.url, LOGIN_URL);
        assert.deepEqual(events.result, { ok: true, email: "new@example.com" });
        assert.deepEqual(await getCodexLoginStatus(home, fake), { installed: true, loggedIn: true, identity: { name: "", email: "new@example.com", plan: "Plus" } });

        // 로그아웃: 로그인 정보가 지워졌는지 확인하고, 지워지지 않으면 실패로 알린다.
        process.env.AP_FAKE_LOGOUT_STUCK = "1";
        assert.equal((await logoutCodex(home, fake)).ok, false);
        delete process.env.AP_FAKE_LOGOUT_STUCK;
        assert.deepEqual(await logoutCodex(home, fake), { ok: true });
        assert.equal((await getCodexLoginStatus(home, fake)).loggedIn, false);

        // 로그인 취소와 실패.
        process.env.AP_FAKE_DELAY = "5000";

        const cancelled = await new Promise((resolve) => {
            const session = startCodexLogin(home, { onUrl: () => session?.cancel?.(), onFinish: resolve }, fake);
        });

        assert.equal(cancelled.cancelled, true);
        process.env.AP_FAKE_DELAY = "20";
        process.env.AP_FAKE_LOGIN_FAIL = "1";

        const failed = await new Promise((resolve) => startCodexLogin(home, { onUrl: () => {}, onFinish: resolve }, fake));

        assert.equal(failed.ok, false);
        assert.match(failed.message, /종료 코드 1/);
        delete process.env.AP_FAKE_LOGIN_FAIL;

        const missing = await new Promise((resolve) => startCodexLogin(home, { onUrl: () => {}, onFinish: resolve }, { command: path.join(testDir, "missing-codex") }));

        assert.equal(missing.ok, false);
    } finally {
        for (const key of ["AP_FAKE_URL", "AP_FAKE_AUTH", "AP_FAKE_DELAY", "AP_FAKE_LOGIN_FAIL", "AP_FAKE_LOGOUT_STUCK"]) {
            delete process.env[key];
        }
    }
};

const checkClaudeLogout = async (testDir) => {
    const fakeFile = path.join(testDir, "fakeClaudeLogout.cjs");
    const fake = { command: process.execPath, prefixArgs: [fakeFile] };
    const configDir = path.join(testDir, "claude-logout");

    fs.writeFileSync(fakeFile, FAKE_CLAUDE_SOURCE);
    fs.mkdirSync(configDir);
    fs.writeFileSync(path.join(configDir, ".credentials.json"), "{}");
    assert.equal((await getAuthStatus(configDir, fake)).loggedIn, true);

    process.env.AP_FAKE_LOGOUT_STUCK = "1";
    assert.equal((await logoutClaude(configDir, fake)).ok, false, "로그아웃 뒤에도 로그인돼 있으면 실패로 알린다");
    delete process.env.AP_FAKE_LOGOUT_STUCK;
    assert.deepEqual(await logoutClaude(configDir, fake), { ok: true });
    assert.equal((await getAuthStatus(configDir, fake)).loggedIn, false);
    assert.equal((await logoutClaude(configDir, { command: path.join(testDir, "missing-claude") })).ok, false);
};

const checkCodexStore = (testDir) => {
    const accountsRoot = path.join(testDir, "codex-accounts");
    const baseHome = path.join(testDir, "base-home");
    const store = createCodexAccountStore({ accountsRoot: accountsRoot, getBaseHome: () => baseHome });
    const created = store.createAccount({ label: "  회사\n계정  " });

    assert.match(created.id, /^cx-[0-9a-f]{8}$/);
    assert.equal(created.label, "회사 계정");
    assert.equal(created.home, path.join(accountsRoot, created.id));
    assert(fs.existsSync(created.home));
    assert.equal(store.getHome(DEFAULT_CODEX_ACCOUNT_ID), baseHome);
    assert.equal(store.getHome("../escape"), "", "형식이 틀린 id는 폴더를 가리키지 못한다");

    assert.equal(store.removeAccountDir(DEFAULT_CODEX_ACCOUNT_ID), false, "기본 계정 폴더는 지우지 않는다");
    assert.equal(store.removeAccountDir(created.id), true);
    assert(!fs.existsSync(created.home));

    assert.deepEqual(normalizeCodexAccounts([{ id: created.id, label: "a" }, { id: created.id, label: "b" }, { id: "acct-12345678" }, { id: "../x" }, null, "x"]), [{ id: created.id, label: "a" }]);
    assert.deepEqual(normalizeCodexAccounts("x"), []);
    assert.equal(normalizeCodexAccounts(Array.from({ length: 20 }, (_, index) => ({ id: `cx-${String(index).padStart(8, "0")}` }))).length, 8);
};

const checkReader = async (testDir) => {
    const fakeFile = path.join(testDir, "fakeCodexReader.cjs");
    const fake = { command: process.execPath, prefixArgs: [fakeFile] };
    const home = path.join(testDir, "reader");
    const changes = [];
    const reader = createCodexAccountReader({ codexHome: home, launch: fake, now: () => NOW, onChange: (account) => changes.push(account) });

    fs.writeFileSync(fakeFile, FAKE_CODEX_SOURCE);
    fs.mkdirSync(home);

    const loggedOut = await reader.refresh(true);

    assert.equal(loggedOut.loggedIn, false);
    assert.equal(loggedOut.error.code, "NOT_LOGGED_IN");

    fs.writeFileSync(
        path.join(home, "auth.json"),
        JSON.stringify({ tokens: { id_token: createIdToken({ email: "dev@example.com", name: "개발자", "https://api.openai.com/auth": { chatgpt_plan_type: "pro" } }) } })
    );

    const noUsage = await reader.refresh(true);

    assert.equal(noUsage.loggedIn, true);
    assert.deepEqual(noUsage.profile, { name: "개발자", email: "dev@example.com", plan: "Pro", organization: "" });
    assert.equal(noUsage.error.code, "NO_USAGE", "사용 기록이 없으면 한도 대신 안내를 준다");

    writeRollout(home, "2026-11-03", "rollout-2026-11-03T07-00-00-x.jsonl", [
        createTokenCount("2026-11-03T07:00:00Z", { primary: { used_percent: 50, window_minutes: 10080, resets_at: Math.floor(NOW / 1000) + 600 } })
    ]);

    const withUsage = await reader.refresh(true);

    assert.equal(withUsage.error, null);
    assert.deepEqual(
        withUsage.limits.map((limit) => [limit.label, limit.percent]),
        [["주간 한도", 50]]
    );
    assert.equal(withUsage.fetchedAt, Date.parse("2026-11-03T07:00:00Z"));
    assert.equal(changes.length, 3);

    // 15초 안의 다시 읽기는 새로 읽지 않는다.
    assert.equal(await reader.refresh(), withUsage);
};

// 계정 제거는 로그아웃을 기다리는 동안 다른 곳이 저장한 설정을 옛 값으로 되돌리지 않는다.
const checkCodexRemove = async (testDir) => {
    const fakeFile = path.join(testDir, "fakeCodexIpc.cjs");
    const store = createCodexAccountStore({ accountsRoot: path.join(testDir, "ipc-accounts"), getBaseHome: () => path.join(testDir, "ipc-base") });
    const removed = store.createAccount({ label: "지울 계정" });
    const handlers = {};
    const events = [];
    let settings = { theme: "system", codexAccounts: [{ id: removed.id, label: removed.label }], codexAccountId: removed.id };

    fs.writeFileSync(fakeFile, FAKE_CODEX_SOURCE);

    createCodexAccountIpc({
        readSettings: () => ({ ...settings }),
        writeSettings: (next) => {
            settings = { ...next };
        },
        getCodexAccountId: () => settings.codexAccountId,
        setCodexAccountId: () => {},
        resolveProjectDir: () => testDir,
        broadcast: (channel) => events.push(channel),
        isRunning: () => false,
        isProjectRunning: () => false,
        onAccountsChange: () => events.push("change"),
        launch: { command: process.execPath, prefixArgs: [fakeFile] },
        store: store
    }).register((channel, handler) => {
        handlers[channel] = handler;
    });

    const pending = handlers["autopilot:remove-codex-account"]({}, removed.id);

    settings = { ...settings, theme: "dark", codexAccounts: [...settings.codexAccounts, { id: "cx-0000000a", label: "새 계정" }] };

    assert.equal((await pending).status, "OK");
    assert.equal(settings.theme, "dark", "로그아웃을 기다리는 동안 바뀐 설정을 유지한다");
    assert.deepEqual(settings.codexAccounts, [{ id: "cx-0000000a", label: "새 계정" }], "그 사이 추가한 계정은 남기고 제거한 계정만 뺀다");
    assert.equal(settings.codexAccountId, DEFAULT_CODEX_ACCOUNT_ID);
    assert(!fs.existsSync(removed.home));
    // 화면이 알림을 받고 Codex 상태를 다시 물을 때 메인이 기억한 옛 값을 주지 않도록 먼저 알린다.
    assert.deepEqual(events, ["change", "autopilot:codex-accounts"]);
};

const runChecks = async () => {
    const testDir = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), "autopilot-login-"));

    try {
        checkIdentity(testDir);
        checkUsage(testDir);
        checkCodexStore(testDir);

        await checkCodexCli(testDir);
        await checkClaudeLogout(testDir);
        await checkReader(testDir);
        await checkCodexRemove(testDir);

        console.log("Desktop login checks passed.");
    } finally {
        fs.rmSync(testDir, { recursive: true, force: true });
    }
};

runChecks().catch((error) => {
    console.error(error);

    process.exitCode = 1;
});

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createAccountStore, normalizeAccounts, sanitizeLabel, resolveBaseDir, getHomeConfigDir, DEFAULT_ACCOUNT_ID, MAX_ACCOUNTS } = require("../desktop/accountStore.cjs");
const { getAuthStatus, startLogin, isLoginUrl } = require("../desktop/claudeCli.cjs");

const LOGIN_URL = "https://claude.com/cai/oauth/authorize?code=true&client_id=test&state=abc";

// claude를 흉내 내는 스크립트. 로그인 코드가 good-code일 때만 설정 폴더에 로그인 정보를 쓴다.
const FAKE_CLAUDE_SOURCE = String.raw`
const fs = require("node:fs");
const path = require("node:path");
const credentials = path.join(process.env.CLAUDE_CONFIG_DIR, ".credentials.json");
const [group, action] = process.argv.slice(2);

// 앱의 ELECTRON_RUN_AS_NODE가 넘어오면 대상 프로젝트의 electron 실행이 깨지므로 실패로 알린다.
if (process.env.ELECTRON_RUN_AS_NODE) {
    process.exit(3);
}

if (group === "auth" && action === "status") {
    const loggedIn = fs.existsSync(credentials);

    console.log(JSON.stringify(loggedIn ? { loggedIn: true, email: "dev@example.com", orgName: "Example Org", subscriptionType: "team" } : { loggedIn: false }));
} else if (group === "auth" && action === "login") {
    const url = process.env.AP_FAKE_URL;

    process.stdout.write("Opening browser to sign in…\nIf the browser didn't open, visit: " + url + "\nPaste code here if prompted > ");
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (text) => {
        if (text.trim() === "good-code") {
            fs.writeFileSync(credentials, "{}");
            process.exit(0);
        }

        process.exit(1);
    });
} else {
    process.exit(2);
}
`;

const waitFor = async (predicate, message, timeoutMs = 10000) => {
    const startedAt = Date.now();

    while (!predicate()) {
        assert(Date.now() - startedAt < timeoutMs, message);

        await new Promise((resolve) => setTimeout(resolve, 20));
    }
};

const checkNormalizeAccounts = () => {
    assert.deepEqual(normalizeAccounts(undefined), []);
    assert.deepEqual(normalizeAccounts("acct-12345678"), []);

    const accounts = normalizeAccounts([
        { id: "acct-12345678", label: "  업무\n계정  " },
        { id: "acct-12345678", label: "중복" },
        { id: "../evil", label: "경로" },
        { id: "acct-ABCDEF12", label: "대문자" },
        { id: "default", label: "기본" },
        { id: "acct-abcdef12" },
        null,
        "acct-00000000"
    ]);

    assert.deepEqual(accounts, [
        { id: "acct-12345678", label: "업무 계정", shared: false },
        { id: "acct-abcdef12", label: "acct-abcdef12", shared: false }
    ]);
    assert.equal(normalizeAccounts([{ id: "acct-12345678", label: "a", shared: true }])[0].shared, true);
    assert.equal(normalizeAccounts([{ id: "acct-12345678", label: "a", shared: "yes" }])[0].shared, false);

    const many = Array.from({ length: MAX_ACCOUNTS + 3 }, (value, index) => ({ id: `acct-0000000${index}`.slice(0, 13), label: `계정${index}` }));

    assert(normalizeAccounts(many).length <= MAX_ACCOUNTS);
    assert.equal(sanitizeLabel("x".repeat(100)).length, 30);
    assert.equal(sanitizeLabel(null), "");
};

// 기본 .claude의 위치는 환경마다 다르다: 설정에서 고른 폴더, 환경 변수, 사용자 폴더 순이다.
const checkBaseDir = () => {
    const savedEnv = process.env.CLAUDE_CONFIG_DIR;

    try {
        delete process.env.CLAUDE_CONFIG_DIR;

        assert.equal(resolveBaseDir(""), getHomeConfigDir());
        assert.equal(resolveBaseDir("D:\dev\.claude"), "D:\dev\.claude");

        process.env.CLAUDE_CONFIG_DIR = "E:\env\.claude";

        assert.equal(resolveBaseDir(""), "E:\env\.claude");
        assert.equal(resolveBaseDir("D:\dev\.claude"), "D:\dev\.claude", "설정에서 고른 폴더가 환경 변수보다 앞선다");
    } finally {
        if (savedEnv === undefined) {
            delete process.env.CLAUDE_CONFIG_DIR;
        } else {
            process.env.CLAUDE_CONFIG_DIR = savedEnv;
        }
    }
};

// 설정 폴더는 id로만 정해지므로 설정 파일에 다른 경로를 적어도 그 밖은 건드리지 못한다.
// 공유 항목은 기본 .claude로 연결되어 메모리·기록이 함께 쓰이고, 로그인 정보는 계정마다 따로이며, 제거해도 기본 .claude의 데이터는 그대로여야 한다.
const checkAccountStore = (testDir) => {
    const baseDir = path.join(testDir, "home", ".claude");
    const accountsRoot = path.join(testDir, "app", "accounts");
    const memoryFile = path.join(baseDir, "projects", "e--proj", "memory", "note.md");

    fs.mkdirSync(path.dirname(memoryFile), { recursive: true });
    fs.mkdirSync(path.join(baseDir, "skills", "mine"), { recursive: true });
    fs.writeFileSync(memoryFile, "기억");
    fs.writeFileSync(path.join(baseDir, "skills", "mine", "SKILL.md"), "skill");
    fs.writeFileSync(path.join(baseDir, "CLAUDE.md"), "지침");
    fs.writeFileSync(path.join(baseDir, "settings.json"), "{}");
    fs.writeFileSync(path.join(baseDir, ".credentials.json"), "secret");
    fs.writeFileSync(path.join(baseDir, ".claude.json"), "{}");
    fs.writeFileSync(path.join(baseDir, "history.jsonl"), "x");

    const store = createAccountStore({ accountsRoot: accountsRoot, getBaseDir: () => baseDir });

    assert.equal(store.getConfigDir(DEFAULT_ACCOUNT_ID), baseDir);
    assert.equal(store.getConfigDir("acct-12345678"), path.join(accountsRoot, "acct-12345678"));

    for (const invalidId of ["", "../home", "acct-1234567", "acct-12345678/../..", "ACCT-12345678", "C:\Windows"]) {
        assert.equal(store.getConfigDir(invalidId), "", invalidId);
        assert.equal(store.removeAccountDir(invalidId), false, invalidId);
    }

    const shared = store.createAccount({ label: "공유", shareData: true });

    assert(shared.configDir.startsWith(accountsRoot));
    assert.equal(shared.shared, true);
    assert.equal(fs.readFileSync(path.join(shared.configDir, "projects", "e--proj", "memory", "note.md"), "utf8"), "기억");
    assert.equal(fs.readFileSync(path.join(shared.configDir, "CLAUDE.md"), "utf8"), "지침");
    assert(fs.existsSync(path.join(shared.configDir, "skills", "mine", "SKILL.md")));
    assert(!fs.existsSync(path.join(shared.configDir, "commands")), "기본 .claude에 없는 항목은 만들지 않는다");

    // 파일 링크를 만들 수 없는 환경(권한 없는 Windows)에서는 복사본이라 아래의 낡은 링크 검사는 링크일 때만 한다.
    const isClaudeMdLinked = fs.lstatSync(path.join(shared.configDir, "CLAUDE.md")).isSymbolicLink();

    // 계정 폴더에서 쓴 세션 기록은 기본 .claude에 쌓인다.
    fs.writeFileSync(path.join(shared.configDir, "projects", "e--proj", "session.jsonl"), "새 기록");

    assert.equal(fs.readFileSync(path.join(baseDir, "projects", "e--proj", "session.jsonl"), "utf8"), "새 기록");

    for (const privateName of [".credentials.json", ".claude.json", "history.jsonl"]) {
        assert(!fs.existsSync(path.join(shared.configDir, privateName)), `${privateName}은 연결하지 않는다`);
    }

    const isolated = store.createAccount({ label: "", shareData: false });

    assert.notEqual(isolated.id, shared.id);
    assert.deepEqual(fs.readdirSync(isolated.configDir), []);

    // 이미 있는 실제 폴더는 건드리지 않고, 다른 곳을 가리키는 낡은 링크만 다시 잇는다.
    const realDir = path.join(isolated.configDir, "projects");

    fs.mkdirSync(realDir);
    fs.writeFileSync(path.join(realDir, "mine.txt"), "내 것");
    store.syncSharedData(isolated.id);

    assert.equal(fs.readFileSync(path.join(realDir, "mine.txt"), "utf8"), "내 것");
    assert(!fs.lstatSync(realDir).isSymbolicLink());

    const movedBase = path.join(testDir, "moved", ".claude");

    fs.mkdirSync(path.join(movedBase, "projects"), { recursive: true });
    fs.writeFileSync(path.join(movedBase, "projects", "moved.txt"), "새 위치");

    const movedStore = createAccountStore({ accountsRoot: accountsRoot, getBaseDir: () => movedBase });

    movedStore.syncSharedData(shared.id);

    assert.equal(fs.readFileSync(path.join(shared.configDir, "projects", "moved.txt"), "utf8"), "새 위치");
    assert(!fs.existsSync(path.join(shared.configDir, "projects", "e--proj")), "새 위치의 projects를 가리켜야 한다");
    assert.equal(fs.existsSync(path.join(shared.configDir, "CLAUDE.md")), !isClaudeMdLinked, "새 위치에 없는 항목은 이전 위치를 가리키는 낡은 링크를 끊는다(복사본은 그대로)");

    assert.equal(store.removeAccountDir(DEFAULT_ACCOUNT_ID), false);
    assert(fs.existsSync(baseDir), "기본 .claude는 지우지 않는다");

    assert.equal(store.removeAccountDir(shared.id), true);
    assert(!fs.existsSync(shared.configDir));
    assert.equal(fs.readFileSync(memoryFile, "utf8"), "기억", "제거해도 기본 .claude의 메모리는 그대로다");
    assert(fs.existsSync(path.join(baseDir, "projects", "e--proj", "session.jsonl")));
    assert(fs.existsSync(path.join(baseDir, "skills", "mine", "SKILL.md")));
    assert.equal(fs.readFileSync(path.join(baseDir, "CLAUDE.md"), "utf8"), "지침");
    assert(fs.existsSync(isolated.configDir));
};

const createLoginRun = (configDir, fake) => {
    const events = { url: "", result: null };
    const session = startLogin(
        configDir,
        {
            onUrl: (url) => {
                events.url = url;
            },
            onFinish: (result) => {
                events.result = result;
            }
        },
        fake
    );

    return { events: events, session: session };
};

const checkClaudeCli = async (testDir) => {
    const fakeFile = path.join(testDir, "fakeClaude.cjs");
    const fake = { command: process.execPath, prefixArgs: [fakeFile] };
    const configDir = path.join(testDir, "login-account");

    fs.writeFileSync(fakeFile, FAKE_CLAUDE_SOURCE);
    fs.mkdirSync(configDir);

    process.env.AP_FAKE_URL = LOGIN_URL;

    const savedRunAsNode = process.env.ELECTRON_RUN_AS_NODE;

    process.env.ELECTRON_RUN_AS_NODE = "1";

    assert.deepEqual(await getAuthStatus(configDir, fake), { loggedIn: false, email: "", orgName: "", subscriptionType: "" });

    if (savedRunAsNode === undefined) {
        delete process.env.ELECTRON_RUN_AS_NODE;
    } else {
        process.env.ELECTRON_RUN_AS_NODE = savedRunAsNode;
    }
    assert(isLoginUrl(LOGIN_URL));
    assert(isLoginUrl("https://platform.claude.com/oauth/code/callback"));

    for (const rejected of ["http://claude.com/x", "https://claude.com.evil.example/x", "https://evil.example/claude.com", "file:///C:/x", "javascript:alert(1)", "claude.com"]) {
        assert(!isLoginUrl(rejected), rejected);
    }

    // 로그인 주소를 알려주고, 잘못된 형식의 코드는 CLI에 전달하지 않는다. 올바른 코드를 보내면 로그인 상태를 확인해 성공으로 끝난다.
    const success = createLoginRun(configDir, fake);

    await waitFor(() => success.events.url, "로그인 주소를 알려야 한다");

    assert.equal(success.events.url, LOGIN_URL);
    assert.equal(success.session.submitCode("bad code!"), false);
    assert.equal(success.session.submitCode(""), false);
    assert.equal(success.session.submitCode("good-code"), true);

    await waitFor(() => success.events.result, "로그인이 끝나야 한다");

    assert.deepEqual(success.events.result, { ok: true, email: "dev@example.com" });
    assert.equal(success.session.submitCode("good-code"), false, "끝난 뒤에는 코드를 받지 않는다");

    // 코드가 틀리면 실패하고, 다른 주소(피싱 가능성)는 알리지 않는다.
    const failedDir = path.join(testDir, "login-failed");

    fs.mkdirSync(failedDir);
    process.env.AP_FAKE_URL = "https://evil.example.com/login";

    const failure = createLoginRun(failedDir, fake);

    await new Promise((resolve) => setTimeout(resolve, 500));

    assert.equal(failure.events.url, "");
    assert.equal(failure.session.submitCode("wrong-code"), true);

    await waitFor(() => failure.events.result, "실패로 끝나야 한다");

    assert.equal(failure.events.result.ok, false);
    assert(failure.events.result.message.includes("종료 코드 1"));
    assert(!fs.existsSync(path.join(failedDir, ".credentials.json")));

    // 취소하면 프로세스를 끝내고 취소로 알린다.
    process.env.AP_FAKE_URL = LOGIN_URL;

    const cancelDir = path.join(testDir, "login-cancel");

    fs.mkdirSync(cancelDir);

    const cancelled = createLoginRun(cancelDir, fake);

    await waitFor(() => cancelled.events.url, "로그인 주소를 알려야 한다");
    cancelled.session.cancel();
    await waitFor(() => cancelled.events.result, "취소로 끝나야 한다");

    assert.equal(cancelled.events.result.ok, false);
    assert.equal(cancelled.events.result.cancelled, true);
};

const runChecks = async () => {
    const testDir = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), "autopilot-accounts-"));

    try {
        checkNormalizeAccounts();
        checkBaseDir();
        checkAccountStore(testDir);

        await checkClaudeCli(testDir);

        console.log("Desktop account checks passed.");
    } finally {
        fs.rmSync(testDir, { recursive: true, force: true });
    }
};

runChecks().catch((error) => {
    console.error(error);

    process.exitCode = 1;
});

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createAccountStore, normalizeAccounts, sanitizeLabel, resolveBaseDir, getHomeConfigDir, DEFAULT_ACCOUNT_ID, MAX_ACCOUNTS } = require("../desktop/accountStore.cjs");
const { getAuthStatus, startLogin, isLoginUrl } = require("../desktop/claudeCli.cjs");
const { applyLoginShellPath, parseShellPath, mergePath, runLoginShell } = require("../desktop/loginShellPath.cjs");
const { readKeychainOAuth, getServiceNames, decodeSecret } = require("../desktop/keychainCredentials.cjs");

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

    if (process.env.AP_FAKE_ARGS_FILE) {
        fs.writeFileSync(process.env.AP_FAKE_ARGS_FILE, JSON.stringify(process.argv.slice(2)));
    }

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

    // 아는 이메일은 로그인 페이지에 미리 채우도록 --email로 넘기고, 형식이 맞지 않으면(CMD가 해석하는 문자·옵션처럼 보이는 앞의 -) 넘기지 않는다.
    const argsFile = path.join(testDir, "login-args.json");
    const baseArgs = ["auth", "login", "--claudeai"];
    const emailCases = [
        ["dev@example.com", [...baseArgs, "--email", "dev@example.com"]],
        ["first.last+tag@sub.example.co.kr", [...baseArgs, "--email", "first.last+tag@sub.example.co.kr"]],
        ["a b@example.com", baseArgs],
        ["x@example.com&calc", baseArgs],
        ["x@example.com%PATH%", baseArgs],
        ['x@"example.com', baseArgs],
        ["-x@example.com", baseArgs],
        ["", baseArgs],
        [undefined, baseArgs]
    ];

    process.env.AP_FAKE_ARGS_FILE = argsFile;

    for (const [email, expected] of emailCases) {
        fs.rmSync(argsFile, { force: true });

        const run = createLoginRun(cancelDir, { ...fake, email: email });

        await waitFor(() => fs.existsSync(argsFile) && fs.readFileSync(argsFile, "utf8"), "로그인 인자를 기록해야 한다");

        assert.deepEqual(JSON.parse(fs.readFileSync(argsFile, "utf8")), expected, String(email));

        run.session.cancel();
        await waitFor(() => run.events.result, "취소로 끝나야 한다");
    }

    delete process.env.AP_FAKE_ARGS_FILE;
};

// Finder·Dock으로 연 앱은 터미널의 PATH를 받지 못하므로 로그인 셸의 PATH를 합쳐 claude를 찾게 한다.
const checkLoginShellPath = async (testDir) => {
    const home = path.join(testDir, "home");
    const noisy = "Last login: today\n__AUTOPILOT_PATH_START__/opt/nvm/bin:/usr/bin\n__AUTOPILOT_PATH_END__\nbye";
    const merge = async (env, runShell) => (await applyLoginShellPath({ processEnv: env, platform: "darwin", homeDir: home, runShell: runShell })).split(path.delimiter);

    assert.equal(parseShellPath(noisy), "/opt/nvm/bin:/usr/bin");
    assert.equal(parseShellPath("배너만 있고 표식이 없음"), "");
    assert.equal(mergePath(["/usr/bin", "/bin"].join(path.delimiter), ["/opt/nvm/bin", "/usr/bin"].join(path.delimiter), "", undefined), ["/usr/bin", "/bin", "/opt/nvm/bin"].join(path.delimiter));

    const fromShell = await merge({ SHELL: "/bin/zsh", PATH: ["/usr/bin", "/bin"].join(path.delimiter) }, async (shell) => (shell === "/bin/zsh" ? noisy.replace(/:/g, path.delimiter) : ""));

    assert.deepEqual(fromShell.slice(0, 3), ["/usr/bin", "/bin", "/opt/nvm/bin"]);
    assert(fromShell.includes(path.join(home, ".local", "bin")) && fromShell.includes("/opt/homebrew/bin"));
    assert.equal(new Set(fromShell).size, fromShell.length);

    const failed = await merge({ SHELL: "/bin/zsh", PATH: "/usr/bin" }, async () => "");

    assert.equal(failed[0], "/usr/bin");
    assert(failed.includes(path.join(home, ".claude", "local")), "셸을 읽지 못해도 흔한 설치 위치는 남는다");

    const windowsPath = await applyLoginShellPath({ processEnv: { PATH: "C:\\Windows" }, platform: "win32", runShell: async () => assert.fail("Windows에서는 셸을 띄우지 않는다") });

    assert.equal(windowsPath, "C:\\Windows");

    if (process.platform === "win32") {
        return;
    }

    const shellFile = path.join(testDir, "fake-shell");

    fs.writeFileSync(shellFile, '#!/bin/sh\necho 배너가 찍혀도 괜찮다\nPATH="/fake/login/bin:$PATH"\nexport PATH\nexec /bin/sh -c "$2"\n', { mode: 0o755 });

    assert(parseShellPath(await runLoginShell(shellFile, { PATH: "/usr/bin:/bin" }, 5000)).startsWith("/fake/login/bin"));

    fs.writeFileSync(shellFile, "#!/bin/sh\nexec sleep 10\n", { mode: 0o755 });

    const startedAt = Date.now();

    assert.equal(await runLoginShell(shellFile, process.env, 300), "");
    assert(Date.now() - startedAt < 3000, "셸이 멈추면 시간 제한에서 끊어야 한다");
};

// macOS는 로그인 정보를 키체인에 두므로 security로 읽는다. 서비스 이름에는 설정 폴더 경로의 해시가 붙고, 접미사 없는 옛 이름은 기본 폴더만 쓴다.
const checkKeychainCredentials = async (testDir) => {
    const home = path.join(testDir, "home");
    const defaultDir = path.join(home, ".claude");
    const accountDir = path.join(testDir, "accounts", "acct-12345678");
    const plainName = "Claude Code-credentials";
    const hashName = (dir) => `${plainName}-${crypto.createHash("sha256").update(dir).digest("hex").slice(0, 8)}`;
    const oauth = (token, expiresAt) => ({ claudeAiOauth: { accessToken: token, expiresAt: expiresAt } });
    const toHex = (value) => Buffer.from(JSON.stringify(value), "utf8").toString("hex");

    assert(getServiceNames(defaultDir, home).includes(hashName(defaultDir)));
    assert(getServiceNames(defaultDir, home).includes(plainName));
    assert(getServiceNames(accountDir, home).includes(hashName(accountDir)));
    assert(!getServiceNames(accountDir, home).includes(plainName));
    assert.equal(decodeSecret(toHex({ a: "한" })), '{"a":"한"}');
    assert.equal(decodeSecret(' {"a":1}\n'), '{"a":1}');

    const createSecurity = (items, failureCode) => {
        const calls = [];
        const execFileImpl = (command, args, options, callback) => {
            const service = args[args.indexOf("-s") + 1];

            calls.push({ command: command, args: args, service: service });

            if (failureCode) {
                callback(Object.assign(new Error("failed"), { code: failureCode }), "");
            } else if (service in items) {
                callback(null, `${items[service]}\n`);
            } else {
                callback(Object.assign(new Error("not found"), { code: 44 }), "");
            }
        };

        return { calls: calls, execFileImpl: execFileImpl };
    };

    // 해시 이름과 옛 이름이 모두 있으면 만료가 더 늦은 쪽을 쓰고, 16진수로 돌아온 값도 읽는다.
    const both = createSecurity({ [hashName(defaultDir)]: toHex(oauth("new", 2000)), [plainName]: JSON.stringify(oauth("old", 1000)) });
    const found = await readKeychainOAuth(defaultDir, { homeDir: home, execFileImpl: both.execFileImpl });

    assert.equal(found.oauth.accessToken, "new");
    assert.equal(found.isBlocked, false);
    assert(both.calls.every((call) => call.command === "/usr/bin/security" && call.args[0] === "find-generic-password" && call.args.includes("-w")));

    // 다른 계정의 폴더는 옛 이름을 읽지 않는다(기본 계정의 로그인이 섞이면 안 된다).
    const other = createSecurity({ [plainName]: JSON.stringify(oauth("default-account", 5000)) });

    assert.deepEqual(await readKeychainOAuth(accountDir, { homeDir: home, execFileImpl: other.execFileImpl }), { oauth: null, isBlocked: false });
    assert(other.calls.every((call) => call.service !== plainName));

    // 항목이 없는 것(44)과 읽지 못한 것(접근 거부·시간 초과)을 구분한다. 깨진 값은 없는 것으로 본다.
    assert.equal((await readKeychainOAuth(defaultDir, { homeDir: home, execFileImpl: createSecurity({}, 36).execFileImpl })).isBlocked, true);
    assert.deepEqual(await readKeychainOAuth(defaultDir, { homeDir: home, execFileImpl: createSecurity({ [hashName(defaultDir)]: "{ broken" }).execFileImpl }), { oauth: null, isBlocked: false });

    // CI의 macOS에서는 임시 키체인으로 진짜 security의 출력과 종료 코드를 확인한다. 사용자 키체인은 건드리지 않는다.
    if (process.platform !== "darwin" || !process.env.CI) {
        return;
    }

    const keychain = path.join(testDir, "check.keychain-db");
    const security = (...args) => execFileSync("/usr/bin/security", args, { encoding: "utf8" });
    const originalList = security("list-keychains", "-d", "user")
        .split("\n")
        .map((line) => line.trim().replace(/^"|"$/g, ""))
        .filter(Boolean);

    try {
        security("create-keychain", "-p", "check", keychain);
        security("unlock-keychain", "-p", "check", keychain);
        security("add-generic-password", "-a", "check", "-s", hashName(accountDir), "-w", JSON.stringify(oauth("real-token", 3000)), keychain);

        assert.equal((await readKeychainOAuth(accountDir, { keychain: keychain })).oauth.accessToken, "real-token");
        assert.deepEqual(await readKeychainOAuth(path.join(testDir, "no-such-account"), { keychain: keychain }), { oauth: null, isBlocked: false });
    } finally {
        try {
            security("delete-keychain", keychain);
        } catch {}

        security("list-keychains", "-d", "user", "-s", ...originalList);
    }
};

const runChecks = async () => {
    const testDir = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), "autopilot-accounts-"));

    try {
        checkNormalizeAccounts();
        checkBaseDir();
        checkAccountStore(testDir);

        await checkClaudeCli(testDir);
        await checkLoginShellPath(testDir);
        await checkKeychainCredentials(testDir);

        console.log("Desktop account checks passed.");
    } finally {
        fs.rmSync(testDir, { recursive: true, force: true });
    }
};

runChecks().catch((error) => {
    console.error(error);

    process.exitCode = 1;
});

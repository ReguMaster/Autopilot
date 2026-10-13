const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_ACCOUNT_ID = "default";
const DEFAULT_ACCOUNT_LABEL = "기본 계정";
const ACCOUNT_ID_PATTERN = /^acct-[0-9a-f]{8}$/;
const MAX_LABEL_LENGTH = 30;
const MAX_ACCOUNTS = 8;
// 계정마다 설정 폴더가 달라 메모리·세션 기록·전역 지침이 갈라지므로, 기본 .claude의 이 항목들을 연결해 함께 쓴다.
// 로그인 정보(.credentials.json)와 계정 상태(.claude.json)는 연결하지 않아 계정끼리 섞이지 않는다.
const SHARED_DIRS = ["projects", "skills", "plugins", "commands", "agents"];
const SHARED_FILES = ["CLAUDE.md", "settings.json"];

const getHomeConfigDir = () => {
    return path.join(os.homedir(), ".claude");
};

// 기본 .claude의 위치는 환경마다 다르다. 설정에서 고른 폴더, 없으면 환경 변수 CLAUDE_CONFIG_DIR, 없으면 사용자 폴더의 .claude 순서로 쓴다.
const resolveBaseDir = (savedDir) => {
    return savedDir || process.env.CLAUDE_CONFIG_DIR || getHomeConfigDir();
};

const sanitizeLabel = (label) => {
    return String(label ?? "")
        .replace(/[\r\n\t]+/g, " ")
        .trim()
        .slice(0, MAX_LABEL_LENGTH);
};

// 저장된 계정 목록에서 올바른 항목만 남긴다. 설정 폴더는 저장하지 않고 id로 정해, 설정 파일로 임의 경로를 가리킬 수 없다.
const normalizeAccounts = (saved) => {
    if (!Array.isArray(saved)) {
        return [];
    }

    const seen = new Set();
    const accounts = [];

    for (const entry of saved) {
        if (typeof entry?.id !== "string" || !ACCOUNT_ID_PATTERN.test(entry.id) || seen.has(entry.id)) {
            continue;
        }

        seen.add(entry.id);
        accounts.push({ id: entry.id, label: sanitizeLabel(entry.label) || entry.id, shared: entry.shared === true });
    }

    return accounts.slice(0, MAX_ACCOUNTS);
};

const getEntryStat = (file) => {
    try {
        return fs.lstatSync(file);
    } catch {
        return null;
    }
};

// target이 source를 가리키는 링크가 되게 한다. 이미 있는 실제 폴더·파일은 건드리지 않고, 다른 곳을 가리키는 낡은 링크만 바꾼다.
// 폴더는 관리자 권한이 필요 없는 junction으로, 파일은 심볼릭 링크로 만들고 안 되면 복사한다.
const linkEntry = (source, target, isDirectory) => {
    const stat = getEntryStat(target);

    if (stat && !stat.isSymbolicLink()) {
        return;
    }

    if (stat && path.resolve(fs.readlinkSync(target)) === path.resolve(source)) {
        return;
    }

    if (stat) {
        fs.unlinkSync(target);
    }

    try {
        fs.symlinkSync(source, target, isDirectory ? "junction" : "file");
    } catch (error) {
        if (isDirectory) {
            throw error;
        }

        fs.copyFileSync(source, target);
    }
};

// 새 위치에 없는 항목을 가리키는 낡은 링크는 이전 위치의 데이터를 계속 보여 주므로 끊는다. 실제 폴더·파일은 그대로 둔다.
const unlinkStaleEntry = (target) => {
    if (getEntryStat(target)?.isSymbolicLink()) {
        fs.unlinkSync(target);
    }
};

const linkSharedData = (baseDir, configDir) => {
    fs.mkdirSync(configDir, { recursive: true });
    fs.mkdirSync(path.join(baseDir, "projects"), { recursive: true });

    for (const [names, isDirectory] of [
        [SHARED_DIRS, true],
        [SHARED_FILES, false]
    ]) {
        for (const name of names) {
            const source = path.join(baseDir, name);
            const target = path.join(configDir, name);

            if (fs.existsSync(source)) {
                linkEntry(source, target, isDirectory);
            } else {
                unlinkStaleEntry(target);
            }
        }
    }
};

const createAccountStore = ({ accountsRoot, getBaseDir = () => resolveBaseDir("") }) => {
    // 기본 계정은 기본 .claude, 나머지는 앱 데이터 폴더 아래 id 이름의 폴더다. 알 수 없는 id면 빈 문자열이다.
    const getConfigDir = (accountId) => {
        if (accountId === DEFAULT_ACCOUNT_ID) {
            return getBaseDir();
        }

        return ACCOUNT_ID_PATTERN.test(accountId) ? path.join(accountsRoot, accountId) : "";
    };

    const createAccount = ({ label, shareData }) => {
        const id = `acct-${crypto.randomBytes(4).toString("hex")}`;
        const configDir = getConfigDir(id);

        fs.mkdirSync(configDir, { recursive: true });

        if (shareData) {
            linkSharedData(getBaseDir(), configDir);
        }

        return { id: id, label: sanitizeLabel(label), configDir: configDir, shared: shareData === true };
    };

    // 기본 .claude의 위치가 바뀌었거나 앱을 옮긴 뒤에도 연결이 맞도록 다시 이어 준다.
    const syncSharedData = (accountId) => {
        const configDir = getConfigDir(accountId);

        if (accountId === DEFAULT_ACCOUNT_ID || !configDir || !fs.existsSync(configDir)) {
            return;
        }

        linkSharedData(getBaseDir(), configDir);
    };

    // 연결은 원본을 따라가 지워지지 않도록 먼저 연결만 끊고 나서 폴더를 지운다. 앱이 만든 폴더(accountsRoot 아래 id 폴더)만 지운다.
    const removeAccountDir = (accountId) => {
        const configDir = getConfigDir(accountId);

        if (accountId === DEFAULT_ACCOUNT_ID || !configDir) {
            return false;
        }

        try {
            for (const name of fs.readdirSync(configDir)) {
                if (getEntryStat(path.join(configDir, name))?.isSymbolicLink()) {
                    fs.unlinkSync(path.join(configDir, name));
                }
            }
        } catch {}

        fs.rmSync(configDir, { recursive: true, force: true });

        return true;
    };

    return { getConfigDir: getConfigDir, createAccount: createAccount, syncSharedData: syncSharedData, removeAccountDir: removeAccountDir };
};

module.exports = {
    createAccountStore,
    normalizeAccounts,
    sanitizeLabel,
    resolveBaseDir,
    getHomeConfigDir,
    DEFAULT_ACCOUNT_ID,
    DEFAULT_ACCOUNT_LABEL,
    ACCOUNT_ID_PATTERN,
    MAX_ACCOUNTS,
    SHARED_DIRS,
    SHARED_FILES
};

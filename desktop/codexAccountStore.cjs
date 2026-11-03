const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { sanitizeLabel, MAX_ACCOUNTS } = require("./accountStore.cjs");
const { getDefaultCodexHome } = require("./codexCli.cjs");

const DEFAULT_CODEX_ACCOUNT_ID = "default";
const DEFAULT_CODEX_ACCOUNT_LABEL = "기본 계정";
const CODEX_ACCOUNT_ID_PATTERN = /^cx-[0-9a-f]{8}$/;

// 저장된 목록에서 올바른 항목만 남긴다. 폴더는 저장하지 않고 id로 정해, 설정 파일로 임의 경로를 가리킬 수 없다.
const normalizeCodexAccounts = (saved) => {
    if (!Array.isArray(saved)) {
        return [];
    }

    const seen = new Set();
    const accounts = [];

    for (const entry of saved) {
        if (typeof entry?.id !== "string" || !CODEX_ACCOUNT_ID_PATTERN.test(entry.id) || seen.has(entry.id)) {
            continue;
        }

        seen.add(entry.id);
        accounts.push({ id: entry.id, label: sanitizeLabel(entry.label) || entry.id });
    }

    return accounts.slice(0, MAX_ACCOUNTS);
};

// 기본 계정은 기본 Codex 폴더(CODEX_HOME 또는 ~/.codex), 나머지는 앱 데이터 폴더 아래 id 이름의 폴더(그 계정의 CODEX_HOME)다. 알 수 없는 id면 빈 문자열이다.
const createCodexAccountStore = ({ accountsRoot, getBaseHome = () => getDefaultCodexHome() }) => {
    const getHome = (accountId) => {
        if (accountId === DEFAULT_CODEX_ACCOUNT_ID) {
            return getBaseHome();
        }

        return CODEX_ACCOUNT_ID_PATTERN.test(accountId) ? path.join(accountsRoot, accountId) : "";
    };

    const createAccount = ({ label }) => {
        const id = `cx-${crypto.randomBytes(4).toString("hex")}`;
        const home = getHome(id);

        fs.mkdirSync(home, { recursive: true });

        return { id: id, label: sanitizeLabel(label), home: home };
    };

    // 앱이 만든 폴더(accountsRoot 아래 id 폴더)만 지운다. 기본 계정은 지우지 않는다.
    const removeAccountDir = (accountId) => {
        const home = getHome(accountId);

        if (accountId === DEFAULT_CODEX_ACCOUNT_ID || !home) {
            return false;
        }

        fs.rmSync(home, { recursive: true, force: true });

        return true;
    };

    return { getHome: getHome, createAccount: createAccount, removeAccountDir: removeAccountDir };
};

module.exports = { createCodexAccountStore, normalizeCodexAccounts, DEFAULT_CODEX_ACCOUNT_ID, DEFAULT_CODEX_ACCOUNT_LABEL, CODEX_ACCOUNT_ID_PATTERN };

const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const os = require("node:os");
const path = require("node:path");

const SECURITY_COMMAND = "/usr/bin/security";
const SERVICE_NAME = "Claude Code-credentials";
const HASH_LENGTH = 8;
const READ_TIMEOUT_MS = 10000;
const NOT_FOUND_EXIT_CODE = 44;
const HEX_PATTERN = /^(?:[0-9a-f]{2})+$/i;

// 최근 Claude Code는 설정 폴더 경로의 SHA-256 앞 8자를 서비스 이름 뒤에 붙인다. 접미사 없는 옛 이름은 기본 폴더(~/.claude)의 것만 쓴다(다른 계정의 로그인을 읽으면 안 된다).
const getServiceNames = (configDir, homeDir = os.homedir()) => {
    const hashInputs = [...new Set([configDir, path.resolve(configDir)])];
    const names = hashInputs.map((input) => `${SERVICE_NAME}-${crypto.createHash("sha256").update(input).digest("hex").slice(0, HASH_LENGTH)}`);

    if (path.resolve(configDir) === path.resolve(homeDir, ".claude")) {
        names.push(SERVICE_NAME);
    }

    return names;
};

// security -w는 JSON이 출력하기 어려운 문자를 담고 있으면 16진수 문자열로 돌려준다.
const decodeSecret = (output) => {
    const text = output.trim();

    return HEX_PATTERN.test(text) ? Buffer.from(text, "hex").toString("utf8") : text;
};

const parseOAuth = (secret) => {
    try {
        return JSON.parse(secret).claudeAiOauth ?? null;
    } catch {
        return null;
    }
};

const runSecurity = (args, options) => {
    return new Promise((resolve) => {
        (options.execFileImpl || execFile)(SECURITY_COMMAND, args, { timeout: READ_TIMEOUT_MS, windowsHide: true, maxBuffer: 1024 * 1024 }, (error, stdout) => {
            resolve({ error: error, stdout: String(stdout || "") });
        });
    });
};

const pickNewer = (current, candidate) => {
    return !current || Number(candidate?.expiresAt) > Number(current.expiresAt) ? candidate : current;
};

// macOS에서 Claude Code는 로그인 정보를 설정 폴더의 파일이 아니라 키체인에 둔다. 앱이 쓰는 방식과 같게 읽기만 하고(키체인을 바꾸지 않는다) 토큰은 이 모듈 밖에 로그로 남기지 않는다.
// 없으면 oauth가 null, 읽지 못했으면(접근 거부·시간 초과) isBlocked가 true다. options.keychain은 검증용으로 다른 키체인 파일을 가리킨다.
const readKeychainOAuth = async (configDir, options = {}) => {
    const keychainArgs = options.keychain ? [options.keychain] : [];
    let oauth = null;
    let isBlocked = false;

    for (const service of getServiceNames(configDir, options.homeDir)) {
        const { error, stdout } = await runSecurity(["find-generic-password", "-s", service, "-w", ...keychainArgs], options);

        if (error) {
            isBlocked = isBlocked || error.code !== NOT_FOUND_EXIT_CODE;

            continue;
        }

        const found = parseOAuth(decodeSecret(stdout));

        if (found?.accessToken) {
            oauth = pickNewer(oauth, found);
        }
    }

    return { oauth: oauth, isBlocked: !oauth && isBlocked };
};

module.exports = { readKeychainOAuth, getServiceNames, decodeSecret };

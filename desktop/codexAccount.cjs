const fs = require("node:fs");
const path = require("node:path");
const { getCodexLoginStatus, getPlanName } = require("./codexCli.cjs");

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const MIN_REFRESH_GAP_MS = 15000;
const MAX_ROLLOUT_FILES = 6;
const TAIL_BYTES = 1024 * 1024;
const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * 60;
const NO_USAGE_MESSAGE = "아직 한도를 읽을 수 있는 Codex 사용 기록이 없어요. 이 계정으로 Codex를 한 번 쓰면 여기에 표시돼요.";

const createFailure = (code, msg) => {
    return { code: code, msg: msg };
};

// 창 길이(분)를 Claude 한도와 같은 이름으로 부른다. 화면의 "시간보다 빨리 쓰고 있어요"가 "5시간"·"주간"으로 시작하는 이름만 기간을 안다.
const getWindowLabel = (minutes) => {
    if (minutes === 5 * MINUTES_PER_HOUR) {
        return "5시간 한도";
    }

    if (minutes === 7 * MINUTES_PER_DAY) {
        return "주간 한도";
    }

    return minutes >= MINUTES_PER_DAY ? `${Math.round(minutes / MINUTES_PER_DAY)}일 한도` : `${Math.max(1, Math.round(minutes / MINUTES_PER_HOUR))}시간 한도`;
};

// 창이 이미 리셋된 뒤의 기록이면(리셋 시각이 지남) 지금은 새 창이라 쓴 양을 0으로 본다.
const toLimit = (window, nowMs) => {
    const resetsAt = Number(window.resets_at) * 1000;
    const isReset = !Number.isFinite(resetsAt) || resetsAt <= nowMs;

    return { label: getWindowLabel(Number(window.window_minutes)), percent: isReset ? 0 : Math.min(100, Math.max(0, Number(window.used_percent))), resetsAt: isReset ? 0 : resetsAt };
};

const isValidWindow = (window) => {
    return Boolean(window) && Number.isFinite(Number(window.used_percent)) && Number.isFinite(Number(window.window_minutes)) && Number(window.window_minutes) > 0;
};

// 세션 기록(rollout-*.jsonl)의 token_count 이벤트가 마지막으로 알린 한도를 읽는다. 비공식 형식이라 알 수 없는 줄은 건너뛴다.
const parseRateLimitLine = (line, nowMs) => {
    try {
        const event = JSON.parse(line);
        const rateLimits = event?.payload?.rate_limits;
        const windows = [rateLimits?.primary, rateLimits?.secondary].filter(isValidWindow);

        if (event?.payload?.type !== "token_count" || windows.length === 0) {
            return null;
        }

        return { limits: windows.map((window) => toLimit(window, nowMs)), planType: String(rateLimits.plan_type || ""), fetchedAt: Date.parse(event.timestamp) || 0 };
    } catch {
        return null;
    }
};

const listDirectory = (dir) => {
    try {
        return fs.readdirSync(dir).sort().reverse();
    } catch {
        return [];
    }
};

// sessions/YYYY/MM/DD/rollout-*.jsonl을 최근 것부터 최대 MAX_ROLLOUT_FILES개 모은다(이름이 시각 순이라 이름 순서가 곧 시간 순서다).
const listRecentRollouts = (codexHome) => {
    const root = path.join(codexHome, "sessions");
    const files = [];

    for (const year of listDirectory(root)) {
        for (const month of listDirectory(path.join(root, year))) {
            for (const day of listDirectory(path.join(root, year, month))) {
                for (const name of listDirectory(path.join(root, year, month, day))) {
                    if (name.startsWith("rollout-") && name.endsWith(".jsonl")) {
                        files.push(path.join(root, year, month, day, name));
                    }

                    if (files.length >= MAX_ROLLOUT_FILES) {
                        return files;
                    }
                }
            }
        }
    }

    return files;
};

const readTail = (file) => {
    const descriptor = fs.openSync(file, "r");

    try {
        const { size } = fs.fstatSync(descriptor);
        const length = Math.min(size, TAIL_BYTES);
        const buffer = Buffer.alloc(length);

        fs.readSync(descriptor, buffer, 0, length, size - length);

        return buffer.toString("utf8");
    } finally {
        fs.closeSync(descriptor);
    }
};

const readCodexUsage = (codexHome, nowMs) => {
    for (const file of listRecentRollouts(codexHome)) {
        try {
            const lines = readTail(file).split("\n");

            for (let index = lines.length - 1; index >= 0; index--) {
                const usage = lines[index].includes('"rate_limits"') ? parseRateLimitLine(lines[index], nowMs) : null;

                if (usage) {
                    return usage;
                }
            }
        } catch {}
    }

    return null;
};

const createEmptyAccount = () => {
    return { installed: true, loggedIn: false, profile: null, limits: [], fetchedAt: 0, error: null, loginExpiresAt: 0 };
};

// 계정마다 하나. 로그인 상태(`codex login status`)와 신원(auth.json의 id_token 클레임), 사용 한도(세션 기록)를 읽어 보관한다. 토큰은 이 파일 밖으로 내보내지 않는다.
const createCodexAccountReader = (options) => {
    const now = options.now || Date.now;
    const onChange = options.onChange || (() => {});
    let account = createEmptyAccount();
    let lastAttemptAt = 0;
    let inFlight = null;
    let timer = null;

    const run = async () => {
        lastAttemptAt = now();

        try {
            const status = await getCodexLoginStatus(options.codexHome, options.launch);

            if (!status.installed || !status.loggedIn) {
                account = {
                    ...createEmptyAccount(),
                    installed: status.installed,
                    error: status.installed ? createFailure("NOT_LOGGED_IN", "이 계정은 Codex에 로그인되어 있지 않아요.") : createFailure("NOT_INSTALLED", "Codex가 설치돼 있지 않아요.")
                };
            } else {
                const usage = readCodexUsage(options.codexHome, now());
                const identity = status.identity;
                const plan = identity?.plan || getPlanName(usage?.planType);

                account = {
                    installed: true,
                    loggedIn: true,
                    profile: { name: identity?.name || "", email: identity?.email || "", plan: plan, organization: "" },
                    limits: usage ? usage.limits : [],
                    fetchedAt: usage ? usage.fetchedAt : 0,
                    error: usage ? null : createFailure("NO_USAGE", NO_USAGE_MESSAGE),
                    loginExpiresAt: 0
                };
            }
        } catch (error) {
            account = { ...account, error: createFailure("READ_FAILED", `계정 정보를 읽지 못했어요. ${error.message}`) };
        }

        onChange(account);

        return account;
    };

    // 진행 중이거나 방금 시도했으면 새로 읽지 않는다. 로그인·로그아웃 직후처럼 반드시 다시 읽어야 하면 isForced로 간격 검사를 건너뛴다.
    const refresh = async (isForced = false) => {
        if (inFlight) {
            return inFlight;
        }

        if (!isForced && lastAttemptAt && now() - lastAttemptAt < MIN_REFRESH_GAP_MS) {
            return account;
        }

        inFlight = run().finally(() => {
            inFlight = null;
        });

        return inFlight;
    };

    const start = () => {
        refresh();

        timer = setInterval(() => refresh(), REFRESH_INTERVAL_MS);
        timer.unref();
    };

    const stop = () => {
        clearInterval(timer);
    };

    return { start: start, stop: stop, refresh: refresh, getAccount: () => account };
};

module.exports = { createCodexAccountReader, readCodexUsage, parseRateLimitLine, getWindowLabel };

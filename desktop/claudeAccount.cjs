const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const PROFILE_URL = "https://api.anthropic.com/api/oauth/profile";
const OAUTH_BETA_HEADER = "oauth-2025-04-20";
const REQUEST_TIMEOUT_MS = 10000;
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const MIN_REFRESH_GAP_MS = 15000;
const MIN_RENEW_GAP_MS = 30 * 60 * 1000;
const SESSION_LABEL = "5시간 한도";
const WEEKLY_LABEL = "주간 한도";
const SCOPED_FALLBACK_NAME = "모델별";
const EXPIRED_MESSAGE = "Claude 로그인 정보가 만료됐어요. '다시 로그인'을 누르거나 이 계정으로 Claude Code를 한 번 실행해 주세요.";
const LEGACY_LIMITS = [
    { key: "five_hour", label: SESSION_LABEL },
    { key: "seven_day", label: WEEKLY_LABEL }
];
const PLAN_NAMES = { claude_pro: "Pro", claude_max: "Max", claude_team: "Team", claude_enterprise: "Enterprise" };
const MAX_MULTIPLIER_PATTERN = /max_(\d+)x/;

const createFailure = (code, msg) => {
    return { code: code, msg: msg };
};

// 엔진의 기본 설정 폴더(~/.claude)와 같아야 한다. 다른 계정은 credentialsFile 옵션으로 지정한다.
const getCredentialsFile = () => {
    return path.join(os.homedir(), ".claude", ".credentials.json");
};

const readOAuth = (credentialsFile) => {
    try {
        return JSON.parse(fs.readFileSync(credentialsFile, "utf8")).claudeAiOauth ?? null;
    } catch {
        return null;
    }
};

const getLimitLabel = (entry) => {
    if (entry.kind === "session") {
        return SESSION_LABEL;
    }

    if (entry.kind === "weekly_all") {
        return WEEKLY_LABEL;
    }

    if (entry.kind === "weekly_scoped") {
        return `${WEEKLY_LABEL} · ${entry.scope?.model?.display_name || SCOPED_FALLBACK_NAME}`;
    }

    return "";
};

const toLimit = (label, percent, resetsAt) => {
    const resetTime = Date.parse(resetsAt);

    return { label: label, percent: Math.min(100, Math.max(0, percent)), resetsAt: Number.isNaN(resetTime) ? 0 : resetTime };
};

const isValidLimit = (label, percent) => {
    return Boolean(label) && typeof percent === "number" && Number.isFinite(percent);
};

// 응답은 비공식이라 limits[]를 기준으로 읽고, 없으면 five_hour·seven_day로 대신한다. 알 수 없는 항목은 건너뛴다.
const parseUsage = (body) => {
    const entries = Array.isArray(body?.limits) ? body.limits : [];
    const limits = entries.filter((entry) => isValidLimit(getLimitLabel(entry), entry.percent)).map((entry) => toLimit(getLimitLabel(entry), entry.percent, entry.resets_at));

    if (limits.length > 0) {
        return limits;
    }

    return LEGACY_LIMITS.filter(({ key, label }) => isValidLimit(label, body?.[key]?.utilization)).map(({ key, label }) => toLimit(label, body[key].utilization, body[key].resets_at));
};

const getPlanName = (account, organization) => {
    let plan = PLAN_NAMES[organization?.organization_type] || "";

    if (!plan && account?.has_claude_max) {
        plan = "Max";
    }

    if (!plan && account?.has_claude_pro) {
        plan = "Pro";
    }

    const multiplier = MAX_MULTIPLIER_PATTERN.exec(organization?.rate_limit_tier || "")?.[1];

    return plan === "Max" && multiplier ? `${plan} ${multiplier}x` : plan;
};

// 아바타 URL은 응답에 없다. 화면은 이름(없으면 이메일)의 첫 글자를 그린다.
const parseProfile = (body) => {
    const name = String(body?.account?.display_name || body?.account?.full_name || "").trim();
    const email = String(body?.account?.email || "").trim();

    if (!name && !email) {
        return null;
    }

    return { name: name, email: email, plan: getPlanName(body.account, body.organization), organization: String(body.organization?.name || "") };
};

const createEmptyAccount = () => {
    return { profile: null, limits: [], fetchedAt: 0, error: null };
};

// 토큰은 이 파일 안에서만 읽어 Anthropic 엔드포인트 두 곳으로만 보내고 화면·로그에는 넘기지 않는다. 만료돼도 갱신하지 않는다(refresh token을 쓰면 Claude Code 로그인에 영향을 줄 수 있다).
// 앱을 켤 때 한 번 조회해 보관하고 이후 REFRESH_INTERVAL_MS마다 다시 읽는다. 일부만 실패하면 성공한 쪽은 새 값, 실패한 쪽은 이전 값을 유지한다.
const createAccountReader = (options = {}) => {
    const fetchImpl = options.fetchImpl || fetch;
    const now = options.now || Date.now;
    const onChange = options.onChange || (() => {});
    let account = createEmptyAccount();
    let lastAttemptAt = 0;
    let lastRenewAt = 0;
    let inFlight = null;
    let timer = null;

    const fetchJson = async (url, token) => {
        const response = await fetchImpl(url, {
            headers: { Authorization: `Bearer ${token}`, "anthropic-beta": OAUTH_BETA_HEADER },
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        });

        if (response.status === 401) {
            return { failure: createFailure("TOKEN_EXPIRED", EXPIRED_MESSAGE) };
        }

        if (!response.ok) {
            return { failure: createFailure("HTTP_ERROR", `계정 정보를 가져오지 못했어요 (HTTP ${response.status}).`) };
        }

        return { body: await response.json() };
    };

    const fetchOnce = async () => {
        const oauth = readOAuth(options.credentialsFile || getCredentialsFile());

        if (!oauth?.accessToken && process.platform === "darwin") {
            return { failure: createFailure("UNSUPPORTED_PLATFORM", "macOS는 로그인 정보를 키체인에 저장해서 이 앱이 사용량을 조회하지 못해요.") };
        }

        if (!oauth?.accessToken) {
            return { failure: createFailure("NO_CREDENTIALS", "이 계정의 Claude 구독 로그인 정보를 찾지 못했어요. '다시 로그인'으로 로그인해 주세요.") };
        }

        if (Number(oauth.expiresAt) <= now()) {
            return { failure: createFailure("TOKEN_EXPIRED", EXPIRED_MESSAGE) };
        }

        const [usageResult, profileResult] = await Promise.all([fetchJson(USAGE_URL, oauth.accessToken), fetchJson(PROFILE_URL, oauth.accessToken)]);
        const limits = usageResult.body ? parseUsage(usageResult.body) : [];
        const profile = profileResult.body ? parseProfile(profileResult.body) : null;
        const emptyFailure = createFailure("UNSUPPORTED_RESPONSE", "응답에서 계정 정보를 찾지 못했어요.");

        return {
            limits: limits.length > 0 ? limits : null,
            profile: profile,
            failure: usageResult.failure || profileResult.failure || (limits.length === 0 || !profile ? emptyFailure : null)
        };
    };

    // 만료로 실패하면 CLI가 토큰을 갱신하도록 맡기고 한 번 다시 읽는다. 갱신이 안 되는 계정이 5분마다 CLI를 띄우지 않게 간격을 둔다.
    const fetchAccount = async () => {
        const result = await fetchOnce();

        if (result.failure?.code !== "TOKEN_EXPIRED" || !options.renewCredentials || (lastRenewAt && now() - lastRenewAt < MIN_RENEW_GAP_MS)) {
            return result;
        }

        lastRenewAt = now();

        return (await options.renewCredentials()) ? fetchOnce() : result;
    };

    const run = async () => {
        lastAttemptAt = now();

        try {
            const result = await fetchAccount();
            const hasNewData = Boolean(result.limits || result.profile);

            account = {
                profile: result.profile || account.profile,
                limits: result.limits || account.limits,
                fetchedAt: hasNewData ? now() : account.fetchedAt,
                error: result.failure
            };
        } catch (error) {
            account = { ...account, error: createFailure("REQUEST_FAILED", `계정 정보를 가져오지 못했어요. ${error.message}`) };
        }

        onChange(account);

        return account;
    };

    // 진행 중이거나 방금 시도했으면 새로 요청하지 않고 지금 값을 돌려준다(새로 고침 연타 방지). 로그인 직후처럼 반드시 다시 읽어야 하면 isForced로 간격 검사를 건너뛴다.
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

module.exports = { createAccountReader };

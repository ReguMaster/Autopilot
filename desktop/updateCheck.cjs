const LATEST_URL = "https://api.github.com/repos/ReguMaster/Autopilot/releases/latest";
const RELEASES_URL = "https://github.com/ReguMaster/Autopilot/releases";
const REQUEST_TIMEOUT_MS = 10000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)$/;

const parseVersion = (text) => {
    const match = VERSION_PATTERN.exec(String(text ?? ""));

    return match ? match.slice(1).map(Number) : null;
};

const isNewerVersion = (candidate, current) => {
    const next = parseVersion(candidate);
    const now = parseVersion(current);

    if (!next || !now) {
        return false;
    }

    const index = next.findIndex((part, position) => part !== now[position]);

    return index !== -1 && next[index] > now[index];
};

// 최신 릴리스 태그가 현재 버전보다 높으면 {version, url}을 보관하고 바뀔 때만 onChange로 알린다. 열 주소는 검증한 태그로 직접 만들어 응답의 URL을 쓰지 않는다.
// 조회에 실패하면 이전 값을 유지하고 조용히 넘어간다. 비인증 GitHub API 한도(시간당 60회)보다 훨씬 드물게 부른다.
const createUpdateCheck = (options) => {
    const fetchImpl = options.fetchImpl || fetch;
    const onChange = options.onChange || (() => {});
    let update = null;

    const check = async () => {
        try {
            const response = await fetchImpl(LATEST_URL, { headers: { Accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });

            if (!response.ok) {
                return update;
            }

            const tag = (await response.json()).tag_name;
            const next = isNewerVersion(tag, options.currentVersion) ? { version: tag.replace(/^v/, ""), url: `${RELEASES_URL}/tag/${tag}` } : null;

            if (next?.version !== update?.version) {
                update = next;
                onChange(update);
            }
        } catch {}

        return update;
    };

    const start = () => {
        check();
        setInterval(check, CHECK_INTERVAL_MS).unref();
    };

    return { check: check, start: start, getUpdate: () => update };
};

module.exports = { createUpdateCheck, isNewerVersion };

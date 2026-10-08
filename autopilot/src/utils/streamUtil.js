import { MAX_STREAM_LINE_LENGTH, SECOND_MS } from "./config.js";
import dateUtil from "./dateUtil.js";
import util from "./util.js";

const TOOL_ARGUMENT_MAX_LENGTH = 120;

const parseStreamLine = (line) => {
    if (line.length > MAX_STREAM_LINE_LENGTH) {
        return null;
    }

    try {
        return JSON.parse(line);
    } catch {
        return null;
    }
};

const getToolArgument = (input) => {
    const argument = [input.command, input.file_path, input.pattern, input.description, input.url, input.path].find(Boolean) || "";

    return String(argument).split(/\r?\n/)[0].slice(0, TOOL_ARGUMENT_MAX_LENGTH);
};

const handleInitEvent = (event, sessionStats, writeLog, eventTime) => {
    sessionStats.session = event.session_id;

    writeLog(`${eventTime} [세션] ${sessionStats.session} (claude --resume 으로 전체 기록 확인)`);
};

const handleAssistantEvent = (event, writeLog, eventTime) => {
    for (const item of event.message?.content || []) {
        if (item.type === "text" && item.text?.trim()) {
            writeLog(`${eventTime} ${item.text.trim()}`);
        }

        if (item.type === "tool_use") {
            writeLog(`${eventTime}   > ${item.name} ${getToolArgument(item.input || {})}`);
        }
    }
};

// allowed* 상태는 정상이므로 한도 도달로 보지 않는다.
const handleRateLimitEvent = (event, sessionStats, writeLog, eventTime) => {
    const rateLimitInfo = event.rate_limit_info || {};

    if (Number.isFinite(Number(rateLimitInfo.resetsAt))) {
        sessionStats.resetAt = Number(rateLimitInfo.resetsAt) * SECOND_MS;
    }

    if (typeof rateLimitInfo.status !== "string" || rateLimitInfo.status.startsWith("allowed")) {
        return;
    }

    sessionStats.limitHit = true;

    const resetTime = sessionStats.resetAt ? dateUtil.getTimeString(new Date(sessionStats.resetAt)) : "?";

    writeLog(`${eventTime} [사용량 한도] ${rateLimitInfo.rateLimitType} ${rateLimitInfo.status} · ${resetTime} 리셋`);
};

const handleResultEvent = (event, sessionStats, writeLog, eventTime) => {
    Object.assign(sessionStats, { isError: Boolean(event.is_error), turns: event.num_turns, cost: event.total_cost_usd, summary: event.result });

    writeLog(`${eventTime} [결과] ${event.subtype} · ${event.num_turns}턴 · ${dateUtil.getMinutesFromMs(event.duration_ms)}분 · $${util.formatCost(event.total_cost_usd)}`);
};

// stream-json 한 줄을 해석해 세션 통계와 로그에 반영한다. 하위 도구 이벤트는 무시한다.
const handleStreamEvent = (line, sessionStats, writeLog) => {
    const event = parseStreamLine(line);

    if (!event || event.parent_tool_use_id) {
        return;
    }

    const eventTime = dateUtil.getTimeString(new Date());

    if (event.type === "system" && event.subtype === "init") {
        handleInitEvent(event, sessionStats, writeLog, eventTime);
    } else if (event.type === "assistant") {
        handleAssistantEvent(event, writeLog, eventTime);
    } else if (event.type === "rate_limit_event") {
        handleRateLimitEvent(event, sessionStats, writeLog, eventTime);
    } else if (event.type === "result") {
        handleResultEvent(event, sessionStats, writeLog, eventTime);
    }
};

export default { handleStreamEvent };

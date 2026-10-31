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

// 백그라운드 작업 알림으로 같은 세션이 이어지면 result가 한 번 더 온다. num_turns는 이어진 부분만 세고 total_cost_usd는 세션 누적이다.
const handleResultEvent = (event, sessionStats, writeLog, eventTime) => {
    Object.assign(sessionStats, { isError: Boolean(event.is_error), turns: (sessionStats.turns || 0) + (event.num_turns || 0), cost: event.total_cost_usd, summary: event.result });

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

// Codex는 명령을 셸로 감싸 보고한다(bash -lc '…', powershell.exe -Command "…"). 앱의 도구 줄에는 안쪽 명령만 보인다.
const CODEX_SHELL_PATTERN = /^(?:"[^"]*"|\S+)\s+(?:-NoProfile\s+)?(?:-lc|-c|-Command)\s+([\s\S]+)$/i;
const CODEX_FILE_TOOLS = { add: "Write", update: "Edit", delete: "Delete" };
const CODEX_LIMIT_PATTERN = /usage limit|rate limit/i;

const getCodexCommand = (command) => {
    const text = String(command || "");
    const inner = text.match(CODEX_SHELL_PATTERN)?.[1].trim() || text;

    return inner.replace(/^(["'])([\s\S]*)\1$/, "$2");
};

// 오류 문구가 사용량 한도면 표시한다. Codex는 리셋 시각을 주지 않아 회차 실패로 세고 재시도한다.
// shortcut: 리셋 시각을 모르므로 한도 대기 없이 실패 재시도로 처리한다. Codex가 리셋 시각을 이벤트로 주면 resetAt을 채워 Claude와 같은 대기로 바꾼다.
const handleCodexLimit = (message, sessionStats, writeLog, eventTime) => {
    if (CODEX_LIMIT_PATTERN.test(message)) {
        sessionStats.limitHit = true;

        writeLog(`${eventTime} [사용량 한도] Codex ${message}`);
    }
};

const handleCodexItem = (event, sessionStats, writeLog, eventTime) => {
    const item = event.item || {};

    if (event.type === "item.started") {
        if (item.type === "command_execution") {
            writeLog(`${eventTime}   > Bash ${getToolArgument({ command: getCodexCommand(item.command) })}`);
        } else if (item.type === "mcp_tool_call") {
            writeLog(`${eventTime}   > ${item.server}.${item.tool}`);
        }

        return;
    }

    if (item.type === "agent_message" && item.text?.trim()) {
        sessionStats.summary = item.text.trim();

        writeLog(`${eventTime} ${item.text.trim()}`);
    } else if (item.type === "file_change") {
        for (const change of item.changes || []) {
            writeLog(`${eventTime}   > ${CODEX_FILE_TOOLS[change.kind] || "Edit"} ${getToolArgument({ path: change.path })}`);
        }
    } else if (item.type === "web_search") {
        writeLog(`${eventTime}   > WebSearch ${getToolArgument({ pattern: item.query })}`);
    }
};

// codex exec --json 한 줄을 해석해 Claude 세션과 같은 형식의 로그(말은 시각 뒤 본문, 도구는 "  > 이름 인자")로 남긴다. 모르는 이벤트는 무시한다.
const handleCodexEvent = (line, sessionStats, writeLog) => {
    const event = parseStreamLine(line);

    if (!event) {
        return;
    }

    const eventTime = dateUtil.getTimeString(new Date());

    if (event.type === "thread.started") {
        sessionStats.session = event.thread_id;

        writeLog(`${eventTime} [세션] ${sessionStats.session} (codex resume 으로 전체 기록 확인)`);
    } else if (event.type === "item.started" || event.type === "item.completed") {
        handleCodexItem(event, sessionStats, writeLog, eventTime);
    } else if (event.type === "turn.completed") {
        const usage = event.usage || {};

        writeLog(`${eventTime} [결과] 완료 · 입력 ${usage.input_tokens ?? 0} · 출력 ${usage.output_tokens ?? 0} 토큰`);
    } else if (event.type === "turn.failed") {
        const message = String(event.error?.message || "알 수 없는 오류");

        // 다시 연결하는 중 같은 error 이벤트는 회차를 끝내지 않으므로 turn.failed만 실패로 센다.
        sessionStats.isError = true;

        writeLog(`${eventTime} [결과] 실패 · ${message}`);
        handleCodexLimit(message, sessionStats, writeLog, eventTime);
    } else if (event.type === "error") {
        const message = String(event.message || "알 수 없는 오류");

        writeLog(`${eventTime} [오류] ${message}`);
        handleCodexLimit(message, sessionStats, writeLog, eventTime);
    }
};

export default { handleStreamEvent, handleCodexEvent, getCodexCommand };

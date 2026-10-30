import { BRAINSTORM_PHASES, BRAINSTORM_PROVIDERS, PROVIDER_CLAUDE, PROVIDER_LABELS } from "./config.js";

const MAX_MESSAGE_LENGTH = 300;
const MAX_ITEMS = 10;
const MAX_ITEM_LENGTH = 200;
const MAX_DISPUTES = 10;
const MAX_TITLE_LENGTH = 120;
const MAX_POSITION_LENGTH = 600;
const DISPUTE_ID_PATTERN = /^d\d{1,2}$/;
const RESOLUTION_PATTERN = /^(d\d{1,2})=([a-z]+)$/;

// AI가 쓴 글은 한 줄로 펴고 제어 문자를 지워 길이를 묶는다. 문자열이 아니면 빈 값이다.
const clean = (value, maxLength) => {
    if (typeof value !== "string") {
        return "";
    }

    return value
        .replace(/[\u0000-\u001f\u007f]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, maxLength);
};

const cleanList = (list) => {
    return (Array.isArray(list) ? list : [])
        .map((item) => clean(item, MAX_ITEM_LENGTH))
        .filter(Boolean)
        .slice(0, MAX_ITEMS);
};

// 협의 한 번의 발언. 답에서 JSON 객체 하나를 꺼내 형식을 확인한다. 발언이 없거나 JSON이 아니면 null이다.
// 반대할 점이나 더 개선할 점이 남았는데 합의라고 하면 합의로 보지 않는다.
const parseTurn = (text) => {
    const source = String(text || "");
    const start = source.indexOf("{");
    const end = source.lastIndexOf("}");

    if (start < 0 || end <= start) {
        return null;
    }

    let value;

    try {
        value = JSON.parse(source.slice(start, end + 1));
    } catch {
        return null;
    }

    const message = clean(value?.message, MAX_MESSAGE_LENGTH);

    if (!message) {
        return null;
    }

    const disagree = (Array.isArray(value.disagree) ? value.disagree : [])
        .map((item) => ({ point: clean(item?.point, MAX_ITEM_LENGTH), reason: clean(item?.reason, MAX_ITEM_LENGTH) }))
        .filter((item) => item.point)
        .slice(0, MAX_ITEMS);

    const improve = cleanList(value.improve);

    return {
        message: message,
        agree: cleanList(value.agree),
        disagree: disagree,
        improve: improve,
        changes: cleanList(value.changes),
        consensus: value.consensus === true && disagree.length === 0 && improve.length === 0
    };
};

const formatTurn = (turn, index) => {
    const lines = [`## ${Math.floor(index / 2) + 1}번째 주고받기 - ${PROVIDER_LABELS[turn.provider]}`, "", turn.message, ""];

    if (turn.agree.length) {
        lines.push(`- 동의: ${turn.agree.join(" / ")}`);
    }

    for (const item of turn.disagree) {
        lines.push(`- 반대: ${item.point}${item.reason ? ` (이유: ${item.reason})` : ""}`);
    }

    if (turn.improve.length) {
        lines.push(`- 더 개선할 점: ${turn.improve.join(" / ")}`);
    }

    if (turn.changes.length) {
        lines.push(`- 바꾼 점: ${turn.changes.join(" / ")}`);
    }

    return lines.join("\n").trimEnd();
};

// 사람이 읽는 협의 기록(proposals/<단계>-debate.md). turns는 { provider, message, agree, disagree, improve, changes }다.
const formatTranscript = (phaseLabel, turns, isConsensus) => {
    const ending = isConsensus ? "두 AI가 합의했어요." : "끝까지 맞추지 못한 쟁점이 남았어요.";

    return [`# ${phaseLabel} 협의 기록`, "", `Claude와 Codex가 ${Math.ceil(turns.length / 2)}번 주고받았어요. ${ending}`, "", ...turns.map((turn, index) => `${formatTurn(turn, index)}\n`)]
        .join("\n")
        .trimEnd();
};

// 합의 정리 회차가 쓴 쟁점 파일(JSON 배열 [{ title, claude, codex }]). 읽을 수 없으면 쟁점이 없는 것으로 본다. 아이디는 순서대로 d1, d2…로 다시 붙인다.
const parseDisputes = (text) => {
    let value;

    try {
        value = JSON.parse(String(text || "").replace(/^\uFEFF/, ""));
    } catch {
        return [];
    }

    return (Array.isArray(value) ? value : [])
        .map((item) => ({ title: clean(item?.title, MAX_TITLE_LENGTH), claude: clean(item?.claude, MAX_POSITION_LENGTH), codex: clean(item?.codex, MAX_POSITION_LENGTH) }))
        .filter((item) => item.title && item.claude && item.codex)
        .slice(0, MAX_DISPUTES)
        .map((item, index) => ({ id: `d${index + 1}`, ...item }));
};

const PROVIDERS = [PROVIDER_CLAUDE, ...BRAINSTORM_PROVIDERS];

const isDispute = (dispute) => {
    return DISPUTE_ID_PATTERN.test(dispute?.id) && ["title", "claude", "codex"].every((key) => typeof dispute[key] === "string" && dispute[key]);
};

// PHASE.json의 협의 결과. 고르기 전에는 resolved가 null이고, 고르면 쟁점마다 고른 쪽이다.
const isDebateState = (debate) => {
    if (debate === null) {
        return true;
    }

    const disputes = debate?.disputes;

    if (!BRAINSTORM_PHASES.includes(debate?.phase) || !Array.isArray(disputes) || disputes.length > MAX_DISPUTES || !disputes.every(isDispute)) {
        return false;
    }

    if (debate.resolved === null) {
        return true;
    }

    const ids = disputes.map((dispute) => dispute.id);
    const resolved = debate.resolved;

    return typeof resolved === "object" && Object.keys(resolved).length === ids.length && ids.every((id) => PROVIDERS.includes(resolved[id]));
};

// approve --resolve 값(d1=claude,d2=codex). 형식이 틀리거나 같은 쟁점을 두 번 고르면 null이다. 쟁점을 모두 골랐는지는 서비스가 확인한다.
const parseResolutions = (text) => {
    const resolutions = {};

    for (const item of String(text).split(",")) {
        const match = RESOLUTION_PATTERN.exec(item);

        if (!match || !PROVIDERS.includes(match[2]) || Object.hasOwn(resolutions, match[1])) {
            return null;
        }

        resolutions[match[1]] = match[2];
    }

    return resolutions;
};

export default { parseTurn, formatTranscript, parseDisputes, isDebateState, parseResolutions };

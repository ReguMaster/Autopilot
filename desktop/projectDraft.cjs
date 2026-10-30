// 새 프로젝트 만들기의 순수 규칙: 폴더 이름 검사, Claude 초안 요청·해석, brief.md 만들기. 메인(projectFiles·autopilotIpc)과 화면(esbuild가 묶음)이 함께 쓴다.

// 어디서 쓰나요. 초안 요청도 이 키로만 고르게 한다.
const PLATFORMS = [
    { key: "web", label: "웹" },
    { key: "mobile", label: "모바일 앱" },
    { key: "desktop", label: "데스크톱 앱" },
    { key: "server", label: "서버 · API" },
    { key: "cli", label: "CLI · 도구" },
    { key: "unknown", label: "아직 몰라요" }
];
const PLATFORM_KEYS = PLATFORMS.map((platform) => platform.key);
const MAX_PROJECT_NAME_LENGTH = 64;
const MAX_DRAFT_NAME_LENGTH = 40;
const MAX_WHAT_LENGTH = 2000;
const MAX_BRIEF_LENGTH = 32 * 1024;
const DRAFT_LIMITS = { label: 60, summary: 200, reason: 200, users: 6, features: 10, exclusions: 8, stack: 6, refs: 8 };
const RESERVED_NAME_PATTERN = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const INVALID_NAME_PATTERN = /[<>:"/\\|?*\u0000-\u001f]/;
// 줄바꿈·탭 말고 제어 문자는 지운다.
const CONTROL_PATTERN = /[\u0000-\u0008\u000b-\u001f\u007f]/g;

// Windows에서도 만들 수 있는 폴더 이름인지. 문제가 없으면 빈 문자열이다.
const getProjectNameError = (name) => {
    if (typeof name !== "string" || !name.trim()) {
        return "프로젝트 이름을 적어 주세요.";
    }

    if (name.length > MAX_PROJECT_NAME_LENGTH) {
        return `이름은 ${MAX_PROJECT_NAME_LENGTH}자까지 쓸 수 있어요.`;
    }

    if (INVALID_NAME_PATTERN.test(name)) {
        return '이름에 < > : " / \\ | ? * 는 쓸 수 없어요.';
    }

    if (name !== name.trimStart() || /[. ]$/.test(name)) {
        return "이름은 빈칸으로 시작하거나 점·빈칸으로 끝날 수 없어요.";
    }

    if (RESERVED_NAME_PATTERN.test(name)) {
        return "Windows가 쓰는 이름이라 쓸 수 없어요.";
    }

    return "";
};

const cleanText = (value, maxLength) => {
    return typeof value === "string" ? value.replace(CONTROL_PATTERN, " ").replace(/\s+/g, " ").trim().slice(0, maxLength) : "";
};

// 칸 목록: 글자를 다듬고 빈 것·겹친 것을 빼고 개수를 자른다.
const cleanItems = (items, maxCount) => {
    const seen = new Set();

    return (Array.isArray(items) ? items : [])
        .map((item) => ({ label: cleanText(typeof item === "string" ? item : item?.label, DRAFT_LIMITS.label), picked: typeof item === "string" ? true : item?.picked !== false }))
        .filter((item) => item.label && !seen.has(item.label) && seen.add(item.label))
        .slice(0, maxCount);
};

// 영문 소문자·숫자·하이픈 폴더 이름. 쓸 수 없으면 빈 문자열이다.
const toFolderName = (value) => {
    const name = String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, MAX_DRAFT_NAME_LENGTH)
        .replace(/-$/, "");

    return getProjectNameError(name) ? "" : name;
};

const getDraftPrompt = ({ what, platforms = [] }) => {
    const chosen = PLATFORMS.filter((platform) => platforms.includes(platform.key)).map((platform) => platform.label);

    return [
        "사용자가 새 소프트웨어 프로젝트를 만들려고 한다. 아래 설명으로 프로젝트 초안을 잡아라.",
        "도구는 쓰지 말고, 설명 없이 JSON 객체 하나만 답하라. 글은 한국어로 쓰고 label은 짧은 명사구로 쓴다.",
        "형식:",
        '{"name": "영문 소문자·숫자·하이픈 폴더 이름(40자 이하)", "summary": "무엇을 누가 어떻게 쓰는지 한 문장", "users": [{"label": "사용자", "picked": true}], "platforms": ["web"], "features": [{"label": "기능", "picked": true}], "exclusions": [{"label": "이번에 하지 않을 것", "picked": true}], "stack": {"items": ["기술"], "reason": "고른 이유 한 문장"}}',
        `platforms는 ${PLATFORM_KEYS.join(", ")} 중에서 고른다.`,
        "users는 2~3개, features는 꼭 필요한 것 3~5개(picked: true)와 있으면 좋은 추천 2~3개(picked: false), exclusions는 첫 버전에서 빼는 게 맞는 것 2~3개(picked: true)와 고민해 볼 것 1~2개(picked: false)를 쓴다.",
        "label은 24자 안쪽으로 짧게 쓴다. stack은 이 규모에 맞는 가장 단순한 조합 2~4개다.",
        chosen.length ? `사용자가 고른 실행 환경: ${chosen.join(", ")}` : "",
        "<설명>",
        cleanText(what, MAX_WHAT_LENGTH),
        "</설명>"
    ]
        .filter(Boolean)
        .join("\n");
};

const MAX_EXAMPLES = 5;
const EXAMPLE_LIMITS = { label: 14, what: 120, exclude: 24 };

// 새 프로젝트 화면의 "추천 예시 받기". 기본 예시는 그대로 두고 추천만 이 질문으로 새로 받는다. exclude는 이미 보인 예시의 이름이라 겹치지 않게 한다.
const getExamplesPrompt = ({ exclude = [] } = {}) => {
    const shown = (Array.isArray(exclude) ? exclude : [])
        .map((label) => cleanText(label, EXAMPLE_LIMITS.label))
        .filter(Boolean)
        .slice(0, EXAMPLE_LIMITS.exclude);

    return [
        "새 소프트웨어 프로젝트를 막 시작하려는 사람에게 보여 줄 아이디어 예시를 만들어라.",
        "도구는 쓰지 말고, 설명 없이 JSON 배열 하나만 답하라. 글은 한국어로 쓴다.",
        "형식:",
        '[{"label": "짧은 이름", "what": "무엇을 누가 어떻게 쓰는지 한두 문장", "platforms": ["web"]}]',
        `예시는 ${MAX_EXAMPLES}개다. 서로 다른 분야와 실행 환경으로 섞고, 한두 사람이 몇 주 안에 만들 수 있는 작은 규모로 쓴다.`,
        `label은 ${EXAMPLE_LIMITS.label}자 안쪽 명사구, what은 ${EXAMPLE_LIMITS.what}자 안쪽 해요체 문장이다.`,
        `platforms는 ${PLATFORM_KEYS.filter((key) => key !== "unknown").join(", ")} 중에서 1~2개를 고른다.`,
        shown.length ? `이미 보여 준 예시와 겹치지 않게 하라: ${shown.join(", ")}` : ""
    ]
        .filter(Boolean)
        .join("\n");
};

// 답에서 JSON 배열을 찾아 예시마다 다듬는다. 읽을 수 없으면 빈 배열이다.
const parseExamples = (text) => {
    const source = String(text || "");
    const start = source.indexOf("[");
    const end = source.lastIndexOf("]");
    let raw = null;

    try {
        raw = start >= 0 && end > start ? JSON.parse(source.slice(start, end + 1)) : null;
    } catch {
        raw = null;
    }

    const seen = new Set();

    return (Array.isArray(raw) ? raw : [])
        .map((item) => ({
            label: cleanText(item?.label, EXAMPLE_LIMITS.label),
            what: cleanText(item?.what, EXAMPLE_LIMITS.what),
            platforms: (Array.isArray(item?.platforms) ? item.platforms : []).filter((key, index, list) => PLATFORM_KEYS.includes(key) && list.indexOf(key) === index).slice(0, 2)
        }))
        .filter((item) => item.label && item.what && !seen.has(item.label) && seen.add(item.label))
        .slice(0, MAX_EXAMPLES);
};

// 답에서 JSON 객체를 찾아 읽고 칸마다 다듬는다. 읽을 수 없으면 null이다.
const parseDraft = (text) => {
    const source = String(text || "");
    const start = source.indexOf("{");
    const end = source.lastIndexOf("}");

    if (start < 0 || end <= start) {
        return null;
    }

    let raw = null;

    try {
        raw = JSON.parse(source.slice(start, end + 1));
    } catch {
        return null;
    }

    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return null;
    }

    const summary = cleanText(raw.summary, DRAFT_LIMITS.summary);
    const stackItems = cleanItems(raw.stack?.items, DRAFT_LIMITS.stack).map((item) => item.label);

    if (!summary) {
        return null;
    }

    return {
        name: toFolderName(raw.name),
        summary: summary,
        users: cleanItems(raw.users, DRAFT_LIMITS.users),
        platforms: (Array.isArray(raw.platforms) ? raw.platforms : []).filter((key, index, list) => PLATFORM_KEYS.includes(key) && list.indexOf(key) === index),
        features: cleanItems(raw.features, DRAFT_LIMITS.features),
        exclusions: cleanItems(raw.exclusions, DRAFT_LIMITS.exclusions),
        stack: { items: stackItems, reason: cleanText(raw.stack?.reason, DRAFT_LIMITS.reason) }
    };
};

const getPickedLabels = (items) => {
    return (items ?? []).filter((item) => item.picked).map((item) => item.label);
};

const getStackLines = (stack) => {
    if (stack.choice === "custom") {
        return stack.custom.length ? stack.custom.map((item) => `- ${item}`) : ["기획 단계에서 정해요."];
    }

    if (stack.choice === "recommended" && stack.items.length) {
        return [...stack.items.map((item) => `- ${item}`), ...(stack.reason ? ["", `추천 이유: ${stack.reason}`] : [])];
    }

    return ["기획 단계에서 정해요."];
};

const getListSection = (title, labels) => {
    return labels.length ? [`## ${title}`, "", ...labels.map((label) => `- ${label}`), ""] : [];
};

// docs/autopilot/brief.md 본문. 기획 단계가 이 파일을 먼저 읽는다. 고르지 않은 추천은 넣지 않는다(빼기로 한 것을 기획이 다시 넣지 않게).
const buildProjectBrief = (draft) => {
    const platformLabels = PLATFORMS.filter((platform) => draft.platforms.includes(platform.key)).map((platform) => platform.label);
    const what = cleanText(draft.what, MAX_WHAT_LENGTH);
    const summary = cleanText(draft.summary, DRAFT_LIMITS.summary) || what;

    return [
        `# ${draft.name || "새 프로젝트"}`,
        "",
        summary,
        "",
        ...getListSection("누가 쓰나요", getPickedLabels(draft.users)),
        ...getListSection("어디서 쓰나요", platformLabels),
        ...getListSection("꼭 있어야 할 기능", getPickedLabels(draft.features)),
        ...getListSection("이번에 하지 않을 것", getPickedLabels(draft.exclusions)),
        "## 기술 스택",
        "",
        ...getStackLines(draft.stack),
        "",
        ...getListSection("참고할 것", getPickedLabels(draft.refs)),
        ...(what && what !== summary ? ["## 처음 적은 내용", "", what, ""] : [])
    ].join("\n");
};

// 메인이 쓰기 전에 다듬는다. 제어 문자를 지우고 크기를 묶는다.
const sanitizeBrief = (text) => {
    const clean = String(text || "")
        .replace(/\r\n?/g, "\n")
        .replace(CONTROL_PATTERN, "");

    return `${clean.slice(0, MAX_BRIEF_LENGTH).trimEnd()}\n`;
};

module.exports = {
    PLATFORMS,
    PLATFORM_KEYS,
    DRAFT_LIMITS,
    MAX_PROJECT_NAME_LENGTH,
    MAX_WHAT_LENGTH,
    MAX_BRIEF_LENGTH,
    getProjectNameError,
    toFolderName,
    getDraftPrompt,
    parseDraft,
    getExamplesPrompt,
    parseExamples,
    buildProjectBrief,
    sanitizeBrief
};

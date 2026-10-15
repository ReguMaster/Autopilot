// 화면 표시용 순수 함수. DOM·window에 의존하지 않는다(tests/checkDesktopView.js가 단독으로 불러 검증한다).
const MODEL_LABELS = { fable: "Fable", opus: "Opus", sonnet: "Sonnet", haiku: "Haiku" };

const padNumber = (number) => {
    return String(number).padStart(2, "0");
};

const formatDuration = (ms) => {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));

    return `${padNumber(Math.floor(totalSeconds / 3600))}:${padNumber(Math.floor((totalSeconds % 3600) / 60))}:${padNumber(totalSeconds % 60)}`;
};

// 파일 크기를 1024 단위로 읽기 쉽게(1.5 KB, 12 MB).
const formatBytes = (bytes) => {
    const units = ["B", "KB", "MB", "GB"];
    let value = Math.max(0, Number(bytes) || 0);
    let index = 0;

    while (value >= 1024 && index < units.length - 1) {
        value /= 1024;
        index++;
    }

    return `${index === 0 || value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
};

const formatClock = (ms) => {
    const date = new Date(ms);

    return `${padNumber(date.getHours())}:${padNumber(date.getMinutes())}`;
};

const formatDeadline = (ms) => {
    const date = new Date(ms);

    return `${date.getMonth() + 1}월 ${date.getDate()}일 ${formatClock(ms)}`;
};

// 종료 시각(HH:mm, 비우면 엔진 기본값). 엔진처럼 날짜는 없고 이미 지난 시각이면 다음 날로 본다.
const DEFAULT_END_TIME = "07:00";
const MINUTES_PER_DAY = 1440;
const PRESET_ROUND_MINUTES = 5;

const parseTimeMinutes = (value) => {
    const [hours, minutes] = (value || DEFAULT_END_TIME).split(":").map(Number);

    return hours * 60 + minutes;
};

const formatTimeMinutes = (totalMinutes) => {
    const minutes = ((totalMinutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;

    return `${padNumber(Math.floor(minutes / 60))}:${padNumber(minutes % 60)}`;
};

const shiftEndTime = (value, minutes) => {
    return formatTimeMinutes(parseTimeMinutes(value) + minutes);
};

// 지금부터 minutes 뒤를 5분 단위로 올려 잡는다.
const getEndTimeAfter = (nowMs, minutes) => {
    const date = new Date(nowMs);
    const target = date.getHours() * 60 + date.getMinutes() + (date.getSeconds() > 0 ? 1 : 0) + minutes;

    return formatTimeMinutes(Math.ceil(target / PRESET_ROUND_MINUTES) * PRESET_ROUND_MINUTES);
};

const formatTimeUntil = (value, nowMs) => {
    const date = new Date(nowMs);
    const nowMinutes = date.getHours() * 60 + date.getMinutes();
    const diff = (((parseTimeMinutes(value) - nowMinutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY || MINUTES_PER_DAY;
    const hours = Math.floor(diff / 60);
    const minutes = diff % 60;

    if (!hours) {
        return `${minutes}분 뒤`;
    }

    return minutes ? `${hours}시간 ${minutes}분 뒤` : `${hours}시간 뒤`;
};

const EFFORT_LABELS = { low: "Low", medium: "Medium", high: "High", xhigh: "XHigh", max: "Max" };

const formatEffort = (effort) => {
    return EFFORT_LABELS[effort] || effort;
};

// 별칭(opus)이나 모델 ID(claude-opus-4-8)가 속한 계열. 모르면 빈 문자열이다.
const getModelFamily = (model) => {
    return Object.keys(MODEL_LABELS).find((family) => model === family || model.split("-").includes(family)) || "";
};

// 별칭은 계열 이름, 모델 ID는 날짜를 뺀 "Opus 4.8"처럼 보여준다. claude-3-5-sonnet처럼 버전이 앞에 와도 같은 모양이다.
const formatModelName = (model) => {
    if (MODEL_LABELS[model] || !model.startsWith("claude-")) {
        return MODEL_LABELS[model] || model;
    }

    const parts = model
        .slice("claude-".length)
        .replace(/-\d{8}$/, "")
        .split("-");
    const name = parts
        .filter((part) => !/^\d+$/.test(part))
        .map((part) => part[0].toUpperCase() + part.slice(1))
        .join(" ");
    const version = parts.filter((part) => /^\d+$/.test(part)).join(".");

    return [name, version].filter(Boolean).join(" ");
};

const formatOptions = (model, effort) => {
    return model ? `${formatModelName(model)} · ${formatEffort(effort)}` : "-";
};

const formatRemaining = (ms) => {
    const totalMinutes = Math.max(0, Math.round(ms / 60000));
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;

    if (days > 0) {
        return `${days}일 ${hours}시간`;
    }

    return hours > 0 ? `${hours}시간 ${minutes}분` : `${minutes}분`;
};

// 같은 날이면 시각만, 다른 날이면 날짜까지 보여준다.
const formatUsageReset = (resetsAt, now) => {
    if (!resetsAt) {
        return "리셋 시각을 알 수 없어요";
    }

    const isSameDay = new Date(resetsAt).toDateString() === new Date(now).toDateString();

    return `${isSameDay ? formatClock(resetsAt) : formatDeadline(resetsAt)} 리셋 · ${formatRemaining(resetsAt - now)} 후`;
};

const LOGIN_EXPIRY_WARN_MS = 3 * 24 * 60 * 60 * 1000;

// 저장된 로그인의 만료 안내. 만료 3일 전(Claude Code가 경고를 내는 시점)부터 isExpiring이고 banner에 안내 문장이 있다. 만료 시각을 모르면 null이다.
const describeLoginExpiry = (loginExpiresAt, now) => {
    if (!loginExpiresAt) {
        return null;
    }

    const remaining = loginExpiresAt - now;

    if (remaining <= 0) {
        return { text: "로그인이 만료됐어요", banner: "Claude 로그인이 만료됐어요. 다시 로그인해 주세요.", isExpiring: true };
    }

    const isExpiring = remaining <= LOGIN_EXPIRY_WARN_MS;

    return {
        text: `로그인 만료 ${formatDeadline(loginExpiresAt)} · ${formatRemaining(remaining)} 후`,
        banner: isExpiring ? `Claude 로그인이 ${formatRemaining(remaining)} 뒤 만료돼요. 미리 다시 로그인하면 실행이 중간에 멈추지 않아요.` : "",
        isExpiring: isExpiring
    };
};

const getUsageTone = (percent) => {
    if (percent >= 90) {
        return "danger";
    }

    return percent >= 70 ? "warn" : "ok";
};

const getLineKind = ({ stream, text }) => {
    if (stream === "err" || text.startsWith("[stderr]")) {
        return "err";
    }

    if (stream === "app") {
        return "app";
    }

    if (/^\[\d+회차\]|^AutoPilot 종료/.test(text)) {
        return "round";
    }

    if (text.includes("[사용량 한도]")) {
        return "warn";
    }

    if (text.includes("[결과]")) {
        return "ok";
    }

    if (/^\d{2}:\d{2}:\d{2} {3}> /.test(text)) {
        return "tool";
    }

    return "";
};

// 앱이 시작하지 않고 연결한 엔진은 종료 코드를 알 수 없어(exitCode가 null) 종료 사유로만 판단한다.
const getRunPhase = (state) => {
    if (state.status === "running") {
        return { label: state.attached ? "실행 중 · 연결됨" : "실행 중", tone: "run" };
    }

    if (state.status === "stopping") {
        return { label: "종료 요청됨", tone: "warn" };
    }

    if (!state.endedAt) {
        return { label: "대기 중", tone: "muted" };
    }

    if (state.exitCode === 0) {
        return { label: "정상 종료", tone: "ok" };
    }

    if (state.reason === "중단 요청" || state.reason === "강제 종료" || state.exitCode === 130) {
        return { label: "중단됨", tone: "warn" };
    }

    if (state.exitCode === null) {
        return { label: "종료됨", tone: "muted" };
    }

    return { label: "오류 종료", tone: "danger" };
};

// 연결하면서 이미 쓰인 로그를 읽은 회차는 시각을 알 수 없다.
const formatRoundTime = (round) => {
    if (!round.timesKnown) {
        return "시각을 알 수 없어요";
    }

    const startedText = `${formatClock(round.startedAt)} 시작`;

    return round.endedAt ? `${startedText}, ${((round.endedAt - round.startedAt) / 60000).toFixed(1)}분` : startedText;
};

const getRoundTone = (outcome) => {
    if (!outcome) {
        return "run";
    }

    if (outcome === "완료") {
        return "ok";
    }

    if (outcome.startsWith("실패") || outcome === "시한 초과") {
        return "danger";
    }

    if (outcome === "commit 없음") {
        return "muted";
    }

    return "warn";
};

/* 화면 상태: 시작 전(ready), 실행 중(run), 실행을 마친 뒤(done) */

// 실행을 마친 뒤 다른 프로젝트를 고르면 지난 실행 대신 시작 화면을 보여준다(isFinishDismissed).
const getView = (state, isFinishDismissed) => {
    if (state.status !== "idle") {
        return "run";
    }

    return state.endedAt && !isFinishDismissed ? "done" : "ready";
};

const isNightHour = (hour) => {
    return hour >= 18 || hour < 5;
};

const getGreetingEmoji = (hour) => {
    if (isNightHour(hour)) {
        return "🌙";
    }

    return hour < 12 ? "☀️" : "☕";
};

const getGreeting = ({ hour, policy, endTime, projectName }) => {
    if (!projectName) {
        return { title: "먼저 작업할 프로젝트를 골라 주세요. 📂", lead: "Git 저장소의 루트 폴더를 고르면 바로 시작할 수 있어요." };
    }

    const end = endTime || DEFAULT_END_TIME;
    const when = isNightHour(hour) ? "오늘 밤에는" : "지금부터";
    const title = `${when} ${projectName}에 무엇을 해 둘까요? ${getGreetingEmoji(hour)}`;

    if (policy === "todo") {
        return { title: title, lead: `적어 주신 일만 하나씩 해 두고 끝낼게요. 늦어도 ${end}에는 멈춰요.` };
    }

    return { title: title, lead: `적어 주신 일을 ${end}까지 하나씩 해 두고, 남는 시간에는 스스로 고칠 곳을 찾아볼게요.` };
};

const getWorkSummary = (state) => {
    const commits = state.rounds.flatMap((round) => round.commits || []);

    return {
        toolCalls: state.work.toolCalls,
        filesRead: state.work.filesRead,
        filesEdited: state.work.filesEdited,
        commits: commits.length,
        insertions: commits.reduce((sum, commit) => sum + commit.insertions, 0),
        deletions: commits.reduce((sum, commit) => sum + commit.deletions, 0)
    };
};

// 엔진 종료 사유를 사용자에게 들려주는 문장으로 바꾼다. 모르는 사유는 그대로 보여준다.
const FINISH_REASONS = [
    [/^예정 시각 도달$/, (state) => (state.deadlineAt ? `종료 시각 ${formatClock(state.deadlineAt)}에 맞춰 멈췄어요.` : "정해 둔 종료 시각에 맞춰 멈췄어요.")],
    [/예약 작업 완료/, () => "적어 주신 일을 모두 마쳤어요."],
    [/연속 새 commit 없음/, () => "더 고칠 만한 곳을 찾지 못해서 멈췄어요."],
    [/^중단 요청$/, () => "말씀하신 대로 이번 회차를 마치고 멈췄어요."],
    [/^강제 종료$/, () => "커밋하지 않은 변경은 작업 폴더에 남아 있을 수 있어요."],
    [/연속 \d+회 실패/, () => "연속으로 실패해서 멈췄어요. 전체 기록에서 이유를 확인해 주세요."],
    [/사용량 한도/, () => "사용량 한도 때문에 더 이어 가지 못했어요."],
    [/회차 상한/, () => "정해진 회차를 모두 채웠어요."]
];

const getReasonText = (reason, deadlineAt) => {
    return FINISH_REASONS.find(([pattern]) => pattern.test(reason))?.[1]({ deadlineAt: deadlineAt }) || (reason ? `종료 사유: ${reason}` : "");
};

const getWorkSentence = (roundCount, commitCount) => {
    if (!roundCount) {
        return "회차를 시작하기 전에 멈췄어요.";
    }

    return commitCount ? `${roundCount}회차 동안 쉬지 않고 일해서 커밋 ${commitCount}개를 남겼어요.` : `${roundCount}회차 동안 일했지만 커밋으로 남길 만한 변경은 없었어요.`;
};

const describeFinish = (state) => {
    const tone = getRunPhase(state).tone;
    const hour = new Date(state.endedAt).getHours();
    const reasonText = getReasonText(state.reason, state.deadlineAt);
    const work = getWorkSentence(state.rounds.length, getWorkSummary(state).commits);
    let title = "일을 마쳤어요.";

    if (tone === "danger") {
        title = "도중에 멈췄어요.";
    } else if (tone === "warn") {
        title = "여기까지 하고 멈췄어요.";
    } else if (hour >= 5 && hour < 12) {
        title = "좋은 아침이에요.";
    }

    return { title: title, lead: reasonText ? `${work} ${reasonText}` : work };
};

// 회차 사이에 기다리는 동안에는 마지막 문장 대신 기다리는 이유를 들려준다.
const getWaitSentence = (state) => {
    if (state.status === "stopping") {
        return "종료 신호를 받았어요. 이번 회차를 마치는 대로 멈출게요.";
    }

    if (state.phase === "시작 중") {
        return "준비하고 있어요. 곧 첫 회차를 시작할게요.";
    }

    const retry = state.phase.match(/^(\d+)분 후 재시도 대기$/);

    if (retry) {
        return `잠깐 문제가 생겼어요. ${retry[1]}분 뒤에 다시 해 볼게요.`;
    }

    const limit = state.phase.match(/^사용량 한도 대기 \((\d{2}:\d{2})/);

    return limit ? `사용량 한도에 닿아서 잠깐 쉬고 있어요. ${limit[1]}에 다시 이어서 할게요.` : "";
};

/* 회차 진행선: 실행 시작부터 종료 예정 시각까지를 100으로 놓고 회차 구간·커밋·지금 위치를 퍼센트로 정한다 */

const getTrack = (state, nowMs) => {
    if (!state.startedAt || !state.deadlineAt) {
        return null;
    }

    const isRunning = state.status !== "idle";
    const lastMs = isRunning ? nowMs : state.endedAt;
    const span = Math.max(1, Math.max(state.deadlineAt, lastMs) - state.startedAt);
    const toPercent = (ms) => Math.min(100, Math.max(0, ((ms - state.startedAt) / span) * 100));
    // 연결하면서 이미 쓰인 로그로 읽은 회차는 시각을 몰라 그리지 않는다.
    const rounds = state.rounds.filter((round) => round.timesKnown);
    const segments = rounds.map((round) => ({ from: toPercent(round.startedAt), to: toPercent(round.endedAt || lastMs), isLive: isRunning && !round.endedAt }));
    return {
        segments: segments,
        commits: rounds.filter((round) => round.endedAt && round.commits?.length).map((round) => ({ at: toPercent(round.endedAt), count: round.commits.length })),
        head: isRunning ? toPercent(nowMs) : null,
        startText: formatClock(state.startedAt),
        endText: formatClock(state.deadlineAt)
    };
};

/* 이야기: 엔진 로그의 Claude 문장과 도구 호출을 읽어, 도구 호출 뒤에 이어지는 문장 단위(beat)로 묶는다 */

const STORY_LIMIT = 10;
const STORY_TOOL_LIMIT = 4;
const STORY_DETAIL_LENGTH = 32;
const STORY_TOOL_PATTERN = /^(\d{2}:\d{2}:\d{2}) {3}> (\S+) ?(.*)$/;
// 시각 뒤가 [로 시작하면 엔진의 알림 줄([세션]·[결과]·[사용량 한도])이다.
const STORY_SAY_PATTERN = /^(\d{2}:\d{2}:\d{2}) (?!\[)(.+)$/;
const STORY_MORE_PATTERN = /^ {4}(.*)$/;
const STORY_GAIN_PATTERN = /^성과:\s*(.+)$/;
const STORY_RUN_START_PATTERN = /^\[앱\] (엔진을 시작했어요|이미 실행 중인 엔진)/;
const PATH_TOOLS = ["Read", "Edit", "MultiEdit", "Write", "NotebookEdit"];

const shortenText = (text, length) => {
    return text.length > length ? `${text.slice(0, length - 1)}…` : text;
};

// 마크다운 강조와 목록 기호는 화면 문장에서 뺀다.
const cleanStoryText = (text) => {
    return text
        .replace(/\*\*|__|`/g, "")
        .replace(/^\s*(?:#+|[-*]|\d+\.)\s+/, "")
        .trim();
};

const parseStoryLine = (text) => {
    const tool = text.match(STORY_TOOL_PATTERN);

    if (tool) {
        return { type: "tool", time: tool[1], name: tool[2], argument: tool[3] };
    }

    const head = text.match(STORY_SAY_PATTERN);
    const more = head ? null : text.match(STORY_MORE_PATTERN);
    const body = head ? head[2] : more?.[1];

    if (body === undefined) {
        return null;
    }

    const gain = body.match(STORY_GAIN_PATTERN);

    if (gain) {
        return { type: "gain", time: head ? head[1] : "", text: gain[1].trim() };
    }

    return head ? { type: "say", time: head[1], text: cleanStoryText(body) } : { type: "more", text: cleanStoryText(body) };
};

const getFileName = (argument) => {
    return argument.split(/[\\/]/).filter(Boolean).pop() || "";
};

const getToolDetail = (name, argument) => {
    return PATH_TOOLS.includes(name) ? getFileName(argument) : shortenText(argument, STORY_DETAIL_LENGTH);
};

// git commit 메시지에 test가 들어갈 수 있어 commit을 먼저 본다.
const BASH_PHRASES = [
    [/\bgit commit\b/, "지금까지 한 일을 커밋으로 남기고 있어요."],
    [/\b(test|tests|jest|vitest|mocha|pytest)\b/, "테스트를 돌려 보고 결과를 기다리고 있어요."],
    [/\bgit (status|diff|log|show)\b/, "바뀐 내용을 git으로 다시 살펴보고 있어요."],
    [/\b(build|lint|tsc|typecheck)\b/, "빌드와 검사를 돌려 보고 있어요."],
    [/\b(npm|pnpm|yarn) (install|ci|add)\b/, "필요한 패키지를 준비하고 있어요."]
];

// Claude가 문장을 남기기 전에 도구만 부르는 동안 보여줄 문장. 파일 이름 뒤에는 받침에 따라 바뀌는 조사를 붙이지 않는다.
const describeTool = (name, argument) => {
    const file = getFileName(argument);
    const target = file ? `${file} 파일을` : "파일을";

    if (name === "Read") {
        return `${target} 차근차근 읽어 보고 있어요.`;
    }

    if (name === "Edit" || name === "MultiEdit" || name === "NotebookEdit") {
        return `${target} 조심스럽게 고치고 있어요.`;
    }

    if (name === "Write") {
        return `${target} 새로 쓰고 있어요.`;
    }

    if (name === "Grep") {
        return argument ? `코드에서 ${shortenText(argument, 24)} 흔적을 찾아보고 있어요.` : "코드에서 흔적을 찾아보고 있어요.";
    }

    if (name === "Glob") {
        return "어떤 파일들이 있는지 둘러보고 있어요.";
    }

    if (name === "Bash") {
        return BASH_PHRASES.find(([pattern]) => pattern.test(argument))?.[1] || "터미널에서 명령을 실행하고 있어요.";
    }

    if (name === "WebFetch" || name === "WebSearch") {
        return "필요한 자료를 찾아 읽고 있어요.";
    }

    if (name === "TodoWrite") {
        return "할 일을 차례로 정리하고 있어요.";
    }

    if (name === "Task" || name === "Agent") {
        return "도우미에게 일을 나눠 맡기고 있어요.";
    }

    return `${name} 도구로 일하고 있어요.`;
};

const createStory = () => {
    return { items: [], lastType: "", nextId: 1 };
};

const pushStoryItem = (story, item) => {
    story.items.push({ ...item, id: story.nextId++ });
    story.items.splice(0, Math.max(0, story.items.length - STORY_LIMIT));
};

// 문장(say)은 앞서 부른 도구들을 칩으로 달고, 도구만 온 동안에는 앱이 지은 문장(isPhrase)을 보여주다가 Claude의 문장이 오면 바꾼다.
// 여러 줄 메시지의 둘째 줄부터(more)는 바로 앞 문장에 잇는다. 성과 줄은 상태(gains)가 따로 모으므로 이야기에 넣지 않는다.
const applyStoryEntry = (story, { stream, text }) => {
    if (stream === "app" && STORY_RUN_START_PATTERN.test(text)) {
        Object.assign(story, { items: [], lastType: "" });

        return;
    }

    if (stream !== "out") {
        return;
    }

    const line = parseStoryLine(text);
    const lastItem = story.items.at(-1);
    const isMessageLine = story.lastType === "say" || story.lastType === "more";

    if (!line) {
        story.lastType = "";

        return;
    }

    if (line.type === "tool") {
        const tool = { name: line.name, detail: getToolDetail(line.name, line.argument) };
        const phrase = describeTool(line.name, line.argument);

        if (lastItem?.isPhrase) {
            Object.assign(lastItem, { tools: [...lastItem.tools, tool].slice(-STORY_TOOL_LIMIT), text: phrase, time: line.time });
        } else {
            pushStoryItem(story, { tools: [tool], text: phrase, isPhrase: true, time: line.time });
        }
    } else if (line.type === "say" && line.text) {
        if (lastItem?.isPhrase) {
            // 새 문장이므로 화면에서 다시 드러나도록 id를 바꾼다.
            Object.assign(lastItem, { text: line.text, isPhrase: false, time: line.time, id: story.nextId++ });
        } else {
            pushStoryItem(story, { tools: [], text: line.text, isPhrase: false, time: line.time });
        }
    } else if (line.type === "more" && isMessageLine && lastItem && !lastItem.isPhrase && line.text) {
        lastItem.text = `${lastItem.text} ${line.text}`;
    }

    // 메시지 중간의 성과 줄 뒤에도 같은 메시지가 이어진다.
    story.lastType = line.type === "gain" && !line.time && isMessageLine ? "more" : line.type;
};

/* 성과 줄: "<무엇> <이전> → <이후>" 형식이면 숫자를 크게 보여주고, 아니면 문장 그대로 보여준다 */

const GAIN_CHANGE_PATTERN = /^(.*?)\s*(\S+)\s*(?:→|->)\s*(\S+)$/;
const FIGURE_PATTERN = /^([-+]?\d[\d,.]*)(.*)$/;

const parseGain = (text) => {
    const change = text.match(GAIN_CHANGE_PATTERN);

    return change ? { label: change[1], before: change[2], after: change[3] } : { label: text, before: "", after: "" };
};

const splitFigure = (value) => {
    const figure = value.match(FIGURE_PATTERN);

    return figure ? { number: figure[1], unit: figure[2] } : { number: value, unit: "" };
};

/* 지난 실행: 로그 파일에서 읽은 요약을 목록과 상세 문장으로 바꾼다. 로그가 깨졌거나 끝맺음이 없어도 같은 모양으로 보여준다 */

const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];
const DAY_MS = 24 * 60 * 60 * 1000;
const PAST_STATUSES = [
    [/^예정 시각 도달$|예약 작업 완료|연속 새 commit 없음|회차 상한/, "정상 종료", "ok"],
    [/^중단 요청$|^강제 종료$/, "중단됨", "warn"],
    [/사용량 한도/, "한도로 멈춤", "warn"],
    [/연속 \d+회 실패|^실행 오류/, "오류 종료", "danger"]
];

const getStartOfDay = (ms) => {
    const date = new Date(ms);

    date.setHours(0, 0, 0, 0);

    return date.getTime();
};

const formatPastDay = (ms, nowMs) => {
    if (!ms) {
        return "날짜를 알 수 없어요";
    }

    const days = Math.round((getStartOfDay(nowMs) - getStartOfDay(ms)) / DAY_MS);

    if (days === 0) {
        return "오늘";
    }

    if (days === 1) {
        return "어제";
    }

    const date = new Date(ms);

    return `${date.getMonth() + 1}월 ${date.getDate()}일 (${WEEKDAY_LABELS[date.getDay()]})`;
};

const getPastStatus = (run) => {
    if (run.isActive) {
        return { label: "진행 중", tone: "run" };
    }

    if (run.isUnreadable) {
        return { label: "읽을 수 없음", tone: "danger" };
    }

    if (run.isEmpty) {
        return { label: "내용 없음", tone: "muted" };
    }

    if (!run.reason) {
        return { label: "끝맺음 없음", tone: "muted" };
    }

    const matched = PAST_STATUSES.find(([pattern]) => pattern.test(run.reason));

    return matched ? { label: matched[1], tone: matched[2] } : { label: "종료", tone: "muted" };
};

const getPastNotes = (run) => {
    if (run.isUnreadable) {
        return ["기록 파일을 읽지 못했어요."];
    }

    const notes = [];

    if (run.isEmpty) {
        notes.push("기록에서 읽을 수 있는 내용이 없어요. 파일이 비었거나 깨졌을 수 있어요.");
    } else if (!run.reason && !run.isActive) {
        notes.push("끝맺음 줄이 없어요. 앱이나 PC가 꺼졌거나 강제로 종료됐을 수 있어요.");
    }

    if (run.isPartial) {
        notes.push("기록이 커서 마지막 부분만 읽었어요.");
    }

    return notes;
};

const formatPastMeta = (run) => {
    if (run.isUnreadable || run.isEmpty) {
        return "";
    }

    const parts = [`${run.roundCount}회차`, run.commitCount ? `커밋 ${run.commitCount}개 +${run.insertions} −${run.deletions}` : "커밋 없음"];

    return parts.join(" · ");
};

const describePastRun = (run, nowMs) => {
    const hasDuration = run.endedAt > run.startedAt && !run.isActive;
    const duration = hasDuration ? (run.endedAt - run.startedAt < 60000 ? "1분 미만" : formatRemaining(run.endedAt - run.startedAt)) : "";

    return {
        day: formatPastDay(run.startedAt, nowMs),
        time: run.startedAt ? formatClock(run.startedAt) : "",
        duration: duration,
        status: getPastStatus(run),
        meta: formatPastMeta(run),
        headline: run.headline || "",
        lead: run.isUnreadable || run.isEmpty ? "" : `${getWorkSentence(run.roundCount, run.commitCount)} ${getReasonText(run.reason, run.deadlineAt)}`.trim(),
        notes: getPastNotes(run)
    };
};

/* 지난 실행의 대화: 로그 줄을 Claude의 문장·회차·커밋·성과가 시간 순으로 이어지는 목록으로 바꾼다. 알아볼 수 없는 줄은 건너뛴다 */

const TRANSCRIPT_LIMIT = 1500;
const TRANSCRIPT_TEXT_LENGTH = 600;
const TRANSCRIPT_ROUND_PATTERN = /^\[(\d+)회차\] (.+)$/;
const TRANSCRIPT_ROUND_START_PATTERN = /^시작 - 남은 시간 \d+분(?: \(model (\S+), effort (\S+)\))?/;
const TRANSCRIPT_COMMIT_PATTERN = /^\[커밋\] (\S+) \+(\d+) -(\d+) ?(.*)$/;
const TRANSCRIPT_LIMIT_PATTERN = /^\[사용량 한도\] (.+)$/;
const TRANSCRIPT_FINISH_PATTERN = /^AutoPilot 종료 - (.+) \(\d+회차\)$/;

const buildTranscript = (lines) => {
    const items = [];
    let tools = [];
    let toolCount = 0;
    let lastType = "";
    let lastSay = null;

    const pushItem = (item) => {
        items.push(item);
    };

    // 문장 없이 도구만 부른 구간은 문장 앞 칩으로 붙지 못하므로 따로 한 줄로 남긴다.
    const flushTools = () => {
        if (toolCount) {
            pushItem({ kind: "work", tools: tools, count: toolCount });
        }

        tools = [];
        toolCount = 0;
    };

    for (const text of Array.isArray(lines) ? lines : []) {
        if (typeof text !== "string") {
            continue;
        }

        const round = text.match(TRANSCRIPT_ROUND_PATTERN);
        const commit = round ? null : text.match(TRANSCRIPT_COMMIT_PATTERN);
        const limit = round || commit ? null : text.match(TRANSCRIPT_LIMIT_PATTERN);
        const finish = round || commit || limit ? null : text.match(TRANSCRIPT_FINISH_PATTERN);

        if (round || commit || limit || finish) {
            flushTools();

            lastType = "";
            lastSay = null;
        }

        if (round) {
            const start = round[2].match(TRANSCRIPT_ROUND_START_PATTERN);

            pushItem(
                start
                    ? { kind: "round", round: Number(round[1]), options: start[1] ? formatOptions(start[1], start[2]) : "" }
                    : { kind: "result", round: Number(round[1]), outcome: round[2], tone: getRoundTone(round[2]) }
            );

            continue;
        }

        if (commit) {
            pushItem({ kind: "commit", hash: commit[1], insertions: Number(commit[2]), deletions: Number(commit[3]), subject: commit[4] });

            continue;
        }

        if (limit) {
            pushItem({ kind: "notice", text: shortenText(limit[1], TRANSCRIPT_TEXT_LENGTH) });

            continue;
        }

        if (finish) {
            pushItem({ kind: "finish", text: shortenText(finish[1], TRANSCRIPT_TEXT_LENGTH) });

            continue;
        }

        const line = parseStoryLine(text);
        const isMessageLine = lastType === "say" || lastType === "more";

        if (!line) {
            lastType = "";

            continue;
        }

        if (line.type === "tool") {
            tools = [...tools, { name: line.name, detail: getToolDetail(line.name, line.argument) }].slice(-STORY_TOOL_LIMIT);
            toolCount++;
        } else if (line.type === "say" && line.text) {
            lastSay = { kind: "say", time: line.time, text: shortenText(line.text, TRANSCRIPT_TEXT_LENGTH), tools: tools, count: toolCount };

            pushItem(lastSay);

            tools = [];
            toolCount = 0;
        } else if (line.type === "more" && isMessageLine && lastSay && line.text) {
            lastSay.text = shortenText(`${lastSay.text} ${line.text}`, TRANSCRIPT_TEXT_LENGTH);
        } else if (line.type === "gain" && line.text) {
            pushItem({ kind: "gain", text: shortenText(line.text, TRANSCRIPT_TEXT_LENGTH) });
        }

        // 메시지 중간의 성과 줄 뒤에도 같은 메시지가 이어진다.
        lastType = line.type === "gain" && !line.time && isMessageLine ? "more" : line.type;
    }

    flushTools();

    return { items: items.slice(-TRANSCRIPT_LIMIT), omitted: Math.max(0, items.length - TRANSCRIPT_LIMIT) };
};

/* 예약: 시작 조건 문장과 지금 상태 문장 */

const WEEKDAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const SCHEDULE_WINDOW_LABELS = { session: "5시간 한도", weekly: "주간 한도" };

const isSameDays = (days, expected) => {
    return days.length === expected.length && expected.every((day) => days.includes(day));
};

const describeDays = (days) => {
    if (days.length === 7) {
        return "매일";
    }

    if (isSameDays(days, [1, 2, 3, 4, 5])) {
        return "평일";
    }

    if (isSameDays(days, [0, 6])) {
        return "주말";
    }

    return WEEKDAY_ORDER.filter((day) => days.includes(day))
        .map((day) => WEEKDAY_NAMES[day])
        .join("·");
};

const formatScheduleDuration = (minutes) => {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;

    if (!hours) {
        return `${rest}분`;
    }

    return rest ? `${hours}시간 ${rest}분` : `${hours}시간`;
};

// 예약 하나를 두 줄로 설명한다. 제목은 언제 시작하는지, 설명은 어떻게 돌고 어떤 조건이 붙는지다.
const describeSchedule = (schedule) => {
    const days = describeDays(schedule.days);
    const duration = `${formatScheduleDuration(schedule.duration)} 실행`;
    const condition = schedule.minRemaining ? `남은 한도 ${schedule.minRemaining}% 이상일 때만` : "";

    if (schedule.kind === "time") {
        return { title: `${days} ${schedule.time}에 시작`, detail: [duration, condition].filter(Boolean).join(", ") };
    }

    const range = schedule.from ? `${days} ${schedule.from}~${schedule.to} 사이에 시작` : `${days} 언제든 시작`;

    return { title: `${SCHEDULE_WINDOW_LABELS[schedule.window]}가 리셋되면 시작`, detail: [range, duration, condition].filter(Boolean).join(", ") };
};

// 오늘·내일은 말로, 그 밖에는 날짜와 요일로 적는다.
const formatScheduleWhen = (ms, nowMs) => {
    const date = new Date(ms);
    const dayDiff = Math.round(
        (new Date(date.getFullYear(), date.getMonth(), date.getDate()) - new Date(new Date(nowMs).getFullYear(), new Date(nowMs).getMonth(), new Date(nowMs).getDate())) / 86400000
    );

    if (dayDiff === 0) {
        return `오늘 ${formatClock(ms)}`;
    }

    if (dayDiff === 1) {
        return `내일 ${formatClock(ms)}`;
    }

    return `${date.getMonth() + 1}월 ${date.getDate()}일 (${WEEKDAY_NAMES[date.getDay()]}) ${formatClock(ms)}`;
};

// 판단 결과(status)를 한 문장으로. 막힌 이유는 warn, 기다리는 중은 muted, 정상 흐름은 ok로 구분한다.
const describeScheduleStatus = (schedule, status, nowMs) => {
    const label = SCHEDULE_WINDOW_LABELS[schedule.window];

    if (!schedule.enabled || status?.code === "disabled") {
        return { text: "꺼져 있어요", tone: "muted" };
    }

    if (!status) {
        return { text: "확인하는 중이에요", tone: "muted" };
    }

    switch (status.code) {
        case "next-time":
            return { text: status.at ? `다음 시작은 ${formatScheduleWhen(status.at, nowMs)}이에요` : "시작할 요일이 없어요", tone: "ok" };
        case "waiting-reset":
            return { text: status.resetsAt ? `${label} 리셋을 기다려요. ${formatUsageReset(status.resetsAt, nowMs)}` : `${label} 리셋을 기다려요`, tone: "ok" };
        case "outside-window":
            return { text: status.opensAt ? `리셋됐어요. 허용 시간대가 열리는 ${formatScheduleWhen(status.opensAt, nowMs)}에 시작해요` : "리셋됐지만 시작할 수 있는 요일이 없어요", tone: "muted" };
        case "busy":
            return { text: "다른 실행이 끝나길 기다려요", tone: "muted" };
        case "low-limit":
            return { text: `남은 한도가 ${status.remaining}%라 기다려요. ${status.need}% 이상이어야 시작해요`, tone: "warn" };
        case "too-short":
            return { text: "허용 시간대가 곧 닫혀서 이번에는 건너뛰어요", tone: "muted" };
        case "no-usage":
            return { text: `사용량을 읽지 못해 한도 리셋을 알 수 없어요. ${status.message}`, tone: "warn" };
        case "loading":
            return { text: "사용량을 읽는 중이에요", tone: "muted" };
        case "starting":
        case "started":
            return { text: "방금 시작했어요", tone: "ok" };
        case "failed":
            return { text: "시작하지 못했어요", tone: "warn" };
        default:
            return { text: "", tone: "muted" };
    }
};

// 시작 화면의 예약 한 줄. 다음에 시작할 때와 한도 리셋을 기다리는 예약 수를 알린다.
const describeScheduleSummary = (schedules, statuses, nowMs) => {
    if (!schedules.length) {
        return "예약해 두면 정해진 때나 한도가 리셋될 때 자동으로 시작해요";
    }

    const active = schedules.filter((schedule) => schedule.enabled);

    if (!active.length) {
        return "예약이 모두 꺼져 있어요";
    }

    const nextTimes = active
        .map((schedule) => statuses.find((status) => status.id === schedule.id))
        .filter((status) => status?.code === "next-time" && status.at)
        .map((status) => status.at);
    const resetCount = active.filter((schedule) => schedule.kind === "reset").length;
    const parts = [];

    if (nextTimes.length) {
        parts.push(`다음 예약 ${formatScheduleWhen(Math.min(...nextTimes), nowMs)}`);
    }

    if (resetCount) {
        parts.push(`한도 리셋을 기다리는 예약 ${resetCount}개`);
    }

    return parts.join(", ") || `켜져 있는 예약 ${active.length}개`;
};

// 마지막으로 시작을 시도한 결과. 시도한 적이 없으면 빈 문장이다.
const describeScheduleLast = (last, nowMs) => {
    if (!last) {
        return { text: "", tone: "muted" };
    }

    const when = formatScheduleWhen(last.at, nowMs);

    return last.ok ? { text: `${when}에 시작했어요`, tone: "muted" } : { text: `${when}에 시작하지 못했어요. ${last.message}`, tone: "warn" };
};

export {
    MODEL_LABELS,
    padNumber,
    formatDuration,
    formatBytes,
    formatClock,
    formatDeadline,
    DEFAULT_END_TIME,
    MINUTES_PER_DAY,
    PRESET_ROUND_MINUTES,
    parseTimeMinutes,
    formatTimeMinutes,
    shiftEndTime,
    getEndTimeAfter,
    formatTimeUntil,
    EFFORT_LABELS,
    formatEffort,
    getModelFamily,
    formatModelName,
    formatOptions,
    formatRemaining,
    formatUsageReset,
    describeLoginExpiry,
    getUsageTone,
    getLineKind,
    getRunPhase,
    formatRoundTime,
    getRoundTone,
    getView,
    isNightHour,
    getGreetingEmoji,
    getGreeting,
    getWorkSummary,
    FINISH_REASONS,
    getReasonText,
    getWorkSentence,
    describeFinish,
    getWaitSentence,
    getTrack,
    STORY_LIMIT,
    STORY_TOOL_LIMIT,
    STORY_DETAIL_LENGTH,
    STORY_TOOL_PATTERN,
    STORY_SAY_PATTERN,
    STORY_MORE_PATTERN,
    STORY_GAIN_PATTERN,
    STORY_RUN_START_PATTERN,
    PATH_TOOLS,
    shortenText,
    cleanStoryText,
    parseStoryLine,
    getFileName,
    getToolDetail,
    BASH_PHRASES,
    describeTool,
    createStory,
    pushStoryItem,
    applyStoryEntry,
    GAIN_CHANGE_PATTERN,
    FIGURE_PATTERN,
    parseGain,
    splitFigure,
    WEEKDAY_LABELS,
    DAY_MS,
    PAST_STATUSES,
    getStartOfDay,
    formatPastDay,
    getPastStatus,
    getPastNotes,
    formatPastMeta,
    describePastRun,
    TRANSCRIPT_LIMIT,
    TRANSCRIPT_TEXT_LENGTH,
    TRANSCRIPT_ROUND_PATTERN,
    TRANSCRIPT_ROUND_START_PATTERN,
    TRANSCRIPT_COMMIT_PATTERN,
    TRANSCRIPT_LIMIT_PATTERN,
    TRANSCRIPT_FINISH_PATTERN,
    buildTranscript,
    WEEKDAY_NAMES,
    WEEKDAY_ORDER,
    SCHEDULE_WINDOW_LABELS,
    isSameDays,
    describeDays,
    formatScheduleDuration,
    describeSchedule,
    formatScheduleWhen,
    describeScheduleStatus,
    describeScheduleSummary,
    describeScheduleLast
};

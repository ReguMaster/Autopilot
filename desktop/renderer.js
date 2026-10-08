const MAX_LOG_LINES = 3000;
const CLOCK_INTERVAL_MS = 1000;
const FOLLOW_THRESHOLD_PX = 24;
const LOG_FLUSH_MS = 50;
const EMPTY_CLOCK = "--:--:--";

const STATUS_OK = "OK";

const MODEL_LABELS = { fable: "Fable", opus: "Opus", sonnet: "Sonnet", haiku: "Haiku" };

const OPTIONS_HINTS = {
    idle: "실행 중에 바꾸면 다음 회차부터 적용돼요.",
    running: "바꾸면 바로 전달돼요. 진행 중인 회차는 그대로 끝나요.",
    stopping: "종료 요청 후에는 바꿀 수 없어요."
};

const byId = (id) => document.getElementById(id);

const elements = {
    version: byId("version"),
    navItems: document.querySelectorAll(".nav-item"),
    views: document.querySelectorAll(".view"),
    badge: byId("status-badge"),
    statPhase: byId("stat-phase"),
    notice: byId("notice"),
    engineBanner: byId("engine-banner"),
    openSettings: byId("open-settings"),
    engineNotice: byId("engine-notice"),
    enginePath: byId("engine-path"),
    findExe: byId("find-exe"),
    selectExe: byId("select-exe"),
    form: byId("run-form"),
    endTime: byId("end-time"),
    policy: byId("policy"),
    model: byId("model"),
    effort: byId("effort"),
    start: byId("start"),
    stop: byId("stop"),
    kill: byId("kill"),
    appliedNow: byId("applied-now"),
    appliedNextLabel: byId("applied-next-label"),
    appliedNext: byId("applied-next"),
    appliedTag: byId("applied-tag"),
    optionsHint: byId("options-hint"),
    statRound: byId("stat-round"),
    statRoundSub: byId("stat-round-sub"),
    statRemaining: byId("stat-remaining"),
    statProgress: byId("stat-progress"),
    statDeadline: byId("stat-deadline"),
    statElapsed: byId("stat-elapsed"),
    statPolicy: byId("stat-policy"),
    log: byId("log"),
    logEmpty: byId("log-empty"),
    logCount: byId("log-count"),
    follow: byId("follow"),
    clearLog: byId("clear-log"),
    openReport: byId("open-report"),
    rounds: byId("rounds"),
    roundCount: byId("round-count")
};

let settings = { exePath: "" };
let currentState = null;
let pendingEntries = [];
let isFlushScheduled = false;
let renderedRoundsKey = "";
let lineNumber = 0;
let isApplying = false;
let isApplyQueued = false;

const padNumber = (number) => {
    return String(number).padStart(2, "0");
};

const formatDuration = (ms) => {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));

    return `${padNumber(Math.floor(totalSeconds / 3600))}:${padNumber(Math.floor((totalSeconds % 3600) / 60))}:${padNumber(totalSeconds % 60)}`;
};

const formatClock = (ms) => {
    const date = new Date(ms);

    return `${padNumber(date.getHours())}:${padNumber(date.getMinutes())}`;
};

const formatDeadline = (ms) => {
    const date = new Date(ms);

    return `${date.getMonth() + 1}월 ${date.getDate()}일 ${formatClock(ms)}`;
};

const formatOptions = (model, effort) => {
    return model ? `${MODEL_LABELS[model] || model} · ${effort}` : "-";
};

/* 화면 전환 */

const showView = (name) => {
    for (const view of elements.views) {
        view.hidden = view.id !== `view-${name}`;
    }

    for (const item of elements.navItems) {
        if (item.dataset.view === name) {
            item.setAttribute("aria-current", "page");
        } else {
            item.removeAttribute("aria-current");
        }
    }
};

/* 로그 */

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

const createLogLine = (entry) => {
    const line = document.createElement("div");
    const number = document.createElement("span");
    const text = document.createElement("span");

    lineNumber++;

    line.className = "line";
    line.dataset.kind = getLineKind(entry);
    number.className = "ln";
    number.textContent = lineNumber;
    text.className = "tx";
    text.textContent = entry.text;

    line.append(number, text);

    return line;
};

// 안내 줄(첫 자식)을 제외한 줄 수
const getLineCount = () => {
    return elements.log.childElementCount - 1;
};

const updateLogCount = () => {
    elements.logCount.textContent = `${getLineCount()}줄`;
};

// 로그는 모아서 한 번에 DOM에 반영한다. 창이 최소화돼도 멈추지 않도록 rAF 대신 타이머를 쓴다. 사용자가 위로 스크롤한 상태면 따라가지 않는다.
const flushLogEntries = () => {
    isFlushScheduled = false;

    const fragment = document.createDocumentFragment();
    const entries = pendingEntries.slice(-MAX_LOG_LINES);

    lineNumber += pendingEntries.length - entries.length;

    for (const entry of entries) {
        fragment.append(createLogLine(entry));
    }

    pendingEntries = [];

    elements.logEmpty.hidden = true;
    elements.log.append(fragment);

    while (getLineCount() > MAX_LOG_LINES) {
        elements.log.children[1].remove();
    }

    updateLogCount();

    if (elements.follow.checked) {
        elements.log.scrollTop = elements.log.scrollHeight;
    }
};

const appendLogEntries = (entries) => {
    if (!entries.length) {
        return;
    }

    pendingEntries.push(...entries);

    if (!isFlushScheduled) {
        isFlushScheduled = true;

        setTimeout(flushLogEntries, LOG_FLUSH_MS);
    }
};

const clearLog = () => {
    pendingEntries = [];
    lineNumber = 0;

    for (const line of elements.log.querySelectorAll(".line:not(.empty)")) {
        line.remove();
    }

    elements.logEmpty.hidden = false;

    updateLogCount();
};

const handleFollowByScroll = () => {
    const { scrollHeight, scrollTop, clientHeight } = elements.log;

    elements.follow.checked = scrollHeight - scrollTop - clientHeight < FOLLOW_THRESHOLD_PX;
};

/* 상태 표시 */

const getRunPhase = (state) => {
    if (state.status === "running") {
        return { label: "실행 중", tone: "run" };
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

    return { label: "오류 종료", tone: "danger" };
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

const createRoundItem = (round) => {
    const item = document.createElement("li");
    const number = document.createElement("span");
    const body = document.createElement("div");
    const title = document.createElement("strong");
    const time = document.createElement("small");
    const options = document.createElement("small");
    const tag = document.createElement("span");
    const minutes = round.endedAt ? ((round.endedAt - round.startedAt) / 60000).toFixed(1) : "";

    item.className = "round";
    number.className = "round-no num";
    number.textContent = round.round;
    body.className = "round-body";
    title.textContent = `${round.round}회차`;
    time.className = "num";
    time.textContent = round.endedAt ? `${formatClock(round.startedAt)} 시작, ${minutes}분` : `${formatClock(round.startedAt)} 시작`;
    options.textContent = formatOptions(round.model, round.effort);
    tag.className = "tag";
    tag.dataset.tone = getRoundTone(round.outcome);
    tag.textContent = round.outcome || "진행 중";

    body.append(title, time, options);
    item.append(number, body, tag);

    return item;
};

const renderRounds = (state) => {
    const key = JSON.stringify(state.rounds.map((round) => [round.round, round.startedAt, round.outcome]));

    elements.roundCount.textContent = `${state.rounds.length}회`;

    if (key === renderedRoundsKey) {
        return;
    }

    renderedRoundsKey = key;

    elements.rounds.replaceChildren(...state.rounds.map(createRoundItem).reverse());
};

const renderClock = () => {
    const state = currentState;

    if (!state || !state.startedAt) {
        elements.statElapsed.textContent = EMPTY_CLOCK;
        elements.statRemaining.textContent = EMPTY_CLOCK;
        elements.statProgress.value = 0;

        return;
    }

    if (state.status === "idle") {
        elements.statElapsed.textContent = formatDuration(state.endedAt - state.startedAt);
        elements.statRemaining.textContent = EMPTY_CLOCK;

        return;
    }

    const now = Date.now();

    elements.statElapsed.textContent = formatDuration(now - state.startedAt);

    if (state.deadlineAt) {
        elements.statRemaining.textContent = formatDuration(state.deadlineAt - now);
        elements.statProgress.value = Math.min(100, Math.max(0, ((now - state.startedAt) / (state.deadlineAt - state.startedAt)) * 100));
    }
};

const showNotice = (message, target = elements.notice) => {
    target.textContent = message;
    target.hidden = !message;
};

const showFailure = (result, target) => {
    showNotice(result.status === STATUS_OK ? "" : result.error.msg, target);
};

const renderSettings = () => {
    elements.enginePath.textContent = settings.exePath || "연결된 autopilot 실행 파일이 없어요.";
    elements.selectExe.textContent = settings.exePath ? "파일 변경" : "파일 선택";
    elements.engineBanner.hidden = Boolean(settings.exePath);
};

/* 모델·Effort */

const getSelectedOptions = () => {
    return { model: elements.model.value, effort: elements.effort.value };
};

const setSelectedOptions = ({ model, effort }) => {
    elements.model.value = model;
    elements.effort.value = effort;
};

// 실행 중에는 엔진에 전달된 값을 기준으로 선택을 맞춘다. 전달 중인 값은 덮어쓰지 않는다.
const renderOptions = (state) => {
    const isIdle = state.status === "idle";

    if (!isIdle && !isApplying && state.requested.model) {
        setSelectedOptions(state.requested);
    }

    const selected = getSelectedOptions();
    const isPending = !isIdle && (state.requested.model !== state.model || state.requested.effort !== state.effort);

    elements.model.disabled = state.status === "stopping";
    elements.effort.disabled = state.status === "stopping";

    if (isIdle) {
        elements.appliedNow.textContent = state.startedAt ? `마지막 ${formatOptions(state.model, state.effort)}` : "실행 전";
        elements.appliedNextLabel.textContent = "시작할 때";
        elements.appliedNext.textContent = formatOptions(selected.model, selected.effort);
    } else {
        elements.appliedNow.textContent = `${formatOptions(state.model, state.effort)} (${state.round ? `${state.round}회차` : "시작 중"})`;
        elements.appliedNextLabel.textContent = "다음 회차부터";
        elements.appliedNext.textContent = isPending ? formatOptions(state.requested.model, state.requested.effort) : "변경 없음";
    }

    elements.appliedTag.hidden = !isPending;
    elements.optionsHint.textContent = OPTIONS_HINTS[state.status];
};

// 변경은 즉시 전달한다. 전달 중에 또 바뀌면 마지막 선택만 한 번 더 보낸다.
const applyRoundOptions = async () => {
    if (isApplying) {
        isApplyQueued = true;

        return;
    }

    isApplying = true;

    do {
        isApplyQueued = false;

        const result = await window.autopilot.setOptions(getSelectedOptions());

        showFailure(result);

        if (result.status !== STATUS_OK) {
            isApplyQueued = false;
        }
    } while (isApplyQueued);

    isApplying = false;

    renderOptions(currentState);
};

const handleOptionChange = () => {
    if (currentState.status === "running") {
        applyRoundOptions();
    } else {
        renderOptions(currentState);
    }
};

/* 전체 렌더링과 이벤트 */

const renderState = (state) => {
    currentState = state;

    const hasEngine = Boolean(settings.exePath);
    const isIdle = state.status === "idle";
    const phase = hasEngine ? getRunPhase(state) : { label: "엔진 미연결", tone: "muted" };
    const lastRound = state.rounds[state.rounds.length - 1];
    const finishedCount = state.rounds.filter((round) => round.outcome === "완료").length;

    elements.badge.textContent = phase.label;
    elements.badge.dataset.tone = phase.tone;
    elements.statPhase.textContent = state.reason && isIdle && state.endedAt ? state.reason : state.phase || "시작하면 진행 단계가 표시돼요.";

    elements.statRound.textContent = state.round;
    elements.statRoundSub.textContent = lastRound ? `완료 ${finishedCount}회, 최근 결과 ${lastRound.outcome || "진행 중"}` : "아직 시작한 회차가 없어요.";
    elements.statDeadline.textContent = state.deadlineAt ? `종료 예정 ${formatDeadline(state.deadlineAt)}` : "종료 예정 시각 없음";
    elements.statPolicy.textContent = state.policy ? `정책 ${state.policy.replace(/ \(.+\)$/, "")}` : "정책 없음";

    elements.start.disabled = !hasEngine || !isIdle;
    elements.stop.disabled = state.status !== "running";
    elements.kill.disabled = isIdle;
    elements.openReport.disabled = !state.reportFile;
    elements.endTime.disabled = !isIdle;
    elements.policy.disabled = !isIdle;
    elements.selectExe.disabled = !isIdle;
    elements.findExe.disabled = !isIdle;

    renderOptions(state);
    renderRounds(state);
    renderClock();
};

const handleStart = async (event) => {
    event.preventDefault();

    showFailure(await window.autopilot.start({ endTime: elements.endTime.value, policy: elements.policy.value, ...getSelectedOptions() }));
};

const handleStop = async () => {
    showFailure(await window.autopilot.stop());
};

const handleKill = async () => {
    showFailure(await window.autopilot.kill());
};

const handleOpenReport = async () => {
    showFailure(await window.autopilot.openReport());
};

const applyEngineResult = (result) => {
    showFailure(result, elements.engineNotice);

    if (result.status === STATUS_OK) {
        settings = result.data.settings;

        renderSettings();
        renderState(currentState);
    }
};

const handleSelectExecutable = async () => {
    applyEngineResult(await window.autopilot.selectExecutable());
};

const handleFindExecutable = async () => {
    applyEngineResult(await window.autopilot.findExecutable());
};

const initialize = async () => {
    const snapshot = await window.autopilot.getState();

    settings = snapshot.settings;

    elements.version.textContent = `v${snapshot.version}`;
    elements.endTime.value = settings.endTime;
    elements.policy.value = settings.policy;

    setSelectedOptions(settings);
    renderSettings();
    renderState(snapshot.state);
    appendLogEntries(snapshot.logs);

    window.autopilot.onLog(appendLogEntries);
    window.autopilot.onState(renderState);

    for (const item of elements.navItems) {
        item.addEventListener("click", () => showView(item.dataset.view));
    }

    elements.openSettings.addEventListener("click", () => showView("settings"));
    elements.form.addEventListener("submit", handleStart);
    elements.stop.addEventListener("click", handleStop);
    elements.kill.addEventListener("click", handleKill);
    elements.selectExe.addEventListener("click", handleSelectExecutable);
    elements.findExe.addEventListener("click", handleFindExecutable);
    elements.openReport.addEventListener("click", handleOpenReport);
    elements.clearLog.addEventListener("click", clearLog);
    elements.log.addEventListener("scroll", handleFollowByScroll);
    elements.model.addEventListener("change", handleOptionChange);
    elements.effort.addEventListener("change", handleOptionChange);

    setInterval(renderClock, CLOCK_INTERVAL_MS);
};

initialize();

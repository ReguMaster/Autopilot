const MAX_LOG_LINES = 3000;
const LIVE_LINES = 4;
const LIVE_FADE_MS = 650;
const MAX_WORD_DELAY_STEPS = 24;
const CLOCK_INTERVAL_MS = 1000;
const FOLLOW_THRESHOLD_PX = 24;
const LOG_FLUSH_MS = 50;
const EMPTY_CLOCK = "--:--:--";
const SKELETON_ITEM_COUNT = 3;
const PANEL_NAMES = ["settings", "profile"];

const STATUS_OK = "OK";

// 안내 문구는 알려야 할 때만 보인다(적용 대기는 renderOptions가 따로 쓴다).
const OPTIONS_HINTS = {
    idle: "",
    running: "",
    stopping: "종료 요청 후에는 모델·Effort를 바꿀 수 없어요."
};

// 상태별 가운데 버튼. 종료 요청 후에 누르면 메인 프로세스가 확인 모달을 띄우고 강제 종료한다.
const MAIN_ACTIONS = {
    idle: { action: "start", label: "시작", title: "" },
    running: { action: "stop", label: "종료 신호", title: "현재 회차를 마친 뒤 종료해요" },
    stopping: { action: "kill", label: "종료", title: "즉시 중단해요. commit 전 변경은 working tree에 남아요" }
};

const byId = (id) => document.getElementById(id);

const elements = {
    titlebar: byId("titlebar"),
    settingsToggle: byId("settings-toggle"),
    settings: byId("settings"),
    profileToggle: byId("profile-toggle"),
    profile: byId("profile"),
    profileCard: byId("profile-card"),
    profileAvatar: byId("profile-avatar"),
    profileName: byId("profile-name"),
    profileEmail: byId("profile-email"),
    profilePlan: byId("profile-plan"),
    usageSection: byId("usage-section"),
    usageList: byId("usage-list"),
    usageStatus: byId("usage-status"),
    usageRefresh: byId("usage-refresh"),
    accountSelect: byId("account-select"),
    accountAdd: byId("account-add"),
    accountLogin: byId("account-login"),
    accountRemove: byId("account-remove"),
    accountMessage: byId("account-message"),
    accountForm: byId("account-form"),
    accountLabel: byId("account-label"),
    accountShare: byId("account-share"),
    claudeDir: byId("claude-dir"),
    claudeDirPath: byId("claude-dir-path"),
    selectClaudeDir: byId("select-claude-dir"),
    resetClaudeDir: byId("reset-claude-dir"),
    accountFormCancel: byId("account-form-cancel"),
    loginBox: byId("login-box"),
    loginMessage: byId("login-message"),
    loginOpen: byId("login-open"),
    loginCodeForm: byId("login-code-form"),
    loginCode: byId("login-code"),
    loginCancel: byId("login-cancel"),
    windowMinimize: byId("window-minimize"),
    windowMaximize: byId("window-maximize"),
    windowClose: byId("window-close"),
    content: document.querySelector(".content"),
    hero: document.querySelector(".hero"),
    badge: byId("status-badge"),
    clock: byId("clock"),
    clockLabel: byId("clock-label"),
    clockValue: byId("clock-value"),
    statPhase: byId("stat-phase"),
    notice: byId("notice"),
    projectBanner: byId("project-banner"),
    bannerSelectProject: byId("banner-select-project"),
    form: byId("run-form"),
    mainAction: byId("main-action"),
    choices: document.querySelectorAll(".choice"),
    effortControl: byId("effort-control"),
    effortBars: byId("effort-control").querySelectorAll(".bars i"),
    effort: byId("effort"),
    effortName: byId("effort-name"),
    effortLevels: byId("effort-levels"),
    endTime: byId("end-time"),
    extendOnLimit: byId("extend-on-limit"),
    tasks: byId("tasks"),
    applyNote: byId("apply-note"),
    livePanel: byId("live-panel"),
    live: byId("live"),
    history: byId("history"),
    historyToggle: byId("history-toggle"),
    historyClose: byId("history-close"),
    log: byId("log"),
    logEmpty: byId("log-empty"),
    logCount: byId("log-count"),
    follow: byId("follow"),
    clearLog: byId("clear-log"),
    rounds: byId("rounds"),
    roundCount: byId("round-count"),
    roundSummary: byId("round-summary"),
    project: document.querySelector(".project"),
    projectPath: byId("project-path"),
    selectProject: byId("select-project"),
    appVersion: byId("app-version"),
    resetProgress: byId("reset-progress"),
    openReport: byId("open-report")
};

// Effort 단계 이름은 index.html의 목록이 기준이다(tests/checkDesktopRunner.js가 엔진 허용 값과 대조한다).
const EFFORT_LEVELS = [...elements.effortLevels.options].map((option) => option.label);

let settings = { projectDir: "" };
let appVersion = "";
let currentState = null;
let pendingEntries = [];
let isFlushScheduled = false;
let renderedRoundsKey = "";
let lineNumber = 0;
let isApplying = false;
let isApplyQueued = false;
let renderedUsageKey = "";
const EMPTY_ACCOUNT = { profile: null, limits: [], fetchedAt: 0, error: null };
const LOGIN_DONE_HIDE_MS = 3000;
const MAX_ACCOUNT_COUNT = 9;

let accountsState = { accounts: [], activeId: "default" };
let accountSnapshots = {};
let loginState = null;
let claudeDirInfo = null;
let renderedAccountsKey = "";
let loginHideTimer = 0;

/* 화면 움직임 */

// 문구가 바뀔 때만 새 문구가 맺히는 전환을 다시 건다.
const swapText = (element, text) => {
    if (element.textContent === text) {
        return;
    }

    element.textContent = text;
    element.classList.remove("swap");
    void element.offsetWidth;
    element.classList.add("swap");
};

// 고른 항목 뒤로 선택 표시를 옮긴다. 이름이 펼쳐지는 동안에도 따라가도록 크기 변화마다 다시 잰다.
const updateChoicePill = (choice) => {
    const checked = choice.querySelector("input:checked")?.closest("label");

    if (!checked) {
        return;
    }

    choice.style.setProperty("--pill-x", `${checked.offsetLeft}px`);
    choice.style.setProperty("--pill-w", `${checked.offsetWidth}px`);
};

const watchChoicePills = () => {
    const observer = new ResizeObserver(() => elements.choices.forEach(updateChoicePill));

    for (const choice of elements.choices) {
        for (const label of choice.querySelectorAll("label")) {
            observer.observe(label);
        }

        choice.addEventListener("change", () => updateChoicePill(choice));
        updateChoicePill(choice);
    }
};

// 블러는 최근 로그 바로 아래에서 시작한다.
const updateVeil = () => {
    document.documentElement.style.setProperty("--veil-top", `${Math.round(elements.livePanel.getBoundingClientRect().bottom)}px`);
};

/* 전체 기록 로그 */

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

const scrollLogToEnd = () => {
    if (elements.follow.checked) {
        elements.log.scrollTop = elements.log.scrollHeight;
    }
};

/* 최근 로그: 단어 단위로 맺히고 오래된 줄은 흐려지며 빠진다 */

const createLiveLine = (entry) => {
    const item = document.createElement("li");

    item.dataset.kind = getLineKind(entry);

    entry.text.split(/(\s+)/).forEach((part, index) => {
        const word = document.createElement("span");

        word.className = "word";
        word.style.setProperty("--word", Math.min(index, MAX_WORD_DELAY_STEPS));
        word.textContent = part;

        item.append(word);
    });

    return item;
};

const fadeOutLiveLine = (item) => {
    item.classList.add("out");

    setTimeout(() => item.remove(), LIVE_FADE_MS);
};

const appendLiveLines = (entries) => {
    const visibleLines = [...elements.live.children].filter((item) => !item.classList.contains("out"));
    const newLines = entries.slice(-LIVE_LINES).map(createLiveLine);
    const overflow = visibleLines.length + newLines.length - LIVE_LINES;

    elements.live.append(...newLines);

    for (const item of visibleLines.slice(0, Math.max(0, overflow))) {
        fadeOutLiveLine(item);
    }
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
    scrollLogToEnd();
    appendLiveLines(entries);
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

    elements.live.replaceChildren();
    elements.logEmpty.hidden = false;

    updateLogCount();
};

const handleFollowByScroll = () => {
    const { scrollHeight, scrollTop, clientHeight } = elements.log;

    elements.follow.checked = scrollHeight - scrollTop - clientHeight < FOLLOW_THRESHOLD_PX;
};

/* 사용량 */

const createUsageItem = () => {
    const item = document.createElement("section");
    const name = document.createElement("h3");
    const percent = document.createElement("b");
    const meter = document.createElement("div");
    const fill = document.createElement("i");
    const reset = document.createElement("span");

    item.className = "usage-item";
    percent.className = "usage-percent num";
    meter.className = "usage-meter";
    meter.setAttribute("role", "meter");
    meter.setAttribute("aria-valuemin", "0");
    meter.setAttribute("aria-valuemax", "100");
    reset.className = "usage-reset";

    meter.append(fill);
    item.append(name, percent, meter, reset);

    return item;
};

const updateUsageItem = (item, limit, now) => {
    const percent = Math.round(limit.percent);
    const meter = item.querySelector(".usage-meter");

    item.dataset.tone = getUsageTone(limit.percent);
    item.querySelector("h3").textContent = limit.label;
    item.querySelector(".usage-percent").textContent = `${percent}%`;
    item.querySelector(".usage-reset").textContent = formatUsageReset(limit.resetsAt, now);
    meter.style.setProperty("--value", String(limit.percent));
    meter.setAttribute("aria-valuenow", String(percent));
    meter.setAttribute("aria-label", limit.label);
};

const getAvatarLetter = ({ name, email }) => {
    return Array.from(name || email)[0]?.toUpperCase() ?? "";
};

// 아바타 사진은 계정 정보에 없어 이름(없으면 이메일)의 첫 글자를 그린다. 조직 이름은 요금제 표시의 툴팁에 둔다.
const renderProfile = (profile, isLoading) => {
    elements.profileCard.hidden = !profile && !isLoading;
    elements.profileCard.setAttribute("aria-busy", String(isLoading));
    elements.profileAvatar.textContent = profile ? getAvatarLetter(profile) : "";
    elements.profileName.textContent = profile ? profile.name || profile.email : "";
    elements.profileEmail.textContent = profile?.name ? profile.email : "";
    elements.profilePlan.textContent = profile?.plan || "";
    elements.profilePlan.hidden = !profile?.plan;
    elements.profilePlan.title = profile?.organization || "";
};

// 항목 구성이 같으면 막대를 다시 만들지 않아 값이 바뀔 때만 막대가 움직인다.
const renderUsage = (limits, isLoading) => {
    const key = isLoading ? "loading" : limits.map((limit) => limit.label).join("|");

    elements.usageSection.hidden = !isLoading && limits.length === 0;

    if (key !== renderedUsageKey) {
        elements.usageList.replaceChildren(...Array.from({ length: isLoading ? SKELETON_ITEM_COUNT : limits.length }, createUsageItem));
        elements.usageList.toggleAttribute("data-loading", isLoading);
        renderedUsageKey = key;
    }

    if (!isLoading) {
        limits.forEach((limit, index) => updateUsageItem(elements.usageList.children[index], limit, Date.now()));
    }
};

const getAccountStatus = (account, isLoading) => {
    if (isLoading) {
        return { text: "불러오는 중이에요.", tone: "" };
    }

    if (!account.error) {
        return { text: `${formatClock(account.fetchedAt)} 기준`, tone: "" };
    }

    const staleNote = account.fetchedAt ? ` (${formatClock(account.fetchedAt)} 기준 값)` : "";

    return { text: account.error.msg + staleNote, tone: "warn" };
};

// 메인 프로세스가 앱을 켤 때 한 번 읽어 보관하고 주기적으로 갱신해 보내 준다. 값이 없고 오류도 없으면 첫 조회 중이다.
const renderAccount = (account) => {
    const isLoading = !account.fetchedAt && !account.error;
    const status = getAccountStatus(account, isLoading);

    renderProfile(account.profile, isLoading);
    renderUsage(account.limits, isLoading);

    elements.usageStatus.textContent = status.text;
    elements.usageStatus.dataset.tone = status.tone;
};

const renderActiveAccount = () => {
    renderAccount(accountSnapshots[accountsState.activeId] || EMPTY_ACCOUNT);
};

const showAccountMessage = (message) => {
    elements.accountMessage.textContent = message;
    elements.accountMessage.dataset.tone = "warn";
    elements.accountMessage.hidden = !message;
};

const showAccountFailure = (result) => {
    showAccountMessage(result.status === STATUS_OK ? "" : result.error.msg);

    return result.status === STATUS_OK;
};

/* 계정 */

// 실행 중이거나 로그인 중에는 계정을 바꾸거나 추가·제거할 수 없다(메인 프로세스도 막는다).
const renderAccountBar = () => {
    const { accounts, activeId } = accountsState;
    const isIdle = !currentState || currentState.status === "idle";
    const isLocked = !isIdle || loginState?.phase === "waiting";
    const accountsKey = accounts.map((account) => `${account.id}:${account.label}`).join("|");

    if (accountsKey !== renderedAccountsKey) {
        elements.accountSelect.replaceChildren(...accounts.map((account) => new Option(account.label, account.id)));
        renderedAccountsKey = accountsKey;
    }

    elements.accountSelect.value = activeId;
    elements.accountSelect.disabled = isLocked;
    elements.accountSelect.title = isIdle ? "" : "실행 중에는 계정을 바꿀 수 없어요.";
    elements.accountAdd.disabled = isLocked || accounts.length >= MAX_ACCOUNT_COUNT;
    elements.accountLogin.disabled = isLocked;
    elements.accountRemove.disabled = isLocked || activeId === "default";
    elements.selectClaudeDir.disabled = isLocked;
    elements.resetClaudeDir.disabled = isLocked || !claudeDirInfo || claudeDirInfo.isAuto;
};

const renderClaudeDir = () => {
    elements.claudeDirPath.textContent = claudeDirInfo ? `${claudeDirInfo.path}${claudeDirInfo.isAuto ? " (자동 감지)" : ""}${claudeDirInfo.exists ? "" : " - 폴더를 찾지 못했어요"}` : "";
    elements.claudeDir.toggleAttribute("data-missing", Boolean(claudeDirInfo) && !claudeDirInfo.exists);
};

const hideLoginBox = () => {
    clearTimeout(loginHideTimer);

    loginState = null;

    renderLogin();
    renderAccountBar();
};

const renderLogin = () => {
    const isWaiting = loginState?.phase === "waiting";

    elements.loginBox.hidden = !loginState;

    if (!loginState) {
        return;
    }

    elements.loginMessage.textContent = loginState.message;
    elements.loginMessage.dataset.tone = loginState.phase === "failed" ? "warn" : "";
    elements.loginOpen.hidden = !isWaiting || !loginState.url;
    elements.loginCodeForm.hidden = !isWaiting || !loginState.url;
    elements.loginCancel.textContent = isWaiting ? "취소" : "닫기";

    if (isWaiting) {
        elements.accountForm.hidden = true;
    }
};

const applyLoginState = (state) => {
    clearTimeout(loginHideTimer);

    loginState = state;

    renderLogin();
    renderAccountBar();

    if (state?.phase === "succeeded") {
        elements.loginCode.value = "";
        loginHideTimer = setTimeout(hideLoginBox, LOGIN_DONE_HIDE_MS);
    }
};

const applyAccountsPayload = (payload) => {
    accountsState = { accounts: payload.accounts, activeId: payload.activeId };
    claudeDirInfo = payload.claudeDir;
    accountSnapshots = { ...accountSnapshots, ...payload.snapshots };

    if (payload.login || loginState?.phase === "waiting") {
        applyLoginState(payload.login);
    }

    renderAccountBar();
    renderClaudeDir();
    renderActiveAccount();
};

const handleAccountSelect = async () => {
    const result = await window.autopilot.selectAccount(elements.accountSelect.value);

    if (showAccountFailure(result)) {
        applyAccountsPayload(result.data);
    }

    renderAccountBar();
};

const handleAccountAdd = () => {
    showAccountMessage("");

    elements.accountForm.hidden = false;
    elements.accountLabel.focus();
};

const handleAccountFormCancel = () => {
    elements.accountForm.hidden = true;
    elements.accountLabel.value = "";
};

const handleAccountFormSubmit = async (event) => {
    event.preventDefault();

    const result = await window.autopilot.addAccount({ label: elements.accountLabel.value, shareData: elements.accountShare.checked });

    if (showAccountFailure(result)) {
        handleAccountFormCancel();
    }
};

const handleAccountLogin = async () => {
    showAccountFailure(await window.autopilot.loginAccount(accountsState.activeId));
};

const handleAccountRemove = async () => {
    const result = await window.autopilot.removeAccount(accountsState.activeId);

    if (showAccountFailure(result) && !result.data.cancelled) {
        applyAccountsPayload(result.data);
    }
};

const handleLoginCancel = async () => {
    if (loginState?.phase === "waiting") {
        await window.autopilot.cancelLogin();
    } else {
        hideLoginBox();
    }
};

const handleLoginCode = async (event) => {
    event.preventDefault();

    if (showAccountFailure(await window.autopilot.submitLoginCode(elements.loginCode.value))) {
        elements.loginCode.value = "";
    }
};

const handleClaudeDirChange = async (request) => {
    const result = await request();

    showFailure(result);

    if (result.status === STATUS_OK) {
        applyAccountsPayload(result.data);
    }
};

const handleRefreshAccount = async () => {
    elements.usageRefresh.disabled = true;

    const result = await window.autopilot.refreshAccount(accountsState.activeId);

    elements.usageRefresh.disabled = false;

    if (showAccountFailure(result)) {
        accountSnapshots[result.data.id] = result.data.account;
        renderActiveAccount();
    }
};

/* 설정·프로필 패널과 전체 기록 */

const getOpenPanel = () => {
    return PANEL_NAMES.find((name) => document.body.classList.contains(`${name}-open`));
};

const applyPanelState = (name, isOpen) => {
    if (document.body.classList.contains(`${name}-open`) === isOpen) {
        return;
    }

    document.body.classList.toggle(`${name}-open`, isOpen);
    elements[name].inert = !isOpen;
    elements[`${name}Toggle`].setAttribute("aria-expanded", String(isOpen));

    if (name === "settings" && isOpen) {
        elements.choices.forEach(updateChoicePill);
    }

    if (name === "profile" && isOpen) {
        renderActiveAccount();
    }
};

// 두 패널은 같은 자리에 뜨므로 하나를 열면 다른 하나는 닫는다.
const setPanelOpen = (name, isOpen) => {
    if (isOpen) {
        PANEL_NAMES.filter((otherName) => otherName !== name).forEach((otherName) => applyPanelState(otherName, false));
    }

    applyPanelState(name, isOpen);
};

const closePanels = () => {
    PANEL_NAMES.forEach((name) => applyPanelState(name, false));
};

const setHistoryOpen = (isOpen) => {
    const label = isOpen ? "전체 기록 닫기" : "전체 기록 보기";

    elements.history.hidden = !isOpen;
    document.body.classList.toggle("history-open", isOpen);
    elements.historyToggle.setAttribute("aria-expanded", String(isOpen));
    elements.historyToggle.textContent = label;
    elements.livePanel.setAttribute("aria-expanded", String(isOpen));

    if (isOpen) {
        closePanels();
        scrollLogToEnd();
        elements.history.scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
        elements.content.scrollTo({ top: 0, behavior: "smooth" });
    }
};

const handleLivePanelKey = (event) => {
    if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        setHistoryOpen(elements.history.hidden);
    }
};

// 패널이 열린 채로 화면의 다른 곳을 누르거나 Esc를 누르면 닫는다.
const handleOutsidePointer = (event) => {
    const name = getOpenPanel();

    if (name && !elements[name].contains(event.target) && !elements[`${name}Toggle`].contains(event.target)) {
        closePanels();
    }
};

const handleEscape = (event) => {
    const name = getOpenPanel();

    if (event.key === "Escape" && name) {
        closePanels();
        elements[`${name}Toggle`].focus();
    }
};

/* 상태 표시 */

const createRoundItem = (round) => {
    const item = document.createElement("li");
    const number = document.createElement("span");
    const body = document.createElement("div");
    const time = document.createElement("span");
    const options = document.createElement("small");
    const tag = document.createElement("span");

    item.className = "round";
    number.className = "round-no num";
    number.textContent = round.round;
    body.className = "round-body";
    time.className = "num";
    time.textContent = formatRoundTime(round);
    options.textContent = formatOptions(round.model, round.effort);
    tag.className = "tag";
    tag.dataset.tone = getRoundTone(round.outcome);
    tag.textContent = round.outcome || "진행 중";

    body.append(time, options);
    item.append(number, body, tag);

    return item;
};

const renderRounds = (state) => {
    const key = JSON.stringify(state.rounds.map((round) => [round.round, round.startedAt, round.outcome]));
    const lastRound = state.rounds[state.rounds.length - 1];
    const finishedCount = state.rounds.filter((round) => round.outcome === "완료").length;
    const policyText = state.policy ? `, 정책 ${state.policy.replace(/ \(.+\)$/, "")}` : "";

    elements.roundCount.textContent = `${state.rounds.length}회`;
    elements.roundSummary.textContent = lastRound ? `완료 ${finishedCount}회, 최근 결과 ${lastRound.outcome || "진행 중"}${policyText}` : "아직 시작한 회차가 없어요.";

    if (key === renderedRoundsKey) {
        return;
    }

    renderedRoundsKey = key;

    elements.rounds.replaceChildren(...state.rounds.map(createRoundItem).reverse());
};

// 실행 중에는 남은 시간(종료 예정 시각을 모르면 경과 시간), 끝난 뒤에는 실행한 시간을 보여준다. 종료 시각은 옵션 줄에 있으므로 따로 쓰지 않는다.
const renderClock = () => {
    const state = currentState;

    if (!state || !state.startedAt) {
        elements.clock.hidden = true;

        return;
    }

    const now = Date.now();

    elements.clock.hidden = false;

    if (state.status === "idle") {
        elements.clockLabel.textContent = "실행 시간";
        elements.clockValue.textContent = state.endedAt ? formatDuration(state.endedAt - state.startedAt) : EMPTY_CLOCK;

        return;
    }

    if (state.deadlineAt) {
        elements.clockLabel.textContent = "남은 시간";
        elements.clockValue.textContent = formatDuration(state.deadlineAt - now);

        return;
    }

    elements.clockLabel.textContent = "경과";
    elements.clockValue.textContent = formatDuration(now - state.startedAt);
};

const getStatusText = (state, phase) => {
    if (state.status === "running" && state.round) {
        return `${state.round}회차 진행 중`;
    }

    if (state.status === "stopping" && state.round) {
        return `${state.round}회차 마무리 중, 종료 요청됨`;
    }

    return phase.label;
};

// 진행 단계 줄은 상태 문구와 겹치면 숨기고, 재시도·사용량 한도·회차 결과처럼 따로 알릴 때만 보인다.
const getPhaseText = (state) => {
    if (state.status === "idle") {
        return state.reason && state.endedAt ? state.reason : "";
    }

    const phase = state.phase === `${state.round}회차 진행 중` ? "" : state.phase;

    if (state.attached) {
        return phase ? `${phase}, 이전에 시작한 엔진에 다시 연결됨` : "이전에 시작한 엔진에 다시 연결됨";
    }

    return phase;
};

const showNotice = (message, tone = "") => {
    elements.notice.textContent = message;
    elements.notice.dataset.tone = tone;
    elements.notice.hidden = !message;
};

const showFailure = (result) => {
    showNotice(result.status === STATUS_OK ? "" : result.error.msg);
};

const renderSettings = () => {
    const hasProject = Boolean(settings.projectDir);

    elements.projectPath.textContent = settings.projectDir || "선택한 폴더가 없어요.";
    elements.project.toggleAttribute("data-missing", !hasProject);
    elements.selectProject.textContent = hasProject ? "폴더 변경" : "폴더 선택";
    elements.projectBanner.hidden = hasProject;
    elements.appVersion.textContent = `AutoPilot v${appVersion}`;
};

/* 모델·Effort */

const renderEffort = () => {
    const level = Number(elements.effort.value);

    elements.effortControl.dataset.level = level;
    swapText(elements.effortName, EFFORT_LEVELS[level]);
    elements.effort.setAttribute("aria-valuetext", EFFORT_LEVELS[level]);

    elements.effortBars.forEach((bar, index) => {
        bar.classList.toggle("on", index <= level);
    });
};

const getSelectedOptions = () => {
    return { model: elements.form.elements.model.value, effort: EFFORT_LEVELS[Number(elements.effort.value)] };
};

const setSelectedOptions = ({ model, effort }) => {
    elements.form.elements.model.value = model;
    elements.effort.value = String(Math.max(0, EFFORT_LEVELS.indexOf(effort)));

    renderEffort();
    elements.choices.forEach(updateChoicePill);
};

const setRadiosDisabled = (name, disabled) => {
    for (const radio of elements.form.elements[name]) {
        radio.disabled = disabled;
    }
};

const showApplyNote = (text, tone) => {
    elements.applyNote.hidden = !text;
    elements.applyNote.dataset.tone = tone;
    swapText(elements.applyNote, text);
};

// 실행 중에는 엔진에 전달된 값을 기준으로 선택을 맞춘다. 전달 중인 값은 덮어쓰지 않는다.
const renderOptions = (state) => {
    const isIdle = state.status === "idle";

    if (!isIdle && !isApplying && state.requested.model) {
        setSelectedOptions(state.requested);
    }

    const isPending = !isIdle && (state.requested.model !== state.model || state.requested.effort !== state.effort);

    setRadiosDisabled("model", state.status === "stopping");
    elements.effort.disabled = state.status === "stopping";

    if (isPending) {
        showApplyNote(`적용 대기: 다음 회차부터 ${formatOptions(state.requested.model, state.requested.effort)} (지금 ${formatOptions(state.model, state.effort)})`, "warn");

        return;
    }

    showApplyNote(OPTIONS_HINTS[state.status], "");
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

// range는 끄는 동안 input이 계속 오므로 표시만 바꾸고, 엔진 전달은 손을 뗀 뒤(change) 한 번만 한다.
const handleOptionChange = () => {
    if (currentState.status === "running") {
        applyRoundOptions();
    } else {
        renderOptions(currentState);
    }
};

/* 전체 렌더링과 이벤트 */

const renderMainAction = (state, hasProject) => {
    const config = MAIN_ACTIONS[state.status];

    elements.mainAction.dataset.action = config.action;
    swapText(elements.mainAction, config.label);
    elements.mainAction.title = config.title;
    elements.mainAction.disabled = state.status === "idle" && !hasProject;
};

const renderState = (state) => {
    currentState = state;

    const hasProject = Boolean(settings.projectDir);
    const isIdle = state.status === "idle";
    const phase = hasProject ? getRunPhase(state) : { label: "프로젝트 미선택", tone: "muted" };
    const phaseText = getPhaseText(state);

    document.body.dataset.status = state.status;
    swapText(elements.badge, getStatusText(state, phase));
    elements.badge.dataset.tone = phase.tone;
    elements.statPhase.hidden = !phaseText;
    swapText(elements.statPhase, phaseText);

    renderMainAction(state, hasProject);

    elements.endTime.disabled = !isIdle;
    elements.extendOnLimit.disabled = !isIdle;
    elements.tasks.disabled = !isIdle;
    setRadiosDisabled("policy", !isIdle);
    elements.openReport.disabled = !state.reportFile;
    elements.selectProject.disabled = !isIdle;
    elements.bannerSelectProject.disabled = !isIdle;
    elements.resetProgress.disabled = !isIdle || !hasProject;

    renderOptions(state);
    renderRounds(state);
    renderAccountBar();
    renderClock();
};

const handleMainAction = async (event) => {
    event.preventDefault();

    const { action } = MAIN_ACTIONS[currentState.status];

    if (action === "start") {
        showFailure(
            await window.autopilot.start({
                tasks: elements.tasks.value,
                endTime: elements.endTime.value,
                policy: elements.form.elements.policy.value,
                extendOnLimit: elements.extendOnLimit.checked,
                ...getSelectedOptions()
            })
        );
    } else if (action === "stop") {
        showFailure(await window.autopilot.stop());
    } else {
        showFailure(await window.autopilot.kill());
    }
};

const handleOpenReport = async () => {
    showFailure(await window.autopilot.openReport());
};

const handleSelectProject = async () => {
    const result = await window.autopilot.selectProject();

    showFailure(result);

    if (result.status === STATUS_OK) {
        settings = result.data.settings;

        renderSettings();
        renderState(currentState);
    }
};

const handleResetProgress = async () => {
    const result = await window.autopilot.resetProgress();

    if (result.status !== STATUS_OK) {
        showFailure(result);

        return;
    }

    if (!result.data.cancelled) {
        showNotice(result.data.isReset ? "진행 기록을 초기화했어요. 원본은 autopilot/progress 폴더에 보관했어요." : "이미 초기 상태예요.", "ok");
    }
};

const renderWindowState = ({ maximized }) => {
    const label = maximized ? "이전 크기로" : "최대화";

    elements.titlebar.toggleAttribute("data-maximized", maximized);
    elements.windowMaximize.setAttribute("aria-label", label);
    elements.windowMaximize.title = label;
};

const bindWindowControls = () => {
    elements.settingsToggle.addEventListener("click", () => setPanelOpen("settings", getOpenPanel() !== "settings"));
    elements.profileToggle.addEventListener("click", () => setPanelOpen("profile", getOpenPanel() !== "profile"));
    elements.windowMinimize.addEventListener("click", () => window.appWindow.minimize());
    elements.windowMaximize.addEventListener("click", () => window.appWindow.toggleMaximize());
    elements.windowClose.addEventListener("click", () => window.appWindow.close());

    window.appWindow.onState(renderWindowState);
};

const bindLayoutWatchers = () => {
    const observer = new ResizeObserver(updateVeil);

    observer.observe(elements.hero);
    window.addEventListener("resize", updateVeil);
    watchChoicePills();
    updateVeil();
};

const initialize = async () => {
    bindWindowControls();

    const snapshot = await window.autopilot.getState();

    settings = snapshot.settings;
    appVersion = snapshot.version;

    elements.endTime.value = settings.endTime;
    elements.tasks.value = settings.tasks;
    elements.form.elements.policy.value = settings.policy;
    elements.extendOnLimit.checked = settings.extendOnLimit;

    setSelectedOptions(settings);
    renderSettings();
    renderState(snapshot.state);
    appendLogEntries(snapshot.logs);
    bindLayoutWatchers();

    applyAccountsPayload((await window.autopilot.getAccounts()).data);

    window.autopilot.onAccounts(applyAccountsPayload);
    window.autopilot.onLogin(applyLoginState);
    window.autopilot.onAccount(({ id, account }) => {
        accountSnapshots[id] = account;

        if (id === accountsState.activeId) {
            renderActiveAccount();
        }
    });
    window.autopilot.onLog(appendLogEntries);
    window.autopilot.onState(renderState);

    elements.form.addEventListener("submit", handleMainAction);
    elements.selectProject.addEventListener("click", handleSelectProject);
    elements.bannerSelectProject.addEventListener("click", handleSelectProject);
    elements.resetProgress.addEventListener("click", handleResetProgress);
    elements.openReport.addEventListener("click", handleOpenReport);
    elements.usageRefresh.addEventListener("click", handleRefreshAccount);
    elements.accountSelect.addEventListener("change", handleAccountSelect);
    elements.selectClaudeDir.addEventListener("click", () => handleClaudeDirChange(window.autopilot.selectClaudeDir));
    elements.resetClaudeDir.addEventListener("click", () => handleClaudeDirChange(window.autopilot.resetClaudeDir));
    elements.accountAdd.addEventListener("click", handleAccountAdd);
    elements.accountLogin.addEventListener("click", handleAccountLogin);
    elements.accountRemove.addEventListener("click", handleAccountRemove);
    elements.accountForm.addEventListener("submit", handleAccountFormSubmit);
    elements.accountFormCancel.addEventListener("click", handleAccountFormCancel);
    elements.loginOpen.addEventListener("click", async () => showAccountFailure(await window.autopilot.openLoginUrl()));
    elements.loginCodeForm.addEventListener("submit", handleLoginCode);
    elements.loginCancel.addEventListener("click", handleLoginCancel);
    elements.historyToggle.addEventListener("click", () => setHistoryOpen(elements.history.hidden));
    elements.historyClose.addEventListener("click", () => setHistoryOpen(false));
    elements.livePanel.addEventListener("click", () => setHistoryOpen(elements.history.hidden));
    elements.livePanel.addEventListener("keydown", handleLivePanelKey);
    elements.clearLog.addEventListener("click", clearLog);
    elements.log.addEventListener("scroll", handleFollowByScroll);
    elements.effort.addEventListener("input", renderEffort);
    elements.effort.addEventListener("change", handleOptionChange);
    document.addEventListener("pointerdown", handleOutsidePointer);
    document.addEventListener("keydown", handleEscape);

    for (const radio of elements.form.elements.model) {
        radio.addEventListener("change", handleOptionChange);
    }

    setInterval(renderClock, CLOCK_INTERVAL_MS);
};

initialize();

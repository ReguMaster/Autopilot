const MAX_LOG_LINES = 3000;
const LIVE_LINES = 4;
const LIVE_FADE_MS = 650;
const LIVE_SHIFT_MS = 450;
const LIVE_SHIFT_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";
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
    loginBanner: byId("login-banner"),
    loginBannerMessage: byId("login-banner-message"),
    bannerLogin: byId("banner-login"),
    form: byId("run-form"),
    mainAction: byId("main-action"),
    effortControl: byId("effort-control"),
    effortBars: byId("effort-control").querySelectorAll(".bars i"),
    effort: byId("effort"),
    effortName: byId("effort-name"),
    effortPopover: byId("effort-popover"),
    effortOptions: byId("effort-popover").querySelectorAll("[data-level]"),
    composer: document.querySelector(".composer"),
    modelChip: byId("model-chip"),
    modelChipMark: byId("model-chip-mark"),
    modelChipName: byId("model-chip-name"),
    modelPopover: byId("model-popover"),
    policyChip: byId("policy-chip"),
    policyChipIcon: byId("policy-chip-icon"),
    policyChipName: byId("policy-chip-name"),
    policyPopover: byId("policy-popover"),
    policyOptions: byId("policy-popover").querySelectorAll("[data-policy]"),
    effortLevels: byId("effort-levels"),
    endTime: byId("end-time"),
    endTimeButton: byId("end-time-button"),
    endTimeValue: byId("end-time-value"),
    endTimeUntil: byId("end-time-until"),
    timePopover: byId("end-time-popover"),
    timeHour: byId("time-hour"),
    timeMinute: byId("time-minute"),
    timeUntil: byId("time-until"),
    extendOnLimit: byId("extend-on-limit"),
    tasks: byId("tasks"),
    applyNote: byId("apply-note"),
    livePanel: byId("live-panel"),
    live: byId("live"),
    history: byId("history"),
    scrim: document.querySelector(".scrim"),
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
    devGroup: byId("dev-group"),
    toggleDevtools: byId("toggle-devtools"),
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
let isStartAfterLogin = false;

/* 화면 움직임 */

const replayAnimation = (element, className) => {
    element.classList.remove(className);
    void element.offsetWidth;
    element.classList.add(className);
};

// 문구가 바뀔 때만 새 문구가 맺히는 전환을 다시 건다.
const swapText = (element, text) => {
    if (element.textContent === text) {
        return;
    }

    element.textContent = text;
    replayAnimation(element, "swap");
};

// 블러는 모델 선택 줄에서 시작한다.
const updateVeil = () => {
    document.documentElement.style.setProperty("--veil-top", `${Math.round(elements.composer.getBoundingClientRect().top)}px`);
};

// 서체와 첫 상태가 준비된 뒤에 화면을 차례로 드러낸다(그 전에는 CSS가 등장 애니메이션을 멈춰 둔다).
const revealWhenReady = async () => {
    await document.fonts.ready;

    requestAnimationFrame(() => document.body.classList.add("ready"));
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

const isHistoryOpen = () => {
    return document.body.classList.contains("history-open");
};

// 닫혀 있는 동안에는 스크롤 위치를 계산하지 않고(레이아웃 강제), 열 때 한 번 맞춘다.
const scrollLogToEnd = () => {
    if (elements.follow.checked && isHistoryOpen()) {
        elements.log.scrollTop = elements.log.scrollHeight;
    }
};

/* 최근 로그: 줄 단위로 떠오르고 오래된 줄은 흐려지며 빠진다 */

const createLiveLine = (entry) => {
    const item = document.createElement("li");

    item.dataset.kind = getLineKind(entry);
    item.textContent = entry.text;

    return item;
};

const fadeOutLiveLine = (item) => {
    item.classList.add("out");

    setTimeout(() => item.remove(), LIVE_FADE_MS);
};

const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

// 목록은 아래에 붙어 있어 새 줄이 붙으면 기존 줄이 한 줄만큼 순간이동한다. 붙이기 전 화면 위치(움직이는 중이면 그 위치)에서 새 위치로 이어서 옮긴다.
const appendLiveLines = (entries) => {
    const visibleLines = [...elements.live.children].filter((item) => !item.classList.contains("out"));
    const newLines = entries.slice(-LIVE_LINES).map(createLiveLine);
    const overflow = visibleLines.length + newLines.length - LIVE_LINES;
    const anchor = elements.live.firstElementChild;
    const beforeTop = anchor?.getBoundingClientRect().top;

    elements.live.getAnimations().forEach((animation) => animation.cancel());
    elements.live.append(...newLines);

    for (const item of visibleLines.slice(0, Math.max(0, overflow))) {
        fadeOutLiveLine(item);
    }

    if (!anchor || reducedMotionQuery.matches) {
        return;
    }

    const shift = beforeTop - anchor.getBoundingClientRect().top;

    if (shift > 0) {
        elements.live.animate([{ translate: `0 ${shift}px` }, { translate: "0 0" }], { duration: LIVE_SHIFT_MS, easing: LIVE_SHIFT_EASING });
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

    // 결과 전에 로그인 상태가 비어(null) 오는 갱신이 있어 끝난 단계만 본다.
    if (isStartAfterLogin && state && state.phase !== "waiting") {
        isStartAfterLogin = false;

        if (state.phase === "succeeded") {
            showLoginRequired(false);
            startRun();
        }
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

// 전체 기록은 아래에서 올라오는 시트다. 화면을 스크롤하지 않고 위에 겹친다.
const setHistoryOpen = (isOpen) => {
    const label = isOpen ? "전체 기록 닫기" : "전체 기록 보기";

    document.body.classList.toggle("history-open", isOpen);
    elements.history.inert = !isOpen;
    elements.historyToggle.setAttribute("aria-expanded", String(isOpen));
    elements.historyToggle.textContent = label;
    elements.livePanel.setAttribute("aria-expanded", String(isOpen));

    if (isOpen) {
        closePanels();
        scrollLogToEnd();
    }
};

const toggleHistory = () => {
    setHistoryOpen(!isHistoryOpen());
};

const handleLivePanelKey = (event) => {
    if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggleHistory();
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
    if (event.key !== "Escape") {
        return;
    }

    const name = getOpenPanel();

    if (name) {
        closePanels();
        elements[`${name}Toggle`].focus();
    } else if (isHistoryOpen()) {
        setHistoryOpen(false);
        elements.livePanel.focus();
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

// 로그인이 필요해서 시작하지 못했으면 안내 줄에 로그인 버튼을 보여준다.
const showLoginRequired = (isRequired, message = "") => {
    elements.loginBannerMessage.textContent = message;
    elements.loginBanner.hidden = !isRequired;
};

const startRun = async () => {
    const result = await window.autopilot.start({
        tasks: elements.tasks.value,
        endTime: elements.endTime.value,
        policy: elements.form.elements.policy.value,
        extendOnLimit: elements.extendOnLimit.checked,
        ...getSelectedOptions()
    });
    const isLoginRequired = result.status !== STATUS_OK && result.error.code === "LOGIN_REQUIRED";

    showLoginRequired(isLoginRequired, isLoginRequired ? result.error.msg : "");
    showFailure(isLoginRequired ? { status: STATUS_OK } : result);
};

// 선택한 계정의 로그인을 시작하고 주소·코드 입력이 있는 프로필 패널을 연다. 로그인이 끝나면 applyLoginState가 멈췄던 시작을 이어간다.
const handleLogin = async () => {
    const result = await window.autopilot.loginAccount(accountsState.activeId);

    showFailure(result);

    if (result.status === STATUS_OK) {
        isStartAfterLogin = true;
        setPanelOpen("profile", true);
    }
};

const renderSettings = () => {
    const hasProject = Boolean(settings.projectDir);

    elements.projectPath.textContent = settings.projectDir || "선택한 폴더가 없어요.";
    elements.project.toggleAttribute("data-missing", !hasProject);
    elements.selectProject.textContent = hasProject ? "폴더 변경" : "폴더 선택";
    elements.projectBanner.hidden = hasProject;
    elements.appVersion.textContent = appVersion ? `v${appVersion}` : "";
};

/* 컴포저 알약: 모델·정책은 팝오버 목록에서 고르고, 고른 값을 알약에 보여준다 */

const POLICY_LABELS = { auto: "자율개선", todo: "지시개선" };
// 목록의 선택 표시가 미끄러지는 것을 보여준 뒤 팝오버를 닫는다.
const CHOICE_CLOSE_DELAY_MS = 320;

// 알약의 글자·아이콘이 실제로 바뀔 때만 맺히는 전환을 건다.
const updateChip = (chip, icon, name, iconId, label) => {
    const href = `#${iconId}`;

    if (icon.getAttribute("href") === href && name.textContent === label) {
        return;
    }

    icon.setAttribute("href", href);
    name.textContent = label;
    replayAnimation(chip, "chip-swap");
};

const closePopoverSoon = (popover) => {
    setTimeout(() => popover.hidePopover(), CHOICE_CLOSE_DELAY_MS);
};

// 개선 정책은 설정 패널의 라디오가 값을 갖고, 컴포저의 알약·팝오버는 그 값을 보여주고 바꾼다.
const renderPolicy = () => {
    const policy = elements.form.elements.policy.value;

    elements.policyPopover.dataset.policy = policy;
    updateChip(elements.policyChip, elements.policyChipIcon, elements.policyChipName, `icon-policy-${policy}`, POLICY_LABELS[policy]);

    for (const option of elements.policyOptions) {
        option.setAttribute("aria-pressed", String(option.dataset.policy === policy));
    }
};

const handlePolicyOptionClick = (event) => {
    const option = event.target.closest("[data-policy]");

    if (option) {
        elements.form.elements.policy.value = option.dataset.policy;
        renderPolicy();
        closePopoverSoon(elements.policyPopover);
    }
};

const renderModelChip = () => {
    const model = elements.form.elements.model.value;

    updateChip(elements.modelChip, elements.modelChipMark, elements.modelChipName, `mark-${model}`, MODEL_LABELS[model]);
};

// 팝오버가 열리고 닫히면 그 팝오버를 여는 알약에 상태를 알린다.
const bindPopoverChips = () => {
    for (const popover of document.querySelectorAll("[popover]")) {
        const chip = document.querySelector(`[popovertarget="${popover.id}"]`);

        popover.addEventListener("toggle", (event) => chip.setAttribute("aria-expanded", String(event.newState === "open")));
    }
};

/* 모델·Effort */

// 이름은 단계가 오른 쪽(아래에서)·내린 쪽(위에서)으로 들어온다.
const renderEffort = () => {
    const level = Number(elements.effort.value);
    const previousLevel = Number(elements.effortControl.dataset.level);

    const label = formatEffort(EFFORT_LEVELS[level]);

    elements.effortControl.dataset.level = level;
    elements.effortControl.style.setProperty("--level", level);
    elements.effortPopover.dataset.level = level;

    for (const option of elements.effortOptions) {
        option.setAttribute("aria-pressed", String(Number(option.dataset.level) === level));
    }

    if (elements.effortName.textContent !== label) {
        elements.effortName.textContent = label;
        replayAnimation(elements.effortName, level > previousLevel ? "tick-up" : "tick-down");
    }

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
    renderModelChip();
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
    elements.modelChip.disabled = state.status === "stopping";
    elements.effort.disabled = state.status === "stopping";
    elements.effortControl.disabled = state.status === "stopping";

    if (state.status === "stopping") {
        elements.modelPopover.hidePopover();
        elements.effortPopover.hidePopover();
    }

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

// 실행 중이면 고른 값을 엔진에 바로 전달한다(다음 회차부터 적용).
const handleEffortOptionClick = (event) => {
    const option = event.target.closest("[data-level]");

    if (!option || elements.effort.disabled) {
        return;
    }

    elements.effort.value = option.dataset.level;
    renderEffort();
    handleOptionChange({ target: elements.effort });
    closePopoverSoon(elements.effortPopover);
};

const handleOptionChange = (event) => {
    if (event.target.name === "model") {
        renderModelChip();
        closePopoverSoon(elements.modelPopover);
    }

    if (currentState.status === "running") {
        applyRoundOptions();
    } else {
        renderOptions(currentState);
    }
};

/* 종료 시각: 비우면 엔진 기본값(07:00)이고, 지난 시각이면 다음 날이다 */

const setText = (element, text) => {
    if (element.textContent !== text) {
        element.textContent = text;
    }
};

const renderEndTime = () => {
    const value = elements.endTime.value;
    const [hour, minute] = (value || DEFAULT_END_TIME).split(":");
    const until = formatTimeUntil(value, Date.now());

    setText(elements.endTimeValue, value || DEFAULT_END_TIME);
    setText(elements.endTimeUntil, until);
    setText(elements.timeHour, hour);
    setText(elements.timeMinute, minute);
    setText(elements.timeUntil, `지금부터 ${until}에 끝나요`);
};

// 바뀐 자리의 숫자만 바뀐 방향에서 미끄러져 들어오게 한다.
const setEndTime = (value, direction) => {
    const [beforeHour, beforeMinute] = (elements.endTime.value || DEFAULT_END_TIME).split(":");
    const [hour, minute] = (value || DEFAULT_END_TIME).split(":");

    elements.endTime.value = value;
    renderEndTime();

    if (hour !== beforeHour) {
        replayAnimation(elements.timeHour, `tick-${direction}`);
    }

    if (minute !== beforeMinute) {
        replayAnimation(elements.timeMinute, `tick-${direction}`);
    }
};

const stepEndTime = (spin, step) => {
    setEndTime(shiftEndTime(elements.endTime.value, step * Number(spin.dataset.unit)), step > 0 ? "up" : "down");
};

const handleTimePresetClick = (event) => {
    const preset = event.target.closest("[data-after], [data-reset]");

    if (preset) {
        setEndTime(preset.hasAttribute("data-reset") ? "" : getEndTimeAfter(Date.now(), Number(preset.dataset.after)), "up");
    }
};

const bindEndTimePicker = () => {
    for (const spin of elements.timePopover.querySelectorAll(".time-spin")) {
        for (const button of spin.querySelectorAll(".spin-button")) {
            button.addEventListener("click", () => stepEndTime(spin, Number(button.dataset.step)));
        }

        spin.addEventListener(
            "wheel",
            (event) => {
                event.preventDefault();
                stepEndTime(spin, event.deltaY < 0 ? 1 : -1);
            },
            { passive: false }
        );
    }

    elements.timePopover.addEventListener("click", handleTimePresetClick);
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
    elements.endTimeButton.disabled = !isIdle;
    elements.extendOnLimit.disabled = !isIdle;

    if (!isIdle) {
        elements.timePopover.hidePopover();
    }
    elements.tasks.disabled = !isIdle;
    setRadiosDisabled("policy", !isIdle);
    elements.policyChip.disabled = !isIdle;

    if (!isIdle) {
        elements.policyPopover.hidePopover();
    }
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
        await startRun();
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

    window.appWindow.isDev().then((isDev) => {
        elements.devGroup.hidden = !isDev;
    });
    elements.toggleDevtools.addEventListener("click", () => window.appWindow.toggleDevTools());
};

const bindLayoutWatchers = () => {
    const observer = new ResizeObserver(updateVeil);

    observer.observe(elements.hero);
    window.addEventListener("resize", updateVeil);
    elements.content.addEventListener("scroll", updateVeil, { passive: true });
    updateVeil();
};

const initialize = async () => {
    revealWhenReady();
    bindWindowControls();

    const snapshot = await window.autopilot.getState();

    settings = snapshot.settings;
    appVersion = snapshot.version;

    elements.endTime.value = settings.endTime;
    renderEndTime();
    elements.tasks.value = settings.tasks;
    elements.form.elements.policy.value = settings.policy;
    renderPolicy();
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
    elements.bannerLogin.addEventListener("click", handleLogin);
    elements.resetProgress.addEventListener("click", handleResetProgress);
    elements.openReport.addEventListener("click", handleOpenReport);
    elements.historyToggle.addEventListener("click", toggleHistory);
    elements.scrim.addEventListener("click", () => {
        closePanels();
        setHistoryOpen(false);
    });
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
    elements.historyClose.addEventListener("click", () => setHistoryOpen(false));
    elements.livePanel.addEventListener("click", toggleHistory);
    elements.livePanel.addEventListener("keydown", handleLivePanelKey);
    elements.clearLog.addEventListener("click", clearLog);
    elements.log.addEventListener("scroll", handleFollowByScroll);
    elements.effortPopover.addEventListener("click", handleEffortOptionClick);
    document.addEventListener("pointerdown", handleOutsidePointer);
    document.addEventListener("keydown", handleEscape);

    bindPopoverChips();
    elements.policyPopover.addEventListener("click", handlePolicyOptionClick);

    for (const radio of elements.form.elements.policy) {
        radio.addEventListener("change", renderPolicy);
    }

    for (const radio of elements.form.elements.model) {
        radio.addEventListener("change", handleOptionChange);
    }

    bindEndTimePicker();
    setInterval(() => {
        renderClock();
        renderEndTime();
    }, CLOCK_INTERVAL_MS);
};

initialize();

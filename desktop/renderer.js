const MAX_LOG_LINES = 3000;
const CLOCK_INTERVAL_MS = 1000;
const STORY_PAST_LINES = 9;
const PAST_SLIDE_MS = 520;
const PAST_SLIDE_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";
const FINISH_GAIN_LIMIT = 3;
const FINISH_ROUND_LIMIT = 6;
const NOW_MID_LENGTH = 45;
const NOW_LONG_LENGTH = 80;
// 지금 문장을 쓸어 드러내는 마스크의 부드러운 끝 폭(px)과 속도(px/ms)
const REVEAL_FEATHER_PX = 96;
const REVEAL_SPEED = 0.36;
const FOLLOW_THRESHOLD_PX = 24;
const LOG_FLUSH_MS = 50;
const EMPTY_CLOCK = "--:--:--";
const SKELETON_ITEM_COUNT = 3;
const PANEL_NAMES = ["settings", "profile"];

const STATUS_OK = "OK";

const OPTIONS_LOCKED_TITLE = "종료 요청 후에는 모델·Effort를 바꿀 수 없어요";
const STOP_CONFIRM_MS = 4000;
const STOP_ARMED_LABEL = "한 번 더 눌러 종료";

// 상태별 가운데 버튼. 종료 요청 후에 누르면 메인 프로세스가 확인 모달을 띄우고 강제 종료한다.
const MAIN_ACTIONS = {
    idle: { action: "start", label: "시작", title: "" },
    running: { action: "stop", label: "종료 신호", title: "현재 회차를 마친 뒤 종료해요" },
    stopping: { action: "kill", label: "종료", title: "즉시 중단해요. commit 전 변경은 working tree에 남아요" }
};

const byId = (id) => document.getElementById(id);

const elements = {
    titlebar: byId("titlebar"),
    updateChip: byId("update-chip"),
    updateLabel: byId("update-label"),
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
    claudeDirAuto: byId("claude-dir-auto"),
    claudeDirMissing: byId("claude-dir-missing"),
    selectClaudeDir: byId("select-claude-dir"),
    resetClaudeDir: byId("reset-claude-dir"),
    accountFormCancel: byId("account-form-cancel"),
    loginBox: byId("login-box"),
    loginMessage: byId("login-message"),
    loginOpen: byId("login-open"),
    loginCodeForm: byId("login-code-form"),
    loginCode: byId("login-code"),
    loginCancel: byId("login-cancel"),
    backToReady: byId("back-to-ready"),
    windowMinimize: byId("window-minimize"),
    windowMaximize: byId("window-maximize"),
    windowClose: byId("window-close"),
    badge: byId("status-badge"),
    clock: byId("clock"),
    clockLabel: byId("clock-label"),
    clockValue: byId("clock-value"),
    statPhase: byId("stat-phase"),
    track: byId("track"),
    trackStart: byId("track-start"),
    trackBar: byId("track-bar"),
    trackEnd: byId("track-end"),
    greetTitle: byId("greet-title"),
    greetLead: byId("greet-lead"),
    storyPast: byId("story-past"),
    outcome: byId("outcome"),
    outcomeRound: byId("outcome-round"),
    outcomeLabel: byId("outcome-label"),
    outcomeHero: byId("outcome-hero"),
    outcomeBefore: byId("outcome-before"),
    outcomeBeforeUnit: byId("outcome-before-unit"),
    outcomeAfter: byId("outcome-after"),
    outcomeAfterUnit: byId("outcome-after-unit"),
    nowLine: document.querySelector(".now"),
    nowText: byId("now-text"),
    nowTime: byId("now-time"),
    workTools: byId("work-tools"),
    workRead: byId("work-read"),
    workEdited: byId("work-edited"),
    workInsertions: byId("work-insertions"),
    workDeletions: byId("work-deletions"),
    workCommits: byId("work-commits"),
    finishTitle: byId("finish-title"),
    finishLead: byId("finish-lead"),
    finishGains: byId("finish-gains"),
    finishRounds: byId("finish-rounds"),
    doneReport: byId("done-report"),
    doneHistory: byId("done-history"),
    recent: byId("recent"),
    recentList: byId("recent-list"),
    archive: byId("archive"),
    archiveAll: byId("archive-all"),
    archiveToggle: byId("archive-toggle"),
    archiveBack: byId("archive-back"),
    archiveClose: byId("archive-close"),
    archiveTitle: byId("archive-title"),
    archiveCount: byId("archive-count"),
    archiveNote: byId("archive-note"),
    archiveListPane: byId("archive-list-pane"),
    archiveList: byId("archive-list"),
    archiveDetailPane: byId("archive-detail-pane"),
    archiveLead: byId("archive-lead"),
    archiveGains: byId("archive-gains"),
    archiveNotes: byId("archive-notes"),
    archiveReport: byId("archive-report"),
    archiveLog: byId("archive-log"),
    archiveDelete: byId("archive-delete"),
    archiveChat: byId("archive-chat"),
    notice: byId("notice"),
    projectBanner: byId("project-banner"),
    bannerSelectProject: byId("banner-select-project"),
    loginBanner: byId("login-banner"),
    loginBannerMessage: byId("login-banner-message"),
    bannerLogin: byId("banner-login"),
    form: byId("run-form"),
    mainAction: byId("main-action"),
    mainActionLabel: byId("main-action-label"),
    effortControl: byId("effort-control"),
    effortWaves: document.querySelectorAll("#effort-control .wave path, #effort-popover .wave path"),
    effort: byId("effort"),
    effortName: byId("effort-name"),
    effortPopover: byId("effort-popover"),
    effortOptions: byId("effort-popover").querySelectorAll("[data-level]"),
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
    modelVersions: byId("model-versions"),
    modelVersionsNote: byId("model-versions-note"),
    tasks: byId("tasks"),
    tasksToggle: byId("tasks-toggle"),
    tasksCount: byId("tasks-count"),
    tasksFirst: byId("tasks-first"),
    applyNote: byId("apply-note"),
    livePanel: byId("live-panel"),
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
let stopArmTimer = 0;
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

const story = createStory();
let renderedNowKey = "";
let revealToken = 0;
let revealDone = Promise.resolve();
let revealResolve = () => {};
let isStoryBusy = false;
let isStoryDirty = false;
let renderedTrackKey = "";
let renderedFinishKey = "";
// 실행을 마친 뒤 다른 프로젝트를 고르면 지난 실행 대신 시작 화면을 보여준다. 새 실행이 시작되면 다시 마친 화면을 쓴다.
let isFinishDismissed = false;

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

/* 이야기: Claude의 문장과 도구 호출을 큰 문장 하나와 흐려지는 지난 문장으로 보여준다 */

// 지금 문장을 줄 순서대로 부드러운 마스크로 쓸어 드러낸다. 글자 위치는 그대로라 움직임 줄이기 설정에서도 쓴다.
const revealNowText = () => {
    const token = ++revealToken;

    revealDone = new Promise((resolve) => {
        revealResolve();
        revealResolve = resolve;
    });

    const line = elements.nowLine;
    const box = line.getBoundingClientRect();
    const lineHeight = parseFloat(getComputedStyle(line).lineHeight);
    const range = document.createRange();
    const widths = [];

    range.selectNodeContents(line);

    for (const rect of range.getClientRects()) {
        if (rect.width > 0) {
            const index = Math.floor((rect.top + rect.height / 2 - box.top) / lineHeight);

            widths[index] = Math.max(widths[index] || 0, rect.right - box.left);
        }
    }

    const lines = Array.from(widths, (width, index) => ({ top: index * lineHeight, width: (width || 0) + REVEAL_FEATHER_PX }));
    const total = lines.reduce((sum, item) => sum + item.width, 0);
    let startedAt = 0;

    const paint = (now) => {
        if (token !== revealToken) {
            return;
        }

        startedAt = startedAt || now;

        let travelled = (now - startedAt) * REVEAL_SPEED;
        const layers = lines.map((item) => {
            const edge = Math.min(travelled, item.width);

            travelled -= edge;

            return `linear-gradient(90deg, #000 ${edge - REVEAL_FEATHER_PX}px, rgb(0 0 0 / 0.35) ${edge - REVEAL_FEATHER_PX / 2}px, transparent ${edge}px) 0 ${item.top}px / 100% ${lineHeight}px no-repeat`;
        });

        if ((now - startedAt) * REVEAL_SPEED >= total) {
            line.style.removeProperty("mask");
            revealResolve();

            return;
        }

        line.style.setProperty("mask", layers.join(", "));
        requestAnimationFrame(paint);
    };

    requestAnimationFrame(paint);
};

// 드러내는 중에 문장이 이어지면(여러 줄 메시지) 마스크가 새 줄을 가리므로 바로 다 보여준다.
const stopReveal = () => {
    revealToken++;
    elements.nowLine.style.removeProperty("mask");
    revealResolve();
};

const createToolChip = (tool) => {
    const chip = document.createElement("span");
    const name = document.createElement("b");

    chip.className = "tool";
    name.textContent = tool.name;
    chip.append(name, tool.detail);

    return chip;
};

const getPastKey = (item) => {
    return `${item.id}:${item.tools.length}:${item.text}`;
};

// 도구 칩은 문장 위에 한 줄로 모으고, 문장은 그 아래에 둔다.
const createPastItem = (item) => {
    const paragraph = document.createElement("p");
    const said = document.createElement("span");

    said.className = "said";
    said.textContent = item.text;
    paragraph.dataset.key = getPastKey(item);
    paragraph.className = "appear";
    paragraph.addEventListener("animationend", () => paragraph.classList.remove("appear"), { once: true });

    if (item.tools.length) {
        const tools = document.createElement("span");

        tools.className = "tools";
        tools.append(...item.tools.map(createToolChip));
        paragraph.append(tools);
    }

    paragraph.append(said);

    return paragraph;
};

// 이미 있는 줄은 DOM을 그대로 두어 위치만 바뀌게 하고(slidePast), 새로 지난 문장만 만들어 한 번 맺히게 한다.
const renderPast = (items) => {
    const known = new Map([...elements.storyPast.children].map((node) => [node.dataset.key, node]));
    const wanted = new Set(items.map(getPastKey));

    known.forEach((node, key) => {
        if (!wanted.has(key)) {
            node.remove();
        }
    });

    elements.storyPast.append(...items.filter((item) => !known.has(getPastKey(item))).map(createPastItem));
};

const getPastTops = () => {
    return new Map([...elements.storyPast.children].map((node) => [node, node.getBoundingClientRect().top]));
};

// 문장이 늘거나 지금 문장의 높이가 바뀌어 줄 위치가 달라지면 이전 위치에서 부드럽게 올라가게 한다(FLIP).
const slidePast = (tops) => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
        return;
    }

    tops.forEach((top, node) => {
        const distance = top - node.getBoundingClientRect().top;

        if (node.isConnected && Math.abs(distance) > 1) {
            node.animate({ translate: [`0 ${distance}px`, "0 0"] }, { duration: PAST_SLIDE_MS, easing: PAST_SLIDE_EASING });
        }
    });
};

const getNowLength = (text) => {
    if (text.length > NOW_LONG_LENGTH) {
        return "long";
    }

    return text.length > NOW_MID_LENGTH ? "mid" : "";
};

// 기다리는 동안에는 기다리는 이유를 지금 문장으로 쓰고, 마지막 문장은 지난 문장으로 내린다.
const renderStory = () => {
    const waitSentence = currentState ? getWaitSentence(currentState) : "";
    const lastItem = story.items.at(-1);
    const nowItem = waitSentence ? null : lastItem;
    const pastItems = (nowItem ? story.items.slice(0, -1) : story.items).slice(-STORY_PAST_LINES);
    const text = waitSentence || nowItem?.text || "곧 첫 문장을 들려드릴게요.";
    const key = waitSentence ? `wait:${waitSentence}` : `item:${nowItem?.id || 0}`;

    const tops = getPastTops();

    renderPast(pastItems);
    swapText(elements.nowTime, nowItem?.time || "");
    elements.nowLine.dataset.length = getNowLength(text);

    if (key !== renderedNowKey) {
        renderedNowKey = key;
        elements.nowText.textContent = text;
        revealNowText();
    } else if (elements.nowText.textContent !== text) {
        stopReveal();
        elements.nowText.textContent = text;
        replayAnimation(elements.nowLine, "swap");
    }

    slidePast(tops);
};

// 새 문장·이동·드러내기 애니메이션이 끝나기 전에 로그가 오면 가장 최근 상태만 모아 두었다가 끝난 뒤 한 번 그린다(애니메이션이 끊기지 않게).
const scheduleStory = async () => {
    if (isStoryBusy) {
        isStoryDirty = true;

        return;
    }

    isStoryBusy = true;
    renderStory();

    const animations = elements.nowLine
        .closest("section")
        .getAnimations({ subtree: true })
        .filter((animation) => animation.effect.getComputedTiming().endTime !== Infinity);

    await Promise.allSettled([revealDone, ...animations.map((animation) => animation.finished)]);

    isStoryBusy = false;

    if (isStoryDirty) {
        isStoryDirty = false;
        scheduleStory();
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

    for (const entry of entries) {
        applyStoryEntry(story, entry);
    }

    scheduleStory();
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

/* 사용량 */

const SESSION_LIMIT_PREFIX = "5시간";

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
    item.toggleAttribute("data-session", limit.label.startsWith(SESSION_LIMIT_PREFIX));
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
    renderAccountBar();
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

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

const createIcon = (className, symbolId) => {
    const icon = document.createElementNS(SVG_NAMESPACE, "svg");
    const use = document.createElementNS(SVG_NAMESPACE, "use");

    icon.setAttribute("class", className);
    icon.setAttribute("aria-hidden", "true");
    use.setAttribute("href", `#${symbolId}`);
    icon.append(use);

    return icon;
};

// 계정은 이름 첫 글자를 단 줄로 고른다(라디오 묶음).
const createAccountOption = (account) => {
    const option = document.createElement("button");
    const initial = document.createElement("span");
    const label = document.createElement("span");

    option.type = "button";
    option.className = "account-option";
    option.dataset.id = account.id;
    option.setAttribute("role", "radio");
    initial.className = "initial";
    initial.textContent = getAvatarLetter({ name: account.label, email: "" });
    label.textContent = account.label;
    option.append(initial, label, createIcon("icon tick", "icon-check"));

    return option;
};

const DEFAULT_ACCOUNT_ID = "default";
// 로그인 정보가 없거나 만료돼 사용량을 읽지 못할 때만 다시 로그인이 필요하다.
const RELOGIN_ERROR_CODES = ["NO_CREDENTIALS", "TOKEN_EXPIRED"];

// 실행 중이거나 로그인 중에는 계정을 바꾸거나 추가·제거할 수 없다(메인 프로세스도 막는다).
const renderAccountBar = () => {
    const { accounts, activeId } = accountsState;
    const isIdle = !currentState || currentState.status === "idle";
    const isLocked = !isIdle || loginState?.phase === "waiting";
    const accountsKey = accounts.map((account) => `${account.id}:${account.label}`).join("|");

    if (accountsKey !== renderedAccountsKey) {
        elements.accountSelect.replaceChildren(...accounts.map(createAccountOption));
        renderedAccountsKey = accountsKey;
    }

    for (const option of elements.accountSelect.children) {
        option.setAttribute("aria-checked", String(option.dataset.id === activeId));
        option.disabled = isLocked;
        option.title = isIdle ? "" : "실행 중에는 계정을 바꿀 수 없어요.";
    }

    elements.accountAdd.disabled = isLocked || accounts.length >= MAX_ACCOUNT_COUNT;
    elements.accountLogin.hidden = !RELOGIN_ERROR_CODES.includes(accountSnapshots[activeId]?.error?.code);
    elements.accountLogin.disabled = isLocked;
    elements.accountRemove.hidden = activeId === DEFAULT_ACCOUNT_ID;
    elements.accountRemove.disabled = isLocked;
    elements.selectClaudeDir.disabled = isLocked;
    elements.resetClaudeDir.disabled = isLocked || !claudeDirInfo || claudeDirInfo.isAuto;
};

const renderClaudeDir = () => {
    elements.claudeDirPath.textContent = claudeDirInfo?.path ?? "";
    elements.claudeDirAuto.hidden = !claudeDirInfo?.isAuto;
    elements.claudeDirMissing.hidden = !claudeDirInfo || claudeDirInfo.exists;
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

    elements.loginBox.dataset.phase = loginState.phase;
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

const handleAccountSelect = async (event) => {
    const option = event.target.closest("[data-id]");

    if (!option || option.disabled || option.dataset.id === accountsState.activeId) {
        return;
    }

    const result = await window.autopilot.selectAccount(option.dataset.id);

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

    if (name === "settings" && isOpen) {
        loadModels();
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
        setArchiveOpen(false);
        scrollLogToEnd();
    }
};

const toggleHistory = () => {
    setHistoryOpen(!isHistoryOpen());
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
    } else if (isArchiveOpen()) {
        setArchiveOpen(false);
        elements.archiveAll.focus();
    }
};

/* 지난 실행: 로그 파일로 남은 지난 실행을 시작 화면에서 몇 개 보여주고, 전체 목록과 채팅처럼 이어지는 그날의 작업을 시트로 본다 */

const RECENT_RUN_COUNT = 3;
const MAX_ARCHIVE_RUNS = 200;
const CHAT_TOOL_CHIP_LIMIT = 4;

let recentRuns = [];
let recentToken = 0;
let archiveToken = 0;
let archiveRunId = "";
let lastStatus = "idle";

const isArchiveOpen = () => {
    return document.body.classList.contains("archive-open");
};

const createTag = (status) => {
    const tag = document.createElement("span");

    tag.className = "tag";
    tag.dataset.tone = status.tone;
    tag.textContent = status.label;

    return tag;
};

const createRunItem = (run, nowMs) => {
    const description = describePastRun(run, nowMs);
    const item = document.createElement("li");
    const button = document.createElement("button");
    const when = document.createElement("span");
    const day = document.createElement("b");
    const time = document.createElement("span");
    const meta = document.createElement("small");
    const headline = document.createElement("span");

    button.type = "button";
    button.className = "run-item";
    button.dataset.id = run.id;
    when.className = "run-when";
    day.textContent = description.day;
    time.className = "num";
    time.textContent = [description.time, description.duration].filter(Boolean).join(" · ");
    meta.className = "run-meta";
    meta.textContent = description.meta || description.notes[0] || "";
    headline.className = "run-headline";
    headline.textContent = description.headline;

    when.append(day, time);
    button.append(when, createTag(description.status), meta, headline);
    item.append(button);

    return item;
};

const renderRunList = (list, runs) => {
    const nowMs = Date.now();

    list.replaceChildren(...runs.map((run) => createRunItem(run, nowMs)));
};

const renderRecent = () => {
    const runs = recentRuns.slice(0, RECENT_RUN_COUNT);

    elements.recent.hidden = !settings.projectDir || !runs.length;

    renderRunList(elements.recentList, runs);
};

// 목록을 읽지 못해도 시작 화면은 그대로 쓸 수 있어야 하므로 실패하면 조용히 숨긴다.
const loadRecentRuns = async () => {
    const token = ++recentToken;
    const result = await window.autopilot.listRuns(RECENT_RUN_COUNT);

    if (token !== recentToken) {
        return;
    }

    recentRuns = result.status === STATUS_OK ? result.data.runs : [];

    renderRecent();
};

const setArchiveNote = (message, tone = "") => {
    elements.archiveNote.textContent = message;
    elements.archiveNote.dataset.tone = tone;
    elements.archiveNote.hidden = !message;
};

const showArchivePane = (pane) => {
    const isDetail = pane === "detail";

    elements.archiveListPane.hidden = isDetail;
    elements.archiveDetailPane.hidden = !isDetail;
    elements.archiveBack.hidden = !isDetail;
};

const setArchiveOpen = (isOpen) => {
    if (isOpen === isArchiveOpen()) {
        return;
    }

    document.body.classList.toggle("archive-open", isOpen);
    elements.archive.inert = !isOpen;
    elements.archiveAll.setAttribute("aria-expanded", String(isOpen));
    elements.archiveToggle.setAttribute("aria-expanded", String(isOpen));

    if (isOpen) {
        closePanels();
        setHistoryOpen(false);
    }
};

const openArchiveList = async () => {
    const token = ++archiveToken;

    setArchiveOpen(true);
    showArchivePane("list");
    setArchiveNote("불러오는 중이에요.");

    elements.archiveTitle.textContent = "지난 실행";
    elements.archiveCount.textContent = "";

    const result = await window.autopilot.listRuns(MAX_ARCHIVE_RUNS);

    if (token !== archiveToken) {
        return;
    }

    const runs = result.status === STATUS_OK ? result.data.runs : [];

    renderRunList(elements.archiveList, runs);

    elements.archiveCount.textContent = runs.length ? `${runs.length}개` : "";

    if (result.status !== STATUS_OK) {
        setArchiveNote(result.error.msg, "warn");
    } else {
        setArchiveNote(runs.length ? "" : "아직 지난 실행이 없어요. 실행하면 기록이 프로젝트의 .autopilot/progress 폴더에 남아요.");
    }
};

const createChatChips = (item) => {
    const chips = item.tools.slice(-CHAT_TOOL_CHIP_LIMIT).map(createToolChip);

    if (item.count > chips.length) {
        const more = document.createElement("small");

        more.className = "chat-more";
        more.textContent = `외 ${item.count - chips.length}번`;
        chips.push(more);
    }

    return chips;
};

const createChatLine = (className, ...children) => {
    const node = document.createElement("li");

    node.className = `chat-item ${className}`;
    node.append(...children);

    return node;
};

const createChatText = (tagName, className, text) => {
    const node = document.createElement(tagName);

    node.className = className;
    node.textContent = text;

    return node;
};

const createChatItem = (item) => {
    if (item.kind === "say") {
        const bubble = document.createElement("div");

        bubble.className = "bubble";
        bubble.append(...createChatChips(item), createChatText("span", "said", item.text), createChatText("time", "num", item.time));

        return createChatLine("say", bubble);
    }

    if (item.kind === "work") {
        return createChatLine("work", ...createChatChips(item));
    }

    if (item.kind === "round") {
        return createChatLine("round", createChatText("b", "", `${item.round}회차 시작`), createChatText("small", "", item.options));
    }

    if (item.kind === "result") {
        return createChatLine("result", createChatText("b", "", `${item.round}회차`), createTag({ label: item.outcome, tone: item.tone }));
    }

    if (item.kind === "commit") {
        return createChatLine(
            "commit",
            createChatText("code", "", item.hash),
            createChatText("span", "subject", item.subject || "제목 없음"),
            createChatText("ins", "", `+${item.insertions}`),
            createChatText("del", "", `−${item.deletions}`)
        );
    }

    if (item.kind === "gain") {
        return createChatLine("gain", createChatText("b", "", "성과"), createChatText("span", "", item.text));
    }

    return createChatLine("note", createChatText("span", "", item.kind === "finish" ? `종료 · ${item.text}` : item.text));
};

const renderArchiveDetail = ({ run, lines, omittedLines }) => {
    const description = describePastRun(run, Date.now());
    const transcript = buildTranscript(lines);
    const notes = [...description.notes];

    if (omittedLines || transcript.omitted) {
        notes.push("기록이 길어 최근 대화만 보여줘요. 전체는 원본 로그에서 볼 수 있어요.");
    }

    archiveRunId = run.id;

    elements.archiveTitle.textContent = `${description.day} ${description.time}`.trim();
    elements.archiveCount.textContent = [description.duration, description.status.label].filter(Boolean).join(" · ");
    elements.archiveLead.textContent = description.lead || description.meta;
    elements.archiveGains.hidden = !run.gains?.length;
    elements.archiveGains.replaceChildren(...(run.gains || []).slice().reverse().map(createGainItem));
    elements.archiveNotes.textContent = notes.join(" ");
    elements.archiveNotes.hidden = !notes.length;
    elements.archiveReport.disabled = !run.hasReport;
    elements.archiveLog.disabled = Boolean(run.isUnreadable);
    elements.archiveDelete.disabled = Boolean(run.isActive);
    elements.archiveChat.replaceChildren(...(transcript.items.length ? transcript.items.map(createChatItem) : [createChatLine("note", createChatText("span", "", "대화로 보여 줄 내용이 없어요."))]));
    elements.archiveChat.scrollTop = 0;
};

const openArchiveDetail = async (id) => {
    const token = ++archiveToken;

    setArchiveOpen(true);
    showArchivePane("detail");
    setArchiveNote("불러오는 중이에요.");

    elements.archiveChat.replaceChildren();

    const result = await window.autopilot.readRun(id);

    if (token !== archiveToken) {
        return;
    }

    if (result.status !== STATUS_OK) {
        showArchivePane("list");
        setArchiveNote(result.error.msg, "warn");

        return;
    }

    setArchiveNote("");
    renderArchiveDetail(result.data);
};

const handleRunItemClick = (event) => {
    const item = event.target.closest("[data-id]");

    if (item) {
        openArchiveDetail(item.dataset.id);
    }
};

const handleArchiveFile = async (kind) => {
    const result = await window.autopilot.openRunFile(archiveRunId, kind);

    if (result.status !== STATUS_OK) {
        setArchiveNote(result.error.msg, "warn");
    }
};

// 지운 뒤에는 목록으로 돌아가 지워졌음을 알리고, 시작 화면의 최근 목록도 다시 읽는다.
const handleArchiveDelete = async () => {
    const result = await window.autopilot.deleteRun(archiveRunId);

    if (result.status !== STATUS_OK) {
        setArchiveNote(result.error.msg, "warn");

        return;
    }

    if (!result.data.cancelled) {
        await openArchiveList();
        loadRecentRuns();
        setArchiveNote("기록을 지웠어요.");
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

const renderStatusPhase = () => {
    const phaseText = getPhaseText(currentState);

    elements.statPhase.hidden = !phaseText;
    setText(elements.statPhase, phaseText);
};

const renderView = (state) => {
    if (state.status !== "idle") {
        isFinishDismissed = false;
    }

    const view = getView(state, isFinishDismissed);

    document.body.dataset.view = view;

    if (view !== "run") {
        setTasksOpen(false);
    }
};

// 실행 중에는 작업 칸이 접혀 있고, 눌러서 읽어 볼 수 있다. 실행이 끝나면 다음 실행을 위해 접힌 상태로 되돌린다.
const setTasksOpen = (isOpen) => {
    document.body.toggleAttribute("data-tasks-open", isOpen);
    elements.tasksToggle.setAttribute("aria-expanded", String(isOpen));
};

const renderGreeting = () => {
    const projectName = settings.projectDir ? settings.projectDir.split(/[\\/]/).filter(Boolean).pop() : "";
    const greeting = getGreeting({ hour: new Date().getHours(), policy: elements.form.elements.policy.value, endTime: elements.endTime.value, projectName: projectName });

    const [before, after] = projectName ? greeting.title.split(projectName) : [greeting.title, ""];
    const name = document.createElement("span");

    name.className = "project-name";
    name.textContent = projectName;
    elements.greetTitle.replaceChildren(before, ...(projectName ? [name, after] : []));
    setText(elements.greetLead, greeting.lead);
};

// 앱처럼 보이도록 브라우저 기본 동작(오른쪽 메뉴, 파일 끌어 놓기 이동)을 막는다. 입력 칸은 붙여넣기 때문에 메뉴를 남긴다.
const bindNativeFeel = () => {
    document.addEventListener("contextmenu", (event) => {
        if (!event.target.closest("input, textarea, .log")) {
            event.preventDefault();
        }
    });
    document.addEventListener("dragover", (event) => event.preventDefault());
    document.addEventListener("drop", (event) => event.preventDefault());
};

// 실행 중에는 작업 칸 대신 잠긴 작업 요약 한 줄을 보여준다.
const renderTasksSummary = () => {
    const tasks = elements.tasks.value
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

    elements.tasksCount.textContent = tasks.length ? `작업 ${tasks.length}개` : "작업 없이";
    elements.tasksFirst.textContent = tasks.length ? tasks.join(", ") : "스스로 개선점을 찾고 있어요";
};

const createTrackNode = (tag, className, properties, text = "") => {
    const node = document.createElement(tag);

    node.className = className;
    node.textContent = text;

    for (const [name, value] of Object.entries(properties)) {
        node.style.setProperty(`--${name}`, String(value));
    }

    return node;
};

// 지금 위치는 매초 조금씩 움직이므로, 0.1% 넘게 바뀔 때만 다시 그린다.
const renderTrack = () => {
    const track = getTrack(currentState, Date.now());

    elements.track.hidden = !track || document.body.dataset.view === "ready";

    if (elements.track.hidden) {
        return;
    }

    const key = JSON.stringify(track, (name, value) => (typeof value === "number" ? Math.round(value * 10) : value));

    if (key === renderedTrackKey) {
        return;
    }

    renderedTrackKey = key;
    elements.trackStart.textContent = track.startText;
    elements.trackEnd.textContent = track.endText;
    elements.trackBar.setAttribute("aria-label", `${track.startText}부터 ${track.endText}까지, 회차 ${track.segments.length}개`);
    elements.trackBar.replaceChildren(
        ...track.segments.map((segment) => createTrackNode("i", segment.isLive ? "seg live" : "seg", { from: segment.from, to: segment.to })),
        ...track.commits.map((commit) => Object.assign(createTrackNode("i", "commit", { at: commit.at }), { title: `커밋 ${commit.count}개` })),
        ...(track.head === null ? [] : [createTrackNode("i", "head", { at: track.head })])
    );
};

const renderWork = (state) => {
    const summary = getWorkSummary(state);

    swapText(elements.workTools, String(summary.toolCalls));
    swapText(elements.workRead, String(summary.filesRead));
    swapText(elements.workEdited, String(summary.filesEdited));
    swapText(elements.workInsertions, `+${summary.insertions}`);
    swapText(elements.workDeletions, `−${summary.deletions}`);
    setText(elements.workCommits, `남긴 커밋 ${summary.commits}개`);
};

const HERO_SIZES = ["display", "xl", "lg", "md", "sm"];

// 값이 길면 글자 크기 단계를 내려 한 줄에 맞춘다. 가장 작은 단계에서도 넘치면 CSS가 말줄임한다.
const fitOutcomeHero = () => {
    if (elements.outcomeHero.hidden) {
        return;
    }

    for (const size of HERO_SIZES) {
        elements.outcomeHero.dataset.size = size;

        const values = elements.outcomeHero.querySelectorAll(".was, .is");

        if (Array.from(values).every((value) => value.scrollWidth <= value.clientWidth)) {
            return;
        }
    }
};

// 가장 최근 성과 줄을 크게 보여준다. "이전 → 이후" 형식이 아니면 문장만 보여준다.
const renderOutcome = (state) => {
    const gain = state.gains.at(-1);

    elements.outcome.hidden = !gain;

    if (!gain) {
        return;
    }

    const parsed = parseGain(gain.text);
    const before = splitFigure(parsed.before);
    const after = splitFigure(parsed.after);

    elements.outcome.dataset.earlier = String(gain.round < state.round);
    setText(elements.outcomeRound, `${gain.round}회차`);
    swapText(elements.outcomeLabel, parsed.label);
    elements.outcomeHero.hidden = !parsed.after;
    setText(elements.outcomeBefore, before.number);
    setText(elements.outcomeBeforeUnit, before.unit);
    swapText(elements.outcomeAfter, after.number);
    setText(elements.outcomeAfterUnit, after.unit);
    fitOutcomeHero();
};

new ResizeObserver(fitOutcomeHero).observe(elements.outcomeHero);

const createFigure = (className, value) => {
    const { number, unit } = splitFigure(value);
    const figure = document.createElement("span");
    const unitText = document.createElement("small");

    figure.className = className;
    unitText.textContent = unit;
    figure.append(number, unitText);

    return figure;
};

const createGainItem = (gain) => {
    const item = document.createElement("li");
    const what = document.createElement("span");
    const note = document.createElement("small");
    const parsed = parseGain(gain.text);

    what.className = "what";
    note.textContent = `${gain.round}회차`;
    what.append(parsed.label, note);
    item.append(what);

    if (parsed.after) {
        const figure = document.createElement("span");
        const arrow = document.createElement("span");

        figure.className = "figure num";
        arrow.className = "to";
        arrow.textContent = "→";
        figure.append(createFigure("was", parsed.before), arrow, createFigure("is", parsed.after));
        item.append(figure);
    }

    return item;
};

const createFinishRound = (round) => {
    const item = document.createElement("li");
    const name = document.createElement("b");
    const body = document.createElement("span");
    const lines = document.createElement("span");

    name.textContent = `${round.round}회차`;

    if (round.commits.length) {
        const hashes = document.createElement("code");
        const insertions = document.createElement("ins");
        const deletions = document.createElement("del");

        hashes.textContent = round.commits.map((commit) => commit.hash).join(" ");
        insertions.textContent = `+${round.commits.reduce((sum, commit) => sum + commit.insertions, 0)}`;
        deletions.textContent = `−${round.commits.reduce((sum, commit) => sum + commit.deletions, 0)}`;
        body.append(`커밋 ${round.commits.length}개`, hashes);
        lines.append(insertions, deletions);
    } else {
        body.textContent = round.outcome || "진행 중";
    }

    item.append(name, body, lines);

    return item;
};

const renderFinish = (state) => {
    if (document.body.dataset.view !== "done") {
        return;
    }

    const key = JSON.stringify([state.endedAt, state.reason, state.rounds.length, state.gains.length]);

    if (key === renderedFinishKey) {
        return;
    }

    const finish = describeFinish(state);

    renderedFinishKey = key;
    elements.finishTitle.textContent = finish.title;
    elements.finishLead.textContent = finish.lead;
    elements.finishGains.hidden = !state.gains.length;
    elements.finishGains.replaceChildren(...state.gains.slice(-FINISH_GAIN_LIMIT).reverse().map(createGainItem));
    elements.finishRounds.replaceChildren(...state.rounds.slice(-FINISH_ROUND_LIMIT).map(createFinishRound));
};

const showNotice = (message, tone = "") => {
    elements.notice.textContent = message;
    elements.notice.dataset.tone = tone;
    elements.notice.hidden = !message;
};

const showFailure = (result) => {
    showNotice(result.status === STATUS_OK ? "" : result.error.msg);
};

const renderUpdate = (update) => {
    elements.updateChip.hidden = !update;

    if (update) {
        elements.updateLabel.textContent = `v${update.version}`;
        elements.updateChip.title = `새 버전 v${update.version}이 나왔어요 (현재 v${appVersion}). 누르면 다운로드 페이지가 열려요.`;
        elements.updateChip.setAttribute("aria-label", `새 버전 v${update.version} 다운로드 페이지 열기`);
    }
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

const CHIP_RESIZE_MS = 320;
const CHIP_RESIZE_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

// 글자 길이로 알약 너비가 바뀌면 뒤의 알약이 튀지 않고 함께 미끄러지도록 너비를 이어 준다.
const animateChipWidth = (chip, fromWidth) => {
    const toWidth = chip.getBoundingClientRect().width;

    if (reducedMotion.matches || Math.abs(toWidth - fromWidth) < 1) {
        return;
    }

    chip.animate([{ width: `${fromWidth}px` }, { width: `${toWidth}px` }], { duration: CHIP_RESIZE_MS, easing: CHIP_RESIZE_EASING });
};

// 알약의 글자·아이콘이 실제로 바뀌었는지 돌려준다. 바뀌었으면 너비 전환까지 건다.
const updateChip = (chip, icon, name, iconId, label) => {
    const href = `#${iconId}`;

    if (icon.getAttribute("href") === href && name.textContent === label) {
        return false;
    }

    const previousWidth = chip.getBoundingClientRect().width;

    icon.setAttribute("href", href);
    name.textContent = label;
    animateChipWidth(chip, previousWidth);

    return true;
};

const closePopoverSoon = (popover) => {
    setTimeout(() => popover.hidePopover(), CHOICE_CLOSE_DELAY_MS);
};

// 개선 정책은 설정 패널의 라디오가 값을 갖고, 컴포저의 알약·팝오버는 그 값을 보여주고 바꾼다.
const renderPolicy = () => {
    const policy = elements.form.elements.policy.value;

    elements.policyPopover.dataset.policy = policy;
    if (updateChip(elements.policyChip, elements.policyChipIcon, elements.policyChipName, `icon-policy-${policy}`, POLICY_LABELS[policy])) {
        replayAnimation(elements.policyChipName, "tick-up");
    }

    for (const option of elements.policyOptions) {
        option.setAttribute("aria-pressed", String(option.dataset.policy === policy));
    }

    renderGreeting();
};

const handlePolicyOptionClick = (event) => {
    const option = event.target.closest("[data-policy]");

    if (option) {
        elements.form.elements.policy.value = option.dataset.policy;
        renderPolicy();
        closePopoverSoon(elements.policyPopover);
    }
};

// 모델은 계열 별칭(최신 버전)이거나 설정에서 고정한 모델 ID다. 알약은 계열 마크와 실제로 쓸 모델 이름을 보여준다.
const resolveModel = (model) => {
    return settings.modelVersions?.[model] || model;
};

const renderModelChip = (model = resolveModel(elements.form.elements.model.value)) => {
    const family = elements.form.elements.model.value;

    elements.modelChip.dataset.model = family;

    if (updateChip(elements.modelChip, elements.modelChipMark, elements.modelChipName, `mark-${family}`, formatModelName(model))) {
        replayAnimation(elements.modelChip, "model-swap");
    }
};

// 팝오버가 열리고 닫히면 그 팝오버를 여는 알약에 상태를 알린다.
const bindPopoverChips = () => {
    for (const popover of document.querySelectorAll("[popover]")) {
        const chip = document.querySelector(`[popovertarget="${popover.id}"]`);

        popover.addEventListener("toggle", (event) => chip.setAttribute("aria-expanded", String(event.newState === "open")));
    }
};

/* 모델·Effort */

// 단계가 높을수록 두 마루의 진폭이 커지는 물결. 알약과 목록이 같은 모양을 쓴다.
const getWavePath = (level) => `M-7 8q2-${(1 + level * 1.7).toFixed(1)} 4 0${"t4 0".repeat(8)}`;

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
        const previousWidth = elements.effortControl.getBoundingClientRect().width;

        elements.effortName.textContent = label;
        animateChipWidth(elements.effortControl, previousWidth);
        replayAnimation(elements.effortName, level > previousLevel ? "tick-up" : "tick-down");
        replayAnimation(elements.effortControl, "effort-swap");
    }

    elements.effortWaves.forEach((path) => {
        path.style.setProperty("d", `path("${getWavePath(Number(path.closest("[data-level]").dataset.level))}")`);
    });
};

const getSelectedOptions = () => {
    return { model: elements.form.elements.model.value, effort: EFFORT_LEVELS[Number(elements.effort.value)] };
};

const setSelectedOptions = ({ model, effort }) => {
    elements.form.elements.model.value = getModelFamily(model) || elements.form.elements.model.value;
    elements.effort.value = String(Math.max(0, EFFORT_LEVELS.indexOf(effort)));

    renderEffort();
    renderModelChip(resolveModel(model));
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

    elements.modelChip.title = state.status === "stopping" ? OPTIONS_LOCKED_TITLE : "";
    elements.effortControl.title = elements.modelChip.title;

    if (state.status === "stopping") {
        elements.modelPopover.hidePopover();
        elements.effortPopover.hidePopover();
    }

    if (isPending) {
        showApplyNote(`적용 대기: 다음 회차부터 ${formatOptions(state.requested.model, state.requested.effort)} (지금 ${formatOptions(state.model, state.effort)})`, "warn");

        return;
    }

    showApplyNote("", "");
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

/* 모델 버전: 계열마다 최신(기본)이거나 공식 목록에서 고른 버전으로 고정한다. 목록은 계정으로 공식 API에서 받아와 새 모델이 나오면 따라온다 */

let availableModels = null;

const loadModels = async () => {
    const result = await window.autopilot.getModels();

    availableModels = result.status === STATUS_OK ? result.data.models : [];
    renderModelVersions();
};

const createModelVersionRow = (family) => {
    const row = document.createElement("label");
    const body = document.createElement("span");
    const title = document.createElement("b");
    const select = document.createElement("select");
    const pinned = settings.modelVersions[family] || "";
    const versions = (availableModels ?? []).filter((model) => model.line === family).map((model) => model.id);
    const ids = pinned && !versions.includes(pinned) ? [...versions, pinned] : versions;

    row.className = "row version-row";
    body.className = "row-body";
    title.textContent = MODEL_LABELS[family];
    select.className = "version-select";
    select.dataset.family = family;
    select.setAttribute("aria-label", `${MODEL_LABELS[family]} 버전`);
    select.append(new Option("최신 버전 (기본)", ""), ...ids.map((id) => new Option(`${formatModelName(id)} · ${id}`, id)));
    select.value = pinned;
    select.disabled = Boolean(currentState) && currentState.status !== "idle";
    body.append(title);
    row.append(body, select);

    return row;
};

const renderModelVersions = () => {
    elements.modelVersions.replaceChildren(...Object.keys(MODEL_LABELS).map(createModelVersionRow));
    elements.modelVersionsNote.hidden = Boolean(availableModels?.length);
    elements.modelVersionsNote.textContent = availableModels ? "버전 목록을 불러오지 못했어요. 로그인 상태를 확인해 주세요." : "버전 목록을 불러오는 중이에요.";
};

const handleModelVersionChange = async (event) => {
    const result = await window.autopilot.setModelVersion(event.target.dataset.family, event.target.value);

    showFailure(result);

    if (result.status === STATUS_OK) {
        settings = { ...settings, modelVersions: result.data.modelVersions };
    }

    renderModelVersions();
    renderModelChip();
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
    renderGreeting();
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

// 종료 신호는 실수로 누르기 쉬워 한 번 누르면 잠깐 대기하고, 그 안에 한 번 더 눌러야 보낸다.
const setStopArmed = (isArmed) => {
    clearTimeout(stopArmTimer);
    stopArmTimer = isArmed ? setTimeout(() => setStopArmed(false), STOP_CONFIRM_MS) : 0;
    renderMainAction(currentState, Boolean(settings.projectDir));
};

const renderMainAction = (state, hasProject) => {
    const config = MAIN_ACTIONS[state.status];
    const isArmed = Boolean(stopArmTimer) && config.action === "stop";

    if (!isArmed && stopArmTimer) {
        clearTimeout(stopArmTimer);
        stopArmTimer = 0;
    }

    elements.mainAction.dataset.action = config.action;
    elements.mainAction.toggleAttribute("data-armed", isArmed);
    elements.mainAction.style.setProperty("--arm-ms", `${STOP_CONFIRM_MS}ms`);
    swapText(elements.mainActionLabel, isArmed ? STOP_ARMED_LABEL : config.label);
    elements.mainAction.title = isArmed ? `${STOP_CONFIRM_MS / 1000}초 안에 한 번 더 누르면 현재 회차를 마치고 종료해요` : config.title;
    elements.mainAction.disabled = state.status === "idle" && !hasProject;
};

const renderState = (state) => {
    currentState = state;

    // 실행이 끝나면 방금 끝난 실행이 지난 실행 목록에 들어온다.
    if (lastStatus !== "idle" && state.status === "idle") {
        loadRecentRuns();
    }

    lastStatus = state.status;

    const hasProject = Boolean(settings.projectDir);
    const isIdle = state.status === "idle";
    const phase = hasProject ? getRunPhase(state) : { label: "프로젝트 미선택", tone: "muted" };

    document.body.dataset.status = state.status;
    elements.usageList.toggleAttribute("data-working", state.status === "running");
    renderView(state);
    swapText(elements.badge, getStatusText(state, phase));
    elements.badge.dataset.tone = phase.tone;
    renderStatusPhase();

    renderMainAction(state, hasProject);

    elements.endTime.disabled = !isIdle;
    elements.endTimeButton.disabled = !isIdle;
    elements.extendOnLimit.disabled = !isIdle;

    for (const select of elements.modelVersions.querySelectorAll("select")) {
        select.disabled = !isIdle;
    }

    if (!isIdle) {
        elements.timePopover.hidePopover();
    }
    elements.tasks.readOnly = !isIdle;
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
    renderTrack();
    renderWork(state);
    renderOutcome(state);
    renderFinish(state);
    renderGreeting();
    renderTasksSummary();
    scheduleStory();
};

const handleMainAction = async (event) => {
    event.preventDefault();

    const { action } = MAIN_ACTIONS[currentState.status];

    if (action === "start") {
        await startRun();
    } else if (action === "stop") {
        if (!stopArmTimer) {
            setStopArmed(true);

            return;
        }

        setStopArmed(false);
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
        isFinishDismissed = true;

        renderSettings();
        renderState(currentState);
        loadRecentRuns();
    }
};

const handleResetProgress = async () => {
    const result = await window.autopilot.resetProgress();

    if (result.status !== STATUS_OK) {
        showFailure(result);

        return;
    }

    if (!result.data.cancelled) {
        showNotice(result.data.isReset ? "진행 기록을 초기화했어요. 원본은 .autopilot/progress 폴더에 보관했어요." : "이미 초기 상태예요.", "ok");
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
    elements.backToReady.addEventListener("click", () => {
        isFinishDismissed = true;
        renderState(currentState);
    });
    elements.windowMinimize.addEventListener("click", () => window.appWindow.minimize());
    elements.windowMaximize.addEventListener("click", () => window.appWindow.toggleMaximize());
    elements.windowClose.addEventListener("click", () => window.appWindow.close());

    window.appWindow.onState(renderWindowState);

    window.appWindow.isDev().then((isDev) => {
        elements.devGroup.hidden = !isDev;
    });
    elements.toggleDevtools.addEventListener("click", () => window.appWindow.toggleDevTools());
};

const initialize = async () => {
    revealWhenReady();
    bindWindowControls();
    bindNativeFeel();
    elements.tasksToggle.addEventListener("click", () => setTasksOpen(!document.body.hasAttribute("data-tasks-open")));

    const snapshot = await window.autopilot.getState();

    settings = snapshot.settings;
    appVersion = snapshot.version;

    renderUpdate(snapshot.update);
    window.autopilot.onUpdate(renderUpdate);
    elements.updateChip.addEventListener("click", async () => showFailure(await window.autopilot.openUpdate()));

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
    loadRecentRuns();

    applyAccountsPayload((await window.autopilot.getAccounts()).data);

    elements.modelVersions.addEventListener("change", handleModelVersionChange);
    renderModelVersions();
    loadModels();

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
        setArchiveOpen(false);
    });
    elements.archiveAll.addEventListener("click", openArchiveList);
    elements.archiveToggle.addEventListener("click", openArchiveList);
    elements.archiveBack.addEventListener("click", openArchiveList);
    elements.archiveClose.addEventListener("click", () => setArchiveOpen(false));
    elements.archiveReport.addEventListener("click", () => handleArchiveFile("report"));
    elements.archiveLog.addEventListener("click", () => handleArchiveFile("log"));
    elements.archiveDelete.addEventListener("click", handleArchiveDelete);
    elements.recentList.addEventListener("click", handleRunItemClick);
    elements.archiveList.addEventListener("click", handleRunItemClick);
    elements.usageRefresh.addEventListener("click", handleRefreshAccount);
    elements.accountSelect.addEventListener("click", handleAccountSelect);
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
    elements.doneHistory.addEventListener("click", toggleHistory);
    elements.doneReport.addEventListener("click", handleOpenReport);
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
    document.addEventListener("visibilitychange", () => document.documentElement.classList.toggle("window-hidden", document.hidden));
    setInterval(() => {
        renderClock();
        renderEndTime();
        renderStatusPhase();
        renderTrack();
    }, CLOCK_INTERVAL_MS);
};

initialize();

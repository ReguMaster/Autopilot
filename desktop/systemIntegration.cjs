const { BrowserWindow, Menu, Notification, Tray, nativeImage, powerSaveBlocker } = require("electron");
const path = require("node:path");

const TRAY_ICON_SIZE = 16;
// 고해상도 화면에서 흐려지지 않게 2배 크기로 만들어 같은 논리 크기로 쓴다.
const TRAY_ICON_SCALE = 2;
const PAUSED_PHASE_PATTERN = /재시도|사용량 한도/;
const LIMIT_PHASE_PREFIX = "사용량 한도 대기";
const KILLED_REASON = "강제 종료";
// 알림 종류와 그것을 켜고 끄는 설정 키
const NOTIFY_PREFERENCE_KEYS = { finish: "notifyFinish", failure: "notifyFailure", limit: "notifyLimit", schedule: "notifySchedule" };

let tray = null;
let readPreferences = () => ({});
let sleepBlockerId = null;
let previousStatus = "idle";
let previousPhase = "";
let previousProgressKey = "";

const getMainWindow = () => {
    return BrowserWindow.getAllWindows().find((window) => !window.isDestroyed()) || null;
};

const isActiveStatus = (status) => {
    return status === "running" || status === "stopping";
};

// 엔진이 도는 동안 PC가 잠들면 회차가 멈춘다. 화면은 꺼져도 되므로 앱 일시 중단만 막는다.
const syncSleepBlocker = (state) => {
    const shouldBlock = isActiveStatus(state.status);

    if (shouldBlock && sleepBlockerId === null) {
        sleepBlockerId = powerSaveBlocker.start("prevent-app-suspension");
    } else if (!shouldBlock && sleepBlockerId !== null) {
        powerSaveBlocker.stop(sleepBlockerId);

        sleepBlockerId = null;
    }
};

// 종료 시각이 정해져 있으면 시작부터 종료 시각까지의 경과를, 없으면 진행 중 표시만 한다.
const getProgress = (state) => {
    if (!isActiveStatus(state.status)) {
        return { mode: "none", fraction: -1 };
    }

    if (state.status === "stopping" || PAUSED_PHASE_PATTERN.test(state.phase)) {
        return { mode: "paused", fraction: 1 };
    }

    if (state.deadlineAt > state.startedAt) {
        const fraction = (Date.now() - state.startedAt) / (state.deadlineAt - state.startedAt);

        return { mode: "normal", fraction: Math.min(1, Math.max(0, fraction)) };
    }

    return { mode: "indeterminate", fraction: 1 };
};

const syncTaskbarProgress = (state) => {
    const { mode, fraction } = getProgress(state);
    const key = `${mode}:${Math.round(fraction * 100)}`;
    const window = getMainWindow();

    if (key === previousProgressKey || !window) {
        return;
    }

    previousProgressKey = key;

    window.setProgressBar(fraction, { mode: mode });
};

const showWindow = () => {
    const window = getMainWindow();

    if (!window) {
        return;
    }

    if (window.isMinimized()) {
        window.restore();
    }

    window.show();
    window.focus();
};

// 알림 설정은 호출한 쪽이 넘겨 준 함수로 읽는다(저장 위치를 이 모듈이 알 필요가 없다).
const configure = ({ getPreferences }) => {
    readPreferences = getPreferences;
};

// 종류가 꺼져 있으면 보내지 않고, 창을 보고 있을 때는 따로 켠 경우에만 보낸다.
const shouldNotify = (kind, preferences, isWindowFocused) => {
    return preferences[NOTIFY_PREFERENCE_KEYS[kind]] === true && (!isWindowFocused || preferences.notifyFocused === true);
};

const notify = (title, body, kind) => {
    const window = getMainWindow();

    if (!Notification.isSupported() || !shouldNotify(kind, readPreferences(), Boolean(window?.isFocused()))) {
        return;
    }

    const notification = new Notification({ title: title, body: body });

    notification.on("click", showWindow);
    notification.show();
};

// 알아야 하는 전환(종료·실패·사용량 한도 대기)의 알림 내용. 직접 강제 종료한 경우는 알리지 않는다. 없으면 null.
const getTransitionNotice = (previous, state) => {
    if (isActiveStatus(previous.status) && !isActiveStatus(state.status) && state.reason !== KILLED_REASON) {
        const isFailure = state.exitCode !== null && state.exitCode !== 0;

        return { kind: isFailure ? "failure" : "finish", title: isFailure ? "AutoPilot 실패" : "AutoPilot 종료", body: `${state.reason} (${state.round}회차)` };
    }

    if (state.phase.startsWith(LIMIT_PHASE_PREFIX) && !previous.phase.startsWith(LIMIT_PHASE_PREFIX)) {
        return { kind: "limit", title: "AutoPilot 대기 중", body: state.phase };
    }

    return null;
};

const notifyTransition = (state) => {
    const notice = getTransitionNotice({ status: previousStatus, phase: previousPhase }, state);

    if (notice) {
        notify(notice.title, notice.body, notice.kind);
    }
};

const syncTrayTooltip = (state) => {
    tray?.setToolTip(isActiveStatus(state.status) ? `AutoPilot - ${state.phase}` : "AutoPilot");
};

// 러너의 상태 변화마다 호출한다. 절전 방지·작업표시줄 진행·트레이 툴팁·알림을 한곳에서 맞춘다.
const handleState = (state) => {
    syncSleepBlocker(state);
    syncTaskbarProgress(state);
    syncTrayTooltip(state);
    notifyTransition(state);

    previousStatus = state.status;
    previousPhase = state.phase;
};

const createTray = ({ onQuit }) => {
    const source = nativeImage.createFromPath(path.join(__dirname, "../docs/icon.png")).resize({ width: TRAY_ICON_SIZE * TRAY_ICON_SCALE, height: TRAY_ICON_SIZE * TRAY_ICON_SCALE, quality: "best" });
    const icon = nativeImage.createFromBuffer(source.toPNG(), { scaleFactor: TRAY_ICON_SCALE });

    tray = new Tray(icon);

    tray.setToolTip("AutoPilot");
    tray.setContextMenu(Menu.buildFromTemplate([{ label: "창 열기", click: showWindow }, { type: "separator" }, { label: "종료", click: onQuit }]));
    tray.on("click", showWindow);
};

module.exports = { handleState, createTray, showWindow, notify, configure, shouldNotify, getTransitionNotice };

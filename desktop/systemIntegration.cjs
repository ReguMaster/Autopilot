const { BrowserWindow, Menu, Notification, Tray, nativeImage, powerSaveBlocker } = require("electron");
const path = require("node:path");

const TRAY_ICON_SIZE = 16;
const PAUSED_PHASE_PATTERN = /재시도|사용량 한도/;
const LIMIT_PHASE_PREFIX = "사용량 한도 대기";
const KILLED_REASON = "강제 종료";

let tray = null;
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

const notify = (title, body) => {
    const window = getMainWindow();

    if (!Notification.isSupported() || window?.isFocused()) {
        return;
    }

    const notification = new Notification({ title: title, body: body });

    notification.on("click", showWindow);
    notification.show();
};

// 창을 보고 있지 않을 때 알아야 하는 전환(종료·사용량 한도 대기)만 알린다. 직접 강제 종료한 경우는 알리지 않는다.
const notifyTransition = (state) => {
    if (isActiveStatus(previousStatus) && !isActiveStatus(state.status) && state.reason !== KILLED_REASON) {
        const isFailure = state.exitCode !== null && state.exitCode !== 0;

        notify(isFailure ? "AutoPilot 실패" : "AutoPilot 종료", `${state.reason} (${state.round}회차)`);
    } else if (state.phase.startsWith(LIMIT_PHASE_PREFIX) && !previousPhase.startsWith(LIMIT_PHASE_PREFIX)) {
        notify("AutoPilot 대기 중", state.phase);
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
    const icon = nativeImage.createFromPath(path.join(__dirname, "../docs/icon.png")).resize({ width: TRAY_ICON_SIZE, height: TRAY_ICON_SIZE });

    tray = new Tray(icon);

    tray.setToolTip("AutoPilot");
    tray.setContextMenu(Menu.buildFromTemplate([{ label: "창 열기", click: showWindow }, { type: "separator" }, { label: "종료", click: onQuit }]));
    tray.on("click", showWindow);
};

module.exports = { handleState, createTray, showWindow };

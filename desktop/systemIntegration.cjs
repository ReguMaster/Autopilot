const { BrowserWindow, Menu, Notification, Tray, nativeImage, powerMonitor, powerSaveBlocker, systemPreferences } = require("electron");
const path = require("node:path");

const TRAY_ICON_SIZE = 16;
// 고해상도 화면에서 흐려지지 않게 2배 크기로 만들어 같은 논리 크기로 쓴다.
const TRAY_ICON_SCALE = 2;
const OVERLAY_ICON_SIZE = 16;
const OVERLAY_FRAME_COUNT = 12;
const OVERLAY_FRAME_MS = 120;
const OVERLAY_DESCRIPTION = "AutoPilot 실행 중";
// 흰 바탕 위에서 파란 호가 한 바퀴 도는 그림이라 밝은 작업표시줄과 어두운 작업표시줄 모두에서 보인다.
const OVERLAY_ACCENT = [0x36, 0x56, 0xd6];
const OVERLAY_TRACK = [0xcf, 0xd6, 0xf5];
const OVERLAY_RING = { inner: 6.5, outer: 11.5 };
const PAUSED_PHASE_PATTERN = /재시도|사용량 한도/;
const LIMIT_PHASE_PREFIX = "사용량 한도 대기";
const KILLED_REASON = "강제 종료";
// 알림 종류와 그것을 켜고 끄는 설정 키
const NOTIFY_PREFERENCE_KEYS = { finish: "notifyFinish", failure: "notifyFailure", limit: "notifyLimit", schedule: "notifySchedule" };

let tray = null;
let readPreferences = () => ({});
let sleepBlockerId = null;
let isActiveSynced = false;
let previousProgressKey = "";
let overlayTimer = null;
let overlayFrames = null;
let overlayFrameIndex = 0;
let isOverlayShown = false;
// 열려 있는 프로젝트 세션마다 마지막으로 알린 상태. 절전 방지·진행률·트레이는 이 모두를 모아 판단한다.
const sessionStates = new Map();

const getMainWindow = () => {
    return BrowserWindow.getAllWindows().find((window) => !window.isDestroyed()) || null;
};

const isActiveStatus = (status) => {
    return status === "running" || status === "stopping";
};

const getActiveStates = () => {
    return [...sessionStates.values()].filter((state) => isActiveStatus(state.status));
};

// 엔진이 도는 동안 PC가 잠들면 회차가 멈춘다. 설정에 따라 항상(always), 전원이 연결된 동안만(plugged), 쓰지 않는다(never).
const shouldBlockSleep = (status, mode, isOnBattery) => {
    const effectiveMode = mode || "always";

    return isActiveStatus(status) && (effectiveMode === "always" || (effectiveMode === "plugged" && !isOnBattery));
};

// 화면은 꺼져도 되므로 앱 일시 중단만 막는다.
const refreshSleepBlocker = () => {
    const shouldBlock = shouldBlockSleep(getActiveStates().length > 0 ? "running" : "idle", readPreferences().sleepBlock, powerMonitor.isOnBatteryPower());

    if (shouldBlock && sleepBlockerId === null) {
        sleepBlockerId = powerSaveBlocker.start("prevent-app-suspension");
    } else if (!shouldBlock && sleepBlockerId !== null) {
        powerSaveBlocker.stop(sleepBlockerId);

        sleepBlockerId = null;
    }
};

// 상태가 바뀔 때마다 설정 파일을 읽지 않도록 실행 중인 프로젝트가 있는지가 바뀐 때에만 다시 판단한다.
const syncSleepBlocker = () => {
    const isActive = getActiveStates().length > 0;

    if (isActive !== isActiveSynced) {
        isActiveSynced = isActive;
        refreshSleepBlocker();
    }
};

// 전원이 연결되거나 배터리로 바뀌면 전원 연결 때만 막는 설정을 다시 판단한다.
const watchPower = () => {
    powerMonitor.on("on-ac", refreshSleepBlocker);
    powerMonitor.on("on-battery", refreshSleepBlocker);
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

// 실행 중인 프로젝트가 여럿이면 종료 시각이 있는 것들의 평균 경과를 보이고, 모두 대기 중이면 대기로 본다.
const getAggregateProgress = (states) => {
    const progresses = states.map(getProgress).filter((progress) => progress.mode !== "none");

    if (progresses.length === 0) {
        return { mode: "none", fraction: -1 };
    }

    const measured = progresses.filter((progress) => progress.mode === "normal");

    if (measured.length > 0) {
        return { mode: "normal", fraction: measured.reduce((sum, progress) => sum + progress.fraction, 0) / measured.length };
    }

    return progresses.every((progress) => progress.mode === "paused") ? { mode: "paused", fraction: 1 } : { mode: "indeterminate", fraction: 1 };
};

const syncTaskbarProgress = () => {
    const { mode, fraction } = getAggregateProgress(getActiveStates());
    const key = `${mode}:${Math.round(fraction * 100)}`;
    const window = getMainWindow();

    if (key === previousProgressKey || !window) {
        return;
    }

    previousProgressKey = key;

    window.setProgressBar(fraction, { mode: mode });
};

const mixColor = (from, to, ratio) => {
    return from.map((value, index) => value + (to[index] - value) * ratio);
};

// 흰 원 안에서 호의 머리가 index번째 각도에 오고 꼬리가 뒤로 옅어지는 BGRA(미리 곱한 알파) 비트맵.
const drawOverlayBitmap = (index) => {
    const size = OVERLAY_ICON_SIZE * TRAY_ICON_SCALE;
    const center = (size - 1) / 2;
    const head = (index / OVERLAY_FRAME_COUNT) * 2 * Math.PI;
    const buffer = Buffer.alloc(size * size * 4);

    for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
            const distance = Math.hypot(x - center, y - center);
            const discCoverage = Math.min(1, Math.max(0, size / 2 - distance));
            const ringCoverage = Math.min(1, Math.max(0, Math.min(distance - OVERLAY_RING.inner, OVERLAY_RING.outer - distance) + 0.5));
            const behind = (((head - Math.atan2(y - center, x - center)) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
            const ringColor = mixColor(OVERLAY_TRACK, OVERLAY_ACCENT, 1 - behind / (2 * Math.PI));
            const [red, green, blue] = mixColor([255, 255, 255], ringColor, ringCoverage);
            const offset = (y * size + x) * 4;

            buffer[offset] = Math.round(blue * discCoverage);
            buffer[offset + 1] = Math.round(green * discCoverage);
            buffer[offset + 2] = Math.round(red * discCoverage);
            buffer[offset + 3] = Math.round(255 * discCoverage);
        }
    }

    return buffer;
};

const getOverlayFrames = () => {
    if (!overlayFrames) {
        const size = OVERLAY_ICON_SIZE * TRAY_ICON_SCALE;

        overlayFrames = Array.from({ length: OVERLAY_FRAME_COUNT }, (_, index) => {
            return nativeImage.createFromBitmap(drawOverlayBitmap(index), { width: size, height: size, scaleFactor: TRAY_ICON_SCALE });
        });
    }

    return overlayFrames;
};

const showOverlayFrame = () => {
    const frames = getOverlayFrames();

    getMainWindow()?.setOverlayIcon(frames[overlayFrameIndex % frames.length], OVERLAY_DESCRIPTION);

    overlayFrameIndex += 1;
};

// Windows 작업표시줄 아이콘 모서리에 도는 표시를 얹는다. 일하는 동안만 돌고, 대기·종료 신호 중에는 진행 막대의 색만 남긴다.
// 시스템이 애니메이션을 줄이게 설정돼 있으면 멈춘 그림 한 장만 보인다.
const syncTaskbarOverlay = (mode) => {
    const shouldShow = process.platform === "win32" && (mode === "normal" || mode === "indeterminate");
    const window = getMainWindow();

    if (shouldShow === isOverlayShown || !window) {
        return;
    }

    isOverlayShown = shouldShow;

    clearInterval(overlayTimer);

    overlayTimer = null;

    if (!shouldShow) {
        window.setOverlayIcon(null, "");

        return;
    }

    showOverlayFrame();

    if (!systemPreferences.getAnimationSettings().prefersReducedMotion) {
        overlayTimer = setInterval(showOverlayFrame, OVERLAY_FRAME_MS);
    }
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

// 알림은 프로젝트마다 직전 상태와 비교한다. 프로젝트 이름은 알림을 보낼 때만 getProjectName으로 구한다(상태 변화는 매우 잦다).
const notifyTransition = (previous, state, getProjectName) => {
    const notice = getTransitionNotice(previous, state);

    if (notice) {
        const projectName = getProjectName();

        notify(notice.title, projectName ? `${projectName} · ${notice.body}` : notice.body, notice.kind);
    }
};

// 실행 중인 프로젝트가 하나면 그 단계를, 여럿이면 개수를 보인다.
const getTrayTooltip = (activeStates) => {
    if (activeStates.length === 0) {
        return "AutoPilot";
    }

    return activeStates.length === 1 ? `AutoPilot - ${activeStates[0].phase}` : `AutoPilot - ${activeStates.length}개 프로젝트 실행 중`;
};

const syncTrayTooltip = () => {
    tray?.setToolTip(getTrayTooltip(getActiveStates()));
};

// 프로젝트 세션의 상태 변화마다 호출한다. 절전 방지·작업표시줄 진행·트레이 툴팁은 모든 세션을 모아, 알림은 그 프로젝트의 직전 상태와 비교해 맞춘다.
const handleState = (key, state, { getProjectName = () => "" } = {}) => {
    const previous = sessionStates.get(key) || { status: "idle", phase: "" };

    sessionStates.set(key, { status: state.status, phase: state.phase, startedAt: state.startedAt, deadlineAt: state.deadlineAt });

    syncSleepBlocker();
    syncTaskbarProgress();
    syncTaskbarOverlay(getAggregateProgress(getActiveStates()).mode);
    syncTrayTooltip();
    notifyTransition(previous, state, getProjectName);
};

const createTray = ({ onQuit }) => {
    const source = nativeImage.createFromPath(path.join(__dirname, "../docs/icon.png")).resize({ width: TRAY_ICON_SIZE * TRAY_ICON_SCALE, height: TRAY_ICON_SIZE * TRAY_ICON_SCALE, quality: "best" });
    const icon = nativeImage.createFromBuffer(source.toPNG(), { scaleFactor: TRAY_ICON_SCALE });

    tray = new Tray(icon);

    tray.setToolTip("AutoPilot");
    tray.setContextMenu(Menu.buildFromTemplate([{ label: "창 열기", click: showWindow }, { type: "separator" }, { label: "종료", click: onQuit }]));
    tray.on("click", showWindow);
};

module.exports = { handleState, createTray, showWindow, notify, configure, shouldNotify, getTransitionNotice, shouldBlockSleep, getAggregateProgress, getTrayTooltip, drawOverlayBitmap, OVERLAY_FRAME_COUNT, refreshSleepBlocker, watchPower };

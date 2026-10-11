const { app, BrowserWindow, ipcMain, screen } = require("electron");
const path = require("node:path");
const { registerIpc, confirmClose, isOwnedEngineRunning, attachRunningEngine, checkEngine } = require("./autopilotIpc.cjs");
const { createTray, showWindow } = require("./systemIntegration.cjs");

const WINDOW_SIZE = { width: 600, height: 800 };
const WINDOW_MIN_SIZE = { width: 480, height: 640 };
const WINDOW_SCREEN_MARGIN = 40;
const WINDOW_BACKGROUND = { day: "#2f78d0", night: "#121a3c" };
const DAYLIGHT_HOURS = { from: 6, to: 19 };
const SMOKE_TEST_TIMEOUT_MS = 15000;
const WINDOW_RESIZE_ANIMATION_MS = 240;
const WINDOW_RESIZE_FRAME_MS = 16;

let isQuitting = false;
let resizeAnimation = null;
let restoreBounds = null;

const SMOKE_CHECK_SCRIPT =
    "typeof window.autopilot?.start === 'function' && typeof window.autopilot?.login === 'function' && Boolean(document.querySelector('#login-banner')) && typeof window.appWindow?.close === 'function' && Boolean(document.querySelector('#log')) && Boolean(document.querySelector('#titlebar')) && typeof initialize === 'function'";

// 화면은 크기를 옮기는 동안 하늘 애니메이션을 멈춰 다시 그릴 양을 줄인다.
const sendWindowState = (window, resizing = false) => window.webContents.send("window:state", { maximized: window.isMaximized(), resizing });

// 프레임 없는 창은 최대화·복원이 즉시 바뀌어 화면이 튄다. 크기를 보간하며 옮기고, 끝에서 실제 최대화로 전환해 스냅·더블클릭 같은 기본 동작과 맞춘다.
const animateWindowBounds = (window, from, to, onDone) => {
    const startedAt = Date.now();

    sendWindowState(window, true);

    resizeAnimation = setInterval(() => {
        const ratio = Math.min(1, (Date.now() - startedAt) / WINDOW_RESIZE_ANIMATION_MS);
        const eased = 1 - (1 - ratio) ** 3;

        if (window.isDestroyed()) {
            clearInterval(resizeAnimation);
            resizeAnimation = null;

            return;
        }

        window.setBounds({
            x: Math.round(from.x + (to.x - from.x) * eased),
            y: Math.round(from.y + (to.y - from.y) * eased),
            width: Math.round(from.width + (to.width - from.width) * eased),
            height: Math.round(from.height + (to.height - from.height) * eased)
        });

        if (ratio === 1) {
            clearInterval(resizeAnimation);
            resizeAnimation = null;
            onDone?.();
            sendWindowState(window);
        }
    }, WINDOW_RESIZE_FRAME_MS);
};

const maximizeWithAnimation = (window) => {
    const from = window.getBounds();
    const { workArea } = screen.getDisplayMatching(from);

    restoreBounds = from;
    animateWindowBounds(window, from, workArea, () => window.maximize());
};

// 헤더를 화면에서 직접 그리므로 창 버튼 동작을 받는다. 요청한 창에만 적용하고, 닫기는 일반 close라 실행 중 확인을 그대로 거친다.
const registerWindowControls = () => {
    const getSenderWindow = (event) => BrowserWindow.fromWebContents(event.sender);

    ipcMain.on("window:minimize", (event) => getSenderWindow(event)?.minimize());
    ipcMain.on("window:close", (event) => getSenderWindow(event)?.close());
    ipcMain.on("window:toggle-maximize", (event) => {
        const window = getSenderWindow(event);

        if (!window || resizeAnimation) {
            return;
        }

        if (window.isMaximized()) {
            window.unmaximize();
        } else {
            maximizeWithAnimation(window);
        }
    });
};

// 화면이 그려지기 전에 비치는 창 바탕색. 하늘(sky.js)이 낮에는 파랗고 밤에는 짙으므로 시각에 맞춰 고른다.
const getWindowBackground = () => {
    const hour = new Date().getHours();

    return hour >= DAYLIGHT_HOURS.from && hour < DAYLIGHT_HOURS.to ? WINDOW_BACKGROUND.day : WINDOW_BACKGROUND.night;
};

// 세로형 창. 작은 화면(예: 768px 노트북)에서는 작업 영역 안에 들어오도록 줄인다.
const getWindowSize = () => {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;

    return { width: Math.min(WINDOW_SIZE.width, width), height: Math.min(WINDOW_SIZE.height, height - WINDOW_SCREEN_MARGIN) };
};

const createWindow = () => {
    const window = new BrowserWindow({
        title: "AutoPilot",
        ...getWindowSize(),
        minWidth: WINDOW_MIN_SIZE.width,
        minHeight: WINDOW_MIN_SIZE.height,
        backgroundColor: getWindowBackground(),
        icon: path.join(__dirname, "../docs/icon.png"),
        frame: false,
        show: false,
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, "preload.cjs"),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true
        }
    });

    // 첫 화면이 그려진 뒤에 띄워 빈 창이 비치지 않게 한다. 등장 애니메이션은 화면이 맡는다.
    window.once("ready-to-show", () => window.show());
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    // 앱이 시작한 엔진이 실행 중이면 닫기는 트레이로 숨기기만 한다. 종료는 트레이 메뉴에서 확인을 거쳐 한다.
    window.on("close", (event) => {
        if (!isQuitting && isOwnedEngineRunning()) {
            event.preventDefault();
            window.hide();

            return;
        }

        if (!confirmClose(window)) {
            event.preventDefault();

            isQuitting = false;
        }
    });
    window.on("focus", attachRunningEngine);

    window.on("maximize", () => sendWindowState(window, Boolean(resizeAnimation)));
    window.on("unmaximize", () => {
        sendWindowState(window);

        if (restoreBounds) {
            const target = restoreBounds;

            restoreBounds = null;
            animateWindowBounds(window, window.getBounds(), target);
        }
    });

    if (process.argv.includes("--smoke-test")) {
        const timeout = setTimeout(() => app.exit(1), SMOKE_TEST_TIMEOUT_MS);

        window.webContents.once("did-fail-load", () => app.exit(1));
        window.webContents.once("did-finish-load", async () => {
            clearTimeout(timeout);

            const isBridgeReady = await window.webContents.executeJavaScript(SMOKE_CHECK_SCRIPT).catch(() => false);
            const isEngineReady = await checkEngine();

            app.exit(window.getTitle() === "AutoPilot" && isBridgeReady && isEngineReady ? 0 : 1);
        });
    }

    window.loadFile(path.join(__dirname, "index.html"));

    if (!app.isPackaged && process.argv.includes("--dev")) {
        window.webContents.openDevTools({ mode: "detach" });
    }
};

const quitFromTray = () => {
    isQuitting = true;

    showWindow();
    BrowserWindow.getAllWindows()[0]?.close();
};

// 엔진은 한 번에 하나만 실행되므로 앱도 하나만 띄운다. 스모크 테스트는 실행 중인 앱과 무관하게 검증해야 하므로 제외한다.
const hasInstanceLock = process.argv.includes("--smoke-test") || app.requestSingleInstanceLock();

if (!hasInstanceLock) {
    app.quit();
} else {
    app.on("second-instance", showWindow);

    app.whenReady().then(() => {
        registerIpc();
        registerWindowControls();
        createWindow();
        createTray({ onQuit: quitFromTray });

        app.on("activate", () => {
            if (BrowserWindow.getAllWindows().length === 0) {
                createWindow();
            }
        });
    });
}

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});

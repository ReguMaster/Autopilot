const { app, BrowserWindow, ipcMain, screen } = require("electron");
const path = require("node:path");
const { registerIpc, confirmClose, attachRunningEngine, checkEngine } = require("./autopilotIpc.cjs");

const WINDOW_SIZE = { width: 600, height: 800 };
const WINDOW_MIN_SIZE = { width: 480, height: 640 };
const WINDOW_SCREEN_MARGIN = 40;
const WINDOW_BACKGROUND = { day: "#2f78d0", night: "#121a3c" };
const DAYLIGHT_HOURS = { from: 6, to: 19 };
const SMOKE_TEST_TIMEOUT_MS = 15000;

const SMOKE_CHECK_SCRIPT =
    "typeof window.autopilot?.start === 'function' && typeof window.appWindow?.close === 'function' && Boolean(document.querySelector('#log')) && Boolean(document.querySelector('#titlebar')) && typeof initialize === 'function'";

// 헤더를 화면에서 직접 그리므로 창 버튼 동작을 받는다. 요청한 창에만 적용하고, 닫기는 일반 close라 실행 중 확인을 그대로 거친다.
const registerWindowControls = () => {
    const getSenderWindow = (event) => BrowserWindow.fromWebContents(event.sender);

    ipcMain.on("window:minimize", (event) => getSenderWindow(event)?.minimize());
    ipcMain.on("window:close", (event) => getSenderWindow(event)?.close());
    ipcMain.on("window:toggle-maximize", (event) => {
        const window = getSenderWindow(event);

        if (!window) {
            return;
        }

        if (window.isMaximized()) {
            window.unmaximize();
        } else {
            window.maximize();
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
    window.on("close", (event) => {
        if (!confirmClose(window)) {
            event.preventDefault();
        }
    });
    window.on("focus", attachRunningEngine);

    const sendWindowState = () => window.webContents.send("window:state", { maximized: window.isMaximized() });

    window.on("maximize", sendWindowState);
    window.on("unmaximize", sendWindowState);

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

const focusExistingWindow = () => {
    const [window] = BrowserWindow.getAllWindows();

    if (!window) {
        return;
    }

    if (window.isMinimized()) {
        window.restore();
    }

    window.focus();
};

// 엔진은 한 번에 하나만 실행되므로 앱도 하나만 띄운다. 스모크 테스트는 실행 중인 앱과 무관하게 검증해야 하므로 제외한다.
const hasInstanceLock = process.argv.includes("--smoke-test") || app.requestSingleInstanceLock();

if (!hasInstanceLock) {
    app.quit();
} else {
    app.on("second-instance", focusExistingWindow);

    app.whenReady().then(() => {
        registerIpc();
        registerWindowControls();
        createWindow();

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

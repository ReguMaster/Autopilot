const { app, BrowserWindow, ipcMain, screen, session } = require("electron");
const path = require("node:path");
const { registerIpc, confirmClose, isOwnedEngineRunning, attachRunningEngine, checkEngine } = require("./autopilotIpc.cjs");
const { createTray, showWindow } = require("./systemIntegration.cjs");

const WINDOW_SIZE = { width: 600, height: 800 };
const WINDOW_MIN_SIZE = { width: 480, height: 640 };
const WINDOW_SCREEN_MARGIN = 40;
const WINDOW_BACKGROUND = { day: "#2f78d0", night: "#121a3c" };
const DAYLIGHT_HOURS = { from: 6, to: 19 };
const SMOKE_TEST_TIMEOUT_MS = 15000;

const IS_DEV = process.argv.includes("-dev") || process.argv.includes("--dev");
const DEV_DEBUGGING_PORT = "9222";

if (IS_DEV) {
    app.commandLine.appendSwitch("remote-debugging-port", DEV_DEBUGGING_PORT);
}

// 트레이에 숨기거나 다른 창에 가려져도 로그·상태 갱신이 느려지지 않게 하고, 렌더러 메모리 상한을 둔다.
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
app.commandLine.appendSwitch("js-flags", "--max-old-space-size=256");
// 로컬 파일만 로드하므로 프록시 탐색이 필요 없다.
app.commandLine.appendSwitch("no-proxy-server");
app.enableSandbox();
app.setAppUserModelId("com.autopilot.desktop");

let isQuitting = false;

const SMOKE_CHECK_SCRIPT =
    "typeof window.autopilot?.start === 'function' && typeof window.autopilot?.login === 'function' && Boolean(document.querySelector('#login-banner')) && typeof window.appWindow?.close === 'function' && Boolean(document.querySelector('#log')) && Boolean(document.querySelector('#titlebar')) && typeof initialize === 'function'";

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
    ipcMain.handle("window:is-dev", () => IS_DEV);
    ipcMain.on("window:toggle-devtools", (event) => {
        if (IS_DEV) {
            event.sender.toggleDevTools();
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
            sandbox: true,
            webSecurity: true,
            allowRunningInsecureContent: false,
            backgroundThrottling: false,
            spellcheck: false,
            v8CacheOptions: "bypassHeatCheck",
            enableWebSQL: false,
            webgl: false,
            devTools: IS_DEV
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
    app.on("web-contents-created", (event, contents) => {
        contents.on("will-attach-webview", (attachEvent) => attachEvent.preventDefault());
    });

    app.whenReady().then(() => {
        // 이 앱은 카메라·위치 등 웹 권한을 쓰지 않으므로 모두 거부한다.
        session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => callback(false));
        session.defaultSession.setPermissionCheckHandler(() => false);

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

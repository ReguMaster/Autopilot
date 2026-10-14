const { app, BrowserWindow, ipcMain, screen, session } = require("electron");
const path = require("node:path");
const {
    registerIpc,
    confirmClose,
    isOwnedEngineRunning,
    isTrayResident,
    syncLaunchAtLogin,
    attachRunningEngine,
    checkEngine,
    startAccountWatch,
    startUpdateWatch,
    startScheduleWatch
} = require("./autopilotIpc.cjs");
const { wasLaunchedHidden } = require("./launchAtLogin.cjs");
const { createTray, showWindow } = require("./systemIntegration.cjs");

const WINDOW_SIZE = { width: 600, height: 800 };
const WINDOW_MIN_SIZE = { width: 480, height: 640 };
const WINDOW_SCREEN_MARGIN = 40;
// 화면이 그려지기 전에 비치는 창 바탕색. 화면 바탕과 같은 흰색이다.
const WINDOW_BACKGROUND = "#ffffff";
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
// 개발 실행(electron.exe)이 알림을 띄우면 Electron이 같은 ID로 시작 메뉴에 Electron.lnk를 만들고, 작업표시줄은 그 바로가기 아이콘을 쓴다. 패키지 앱과 ID를 나눠 충돌을 막는다.
app.setAppUserModelId(app.isPackaged ? "com.autopilot.desktop" : "com.autopilot.desktop.dev");

const isSmokeTest = process.argv.includes("--smoke-test");

let isQuitting = false;

const SMOKE_CHECK_SCRIPT =
    "typeof window.autopilot?.start === 'function' && typeof window.autopilot?.loginAccount === 'function' && Boolean(document.querySelector('#login-banner')) && typeof window.appWindow?.close === 'function' && typeof window.autopilot?.getAccounts === 'function' && Boolean(document.querySelector('#log')) && Boolean(document.querySelector('#titlebar')) && Boolean(document.querySelector('#profile')) && Boolean(document.querySelector('#archive')) && typeof window.autopilot?.listRuns === 'function' && typeof window.autopilot?.openUpdate === 'function' && Boolean(document.querySelector('#update-chip')) && typeof window.autopilot?.getSchedules === 'function' && Boolean(document.querySelector('#schedule')) && typeof initialize === 'function' && Boolean(document.querySelector('#model-versions .select-trigger'))";

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
        backgroundColor: WINDOW_BACKGROUND,
        icon: path.join(__dirname, process.platform === "win32" ? "../docs/icon.ico" : "../docs/icon.png"),
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

    // 첫 화면이 그려진 뒤에 띄워 빈 창이 비치지 않게 한다. 등장 애니메이션은 화면이 맡는다. 로그인 자동 실행이면 트레이에만 둔다.
    window.once("ready-to-show", () => {
        if (!isSmokeTest && wasLaunchedHidden()) {
            return;
        }

        window.show();
    });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    window.webContents.setVisualZoomLevelLimits(1, 1);
    // 확대·축소와 새로고침 단축키는 웹 페이지 느낌이라 막는다. 개발 중에는 새로고침만 남긴다.
    window.webContents.on("before-input-event", (event, input) => {
        const isCommand = input.control || input.meta;
        const isZoom = isCommand && ["+", "-", "=", "0"].includes(input.key);
        const isReload = input.key === "F5" || (isCommand && input.key.toLowerCase() === "r");

        if (input.type === "keyDown" && (isZoom || (isReload && !IS_DEV))) {
            event.preventDefault();
        }
    });
    // 앱이 시작한 엔진이 실행 중이거나 설정에서 트레이 상주를 켰으면 닫기는 트레이로 숨기기만 한다. 종료는 트레이 메뉴에서 확인을 거쳐 한다.
    window.on("close", (event) => {
        if (!isQuitting && (isOwnedEngineRunning() || isTrayResident())) {
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
    // macOS는 창이 모두 닫혀도 앱이 남으므로, 트레이 메뉴의 종료는 창이 닫힌 뒤 직접 끝낸다.
    window.on("closed", () => {
        if (isQuitting) {
            app.quit();
        }
    });

    const sendWindowState = () => window.webContents.send("window:state", { maximized: window.isMaximized() });

    window.on("maximize", sendWindowState);
    window.on("unmaximize", sendWindowState);

    if (isSmokeTest) {
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
const hasInstanceLock = isSmokeTest || app.requestSingleInstanceLock();

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

        if (!isSmokeTest) {
            syncLaunchAtLogin();
            startAccountWatch();
            startUpdateWatch();
            startScheduleWatch();
        }

        app.on("activate", () => {
            if (BrowserWindow.getAllWindows().length === 0) {
                createWindow();
            }
        });
    });
}

// Cmd+Q나 시스템 종료처럼 트레이가 아닌 경로의 종료는 닫기 처리가 숨기기만 하지 않고 종료 확인을 거치게 한다.
app.on("before-quit", () => {
    isQuitting = true;
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});

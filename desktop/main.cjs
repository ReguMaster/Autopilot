const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const { registerIpc, confirmClose, attachRunningEngine } = require("./autopilotIpc.cjs");

const SMOKE_CHECK_SCRIPT = "typeof window.autopilot?.start === 'function' && Boolean(document.querySelector('#log'))";
const SMOKE_TEST_TIMEOUT_MS = 15000;

const createWindow = () => {
    const window = new BrowserWindow({
        title: "AutoPilot",
        width: 1280,
        height: 880,
        minWidth: 900,
        minHeight: 600,
        backgroundColor: "#ffffff",
        icon: path.join(__dirname, "../docs/icon.png"),
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, "preload.cjs"),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true
        }
    });

    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    window.on("close", (event) => {
        if (!confirmClose(window)) {
            event.preventDefault();
        }
    });
    window.on("focus", attachRunningEngine);

    if (process.argv.includes("--smoke-test")) {
        const timeout = setTimeout(() => app.exit(1), SMOKE_TEST_TIMEOUT_MS);

        window.webContents.once("did-fail-load", () => app.exit(1));
        window.webContents.once("did-finish-load", async () => {
            clearTimeout(timeout);

            const isBridgeReady = await window.webContents.executeJavaScript(SMOKE_CHECK_SCRIPT).catch(() => false);

            app.exit(window.getTitle() === "AutoPilot" && isBridgeReady ? 0 : 1);
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

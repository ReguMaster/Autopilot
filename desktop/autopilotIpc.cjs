const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { createRunner, STATUS_OK, STATUS_FAILED } = require("./autopilotRunner.cjs");

const KIT_DIR_NAME = "autopilot";
const CLI_OPTION_FLAGS = [
    ["endTime", "--end-time"],
    ["policy", "--policy"],
    ["effort", "--effort"]
];
const DEFAULT_SETTINGS = { exePath: "", endTime: "", policy: "", effort: "" };

const getSettingsFile = () => {
    return path.join(app.getPath("userData"), "settings.json");
};

const readSettings = () => {
    try {
        const saved = JSON.parse(fs.readFileSync(getSettingsFile(), "utf8"));

        return Object.fromEntries(Object.keys(DEFAULT_SETTINGS).map((key) => [key, typeof saved[key] === "string" ? saved[key] : ""]));
    } catch {
        return { ...DEFAULT_SETTINGS };
    }
};

const writeSettings = (settings) => {
    fs.mkdirSync(app.getPath("userData"), { recursive: true });
    fs.writeFileSync(getSettingsFile(), JSON.stringify(settings, null, 4));
};

const createFailure = (code, msg) => {
    return { status: STATUS_FAILED, error: { code: code, msg: msg } };
};

// CLI가 키트 폴더 이름과 위치로 프로젝트 루트를 정하므로 autopilot/ 안의 실행 파일만 받는다.
const getExecutableError = (exePath) => {
    if (!exePath || !fs.existsSync(exePath) || !fs.statSync(exePath).isFile()) {
        return "autopilot 실행 파일을 찾지 못했어요.";
    }

    if (path.basename(path.dirname(exePath)) !== KIT_DIR_NAME) {
        return "대상 프로젝트의 autopilot 폴더 안에 있는 실행 파일을 선택해 주세요.";
    }

    return "";
};

const getCliArgs = (options) => {
    const args = ["--no-open"];

    for (const [key, flag] of CLI_OPTION_FLAGS) {
        const value = typeof options[key] === "string" ? options[key].trim() : "";

        if (value) {
            args.push(flag, value);
        }
    }

    return args;
};

const broadcast = (channel, payload) => {
    for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) {
            window.webContents.send(channel, payload);
        }
    }
};

const runner = createRunner({
    onLog: (entries) => broadcast("autopilot:log", entries),
    onState: (state) => broadcast("autopilot:state", state)
});

const handleStart = (event, options = {}) => {
    const settings = readSettings();
    const exeError = getExecutableError(settings.exePath);

    if (exeError) {
        return createFailure("INVALID_EXECUTABLE", exeError);
    }

    writeSettings({ ...settings, endTime: String(options.endTime || ""), policy: String(options.policy || ""), effort: String(options.effort || "") });

    return runner.start({ command: settings.exePath, args: getCliArgs(options) });
};

const handleSelectExecutable = async (event) => {
    const settings = readSettings();
    const window = BrowserWindow.fromWebContents(event.sender);
    const filters = process.platform === "win32" ? [{ name: "AutoPilot", extensions: ["exe"] }] : [];
    const selection = await dialog.showOpenDialog(window, {
        title: "autopilot 실행 파일 선택",
        defaultPath: settings.exePath || undefined,
        properties: ["openFile"],
        filters: filters
    });

    if (selection.canceled) {
        return { status: STATUS_OK, data: { settings: settings } };
    }

    const exeError = getExecutableError(selection.filePaths[0]);

    if (exeError) {
        return createFailure("INVALID_EXECUTABLE", exeError);
    }

    const nextSettings = { ...settings, exePath: selection.filePaths[0] };

    writeSettings(nextSettings);

    return { status: STATUS_OK, data: { settings: nextSettings } };
};

const handleKill = async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const { response } = await dialog.showMessageBox(window, {
        type: "warning",
        title: "AutoPilot",
        message: "강제 종료할까요?",
        detail: "실행 중인 회차가 즉시 중단되고 commit 전 변경은 working tree에 남아요. 진행 중인 리포트도 마무리되지 않아요.",
        buttons: ["취소", "강제 종료"],
        defaultId: 0,
        cancelId: 0
    });

    if (response === 0) {
        return { status: STATUS_OK, data: { cancelled: true } };
    }

    return runner.kill();
};

const handleOpenReport = async () => {
    const { reportFile } = runner.getState();

    if (!reportFile || !fs.existsSync(reportFile)) {
        return createFailure("NO_REPORT", "열 수 있는 리포트가 아직 없어요.");
    }

    const openError = await shell.openPath(reportFile);

    return openError ? createFailure("OPEN_FAILED", openError) : { status: STATUS_OK };
};

const registerIpc = () => {
    ipcMain.handle("autopilot:get-state", () => ({ settings: readSettings(), state: runner.getState(), logs: runner.getLogs() }));
    ipcMain.handle("autopilot:select-exe", handleSelectExecutable);
    ipcMain.handle("autopilot:start", handleStart);
    ipcMain.handle("autopilot:stop", () => runner.stop());
    ipcMain.handle("autopilot:kill", handleKill);
    ipcMain.handle("autopilot:open-report", handleOpenReport);
};

// 실행 중에 창을 닫으면 엔진이 끊기므로 확인을 받고 강제 종료한다. 닫아도 되면 true를 반환한다.
const confirmClose = (window) => {
    if (!runner.isRunning()) {
        return true;
    }

    const response = dialog.showMessageBoxSync(window, {
        type: "warning",
        title: "AutoPilot",
        message: "AutoPilot이 실행 중이에요.",
        detail: "창을 닫으면 실행 중인 회차가 강제 종료되고 commit 전 변경은 working tree에 남아요.",
        buttons: ["계속 실행", "강제 종료 후 닫기"],
        defaultId: 0,
        cancelId: 0
    });

    if (response === 0) {
        return false;
    }

    runner.kill();

    return true;
};

module.exports = { registerIpc, confirmClose };

const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { createRunner, MODEL_CHOICES, EFFORT_CHOICES, STATUS_OK, STATUS_FAILED } = require("./autopilotRunner.cjs");
const { KIT_DIR_NAME, findEngineExecutable, isKitReportFile } = require("./engineFinder.cjs");

const CLI_OPTION_FLAGS = [
    ["endTime", "--end-time"],
    ["policy", "--policy"],
    ["model", "--model"],
    ["effort", "--effort"]
];
const ENGINE_VERSION_TIMEOUT_MS = 10000;
const ENGINE_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][\w.]+)?$/;
const DEFAULT_SETTINGS = { exePath: "", endTime: "", policy: "", model: "opus", effort: "high" };

const getSettingsFile = () => {
    return path.join(app.getPath("userData"), "settings.json");
};

const readSettings = () => {
    try {
        const saved = JSON.parse(fs.readFileSync(getSettingsFile(), "utf8"));

        return Object.fromEntries(Object.keys(DEFAULT_SETTINGS).map((key) => [key, typeof saved[key] === "string" ? saved[key] : DEFAULT_SETTINGS[key]]));
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

// 엔진 버전을 읽는다. --version을 모르는 이전 버전이거나 실행에 실패하면 빈 문자열이다.
const readEngineVersion = (exePath) => {
    return new Promise((resolve) => {
        if (getExecutableError(exePath)) {
            resolve("");

            return;
        }

        execFile(exePath, ["--version"], { windowsHide: true, timeout: ENGINE_VERSION_TIMEOUT_MS, encoding: "utf8" }, (error, stdout) => {
            const version = error ? "" : stdout.trim();

            resolve(ENGINE_VERSION_PATTERN.test(version) ? version : "");
        });
    });
};

// 포터블 실행 파일 위치, 앱 실행 파일 위치, 작업 폴더 순으로 찾아 연결하고 저장한다. 못 찾으면 null.
const connectFoundExecutable = (settings) => {
    const startDirs = [process.env.PORTABLE_EXECUTABLE_DIR, path.dirname(process.execPath), process.cwd()].filter(Boolean);
    const exePath = findEngineExecutable(startDirs);

    if (!exePath) {
        return null;
    }

    const nextSettings = { ...settings, exePath: exePath };

    writeSettings(nextSettings);

    return nextSettings;
};

const isValidRoundOptions = ({ model, effort }) => {
    return MODEL_CHOICES.includes(model) && EFFORT_CHOICES.includes(effort);
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

    if (!isValidRoundOptions(options)) {
        return createFailure("INVALID_OPTIONS", "model 또는 effort 값이 올바르지 않아요.");
    }

    writeSettings({ ...settings, endTime: String(options.endTime || ""), policy: String(options.policy || ""), model: options.model, effort: options.effort });

    return runner.start({ command: settings.exePath, args: getCliArgs(options), roundOptions: { model: options.model, effort: options.effort } });
};

// 실행 중인 엔진에 다음 회차부터 쓸 model·effort를 전달하고, 성공하면 다음 시작의 기본값으로도 저장한다.
const handleSetOptions = async (event, options = {}) => {
    if (!isValidRoundOptions(options)) {
        return createFailure("INVALID_OPTIONS", "model 또는 effort 값이 올바르지 않아요.");
    }

    const result = await runner.setRoundOptions({ model: options.model, effort: options.effort });

    if (result.status === STATUS_OK) {
        writeSettings({ ...readSettings(), model: options.model, effort: options.effort });
    }

    return result;
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

    return { status: STATUS_OK, data: { settings: nextSettings, engineVersion: await readEngineVersion(nextSettings.exePath) } };
};

const handleFindExecutable = async () => {
    const settings = connectFoundExecutable(readSettings());

    if (!settings) {
        return createFailure("ENGINE_NOT_FOUND", "autopilot 실행 파일을 자동으로 찾지 못했어요. 직접 선택해 주세요.");
    }

    return { status: STATUS_OK, data: { settings: settings, engineVersion: await readEngineVersion(settings.exePath) } };
};

// 앱이 시작하지 않았지만 이미 실행 중인 엔진(예: 시작 배치로 띄운 엔진)이 있으면 연결한다. 연결 상태는 state 이벤트로 화면에 전달된다.
let isCheckingRunningEngine = false;

const attachRunningEngine = async () => {
    const { exePath } = readSettings();

    if (isCheckingRunningEngine || runner.isRunning() || getExecutableError(exePath)) {
        return;
    }

    isCheckingRunningEngine = true;

    try {
        await runner.attachIfRunning({ command: exePath });
    } finally {
        isCheckingRunningEngine = false;
    }
};

// 저장된 경로가 없거나 더 이상 유효하지 않을 때만 자동으로 연결한다.
const handleGetState = async () => {
    let settings = readSettings();

    if (getExecutableError(settings.exePath)) {
        settings = connectFoundExecutable(settings) || settings;
    }

    await attachRunningEngine();

    return { version: app.getVersion(), engineVersion: await readEngineVersion(settings.exePath), settings: settings, state: runner.getState(), logs: runner.getLogs() };
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

    const { exePath } = readSettings();

    if (!isKitReportFile(exePath && path.dirname(exePath), reportFile)) {
        return createFailure("INVALID_REPORT", "엔진 폴더의 progress 안에 있는 리포트만 열 수 있어요.");
    }

    const openError = await shell.openPath(reportFile);

    return openError ? createFailure("OPEN_FAILED", openError) : { status: STATUS_OK };
};

const registerIpc = () => {
    ipcMain.handle("autopilot:get-state", handleGetState);
    ipcMain.handle("autopilot:select-exe", handleSelectExecutable);
    ipcMain.handle("autopilot:find-exe", handleFindExecutable);
    ipcMain.handle("autopilot:start", handleStart);
    ipcMain.handle("autopilot:stop", () => runner.stop());
    ipcMain.handle("autopilot:set-options", handleSetOptions);
    ipcMain.handle("autopilot:kill", handleKill);
    ipcMain.handle("autopilot:open-report", handleOpenReport);
};

// 앱이 시작한 엔진은 창을 닫으면 출력이 끊기므로 확인을 받고 강제 종료한다. 연결한 엔진은 앱 소유가 아니라 그대로 두고 닫는다. 닫아도 되면 true를 반환한다.
const confirmClose = (window) => {
    if (!runner.isRunning() || runner.isAttached()) {
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

module.exports = { registerIpc, confirmClose, attachRunningEngine };

const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { createRunner, execEngine, MODEL_CHOICES, EFFORT_CHOICES, STATUS_OK, STATUS_FAILED } = require("./autopilotRunner.cjs");
const { getProjectError, isProjectReportFile } = require("./projectFiles.cjs");

const POLICY_CHOICES = ["auto", "todo"];
const END_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const ENGINE_HELP_TIMEOUT_MS = 10000;
const TASKS_FILE_NAME = "tasks.md";
const DEFAULT_SETTINGS = { projectDir: "", tasks: "", endTime: "", policy: "auto", model: "opus", effort: "high" };

// 저장된 값이 허용 범위를 벗어나면 기본값으로 대신한다.
const SETTING_VALIDATORS = {
    projectDir: (value) => typeof value === "string",
    tasks: (value) => typeof value === "string",
    endTime: (value) => value === "" || END_TIME_PATTERN.test(value),
    policy: (value) => POLICY_CHOICES.includes(value),
    model: (value) => MODEL_CHOICES.includes(value),
    effort: (value) => EFFORT_CHOICES.includes(value)
};

const getSettingsFile = () => {
    return path.join(app.getPath("userData"), "settings.json");
};

const readSettings = () => {
    try {
        const saved = JSON.parse(fs.readFileSync(getSettingsFile(), "utf8"));

        return Object.fromEntries(Object.entries(SETTING_VALIDATORS).map(([key, isValid]) => [key, isValid(saved[key]) ? saved[key] : DEFAULT_SETTINGS[key]]));
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

const getEngineScript = () => {
    return app.isPackaged ? path.join(process.resourcesPath, "engine", "core", "autopilot_loop.js") : path.join(__dirname, "..", "autopilot", "core", "autopilot_loop.js");
};

// 엔진은 앱 실행 파일을 Node로 실행해(ELECTRON_RUN_AS_NODE) 별도 설치 없이 같은 exe 안에서 돈다.
const getEngineLaunch = () => {
    return { command: process.execPath, prefixArgs: [getEngineScript()], env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } };
};

// 엔진이 앱 번들 안에서 실제로 실행되는지 확인한다(스모크 테스트용).
const checkEngine = () => {
    return new Promise((resolve) => {
        const { command, prefixArgs, env } = getEngineLaunch();

        execFile(command, [...prefixArgs, "--help"], { windowsHide: true, timeout: ENGINE_HELP_TIMEOUT_MS, encoding: "utf8", env: env }, (error, stdout) => {
            resolve(!error && stdout.includes("AutoPilot --project"));
        });
    });
};

const isValidRoundOptions = ({ model, effort }) => {
    return MODEL_CHOICES.includes(model) && EFFORT_CHOICES.includes(effort);
};

const getCliArgs = ({ projectDir, tasksFile, endTime, policy, model, effort }) => {
    const args = ["--project", projectDir, "--no-open", "--tasks-file", tasksFile, "--policy", policy, "--model", model, "--effort", effort];

    if (endTime) {
        args.push("--end-time", endTime);
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

// 시작 인자의 오류를 알려준다. 없으면 null.
const getStartError = (settings, options) => {
    const projectError = getProjectError(settings.projectDir);

    if (projectError) {
        return createFailure("INVALID_PROJECT", projectError);
    }

    if (!isValidRoundOptions(options) || !POLICY_CHOICES.includes(options.policy) || (options.endTime && !END_TIME_PATTERN.test(options.endTime))) {
        return createFailure("INVALID_OPTIONS", "모델, Effort, 정책, 종료 시각 값이 올바르지 않아요.");
    }

    if (options.policy === "todo" && !options.tasks.trim()) {
        return createFailure("TASKS_REQUIRED", "지시개선은 처리할 작업을 입력해야 시작할 수 있어요.");
    }

    return null;
};

const handleStart = (event, options = {}) => {
    const settings = readSettings();
    const startOptions = {
        tasks: typeof options.tasks === "string" ? options.tasks : "",
        endTime: String(options.endTime || ""),
        policy: options.policy,
        model: options.model,
        effort: options.effort
    };
    const startError = getStartError(settings, startOptions);

    if (startError) {
        return startError;
    }

    // 작업은 긴 텍스트라 인자로 넘기지 않고 파일로 전달한다. 엔진이 시작할 때 한 번 읽는다.
    const tasksFile = path.join(app.getPath("userData"), TASKS_FILE_NAME);

    fs.mkdirSync(app.getPath("userData"), { recursive: true });
    fs.writeFileSync(tasksFile, startOptions.tasks, "utf8");
    writeSettings({ ...settings, ...startOptions });

    return runner.start({
        ...getEngineLaunch(),
        projectDir: settings.projectDir,
        args: getCliArgs({ ...startOptions, projectDir: settings.projectDir, tasksFile: tasksFile }),
        roundOptions: { model: startOptions.model, effort: startOptions.effort }
    });
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

// 앱을 닫았다 켠 사이에 계속 실행된 엔진이 선택한 프로젝트에 있으면 연결한다. 연결 상태는 state 이벤트로 화면에 전달된다.
let isCheckingRunningEngine = false;

const attachRunningEngine = async () => {
    const { projectDir } = readSettings();

    if (isCheckingRunningEngine || runner.isRunning() || getProjectError(projectDir)) {
        return;
    }

    isCheckingRunningEngine = true;

    try {
        await runner.attachIfRunning({ ...getEngineLaunch(), projectDir: projectDir });
    } finally {
        isCheckingRunningEngine = false;
    }
};

const handleSelectProject = async (event) => {
    if (runner.isRunning()) {
        return createFailure("RUNNING", "실행 중에는 프로젝트를 바꿀 수 없어요.");
    }

    const settings = readSettings();
    const window = BrowserWindow.fromWebContents(event.sender);
    const selection = await dialog.showOpenDialog(window, {
        title: "대상 프로젝트 폴더 선택",
        defaultPath: settings.projectDir || undefined,
        properties: ["openDirectory"]
    });

    if (selection.canceled) {
        return { status: STATUS_OK, data: { settings: settings } };
    }

    const projectError = getProjectError(selection.filePaths[0]);

    if (projectError) {
        return createFailure("INVALID_PROJECT", projectError);
    }

    const nextSettings = { ...settings, projectDir: selection.filePaths[0] };

    writeSettings(nextSettings);

    await attachRunningEngine();

    return { status: STATUS_OK, data: { settings: nextSettings } };
};

const handleGetState = async () => {
    await attachRunningEngine();

    return { version: app.getVersion(), settings: readSettings(), state: runner.getState(), logs: runner.getLogs() };
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

// 진행 기록을 보관하고 초기화한다. 이어갈 내용이 사라지므로 확인을 받고, 실행 중에는 막는다.
const handleResetProgress = async (event) => {
    const { projectDir } = readSettings();
    const projectError = getProjectError(projectDir);

    if (projectError) {
        return createFailure("INVALID_PROJECT", projectError);
    }

    if (runner.isRunning()) {
        return createFailure("RUNNING", "실행 중에는 진행 기록을 초기화할 수 없어요.");
    }

    const window = BrowserWindow.fromWebContents(event.sender);
    const { response } = await dialog.showMessageBox(window, {
        type: "question",
        title: "AutoPilot",
        message: "진행 기록을 초기화할까요?",
        detail: "다음 실행이 이전 작업을 이어받지 않고 빈 기록에서 시작해요. 원본은 프로젝트의 autopilot/progress 폴더에 보관돼요.",
        buttons: ["취소", "초기화"],
        defaultId: 0,
        cancelId: 0
    });

    if (response === 0) {
        return { status: STATUS_OK, data: { cancelled: true } };
    }

    return new Promise((resolve) => {
        execEngine({ ...getEngineLaunch(), projectDir: projectDir }, "reset-progress", [], (error, stdout, stderr) => {
            if (error) {
                resolve(createFailure("RESET_FAILED", (stderr || error.message).trim()));

                return;
            }

            resolve({ status: STATUS_OK, data: { isReset: stdout.includes("Progress record reset") } });
        });
    });
};

const handleOpenReport = async () => {
    const { reportFile } = runner.getState();

    if (!reportFile || !fs.existsSync(reportFile)) {
        return createFailure("NO_REPORT", "열 수 있는 리포트가 아직 없어요.");
    }

    if (!isProjectReportFile(runner.getProjectDir(), reportFile)) {
        return createFailure("INVALID_REPORT", "프로젝트의 autopilot/progress 안에 있는 리포트만 열 수 있어요.");
    }

    const openError = await shell.openPath(reportFile);

    return openError ? createFailure("OPEN_FAILED", openError) : { status: STATUS_OK };
};

const registerIpc = () => {
    ipcMain.handle("autopilot:get-state", handleGetState);
    ipcMain.handle("autopilot:select-project", handleSelectProject);
    ipcMain.handle("autopilot:start", handleStart);
    ipcMain.handle("autopilot:stop", () => runner.stop());
    ipcMain.handle("autopilot:set-options", handleSetOptions);
    ipcMain.handle("autopilot:kill", handleKill);
    ipcMain.handle("autopilot:reset-progress", handleResetProgress);
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

module.exports = { registerIpc, confirmClose, attachRunningEngine, checkEngine };

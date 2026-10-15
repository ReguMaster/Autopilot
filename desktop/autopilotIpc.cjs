const { app, BrowserWindow, dialog, ipcMain, powerMonitor, shell } = require("electron");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { createRunner, execEngine, MODEL_CHOICES, EFFORT_CHOICES, STATUS_OK, STATUS_FAILED } = require("./autopilotRunner.cjs");
const { getProjectError, isProjectReportFile, isProjectLogFile } = require("./projectFiles.cjs");
const { listRuns, readRun, deleteRun, getRunFiles, MAX_RUN_COUNT } = require("./runHistory.cjs");
const { handleState, notify, configure: configureSystem } = require("./systemIntegration.cjs");
const { createAccountIpc } = require("./accountIpc.cjs");
const { parseLoginExpiryFlag } = require("./claudeAccount.cjs");
const { createUpdateCheck } = require("./updateCheck.cjs");
const loginItem = require("./launchAtLogin.cjs");
const { createScheduler } = require("./scheduler.cjs");
const { parseSchedule } = require("./scheduleRules.cjs");
const { readJsonFile } = require("./jsonFile.cjs");
const { createSettingsStore, SETTING_VALIDATORS, OVERRIDABLE_KEYS, PREFERENCE_KEYS, POLICY_CHOICES, END_TIME_PATTERN } = require("./settingsStore.cjs");

const ENGINE_HELP_TIMEOUT_MS = 10000;
// 절전에서 깨면 네트워크가 올라올 때까지 잠시 기다린 뒤 판단한다.
const SCHEDULE_RESUME_DELAY_MS = 5000;
const TASKS_FILE_NAME = "tasks.md";
const SETTINGS_FILE_FILTERS = [{ name: "AutoPilot 설정", extensions: ["json"] }];
const MAX_SETTINGS_IMPORT_BYTES = 2 * 1024 * 1024;

const SETTINGS_SCOPES = ["global", "project"];

const settingsStore = createSettingsStore({ dir: app.getPath("userData") });
// 계정·시스템·선택한 프로젝트처럼 전역에만 있는 값과 전역 기본값. 프로젝트마다 달라지는 값은 readEffective로 읽는다.
const readSettings = settingsStore.read;
const writeSettings = settingsStore.write;
const updateSettings = settingsStore.update;
// 선택한 프로젝트가 덮어쓴 값을 전역 값 위에 얹은 설정. 프로젝트가 없으면 전역 값이다.
const readEffective = () => settingsStore.resolve().settings;

// 화면이 설정을 그리는 데 필요한 것: 적용되는 값, 프로젝트가 덮어쓴 키, 전역 기본값, 한 번 알릴 안내.
const getSettingsView = () => {
    return { ...settingsStore.resolve(), notice: settingsStore.takeNotice() };
};

// 예약은 전역 목록과 선택한 프로젝트의 목록을 합쳐 보여준다(덮어쓰기가 아니라 합침). 목록에서는 scope로 어느 쪽인지 구분하고, 저장할 때 다시 나눈다.
const readAllSchedules = () => {
    const { projectDir, schedules } = readSettings();
    const projectSchedules = settingsStore.readProject(projectDir).schedules ?? [];

    return [...schedules.map((schedule) => ({ ...schedule, scope: "global" })), ...projectSchedules.map((schedule) => ({ ...schedule, scope: "project" }))];
};

const writeAllSchedules = (list) => {
    const { projectDir } = readSettings();

    updateSettings({ schedules: list.filter((schedule) => schedule.scope !== "project") });

    if (projectDir) {
        settingsStore.updateProject(projectDir, { schedules: list.filter((schedule) => schedule.scope === "project") });
    }
};

// 다른 프로젝트를 골라 목록에서 빠져 있는 예약도 판단 상태(마지막 시작 등)는 남겨 둔다.
const getKnownScheduleIds = () => {
    return [...readSettings().schedules, ...settingsStore.listProjects().flatMap((project) => project.overrides.schedules ?? [])].map((schedule) => schedule.id);
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

const resolveModel = (family, modelVersions) => {
    return modelVersions[family] || family;
};

const getCliArgs = ({ projectDir, tasksFile, endTime, policy, extendOnLimit, model, effort, configDir }) => {
    const args = ["--project", projectDir, "--no-open", "--tasks-file", tasksFile, "--policy", policy, "--model", model, "--effort", effort];

    if (endTime) {
        args.push("--end-time", endTime);
    }

    if (extendOnLimit) {
        args.push("--extend-on-limit");
    }

    if (configDir) {
        args.push("--config-dir", configDir);
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
    onState: (state) => {
        broadcast("autopilot:state", state);
        handleState(state);
    }
});

// --debug-login-expiry는 만료 화면을 보는 개발용이라 패키지 앱에서는 읽지 않는다.
const accounts = createAccountIpc({
    readSettings: readSettings,
    writeSettings: writeSettings,
    broadcast: broadcast,
    isRunning: () => runner.isRunning(),
    loginExpiresAtOverride: app.isPackaged ? 0 : parseLoginExpiryFlag(process.argv)
});

const updateCheck = createUpdateCheck({ currentVersion: app.getVersion(), onChange: (update) => broadcast("autopilot:update", update), isEnabled: () => readSettings().checkUpdates });

// 예약이 조건을 만족하면 마지막으로 저장한 작업·정책·모델·Effort로 시작한다. 종료 시각은 예약이 정한 값이라 다음 시작의 기본값으로 저장하지 않는다.
const startScheduledRun = async (schedule, plan) => {
    try {
        const settings = readEffective();
        const result = await launchRun(
            settings,
            { tasks: settings.tasks, endTime: plan.endTime, policy: settings.policy, extendOnLimit: settings.extendOnLimit, model: settings.model, effort: settings.effort },
            { remember: false }
        );

        return result.status === STATUS_OK ? { ok: true, message: `조건이 맞아서 ${plan.endTime}까지 실행을 시작했어요.` } : { ok: false, message: result.error.msg };
    } catch (error) {
        return { ok: false, message: error.message };
    }
};

// 앱을 닫았다 켠 사이에 계속 실행된 엔진이 있으면 먼저 연결해 둔다. 모르고 두 번째 엔진을 시작하지 않게 하기 위해서다.
const isEngineBusy = async () => {
    await attachRunningEngine();

    return runner.isRunning() || isLaunching;
};

const scheduler = createScheduler({
    stateFile: path.join(app.getPath("userData"), "schedule-state.json"),
    readSchedules: readAllSchedules,
    writeSchedules: writeAllSchedules,
    getKnownIds: getKnownScheduleIds,
    getUsage: () => accounts.getActiveUsage(),
    refreshUsage: () => accounts.refreshActiveUsage(),
    isBusy: isEngineBusy,
    startRun: startScheduledRun,
    notify: (title, body) => notify(title, body, "schedule"),
    onChange: (payload) => broadcast("autopilot:schedules", payload)
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

let isLaunching = false;

// 수동 시작과 예약 시작이 함께 쓰는 시작 절차. remember가 참이면 쓴 값을 다음 시작의 기본값으로 저장한다.
const launchRun = async (settings, startOptions, { remember }) => {
    const startError = getStartError(settings, startOptions);

    if (startError) {
        return startError;
    }

    isLaunching = true;

    try {
        const runAccount = await accounts.getRunAccount();

        if (runAccount.status !== STATUS_OK) {
            return runAccount;
        }

        // 작업은 긴 텍스트라 인자로 넘기지 않고 파일로 전달한다. 엔진이 시작할 때 한 번 읽는다.
        const tasksFile = path.join(app.getPath("userData"), TASKS_FILE_NAME);

        fs.mkdirSync(app.getPath("userData"), { recursive: true });
        fs.writeFileSync(tasksFile, startOptions.tasks, "utf8");

        if (remember) {
            settingsStore.remember(settings.projectDir, startOptions);
        }

        const model = resolveModel(startOptions.model, settings.modelVersions);

        return await runner.start({
            ...getEngineLaunch(),
            projectDir: settings.projectDir,
            args: getCliArgs({ ...startOptions, model: model, projectDir: settings.projectDir, tasksFile: tasksFile, configDir: runAccount.data.configDir }),
            roundOptions: { model: model, effort: startOptions.effort }
        });
    } finally {
        isLaunching = false;
    }
};

const handleStart = async (event, options = {}) => {
    return launchRun(
        readEffective(),
        {
            tasks: typeof options.tasks === "string" ? options.tasks : "",
            endTime: String(options.endTime || ""),
            policy: options.policy,
            extendOnLimit: options.extendOnLimit === true,
            model: options.model,
            effort: options.effort
        },
        { remember: true }
    );
};

// 실행 중인 엔진에 다음 회차부터 쓸 model·effort를 전달하고, 성공하면 다음 시작의 기본값으로도 저장한다.
const handleSetOptions = async (event, options = {}) => {
    if (!isValidRoundOptions(options)) {
        return createFailure("INVALID_OPTIONS", "model 또는 effort 값이 올바르지 않아요.");
    }

    const settings = readEffective();
    const result = await runner.setRoundOptions({ model: resolveModel(options.model, settings.modelVersions), effort: options.effort });

    if (result.status === STATUS_OK) {
        settingsStore.remember(settings.projectDir, { model: options.model, effort: options.effort });
    }

    return result;
};

// 설정 패널에서 바꾼 값을 전역 기본값(global)이나 선택한 프로젝트의 덮어쓰기(project)로 저장한다. 실행 중에는 바꾸지 않는다.
const handleUpdateSettings = (event, request = {}) => {
    const { scope, patch } = request;
    const keys = patch && typeof patch === "object" ? Object.keys(patch) : [];

    if (runner.isRunning()) {
        return createFailure("RUNNING", "실행 중에는 설정을 바꿀 수 없어요.");
    }

    if (!SETTINGS_SCOPES.includes(scope) || keys.length === 0 || !keys.every((key) => OVERRIDABLE_KEYS.includes(key) && SETTING_VALIDATORS[key](patch[key]))) {
        return createFailure("INVALID_OPTIONS", "설정 범위나 값이 올바르지 않아요.");
    }

    const { projectDir } = readSettings();

    if (scope === "project" && !projectDir) {
        return createFailure("INVALID_PROJECT", "프로젝트를 먼저 선택해 주세요.");
    }

    if (scope === "project") {
        settingsStore.updateProject(projectDir, patch);
    } else {
        updateSettings(patch);
    }

    return { status: STATUS_OK, data: getSettingsView() };
};

const getExportFileName = () => {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, "0");

    return `autopilot-settings-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}.json`;
};

// 설정을 파일로 내보낸다. 계정·Claude 데이터 폴더·선택한 프로젝트·자동 실행처럼 이 PC에서만 뜻이 있는 값은 담지 않는다.
const handleExportSettings = async (event) => {
    const selection = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), {
        title: "설정 내보내기",
        defaultPath: path.join(app.getPath("documents"), getExportFileName()),
        filters: SETTINGS_FILE_FILTERS
    });

    if (selection.canceled || !selection.filePath) {
        return { status: STATUS_OK, data: { canceled: true } };
    }

    try {
        fs.writeFileSync(selection.filePath, JSON.stringify(settingsStore.exportData(), null, 4), "utf8");

        return { status: STATUS_OK, data: { canceled: false } };
    } catch (error) {
        return createFailure("EXPORT_FAILED", `설정을 내보내지 못했어요: ${error.message}`);
    }
};

// 내보낸 파일의 설정으로 덮어쓴다. 프로젝트별 설정은 이 PC에 있는 Git 저장소 루트만 적용한다. 덮어쓰는 일이라 확인은 화면의 모달이 먼저 받는다.
const handleImportSettings = async (event) => {
    if (runner.isRunning()) {
        return createFailure("RUNNING", "실행 중에는 설정을 가져올 수 없어요.");
    }

    const selection = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), { title: "설정 가져오기", properties: ["openFile"], filters: SETTINGS_FILE_FILTERS });

    if (selection.canceled) {
        return { status: STATUS_OK, data: { canceled: true } };
    }

    const file = selection.filePaths[0];
    const loaded = fs.statSync(file).size > MAX_SETTINGS_IMPORT_BYTES ? { state: "corrupt" } : readJsonFile(file);

    if (loaded.state !== "ok") {
        return createFailure("IMPORT_FAILED", "설정 파일을 읽지 못했어요. AutoPilot이 내보낸 JSON 파일인지 확인해 주세요.");
    }

    const result = settingsStore.importData(loaded.data, { canUseProject: (projectDir) => !getProjectError(projectDir) });

    if (result.error) {
        return createFailure("IMPORT_FAILED", result.error);
    }

    // 로그인 자동 실행은 트레이 상주가 켜져 있어야 하므로 가져온 값이 이를 깨지 않게 한다.
    if (readSettings().launchAtLogin) {
        updateSettings({ keepInTray: true });
    }

    return { status: STATUS_OK, data: { canceled: false, ...getSettingsView(), keyCount: result.keyCount, projectCount: result.projectCount, skippedCount: result.skippedCount } };
};

// 기본값으로 되돌린다. 계정·Claude 데이터 폴더·선택한 프로젝트·자동 실행·예약은 그대로 두고 프로젝트별 설정은 지운다. 확인은 화면의 모달이 먼저 받는다.
const handleRestoreDefaults = () => {
    if (runner.isRunning()) {
        return createFailure("RUNNING", "실행 중에는 설정을 되돌릴 수 없어요.");
    }

    settingsStore.resetPreferences();

    return { status: STATUS_OK, data: getSettingsView() };
};

// 알림처럼 실행과 무관하게 언제든 바꾸는 전역 환경설정을 저장한다.
const handleSetPreferences = (event, patch) => {
    const keys = patch && typeof patch === "object" ? Object.keys(patch) : [];

    if (keys.length === 0 || !keys.every((key) => PREFERENCE_KEYS.includes(key) && SETTING_VALIDATORS[key](patch[key]))) {
        return createFailure("INVALID_OPTIONS", "환경설정 값이 올바르지 않아요.");
    }

    updateSettings(patch);

    // 새 버전 확인을 켜거나 끄면 바로 반영한다(켜면 지금 확인하고, 끄면 알고 있던 안내를 거둔다).
    if (Object.hasOwn(patch, "checkUpdates")) {
        updateCheck.check();
    }

    return { status: STATUS_OK, data: getSettingsView() };
};

// 선택한 프로젝트가 덮어쓴 값을 지워 전역 값을 따라가게 한다.
const handleResetSettings = (event, keys) => {
    const { projectDir } = readSettings();

    if (runner.isRunning()) {
        return createFailure("RUNNING", "실행 중에는 설정을 바꿀 수 없어요.");
    }

    if (!Array.isArray(keys) || keys.length === 0 || !keys.every((key) => OVERRIDABLE_KEYS.includes(key))) {
        return createFailure("INVALID_OPTIONS", "되돌릴 설정이 올바르지 않아요.");
    }

    if (!projectDir) {
        return createFailure("INVALID_PROJECT", "프로젝트를 먼저 선택해 주세요.");
    }

    settingsStore.clearProject(projectDir, keys);

    return { status: STATUS_OK, data: getSettingsView() };
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
        return { status: STATUS_OK, data: getSettingsView() };
    }

    const projectError = getProjectError(selection.filePaths[0]);

    if (projectError) {
        return createFailure("INVALID_PROJECT", projectError);
    }

    updateSettings({ projectDir: selection.filePaths[0] });

    await attachRunningEngine();

    return { status: STATUS_OK, data: getSettingsView() };
};

const handleGetState = async () => {
    await attachRunningEngine();

    return {
        version: app.getVersion(),
        platform: process.platform,
        canLaunchAtLogin: loginItem.isSupported(),
        update: updateCheck.getUpdate(),
        ...getSettingsView(),
        state: runner.getState(),
        logs: runner.getLogs()
    };
};

// 로그인 자동 실행은 트레이에 상주해야 의미가 있으므로 켜면 트레이 상주도 함께 켠다. 시스템이 실제로 등록했는지 다시 읽어 확인한다.
const handleSetSystem = (event, options = {}) => {
    const launchAtLogin = options.launchAtLogin === true;
    const keepInTray = options.keepInTray === true || launchAtLogin;

    if (launchAtLogin && !loginItem.isSupported()) {
        return createFailure("UNSUPPORTED", "설치한 앱에서만 로그인 자동 실행을 켤 수 있어요.");
    }

    const previous = readSettings().launchAtLogin;

    try {
        loginItem.setEnabled(launchAtLogin);
    } catch (error) {
        return createFailure("LOGIN_ITEM_FAILED", `로그인 자동 실행을 바꾸지 못했어요: ${error.message}`);
    }

    if (loginItem.isSupported() && loginItem.isEnabled() !== launchAtLogin) {
        // 시스템에 반쯤 남은 항목이 저장된 설정과 어긋나지 않게 이전 상태로 되돌린다.
        try {
            loginItem.setEnabled(previous);
        } catch {}

        return createFailure("LOGIN_ITEM_FAILED", "시스템이 로그인 자동 실행 설정을 받아들이지 않았어요. 보안 정책이나 권한을 확인해 주세요.");
    }

    updateSettings({ keepInTray: keepInTray, launchAtLogin: launchAtLogin });

    return { status: STATUS_OK, data: getSettingsView() };
};

// 앱을 켤 때 저장된 자동 실행 설정으로 로그인 항목의 경로를 다시 맞춘다(업데이트·재설치로 실행 파일 위치가 바뀌었을 수 있다).
const syncLaunchAtLogin = () => {
    if (readSettings().launchAtLogin && loginItem.isSupported()) {
        try {
            loginItem.setEnabled(true);
        } catch {}
    }
};

// 닫아도 트레이에 남겨 둘지. 실행 중이 아닐 때의 닫기 동작을 정한다.
const isTrayResident = () => {
    return readSettings().keepInTray;
};

// 예약을 저장하기 전에 지금 컴포저의 작업·정책·모델·Effort를 함께 저장한다. 예약 실행은 이 값으로 돈다.
const handleSaveSchedule = async (event, payload = {}) => {
    const settings = readSettings();
    const composer = payload.options || {};
    const options = {
        tasks: typeof composer.tasks === "string" ? composer.tasks : "",
        policy: composer.policy,
        extendOnLimit: composer.extendOnLimit === true,
        model: composer.model,
        effort: composer.effort
    };
    const parsed = parseSchedule(payload.schedule);
    const projectError = getProjectError(settings.projectDir);

    if (parsed.error) {
        return createFailure("INVALID_SCHEDULE", parsed.error);
    }

    if (projectError) {
        return createFailure("INVALID_PROJECT", projectError);
    }

    if (!isValidRoundOptions(options) || !POLICY_CHOICES.includes(options.policy)) {
        return createFailure("INVALID_OPTIONS", "모델, Effort, 정책 값이 올바르지 않아요.");
    }

    if (options.policy === "todo" && !options.tasks.trim()) {
        return createFailure("TASKS_REQUIRED", "지시개선은 처리할 작업을 입력해야 예약할 수 있어요.");
    }

    settingsStore.remember(settings.projectDir, options);

    const result = await scheduler.save(payload.schedule);

    return result.error ? createFailure("INVALID_SCHEDULE", result.error) : { status: STATUS_OK, data: scheduler.getPayload() };
};

const handleDeleteSchedule = async (event, id) => {
    await scheduler.remove(String(id));

    return { status: STATUS_OK, data: scheduler.getPayload() };
};

const handleToggleSchedule = async (event, id, enabled) => {
    await scheduler.setEnabled(String(id), enabled);

    return { status: STATUS_OK, data: scheduler.getPayload() };
};

const handleOpenUpdate = async () => {
    const update = updateCheck.getUpdate();

    if (!update) {
        return createFailure("NO_UPDATE", "열 수 있는 새 버전 안내가 없어요.");
    }

    await shell.openExternal(update.url);

    return { status: STATUS_OK };
};

// 진행 기록을 보관하고 초기화한다. 실행 중에는 막는다. 이어갈 내용이 사라지는 일이라 확인은 화면의 모달이 먼저 받는다.
const handleResetProgress = async () => {
    const { projectDir } = readSettings();
    const projectError = getProjectError(projectDir);

    if (projectError) {
        return createFailure("INVALID_PROJECT", projectError);
    }

    if (runner.isRunning()) {
        return createFailure("RUNNING", "실행 중에는 진행 기록을 초기화할 수 없어요.");
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
        return createFailure("INVALID_REPORT", "프로젝트의 .autopilot/progress 안에 있는 리포트만 열 수 있어요.");
    }

    const openError = await shell.openPath(reportFile);

    return openError ? createFailure("OPEN_FAILED", openError) : { status: STATUS_OK };
};

const getActiveLogFile = () => {
    return runner.isRunning() ? runner.getState().logFile : "";
};

// 지난 실행 목록. 프로젝트를 고르지 않았거나 기록 폴더가 없으면 빈 목록이다. 읽지 못하는 로그는 목록에서 읽을 수 없음으로 표시한다.
const handleListRuns = async (event, limit) => {
    const { projectDir } = readSettings();

    if (getProjectError(projectDir)) {
        return { status: STATUS_OK, data: { runs: [] } };
    }

    try {
        const runs = await listRuns(projectDir, { limit: Number.isFinite(limit) ? limit : MAX_RUN_COUNT, activeLogFile: getActiveLogFile() });

        return { status: STATUS_OK, data: { runs: runs } };
    } catch (error) {
        return createFailure("LIST_RUNS_FAILED", `지난 실행 목록을 읽지 못했어요: ${error.message}`);
    }
};

const handleReadRun = async (event, id) => {
    const { projectDir } = readSettings();

    try {
        return { status: STATUS_OK, data: await readRun(projectDir, id, { activeLogFile: getActiveLogFile() }) };
    } catch (error) {
        return createFailure("READ_RUN_FAILED", `기록을 읽지 못했어요: ${error.message}`);
    }
};

// 지난 실행의 리포트나 원본 로그를 연다. 렌더러가 보낸 id는 형식을 검사하고 진행 기록 폴더 안의 파일만 연다.
const handleOpenRunFile = async (event, id, kind) => {
    const { projectDir } = readSettings();
    const files = getRunFiles(projectDir, id);
    const isReport = kind === "report";
    const file = isReport ? files?.reportFile : files?.logFile;

    if (!file || !fs.existsSync(file)) {
        return createFailure(isReport ? "NO_REPORT" : "NO_LOG", isReport ? "열 수 있는 리포트가 없어요." : "열 수 있는 로그가 없어요.");
    }

    if (!(isReport ? isProjectReportFile(projectDir, file) : isProjectLogFile(projectDir, file))) {
        return createFailure("INVALID_FILE", "프로젝트의 .autopilot/progress 안에 있는 기록만 열 수 있어요.");
    }

    const openError = await shell.openPath(file);

    return openError ? createFailure("OPEN_FAILED", openError) : { status: STATUS_OK };
};

// 지난 실행의 로그와 리포트를 지운다. 되돌릴 수 없는 일이라 확인은 화면의 모달이 먼저 받는다.
const handleDeleteRun = async (event, id) => {
    const { projectDir } = readSettings();
    const files = getRunFiles(projectDir, id);

    if (!files) {
        return createFailure("INVALID_RUN", "지울 수 없는 기록이에요.");
    }

    if (getActiveLogFile() && path.resolve(getActiveLogFile()).toLowerCase() === path.resolve(files.logFile).toLowerCase()) {
        return createFailure("RUN_ACTIVE", "진행 중인 실행은 지울 수 없어요.");
    }

    try {
        await deleteRun(projectDir, id, { activeLogFile: getActiveLogFile() });

        return { status: STATUS_OK };
    } catch (error) {
        return createFailure("DELETE_RUN_FAILED", `기록을 지우지 못했어요: ${error.message}`);
    }
};

const registerIpc = () => {
    settingsStore.recover();
    settingsStore.upgrade();
    configureSystem({ getPreferences: readSettings });

    ipcMain.handle("autopilot:get-state", handleGetState);
    ipcMain.handle("autopilot:select-project", handleSelectProject);
    ipcMain.handle("autopilot:start", handleStart);
    ipcMain.handle("autopilot:stop", () => runner.stop());
    ipcMain.handle("autopilot:set-options", handleSetOptions);
    ipcMain.handle("autopilot:update-settings", handleUpdateSettings);
    ipcMain.handle("autopilot:reset-settings", handleResetSettings);
    ipcMain.handle("autopilot:set-preferences", handleSetPreferences);
    ipcMain.handle("autopilot:export-settings", handleExportSettings);
    ipcMain.handle("autopilot:import-settings", handleImportSettings);
    ipcMain.handle("autopilot:restore-defaults", handleRestoreDefaults);
    ipcMain.handle("autopilot:kill", () => runner.kill());
    ipcMain.handle("autopilot:reset-progress", handleResetProgress);
    ipcMain.handle("autopilot:open-report", handleOpenReport);
    ipcMain.handle("autopilot:list-runs", handleListRuns);
    ipcMain.handle("autopilot:read-run", handleReadRun);
    ipcMain.handle("autopilot:open-run-file", handleOpenRunFile);
    ipcMain.handle("autopilot:delete-run", handleDeleteRun);
    ipcMain.handle("autopilot:open-update", handleOpenUpdate);
    ipcMain.handle("autopilot:set-system", handleSetSystem);
    ipcMain.handle("autopilot:get-schedules", () => ({ status: STATUS_OK, data: scheduler.getPayload() }));
    ipcMain.handle("autopilot:save-schedule", handleSaveSchedule);
    ipcMain.handle("autopilot:delete-schedule", handleDeleteSchedule);
    ipcMain.handle("autopilot:toggle-schedule", handleToggleSchedule);
    accounts.register();

    // 로그인 중에 앱이 끝나도 로그인 프로세스가 남지 않게 한다.
    app.on("before-quit", () => accounts.cancelLogin());
};

// 앱이 시작한 엔진이 실행 중인지. 이때 창을 닫으면 트레이로 숨겨 엔진을 계속 돌린다.
const isOwnedEngineRunning = () => {
    return runner.isRunning() && !runner.isAttached();
};

// 앱이 시작한 엔진은 트레이에서 종료할 때 출력이 끊기므로 확인을 받고 강제 종료한다. 연결한 엔진은 앱 소유가 아니라 그대로 두고 닫는다. 닫아도 되면 true를 반환한다.
const confirmClose = (window) => {
    if (!runner.isRunning() || runner.isAttached()) {
        return true;
    }

    const response = dialog.showMessageBoxSync(window, {
        type: "warning",
        title: "AutoPilot",
        message: "AutoPilot이 실행 중이에요.",
        detail: "앱을 종료하면 실행 중인 회차가 강제 종료되고 commit 전 변경은 working tree에 남아요.",
        buttons: ["계속 실행", "강제 종료 후 종료"],
        defaultId: 0,
        cancelId: 0
    });

    if (response === 0) {
        return false;
    }

    runner.kill();

    return true;
};

// 앱을 켤 때 한 번 조회하고 이후 주기적으로 다시 읽는다. 스모크 테스트는 네트워크를 쓰지 않도록 시작하지 않는다.
const startAccountWatch = () => {
    accounts.startWatch();
};

// 예약 판단은 사용량 조회와 실행 시작을 하므로 스모크 테스트에서는 시작하지 않는다. 절전에서 깨어나면 놓친 예약을 바로 살핀다.
const startScheduleWatch = () => {
    scheduler.start();
    powerMonitor.on("resume", () => setTimeout(scheduler.tick, SCHEDULE_RESUME_DELAY_MS));
};

// 새 버전 확인도 네트워크를 쓰므로 스모크 테스트에서는 시작하지 않는다.
const startUpdateWatch = () => {
    updateCheck.start();
};

module.exports = { registerIpc, confirmClose, isOwnedEngineRunning, isTrayResident, syncLaunchAtLogin, attachRunningEngine, checkEngine, startAccountWatch, startUpdateWatch, startScheduleWatch };

const { app, BrowserWindow, dialog, ipcMain, nativeTheme, powerMonitor, shell } = require("electron");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { createRunner, execEngine, parseBuildPhase, MODEL_CHOICES, EFFORT_CHOICES, STATUS_OK, STATUS_FAILED } = require("./autopilotRunner.cjs");
const { getProjectError, canInitGitRepo, initGitRepo, getGitAuthor, createProject, isProjectReportFile, isProjectLogFile, getPhaseDoc, readPhaseDoc } = require("./projectFiles.cjs");
const { createStreakStore } = require("./streakStore.cjs");
const { sanitizeCardContent, getCardFileName, renderCardPng } = require("./shareCard.cjs");
const { listRuns, readRun, deleteRun, getRunFiles, getRunUsage, pruneRuns, MAX_RUN_COUNT } = require("./runHistory.cjs");
const { handleState, notify, showWindow, configure: configureSystem, refreshSleepBlocker } = require("./systemIntegration.cjs");
const { shouldRunPostAction, runPowerAction, createPostAction } = require("./postAction.cjs");
const { createAccountIpc } = require("./accountIpc.cjs");
const { parseLoginExpiryFlag } = require("./claudeAccount.cjs");
const { createUpdateCheck } = require("./updateCheck.cjs");
const loginItem = require("./launchAtLogin.cjs");
const { createScheduler } = require("./scheduler.cjs");
const { parseSchedule } = require("./scheduleRules.cjs");
const { getCliArgs, getEndTimeError, MAX_LINKED_REPOS, AI_PROVIDERS } = require("./engineArgs.cjs");
const { readJsonFile } = require("./jsonFile.cjs");
const { createSettingsStore, getProjectKey, ACCOUNT_KEY, LINKED_REPOS_KEY, SETTING_VALIDATORS, OVERRIDABLE_KEYS, PREFERENCE_KEYS, POLICY_CHOICES, MAX_TABS } = require("./settingsStore.cjs");
const { createSessionPool } = require("./sessionPool.cjs");
const { askClaude, getCodexStatus } = require("./claudeCli.cjs");
const { getDraftPrompt, parseDraft, getExamplesPrompt, parseExamples, PLATFORM_KEYS, MAX_WHAT_LENGTH } = require("./projectDraft.cjs");

const ENGINE_HELP_TIMEOUT_MS = 10000;
// 절전에서 깨면 네트워크가 올라올 때까지 잠시 기다린 뒤 판단한다.
const SCHEDULE_RESUME_DELAY_MS = 5000;
const TASKS_FILE_NAME = "tasks.md";
const SETTINGS_FILE_FILTERS = [{ name: "AutoPilot 설정", extensions: ["json"] }];
const MAX_SETTINGS_IMPORT_BYTES = 2 * 1024 * 1024;

// 끝난 실행 뒤 PC를 절전·종료하기 전에 취소할 수 있게 기다리는 시간
const POST_ACTION_DELAY_MS = 60 * 1000;
const SETTINGS_SCOPES = ["global", "project"];
// 값이 올바르지 않을 때 입력 줄이 보여줄 이유. 없는 키는 일반 문구를 쓴다.
const SETTING_ERROR_MESSAGES = {
    commitPrefix: "커밋 접두어는 앞뒤 공백·백틱·제어 문자가 없는 1~20자여야 해요.",
    workBranch: "작업 브랜치는 영문·숫자·._-/로 된 git 브랜치 이름이어야 하고 main·master는 쓸 수 없어요."
};

const settingsStore = createSettingsStore({ dir: app.getPath("userData") });
// 계정·시스템·선택한 프로젝트처럼 전역에만 있는 값과 전역 기본값. 프로젝트마다 달라지는 값은 readEffective로 읽는다.
const readSettings = settingsStore.read;
const writeSettings = settingsStore.write;
const updateSettings = settingsStore.update;
// 프로젝트(생략하면 활성 프로젝트)가 덮어쓴 값을 전역 값 위에 얹은 설정. 프로젝트가 없으면 전역 값이다.
const readEffective = (projectDir) => settingsStore.resolve(projectDir).settings;

// 화면이 설정을 그리는 데 필요한 것: 적용되는 값, 프로젝트가 덮어쓴 키, 전역 기본값, 한 번 알릴 안내.
const getSettingsView = (projectDir) => {
    return { ...settingsStore.resolve(projectDir), notice: settingsStore.takeNotice() };
};

// 예약은 전역 목록과 선택한 프로젝트의 목록을 합쳐 보여준다(덮어쓰기가 아니라 합침). 목록에서는 scope로 어느 쪽인지 구분하고, 저장할 때 다시 나눈다.
const readAllSchedules = () => {
    const { tabs, schedules } = readSettings();
    const projectSchedules = tabs.flatMap((projectDir) => (settingsStore.readProject(projectDir).schedules ?? []).map((schedule) => ({ ...schedule, scope: "project", projectDir: projectDir })));

    return [...schedules.map((schedule) => ({ ...schedule, scope: "global" })), ...projectSchedules];
};

// 프로젝트 예약은 projectDir이 가리키는 열린 탭의 프로젝트 파일에 나눠 쓴다(projectDir이 없는 항목은 활성 탭의 것이다).
const writeAllSchedules = (list) => {
    const { tabs, projectDir: activeDir } = readSettings();

    updateSettings({ schedules: list.filter((schedule) => schedule.scope !== "project") });

    for (const projectDir of tabs) {
        const mine = list.filter((schedule) => schedule.scope === "project" && getSessionKey(schedule.projectDir || activeDir) === getSessionKey(projectDir));

        if (mine.length > 0 || (settingsStore.readProject(projectDir).schedules ?? []).length > 0) {
            settingsStore.updateProject(projectDir, { schedules: mine });
        }
    }
};

// 프로젝트 예약은 그 프로젝트에서, 전역 예약은 그때 활성인 탭의 프로젝트에서 돈다.
const getScheduleDir = (schedule) => {
    return schedule.scope === "project" && schedule.projectDir ? schedule.projectDir : getActiveDir();
};

// 다른 프로젝트를 골라 목록에서 빠져 있는 예약도 판단 상태(마지막 시작 등)는 남겨 둔다.
const getKnownScheduleIds = () => {
    return [...readSettings().schedules, ...settingsStore.listProjects().flatMap((project) => project.overrides.schedules ?? [])].map((schedule) => schedule.id);
};

const createFailure = (code, msg) => {
    return { status: STATUS_FAILED, error: { code: code, msg: msg } };
};

const createNoSessionFailure = () => {
    return createFailure("INVALID_PROJECT", "열려 있는 프로젝트가 아니에요.");
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

// 회차를 돌리는 에이전트와 Codex의 model·effort(Codex가 회차를 돌리거나 브레인스토밍할 때 쓴다)
const AGENT_KEYS = ["runner", "codexModel", "codexEffort"];

const isValidAgentOptions = (options) => {
    return AGENT_KEYS.every((key) => SETTING_VALIDATORS[key](options[key]));
};

// 작업 모드·신규 개발 설정과 실행 에이전트. 렌더러가 보낸 값 중 이 키만 받고, 없는 키는 fallback(저장된 값)을 쓴다.
const MODE_KEYS = ["mode", "gates", "allow", "designFormat", "qaOnFail", "securityOnFail", "brainstorm", "crossReview", "debate", "debateTurns", ...AGENT_KEYS];

const pickModeOptions = (source, fallback) => {
    return Object.fromEntries(MODE_KEYS.map((key) => [key, source[key] === undefined ? fallback[key] : source[key]]));
};

const isValidModeOptions = (options) => {
    return MODE_KEYS.every((key) => SETTING_VALIDATORS[key](options[key]));
};

// 엔진 status가 알려주는 신규 개발 단계 상태({phase, awaiting, qaRetries, securityRetries}). 신규 개발을 한 적 없거나 읽지 못하면 null이다.
const readBuildPhase = (projectDir) => {
    return new Promise((resolve) => {
        execEngine({ ...getEngineLaunch(), projectDir: projectDir }, "status", [], (error, stdout) => {
            resolve(error ? null : parseBuildPhase(stdout));
        });
    });
};

// 신규 개발을 시작할 수 있는지. 기획(또는 돌려보낸 기획)은 만들 것이 있어야 하고, 예약은 확인을 기다리는 단계를 대신 다시 하지 않는다.
const getBuildStartError = (buildPhase, tasks, isScheduled) => {
    if (buildPhase?.phase === "done") {
        return createFailure("BUILD_DONE", "신규 개발의 모든 단계를 마쳤어요. 진행 기록을 초기화하면 기획부터 다시 시작해요.");
    }

    if (isScheduled && buildPhase?.awaiting) {
        return createFailure("PHASE_AWAITING", "신규 개발이 단계 확인을 기다리고 있어 예약을 건너뛰었어요.");
    }

    const startPhase = buildPhase?.awaiting || buildPhase?.phase || "plan";

    return startPhase === "plan" && !tasks.trim() ? createFailure("TASKS_REQUIRED", "신규 개발은 만들 것을 적어야 시작할 수 있어요.") : null;
};

const resolveModel = (family, modelVersions) => {
    return modelVersions[family] || family;
};

const broadcast = (channel, payload) => {
    for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) {
            window.webContents.send(channel, payload);
        }
    }
};

// 앱이 시작한 실행이 스스로 끝나면 설정에 따라 PC를 절전·종료한다. 곧바로 하지 않고 창을 띄워 알린 뒤 기다리며, 그 안에 취소할 수 있다.
const postAction = createPostAction({
    delayMs: POST_ACTION_DELAY_MS,
    run: async (action) => {
        const error = await runPowerAction(process.platform, action);

        if (error) {
            broadcast("autopilot:post-action", { pending: null, error: `PC를 ${action === "sleep" ? "절전" : "종료"}하지 못했어요: ${error}` });
        }
    },
    onChange: (pending) => broadcast("autopilot:post-action", { pending: pending, error: "" })
});

const watchPostAction = (session, state) => {
    const isActive = state.status === "running" || state.status === "stopping";

    if (isActive) {
        session.isRunOwned = !state.attached;
        postAction.cancel();
    }

    if (!isActive && (session.previousStatus === "running" || session.previousStatus === "stopping")) {
        const action = readSettings().postRunAction;

        const hasOtherActive = sessionPool.getAll().some((other) => other !== session && other.runner.isRunning());

        if (shouldRunPostAction({ previousStatus: session.previousStatus, state: state, action: action, isOwned: session.isRunOwned, hasOtherActive: hasOtherActive })) {
            showWindow();
            postAction.start(action);
        }
    }

    session.previousStatus = state.status;
};

// 프로젝트 하나의 실행 세션. 러너와 함께 시작·재연결 진행 여부, 직전 상태를 프로젝트마다 따로 갖는다.
const createSession = (projectDir) => {
    const session = { projectDir: projectDir, runner: null, isLaunching: false, isCheckingEngine: false, previousStatus: "idle", isRunOwned: false, tabStatus: "idle" };

    session.runner = createRunner({
        onLog: (entries) => broadcast("autopilot:log", { projectDir: session.projectDir, entries: entries }),
        onState: (state) => {
            broadcast("autopilot:state", { projectDir: session.projectDir, state: state });
            handleState(session.projectDir, state, { getProjectName: () => (readSettings().tabs.length > 1 ? path.basename(session.projectDir) : "") });
            watchPostAction(session, state);

            if (state.status !== session.tabStatus) {
                session.tabStatus = state.status;
                broadcastTabs();
            }
        }
    });

    return session;
};

const getActiveDir = () => readSettings().projectDir;

const getSessionKey = (projectDir) => (projectDir ? getProjectKey(projectDir) : "");
const sessionPool = createSessionPool({
    getKey: getSessionKey,
    getActiveDir: getActiveDir,
    getOpenDirs: () => readSettings().tabs,
    createSession: createSession
});
const isAnyRunning = () => sessionPool.getAll().some((session) => session.runner.isRunning());
const isProjectRunning = (projectDir) => Boolean(sessionPool.get(projectDir)?.runner.isRunning());

// 프로젝트(탭)가 고른 계정. 고르지 않았으면 전역 계정을 따른다. 프로젝트가 없으면 전역에 저장한다.
// 열린 탭과 각 탭의 실행 상태(status), 신규 개발이면 모드와 지금 단계(mode "build"·step "plan" 등, 없으면 빈 문자열). 화면은 이 요약으로 레일의 프로젝트 목록을 그린다(탭 이름은 폴더 이름).
const getTabsPayload = () => {
    const { tabs, projectDir } = readSettings();

    return {
        active: projectDir,
        tabs: tabs.map((dir) => {
            const state = sessionPool.get(dir)?.runner.getState();

            return { projectDir: dir, name: path.basename(dir), status: state?.status ?? "idle", mode: state?.mode ?? "", step: state?.step?.phase ?? "" };
        })
    };
};

let lastTabsKey = "";

const broadcastTabs = ({ force = false } = {}) => {
    const payload = getTabsPayload();
    const key = JSON.stringify(payload);

    if (force || key !== lastTabsKey) {
        lastTabsKey = key;
        broadcast("autopilot:tabs", payload);
    }

    return payload;
};

const getAccountId = (projectDir) => readEffective(projectDir).accountId;
const setAccountId = (projectDir, accountId) => {
    if (projectDir) {
        settingsStore.updateProject(projectDir, { [ACCOUNT_KEY]: accountId });
    } else {
        updateSettings({ accountId: accountId });
    }
};

// --debug-login-expiry는 만료 화면을 보는 개발용이라 패키지 앱에서는 읽지 않는다.
const accounts = createAccountIpc({
    readSettings: readSettings,
    writeSettings: writeSettings,
    getAccountId: getAccountId,
    setAccountId: setAccountId,
    resolveProjectDir: (requestedDir) => sessionPool.get(requestedDir)?.projectDir ?? null,
    broadcast: broadcast,
    isRunning: isAnyRunning,
    isProjectRunning: isProjectRunning,
    loginExpiresAtOverride: app.isPackaged ? 0 : parseLoginExpiryFlag(process.argv)
});

const updateCheck = createUpdateCheck({ currentVersion: app.getVersion(), onChange: (update) => broadcast("autopilot:update", update), isEnabled: () => readSettings().checkUpdates });

// 예약이 조건을 만족하면 마지막으로 저장한 작업·정책·모델·Effort로 시작한다. 종료 시각은 예약이 정한 값이라 다음 시작의 기본값으로 저장하지 않는다.
const startScheduledRun = async (schedule, plan) => {
    try {
        const session = sessionPool.get(getScheduleDir(schedule));

        if (!session) {
            return { ok: false, message: "예약한 프로젝트가 열려 있지 않아요." };
        }

        const settings = readEffective(session.projectDir);
        const result = await launchRun(
            session,
            settings,
            {
                tasks: settings.tasks,
                endTime: plan.endTime,
                policy: settings.policy,
                extendOnLimit: settings.extendOnLimit,
                model: settings.model,
                effort: settings.effort,
                ...pickModeOptions({}, settings)
            },
            { remember: false, isScheduled: true }
        );

        return result.status === STATUS_OK ? { ok: true, message: `조건이 맞아서 ${plan.endTime}까지 실행을 시작했어요.` } : { ok: false, message: result.error.msg };
    } catch (error) {
        return { ok: false, message: error.message };
    }
};

// 엔진은 저장소를 폴더 이름으로 구분하므로 작업 프로젝트·이미 연결한 저장소와 같은 폴더이거나 폴더 이름이 겹치면 연결할 수 없다.
const getLinkedRepoError = (repoDir, usedDirs) => {
    const projectError = getProjectError(repoDir);

    if (projectError) {
        return projectError;
    }

    if (usedDirs.some((usedDir) => getProjectKey(usedDir) === getProjectKey(repoDir))) {
        return "작업 프로젝트나 이미 연결한 저장소예요.";
    }

    return usedDirs.some((usedDir) => path.basename(usedDir).toLowerCase() === path.basename(repoDir).toLowerCase())
        ? "폴더 이름이 작업 프로젝트나 다른 연결 저장소와 같아요. 이름이 다른 폴더만 연결할 수 있어요."
        : "";
};

// 이 프로젝트에 연결할 저장소 폴더를 골라 더한다. 작업 프로젝트를 빼고 MAX_LINKED_REPOS개까지다.
const handleAddLinkedRepo = async (event, requestedDir) => {
    const session = sessionPool.get(requestedDir);

    if (!session?.projectDir) {
        return createNoSessionFailure();
    }

    if (session.runner.isRunning() || session.isLaunching) {
        return createFailure("RUNNING", "실행 중에는 연결 저장소를 바꿀 수 없어요.");
    }

    const { projectDir } = session;
    const linkedRepos = readEffective(projectDir).linkedRepos;

    if (linkedRepos.length >= MAX_LINKED_REPOS) {
        return createFailure("TOO_MANY_REPOS", `연결 저장소는 작업 프로젝트를 빼고 ${MAX_LINKED_REPOS}개까지, 모두 합쳐 ${MAX_LINKED_REPOS + 1}개까지 쓸 수 있어요.`);
    }

    const selection = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
        title: "연결할 저장소 폴더 선택",
        defaultPath: path.dirname(projectDir),
        properties: ["openDirectory"]
    });

    if (selection.canceled) {
        return { status: STATUS_OK, data: getSettingsView(projectDir) };
    }

    const repoError = getLinkedRepoError(selection.filePaths[0], [projectDir, ...linkedRepos]);

    if (repoError) {
        return createFailure("INVALID_PROJECT", repoError);
    }

    settingsStore.updateProject(projectDir, { [LINKED_REPOS_KEY]: [...linkedRepos, selection.filePaths[0]] });

    return { status: STATUS_OK, data: getSettingsView(projectDir) };
};

const handleRemoveLinkedRepo = (event, repoDir, requestedDir) => {
    const session = sessionPool.get(requestedDir);

    if (!session?.projectDir) {
        return createNoSessionFailure();
    }

    if (session.runner.isRunning() || session.isLaunching) {
        return createFailure("RUNNING", "실행 중에는 연결 저장소를 바꿀 수 없어요.");
    }

    const { projectDir } = session;
    const linkedRepos = readEffective(projectDir).linkedRepos;

    settingsStore.updateProject(projectDir, { [LINKED_REPOS_KEY]: linkedRepos.filter((linkedRepo) => linkedRepo !== repoDir) });

    return { status: STATUS_OK, data: getSettingsView(projectDir) };
};

// 앱을 닫았다 켠 사이에 계속 실행된 엔진이 있으면 먼저 연결해 둔다. 모르고 두 번째 엔진을 시작하지 않게 하기 위해서다.
const isEngineBusy = async (schedule) => {
    const projectDir = getScheduleDir(schedule);

    await attachRunningEngine(projectDir);

    const session = sessionPool.get(projectDir);

    return !session || session.runner.isRunning() || session.isLaunching;
};

const scheduler = createScheduler({
    stateFile: path.join(app.getPath("userData"), "schedule-state.json"),
    readSchedules: readAllSchedules,
    writeSchedules: writeAllSchedules,
    getKnownIds: getKnownScheduleIds,
    getUsage: (schedule) => accounts.getActiveUsage(getScheduleDir(schedule)),
    refreshUsage: (schedule) => accounts.refreshActiveUsage(getScheduleDir(schedule)),
    getTargetKey: (schedule) => getSessionKey(getScheduleDir(schedule)),
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

    if (!isValidRoundOptions(options) || !POLICY_CHOICES.includes(options.policy) || !isValidModeOptions(options)) {
        return createFailure("INVALID_OPTIONS", "모델, Effort, 정책, 작업 모드 값이 올바르지 않아요.");
    }

    const endTimeError = getEndTimeError(options.endTime);

    if (endTimeError) {
        return createFailure("INVALID_END_TIME", endTimeError);
    }

    if (options.mode !== "build" && options.policy === "todo" && !options.tasks.trim()) {
        return createFailure("TASKS_REQUIRED", "지시개선은 처리할 작업을 입력해야 시작할 수 있어요.");
    }

    return null;
};

// 수동 시작과 예약 시작이 함께 쓰는 시작 절차. remember가 참이면 쓴 값을 다음 시작의 기본값으로 저장한다(날짜를 붙인 종료 시각은 빼고).
const launchRun = async (session, settings, startOptions, { remember, keepTasks = false, isScheduled = false }) => {
    if (!session) {
        return createNoSessionFailure();
    }

    const startError = getStartError(settings, startOptions);

    if (startError) {
        return startError;
    }

    session.isLaunching = true;

    try {
        const runAccount = await accounts.getRunAccount(session.projectDir);

        if (runAccount.status !== STATUS_OK) {
            return runAccount;
        }

        const brokenRepo = settings.linkedRepos.find((repoDir) => getProjectError(repoDir));

        if (brokenRepo) {
            return createFailure("INVALID_PROJECT", `연결 저장소를 쓸 수 없어요 (${brokenRepo}): ${getProjectError(brokenRepo)}`);
        }

        if (startOptions.mode === "build") {
            const buildError = getBuildStartError(await readBuildPhase(settings.projectDir), startOptions.tasks, isScheduled);

            if (buildError) {
                return buildError;
            }
        }

        // 작업은 긴 텍스트라 인자로 넘기지 않고 파일로 전달한다. 엔진이 시작할 때 한 번 읽는다.
        const tasksFile = path.join(app.getPath("userData"), TASKS_FILE_NAME);

        fs.mkdirSync(app.getPath("userData"), { recursive: true });
        fs.writeFileSync(tasksFile, startOptions.tasks, "utf8");

        // 날짜를 붙인 종료 시각과 단계 수정 요청(keepTasks, 작업 칸의 만들 것을 지키려고)은 다음 시작의 기본값으로 저장하지 않는다.
        if (remember) {
            const { endTime, tasks, ...otherOptions } = startOptions;

            settingsStore.remember(settings.projectDir, { ...otherOptions, ...(!endTime.includes(" ") && { endTime: endTime }), ...(!keepTasks && { tasks: tasks }) });
        }

        const model = resolveModel(startOptions.model, settings.modelVersions);

        return await session.runner.start({
            ...getEngineLaunch(),
            projectDir: settings.projectDir,
            args: getCliArgs({
                ...startOptions,
                extendLimitMinutes: settings.extendLimitMinutes,
                commitPrefix: settings.commitPrefix,
                workBranch: settings.workBranch,
                logRetentionDays: settings.logRetentionDays,
                linkedRepos: settings.linkedRepos,
                model: model,
                projectDir: settings.projectDir,
                tasksFile: tasksFile,
                configDir: runAccount.data.configDir
            }),
            roundOptions: { model: model, effort: startOptions.effort, runner: startOptions.runner, codexModel: startOptions.codexModel, codexEffort: startOptions.codexEffort }
        });
    } finally {
        session.isLaunching = false;
    }
};

const handleStart = async (event, options = {}) => {
    const session = sessionPool.get(options.projectDir);

    return launchRun(
        session,
        readEffective(session?.projectDir),
        {
            tasks: typeof options.tasks === "string" ? options.tasks : "",
            endTime: String(options.endTime || ""),
            policy: options.policy,
            extendOnLimit: options.extendOnLimit === true,
            model: options.model,
            effort: options.effort,
            ...pickModeOptions(options, readEffective(session?.projectDir))
        },
        { remember: true, keepTasks: options.keepTasks === true }
    );
};

// 실행 중인 엔진에 다음 회차부터 쓸 실행 에이전트와 Claude·Codex의 model·effort를 전달하고, 성공하면 다음 시작의 기본값으로도 저장한다.
const handleSetOptions = async (event, options = {}) => {
    if (!isValidRoundOptions(options) || !isValidAgentOptions(options)) {
        return createFailure("INVALID_OPTIONS", "모델 또는 Effort 값이 올바르지 않아요.");
    }

    const session = sessionPool.get(options.projectDir);

    if (!session) {
        return createNoSessionFailure();
    }

    const settings = readEffective(session.projectDir);
    const agentOptions = Object.fromEntries(AGENT_KEYS.map((key) => [key, options[key]]));
    const result = await session.runner.setRoundOptions({ model: resolveModel(options.model, settings.modelVersions), effort: options.effort, ...agentOptions });

    if (result.status === STATUS_OK) {
        settingsStore.remember(settings.projectDir, { model: options.model, effort: options.effort, ...agentOptions });
    }

    return result;
};

// 설정 패널에서 바꾼 값을 전역 기본값(global)이나 선택한 프로젝트의 덮어쓰기(project)로 저장한다. 실행 중에는 바꾸지 않는다.
const handleUpdateSettings = (event, request = {}) => {
    const { scope, patch } = request;
    const keys = patch && typeof patch === "object" ? Object.keys(patch) : [];
    const session = sessionPool.get(request.projectDir);

    if (!session) {
        return createNoSessionFailure();
    }

    if (session.runner.isRunning()) {
        return createFailure("RUNNING", "실행 중에는 설정을 바꿀 수 없어요.");
    }

    if (!SETTINGS_SCOPES.includes(scope) || keys.length === 0 || !keys.every((key) => OVERRIDABLE_KEYS.includes(key) && SETTING_VALIDATORS[key](patch[key]))) {
        const invalidKey = keys.find((key) => !OVERRIDABLE_KEYS.includes(key) || !SETTING_VALIDATORS[key](patch[key]));

        return createFailure("INVALID_OPTIONS", SETTING_ERROR_MESSAGES[invalidKey] || "설정 범위나 값이 올바르지 않아요.");
    }

    const { projectDir } = session;

    if (scope === "project" && !projectDir) {
        return createFailure("INVALID_PROJECT", "프로젝트를 먼저 선택해 주세요.");
    }

    if (scope === "project") {
        settingsStore.updateProject(projectDir, patch);
    } else {
        updateSettings(patch);
    }

    return { status: STATUS_OK, data: getSettingsView(projectDir) };
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

// 마친 실행의 성과 카드를 PNG로 저장한다. 저장할 곳을 먼저 받고(취소하면 그리지 않는다) 숨긴 창에 그려 파일로 쓴다.
const handleSaveCard = async (event, payload = {}) => {
    const content = sanitizeCardContent(payload.content);

    if (!content) {
        return createFailure("INVALID_CARD", "카드에 담을 문장이 없어요.");
    }

    const selection = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), {
        title: "성과 카드 저장",
        defaultPath: path.join(app.getPath("pictures"), getCardFileName(payload.projectName, Date.now())),
        filters: [{ name: "PNG 이미지", extensions: ["png"] }]
    });

    if (selection.canceled || !selection.filePath) {
        return { status: STATUS_OK, data: { canceled: true } };
    }

    try {
        const file = /\.png$/i.test(selection.filePath) ? selection.filePath : `${selection.filePath}.png`;

        await fs.promises.writeFile(file, await renderCardPng(content));

        return { status: STATUS_OK, data: { canceled: false, file: file } };
    } catch (error) {
        return createFailure("CARD_FAILED", `카드를 저장하지 못했어요: ${error.message}`);
    }
};

// 내보낸 파일의 설정으로 덮어쓴다. 프로젝트별 설정은 이 PC에 있는 Git 저장소 루트만 적용한다. 덮어쓰는 일이라 확인은 화면의 모달이 먼저 받는다.
const handleImportSettings = async (event) => {
    if (isAnyRunning()) {
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

    applyPreferenceChanges();

    return { status: STATUS_OK, data: { canceled: false, ...getSettingsView(), keyCount: result.keyCount, projectCount: result.projectCount, skippedCount: result.skippedCount } };
};

// 기본값으로 되돌린다. 계정·Claude 데이터 폴더·선택한 프로젝트·자동 실행·예약은 그대로 두고 프로젝트별 설정은 지운다. 확인은 화면의 모달이 먼저 받는다.
const handleRestoreDefaults = () => {
    if (isAnyRunning()) {
        return createFailure("RUNNING", "실행 중에는 설정을 되돌릴 수 없어요.");
    }

    settingsStore.resetPreferences();
    applyPreferenceChanges();

    return { status: STATUS_OK, data: getSettingsView() };
};

// 화면이 그려지기 전에 비치는 창 바탕색. 화면 바탕(--page)과 같다.
const WINDOW_BACKGROUNDS = { light: "#f4f6fa", dark: "#0e131d" };

const getWindowBackground = () => {
    return nativeTheme.shouldUseDarkColors ? WINDOW_BACKGROUNDS.dark : WINDOW_BACKGROUNDS.light;
};

// 테마는 nativeTheme이 정한다. 화면의 prefers-color-scheme·스크롤 막대·입력 칸과 창 바탕이 함께 따라간다.
const applyTheme = () => {
    nativeTheme.themeSource = readSettings().theme;

    for (const window of BrowserWindow.getAllWindows()) {
        window.setBackgroundColor(getWindowBackground());
    }
};

// 환경설정이 바뀌면 바로 반영한다. 새 버전 확인은 켜면 지금 확인하고 끄면 알고 있던 안내를 거두고, 절전 방지는 실행 중이어도 다시 판단한다.
const applyPreferenceChanges = () => {
    updateCheck.check();
    refreshSleepBlocker();
    applyTheme();
};

// 알림처럼 실행과 무관하게 언제든 바꾸는 전역 환경설정을 저장한다.
const handleSetPreferences = (event, patch) => {
    const keys = patch && typeof patch === "object" ? Object.keys(patch) : [];

    if (keys.length === 0 || !keys.every((key) => PREFERENCE_KEYS.includes(key) && SETTING_VALIDATORS[key](patch[key]))) {
        return createFailure("INVALID_OPTIONS", "환경설정 값이 올바르지 않아요.");
    }

    updateSettings(patch);

    // 레일 너비는 화면에만 닿는다. 끌 때마다 새 버전 확인(네트워크)을 다시 하지 않는다.
    if (keys.some((key) => key !== "railWidth")) {
        applyPreferenceChanges();
    }

    return { status: STATUS_OK, data: getSettingsView() };
};

// 선택한 프로젝트가 덮어쓴 값을 지워 전역 값을 따라가게 한다.
const handleResetSettings = (event, keys, requestedDir) => {
    const session = sessionPool.get(requestedDir);

    if (!session) {
        return createNoSessionFailure();
    }

    const { projectDir } = session;

    if (session.runner.isRunning()) {
        return createFailure("RUNNING", "실행 중에는 설정을 바꿀 수 없어요.");
    }

    if (!Array.isArray(keys) || keys.length === 0 || !keys.every((key) => OVERRIDABLE_KEYS.includes(key))) {
        return createFailure("INVALID_OPTIONS", "되돌릴 설정이 올바르지 않아요.");
    }

    if (!projectDir) {
        return createFailure("INVALID_PROJECT", "프로젝트를 먼저 선택해 주세요.");
    }

    settingsStore.clearProject(projectDir, keys);

    return { status: STATUS_OK, data: getSettingsView(projectDir) };
};

// 앱을 닫았다 켠 사이에 계속 실행된 엔진이 프로젝트(생략하면 활성 프로젝트)에 있으면 연결한다. 연결 상태는 state 이벤트로 화면에 전달된다.
const attachRunningEngine = async (requestedDir) => {
    const session = sessionPool.get(requestedDir);

    if (!session || session.isCheckingEngine || session.runner.isRunning() || getProjectError(session.projectDir)) {
        return;
    }

    session.isCheckingEngine = true;

    try {
        await session.runner.attachIfRunning({ ...getEngineLaunch(), projectDir: session.projectDir });
    } finally {
        session.isCheckingEngine = false;
    }
};

// 열려 있는 모든 탭의 프로젝트에서 계속 실행 중인 엔진에 연결한다(창에 포커스가 올 때).
const attachRunningEngines = async () => {
    await Promise.all(readSettings().tabs.map((projectDir) => attachRunningEngine(projectDir)));
};

// 보는 프로젝트가 바뀐 뒤 화면이 받을 것. 계정은 프로젝트마다 달라 선택한 계정도 바뀔 수 있어 다시 보내고, 계속 실행 중인 엔진에는 연결한다.
// 연결하는 동안 나간 이벤트는 렌더러가 아직 이전 프로젝트를 보고 있어 버리므로, 응답에 새 프로젝트의 지금 상태와 로그를 담는다(응답 뒤의 이벤트는 반영된다).
const getSwitchResult = async (session, extra = {}) => {
    accounts.broadcastPayload();

    await attachRunningEngine(session.projectDir);

    return { status: STATUS_OK, data: { ...getSettingsView(), ...extra, tabs: broadcastTabs({ force: true }), state: session.runner.getState(), logs: session.runner.getLogs() } };
};

// 사용자가 방금 대화상자로 고른, .git이 없는 폴더와 그 폴더로 하려던 일(select·tab). 렌더러는 경로를 보내지 않고 이 폴더에만 새 저장소를 만들 수 있다.
let pendingGitInit = null;

// 고른 폴더를 쓸 수 없으면 실패를 돌려준다. .git이 없는 폴더면 새 저장소를 만들지 화면이 묻도록 NOT_GIT_REPO로 알리고 그 폴더를 기억한다.
const getSelectionFailure = (selectedDir, kind) => {
    const projectError = getProjectError(selectedDir);

    if (!projectError) {
        return null;
    }

    if (!canInitGitRepo(selectedDir)) {
        return createFailure("INVALID_PROJECT", projectError);
    }

    pendingGitInit = { dir: selectedDir, kind: kind };

    return { ...createFailure("NOT_GIT_REPO", "Git 저장소가 아니에요. 여기에 새 저장소를 만들 수 있어요."), data: { projectDir: selectedDir } };
};

// 이미 열린 프로젝트면 새 탭을 만들지 않고 그 탭으로 가고, 아니면 지금 탭의 프로젝트를 바꾼다. 이벤트의 projectDir과 화면이 보는 projectDir은 탭에 저장된 같은 문자열이다.
const selectProjectDir = (selectedDir) => {
    const settings = readSettings();
    const opened = settingsStore.openTab(selectedDir, { replaceDir: settings.projectDir });

    if (opened.error) {
        return createFailure("TOO_MANY_TABS", opened.error);
    }

    // 바뀐 탭의 이전 프로젝트는 더 열려 있지 않으므로 세션을 버린다.
    if (!opened.existing && settings.projectDir) {
        sessionPool.close(settings.projectDir);
    }

    return getSwitchResult(sessionPool.open(opened.projectDir), { existing: opened.existing });
};

const openTabDir = (selectedDir) => {
    const opened = settingsStore.openTab(selectedDir);

    if (opened.error) {
        return createFailure("TOO_MANY_TABS", opened.error);
    }

    return getSwitchResult(sessionPool.open(opened.projectDir), { existing: opened.existing });
};

const handleSelectProject = async (event) => {
    if (sessionPool.get().runner.isRunning()) {
        return createFailure("RUNNING", "실행 중에는 프로젝트를 바꿀 수 없어요.");
    }

    const window = BrowserWindow.fromWebContents(event.sender);
    const selection = await dialog.showOpenDialog(window, {
        title: "대상 프로젝트 폴더 선택",
        defaultPath: readSettings().projectDir || undefined,
        properties: ["openDirectory"]
    });

    pendingGitInit = null;

    if (selection.canceled) {
        return { status: STATUS_OK, data: getSettingsView() };
    }

    return getSelectionFailure(selection.filePaths[0], "select") || selectProjectDir(selection.filePaths[0]);
};

// 폴더를 골라 새 탭으로 연다. 이미 열린 프로젝트면 새 탭 없이 그 탭으로 간다.
const handleOpenTab = async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const selection = await dialog.showOpenDialog(window, {
        title: "프로젝트 탭으로 열 폴더 선택",
        defaultPath: readSettings().projectDir || undefined,
        properties: ["openDirectory"]
    });

    pendingGitInit = null;

    if (selection.canceled) {
        return { status: STATUS_OK, data: { ...getSettingsView(), canceled: true, tabs: getTabsPayload() } };
    }

    return getSelectionFailure(selection.filePaths[0], "tab") || openTabDir(selection.filePaths[0]);
};

// 화면이 사용자 확인을 받은 뒤 방금 고른 폴더에 새 저장소를 만들고, 하려던 일(프로젝트 바꾸기·새 탭)을 이어간다.
const handleInitGitRepo = async () => {
    const pending = pendingGitInit;

    pendingGitInit = null;

    if (!pending || !canInitGitRepo(pending.dir)) {
        return createFailure("INVALID_PROJECT", "새 저장소를 만들 폴더를 다시 골라 주세요.");
    }

    if (pending.kind === "select" && sessionPool.get().runner.isRunning()) {
        return createFailure("RUNNING", "실행 중에는 프로젝트를 바꿀 수 없어요.");
    }

    const initError = await initGitRepo(pending.dir);

    if (initError) {
        return createFailure("GIT_INIT_FAILED", `새 저장소를 만들지 못했어요: ${initError}`);
    }

    return pending.kind === "select" ? selectProjectDir(pending.dir) : openTabDir(pending.dir);
};

// 새 프로젝트를 만들 상위 폴더. 이번 실행에서 대화상자로 고른 폴더, 없으면 마지막으로 만든 위치, 없으면 문서 폴더다. 렌더러는 경로를 보내지 않는다.
let pickedCreateParent = "";

const getCreateParentDir = () => {
    const saved = readSettings().createParentDir;

    return pickedCreateParent || (saved && fs.existsSync(saved) ? saved : app.getPath("documents"));
};

const handleGetCreateInfo = async () => {
    return { status: STATUS_OK, data: { parentDir: getCreateParentDir(), author: await getGitAuthor() } };
};

const handlePickCreateDir = async (event) => {
    const selection = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
        title: "새 프로젝트를 만들 위치 선택",
        defaultPath: getCreateParentDir(),
        properties: ["openDirectory", "createDirectory"]
    });

    if (!selection.canceled) {
        pickedCreateParent = selection.filePaths[0];
    }

    return { status: STATUS_OK, data: { parentDir: getCreateParentDir(), canceled: selection.canceled } };
};

// 진행 중인 초안 요청. 한 번에 하나만 두고 새 요청이나 취소가 오면 앞의 것을 끝낸다.
let draftRequest = null;

const handleCancelDraft = () => {
    draftRequest?.cancel();
    draftRequest = null;

    return { status: STATUS_OK };
};

// 한두 줄 설명으로 Claude에게 초안(이름·요약·사용자·기능·하지 않을 것·기술 스택)을 받는다. 답은 parseDraft가 다듬은 값만 돌려준다.
const handleDraftProject = async (event, request = {}) => {
    const what = typeof request.what === "string" ? request.what.slice(0, MAX_WHAT_LENGTH) : "";
    const platforms = Array.isArray(request.platforms) ? request.platforms.filter((key) => PLATFORM_KEYS.includes(key)) : [];

    if (!what.trim()) {
        return createFailure("INVALID_DRAFT", "무엇을 만들고 싶은지 적어 주세요.");
    }

    handleCancelDraft();

    const account = await accounts.getDraftAccount();

    if (account.status !== STATUS_OK) {
        return account;
    }

    const ask = askClaude(account.data.configDir, getDraftPrompt({ what: what, platforms: platforms }));

    draftRequest = ask;

    const result = await ask.promise;

    if (draftRequest === ask) {
        draftRequest = null;
    }

    if (result.cancelled) {
        return createFailure("CANCELED", "초안 만들기를 그만뒀어요.");
    }

    if (result.error) {
        return createFailure("DRAFT_FAILED", `Claude가 초안을 쓰지 못했어요. ${result.error}`);
    }

    const draft = parseDraft(result.text);

    return draft ? { status: STATUS_OK, data: { draft: draft } } : createFailure("DRAFT_INVALID", "Claude의 초안을 읽지 못했어요.");
};

// 새 프로젝트 화면의 추천 예시. 기본 예시는 화면이 갖고 있고, 여기서는 haiku로 새 추천만 받는다(도구 없는 최소 호출, 한 번에 하나). 읽지 못하면 빈 목록 대신 실패로 알린다.
let examplesRequest = null;

const handleSuggestExamples = async (event, request = {}) => {
    if (examplesRequest) {
        return createFailure("BUSY", "추천 예시를 받는 중이에요.");
    }

    const account = await accounts.getDraftAccount();

    if (account.status !== STATUS_OK) {
        return account;
    }

    const ask = askClaude(account.data.configDir, getExamplesPrompt({ exclude: request.exclude }), { model: "haiku", timeoutMs: 45000 });

    examplesRequest = ask;

    const result = await ask.promise;

    examplesRequest = null;

    if (result.error) {
        return createFailure("EXAMPLES_FAILED", `Claude가 예시를 만들지 못했어요. ${result.error}`);
    }

    const examples = parseExamples(result.text);

    return examples.length ? { status: STATUS_OK, data: { examples: examples } } : createFailure("EXAMPLES_INVALID", "Claude의 예시를 읽지 못했어요.");
};

// 새 프로젝트를 만들고 새 탭으로 연다. 신규 개발 모드에 brief.md 내용을 만들 것으로 채워 시작 전 화면에서 바로 기획을 시작할 수 있게 한다.
const handleCreateProject = async (event, request = {}) => {
    if (readSettings().tabs.length >= MAX_TABS) {
        return createFailure("TOO_MANY_TABS", `탭은 ${MAX_TABS}개까지 열 수 있어요. 탭 하나를 닫고 만들어 주세요.`);
    }

    const parentDir = getCreateParentDir();
    const author = request.author && typeof request.author === "object" ? { name: String(request.author.name ?? "").trim(), email: String(request.author.email ?? "").trim() } : null;
    const created = await createProject({ parentDir: parentDir, name: request.name, brief: request.brief, author: author });

    if (created.error) {
        return createFailure(created.code, created.error);
    }

    updateSettings({ createParentDir: parentDir });

    const opened = settingsStore.openTab(created.projectDir);

    if (opened.error) {
        return createFailure("TOO_MANY_TABS", opened.error);
    }

    settingsStore.remember(opened.projectDir, { mode: "build", tasks: created.brief });

    return getSwitchResult(sessionPool.open(opened.projectDir), { created: true });
};

const handleActivateTab = async (event, requestedDir) => {
    const session = sessionPool.get(requestedDir);

    if (!session?.projectDir) {
        return createNoSessionFailure();
    }

    settingsStore.openTab(session.projectDir);

    return getSwitchResult(session);
};

// 탭을 닫는다. 실행 중인 탭은 닫지 않는다(종료한 뒤 닫는다). 활성 탭을 닫으면 이웃 탭이 활성이 된다.
const handleCloseTab = async (event, requestedDir) => {
    const session = sessionPool.get(requestedDir);

    if (!session?.projectDir) {
        return createNoSessionFailure();
    }

    if (session.runner.isRunning() || session.isLaunching) {
        return createFailure("RUNNING", "실행 중인 탭은 닫을 수 없어요. 먼저 종료해 주세요.");
    }

    settingsStore.closeTab(session.projectDir);
    sessionPool.close(session.projectDir);

    return getSwitchResult(sessionPool.get());
};

const handleGetState = async (event, requestedDir) => {
    const session = sessionPool.get(requestedDir);

    if (!session) {
        return createNoSessionFailure();
    }

    await attachRunningEngine(session.projectDir);

    return {
        version: app.getVersion(),
        platform: process.platform,
        canLaunchAtLogin: loginItem.isSupported(),
        update: updateCheck.getUpdate(),
        ...getSettingsView(session.projectDir),
        tabs: getTabsPayload(),
        postAction: postAction.getPending(),
        state: session.runner.getState(),
        logs: session.runner.getLogs()
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
        effort: composer.effort,
        ...pickModeOptions(composer, readEffective(settings.projectDir))
    };
    const parsed = parseSchedule(payload.schedule);
    const projectError = getProjectError(settings.projectDir);

    if (parsed.error) {
        return createFailure("INVALID_SCHEDULE", parsed.error);
    }

    if (projectError) {
        return createFailure("INVALID_PROJECT", projectError);
    }

    if (!isValidRoundOptions(options) || !POLICY_CHOICES.includes(options.policy) || !isValidModeOptions(options)) {
        return createFailure("INVALID_OPTIONS", "모델, Effort, 정책, 작업 모드 값이 올바르지 않아요.");
    }

    if (options.mode !== "build" && options.policy === "todo" && !options.tasks.trim()) {
        return createFailure("TASKS_REQUIRED", "지시개선은 처리할 작업을 입력해야 예약할 수 있어요.");
    }

    settingsStore.remember(settings.projectDir, options);

    const result = await scheduler.save({ ...payload.schedule, projectDir: settings.projectDir });

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
const handleResetProgress = async (event, requestedDir) => {
    const session = sessionPool.get(requestedDir);

    if (!session) {
        return createNoSessionFailure();
    }

    const { projectDir } = session;
    const projectError = getProjectError(projectDir);

    if (projectError) {
        return createFailure("INVALID_PROJECT", projectError);
    }

    if (session.runner.isRunning()) {
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

// 신규 개발의 단계 상태. 신규 개발을 한 적 없으면 phase가 null이다.
const handleGetPhase = async (event, requestedDir) => {
    const session = sessionPool.get(requestedDir);

    if (!session) {
        return createNoSessionFailure();
    }

    return { status: STATUS_OK, data: { phase: getProjectError(session.projectDir) ? null : await readBuildPhase(session.projectDir) } };
};

// 여러 AI가 안을 낸 단계에서 고를 수 있는 안. 엔진의 approve --pick 값과 같다.
const PROPOSAL_PICKS = AI_PROVIDERS;

// 협의한 단계의 쟁점마다 고른 쪽({ d1: "claude" }). 엔진 approve --resolve 값으로 바꾸고, 형식이 틀리면 null이다(빈 값은 고를 쟁점이 없는 승인).
const DISPUTE_ID_PATTERN = /^d\d{1,2}$/;
const MAX_DISPUTES = 10;

const getResolveArgs = (resolutions) => {
    if (resolutions === undefined || resolutions === null) {
        return [];
    }

    const entries = typeof resolutions === "object" && !Array.isArray(resolutions) ? Object.entries(resolutions) : null;

    if (!entries || entries.length > MAX_DISPUTES || !entries.every(([id, side]) => DISPUTE_ID_PATTERN.test(id) && PROPOSAL_PICKS.includes(side))) {
        return null;
    }

    return entries.length ? ["--resolve", entries.map(([id, side]) => `${id}=${side}`).join(",")] : [];
};

// 확인을 기다리는 신규 개발 단계를 승인한다. 다음 실행이 다음 단계부터 한다. 실행 중에는 막는다.
// pick은 여러 AI가 안을 낸 단계에서 고른 안이고, resolutions는 협의한 단계의 쟁점마다 고른 쪽이다.
const handleApprovePhase = async (event, requestedDir, pick, resolutions) => {
    const resolveArgs = getResolveArgs(resolutions);

    if (pick !== undefined && pick !== null && !PROPOSAL_PICKS.includes(pick)) {
        return createFailure("INVALID_PICK", "고를 수 없는 안이에요.");
    }

    if (!resolveArgs) {
        return createFailure("INVALID_RESOLVE", "고를 수 없는 쟁점이에요.");
    }

    const session = sessionPool.get(requestedDir);

    if (!session) {
        return createNoSessionFailure();
    }

    const { projectDir } = session;
    const projectError = getProjectError(projectDir);

    if (projectError) {
        return createFailure("INVALID_PROJECT", projectError);
    }

    if (session.runner.isRunning() || session.isLaunching) {
        return createFailure("RUNNING", "실행 중에는 단계를 승인할 수 없어요.");
    }

    return new Promise((resolve) => {
        execEngine({ ...getEngineLaunch(), projectDir: projectDir }, "approve", [...(pick ? ["--pick", pick] : []), ...resolveArgs], async (error, stdout, stderr) => {
            if (error) {
                resolve(createFailure("APPROVE_FAILED", (stderr || error.message).trim()));

                return;
            }

            resolve({ status: STATUS_OK, data: { phase: await readBuildPhase(projectDir) } });
        });
    });
};

// 다른 AI 제공자(지금은 Codex)를 쓸 수 있는지. 단계 카드가 열릴 때마다 묻지 않도록 잠시 기억한다.
const PROVIDER_STATUS_TTL_MS = 60000;
let providerStatus = { at: 0, data: null };

const handleGetProviders = async () => {
    if (!providerStatus.data || Date.now() - providerStatus.at > PROVIDER_STATUS_TTL_MS) {
        providerStatus = { at: Date.now(), data: { codex: await getCodexStatus() } };
    }

    return { status: STATUS_OK, data: providerStatus.data };
};

// 확인을 기다리는 단계의 산출물 미리보기. 렌더러는 단계 이름만 보내고 경로는 projectFiles가 정해진 위치로만 정한다.
const handleReadPhaseDoc = async (event, phase, requestedDir) => {
    const session = sessionPool.get(requestedDir);

    if (!session) {
        return createNoSessionFailure();
    }

    try {
        const doc = readPhaseDoc(session.projectDir, phase);

        return doc ? { status: STATUS_OK, data: doc } : createFailure("NO_DOC", "산출물 문서를 아직 찾지 못했어요.");
    } catch (error) {
        return createFailure("READ_FAILED", error.message);
    }
};

const handleOpenPhaseDoc = async (event, phase, requestedDir) => {
    const session = sessionPool.get(requestedDir);

    if (!session) {
        return createNoSessionFailure();
    }

    const doc = getPhaseDoc(session.projectDir, phase);

    if (!doc) {
        return createFailure("NO_DOC", "산출물 문서를 아직 찾지 못했어요.");
    }

    const openError = await shell.openPath(doc.realPath);

    return openError ? createFailure("OPEN_FAILED", openError) : { status: STATUS_OK };
};

const handleOpenReport = async (event, requestedDir) => {
    const session = sessionPool.get(requestedDir);

    if (!session) {
        return createNoSessionFailure();
    }

    const { reportFile } = session.runner.getState();

    if (!reportFile || !fs.existsSync(reportFile)) {
        return createFailure("NO_REPORT", "열 수 있는 리포트가 아직 없어요.");
    }

    if (!isProjectReportFile(session.runner.getProjectDir(), reportFile)) {
        return createFailure("INVALID_REPORT", "프로젝트의 .autopilot/progress 안에 있는 리포트만 열 수 있어요.");
    }

    const openError = await shell.openPath(reportFile);

    return openError ? createFailure("OPEN_FAILED", openError) : { status: STATUS_OK };
};

const getActiveLogFile = (session) => {
    return session.runner.isRunning() ? session.runner.getState().logFile : "";
};

// 지난 실행 목록. 프로젝트를 고르지 않았거나 기록 폴더가 없으면 빈 목록이다. 읽지 못하는 로그는 목록에서 읽을 수 없음으로 표시한다.
const handleListRuns = async (event, limit, requestedDir) => {
    const session = sessionPool.get(requestedDir);

    if (!session) {
        return createNoSessionFailure();
    }

    const { projectDir } = session;

    if (getProjectError(projectDir)) {
        return { status: STATUS_OK, data: { runs: [] } };
    }

    try {
        const runs = await listRuns(projectDir, { limit: Number.isFinite(limit) ? limit : MAX_RUN_COUNT, activeLogFile: getActiveLogFile(session) });

        return { status: STATUS_OK, data: { runs: runs } };
    } catch (error) {
        return createFailure("LIST_RUNS_FAILED", `지난 실행 목록을 읽지 못했어요: ${error.message}`);
    }
};

const handleReadRun = async (event, id, requestedDir) => {
    const session = sessionPool.get(requestedDir);

    if (!session) {
        return createNoSessionFailure();
    }

    try {
        return { status: STATUS_OK, data: await readRun(session.projectDir, id, { activeLogFile: getActiveLogFile(session) }) };
    } catch (error) {
        return createFailure("READ_RUN_FAILED", `기록을 읽지 못했어요: ${error.message}`);
    }
};

// 지난 실행의 리포트나 원본 로그를 연다. 렌더러가 보낸 id는 형식을 검사하고 진행 기록 폴더 안의 파일만 연다.
const handleOpenRunFile = async (event, id, kind, requestedDir) => {
    const session = sessionPool.get(requestedDir);

    if (!session) {
        return createNoSessionFailure();
    }

    const { projectDir } = session;
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
const handleDeleteRun = async (event, id, requestedDir) => {
    const session = sessionPool.get(requestedDir);

    if (!session) {
        return createNoSessionFailure();
    }

    const { projectDir } = session;
    const files = getRunFiles(projectDir, id);
    const activeLogFile = getActiveLogFile(session);

    if (!files) {
        return createFailure("INVALID_RUN", "지울 수 없는 기록이에요.");
    }

    if (activeLogFile && path.resolve(activeLogFile).toLowerCase() === path.resolve(files.logFile).toLowerCase()) {
        return createFailure("RUN_ACTIVE", "진행 중인 실행은 지울 수 없어요.");
    }

    try {
        await deleteRun(projectDir, id, { activeLogFile: activeLogFile });

        return { status: STATUS_OK };
    } catch (error) {
        return createFailure("DELETE_RUN_FAILED", `기록을 지우지 못했어요: ${error.message}`);
    }
};

// 선택한 프로젝트의 지난 로그·리포트 용량과, 지금 보관 기간 설정으로 정리될 몫. 프로젝트를 고르지 않았으면 null이다.
const handleGetRunUsage = async (event, requestedDir) => {
    const session = sessionPool.get(requestedDir);

    if (!session) {
        return createNoSessionFailure();
    }

    const { projectDir, logRetentionDays } = readEffective(session.projectDir);

    if (getProjectError(projectDir)) {
        return { status: STATUS_OK, data: { usage: null } };
    }

    try {
        return { status: STATUS_OK, data: { usage: { ...(await getRunUsage(projectDir, logRetentionDays)), retentionDays: logRetentionDays } } };
    } catch (error) {
        return createFailure("USAGE_FAILED", `기록 용량을 읽지 못했어요: ${error.message}`);
    }
};

const streakStore = createStreakStore({ file: path.join(app.getPath("userData"), "streaks.json"), getKey: getProjectKey });

// 선택한 프로젝트에서 실행한 날짜 목록(오름차순). 연속 일수는 화면이 오늘 날짜로 센다.
const handleGetStreakDays = async (event, requestedDir) => {
    const session = sessionPool.get(requestedDir);

    if (!session) {
        return createNoSessionFailure();
    }

    const { projectDir } = readEffective(session.projectDir);

    if (getProjectError(projectDir)) {
        return { status: STATUS_OK, data: { days: [] } };
    }

    try {
        return { status: STATUS_OK, data: { days: await streakStore.refresh(projectDir) } };
    } catch (error) {
        return createFailure("STREAK_FAILED", `실행한 날을 읽지 못했어요: ${error.message}`);
    }
};

// 보관 기간이 지난 로그와 리포트를 지금 지운다. 되돌릴 수 없는 일이라 확인은 화면의 모달이 먼저 받는다.
const handlePruneRuns = async (event, requestedDir) => {
    const session = sessionPool.get(requestedDir);

    if (!session) {
        return createNoSessionFailure();
    }

    const { projectDir, logRetentionDays } = readEffective(session.projectDir);

    if (getProjectError(projectDir)) {
        return createFailure("INVALID_PROJECT", "프로젝트를 먼저 선택해 주세요.");
    }

    try {
        return { status: STATUS_OK, data: await pruneRuns(projectDir, logRetentionDays, { activeLogFile: getActiveLogFile(session) }) };
    } catch (error) {
        return createFailure("PRUNE_FAILED", `오래된 기록을 지우지 못했어요: ${error.message}`);
    }
};

const handleStop = (event, requestedDir) => {
    const session = sessionPool.get(requestedDir);

    return session ? session.runner.stop() : createNoSessionFailure();
};

const handleKill = (event, requestedDir) => {
    const session = sessionPool.get(requestedDir);

    return session ? session.runner.kill() : createNoSessionFailure();
};

const handleCancelPostAction = () => {
    postAction.cancel();

    return { status: STATUS_OK };
};

const handleRunPostActionNow = async () => {
    await postAction.runNow();

    return { status: STATUS_OK };
};

const registerIpc = () => {
    settingsStore.recover();
    settingsStore.upgrade();
    configureSystem({ getPreferences: readSettings });
    applyTheme();

    ipcMain.handle("autopilot:get-state", handleGetState);
    ipcMain.handle("autopilot:select-project", handleSelectProject);
    ipcMain.handle("autopilot:open-tab", handleOpenTab);
    ipcMain.handle("autopilot:activate-tab", handleActivateTab);
    ipcMain.handle("autopilot:close-tab", handleCloseTab);
    ipcMain.handle("autopilot:start", handleStart);
    ipcMain.handle("autopilot:stop", handleStop);
    ipcMain.handle("autopilot:set-options", handleSetOptions);
    ipcMain.handle("autopilot:update-settings", handleUpdateSettings);
    ipcMain.handle("autopilot:reset-settings", handleResetSettings);
    ipcMain.handle("autopilot:add-linked-repo", handleAddLinkedRepo);
    ipcMain.handle("autopilot:remove-linked-repo", handleRemoveLinkedRepo);
    ipcMain.handle("autopilot:set-preferences", handleSetPreferences);
    ipcMain.handle("autopilot:cancel-post-action", handleCancelPostAction);
    ipcMain.handle("autopilot:run-post-action-now", handleRunPostActionNow);
    ipcMain.handle("autopilot:export-settings", handleExportSettings);
    ipcMain.handle("autopilot:import-settings", handleImportSettings);
    ipcMain.handle("autopilot:restore-defaults", handleRestoreDefaults);
    ipcMain.handle("autopilot:kill", handleKill);
    ipcMain.handle("autopilot:reset-progress", handleResetProgress);
    ipcMain.handle("autopilot:get-phase", handleGetPhase);
    ipcMain.handle("autopilot:approve-phase", handleApprovePhase);
    ipcMain.handle("autopilot:get-providers", handleGetProviders);
    ipcMain.handle("autopilot:init-git-repo", handleInitGitRepo);
    ipcMain.handle("autopilot:get-create-info", handleGetCreateInfo);
    ipcMain.handle("autopilot:pick-create-dir", handlePickCreateDir);
    ipcMain.handle("autopilot:draft-project", handleDraftProject);
    ipcMain.handle("autopilot:cancel-draft", handleCancelDraft);
    ipcMain.handle("autopilot:suggest-examples", handleSuggestExamples);
    ipcMain.handle("autopilot:create-project", handleCreateProject);
    ipcMain.handle("autopilot:read-phase-doc", handleReadPhaseDoc);
    ipcMain.handle("autopilot:open-phase-doc", handleOpenPhaseDoc);
    ipcMain.handle("autopilot:open-report", handleOpenReport);
    ipcMain.handle("autopilot:list-runs", handleListRuns);
    ipcMain.handle("autopilot:read-run", handleReadRun);
    ipcMain.handle("autopilot:open-run-file", handleOpenRunFile);
    ipcMain.handle("autopilot:delete-run", handleDeleteRun);
    ipcMain.handle("autopilot:get-run-usage", handleGetRunUsage);
    ipcMain.handle("autopilot:get-streak-days", handleGetStreakDays);
    ipcMain.handle("autopilot:save-card", handleSaveCard);
    ipcMain.handle("autopilot:prune-runs", handlePruneRuns);
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
const getOwnedRunningSessions = () => {
    return sessionPool.getAll().filter((session) => session.runner.isRunning() && !session.runner.isAttached());
};

const isOwnedEngineRunning = () => {
    return getOwnedRunningSessions().length > 0;
};

// 앱이 시작한 엔진은 트레이에서 종료할 때 출력이 끊기므로 확인을 받고 강제 종료한다. 연결한 엔진은 앱 소유가 아니라 그대로 두고 닫는다. 닫아도 되면 true를 반환한다.
const confirmClose = (window) => {
    const ownedSessions = getOwnedRunningSessions();

    if (ownedSessions.length === 0) {
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

    ownedSessions.forEach((session) => session.runner.kill());

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

module.exports = {
    registerIpc,
    getWindowBackground,
    confirmClose,
    isOwnedEngineRunning,
    isTrayResident,
    syncLaunchAtLogin,
    attachRunningEngine,
    attachRunningEngines,
    checkEngine,
    startAccountWatch,
    startUpdateWatch,
    startScheduleWatch
};

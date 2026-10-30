// 엔진·메인 프로세스 없이 화면만 띄우기 위한 가짜 preload다. preload.cjs와 같은 API를 흉내 내고, 장면 실행기가 __drive로 데이터를 흘려 보낸다.
const fs = require("node:fs");

const readArgument = (name) => {
    const prefix = `--${name}=`;

    return process.argv.find((item) => item.startsWith(prefix))?.slice(prefix.length);
};

const init = JSON.parse(fs.readFileSync(readArgument("ap-fake-init"), "utf8"));
const { createInitialState } = require(`${init.root}/desktop/autopilotRunner.cjs`);

// 시각을 고정해 시계·남은 시간 문구가 장면마다 같게 한다. 장면은 __drive.now로 시각을 옮긴다.
const RealDate = Date;
let fakeNow = init.now || new RealDate(2026, 8, 1, 10, 0, 0).getTime();

class FakeDate extends RealDate {
    constructor(...args) {
        if (args.length === 0) {
            super(fakeNow);
        } else {
            super(...args);
        }
    }

    static now() {
        return fakeNow;
    }
}

window.Date = FakeDate;

const DEFAULT_SETTINGS = {
    projectDir: "",
    linkedRepos: [],
    tasks: "",
    endTime: "",
    policy: "auto",
    extendOnLimit: false,
    extendLimitMinutes: 0,
    commitPrefix: "[ap]",
    workBranch: "ai/autopilot",
    logRetentionDays: 30,
    model: "opus",
    modelVersions: {},
    effort: "high",
    runner: "claude",
    mode: "maintain",
    gates: ["plan", "design"],
    allow: ["deps", "large"],
    designFormat: "html",
    qaOnFail: "retry:3",
    securityOnFail: "retry:3",
    mains: {},
    brainstorm: [],
    debate: [],
    crossReview: false,
    debateTurns: 8,
    codexModel: "",
    codexEffort: "",
    accounts: [],
    accountId: "default",
    claudeDir: "",
    keepInTray: true,
    launchAtLogin: false
};
const OVERRIDABLE_DEFAULTS = {
    tasks: DEFAULT_SETTINGS.tasks,
    endTime: DEFAULT_SETTINGS.endTime,
    policy: DEFAULT_SETTINGS.policy,
    extendOnLimit: DEFAULT_SETTINGS.extendOnLimit,
    extendLimitMinutes: DEFAULT_SETTINGS.extendLimitMinutes,
    commitPrefix: DEFAULT_SETTINGS.commitPrefix,
    workBranch: DEFAULT_SETTINGS.workBranch,
    logRetentionDays: DEFAULT_SETTINGS.logRetentionDays,
    model: DEFAULT_SETTINGS.model,
    modelVersions: DEFAULT_SETTINGS.modelVersions,
    effort: DEFAULT_SETTINGS.effort,
    runner: DEFAULT_SETTINGS.runner,
    mode: DEFAULT_SETTINGS.mode,
    gates: DEFAULT_SETTINGS.gates,
    allow: DEFAULT_SETTINGS.allow,
    designFormat: DEFAULT_SETTINGS.designFormat,
    qaOnFail: DEFAULT_SETTINGS.qaOnFail,
    securityOnFail: DEFAULT_SETTINGS.securityOnFail,
    mains: DEFAULT_SETTINGS.mains,
    brainstorm: DEFAULT_SETTINGS.brainstorm,
    debate: DEFAULT_SETTINGS.debate,
    crossReview: DEFAULT_SETTINGS.crossReview,
    debateTurns: DEFAULT_SETTINGS.debateTurns,
    codexModel: DEFAULT_SETTINGS.codexModel,
    codexEffort: DEFAULT_SETTINGS.codexEffort
};
const DEFAULT_ACCOUNTS = {
    accounts: [{ id: "default", label: "기본 계정", shared: false }],
    activeId: "default",
    claudeDir: { path: "C:/Users/User/.claude", isAuto: true, exists: true },
    snapshots: {},
    login: null
};
const DEFAULT_SCHEDULES = {
    schedules: [],
    statuses: [],
    maxSchedules: 8,
    defaults: {
        time: { id: "", enabled: true, kind: "time", time: "23:00", window: "session", from: "", to: "", days: [1, 2, 3, 4, 5, 6, 0], minRemaining: 0, duration: 360 },
        reset: { id: "", enabled: true, kind: "reset", time: "23:00", window: "session", from: "22:00", to: "07:00", days: [1, 2, 3, 4, 5, 6, 0], minRemaining: 50, duration: 360 }
    }
};

const model = {
    version: "1.4.2",
    platform: "win32",
    canLaunchAtLogin: false,
    update: null,
    settings: { ...DEFAULT_SETTINGS, ...init.settings },
    overridden: init.overridden || [],
    globals: { ...OVERRIDABLE_DEFAULTS, ...init.globals },
    state: { ...createInitialState(), ...init.state },
    // 열린 탭 요약. 장면이 tabs를 주었을 때만 탭 줄이 보인다(주지 않은 장면은 탭 줄이 없던 옛 화면과 같다).
    tabs: init.tabs || [],
    logs: init.logs || [],
    accounts: { ...DEFAULT_ACCOUNTS, ...init.accounts },
    schedules: { ...DEFAULT_SCHEDULES, ...init.schedules },
    runs: init.runs || [],
    streakDays: init.streakDays || [],
    runDetails: init.runDetails || {},
    models: init.models || [],
    isDev: Boolean(init.isDev),
    maximized: false,
    ...init.model
};
const listeners = {};
const calls = [];
const ok = (data) => ({ status: "OK", data: data });
// 설정 화면이 쓰는 모양: 적용되는 값, 프로젝트가 덮어쓴 키, 전역 값. 옛 화면은 settings만 읽는다.
const getSettingsView = () => ({ settings: model.settings, overridden: model.overridden, globals: model.globals, notice: "" });
const getTabsPayload = () => ({ active: model.settings.projectDir, tabs: model.tabs });
// 프로젝트를 바꾼 뒤 화면이 받는 모양: 설정, 탭 요약, 그 프로젝트의 상태와 로그
const getSwitchData = (extra = {}) => ({ ...getSettingsView(), tabs: getTabsPayload(), state: model.state, logs: model.logs, ...extra });
const fail = (code, msg) => ({ status: "FAILED", error: { code: code, msg: msg } });

const subscribe = (channel) => (callback) => {
    (listeners[channel] = listeners[channel] || []).push(callback);

    return () => {
        listeners[channel] = listeners[channel].filter((item) => item !== callback);
    };
};

// projectDir을 단 이벤트(actions/events.js)가 없는 옛 화면은 상태·로그 묶음 그대로 받는다.
const isTaggedEvents = fs.existsSync(`${init.root}/desktop/ui/actions/events.js`);
const tag = (key, value) => (isTaggedEvents ? { projectDir: model.settings.projectDir, [key]: value } : value);

const emit = (channel, payload) => {
    (listeners[channel] || []).forEach((callback) => callback(payload));
};

const record =
    (name) =>
    (...args) => {
        calls.push([name, ...args]);
    };

const respond =
    (name, handler) =>
    async (...args) => {
        record(name)(...args);

        const scripted = init.responses?.[name];

        return scripted ? scripted : handler(...args);
    };

const api = {
    getState: respond("getState", async () => ({
        version: model.version,
        platform: model.platform,
        canLaunchAtLogin: model.canLaunchAtLogin,
        update: model.update,
        ...getSettingsView(),
        state: model.state,
        tabs: getTabsPayload(),
        logs: model.logs
    })),
    selectProject: respond("selectProject", async () => ok(getSettingsView())),
    openTab: respond("openTab", async () => ok({ ...getSettingsView(), canceled: true, tabs: getTabsPayload() })),
    activateTab: respond("activateTab", async (projectDir) => {
        model.settings = { ...model.settings, projectDir: projectDir };

        return ok(getSwitchData());
    }),
    closeTab: respond("closeTab", async (projectDir) => {
        model.tabs = model.tabs.filter((tab) => tab.projectDir !== projectDir);
        model.settings = { ...model.settings, projectDir: model.tabs[0]?.projectDir || "" };

        return ok(getSwitchData());
    }),
    start: respond("start", async () => ok({})),
    stop: respond("stop", async () => ok({})),
    setOptions: respond("setOptions", async () => ok({})),
    setModelVersion: respond("setModelVersion", async (family, version) => {
        const modelVersions = { ...model.settings.modelVersions };

        if (version) {
            modelVersions[family] = version;
        } else {
            delete modelVersions[family];
        }

        model.settings = { ...model.settings, modelVersions: modelVersions };

        return ok({ modelVersions: modelVersions });
    }),
    updateSettings: respond("updateSettings", async ({ scope, patch }) => {
        if (scope === "project") {
            model.settings = { ...model.settings, ...patch };
            model.overridden = [...new Set([...model.overridden, ...Object.keys(patch)])];
        } else {
            model.globals = { ...model.globals, ...patch };
            model.settings = { ...model.settings, ...Object.fromEntries(Object.entries(patch).filter(([key]) => !model.overridden.includes(key))) };
        }

        return ok(getSettingsView());
    }),
    addLinkedRepo: respond("addLinkedRepo", async () => {
        model.settings = { ...model.settings, linkedRepos: [...model.settings.linkedRepos, `C:/work/repo-${model.settings.linkedRepos.length + 1}`] };

        return ok(getSettingsView());
    }),
    removeLinkedRepo: respond("removeLinkedRepo", async (repoDir) => {
        model.settings = { ...model.settings, linkedRepos: model.settings.linkedRepos.filter((linkedRepo) => linkedRepo !== repoDir) };

        return ok(getSettingsView());
    }),
    resetSettings: respond("resetSettings", async (keys) => {
        model.overridden = model.overridden.filter((key) => !keys.includes(key));
        model.settings = { ...model.settings, ...Object.fromEntries(keys.map((key) => [key, model.globals[key]])) };

        return ok(getSettingsView());
    }),
    setPreferences: respond("setPreferences", async (patch) => {
        model.settings = { ...model.settings, ...patch };

        return ok(getSettingsView());
    }),
    cancelPostAction: respond("cancelPostAction", async () => ok({})),
    runPostActionNow: respond("runPostActionNow", async () => ok({})),
    exportSettings: respond("exportSettings", async () => ok({ canceled: false })),
    importSettings: respond("importSettings", async () => ok({ canceled: false, ...getSettingsView(), keyCount: 3, projectCount: 1, skippedCount: 0 })),
    restoreDefaultSettings: respond("restoreDefaultSettings", async () => {
        model.overridden = [];
        model.settings = { ...model.settings, ...model.globals };

        return ok(getSettingsView());
    }),
    getRunUsage: respond("getRunUsage", async () =>
        ok({
            usage:
                model.usage === undefined ? { runCount: 12, bytes: 4400000, staleCount: 8, staleBytes: 3900000, oldestDay: "2026-08-02", retentionDays: model.settings.logRetentionDays } : model.usage
        })
    ),
    saveCard: respond("saveCard", async () => ok({ canceled: false, file: "C:/Users/me/Pictures/AutoPilot-card.png" })),
    getStreakDays: respond("getStreakDays", async () => ok({ days: model.streakDays })),
    pruneRuns: respond("pruneRuns", async () => ok({ deletedCount: 8, freedBytes: 3900000 })),
    getModels: respond("getModels", async () => ok({ models: model.models })),
    kill: respond("kill", async () => ok({})),
    resetProgress: respond("resetProgress", async () => ok({ isReset: true })),
    getPhase: respond("getPhase", async () => ok({ phase: model.buildPhase ?? null })),
    // 여러 AI가 안을 낸 단계면 고른 안(pick)을, 협의한 단계면 쟁점마다 고른 쪽(resolutions)을 남긴다.
    approvePhase: respond("approvePhase", async (projectDir, pick, resolutions) =>
        ok({
            phase: model.buildPhase
                ? {
                      ...model.buildPhase,
                      awaiting: null,
                      proposals: model.buildPhase.proposals && pick ? { ...model.buildPhase.proposals, picked: pick } : (model.buildPhase.proposals ?? null),
                      debate: model.buildPhase.debate ? { ...model.buildPhase.debate, resolved: resolutions || {} } : null
                  }
                : null
        })
    ),
    getProviders: respond("getProviders", async () => ok(model.providers ?? { codex: { available: true, reason: "", models: [] } })),
    readPhaseDoc: respond("readPhaseDoc", async (phase) => (model.phaseDocs?.[phase] ? ok(model.phaseDocs[phase]) : fail("NO_DOC", "산출물 문서를 아직 찾지 못했어요."))),
    openPhaseDoc: respond("openPhaseDoc", async () => ok({})),
    initGitRepo: respond("initGitRepo", async () => ok(getSettingsView())),
    getCreateInfo: respond("getCreateInfo", async () => ok(model.createInfo ?? { parentDir: "D:\\work", author: { name: "한빛", email: "hanbit@example.com" } })),
    pickCreateDir: respond("pickCreateDir", async () => ok({ parentDir: "D:\\projects", canceled: false })),
    // 초안은 model.draftDelay(ms) 뒤에 model.draft를 주거나 model.draftError로 실패한다. 그만두기를 누르면 바로 CANCELED다.
    draftProject: respond(
        "draftProject",
        () =>
            new Promise((resolve) => {
                model.cancelDraft = () => resolve(fail("CANCELED", "초안 만들기를 그만뒀어요."));
                setTimeout(() => resolve(model.draftError ? fail(model.draftError.code, model.draftError.msg) : ok({ draft: model.draft })), model.draftDelay ?? 300);
            })
    ),
    cancelDraft: respond("cancelDraft", async () => {
        model.cancelDraft?.();

        return ok({});
    }),
    // 추천 예시는 model.examplesDelay(ms) 뒤에 model.examples를 주거나 model.examplesError로 실패한다.
    suggestExamples: respond(
        "suggestExamples",
        () =>
            new Promise((resolve) =>
                setTimeout(() => resolve(model.examplesError ? fail(model.examplesError.code, model.examplesError.msg) : ok({ examples: model.examples ?? [] })), model.examplesDelay ?? 300)
            )
    ),
    createProject: respond("createProject", async () => ok({ ...getSettingsView(), tabs: { active: model.settings.projectDir, tabs: model.tabs } })),
    openReport: respond("openReport", async () => ok({})),
    listRuns: respond("listRuns", async (limit) => ok({ runs: model.runs.slice(0, limit) })),
    readRun: respond("readRun", async (id) => (model.runDetails[id] ? ok(model.runDetails[id]) : fail("READ_RUN_FAILED", "기록을 읽지 못했어요."))),
    openRunFile: respond("openRunFile", async () => ok({})),
    deleteRun: respond("deleteRun", async () => ok({})),
    openUpdate: respond("openUpdate", async () => ok({})),
    getSchedules: respond("getSchedules", async () => ok(model.schedules)),
    saveSchedule: respond("saveSchedule", async () => ok(model.schedules)),
    deleteSchedule: respond("deleteSchedule", async () => ok(model.schedules)),
    toggleSchedule: respond("toggleSchedule", async () => ok(model.schedules)),
    setSystemSettings: respond("setSystemSettings", async (next) => {
        model.settings = { ...model.settings, ...next };

        return ok(getSettingsView());
    }),
    getAccounts: respond("getAccounts", async () => ok(model.accounts)),
    refreshAccount: respond("refreshAccount", async (id) => ok({ id: id, account: model.accounts.snapshots[id] })),
    selectAccount: respond("selectAccount", async (id) => {
        model.accounts = { ...model.accounts, activeId: id };

        return ok(model.accounts);
    }),
    addAccount: respond("addAccount", async () => ok({})),
    loginAccount: respond("loginAccount", async () => ok({})),
    submitLoginCode: respond("submitLoginCode", async () => ok({})),
    cancelLogin: respond("cancelLogin", async () => ok({})),
    openLoginUrl: respond("openLoginUrl", async () => ok({})),
    removeAccount: respond("removeAccount", async () => ok(model.accounts)),
    selectClaudeDir: respond("selectClaudeDir", async () => ok(model.accounts)),
    resetClaudeDir: respond("resetClaudeDir", async () => ok(model.accounts)),
    onTabs: subscribe("tabs"),
    onLog: subscribe("log"),
    onState: subscribe("state"),
    onAccount: subscribe("account"),
    onAccounts: subscribe("accounts"),
    onLogin: subscribe("login"),
    onUpdate: subscribe("update"),
    onSchedules: subscribe("schedules"),
    onPostAction: subscribe("postAction")
};

window.autopilot = api;
window.appWindow = {
    minimize: record("minimize"),
    toggleMaximize: () => {
        model.maximized = !model.maximized;
        emit("window", { maximized: model.maximized });
    },
    close: record("close"),
    isDev: async () => model.isDev,
    toggleDevTools: record("toggleDevTools"),
    onState: subscribe("window")
};

window.__calls = calls;
window.__drive = {
    now: (ms) => {
        fakeNow = ms;
    },
    state: (patch) => {
        model.state = { ...model.state, ...patch };
        document.body.dataset.driveStatus = model.state.status;
        emit("state", tag("state", model.state));
    },
    log: (lines) => {
        const entries = lines.map((text) => ({ stream: text.startsWith("[앱]") ? "app" : "out", text: text, at: Date.now() }));

        model.logs.push(...entries);
        emit("log", tag("entries", entries));
    },
    tabs: (tabs, active) => {
        model.tabs = tabs;
        emit("tabs", { active: active ?? model.settings.projectDir, tabs: tabs });
    },
    accounts: (patch) => {
        model.accounts = { ...model.accounts, ...patch };
        emit("accounts", model.accounts);
    },
    account: (id, account) => {
        model.accounts = { ...model.accounts, snapshots: { ...model.accounts.snapshots, [id]: account } };
        emit("account", { id: id, account: account });
    },
    login: (login) => emit("login", login),
    postAction: (payload) => emit("postAction", payload),
    schedules: (patch) => {
        model.schedules = { ...model.schedules, ...patch };
        emit("schedules", model.schedules);
    },
    update: (update) => {
        model.update = update;
        emit("update", update);
    },
    settings: (patch) => {
        model.settings = { ...model.settings, ...patch };
    }
};

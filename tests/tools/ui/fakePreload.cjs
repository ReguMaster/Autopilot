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
    tasks: "",
    endTime: "",
    policy: "auto",
    extendOnLimit: false,
    extendLimitMinutes: 0,
    commitPrefix: "[ap]",
    workBranch: "ai/autopilot",
    model: "opus",
    modelVersions: {},
    effort: "high",
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
    model: DEFAULT_SETTINGS.model,
    modelVersions: DEFAULT_SETTINGS.modelVersions,
    effort: DEFAULT_SETTINGS.effort
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
    version: "1.2.1",
    platform: "win32",
    canLaunchAtLogin: false,
    update: null,
    settings: { ...DEFAULT_SETTINGS, ...init.settings },
    overridden: init.overridden || [],
    globals: { ...OVERRIDABLE_DEFAULTS, ...init.globals },
    state: { ...createInitialState(), ...init.state },
    logs: init.logs || [],
    accounts: { ...DEFAULT_ACCOUNTS, ...init.accounts },
    schedules: { ...DEFAULT_SCHEDULES, ...init.schedules },
    runs: init.runs || [],
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
const fail = (code, msg) => ({ status: "FAILED", error: { code: code, msg: msg } });

const subscribe = (channel) => (callback) => {
    (listeners[channel] = listeners[channel] || []).push(callback);

    return () => {
        listeners[channel] = listeners[channel].filter((item) => item !== callback);
    };
};

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
        logs: model.logs
    })),
    selectProject: respond("selectProject", async () => ok(getSettingsView())),
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
    resetSettings: respond("resetSettings", async (keys) => {
        model.overridden = model.overridden.filter((key) => !keys.includes(key));
        model.settings = { ...model.settings, ...Object.fromEntries(keys.map((key) => [key, model.globals[key]])) };

        return ok(getSettingsView());
    }),
    setPreferences: respond("setPreferences", async (patch) => {
        model.settings = { ...model.settings, ...patch };

        return ok(getSettingsView());
    }),
    exportSettings: respond("exportSettings", async () => ok({ canceled: false })),
    importSettings: respond("importSettings", async () => ok({ canceled: false, ...getSettingsView(), keyCount: 3, projectCount: 1, skippedCount: 0 })),
    restoreDefaultSettings: respond("restoreDefaultSettings", async () => {
        model.overridden = [];
        model.settings = { ...model.settings, ...model.globals };

        return ok(getSettingsView());
    }),
    getModels: respond("getModels", async () => ok({ models: model.models })),
    kill: respond("kill", async () => ok({})),
    resetProgress: respond("resetProgress", async () => ok({ isReset: true })),
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
    onLog: subscribe("log"),
    onState: subscribe("state"),
    onAccount: subscribe("account"),
    onAccounts: subscribe("accounts"),
    onLogin: subscribe("login"),
    onUpdate: subscribe("update"),
    onSchedules: subscribe("schedules")
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
        emit("state", model.state);
    },
    log: (lines) => {
        const entries = lines.map((text) => ({ stream: text.startsWith("[앱]") ? "app" : "out", text: text, at: Date.now() }));

        model.logs.push(...entries);
        emit("log", entries);
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

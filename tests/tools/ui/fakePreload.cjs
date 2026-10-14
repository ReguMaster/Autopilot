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
    model: "opus",
    modelVersions: {},
    effort: "high",
    accounts: [],
    accountId: "default",
    claudeDir: "",
    keepInTray: true,
    launchAtLogin: false
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
        settings: model.settings,
        state: model.state,
        logs: model.logs
    })),
    selectProject: respond("selectProject", async () => ok({ settings: model.settings })),
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
    getModels: respond("getModels", async () => ok({ models: model.models })),
    kill: respond("kill", async () => ok({ cancelled: false })),
    resetProgress: respond("resetProgress", async () => ok({ cancelled: false, isReset: true })),
    openReport: respond("openReport", async () => ok({})),
    listRuns: respond("listRuns", async (limit) => ok({ runs: model.runs.slice(0, limit) })),
    readRun: respond("readRun", async (id) => (model.runDetails[id] ? ok(model.runDetails[id]) : fail("READ_RUN_FAILED", "기록을 읽지 못했어요."))),
    openRunFile: respond("openRunFile", async () => ok({})),
    deleteRun: respond("deleteRun", async () => ok({ cancelled: false })),
    openUpdate: respond("openUpdate", async () => ok({})),
    getSchedules: respond("getSchedules", async () => ok(model.schedules)),
    saveSchedule: respond("saveSchedule", async () => ok(model.schedules)),
    deleteSchedule: respond("deleteSchedule", async () => ok(model.schedules)),
    toggleSchedule: respond("toggleSchedule", async () => ok(model.schedules)),
    setSystemSettings: respond("setSystemSettings", async (next) => {
        model.settings = { ...model.settings, ...next };

        return ok({ settings: model.settings });
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
    removeAccount: respond("removeAccount", async () => ok({ cancelled: false, ...model.accounts })),
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

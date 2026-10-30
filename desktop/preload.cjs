const { contextBridge, ipcRenderer } = require("electron");

const subscribe = (channel) => {
    return (callback) => {
        const listener = (event, payload) => callback(payload);

        ipcRenderer.on(channel, listener);

        return () => ipcRenderer.removeListener(channel, listener);
    };
};

contextBridge.exposeInMainWorld("autopilot", {
    getState: (projectDir) => ipcRenderer.invoke("autopilot:get-state", projectDir),
    selectProject: () => ipcRenderer.invoke("autopilot:select-project"),
    openTab: () => ipcRenderer.invoke("autopilot:open-tab"),
    activateTab: (projectDir) => ipcRenderer.invoke("autopilot:activate-tab", projectDir),
    closeTab: (projectDir) => ipcRenderer.invoke("autopilot:close-tab", projectDir),
    start: (options) => ipcRenderer.invoke("autopilot:start", options),
    stop: (projectDir) => ipcRenderer.invoke("autopilot:stop", projectDir),
    setOptions: (options) => ipcRenderer.invoke("autopilot:set-options", options),
    updateSettings: (request) => ipcRenderer.invoke("autopilot:update-settings", request),
    resetSettings: (keys, projectDir) => ipcRenderer.invoke("autopilot:reset-settings", keys, projectDir),
    addLinkedRepo: (projectDir) => ipcRenderer.invoke("autopilot:add-linked-repo", projectDir),
    removeLinkedRepo: (repoDir, projectDir) => ipcRenderer.invoke("autopilot:remove-linked-repo", repoDir, projectDir),
    setPreferences: (patch) => ipcRenderer.invoke("autopilot:set-preferences", patch),
    cancelPostAction: () => ipcRenderer.invoke("autopilot:cancel-post-action"),
    runPostActionNow: () => ipcRenderer.invoke("autopilot:run-post-action-now"),
    exportSettings: () => ipcRenderer.invoke("autopilot:export-settings"),
    importSettings: () => ipcRenderer.invoke("autopilot:import-settings"),
    restoreDefaultSettings: () => ipcRenderer.invoke("autopilot:restore-defaults"),
    getModels: (projectDir) => ipcRenderer.invoke("autopilot:get-models", projectDir),
    kill: (projectDir) => ipcRenderer.invoke("autopilot:kill", projectDir),
    resetProgress: (projectDir) => ipcRenderer.invoke("autopilot:reset-progress", projectDir),
    getPhase: (projectDir) => ipcRenderer.invoke("autopilot:get-phase", projectDir),
    approvePhase: (projectDir, pick) => ipcRenderer.invoke("autopilot:approve-phase", projectDir, pick),
    getProviders: () => ipcRenderer.invoke("autopilot:get-providers"),
    initGitRepo: () => ipcRenderer.invoke("autopilot:init-git-repo"),
    readPhaseDoc: (phase, projectDir) => ipcRenderer.invoke("autopilot:read-phase-doc", phase, projectDir),
    openPhaseDoc: (phase, projectDir) => ipcRenderer.invoke("autopilot:open-phase-doc", phase, projectDir),
    openReport: (projectDir) => ipcRenderer.invoke("autopilot:open-report", projectDir),
    listRuns: (limit, projectDir) => ipcRenderer.invoke("autopilot:list-runs", limit, projectDir),
    readRun: (id, projectDir) => ipcRenderer.invoke("autopilot:read-run", id, projectDir),
    openRunFile: (id, kind, projectDir) => ipcRenderer.invoke("autopilot:open-run-file", id, kind, projectDir),
    deleteRun: (id, projectDir) => ipcRenderer.invoke("autopilot:delete-run", id, projectDir),
    getRunUsage: (projectDir) => ipcRenderer.invoke("autopilot:get-run-usage", projectDir),
    getStreakDays: (projectDir) => ipcRenderer.invoke("autopilot:get-streak-days", projectDir),
    saveCard: (payload) => ipcRenderer.invoke("autopilot:save-card", payload),
    pruneRuns: (projectDir) => ipcRenderer.invoke("autopilot:prune-runs", projectDir),
    openUpdate: () => ipcRenderer.invoke("autopilot:open-update"),
    getSchedules: () => ipcRenderer.invoke("autopilot:get-schedules"),
    saveSchedule: (payload) => ipcRenderer.invoke("autopilot:save-schedule", payload),
    deleteSchedule: (id) => ipcRenderer.invoke("autopilot:delete-schedule", id),
    toggleSchedule: (id, enabled) => ipcRenderer.invoke("autopilot:toggle-schedule", id, enabled),
    setSystemSettings: (options) => ipcRenderer.invoke("autopilot:set-system", options),
    getAccounts: (projectDir) => ipcRenderer.invoke("autopilot:get-accounts", projectDir),
    refreshAccount: (accountId) => ipcRenderer.invoke("autopilot:refresh-account", accountId),
    selectAccount: (accountId, projectDir) => ipcRenderer.invoke("autopilot:select-account", accountId, projectDir),
    addAccount: (options) => ipcRenderer.invoke("autopilot:add-account", options),
    loginAccount: (accountId) => ipcRenderer.invoke("autopilot:login-account", accountId),
    submitLoginCode: (code) => ipcRenderer.invoke("autopilot:submit-login-code", code),
    cancelLogin: () => ipcRenderer.invoke("autopilot:cancel-login"),
    openLoginUrl: () => ipcRenderer.invoke("autopilot:open-login-url"),
    removeAccount: (accountId) => ipcRenderer.invoke("autopilot:remove-account", accountId),
    getCreateInfo: () => ipcRenderer.invoke("autopilot:get-create-info"),
    pickCreateDir: () => ipcRenderer.invoke("autopilot:pick-create-dir"),
    draftProject: (request) => ipcRenderer.invoke("autopilot:draft-project", request),
    cancelDraft: () => ipcRenderer.invoke("autopilot:cancel-draft"),
    createProject: (request) => ipcRenderer.invoke("autopilot:create-project", request),
    selectClaudeDir: () => ipcRenderer.invoke("autopilot:select-claude-dir"),
    resetClaudeDir: () => ipcRenderer.invoke("autopilot:reset-claude-dir"),
    onTabs: subscribe("autopilot:tabs"),
    onLog: subscribe("autopilot:log"),
    onState: subscribe("autopilot:state"),
    onAccount: subscribe("autopilot:account"),
    onAccounts: subscribe("autopilot:accounts"),
    onLogin: subscribe("autopilot:login"),
    onUpdate: subscribe("autopilot:update"),
    onSchedules: subscribe("autopilot:schedules"),
    onPostAction: subscribe("autopilot:post-action")
});

contextBridge.exposeInMainWorld("appWindow", {
    minimize: () => ipcRenderer.send("window:minimize"),
    toggleMaximize: () => ipcRenderer.send("window:toggle-maximize"),
    close: () => ipcRenderer.send("window:close"),
    isDev: () => ipcRenderer.invoke("window:is-dev"),
    toggleDevTools: () => ipcRenderer.send("window:toggle-devtools"),
    onState: subscribe("window:state")
});

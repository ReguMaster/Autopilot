const { contextBridge, ipcRenderer } = require("electron");

const subscribe = (channel) => {
    return (callback) => {
        const listener = (event, payload) => callback(payload);

        ipcRenderer.on(channel, listener);

        return () => ipcRenderer.removeListener(channel, listener);
    };
};

contextBridge.exposeInMainWorld("autopilot", {
    getState: () => ipcRenderer.invoke("autopilot:get-state"),
    selectProject: () => ipcRenderer.invoke("autopilot:select-project"),
    start: (options) => ipcRenderer.invoke("autopilot:start", options),
    stop: () => ipcRenderer.invoke("autopilot:stop"),
    setOptions: (options) => ipcRenderer.invoke("autopilot:set-options", options),
    kill: () => ipcRenderer.invoke("autopilot:kill"),
    resetProgress: () => ipcRenderer.invoke("autopilot:reset-progress"),
    openReport: () => ipcRenderer.invoke("autopilot:open-report"),
    listRuns: (limit) => ipcRenderer.invoke("autopilot:list-runs", limit),
    readRun: (id) => ipcRenderer.invoke("autopilot:read-run", id),
    openRunFile: (id, kind) => ipcRenderer.invoke("autopilot:open-run-file", id, kind),
    deleteRun: (id) => ipcRenderer.invoke("autopilot:delete-run", id),
    openUpdate: () => ipcRenderer.invoke("autopilot:open-update"),
    setSystemSettings: (options) => ipcRenderer.invoke("autopilot:set-system", options),
    getAccounts: () => ipcRenderer.invoke("autopilot:get-accounts"),
    refreshAccount: (accountId) => ipcRenderer.invoke("autopilot:refresh-account", accountId),
    selectAccount: (accountId) => ipcRenderer.invoke("autopilot:select-account", accountId),
    addAccount: (options) => ipcRenderer.invoke("autopilot:add-account", options),
    loginAccount: (accountId) => ipcRenderer.invoke("autopilot:login-account", accountId),
    submitLoginCode: (code) => ipcRenderer.invoke("autopilot:submit-login-code", code),
    cancelLogin: () => ipcRenderer.invoke("autopilot:cancel-login"),
    openLoginUrl: () => ipcRenderer.invoke("autopilot:open-login-url"),
    removeAccount: (accountId) => ipcRenderer.invoke("autopilot:remove-account", accountId),
    selectClaudeDir: () => ipcRenderer.invoke("autopilot:select-claude-dir"),
    resetClaudeDir: () => ipcRenderer.invoke("autopilot:reset-claude-dir"),
    onLog: subscribe("autopilot:log"),
    onState: subscribe("autopilot:state"),
    onAccount: subscribe("autopilot:account"),
    onAccounts: subscribe("autopilot:accounts"),
    onLogin: subscribe("autopilot:login"),
    onUpdate: subscribe("autopilot:update")
});

contextBridge.exposeInMainWorld("appWindow", {
    minimize: () => ipcRenderer.send("window:minimize"),
    toggleMaximize: () => ipcRenderer.send("window:toggle-maximize"),
    close: () => ipcRenderer.send("window:close"),
    isDev: () => ipcRenderer.invoke("window:is-dev"),
    toggleDevTools: () => ipcRenderer.send("window:toggle-devtools"),
    onState: subscribe("window:state")
});

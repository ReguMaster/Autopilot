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
    onLog: subscribe("autopilot:log"),
    onState: subscribe("autopilot:state")
});

contextBridge.exposeInMainWorld("appWindow", {
    minimize: () => ipcRenderer.send("window:minimize"),
    toggleMaximize: () => ipcRenderer.send("window:toggle-maximize"),
    close: () => ipcRenderer.send("window:close"),
    onState: subscribe("window:state")
});

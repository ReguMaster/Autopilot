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
    selectExecutable: () => ipcRenderer.invoke("autopilot:select-exe"),
    findExecutable: () => ipcRenderer.invoke("autopilot:find-exe"),
    start: (options) => ipcRenderer.invoke("autopilot:start", options),
    stop: () => ipcRenderer.invoke("autopilot:stop"),
    setOptions: (options) => ipcRenderer.invoke("autopilot:set-options", options),
    kill: () => ipcRenderer.invoke("autopilot:kill"),
    openReport: () => ipcRenderer.invoke("autopilot:open-report"),
    onLog: subscribe("autopilot:log"),
    onState: subscribe("autopilot:state")
});

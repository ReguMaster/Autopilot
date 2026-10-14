import { create } from "zustand";

// 메인 프로세스가 보관하는 앱 정보와 저장된 설정, 창 상태.
const useAppStore = create(() => ({
    version: "",
    platform: "",
    canLaunchAtLogin: false,
    update: null,
    settings: { projectDir: "", modelVersions: {}, keepInTray: true, launchAtLogin: false },
    isDev: false,
    maximized: false
}));

const setSettings = (settings) => {
    useAppStore.setState({ settings: settings });
};

const getSettings = () => useAppStore.getState().settings;

export { useAppStore, setSettings, getSettings };

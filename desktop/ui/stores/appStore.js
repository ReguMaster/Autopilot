import { create } from "zustand";

// 메인 프로세스가 보관하는 앱 정보와 저장된 설정, 창 상태. settings는 선택한 프로젝트에 적용되는 값이고,
// overridden은 그중 프로젝트가 전역 값을 덮어쓴 키, globals는 전역에 저장된 덮어쓸 수 있는 키의 값이다.
const useAppStore = create(() => ({
    version: "",
    platform: "",
    canLaunchAtLogin: false,
    update: null,
    settings: { projectDir: "", linkedRepos: [], modelVersions: {}, keepInTray: true, launchAtLogin: false },
    overridden: [],
    globals: {},
    isDev: false,
    maximized: false
}));

const applySettingsView = (view) => {
    useAppStore.setState({ settings: view.settings, overridden: view.overridden, globals: view.globals });
};

const getSettings = () => useAppStore.getState().settings;

export { useAppStore, applySettingsView, getSettings };

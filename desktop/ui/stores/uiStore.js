import { create } from "zustand";
import { STATUS_OK } from "../lib/constants.js";

// 화면 자체의 상태. 패널·시트는 한 번에 하나씩 뜨도록 서로 닫는다(옛 renderer.js의 규칙 그대로).
const useUiStore = create(() => ({
    panel: null,
    settingsScope: "global",
    history: false,
    archive: false,
    schedule: false,
    tasksOpen: false,
    stopArmed: false,
    isStarting: false,
    finishDismissed: false,
    notice: { message: "", tone: "" },
    loginBanner: null,
    startAfterLogin: false
}));

const ui = {
    set: (patch) => useUiStore.setState(patch),
    get: () => useUiStore.getState(),

    // 두 패널은 같은 자리에 뜨므로 하나를 열면 다른 하나는 닫고, 예약 시트도 닫는다.
    setPanel: (name) => useUiStore.setState(name ? { panel: name, schedule: false } : { panel: null }),
    togglePanel: (name) => ui.setPanel(useUiStore.getState().panel === name ? null : name),
    setHistory: (isOpen) => useUiStore.setState(isOpen ? { history: true, panel: null, archive: false, schedule: false } : { history: false }),
    setArchive: (isOpen) => useUiStore.setState(isOpen ? { archive: true, panel: null, history: false, schedule: false } : { archive: false }),
    setSchedule: (isOpen) => useUiStore.setState(isOpen ? { schedule: true, panel: null, history: false, archive: false } : { schedule: false }),
    closeAll: () => useUiStore.setState({ panel: null, history: false, archive: false, schedule: false }),

    showNotice: (message, tone = "") => useUiStore.setState({ notice: { message: message, tone: tone } }),
    showFailure: (result) => ui.showNotice(result.status === STATUS_OK ? "" : result.error.msg),
    showLoginRequired: (message) => useUiStore.setState({ loginBanner: message })
};

export { useUiStore, ui };

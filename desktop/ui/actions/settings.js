import { STATUS_OK } from "../lib/constants.js";
import { applySettingsView, getSettings } from "../stores/appStore.js";
import { composer } from "../stores/composerStore.js";
import { ui, useUiStore } from "../stores/uiStore.js";

// 메인이 돌려준 설정(적용되는 값·덮어쓴 키·전역 값)을 스토어에 반영한다. composerKeys를 주면 컴포저도 그 키만 따라가고, 안내가 있으면 보여준다.
const applyView = (view, composerKeys) => {
    applySettingsView(view);

    if (composerKeys) {
        composer.loadSettings(view.settings, composerKeys);
    }

    if (view.notice) {
        ui.showNotice(view.notice, "warn");
    }
};

// 고른 범위. 프로젝트를 고르지 않았으면 이 프로젝트 범위는 쓸 수 없어 전역이다.
const getSettingsScope = () => {
    return useUiStore.getState().settingsScope === "project" && getSettings().projectDir ? "project" : "global";
};

const settings = {
    applyView: applyView,
    getScope: getSettingsScope,

    // 설정 패널에서 고른 범위(전역 또는 이 프로젝트)에 저장한다.
    update: async (patch) => {
        const result = await window.autopilot.updateSettings({ scope: getSettingsScope(), patch: patch });

        ui.showFailure(result);

        if (result.status !== STATUS_OK) {
            return false;
        }

        applyView(result.data, Object.keys(patch));

        return true;
    },

    // 이 프로젝트가 덮어쓴 값을 지워 전역 값을 따라가게 한다.
    reset: async (keys) => {
        const result = await window.autopilot.resetSettings(keys);

        ui.showFailure(result);

        if (result.status === STATUS_OK) {
            applyView(result.data, keys);
        }
    }
};

export { settings };

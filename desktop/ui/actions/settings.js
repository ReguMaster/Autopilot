import { STATUS_OK } from "../lib/constants.js";
import { applySettingsView, getSettings } from "../stores/appStore.js";
import { composer } from "../stores/composerStore.js";
import { modal } from "../stores/modalStore.js";
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

const COMPOSER_KEYS = ["tasks", "endTime", "policy", "extendOnLimit", "model", "effort"];

const getImportMessage = ({ projectCount, skippedCount }) => {
    const skipped = skippedCount ? ` 이 PC에 없는 프로젝트 ${skippedCount}개는 건너뛰었어요.` : "";

    return `설정을 가져왔어요. 프로젝트 설정 ${projectCount}개를 적용했어요.${skipped}`;
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

    exportToFile: async () => {
        const result = await window.autopilot.exportSettings();

        ui.showFailure(result);

        if (result.status === STATUS_OK && !result.data.canceled) {
            ui.showNotice("설정을 파일로 내보냈어요.", "ok");
        }
    },

    importFromFile: async () => {
        const isConfirmed = await modal.confirm({
            title: "설정을 가져올까요?",
            message: "고른 파일의 설정으로 지금 설정을 덮어써요. 계정·Claude 데이터 폴더·선택한 프로젝트·로그인 자동 실행은 가져오지 않아요.",
            confirmLabel: "파일 고르기"
        });

        if (!isConfirmed) {
            return;
        }

        const result = await window.autopilot.importSettings();

        ui.showFailure(result);

        if (result.status === STATUS_OK && !result.data.canceled) {
            applyView(result.data, COMPOSER_KEYS);
            ui.showNotice(getImportMessage(result.data), "ok");
        }
    },

    restoreDefaults: async () => {
        const isConfirmed = await modal.confirm({
            title: "설정을 기본값으로 되돌릴까요?",
            message: "전역 기본값과 프로젝트별로 기억한 작업·모델·Effort 같은 값이 모두 기본값으로 돌아가요. 계정·Claude 데이터 폴더·선택한 프로젝트·로그인 자동 실행·예약은 그대로예요.",
            confirmLabel: "되돌리기",
            tone: "danger"
        });

        if (!isConfirmed) {
            return;
        }

        const result = await window.autopilot.restoreDefaultSettings();

        ui.showFailure(result);

        if (result.status === STATUS_OK) {
            applyView(result.data, COMPOSER_KEYS);
            ui.showNotice("설정을 기본값으로 되돌렸어요.", "ok");
        }
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

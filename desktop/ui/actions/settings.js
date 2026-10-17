import { formatBytes } from "../../viewFormat.js";
import { STATUS_OK } from "../lib/constants.js";
import { applySettingsView, getSettings } from "../stores/appStore.js";
import { composer } from "../stores/composerStore.js";
import { modal } from "../stores/modalStore.js";
import { ui, useUiStore } from "../stores/uiStore.js";
import { loadRecentRuns } from "./runs.js";

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

const save = async (patch) => {
    const result = await window.autopilot.updateSettings({ scope: getSettingsScope(), patch: patch });

    ui.showFailure(result);

    if (result.status !== STATUS_OK) {
        return result.error.msg;
    }

    applyView(result.data, Object.keys(patch));

    return "";
};

// 실행이 끝난 뒤 PC를 절전·종료하기 전의 기다림. pending은 {action, at}이거나 null이고, 실행하지 못했으면 error가 온다.
const applyPostAction = ({ pending, error }) => {
    ui.set({ postAction: pending });

    if (error) {
        ui.showNotice(error, "warn");
    }
};

const settings = {
    applyView: applyView,
    applyPostAction: applyPostAction,
    getScope: getSettingsScope,

    // 설정 패널에서 고른 범위(전역 또는 이 프로젝트)에 저장한다. 실패하면 이유를, 성공하면 빈 문자열을 돌려준다(입력 줄이 이유를 보여준다).
    save: save,

    update: async (patch) => (await save(patch)) === "",

    // 알림처럼 실행과 무관한 전역 환경설정은 범위 없이 바로 저장한다.
    setPreferences: async (patch) => {
        const result = await window.autopilot.setPreferences(patch);

        ui.showFailure(result);

        if (result.status === STATUS_OK) {
            applyView(result.data);
        }
    },

    // 끝난 뒤 PC 동작. 종료는 저장하지 않은 작업을 잃을 수 있어 확인을 먼저 받는다.
    setPostRunAction: async (action) => {
        if (action === "shutdown") {
            const isConfirmed = await modal.confirm({
                title: "실행이 끝나면 PC를 종료할까요?",
                message: "끝나고 1분 안에 취소할 수 있어요. 다른 프로그램에서 저장하지 않은 작업은 사라질 수 있어요. 직접 종료 신호를 보내거나 강제 종료하면 실행하지 않아요.",
                confirmLabel: "종료로 설정",
                tone: "danger"
            });

            if (!isConfirmed) {
                return;
            }
        }

        await settings.setPreferences({ postRunAction: action });
    },

    cancelPostAction: async () => {
        ui.showFailure(await window.autopilot.cancelPostAction());
    },

    runPostActionNow: async () => {
        ui.showFailure(await window.autopilot.runPostActionNow());
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

    // 보관 기간이 지난 로그·리포트를 지금 지운다. 되돌릴 수 없어 확인을 먼저 받는다.
    pruneStaleRuns: async () => {
        const isConfirmed = await modal.confirm({
            title: "오래된 기록을 지울까요?",
            message: "보관 기간이 지난 로그와 리포트를 지금 지워요. 지난 실행 목록에서도 사라지고 되돌릴 수 없어요. 커밋과 진행 기록은 그대로예요.",
            confirmLabel: "지우기",
            tone: "danger"
        });

        if (!isConfirmed) {
            return;
        }

        const result = await window.autopilot.pruneRuns();

        ui.showFailure(result);

        if (result.status === STATUS_OK) {
            ui.showNotice(result.data.deletedCount ? `오래된 기록 ${result.data.deletedCount}개를 지웠어요 (${formatBytes(result.data.freedBytes)}).` : "지울 기록이 없었어요.", "ok");
            loadRecentRuns();
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

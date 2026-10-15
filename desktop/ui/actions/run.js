import { STATUS_OK } from "../lib/constants.js";
import { getSettings } from "../stores/appStore.js";
import { composer, useComposerStore } from "../stores/composerStore.js";
import { modal } from "../stores/modalStore.js";
import { getRunState } from "../stores/runStore.js";
import { ui, useUiStore } from "../stores/uiStore.js";
import { loadRecentRuns } from "./runs.js";
import { settings } from "./settings.js";

const STOP_CONFIRM_MS = 4000;

let stopArmTimer = 0;

// 시작은 선택한 값을 엔진에 넘기고, 로그인이 필요하면 안내 줄에 로그인 버튼을 보여준다. 응답을 기다리는 동안 다시 누르지 못하게 한다.
const startRun = async () => {
    if (useUiStore.getState().isStarting) {
        return;
    }

    ui.set({ isStarting: true });

    try {
        const { tasks, endTime, policy, extendOnLimit } = useComposerStore.getState();
        const result = await window.autopilot.start({ tasks: tasks, endTime: endTime, policy: policy, extendOnLimit: extendOnLimit, ...composer.getSelectedOptions() });
        const isLoginRequired = result.status !== STATUS_OK && result.error.code === "LOGIN_REQUIRED";

        ui.showLoginRequired(isLoginRequired ? result.error.msg : null);
        ui.showFailure(isLoginRequired ? { status: STATUS_OK } : result);
    } finally {
        ui.set({ isStarting: false });
    }
};

// 종료 신호는 실수로 누르기 쉬워 한 번 누르면 잠깐 대기하고, 그 안에 한 번 더 눌러야 보낸다.
const setStopArmed = (isArmed) => {
    clearTimeout(stopArmTimer);
    stopArmTimer = isArmed ? setTimeout(() => setStopArmed(false), STOP_CONFIRM_MS) : 0;
    ui.set({ stopArmed: isArmed });
};

const handleMainAction = async () => {
    const status = getRunState().status;

    if (status === "idle") {
        await startRun();
    } else if (status === "running") {
        if (!useUiStore.getState().stopArmed) {
            setStopArmed(true);

            return;
        }

        setStopArmed(false);
        ui.showFailure(await window.autopilot.stop());
    } else {
        const isConfirmed = await modal.confirm({
            title: "강제 종료할까요?",
            message: "실행 중인 회차가 즉시 중단되고 commit 전 변경은 working tree에 남아요. 진행 중인 리포트도 마무리되지 않아요.",
            confirmLabel: "강제 종료",
            tone: "danger"
        });

        if (isConfirmed) {
            ui.showFailure(await window.autopilot.kill());
        }
    }
};

const openReport = async () => {
    ui.showFailure(await window.autopilot.openReport());
};

const selectProject = async () => {
    const result = await window.autopilot.selectProject();

    ui.showFailure(result);

    if (result.status === STATUS_OK) {
        settings.applyView(result.data, ["tasks", "endTime", "policy", "extendOnLimit", "model", "effort"]);
        ui.set({ finishDismissed: true, settingsScope: result.data.settings.projectDir ? useUiStore.getState().settingsScope : "global" });
        loadRecentRuns();
    }
};

const resetProgress = async () => {
    const isConfirmed = await modal.confirm({
        title: "진행 기록을 초기화할까요?",
        message: "다음 실행이 이전 작업을 이어받지 않고 빈 기록에서 시작해요. 원본은 프로젝트의 .autopilot/progress 폴더에 보관돼요.",
        confirmLabel: "초기화",
        tone: "danger"
    });

    if (!isConfirmed) {
        return;
    }

    const result = await window.autopilot.resetProgress();

    if (result.status !== STATUS_OK) {
        ui.showFailure(result);

        return;
    }

    ui.showNotice(result.data.isReset ? "진행 기록을 초기화했어요. 원본은 .autopilot/progress 폴더에 보관했어요." : "이미 초기 상태예요.", "ok");
};

// 로그인 자동 실행·트레이 상주는 둘을 함께 보내고, 메인이 돌려준 설정으로 맞춘다.
const changeSystemSettings = async (patch) => {
    const { keepInTray, launchAtLogin } = getSettings();
    const result = await window.autopilot.setSystemSettings({ keepInTray: keepInTray, launchAtLogin: launchAtLogin, ...patch });

    ui.showFailure(result);

    if (result.status === STATUS_OK) {
        settings.applyView(result.data);
    }
};

const openUpdate = async () => {
    ui.showFailure(await window.autopilot.openUpdate());
};

export { STOP_CONFIRM_MS, startRun, setStopArmed, handleMainAction, openReport, selectProject, resetProgress, changeSystemSettings, openUpdate };

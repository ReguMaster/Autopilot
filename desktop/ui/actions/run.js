import { buildShareCard } from "../../viewFormat.js";
import { getRevisionTasks } from "../lib/buildSteps.js";
import { STATUS_OK } from "../lib/constants.js";
import { getProjectName } from "../lib/projectName.js";
import { getSettings } from "../stores/appStore.js";
import { composer, useComposerStore } from "../stores/composerStore.js";
import { modal } from "../stores/modalStore.js";
import { getRunState, useRunStore } from "../stores/runStore.js";
import { ui, useUiStore } from "../stores/uiStore.js";
import { settings } from "./settings.js";
import { loadBuildPhase, setBuildPhase } from "./runs.js";
import { applyProjectSwitch, confirmGitInit } from "./tabs.js";

const STOP_CONFIRM_MS = 4000;

let stopArmTimer = 0;

// 시작은 선택한 값을 엔진에 넘기고, 로그인이 필요하면 안내 줄에 로그인 버튼을 보여준다. 응답을 기다리는 동안 다시 누르지 못하게 한다.
// overrides는 컴포저 값 대신 넘길 값이다(단계 수정 요청의 작업과 keepTasks).
const startRun = async (overrides = {}) => {
    if (useUiStore.getState().isStarting) {
        return;
    }

    ui.set({ isStarting: true });

    try {
        const { tasks, endTime, policy, extendOnLimit } = useComposerStore.getState();
        const result = await window.autopilot.start({
            tasks: tasks,
            endTime: endTime,
            policy: policy,
            extendOnLimit: extendOnLimit,
            ...composer.getSelectedOptions(),
            ...composer.getModeOptions(),
            ...overrides
        });
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

// 마친 실행의 성과 카드를 PNG로 저장한다. 문장과 사실 줄은 화면이 고르고 그리기와 저장은 메인이 한다.
const saveShareCard = async () => {
    const { state, logs } = useRunStore.getState();
    const projectName = getProjectName(getSettings().projectDir);
    const content = buildShareCard({ state: state, lines: logs.map((log) => log.text), projectName: projectName, nowMs: Date.now() });
    const result = await window.autopilot.saveCard({ content: content, projectName: projectName });

    if (result.status !== STATUS_OK) {
        ui.showFailure(result);

        return;
    }

    if (!result.data.canceled) {
        ui.showNotice("성과 카드를 저장했어요.", "ok");
    }
};

const selectProject = async () => {
    const result = await confirmGitInit(await window.autopilot.selectProject());

    if (!result) {
        return;
    }

    ui.showFailure(result);

    if (result.status === STATUS_OK) {
        applyProjectSwitch(result.data, { dismissFinish: true });
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
    // 진행 기록 초기화는 신규 개발의 단계도 기획으로 돌린다.
    loadBuildPhase();
};

// 확인을 기다리는 신규 개발 단계를 승인한다. 성공하면 다음 실행이 다음 단계부터 하고, 단계 상태를 메인이 돌려준 값으로 바꾼다.
// pick은 여러 AI가 안을 낸 단계에서 고른 안(claude·codex)이고, resolutions는 협의한 단계의 쟁점마다 고른 쪽({ d1: "codex" })이다.
// 승인하는 동안 다른 탭으로 옮길 수 있으므로 프로젝트는 승인 전에 정해 둔다.
const approvePhase = async (pick, resolutions) => {
    const { projectDir } = getSettings();
    const result = await window.autopilot.approvePhase(projectDir || undefined, pick, resolutions);

    ui.showFailure(result);

    if (result.status === STATUS_OK) {
        setBuildPhase(projectDir, result.data.phase);
    }

    return result.status === STATUS_OK;
};

// 확인을 기다리던 단계를 승인하고 바로 다음 단계를 시작한다. 승인하는 동안 다른 탭으로 옮겼으면 그 프로젝트를 대신 시작하지 않는다.
const approveAndStart = async (pick, resolutions) => {
    const { projectDir } = getSettings();

    if ((await approvePhase(pick, resolutions)) && getSettings().projectDir === projectDir) {
        await startRun();
    }
};

// 고칠 점을 수정 요청으로 넘겨 확인을 기다리던 단계를 다시 한다. 작업 칸의 만들 것은 다음 시작의 기본값으로 그대로 둔다(keepTasks).
const revisePhase = async (feedback) => {
    await startRun({ tasks: getRevisionTasks(feedback, useComposerStore.getState().tasks), keepTasks: true });
};

// 단계 산출물(plan.md·design·qa.md)은 메인이 정해진 위치에서만 읽고 연다.
const readPhaseDoc = (phase) => {
    return window.autopilot.readPhaseDoc(phase);
};

const openPhaseDoc = async (phase) => {
    ui.showFailure(await window.autopilot.openPhaseDoc(phase));
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

export {
    STOP_CONFIRM_MS,
    startRun,
    setStopArmed,
    handleMainAction,
    openReport,
    saveShareCard,
    selectProject,
    resetProgress,
    approvePhase,
    approveAndStart,
    revisePhase,
    readPhaseDoc,
    openPhaseDoc,
    changeSystemSettings,
    openUpdate
};

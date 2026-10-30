import { EFFORT_LEVELS, STATUS_OK } from "../lib/constants.js";
import { getSettings } from "../stores/appStore.js";
import { composer, COMPOSER_KEYS, useComposerStore } from "../stores/composerStore.js";
import { modal } from "../stores/modalStore.js";
import { getRunState } from "../stores/runStore.js";
import { useRunsStore } from "../stores/runsStore.js";
import { useScheduleStore } from "../stores/scheduleStore.js";
import { applyTabs, useTabsStore } from "../stores/tabsStore.js";
import { ui, useUiStore } from "../stores/uiStore.js";
import { applySessionSnapshot } from "./events.js";
import { loadRecentRuns } from "./runs.js";
import { settings } from "./settings.js";

// 탭을 떠날 때 아직 저장하지 않은 컴포저 값(작업 문구 등). 돌아오면 저장된 값 위에 다시 얹는다.
const drafts = new Map();

const getUnsavedValues = (saved) => {
    const current = useComposerStore.getState();
    const values = {
        tasks: current.tasks,
        endTime: current.endTime,
        policy: current.policy,
        extendOnLimit: current.extendOnLimit,
        model: current.model,
        effort: EFFORT_LEVELS[current.effort],
        ...composer.getModeOptions()
    };

    // 확인받기·허용 목록은 배열이라 값으로 비교한다.
    return Object.fromEntries(Object.entries(values).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(saved[key])));
};

const rememberDraft = (projectDir) => {
    const unsaved = getUnsavedValues(getSettings());

    if (Object.keys(unsaved).length > 0) {
        drafts.set(projectDir, unsaved);
    } else {
        drafts.delete(projectDir);
    }
};

// 메인이 알려 준 탭에 없는 프로젝트의 기억은 버린다(탭을 닫았거나 탭의 프로젝트를 바꿨다).
const forgetClosedDrafts = (tabs) => {
    for (const projectDir of [...drafts.keys()]) {
        if (!tabs.some((tab) => tab.projectDir === projectDir)) {
            drafts.delete(projectDir);
        }
    }
};

// 보는 프로젝트가 바뀐 뒤(프로젝트 고르기·탭 열기·전환·닫기) 메인이 준 결과를 화면에 반영한다.
// 보는 프로젝트가 그대로면(다른 탭을 닫았을 때 등) 탭 목록과 설정만 바꾸고, 쓰던 컴포저와 이야기는 건드리지 않는다.
// dismissFinish가 참이면(프로젝트 고르기) 같은 프로젝트를 다시 골라도 처음부터 다시 채우고, 마친 화면은 닫은 채로 둔다(시작 전 화면으로 돌아간다).
const applyProjectSwitch = (data, { dismissFinish = false } = {}) => {
    const previousDir = getSettings().projectDir;
    const nextDir = data.settings.projectDir;
    const isSwitched = nextDir !== previousDir;
    const isRefill = isSwitched || dismissFinish;

    if (isSwitched && previousDir && getRunState()?.status === "idle") {
        rememberDraft(previousDir);
    }

    if (data.tabs) {
        applyTabs(data.tabs);
        forgetClosedDrafts(data.tabs.tabs);
    }

    settings.applyView(data, isRefill ? COMPOSER_KEYS : undefined);

    if (!isRefill) {
        return;
    }

    ui.set({ finishDismissed: dismissFinish });
    // 떠나기 전에 기억해 둔 단계 상태를 바로 보여 이전 프로젝트의 단계가 남지 않게 한다. loadRecentRuns가 새로 읽으면 바뀐다.
    useRunsStore.setState((store) => ({ buildPhase: store.phases[nextDir] ?? null }));

    if (data.state) {
        applySessionSnapshot(data);
    }

    const draft = isSwitched ? drafts.get(nextDir) : undefined;

    if (draft) {
        composer.loadSettings(draft, Object.keys(draft));
    }

    ui.set({ settingsScope: nextDir ? useUiStore.getState().settingsScope : "global" });

    if (data.existing && isSwitched) {
        ui.showNotice("이미 열려 있는 프로젝트라서 그 탭으로 이동했어요.");
    }

    loadRecentRuns();
};

// 고른 폴더가 Git 저장소가 아니면(NOT_GIT_REPO) 새 저장소를 만들지 묻는다. 만들면 메인이 이어서 연 결과를, 취소하면 null을 돌려준다.
// 메인은 방금 대화상자로 고른 폴더에만 저장소를 만들므로 경로를 보내지 않는다.
const confirmGitInit = async (result) => {
    if (result.status === STATUS_OK || result.error.code !== "NOT_GIT_REPO") {
        return result;
    }

    const isConfirmed = await modal.confirm({
        title: "새 Git 저장소를 만들까요?",
        message: `${result.data.projectDir} 폴더는 Git 저장소가 아니에요. 여기에 main 브랜치로 새 저장소를 만들고 빈 첫 커밋을 남긴 뒤 열게요.`,
        confirmLabel: "저장소 만들기"
    });

    return isConfirmed ? window.autopilot.initGitRepo() : null;
};

const openTab = async () => {
    const result = await confirmGitInit(await window.autopilot.openTab());

    if (!result) {
        return;
    }

    ui.showFailure(result);

    if (result.status === STATUS_OK && !result.data.canceled) {
        ui.set({ newProject: false });
        applyProjectSwitch(result.data);
    }
};

// 새 프로젝트 화면을 보고 있었으면 닫고 그 탭을 보인다.
const activateTab = async (projectDir) => {
    ui.set({ newProject: false });

    if (projectDir === useTabsStore.getState().active) {
        return;
    }

    const result = await window.autopilot.activateTab(projectDir);

    ui.showFailure(result);

    if (result.status === STATUS_OK) {
        applyProjectSwitch(result.data);
    }
};

const getScheduleCount = (projectDir) => {
    return useScheduleStore.getState().payload.schedules.filter((schedule) => schedule.scope === "project" && schedule.projectDir === projectDir).length;
};

// 탭을 닫으면 그 프로젝트의 예약은 다시 열 때까지 실행되지 않으므로, 예약이 있으면 먼저 확인한다. 실행 중인 탭은 메인이 거부한다.
const closeTab = async (projectDir) => {
    const scheduleCount = getScheduleCount(projectDir);

    if (scheduleCount > 0) {
        const isConfirmed = await modal.confirm({
            title: "탭을 닫을까요?",
            message: `이 프로젝트에 예약 ${scheduleCount}개가 있어요. 탭을 닫으면 다시 열 때까지 이 예약은 실행되지 않아요.`,
            confirmLabel: "탭 닫기"
        });

        if (!isConfirmed) {
            return;
        }
    }

    const result = await window.autopilot.closeTab(projectDir);

    ui.showFailure(result);

    if (result.status === STATUS_OK) {
        applyProjectSwitch(result.data);
    }
};

export { applyProjectSwitch, confirmGitInit, openTab, activateTab, closeTab };

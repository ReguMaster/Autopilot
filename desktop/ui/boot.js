import { STATUS_OK } from "./lib/constants.js";
import { applyLogin, applyPayload } from "./actions/accounts.js";
import { loadRecentRuns } from "./actions/runs.js";
import { setStopArmed } from "./actions/run.js";
import { setAccountSnapshot } from "./stores/accountStore.js";
import { useAppStore } from "./stores/appStore.js";
import { composer, useComposerStore } from "./stores/composerStore.js";
import { applyRunState, appendEntries, flushNow, getRunState, useRunStore } from "./stores/runStore.js";
import { applySchedulePayload } from "./stores/scheduleStore.js";
import { ui, useUiStore } from "./stores/uiStore.js";

// 실행 상태가 바뀔 때 다른 스토어가 따라야 하는 규칙. 옛 renderer.js의 renderState가 한꺼번에 하던 일이다.
const followRunState = (state, previous) => {
    composer.syncFromRun(state);

    // 실행이 끝나면 방금 끝난 실행이 지난 실행 목록에 들어온다.
    if (previous && previous.status !== "idle" && state.status === "idle") {
        loadRecentRuns();
    }

    // 새 실행이 시작되면 다시 마친 화면을 쓰고, 종료 신호 대기는 실행 중일 때만 이어진다.
    if (state.status !== "idle" && useUiStore.getState().finishDismissed) {
        ui.set({ finishDismissed: false });
    }

    if (state.status !== "running" && useUiStore.getState().stopArmed) {
        setStopArmed(false);
    }
};

// 첫 상태를 모두 받아 스토어를 채운 뒤에 화면을 그리도록 기다린다. 이후 변경은 메인이 보내는 이벤트로 받는다.
const boot = async () => {
    const snapshot = await window.autopilot.getState();
    const settings = snapshot.settings;

    useAppStore.setState({
        version: snapshot.version,
        platform: snapshot.platform,
        canLaunchAtLogin: snapshot.canLaunchAtLogin,
        update: snapshot.update,
        settings: settings,
        isDev: await window.appWindow.isDev()
    });
    useComposerStore.setState({ endTime: settings.endTime, tasks: settings.tasks, policy: settings.policy, extendOnLimit: settings.extendOnLimit });
    composer.setSelectedOptions(settings);
    applyRunState(snapshot.state);
    composer.syncFromRun(snapshot.state);
    appendEntries(snapshot.logs);
    flushNow();

    if (snapshot.settingsNotice) {
        ui.showNotice(snapshot.settingsNotice, "warn");
    }

    const accountsResult = await window.autopilot.getAccounts();

    if (accountsResult.status === STATUS_OK) {
        applyPayload(accountsResult.data);
    }

    const schedulesResult = await window.autopilot.getSchedules();

    if (schedulesResult.status === STATUS_OK) {
        applySchedulePayload(schedulesResult.data);
    }

    loadRecentRuns();

    useRunStore.subscribe((current, previous) => {
        if (current.state !== previous.state) {
            followRunState(current.state, previous.state);
        }
    });

    window.autopilot.onState(applyRunState);
    window.autopilot.onLog(appendEntries);
    window.autopilot.onUpdate((update) => useAppStore.setState({ update: update }));
    window.autopilot.onAccounts(applyPayload);
    window.autopilot.onAccount(({ id, account }) => setAccountSnapshot(id, account));
    window.autopilot.onLogin(applyLogin);
    window.autopilot.onSchedules(applySchedulePayload);
    window.appWindow.onState(({ maximized }) => useAppStore.setState({ maximized: maximized }));

    return getRunState();
};

export { boot };

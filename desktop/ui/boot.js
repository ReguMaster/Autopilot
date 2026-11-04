import { STATUS_OK } from "./lib/constants.js";
import { applyLogin, applyPayload } from "./actions/accounts.js";
import { handleLogEvent, handleStateEvent } from "./actions/events.js";
import { settings as settingsActions } from "./actions/settings.js";
import { loadBuildPhase, loadProviders, loadRecentRuns } from "./actions/runs.js";
import { setStopArmed } from "./actions/run.js";
import { applyCodexLogin, applyCodexPayload } from "./actions/codexAccounts.js";
import { setAccountSnapshot } from "./stores/accountStore.js";
import { setCodexAccountSnapshot } from "./stores/codexAccountStore.js";
import { useAppStore } from "./stores/appStore.js";
import { composer } from "./stores/composerStore.js";
import { applyRunState, appendEntries, flushNow, getRunState, useRunStore } from "./stores/runStore.js";
import { useRunsStore } from "./stores/runsStore.js";
import { applyTabs, useTabsStore } from "./stores/tabsStore.js";
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

// 레일이 다른 탭의 확인 대기·단계도 알리도록, 처음 보는 탭과 실행을 마친 탭의 단계 상태를 읽어 둔다. 보는 탭은 loadRecentRuns가 읽는다.
const refreshTabPhases = (previousTabs, { tabs, active }) => {
    for (const tab of tabs) {
        const previous = previousTabs.find((item) => item.projectDir === tab.projectDir);

        if (tab.projectDir !== active && (!previous || (previous.status !== "idle" && tab.status === "idle"))) {
            loadBuildPhase(tab.projectDir);
        }
    }
};

// 첫 상태를 모두 받아 스토어를 채운 뒤에 화면을 그리도록 기다린다. 이후 변경은 메인이 보내는 이벤트로 받는다.
const boot = async () => {
    const snapshot = await window.autopilot.getState();
    const settings = snapshot.settings;

    ui.set({ postAction: snapshot.postAction, home: Boolean(snapshot.startAtHome) });

    useAppStore.setState({
        version: snapshot.version,
        platform: snapshot.platform,
        canLaunchAtLogin: snapshot.canLaunchAtLogin,
        update: snapshot.update,
        settings: settings,
        overridden: snapshot.overridden,
        globals: snapshot.globals,
        isDev: await window.appWindow.isDev()
    });
    composer.loadSettings(settings);
    applyTabs(snapshot.tabs);
    refreshTabPhases([], snapshot.tabs);
    applyRunState(snapshot.state);
    composer.syncFromRun(snapshot.state);
    appendEntries(snapshot.logs);
    flushNow();

    if (snapshot.notice) {
        ui.showNotice(snapshot.notice, "warn");
    }

    const accountsResult = await window.autopilot.getAccounts();

    if (accountsResult.status === STATUS_OK) {
        applyPayload(accountsResult.data);
    }

    const codexResult = await window.autopilot.getCodexAccounts();

    if (codexResult.status === STATUS_OK) {
        applyCodexPayload(codexResult.data);
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

    window.autopilot.onTabs((payload) => {
        const previousTabs = useTabsStore.getState().tabs;

        applyTabs(payload);
        refreshTabPhases(previousTabs, payload);
    });
    window.autopilot.onState(handleStateEvent);
    window.autopilot.onLog(handleLogEvent);
    window.autopilot.onUpdate((update) => useAppStore.setState({ update: update }));
    window.autopilot.onAccounts(applyPayload);
    window.autopilot.onAccount(({ id, account }) => setAccountSnapshot(id, account));
    window.autopilot.onLogin(applyLogin);
    window.autopilot.onCodexAccounts((payload) => {
        applyCodexPayload(payload);

        // 계정이 바뀌면 Codex를 쓸 수 있는지도 바뀐다. 아직 읽은 적이 없으면 그 값을 쓰는 화면이 열릴 때 읽는다.
        if (useRunsStore.getState().providers) {
            loadProviders();
        }
    });
    window.autopilot.onCodexAccount(({ id, account }) => setCodexAccountSnapshot(id, account));
    window.autopilot.onCodexLogin(applyCodexLogin);
    window.autopilot.onSchedules(applySchedulePayload);
    window.autopilot.onPostAction(settingsActions.applyPostAction);
    window.appWindow.onState(({ maximized }) => useAppStore.setState({ maximized: maximized }));

    return getRunState();
};

export { boot };

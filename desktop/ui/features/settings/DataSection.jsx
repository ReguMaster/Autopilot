import { openArchiveList } from "../../actions/runs.js";
import { openReport, resetProgress } from "../../actions/run.js";
import { settings } from "../../actions/settings.js";
import { NavRow, SettingsGroup } from "../../components/SettingsGroup.jsx";
import { useAnyRunning } from "../../hooks/useAnyRunning.js";
import { useAppStore } from "../../stores/appStore.js";
import { useRunStore } from "../../stores/runStore.js";
import { ui, useUiStore } from "../../stores/uiStore.js";

const HistoryGroup = () => {
    const hasProject = useAppStore((store) => Boolean(store.settings.projectDir));
    const isIdle = useRunStore((store) => store.state.status === "idle");
    const reportFile = useRunStore((store) => store.state.reportFile);
    const isHistoryOpen = useUiStore((store) => store.history);
    const isArchiveOpen = useUiStore((store) => store.archive);

    return (
        <SettingsGroup id="group-history" title="기록">
            <NavRow id="history-toggle" aria-expanded={isHistoryOpen} aria-controls="history" onClick={() => ui.setHistory(!isHistoryOpen)}>
                {isHistoryOpen ? "전체 기록 닫기" : "전체 기록 보기"}
            </NavRow>
            <NavRow id="archive-toggle" aria-expanded={isArchiveOpen} aria-controls="archive" onClick={openArchiveList}>
                지난 실행 보기
            </NavRow>
            <NavRow id="open-report" disabled={!reportFile} onClick={openReport}>
                리포트 열기
            </NavRow>
            <NavRow id="reset-progress" danger disabled={!isIdle || !hasProject} onClick={resetProgress}>
                진행 기록 초기화
            </NavRow>
        </SettingsGroup>
    );
};

// 설정 파일을 내보내고 가져오고, 기본값으로 되돌린다. 덮어쓰는 일이라 실행 중에는 막는다.
const ManageGroup = () => {
    const isIdle = !useAnyRunning();

    return (
        <SettingsGroup id="group-manage" title="설정 관리">
            <NavRow id="export-settings" onClick={settings.exportToFile}>
                설정 내보내기
            </NavRow>
            <NavRow id="import-settings" disabled={!isIdle} onClick={settings.importFromFile}>
                설정 가져오기
            </NavRow>
            <NavRow id="restore-defaults" danger disabled={!isIdle} onClick={settings.restoreDefaults}>
                설정 기본값으로 되돌리기
            </NavRow>
        </SettingsGroup>
    );
};

const DataSection = () => {
    const isDev = useAppStore((store) => store.isDev);

    return (
        <>
            <HistoryGroup />
            <ManageGroup />
            <SettingsGroup id="group-dev" sectionId="dev-group" title="개발자" hidden={!isDev}>
                <NavRow id="toggle-devtools" onClick={() => window.appWindow.toggleDevTools()}>
                    개발자 도구 켜기/끄기
                </NavRow>
            </SettingsGroup>
        </>
    );
};

export { DataSection };

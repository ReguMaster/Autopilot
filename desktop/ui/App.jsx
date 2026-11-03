import { useEffect } from "react";
import { ModalHost } from "./components/ModalHost.jsx";
import { Scrim } from "./components/Scrim.jsx";
import { Symbols } from "./components/Symbols.jsx";
import { ArchiveSheet } from "./features/archive/ArchiveSheet.jsx";
import { Composer } from "./features/composer/Composer.jsx";
import { NewProjectView } from "./features/create/NewProjectView.jsx";
import { FinishView } from "./features/done/FinishView.jsx";
import { HistorySheet } from "./features/history/HistorySheet.jsx";
import { ProfilePanel } from "./features/profile/ProfilePanel.jsx";
import { ReadyView } from "./features/ready/ReadyView.jsx";
import { RunView } from "./features/run/RunView.jsx";
import { ScheduleSheet } from "./features/schedule/ScheduleSheet.jsx";
import { Welcome } from "./features/welcome/Welcome.jsx";
import { SettingsPanel } from "./features/settings/SettingsPanel.jsx";
import { Notices } from "./features/shell/Notices.jsx";
import { Rail } from "./features/shell/Rail.jsx";
import { TitleBar } from "./features/shell/TitleBar.jsx";
import { useBodyFlags, useNativeFeel, useRevealWhenReady } from "./hooks/useBodyFlags.js";
import { useOverlayDismiss } from "./hooks/useOverlayDismiss.js";
import { useApproval } from "./hooks/useApproval.js";
import { useReplayOnChange } from "./hooks/useReplay.js";
import { useView } from "./hooks/useView.js";
import { useAppStore } from "./stores/appStore.js";
import { useRunStore } from "./stores/runStore.js";
import { ui, useUiStore } from "./stores/uiStore.js";

// 왼쪽에 프로젝트 레일, 오른쪽 열에 위에서부터 실행 줄(창 끌기 영역), 본문, 안내 문구, 컴포저를 쌓고 패널·시트가 그 위에 뜬다. 상태 줄(Course)은 실행·마친 화면이 본문 안에 둔다.
const App = () => {
    const view = useView();
    const status = useRunStore((store) => store.state.status);
    const { panel, history, archive, schedule, tasksOpen, newProject } = useUiStore();
    const approval = useApproval();

    useBodyFlags({ view: view, status: status, isTasksOpen: tasksOpen, isApproval: Boolean(approval), isCreating: newProject, panel: panel, history: history, archive: archive, schedule: schedule });
    useRevealWhenReady();
    useNativeFeel();
    useOverlayDismiss();
    const contentRef = useReplayOnChange(
        useAppStore((store) => store.settings.projectDir),
        "switch-in"
    );

    // 작업 칸은 실행 중에만 접고 펼친다. 실행이 끝나면 다음 실행을 위해 접힌 상태로 되돌린다.
    useEffect(() => {
        if (view !== "run") {
            ui.set({ tasksOpen: false });
        }
    }, [view]);

    return (
        <>
            <Rail />
            <div className="main-column">
                <TitleBar />
                <div className="content" ref={contentRef}>
                    {newProject ? (
                        <NewProjectView />
                    ) : (
                        <main className="stage">
                            <ReadyView />
                            <RunView />
                            <FinishView />
                        </main>
                    )}
                    <Notices />
                    {newProject ? null : <Composer />}
                    <Welcome />
                </div>
            </div>
            <Symbols />
            <Scrim />
            <HistorySheet />
            <ArchiveSheet />
            <ScheduleSheet />
            <ProfilePanel />
            <SettingsPanel />
            <ModalHost />
        </>
    );
};

export { App };

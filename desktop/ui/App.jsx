import { Symbols } from "./components/Symbols.jsx";
import { Composer } from "./features/composer/Composer.jsx";
import { FinishView } from "./features/done/FinishView.jsx";
import { ReadyView } from "./features/ready/ReadyView.jsx";
import { RunView } from "./features/run/RunView.jsx";
import { Course } from "./features/shell/Course.jsx";
import { Notices } from "./features/shell/Notices.jsx";
import { TitleBar } from "./features/shell/TitleBar.jsx";
import { useBodyFlags, useNativeFeel, useRevealWhenReady } from "./hooks/useBodyFlags.js";
import { useView } from "./hooks/useView.js";
import { useRunStore } from "./stores/runStore.js";
import { useUiStore } from "./stores/uiStore.js";

// 화면은 사이드바 없이 한 장이다. 위에서부터 헤더, 상태 줄, 본문, 안내 문구, 컴포저를 쌓고 패널·시트가 그 위에 뜬다.
const App = () => {
    const view = useView();
    const status = useRunStore((store) => store.state.status);
    const { panel, history, archive, schedule, tasksOpen } = useUiStore();

    useBodyFlags({ view: view, status: status, isTasksOpen: tasksOpen, panel: panel, history: history, archive: archive, schedule: schedule });
    useRevealWhenReady();
    useNativeFeel();

    return (
        <>
            <TitleBar />
            <div className="content">
                <Course />
                <main className="stage">
                    <ReadyView />
                    <RunView />
                    <FinishView />
                </main>
                <Notices />
                <Composer />
            </div>
            <Symbols />
        </>
    );
};

export { App };

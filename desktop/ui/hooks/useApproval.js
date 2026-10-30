import { useAppStore } from "../stores/appStore.js";
import { useComposerStore } from "../stores/composerStore.js";
import { useRunStore } from "../stores/runStore.js";
import { useRunsStore } from "../stores/runsStore.js";
import { useView } from "./useView.js";

// 확인 기다림 화면이면 확인을 기다리는 단계(plan·design), 아니면 빈 문자열이다.
// 신규 개발 모드의 시작 전과, 확인받기 단계에서 멈춘 실행을 마친 직후에 보인다.
const useApproval = () => {
    const view = useView();
    const awaiting = useRunsStore((store) => store.buildPhase?.awaiting || "");
    const isBuild = useComposerStore((store) => store.mode === "build");
    const hasProject = useAppStore((store) => Boolean(store.settings.projectDir));
    const isAwaitingRun = useRunStore((store) => / 확인 대기$/.test(store.state.reason));

    if (!awaiting || !hasProject) {
        return "";
    }

    if (view === "ready") {
        return isBuild ? awaiting : "";
    }

    return view === "done" && isAwaitingRun ? awaiting : "";
};

export { useApproval };

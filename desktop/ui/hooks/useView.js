import { getView } from "../../viewFormat.js";
import { useRunStore } from "../stores/runStore.js";
import { useUiStore } from "../stores/uiStore.js";

// 화면은 시작 전(ready)·실행 중(run)·마친 뒤(done) 중 하나다.
const useView = () => {
    const status = useRunStore((store) => store.state.status);
    const endedAt = useRunStore((store) => store.state.endedAt);
    const isFinishDismissed = useUiStore((store) => store.finishDismissed);

    return getView({ status: status, endedAt: endedAt }, isFinishDismissed);
};

export { useView };

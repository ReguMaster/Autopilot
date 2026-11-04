import { cancelBuild } from "../../actions/run.js";
import { Button } from "../../components/Button.jsx";
import { useRunStore } from "../../stores/runStore.js";
import { useRunsStore } from "../../stores/runsStore.js";
import { useUiStore } from "../../stores/uiStore.js";

// 신규 개발을 중간에 취소하는 단추. 실행 중이면 신규 개발 실행일 때, 멈춘 뒤에는 이어갈 단계가 있을 때만 보인다(모두 마쳤으면 되돌릴 것이 없다).
// 화면 넷(시작 전·실행·마침·확인 기다림)이 함께 마운트돼 있으므로 id는 화면마다 달리 받는다.
const CancelBuildButton = ({ id }) => {
    const status = useRunStore((store) => store.state.status);
    const mode = useRunStore((store) => store.state.mode);
    const buildPhase = useRunsStore((store) => store.buildPhase);
    const isCancelling = useUiStore((store) => store.isCancelling);
    const isVisible = status === "idle" ? Boolean(buildPhase) && buildPhase.phase !== "done" : mode === "build";

    if (!isVisible) {
        return null;
    }

    return (
        <Button id={id} variant="danger" disabled={isCancelling} onClick={cancelBuild}>
            신규 개발 취소
        </Button>
    );
};

export { CancelBuildButton };

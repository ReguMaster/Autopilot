import { handleMainAction } from "../../actions/run.js";
import { useComposerStore } from "../../stores/composerStore.js";
import { AiPills } from "./AiPills.jsx";
import { AllowChip } from "./AllowChip.jsx";
import { EndTimeChip } from "./EndTimeChip.jsx";
import { MainAction } from "./MainAction.jsx";
import { PolicyChip } from "./PolicyChip.jsx";
import { TasksFold } from "./TasksFold.jsx";

// 컴포저: 시작 전에는 작업을 적는 칸 아래에 옵션 알약과 주 버튼이 있고, 실행 중에는 아래에 붙은 얇은 막대로 줄어든다.
// 유지 보수는 개선 정책, 신규 개발은 허용 범위를 고른다. 모델과 노력(추론)은 AI마다 알약 하나(Claude·Codex)가 맡고 늘 둘 다 보인다.
// 모델·정책 같은 실행 값은 이 폼이 아니라 스토어가 갖고, 폼은 주 버튼의 제출만 맡는다.
const Composer = () => {
    const isBuild = useComposerStore((store) => store.mode === "build");

    return (
        <form
            id="run-form"
            className="composer"
            onSubmit={(event) => {
                event.preventDefault();
                handleMainAction();
            }}
        >
            <TasksFold />
            <div className="composer-bar">
                <AiPills />
                {isBuild ? <AllowChip /> : <PolicyChip />}
                <EndTimeChip />
                <MainAction />
            </div>
        </form>
    );
};

export { Composer };

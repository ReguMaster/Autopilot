import { handleMainAction } from "../../actions/run.js";
import { EffortChip } from "./EffortChip.jsx";
import { EndTimeChip } from "./EndTimeChip.jsx";
import { MainAction } from "./MainAction.jsx";
import { ModelChip } from "./ModelChip.jsx";
import { PolicyChip } from "./PolicyChip.jsx";
import { TasksFold } from "./TasksFold.jsx";

// 컴포저: 시작 전에는 작업을 적는 칸 아래에 옵션 알약과 주 버튼이 있고, 실행 중에는 아래에 붙은 얇은 막대로 줄어든다.
// 모델·정책 같은 실행 값은 이 폼이 아니라 스토어가 갖고, 폼은 주 버튼의 제출만 맡는다.
const Composer = () => {
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
                <ModelChip />
                <EffortChip />
                <PolicyChip />
                <EndTimeChip />
                <MainAction />
            </div>
        </form>
    );
};

export { Composer };

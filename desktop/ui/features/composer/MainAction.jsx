import { STOP_CONFIRM_MS } from "../../actions/run.js";
import { SwapText } from "../../components/SwapText.jsx";
import { MAIN_ACTIONS } from "../../lib/constants.js";
import { useAppStore } from "../../stores/appStore.js";
import { useRunStore } from "../../stores/runStore.js";
import { useUiStore } from "../../stores/uiStore.js";

const STOP_ARMED_LABEL = "한 번 더 눌러 종료";

// 가운데 버튼은 시작 → 종료 신호 → 종료로 바뀐다. 종료 신호는 한 번 누르면 붉게 바뀌어 4초 동안 "한 번 더 눌러 종료"를 보이고, 그 안에 다시 눌러야 보낸다.
const MainAction = () => {
    const status = useRunStore((store) => store.state.status);
    const hasProject = useAppStore((store) => Boolean(store.settings.projectDir));
    const stopArmed = useUiStore((store) => store.stopArmed);
    const isStarting = useUiStore((store) => store.isStarting);
    const config = MAIN_ACTIONS[status];
    const isArmed = stopArmed && config.action === "stop";
    const title = isArmed ? `${STOP_CONFIRM_MS / 1000}초 안에 한 번 더 누르면 현재 회차를 마치고 종료해요` : config.title;

    return (
        <button
            type="submit"
            id="main-action"
            className="main-action"
            data-action={config.action}
            data-armed={isArmed ? "" : undefined}
            style={{ "--arm-ms": `${STOP_CONFIRM_MS}ms` }}
            title={title || undefined}
            disabled={(status === "idle" && !hasProject) || isStarting}
        >
            <i aria-hidden="true"></i>
            <SwapText id="main-action-label" value={isArmed ? STOP_ARMED_LABEL : config.label} />
        </button>
    );
};

export { MainAction };

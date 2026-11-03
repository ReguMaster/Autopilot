import { formatAgentOptions } from "../../../viewFormat.js";
import { SwapText } from "../../components/SwapText.jsx";
import { useRunStore } from "../../stores/runStore.js";

// 다음 회차에 쓸 값. 그 회차를 돌리는 AI의 모델·노력(추론)이다.
const getRequestedAgent = (requested, runner) => {
    return runner === "codex" ? { runner: "codex", model: requested.codexModel, effort: requested.codexEffort } : { runner: "claude", model: requested.model, effort: requested.effort };
};

// 실행 중에 고른 모델·노력(추론)·작업할 AI가 아직 엔진에 적용되기 전이면(다음 회차부터 적용) 그 사실을 알린다.
// 신규 개발은 단계마다 메인이 정해져 있어 지금 일하는 AI의 값만 비교한다(작업할 AI를 바꾸지 않는다).
const getApplyNote = (state) => {
    const next = getRequestedAgent(state.requested, state.mode === "build" ? state.runner : state.requested.runner);
    const isPending = state.status !== "idle" && (next.runner !== state.runner || next.model !== state.model || next.effort !== state.effort);

    return isPending ? `적용 대기: 다음 회차부터 ${formatAgentOptions(next.runner, next.model, next.effort)} (지금 ${formatAgentOptions(state.runner, state.model, state.effort)})` : "";
};

const ApplyNote = () => {
    const text = useRunStore((store) => getApplyNote(store.state));

    return <SwapText as="p" id="apply-note" className="apply-note" aria-live="polite" hidden={!text} data-tone={text ? "warn" : undefined} value={text} />;
};

export { ApplyNote, getApplyNote };

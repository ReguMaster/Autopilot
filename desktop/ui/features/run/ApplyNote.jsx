import { formatAgentOptions } from "../../../viewFormat.js";
import { SwapText } from "../../components/SwapText.jsx";
import { useRunStore } from "../../stores/runStore.js";

// 다음 회차에 쓸 값. Codex를 고르면 Codex의 model·effort가 회차 값이다.
const getRequestedAgent = (requested) => {
    return requested.runner === "codex" ? { runner: "codex", model: requested.codexModel, effort: requested.codexEffort } : { runner: "claude", model: requested.model, effort: requested.effort };
};

// 실행 중에 고른 에이전트·모델·Effort가 아직 엔진에 적용되기 전이면(다음 회차부터 적용) 그 사실을 알린다.
const getApplyNote = (state) => {
    const next = getRequestedAgent(state.requested);
    const isPending = state.status !== "idle" && (next.runner !== state.runner || next.model !== state.model || next.effort !== state.effort);

    return isPending ? `적용 대기: 다음 회차부터 ${formatAgentOptions(next.runner, next.model, next.effort)} (지금 ${formatAgentOptions(state.runner, state.model, state.effort)})` : "";
};

const ApplyNote = () => {
    const text = useRunStore((store) => getApplyNote(store.state));

    return <SwapText as="p" id="apply-note" className="apply-note" aria-live="polite" hidden={!text} data-tone={text ? "warn" : undefined} value={text} />;
};

export { ApplyNote, getApplyNote };

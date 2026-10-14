import { formatOptions } from "../../../viewFormat.js";
import { SwapText } from "../../components/SwapText.jsx";
import { useRunStore } from "../../stores/runStore.js";

// 실행 중에 고른 모델·Effort가 아직 엔진에 적용되기 전이면(다음 회차부터 적용) 그 사실을 알린다.
const getApplyNote = (state) => {
    const isPending = state.status !== "idle" && (state.requested.model !== state.model || state.requested.effort !== state.effort);

    return isPending ? `적용 대기: 다음 회차부터 ${formatOptions(state.requested.model, state.requested.effort)} (지금 ${formatOptions(state.model, state.effort)})` : "";
};

const ApplyNote = () => {
    const text = useRunStore((store) => getApplyNote(store.state));

    return <SwapText as="p" id="apply-note" className="apply-note" aria-live="polite" hidden={!text} data-tone={text ? "warn" : undefined} value={text} />;
};

export { ApplyNote, getApplyNote };

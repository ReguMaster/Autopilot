import { MODEL_LABELS, formatEffort } from "../../../viewFormat.js";
import { settings } from "../../actions/settings.js";
import { Select } from "../../components/Select.jsx";
import { SettingsGroup } from "../../components/SettingsGroup.jsx";
import { EFFORT_LEVELS, POLICY_LABELS } from "../../lib/constants.js";
import { useRunStore } from "../../stores/runStore.js";
import { ScopeNote, useScopedValue } from "./ScopeControls.jsx";

const LOCKED_REASON = "실행 중에는 바꿀 수 없어요";
const MODEL_OPTIONS = Object.entries(MODEL_LABELS).map(([value, label]) => ({ value: value, label: label }));
const EFFORT_OPTIONS = EFFORT_LEVELS.map((level) => ({ value: level, label: formatEffort(level) }));
const POLICY_OPTIONS = [
    { value: "auto", label: POLICY_LABELS.auto, hint: "작업을 마친 뒤에도 스스로 개선점을 찾아요" },
    { value: "todo", label: POLICY_LABELS.todo, hint: "적어 둔 작업만 처리하고 끝나요" }
];

const DefaultRow = ({ settingKey, title, options }) => {
    const isIdle = useRunStore((store) => store.state.status === "idle");
    const { value } = useScopedValue(settingKey);
    const labelId = `default-label-${settingKey}`;

    return (
        <div className="row version-row">
            <span className="row-body">
                <b id={labelId}>{title}</b>
                <ScopeNote settingKey={settingKey} disabled={!isIdle} />
            </span>
            <Select value={value} options={options} disabled={!isIdle} disabledReason={LOCKED_REASON} labelId={labelId} onChange={(next) => settings.update({ [settingKey]: next })} />
        </div>
    );
};

// 새 실행을 시작할 때 컴포저에 미리 채워 둘 모델·Effort·개선 정책. 컴포저에서 고른 값은 이 프로젝트에만 기억된다.
const RunDefaults = () => {
    return (
        <SettingsGroup id="group-defaults" sectionId="defaults-group" title="실행 기본값">
            <div className="versions">
                <DefaultRow settingKey="model" title="모델" options={MODEL_OPTIONS} />
                <DefaultRow settingKey="effort" title="Effort" options={EFFORT_OPTIONS} />
                <DefaultRow settingKey="policy" title="개선 정책" options={POLICY_OPTIONS} />
            </div>
        </SettingsGroup>
    );
};

export { RunDefaults };

import { MODEL_LABELS, formatModelName } from "../../../viewFormat.js";
import { settings } from "../../actions/settings.js";
import { SelectRow } from "../../components/SettingsGroup.jsx";
import { getModelsNote, useModels } from "../../hooks/useModels.js";
import { composer } from "../../stores/composerStore.js";
import { useRunStore } from "../../stores/runStore.js";
import { useUiStore } from "../../stores/uiStore.js";
import { useScopedValue } from "./ScopeControls.jsx";

const FAMILIES = Object.keys(MODEL_LABELS);
const LATEST_OPTION = { value: "", label: "최신 버전 (기본)", hint: "새 모델이 나오면 따라가요" };
const LOCKED_REASON = "실행 중에는 바꿀 수 없어요";

const getOptions = (family, pinned, models) => {
    const versions = (models ?? []).filter((model) => model.line === family).map((model) => model.id);
    const ids = pinned && !versions.includes(pinned) ? [...versions, pinned] : versions;

    return [LATEST_OPTION, ...ids.map((id) => ({ value: id, label: formatModelName(id), hint: id }))];
};

// 계열마다 최신(기본)이거나 공식 목록에서 고른 버전으로 고정한다. 고르면 컴포저의 모델 알약이 바로 따라간다.
const ModelVersions = () => {
    const isIdle = useRunStore((store) => store.state.status === "idle");
    const isPanelOpen = useUiStore((store) => store.panel === "settings");
    const versions = useScopedValue("modelVersions").value ?? {};
    const models = useModels(isPanelOpen);

    // 범위 안의 모델 버전 묶음 전체를 저장한다. 이 프로젝트가 처음 바꿀 때는 지금 적용 중인 묶음에서 한 계열만 바꾼 것이 된다.
    const handleChange = async (family, version) => {
        const next = { ...versions, [family]: version };

        if (!version) {
            delete next[family];
        }

        if (await settings.update({ modelVersions: next })) {
            composer.showFamily();
        }
    };

    const note = getModelsNote(models);

    return (
        <>
            <div className="versions">
                {FAMILIES.map((family) => (
                    <SelectRow
                        key={family}
                        labelId={`version-label-${family}`}
                        title={MODEL_LABELS[family]}
                        value={versions[family] || ""}
                        options={getOptions(family, versions[family] || "", models)}
                        disabled={!isIdle}
                        disabledReason={LOCKED_REASON}
                        onChange={(version) => handleChange(family, version)}
                    />
                ))}
            </div>
            <p className="row-note version-note" hidden={!note}>
                {note}
            </p>
        </>
    );
};

export { ModelVersions };

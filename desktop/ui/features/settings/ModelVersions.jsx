import { useEffect, useState } from "react";
import { MODEL_LABELS, formatModelName } from "../../../viewFormat.js";
import { Select } from "../../components/Select.jsx";
import { STATUS_OK } from "../../lib/constants.js";
import { setSettings, useAppStore } from "../../stores/appStore.js";
import { composer } from "../../stores/composerStore.js";
import { useRunStore } from "../../stores/runStore.js";
import { useUiStore } from "../../stores/uiStore.js";

const FAMILIES = Object.keys(MODEL_LABELS);
const LATEST_OPTION = { value: "", label: "최신 버전 (기본)", hint: "새 모델이 나오면 따라가요" };
const LOADING_NOTE = "버전 목록을 불러오는 중이에요.";
const FAILED_NOTE = "버전 목록을 불러오지 못했어요. 로그인 상태를 확인해 주세요.";
const LOCKED_REASON = "실행 중에는 바꿀 수 없어요";

// 설정 패널을 열 때마다 읽는다. 목록은 메인이 보관하므로 다시 읽어도 가볍다.
const useModels = (isPanelOpen) => {
    const [models, setModels] = useState(null);

    useEffect(() => {
        if (models !== null && !isPanelOpen) {
            return undefined;
        }

        let isCancelled = false;

        window.autopilot.getModels().then((result) => {
            if (!isCancelled) {
                setModels(result.status === STATUS_OK ? result.data.models : []);
            }
        });

        return () => {
            isCancelled = true;
        };
    }, [isPanelOpen]);

    return models;
};

const getOptions = (family, pinned, models) => {
    const versions = (models ?? []).filter((model) => model.line === family).map((model) => model.id);
    const ids = pinned && !versions.includes(pinned) ? [...versions, pinned] : versions;

    return [LATEST_OPTION, ...ids.map((id) => ({ value: id, label: formatModelName(id), hint: id }))];
};

const getModelsNote = (models) => {
    if (models === null) {
        return LOADING_NOTE;
    }

    return models.length === 0 ? FAILED_NOTE : "";
};

// 계열마다 최신(기본)이거나 공식 목록에서 고른 버전으로 고정한다. 고르면 컴포저의 모델 알약이 바로 따라간다.
const ModelVersions = () => {
    const isIdle = useRunStore((store) => store.state.status === "idle");
    const isPanelOpen = useUiStore((store) => store.panel === "settings");
    const versions = useAppStore((store) => store.settings.modelVersions) ?? {};
    const models = useModels(isPanelOpen);
    const [error, setError] = useState("");

    const handleChange = async (family, version) => {
        const result = await window.autopilot.setModelVersion(family, version);

        if (result.status !== STATUS_OK) {
            setError(result.error.msg);

            return;
        }

        setError("");
        setSettings({ ...useAppStore.getState().settings, modelVersions: result.data.modelVersions });
        composer.showFamily();
    };

    const note = error || getModelsNote(models);

    return (
        <>
            <div className="versions">
                {FAMILIES.map((family) => (
                    <div key={family} className="row version-row">
                        <span className="row-body">
                            <b id={`version-label-${family}`}>{MODEL_LABELS[family]}</b>
                        </span>
                        <Select
                            value={versions[family] || ""}
                            options={getOptions(family, versions[family] || "", models)}
                            disabled={!isIdle}
                            disabledReason={LOCKED_REASON}
                            labelId={`version-label-${family}`}
                            onChange={(version) => handleChange(family, version)}
                        />
                    </div>
                ))}
            </div>
            <p className="row-note version-note" role={error ? "alert" : undefined} hidden={!note}>
                {note}
            </p>
        </>
    );
};

export { ModelVersions };

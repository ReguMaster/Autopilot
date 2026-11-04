import { useShallow } from "zustand/react/shallow";
import { settings } from "../../actions/settings.js";
import { Seg } from "../../components/Seg.jsx";
import { getProjectName } from "../../lib/projectName.js";
import { useAppStore } from "../../stores/appStore.js";
import { ui, useUiStore } from "../../stores/uiStore.js";

const GLOBAL_NOTE = "모든 프로젝트의 기본값이에요. 프로젝트가 따로 정하지 않은 값은 이 값을 따라가요.";

// 고른 범위. 프로젝트를 고르지 않았으면 이 프로젝트 범위는 쓸 수 없어 전역이다.
const useSettingsScope = () => {
    const preferred = useUiStore((store) => store.settingsScope);
    const hasProject = useAppStore((store) => Boolean(store.settings.projectDir));

    return preferred === "project" && hasProject ? "project" : "global";
};

// 설정 패널에서 지금 보고 바꾸는 값: 전역은 전역에 저장된 값, 이 프로젝트는 프로젝트에 적용되는 값(덮어쓴 값 또는 전역 값)이다.
const useScopedValue = (key) => {
    const scope = useSettingsScope();
    const value = useAppStore((store) => (scope === "project" ? store.settings[key] : store.globals[key]));
    const isOverridden = useAppStore((store) => scope === "project" && store.overridden.includes(key));

    return { scope: scope, value: value, isOverridden: isOverridden };
};

// 여러 키를 한꺼번에 읽는다. 값끼리 기대는 규칙(lib/buildRules)이 한 번에 여러 키를 보기 때문이다.
const useScopedValues = (keys) => {
    const scope = useSettingsScope();

    return useAppStore(useShallow((store) => Object.fromEntries(keys.map((key) => [key, scope === "project" ? store.settings[key] : store.globals[key]]))));
};

// 이 프로젝트 범위에서 그 프로젝트가 덮어쓴 값에만 붙는 한 줄(바꾸지 않은 값은 전역을 따른다고 범위 스위치 옆에서 한 번 알린다). 되돌리면 전역 값을 따라간다.
const ScopeNote = ({ settingKey, disabled = false }) => {
    const { scope, isOverridden } = useScopedValue(settingKey);

    if (scope !== "project" || !isOverridden) {
        return null;
    }

    return (
        <small className="scope-note" data-overridden="">
            이 프로젝트 값
            <button
                type="button"
                className="scope-reset"
                disabled={disabled}
                title="이 프로젝트가 바꾼 값을 지우고 전역 값을 따라가요"
                aria-label="전역 값으로 되돌리기"
                onClick={(event) => {
                    event.preventDefault();
                    settings.reset([settingKey]);
                }}
            >
                되돌리기
            </button>
        </small>
    );
};

// 이 항목의 값을 전역과 이 프로젝트 중 어디에 저장할지 고른다. 범위가 없는 항목(일반·데이터)에서는 쓰지 않는다.
const ScopeSwitch = () => {
    const scope = useSettingsScope();
    const projectDir = useAppStore((store) => store.settings.projectDir);
    const options = [
        { value: "global", label: "전역" },
        { value: "project", label: "이 프로젝트", disabled: !projectDir }
    ];

    return (
        <div className="scope-switch">
            <Seg name="settings-scope" label="설정 범위" options={options} value={scope} onChange={(next) => ui.set({ settingsScope: next })} />
            <p id="scope-note">{scope === "project" ? `${getProjectName(projectDir)}에만 적용돼요. 바꾸지 않은 값은 전역 값을 따라가요.` : GLOBAL_NOTE}</p>
        </div>
    );
};

export { ScopeSwitch, ScopeNote, useScopedValue, useScopedValues, useSettingsScope };

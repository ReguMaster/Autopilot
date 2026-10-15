import { settings } from "../../actions/settings.js";
import { Seg } from "../../components/Seg.jsx";
import { SettingsGroup } from "../../components/SettingsGroup.jsx";
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

// 이 프로젝트 범위에서만 보이는 한 줄: 전역 값을 따르는지, 덮어썼다면 되돌릴 수 있는지.
const ScopeNote = ({ settingKey, disabled = false }) => {
    const { scope, isOverridden } = useScopedValue(settingKey);

    if (scope !== "project") {
        return null;
    }

    return (
        <small className="scope-note" data-overridden={isOverridden ? "" : undefined}>
            {isOverridden ? "이 프로젝트 값" : "전역 값을 따라가요"}
            {isOverridden ? (
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
            ) : null}
        </small>
    );
};

const ScopeGroup = () => {
    const scope = useSettingsScope();
    const projectDir = useAppStore((store) => store.settings.projectDir);
    const options = [
        { value: "global", label: "전역" },
        { value: "project", label: "이 프로젝트", disabled: !projectDir }
    ];

    return (
        <SettingsGroup id="group-scope" title="설정 범위">
            <div className="field scope-field">
                <Seg name="settings-scope" label="설정 범위" options={options} value={scope} onChange={(next) => ui.set({ settingsScope: next })} />
                <p id="scope-note" className="field-desc">
                    {scope === "project" ? `${getProjectName(projectDir)} 프로젝트에만 적용돼요. 바꾸지 않은 값은 전역 값을 따라가요.` : GLOBAL_NOTE}
                </p>
            </div>
        </SettingsGroup>
    );
};

export { ScopeGroup, ScopeNote, useScopedValue, useSettingsScope };

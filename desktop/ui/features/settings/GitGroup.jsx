import { useEffect, useRef, useState } from "react";
import { settings } from "../../actions/settings.js";
import { SettingsGroup } from "../../components/SettingsGroup.jsx";
import { useRunStore } from "../../stores/runStore.js";
import { ScopeNote, useScopedValue } from "./ScopeControls.jsx";

const ROWS = [
    { key: "commitPrefix", title: "커밋 접두어", placeholder: "[ap]", note: "AutoPilot이 만드는 커밋 메시지 앞에 붙어요. 1~20자이고 앞뒤 공백과 백틱은 쓸 수 없어요." },
    { key: "workBranch", title: "작업 브랜치", placeholder: "ai/autopilot", note: "AutoPilot은 이 브랜치에서만 작업하고 커밋해요. 영문·숫자·._-/로 쓰고 main·master는 쓸 수 없어요." }
];

// 입력을 마칠 때(포커스를 떠나거나 Enter) 저장한다. 값이 올바르지 않으면 줄 아래에 이유를 보여주고 입력을 그대로 둔다.
const GitRow = ({ settingKey, title, placeholder, note }) => {
    const isIdle = useRunStore((store) => store.state.status === "idle");
    const { value } = useScopedValue(settingKey);
    const [draft, setDraft] = useState(value);
    const [error, setError] = useState("");
    const isSaving = useRef(false);
    const inputId = `git-${settingKey}`;

    useEffect(() => {
        setDraft(value);
        setError("");
    }, [value]);

    // Enter와 포커스를 떠날 때 모두 저장하므로 겹쳐 오면 한 번만 보낸다.
    const commit = async () => {
        const next = draft.trim();

        if (isSaving.current) {
            return;
        }

        if (next === value) {
            setDraft(next);
            setError("");

            return;
        }

        isSaving.current = true;

        try {
            const message = await settings.save({ [settingKey]: next });

            setError(message);

            if (!message) {
                setDraft(next);
            }
        } finally {
            isSaving.current = false;
        }
    };

    const handleKeyDown = (event) => {
        if (event.key === "Enter") {
            commit();
        }
    };

    return (
        <div className="field git-field">
            <div className="field-head">
                <label className="field-title" htmlFor={inputId}>
                    {title}
                </label>
            </div>
            <input
                id={inputId}
                className="account-input"
                value={draft}
                placeholder={placeholder}
                disabled={!isIdle}
                aria-invalid={error ? "true" : undefined}
                aria-describedby={`${inputId}-note`}
                spellCheck={false}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={commit}
                onKeyDown={handleKeyDown}
            />
            <p id={`${inputId}-note`} className="field-desc">
                {note}
            </p>
            <ScopeNote settingKey={settingKey} disabled={!isIdle} />
            <p className="field-error" role="alert" hidden={!error}>
                {error}
            </p>
        </div>
    );
};

// 대상 프로젝트의 Git에 남는 이름. 프로젝트마다 팀 규칙이 다를 수 있어 이 프로젝트 범위로도 정할 수 있다.
const GitGroup = () => {
    return (
        <SettingsGroup id="group-git" sectionId="git-group" title="Git">
            {ROWS.map((row) => (
                <GitRow key={row.key} settingKey={row.key} title={row.title} placeholder={row.placeholder} note={row.note} />
            ))}
        </SettingsGroup>
    );
};

export { GitGroup };

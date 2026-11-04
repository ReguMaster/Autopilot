import { useEffect } from "react";
import { MODEL_LABELS, formatEffort } from "../../../viewFormat.js";
import { accounts } from "../../actions/accounts.js";
import { loadProviders } from "../../actions/runs.js";
import { settings } from "../../actions/settings.js";
import { Button } from "../../components/Button.jsx";
import { NavRow, SettingsGroup } from "../../components/SettingsGroup.jsx";
import { Tag } from "../../components/Tag.jsx";
import { CODEX_EFFORT_LEVELS, EFFORT_LEVELS } from "../../lib/constants.js";
import { getCodexModelOptions } from "../../lib/buildSteps.js";
import { useAnyRunning } from "../../hooks/useAnyRunning.js";
import { useAccountStore } from "../../stores/accountStore.js";
import { useRunsStore } from "../../stores/runsStore.js";
import { ui } from "../../stores/uiStore.js";
import { ModelVersions } from "./ModelVersions.jsx";
import { ScopeNote, useScopedValue } from "./ScopeControls.jsx";
import { ScopedSelectRow } from "./rows.jsx";

const MODEL_OPTIONS = Object.entries(MODEL_LABELS).map(([value, label]) => ({ value: value, label: label }));
const EFFORT_OPTIONS = EFFORT_LEVELS.map((level) => ({ value: level, label: formatEffort(level) }));
const CODEX_EFFORT_OPTIONS = CODEX_EFFORT_LEVELS.map((level) => ({ value: level, label: formatEffort(level, "codex") }));

// Claude 데이터 폴더. 메모리·지침·스킬이 있는 곳이고, 추가한 계정도 이 폴더의 데이터를 함께 쓴다.
const ClaudeDir = () => {
    const claudeDir = useAccountStore((store) => store.claudeDir);
    const login = useAccountStore((store) => store.login);
    const isAnyRunning = useAnyRunning();
    const isLocked = isAnyRunning || login?.phase === "waiting";

    return (
        <div id="claude-dir" className="field claude-dir" data-missing={claudeDir && !claudeDir.exists ? "" : undefined}>
            <div className="field-head">
                <h4 className="field-title">Claude 데이터 폴더</h4>
                <span id="claude-dir-auto" className="tag" hidden={!claudeDir?.isAuto}>
                    자동 감지
                </span>
                <span id="claude-dir-missing" className="tag warn" hidden={!claudeDir || claudeDir.exists}>
                    폴더를 찾지 못했어요
                </span>
            </div>
            <p id="claude-dir-path" className="path">
                {claudeDir?.path ?? ""}
            </p>
            <p className="field-desc">
                메모리·지침·스킬이 있는 .claude 폴더예요. 추가한 계정도 이 폴더의 데이터를 함께 써요. 자동 감지는 환경 변수 CLAUDE_CONFIG_DIR, 없으면 사용자 폴더의 .claude예요.
            </p>
            <div className="row-actions">
                <Button id="select-claude-dir" disabled={isLocked} onClick={() => accounts.changeClaudeDir(window.autopilot.selectClaudeDir)}>
                    폴더 변경
                </Button>
                <Button id="reset-claude-dir" disabled={isLocked || !claudeDir || claudeDir.isAuto} onClick={() => accounts.changeClaudeDir(window.autopilot.resetClaudeDir)}>
                    자동 감지
                </Button>
            </div>
        </div>
    );
};

const ClaudeGroup = () => {
    const model = useScopedValue("model").value;
    const effort = useScopedValue("effort").value;

    return (
        <SettingsGroup id="group-claude" title="Claude" note="새 실행을 시작할 때 입력창의 Claude 알약에 미리 채워 둬요.">
            <ScopedSelectRow labelId="default-label-model" settingKey="model" title="모델" value={model} options={MODEL_OPTIONS} onChange={(next) => settings.update({ model: next })} />
            <ScopedSelectRow labelId="default-label-effort" settingKey="effort" title="노력" value={effort} options={EFFORT_OPTIONS} onChange={(next) => settings.update({ effort: next })} />
            <ClaudeDir />
        </SettingsGroup>
    );
};

const ModelVersionGroup = () => {
    return (
        <SettingsGroup id="group-model" title="모델 버전">
            <div className="field">
                <p className="field-desc">기본은 각 모델의 최신 버전이에요. 버전을 고르면 그 모델을 쓸 때 고른 버전으로 실행해요. 실행 중에는 바꿀 수 없어요.</p>
                <ScopeNote settingKey="modelVersions" />
            </div>
            <div id="model-versions">
                <ModelVersions />
            </div>
        </SettingsGroup>
    );
};

const getCodexStatus = (codex) => {
    if (codex === undefined) {
        return { tone: "", label: "확인하는 중", note: "Codex가 쓸 수 있는지 확인하고 있어요." };
    }

    if (codex?.available) {
        return { tone: "ok", label: "쓸 수 있어요", note: "설치와 로그인을 확인했어요. 신규 개발의 단계마다 메인이나 보조로 쓸 수 있어요." };
    }

    return { tone: "warn", label: "쓸 수 없어요", note: codex?.reason ?? "Codex를 확인하지 못했어요." };
};

const CodexStatus = () => {
    const providers = useRunsStore((store) => store.providers);
    const status = getCodexStatus(providers ? providers.codex : undefined);

    return (
        <div id="codex-status" className="row">
            <span className="row-body">
                <b>상태</b>
                <small>{status.note}</small>
            </span>
            <Tag tone={status.tone}>{status.label}</Tag>
            <Button onClick={loadProviders}>다시 확인</Button>
        </div>
    );
};

const CodexGroup = () => {
    const codex = useRunsStore((store) => store.providers?.codex);
    const codexModel = useScopedValue("codexModel").value;
    const codexEffort = useScopedValue("codexEffort").value;

    return (
        <SettingsGroup id="group-codex" title="Codex" note="Codex는 설정 파일을 따르지 않고 늘 여기서 정한 모델과 추론으로 불러요.">
            <CodexStatus />
            <ScopedSelectRow
                labelId="default-label-codexModel"
                settingKey="codexModel"
                title="모델"
                note={codex?.models?.length ? "Codex가 알려 준 목록이에요." : "Codex의 모델 목록을 읽지 못해 저장된 값만 보여요."}
                value={codexModel}
                options={getCodexModelOptions(codex?.models ?? [], codexModel)}
                onChange={(next) => settings.update({ codexModel: next })}
            />
            <ScopedSelectRow
                labelId="default-label-codexEffort"
                settingKey="codexEffort"
                title="추론"
                value={codexEffort}
                options={CODEX_EFFORT_OPTIONS}
                onChange={(next) => settings.update({ codexEffort: next })}
            />
        </SettingsGroup>
    );
};

// 계정 추가·로그인·한도는 한도 패널이 맡는다.
const AccountGroup = () => {
    return (
        <SettingsGroup id="group-accounts" title="계정과 한도">
            <NavRow id="open-profile" aria-controls="profile" onClick={() => ui.setPanel("profile")}>
                Claude·Codex 계정과 사용량 한도 보기
            </NavRow>
        </SettingsGroup>
    );
};

const AiSection = () => {
    useEffect(() => {
        loadProviders();
    }, []);

    return (
        <>
            <ClaudeGroup />
            <ModelVersionGroup />
            <CodexGroup />
            <AccountGroup />
        </>
    );
};

export { AiSection };

import { useShallow } from "zustand/react/shallow";
import { accounts } from "../../actions/accounts.js";
import { openArchiveList } from "../../actions/runs.js";
import { changeSystemSettings, openReport, resetProgress, selectProject } from "../../actions/run.js";
import { Button } from "../../components/Button.jsx";
import { Icon } from "../../components/Icon.jsx";
import { Panel } from "../../components/Panel.jsx";
import { NavRow, SettingsGroup, SwitchRow } from "../../components/SettingsGroup.jsx";
import { useAccountStore } from "../../stores/accountStore.js";
import { useAppStore } from "../../stores/appStore.js";
import { composer, useComposerStore } from "../../stores/composerStore.js";
import { useRunStore } from "../../stores/runStore.js";
import { ui, useUiStore } from "../../stores/uiStore.js";
import { ModelVersions } from "./ModelVersions.jsx";

const KEEP_IN_TRAY_NOTE = "창을 닫아도 앱이 트레이에 남아 실행과 예약 시작이 이어져요. 끄면 실행 중이 아닐 때 창을 닫으면 앱이 종료돼요.";
const LAUNCH_AT_LOGIN_NOTE = "컴퓨터에 로그인하면 창 없이 트레이로 조용히 켜져요. 켜면 트레이 상주도 함께 켜져요.";
const LAUNCH_AT_LOGIN_UNSUPPORTED_NOTE = "설치한 앱에서만 켤 수 있어요. 개발 실행에서는 쓸 수 없어요.";

const ProviderGroup = () => {
    const claudeDir = useAccountStore((store) => store.claudeDir);
    const login = useAccountStore((store) => store.login);
    const isIdle = useRunStore((store) => store.state.status === "idle");
    const isLocked = !isIdle || login?.phase === "waiting";

    return (
        <SettingsGroup id="group-provider" title="AI 제공자">
            <div className="provider" role="radiogroup" aria-label="AI 제공자">
                <button type="button" className="provider-option" role="radio" aria-checked="true">
                    <svg className="icon provider-mark" viewBox="0 0 24 24" aria-hidden="true">
                        <use href="#mark-claude" />
                    </svg>
                    <span className="provider-text">
                        <b>Claude</b>
                        <small>Anthropic · 현재 지원하는 제공자예요</small>
                    </span>
                    <Icon symbol="icon-check" className="icon tick" />
                </button>
            </div>
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
        </SettingsGroup>
    );
};

const ProjectGroup = () => {
    const projectDir = useAppStore((store) => store.settings.projectDir);
    const isIdle = useRunStore((store) => store.state.status === "idle");

    return (
        <SettingsGroup id="group-project" title="프로젝트">
            <div className="field project" data-missing={projectDir ? undefined : ""}>
                <div className="field-head">
                    <h4 className="field-title">대상 프로젝트</h4>
                    <Button id="select-project" disabled={!isIdle} onClick={selectProject}>
                        {projectDir ? "폴더 변경" : "폴더 선택"}
                    </Button>
                </div>
                <p id="project-path" className="path">
                    {projectDir || "선택한 폴더가 없어요."}
                </p>
                <p className="field-desc">Git 저장소의 루트 폴더만 고를 수 있어요.</p>
            </div>
        </SettingsGroup>
    );
};

// 로그인 자동 실행을 켜면 트레이 상주는 반드시 켜져 있어야 하므로 끌 수 없게 잠근다. 개발 실행처럼 등록할 수 없는 환경은 켜는 쪽을 막는다.
const SystemGroup = () => {
    const { keepInTray, launchAtLogin } = useAppStore((store) => store.settings);
    const canLaunchAtLogin = useAppStore((store) => store.canLaunchAtLogin);

    return (
        <SettingsGroup id="group-system" title="시스템">
            <SwitchRow
                id="keep-in-tray"
                noteId="keep-in-tray-note"
                title="닫아도 트레이에서 계속 켜 두기"
                note={KEEP_IN_TRAY_NOTE}
                checked={Boolean(keepInTray)}
                disabled={Boolean(launchAtLogin)}
                onChange={(isOn) => changeSystemSettings({ keepInTray: isOn })}
            />
            <SwitchRow
                id="launch-at-login"
                noteId="launch-at-login-note"
                title="로그인하면 자동으로 켜기"
                note={canLaunchAtLogin || launchAtLogin ? LAUNCH_AT_LOGIN_NOTE : LAUNCH_AT_LOGIN_UNSUPPORTED_NOTE}
                checked={Boolean(launchAtLogin)}
                disabled={!canLaunchAtLogin && !launchAtLogin}
                onChange={(isOn) => changeSystemSettings({ launchAtLogin: isOn })}
            />
        </SettingsGroup>
    );
};

const HistoryGroup = () => {
    const hasProject = useAppStore((store) => Boolean(store.settings.projectDir));
    const isIdle = useRunStore((store) => store.state.status === "idle");
    const reportFile = useRunStore((store) => store.state.reportFile);
    const isHistoryOpen = useUiStore((store) => store.history);
    const isArchiveOpen = useUiStore((store) => store.archive);

    return (
        <SettingsGroup id="group-history" title="기록">
            <NavRow id="history-toggle" aria-expanded={isHistoryOpen} aria-controls="history" onClick={() => ui.setHistory(!isHistoryOpen)}>
                {isHistoryOpen ? "전체 기록 닫기" : "전체 기록 보기"}
            </NavRow>
            <NavRow id="archive-toggle" aria-expanded={isArchiveOpen} aria-controls="archive" onClick={openArchiveList}>
                지난 실행 보기
            </NavRow>
            <NavRow id="open-report" disabled={!reportFile} onClick={openReport}>
                리포트 열기
            </NavRow>
            <NavRow id="reset-progress" danger disabled={!isIdle || !hasProject} onClick={resetProgress}>
                진행 기록 초기화
            </NavRow>
        </SettingsGroup>
    );
};

const SettingsPanel = () => {
    const open = useUiStore((store) => store.panel === "settings");
    const isIdle = useRunStore((store) => store.state.status === "idle");
    const extendOnLimit = useComposerStore((store) => store.extendOnLimit);
    const { version, isDev } = useAppStore(useShallow((store) => ({ version: store.version, isDev: store.isDev })));

    return (
        <Panel id="settings" className="settings-panel" aria-labelledby="settings-title" open={open}>
            <h2 id="settings-title" className="panel-title">
                설정
            </h2>

            <ProviderGroup />

            <SettingsGroup id="group-model" title="모델 버전">
                <div className="field">
                    <p className="field-desc">기본은 각 모델의 최신 버전이에요. 버전을 고르면 그 모델을 쓸 때 고른 버전으로 실행해요. 실행 중에는 바꿀 수 없어요.</p>
                </div>
                <div id="model-versions">
                    <ModelVersions />
                </div>
            </SettingsGroup>

            <ProjectGroup />

            <SettingsGroup id="group-limit" title="사용량 한도">
                <SwitchRow
                    id="extend-on-limit"
                    title="대기한 시간만큼 종료 시각 연장"
                    note="한도에 걸려 리셋까지 기다리면 그 시간만큼 종료 시각을 늦춰요. 끄면 리셋이 종료 시각 뒤일 때 바로 끝나요."
                    checked={extendOnLimit}
                    disabled={!isIdle}
                    onChange={composer.setExtendOnLimit}
                    form="run-form"
                />
            </SettingsGroup>

            <SystemGroup />
            <HistoryGroup />

            <SettingsGroup id="group-dev" sectionId="dev-group" title="개발자" hidden={!isDev}>
                <NavRow id="toggle-devtools" onClick={() => window.appWindow.toggleDevTools()}>
                    개발자 도구 켜기/끄기
                </NavRow>
            </SettingsGroup>

            <p className="panel-foot">
                <span>앱 버전</span>
                <span id="app-version" className="num">
                    {version ? `v${version}` : ""}
                </span>
            </p>
        </Panel>
    );
};

export { SettingsPanel };

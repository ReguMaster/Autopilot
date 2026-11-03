import { useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { getUsageTone } from "../../../viewFormat.js";
import { openArchiveList } from "../../actions/runs.js";
import { schedules } from "../../actions/schedules.js";
import { activateTab, closeTab, openTab } from "../../actions/tabs.js";
import { openNewProject } from "../../actions/newProject.js";
import { AvatarRing } from "../../components/AvatarRing.jsx";
import { Button } from "../../components/Button.jsx";
import { Icon } from "../../components/Icon.jsx";
import { getTabTicks } from "../../lib/buildSteps.js";
import { PHASE_LABELS } from "../../lib/constants.js";
import { getTabLabels } from "../../lib/projectName.js";
import { EMPTY_ACCOUNT, useAccountStore } from "../../stores/accountStore.js";
import { useComposerStore } from "../../stores/composerStore.js";
import { useRunStore } from "../../stores/runStore.js";
import { useRunsStore } from "../../stores/runsStore.js";
import { useTabsStore } from "../../stores/tabsStore.js";
import { ui, useUiStore } from "../../stores/uiStore.js";
import { RailResizer } from "./RailResizer.jsx";

const IDLE_NOTES = { running: "실행 중", stopping: "종료 신호를 보냈어요", idle: "쉬는 중" };

const getRunningTitle = (label) => `${label} · 실행 중에는 닫을 수 없어요`;

// 프로젝트 한 줄 상태. 모드와 신규 개발 단계, 확인을 기다리는 단계까지 알린다.
// composerMode는 보는 프로젝트는 컴포저가 고른 작업 모드, 다른 프로젝트는 저장된 작업 모드(탭 요약의 savedMode)다. 모르면 쉬는 중이라고만 한다. 실행 중 문구는 runningText를 쓴다.
const getTabNote = ({ status, mode, step, buildPhase, composerMode, runningText = "유지 보수, 실행 중" }) => {
    if (status !== "idle") {
        if (mode === "build" && step) {
            return { text: `신규 개발, ${PHASE_LABELS[step.phase]} 단계`, tone: "run" };
        }

        return { text: status === "stopping" ? IDLE_NOTES.stopping : runningText, tone: "run" };
    }

    if (buildPhase?.awaiting) {
        return { text: `${PHASE_LABELS[buildPhase.awaiting]} 확인을 기다려요`, tone: "warn" };
    }

    if (composerMode === undefined) {
        return { text: IDLE_NOTES.idle, tone: "" };
    }

    if (composerMode !== "build") {
        return { text: "유지 보수", tone: "" };
    }

    if (!buildPhase) {
        return { text: "신규 개발", tone: "" };
    }

    return { text: buildPhase.phase === "done" ? "신규 개발, 모든 단계 마침" : `신규 개발, ${PHASE_LABELS[buildPhase.phase]} 단계부터`, tone: "" };
};

// 방향키는 포커스만 옮기고, 프로젝트를 여는 것은 Enter·Space(버튼의 기본 동작)로 한다. 실행 중인 프로젝트를 지나쳐도 전환이 일어나지 않는다.
const moveFocus = (event) => {
    const keys = { ArrowUp: -1, ArrowDown: 1, Home: -Infinity, End: Infinity };

    if (!(event.key in keys)) {
        return;
    }

    const buttons = [...event.currentTarget.querySelectorAll('[role="tab"]')];
    const current = buttons.indexOf(document.activeElement);
    const next = Math.min(buttons.length - 1, Math.max(0, current + keys[event.key]));

    event.preventDefault();
    buttons[next]?.focus();
};

// 받은 프로젝트(탭) 목록을 그린다. 보는 프로젝트는 activeNote(실시간 상태), 다른 프로젝트는 탭 요약과 단계 상태 기억(phases)으로 한 줄 상태를 보인다.
const ProjectList = ({ tabs, active, activeNote = null, activeTicks = null, phases = {} }) => {
    const listRef = useRef(null);
    const labels = getTabLabels(tabs);
    // 새 프로젝트 화면처럼 고른 탭이 없을 때도 Tab 키로 목록에 들어올 수 있게 첫 탭을 포커스 자리로 둔다.
    const hasActive = tabs.some((tab) => tab.projectDir === active);

    useEffect(() => {
        listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
    }, [active, tabs.length]);

    return (
        <div id="tabs" ref={listRef} className="projects" role="tablist" aria-orientation="vertical" aria-label="열린 프로젝트" onKeyDown={moveFocus}>
            {tabs.map((tab, index) => {
                const isActive = tab.projectDir === active;
                const isRunning = tab.status !== "idle";
                const stepOf = tab.step ? { phase: tab.step } : null;
                const ticks = isActive && activeNote ? activeTicks : getTabTicks({ status: tab.status, mode: tab.mode, step: stepOf, buildPhase: phases[tab.projectDir] ?? null });
                const note =
                    isActive && activeNote
                        ? activeNote
                        : getTabNote({ status: tab.status, mode: tab.mode, step: stepOf, buildPhase: phases[tab.projectDir] ?? null, composerMode: tab.savedMode, runningText: IDLE_NOTES.running });

                return (
                    <div key={tab.projectDir} className="proj" data-active={isActive ? "" : undefined} data-status={tab.status} data-tone={note.tone || undefined}>
                        <button
                            type="button"
                            role="tab"
                            className="proj-main"
                            aria-selected={isActive}
                            tabIndex={isActive || (!hasActive && index === 0) ? 0 : -1}
                            title={tab.projectDir}
                            onClick={() => activateTab(tab.projectDir)}
                        >
                            <span className="proj-mark" aria-hidden="true">
                                {Array.from(labels[index])[0]?.toUpperCase()}
                                {isRunning || note.tone === "warn" ? <i className="proj-badge" /> : null}
                            </span>
                            <span className="proj-name rail-label">{labels[index]}</span>
                            <span className="proj-note rail-label">{note.text}</span>
                            {ticks ? (
                                <span className="proj-ticks" aria-hidden="true">
                                    {ticks.map((state, tick) => (
                                        <i key={tick} data-s={state || undefined} />
                                    ))}
                                </span>
                            ) : null}
                        </button>
                        <button
                            type="button"
                            className="proj-close"
                            aria-label={`${labels[index]} 닫기`}
                            title={isRunning ? getRunningTitle(labels[index]) : "닫기"}
                            disabled={isRunning}
                            onClick={() => closeTab(tab.projectDir)}
                        >
                            <Icon symbol="icon-x" />
                        </button>
                    </div>
                );
            })}
        </div>
    );
};

// 가장 많이 쓴 한도를 보인다.
const getTopLimit = (limits) => {
    return limits.reduce((top, limit) => (!top || limit.percent > top.percent ? limit : top), null);
};

// "5시간 한도"는 "5시간", "주간 한도 (전체)"는 "주간"으로 줄인다.
const getShortLimitName = (label) => label.replace(" 한도", "").replace(" (전체)", "");

const AccountCard = () => {
    const isOpen = useUiStore((store) => store.panel === "profile");
    const { account, label } = useAccountStore(
        useShallow((store) => ({
            account: store.snapshots[store.activeId] ?? EMPTY_ACCOUNT,
            label: store.accounts.find((item) => item.id === store.activeId)?.label ?? ""
        }))
    );
    const name = account.profile?.name || account.profile?.email || label || "Claude 계정";
    const limit = getTopLimit(account.limits);
    const percent = limit ? Math.round(limit.percent) : null;

    return (
        <button type="button" id="profile-toggle" className="rail-account" aria-label="프로필" title={name} aria-expanded={isOpen} aria-controls="profile" onClick={() => ui.togglePanel("profile")}>
            <AvatarRing letter={Array.from(name)[0]?.toUpperCase()} percent={percent} aria-hidden="true" />
            <span className="rail-account-body rail-label">
                <b className="rail-account-name">{name}</b>
                {limit ? (
                    <span className="rail-account-use" data-tone={getUsageTone(percent)}>
                        {`${getShortLimitName(limit.label)} ${percent}%`}
                    </span>
                ) : null}
            </span>
            <Icon symbol="icon-chevron" className="icon rail-chevron rail-label" />
        </button>
    );
};

// 왼쪽 레일: 열린 프로젝트(탭)와 지난 실행·예약·설정, 계정. 탭 줄과 헤더 버튼을 대신한다.
const Rail = () => {
    const { tabs, active } = useTabsStore(useShallow((store) => ({ tabs: store.tabs, active: store.active })));
    const { status, mode, step } = useRunStore(useShallow((store) => ({ status: store.state.status, mode: store.state.mode, step: store.state.step })));
    const buildPhase = useRunsStore((store) => store.buildPhase);
    const phases = useRunsStore((store) => store.phases);
    const composerMode = useComposerStore((store) => store.mode);
    const { panel, archive, schedule, isCreating } = useUiStore(useShallow((store) => ({ panel: store.panel, archive: store.archive, schedule: store.schedule, isCreating: store.newProject })));
    const activeNote = getTabNote({ status: status, mode: mode, step: step, buildPhase: buildPhase, composerMode: composerMode });
    // 쉬는 중인 보는 프로젝트는 유지 보수로 둔 동안에는 눈금을 그리지 않는다.
    const activeTicks = status !== "idle" || buildPhase?.awaiting || composerMode === "build" ? getTabTicks({ status: status, mode: mode, step: step, buildPhase: buildPhase }) : null;

    return (
        <aside id="rail" className="rail" aria-label="프로젝트와 메뉴">
            <div className="rail-brand">
                <img src="../docs/logo.png" alt="Autopilot" />
            </div>
            <h2 className="rail-section rail-label">프로젝트</h2>
            <nav id="tabbar" className="rail-projects" aria-label="열린 프로젝트">
                <ProjectList tabs={tabs} active={isCreating ? "" : active} activeNote={activeNote} activeTicks={activeTicks} phases={phases} />
                <div className="rail-add-group">
                    <Button id="new-project-toggle" size="" className="rail-add" aria-label="새 프로젝트" title="새 프로젝트" aria-current={isCreating ? "page" : undefined} onClick={openNewProject}>
                        <Icon symbol="icon-plus" />
                        <span className="rail-label">새 프로젝트</span>
                    </Button>
                    <Button id="tab-add" size="" className="rail-add" aria-label="프로젝트 열기" title="프로젝트 열기" onClick={openTab}>
                        <Icon symbol="icon-folder" />
                        <span className="rail-label">프로젝트 열기</span>
                    </Button>
                </div>
            </nav>
            <div className="rail-foot">
                <button
                    type="button"
                    id="archive-toggle"
                    className="rail-item"
                    aria-label="지난 실행"
                    title="지난 실행"
                    aria-expanded={archive}
                    aria-controls="archive"
                    onClick={() => (archive ? ui.setArchive(false) : openArchiveList())}
                >
                    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
                        <path d="M2.6 8a5.4 5.4 0 1 0 1.6-3.8M2.4 2.6v2.6H5" />
                        <path d="M8 5.2V8l2 1.3" />
                    </svg>
                    <span className="rail-label">지난 실행</span>
                </button>
                <button
                    type="button"
                    id="schedule-toggle"
                    className="rail-item"
                    aria-label="예약"
                    title="예약"
                    aria-expanded={schedule}
                    aria-controls="schedule"
                    onClick={() => (schedule ? schedules.close() : schedules.open())}
                >
                    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
                        <rect x="2.4" y="3.2" width="11.2" height="10.4" rx="2" />
                        <path d="M2.4 6.6h11.2M5.4 1.8v2.6M10.6 1.8v2.6" />
                    </svg>
                    <span className="rail-label">예약</span>
                </button>
                <button
                    type="button"
                    id="settings-toggle"
                    className="rail-item"
                    aria-label="설정"
                    title="설정"
                    aria-expanded={panel === "settings"}
                    aria-controls="settings"
                    onClick={() => ui.togglePanel("settings")}
                >
                    <svg className="icon" viewBox="0 0 12 12" aria-hidden="true">
                        <path d="M10.93 5.18L10.93 6.82L9.78 6.94L9.34 8.01L10.07 8.91L8.91 10.07L8.01 9.34L6.94 9.78L6.82 10.93L5.18 10.93L5.06 9.78L3.99 9.34L3.09 10.07L1.93 8.91L2.66 8.01L2.22 6.94L1.07 6.82L1.07 5.18L2.22 5.06L2.66 3.99L1.93 3.09L3.09 1.93L3.99 2.66L5.06 2.22L5.18 1.07L6.82 1.07L6.94 2.22L8.01 2.66L8.91 1.93L10.07 3.09L9.34 3.99L9.78 5.06Z" />
                        <circle cx="6" cy="6" r="1.6" />
                    </svg>
                    <span className="rail-label">설정</span>
                </button>
                <AccountCard />
            </div>
            <RailResizer />
        </aside>
    );
};

export { Rail, ProjectList, getTabNote };

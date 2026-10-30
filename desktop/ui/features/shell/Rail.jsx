import { useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { getUsageTone } from "../../../viewFormat.js";
import { openArchiveList } from "../../actions/runs.js";
import { schedules } from "../../actions/schedules.js";
import { activateTab, closeTab, openTab } from "../../actions/tabs.js";
import { openNewProject } from "../../actions/newProject.js";
import { Icon } from "../../components/Icon.jsx";
import { PHASE_LABELS } from "../../lib/constants.js";
import { getTabLabels } from "../../lib/projectName.js";
import { EMPTY_ACCOUNT, useAccountStore } from "../../stores/accountStore.js";
import { useComposerStore } from "../../stores/composerStore.js";
import { useRunStore } from "../../stores/runStore.js";
import { useRunsStore } from "../../stores/runsStore.js";
import { useTabsStore } from "../../stores/tabsStore.js";
import { ui, useUiStore } from "../../stores/uiStore.js";

const IDLE_NOTES = { running: "실행 중", stopping: "종료 신호를 보냈어요", idle: "쉬는 중" };
const WEEKLY_LABEL_PREFIX = "주간";

const getRunningTitle = (label) => `${label} · 실행 중에는 닫을 수 없어요`;

// 보는 프로젝트는 모드와 신규 개발 단계까지 한 줄로 알린다. 다른 프로젝트는 실행 상태만 안다.
const getActiveNote = ({ status, mode, step, buildPhase, composerMode }) => {
    if (status !== "idle") {
        if (mode === "build" && step) {
            return { text: `신규 개발, ${PHASE_LABELS[step.phase]} 단계`, tone: "run" };
        }

        return { text: status === "stopping" ? IDLE_NOTES.stopping : "유지 보수, 실행 중", tone: "run" };
    }

    if (buildPhase?.awaiting) {
        return { text: `${PHASE_LABELS[buildPhase.awaiting]} 확인을 기다려요`, tone: "warn" };
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

// 받은 프로젝트(탭) 목록을 그린다. 보는 프로젝트만 activeNote로 자세한 상태를 보인다.
const ProjectList = ({ tabs, active, activeNote = null }) => {
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
                const note = isActive && activeNote ? activeNote : { text: IDLE_NOTES[tab.status] ?? IDLE_NOTES.idle, tone: isRunning ? "run" : "" };

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
                                {note.tone === "run" ? <span className="ring" /> : Array.from(labels[index])[0]?.toUpperCase()}
                            </span>
                            <span className="proj-name rail-label">{labels[index]}</span>
                            <span className="proj-note rail-label">{note.text}</span>
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

// 주간 한도가 있으면 그것을, 없으면 가장 많이 쓴 한도를 보인다.
const getWeeklyLimit = (limits) => {
    return limits.find((limit) => limit.label.startsWith(WEEKLY_LABEL_PREFIX)) ?? limits.toSorted((first, second) => second.percent - first.percent)[0] ?? null;
};

const AccountCard = () => {
    const isOpen = useUiStore((store) => store.panel === "profile");
    const { account, label } = useAccountStore(
        useShallow((store) => ({
            account: store.snapshots[store.activeId] ?? EMPTY_ACCOUNT,
            label: store.accounts.find((item) => item.id === store.activeId)?.label ?? ""
        }))
    );
    const name = account.profile?.name || account.profile?.email || label || "Claude 계정";
    const limit = getWeeklyLimit(account.limits);
    const percent = limit ? Math.round(limit.percent) : null;

    return (
        <button type="button" id="profile-toggle" className="rail-account" aria-label="프로필" title={name} aria-expanded={isOpen} aria-controls="profile" onClick={() => ui.togglePanel("profile")}>
            <span className="rail-avatar" aria-hidden="true">
                {Array.from(name)[0]?.toUpperCase()}
            </span>
            <span className="rail-account-body rail-label">
                <span className="rail-account-top">
                    <b className="rail-account-name">{name}</b>
                    {percent === null ? null : <span className="num">{`주간 ${percent}%`}</span>}
                </span>
                {percent === null ? null : <i className="rail-meter" data-tone={getUsageTone(percent)} style={{ "--value": String(percent) }} />}
            </span>
        </button>
    );
};

// 왼쪽 레일: 열린 프로젝트(탭)와 지난 실행·예약·설정, 계정. 탭 줄과 헤더 버튼을 대신한다.
const Rail = () => {
    const { tabs, active } = useTabsStore(useShallow((store) => ({ tabs: store.tabs, active: store.active })));
    const { status, mode, step } = useRunStore(useShallow((store) => ({ status: store.state.status, mode: store.state.mode, step: store.state.step })));
    const buildPhase = useRunsStore((store) => store.buildPhase);
    const composerMode = useComposerStore((store) => store.mode);
    const { panel, archive, schedule, isCreating } = useUiStore(useShallow((store) => ({ panel: store.panel, archive: store.archive, schedule: store.schedule, isCreating: store.newProject })));
    const activeNote = getActiveNote({ status: status, mode: mode, step: step, buildPhase: buildPhase, composerMode: composerMode });

    return (
        <aside id="rail" className="rail" aria-label="프로젝트와 메뉴">
            <div className="rail-brand">
                <img src="../docs/icon.png" alt="" />
                <span className="rail-label">Autopilot</span>
            </div>
            <h2 className="rail-section rail-label">프로젝트</h2>
            <nav id="tabbar" className="rail-projects" aria-label="열린 프로젝트">
                <ProjectList tabs={tabs} active={isCreating ? "" : active} activeNote={activeNote} />
                <button
                    type="button"
                    id="new-project-toggle"
                    className="rail-item"
                    aria-label="새 프로젝트"
                    title="새 프로젝트"
                    aria-current={isCreating ? "page" : undefined}
                    onClick={openNewProject}
                >
                    <Icon symbol="icon-plus" />
                    <span className="rail-label">새 프로젝트</span>
                </button>
                <button type="button" id="tab-add" className="rail-item" aria-label="프로젝트 열기" title="프로젝트 열기" onClick={openTab}>
                    <Icon symbol="icon-folder" />
                    <span className="rail-label">프로젝트 열기</span>
                </button>
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
        </aside>
    );
};

export { Rail, ProjectList, getActiveNote };

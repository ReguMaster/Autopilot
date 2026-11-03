import { useShallow } from "zustand/react/shallow";
import { describeScheduleSummary, describeStreak, formatDayKey, formatEndTimeShort, getGreeting, getStreakSummary } from "../../../viewFormat.js";
import { openArchiveDetail, openArchiveList } from "../../actions/runs.js";
import { schedules } from "../../actions/schedules.js";
import { Icon } from "../../components/Icon.jsx";
import { RunList } from "../../components/RunList.jsx";
import { Seg } from "../../components/Seg.jsx";
import { getProjectName } from "../../lib/projectName.js";
import { useClock } from "../../stores/clock.js";
import { useAppStore } from "../../stores/appStore.js";
import { composer, useComposerStore } from "../../stores/composerStore.js";
import { useRunStore } from "../../stores/runStore.js";
import { useRunsStore } from "../../stores/runsStore.js";
import { useScheduleStore } from "../../stores/scheduleStore.js";
import { useUiStore } from "../../stores/uiStore.js";
import { LinkedRepoPeek } from "../shell/LinkedRepoPeek.jsx";
import { ProjectHead } from "../shell/ProjectHead.jsx";
import { BuildReady } from "./BuildReady.jsx";
import { ApprovalView } from "../approval/ApprovalView.jsx";
import { useApproval } from "../../hooks/useApproval.js";

const RECENT_RUN_COUNT = 3;

// 시작 전 인사. 프로젝트 이름은 따로 꾸미고, 문구는 시각·정책·종료 시각에 따라 달라진다.
const Greeting = () => {
    const projectName = useAppStore((store) => getProjectName(store.settings.projectDir));
    const { policy, endTime } = useComposerStore(useShallow((store) => ({ policy: store.policy, endTime: store.endTime })));
    const hour = useClock((now) => new Date(now).getHours());
    const today = useClock(formatDayKey);
    const streakDays = useRunsStore((store) => store.streakDays);
    const streakText = describeStreak(getStreakSummary(streakDays, today));
    const endLabel = useClock((now) => formatEndTimeShort(endTime, now));
    const greeting = getGreeting({ hour: hour, policy: policy, endTime: endTime, endLabel: endLabel, projectName: projectName, streakText: streakText });
    const [before, after] = projectName ? greeting.title.split(projectName) : [greeting.title, ""];

    return (
        <>
            <h1 id="greet-title">
                {before}
                {projectName ? <span className="project-name">{projectName}</span> : null}
                {projectName ? after : null}
            </h1>
            <p id="greet-lead" className="lead">
                {greeting.lead}
            </p>
        </>
    );
};

// 예약 한 줄: 다음에 시작할 때와 한도 리셋을 기다리는 예약 수. 남은 시간 문구가 바뀌도록 매초 확인한다.
const SchedulePeek = () => {
    const { schedules: list, statuses } = useScheduleStore((store) => store.payload);
    const isOpen = useUiStore((store) => store.schedule);
    const text = useClock((now) => describeScheduleSummary(list, statuses, now));

    return (
        <button type="button" id="schedule-peek" className="peek" aria-controls="schedule" aria-expanded={isOpen} onClick={schedules.open}>
            <Icon symbol="icon-clock" />
            <span id="schedule-peek-text">{text}</span>
        </button>
    );
};

const RecentRuns = () => {
    const hasProject = useAppStore((store) => Boolean(store.settings.projectDir));
    const recent = useRunsStore((store) => store.recent);
    const isArchiveOpen = useUiStore((store) => store.archive);
    const runs = recent.slice(0, RECENT_RUN_COUNT);

    return (
        <section id="recent" className="recent" aria-label="지난 실행" hidden={!hasProject || !runs.length}>
            <div className="recent-head">
                <h2>지난 실행</h2>
                <button type="button" id="archive-all" className="link" aria-controls="archive" aria-expanded={isArchiveOpen} onClick={openArchiveList}>
                    <Icon symbol="icon-lines" />
                    전체 보기
                </button>
            </div>
            <RunList id="recent-list" className="recent-list" runs={runs} onOpen={openArchiveDetail} />
        </section>
    );
};

const MODE_OPTIONS = [
    { value: "maintain", label: "유지 보수", icon: "icon-policy-auto" },
    { value: "build", label: "신규 개발", icon: "icon-spark" }
];

// 작업 모드 전환. 고른 칸 뒤로 알약이 미끄러져 옮겨 가고, 실행 중에는 바꿀 수 없다.
const ModeSeg = () => {
    const mode = useComposerStore((store) => store.mode);
    const isIdle = useRunStore((store) => store.state.status === "idle");

    return <Seg name="mode" label="작업 모드" className="mode-seg" slide options={MODE_OPTIONS.map((option) => ({ ...option, disabled: !isIdle }))} value={mode} onChange={composer.setMode} />;
};

// 시작 전: 프로젝트 이름과 작업 모드, 그 아래에 유지 보수는 인사와 지난 실행, 신규 개발은 단계 카드와 안내를 둔다.
const ReadyView = () => {
    const isBuild = useComposerStore((store) => store.mode === "build");
    const hasProject = useAppStore((store) => Boolean(store.settings.projectDir));
    const showBuild = isBuild && hasProject;
    const approval = useApproval();

    // 확인받기 단계에서 멈췄으면 산출물을 확인하는 화면이다. 마친 화면에서도 같은 화면을 쓴다(FinishView).
    if (approval) {
        return (
            <section className="greet view-ready approval" data-mode="build" aria-label="확인 기다림">
                <ApprovalView phase={approval} side={<ModeSeg />} />
            </section>
        );
    }

    return (
        <section className="greet view-ready" data-mode={showBuild ? "build" : "maintain"} aria-label="시작 전">
            <ProjectHead hideName>
                <ModeSeg />
            </ProjectHead>
            {showBuild ? <BuildReady /> : <Greeting />}
            <SchedulePeek />
            <LinkedRepoPeek />
            {showBuild ? null : <RecentRuns />}
        </section>
    );
};

export { ReadyView };

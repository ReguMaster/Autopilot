import { WEEKDAY_NAMES, describePastRun, describeSchedule, formatClock, formatPastDay, formatScheduleWhen, getStartOfDay } from "../../viewFormat.js";
import { PHASE_LABELS } from "./constants.js";
import { getTabTicks } from "./buildSteps.js";
import { getProjectName } from "./projectName.js";

// 홈 화면의 내용. 이어하기(지금)·오늘 예정(앞으로)·마지막 한 일(지난)은 서로 다른 질문에 답하고, 한 가지 사실은 한 곳에만 나온다.
// DOM·스토어에 의존하지 않아 tests/checkDesktopUi.js가 그대로 부른다.
const HOUR_MS = 60 * 60 * 1000;
const STOPPED_WINDOW_MS = 72 * HOUR_MS;
const OVERNIGHT_MS = 14 * HOUR_MS;
const NOON_HOUR = 12;
// 지금 일하는 곳을 맨 앞에 둔다(인사가 그 프로젝트를 말한다). 확인 대기는 그다음이고 레일의 점과 인사의 둘째 문장이 계속 알린다.
const KIND_ORDER = { running: 0, awaiting: 1, stopped: 2 };

// 멈춘 이유 중 이어서 할 만한 것. 사용자가 직접 멈춘 실행(중단 요청·강제 종료)과 정상 종료는 넣지 않는다.
const STOPPED_REASONS = [
    [/사용량 한도/, "한도에 걸려"],
    [/연속 \d+회 실패|^실행 오류/, "오류로"],
    [/^테스트\/QA 실패$/, "테스트/QA 실패로"],
    [/^보안검토 실패$/, "보안검토 실패로"]
];

// 목록(최근 순)에서 가장 최근에 끝난 실행. 진행 중이거나 읽을 수 없거나 회차가 없는 기록은 뺀다.
const getLatestRun = (runs) => {
    return runs.find((run) => !run.isActive && !run.isUnreadable && !run.isEmpty && run.roundCount > 0) ?? null;
};

const getRunEnd = (run) => run.endedAt || run.startedAt;

const getAwaitingSay = (phase) => {
    const label = PHASE_LABELS[phase.awaiting];
    const disputeCount = phase.debate?.disputes?.length ?? 0;

    if (disputeCount > 0) {
        return `${label} 협의에서 못 맞춘 쟁점이 ${disputeCount}개 있어요. 골라 주세요.`;
    }

    if ((phase.proposals?.candidates?.length ?? 0) > 1 && !phase.proposals.picked) {
        return `${label} 안이 둘 준비됐어요. 하나를 골라 주세요.`;
    }

    return `${label} 단계를 마쳤어요. 확인하고 승인하면 다음 단계를 시작해요.`;
};

const getRunningSay = (tab) => {
    if (tab.status === "stopping") {
        return "종료 신호를 받아 마무리하고 있어요.";
    }

    return tab.mode === "build" && tab.step ? `신규 개발, ${PHASE_LABELS[tab.step]} 단계를 하고 있어요.` : "유지 보수를 하고 있어요.";
};

const getStoppedSay = (run) => {
    const reason = STOPPED_REASONS.find(([pattern]) => pattern.test(run.reason));

    return reason ? `${reason[1]} ${formatClock(getRunEnd(run))}에 멈췄어요.` : "";
};

// 프로젝트 하나가 이어하기에 들어가는지와 그 문장. 실행 중 → 확인 대기 → 한도·오류로 멈춤 순서로 앞에 둔다.
const getResumeItem = (tab, { phase, run, nowMs }) => {
    const base = { projectDir: tab.projectDir, name: tab.name };

    if (tab.status !== "idle") {
        const ticks = getTabTicks({ status: tab.status, mode: tab.mode, step: tab.step ? { phase: tab.step } : null, buildPhase: phase });

        return { ...base, kind: "running", tone: "run", tag: tab.status === "stopping" ? "종료하는 중" : "실행 중", say: getRunningSay(tab), facts: "", ticks: ticks, actionLabel: "지켜보기" };
    }

    if (phase?.awaiting) {
        const ticks = getTabTicks({ status: "idle", mode: tab.mode, step: null, buildPhase: phase });

        return { ...base, kind: "awaiting", tone: "warn", tag: "확인을 기다려요", say: getAwaitingSay(phase), facts: getAwaitingFacts(run), ticks: ticks, actionLabel: "확인하기" };
    }

    const say = run && nowMs - getRunEnd(run) < STOPPED_WINDOW_MS ? getStoppedSay(run) : "";

    return say ? { ...base, kind: "stopped", tone: "", tag: "", say: say, facts: "", ticks: null, actionLabel: "이어서 하기" } : null;
};

const getAwaitingFacts = (run) => {
    if (!run) {
        return "";
    }

    const commits = run.commitCount ? `커밋 ${run.commitCount}개를 남겼어요` : "커밋은 남기지 않았어요";

    return `${formatClock(getRunEnd(run))}에 멈췄고, ${run.roundCount}회차 동안 ${commits}.`;
};

const getResumeItems = ({ tabs, phases, latestRuns, nowMs }) => {
    return tabs
        .map((tab) => getResumeItem(tab, { phase: phases[tab.projectDir] ?? null, run: latestRuns[tab.projectDir] ?? null, nowMs: nowMs }))
        .filter(Boolean)
        .sort((left, right) => KIND_ORDER[left.kind] - KIND_ORDER[right.kind]);
};

const isSameDay = (ms, nowMs) => getStartOfDay(ms) === getStartOfDay(nowMs);

// 예약이 도는 프로젝트. 프로젝트 예약은 저장할 때 달린 프로젝트, 전역 예약은 그때 보는 프로젝트다(scheduler의 getScheduleDir).
const getScheduleProject = (schedule, tabs, active) => {
    const projectDir = schedule.scope === "project" ? schedule.projectDir : active;

    return tabs.find((tab) => tab.projectDir === projectDir)?.name ?? getProjectName(projectDir);
};

// 오늘 안에 시작하는 예약. 정해진 시각은 그 시각, 한도 리셋은 리셋 시각이 오늘이면 그 시각에 맞춰 시각 순으로 둔다.
// later는 오늘 예정이 없을 때 알릴 다음 예약 시각(없으면 0)이다.
const getTodayEntries = ({ schedules, statuses, tabs, active, nowMs }) => {
    const entries = [];
    let later = 0;

    for (const schedule of schedules.filter((item) => item.enabled)) {
        const status = statuses.find((item) => item.id === schedule.id);
        const isReset = status?.code === "waiting-reset";
        const at = isReset ? status.resetsAt : status?.code === "next-time" ? status.at : 0;

        if (!at) {
            continue;
        }

        if (!isSameDay(at, nowMs)) {
            later = later ? Math.min(later, at) : at;

            continue;
        }

        entries.push({
            id: schedule.id,
            at: at,
            when: isReset ? `오늘 ${formatClock(at)} 한도 리셋 뒤` : `오늘 ${formatClock(at)}`,
            name: getScheduleProject(schedule, tabs, active),
            say: isReset ? "한도가 리셋되면 시작해요." : "실행을 시작해요.",
            fact: describeSchedule(schedule).detail
        });
    }

    entries.sort((left, right) => left.at - right.at);

    return { entries: entries, laterText: later ? formatScheduleWhen(later, nowMs) : "" };
};

const getRunFacts = (run) => {
    const rounds = `${run.roundCount}회차`;

    return run.commitCount ? `${rounds}, 커밋 ${run.commitCount}개, 변경 +${run.insertions} −${run.deletions}줄` : `${rounds}, 커밋은 남기지 않았어요`;
};

// 열린 프로젝트들의 마지막 실행 중 가장 최근에 끝난 하나. 결과 문장은 성과 줄이나 첫 커밋 제목(run.headline)이고 없으면 회차 요약이다.
const getLastDone = ({ tabs, latestRuns, nowMs }) => {
    let best = null;

    for (const tab of tabs) {
        const run = latestRuns[tab.projectDir];

        if (run && (!best || getRunEnd(run) > getRunEnd(best.run))) {
            best = { tab: tab, run: run };
        }
    }

    if (!best) {
        return null;
    }

    const { tab, run } = best;
    const description = describePastRun(run, nowMs);
    const day = formatPastDay(run.startedAt, nowMs);
    const when = run.endedAt > run.startedAt ? `${day} ${formatClock(run.startedAt)}부터 ${formatClock(run.endedAt)}까지` : `${day} ${formatClock(run.startedAt)}`;

    return { projectDir: tab.projectDir, name: tab.name, runId: run.id, when: when, say: run.headline || description.lead, facts: getRunFacts(run), status: description.status };
};

const formatHomeDate = (nowMs) => {
    const date = new Date(nowMs);
    const hour = date.getHours();
    const meridiem = hour < NOON_HOUR ? "오전" : "오후";

    return `${date.getMonth() + 1}월 ${date.getDate()}일 ${WEEKDAY_NAMES[date.getDay()]}요일, ${meridiem} ${hour % NOON_HOUR || NOON_HOUR}:${String(date.getMinutes()).padStart(2, "0")}`;
};

// 인사는 앞 글 · 강조 · 뒷 글로 나눠 강조만 굵게 그린다.
const getHomeGreeting = ({ tabs, items, latestRuns, nowMs }) => {
    if (!tabs.length) {
        return { before: "안녕하세요. ", strong: "첫 프로젝트", after: "를 시작해 볼까요?", lead: "Git 저장소의 루트 폴더를 열거나, 한두 줄만 적어서 새로 만들 수 있어요." };
    }

    const running = items.filter((item) => item.kind === "running");
    const awaitingCount = items.filter((item) => item.kind === "awaiting").length;
    const stoppedCount = items.filter((item) => item.kind === "stopped").length;
    const nightCount = tabs.filter((tab) => latestRuns[tab.projectDir] && nowMs - getRunEnd(latestRuns[tab.projectDir]) < OVERNIGHT_MS).length;
    const hour = new Date(nowMs).getHours();
    const parts = [];

    if (awaitingCount) {
        parts.push(`확인해 주실 일이 ${awaitingCount}개 있어요.`);
    }

    if (stoppedCount) {
        parts.push(`멈춘 곳이 ${stoppedCount}곳 있어요.`);
    }

    const lead = parts.join(" ");

    if (running.length) {
        return { before: "지금 ", strong: running.length === 1 ? running[0].name : `프로젝트 ${running.length}곳`, after: "에서 일하고 있어요.", lead: lead };
    }

    if (hour < NOON_HOUR && nightCount) {
        return { before: "어젯밤 ", strong: `프로젝트 ${nightCount}곳`, after: "에서 일했어요.", lead: lead };
    }

    if (items.length) {
        return { before: "이어서 할 일이 ", strong: `${items.length}개`, after: " 있어요.", lead: lead };
    }

    return { before: "오늘은 ", strong: "무엇을", after: " 맡겨 볼까요?", lead: "프로젝트를 열어 일을 적어 두거나, 예약해 두면 정해진 때에 시작해요." };
};

// 홈 화면 전체. 스토어의 값을 그대로 받아 화면이 그릴 것만 돌려준다.
const getHomeModel = ({ tabs, active, phases, latestRuns, schedules, statuses, nowMs }) => {
    const items = getResumeItems({ tabs: tabs, phases: phases, latestRuns: latestRuns, nowMs: nowMs });

    return {
        date: formatHomeDate(nowMs),
        greeting: getHomeGreeting({ tabs: tabs, items: items, latestRuns: latestRuns, nowMs: nowMs }),
        items: items,
        today: getTodayEntries({ schedules: schedules, statuses: statuses, tabs: tabs, active: active, nowMs: nowMs }),
        scheduleCount: schedules.length,
        lastDone: getLastDone({ tabs: tabs, latestRuns: latestRuns, nowMs: nowMs })
    };
};

export { getLatestRun, getResumeItems, getTodayEntries, getLastDone, formatHomeDate, getHomeGreeting, getHomeModel };

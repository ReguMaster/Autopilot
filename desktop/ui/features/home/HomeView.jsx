import { useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { continueProject, loadLatestRuns, openLastReport, openLastRun } from "../../actions/home.js";
import { openNewProject } from "../../actions/newProject.js";
import { schedules } from "../../actions/schedules.js";
import { openTab } from "../../actions/tabs.js";
import { Button } from "../../components/Button.jsx";
import { Icon } from "../../components/Icon.jsx";
import { Tag } from "../../components/Tag.jsx";
import { PHASE_LABELS } from "../../lib/constants.js";
import { getHomeModel } from "../../lib/homeModel.js";
import { useClock } from "../../stores/clock.js";
import { useRunsStore } from "../../stores/runsStore.js";
import { useScheduleStore } from "../../stores/scheduleStore.js";
import { useTabsStore } from "../../stores/tabsStore.js";
import "./HomeView.css";

const BUILD_STEP_KEYS = Object.keys(PHASE_LABELS);

const ACTION_ICONS = { awaiting: "icon-doc", running: "icon-eye", stopped: "icon-play" };

const getLetter = (name) => Array.from(name)[0]?.toUpperCase() ?? "";

const Tile = ({ name, tone }) => (
    <span className="home-tile" data-tone={tone || undefined} aria-hidden="true">
        {getLetter(name)}
    </span>
);

// 신규 개발 다섯 단계. ticks는 레일의 눈금과 같은 값(done·active·hold·stop·빈 값)이다.
const Steps = ({ ticks }) => (
    <div className="home-steps" aria-label="신규 개발 단계">
        {ticks.map((state, index) => (
            <div key={BUILD_STEP_KEYS[index]} className="home-step" data-s={state || undefined}>
                <i></i>
                <span>{PHASE_LABELS[BUILD_STEP_KEYS[index]]}</span>
            </div>
        ))}
    </div>
);

const ResumeCard = ({ item }) => (
    <article className="home-resume" data-kind={item.kind}>
        <div className="home-resume-top">
            <Tile name={item.name} tone={item.tone} />
            <div className="home-resume-name">
                <b title={item.projectDir}>{item.name}</b>
                {item.tag ? (
                    <Tag tone={item.tone}>
                        {item.kind === "running" ? <i className="ring"></i> : null}
                        {item.tag}
                    </Tag>
                ) : null}
            </div>
            <Button variant="primary" size="" className="home-resume-act" onClick={() => continueProject(item.projectDir)}>
                <Icon symbol={ACTION_ICONS[item.kind]} />
                {item.actionLabel}
            </Button>
            <div className="home-resume-body">
                <p className="home-resume-say">{item.say}</p>
                {item.facts ? <p className="home-resume-facts">{item.facts}</p> : null}
            </div>
        </div>
        {item.ticks ? <Steps ticks={item.ticks} /> : null}
    </article>
);

const ResumeRow = ({ item }) => (
    <li className="home-row">
        <Tile name={item.name} tone={item.tone} />
        <p className="home-row-text">
            <b>{item.name}</b>
            <span>{item.say}</span>
        </p>
        <Button onClick={() => continueProject(item.projectDir)}>
            <Icon symbol={ACTION_ICONS[item.kind]} />
            {item.actionLabel}
        </Button>
    </li>
);

// 이어하기: 지금 손댈 프로젝트만. 첫 항목은 카드, 나머지는 한 줄이다.
const ResumeSection = ({ items }) => {
    const [first, ...rest] = items;

    return (
        <section id="home-resume" className="home-resume-sec" aria-label="이어하기">
            <div className="home-sec-head">
                <h2>이어하기</h2>
                <span className="home-sec-sub">지금 손댈 곳</span>
            </div>
            <ResumeCard item={first} />
            {rest.length ? (
                <ul className="home-rows">
                    {rest.map((item) => (
                        <ResumeRow key={item.projectDir} item={item} />
                    ))}
                </ul>
            ) : null}
        </section>
    );
};

// 오늘 예정: 앞으로 돌 일. 없으면 한 줄만 두고 다음 예약이 있으면 알린다.
const TodaySection = ({ today, scheduleCount }) => (
    <section id="home-today" aria-label="오늘 예정">
        <div className="home-sec-head">
            <h2>오늘 예정</h2>
            <span className="home-sec-sub">앞으로 돌 일</span>
        </div>
        {today.entries.length ? (
            today.entries.map((entry) => (
                <article key={entry.id} className="home-entry">
                    <p className="home-entry-when">{entry.when}</p>
                    <p className="home-entry-who">
                        <Tile name={entry.name} />
                        <b>{entry.name}</b>
                    </p>
                    <p className="home-entry-say">{entry.say}</p>
                    {entry.fact ? <p className="home-entry-fact">{entry.fact}</p> : null}
                </article>
            ))
        ) : (
            <p className="home-empty">{today.laterText ? `오늘 예정된 실행은 없어요. 다음 예약은 ${today.laterText}이에요.` : "오늘 예정된 실행이 없어요."}</p>
        )}
        <button type="button" id="home-schedule" className="link home-more" aria-controls="schedule" onClick={schedules.open}>
            <Icon symbol="icon-clock" />
            {scheduleCount ? `예약 ${scheduleCount}개 모두 보기` : "예약 만들기"}
        </button>
    </section>
);

// 마지막 한 일: 가장 최근에 끝난 실행 하나. 멈춘 실행이면 그 이유도 알린다.
const LastDoneSection = ({ lastDone }) => (
    <section id="home-last" aria-label="마지막 한 일">
        <div className="home-sec-head">
            <h2>마지막 한 일</h2>
            <span className="home-sec-sub">가장 최근에 끝난 실행</span>
        </div>
        <article className="home-entry">
            <p className="home-entry-when">
                {lastDone.when}
                {["warn", "danger"].includes(lastDone.status.tone) ? <Tag tone={lastDone.status.tone}>{lastDone.status.label}</Tag> : null}
            </p>
            <p className="home-entry-who">
                <Tile name={lastDone.name} />
                <b title={lastDone.projectDir}>{lastDone.name}</b>
            </p>
            <p className="home-entry-say big">{lastDone.say}</p>
            <p className="home-entry-fact">{lastDone.facts}</p>
            <div className="home-entry-act">
                <Button onClick={() => openLastRun(lastDone)}>
                    <Icon symbol="icon-lines" />
                    대화 보기
                </Button>
                <Button onClick={() => openLastReport(lastDone)}>
                    <Icon symbol="icon-doc" />
                    리포트 열기
                </Button>
            </div>
        </article>
    </section>
);

// 프로젝트가 하나도 없을 때: 시작하는 두 길과 짧은 안내
const StartSection = () => (
    <>
        <div className="home-start">
            <button type="button" id="home-new-project" className="home-start-card" onClick={openNewProject}>
                <span className="home-tile" data-tone="run">
                    <Icon symbol="icon-plus" />
                </span>
                <b>새 프로젝트 만들기</b>
                <span>무엇을 만들지 한두 줄만 적어 주세요. 나머지 초안은 제가 채워 둘게요.</span>
            </button>
            <button type="button" id="home-open-project" className="home-start-card" onClick={openTab}>
                <span className="home-tile">
                    <Icon symbol="icon-folder" />
                </span>
                <b>프로젝트 열기</b>
                <span>이미 쓰는 Git 저장소의 폴더를 골라 주세요. 쌓아 둔 일을 하나씩 해 둘게요.</span>
            </button>
        </div>
        <ul className="home-how">
            <li>
                <Icon symbol="icon-policy-auto" />
                <p>
                    <b>유지 보수</b>는 적어 주신 일을 끝낼 시각까지 하나씩 해 두고, 남는 시간에는 스스로 고칠 곳을 찾아요.
                </p>
            </li>
            <li>
                <Icon symbol="icon-spark" />
                <p>
                    <b>신규 개발</b>은 기획부터 보안검토까지 단계마다 확인을 받으며 만들어요.
                </p>
            </li>
            <li>
                <Icon symbol="icon-clock" />
                <p>
                    <b>예약</b>해 두면 정해진 때나 한도가 리셋될 때 알아서 시작해요.
                </p>
            </li>
        </ul>
    </>
);

// 앱을 켜면 처음 보이는 화면. 열린 모든 프로젝트를 한눈에 보고 어디서 이어 갈지 정한다.
const HomeView = () => {
    const { tabs, active } = useTabsStore(useShallow((store) => ({ tabs: store.tabs, active: store.active })));
    const phases = useRunsStore((store) => store.phases);
    const latestRuns = useRunsStore((store) => store.latestRuns);
    const { schedules: scheduleList, statuses } = useScheduleStore((store) => store.payload);
    const minute = useClock((now) => Math.floor(now / 60000));
    const nowMs = useMemo(() => Date.now(), [minute]);
    const model = useMemo(
        () => getHomeModel({ tabs: tabs, active: active, phases: phases, latestRuns: latestRuns, schedules: scheduleList, statuses: statuses, nowMs: nowMs }),
        [tabs, active, phases, latestRuns, scheduleList, statuses, nowMs]
    );
    const { greeting } = model;
    // 열릴 때와 탭의 실행 상태가 바뀔 때(실행이 끝난 직후 등) 마지막 실행을 다시 읽는다.
    const tabKey = tabs.map((tab) => `${tab.projectDir}|${tab.status}`).join("\n");

    useEffect(() => {
        loadLatestRuns(tabs.map((tab) => tab.projectDir));
    }, [tabKey]);

    return (
        <section id="home" className="home" aria-label="홈">
            <p className="home-date">{model.date}</p>
            <h1 id="home-title">
                {greeting.before}
                <b>{greeting.strong}</b>
                {greeting.after}
            </h1>
            {greeting.lead ? (
                <p id="home-lead" className="lead">
                    {greeting.lead}
                </p>
            ) : null}
            {tabs.length ? (
                <div className="home-grid">
                    {model.items.length ? <ResumeSection items={model.items} /> : null}
                    <TodaySection today={model.today} scheduleCount={model.scheduleCount} />
                    {model.lastDone ? <LastDoneSection lastDone={model.lastDone} /> : null}
                </div>
            ) : (
                <StartSection />
            )}
        </section>
    );
};

// StartSection은 시계를 쓰지 않아 서버 렌더로 마크업을 검증할 수 있다(tests/checkDesktopUi.js).
export { HomeView, StartSection };

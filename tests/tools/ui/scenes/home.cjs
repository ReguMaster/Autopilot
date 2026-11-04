const { ACCOUNTS, HOUR, MINUTE, NOW, PROJECT, makeRun } = require("./data.cjs");

const SECOND = "E:/Workspaces/Demo/autopilot-landing";
const THIRD = "E:/Workspaces/Demo/orbit-notes";

const tab = (projectDir, status = "idle", extra = {}) => ({ projectDir: projectDir, name: projectDir.split("/").pop(), status: status, savedMode: "maintain", ...extra });

// 가짜 시계는 2026-09-01 10:00이다. 어젯밤에 돈 프로젝트 셋: 기획서 확인을 기다리는 Kirikomodo, 마친 autopilot-landing, 한도에 걸려 멈춘 orbit-notes.
const RUNS_BY_PROJECT = {
    [PROJECT]: [
        makeRun(0, {
            id: "2026-08-31/autopilot_230000_k.log",
            startedAt: NOW - 11 * HOUR,
            endedAt: NOW - (8 * HOUR + 20 * MINUTE),
            reason: "기획 확인 대기",
            mode: "build",
            roundCount: 3,
            commitCount: 4,
            insertions: 310,
            deletions: 0,
            headline: "기획서 10절을 모두 썼어요"
        })
    ],
    [SECOND]: [
        makeRun(0, {
            id: "2026-08-31/autopilot_230000_a.log",
            startedAt: NOW - 11 * HOUR,
            endedAt: NOW - 3 * HOUR,
            roundCount: 7,
            commitCount: 9,
            insertions: 420,
            deletions: 130,
            headline: "테스트 통과 38 → 50"
        })
    ],
    [THIRD]: [
        makeRun(0, {
            id: "2026-08-31/autopilot_030000_o.log",
            startedAt: NOW - 7 * HOUR,
            endedAt: NOW - (4 * HOUR + 40 * MINUTE),
            reason: "사용량 한도로 종료",
            roundCount: 2,
            commitCount: 1,
            insertions: 24,
            deletions: 3,
            headline: "린트 경고 24 → 3"
        })
    ]
};

const PHASE_AWAITING = { phase: "plan", awaiting: "plan", qaRetries: 0, securityRetries: 0, proposals: null, debate: null, receivedProposal: null };

const SCHEDULES = {
    schedules: [
        {
            id: "sch-1",
            enabled: true,
            kind: "time",
            time: "23:00",
            window: "session",
            from: "",
            to: "",
            days: [0, 1, 2, 3, 4, 5, 6],
            minRemaining: 40,
            duration: 420,
            scope: "project",
            projectDir: SECOND
        }
    ],
    statuses: [{ id: "sch-1", code: "next-time", at: new Date(2026, 8, 1, 23, 0, 0).getTime() }]
};

const base = (tabs) => ({
    settings: { projectDir: PROJECT },
    tabs: tabs,
    accounts: ACCOUNTS,
    startAtHome: true,
    runsByProject: RUNS_BY_PROJECT,
    model: { phaseByProject: { [PROJECT]: PHASE_AWAITING } },
    schedules: SCHEDULES
});

const readHome = (t) =>
    t.eval(
        `JSON.stringify({ home: document.body.hasAttribute("data-home"), title: document.getElementById("home-title")?.textContent ?? "", lead: document.getElementById("home-lead")?.textContent ?? "", rows: document.querySelectorAll(".home-row").length, entries: document.querySelectorAll("#home-today .home-entry").length, last: document.querySelector("#home-last .home-entry-say")?.textContent ?? "", stageShown: Boolean(document.querySelector(".stage")) && getComputedStyle(document.querySelector(".stage")).display !== "none", composerShown: Boolean(document.getElementById("run-form")) && getComputedStyle(document.getElementById("run-form")).display !== "none" })`
    );

// 홈: 앱을 켜면 보이는 화면. 확인 대기·한도로 멈춤·마친 실행이 한 화면에 모이고, 누르면 그 프로젝트로 간다.
const SCENES = [
    {
        name: "home-morning",
        init: base([tab(PROJECT), tab(SECOND), tab(THIRD)]),
        run: async (t) => {
            await t.wait(600);
            await t.note("home", await readHome(t));
            await t.shot("page");
            await t.shot("rail", "#rail");
            await t.clearCalls();
            await t.click(".home-resume-act");
            await t.wait(600);
            await t.note("after-continue", await readHome(t));
            await t.click("#home-toggle");
            await t.wait(600);
            await t.note("back-home", await readHome(t));
            await t.click(".home-row .button");
            await t.wait(600);
            await t.note("row-action", await readHome(t));
            await t.note("calls", JSON.stringify((await t.calls()).filter((call) => ["activateTab", "readRun"].includes(call[0]))));
        }
    },
    {
        name: "home-running",
        init: base([tab(PROJECT), tab(SECOND, "running"), tab(THIRD)]),
        run: async (t) => {
            await t.wait(600);
            await t.note("home", await readHome(t));
            await t.shot("page");
        }
    },
    {
        name: "home-first",
        init: { settings: { projectDir: "" }, tabs: [], accounts: ACCOUNTS, startAtHome: true },
        run: async (t) => {
            await t.wait(600);
            await t.note("home", await readHome(t));
            await t.shot("page");
            await t.click("#home-new-project");
            await t.wait(600);
            await t.note("new-project", await readHome(t));
            await t.click("#home-toggle");
            await t.wait(600);
            await t.note("back-home", await readHome(t));
        }
    },
    {
        name: "home-narrow",
        size: [800, 700],
        init: base([tab(PROJECT), tab(SECOND), tab(THIRD)]),
        run: async (t) => {
            await t.wait(600);
            await t.shot("page");
        }
    }
];

module.exports = { SCENES };

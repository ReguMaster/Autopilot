const { PROJECT, RUNS, round, runningState, doneState } = require("./data.cjs");

const SECOND = "E:/Workspaces/Demo/hanbit-booking";

const getTabs = () => [
    { projectDir: SECOND, name: "hanbit-booking", status: "idle" },
    { projectDir: PROJECT, name: "Kirikomodo", status: "idle" }
];

const BUILD = {
    settings: { projectDir: SECOND, mode: "build", tasks: "동네 미용실 예약 웹앱. 손님은 날짜와 디자이너를 골라 예약하고, 원장은 하루 예약표를 한눈에 본다." },
    tabs: getTabs(),
    runs: RUNS
};

const PLAN_DOC = {
    kind: "file",
    path: "docs/autopilot/plan.md",
    isPartial: false,
    text: [
        "# 동네 미용실 예약 웹앱",
        "",
        "손님이 날짜와 디자이너를 골라 30분 단위로 예약하고, 원장이 하루 예약표를 보는 웹앱이에요.",
        "",
        "## 화면 6개",
        "- 손님: 디자이너 고르기, 날짜와 시간 고르기, 예약 확인, 내 예약",
        "- 원장: 하루 예약표, 디자이너 근무 시간 설정",
        "",
        "## 기술 선택",
        "- Next.js 15, SQLite(Prisma), Tailwind. 새 dependency 6개(허용됨)",
        "- 로그인은 원장 한 명만, 손님은 전화번호로 `예약 조회`",
        "",
        "## 이번에 하지 않는 것",
        "- 카카오 알림톡, 결제, 여러 매장",
        "",
        "## 개발 순서",
        "1. 데이터 구조와 예약 가능 시간 계산",
        "2. 손님 화면",
        "3. 원장 화면"
    ].join("\n")
};
const DESIGN_DOC = {
    kind: "folder",
    path: "docs/autopilot/design",
    entries: ["customer-choose.html", "customer-confirm.html", "customer-time.html", "index.html", "owner-day.html", "owner-hours.html", "style.css"]
};

const commit = (hash, insertions, subject) => ({ hash: hash, insertions: insertions, deletions: 0, subject: subject });
const BUILD_ROUNDS = [
    round(1, { commits: [commit("e02b5c9", 903, "[ap] Next.js와 SQLite 기본 구조")] }),
    round(2, { commits: [commit("3fa77d2", 167, "[ap] 디자이너 선택 화면")] }),
    round(3, { commits: [commit("9c1e04a", 214, "[ap] 예약 가능 시간 계산")] }),
    round(4, { endedAt: 0, outcome: "", commits: [] })
];
const buildRunState = (overrides = {}) =>
    runningState({
        project: SECOND,
        mode: "build",
        step: { phase: "build", status: "running", qaRetries: 0 },
        phase: "4회차 진행 중",
        round: 4,
        rounds: BUILD_ROUNDS,
        gains: [],
        work: { toolCalls: 212, filesRead: 48, filesEdited: 31 },
        ...overrides
    });
const BUILD_LINES = [
    "[앱] 엔진을 시작했어요",
    "10:00:05   > Edit app/reserve/page.tsx",
    "10:00:07 예약 화면에서 디자이너를 고르면 그날 비어 있는 시간만 보이게 했어요.",
    "10:00:09   > Bash npm test",
    "10:00:12 겹치는 예약을 막는 검사를 서버에도 넣고 있어요."
];
const getRunTabs = () => [
    { projectDir: SECOND, name: "hanbit-booking", status: "running" },
    { projectDir: PROJECT, name: "Kirikomodo", status: "idle" }
];
const RUN_BUILD = { settings: BUILD.settings, tabs: getRunTabs(), state: buildRunState(), model: { buildPhase: { phase: "build", awaiting: null, qaRetries: 0 } } };
const NARROW = [820, 700];

// 신규 개발의 실행 중·확인 기다림·마친 화면과 유지 보수 실행 중, 좁은 창
const BUILD_RUN_SCENES = [
    {
        name: "run-build",
        init: RUN_BUILD,
        run: async (t) => {
            await t.log(BUILD_LINES);
            await t.shot("run");
            await t.shot("steps", "#run-steps");
            await t.shot("card", "#run-card");
        }
    },
    {
        name: "run-build-qa-retry",
        init: { ...RUN_BUILD, state: buildRunState({ step: { phase: "build", status: "running", qaRetries: 1 } }) },
        run: async (t) => {
            await t.log(BUILD_LINES);
            await t.shot("steps", "#run-steps");
        }
    },
    {
        name: "run-maintain",
        init: { settings: { projectDir: PROJECT }, state: runningState(), tabs: [{ projectDir: PROJECT, name: "Kirikomodo", status: "running" }] },
        run: async (t) => {
            await t.log(["[앱] 엔진을 시작했어요", "10:00:05   > Grep createStory", "10:00:07 이야기를 만드는 부분을 찾았어요.", "10:00:10 이야기 영역이 같은 모양이면 다시 그리지 않게 고쳤어요."]);
            await t.shot("run");
        }
    },
    {
        name: "approval-plan",
        init: { ...BUILD, model: { buildPhase: { phase: "design", awaiting: "plan", qaRetries: 0 }, phaseDocs: { plan: PLAN_DOC } } },
        run: async (t) => {
            await t.shot("approval");
            await t.click("#approval-feedback");
            await t.type("원장 화면에 주간 보기도 넣어 주세요");
            await t.click("#approval-revise");
            await t.wait(300);
            await t.note("revise", await t.eval("JSON.stringify(window.__calls.filter((call) => call[0] === 'start').map((call) => ({ tasks: call[1].tasks, keepTasks: call[1].keepTasks })))"));
        }
    },
    {
        name: "approval-plan-approve",
        init: { ...BUILD, model: { buildPhase: { phase: "design", awaiting: "plan", qaRetries: 0 }, phaseDocs: { plan: PLAN_DOC } } },
        run: async (t) => {
            await t.click("#approval-approve");
            await t.wait(300);
            await t.note("calls", await t.eval("JSON.stringify(window.__calls.filter((call) => ['approvePhase', 'start'].includes(call[0])).map((call) => call[0]))"));
        }
    },
    {
        name: "approval-design",
        init: {
            ...BUILD,
            state: doneState({
                project: SECOND,
                mode: "build",
                reason: "디자인 확인 대기",
                exitCode: 0,
                step: { phase: "design", status: "awaiting", qaRetries: 0 },
                rounds: BUILD_ROUNDS.slice(0, 2),
                gains: []
            }),
            model: { buildPhase: { phase: "build", awaiting: "design", qaRetries: 0 }, phaseDocs: { design: DESIGN_DOC } }
        },
        run: async (t) => {
            await t.shot("approval");
        }
    },
    {
        name: "approval-no-doc",
        init: { ...BUILD, model: { buildPhase: { phase: "design", awaiting: "plan", qaRetries: 0 } } },
        run: async (t) => {
            await t.shot("approval");
        }
    },
    {
        name: "done-build-complete",
        init: {
            ...BUILD,
            state: doneState({
                project: SECOND,
                mode: "build",
                reason: "신규 개발: 모든 단계 완료",
                exitCode: 0,
                step: { phase: "qa", status: "done", qaRetries: 1 },
                rounds: BUILD_ROUNDS.slice(0, 3),
                gains: [{ round: 3, text: "테스트 통과 0 → 34" }]
            }),
            model: { buildPhase: { phase: "done", awaiting: null, qaRetries: 1 } }
        },
        run: async (t) => {
            await t.shot("done");
        }
    },
    {
        name: "done-qa-failed",
        init: {
            ...BUILD,
            state: doneState({
                project: SECOND,
                mode: "build",
                reason: "테스트/QA 실패",
                exitCode: 0,
                step: { phase: "qa", status: "failed", qaRetries: 3 },
                rounds: BUILD_ROUNDS.slice(0, 3),
                gains: []
            }),
            model: { buildPhase: { phase: "qa", awaiting: null, qaRetries: 3 } }
        },
        run: async (t) => {
            await t.shot("done");
        }
    },
    {
        name: "run-build-narrow",
        size: NARROW,
        init: RUN_BUILD,
        run: async (t) => {
            await t.log(BUILD_LINES);
            await t.shot("run");
        }
    },
    {
        name: "approval-plan-narrow",
        size: NARROW,
        init: { ...BUILD, model: { buildPhase: { phase: "design", awaiting: "plan", qaRetries: 0 }, phaseDocs: { plan: PLAN_DOC } } },
        run: async (t) => {
            await t.shot("approval");
        }
    },
    {
        name: "ready-build-narrow",
        size: NARROW,
        init: BUILD,
        run: async (t) => {
            await t.shot("ready");
            await t.click("#end-time-button");
            await t.wait(400);
            await t.shot("endtime", "");
        }
    }
];

// 신규 개발의 시작 전 화면: 단계 카드(칸마다 설정), 허용 팝오버, 날짜를 고르는 종료 시각, 이어서 할 단계
const SCENES = [
    {
        name: "ready-build",
        init: BUILD,
        run: async (t) => {
            await t.shot("ready");
            await t.shot("steps", "#build-steps");
            await t.shot("composer", ".composer");
        }
    },
    {
        name: "ready-build-allow-popover",
        init: BUILD,
        run: async (t) => {
            await t.click("#allow-chip");
            await t.wait(400);
            await t.shot("ready");
            await t.click('[data-allow="send"]');
            await t.wait(300);
            await t.shot("popover-send", "#allow-popover");
            await t.note("allow", await t.eval("document.querySelector('#allow-count').textContent"));
        }
    },
    {
        name: "ready-build-endtime-popover",
        init: BUILD,
        run: async (t) => {
            await t.click("#end-time-button");
            await t.wait(400);
            await t.click('[data-shortcut="weekend"]');
            await t.wait(400);
            await t.shot("ready");
            await t.shot("popover", "#end-time-popover");
        }
    },
    {
        name: "ready-build-resume",
        init: { ...BUILD, settings: { ...BUILD.settings, tasks: "" }, model: { buildPhase: { phase: "design", awaiting: null, qaRetries: 0 } } },
        run: async (t) => {
            await t.shot("ready");
        }
    },
    {
        name: "ready-build-awaiting",
        init: { ...BUILD, model: { buildPhase: { phase: "design", awaiting: "plan", qaRetries: 0 }, phaseDocs: { plan: PLAN_DOC } } },
        run: async (t) => {
            await t.shot("ready");
        }
    },
    ...BUILD_RUN_SCENES
];

module.exports = { SCENES };

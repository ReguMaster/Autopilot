const { PROJECT, RUNS } = require("./data.cjs");

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
        init: { ...BUILD, model: { buildPhase: { phase: "design", awaiting: "plan", qaRetries: 0 } } },
        run: async (t) => {
            await t.shot("ready");
        }
    }
];

module.exports = { SCENES };

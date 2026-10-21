const { ACCOUNTS, MODELS, NOW, PROJECT, RUNS, doneState, runningState } = require("./data.cjs");

const SECOND = "E:/Workspaces/Demo/autopilot-landing";

const TOOL = (name, argument, time) => `${time}   > ${name} ${argument}`;

const getTabs = (status) => [
    { projectDir: PROJECT, name: "Kirikomodo", status: status },
    { projectDir: SECOND, name: "autopilot-landing", status: "idle" }
];

// README에 싣는 화면(docs/screenshots). 가짜 데이터로 같은 장면을 다시 찍을 수 있게 장면으로 둔다.
// electron tests/tools/ui/runScenes.cjs -- --root . --out <폴더> --scenes readme-ready,readme-running,readme-done,readme-settings,readme-history
const SCENES = [
    {
        name: "readme-ready",
        init: { settings: { projectDir: PROJECT }, runs: RUNS, tabs: getTabs("idle") },
        run: async (t) => {
            await t.shot("ready");
        }
    },
    {
        name: "readme-running",
        init: { settings: { projectDir: PROJECT }, state: runningState(), tabs: getTabs("running") },
        run: async (t) => {
            await t.log([
                "[앱] 엔진을 시작했어요",
                TOOL("Grep", "createStory", "10:00:05"),
                TOOL("Read", "desktop/viewFormat.js", "10:00:06"),
                "10:00:07 이야기를 만드는 부분을 찾았어요. 도구 줄이 오면 앱이 지은 문장을 먼저 보여주고, Claude의 문장이 오면 그 문장으로 바꿔 줘요.",
                TOOL("Edit", "desktop/ui/features/run/RunView.jsx", "10:00:09"),
                "10:00:10 이야기 영역이 같은 모양이면 다시 그리지 않게 고쳤어요."
            ]);
            await t.shot("running");
        }
    },
    {
        name: "readme-settings",
        init: { settings: { projectDir: PROJECT }, accounts: ACCOUNTS, models: MODELS, runs: RUNS, tabs: getTabs("idle") },
        run: async (t) => {
            await t.click("#settings-toggle");
            await t.wait(700);
            await t.shot("settings", "", { skipDom: true });
        }
    },
    {
        name: "readme-history",
        init: { settings: { projectDir: PROJECT }, state: runningState(), tabs: getTabs("running") },
        run: async (t) => {
            await t.log([
                "[앱] 엔진을 시작했어요",
                "[1회차] 시작 - 남은 시간 420분 (model claude-opus-4-8, effort high)",
                TOOL("Read", "src/search.js", "10:00:03"),
                TOOL("Bash", "npm run bench -- search", "10:00:09"),
                "10:00:11 상품 2만 개 기준으로 지금은 한 번 검색에 1.4초가 걸려요.",
                TOOL("Edit", "src/search.js", "10:00:20"),
                TOOL("Bash", "npm test", "10:00:41"),
                "10:00:50 앞부분이 맞는 상품부터 찾도록 쿼리를 다듬었어요.",
                "성과: 검색 응답 시간 1.4초 → 0.2초",
                "[커밋] f48e64d +28 -5 [ap] 상품 검색이 인덱스를 쓰도록 쿼리 정리",
                "[1회차] 완료",
                "[2회차] 시작 - 남은 시간 380분 (model claude-opus-4-8, effort high)",
                TOOL("Read", "src/payments/retry.js", "10:30:02"),
                "10:30:06 재시도할 때마다 새 청구가 만들어지고 있었어요."
            ]);
            await t.click("#live-panel");
            await t.wait(700);
            await t.shot("history", "", { skipDom: true });
        }
    },
    {
        name: "readme-done",
        init: {
            settings: { projectDir: PROJECT },
            state: doneState(),
            tabs: getTabs("idle"),
            logs: ["10:00:03 먼저 프로젝트 구조를 살펴보고 있어요.", "10:40:11 검색 쿼리가 인덱스를 쓰도록 고쳐 뒀어요."].map((text) => ({ stream: "out", text: text, at: NOW }))
        },
        run: async (t) => {
            await t.shot("done");
        }
    }
];

module.exports = { SCENES };

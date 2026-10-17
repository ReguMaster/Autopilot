const { NOW, PROJECT, RUNS, doneState, runningState } = require("./data.cjs");

const SECOND = "E:/Workspaces/Demo/autopilot-landing";

const TOOL = (name, argument, time) => `${time}   > ${name} ${argument}`;

const getTabs = (status) => [
    { projectDir: PROJECT, name: "Kirikomodo", status: status },
    { projectDir: SECOND, name: "autopilot-landing", status: "idle" }
];

// README에 싣는 화면(docs/screenshots). 가짜 데이터로 같은 장면을 다시 찍을 수 있게 장면으로 둔다.
// electron tests/tools/ui/runScenes.cjs -- --root . --out <폴더> --scenes readme-ready,readme-running,readme-done
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

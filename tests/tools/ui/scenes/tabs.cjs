const { PROJECT, runningState } = require("./data.cjs");

const SECOND = "E:/Workspaces/Demo/autopilot-landing";
const THIRD = "E:/Workspaces/Demo/a-project-with-a-rather-long-folder-name";

const tab = (projectDir, status = "idle") => ({ projectDir: projectDir, name: projectDir.split("/").pop(), status: status });

const THREE_TABS = [tab(PROJECT), tab(SECOND, "running"), tab(THIRD)];

// 프로젝트 탭 줄: 실행 중인 탭의 점, 활성 탭, 긴 이름, 이름이 같은 탭, 좁은 창. 탭을 주지 않은 다른 장면에는 탭 줄이 없다.
const SCENES = [
    {
        name: "tabs-ready",
        init: { settings: { projectDir: PROJECT }, tabs: THREE_TABS },
        run: async (t) => {
            await t.shot("tabbar", ".tabbar");
            await t.shot("page");
            await t.hover(".tab[data-active]");
            await t.shot("hover-active", ".tabbar");
            await t.hover(".tab:nth-child(3)");
            await t.shot("hover-idle", ".tabbar");
        }
    },
    {
        name: "tabs-running",
        init: { settings: { projectDir: SECOND }, state: runningState(), tabs: THREE_TABS },
        run: async (t) => {
            await t.shot("tabbar", ".tabbar");
            await t.shot("page");
            await t.note("close-disabled", await t.eval(`JSON.stringify([...document.querySelectorAll(".tab-close")].map((button) => button.disabled))`));
            await t.clearCalls();
            await t.click(".tab:nth-child(1) .tab-main");
            await t.click(".tab:nth-child(3) .tab-close");
            await t.note("calls", JSON.stringify((await t.calls()).map((call) => call.join(":"))));
            await t.shot("after-close", ".tabbar");
        }
    },
    {
        name: "tabs-same-name",
        init: {
            settings: { projectDir: "E:/Work/app" },
            tabs: [tab("E:/Work/app"), tab("E:/Personal/app"), tab("E:/Work/api")]
        },
        run: async (t) => {
            await t.shot("tabbar", ".tabbar");
            await t.note("labels", await t.eval(`JSON.stringify([...document.querySelectorAll(".tab-name")].map((node) => node.textContent))`));
        }
    },
    {
        name: "tabs-narrow",
        size: [480, 640],
        init: {
            settings: { projectDir: PROJECT },
            tabs: [tab(PROJECT), tab(SECOND, "running"), tab(THIRD), tab("E:/Workspaces/Demo/one"), tab("E:/Workspaces/Demo/two"), tab("E:/Workspaces/Demo/three")]
        },
        run: async (t) => {
            await t.shot("titlebar", ".titlebar");
            await t.shot("tabbar", ".tabbar");
            await t.shot("page");
            await t.note("overflow", await t.eval(`(() => { const el = document.querySelector(".tabs"); return JSON.stringify([el.scrollWidth, el.clientWidth]); })()`));
        }
    }
];

module.exports = { SCENES };

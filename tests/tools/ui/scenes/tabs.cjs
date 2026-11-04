const { ACCOUNTS, CODEX_ACCOUNTS, PROJECT, runningState } = require("./data.cjs");

const SECOND = "E:/Workspaces/Demo/autopilot-landing";
const THIRD = "E:/Workspaces/Demo/a-project-with-a-rather-long-folder-name";

const tab = (projectDir, status = "idle", savedMode = "maintain") => ({ projectDir: projectDir, name: projectDir.split("/").pop(), status: status, savedMode: savedMode });

const THREE_TABS = [tab(PROJECT), tab(SECOND, "running"), tab(THIRD)];

// 레일의 프로젝트 목록: 실행 중인 프로젝트의 고리, 보는 프로젝트, 긴 이름, 이름이 같은 프로젝트, 좁은 창(아이콘 띠). 탭을 주지 않은 다른 장면에는 목록이 비어 있다.
const SCENES = [
    {
        name: "tabs-ready",
        init: { settings: { projectDir: PROJECT }, tabs: THREE_TABS },
        run: async (t) => {
            await t.shot("rail", "#rail");
            await t.shot("page");
            await t.hover(".proj[data-active]");
            await t.shot("hover-active", "#rail");
            await t.hover(".proj:nth-child(3)");
            await t.shot("hover-idle", "#rail");
        }
    },
    {
        name: "rail-resize",
        init: { settings: { projectDir: PROJECT }, tabs: THREE_TABS, accounts: ACCOUNTS, codexAccounts: CODEX_ACCOUNTS },
        run: async (t) => {
            const readWidth = () => t.eval(`getComputedStyle(document.getElementById("rail")).width`);

            await t.shot("rail", "#rail");
            await t.hover("#new-project-toggle");
            await t.shot("hover-new", "#rail");
            await t.hover("#tab-add");
            await t.shot("hover-open", "#rail");

            await t.clearCalls();
            await t.drag(".rail-resizer", 80);
            await t.note("dragged", await readWidth());
            await t.note("saved", JSON.stringify((await t.calls()).filter((call) => call[0] === "setPreferences")));
            await t.shot("wide", "#rail");

            await t.drag(".rail-resizer", -400);
            await t.note("collapsing", await readWidth());
            await t.wait(600);
            await t.note("collapsed", `${await readWidth()} ${await t.eval(`document.documentElement.hasAttribute("data-rail-collapsed")`)}`);
            await t.shot("collapsed", "#rail");
            await t.hover(".proj:nth-child(3)");
            await t.shot("collapsed-hover", "#rail");
            await t.drag(".rail-resizer", 400);
            await t.wait(600);
            await t.note("clamped-max", await readWidth());

            await t.focus(".rail-resizer");
            await t.press("Home");
            await t.wait(600);
            await t.note("home", await readWidth());
            await t.shot("collapsed-home", "#rail");
            await t.press("Right");
            await t.wait(600);
            await t.note("right", await readWidth());

            await t.eval(`document.querySelector(".rail-resizer").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))`);
            await t.note("reset", await readWidth());

            await t.click("#new-project-toggle");
            await t.shot("creating", "#rail");
        }
    },
    {
        name: "tabs-running",
        init: { settings: { projectDir: SECOND }, state: runningState(), tabs: THREE_TABS },
        run: async (t) => {
            await t.shot("rail", "#rail");
            await t.shot("page");
            await t.note("close-disabled", await t.eval(`JSON.stringify([...document.querySelectorAll(".proj-close")].map((button) => button.disabled))`));
            await t.clearCalls();
            await t.click(".proj:nth-child(1) .proj-main");
            await t.hover(".proj:nth-child(3)");
            await t.click(".proj:nth-child(3) .proj-close");
            await t.shot("close-confirm");
            await t.confirm();
            await t.note("calls", JSON.stringify((await t.calls()).map((call) => call.join(":"))));
            await t.shot("after-close", "#rail");
        }
    },
    {
        name: "tabs-same-name",
        init: {
            settings: { projectDir: "E:/Work/app" },
            tabs: [tab("E:/Work/app"), tab("E:/Personal/app"), tab("E:/Work/api")]
        },
        run: async (t) => {
            await t.shot("rail", "#rail");
            await t.note("labels", await t.eval(`JSON.stringify([...document.querySelectorAll(".proj-name")].map((node) => node.textContent))`));
        }
    },
    {
        name: "tabs-narrow",
        size: [800, 640],
        init: {
            settings: { projectDir: PROJECT },
            tabs: [tab(PROJECT), tab(SECOND, "running"), tab(THIRD), tab("E:/Workspaces/Demo/one"), tab("E:/Workspaces/Demo/two"), tab("E:/Workspaces/Demo/three")]
        },
        run: async (t) => {
            await t.shot("titlebar", ".titlebar");
            await t.shot("rail", "#rail");
            await t.shot("page");
            await t.note("overflow", await t.eval(`(() => { const el = document.querySelector(".rail-projects"); return JSON.stringify([el.scrollHeight, el.clientHeight]); })()`));
        }
    }
];

module.exports = { SCENES };

const { NOW, PROJECT, runningState, doneState, withProject } = require("./data.cjs");

const SCENES = [
    {
        name: "shell-ready-no-project",
        init: {},
        run: async (t) => {
            await t.shot("titlebar", ".titlebar");
            await t.shot("course", ".course");
            await t.shot("notices", ".notices");
            await t.shot("page");
        }
    },
    {
        name: "shell-ready-project",
        init: withProject,
        run: async (t) => {
            await t.shot("notices", ".notices");
            await t.shot("course", ".course");
            await t.shot("page");
        }
    },
    {
        name: "shell-running",
        init: { ...withProject, state: runningState() },
        run: async (t) => {
            await t.shot("course", ".course");
            await t.state({ phase: "5분 후 재시도 대기" });
            await t.shot("course-retry", ".course");
            await t.state({ status: "stopping", phase: "3회차 진행 중" });
            await t.shot("course-stopping", ".course");
            await t.state({ attached: true, status: "running" });
            await t.shot("course-attached", ".course");
            await t.state({ deadlineAt: 0 });
            await t.shot("course-no-deadline", ".course");
        }
    },
    {
        name: "shell-done",
        init: { ...withProject, state: doneState() },
        run: async (t) => {
            await t.shot("course", ".course");
            await t.state({ reason: "사용량 한도 도달로 종료", exitCode: 1 });
            await t.shot("course-failed", ".course");
        }
    },
    {
        name: "shell-titlebar-controls",
        init: { ...withProject, model: { update: { version: "1.3.0", url: "https://example.com" } }, isDev: true },
        run: async (t) => {
            await t.shot("update-chip", ".titlebar");
            await t.click("#window-maximize");
            await t.shot("maximized", ".titlebar");
            await t.click("#window-maximize");
            await t.hover("#settings-toggle");
            await t.shot("hover-settings", ".titlebar");
            await t.click("#update-chip");
            await t.note("calls", (await t.calls()).map((call) => call[0]).join(","));
        }
    }
];

module.exports = { SCENES, NOW, PROJECT };

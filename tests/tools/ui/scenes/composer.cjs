const { PROJECT, runningState, withProject } = require("./data.cjs");

const CHIPS = [
    ["model", "#model-chip"],
    ["effort", "#effort-control"],
    ["policy", "#policy-chip"],
    ["end-time", "#end-time-button"],
    ["main", "#main-action"]
];

const noteCalls = async (t, key = "calls") => {
    await t.note(key, JSON.stringify(await t.calls()));
};

const SCENES = [
    {
        name: "composer-ready",
        init: { ...withProject },
        run: async (t) => {
            await t.shot("composer", ".composer");

            for (const [name, selector] of CHIPS) {
                await t.shot(`chip-${name}`, selector);
            }

            await t.hover("#model-chip");
            await t.shot("chip-model-hover", "#model-chip");
        }
    },
    {
        name: "composer-no-project",
        init: {},
        run: async (t) => {
            await t.shot("composer", ".composer");
            await t.shot("main", "#main-action");
        }
    },
    {
        name: "composer-model-popover",
        init: { ...withProject },
        run: async (t) => {
            await t.click("#model-chip");
            await t.shot("popover-open", "#model-popover");
            await t.shot("chip-open", "#model-chip");
            await t.click("#model-popover label:nth-child(3)");
            await t.wait(500);
            await t.shot("chip-sonnet", "#model-chip");
            await t.shot("popover-after-pick", "#model-popover", { skipDom: true });
            await t.click("#model-chip");
            await t.shot("popover-sonnet", "#model-popover");
        }
    },
    {
        name: "composer-effort-popover",
        init: { ...withProject },
        run: async (t) => {
            await t.click("#effort-control");
            await t.shot("popover-open", "#effort-popover");
            await t.click("#effort-popover button:nth-child(5)");
            await t.wait(500);
            await t.shot("chip-max", "#effort-control");
            await t.click("#effort-control");
            await t.shot("popover-max", "#effort-popover");
            await t.click("#effort-popover button:nth-child(1)");
            await t.wait(500);
            await t.shot("chip-low", "#effort-control");
        }
    },
    {
        name: "composer-policy-popover",
        init: { ...withProject },
        run: async (t) => {
            await t.click("#policy-chip");
            await t.shot("popover-open", "#policy-popover");
            await t.click('#policy-popover [data-policy="todo"]');
            await t.wait(500);
            await t.shot("chip-todo", "#policy-chip");
            await t.shot("greet", ".greet");
        }
    },
    {
        name: "composer-end-time-popover",
        init: { ...withProject },
        run: async (t) => {
            await t.click("#end-time-button");
            await t.shot("popover-open", "#end-time-popover");
            await t.click(".time-spin:nth-child(1) .spin-button:nth-child(1)");
            await t.wait(500);
            await t.shot("popover-hour-up", "#end-time-popover");
            await t.click(".time-spin:nth-child(3) .spin-button:nth-child(3)");
            await t.wait(500);
            await t.shot("popover-minute-down", "#end-time-popover");
            await t.shot("chip-changed", "#end-time-button");
            await t.click(".time-presets .button:nth-child(2)");
            await t.wait(500);
            await t.shot("popover-preset", "#end-time-popover");
            await t.click(".time-presets .button:nth-child(4)");
            await t.wait(500);
            await t.shot("popover-reset", "#end-time-popover");
        }
    },
    {
        name: "composer-locks",
        init: { ...withProject, state: runningState() },
        run: async (t) => {
            await t.shot("composer-running", ".composer", { tolerant: true });

            for (const [name, selector] of CHIPS) {
                await t.shot(`running-${name}`, selector);
            }

            await t.state({ status: "stopping" });
            await t.shot("composer-stopping", ".composer", { tolerant: true });
            await t.note(
                "animations",
                await t.eval(
                    `JSON.stringify(document.getAnimations().map((a) => [a.animationName || a.transitionProperty || a.constructor.name, a.playState, a.effect && a.effect.target && (a.effect.target.id || a.effect.target.className || a.effect.target.tagName)]))`
                )
            );
            await t.note(
                "rects",
                await t.eval(
                    `JSON.stringify([...document.querySelectorAll("#tasks-toggle, #tasks-toggle > *")].map((node) => { const r = node.getBoundingClientRect(); return [node.id || node.tagName, +r.x.toFixed(2), +r.y.toFixed(2), +r.width.toFixed(2), +r.height.toFixed(2)]; }))`
                )
            );
            await t.note(
                "styles",
                await t.eval(
                    `JSON.stringify([...document.querySelectorAll("#tasks-toggle, #tasks-toggle > *")].map((node) => { const c = getComputedStyle(node); return [node.id || node.tagName, c.transform, c.translate, c.scale, c.opacity, c.letterSpacing]; }))`
                )
            );

            for (const [name, selector] of CHIPS) {
                await t.shot(`stopping-${name}`, selector);
            }
        }
    },
    {
        name: "composer-main-action",
        init: { ...withProject, state: runningState() },
        run: async (t) => {
            await t.shot("running", "#main-action");
            await t.clearCalls();
            await t.click("#main-action");
            await t.shot("armed", "#main-action");
            await t.note("armed-calls", JSON.stringify(await t.calls()));
            await t.click("#main-action");
            await t.shot("after-stop", "#main-action");
            await t.note("stop-calls", JSON.stringify((await t.calls()).map((call) => call[0])));
            await t.state({ status: "stopping" });
            await t.shot("stopping", "#main-action");
            await t.clearCalls();
            await t.click("#main-action");
            await t.confirm();
            await t.note("kill-calls", JSON.stringify((await t.calls()).map((call) => call[0])));
        }
    },
    {
        name: "composer-running-options",
        init: { ...withProject, state: runningState() },
        run: async (t) => {
            await t.clearCalls();
            await t.click("#model-chip");
            await t.click("#model-popover label:nth-child(3)");
            await t.wait(500);
            await t.click("#effort-control");
            await t.click("#effort-popover button:nth-child(1)");
            await t.wait(500);
            await noteCalls(t, "options-calls");
            await t.shot("apply-note", ".now-meta");
            await t.state({ requested: { model: "claude-sonnet-4-6", effort: "low" }, model: "claude-sonnet-4-6", effort: "low" });
            await t.shot("chips-synced", ".composer-bar");
        }
    },
    {
        name: "composer-tasks",
        init: { settings: { projectDir: PROJECT, tasks: "로그인 버그 고치기\n테스트 추가\n" } },
        run: async (t) => {
            await t.shot("fold", ".composer");
            await t.state(runningState());
            await t.shot("running-summary", ".composer");
            await t.click("#tasks-toggle");
            await t.wait(600);
            await t.shot("running-open", ".composer");
            await t.click("#tasks-toggle");
            await t.wait(600);
            await t.shot("running-closed", ".composer");
        }
    },
    {
        name: "composer-typing",
        init: { ...withProject },
        run: async (t) => {
            await t.click("#tasks");
            await t.type("abc");
            await t.shot("typed", ".composer", { skipDom: true });
            await t.note("value", await t.eval('document.getElementById("tasks").value'));
        }
    },
    {
        name: "composer-start",
        init: { settings: { projectDir: PROJECT, tasks: "한 가지 일", policy: "todo", endTime: "22:00", effort: "xhigh", model: "sonnet" } },
        run: async (t) => {
            await t.shot("composer", ".composer");
            await t.clearCalls();
            await t.click("#main-action");
            await t.wait(200);
            await t.note("start-calls", JSON.stringify(await t.calls()));
        }
    },
    {
        name: "composer-start-login-required",
        init: { ...withProject, responses: { start: { status: "FAILED", error: { code: "LOGIN_REQUIRED", msg: "Claude 로그인이 필요해요." } } } },
        run: async (t) => {
            await t.click("#main-action");
            await t.wait(200);
            await t.shot("banner", ".notices");
            await t.shot("page-bottom", ".content > .notices");
        }
    },
    {
        name: "composer-start-failure",
        init: { ...withProject, responses: { start: { status: "FAILED", error: { code: "INVALID_OPTIONS", msg: "모델, Effort, 정책, 종료 시각 값이 올바르지 않아요." } } } },
        run: async (t) => {
            await t.click("#main-action");
            await t.wait(200);
            await t.shot("notice", ".notices");
        }
    },
    {
        name: "composer-effort-wave",
        init: { ...withProject, state: runningState() },
        run: async (t) => {
            await t.note(
                "wave",
                await t.eval(`(() => {
                    const path = document.querySelector("#effort-control .wave path");
                    const style = getComputedStyle(path);
                    return JSON.stringify({ d: style.d, transform: style.transform, anims: path.getAnimations().map((a) => a.animationName + ":" + a.playState) });
                })()`)
            );
        }
    },
    {
        name: "composer-narrow",
        size: [480, 640],
        init: { ...withProject },
        run: async (t) => {
            await t.shot("composer", ".composer");
            await t.state(runningState());
            await t.shot("composer-running", ".composer");
        }
    }
];

module.exports = { SCENES };

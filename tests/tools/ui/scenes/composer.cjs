const { MODELS, PROJECT, runningState, withProject } = require("./data.cjs");

const CHIPS = [
    ["claude", "#ai-pill-claude"],
    ["codex", "#ai-pill-codex"],
    ["policy", "#policy-chip"],
    ["end-time", "#end-time-button"],
    ["main", "#main-action"]
];

// 모델 목록에는 계열 줄과 버전 줄이 섞여 있어 순서 대신 값으로 고른다.
const SONNET_OPTION = '#ai-popover-claude label:has(input[value="sonnet"])';
const CODEX_PROVIDERS = {
    codex: {
        available: true,
        reason: "",
        models: [
            { id: "gpt-6.1-sol", label: "GPT-6.1-Sol" },
            { id: "gpt-6.1-sol-mini", label: "GPT-6.1-Sol-Mini" },
            { id: "gpt-6-luna", label: "GPT-6-Luna" }
        ]
    }
};

const noteCalls = async (t, key = "calls") => {
    await t.note(key, JSON.stringify(await t.calls()));
};

// 슬라이드를 코드로 움직인다(React의 onChange가 받는 input 이벤트를 보낸다).
const setSlider = (t, provider, level) => {
    return t.eval(`(() => {
        const input = document.querySelector("#ai-popover-${provider} .slider input");
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "${level}");
        input.dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
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

            await t.hover("#ai-pill-claude");
            await t.shot("chip-claude-hover", "#ai-pill-claude");
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
        // Claude 알약: 모델 목록(계열 아래에 버전)과 노력 슬라이드가 한 팝오버에 있다.
        name: "composer-model-popover",
        init: { ...withProject, models: MODELS },
        run: async (t) => {
            await t.click("#ai-pill-claude");
            await t.wait(300);
            await t.shot("popover-open", "#ai-popover-claude");
            await t.shot("chip-open", "#ai-pill-claude");
            await t.click(SONNET_OPTION);
            await t.wait(500);
            await t.shot("chip-sonnet", "#ai-pill-claude");
            await t.click("#ai-pill-claude");
            await t.wait(300);
            await t.shot("popover-sonnet", "#ai-popover-claude");
        }
    },
    {
        // 계열 아래의 버전을 고르면 그 계열이 그 버전으로 고정되고, 알약이 버전 이름으로 바뀐다. 최신 버전 줄을 고르면 고정이 풀린다.
        name: "composer-model-version",
        init: { ...withProject, models: MODELS },
        run: async (t) => {
            await t.click("#ai-pill-claude");
            await t.wait(300);
            await t.click('#ai-popover-claude label:has(input[value="opus@claude-opus-4-7"])');
            await t.wait(600);
            await t.shot("chip-pinned", "#ai-pill-claude");
            await noteCalls(t);
            await t.click("#ai-pill-claude");
            await t.wait(300);
            await t.shot("popover-pinned", "#ai-popover-claude");
            await t.click('#ai-popover-claude label:has(input[value="opus"])');
            await t.wait(600);
            await t.shot("chip-latest", "#ai-pill-claude");
        }
    },
    {
        // Codex 알약: 모델은 Codex가 알려 준 목록에서 고르고, 추론은 슬라이드로 정한다.
        name: "composer-model-codex",
        init: { ...withProject, models: MODELS, model: { providers: CODEX_PROVIDERS } },
        run: async (t) => {
            await t.shot("chips-initial", ".composer-bar");
            await t.click("#ai-pill-codex");
            await t.wait(300);
            await t.shot("popover-codex", "#ai-popover-codex");
            await t.click('#ai-popover-codex label:has(input[value="gpt-6.1-sol-mini"])');
            await t.wait(500);
            await t.click("#ai-pill-codex");
            await t.wait(300);
            await setSlider(t, "codex", 3);
            await t.wait(500);
            await t.shot("popover-codex-high", "#ai-popover-codex");
            await t.shot("chips-codex", ".composer-bar");
            await t.note("codexPill", await t.eval('document.querySelector("#ai-pill-codex").textContent.trim()'));
        }
    },
    {
        name: "composer-model-codex-unavailable",
        init: { ...withProject, model: { providers: { codex: { available: false, reason: "Codex 로그인이 필요해요" } } } },
        run: async (t) => {
            await t.click("#ai-pill-codex");
            await t.wait(300);
            await t.shot("popover-unavailable", "#ai-popover-codex");
        }
    },
    {
        // 노력 슬라이드: 단계마다 이름과 설명이 바뀌고 알약도 따라 바뀐다. 끝(Max)에서는 선과 글자가 붉게 바뀐다.
        name: "composer-effort-popover",
        init: { ...withProject },
        run: async (t) => {
            await t.click("#ai-pill-claude");
            await t.wait(300);
            await t.shot("popover-open", "#ai-popover-claude");
            await setSlider(t, "claude", 4);
            await t.wait(500);
            await t.shot("popover-max", "#ai-popover-claude");
            await t.shot("chip-max", "#ai-pill-claude");
            await setSlider(t, "claude", 0);
            await t.wait(500);
            await t.shot("chip-low", "#ai-pill-claude");
        }
    },
    {
        // 유지 보수: 작업할 AI는 팝오버의 스위치로 바꾸고, 알약 끝에 메인 표시가 붙는다. 하나를 켜면 다른 쪽이 꺼진다.
        name: "composer-runner-switch",
        init: { ...withProject, model: { providers: CODEX_PROVIDERS } },
        run: async (t) => {
            await t.note("tagsBefore", await t.eval('JSON.stringify([...document.querySelectorAll(".ai-tag")].map((el) => el.closest(".ai-pill").dataset.provider + ":" + el.textContent))'));
            await t.click("#ai-pill-codex");
            await t.wait(300);
            await t.shot("popover-foot", "#ai-popover-codex");
            await t.click('#ai-popover-codex .ai-foot input[role="switch"]');
            await t.wait(400);
            await t.note("tagsAfter", await t.eval('JSON.stringify([...document.querySelectorAll(".ai-tag")].map((el) => el.closest(".ai-pill").dataset.provider + ":" + el.textContent))'));
            await t.shot("chips-after", ".composer-bar");
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
            await t.click(".time-box .spin-button:nth-child(1)");
            await t.wait(500);
            await t.shot("popover-minute-up", "#end-time-popover");
            await t.shot("chip-changed", "#end-time-button");
            await t.click('[data-shortcut="3h"]');
            await t.wait(500);
            await t.shot("popover-preset", "#end-time-popover");
            await t.click('.time-days [data-offset="3"]');
            await t.wait(500);
            await t.shot("popover-day", "#end-time-popover");
            await t.shot("chip-dated", "#end-time-button");
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
            await t.click("#ai-pill-claude");
            await t.click(SONNET_OPTION);
            await t.wait(500);
            await t.click("#ai-pill-claude");
            await t.wait(300);
            await setSlider(t, "claude", 0);
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
        init: { ...withProject, responses: { start: { status: "FAILED", error: { code: "INVALID_OPTIONS", msg: "모델, 노력, 정책, 종료 시각 값이 올바르지 않아요." } } } },
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
                    const path = document.querySelector("#ai-pill-claude .wave path");
                    const style = getComputedStyle(path);
                    return JSON.stringify({ d: style.d, transform: style.transform, anims: path.getAnimations().map((a) => a.animationName + ":" + a.playState) });
                })()`)
            );
        }
    },
    {
        name: "composer-narrow",
        size: [760, 620],
        init: { ...withProject },
        run: async (t) => {
            await t.shot("composer", ".composer");
            await t.state(runningState());
            await t.shot("composer-running", ".composer");
        }
    }
];

module.exports = { SCENES };

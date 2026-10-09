const NAMES = [
    "Clean Radar", "Terminal Rain", "Aurora Glass", "Cockpit HUD", "Velocity",
    "Neon Grid", "Paper Calm", "Heartbeat", "Orbit", "Equalizer",
    "Sunrise", "Blueprint", "Mono Spotlight", "Aqua Bubbles", "Amber CRT",
    "Radar Scope", "Code Stream", "Orb Core", "Flight Path", "Hyperspace"
];

const MODELS = {
    fable: { name: "Fable", tag: "최고 성능 · 깊은 추론" },
    opus: { name: "Opus", tag: "기본값 · 안정적인 고성능" },
    sonnet: { name: "Sonnet", tag: "균형 · 빠른 처리" },
    haiku: { name: "Haiku", tag: "경량 · 가장 빠름" }
};

const EFFORTS = [
    { id: "low", desc: "빠르게 처리해요. 추론은 최소예요." },
    { id: "medium", desc: "속도와 깊이의 균형이에요." },
    { id: "high", desc: "기본값이에요. 충분히 생각하고 작업해요." },
    { id: "xhigh", desc: "더 깊이 생각해요. 회차가 길어질 수 있어요." },
    { id: "max", desc: "최대 추론이에요. 가장 오래 걸리고 가장 많이 써요." }
];

const LOGOS = {
    fable: `<path class="spark" d="M24 2c1.8 13.5 7.5 20.2 22 22-14.5 1.8-20.2 8.5-22 22-1.8-13.5-7.5-20.2-22-22C16.5 22.2 22.2 15.5 24 2Z" fill="url(#gFable)"/><circle class="tw t1" cx="39" cy="9" r="2.5" fill="#ffe08a"/><circle class="tw t2" cx="9" cy="39" r="1.8" fill="#ffe08a"/><circle class="tw t3" cx="41" cy="39" r="1.2" fill="#fff"/>`,
    opus: `<g class="gem"><path d="M24 3 42 13.5v21L24 45 6 34.5v-21Z" fill="url(#gOpus)"/><path class="shine" d="M24 3 42 13.5 24 24 6 13.5Z" fill="#fff"/><path d="M24 3v42M6 13.5 24 24l18-10.5M6 34.5 24 24l18 10.5" fill="none" stroke="#fff" stroke-opacity=".4" stroke-width="1.4" stroke-linejoin="round"/></g>`,
    sonnet: `<rect x="3" y="3" width="42" height="42" rx="13" fill="url(#gSonnet)"/><g fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"><path class="w w1" d="M11 17c4-5 8-5 13 0s9 5 13 0"/><path class="w w2" d="M11 25c4-5 8-5 13 0s9 5 13 0" opacity=".8"/><path class="w w1" d="M11 33c4-5 8-5 13 0s9 5 13 0" opacity=".6"/></g>`,
    haiku: `<g class="leaf"><path d="M24 3C40 7 46 24 24 45 2 24 8 7 24 3Z" fill="url(#gHaiku)"/><path d="M19 19h10M17 26h14M19 33h10" stroke="#fff" stroke-width="3.2" stroke-linecap="round" fill="none"/></g>`
};

const ROUND_STEPS = [
    ["round", "[{n}회차] 시작 - 남은 시간 {m}분 (model {model}, effort {effort})"],
    ["info", "작업 선택: 설정 해석 오류 메시지 개선"],
    ["info", "autopilot/src/utils/settingsUtil.js 읽는 중"],
    ["info", "autopilot/src/utils/cliUtil.js 수정"],
    ["info", "npm run test:cli 실행"],
    ["ok", "검증 통과 (48/48)"],
    ["warn", "format:check:cli 경고 1건 - 자동 수정"],
    ["info", "git commit [ap] 설정 해석 오류 메시지 개선"],
    ["ok", "[{n}회차] 완료 - 변경 2파일"]
];
const WRAP_UP = ["남은 작업 정리 중", "진행 기록 갱신", "변경 사항 확인"];
const CODE = [
    "export const runAutopilot = async (options) => {",
    "    const settings = await settingsUtil.resolve(options);",
    "    const lock = await autopilotUtil.acquireLock(settings.kitDir);",
    "    try {",
    "        for (let round = 1; round <= settings.maxRounds; round++) {",
    "            const result = await runRound(settings, round);",
    "            if (result.stop) { break; }",
    "        }",
    "    } finally {",
    "        await lock.release();",
    "    }",
    "};",
    ""
];
const SATS = [{ k: .9, tilt: -8, speed: 1, phase: 0 }, { k: 1.15, tilt: 6, speed: -.7, phase: 2 }, { k: 1.4, tilt: -3, speed: .5, phase: 4 }];
const ORBIT_RATIO = .34;
const ORBIT_SPEED = { idle: .12, running: 1, stopping: .4 };
const START_REMAINING = 6 * 3600 + 30 * 60;

const body = document.body;
const $ = (id) => document.getElementById(id);
const run = { phase: "idle", ended: "대기 중", round: 0, step: 0, remaining: START_REMAINING, timer: 0 };
const opts = { requested: { model: "opus", effort: 2 }, applied: { model: "opus", effort: 2 }, when: "07:00 종료 · 자율개선" };

const pad = (value) => String(value).padStart(2, "0");
const formatClock = (seconds) => `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`;
const logo = (model) => `<svg class="lg lg-${model}" viewBox="0 0 48 48" aria-hidden="true">${LOGOS[model]}</svg>`;

const STATUS = {
    idle: () => run.ended,
    running: () => `${run.round}회차 진행 중`,
    stopping: () => `${run.round}회차 마무리 중 · 종료 요청됨`
};
const MAIN_LABEL = { idle: "시작", running: "종료 신호", stopping: "종료" };

const renderChip = () => {
    const { model, effort } = opts.requested;
    const changed = model !== opts.applied.model || effort !== opts.applied.effort;
    const bars = [0, 1, 2, 3, 4].map((n) => `<i style="--n:${n}" class="${n <= effort ? "on" : ""}"></i>`).join("");

    $("chip").dataset.lv = effort;
    $("chip").innerHTML = `${logo(model)}<b>${MODELS[model].name}</b><span class="bars">${bars}</span><em>${EFFORTS[effort].id}</em>`;
    $("chip").setAttribute("aria-label", `모델 ${MODELS[model].name}, effort ${EFFORTS[effort].id}. 눌러서 변경`);
    $("when").textContent = opts.when;
    $("pend").hidden = run.phase === "idle" || !changed;
    body.style.setProperty("--eff", opts.applied.effort / 4);
};

const render = () => {
    body.dataset.state = run.phase;
    $("main").textContent = MAIN_LABEL[run.phase];
    $("state").textContent = STATUS[run.phase]();
    $("clock").textContent = formatClock(run.remaining);
    renderChip();
};

const blip = () => {
    if (body.dataset.v !== "16") {
        return;
    }

    const item = document.createElement("i");
    const angle = Math.random() * Math.PI * 2;
    const radius = 8 + Math.random() * 26;

    item.className = "blip";
    item.style.cssText = `--bx:${(Math.cos(angle) * radius * 1.25).toFixed(1)}vmin;--by:${(Math.sin(angle) * radius * .7).toFixed(1)}vmin`;
    document.querySelector(".fx-orb").append(item);
    item.addEventListener("animationend", () => item.remove());
};

const addLine = (tone, text) => {
    const list = $("lines");
    const item = document.createElement("li");
    const time = document.createElement("time");
    const message = document.createElement("span");

    item.className = tone;
    time.textContent = new Date().toTimeString().slice(0, 8);
    message.textContent = text;
    item.append(time, message);
    list.append(item);

    while (list.children.length > 40) {
        list.firstChild.remove();
    }

    blip();
};

const pushNext = () => {
    if (run.phase === "idle") {
        return;
    }

    if (run.phase === "stopping") {
        addLine("info", WRAP_UP[run.step++ % WRAP_UP.length]);
    } else {
        const [tone, template] = ROUND_STEPS[run.step % ROUND_STEPS.length];

        if (run.step % ROUND_STEPS.length === 0) {
            run.round++;
            opts.applied = { ...opts.requested };
        }

        run.step++;
        addLine(tone, template
            .replace("{n}", run.round)
            .replace("{m}", Math.floor(run.remaining / 60))
            .replace("{model}", opts.applied.model)
            .replace("{effort}", EFFORTS[opts.applied.effort].id));
    }

    render();
    run.timer = setTimeout(pushNext, run.phase === "stopping" ? 2400 : 450 + Math.random() * 900);
};

const start = () => {
    run.phase = "running";
    run.round = 0;
    run.step = 0;
    run.remaining = START_REMAINING;
    addLine("info", "AutoPilot 시작 - 종료 시각 07:00, 정책 자율개선");
    pushNext();
};

const sendStop = () => {
    run.phase = "stopping";
    addLine("warn", "종료 신호 전송 - 현재 회차를 마치고 종료합니다");
    render();
};

const kill = () => {
    clearTimeout(run.timer);
    run.phase = "idle";
    run.ended = "중단됨";
    addLine("err", "강제 종료 - 세션 프로세스를 종료했어요. commit 전 변경은 남아 있어요");
    body.classList.add("killing");
    render();
    setTimeout(() => body.classList.remove("killing"), 900);
};

const openKillModal = () => {
    $("modal").returnValue = "";
    $("modal").showModal();
};

const syncEffort = (level) => {
    $("optsDialog").dataset.lv = level;
    $("effort").value = level;
    $("effName").textContent = EFFORTS[level].id.toUpperCase();
    $("effDesc").textContent = EFFORTS[level].desc;
    [...$("ticks").children].forEach((item, index) => item.classList.toggle("on", index === level));
};

const openOpts = (preset = {}) => {
    $("optsForm").elements.model.value = preset.model ?? opts.requested.model;
    syncEffort(preset.effort ?? opts.requested.effort);
    $("optsNote").hidden = run.phase === "idle";
    $("optsDialog").returnValue = "";
    $("optsDialog").showModal();
};

const setVariant = (number) => {
    body.dataset.v = number;
    $("vname").textContent = `${number} · ${NAMES[number - 1]}`;
    $("nums").querySelectorAll("button").forEach((button) => {
        button.setAttribute("aria-current", String(Number(button.dataset.n) === number));
    });
    location.hash = number;
};

const stepVariant = (delta) => setVariant(((Number(body.dataset.v) - 1 + delta + NAMES.length) % NAMES.length) + 1);

const makeRandomItems = (parent, count, withCenter) => {
    parent.append(...Array.from({ length: count }, (_, index) => {
        const item = document.createElement("i");
        const center = withCenter ? `--c:${(1 - Math.abs(index - (count - 1) / 2) / (count * .65)).toFixed(2)};` : "";

        item.style.cssText = `--i:${index};${center}--r1:${Math.random().toFixed(2)};--r2:${Math.random().toFixed(2)};--r3:${Math.random().toFixed(2)}`;
        return item;
    }));
};

const orbitFrame = (() => {
    const sats = [...document.querySelectorAll(".sat")];
    const logoWrap = document.querySelector(".logo-wrap");
    let angle = 0;
    let last = performance.now();

    document.querySelectorAll(".ring").forEach((ring, index) => {
        ring.style.setProperty("--sk", SATS[index].k);
        ring.style.setProperty("--stilt", `${SATS[index].tilt}deg`);
    });
    body.style.setProperty("--ratio", ORBIT_RATIO);

    return (now) => {
        angle += ((now - last) / 1000) * ORBIT_SPEED[run.phase];
        last = now;

        if (body.dataset.v === "9") {
            const width = logoWrap.offsetWidth;

            sats.forEach((sat, index) => {
                const { k, tilt, speed, phase } = SATS[index];
                const theta = angle * speed + phase;
                const major = (width * k) / 2;
                const x = major * Math.cos(theta);
                const y = major * ORBIT_RATIO * Math.sin(theta);
                const rad = (tilt * Math.PI) / 180;
                const depth = (Math.sin(theta) + 1) / 2;

                sat.style.translate = `${x * Math.cos(rad) - y * Math.sin(rad)}px ${x * Math.sin(rad) + y * Math.cos(rad)}px`;
                sat.style.scale = String(.6 + depth * .7);
                sat.style.opacity = String(.45 + depth * .55);
            });
        }
    };
})();

const initMarkup = () => {
    $("models").insertAdjacentHTML("beforeend", Object.entries(MODELS).map(([key, model]) => (
        `<label class="model" data-m="${key}"><input type="radio" name="model" value="${key}"><span class="mlogo">${logo(key)}</span><b>${model.name}</b><small>${model.tag}</small></label>`
    )).join(""));
    $("ticks").innerHTML = EFFORTS.map((effort, index) => `<li data-i="${index}">${effort.id}</li>`).join("");
    $("nums").innerHTML = NAMES.map((name, index) => `<button type="button" data-n="${index + 1}" title="${name}">${index + 1}</button>`).join("");
    $("code").textContent = Array.from({ length: 130 }, (_, index) => CODE[index % CODE.length]).join("\n");
    makeRandomItems($("fx"), 40, true);
    makeRandomItems($("eq"), 40, true);
    makeRandomItems($("sparks"), 24, false);
};

const bindEvents = () => {
    $("main").addEventListener("click", () => {
        if (run.phase === "idle") {
            start();
        } else if (run.phase === "running") {
            sendStop();
        } else {
            openKillModal();
        }
    });
    $("modal").addEventListener("close", () => {
        if ($("modal").returnValue === "kill") {
            kill();
        }
    });
    $("chip").addEventListener("click", () => openOpts());
    $("effort").addEventListener("input", (event) => syncEffort(Number(event.target.value)));
    $("ticks").addEventListener("click", (event) => {
        const item = event.target.closest("li");

        if (item) {
            syncEffort(Number(item.dataset.i));
        }
    });
    $("optsDialog").addEventListener("close", () => {
        if ($("optsDialog").returnValue !== "save") {
            return;
        }

        const data = new FormData($("optsForm"));

        opts.requested = { model: data.get("model"), effort: Number(data.get("effort")) };
        opts.when = `${data.get("time")} 종료 · ${data.get("policy")}`;

        if (run.phase === "idle") {
            opts.applied = { ...opts.requested };
        }

        renderChip();
    });
    $("nums").addEventListener("click", (event) => {
        if (event.target.dataset.n) {
            setVariant(Number(event.target.dataset.n));
        }
    });
    document.addEventListener("keydown", (event) => {
        if (event.target.matches("input, dialog") || document.querySelector("dialog[open]")) {
            return;
        }

        if (event.key === "ArrowRight") {
            stepVariant(1);
        } else if (event.key === "ArrowLeft") {
            stepVariant(-1);
        }
    });
};

const applyHash = () => {
    const [variant, scene = ""] = location.hash.slice(1).split(",");
    const options = scene.match(/^opts(\d)?(?:-(\w+))?$/);

    setVariant(Math.min(Math.max(Number(variant) || 1, 1), NAMES.length));

    if (scene === "run" || scene === "stop" || scene === "modal") {
        start();
    }

    if (scene === "stop" || scene === "modal") {
        sendStop();
    }

    if (scene === "modal") {
        openKillModal();
    }

    if (options) {
        openOpts({ effort: options[1] === undefined ? undefined : Number(options[1]), model: options[2] });
    }
};

initMarkup();
bindEvents();
render();
syncEffort(opts.requested.effort);
applyHash();
setInterval(() => {
    if (run.phase !== "idle") {
        run.remaining--;
        $("clock").textContent = formatClock(run.remaining);
    }
}, 1000);
requestAnimationFrame(function loop(now) {
    orbitFrame(now);
    requestAnimationFrame(loop);
});

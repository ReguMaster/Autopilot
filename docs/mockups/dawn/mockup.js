const VARIANTS = [
    { name: "수평선", reveal: "type", keep: 4 },
    { name: "인수인계", reveal: "type", keep: 6, fold: true },
    { name: "출발 안내", reveal: "scramble", keep: 5 },
    { name: "07:00 알람", reveal: "line", keep: 2 },
    { name: "스로틀", reveal: "line", keep: 6, ttl: 9000 },
    { name: "분홍 시간", reveal: "word", keep: 5 },
    { name: "상태 줄", reveal: "type", keep: 4 },
    { name: "한 문장", reveal: "word", keep: 3 },
    { name: "여백", reveal: "line", keep: 2, fold: true },
    { name: "레일", reveal: "type", keep: 9 },
    { name: "모델 탭", reveal: "type", keep: 5 },
    { name: "분할 버튼", reveal: "line", keep: 6, ttl: 9000, fold: true },
    { name: "살구", reveal: "type", keep: 4 },
    { name: "해돋이 버튼", reveal: "line", keep: 4 },
    { name: "명령줄", reveal: "type", keep: 7 },
    { name: "자막", reveal: "line", keep: 2 },
    { name: "회차 눈금", reveal: "type", keep: 4 },
    { name: "굵은 잉크", reveal: "line", keep: 6, ttl: 10000 },
    { name: "세 칸", reveal: "type", keep: 7 },
    { name: "접힘", reveal: "word", keep: 4, fold: true }
];

const MODELS = {
    fable: { name: "Fable", josa: "이" },
    opus: { name: "Opus", josa: "가" },
    sonnet: { name: "Sonnet", josa: "이" },
    haiku: { name: "Haiku", josa: "가" }
};
const MODEL_KEYS = Object.keys(MODELS);
const EFFORTS = ["low", "medium", "high", "xhigh", "max"];
const EFFORT_JOSA = ["로", "으로", "로", "로", "로"];

// 단색 마크. Fable은 4점 반짝이 대신 초승달로 그린다(반짝이는 AI 배지로 읽힌다)
const MARKS = {
    fable: `<circle cx="23" cy="25" r="17" fill="#46609f" mask="url(#moonCut)"/><circle cx="37" cy="33" r="2.6" fill="#e9a23b"/>`,
    opus: `<path d="M24 4 41 14v20L24 44 7 34V14Z" fill="#df8f2e"/><path d="M24 4v40M7 14l17 10 17-10M7 34l17-10 17 10" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="1.5" stroke-linejoin="round"/>`,
    sonnet: `<rect x="4" y="4" width="40" height="40" rx="11" fill="#2c7f8f"/><path d="M12 18c4-4.5 7.5-4.5 12 0s8 4.5 12 0M12 25c4-4.5 7.5-4.5 12 0s8 4.5 12 0M12 32c4-4.5 7.5-4.5 12 0s8 4.5 12 0" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/>`,
    haiku: `<path d="M24 3C40 7 46 24 24 45 2 24 8 7 24 3Z" fill="#5f9e45"/><path d="M19 19h10M17 26h14M19 33h10" stroke="#fff" stroke-width="3" stroke-linecap="round"/>`
};

const ROUND_STEPS = [
    ["round", "[{n}회차] 시작 - 남은 시간 {m}분 (model {model}, effort {effort})"],
    ["info", "작업 선택: 설정 해석 오류 메시지 개선"],
    ["info", "autopilot/src/utils/settingsUtil.js 읽는 중"],
    ["info", "autopilot/src/utils/cliUtil.js 수정"],
    ["info", "npm run test:cli 실행"],
    ["ok", "검증 통과 (48/48)"],
    ["warn", "format:check:cli 경고 1건, 자동 수정"],
    ["info", "git commit [ap] 설정 해석 오류 메시지 개선"],
    ["ok", "[{n}회차] 완료 - 변경 2파일"]
];
const WRAP_UP = ["남은 작업 정리 중", "진행 기록 갱신", "변경 사항 확인"];
const SCRAMBLE_POOL = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789";
const START_REMAINING = 6 * 3600 + 30 * 60;
const TOTAL_RUN = START_REMAINING + 90 * 60;
const MAIN_LABEL = { idle: "시작", running: "종료 신호", stopping: "종료" };
const REDUCED_MOTION = matchMedia("(prefers-reduced-motion: reduce)").matches;

const body = document.body;
const $ = (id) => document.getElementById(id);
const run = { phase: "idle", ended: "대기 중", round: 0, step: 0, remaining: START_REMAINING, timer: 0 };
const opts = { model: "opus", effort: 2, time: "07:00", policy: "자율개선" };
let applied = { ...opts };
let variant = VARIANTS[0];

const STATUS = {
    idle: () => run.ended,
    running: () => (run.round ? `${run.round}회차 진행 중` : "첫 회차 준비 중"),
    stopping: () => (run.round ? `${run.round}회차 마무리 중, 종료 요청됨` : "종료 요청됨")
};

const pad = (value) => String(value).padStart(2, "0");
const formatClock = (seconds) => `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`;
const markSvg = (model) => `<svg class="mk" viewBox="0 0 48 48" aria-hidden="true">${MARKS[model]}</svg>`;
const effortMarkup = () => `<span class="effort"><span class="bars">${[0, 1, 2, 3, 4].map((n) => `<i style="--n:${n}"></i>`).join("")}<input type="range" min="0" max="4" step="1" data-bind="effort" aria-label="생각 깊이"></span><b class="lvname"></b></span>`;

const syncControls = () => {
    const level = EFFORTS[opts.effort];

    document.querySelectorAll('input[name="model"]').forEach((radio) => {
        radio.checked = radio.value === opts.model;
    });
    document.querySelectorAll('input[name="policy"]').forEach((radio) => {
        radio.checked = radio.value === opts.policy;
    });
    document.querySelectorAll("[data-bind]").forEach((control) => {
        control.value = String(opts[control.dataset.bind]);

        if (control.type === "range") {
            control.setAttribute("aria-valuetext", level);
        }
    });
    document.querySelectorAll(".effort").forEach((effort) => {
        effort.dataset.lv = opts.effort;
        effort.querySelectorAll(".bars i").forEach((bar, index) => bar.classList.toggle("on", index <= opts.effort));
    });
    document.querySelectorAll(".lvname").forEach((name) => {
        name.textContent = level;
    });
    $("dial").querySelectorAll("path").forEach((path, index) => path.classList.toggle("on", index <= opts.effort));
    body.dataset.lv = opts.effort;
    document.querySelector('[data-josa="model"]').textContent = MODELS[opts.model].josa;
    document.querySelector('[data-josa="effort"]').textContent = EFFORT_JOSA[opts.effort];
    $("stepModel").innerHTML = `${markSvg(opts.model)} ${MODELS[opts.model].name}`;
    $("toggleValue").textContent = `${MODELS[opts.model].name}, ${level}, ${opts.time}까지`;
};

const render = () => {
    const changed = Object.keys(opts).some((key) => opts[key] !== applied[key]);
    const progress = run.phase === "idle" ? 0 : 1 - run.remaining / TOTAL_RUN;

    body.dataset.state = run.phase;
    $("main").textContent = MAIN_LABEL[run.phase];
    $("state").textContent = STATUS[run.phase]();
    $("clock").textContent = formatClock(run.remaining);
    $("bigclock").textContent = formatClock(run.remaining);
    $("pend").hidden = run.phase === "idle" || !changed;
    body.style.setProperty("--progress", progress.toFixed(4));
};

const fadeOut = (item) => {
    item.classList.add("out");
    setTimeout(() => item.remove(), 650);
};

const revealText = (item, span, text) => {
    if (REDUCED_MOTION || variant.reveal === "line") {
        span.textContent = text;
        item.classList.toggle("appear", !REDUCED_MOTION);
        return;
    }

    if (variant.reveal === "word") {
        span.innerHTML = "";
        text.split(/(\s+)/).forEach((part, index) => {
            const word = document.createElement("span");

            word.className = "w";
            word.style.setProperty("--w", index);
            word.textContent = part;
            span.append(word);
        });
        return;
    }

    let frame = 0;
    const frames = variant.reveal === "scramble" ? 10 : Math.min(text.length, 36);

    item.classList.add("typing");
    const timer = setInterval(() => {
        frame++;
        const shown = Math.ceil((text.length * frame) / frames);

        if (variant.reveal === "scramble") {
            span.textContent = text.slice(0, shown) + text.slice(shown).replace(/\S/g, () => SCRAMBLE_POOL[Math.floor(Math.random() * SCRAMBLE_POOL.length)]);
        } else {
            span.textContent = text.slice(0, shown);
        }

        if (frame >= frames) {
            clearInterval(timer);
            span.textContent = text;
            item.classList.remove("typing");
        }
    }, variant.reveal === "scramble" ? 40 : 22);
};

const addLine = (tone, text) => {
    const list = $("lines");
    const item = document.createElement("li");
    const time = document.createElement("time");
    const message = document.createElement("span");
    const live = [...list.children].filter((line) => !line.classList.contains("out"));

    item.className = tone;
    time.textContent = new Date().toTimeString().slice(0, 8);
    item.append(time, message);
    list.append(item);
    revealText(item, message, text);
    live.slice(0, Math.max(0, live.length + 1 - variant.keep)).forEach(fadeOut);

    if (variant.ttl) {
        setTimeout(() => fadeOut(item), variant.ttl);
    }
};

const markRound = () => {
    const rounds = $("rounds");

    rounds.querySelector(".now")?.classList.remove("now");
    rounds.insertAdjacentHTML("beforeend", '<li class="now"></li>');

    while (rounds.children.length > 14) {
        rounds.firstElementChild.remove();
    }
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
            applied = { ...opts };
            markRound();
        }

        run.step++;
        addLine(tone, template
            .replace("{n}", run.round)
            .replace("{m}", Math.floor(run.remaining / 60))
            .replace("{model}", applied.model)
            .replace("{effort}", EFFORTS[applied.effort]));
    }

    render();
    run.timer = setTimeout(pushNext, run.phase === "stopping" ? 2600 : 700 + Math.random() * 1100);
};

const start = () => {
    run.phase = "running";
    run.round = 0;
    run.step = 0;
    run.remaining = START_REMAINING;
    applied = { ...opts };
    $("rounds").innerHTML = "";
    addLine("info", `AutoPilot 시작, ${opts.time}까지 ${opts.policy}`);
    run.timer = setTimeout(pushNext, 500);
    render();
};

const sendStop = () => {
    run.phase = "stopping";
    addLine("warn", "종료 신호를 보냈어요. 현재 회차를 마치고 끝나요");
    render();
};

const kill = () => {
    clearTimeout(run.timer);
    run.phase = "idle";
    run.ended = "중단됨";
    addLine("err", "강제 종료했어요. commit 전 변경은 파일에 남아 있어요");
    body.classList.add("halted");
    render();
    setTimeout(() => body.classList.remove("halted"), 1600);
};

const openKillModal = () => {
    $("modal").returnValue = "";
    $("modal").showModal();
};

const setOpen = (open) => {
    body.classList.toggle("opts-open", open);
    document.querySelectorAll(".opt-toggle, .split").forEach((button) => button.setAttribute("aria-expanded", String(open)));
};

const setVariant = (number) => {
    variant = VARIANTS[number - 1];
    body.dataset.v = number;
    body.toggleAttribute("data-fold", Boolean(variant.fold));
    $("lines").style.setProperty("--keep", variant.keep);
    $("vname").textContent = `${number} ${variant.name}`;
    $("nums").querySelectorAll("button").forEach((button) => {
        button.setAttribute("aria-current", String(Number(button.dataset.n) === number));
    });
    setOpen(false);
    location.hash = number;
};

const stepVariant = (delta) => setVariant(((Number(body.dataset.v) - 1 + delta + VARIANTS.length) % VARIANTS.length) + 1);

const buildDial = () => {
    const center = 100;
    const radius = 84;
    const gap = 7;
    const sweep = 240;
    const segment = (sweep - gap * 4) / 5;
    const point = (degree) => {
        const rad = (degree * Math.PI) / 180;

        return `${(center + radius * Math.cos(rad)).toFixed(1)} ${(center + radius * Math.sin(rad)).toFixed(1)}`;
    };

    $("dial").innerHTML = [0, 1, 2, 3, 4].map((index) => {
        const from = 150 + index * (segment + gap);

        return `<path data-i="${index}" style="--n:${index}" d="M${point(from)} A${radius} ${radius} 0 0 1 ${point(from + segment)}"/>`;
    }).join("");
};

const initMarkup = () => {
    $("models").innerHTML = MODEL_KEYS.map((key) => (
        `<label class="m" data-m="${key}"><input type="radio" name="model" value="${key}">${markSvg(key)}<span>${MODELS[key].name}</span></label>`
    )).join("");
    document.querySelectorAll('select[data-bind="model"]').forEach((select) => {
        const isCli = Boolean(select.closest(".cli"));

        select.innerHTML = MODEL_KEYS.map((key) => `<option value="${key}">${isCli ? key : MODELS[key].name}</option>`).join("");
    });
    document.querySelectorAll("[data-effort-slot]").forEach((slot) => {
        slot.outerHTML = effortMarkup();
    });
    $("nums").innerHTML = VARIANTS.map((item, index) => `<button type="button" data-n="${index + 1}" title="${item.name}">${index + 1}</button>`).join("");
    buildDial();
};

const handleOptionInput = (event) => {
    const target = event.target;
    const key = target.dataset.bind ?? (["model", "policy"].includes(target.name) ? target.name : "");

    if (!key) {
        return;
    }

    // 명령줄의 시각은 직접 타이핑하므로 HH:mm이 완성됐을 때만 반영하고, 벗어나면 마지막 값으로 되돌린다
    if (target.type === "text" && !target.checkValidity()) {
        if (event.type === "change") {
            target.value = opts.time;
        }
        return;
    }

    opts[key] = key === "effort" ? Number(target.value) : target.value;
    syncControls();
    render();
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
    document.addEventListener("input", handleOptionInput);
    document.addEventListener("change", handleOptionInput);
    document.querySelectorAll(".opt-toggle, .split").forEach((button) => {
        button.addEventListener("click", () => setOpen(!body.classList.contains("opts-open")));
    });
    $("dial").addEventListener("click", (event) => {
        const path = event.target.closest("path");

        if (path) {
            opts.effort = Number(path.dataset.i);
            syncControls();
            render();
        }
    });
    document.querySelector(".stepper").addEventListener("click", (event) => {
        const button = event.target.closest("button");

        if (!button) {
            return;
        }

        const delta = button.classList.contains("next") ? 1 : -1;

        opts.model = MODEL_KEYS[(MODEL_KEYS.indexOf(opts.model) + delta + MODEL_KEYS.length) % MODEL_KEYS.length];
        syncControls();
        render();
    });
    $("nums").addEventListener("click", (event) => {
        if (event.target.dataset.n) {
            setVariant(Number(event.target.dataset.n));
        }
    });
    document.addEventListener("keydown", (event) => {
        if (event.target.matches("input, select") || document.querySelector("dialog[open]")) {
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
    const [number, scene = ""] = location.hash.slice(1).split(",");

    setVariant(Math.min(Math.max(Number(number) || 1, 1), VARIANTS.length));

    if (["run", "stop", "modal"].includes(scene)) {
        start();
    }

    if (scene === "stop" || scene === "modal") {
        sendStop();
    }

    if (scene === "modal") {
        openKillModal();
    }

    if (scene === "open") {
        setOpen(true);
    }

    if (scene.startsWith("lv")) {
        opts.effort = Number(scene.slice(2));
        syncControls();
    }
};

initMarkup();
bindEvents();
syncControls();
render();
applyHash();
setInterval(() => {
    if (run.phase !== "idle") {
        run.remaining--;
        render();
    }
}, 1000);

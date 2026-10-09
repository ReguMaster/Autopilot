// 시간대별 하늘 시안. 하루를 분(0~1439)으로 보고 하늘색, 해·달 위치, 별·구름·운석을 계산한다.
const VARIANTS = [
    { name: "하늘 창", density: 0.6, clouds: 4, cloudSpeed: [70, 130], constellations: [["dipper", 0.2, 0.3, 120], ["cassiopeia", 0.82, 0.22, 90]] },
    { name: "비행기 창", density: 0.7, clouds: 5, cloudSpeed: [9, 18], constellations: [["cassiopeia", 0.5, 0.3, 80]] },
    { name: "온 하늘", density: 1, clouds: 6, cloudSpeed: [80, 160], constellations: [["dipper", 0.22, 0.12, 150], ["cassiopeia", 0.8, 0.09, 110], ["orion", 0.86, 0.9, 110]] },
    { name: "선 그림", density: 0.35, clouds: 3, cloudSpeed: [90, 150], starShape: "cross", constellations: [["dipper", 0.18, 0.1, 110], ["cassiopeia", 0.84, 0.08, 80]] },
    { name: "해시계 호", density: 0.5, clouds: 3, cloudSpeed: [90, 150], path: "arc", constellations: [["cassiopeia", 0.5, 0.15, 80]] },
    { name: "종이 하늘", density: 0.6, clouds: 4, cloudSpeed: [80, 140], constellations: [["dipper", 0.2, 0.16, 110], ["cassiopeia", 0.8, 0.12, 80]] },
    { name: "픽셀", density: 0.8, clouds: 4, cloudSpeed: [60, 120], starShape: "square", pixel: true, constellations: [["dipper", 0.22, 0.12, 140], ["orion", 0.82, 0.62, 120]] },
    { name: "점 하늘", density: 1, clouds: 5, cloudSpeed: [70, 130], constellations: [["dipper", 0.2, 0.14, 130], ["cassiopeia", 0.8, 0.1, 100]] },
    { name: "언덕 풍경", density: 0.9, clouds: 3, cloudSpeed: [80, 140], constellations: [["orion", 0.8, 0.28, 70]] },
    { name: "머리 위 하늘", density: 0.7, clouds: 4, cloudSpeed: [80, 140], constellations: [["dipper", 0.18, 0.22, 100], ["cassiopeia", 0.84, 0.18, 70]] },
    { name: "수채", density: 0.8, clouds: 5, cloudSpeed: [90, 170], constellations: [["dipper", 0.2, 0.12, 140], ["orion", 0.84, 0.64, 120]] },
    { name: "별자리 지도", density: 1.5, clouds: 3, cloudSpeed: [100, 180], labels: true, rotate: true, constellations: [["dipper", 0.24, 0.16, 150], ["cassiopeia", 0.78, 0.12, 110], ["orion", 0.8, 0.66, 130], ["swan", 0.2, 0.62, 120]] }
];

// 하늘 위·아래 색. 새벽(05:30~06:30)과 노을(18:00~19:30)에 아래쪽이 따뜻해진다.
const SKY_KEYFRAMES = [
    [0, "#0b1026", "#1b2447"],
    [270, "#0e1530", "#262c52"],
    [330, "#2b3a6b", "#e89a7a"],
    [390, "#7fa6dc", "#ffd2b0"],
    [480, "#79b6f2", "#d6ecff"],
    [720, "#5aa7f0", "#cfe8ff"],
    [990, "#6aa9e8", "#e3f1ff"],
    [1080, "#7188c8", "#ffc09a"],
    [1125, "#3b3f78", "#f08a6b"],
    [1170, "#1c2350", "#43406f"],
    [1260, "#0d1330", "#1d2448"],
    [1440, "#0b1026", "#1b2447"]
];
const SUNRISE = 360;
const SUNSET = 1125;
const SYNODIC_MONTH = 29.530588;
const KNOWN_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);
const TIMELAPSE_STEP = 2;
const TIMELAPSE_MS = 100;

// 별자리 모양(가로·세로 0~1)과 잇는 선. 실제 밤하늘의 배치를 단순화했다.
const CONSTELLATIONS = {
    dipper: { label: "북두칠성", stars: [[0, 0.3], [0.17, 0.34], [0.31, 0.42], [0.45, 0.52], [0.62, 0.5], [0.7, 0.72], [0.5, 0.76]], lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 3]] },
    cassiopeia: { label: "카시오페이아", stars: [[0, 0.2], [0.24, 0.6], [0.48, 0.32], [0.72, 0.66], [0.96, 0.24]], lines: [[0, 1], [1, 2], [2, 3], [3, 4]] },
    orion: { label: "오리온", stars: [[0.12, 0.02], [0.78, 0.1], [0.38, 0.48], [0.49, 0.5], [0.6, 0.52], [0.22, 0.95], [0.84, 0.88]], lines: [[0, 2], [1, 4], [2, 3], [3, 4], [2, 5], [4, 6]] },
    swan: { label: "백조", stars: [[0.5, 0], [0.5, 0.35], [0.5, 0.62], [0.5, 1], [0.08, 0.3], [0.92, 0.42]], lines: [[0, 1], [1, 2], [2, 3], [4, 1], [1, 5]] }
};

const CLOUD_PATH = "M20 50C8 50 2 42 6 34 2 24 12 16 22 20 26 8 42 4 52 14 60 4 80 6 84 20 96 16 110 24 106 36 114 44 106 52 96 50Z";

// 픽셀 시안의 스프라이트. X는 채움, .은 빈칸.
const PIXEL_SPRITES = {
    sun: ["...XXX...", ".XXXXXXX.", ".XXXXXXX.", "XXXXXXXXX", "XXXXXXXXX", "XXXXXXXXX", ".XXXXXXX.", ".XXXXXXX.", "...XXX..."],
    cloud: ["....XXX.......", "..XXXXXXX.XX..", ".XXXXXXXXXXXX.", "XXXXXXXXXXXXXX", ".XXXXXXXXXXXX."]
};

const root = document.documentElement;
const body = document.body;
const sky = document.getElementById("sky");
const state = { variant: 1, minutes: null, timelapse: false, phase: null };
let timelapseTimer = 0;
let meteorTimer = 0;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const smoothstep = (edge0, edge1, value) => {
    const x = clamp((value - edge0) / (edge1 - edge0), 0, 1);

    return x * x * (3 - 2 * x);
};
const bell = (value, center, width) => Math.exp(-(((value - center) / width) ** 2));

const seededRandom = (seed) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);

    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const mixHex = (from, to, ratio) => {
    const parse = (hex) => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
    const [a, b] = [parse(from), parse(to)];

    return `rgb(${a.map((channel, index) => Math.round(channel + (b[index] - channel) * ratio)).join(" ")})`;
};

const getSkyColors = (minutes) => {
    const nextIndex = SKY_KEYFRAMES.findIndex((frame) => frame[0] >= minutes);
    const next = SKY_KEYFRAMES[Math.max(1, nextIndex)];
    const prev = SKY_KEYFRAMES[Math.max(0, nextIndex - 1)];
    const ratio = next[0] === prev[0] ? 0 : (minutes - prev[0]) / (next[0] - prev[0]);

    return { top: mixHex(prev[1], next[1], ratio), bottom: mixHex(prev[2], next[2], ratio) };
};

// 오늘 날짜의 달 나이(0=삭, 0.5=보름). 미리보기에서 덮어쓸 수 있다.
const getMoonPhase = () => {
    if (state.phase !== null) {
        return state.phase;
    }

    const age = ((Date.now() - KNOWN_NEW_MOON) / 86400000) % SYNODIC_MONTH;

    return age / SYNODIC_MONTH;
};

const getNowMinutes = () => {
    const now = new Date();

    return now.getHours() * 60 + now.getMinutes();
};

const readArc = () => {
    const style = getComputedStyle(sky);
    const read = (name) => parseFloat(style.getPropertyValue(name));

    return { left: read("--arc-left"), right: read("--arc-right"), base: read("--arc-base"), top: read("--arc-top"), cx: read("--dial-cx"), cy: read("--dial-cy"), r: read("--dial-r") };
};

// 해·달이 지나가는 길. 기본은 지평선(base)에서 정점(top)까지의 반원, 해시계 호 시안은 원 위를 돈다.
const getBodyPosition = (progress, width, height) => {
    const arc = readArc();

    if (VARIANTS[state.variant - 1].path === "arc") {
        return { left: arc.cx * width - arc.r * width * Math.cos(Math.PI * progress), top: arc.cy * height - arc.r * width * Math.sin(Math.PI * clamp(progress, 0, 1)) };
    }

    const lift = Math.sin(Math.PI * clamp(progress, 0, 1));

    return { left: (arc.left + (arc.right - arc.left) * progress) * width, top: (arc.base - (arc.base - arc.top) * lift) * height };
};

const renderSky = () => {
    const minutes = state.minutes ?? getNowMinutes();
    const day = smoothstep(330, 420, minutes) * (1 - smoothstep(1080, 1170, minutes));
    const twilight = Math.max(bell(minutes, 375, 45), bell(minutes, 1112, 50));
    const colors = getSkyColors(minutes);
    const { width, height } = sky.getBoundingClientRect();
    const sunProgress = (minutes - SUNRISE) / (SUNSET - SUNRISE);
    const moonMinutes = minutes < SUNRISE ? minutes + 1440 : minutes;
    const moonProgress = (moonMinutes - SUNSET) / (SUNRISE + 1440 - SUNSET);
    const sun = getBodyPosition(sunProgress, width, height);
    const moon = getBodyPosition(moonProgress, width, height);
    const phase = getMoonPhase();
    const lit = (1 - Math.cos(2 * Math.PI * phase)) / 2;
    const vars = {
        "--day": day.toFixed(3),
        "--night": (1 - day).toFixed(3),
        "--twilight": twilight.toFixed(3),
        "--sky-top": colors.top,
        "--sky-bottom": colors.bottom,
        "--sun-left": `${sun.left.toFixed(1)}px`,
        "--sun-top": `${sun.top.toFixed(1)}px`,
        "--sun-on": (smoothstep(-0.03, 0.04, sunProgress) * (1 - smoothstep(0.96, 1.03, sunProgress))).toFixed(3),
        "--moon-left": `${moon.left.toFixed(1)}px`,
        "--moon-top": `${moon.top.toFixed(1)}px`,
        "--moon-on": (smoothstep(-0.03, 0.06, moonProgress) * (1 - smoothstep(0.94, 1.03, moonProgress))).toFixed(3),
        "--moon-shadow": `${(phase < 0.5 ? -lit : lit) * 100}%`,
        "--glow-x": clamp(sunProgress, 0, 1).toFixed(3),
        "--chart-turn": `${((minutes / 1440) * 360).toFixed(2)}deg`
    };

    for (const [name, value] of Object.entries(vars)) {
        root.style.setProperty(name, value);
    }

    body.classList.toggle("night", day < 0.45);
};

const svgElement = (name, attributes) => {
    const element = document.createElementNS("http://www.w3.org/2000/svg", name);

    for (const [key, value] of Object.entries(attributes)) {
        element.setAttribute(key, value);
    }

    return element;
};

const buildStars = () => {
    const variant = VARIANTS[state.variant - 1];
    const svg = document.getElementById("stars");
    const { width, height } = sky.getBoundingClientRect();
    const random = seededRandom(7 + state.variant);
    const count = Math.round(((width * height) / 2500) * variant.density);
    const chart = svgElement("g", { class: "chart" });

    svg.replaceChildren(chart);
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

    for (let index = 0; index < count; index++) {
        const x = random() * width;
        const y = random() * height;
        const size = 0.4 + random() ** 3 * 1.4;
        const style = `--d:${(1.6 + random() * 3).toFixed(2)}s;--delay:${(-random() * 4).toFixed(2)}s`;

        if (variant.starShape === "cross") {
            chart.append(svgElement("path", { class: "star", d: `M${x - size * 2} ${y}h${size * 4}M${x} ${y - size * 2}v${size * 4}`, style: style }));
        } else if (variant.starShape === "square") {
            const side = size < 1 ? 2 : 3;

            chart.append(svgElement("rect", { class: "star", x: Math.round(x / 3) * 3, y: Math.round(y / 3) * 3, width: side, height: side, style: style }));
        } else {
            chart.append(svgElement("circle", { class: "star", cx: x, cy: y, r: size, style: style }));
        }
    }

    for (const [name, cx, cy, size] of variant.constellations) {
        const shape = CONSTELLATIONS[name];
        const points = shape.stars.map(([x, y]) => [cx * width + (x - 0.5) * size, cy * height + (y - 0.5) * size * 0.8]);

        for (const [from, to] of shape.lines) {
            chart.append(svgElement("line", { class: "cline", x1: points[from][0], y1: points[from][1], x2: points[to][0], y2: points[to][1] }));
        }

        for (const [x, y] of points) {
            chart.append(svgElement("circle", { class: "cstar", cx: x, cy: y, r: 1.9 }));
        }

        if (variant.labels) {
            const label = svgElement("text", { class: "clabel", x: points[0][0], y: points[0][1] - 9 });

            label.textContent = shape.label;
            chart.append(label);
        }
    }

    if (variant.rotate) {
        const pole = svgElement("g", { class: "chart-grid" });

        for (let ring = 1; ring <= 4; ring++) {
            pole.append(svgElement("circle", { cx: width * 0.5, cy: height * 0.38, r: ring * width * 0.16 }));
        }

        for (let spoke = 0; spoke < 12; spoke++) {
            const angle = (spoke / 12) * Math.PI * 2;

            pole.append(svgElement("line", { x1: width * 0.5, y1: height * 0.38, x2: width * 0.5 + Math.cos(angle) * width, y2: height * 0.38 + Math.sin(angle) * width }));
        }

        chart.prepend(pole);
        chart.style.transformOrigin = `${width * 0.5}px ${height * 0.38}px`;
    }
};

const pixelSprite = (rows, color) => {
    const rects = rows.flatMap((row, y) => [...row].map((cell, x) => (cell === "X" ? `<rect x="${x}" y="${y}" width="1" height="1"/>` : ""))).join("");

    return `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${rows[0].length} ${rows.length}" shape-rendering="crispEdges" fill="${color}">${rects}</svg>`)}")`;
};

const buildClouds = () => {
    const variant = VARIANTS[state.variant - 1];
    const container = document.getElementById("clouds");
    const random = seededRandom(31 + state.variant);
    const style = getComputedStyle(sky);
    const topMin = parseFloat(style.getPropertyValue("--cloud-top"));
    const topMax = parseFloat(style.getPropertyValue("--cloud-bottom"));

    container.replaceChildren();

    for (let index = 0; index < variant.clouds; index++) {
        const cloud = document.createElement("div");
        const duration = variant.cloudSpeed[0] + random() * (variant.cloudSpeed[1] - variant.cloudSpeed[0]);

        cloud.className = "cloud";
        cloud.style.cssText = `--top:${((topMin + random() * (topMax - topMin)) * 100).toFixed(1)}%;--scale:${(0.55 + random() * 0.8).toFixed(2)};--dur:${duration.toFixed(1)}s;--delay:${(-random() * duration).toFixed(1)}s`;
        cloud.innerHTML = `<svg viewBox="0 0 120 60" aria-hidden="true"><path d="${CLOUD_PATH}"/></svg>`;
        container.append(cloud);
    }
};

const dropMeteor = () => {
    const random = Math.random;
    const meteor = document.createElement("i");
    const { width, height } = sky.getBoundingClientRect();

    meteor.className = "meteor";
    meteor.style.cssText = `--x:${(0.35 + random() * 0.6) * width}px;--y:${(0.02 + random() * 0.3) * height}px;--len:${70 + random() * 90}px;--angle:${142 + random() * 18}deg;--travel:${160 + random() * 160}px;--dur:${0.7 + random() * 0.6}s`;
    document.getElementById("meteors").append(meteor);
    meteor.addEventListener("animationend", () => meteor.remove());
};

// 밤에만 5~15초 간격으로 운석이 떨어진다.
const scheduleMeteor = () => {
    clearTimeout(meteorTimer);
    meteorTimer = setTimeout(() => {
        if (body.classList.contains("night")) {
            dropMeteor();
        }

        scheduleMeteor();
    }, 5000 + Math.random() * 10000);
};

const setTimelapse = (enabled) => {
    state.timelapse = enabled;
    clearInterval(timelapseTimer);

    if (enabled) {
        state.minutes = state.minutes ?? getNowMinutes();
        timelapseTimer = setInterval(() => {
            state.minutes = (state.minutes + TIMELAPSE_STEP) % 1440;
            renderSky();
            parent.postMessage({ type: "time", minutes: state.minutes }, "*");
        }, TIMELAPSE_MS);
    }
};

const applyVariant = (number) => {
    state.variant = number;
    body.dataset.v = number;
    root.style.setProperty("--sprite-sun", pixelSprite(PIXEL_SPRITES.sun, "#ffcf4a"));
    root.style.setProperty("--sprite-cloud", pixelSprite(PIXEL_SPRITES.cloud, "#ffffff"));
    root.style.setProperty("--sprite-cloud-night", pixelSprite(PIXEL_SPRITES.cloud, "#5a6185"));
    buildStars();
    buildClouds();
    renderSky();
};

const applyHash = () => {
    const params = new URLSearchParams(location.hash.slice(1));

    state.minutes = params.has("t") ? Number(params.get("t")) : null;
    state.phase = params.has("ph") ? Number(params.get("ph")) : null;
    applyVariant(Number(params.get("v")) || 1);

    if (params.has("meteor")) {
        setTimeout(dropMeteor, 300);
    }
};

window.addEventListener("message", (event) => {
    const message = event.data || {};

    if (message.type === "variant") {
        applyVariant(message.variant);
    } else if (message.type === "time") {
        state.minutes = message.minutes;
        setTimelapse(false);
        renderSky();
    } else if (message.type === "now") {
        state.minutes = null;
        setTimelapse(false);
        renderSky();
    } else if (message.type === "timelapse") {
        setTimelapse(message.enabled);
    } else if (message.type === "phase") {
        state.phase = message.phase;
        renderSky();
    } else if (message.type === "meteor") {
        dropMeteor();
    }
});
window.addEventListener("resize", () => applyVariant(state.variant));

applyHash();
scheduleMeteor();
setInterval(() => {
    if (state.minutes === null) {
        renderSky();
    }
}, 30000);

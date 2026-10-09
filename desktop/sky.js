// 시간대별 수채 하늘. 하루를 분(0~1439)으로 보고 하늘색, 해·달 위치, 별·별자리·구름·운석을 그린다. 대시보드 상태와 무관하다.
// CSP가 inline style 속성을 막으므로 스타일은 CSSOM(style.setProperty)으로만 넣는다.
// 낮 하늘은 흰 UI 글자가 읽히도록 깊은 파랑으로 둔다(밝은 하늘색이면 흰 글자 대비가 3:1 아래로 떨어진다).
const SKY_KEYFRAMES = [
    [0, "#0b1026", "#1b2447"],
    [270, "#0e1530", "#262c52"],
    [330, "#2b3a6b", "#e89a7a"],
    [390, "#5a7fc4", "#f7c09e"],
    [480, "#3a80d4", "#9ccaf2"],
    [720, "#2f78d0", "#94c4f0"],
    [990, "#387dce", "#a6cdf2"],
    [1080, "#5a6fb4", "#f5b08a"],
    [1125, "#3b3f78", "#f08a6b"],
    [1170, "#1c2350", "#43406f"],
    [1260, "#0d1330", "#1d2448"],
    [1440, "#0b1026", "#1b2447"]
];
const SUNRISE_MINUTES = 360;
const SUNSET_MINUTES = 1125;
const DAY_MINUTES = 1440;
const SKY_ARC = { left: 0.1, right: 0.9, base: 0.42, top: 0.09 };
const SYNODIC_MONTH_DAYS = 29.530588;
const KNOWN_NEW_MOON_MS = Date.UTC(2000, 0, 6, 18, 14);
const DAY_MS = 86400000;
// 달(반지름 46)을 가리는 그림자 원(반지름 47)이 이만큼 비켜나면 보름이다. 테두리에 실선이 남지 않게 지름보다 조금 더 민다.
const MOON_SHADOW_TRAVEL = 94;
const SKY_UPDATE_MS = 30000;
const SKY_RESIZE_DELAY_MS = 200;
const METEOR_MIN_DELAY_MS = 5000;
const METEOR_DELAY_RANGE_MS = 10000;
// 글자가 있는 높이의 하늘이 이보다 어두우면 밤(body.night)으로 보고 운석을 떨어뜨린다. UI 색은 시각과 무관하게 흰색이다.
// 아래쪽 색(노을빛)은 화면 맨 아래 타원에만 칠해지고 글자 높이의 하늘은 거의 위쪽 색이다.
const NIGHT_LUMINANCE = 0.19;
const UI_SKY_POSITION = 0.06;
const STAR_AREA_PX = 2500;
const STAR_DENSITY = 0.8;
const STAR_SEED = 18;
const STAR_LAYER_COUNT = 3;
const CLOUD_SEED = 42;
const CLOUD_COUNT = 5;
const CLOUD_DURATION_RANGE = [90, 170];
const CLOUD_TOP_RANGE = [0.04, 0.5];
const CLOUD_PATH = "M20 50C8 50 2 42 6 34 2 24 12 16 22 20 26 8 42 4 52 14 60 4 80 6 84 20 96 16 110 24 106 36 114 44 106 52 96 50Z";
const SVG_NS = "http://www.w3.org/2000/svg";

// 실제 별자리 모양을 단순화했다. 글자와 겹치지 않게 화면 위쪽 양옆에 둔다.
const CONSTELLATIONS = [
    {
        at: [0.2, 0.1],
        size: 140,
        stars: [
            [0, 0.3],
            [0.17, 0.34],
            [0.31, 0.42],
            [0.45, 0.52],
            [0.62, 0.5],
            [0.7, 0.72],
            [0.5, 0.76]
        ],
        lines: [
            [0, 1],
            [1, 2],
            [2, 3],
            [3, 4],
            [4, 5],
            [5, 6],
            [6, 3]
        ]
    },
    {
        at: [0.82, 0.08],
        size: 100,
        stars: [
            [0, 0.2],
            [0.24, 0.6],
            [0.48, 0.32],
            [0.72, 0.66],
            [0.96, 0.24]
        ],
        lines: [
            [0, 1],
            [1, 2],
            [2, 3],
            [3, 4]
        ]
    }
];

const skyRoot = document.documentElement;
const skyElements = {
    sky: document.getElementById("sky"),
    stars: document.getElementById("sky-stars"),
    clouds: document.getElementById("sky-clouds"),
    meteors: document.getElementById("sky-meteors"),
    moonShadow: document.getElementById("moon-shadow"),
    moonGlow: document.getElementById("moon-glow")
};
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

let skyResizeTimer = 0;

const clampNumber = (value, min, max) => {
    return Math.min(max, Math.max(min, value));
};

const smoothStep = (edge0, edge1, value) => {
    const x = clampNumber((value - edge0) / (edge1 - edge0), 0, 1);

    return x * x * (3 - 2 * x);
};

const bellCurve = (value, center, width) => {
    return Math.exp(-(((value - center) / width) ** 2));
};

// 별·구름 위치가 켤 때마다 바뀌지 않도록 고정된 씨앗의 난수를 쓴다.
const createSeededRandom = (seed) => {
    let state = seed;

    return () => {
        state = (state + 0x6d2b79f5) | 0;

        let value = Math.imul(state ^ (state >>> 15), 1 | state);

        value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;

        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
};

const parseHex = (hex) => {
    return [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
};

const mixChannels = (from, to, ratio) => {
    return from.map((channel, index) => Math.round(channel + (to[index] - channel) * ratio));
};

const getLuminance = (channels) => {
    const [red, green, blue] = channels.map((channel) => {
        const value = channel / 255;

        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });

    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
};

const getSkyColors = (minutes) => {
    const nextIndex = Math.max(
        1,
        SKY_KEYFRAMES.findIndex((frame) => frame[0] >= minutes)
    );
    const [prevMinutes, prevTop, prevBottom] = SKY_KEYFRAMES[nextIndex - 1];
    const [nextMinutes, nextTop, nextBottom] = SKY_KEYFRAMES[nextIndex];
    const ratio = (minutes - prevMinutes) / (nextMinutes - prevMinutes);

    return { top: mixChannels(parseHex(prevTop), parseHex(nextTop), ratio), bottom: mixChannels(parseHex(prevBottom), parseHex(nextBottom), ratio) };
};

// 달 나이(0=삭, 0.5=보름)
const getMoonPhase = () => {
    return (((Date.now() - KNOWN_NEW_MOON_MS) / DAY_MS) % SYNODIC_MONTH_DAYS) / SYNODIC_MONTH_DAYS;
};

const getNowMinutes = () => {
    const now = new Date();

    return now.getHours() * 60 + now.getMinutes();
};

// 해·달은 지평선(base)에서 떠 정점(top)을 지나 진다.
const getArcPosition = (progress) => {
    const lift = Math.sin(Math.PI * clampNumber(progress, 0, 1));

    return { left: (SKY_ARC.left + (SKY_ARC.right - SKY_ARC.left) * progress) * window.innerWidth, top: (SKY_ARC.base - (SKY_ARC.base - SKY_ARC.top) * lift) * window.innerHeight };
};

const getHorizonVisibility = (progress) => {
    return smoothStep(-0.03, 0.05, progress) * (1 - smoothStep(0.95, 1.03, progress));
};

const toRgb = (channels) => {
    return `rgb(${channels.join(" ")})`;
};

const renderSky = () => {
    const minutes = getNowMinutes();
    const day = smoothStep(330, 420, minutes) * (1 - smoothStep(1080, 1170, minutes));
    const twilight = Math.max(bellCurve(minutes, 375, 45), bellCurve(minutes, 1112, 50));
    const colors = getSkyColors(minutes);
    const sunProgress = (minutes - SUNRISE_MINUTES) / (SUNSET_MINUTES - SUNRISE_MINUTES);
    const moonMinutes = minutes < SUNRISE_MINUTES ? minutes + DAY_MINUTES : minutes;
    const moonProgress = (moonMinutes - SUNSET_MINUTES) / (SUNRISE_MINUTES + DAY_MINUTES - SUNSET_MINUTES);
    const sun = getArcPosition(sunProgress);
    const moon = getArcPosition(moonProgress);
    const phase = getMoonPhase();
    const lit = (1 - Math.cos(2 * Math.PI * phase)) / 2;
    const uiSky = mixChannels(colors.top, colors.bottom, UI_SKY_POSITION);
    const values = {
        "--day": day.toFixed(3),
        "--night": (1 - day).toFixed(3),
        "--twilight": twilight.toFixed(3),
        "--sky-top": toRgb(colors.top),
        "--sky-bottom": toRgb(colors.bottom),
        "--sun-left": `${sun.left.toFixed(1)}px`,
        "--sun-top": `${sun.top.toFixed(1)}px`,
        "--sun-on": getHorizonVisibility(sunProgress).toFixed(3),
        "--moon-left": `${moon.left.toFixed(1)}px`,
        "--moon-top": `${moon.top.toFixed(1)}px`,
        "--moon-on": getHorizonVisibility(moonProgress).toFixed(3),
        "--glow-x": clampNumber(sunProgress, 0, 1).toFixed(3)
    };

    for (const [name, value] of Object.entries(values)) {
        skyRoot.style.setProperty(name, value);
    }

    skyElements.moonShadow.setAttribute("cx", ((phase < 0.5 ? -lit : lit) * MOON_SHADOW_TRAVEL).toFixed(2));
    skyElements.moonGlow.setAttribute("opacity", lit.toFixed(2));

    document.body.classList.toggle("night", getLuminance(uiSky) < NIGHT_LUMINANCE);
};

const createSvgElement = (name, attributes) => {
    const element = document.createElementNS(SVG_NS, name);

    for (const [key, value] of Object.entries(attributes)) {
        element.setAttribute(key, value);
    }

    return element;
};

// 별마다 애니메이션을 걸면 매 프레임 SVG 전체를 다시 그리므로, 별을 몇 겹의 SVG로 나눠 겹 단위 opacity(합성만 함)로 반짝이게 한다.
const buildStars = () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const random = createSeededRandom(STAR_SEED);
    const count = Math.round(((width * height) / STAR_AREA_PX) * STAR_DENSITY);
    const layers = Array.from({ length: STAR_LAYER_COUNT + 1 }, () => createSvgElement("svg", { viewBox: `0 0 ${width} ${height}` }));

    for (let index = 0; index < count; index++) {
        layers[index % STAR_LAYER_COUNT].append(createSvgElement("circle", { class: "star", cx: random() * width, cy: random() * height, r: 0.4 + random() ** 3 * 1.4 }));
    }

    const constellationLayer = layers[STAR_LAYER_COUNT];

    constellationLayer.classList.add("constellations");

    for (const constellation of CONSTELLATIONS) {
        const points = constellation.stars.map(([x, y]) => [constellation.at[0] * width + (x - 0.5) * constellation.size, constellation.at[1] * height + (y - 0.5) * constellation.size * 0.8]);

        for (const [from, to] of constellation.lines) {
            constellationLayer.append(createSvgElement("line", { class: "star-line", x1: points[from][0], y1: points[from][1], x2: points[to][0], y2: points[to][1] }));
        }

        for (const [x, y] of points) {
            constellationLayer.append(createSvgElement("circle", { class: "star-bright", cx: x, cy: y, r: 1.9 }));
        }
    }

    skyElements.stars.replaceChildren(...layers);
};

const buildClouds = () => {
    const random = createSeededRandom(CLOUD_SEED);
    const clouds = [];

    for (let index = 0; index < CLOUD_COUNT; index++) {
        const cloud = document.createElement("div");
        const duration = CLOUD_DURATION_RANGE[0] + random() * (CLOUD_DURATION_RANGE[1] - CLOUD_DURATION_RANGE[0]);

        cloud.className = "cloud";
        // 블러를 SVG 안에서 한 번만 그려 두면 흐르는 동안 레이어를 옮기기만 한다(CSS filter는 매 프레임 다시 흐린다).
        cloud.innerHTML = `<svg viewBox="-20 -20 160 100" aria-hidden="true"><path d="${CLOUD_PATH}" filter="url(#cloud-blur)" /></svg>`;
        cloud.style.setProperty("--cloud-top", `${((CLOUD_TOP_RANGE[0] + random() * (CLOUD_TOP_RANGE[1] - CLOUD_TOP_RANGE[0])) * 100).toFixed(1)}%`);
        cloud.style.setProperty("--cloud-scale", (0.55 + random() * 0.8).toFixed(2));
        cloud.style.setProperty("--cloud-duration", `${duration.toFixed(1)}s`);
        cloud.style.setProperty("--cloud-delay", `${(-random() * duration).toFixed(1)}s`);
        clouds.push(cloud);
    }

    skyElements.clouds.replaceChildren(...clouds);
};

const dropMeteor = () => {
    const meteor = document.createElement("i");
    const values = {
        "--meteor-x": `${(0.35 + Math.random() * 0.6) * window.innerWidth}px`,
        "--meteor-y": `${(0.02 + Math.random() * 0.3) * window.innerHeight}px`,
        "--meteor-length": `${70 + Math.random() * 90}px`,
        "--meteor-angle": `${142 + Math.random() * 18}deg`,
        "--meteor-travel": `${160 + Math.random() * 160}px`,
        "--meteor-duration": `${0.7 + Math.random() * 0.6}s`
    };

    meteor.className = "meteor";

    for (const [name, value] of Object.entries(values)) {
        meteor.style.setProperty(name, value);
    }

    meteor.addEventListener("animationend", () => meteor.remove());
    skyElements.meteors.append(meteor);
};

// 밤에만 5~15초 간격으로 운석이 떨어진다. 동작 줄이기 설정이면 떨어뜨리지 않는다.
const scheduleMeteor = () => {
    setTimeout(
        () => {
            if (document.body.classList.contains("night") && !prefersReducedMotion.matches && !document.hidden) {
                dropMeteor();
            }

            scheduleMeteor();
        },
        METEOR_MIN_DELAY_MS + Math.random() * METEOR_DELAY_RANGE_MS
    );
};

const handleSkyResize = () => {
    clearTimeout(skyResizeTimer);

    skyResizeTimer = setTimeout(() => {
        buildStars();
        renderSky();
    }, SKY_RESIZE_DELAY_MS);
};

// 처음 그릴 때는 전환 없이 바로 현재 하늘로 칠한다(켤 때 낮 하늘에서 30초에 걸쳐 밤으로 바뀌지 않게).
skyRoot.classList.add("sky-instant");
buildStars();
buildClouds();
renderSky();
requestAnimationFrame(() => requestAnimationFrame(() => skyRoot.classList.remove("sky-instant")));
scheduleMeteor();
setInterval(renderSky, SKY_UPDATE_MS);
window.addEventListener("resize", handleSkyResize);

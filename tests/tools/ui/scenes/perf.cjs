const { runningState, withProject } = require("./data.cjs");

// 부하를 주고 메인 스레드가 멈춘 시간(longtask), DOM 노드 수, 힙을 잰다. perf로 시작하는 note는 비교에서 값을 같게 요구하지 않고 나란히 보여 준다.
const INSTALL_OBSERVER = `(() => {
    window.__long = [];
    new PerformanceObserver((list) => list.getEntries().forEach((entry) => window.__long.push(entry.duration))).observe({ entryTypes: ["longtask"] });
})()`;

const READ_METRICS = `(() => {
    const long = window.__long;

    return JSON.stringify({
        longtasks: long.length,
        longtaskMs: Math.round(long.reduce((sum, ms) => sum + ms, 0)),
        longestMs: Math.round(Math.max(0, ...long)),
        nodes: document.getElementsByTagName("*").length,
        heapMB: Math.round(performance.memory.usedJSHeapSize / 1048576)
    });
})()`;

const lineOf = (index) => `10:${String(Math.floor(index / 60) % 60).padStart(2, "0")}:${String(index % 60).padStart(2, "0")} 줄 ${index} ${"설명 ".repeat(index % 9)}`;

const flood = async (t, total, batch, pauseMs) => {
    for (let index = 0; index < total; index += batch) {
        await t.log(Array.from({ length: batch }, (_, offset) => lineOf(index + offset)));
        await t.wait(pauseMs);
    }
};

const SCENES = [
    {
        name: "perf-log-flood-closed",
        init: { ...withProject, state: runningState() },
        run: async (t) => {
            await t.eval(INSTALL_OBSERVER);
            await flood(t, 3000, 20, 25);
            await t.wait(500);
            await t.note("perf:metrics", await t.eval(READ_METRICS));
        }
    },
    {
        name: "perf-log-flood-open",
        init: { ...withProject, state: runningState() },
        run: async (t) => {
            await t.click("#live-panel");
            await t.wait(700);
            await t.eval(INSTALL_OBSERVER);
            await flood(t, 3000, 20, 25);
            await t.wait(500);
            await t.note("perf:metrics", await t.eval(READ_METRICS));
        }
    },
    {
        name: "perf-state-storm",
        init: { ...withProject, state: runningState() },
        run: async (t) => {
            await t.eval(INSTALL_OBSERVER);

            for (let index = 0; index < 1500; index++) {
                await t.state({ work: { toolCalls: 48 + index, filesRead: 21 + (index % 40), filesEdited: 7 + (index % 12) } });

                if (index % 50 === 0) {
                    await t.wait(10);
                }
            }

            await t.wait(500);
            await t.note("perf:metrics", await t.eval(READ_METRICS));
        }
    },
    {
        name: "perf-open-history",
        init: { ...withProject, state: runningState() },
        run: async (t) => {
            await flood(t, 3000, 100, 10);
            await t.wait(800);
            await t.eval(INSTALL_OBSERVER);
            await t.eval(
                `window.__t0 = performance.now(); document.getElementById("live-panel").click(); new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => { window.__openMs = performance.now() - window.__t0; resolve(); })))`
            );
            await t.wait(900);
            await t.note("perf:open", JSON.stringify({ firstFrameMs: Math.round(await t.eval("window.__openMs")), metrics: JSON.parse(await t.eval(READ_METRICS)) }));
        }
    }
];

module.exports = { SCENES };

const { HOUR, NOW, PROJECT, RUNS, doneState, runningState, withProject } = require("./data.cjs");

const TOOL = (name, argument, time) => `${time}   > ${name} ${argument}`;

const SCHEDULES = {
    schedules: [
        { id: "sch-1", enabled: true, kind: "time", time: "23:00", window: "session", from: "", to: "", days: [1, 2, 3, 4, 5, 6, 0], minRemaining: 0, duration: 360 },
        { id: "sch-2", enabled: true, kind: "reset", time: "23:00", window: "weekly", from: "22:00", to: "07:00", days: [1, 2, 3, 4, 5], minRemaining: 50, duration: 240 }
    ],
    statuses: [
        { id: "sch-1", code: "next-time", at: NOW + 13 * HOUR },
        { id: "sch-2", code: "waiting-reset", resetsAt: NOW + 30 * HOUR }
    ]
};

// 연속 실행 장면용 날짜 목록. 가짜 시계(2026-09-01)의 어제까지 이어진 12일과 그 앞의 20일 기록.
const dayKeys = (start, count) =>
    Array.from({ length: count }, (value, index) => new Date(2026, 6, 1 + start + index)).map(
        (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
    );

const SCENES = [
    {
        name: "stage-ready-empty",
        init: {},
        run: async (t) => {
            await t.shot("greet", ".greet");
        }
    },
    {
        name: "stage-ready-project",
        init: { ...withProject, runs: RUNS },
        run: async (t) => {
            await t.shot("greet", ".greet");
            await t.shot("recent", "#recent");
            await t.hover(".run-item");
            await t.shot("recent-hover", "#recent");
        }
    },
    {
        name: "stage-ready-todo",
        init: { settings: { projectDir: PROJECT, policy: "todo", endTime: "22:00" }, runs: RUNS.slice(0, 1), schedules: SCHEDULES },
        run: async (t) => {
            await t.shot("greet", ".greet");
        }
    },
    {
        name: "stage-ready-streak",
        init: { ...withProject, runs: RUNS, streakDays: [...dayKeys(0, 20), ...dayKeys(50, 12)] },
        run: async (t) => {
            await t.shot("greet", ".greet");
        }
    },
    {
        name: "stage-ready-streak-record",
        init: { ...withProject, runs: RUNS.slice(0, 1), streakDays: [...dayKeys(0, 9), ...dayKeys(50, 12)] },
        run: async (t) => {
            await t.shot("greet", ".greet");
        }
    },
    {
        name: "stage-ready-streak-broken",
        init: { ...withProject, runs: RUNS.slice(0, 1), streakDays: dayKeys(56, 5) },
        run: async (t) => {
            await t.shot("greet", ".greet");
        }
    },
    {
        name: "stage-ready-schedules",
        init: { ...withProject, schedules: { schedules: [{ ...SCHEDULES.schedules[0], enabled: false }], statuses: [] } },
        run: async (t) => {
            await t.shot("peek-off", "#schedule-peek");
            await t.drive("schedules", SCHEDULES);
            await t.shot("peek-on", "#schedule-peek");
            await t.drive("schedules", { schedules: [], statuses: [] });
            await t.shot("peek-none", "#schedule-peek");
        }
    },
    {
        name: "stage-run-story",
        init: { ...withProject, state: runningState({ gains: [] }) },
        run: async (t) => {
            await t.log(["[앱] 엔진을 시작했어요", TOOL("Read", "src/index.js", "10:00:01")]);
            await t.shot("tool-phrase", ".story");
            await t.log(["10:00:03 먼저 프로젝트 구조를 살펴보고 있어요."]);
            await t.shot("first-sentence", ".story");
            await t.log([
                TOOL("Grep", "createStory", "10:00:05"),
                TOOL("Read", "desktop/viewFormat.js", "10:00:06"),
                "10:00:07 이야기를 만드는 부분을 찾았어요. 도구 줄이 오면 앱이 지은 문장을 먼저 보여주고, Claude의 문장이 오면 그 문장으로 바꿔 줘요. 이렇게 하면 사용자가 지금 무슨 일을 하는지 늘 알 수 있어요.",
                "    둘째 줄은 앞 문장에 이어져요.",
                TOOL("Edit", "desktop/ui/Story.jsx", "10:00:09"),
                "10:00:10 파일을 고쳤어요."
            ]);
            await t.shot("burst", ".story");
            await t.state({ phase: "5분 후 재시도 대기" });
            await t.shot("retry-wait", ".story");
            await t.state({ phase: "3회차 진행 중" });
            await t.shot("after-wait", ".story");
        }
    },
    {
        name: "stage-run-work",
        init: { ...withProject, state: runningState() },
        run: async (t) => {
            await t.shot("work", ".work");
            await t.state({ work: { toolCalls: 120, filesRead: 33, filesEdited: 12 } });
            await t.shot("work-changed", ".work");
        }
    },
    {
        name: "stage-run-outcome",
        init: { ...withProject, state: runningState({ gains: [{ round: 3, text: "테스트 통과 41 → 58" }] }) },
        run: async (t) => {
            await t.shot("outcome", "#outcome");
            await t.state({ gains: [{ round: 2, text: "빌드 시간 1,234.5ms → 987.6ms" }] });
            await t.shot("outcome-earlier", "#outcome");
            await t.state({ gains: [{ round: 3, text: "번들 크기 2,345,678.25MB → 1,234,567.5MB 로 아주 많이 줄였어요" }] });
            await t.shot("outcome-long", "#outcome");
            await t.state({ gains: [{ round: 3, text: "문서를 정리했어요" }] });
            await t.shot("outcome-sentence", "#outcome");
            await t.state({ gains: [] });
            await t.shot("outcome-none", "#outcome");
        }
    },
    {
        name: "stage-run-apply-note",
        init: { ...withProject, state: runningState({ requested: { model: "claude-sonnet-4-6", effort: "low" } }) },
        run: async (t) => {
            await t.shot("apply-note", ".now-meta");
            await t.state({ requested: { model: "claude-opus-4-8", effort: "high" } });
            await t.shot("apply-note-cleared", ".now-meta");
        }
    },
    {
        name: "stage-done",
        init: { ...withProject, state: doneState() },
        run: async (t) => {
            await t.shot("finish", ".finish");
            await t.state({ reason: "사용량 한도 도달", exitCode: 1, gains: [] });
            await t.shot("finish-limit", ".finish");
            await t.state({ reason: "강제 종료", exitCode: 130, rounds: [] });
            await t.shot("finish-killed", ".finish");
        }
    },
    {
        name: "stage-done-actions",
        init: { ...withProject, state: doneState() },
        run: async (t) => {
            await t.clearCalls();
            await t.click("#done-report");
            await t.note("calls", (await t.calls()).map((call) => call[0]).join(","));
            await t.click("#back-to-ready");
            await t.shot("after-back", ".greet");
            await t.note("view", await t.eval("document.body.dataset.view"));
        }
    }
];

module.exports = { SCENES };

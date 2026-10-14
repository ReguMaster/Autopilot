// 장면에서 쓰는 가짜 데이터. 시각은 가짜 시계(NOW)를 기준으로 맞춘다.
const NOW = new Date(2026, 8, 1, 10, 0, 0).getTime();
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

const PROJECT = "E:/Workspaces/Demo/Kirikomodo";

const round = (number, overrides = {}) => ({
    round: number,
    startedAt: NOW - (4 - number) * 40 * MINUTE,
    endedAt: NOW - (4 - number) * 40 * MINUTE + 30 * MINUTE,
    outcome: "완료",
    model: "claude-opus-4-8",
    effort: "high",
    commits: [{ hash: `a1b2c3${number}`, insertions: 12 * number, deletions: 3 * number, subject: `${number}회차 정리` }],
    timesKnown: true,
    ...overrides
});

const runningState = (overrides = {}) => ({
    status: "running",
    pid: 4242,
    startedAt: NOW - 2 * HOUR,
    deadlineAt: NOW + 5 * HOUR,
    endedAt: 0,
    attached: false,
    exitCode: null,
    reason: "",
    phase: "3회차 진행 중",
    round: 3,
    rounds: [round(1), round(2), round(3, { endedAt: 0, outcome: "", commits: [] })],
    model: "claude-opus-4-8",
    effort: "high",
    requested: { model: "claude-opus-4-8", effort: "high" },
    project: PROJECT,
    policy: "자율개선",
    logFile: `${PROJECT}/.autopilot/progress/2026-09-01/autopilot_080000_x.log`,
    reportFile: `${PROJECT}/.autopilot/progress/2026-09-01/report_080000_x.html`,
    work: { toolCalls: 48, filesRead: 21, filesEdited: 7 },
    gains: [{ round: 2, text: "테스트 통과 41 → 58" }],
    ...overrides
});

const doneState = (overrides = {}) =>
    runningState({
        status: "idle",
        pid: 0,
        endedAt: NOW - 5 * MINUTE,
        phase: "",
        reason: "종료 시각에 도달",
        rounds: [round(1), round(2), round(3)],
        gains: [
            { round: 1, text: "린트 경고 24 → 3" },
            { round: 2, text: "테스트 통과 41 → 58" }
        ],
        ...overrides
    });

const withProject = { settings: { projectDir: PROJECT } };

const DAY = 24 * HOUR;

// 지난 실행 한 건(runHistory가 돌려주는 요약과 같은 모양)
const makeRun = (index, overrides = {}) => ({
    id: `2026-08-${String(31 - index).padStart(2, "0")}/autopilot_2300${String(index).padStart(2, "0")}_x.log`,
    startedAt: NOW - index * DAY - 11 * HOUR,
    endedAt: NOW - index * DAY - 11 * HOUR + (3 + index) * HOUR,
    policy: "자율개선",
    deadlineAt: NOW - index * DAY - 4 * HOUR,
    reason: "예정 시각 도달",
    roundCount: 3 + index,
    commitCount: 4 + index,
    insertions: 120 + index * 10,
    deletions: 30 + index,
    toolCalls: 80,
    filesEdited: 9,
    gains: [{ round: 2, text: "테스트 통과 41 → 58" }],
    headline: "테스트 통과 41 → 58",
    isEmpty: false,
    hasReport: true,
    isPartial: false,
    isUnreadable: false,
    isActive: false,
    ...overrides
});

const RUNS = [
    makeRun(0),
    makeRun(1, { reason: "사용량 한도로 종료", headline: "린트 경고 24 → 3" }),
    makeRun(2, { reason: "연속 3회 실패", commitCount: 0, insertions: 0, deletions: 0, headline: "" }),
    makeRun(3, { isUnreadable: true })
];

module.exports = { NOW, MINUTE, HOUR, DAY, PROJECT, round, runningState, doneState, withProject, makeRun, RUNS };

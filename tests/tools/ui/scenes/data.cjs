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

module.exports = { NOW, MINUTE, HOUR, PROJECT, round, runningState, doneState, withProject };

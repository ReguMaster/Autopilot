const { spawn, spawnSync, execFile } = require("node:child_process");

const STATUS_OK = "OK";
const STATUS_FAILED = "FAILED";

const MODEL_CHOICES = ["fable", "opus", "sonnet", "haiku"];
const EFFORT_CHOICES = ["low", "medium", "high", "xhigh", "max"];
const MAX_LOG_LINES = 3000;
const STOP_TIMEOUT_MS = 10000;

const HEADER_PATTERN = /^(Project|Deadline|Policy|Log|Report) : (.+)$/;
const DATETIME_PATTERN = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})/;
const ROUND_PATTERN = /^\[(\d+)회차\] (.+)$/;
const ROUND_START_PATTERN = /^시작 - 남은 시간 \d+분(?: \(model (\S+), effort (\S+)\))?/;
const RETRY_PATTERN = /^(\d+)분 후 재시도/;
const LIMIT_PATTERN = /^\[사용량 한도\] (.+)까지 대기/;
const FINISH_PATTERN = /^AutoPilot 종료 - (.+) \(\d+회차\)$/;

const createInitialState = () => {
    return {
        status: "idle",
        pid: 0,
        startedAt: 0,
        endedAt: 0,
        exitCode: null,
        reason: "",
        phase: "",
        round: 0,
        rounds: [],
        model: "",
        effort: "",
        requested: { model: "", effort: "" },
        project: "",
        deadlineAt: 0,
        policy: "",
        logFile: "",
        reportFile: ""
    };
};

const createFailure = (code, msg) => {
    return { status: STATUS_FAILED, error: { code: code, msg: msg } };
};

const createLineReader = (handleLines) => {
    let rest = "";

    return {
        push: (text) => {
            const lines = (rest + text).split(/\r?\n/);

            rest = lines.pop();

            if (lines.length) {
                handleLines(lines);
            }
        },
        flush: () => {
            if (rest) {
                handleLines([rest]);
                rest = "";
            }
        }
    };
};

const applyHeader = (state, key, value) => {
    if (key === "Deadline") {
        const datetime = value.match(DATETIME_PATTERN);

        state.deadlineAt = datetime ? new Date(`${datetime[1]}T${datetime[2]}`).getTime() : 0;
    } else if (key === "Policy") {
        state.policy = value;
    } else if (key === "Project") {
        state.project = value;
    } else if (key === "Log") {
        state.logFile = value;
    } else if (key === "Report") {
        state.reportFile = value;
    }
};

const applyRound = (state, round, text) => {
    const roundStart = text.match(ROUND_START_PATTERN);

    if (roundStart) {
        state.round = round;
        state.phase = `${round}회차 진행 중`;
        state.model = roundStart[1] || state.model;
        state.effort = roundStart[2] || state.effort;
        state.rounds.push({ round: round, startedAt: Date.now(), endedAt: 0, outcome: "", model: state.model, effort: state.effort });

        return;
    }

    const retry = text.match(RETRY_PATTERN);

    if (retry) {
        state.phase = `${retry[1]}분 후 재시도 대기`;

        return;
    }

    const currentRound = state.rounds.findLast((item) => item.round === round && !item.endedAt);

    if (currentRound) {
        currentRound.endedAt = Date.now();
        currentRound.outcome = text;
    }

    state.phase = `${round}회차 ${text}`;
};

// CLI 로그 줄에서 대시보드 상태를 읽는다. 알 수 없는 줄은 무시한다.
const parseLine = (state, line) => {
    const header = line.match(HEADER_PATTERN);

    if (header) {
        applyHeader(state, header[1], header[2]);

        return;
    }

    const round = line.match(ROUND_PATTERN);

    if (round) {
        applyRound(state, Number(round[1]), round[2]);

        return;
    }

    const limit = line.match(LIMIT_PATTERN);

    if (limit) {
        state.phase = `사용량 한도 대기 (${limit[1]}까지)`;

        return;
    }

    const finish = line.match(FINISH_PATTERN);

    if (finish) {
        state.reason = finish[1];
    }
};

const killProcessTree = (childProcess) => {
    if (process.platform !== "win32") {
        // autopilot의 SIGTERM 처리가 회차 프로세스 그룹까지 종료한다.
        childProcess.kill("SIGTERM");

        return;
    }

    const result = spawnSync("taskkill", ["/PID", String(childProcess.pid), "/T", "/F"], { windowsHide: true, encoding: "utf8" });

    if (result.error) {
        throw result.error;
    }

    if (result.status && childProcess.exitCode === null) {
        throw new Error(`프로세스 트리 종료 실패: PID ${childProcess.pid}: ${result.stderr?.trim()}`);
    }
};

// 실행 파일(또는 prefixArgs로 감싼 스크립트) 하나를 자식 프로세스로 실행하고 로그·상태를 콜백으로 전달한다.
const createRunner = ({ onLog, onState }) => {
    const state = createInitialState();
    const logs = [];
    let child = null;
    let launch = null;
    let isKilled = false;

    const emitState = () => {
        onState(state);
    };

    const addLines = (stream, lines) => {
        const entries = lines.map((text) => ({ stream: stream, text: text, at: Date.now() }));

        if (stream === "out") {
            for (const entry of entries) {
                parseLine(state, entry.text);
            }
        }

        logs.push(...entries);
        logs.splice(0, Math.max(0, logs.length - MAX_LOG_LINES));

        onLog(entries);
        emitState();
    };

    const finishRun = (exitCode, errorMessage) => {
        if (!child) {
            return;
        }

        child = null;

        Object.assign(state, { status: "idle", pid: 0, endedAt: Date.now(), exitCode: exitCode, phase: "종료" });

        if (isKilled) {
            state.reason = "강제 종료";
        } else if (errorMessage) {
            state.reason = errorMessage;
        } else if (!state.reason) {
            state.reason = exitCode === 0 ? "종료" : `exit ${exitCode}`;
        }

        addLines("app", [`[앱] 엔진이 종료됐어요 (exit ${exitCode}) - ${state.reason}`]);
    };

    // roundOptions는 시작 인자로 넘기는 model·effort다. 첫 회차 로그가 올 때까지 화면에 이 값을 보여준다.
    const start = ({ command, prefixArgs = [], args = [], roundOptions = {} }) => {
        if (child) {
            return createFailure("ALREADY_RUNNING", "이미 실행 중이에요.");
        }

        launch = { command: command, prefixArgs: prefixArgs };
        isKilled = false;

        const { model = "", effort = "" } = roundOptions;

        Object.assign(state, createInitialState(), { status: "running", startedAt: Date.now(), phase: "시작 중", model: model, effort: effort, requested: { model: model, effort: effort } });

        const childProcess = spawn(command, [...prefixArgs, ...args], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
        const outReader = createLineReader((lines) => addLines("out", lines));
        const errReader = createLineReader((lines) => addLines("err", lines));

        child = childProcess;
        state.pid = childProcess.pid || 0;

        childProcess.stdout.setEncoding("utf8");
        childProcess.stderr.setEncoding("utf8");
        childProcess.stdout.on("data", outReader.push);
        childProcess.stderr.on("data", errReader.push);

        childProcess.once("error", (error) => finishRun(-1, error.message));
        childProcess.once("close", (exitCode) => {
            outReader.flush();
            errReader.flush();
            finishRun(exitCode ?? -1);
        });

        addLines("app", [`[앱] 엔진을 시작했어요: ${[command, ...prefixArgs, ...args].join(" ")}`]);

        return { status: STATUS_OK };
    };

    // 같은 실행 파일에 stop을 전달한다. 현재 회차를 마친 뒤 종료된다.
    const stop = () => {
        return new Promise((resolve) => {
            if (!child || state.status !== "running") {
                resolve(createFailure("NOT_RUNNING", "실행 중이 아니거나 이미 종료 신호를 보냈어요."));

                return;
            }

            execFile(launch.command, [...launch.prefixArgs, "stop"], { windowsHide: true, timeout: STOP_TIMEOUT_MS, encoding: "utf8" }, (error, stdout, stderr) => {
                if (error) {
                    addLines("err", [`[앱] 종료 신호 전달 실패: ${(stderr || error.message).trim()}`]);
                    resolve(createFailure("STOP_FAILED", error.message));

                    return;
                }

                if (child) {
                    state.status = "stopping";
                    state.phase = "현재 회차 후 종료 예정";
                }

                addLines("app", ["[앱] 종료 신호를 보냈어요. 현재 회차를 마친 뒤 종료돼요."]);
                resolve({ status: STATUS_OK });
            });
        });
    };

    // 같은 실행 파일에 set을 전달한다. 진행 중인 회차에는 영향이 없고 다음 회차부터 적용된다.
    const setRoundOptions = ({ model, effort }) => {
        return new Promise((resolve) => {
            if (!child || state.status !== "running") {
                resolve(createFailure("NOT_RUNNING", "실행 중일 때만 변경할 수 있어요."));

                return;
            }

            execFile(
                launch.command,
                [...launch.prefixArgs, "set", "--model", model, "--effort", effort],
                { windowsHide: true, timeout: STOP_TIMEOUT_MS, encoding: "utf8" },
                (error, stdout, stderr) => {
                    if (error) {
                        const message = (stderr || error.message).trim();

                        addLines("err", [`[앱] 모델·effort 변경 실패: ${message}`]);
                        resolve(createFailure("SET_OPTIONS_FAILED", message));

                        return;
                    }

                    state.requested = { model: model, effort: effort };

                    addLines("app", [`[앱] 다음 회차부터 model ${model}, effort ${effort}을(를) 적용해요.`]);
                    resolve({ status: STATUS_OK });
                }
            );
        });
    };

    const kill = () => {
        if (!child) {
            return createFailure("NOT_RUNNING", "실행 중이 아니에요.");
        }

        try {
            isKilled = true;

            killProcessTree(child);
        } catch (error) {
            isKilled = false;

            addLines("err", [`[앱] ${error.message}`]);

            return createFailure("KILL_FAILED", error.message);
        }

        addLines("app", ["[앱] 강제 종료를 요청했어요."]);

        return { status: STATUS_OK };
    };

    return {
        start: start,
        stop: stop,
        setRoundOptions: setRoundOptions,
        kill: kill,
        isRunning: () => child !== null,
        getState: () => state,
        getLogs: () => logs
    };
};

module.exports = { createRunner, MODEL_CHOICES, EFFORT_CHOICES, STATUS_OK, STATUS_FAILED };

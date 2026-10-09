const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync, execFile } = require("node:child_process");
const { StringDecoder } = require("node:string_decoder");
const { isKitLogFile } = require("./engineFinder.cjs");

const STATUS_OK = "OK";
const STATUS_FAILED = "FAILED";

const MODEL_CHOICES = ["fable", "opus", "sonnet", "haiku"];
const EFFORT_CHOICES = ["low", "medium", "high", "xhigh", "max"];
const MAX_LOG_LINES = 3000;
const STOP_TIMEOUT_MS = 10000;
const ATTACH_POLL_MS = 1000;
const ATTACH_READ_CHUNK_BYTES = 1024 * 1024;

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
        attached: false,
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

const applyRound = (state, round, text, isReplay) => {
    const roundStart = text.match(ROUND_START_PATTERN);

    if (roundStart) {
        state.round = round;
        state.phase = `${round}회차 진행 중`;
        state.model = roundStart[1] || state.model;
        state.effort = roundStart[2] || state.effort;
        state.rounds.push({ round: round, startedAt: Date.now(), endedAt: 0, outcome: "", model: state.model, effort: state.effort, timesKnown: !isReplay });

        // 연결한 엔진은 앱이 set한 값이 없으므로 회차가 실제로 쓴 값을 요청 값으로 본다(앱 밖에서 바꾼 값도 반영된다).
        if (state.attached) {
            state.requested = { model: state.model, effort: state.effort };
        }

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

// CLI 로그 줄에서 대시보드 상태를 읽는다. 알 수 없는 줄은 무시한다. 이미 쓰인 로그를 다시 읽는 중(isReplay)이면 회차 시각을 알 수 없다.
const parseLine = (state, line, isReplay = false) => {
    const header = line.match(HEADER_PATTERN);

    if (header) {
        applyHeader(state, header[1], header[2]);

        return;
    }

    const round = line.match(ROUND_PATTERN);

    if (round) {
        applyRound(state, Number(round[1]), round[2], isReplay);

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

const isPidAlive = (pid) => {
    try {
        process.kill(pid, 0);

        return true;
    } catch (error) {
        return error.code === "EPERM";
    }
};

const killProcessTree = (pid, hasExited) => {
    if (process.platform !== "win32") {
        // autopilot의 SIGTERM 처리가 회차 프로세스 그룹까지 종료한다.
        process.kill(pid, "SIGTERM");

        return;
    }

    const result = spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, encoding: "utf8" });

    if (result.error) {
        throw result.error;
    }

    if (result.status && !hasExited()) {
        throw new Error(`프로세스 트리 종료 실패: PID ${pid}: ${result.stderr?.trim()}`);
    }
};

// 엔진의 status 출력(한 줄 JSON)을 해석한다. 실행 중이 아니거나 형식이 맞지 않으면 null이다.
const parseRunStatus = (stdout) => {
    try {
        const runStatus = JSON.parse(stdout.trim().split(/\r?\n/).at(-1));

        if (runStatus?.running === true && Number.isInteger(runStatus.pid) && runStatus.pid > 0 && typeof runStatus.logFile === "string" && runStatus.logFile) {
            return runStatus;
        }
    } catch {}

    return null;
};

// 이미 쓰인 로그를 다시 읽을 때 실행 시작 시각으로 쓴다. 생성 시각을 알 수 없는 파일시스템이면 지금으로 대신한다.
const getLogStartTime = (logFile) => {
    const { birthtimeMs } = fs.statSync(logFile);

    return birthtimeMs > 0 ? birthtimeMs : Date.now();
};

// 실행 파일(또는 prefixArgs로 감싼 스크립트) 하나를 자식 프로세스로 실행하고 로그·상태를 콜백으로 전달한다.
// 앱이 시작하지 않은 엔진은 attachIfRunning으로 연결해 로그 파일을 따라간다. attachPollMs는 테스트에서 줄인다.
const createRunner = ({ onLog, onState, attachPollMs = ATTACH_POLL_MS }) => {
    const state = createInitialState();
    const logs = [];
    let child = null;
    let attachedPid = 0;
    let attachTimer = null;
    let attachReader = null;
    let attachDecoder = null;
    let attachLogFile = "";
    let attachOffset = 0;
    let isReplaying = false;
    let launch = null;
    let isKilled = false;

    const isActive = () => child !== null || attachedPid !== 0;

    const emitState = () => {
        onState(state);
    };

    const addLines = (stream, lines, isReplay = false) => {
        const entries = lines.map((text) => ({ stream: stream, text: text, at: Date.now() }));

        if (stream === "out") {
            for (const entry of entries) {
                parseLine(state, entry.text, isReplay);
            }
        }

        logs.push(...entries);
        logs.splice(0, Math.max(0, logs.length - MAX_LOG_LINES));

        onLog(entries);
        emitState();
    };

    const getDefaultReason = (exitCode) => {
        if (exitCode === null) {
            return "종료 코드를 알 수 없어요";
        }

        return exitCode === 0 ? "종료" : `exit ${exitCode}`;
    };

    const finishRun = (exitCode, errorMessage) => {
        if (!isActive()) {
            return;
        }

        const wasAttached = attachedPid !== 0;

        child = null;
        attachedPid = 0;

        clearInterval(attachTimer);

        attachTimer = null;

        Object.assign(state, { status: "idle", pid: 0, endedAt: Date.now(), exitCode: exitCode, phase: "종료" });

        if (isKilled) {
            state.reason = "강제 종료";
        } else if (errorMessage) {
            state.reason = errorMessage;
        } else if (!state.reason) {
            state.reason = getDefaultReason(exitCode);
        }

        addLines("app", [wasAttached ? `[앱] 연결한 엔진이 종료됐어요 - ${state.reason}` : `[앱] 엔진이 종료됐어요 (exit ${exitCode}) - ${state.reason}`]);
    };

    // roundOptions는 시작 인자로 넘기는 model·effort다. 첫 회차 로그가 올 때까지 화면에 이 값을 보여준다.
    const start = ({ command, prefixArgs = [], args = [], roundOptions = {} }) => {
        if (isActive()) {
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

    // 로그 파일에서 새로 쓰인 부분만 읽는다. 한 번에 읽는 양을 제한해 큰 로그도 메모리를 아끼고, 글자 중간에서 잘린 바이트는 다음 읽기로 넘긴다.
    const readLogGrowth = () => {
        const size = fs.statSync(attachLogFile).size;
        const fileDescriptor = fs.openSync(attachLogFile, "r");

        try {
            while (attachOffset < size) {
                const buffer = Buffer.alloc(Math.min(ATTACH_READ_CHUNK_BYTES, size - attachOffset));
                const bytesRead = fs.readSync(fileDescriptor, buffer, 0, buffer.length, attachOffset);

                if (!bytesRead) {
                    break;
                }

                attachOffset += bytesRead;
                attachReader.push(attachDecoder.write(buffer.subarray(0, bytesRead)));
            }
        } finally {
            fs.closeSync(fileDescriptor);
        }
    };

    // 종료 여부를 먼저 확인하고 로그를 읽는다. 그래야 종료 직전에 쓰인 줄까지 빠짐없이 읽는다.
    const followLog = () => {
        const isAlive = isPidAlive(attachedPid);

        try {
            readLogGrowth();
        } catch {}

        if (isAlive) {
            return;
        }

        attachReader.flush();
        finishRun(null);
    };

    // 이미 실행 중인 엔진의 로그 파일을 처음부터 읽어 상태를 복원하고 이어서 따라간다. 앱이 시작한 엔진이 아니므로 종료 코드는 알 수 없다.
    const attach = ({ command, prefixArgs, pid, logFile }) => {
        launch = { command: command, prefixArgs: prefixArgs };
        isKilled = false;
        // 읽을 파일은 검증을 거친 경로만 쓴다. 로그 안의 Log 헤더 값은 표시용이라 읽기 대상을 바꾸지 못한다.
        attachLogFile = logFile;
        attachOffset = 0;
        attachDecoder = new StringDecoder("utf8");
        attachReader = createLineReader((lines) => addLines("out", lines, isReplaying));

        Object.assign(state, createInitialState(), { status: "running", attached: true, pid: pid, startedAt: getLogStartTime(logFile), phase: "연결 중", logFile: logFile });

        addLines("app", [`[앱] 이미 실행 중인 엔진(PID ${pid})에 연결했어요. 앱을 닫아도 엔진은 계속 실행돼요.`]);

        isReplaying = true;

        try {
            readLogGrowth();
        } finally {
            isReplaying = false;
        }

        attachedPid = pid;
        attachTimer = setInterval(followLog, attachPollMs);
    };

    // 앱이 시작하지 않았지만 이미 실행 중인 엔진이 있으면(엔진의 status로 확인) 연결한다. 로그 경로는 키트 progress/ 안의 엔진 로그만 받는다.
    const attachIfRunning = ({ command, prefixArgs = [], kitDir = path.dirname(command) }) => {
        return new Promise((resolve) => {
            const notAttached = { status: STATUS_OK, data: { attached: false } };

            if (isActive()) {
                resolve(notAttached);

                return;
            }

            execFile(command, [...prefixArgs, "status"], { windowsHide: true, timeout: STOP_TIMEOUT_MS, encoding: "utf8" }, (error, stdout) => {
                const runStatus = error ? null : parseRunStatus(stdout);

                if (!runStatus || isActive() || !isKitLogFile(kitDir, runStatus.logFile)) {
                    resolve(notAttached);

                    return;
                }

                try {
                    attach({ command: command, prefixArgs: prefixArgs, pid: runStatus.pid, logFile: runStatus.logFile });
                    resolve({ status: STATUS_OK, data: { attached: true } });
                } catch (attachError) {
                    Object.assign(state, createInitialState());

                    addLines("err", [`[앱] 실행 중인 엔진에 연결하지 못했어요: ${attachError.message}`]);
                    resolve(createFailure("ATTACH_FAILED", attachError.message));
                }
            });
        });
    };

    // 같은 실행 파일에 stop을 전달한다. 현재 회차를 마친 뒤 종료된다.
    const stop = () => {
        return new Promise((resolve) => {
            if (!isActive() || state.status !== "running") {
                resolve(createFailure("NOT_RUNNING", "실행 중이 아니거나 이미 종료 신호를 보냈어요."));

                return;
            }

            execFile(launch.command, [...launch.prefixArgs, "stop"], { windowsHide: true, timeout: STOP_TIMEOUT_MS, encoding: "utf8" }, (error, stdout, stderr) => {
                if (error) {
                    addLines("err", [`[앱] 종료 신호 전달 실패: ${(stderr || error.message).trim()}`]);
                    resolve(createFailure("STOP_FAILED", error.message));

                    return;
                }

                if (isActive()) {
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
            if (!isActive() || state.status !== "running") {
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
        if (!isActive()) {
            return createFailure("NOT_RUNNING", "실행 중이 아니에요.");
        }

        const childProcess = child;
        const pid = childProcess ? childProcess.pid : attachedPid;
        const hasExited = childProcess ? () => childProcess.exitCode !== null : () => !isPidAlive(pid);

        try {
            isKilled = true;

            killProcessTree(pid, hasExited);
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
        attachIfRunning: attachIfRunning,
        stop: stop,
        setRoundOptions: setRoundOptions,
        kill: kill,
        isRunning: isActive,
        isAttached: () => attachedPid !== 0,
        getState: () => state,
        getLogs: () => logs
    };
};

module.exports = { createRunner, createInitialState, parseLine, MODEL_CHOICES, EFFORT_CHOICES, STATUS_OK, STATUS_FAILED };

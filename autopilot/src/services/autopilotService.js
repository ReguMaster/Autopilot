import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
    STATUS_OK,
    STATUS_FAILED,
    ERROR_CODE_AUTOPILOT_FAILED,
    ERROR_CODE_AUTOPILOT_ERROR,
    MINUTE_MS,
    WAIT_POLL_MS,
    REPORT_REFRESH_MS,
    EXIT_CODE_SUCCESS,
    POLICY_TODO,
    WORK_DIR_NAME,
    PROGRESS_DIR_NAME,
    TODO_COMPLETE_FILE_NAME,
    STOP_REASON_REQUESTED,
    ROUND_OPTIONS_FILE_NAME,
    PROGRESS_MAX_LINES,
    AUTOPILOT_DEFAULTS
} from "../utils/config.js";

import log from "../utils/logUtil.js";
import util from "../utils/util.js";
import dateUtil from "../utils/dateUtil.js";
import fileUtil from "../utils/fileUtil.js";
import gitUtil from "../utils/gitUtil.js";
import processUtil from "../utils/processUtil.js";
import settingsUtil from "../utils/settingsUtil.js";
import promptUtil from "../utils/promptUtil.js";
import progressUtil from "../utils/progressUtil.js";
import reportUtil from "../utils/reportUtil.js";
import autopilotUtil from "../utils/autopilotUtil.js";

const INTERRUPT_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"];

const writeRunHeader = (context) => {
    const { env, runState, writeLog } = context;
    const headerLines = [
        "Claude Code AutoPilot",
        `Project : ${runState.projectDir}`,
        `Config : ${env.CLAUDE_CONFIG_DIR}`,
        `Progress : ${runState.progressFile}`,
        `Deadline : ${dateUtil.getDatetimeString(runState.deadline)} (${runState.endSource})`,
        `Policy : ${runState.policy} (${runState.policySource})`,
        `Log : ${runState.logFile}`,
        `Report : ${runState.reportFile}`
    ];

    for (const headerLine of headerLines) {
        writeLog(headerLine);
    }
};

const getProjectPaths = (options) => {
    const projectDir = autopilotUtil.getProjectDir(options.projectDir);

    return { projectDir: projectDir, workDir: autopilotUtil.getWorkDir(projectDir) };
};

// 실행 전 검증과 폴더·로그 준비를 마치고 회차 실행에 필요한 값을 모아 반환한다.
const prepareRun = (options) => {
    const runConfig = { ...AUTOPILOT_DEFAULTS, ...options.limits };
    const { projectDir, workDir } = getProjectPaths(options);
    const env = autopilotUtil.getRunEnv(options);
    const runGitCommand = gitUtil.createGitRunner(processUtil.getExecutablePath("git", env), projectDir, env);

    gitUtil.assertGitProject(runGitCommand, projectDir);

    const command = options.command || processUtil.getExecutablePath("claude", env);
    const runStart = new Date();
    const runDate = dateUtil.getDateString(runStart);
    const tasks = (options.tasks || "").trim();
    const runSettings = settingsUtil.getRunSettings(options.endTime, options.policy, runStart);

    if (runSettings.policy === POLICY_TODO && !tasks) {
        throw new Error("지시개선 정책에는 처리할 작업이 필요합니다.");
    }

    const progressDir = path.join(workDir, PROGRESS_DIR_NAME, runDate);
    const progressFile = autopilotUtil.getProgressFile(projectDir, options.dataDir);
    const runId = `${dateUtil.getTimeString(runStart).replace(/:/g, "")}_${randomUUID().slice(0, 8)}`;

    fs.mkdirSync(progressDir, { recursive: true });
    progressUtil.ensureProgressRecord(progressFile);

    const runState = {
        ...runSettings,
        workDir: workDir,
        projectDir: projectDir,
        tasks: tasks,
        progressFile: progressFile,
        runStart: runStart,
        runDate: runDate,
        progressDir: progressDir,
        runGitCommand: runGitCommand,
        rounds: [],
        stopFile: autopilotUtil.getStopFile(workDir),
        roundOptionsFile: autopilotUtil.getRoundOptionsFile(workDir),
        logFile: path.join(progressDir, `autopilot_${runId}.log`),
        reportFile: path.join(progressDir, `report_${runId}.html`),
        todoDoneRelPath: `${WORK_DIR_NAME}/${PROGRESS_DIR_NAME}/${runDate}/${TODO_COMPLETE_FILE_NAME}`
    };
    const todoDoneFile = path.join(projectDir, runState.todoDoneRelPath);
    const writeLog = log.createFileLogger(runState.logFile);

    // 앱이 실행 중인 엔진에 다시 연결할 수 있도록 로그 파일 위치를 잠금에 남긴다. 실패해도 실행에는 영향이 없다.
    try {
        autopilotUtil.writeRunLockLogFile(autopilotUtil.getLockFile(workDir), runState.logFile);
    } catch (error) {
        writeLog(`[설정] 잠금에 로그 위치를 기록하지 못했습니다: ${error.message}`);
    }

    // 이전 실행의 완료·중단 신호와 model·effort 변경이 이번 실행에 영향을 주지 않도록 지운다.
    fileUtil.removeFiles([todoDoneFile, runState.stopFile, runState.roundOptionsFile]);

    const context = {
        options: options,
        runConfig: runConfig,
        env: env,
        command: command,
        runState: runState,
        todoDoneFile: todoDoneFile,
        writeLog: writeLog,
        progressCleanupPrompt: "",
        isCleanupRequested: false,
        isCleanupSkipped: false,
        recordedCommitHashes: new Set(gitUtil.getCommitHashesSince(runGitCommand, runStart))
    };

    writeRunHeader(context);

    progressUtil.pruneRunFiles(path.join(workDir, PROGRESS_DIR_NAME), runDate, runConfig.logRetentionDays, writeLog);

    return context;
};

const createLoopState = () => {
    return { activeProcess: null, isInterrupted: false, isAborted: false, isWorkComplete: false, failureCount: 0, idleCount: 0, reason: "" };
};

const isStopRequested = (context, loopState) => {
    return loopState.isInterrupted || fs.existsSync(context.runState.stopFile);
};

// SIGINT/SIGTERM/SIGHUP(터미널 닫힘)이면 실행 중인 세션을 종료하고 현재 회차 후 끝낸다. 해제 함수를 반환한다.
const registerInterruptHandlers = (context, loopState) => {
    const interrupt = () => {
        loopState.isInterrupted = true;

        try {
            processUtil.killProcessTree(loopState.activeProcess);
        } catch (error) {
            context.writeLog(error.message);

            loopState.isAborted = true;
        }
    };

    for (const signal of INTERRUPT_SIGNALS) {
        process.on(signal, interrupt);
    }

    return () => {
        for (const signal of INTERRUPT_SIGNALS) {
            process.removeListener(signal, interrupt);
        }
    };
};

const waitUntil = async (context, loopState, until) => {
    while (Date.now() < until && !isStopRequested(context, loopState)) {
        await util.sleep(Math.min(WAIT_POLL_MS, until - Date.now()));
    }
};

// 세션이 실행되는 동안 리포트를 주기적으로 갱신한다.
const executeSession = async (context, loopState, { round, prompt, roundDeadline, sessionStats, roundOptions }) => {
    const { options, command, env, runState, writeLog } = context;
    const updateLiveReport = () => {
        reportUtil.writeRunReport(runState, `${round}회차 진행 중 · 시한 ${dateUtil.getTimeString(new Date(roundDeadline))}`, true);
    };

    updateLiveReport();

    const reportTimer = setInterval(updateLiveReport, REPORT_REFRESH_MS);

    try {
        return await processUtil.runClaudeSession(command, options.commandArgs || autopilotUtil.getClaudeArgs(roundOptions), prompt, {
            projectDir: runState.projectDir,
            processEnv: env,
            roundDeadline: roundDeadline,
            writeLog: writeLog,
            sessionStats: sessionStats,
            onProcessChange: (childProcess) => {
                loopState.activeProcess = childProcess;
            }
        });
    } finally {
        clearInterval(reportTimer);
    }
};

// 회차를 시작할 때마다 실행 중 변경 파일을 읽어 이번 회차의 model·effort를 정한다.
const getRoundOptions = (context) => {
    let savedOptions = {};

    try {
        savedOptions = autopilotUtil.readRoundOptions(context.runState.roundOptionsFile);
    } catch (error) {
        context.writeLog(`[설정] ${ROUND_OPTIONS_FILE_NAME}을 해석하지 못해 무시합니다: ${error.message}`);
    }

    return autopilotUtil.getRoundOptions(context.options, savedOptions);
};

// 사용량 한도 대기는 실패로 세지 않는다.
const updateRoundCounters = (context, loopState, { isFailed, isRateLimited, previousHead }) => {
    if (isFailed) {
        if (!isRateLimited) {
            loopState.failureCount++;
        }

        return;
    }

    loopState.failureCount = 0;
    loopState.idleCount = gitUtil.hasWorkChanges(context.runState.runGitCommand, previousHead) ? 0 : loopState.idleCount + 1;
};

// 매 회차를 시작할 때 진행 기록 줄 수를 확인해 상한을 넘었으면 원본을 보관하고 정리를 지시한다. 하루 동안 문서가 계속 커지는 것을 막는다.
// 정리 지시가 실패한 회차에서는 같은 지시를 이어가고, 지시했는데도 다음 회차에 여전히 넘으면 남겨야 할 정보가 많은 것으로 보고
// 줄 수가 상한 아래로 내려갈 때까지 다시 지시하지 않는다(회차마다 정리만 반복하지 않도록).
const getProgressCleanupPrompt = (context) => {
    const { runState, writeLog } = context;

    if (context.progressCleanupPrompt) {
        return context.progressCleanupPrompt;
    }

    const lineCount = progressUtil.countProgressLines(runState.progressFile);

    if (lineCount <= PROGRESS_MAX_LINES) {
        context.isCleanupSkipped = false;
    } else if (context.isCleanupRequested && !context.isCleanupSkipped) {
        context.isCleanupSkipped = true;

        writeLog(`[진행 기록] 정리를 지시했지만 ${lineCount}줄이라, ${PROGRESS_MAX_LINES}줄 아래로 내려갈 때까지 다시 지시하지 않습니다.`);
    }

    context.isCleanupRequested = false;

    if (lineCount > PROGRESS_MAX_LINES && !context.isCleanupSkipped) {
        context.progressCleanupPrompt = progressUtil.archiveProgressRecord(runState.progressFile, runState.progressDir, runState.runDate, writeLog);
        context.isCleanupRequested = Boolean(context.progressCleanupPrompt);
    }

    return context.progressCleanupPrompt;
};

const runRound = async (context, loopState, remainingMinutes) => {
    const { runConfig, runState, writeLog, recordedCommitHashes } = context;
    const progressCleanupPrompt = getProgressCleanupPrompt(context);
    const round = runState.rounds.length + 1;
    const roundStart = new Date();
    const previousHead = gitUtil.getHeadHash(runState.runGitCommand);
    const roundDeadline = Math.min(+runState.deadline, Date.now() + runConfig.maxRoundMinutes * MINUTE_MS);
    const sessionStats = { limitHit: false, isError: false };
    const prompt = promptUtil.getRoundPrompt(runState, round, Math.floor(remainingMinutes), progressCleanupPrompt, runConfig.maxTasks);
    const roundOptions = getRoundOptions(context);

    writeLog(`[${round}회차] 시작 - 남은 시간 ${Math.floor(remainingMinutes)}분 (model ${roundOptions.model}, effort ${roundOptions.effort})`);

    const sessionResult = await executeSession(context, loopState, { round: round, prompt: prompt, roundDeadline: roundDeadline, sessionStats: sessionStats, roundOptions: roundOptions });
    const isFailed = sessionResult.exitCode !== EXIT_CODE_SUCCESS || sessionStats.isError;
    const isRateLimited = !loopState.isInterrupted && !sessionResult.timedOut && sessionStats.limitHit && isFailed && sessionStats.resetAt > Date.now();

    updateRoundCounters(context, loopState, { isFailed: isFailed, isRateLimited: isRateLimited, previousHead: previousHead });

    // 정리 지시는 성공한 회차에서 끝난다. 다음 회차는 줄 수를 다시 확인해 필요할 때만 지시한다.
    if (!isFailed) {
        context.progressCleanupPrompt = "";
    }

    const commits = gitUtil.collectNewCommits(runState.runGitCommand, roundStart, recordedCommitHashes);
    const outcome = autopilotUtil.getRoundOutcome({
        isInterrupted: loopState.isInterrupted,
        isRateLimited: isRateLimited,
        timedOut: sessionResult.timedOut,
        isFailed: isFailed,
        exitCode: sessionResult.exitCode,
        isError: sessionStats.isError,
        idleCount: loopState.idleCount
    });

    runState.rounds.push({
        round: round,
        start: roundStart,
        model: roundOptions.model,
        effort: roundOptions.effort,
        minutes: dateUtil.getMinutesFromMs(Date.now() - roundStart),
        ...sessionStats,
        ...sessionResult,
        commits: commits,
        outcome: outcome
    });

    writeLog(`[${round}회차] ${outcome}`);

    return { round: round, isFailed: isFailed, isRateLimited: isRateLimited, resetAt: sessionStats.resetAt };
};

// 중단해야 하면 true를 반환한다. 한도 리셋이 종료 시각 이후면 기다리지 않고 끝낸다.
const waitForRateLimitReset = async (context, loopState, resetAt) => {
    const { runConfig, runState, writeLog } = context;
    const resumeAt = resetAt + runConfig.resetGraceMs;

    if (runState.deadline - resumeAt < runConfig.minMinutes * MINUTE_MS) {
        loopState.reason = "사용량 한도 리셋이 종료 시각 이후";

        return true;
    }

    const resumeTime = dateUtil.getTimeString(new Date(resumeAt));

    writeLog(`[사용량 한도] ${resumeTime}까지 대기 (실패로 세지 않음)`);
    reportUtil.writeRunReport(runState, `사용량 한도 - ${resumeTime} 재시도`, true);

    await waitUntil(context, loopState, resumeAt);

    return false;
};

// 중단해야 하면 true를 반환한다. 대기 후 작업 시간이 부족하면 이유 없이 끝낸다.
const waitForRetry = async (context, loopState, round) => {
    const { runConfig, runState, writeLog } = context;
    const retryWaitMs = runConfig.retryWaitMinutes[loopState.failureCount - 1] * MINUTE_MS;

    if (runState.deadline - Date.now() - retryWaitMs < runConfig.minMinutes * MINUTE_MS) {
        return true;
    }

    writeLog(`[${round}회차] ${retryWaitMs / MINUTE_MS}분 후 재시도`);
    reportUtil.writeRunReport(runState, `${round}회차 실패 - 재시도 대기`, true, true);

    await waitUntil(context, loopState, Date.now() + retryWaitMs);

    return false;
};

// 회차 결과에 따라 종료·대기를 결정한다. 실행을 끝내야 하면 true를 반환한다.
const handleRoundResult = async (context, loopState, roundResult) => {
    const { runConfig, runState, todoDoneFile } = context;

    if (isStopRequested(context, loopState)) {
        loopState.reason = STOP_REASON_REQUESTED;

        return true;
    }

    if (!roundResult.isFailed && runState.policy === POLICY_TODO && fs.existsSync(todoDoneFile)) {
        loopState.reason = "지시개선 정책: 예약 작업 완료";
        loopState.isWorkComplete = true;

        return true;
    }

    if (roundResult.isRateLimited) {
        return await waitForRateLimitReset(context, loopState, roundResult.resetAt);
    }

    if (loopState.idleCount >= runConfig.maxIdleRounds) {
        loopState.reason = `${runConfig.maxIdleRounds}회차 연속 새 commit 없음`;
        loopState.isWorkComplete = true;

        return true;
    }

    if (loopState.failureCount > runConfig.retryWaitMinutes.length) {
        loopState.isAborted = true;
        loopState.reason = `연속 ${loopState.failureCount}회 실패로 중단`;

        return true;
    }

    if (loopState.failureCount) {
        return await waitForRetry(context, loopState, roundResult.round);
    }

    return false;
};

const runRoundLoop = async (context, loopState) => {
    const { runConfig, runState } = context;

    while (runState.rounds.length < runConfig.maxRounds) {
        if (isStopRequested(context, loopState)) {
            loopState.reason = STOP_REASON_REQUESTED;

            break;
        }

        const remainingMinutes = (runState.deadline - Date.now()) / MINUTE_MS;

        if (remainingMinutes < runConfig.minMinutes) {
            break;
        }

        const roundResult = await runRound(context, loopState, remainingMinutes);

        if (await handleRoundResult(context, loopState, roundResult)) {
            break;
        }
    }

    if (!loopState.reason) {
        loopState.reason = runState.rounds.length >= runConfig.maxRounds ? `회차 상한 ${runConfig.maxRounds}회 도달` : "예정 시각 도달";
    }
};

// 작업이 모두 끝난 실행은 이어갈 내용이 없으므로 진행 기록을 보관하고 초기화한다. 시각 도달·회차 상한·실패·중단은 이어가도록 그대로 둔다.
const resetProgressIfComplete = (context, loopState) => {
    const { runState, writeLog } = context;

    if (!loopState.isWorkComplete || loopState.isAborted || loopState.isInterrupted) {
        return;
    }

    progressUtil.resetProgressRecord(runState.progressFile, runState.progressDir, runState.runDate, writeLog);
};

const finishRun = (context, loopState) => {
    const { runState, writeLog } = context;
    const { reason, isAborted, isInterrupted } = loopState;

    resetProgressIfComplete(context, loopState);

    writeLog(`AutoPilot 종료 - ${reason} (${runState.rounds.length}회차)`);
    writeLog(gitUtil.getRecentLog(runState.runGitCommand));
    writeLog(gitUtil.getStatus(runState.runGitCommand));

    reportUtil.writeRunReport(runState, reason, false, isAborted);

    return { ...runState, reason: reason, exitCode: autopilotUtil.getExitCode(isAborted, isInterrupted) };
};

const runLockedAutopilot = async (options) => {
    const context = prepareRun(options);
    const loopState = createLoopState();
    const unregisterInterruptHandlers = registerInterruptHandlers(context, loopState);

    try {
        reportUtil.writeRunReport(context.runState, "시작 중", true);

        if (options.open !== false) {
            processUtil.openFile(context.runState.reportFile);
        }

        await runRoundLoop(context, loopState);
    } catch (error) {
        loopState.isAborted = true;
        loopState.reason = `실행 오류: ${error.message}`;

        processUtil.killProcessTree(loopState.activeProcess);
    } finally {
        unregisterInterruptHandlers();
    }

    return finishRun(context, loopState);
};

// 같은 프로젝트의 동시 실행을 막는다. 잠금을 얻기 전에는 STOP·완료 신호 같은 실행 상태를 건드리지 않는다.
const executeAutopilot = async (options) => {
    const { workDir } = getProjectPaths(options);

    autopilotUtil.ensureWorkDir(workDir);

    const releaseRunLock = autopilotUtil.acquireRunLock(autopilotUtil.getLockFile(workDir));

    try {
        return await runLockedAutopilot(options);
    } finally {
        releaseRunLock();
    }
};

const runAutopilot = async (options = {}) => {
    try {
        const runData = await executeAutopilot(options);

        if (runData.exitCode !== EXIT_CODE_SUCCESS) {
            log.error(runData.reason);

            return { status: STATUS_FAILED, data: runData, error: { code: ERROR_CODE_AUTOPILOT_FAILED, msg: runData.reason } };
        }

        return { status: STATUS_OK, data: runData };
    } catch (error) {
        log.error(util.formatError(error));

        return { status: STATUS_FAILED, error: { code: error.code || ERROR_CODE_AUTOPILOT_ERROR, msg: error.message || String(error) } };
    }
};

// 현재 회차가 끝난 뒤 종료하도록 STOP 파일을 만든다.
const requestStop = (options = {}) => {
    try {
        const { workDir } = getProjectPaths(options);
        const stopFile = autopilotUtil.getStopFile(workDir);

        autopilotUtil.ensureWorkDir(workDir);
        fs.mkdirSync(path.dirname(stopFile), { recursive: true });
        fs.writeFileSync(stopFile, "");

        return { status: STATUS_OK, data: { stopFile: stopFile } };
    } catch (error) {
        log.error(util.formatError(error));

        return { status: STATUS_FAILED, error: { code: error.code || ERROR_CODE_AUTOPILOT_ERROR, msg: error.message || String(error) } };
    }
};

// 실행 중인 AutoPilot이 다음 회차부터 쓸 model·effort를 기록한다. 진행 중인 회차에는 영향이 없다.
const requestRoundOptions = (roundOptions, options = {}) => {
    try {
        const { workDir } = getProjectPaths(options);

        if (!autopilotUtil.isRunLockActive(autopilotUtil.getLockFile(workDir))) {
            throw new Error("실행 중인 AutoPilot이 없습니다.");
        }

        const savedOptions = autopilotUtil.writeRoundOptions(autopilotUtil.getRoundOptionsFile(workDir), roundOptions);

        return { status: STATUS_OK, data: { roundOptions: savedOptions } };
    } catch (error) {
        log.error(util.formatError(error));

        return { status: STATUS_FAILED, error: { code: error.code || ERROR_CODE_AUTOPILOT_ERROR, msg: error.message || String(error) } };
    }
};

// 앱이 연결 여부를 판단하도록 실행 중인지와 pid·로그 파일을 알려준다.
const getRunStatus = (options = {}) => {
    try {
        const { workDir } = getProjectPaths(options);

        return { status: STATUS_OK, data: autopilotUtil.getRunStatus(autopilotUtil.getLockFile(workDir)) };
    } catch (error) {
        log.error(util.formatError(error));

        return { status: STATUS_FAILED, error: { code: error.code || ERROR_CODE_AUTOPILOT_ERROR, msg: error.message || String(error) } };
    }
};

// 진행 기록을 지금 보관하고 초기화한다. 실행 중에는 세션이 문서를 쓰고 있으므로 거부한다.
const requestProgressReset = (options = {}) => {
    try {
        const { projectDir, workDir } = getProjectPaths(options);

        if (autopilotUtil.isRunLockActive(autopilotUtil.getLockFile(workDir))) {
            throw new Error("실행 중인 AutoPilot이 있어 진행 기록을 초기화할 수 없습니다.");
        }

        autopilotUtil.ensureWorkDir(workDir);

        const runDate = dateUtil.getDateString(new Date());
        const failureMessages = [];
        const progressDir = path.join(workDir, PROGRESS_DIR_NAME, runDate);
        const resetResult = progressUtil.resetProgressRecord(autopilotUtil.getProgressFile(projectDir, options.dataDir), progressDir, runDate, (message) => failureMessages.push(message));

        if (!resetResult.isDone) {
            throw new Error(failureMessages.at(-1) || "진행 기록을 초기화하지 못했습니다.");
        }

        return { status: STATUS_OK, data: { isReset: Boolean(resetResult.archivePath), archivePath: resetResult.archivePath } };
    } catch (error) {
        log.error(util.formatError(error));

        return { status: STATUS_FAILED, error: { code: error.code || ERROR_CODE_AUTOPILOT_ERROR, msg: error.message || String(error) } };
    }
};

export { runAutopilot, requestStop, requestRoundOptions, getRunStatus, requestProgressReset };

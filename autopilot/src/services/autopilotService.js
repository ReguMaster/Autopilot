import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
    STATUS_OK,
    STATUS_FAILED,
    ERROR_CODE_AUTOPILOT_FAILED,
    ERROR_CODE_AUTOPILOT_ERROR,
    SECOND_MS,
    MINUTE_MS,
    DAY_MS,
    WAIT_POLL_MS,
    REPORT_REFRESH_MS,
    EXIT_CODE_SUCCESS,
    POLICY_TODO,
    MODE_MAINTAIN,
    MODE_BUILD,
    BUILD_PHASES,
    PHASE_DONE,
    PHASE_LABELS,
    DEFAULT_DESIGN_FORMAT,
    DEFAULT_QA_ON_FAIL,
    DEFAULT_SECURITY_ON_FAIL,
    BRAINSTORM_PROVIDERS,
    PROVIDER_CLAUDE,
    PROVIDER_LABELS,
    PROVIDER_TIMEOUT_MINUTES,
    DEBATE_MAX_TURNS,
    DEBATE_TURN_MINUTES,
    WORK_DIR_NAME,
    PROGRESS_DIR_NAME,
    TODO_COMPLETE_FILE_NAME,
    PHASE_DONE_FILE_NAME,
    STOP_REASON_REQUESTED,
    ROUND_OPTIONS_FILE_NAME,
    PROGRESS_MAX_LINES,
    OPTIONAL_CLAUDE_FLAGS,
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
import phaseUtil from "../utils/phaseUtil.js";
import providerUtil from "../utils/providerUtil.js";
import debateUtil from "../utils/debateUtil.js";

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
        ...(runState.mode === MODE_BUILD ? [`Mode : 신규 개발 (${PHASE_LABELS[runState.phase]} 단계부터)`] : []),
        `Log : ${runState.logFile}`,
        `Report : ${runState.reportFile}`,
        ...runState.repos.filter((repo) => repo.isLinked).map((repo) => `Linked : ${repo.name} (${repo.dir})`)
    ];

    for (const headerLine of headerLines) {
        writeLog(headerLine);
    }
};

const getProjectPaths = (options) => {
    const projectDir = autopilotUtil.getProjectDir(options.projectDir);

    return { projectDir: projectDir, workDir: autopilotUtil.getWorkDir(projectDir) };
};

// 신규 개발의 단계 상태와 인자를 정한다. 유지 보수 실행이면 mode만 돌려준다.
const getModeSettings = (options, progressFile, tasks) => {
    const mode = options.mode || MODE_MAINTAIN;

    if (mode !== MODE_BUILD) {
        return { mode: mode };
    }

    const phaseFile = phaseUtil.getPhaseFile(progressFile);
    const { state, isRevision } = phaseUtil.getStartPhase(phaseUtil.readPhase(phaseFile));

    if (state.phase === PHASE_DONE) {
        throw new Error("신규 개발의 모든 단계를 이미 마쳤습니다. 진행 기록을 초기화하면 기획부터 다시 시작합니다.");
    }

    if (state.phase === BUILD_PHASES[0] && !tasks) {
        throw new Error("신규 개발에는 만들 것이 필요합니다.");
    }

    const allow = options.allow || [];
    const brainstorm = options.brainstorm || [];
    // 다른 AI에게 프로젝트 내용을 보내므로 외부 서비스로 보내기를 허용했을 때만 쓴다.
    const canSend = allow.includes("send");
    const requestedDesignFormat = options.designFormat || DEFAULT_DESIGN_FORMAT;
    // 외부 도구가 필요한 산출물인데 보내기를 허용하지 않았으면 HTML 와이어프레임으로 만든다.
    const isBlockedDesign = ["figma", "image"].includes(requestedDesignFormat) && !allow.includes("send");

    return {
        mode: mode,
        phaseFile: phaseFile,
        phase: state.phase,
        qaRetries: state.qaRetries,
        securityRetries: state.securityRetries,
        isRevision: isRevision,
        gates: options.gates || [],
        allow: allow,
        designFormat: isBlockedDesign ? "html" : requestedDesignFormat,
        requestedDesignFormat: requestedDesignFormat,
        maxQaRetries: options.maxQaRetries ?? phaseUtil.parseOnFail(DEFAULT_QA_ON_FAIL),
        maxSecurityRetries: options.maxSecurityRetries ?? phaseUtil.parseOnFail(DEFAULT_SECURITY_ON_FAIL),
        brainstorm: brainstorm,
        brainstormWith: brainstorm.length && canSend ? options.brainstormWith || BRAINSTORM_PROVIDERS : [],
        isBrainstormBlocked: brainstorm.length > 0 && !canSend,
        crossReview: Boolean(options.crossReview),
        debate: options.debate || [],
        proposals: state.proposals,
        debateState: state.debate
    };
};

// PHASE.json에 쓸 지금 단계 상태. 확인 대기와 고른 안은 단계를 마치거나 확정할 때만 정한다.
const getPhaseState = (runState) => {
    return { phase: runState.phase, awaiting: null, qaRetries: runState.qaRetries, securityRetries: runState.securityRetries, proposals: null, debate: null };
};

// 사용자가 고른 안이 있으면 이번 실행의 첫 회차가 정식 산출물로 확정한다. 디자인은 HTML로 받았을 수 있다.
// 협의한 단계면 쟁점마다 고른 쪽의 입장(choices)을 합의안에 확정한다. 쟁점이 없었으면 choices가 비어 있다.
const getAdoption = (projectDir, proposals, debate) => {
    if (debate?.resolved) {
        return {
            phase: debate.phase,
            choices: debate.disputes.map((dispute) => ({ title: dispute.title, side: debate.resolved[dispute.id], position: dispute[debate.resolved[dispute.id]] }))
        };
    }

    if (!proposals?.picked) {
        return null;
    }

    const htmlFile = phaseUtil.getProposalPath(proposals.phase, proposals.picked, true);

    return { phase: proposals.phase, picked: proposals.picked, file: fs.existsSync(path.join(projectDir, htmlFile)) ? htmlFile : phaseUtil.getProposalPath(proposals.phase, proposals.picked) };
};

// 이어서 하는 단계면 이미 받아 둔 다른 AI의 안을 그대로 쓴다. 돌려보낸 단계면 다시 받는다.
const getReadyProposals = (projectDir, modeSettings) => {
    const readyProposals = {};

    if (modeSettings.isRevision || !modeSettings.brainstorm?.includes(modeSettings.phase)) {
        return readyProposals;
    }

    for (const provider of modeSettings.brainstormWith) {
        const file = [true, false].map((isHtml) => phaseUtil.getProposalPath(modeSettings.phase, provider, isHtml)).find((relPath) => fs.existsSync(path.join(projectDir, relPath)));

        if (file) {
            readyProposals[provider] = file;
        }
    }

    return readyProposals;
};

// 실행 전 검증과 폴더·로그 준비를 마치고 회차 실행에 필요한 값을 모아 반환한다.
const prepareRun = (options) => {
    const runConfig = { ...AUTOPILOT_DEFAULTS, ...(options.logRetentionDays && { logRetentionDays: options.logRetentionDays }), ...options.limits };
    const { projectDir, workDir } = getProjectPaths(options);
    const env = autopilotUtil.getRunEnv(options);
    const gitExecutable = processUtil.getExecutablePath("git", env);
    const linkedRepos = autopilotUtil.getLinkedRepos(options.linkedProjectDirs, projectDir);
    const repos = [{ name: path.basename(projectDir), dir: projectDir, isLinked: false }, ...linkedRepos.map((repo) => ({ ...repo, isLinked: true }))].map((repo) => {
        const runGitCommand = gitUtil.createGitRunner(gitExecutable, repo.dir, env);

        gitUtil.assertGitProject(runGitCommand, repo.dir);

        return { ...repo, runGitCommand: runGitCommand };
    });
    const runGitCommand = repos[0].runGitCommand;
    const command = options.command || processUtil.getExecutablePath("claude", env);
    const runStart = new Date();
    const runDate = dateUtil.getDateString(runStart);
    const tasks = (options.tasks || "").trim();
    const runSettings = { ...settingsUtil.getRunSettings(options.endTime, options.policy, runStart), ...settingsUtil.getGitSettings(options.commitPrefix, options.workBranch) };

    const progressFile = autopilotUtil.getProgressFile(projectDir, options.dataDir);
    const modeSettings = getModeSettings(options, progressFile, tasks);

    if (modeSettings.mode !== MODE_BUILD && runSettings.policy === POLICY_TODO && !tasks) {
        throw new Error("지시개선 정책에는 처리할 작업이 필요합니다.");
    }

    // 여러 날 실행은 하루마다 회차 상한만큼 더 돌 수 있다. 검증의 limits가 정한 상한은 그대로 둔다.
    if (options.limits?.maxRounds === undefined) {
        runConfig.maxRounds = AUTOPILOT_DEFAULTS.maxRounds * Math.ceil((runSettings.deadline - runStart) / DAY_MS);
    }

    const progressDir = path.join(workDir, PROGRESS_DIR_NAME, runDate);
    const runId = `${dateUtil.getTimeString(runStart).replace(/:/g, "")}_${randomUUID().slice(0, 8)}`;

    fs.mkdirSync(progressDir, { recursive: true });
    progressUtil.ensureProgressRecord(progressFile);

    // 돌려보낸 단계를 다시 시작했으면 확인 대기를 바로 지워 다음 실행이 같은 상태를 보게 한다.
    if (modeSettings.isRevision) {
        phaseUtil.writePhase(modeSettings.phaseFile, getPhaseState(modeSettings));
    }

    const runState = {
        ...runSettings,
        ...modeSettings,
        workDir: workDir,
        projectDir: projectDir,
        tasks: tasks,
        progressFile: progressFile,
        runStart: runStart,
        runDate: runDate,
        progressDir: progressDir,
        runGitCommand: runGitCommand,
        repos: repos,
        rounds: [],
        stopFile: autopilotUtil.getStopFile(workDir),
        roundOptionsFile: autopilotUtil.getRoundOptionsFile(workDir),
        logFile: path.join(progressDir, `autopilot_${runId}.log`),
        reportFile: path.join(progressDir, `report_${runId}.html`),
        todoDoneRelPath: `${WORK_DIR_NAME}/${PROGRESS_DIR_NAME}/${runDate}/${TODO_COMPLETE_FILE_NAME}`,
        phaseDoneRelPath: `${WORK_DIR_NAME}/${PROGRESS_DIR_NAME}/${runDate}/${PHASE_DONE_FILE_NAME}`
    };
    const readyProposals = modeSettings.mode === MODE_BUILD ? getReadyProposals(projectDir, modeSettings) : {};

    runState.adoption = modeSettings.mode === MODE_BUILD ? getAdoption(projectDir, modeSettings.proposals, modeSettings.debateState) : null;
    runState.debateStage = null;
    runState.proposalReady = readyProposals;
    runState.proposalPhase = Object.keys(readyProposals).length ? modeSettings.phase : null;

    const todoDoneFile = path.join(projectDir, runState.todoDoneRelPath);
    const phaseDoneFile = path.join(projectDir, runState.phaseDoneRelPath);
    const writeLog = log.createFileLogger(runState.logFile);

    // 앱이 실행 중인 엔진에 다시 연결할 수 있도록 로그 파일 위치를 잠금에 남긴다. 실패해도 실행에는 영향이 없다.
    try {
        autopilotUtil.writeRunLockLogFile(autopilotUtil.getLockFile(workDir), runState.logFile);
    } catch (error) {
        writeLog(`[설정] 잠금에 로그 위치를 기록하지 못했습니다: ${error.message}`);
    }

    // 이전 실행의 완료·중단 신호와 model·effort 변경이 이번 실행에 영향을 주지 않도록 지운다.
    fileUtil.removeFiles([todoDoneFile, phaseDoneFile, runState.stopFile, runState.roundOptionsFile]);

    const context = {
        options: options,
        runConfig: runConfig,
        env: env,
        command: command,
        runState: runState,
        todoDoneFile: todoDoneFile,
        phaseDoneFile: phaseDoneFile,
        writeLog: writeLog,
        unsupportedFlags: [],
        providerChecks: {},
        progressCleanupPrompt: "",
        isCleanupRequested: false,
        isCleanupSkipped: false,
        recordedCommitHashes: new Map(repos.map((repo) => [repo.dir, new Set(gitUtil.getCommitHashesSince(repo.runGitCommand, runStart))]))
    };

    writeRunHeader(context);

    if (linkedRepos.length) {
        writeLog(`[설정] 연결 저장소 ${linkedRepos.length}개: ${linkedRepos.map((repo) => repo.name).join(", ")}`);
    }

    progressUtil.pruneRunFiles(path.join(workDir, PROGRESS_DIR_NAME), runDate, runConfig.logRetentionDays, writeLog);

    return context;
};

const createLoopState = () => {
    return { activeProcess: null, isInterrupted: false, isAborted: false, isWorkComplete: false, failureCount: 0, idleCount: 0, extendedMs: 0, reason: "" };
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
        return await processUtil.runClaudeSession(
            command,
            options.commandArgs ||
                autopilotUtil.getClaudeArgs({ ...roundOptions, unsupportedFlags: context.unsupportedFlags, addDirs: runState.repos.filter((repo) => repo.isLinked).map((repo) => repo.dir) }),
            prompt,
            {
                projectDir: runState.projectDir,
                processEnv: env,
                roundDeadline: roundDeadline,
                writeLog: writeLog,
                sessionStats: sessionStats,
                onProcessChange: (childProcess) => {
                    loopState.activeProcess = childProcess;
                }
            }
        );
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
const updateRoundCounters = (context, loopState, { isFailed, isRateLimited, previousHeads }) => {
    if (isFailed) {
        if (!isRateLimited) {
            loopState.failureCount++;
        }

        return;
    }

    loopState.failureCount = 0;
    loopState.idleCount = context.runState.repos.some((repo, index) => gitUtil.hasWorkChanges(repo.runGitCommand, previousHeads[index])) ? 0 : loopState.idleCount + 1;
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

// 연결 저장소의 commit은 제목 앞에 저장소 이름을 붙여 어느 저장소의 것인지 로그와 리포트에서 알아보게 한다.
const collectRoundCommits = (runState, roundStart, recordedCommitHashes) => {
    return runState.repos.flatMap((repo) => {
        const commits = gitUtil.collectNewCommits(repo.runGitCommand, roundStart, recordedCommitHashes.get(repo.dir));

        return repo.isLinked ? commits.map((commit) => ({ ...commit, subject: `${repo.name}: ${commit.subject}` })) : commits;
    });
};

const runRound = async (context, loopState, remainingMinutes) => {
    const { runConfig, runState, writeLog, recordedCommitHashes } = context;
    const progressCleanupPrompt = getProgressCleanupPrompt(context);
    const round = runState.rounds.length + 1;
    const roundStart = new Date();
    const previousHeads = runState.repos.map((repo) => gitUtil.getHeadHash(repo.runGitCommand));
    const roundDeadline = Math.min(+runState.deadline, Date.now() + runConfig.maxRoundMinutes * MINUTE_MS);
    const sessionStats = { limitHit: false, isError: false };
    const prompt = promptUtil.getRoundPrompt(runState, round, Math.floor(remainingMinutes), progressCleanupPrompt, runConfig.maxTasks);
    const roundOptions = getRoundOptions(context);

    writeLog(`[${round}회차] 시작 - 남은 시간 ${Math.floor(remainingMinutes)}분 (model ${roundOptions.model}, effort ${roundOptions.effort})`);

    const sessionResult = await executeSession(context, loopState, { round: round, prompt: prompt, roundDeadline: roundDeadline, sessionStats: sessionStats, roundOptions: roundOptions });
    const isFailed = sessionResult.exitCode !== EXIT_CODE_SUCCESS || sessionStats.isError;
    const isRateLimited = !loopState.isInterrupted && !sessionResult.timedOut && sessionStats.limitHit && isFailed && sessionStats.resetAt > Date.now();

    updateRoundCounters(context, loopState, { isFailed: isFailed, isRateLimited: isRateLimited, previousHeads: previousHeads });

    // 정리 지시는 성공한 회차에서 끝난다. 다음 회차는 줄 수를 다시 확인해 필요할 때만 지시한다.
    if (!isFailed) {
        context.progressCleanupPrompt = "";
    }

    const commits = collectRoundCommits(runState, roundStart, recordedCommitHashes);
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

    // 앱은 회차 결과 줄보다 먼저 온 커밋 줄을 그 회차에 붙인다.
    for (const commit of commits) {
        writeLog(`[커밋] ${commit.hash} +${commit.insertions} -${commit.deletions} ${commit.subject}`);
    }

    writeLog(`[${round}회차] ${outcome}`);

    return { round: round, isFailed: isFailed, isRateLimited: isRateLimited, resetAt: sessionStats.resetAt };
};

// 중단해야 하면 true를 반환한다. 한도 리셋이 종료 시각 이후면 기다리지 않고 끝낸다.
// extendOnLimit이면 기다린 만큼 종료 시각을 늦춰 대기 전 남은 시간이 그대로 남는다. 로그 시각이 초 단위라 연장분은 올림한다.
// maxExtendMinutes가 있으면 한 실행에서 늘릴 수 있는 총량이 그만큼으로 묶이고, 남은 상한보다 더 필요하면 남은 만큼만 늘린다.
const waitForRateLimitReset = async (context, loopState, resetAt) => {
    const { options, runConfig, runState, writeLog } = context;
    const resumeAt = resetAt + runConfig.resetGraceMs;
    const wantedMs = options.extendOnLimit ? Math.ceil(Math.max(0, resumeAt - Date.now()) / SECOND_MS) * SECOND_MS : 0;
    const capMs = options.maxExtendMinutes ? options.maxExtendMinutes * MINUTE_MS : Infinity;
    const extensionMs = Math.min(wantedMs, Math.max(0, capMs - loopState.extendedMs));
    const isCapped = extensionMs < wantedMs;

    if (+runState.deadline + extensionMs - resumeAt < runConfig.minMinutes * MINUTE_MS) {
        loopState.reason = isCapped ? "사용량 한도 연장 상한 도달" : extensionMs ? "사용량 한도 대기 전 남은 시간 부족" : "사용량 한도 리셋이 종료 시각 이후";

        return true;
    }

    const resumeTime = dateUtil.getTimeString(new Date(resumeAt));

    if (extensionMs) {
        runState.deadline = new Date(+runState.deadline + extensionMs);
        loopState.extendedMs += extensionMs;

        writeLog(`[사용량 한도] 종료 시각 연장 ${dateUtil.getDatetimeString(runState.deadline)} (+${Math.ceil(extensionMs / MINUTE_MS)}분)`);
    }

    if (isCapped) {
        writeLog(`[사용량 한도] 연장 상한 ${options.maxExtendMinutes}분에 도달해 종료 시각을 더 늘리지 않습니다`);
    }

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

// 다른 AI에게 묻고 답을 돌려준다. 못 쓰거나 실패하면 이유를 로그로 남기고 null이다(회차 실패로 세지 않는다).
const askProvider = async (context, loopState, provider, prompt, subject) => {
    const { options, env, runConfig, runState, writeLog } = context;
    const label = PROVIDER_LABELS[provider];

    context.providerChecks[provider] ??= await providerUtil.checkProvider(provider, { cwd: runState.projectDir, processEnv: env, override: options.providerCommands?.[provider] });

    const ready = context.providerChecks[provider];

    if (ready.error) {
        writeLog(`[브레인스토밍] ${label} ${subject} 건너뜀: ${ready.error}`);

        return null;
    }

    writeLog(`[브레인스토밍] ${label} ${subject} 받는 중`);

    const answer = await providerUtil.askProvider(provider, ready, prompt, {
        cwd: runState.projectDir,
        processEnv: env,
        deadline: Math.min(+runState.deadline, Date.now() + Math.min(runConfig.maxRoundMinutes, PROVIDER_TIMEOUT_MINUTES) * MINUTE_MS),
        shouldStop: () => isStopRequested(context, loopState),
        onProcessChange: (childProcess) => {
            loopState.activeProcess = childProcess;
        }
    });

    if (answer.error) {
        writeLog(`[브레인스토밍] ${label} ${subject} 건너뜀: ${answer.error}`);

        return null;
    }

    writeLog(`[브레인스토밍] ${label} ${subject} 받음`);

    return answer.text;
};

const writeProposalFile = (projectDir, relPath, text) => {
    const file = path.join(projectDir, relPath);

    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${text}\n`, "utf8");
};

// 브레인스토밍 단계를 시작할 때 다른 AI의 독립된 안을 받아 docs/autopilot/proposals/에 둔다. 단계마다 한 번만 받는다.
const requestProposals = async (context, loopState) => {
    const { runState } = context;
    const phase = runState.phase;

    if (runState.mode !== MODE_BUILD || !runState.brainstorm.includes(phase) || runState.proposalPhase === phase) {
        return;
    }

    runState.proposalPhase = phase;
    runState.proposalReady = {};

    for (const provider of runState.brainstormWith) {
        const relPath = phaseUtil.getProposalPath(phase, provider, phase === "design" && runState.designFormat === "html");
        const proposal = await askProvider(context, loopState, provider, promptUtil.getProposalPrompt(runState), `${PHASE_LABELS[phase]} 안`);

        if (proposal) {
            writeProposalFile(runState.projectDir, relPath, proposal);
            runState.proposalReady[provider] = relPath;
        }
    }
};

// 협의할 때 Claude에게 보여 줄 Claude의 산출물. 디자인 폴더의 파일은 이름만 알린다.
const readPhaseArtefact = (projectDir, phase) => {
    if (phase === "plan") {
        return fileUtil.readTextFile(path.join(projectDir, "docs/autopilot/plan.md"));
    }

    const designDir = path.join(projectDir, "docs/autopilot/design");
    const designFiles = fs.existsSync(designDir) ? fs.readdirSync(designDir) : [];

    return [fileUtil.readTextFile(path.join(projectDir, "docs/autopilot/design.md")), designFiles.length ? `(docs/autopilot/design/ 파일: ${designFiles.join(", ")})` : ""]
        .filter(Boolean)
        .join("\n\n");
};

// 협의: Claude와 Codex가 각자 같은 대화를 이어 가며 최대 DEBATE_MAX_TURNS번 주고받는다. 한 번은 Claude가 말하고 Codex가 답하는 것이다.
// 둘 다 같은 번에 합의라고 하면 일찍 끝낸다. 어느 쪽이든 답을 못 받으면 null이고, 단계는 나란히 비교로 넘어간다(회차 실패로 세지 않는다).
const runDebate = async (context, loopState) => {
    const { options, env, runState, writeLog } = context;
    const { phase, projectDir } = runState;
    const codexFile = runState.proposalReady.codex;
    const roundOptions = getRoundOptions(context);
    const claude = {
        command: context.command,
        baseArgs: options.commandArgs || [],
        model: roundOptions.model,
        extraArgs: context.unsupportedFlags.includes("--effort") ? [] : ["--effort", "medium"],
        sessionId: null
    };
    const docs = { claudeDoc: readPhaseArtefact(projectDir, phase), codexDoc: fileUtil.readTextFile(path.join(projectDir, codexFile)) };
    const turns = [];
    let codexSessionId = null;

    const skip = (reason) => {
        writeLog(`[협의] 건너뜀: ${reason}`);

        return null;
    };

    const getCallOptions = () => ({
        cwd: projectDir,
        processEnv: env,
        deadline: Math.min(+runState.deadline, Date.now() + DEBATE_TURN_MINUTES * MINUTE_MS),
        shouldStop: () => isStopRequested(context, loopState),
        onProcessChange: (childProcess) => {
            loopState.activeProcess = childProcess;
        }
    });

    context.providerChecks.codex ??= await providerUtil.checkProvider("codex", { cwd: projectDir, processEnv: env, override: options.providerCommands?.codex });

    if (context.providerChecks.codex.error) {
        return skip(context.providerChecks.codex.error);
    }

    writeLog(`[협의] ${PHASE_LABELS[phase]} 시작 (최대 ${DEBATE_MAX_TURNS}번)`);

    for (let exchange = 1; exchange <= DEBATE_MAX_TURNS; exchange++) {
        const claudePrompt = exchange === 1 ? promptUtil.getDebateOpeningPrompt(runState, PROVIDER_CLAUDE, docs) : promptUtil.getDebateReplyPrompt(turns.at(-1), exchange);
        const claudeAnswer = await providerUtil.askClaude(claude, claudePrompt, getCallOptions());
        const claudeTurn = claudeAnswer.text ? debateUtil.parseTurn(claudeAnswer.text) : null;

        if (!claudeTurn || !(claudeAnswer.sessionId || claude.sessionId)) {
            return skip(`Claude 답을 받지 못했어요(${claudeAnswer.error || "형식이 맞지 않아요"})`);
        }

        claude.sessionId = claudeAnswer.sessionId || claude.sessionId;
        turns.push({ provider: PROVIDER_CLAUDE, ...claudeTurn });
        writeLog(`[협의] Claude: ${debateUtil.getLogText(claudeTurn.message)}`);

        // Codex의 세션 아이디를 못 찾으면 대화를 이을 수 없으므로 지금까지 주고받은 말을 다시 보낸다.
        const codexPrompt = codexSessionId
            ? promptUtil.getDebateReplyPrompt(turns.at(-1), exchange)
            : promptUtil.getDebateOpeningPrompt(runState, "codex", { lastTurn: turns.at(-1), transcript: turns.slice(0, -1) });
        const codexAnswer = await providerUtil.askProvider("codex", context.providerChecks.codex, codexPrompt, getCallOptions(), codexSessionId);
        const codexTurn = codexAnswer.text ? debateUtil.parseTurn(codexAnswer.text) : null;

        if (!codexTurn) {
            return skip(`Codex 답을 받지 못했어요(${codexAnswer.error || "형식이 맞지 않아요"})`);
        }

        codexSessionId = codexAnswer.sessionId || codexSessionId;
        turns.push({ provider: "codex", ...codexTurn });
        writeLog(`[협의] Codex: ${debateUtil.getLogText(codexTurn.message)}`);

        if (claudeTurn.consensus && codexTurn.consensus) {
            return { turns: turns, isConsensus: true };
        }
    }

    return { turns: turns, isConsensus: false };
};

// 협의 단계에서 Claude가 산출물을 마치면 협의를 하고, 다음 회차가 결과를 정리하게 한다. 정리 회차로 넘어가면 true다.
const startDebate = async (context, loopState) => {
    const { runState, phaseDoneFile } = context;
    const debate = await runDebate(context, loopState);

    if (!debate) {
        return false;
    }

    writeProposalFile(runState.projectDir, phaseUtil.getDebatePath(runState.phase), debateUtil.formatTranscript(PHASE_LABELS[runState.phase], debate.turns, debate.isConsensus));
    fileUtil.removeFiles([phaseDoneFile]);
    runState.debateStage = "synthesis";
    // 협의와 정리는 같은 단계의 일이라 정리 회차가 commit 없이 끝나도 idle로 몰지 않는다.
    loopState.idleCount = 0;

    return true;
};

// 세션이 남긴 단계 완료 신호로 다음 단계로 넘긴다. 확인 대기·모든 단계 완료·테스트/QA·보안검토 실패로 실행을 끝내야 하면 true를 반환한다.
// 다른 AI의 안을 받은 단계는 교차검토를 받고, 사용자가 안을 고르도록 멈춘다. 다른 AI의 검토는 다음 실행이 commit한다.
const applyPhaseDone = async (context, loopState) => {
    const { runState, phaseDoneFile, writeLog } = context;
    const result = fileUtil.readTextFile(phaseDoneFile).trim().split(/\r?\n/)[0].trim().toLowerCase();
    const phase = runState.phase;
    const label = PHASE_LABELS[phase];
    const maxRetries = { qa: runState.maxQaRetries, security: runState.maxSecurityRetries };
    const readyProviders = runState.brainstorm?.includes(phase) ? Object.keys(runState.proposalReady) : [];
    const isDebatePhase = Boolean(runState.debate?.includes(phase) && runState.proposalReady?.codex);

    if (isDebatePhase && runState.debateStage !== "synthesis" && (await startDebate(context, loopState))) {
        return false;
    }

    // 협의를 정리한 회차가 남긴 쟁점을 상태로 옮긴다. 사용자는 합의안을 확인하고 쟁점마다 한쪽을 고른다.
    const debateResult =
        runState.debateStage === "synthesis"
            ? { phase: phase, disputes: debateUtil.parseDisputes(fileUtil.readTextFile(path.join(runState.projectDir, phaseUtil.getDisputesPath(phase)))), resolved: null }
            : null;
    const candidates = !debateResult && readyProviders.length ? [PROVIDER_CLAUDE, ...readyProviders] : [];
    const reviewState = { ...runState };
    const { state, event } = phaseUtil.getPhaseTransition(getPhaseState(runState), result, runState.gates, maxRetries, candidates, debateResult);

    runState.debateStage = null;

    if (debateResult) {
        writeLog(debateResult.disputes.length ? `[협의] 쟁점 ${debateResult.disputes.length}개를 남기고 끝냈어요` : "[협의] 합의했어요");
    }

    fileUtil.removeFiles([phaseDoneFile]);
    phaseUtil.writePhase(runState.phaseFile, state);
    runState.phase = state.phase;
    runState.qaRetries = state.qaRetries;
    runState.securityRetries = state.securityRetries;
    runState.isRevision = false;

    if (event === "failed") {
        writeLog(`[단계] ${label} 실패`);
        loopState.reason = `${label} 실패`;

        return true;
    }

    // 단계가 바뀌면 앞 단계의 commit 없는 회차를 새 단계의 idle로 세지 않는다.
    loopState.idleCount = 0;

    if (event === "retry") {
        writeLog(`[단계] ${label} 실패 - 개발로 되돌림 (${state[phaseUtil.RETRY_KEYS[phase]]}/${maxRetries[phase]})`);
        writeLog(`[단계] ${PHASE_LABELS[state.phase]} 시작`);

        return false;
    }

    writeLog(`[단계] ${label} 완료`);

    if (event === "done") {
        loopState.reason = "신규 개발: 모든 단계 완료";
        loopState.isWorkComplete = true;

        return true;
    }

    if (event === "await") {
        // 교차검토: 다른 AI가 Claude의 산출물을 읽고 고칠 점을 낸다. 실패해도 고르는 데는 지장이 없다.
        for (const provider of runState.crossReview && !debateResult ? readyProviders : []) {
            const review = await askProvider(context, loopState, provider, promptUtil.getReviewPrompt(reviewState), `${label} 검토`);

            if (review) {
                writeProposalFile(runState.projectDir, phaseUtil.getReviewPath(phase, provider), review);
            }
        }

        writeLog(`[단계] ${label} 확인 대기`);
        loopState.reason = `${label} 확인 대기`;

        return true;
    }

    writeLog(`[단계] ${PHASE_LABELS[state.phase]} 시작`);

    return false;
};

// 회차 결과에 따라 종료·대기를 결정한다. 실행을 끝내야 하면 true를 반환한다.
const handleRoundResult = async (context, loopState, roundResult) => {
    const { runConfig, runState, todoDoneFile } = context;

    // 고른 안을 확정하는 일은 첫 회차가 성공하면 다 한 것으로 본다.
    if (!roundResult.isFailed && runState.adoption) {
        runState.adoption = null;
        phaseUtil.writePhase(runState.phaseFile, getPhaseState(runState));
    }

    // 중단 요청과 같은 회차에 단계를 마쳤어도 단계는 넘긴다. 안 그러면 다음 실행이 끝낸 단계를 다시 한다.
    if (!roundResult.isFailed && runState.mode === MODE_BUILD && fs.existsSync(context.phaseDoneFile) && (await applyPhaseDone(context, loopState))) {
        return true;
    }

    if (isStopRequested(context, loopState)) {
        loopState.reason = STOP_REASON_REQUESTED;

        return true;
    }

    if (!roundResult.isFailed && runState.mode !== MODE_BUILD && runState.policy === POLICY_TODO && fs.existsSync(todoDoneFile)) {
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
        await requestProposals(context, loopState);

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
    for (const repo of runState.repos) {
        if (repo.isLinked) {
            writeLog(`연결 저장소 ${repo.name}`);
        }

        writeLog(gitUtil.getRecentLog(repo.runGitCommand));
        writeLog(gitUtil.getStatus(repo.runGitCommand));
    }

    reportUtil.writeRunReport(runState, reason, false, isAborted);

    return { ...runState, reason: reason, exitCode: autopilotUtil.getExitCode(isAborted, isInterrupted) };
};

// 설치된 Claude Code가 모르는 선택 옵션은 빼고 실행한다. 모르는 옵션이 있으면 CLI가 시작하자마자 실패한다. 사용자 지정 명령(검증용)은 확인하지 않는다.
const detectUnsupportedFlags = async (context) => {
    if (context.options.command || context.options.commandArgs) {
        return [];
    }

    const unsupportedFlags = await processUtil.getUnsupportedFlags(context.command, OPTIONAL_CLAUDE_FLAGS, context.env);

    if (unsupportedFlags.length > 0) {
        context.writeLog(`[설정] 설치된 Claude Code가 ${unsupportedFlags.join(", ")} 옵션을 지원하지 않아 빼고 실행합니다. Claude Code를 업데이트하면 적용됩니다.`);
    }

    return unsupportedFlags;
};

const writeBuildStart = (context) => {
    const { runState, writeLog } = context;

    if (runState.mode !== MODE_BUILD) {
        return;
    }

    if (runState.designFormat !== runState.requestedDesignFormat) {
        writeLog("[설정] 외부 서비스로 보내기를 허용하지 않아 디자인 산출물을 HTML 와이어프레임으로 만듭니다.");
    }

    if (runState.isBrainstormBlocked) {
        writeLog("[브레인스토밍] 외부 서비스로 보내기를 허용하지 않아 다른 AI의 안을 받지 않습니다.");
    }

    writeLog(`[단계] ${PHASE_LABELS[runState.phase]} 시작`);
};

const runLockedAutopilot = async (options) => {
    const context = prepareRun(options);
    const loopState = createLoopState();
    const unregisterInterruptHandlers = registerInterruptHandlers(context, loopState);

    try {
        context.unsupportedFlags = await detectUnsupportedFlags(context);

        reportUtil.writeRunReport(context.runState, "시작 중", true);

        if (options.open !== false) {
            processUtil.openFile(context.runState.reportFile);
        }

        writeBuildStart(context);

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

const getPhaseFile = (projectDir, options) => {
    return phaseUtil.getPhaseFile(autopilotUtil.getProgressFile(projectDir, options.dataDir));
};

// 앱이 연결 여부를 판단하도록 실행 중인지와 pid·로그 파일을 알려준다. 신규 개발을 한 적 있으면 단계 상태도 담는다.
const getRunStatus = (options = {}) => {
    try {
        const { projectDir, workDir } = getProjectPaths(options);
        const phaseFile = getPhaseFile(projectDir, options);
        const runStatus = autopilotUtil.getRunStatus(autopilotUtil.getLockFile(workDir));

        return { status: STATUS_OK, data: fs.existsSync(phaseFile) ? { ...runStatus, phase: phaseUtil.readPhase(phaseFile) } : runStatus };
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

        // 신규 개발의 단계도 처음(기획)으로 돌린다.
        fileUtil.removeFiles([getPhaseFile(projectDir, options)]);

        return { status: STATUS_OK, data: { isReset: Boolean(resetResult.archivePath), archivePath: resetResult.archivePath } };
    } catch (error) {
        log.error(util.formatError(error));

        return { status: STATUS_FAILED, error: { code: error.code || ERROR_CODE_AUTOPILOT_ERROR, msg: error.message || String(error) } };
    }
};

// 협의한 단계의 승인. 쟁점이 있으면 쟁점마다 고른 쪽(resolve)이 모두 있어야 하고, 없으면 그대로 승인한다.
const approveDebate = (phaseFile, state, options) => {
    const ids = state.debate.disputes.map((dispute) => dispute.id);
    const resolutions = options.resolve || {};

    if (options.pick) {
        throw new Error("협의한 단계는 --pick 대신 --resolve로 쟁점마다 고릅니다.");
    }

    if (Object.keys(resolutions).length !== ids.length || !ids.every((id) => Object.hasOwn(resolutions, id))) {
        throw new Error(ids.length ? `쟁점마다 고른 쪽이 필요합니다(--resolve ${ids.map((id) => `${id}=claude|codex`).join(",")}).` : "고를 쟁점이 없습니다. --resolve 없이 승인합니다.");
    }

    const approvedState = { ...state, awaiting: null, debate: { ...state.debate, resolved: resolutions } };

    phaseUtil.writePhase(phaseFile, approvedState);

    return { status: STATUS_OK, data: { phase: approvedState } };
};

// 확인을 기다리는 신규 개발 단계를 승인해 다음 실행이 다음 단계부터 하게 한다. 여러 AI가 안을 낸 단계면 고른 안(pick)이, 협의한 단계면 쟁점마다 고른 쪽(resolve)이 필요하다.
const requestPhaseApproval = (options = {}) => {
    try {
        const { projectDir, workDir } = getProjectPaths(options);
        const phaseFile = getPhaseFile(projectDir, options);

        if (autopilotUtil.isRunLockActive(autopilotUtil.getLockFile(workDir))) {
            throw new Error("실행 중인 AutoPilot이 있어 단계를 승인할 수 없습니다.");
        }

        const state = phaseUtil.readPhase(phaseFile);

        if (!fs.existsSync(phaseFile) || !state.awaiting) {
            throw new Error("확인을 기다리는 단계가 없습니다.");
        }

        if (state.debate) {
            return approveDebate(phaseFile, state, options);
        }

        if (options.resolve) {
            throw new Error("협의한 단계가 아니어서 고를 쟁점이 없습니다.");
        }

        const candidates = state.proposals?.candidates || [];

        if (candidates.length > 1 && !candidates.includes(options.pick)) {
            throw new Error(`안을 하나 골라야 합니다(--pick ${candidates.join(" | ")}).`);
        }

        if (candidates.length < 2 && options.pick) {
            throw new Error("고를 안이 없는 단계입니다.");
        }

        const approvedState = { ...state, awaiting: null, proposals: candidates.length > 1 ? { ...state.proposals, picked: options.pick } : state.proposals };

        phaseUtil.writePhase(phaseFile, approvedState);

        return { status: STATUS_OK, data: { phase: approvedState } };
    } catch (error) {
        log.error(util.formatError(error));

        return { status: STATUS_FAILED, error: { code: error.code || ERROR_CODE_AUTOPILOT_ERROR, msg: error.message || String(error) } };
    }
};

export { runAutopilot, requestStop, requestRoundOptions, getRunStatus, requestProgressReset, requestPhaseApproval };

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
    BRAINSTORM_PHASES,
    PROVIDER_CLAUDE,
    PROVIDER_CODEX,
    PROVIDER_LABELS,
    PROVIDER_TIMEOUT_MINUTES,
    DEBATE_DEFAULT_TURNS,
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
import streamUtil from "../utils/streamUtil.js";

const INTERRUPT_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"];
// 단계의 안 · 검토를 낼 때 Claude에게 주는 도구. 저장소를 읽기만 하게 한다.
const READ_ONLY_TOOLS = "Read,Glob,Grep";

// Codex가 회차를 돌리거나(메인) 안을 내는(보조) 실행인지. model·effort 줄을 헤더에 남길지 정한다.
const isCodexInvolved = (runState, options) => {
    if (runState.mode !== MODE_BUILD) {
        return options.runner === PROVIDER_CODEX;
    }

    return BUILD_PHASES.some((phase) => {
        const { main, assistant } = phaseUtil.getPhaseAgents({ phase: phase, mains: runState.mains, brainstorm: runState.brainstorm, canSend: runState.allow.includes("send") });

        return main === PROVIDER_CODEX || assistant === PROVIDER_CODEX;
    });
};

const writeRunHeader = (context) => {
    const { options, env, runState, writeLog } = context;
    const headerLines = [
        "Claude Code AutoPilot",
        `Project : ${runState.projectDir}`,
        `Config : ${env.CLAUDE_CONFIG_DIR}`,
        `Progress : ${runState.progressFile}`,
        `Deadline : ${dateUtil.getDatetimeString(runState.deadline)} (${runState.endSource})`,
        `Policy : ${runState.policy} (${runState.policySource})`,
        ...(runState.mode === MODE_BUILD ? [`Mode : 신규 개발 (${PHASE_LABELS[runState.phase]} 단계부터)`] : []),
        ...(options.runner === PROVIDER_CODEX ? ["Runner : Codex"] : []),
        ...(runState.mode === MODE_BUILD && Object.values(runState.mains).includes(PROVIDER_CODEX)
            ? [`Main : ${BUILD_PHASES.map((phase) => `${PHASE_LABELS[phase]} ${PROVIDER_LABELS[runState.mains[phase]]}`).join(", ")}`]
            : []),
        ...(isCodexInvolved(runState, options) && (options.codexModel || options.codexEffort) ? [`Codex : model ${options.codexModel || "기본값"}, effort ${options.codexEffort || "기본값"}`] : []),
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
    const mains = phaseUtil.getPhaseMains(options.mains, options.runner);
    // Codex를 보조로 쓰면 프로젝트 내용을 보내므로 외부 서비스로 보내기를 허용했을 때만 쓴다.
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
        mains: mains,
        brainstorm: brainstorm,
        isBrainstormBlocked: BRAINSTORM_PHASES.some((phase) => phaseUtil.getPhaseAgents({ phase: phase, mains: mains, brainstorm: brainstorm, canSend: canSend }).isBlocked),
        crossReview: Boolean(options.crossReview),
        debate: options.debate || [],
        debateTurns: options.debateTurns ?? DEBATE_DEFAULT_TURNS,
        proposals: state.proposals,
        debateState: state.debate,
        receivedProposal: state.receivedProposal
    };
};

// PHASE.json에 쓸 지금 단계 상태. 확인 대기와 고른 안은 단계를 마치거나 확정할 때만 정한다.
const getPhaseState = (runState) => {
    return {
        phase: runState.phase,
        awaiting: null,
        qaRetries: runState.qaRetries,
        securityRetries: runState.securityRetries,
        proposals: null,
        debate: null,
        receivedProposal: runState.receivedProposal
    };
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

    return {
        phase: proposals.phase,
        picked: proposals.picked,
        main: proposals.candidates[0],
        file: fs.existsSync(path.join(projectDir, htmlFile)) ? htmlFile : phaseUtil.getProposalPath(proposals.phase, proposals.picked)
    };
};

// 이 개발이 이 단계의 안을 이미 받아 두었으면(이어서 하는 단계) 그대로 쓴다. 돌려보낸 단계나 진행 기록을 초기화한 뒤 저장소에 남은 앞선 개발의 안이면 다시 받는다.
const getReadyProposals = (projectDir, modeSettings) => {
    const readyProposals = {};

    const { assistant } = phaseUtil.getPhaseAgents({ phase: modeSettings.phase, mains: modeSettings.mains, brainstorm: modeSettings.brainstorm, canSend: modeSettings.allow.includes("send") });

    if (modeSettings.receivedProposal !== modeSettings.phase || !assistant) {
        return readyProposals;
    }

    const file = [true, false].map((isHtml) => phaseUtil.getProposalPath(modeSettings.phase, assistant, isHtml)).find((relPath) => fs.existsSync(path.join(projectDir, relPath)));

    if (file) {
        readyProposals[assistant] = file;
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
    runState.isDisputesRetry = false;
    runState.phaseAgents = null;
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

// 회차를 돌릴 실행 파일·인자와 출력 해석기. Claude는 stream-json, Codex는 exec --json 이벤트다.
const getSessionCommand = (context, agent) => {
    const { options, command, runState } = context;
    const addDirs = runState.repos.filter((repo) => repo.isLinked).map((repo) => repo.dir);

    if (agent.runner !== PROVIDER_CODEX) {
        return {
            command: command,
            args: options.commandArgs || autopilotUtil.getClaudeArgs({ model: agent.model, effort: agent.effort, unsupportedFlags: context.unsupportedFlags, addDirs: addDirs }),
            handleLine: streamUtil.handleStreamEvent
        };
    }

    return {
        command: agent.ready.command,
        args: [...agent.ready.baseArgs, ...providerUtil.PROVIDERS.codex.getRoundArgs(agent.ready.settingArgs, addDirs)],
        handleLine: streamUtil.handleCodexEvent
    };
};

// 세션이 실행되는 동안 리포트를 주기적으로 갱신한다.
const executeSession = async (context, loopState, { round, prompt, roundDeadline, sessionStats, agent }) => {
    const { env, runState, writeLog } = context;
    const session = getSessionCommand(context, agent);
    const updateLiveReport = () => {
        reportUtil.writeRunReport(runState, `${round}회차 진행 중 · 시한 ${dateUtil.getTimeString(new Date(roundDeadline))}`, true);
    };

    updateLiveReport();

    const reportTimer = setInterval(updateLiveReport, REPORT_REFRESH_MS);

    try {
        return await processUtil.runSession(session.command, session.args, prompt, {
            projectDir: runState.projectDir,
            processEnv: env,
            roundDeadline: roundDeadline,
            writeLog: writeLog,
            sessionStats: sessionStats,
            handleLine: session.handleLine,
            onProcessChange: (childProcess) => {
                loopState.activeProcess = childProcess;
            }
        });
    } finally {
        clearInterval(reportTimer);
    }
};

// 회차를 시작할 때마다 실행 중 변경 파일을 읽어 이번 회차의 실행 에이전트와 model·effort를 정한다.
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

// 이번 회차를 돌릴 AI. 신규 개발은 지금 단계의 메인이고, 유지 보수는 실행 에이전트(실행 중 set으로 바뀔 수 있다)다.
const getRoundRunner = (context, roundOptions) => {
    return context.runState.mode === MODE_BUILD ? context.runState.phaseAgents.main : roundOptions.runner;
};

// 이번 회차를 돌릴 에이전트와 그 model·effort. Codex를 쓸 수 없으면(설치·로그인 안 됨) 이번 회차는 Claude로 돌린다.
const getRoundAgent = async (context, roundOptions, runner) => {
    const claude = { runner: PROVIDER_CLAUDE, model: roundOptions.model, effort: roundOptions.effort };

    if (runner !== PROVIDER_CODEX) {
        return claude;
    }

    const ready = await getProviderCheck(context, PROVIDER_CODEX);

    if (ready.error) {
        context.writeLog(`[설정] Codex를 쓸 수 없어 이번 회차는 Claude로 돌립니다: ${ready.error}`);

        return claude;
    }

    return { runner: PROVIDER_CODEX, model: roundOptions.codexModel, effort: roundOptions.codexEffort, ready: ready };
};

// 회차 시작 줄의 실행 값. Claude는 지금까지의 형식 그대로이고, Codex는 앞에 이름을 붙이며 비운 값은 기본값이라고 쓴다(앱 파서가 읽는다).
const getAgentLabel = (agent) => {
    if (agent.runner !== PROVIDER_CODEX) {
        return `model ${agent.model}, effort ${agent.effort}`;
    }

    return `Codex, model ${agent.model || "기본값"}, effort ${agent.effort || "기본값"}`;
};

const runRound = async (context, loopState, remainingMinutes) => {
    const { runConfig, runState, writeLog, recordedCommitHashes } = context;
    const progressCleanupPrompt = getProgressCleanupPrompt(context);
    const round = runState.rounds.length + 1;
    const roundStart = new Date();
    const previousHeads = runState.repos.map((repo) => gitUtil.getHeadHash(repo.runGitCommand));
    const roundDeadline = Math.min(+runState.deadline, Date.now() + runConfig.maxRoundMinutes * MINUTE_MS);
    const sessionStats = { limitHit: false, isError: false };
    const roundOptions = getRoundOptions(context);
    const agent = await getRoundAgent(context, roundOptions, getRoundRunner(context, roundOptions));
    const prompt = promptUtil.getRoundPrompt(runState, round, Math.floor(remainingMinutes), progressCleanupPrompt, runConfig.maxTasks, agent.runner);

    writeLog(`[${round}회차] 시작 - 남은 시간 ${Math.floor(remainingMinutes)}분 (${getAgentLabel(agent)})`);

    const sessionResult = await executeSession(context, loopState, { round: round, prompt: prompt, roundDeadline: roundDeadline, sessionStats: sessionStats, agent: agent });
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
        runner: agent.runner,
        model: agent.model,
        effort: agent.effort,
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

const getRateLimitStopReason = (isCapped, extensionMs) => {
    if (isCapped) {
        return "사용량 한도 연장 상한 도달";
    }

    return extensionMs ? "사용량 한도 대기 전 남은 시간 부족" : "사용량 한도 리셋이 종료 시각 이후";
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
        loopState.reason = getRateLimitStopReason(isCapped, extensionMs);

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

// Claude를 짧게 부를 때(안 · 검토 · 협의 발언)의 실행 값. model·effort는 실행 중 set으로 바뀔 수 있어 부를 때마다 지금 값으로 읽는다.
// tools를 비우면 도구 없이, 주면 그 도구만 쓰게 한다.
const getClaudeCall = (context, { sessionId = null, tools = "" } = {}) => {
    const { options, command, unsupportedFlags } = context;
    const roundOptions = getRoundOptions(context);

    return {
        command: command,
        baseArgs: options.commandArgs || [],
        model: roundOptions.model,
        extraArgs: unsupportedFlags.includes("--effort") ? [] : ["--effort", roundOptions.effort],
        tools: tools,
        sessionId: sessionId
    };
};

// 다른 AI를 쓸 수 있는지는 한 번만 확인한다. model·effort는 실행 중 set으로 바뀔 수 있어 부를 때마다 지금 값으로 붙인다. Codex만 확인이 필요하다(Claude는 엔진이 이미 쓰는 CLI다).
const getProviderCheck = async (context, provider) => {
    const { options, env, runState } = context;

    context.providerChecks[provider] ??= await providerUtil.checkProvider(provider, { cwd: runState.projectDir, processEnv: env, override: options.providerCommands?.[provider] });

    const ready = context.providerChecks[provider];
    const { codexModel, codexEffort } = getRoundOptions(context);

    return ready.error ? ready : { ...ready, settingArgs: providerUtil.PROVIDERS[provider].getSettingArgs({ model: codexModel, effort: codexEffort }) };
};

// 다른 AI에게 묻고 답을 돌려준다. 못 쓰거나 실패하면 이유를 로그로 남기고 null이다(회차 실패로 세지 않는다).
const askProvider = async (context, loopState, provider, prompt, subject) => {
    const { env, runConfig, runState, writeLog } = context;
    const label = PROVIDER_LABELS[provider];
    const isClaude = provider === PROVIDER_CLAUDE;
    const ready = isClaude ? getClaudeCall(context, { tools: READ_ONLY_TOOLS }) : await getProviderCheck(context, provider);

    if (ready.error) {
        writeLog(`[브레인스토밍] ${label} ${subject} 건너뜀: ${ready.error}`);

        return null;
    }

    writeLog(`[브레인스토밍] ${label} ${subject} 받는 중`);

    const startedAt = Date.now();
    const deadline = Math.min(+runState.deadline, startedAt + Math.min(runConfig.maxRoundMinutes, PROVIDER_TIMEOUT_MINUTES) * MINUTE_MS);
    const limitMinutes = Math.ceil((deadline - startedAt) / MINUTE_MS);
    let stderr = "";

    // 답이 길어지면 화면에 아무 소식이 없어 멈춘 것처럼 보이므로, 경과 시간과 지금까지 한 일을 주기적으로 남긴다.
    const heartbeatTimer = setInterval(() => {
        const activity = providerUtil.getActivity(provider, stderr);

        writeLog(`[브레인스토밍] ${label} ${subject} 진행 ${Math.floor((Date.now() - startedAt) / MINUTE_MS)}분째 (최대 ${limitMinutes}분)${activity ? `: ${activity}` : ""}`);
    }, runConfig.providerHeartbeatMs);
    let answer;

    try {
        const callOptions = {
            cwd: runState.projectDir,
            processEnv: env,
            deadline: deadline,
            shouldStop: () => isStopRequested(context, loopState),
            onProcessChange: (childProcess) => {
                loopState.activeProcess = childProcess;
            },
            onStderr: (text) => {
                stderr = text;
            }
        };

        answer = isClaude ? await providerUtil.askClaude(ready, prompt, callOptions) : await providerUtil.askProvider(provider, ready, prompt, callOptions);

        if (answer.text) {
            answer = { ...answer, text: providerUtil.stripCodeFence(answer.text) };
        }
    } finally {
        clearInterval(heartbeatTimer);
    }

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

// 단계를 시작할 때 그 단계의 메인과 보조를 정한다. 메인이 Codex인데 쓸 수 없으면(설치·로그인 안 됨) 그 단계는 Claude가 메인이 되고 보조 없이 진행한다.
const resolvePhaseAgents = async (context) => {
    const { runState, writeLog } = context;
    const phase = runState.phase;

    if (runState.mode !== MODE_BUILD || runState.phaseAgents?.phase === phase) {
        return;
    }

    const agents = phaseUtil.getPhaseAgents({ phase: phase, mains: runState.mains, brainstorm: runState.brainstorm, canSend: runState.allow.includes("send") });

    if (agents.main === PROVIDER_CODEX) {
        const ready = await getProviderCheck(context, PROVIDER_CODEX);

        if (ready.error) {
            writeLog(`[설정] Codex를 쓸 수 없어 ${PHASE_LABELS[phase]} 단계는 Claude가 메인으로 진행합니다: ${ready.error}`);

            runState.phaseAgents = { ...agents, main: PROVIDER_CLAUDE, assistant: null };
            runState.proposalReady = {};

            return;
        }
    }

    runState.phaseAgents = agents;
};

// 브레인스토밍 단계를 시작할 때 보조의 독립된 안을 받아 docs/autopilot/proposals/에 둔다. 단계마다 한 번만 받는다.
const requestProposals = async (context, loopState) => {
    const { runState } = context;
    const phase = runState.phase;
    const assistant = runState.phaseAgents?.assistant;

    if (runState.mode !== MODE_BUILD || !assistant || runState.proposalPhase === phase) {
        return;
    }

    runState.proposalPhase = phase;
    runState.proposalReady = {};

    const relPath = phaseUtil.getProposalPath(phase, assistant, phase === "design" && runState.designFormat === "html");
    const proposal = await askProvider(context, loopState, assistant, promptUtil.getProposalPrompt(runState), `${PHASE_LABELS[phase]} 안`);

    if (proposal) {
        writeProposalFile(runState.projectDir, relPath, proposal);
        runState.proposalReady[assistant] = relPath;
        runState.receivedProposal = phase;
        // 확정을 기다리는 고른 안 · 쟁점을 지우지 않게 지금 상태에 더한다.
        phaseUtil.writePhase(runState.phaseFile, { ...phaseUtil.readPhase(runState.phaseFile), receivedProposal: phase });
    }
};

// 협의할 때 메인의 산출물. 디자인 폴더의 파일은 이름만 알린다.
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

// 협의: 메인과 보조(Claude와 Codex)가 각자 같은 대화를 이어 가며 최대 runState.debateTurns번 주고받는다. 한 번은 메인이 말하고 보조가 답하는 것이다.
// 연달아 둘 다 합의(반대도 남은 개선점도 없음)라고 하면 일찍 끝낸다. 어느 쪽이든 답을 못 받으면(형식이 틀린 답은 한 번 다시 받는다) null이고, 단계는 나란히 비교로 넘어간다(회차 실패로 세지 않는다).
const runDebate = async (context, loopState) => {
    const { env, runState, writeLog } = context;
    const { phase, projectDir } = runState;
    const { main, assistant } = runState.phaseAgents;
    // 각 AI의 안: 메인은 단계 산출물, 보조는 안 받기로 둔 파일이다.
    const docs = { [main]: readPhaseArtefact(projectDir, phase), [assistant]: fileUtil.readTextFile(path.join(projectDir, runState.proposalReady[assistant])) };
    const turns = [];
    const sessionIds = { [PROVIDER_CLAUDE]: null, [PROVIDER_CODEX]: null };

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

    const codexReady = await getProviderCheck(context, PROVIDER_CODEX);

    if (codexReady.error) {
        return skip(codexReady.error);
    }

    const askTurn = (provider, prompt, sessionId) => {
        if (provider === PROVIDER_CLAUDE) {
            return providerUtil.askClaude(getClaudeCall(context, { sessionId: sessionId }), prompt, getCallOptions());
        }

        return providerUtil.askProvider(PROVIDER_CODEX, codexReady, prompt, getCallOptions(), sessionId);
    };

    writeLog(`[협의] ${PHASE_LABELS[phase]} 시작 (최대 ${runState.debateTurns}번)`);

    for (let exchange = 1; exchange <= runState.debateTurns; exchange++) {
        for (const provider of [main, assistant]) {
            const previous = turns.at(-1);
            // 대화가 이어지는 중이면 상대의 말만 전하고, 첫 호출이거나 Codex의 세션 아이디를 못 찾았으면(대화를 이을 수 없다) 지금까지 주고받은 말을 다시 보낸다.
            const prompt = sessionIds[provider]
                ? promptUtil.getDebateReplyPrompt(runState, previous, exchange)
                : promptUtil.getDebateOpeningPrompt(runState, provider, { docs: docs, lastTurn: previous ?? null, transcript: turns.slice(0, -1) });
            let answer = await askTurn(provider, prompt, sessionIds[provider]);
            let turn = answer.text ? debateUtil.parseTurn(answer.text) : null;
            const sessionId = answer.sessionId || sessionIds[provider];

            // 답은 왔는데 형식만 틀렸으면 같은 대화에서 한 번 다시 받는다. 한 번의 형식 실수로 그때까지의 협의를 버리지 않게 한다.
            if (answer.text && !turn && sessionId) {
                answer = await askTurn(provider, promptUtil.getDebateFormatPrompt(), sessionId);
                turn = answer.text ? debateUtil.parseTurn(answer.text) : null;
            }

            // Claude는 세션 아이디가 있어야 같은 대화를 이을 수 있다.
            if (!turn || (provider === PROVIDER_CLAUDE && !(answer.sessionId || sessionId))) {
                return skip(`${PROVIDER_LABELS[provider]} 답을 받지 못했어요(${answer.error || "형식이 맞지 않아요"})`);
            }

            sessionIds[provider] = answer.sessionId || sessionId;
            turns.push({ provider: provider, ...turn });
            writeLog(`[협의] ${PROVIDER_LABELS[provider]}: ${turn.message}`);

            // 보조가 받아들인 것을 메인이 확인한 경우처럼 번이 끝나지 않았어도 연달아 합의하면 끝낸다.
            if (turn.consensus && turns.at(-2)?.consensus) {
                return { turns: turns, isConsensus: true };
            }
        }
    }

    return { turns: turns, isConsensus: false };
};

// 협의 단계에서 메인이 산출물을 마치면 협의를 하고, 다음 회차가 결과를 정리하게 한다. 정리 회차로 넘어가면 true다.
const startDebate = async (context, loopState) => {
    const { runState, phaseDoneFile } = context;
    const debate = await runDebate(context, loopState);

    if (!debate) {
        return false;
    }

    const debatePath = phaseUtil.getDebatePath(runState.phase);

    writeProposalFile(runState.projectDir, debatePath, debateUtil.formatTranscript(PHASE_LABELS[runState.phase], debate.turns, debate.isConsensus));
    fileUtil.removeFiles([phaseDoneFile]);
    runState.debateStage = "synthesis";
    // 쟁점 파일이 정리 회차가 새로 쓴 것인지 같은 파일 시스템의 시각으로 가린다. 시각 단위가 거친 파일 시스템(FAT 2초)도 있다.
    runState.debateEndedAt = fs.statSync(path.join(runState.projectDir, debatePath)).mtimeMs;
    // 협의와 정리는 같은 단계의 일이라 정리 회차가 commit 없이 끝나도 idle로 몰지 않는다.
    loopState.idleCount = 0;

    return true;
};

// 같은 단계를 다시 협의하면 앞선 협의의 쟁점 파일이 저장소에 남아 있으므로 협의를 마친 뒤 새로 쓴 파일만 읽는다. 아니면 null이다.
const readDisputes = (runState) => {
    const file = path.join(runState.projectDir, phaseUtil.getDisputesPath(runState.phase));
    const isFresh = fs.statSync(file, { throwIfNoEntry: false })?.mtimeMs >= runState.debateEndedAt;

    return debateUtil.parseDisputes(isFresh ? fileUtil.readTextFile(file) : "");
};

// 세션이 남긴 단계 완료 신호로 다음 단계로 넘긴다. 확인 대기·모든 단계 완료·테스트/QA·보안검토 실패로 실행을 끝내야 하면 true를 반환한다.
// 다른 AI의 안을 받은 단계는 교차검토를 받고, 사용자가 안을 고르도록 멈춘다. 다른 AI의 검토는 다음 실행이 commit한다.
const applyPhaseDone = async (context, loopState) => {
    const { runState, phaseDoneFile, writeLog } = context;
    const result = fileUtil.readTextFile(phaseDoneFile).trim().split(/\r?\n/)[0].trim().toLowerCase();
    const phase = runState.phase;
    const label = PHASE_LABELS[phase];
    const maxRetries = { qa: runState.maxQaRetries, security: runState.maxSecurityRetries };
    const { main, assistant } = runState.phaseAgents;
    const readyProviders = assistant ? Object.keys(runState.proposalReady) : [];
    const isDebatePhase = Boolean(assistant && runState.debate?.includes(phase) && runState.proposalReady?.[assistant]);

    // 중단 요청이 있으면 협의를 시작하지 않고, 협의가 중단으로 끊겨도 나란히 비교로 넘기지 않는다. 다음 실행이 그 단계와 협의를 다시 한다.
    if (isDebatePhase && runState.debateStage !== "synthesis" && (isStopRequested(context, loopState) || (await startDebate(context, loopState)) || isStopRequested(context, loopState))) {
        return false;
    }

    const isSynthesis = runState.debateStage === "synthesis";
    const disputes = isSynthesis ? readDisputes(runState) : null;

    // 정리 회차가 쟁점 파일을 읽을 수 없게 남겼으면 쟁점을 버리고 합의로 넘기지 않고 한 번 더 그 파일을 쓰게 한다. 또 틀리면 쟁점 없이 넘긴다.
    if (isSynthesis && !disputes && !runState.isDisputesRetry) {
        runState.isDisputesRetry = true;
        fileUtil.removeFiles([phaseDoneFile]);
        loopState.idleCount = 0;

        return false;
    }

    // 협의를 정리한 회차가 남긴 쟁점을 상태로 옮긴다. 사용자는 합의안을 확인하고 쟁점마다 한쪽을 고른다.
    const debateResult = isSynthesis ? { phase: phase, disputes: disputes || [], resolved: null } : null;
    const candidates = !debateResult && readyProviders.length ? [main, ...readyProviders] : [];
    const reviewState = { ...runState };
    const { state, event } = phaseUtil.getPhaseTransition(getPhaseState(runState), result, runState.gates, maxRetries, candidates, debateResult);

    runState.debateStage = null;
    runState.isDisputesRetry = false;

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
        // 교차검토: 보조가 메인의 산출물을 읽고 고칠 점을 낸다. 실패해도 고르는 데는 지장이 없다.
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
        await resolvePhaseAgents(context);
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

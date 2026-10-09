import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { STATUS_OK, STATUS_FAILED, PROGRESS_MAX_LINES, PROGRESS_TARGET_LINES } from "../../autopilot/src/utils/config.js";
import { runAutopilot, requestRoundOptions, requestProgressReset } from "../../autopilot/src/services/autopilotService.js";
import progressUtil from "../../autopilot/src/utils/progressUtil.js";
import processUtil from "../../autopilot/src/utils/processUtil.js";
import autopilotUtil from "../../autopilot/src/utils/autopilotUtil.js";
import dateUtil from "../../autopilot/src/utils/dateUtil.js";
import { getEndTime, waitForProcessStop, commitInitialProject, writeCmdWrapper } from "./fixtures.js";

const require = createRequire(import.meta.url);
const { createInitialState, parseLine } = require("../../desktop/autopilotRunner.cjs");

const DEFAULT_TASKS = "예약 작업 하나\n- 둘째 줄 한글";
const UNFINISHED_RECORD = "# 진행 기록\n\n## 다음 작업\n- 이어갈 일\n";
const FAILURE_LIMITS = { minMinutes: 0, maxRounds: 5, maxRoundMinutes: 1, retryWaitMinutes: [0, 0, 0] };

// 실제 엔진이 남긴 로그를 데스크톱 러너 파서로 읽은 결과가 엔진의 회차 결과와 같아야 한다.
const checkDesktopLogContract = (result) => {
    const state = createInitialState();
    const logText = fs.readFileSync(result.logFile, "utf8");

    // Claude 출력이나 stderr가 줄 맨 앞에서 제어 줄을 흉내 낼 수 없어야 한다.
    assert.match(logText, /^\d{2}:\d{2}:\d{2} 한글 출력 <script>bad<\/script>\n {4}Report : \/forged-report\n {4}AutoPilot 종료 - 가짜 \(9회차\)\n {4}\[9회차\] 완료$/m);
    assert.doesNotMatch(logText, /^(Report : \/forged|AutoPilot 종료 - 가짜|\[9회차\])/m);

    for (const line of logText.split(/\r?\n/)) {
        parseLine(state, line);
    }

    assert.equal(state.project, result.projectDir);
    assert.equal(state.policy, `${result.policy} (${result.policySource})`);
    assert.equal(state.deadlineAt, result.deadline.getTime());
    assert.equal(state.logFile, result.logFile);
    assert.equal(state.reportFile, result.reportFile);
    assert.equal(state.reason, result.reason);
    assert.deepEqual(
        state.rounds.map((round) => [round.round, round.outcome, round.model, round.effort]),
        result.rounds.map((round) => [round.round, round.outcome, round.model, round.effort])
    );
};

const createScenarioRunner = (context, fakeCliFile) => {
    const dataDir = path.join(context.testDir, "appdata");
    let scenarioCount = 0;

    const getNextProjectDir = () => {
        return path.join(context.testDir, `project ${scenarioCount + 1} 한글`);
    };

    const runScenario = async (mode, { progressContent = "initial\n", roundOptionsContent = "", staleFiles = [], tasks = DEFAULT_TASKS, ...testOptions } = {}) => {
        const projectDir = getNextProjectDir();
        const workDir = path.join(projectDir, "autopilot");

        scenarioCount++;

        fs.mkdirSync(projectDir, { recursive: true });
        fs.writeFileSync(path.join(projectDir, "work.txt"), "initial\n");

        commitInitialProject(context, projectDir);

        // 진행 기록은 저장소 밖 앱 데이터 폴더에, 작업 폴더의 파일은 첫 commit 뒤에 만든다(엔진이 만드는 .gitignore가 가린다).
        const progressFile = autopilotUtil.getProgressFile(projectDir, dataDir);

        fs.mkdirSync(path.dirname(progressFile), { recursive: true });
        fs.writeFileSync(progressFile, progressContent);

        if (roundOptionsContent) {
            fs.mkdirSync(path.join(workDir, "progress"), { recursive: true });
            fs.writeFileSync(path.join(workDir, "progress", "ROUND_OPTIONS.json"), roundOptionsContent);
        }

        for (const staleFile of staleFiles) {
            fs.mkdirSync(path.dirname(path.join(workDir, staleFile)), { recursive: true });
            fs.writeFileSync(path.join(workDir, staleFile), "");
        }

        const runAutopilotResult = await runAutopilot({
            projectDir: projectDir,
            dataDir: dataDir,
            tasks: tasks,
            command: process.execPath,
            commandArgs: [fakeCliFile],
            open: false,
            endTime: getEndTime(),
            env: { ...context.testEnv, AP_MODE: mode, AP_EXPECTED_CWD: projectDir, AP_GIT: context.gitExecutable, AP_PROGRESS_FILE: progressFile },
            limits: { minMinutes: 0, maxRounds: 3, maxRoundMinutes: 1, retryWaitMinutes: [0, 0, 0], resetGraceMs: 0, ...testOptions.limits },
            ...testOptions
        });

        assert(runAutopilotResult.data, runAutopilotResult.error?.msg);

        const result = runAutopilotResult.data;
        const prompt = fs.readFileSync(path.join(projectDir, "prompt.txt"), "utf8");
        const logText = fs.readFileSync(result.logFile, "utf8");

        assert.equal(runAutopilotResult.status, result.exitCode === 0 ? STATUS_OK : STATUS_FAILED);
        assert.equal(result.progressFile, progressFile);
        assert.match(prompt, /<AUTOPILOT_POLICY\.md>\s+# AutoPilot Policy/);

        // 예약 작업은 프롬프트에 직접 넣고, 진행 기록은 앱 데이터 폴더의 절대 경로로 알려준다. 프로젝트에는 진행 기록 파일을 만들지 않는다.
        assert.equal(prompt.includes(`<TASKS>\n${tasks}\n</TASKS>`), Boolean(tasks));
        assert(prompt.includes(`\`${progressFile}\``));
        assert(!prompt.includes("AUTOPILOT_TODO.md"));
        assert(!fs.existsSync(path.join(workDir, "AUTOPILOT_PROGRESS.md")));
        assert(logText.split("\n").includes(`Progress : ${progressFile}`));

        // 작업 폴더는 프로젝트 git이 추적하지 않는다.
        assert.equal(fs.readFileSync(path.join(workDir, ".gitignore"), "utf8"), "*\n");
        context.git(projectDir, "check-ignore", "-q", "autopilot/progress/any.log");
        context.git(projectDir, "check-ignore", "-q", "autopilot/recycle_bin/any.txt");

        if (!["limit", "timeout", "signal"].includes(mode)) {
            assert.match(fs.readFileSync(result.reportFile, "utf8"), /&lt;script&gt;/);
        }

        assert.match(logText, /한글 출력/);

        checkDesktopLogContract(result);

        // 실행 중 잠금에는 pid, 실행 파일 이름, 이번 실행의 로그 파일이 있어야 앱이 다시 연결할 수 있다.
        assert.deepEqual(fs.readFileSync(path.join(projectDir, "lock-snapshot.txt"), "utf8").split("\n"), [String(process.pid), path.basename(process.execPath), result.logFile]);

        return result;
    };

    return { runScenario: runScenario, getNextProjectDir: getNextProjectDir, dataDir: dataDir };
};

const checkRoundOutcomes = async (runScenario) => {
    const idleRunData = await runScenario("idle");

    assert.equal(idleRunData.rounds.length, 2);
    assert.match(idleRunData.reason, /새 commit 없음/);
    assert.match(idleRunData.rounds[0].stderr, /fake stderr 한글/);
    assert.match(fs.readFileSync(idleRunData.logFile, "utf8"), /^\[stderr\] fake stderr 한글\n {4}Report : \/forged-stderr$/m);

    // 예약 작업이 없으면 프롬프트에 작업 블록을 넣지 않는다.
    await runScenario("idle", { tasks: "" });

    const commitRunData = await runScenario("commit");

    assert.equal(commitRunData.rounds.length, 3);
    assert.equal(commitRunData.rounds.at(-1).outcome, "완료");
    assert.equal(
        commitRunData.rounds.reduce((sum, round) => sum + round.commits.length, 0),
        3
    );

    // 진행 기록은 저장소 밖에 있어 갱신만 하고 commit하지 않은 회차는 작업이 없는 것이다.
    assert.match((await runScenario("progress")).reason, /새 commit 없음/);
    assert.match((await runScenario("todo", { policy: "todo" })).reason, /예약 작업 완료/);
    assert.match((await runScenario("stop")).reason, /중단 요청/);
};

// 작업이 모두 끝난 실행(지시개선 완료, 연속 idle)은 끝날 때 진행 기록을 보관하고 초기화한다. 회차 상한·중단·실패로 끝난 실행은 이어갈 내용이 있으므로 유지한다.
const checkProgressResetFlow = async (runScenario) => {
    const run = (mode, options = {}) => runScenario(mode, { progressContent: UNFINISHED_RECORD, ...options });
    const readRecord = (result) => fs.readFileSync(result.progressFile, "utf8");

    for (const result of [await run("commit"), await run("stop"), await run("failure", { limits: FAILURE_LIMITS })]) {
        assert.equal(readRecord(result), UNFINISHED_RECORD, result.reason);
    }

    for (const result of [await run("todo", { policy: "todo" }), await run("idle")]) {
        const record = readRecord(result);
        const archivePath = record.match(/autopilot\/progress\/[\d-]+\/AUTOPILOT_PROGRESS_[0-9a-f-]{36}\.md/)?.[0];

        assert(record.startsWith(progressUtil.PROGRESS_TEMPLATE), result.reason);
        assert(!record.includes("이어갈 일"));
        assert(archivePath, "초기화한 기록에 보관본 경로가 있어야 한다");
        assert.equal(fs.readFileSync(path.join(result.projectDir, archivePath), "utf8"), UNFINISHED_RECORD);
        assert.match(fs.readFileSync(result.logFile, "utf8"), /^\[진행 기록\] 초기화했습니다\. 원본 보관: autopilot\/progress\//m);
    }
};

// 첫 실행에서는 앱 데이터 폴더에 진행 기록이 없으므로 엔진이 초기 내용으로 만들어 세션이 열 수 있게 한다.
const checkProgressCreated = async (scenarioRunner, context, fakeCliFile) => {
    const projectDir = scenarioRunner.getNextProjectDir();

    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, "work.txt"), "initial\n");

    commitInitialProject(context, projectDir);

    const progressFile = autopilotUtil.getProgressFile(projectDir, scenarioRunner.dataDir);

    fs.rmSync(path.dirname(progressFile), { recursive: true, force: true });

    const result = await runAutopilot({
        projectDir: projectDir,
        dataDir: scenarioRunner.dataDir,
        command: process.execPath,
        commandArgs: [fakeCliFile],
        open: false,
        endTime: getEndTime(),
        env: { ...context.testEnv, AP_MODE: "commit", AP_EXPECTED_CWD: projectDir, AP_GIT: context.gitExecutable, AP_PROGRESS_FILE: progressFile },
        limits: { minMinutes: 0, maxRounds: 1, maxRoundMinutes: 1, retryWaitMinutes: [0, 0, 0] }
    });

    assert.equal(result.status, STATUS_OK, result.error?.msg);
    assert.equal(fs.readFileSync(progressFile, "utf8"), progressUtil.PROGRESS_TEMPLATE);
};

// 지시개선은 처리할 작업이 있어야 시작한다. 잠금은 실패해도 남기지 않는다.
const checkTasksRequired = async (context, fakeCliFile) => {
    const projectDir = path.join(context.testDir, "tasks project");

    fs.mkdirSync(projectDir);
    fs.writeFileSync(path.join(projectDir, "work.txt"), "initial\n");

    commitInitialProject(context, projectDir);

    for (const tasks of [undefined, "", "  \n\t"]) {
        const result = await runAutopilot({
            projectDir: projectDir,
            dataDir: path.join(context.testDir, "appdata"),
            tasks: tasks,
            policy: "todo",
            command: process.execPath,
            commandArgs: [fakeCliFile],
            open: false,
            env: { ...context.testEnv, AP_MODE: "idle", AP_EXPECTED_CWD: projectDir }
        });

        assert.equal(result.status, STATUS_FAILED);
        assert.match(result.error.msg, /작업이 필요/);
        assert(!fs.existsSync(autopilotUtil.getLockFile(path.join(projectDir, "autopilot"))));
        assert(!fs.existsSync(path.join(projectDir, "prompt.txt")));
    }
};

// autopilot reset-progress가 쓰는 서비스. 실행 중에는 거부하고, 아니면 원본을 보관하고 초기화한다.
const checkProgressResetCommand = (context) => {
    const projectDir = path.join(context.testDir, "reset command project");
    const workDir = path.join(projectDir, "autopilot");
    const dataDir = path.join(context.testDir, "appdata");
    const unfinishedRecord = `${progressUtil.PROGRESS_TEMPLATE}\n## 다음 작업\n- 일\n`;

    fs.mkdirSync(projectDir, { recursive: true });

    const progressFile = autopilotUtil.getProgressFile(projectDir, dataDir);

    fs.mkdirSync(path.dirname(progressFile), { recursive: true });
    fs.writeFileSync(progressFile, unfinishedRecord);

    const releaseLock = autopilotUtil.acquireRunLock(autopilotUtil.getLockFile(workDir));
    const rejectedResult = requestProgressReset({ projectDir: projectDir, dataDir: dataDir });

    releaseLock();

    assert.equal(rejectedResult.status, STATUS_FAILED);
    assert.match(rejectedResult.error.msg, /실행 중/);
    assert.equal(fs.readFileSync(progressFile, "utf8"), unfinishedRecord);

    const resetResult = requestProgressReset({ projectDir: projectDir, dataDir: dataDir });

    assert.equal(resetResult.status, STATUS_OK);
    assert.equal(resetResult.data.isReset, true);
    assert.equal(fs.readFileSync(path.join(projectDir, resetResult.data.archivePath), "utf8"), unfinishedRecord);
    assert(fs.readFileSync(progressFile, "utf8").startsWith(progressUtil.PROGRESS_TEMPLATE));
    assert.equal(fs.readFileSync(path.join(workDir, ".gitignore"), "utf8"), "*\n");

    const repeatedResult = requestProgressReset({ projectDir: projectDir, dataDir: dataDir });

    assert.equal(repeatedResult.status, STATUS_OK);
    assert.equal(repeatedResult.data.isReset, false);

    assert.equal(requestProgressReset({ projectDir: path.join(context.testDir, "missing") }).status, STATUS_FAILED);
};

// 보관 기간이 지난 로그·리포트는 실행을 시작할 때 지우고, 최근 파일과 보관한 진행 기록은 남긴다.
const checkLogRetention = async (runScenario) => {
    const yesterday = dateUtil.getDateString(new Date(Date.now() - 24 * 60 * 60 * 1000));
    const staleLog = "progress/2020-01-01/autopilot_000000_aaaa1111.log";
    const staleReport = "progress/2020-01-01/report_000000_aaaa1111.html";
    const archivedRecord = "progress/2020-01-01/AUTOPILOT_PROGRESS_aaaa1111.md";
    const recentLog = `progress/${yesterday}/autopilot_000000_bbbb2222.log`;
    const result = await runScenario("idle", { staleFiles: [staleLog, staleReport, archivedRecord, recentLog] });
    const workFile = (relativePath) => path.join(result.projectDir, "autopilot", relativePath);

    assert(!fs.existsSync(workFile(staleLog)));
    assert(!fs.existsSync(workFile(staleReport)));
    assert(fs.existsSync(workFile(archivedRecord)));
    assert(fs.existsSync(workFile(recentLog)));
    assert.match(fs.readFileSync(result.logFile, "utf8"), /^\[정리\] 보관 기간 30일이 지난 로그·리포트 2개를 삭제했습니다\.$/m);
};

// 실행 중에 바꾼 model·effort는 다음 회차부터 적용하고, 이전 실행의 변경 파일은 시작할 때 지운다.
const checkRoundOptions = async (runScenario, context) => {
    const readStartLines = (runData) => {
        return fs
            .readFileSync(runData.logFile, "utf8")
            .split("\n")
            .filter((line) => /^\[\d+회차\] 시작/.test(line));
    };
    const optionsRunData = await runScenario("options", { model: "haiku" });
    const startLines = readStartLines(optionsRunData);

    assert.match(startLines[0], /^\[1회차\] 시작 - 남은 시간 \d+분 \(model haiku, effort high\)/);
    assert.match(startLines[1], /^\[2회차\] 시작 - 남은 시간 \d+분 \(model sonnet, effort low\)/);
    assert.deepEqual(
        optionsRunData.rounds.map((round) => [round.model, round.effort]),
        [
            ["haiku", "high"],
            ["sonnet", "low"]
        ]
    );
    assert.match(fs.readFileSync(optionsRunData.reportFile, "utf8"), /sonnet low/);

    const staleRunData = await runScenario("idle", { roundOptionsContent: JSON.stringify({ model: "sonnet", effort: "max" }) });

    assert.match(readStartLines(staleRunData)[0], /\(model opus, effort high\)/);

    const brokenRunData = await runScenario("idle", { roundOptionsContent: "{broken" });

    assert.match(readStartLines(brokenRunData)[0], /\(model opus, effort high\)/);

    const { readRoundOptions, writeRoundOptions, getRoundOptionsFile } = autopilotUtil;
    const optionsProjectDir = path.join(context.testDir, "options project");
    const optionsWorkDir = path.join(optionsProjectDir, "autopilot");
    const roundOptionsFile = getRoundOptionsFile(optionsWorkDir);

    fs.mkdirSync(optionsProjectDir, { recursive: true });

    assert.deepEqual(readRoundOptions(roundOptionsFile), {});
    assert.deepEqual(writeRoundOptions(roundOptionsFile, { model: "sonnet" }), { model: "sonnet" });
    assert.deepEqual(writeRoundOptions(roundOptionsFile, { effort: "max" }), { model: "sonnet", effort: "max" });

    // 허용되지 않은 값은 걸러내고, 깨진 파일은 읽을 때 예외, 쓸 때 덮어쓰기다.
    fs.writeFileSync(roundOptionsFile, JSON.stringify({ model: "gpt", effort: "max", extra: 1 }));

    assert.deepEqual(readRoundOptions(roundOptionsFile), { effort: "max" });

    fs.writeFileSync(roundOptionsFile, "{broken");

    assert.throws(() => readRoundOptions(roundOptionsFile));
    assert.deepEqual(writeRoundOptions(roundOptionsFile, { model: "opus" }), { model: "opus" });

    // 실행 중인 AutoPilot이 있을 때만 변경을 받는다.
    fs.rmSync(roundOptionsFile);

    const missingResult = requestRoundOptions({ model: "sonnet" }, { projectDir: optionsProjectDir });

    assert.equal(missingResult.status, STATUS_FAILED);
    assert.match(missingResult.error.msg, /실행 중인 AutoPilot이 없습니다/);
    assert(!fs.existsSync(roundOptionsFile));

    const releaseLock = autopilotUtil.acquireRunLock(autopilotUtil.getLockFile(optionsWorkDir));
    const requestedResult = requestRoundOptions({ effort: "low" }, { projectDir: optionsProjectDir });

    releaseLock();

    assert.equal(requestedResult.status, STATUS_OK);
    assert.deepEqual(requestedResult.data.roundOptions, { effort: "low" });
    assert.deepEqual(readRoundOptions(roundOptionsFile), { effort: "low" });
};

// 정리 지시는 성공한 회차 전까지만 반복하고, 성공한 뒤에는 다시 넣지 않는다.
const checkProgressCleanupPrompt = async (runScenario) => {
    const longProgress = Array.from({ length: 250 }, (_, index) => `${index} 기록`).join("\n") + "\n";
    const readCleanupLog = (runData) => fs.readFileSync(path.join(runData.projectDir, "cleanup.log"), "utf8");

    // 정리를 지시했는데도 다음 회차에 여전히 넘으면 회차마다 정리만 반복하지 않도록 더 지시하지 않는다.
    const stuckRunData = await runScenario("commit", { progressContent: longProgress });

    assert.equal(readCleanupLog(stuckRunData), "100");
    assert.match(fs.readFileSync(stuckRunData.logFile, "utf8"), /^\[진행 기록\] 정리를 지시했지만 250줄이라, 100줄 아래로 내려갈 때까지 다시 지시하지 않습니다\.$/m);

    // 줄 수는 회차마다 확인한다. 상한 줄에서 시작해 회차마다 한 줄씩 늘면 상한을 넘은 다음 회차에 정리를 지시한다.
    const atLimitProgress = Array.from({ length: PROGRESS_MAX_LINES }, (_, index) => `${index} 기록`).join("\n") + "\n";
    const growingRunData = await runScenario("progress", { progressContent: atLimitProgress });

    assert.equal(readCleanupLog(growingRunData), "01");
    assert.match(fs.readFileSync(growingRunData.logFile, "utf8"), /^\[진행 기록\] 원본 보관: autopilot\/progress\//m);
    assert.match(fs.readFileSync(path.join(growingRunData.projectDir, "prompt.txt"), "utf8"), new RegExp(`${PROGRESS_TARGET_LINES}줄 안팎`));

    // 정리로 줄어든 기록이 다시 상한을 넘으면 다시 지시한다.
    assert.equal(readCleanupLog(await runScenario("regrow", { progressContent: longProgress })), "101");
    assert.equal(readCleanupLog(await runScenario("failure", { progressContent: longProgress, limits: FAILURE_LIMITS })), "1111");
    assert.equal(readCleanupLog(await runScenario("commit")), "000");
};

const checkRetriesAndRateLimit = async (runScenario) => {
    for (const mode of ["failure", "is-error"]) {
        const failedRunData = await runScenario(mode, { limits: FAILURE_LIMITS });

        assert.equal(failedRunData.exitCode, 1);
        assert.equal(failedRunData.rounds.length, 4);
    }

    const rateLimitedRunData = await runScenario("limit");

    assert.equal(rateLimitedRunData.exitCode, 0);
    assert.equal(rateLimitedRunData.rounds.length, 3);
    assert(rateLimitedRunData.rounds.every((round) => round.outcome === "사용량 한도"));
};

const checkTimeout = async (runScenario) => {
    const timeoutRunData = await runScenario("timeout", { limits: { minMinutes: 0, maxRounds: 1, maxRoundMinutes: 0.025, retryWaitMinutes: [] } });

    assert.equal(timeoutRunData.rounds.length, 1, timeoutRunData.reason);
    assert.equal(timeoutRunData.rounds[0].timedOut, true);

    const grandchildPid = Number(fs.readFileSync(path.join(timeoutRunData.projectDir, "grandchild.pid"), "utf8"));

    await waitForProcessStop(grandchildPid, "Timed-out grandchild is still running");
};

const checkInterrupt = async (scenarioRunner, signal) => {
    const interruptedProjectDir = scenarioRunner.getNextProjectDir();
    const signalTimer = setInterval(() => {
        if (fs.existsSync(path.join(interruptedProjectDir, "grandchild.pid"))) {
            clearInterval(signalTimer);

            process.emit(signal);
        }
    }, 50);
    let interruptedRunData;

    try {
        interruptedRunData = await scenarioRunner.runScenario("signal", { limits: { minMinutes: 0, maxRounds: 1, maxRoundMinutes: 1 } });
    } finally {
        clearInterval(signalTimer);
    }

    assert.equal(interruptedRunData.exitCode, 130);
    assert.match(interruptedRunData.reason, /중단 요청/);

    const grandchildPid = Number(fs.readFileSync(path.join(interruptedRunData.projectDir, "grandchild.pid"), "utf8"));

    await waitForProcessStop(grandchildPid, `${signal} interrupted grandchild is still running`);
};

const checkRunLock = async (context) => {
    const { acquireRunLock, getLockFile } = autopilotUtil;
    const lockProjectDir = path.join(context.testDir, "lock project");
    const lockWorkDir = path.join(lockProjectDir, "autopilot");
    const lockFile = getLockFile(lockWorkDir);
    const releaseLock = acquireRunLock(lockFile);

    assert.equal(fs.readFileSync(lockFile, "utf8"), `${process.pid}\n${path.basename(process.execPath)}`);
    assert.throws(() => acquireRunLock(lockFile), /이미 실행 중/);

    // 앱이 다시 연결할 수 있도록 로그 파일 위치를 잠금에 덧붙이고, 엔진이 실행 상태를 판정해 알려준다.
    const { getRunStatus, writeRunLockLogFile } = autopilotUtil;
    const logFile = path.join(lockProjectDir, "로그 폴더", "autopilot_120000_ab12cd34.log");

    assert.deepEqual(getRunStatus(lockFile), { running: true, pid: process.pid, logFile: "" });

    writeRunLockLogFile(lockFile, logFile);

    assert.equal(fs.readFileSync(lockFile, "utf8"), `${process.pid}\n${path.basename(process.execPath)}\n${logFile}`);
    assert.deepEqual(getRunStatus(lockFile), { running: true, pid: process.pid, logFile: logFile });
    assert.throws(() => acquireRunLock(lockFile), /이미 실행 중/);
    assert.deepEqual(fs.readdirSync(path.dirname(lockFile)), ["RUNNING"]);

    // 잠금이 있는 프로젝트는 STOP 파일 같은 실행 상태를 건드리지 않고 거부한다.
    const stopFile = autopilotUtil.getStopFile(lockWorkDir);

    fs.writeFileSync(stopFile, "");

    const lockedRunResult = await runAutopilot({ projectDir: lockProjectDir });

    assert.equal(lockedRunResult.status, STATUS_FAILED);
    assert.match(lockedRunResult.error.msg, /이미 실행 중/);
    assert(fs.existsSync(stopFile));
    assert(fs.existsSync(lockFile));

    releaseLock();

    assert(!fs.existsSync(lockFile));

    // 종료된 프로세스의 낡은 잠금은 덮어쓴다.
    fs.writeFileSync(lockFile, String(spawnSync(process.execPath, ["-e", ""]).pid));

    acquireRunLock(lockFile)();

    assert(!fs.existsSync(lockFile));

    // 살아 있는 pid라도 다른 프로그램이 재사용한 잠금은 덮어쓰고, 이름이 없는 이전 형식은 pid만 보고 거부한다.
    fs.writeFileSync(lockFile, `${process.pid}\nother-program`);

    acquireRunLock(lockFile)();

    assert(!fs.existsSync(lockFile));

    fs.writeFileSync(lockFile, String(process.pid));

    assert.throws(() => acquireRunLock(lockFile), /이미 실행 중/);
    assert(autopilotUtil.isRunLockActive(lockFile));

    fs.writeFileSync(lockFile, `${process.pid}\nother-program\n${logFile}`);

    assert(!autopilotUtil.isRunLockActive(lockFile));
    assert.deepEqual(getRunStatus(lockFile), { running: false });
    assert.deepEqual(getRunStatus(path.join(context.testDir, "missing-lock")), { running: false });
};

// 앱이 자식 프로세스로 쓰는 CLI 계약. 링크로 이어진 경로에서 실행해도 동작하고, 가짜 claude를 PATH에 둔 임시 프로젝트에서 시작·status·set·reset-progress·stop을 확인한다.
// appExe(Electron 앱 exe)를 주면 앱처럼 그 exe를 Node로(ELECTRON_RUN_AS_NODE) 실행한다. 패키징한 앱이면 번들된 엔진(resources/engine)을, 아니면 저장소의 엔진을 쓴다.
const checkCliRun = (context, fakeCliFile, appExe) => {
    const engineDir = path.resolve(import.meta.dirname, "../../autopilot");
    const linkedEngineDir = path.join(context.testDir, "linked engine");
    const command = appExe ? path.resolve(appExe) : process.execPath;
    const bundledEntryFile = appExe ? path.join(path.dirname(command), "resources", "engine", "core", "autopilot_loop.js") : "";
    const entryFile = bundledEntryFile && fs.existsSync(bundledEntryFile) ? bundledEntryFile : path.join(linkedEngineDir, "core", "autopilot_loop.js");
    const projectDir = path.join(context.testDir, "cli project 한글");
    const workDir = path.join(projectDir, "autopilot");
    const dataDir = path.join(context.testDir, "cli appdata");
    const binDir = path.join(context.testDir, "fake-bin");
    const claudeWrapper = path.join(binDir, process.platform === "win32" ? "claude.cmd" : "claude");
    const tasksFile = path.join(context.testDir, "tasks 한글.md");

    fs.symlinkSync(engineDir, linkedEngineDir, "junction");
    fs.mkdirSync(binDir);
    fs.mkdirSync(dataDir);
    fs.mkdirSync(projectDir);
    fs.writeFileSync(path.join(projectDir, "work.txt"), "initial");
    fs.writeFileSync(tasksFile, "\uFEFF첫째 작업\n둘째 작업");

    commitInitialProject(context, projectDir);

    if (process.platform === "win32") {
        writeCmdWrapper(claudeWrapper, fakeCliFile);
    } else {
        fs.writeFileSync(claudeWrapper, `#!/bin/sh\nexec "${process.execPath}" "${fakeCliFile}" "$@"\n`);
    }

    fs.chmodSync(claudeWrapper, 0o755);

    const cliEnv = { ...context.testEnv, AP_MODE: "todo", AP_EXPECTED_CWD: projectDir, AP_GIT: context.gitExecutable, APPDATA: dataDir };

    if (appExe) {
        cliEnv.ELECTRON_RUN_AS_NODE = "1";
    }
    const pathKey = Object.keys(cliEnv).find((key) => key.toUpperCase() === "PATH");

    cliEnv[pathKey] = binDir + path.delimiter + cliEnv[pathKey];

    const runCli = (args) => spawnSync(command, [entryFile, ...args], { cwd: context.testDir, env: cliEnv, encoding: "utf8", timeout: 30000, windowsHide: true });
    const projectArgs = ["--project", projectDir];

    const helpResult = runCli(["--help"]);

    assert.equal(helpResult.status, 0, helpResult.stderr);
    assert.match(helpResult.stdout, /AutoPilot --project/);
    assert.match(helpResult.stdout, /--tasks-file/);
    assert.match(helpResult.stdout, /reset-progress/);

    // 프로젝트가 없거나 이전 형식의 인자는 거부한다.
    for (const invalidArgs of [[], [getEndTime(), "todo", "--no-open"], ["status"], ["stop"], ["--version"], ["--project", path.join(context.testDir, "missing")]]) {
        assert.equal(runCli(invalidArgs).status, 1, invalidArgs.join(" "));
    }

    // 지시개선은 작업 파일이 있어야 하고, 작업 파일이 없으면 시작하지 않는다.
    const noTasksResult = runCli([...projectArgs, "--end-time", getEndTime(), "--policy", "todo", "--no-open"]);

    assert.equal(noTasksResult.status, 1);
    assert.match(noTasksResult.stderr, /작업이 필요/);
    assert.equal(runCli([...projectArgs, "--tasks-file", path.join(context.testDir, "missing.md"), "--no-open"]).status, 1);

    const result = runCli([...projectArgs, "--end-time", getEndTime(), "--policy", "todo", "--tasks-file", tasksFile, "--no-open"]);

    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.match(result.stdout, /예약 작업 완료/);
    assert.match(fs.readFileSync(path.join(projectDir, "prompt.txt"), "utf8"), /<TASKS>\n첫째 작업\n둘째 작업\n<\/TASKS>/);
    assert.match(fs.readFileSync(path.join(projectDir, "prompt.txt"), "utf8"), /<AUTOPILOT_POLICY\.md>\s+# AutoPilot Policy/);

    // 진행 기록은 앱 데이터 폴더(APPDATA)에 만든다.
    const progressFile = autopilotUtil.getProgressFile(projectDir, dataDir);

    assert(fs.existsSync(progressFile));
    assert(!fs.existsSync(path.join(workDir, "AUTOPILOT_PROGRESS.md")));

    // 실행 중이 아닐 때 set은 실패하고, 잘못된 값은 거부한다.
    const idleSetResult = runCli(["set", ...projectArgs, "--model", "sonnet"]);

    assert.equal(idleSetResult.status, 1);
    assert.match(idleSetResult.stderr, /실행 중인 AutoPilot이 없습니다/);
    assert.equal(runCli(["set", ...projectArgs, "--model", "gpt"]).status, 1);
    assert.equal(runCli(["set", ...projectArgs]).status, 1);

    // 앱이 연결 여부를 판단하는 status는 한 줄 JSON으로 답하고, 실행 중이 아니면 running이 false다.
    const statusResult = runCli(["status", ...projectArgs]);

    assert.equal(statusResult.status, 0, statusResult.stderr);
    assert.deepEqual(JSON.parse(statusResult.stdout), { running: false });
    assert.equal(runCli(["status", ...projectArgs, "extra"]).status, 1);

    // reset-progress는 실행 중이 아닐 때 원본을 보관하고 진행 기록을 초기화한다.
    fs.writeFileSync(progressFile, UNFINISHED_RECORD);

    const resetResult = runCli(["reset-progress", ...projectArgs]);

    assert.equal(resetResult.status, 0, resetResult.stderr);
    assert.match(resetResult.stdout, /Progress record reset\. Original archived: autopilot\/progress\//);
    assert(fs.readFileSync(progressFile, "utf8").startsWith(progressUtil.PROGRESS_TEMPLATE));
    assert.equal(runCli(["reset-progress", ...projectArgs, "extra"]).status, 1);

    assert.equal(runCli(["stop", ...projectArgs]).status, 0);
    assert(fs.existsSync(path.join(workDir, "progress", "STOP")));
};

const createSessionOptions = (context, sessionDir, mode) => {
    return {
        projectDir: sessionDir,
        processEnv: { ...context.testEnv, AP_EXPECTED_CWD: sessionDir, AP_MODE: mode },
        roundDeadline: Date.now() + 10000,
        sessionStats: {},
        writeLog: () => {},
        onProcessChange: () => {}
    };
};

const checkSessionRunner = async (context, fakeCliFile) => {
    const { runClaudeSession } = processUtil;

    // CLI가 먼저 끝나면 손자 프로세스가 붙잡은 파이프를 기다리지 않는다.
    const pipesDir = path.join(context.testDir, "pipes");
    const startTime = Date.now();

    fs.mkdirSync(pipesDir);

    await runClaudeSession(process.execPath, [fakeCliFile], "stdin & | < > 한글", createSessionOptions(context, pipesDir, "pipes"));

    assert(Date.now() - startTime < 2500, "Inherited pipes delayed completion");

    try {
        process.kill(Number(fs.readFileSync(path.join(pipesDir, "grandchild.pid"), "utf8")));
    } catch {}

    if (process.platform === "win32") {
        const wrapperDir = path.join(context.testDir, "wrapper");
        const wrapperFile = path.join(context.testDir, "fake wrapper.cmd");

        fs.mkdirSync(wrapperDir);
        writeCmdWrapper(wrapperFile, fakeCliFile);

        const wrapperResult = await runClaudeSession(wrapperFile, ["-p"], "stdin & | < > 한글", createSessionOptions(context, wrapperDir, "idle"));

        assert.equal(wrapperResult.exitCode, 0);
        assert.equal(fs.readFileSync(path.join(wrapperDir, "prompt.txt"), "utf8"), "stdin & | < > 한글");
    }

    const missingError = await runClaudeSession(path.join(context.testDir, "missing-executable"), [], "", {
        ...createSessionOptions(context, context.testDir, "idle"),
        processEnv: context.testEnv,
        roundDeadline: Date.now() + 1000
    }).then(
        () => null,
        (error) => error
    );

    assert.equal(missingError.code, "ENOENT");
};

export {
    createScenarioRunner,
    checkRoundOutcomes,
    checkLogRetention,
    checkProgressResetFlow,
    checkProgressCreated,
    checkTasksRequired,
    checkProgressResetCommand,
    checkRoundOptions,
    checkProgressCleanupPrompt,
    checkRetriesAndRateLimit,
    checkTimeout,
    checkInterrupt,
    checkRunLock,
    checkCliRun,
    checkSessionRunner
};

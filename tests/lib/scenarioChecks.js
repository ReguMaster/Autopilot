import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { STATUS_OK, STATUS_FAILED } from "../../autopilot/src/utils/config.js";
import { runAutopilot, requestRoundOptions } from "../../autopilot/src/services/autopilotService.js";
import processUtil from "../../autopilot/src/utils/processUtil.js";
import autopilotUtil from "../../autopilot/src/utils/autopilotUtil.js";
import dateUtil from "../../autopilot/src/utils/dateUtil.js";
import { readJsonFile, getEndTime, waitForProcessStop, commitInitialProject, writeCmdWrapper } from "./fixtures.js";

const require = createRequire(import.meta.url);
const { createInitialState, parseLine } = require("../../desktop/autopilotRunner.cjs");

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
    let scenarioCount = 0;

    const getNextProjectDir = () => {
        return path.join(context.testDir, `project ${scenarioCount + 1} 한글`);
    };

    const runScenario = async (mode, { progressContent = "initial\n", roundOptionsContent = "", staleFiles = [], ...testOptions } = {}) => {
        const projectDir = getNextProjectDir();
        const kitDir = path.join(projectDir, "autopilot");

        scenarioCount++;

        fs.mkdirSync(kitDir, { recursive: true });
        fs.writeFileSync(path.join(kitDir, "AUTOPILOT_PROGRESS.md"), progressContent);
        fs.writeFileSync(path.join(projectDir, "work.txt"), "initial\n");

        if (roundOptionsContent) {
            fs.mkdirSync(path.join(kitDir, "progress"), { recursive: true });
            fs.writeFileSync(path.join(kitDir, "progress", "ROUND_OPTIONS.json"), roundOptionsContent);
        }

        for (const staleFile of staleFiles) {
            fs.mkdirSync(path.dirname(path.join(kitDir, staleFile)), { recursive: true });
            fs.writeFileSync(path.join(kitDir, staleFile), "");
        }

        commitInitialProject(context, projectDir);

        const runAutopilotResult = await runAutopilot({
            kitDir: kitDir,
            command: process.execPath,
            commandArgs: [fakeCliFile],
            open: false,
            endTime: getEndTime(),
            env: { ...context.testEnv, AP_MODE: mode, AP_EXPECTED_CWD: projectDir, AP_GIT: context.gitExecutable },
            limits: { minMinutes: 0, maxRounds: 3, maxRoundMinutes: 1, retryWaitMinutes: [0, 0, 0], resetGraceMs: 0, ...testOptions.limits },
            ...testOptions
        });

        assert(runAutopilotResult.data, runAutopilotResult.error?.msg);

        const result = runAutopilotResult.data;

        assert.equal(runAutopilotResult.status, result.exitCode === 0 ? STATUS_OK : STATUS_FAILED);
        assert.match(fs.readFileSync(path.join(projectDir, "prompt.txt"), "utf8"), /<AUTOPILOT_POLICY\.md>\s+# AutoPilot Policy/);

        if (!["limit", "timeout", "signal"].includes(mode)) {
            assert.match(fs.readFileSync(result.reportFile, "utf8"), /&lt;script&gt;/);
        }

        assert.match(fs.readFileSync(result.logFile, "utf8"), /한글 출력/);

        checkDesktopLogContract(result);

        // 실행 중 잠금에는 pid, 실행 파일 이름, 이번 실행의 로그 파일이 있어야 앱이 다시 연결할 수 있다.
        assert.deepEqual(fs.readFileSync(path.join(projectDir, "lock-snapshot.txt"), "utf8").split("\n"), [String(process.pid), path.basename(process.execPath), result.logFile]);

        return result;
    };

    return { runScenario: runScenario, getNextProjectDir: getNextProjectDir };
};

const checkRoundOutcomes = async (runScenario) => {
    const idleRunData = await runScenario("idle");

    assert.equal(idleRunData.rounds.length, 2);
    assert.match(idleRunData.reason, /새 commit 없음/);
    assert.match(idleRunData.rounds[0].stderr, /fake stderr 한글/);
    assert.match(fs.readFileSync(idleRunData.logFile, "utf8"), /^\[stderr\] fake stderr 한글\n {4}Report : \/forged-stderr$/m);

    const commitRunData = await runScenario("commit");

    assert.equal(commitRunData.rounds.length, 3);
    assert.equal(commitRunData.rounds.at(-1).outcome, "완료");
    assert.equal(
        commitRunData.rounds.reduce((sum, round) => sum + round.commits.length, 0),
        3
    );

    assert.match((await runScenario("progress")).reason, /새 commit 없음/);
    assert.match((await runScenario("todo", { policy: "todo" })).reason, /예약 작업 완료/);
    assert.match((await runScenario("stop")).reason, /중단 요청/);
};

// 실행 중에 바꾼 model·effort는 다음 회차부터 적용하고, 이전 실행의 변경 파일은 시작할 때 지운다.
// 보관 기간이 지난 로그·리포트는 실행을 시작할 때 지우고, 최근 파일과 보관한 진행 기록은 남긴다.
const checkLogRetention = async (runScenario) => {
    const yesterday = dateUtil.getDateString(new Date(Date.now() - 24 * 60 * 60 * 1000));
    const staleLog = "progress/2020-01-01/autopilot_000000_aaaa1111.log";
    const staleReport = "progress/2020-01-01/report_000000_aaaa1111.html";
    const archivedRecord = "progress/2020-01-01/AUTOPILOT_PROGRESS_aaaa1111.md";
    const recentLog = `progress/${yesterday}/autopilot_000000_bbbb2222.log`;
    const result = await runScenario("idle", { staleFiles: [staleLog, staleReport, archivedRecord, recentLog] });
    const kitFile = (relativePath) => path.join(result.projectDir, "autopilot", relativePath);

    assert(!fs.existsSync(kitFile(staleLog)));
    assert(!fs.existsSync(kitFile(staleReport)));
    assert(fs.existsSync(kitFile(archivedRecord)));
    assert(fs.existsSync(kitFile(recentLog)));
    assert.match(fs.readFileSync(result.logFile, "utf8"), /^\[정리\] 보관 기간 30일이 지난 로그·리포트 2개를 삭제했습니다\.$/m);
};

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
    const optionsKitDir = path.join(context.testDir, "options project", "autopilot");
    const roundOptionsFile = getRoundOptionsFile(optionsKitDir);

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

    const missingResult = requestRoundOptions({ model: "sonnet" }, { kitDir: optionsKitDir });

    assert.equal(missingResult.status, STATUS_FAILED);
    assert.match(missingResult.error.msg, /실행 중인 AutoPilot이 없습니다/);
    assert(!fs.existsSync(roundOptionsFile));

    const releaseLock = autopilotUtil.acquireRunLock(autopilotUtil.getLockFile(optionsKitDir));
    const requestedResult = requestRoundOptions({ effort: "low" }, { kitDir: optionsKitDir });

    releaseLock();

    assert.equal(requestedResult.status, STATUS_OK);
    assert.deepEqual(requestedResult.data.roundOptions, { effort: "low" });
    assert.deepEqual(readRoundOptions(roundOptionsFile), { effort: "low" });
};

// 정리 지시는 성공한 회차 전까지만 반복하고, 성공한 뒤에는 다시 넣지 않는다.
const checkProgressCleanupPrompt = async (runScenario) => {
    const longProgress = Array.from({ length: 250 }, (_, index) => `${index} 기록`).join("\n") + "\n";
    const readCleanupLog = (runData) => fs.readFileSync(path.join(runData.projectDir, "cleanup.log"), "utf8");

    assert.equal(readCleanupLog(await runScenario("commit", { progressContent: longProgress })), "100");
    assert.equal(readCleanupLog(await runScenario("failure", { progressContent: longProgress, limits: { minMinutes: 0, maxRounds: 5, maxRoundMinutes: 1, retryWaitMinutes: [0, 0, 0] } })), "1111");
    assert.equal(readCleanupLog(await runScenario("commit")), "000");
};

const checkRetriesAndRateLimit = async (runScenario) => {
    for (const mode of ["failure", "is-error"]) {
        const failedRunData = await runScenario(mode, { limits: { minMinutes: 0, maxRounds: 5, maxRoundMinutes: 1, retryWaitMinutes: [0, 0, 0] } });

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
    const lockKitDir = path.join(context.testDir, "lock project", "autopilot");
    const lockFile = getLockFile(lockKitDir);
    const releaseLock = acquireRunLock(lockFile);

    assert.equal(fs.readFileSync(lockFile, "utf8"), `${process.pid}\n${path.basename(process.execPath)}`);
    assert.throws(() => acquireRunLock(lockFile), /이미 실행 중/);

    // 앱이 다시 연결할 수 있도록 로그 파일 위치를 잠금에 덧붙이고, 엔진이 실행 상태를 판정해 알려준다.
    const { getRunStatus, writeRunLockLogFile } = autopilotUtil;
    const logFile = path.join(context.testDir, "lock project", "로그 폴더", "autopilot_120000_ab12cd34.log");

    assert.deepEqual(getRunStatus(lockFile), { running: true, pid: process.pid, logFile: "" });

    writeRunLockLogFile(lockFile, logFile);

    assert.equal(fs.readFileSync(lockFile, "utf8"), `${process.pid}\n${path.basename(process.execPath)}\n${logFile}`);
    assert.deepEqual(getRunStatus(lockFile), { running: true, pid: process.pid, logFile: logFile });
    assert.throws(() => acquireRunLock(lockFile), /이미 실행 중/);
    assert.deepEqual(fs.readdirSync(path.dirname(lockFile)), ["RUNNING"]);

    // 잠금이 있는 키트는 STOP 파일 같은 실행 상태를 건드리지 않고 거부한다.
    const stopFile = autopilotUtil.getStopFile(lockKitDir);

    fs.writeFileSync(stopFile, "");

    const lockedRunResult = await runAutopilot({ kitDir: lockKitDir });

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

// 심볼릭 링크나 junction 경로로 실행해도 CLI가 동작해야 한다.
const checkCliEntry = (context) => {
    const kitDir = path.resolve(import.meta.dirname, "../../autopilot");
    const linkedKitDir = path.join(context.testDir, "linked kit");

    fs.symlinkSync(kitDir, linkedKitDir, "junction");

    const helpResult = spawnSync(process.execPath, [path.join(linkedKitDir, "core", "autopilot_loop.js"), "--help"], { encoding: "utf8", windowsHide: true });

    assert.equal(helpResult.status, 0, helpResult.stderr);
    assert.match(helpResult.stdout, /AutoPilot \[HH:mm\]/);
    assert.match(helpResult.stdout, /--version/);

    // 키트와 데스크톱 앱은 함께 배포하므로 버전이 같아야 한다.
    const kitVersion = readJsonFile("autopilot/package.json").version;
    const versionResult = spawnSync(process.execPath, [path.join(linkedKitDir, "core", "autopilot_loop.js"), "--version"], { encoding: "utf8", windowsHide: true });

    assert.equal(versionResult.status, 0, versionResult.stderr);
    assert.equal(versionResult.stderr, "");
    assert.equal(versionResult.stdout.trim(), kitVersion);
    assert.equal(kitVersion, readJsonFile("package.json").version);
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

// SEA로 빌드한 실행 파일이 PATH의 가짜 claude를 실행하는지 확인한다.
const checkBinary = (context, fakeCliFile, binaryPath) => {
    const projectDir = path.join(context.testDir, "binary project 한글");
    const kitDir = path.join(projectDir, "autopilot");
    const executable = path.join(kitDir, process.platform === "win32" ? "autopilot.exe" : "autopilot");
    const binDir = path.join(context.testDir, "fake-bin");
    const claudeWrapper = path.join(binDir, process.platform === "win32" ? "claude.cmd" : "claude");

    fs.mkdirSync(kitDir, { recursive: true });
    fs.copyFileSync(path.resolve(binaryPath), executable);
    fs.chmodSync(executable, 0o755);
    fs.writeFileSync(path.join(projectDir, "work.txt"), "initial");

    commitInitialProject(context, projectDir);

    fs.mkdirSync(binDir);

    if (process.platform === "win32") {
        writeCmdWrapper(claudeWrapper, fakeCliFile);
    } else {
        fs.writeFileSync(claudeWrapper, `#!/bin/sh\nexec "${process.execPath}" "${fakeCliFile}" "$@"\n`);
    }

    fs.chmodSync(claudeWrapper, 0o755);

    const binaryEnv = { ...context.testEnv, AP_MODE: "todo", AP_EXPECTED_CWD: projectDir, AP_GIT: context.gitExecutable };
    const pathKey = Object.keys(binaryEnv).find((key) => key.toUpperCase() === "PATH");

    binaryEnv[pathKey] = binDir + path.delimiter + binaryEnv[pathKey];

    const result = spawnSync(executable, [getEndTime(), "todo", "--no-open"], { cwd: context.testDir, env: binaryEnv, encoding: "utf8", timeout: 15000, windowsHide: true });

    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.match(result.stdout, /예약 작업 완료/);
    assert.match(fs.readFileSync(path.join(projectDir, "prompt.txt"), "utf8"), /<AUTOPILOT_POLICY\.md>\s+# AutoPilot Policy/);

    // 실행 중이 아닐 때 set은 실패하고, 잘못된 값은 거부한다.
    const idleSetResult = spawnSync(executable, ["set", "--model", "sonnet"], { cwd: context.testDir, env: binaryEnv, encoding: "utf8", windowsHide: true });

    assert.equal(idleSetResult.status, 1);
    assert.match(idleSetResult.stderr, /실행 중인 AutoPilot이 없습니다/);
    assert.equal(spawnSync(executable, ["set", "--model", "gpt"], { cwd: context.testDir, env: binaryEnv, windowsHide: true }).status, 1);

    // 앱이 연결 여부를 판단하는 status는 한 줄 JSON으로 답하고, 실행 중이 아니면 running이 false다.
    const statusResult = spawnSync(executable, ["status"], { cwd: context.testDir, env: binaryEnv, encoding: "utf8", windowsHide: true });

    assert.equal(statusResult.status, 0, statusResult.stderr);
    assert.deepEqual(JSON.parse(statusResult.stdout), { running: false });
    assert.equal(spawnSync(executable, ["status", "extra"], { cwd: context.testDir, env: binaryEnv, windowsHide: true }).status, 1);
    assert.equal(execFileSync(executable, ["--version"], { encoding: "utf8", windowsHide: true }).trim(), readJsonFile("autopilot/package.json").version);

    execFileSync(executable, ["stop"], { cwd: context.testDir, env: binaryEnv });

    assert(fs.existsSync(path.join(kitDir, "progress", "STOP")));
};

export {
    createScenarioRunner,
    checkRoundOutcomes,
    checkLogRetention,
    checkRoundOptions,
    checkProgressCleanupPrompt,
    checkRetriesAndRateLimit,
    checkTimeout,
    checkInterrupt,
    checkRunLock,
    checkCliEntry,
    checkSessionRunner,
    checkBinary
};

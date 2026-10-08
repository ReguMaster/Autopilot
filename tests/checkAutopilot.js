import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { STATUS_OK, STATUS_FAILED } from "../autopilot/src/utils/config.js";
import { runAutopilot } from "../autopilot/src/services/autopilotService.js";

import settingsUtil from "../autopilot/src/utils/settingsUtil.js";
import cliUtil from "../autopilot/src/utils/cliUtil.js";
import progressUtil from "../autopilot/src/utils/progressUtil.js";
import streamUtil from "../autopilot/src/utils/streamUtil.js";
import processUtil from "../autopilot/src/utils/processUtil.js";
import autopilotUtil from "../autopilot/src/utils/autopilotUtil.js";

const BOM = String.fromCodePoint(0xfeff);
const HOUR_MS = 60 * 60 * 1000;

// 실제 Claude 대신 회차마다 실행되는 가짜 CLI. AP_MODE로 동작을 고른다.
const FAKE_CLI_SOURCE = String.raw`
import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
if (process.cwd() !== process.env.AP_EXPECTED_CWD) process.exit(99);
let prompt = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => prompt += chunk);
process.stdin.on('end', () => {
  fs.writeFileSync('prompt.txt', prompt);
  fs.appendFileSync('cleanup.log', /AUTOPILOT_PROGRESS_[0-9a-f-]{36}\.md/.test(prompt) ? '1' : '0');
  const mode = process.env.AP_MODE;
  const emit = value => console.log(JSON.stringify(value));
  emit({ type: 'system', subtype: 'init', session_id: 'fake-session' });
  emit({ type: 'assistant', message: { content: [{ type: 'text', text: '한글 출력 <script>bad</script>' }] } });
  if (mode === 'timeout' || mode === 'signal') {
    const grandchild = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'inherit' });
    fs.writeFileSync('grandchild.pid', String(grandchild.pid));
    setInterval(() => emit({ type: 'assistant', message: { content: [{ type: 'text', text: 'busy' }] } }), 10);
    return;
  }
  if (mode === 'pipes') {
    const child = spawn(process.execPath, ['-e', 'setTimeout(()=>process.exit(),3000)'], { stdio: 'inherit' });
    fs.writeFileSync('grandchild.pid', String(child.pid));
    process.exit(0);
  }
  if (mode === 'limit') {
    emit({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: Date.now() / 1000 + 0.05 } });
    emit({ type: 'result', is_error: true, result: 'limit' });
    process.exitCode = 1;
  } else if (mode === 'commit' || mode === 'progress') {
    const file = mode === 'commit' ? 'work.txt' : 'autopilot/AUTOPILOT_PROGRESS.md';
    fs.appendFileSync(file, 'work\n');
    execFileSync(process.env.AP_GIT, ['add', '--', file]);
    execFileSync(process.env.AP_GIT, ['commit', '-m', '[ap] fake']);
  } else if (mode === 'todo') {
    const marker = prompt.match(/빈 파일 (autopilot\/progress\/[^ ]+\/TODO_COMPLETE)/)[1];
    fs.writeFileSync(marker, '');
  } else if (mode === 'stop') fs.writeFileSync('autopilot/progress/STOP', '');
  if (mode === 'failure') process.exitCode = 1;
  if (mode !== 'limit') emit({ type: 'result', subtype: 'success', is_error: mode === 'is-error', num_turns: 1, duration_ms: 10, total_cost_usd: 0.25, result: '검증 <script>' });
  console.error('fake stderr 한글');
});
`;

const wait = (ms) => {
    return new Promise((resolve) => setTimeout(resolve, ms));
};

const getEndTime = () => {
    const endDate = new Date(Date.now() + HOUR_MS);

    return `${String(endDate.getHours()).padStart(2, "0")}:${String(endDate.getMinutes()).padStart(2, "0")}`;
};

const isProcessStopped = (pid) => {
    try {
        process.kill(pid, 0);

        return process.platform === "linux" && /\) Z /.test(fs.readFileSync(`/proc/${pid}/stat`, "utf8"));
    } catch (error) {
        if (["ESRCH", "ENOENT"].includes(error.code)) {
            return true;
        }

        throw error;
    }
};

const createTestContext = (testDir) => {
    const testEnv = { ...process.env, GIT_CONFIG_GLOBAL: path.join(testDir, "gitconfig"), GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" };

    fs.writeFileSync(testEnv.GIT_CONFIG_GLOBAL, "");

    const gitExecutable = processUtil.getExecutablePath("git", testEnv);
    const git = (cwd, ...args) => {
        return execFileSync(gitExecutable, args, { cwd: cwd, env: testEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    };

    return { testDir: testDir, testEnv: testEnv, gitExecutable: gitExecutable, git: git };
};

const commitInitialProject = (context, projectDir) => {
    const { git } = context;

    git(projectDir, "init", "--initial-branch=main");
    git(projectDir, "config", "user.name", "AutoPilot Check");
    git(projectDir, "config", "user.email", "check@example.invalid");
    git(projectDir, "add", ".");
    git(projectDir, "commit", "-m", "initial");
};

const writeCmdWrapper = (wrapperFile, fakeCliFile) => {
    fs.writeFileSync(wrapperFile, `@echo off\r\n"${process.execPath}" "${fakeCliFile}" %*\r\n`);
};

const checkInvalidKit = async (context, errorMessages) => {
    const invalidRunResult = await runAutopilot({ kitDir: path.join(context.testDir, "missing") });

    assert.equal(invalidRunResult.status, STATUS_FAILED);
    assert.equal(invalidRunResult.error.code, "AUTOPILOT_ERROR");
    assert.equal(invalidRunResult.data, undefined);
    assert(errorMessages.some((message) => message.includes("키트를 대상 프로젝트")));
};

const checkRunSettings = () => {
    const { getRunSettings } = settingsUtil;
    const now = new Date(2026, 9, 8, 12, 0, 0);
    const runSettings = getRunSettings("## 실행시간\r\n1999년 오후 4시 30분까지\r\n## 정책\r\n\r\n지시개선\r\n", "", "", now);

    assert.equal(runSettings.deadline.getHours(), 16);
    assert.equal(runSettings.deadline.getMinutes(), 30);
    assert.equal(runSettings.policy, "지시개선");
    assert.equal(getRunSettings("", "07:00", "", now).deadline.getDate(), 9);
    assert.equal(getRunSettings("## 정책\n자율개선 대신 지시개선으로\n", "", "", now).policy, "자율개선");
    assert.equal(getRunSettings("## 정책\n**지시개선**\n", "23:00", "AUTO", now).policy, "자율개선");
    assert.equal(getRunSettings("## 실행시간\n오전 12시\n", "", "", now).deadline.getHours(), 0);
    assert.equal(getRunSettings("## 실행시간\n오후 12시\n", "", "", now).deadline.getHours(), 12);

    for (const invalidEndTime of ["24:00", "12:60", "1:00", "nope"]) {
        assert.throws(() => getRunSettings("", invalidEndTime));
    }

    assert.throws(() => getRunSettings("", "", "not-todo"));
    assert.throws(() => getRunSettings("", "", "constructor"));
};

const checkCommandArgs = () => {
    const { parseCommandArgs } = cliUtil;

    assert.throws(() => parseCommandArgs(["--effort", "high & echo bad"]));
    assert.throws(() => parseCommandArgs(["--unknown"]));
    assert.throws(() => parseCommandArgs(["23:00", "todo", "extra"]));
    assert.equal(parseCommandArgs(["constructor"]).endTime, "constructor");
    assert.equal(parseCommandArgs(["23:00", "todo", "--no-open"]).open, false);
};

const checkProgressArchive = (context) => {
    const { archiveProgressRecord } = progressUtil;
    const archiveKit = path.join(context.testDir, "archive");
    const archiveDir = path.join(archiveKit, "progress");
    const progressFile = path.join(archiveKit, "AUTOPILOT_PROGRESS.md");

    fs.mkdirSync(archiveDir, { recursive: true });

    assert.equal(
        archiveProgressRecord(archiveKit, archiveDir, "test", () => {}),
        ""
    );

    // 200줄은 그대로 두고 201줄부터 보관한다.
    for (const lineCount of [200, 201]) {
        const content = BOM + Array.from({ length: lineCount }, (_, index) => `${index} 한글`).join("\r\n") + "\r\n";

        fs.writeFileSync(progressFile, content);

        const cleanupPrompt = archiveProgressRecord(archiveKit, archiveDir, "test", () => {});

        assert.equal(Boolean(cleanupPrompt), lineCount === 201);
        assert.equal(fs.readFileSync(progressFile, "utf8"), content);

        if (lineCount === 201) {
            assert.equal(fs.readFileSync(path.join(archiveDir, fs.readdirSync(archiveDir)[0]), "utf8"), content);
        }
    }

    assert.equal(
        archiveProgressRecord(archiveKit, path.join(context.testDir, "missing"), "test", () => {}),
        ""
    );
};

const checkStreamEvent = () => {
    const { handleStreamEvent } = streamUtil;
    const sessionStats = {};

    handleStreamEvent(JSON.stringify({ type: "rate_limit_event", rate_limit_info: { status: "allowed", resetsAt: 123 } }), sessionStats, () => {});

    assert.equal(sessionStats.resetAt, 123000);
    assert.equal(sessionStats.limitHit, undefined);

    handleStreamEvent(JSON.stringify({ type: "rate_limit_event", rate_limit_info: { status: "rejected" } }), sessionStats, () => {});

    assert.equal(sessionStats.limitHit, true);

    // JSON이지만 이벤트가 아닌 줄은 무시한다.
    for (const ignoredLine of ["null", "123", "not json"]) {
        handleStreamEvent(ignoredLine, sessionStats, () => {});
    }
};

const createScenarioRunner = (context, fakeCliFile) => {
    let scenarioCount = 0;

    const getNextProjectDir = () => {
        return path.join(context.testDir, `project ${scenarioCount + 1} 한글`);
    };

    const runScenario = async (mode, { progressContent = "initial\n", ...testOptions } = {}) => {
        const projectDir = getNextProjectDir();
        const kitDir = path.join(projectDir, "autopilot");

        scenarioCount++;

        fs.mkdirSync(kitDir, { recursive: true });
        fs.writeFileSync(path.join(kitDir, "AUTOPILOT_PROGRESS.md"), progressContent);
        fs.writeFileSync(path.join(projectDir, "work.txt"), "initial\n");

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

        return result;
    };

    return { runScenario: runScenario, getNextProjectDir: getNextProjectDir };
};

const checkRoundOutcomes = async (runScenario) => {
    const idleRunData = await runScenario("idle");

    assert.equal(idleRunData.rounds.length, 2);
    assert.match(idleRunData.reason, /새 commit 없음/);
    assert.match(idleRunData.rounds[0].stderr, /fake stderr 한글/);

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

    await wait(100);

    const grandchildPid = Number(fs.readFileSync(path.join(timeoutRunData.projectDir, "grandchild.pid"), "utf8"));

    assert(isProcessStopped(grandchildPid), "Timed-out grandchild is still running");
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

    await wait(100);

    const grandchildPid = Number(fs.readFileSync(path.join(interruptedRunData.projectDir, "grandchild.pid"), "utf8"));

    assert(isProcessStopped(grandchildPid), `${signal} interrupted grandchild is still running`);
};

const checkRunLock = async (context) => {
    const { acquireRunLock, getLockFile } = autopilotUtil;
    const lockKitDir = path.join(context.testDir, "lock project", "autopilot");
    const lockFile = getLockFile(lockKitDir);
    const releaseLock = acquireRunLock(lockFile);

    assert.equal(fs.readFileSync(lockFile, "utf8"), String(process.pid));
    assert.throws(() => acquireRunLock(lockFile), /이미 실행 중/);

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
};

// 심볼릭 링크나 junction 경로로 실행해도 CLI가 동작해야 한다.
const checkCliEntry = (context) => {
    const kitDir = path.resolve(import.meta.dirname, "../autopilot");
    const linkedKitDir = path.join(context.testDir, "linked kit");

    fs.symlinkSync(kitDir, linkedKitDir, "junction");

    const helpResult = spawnSync(process.execPath, [path.join(linkedKitDir, "core", "autopilot_loop.js"), "--help"], { encoding: "utf8", windowsHide: true });

    assert.equal(helpResult.status, 0, helpResult.stderr);
    assert.match(helpResult.stdout, /AutoPilot \[HH:mm\]/);
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

    execFileSync(executable, ["stop"], { cwd: context.testDir, env: binaryEnv });

    assert(fs.existsSync(path.join(kitDir, "progress", "STOP")));
};

const checkAutopilot = async () => {
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "ap-node-check-"));
    const originalConsoleLog = console.log;
    const originalConsoleError = console.error;
    const errorMessages = [];
    const context = createTestContext(testDir);

    try {
        console.log = () => {};
        console.error = (message) => errorMessages.push(String(message));

        await checkInvalidKit(context, errorMessages);

        checkRunSettings();
        checkCommandArgs();
        checkProgressArchive(context);
        checkStreamEvent();

        const fakeCliFile = path.join(testDir, "fake.mjs");

        fs.writeFileSync(fakeCliFile, FAKE_CLI_SOURCE);

        const scenarioRunner = createScenarioRunner(context, fakeCliFile);

        await checkRoundOutcomes(scenarioRunner.runScenario);
        await checkRetriesAndRateLimit(scenarioRunner.runScenario);
        await checkTimeout(scenarioRunner.runScenario);
        await checkProgressCleanupPrompt(scenarioRunner.runScenario);
        await checkInterrupt(scenarioRunner, "SIGINT");
        await checkInterrupt(scenarioRunner, "SIGHUP");
        await checkRunLock(context);
        checkCliEntry(context);
        await checkSessionRunner(context, fakeCliFile);

        if (process.argv[2]) {
            checkBinary(context, fakeCliFile, process.argv[2]);
        }

        originalConsoleLog(
            "OK: parsing, archive, UTF-8, commits/idle, progress-only, TODO, STOP, retries, is_error, rate limit, timeout/tree kill, SIGINT/SIGHUP, cleanup prompt once, run lock, linked path entry, inherited pipes, CLI launch"
        );
    } finally {
        console.log = originalConsoleLog;
        console.error = originalConsoleError;

        // 임시 폴더만 지우도록 경로를 확인한다.
        const resolvedTestDir = path.resolve(testDir);

        assert.equal(path.dirname(resolvedTestDir), path.resolve(os.tmpdir()));
        assert(path.basename(resolvedTestDir).startsWith("ap-node-check-"));

        fs.rmSync(resolvedTestDir, { recursive: true, force: true });
    }
};

checkAutopilot().catch((error) => {
    console.error(error);

    process.exitCode = 1;
});

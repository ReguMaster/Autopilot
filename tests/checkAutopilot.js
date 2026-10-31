import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FAKE_CLI_SOURCE, createTestContext } from "./lib/fixtures.js";
import {
    checkProcessIdentity,
    checkFileLogger,
    checkDeadlineTimer,
    checkInvalidProject,
    checkRunFilePrune,
    checkProgressEnsure,
    checkProgressReset,
    checkRunSettings,
    checkCommandArgs,
    checkClaudeArgs,
    checkRunEnv,
    checkProjectPaths,
    checkProgressArchive,
    checkStreamEvent,
    checkCommitLineCounts,
    checkPhaseRules,
    checkAgentRules,
    checkBrainstormRules,
    checkDebateRules
} from "./lib/unitChecks.js";
import {
    createScenarioRunner,
    checkRoundOutcomes,
    checkLogRetention,
    checkLogRetentionOption,
    checkProgressResetFlow,
    checkProgressCreated,
    checkUnsupportedFlags,
    checkTasksRequired,
    checkHugeWorkTree,
    checkProgressResetCommand,
    checkRoundOptions,
    checkProgressCleanupPrompt,
    checkGitNames,
    checkLinkedRepos,
    checkRetriesAndRateLimit,
    checkTimeout,
    checkInterrupt,
    checkRunLock,
    checkCliRun,
    checkSessionRunner,
    checkBuildMode,
    checkBrainstorm,
    checkCodexRunner,
    checkDebate,
    checkHybrid
} from "./lib/scenarioChecks.js";

const checkAutopilot = async () => {
    const testDir = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), "ap-node-check-"));
    const originalConsoleLog = console.log;
    const originalConsoleError = console.error;
    const errorMessages = [];
    const context = createTestContext(testDir);

    try {
        console.log = () => {};
        console.error = (message) => errorMessages.push(String(message));

        await checkInvalidProject(context, errorMessages);

        checkProcessIdentity();
        checkFileLogger(context, errorMessages);
        await checkDeadlineTimer();
        checkRunSettings();
        checkCommandArgs();
        await checkClaudeArgs();
        checkRunEnv();
        checkProjectPaths(context);
        checkProgressArchive(context);
        checkStreamEvent();
        checkCommitLineCounts();
        checkPhaseRules(context);
        checkAgentRules();
        checkBrainstormRules(context);
        checkDebateRules(context);
        checkRunFilePrune(context);
        checkProgressEnsure(context);
        checkProgressReset(context);

        const fakeCliFile = path.join(testDir, "fake.mjs");

        fs.writeFileSync(fakeCliFile, FAKE_CLI_SOURCE);

        const scenarioRunner = createScenarioRunner(context, fakeCliFile);

        await checkRoundOutcomes(scenarioRunner.runScenario);
        await checkLogRetention(scenarioRunner.runScenario);
        await checkLogRetentionOption(scenarioRunner.runScenario);
        await checkProgressResetFlow(scenarioRunner.runScenario);
        await checkProgressCreated(scenarioRunner, context, fakeCliFile);
        await checkUnsupportedFlags(scenarioRunner, context);
        await checkTasksRequired(context, fakeCliFile);
        await checkHugeWorkTree(context, fakeCliFile);
        await checkBuildMode(scenarioRunner, context, fakeCliFile);
        await checkBrainstorm(scenarioRunner, context, fakeCliFile);
        await checkCodexRunner(scenarioRunner, context, fakeCliFile);
        await checkDebate(scenarioRunner, context, fakeCliFile);
        await checkHybrid(scenarioRunner, context, fakeCliFile);
        checkProgressResetCommand(context);
        await checkRoundOptions(scenarioRunner.runScenario, context);
        await checkGitNames(scenarioRunner.runScenario);
        await checkLinkedRepos(scenarioRunner.runScenario, context);
        await checkRetriesAndRateLimit(scenarioRunner.runScenario);
        await checkTimeout(scenarioRunner.runScenario);
        await checkProgressCleanupPrompt(scenarioRunner.runScenario);
        await checkInterrupt(scenarioRunner, "SIGINT");
        await checkInterrupt(scenarioRunner, "SIGHUP");
        await checkRunLock(context);
        checkCliRun(context, fakeCliFile, process.argv[2]);
        await checkSessionRunner(context, fakeCliFile);

        originalConsoleLog(
            "OK: arg parsing, project/work dirs, %APPDATA% progress record, tasks in prompt, UTF-8, commits/idle, TODO_COMPLETE, STOP, model/effort next-round change, retries, is_error, rate limit, timeout/tree kill, SIGINT/SIGHUP, cleanup prompt once, log retention, progress record reset, run lock/pid reuse, build mode phases/gates/approve, Claude-Codex debate, hybrid per-phase main/assistant (codex main + claude assistant proposal/review/debate/adoption, codex fallback), brainstorm (codex proposal/review/pick/skip), codex runner (jsonl log, set switch, fallback, limit), desktop log contract, CLI entry (linked path, tasks file, status/set/reset-progress/stop), inherited pipes"
        );
    } finally {
        console.log = originalConsoleLog;
        console.error = originalConsoleError;

        // 임시 폴더만 지우도록 경로를 확인한다.
        const resolvedTestDir = path.resolve(testDir);

        assert.equal(path.dirname(resolvedTestDir), fs.realpathSync.native(os.tmpdir()));
        assert(path.basename(resolvedTestDir).startsWith("ap-node-check-"));

        fs.rmSync(resolvedTestDir, { recursive: true, force: true });
    }
};

checkAutopilot().catch((error) => {
    console.error(error);

    process.exitCode = 1;
});

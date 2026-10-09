import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FAKE_CLI_SOURCE, createTestContext } from "./lib/fixtures.js";
import { checkInvalidKit, checkRunFilePrune, checkRunSettings, checkCommandArgs, checkClaudeArgs, checkProgressArchive, checkStreamEvent } from "./lib/unitChecks.js";
import {
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
} from "./lib/scenarioChecks.js";

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
        checkClaudeArgs();
        checkProgressArchive(context);
        checkStreamEvent();
        checkRunFilePrune(context);

        const fakeCliFile = path.join(testDir, "fake.mjs");

        fs.writeFileSync(fakeCliFile, FAKE_CLI_SOURCE);

        const scenarioRunner = createScenarioRunner(context, fakeCliFile);

        await checkRoundOutcomes(scenarioRunner.runScenario);
        await checkLogRetention(scenarioRunner.runScenario);
        await checkRoundOptions(scenarioRunner.runScenario, context);
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
            "OK: parsing, archive, UTF-8, commits/idle, progress-only, TODO, STOP, model/effort next-round change, retries, is_error, rate limit, timeout/tree kill, SIGINT/SIGHUP, cleanup prompt once, log retention, run lock/pid reuse, desktop log contract, linked path entry/version, inherited pipes, CLI launch"
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

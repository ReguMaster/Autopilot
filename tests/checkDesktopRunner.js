import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createRunner, STATUS_OK, STATUS_FAILED } = require("../desktop/autopilotRunner.cjs");

// autopilot.exe 대신 실행되는 가짜 CLI. AP_MODE로 동작을 고르고 stop 인자는 STOP 파일을 만든다.
const FAKE_CLI_SOURCE = String.raw`
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const dir = process.env.AP_TEST_DIR;
const stopFile = path.join(dir, "STOP");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const main = async () => {
    if (process.argv[2] === "stop") {
        fs.writeFileSync(stopFile, "");
        console.log("AutoPilot will stop after the current round.");
        return 0;
    }

    if (process.argv[2] === "set") {
        if (process.argv.includes("gpt")) {
            console.error("잘못된 model 값입니다.");
            return 1;
        }

        fs.writeFileSync(path.join(dir, "OPTIONS"), process.argv.slice(3).join(" "));
        console.log("AutoPilot will use model sonnet, effort low from the next round.");
        return 0;
    }

    const mode = process.env.AP_MODE;

    process.stdout.write("Project : C:\\work\\demo\nDeadline : 2026-10-08 07:00:00 (실행 인자)\nPolicy : 자율");
    await sleep(50);
    console.log("개선 (기본값)\nReport : C:\\work\\demo\\report.html");
    console.log("[1회차] 시작 - 남은 시간 300분 (model opus, effort high)");

    if (mode === "hang") {
        const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });

        fs.writeFileSync(path.join(dir, "grandchild.pid"), String(grandchild.pid));
        setInterval(() => {}, 1000);
        return null;
    }

    if (mode === "wait") {
        const optionsFile = path.join(dir, "OPTIONS");
        let round = 1;

        while (!fs.existsSync(stopFile)) {
            if (round === 1 && fs.existsSync(optionsFile)) {
                console.log("[1회차] 완료");
                console.log("[2회차] 시작 - 남은 시간 299분 (model sonnet, effort low)");
                round = 2;
            }

            await sleep(20);
        }

        console.log("[" + round + "회차] 중단됨");
        console.log("AutoPilot 종료 - 중단 요청 (" + round + "회차)");
        return 130;
    }

    console.error("fake stderr 한글");
    console.log("[1회차] 완료");
    console.log("[2회차] 시작 - 남은 시간 200분");
    console.log("[2회차] 사용량 한도");
    console.log("[사용량 한도] 05:30까지 대기 (실패로 세지 않음)");
    console.log("AutoPilot 종료 - 예정 시각 도달 (2회차)");
    return 0;
};

main().then((exitCode) => {
    if (exitCode !== null) {
        process.exitCode = exitCode;
    }
});
`;

const wait = (ms) => {
    return new Promise((resolve) => setTimeout(resolve, ms));
};

const waitFor = async (predicate, message, timeoutMs = 10000) => {
    const startedAt = Date.now();

    while (!predicate()) {
        assert(Date.now() - startedAt < timeoutMs, `시간 초과: ${message}`);

        await wait(20);
    }
};

const isProcessAlive = (pid) => {
    try {
        process.kill(pid, 0);

        return true;
    } catch {
        return false;
    }
};

const createTestRunner = (testDir, mode) => {
    const logs = [];
    const states = [];
    const runner = createRunner({
        onLog: (entries) => logs.push(...entries),
        onState: (state) => states.push(state.status)
    });
    const launch = { command: process.execPath, prefixArgs: [path.join(testDir, "fakeCli.cjs")] };

    process.env.AP_MODE = mode;

    return { runner: runner, logs: logs, states: states, launch: launch };
};

const checkFinishedRun = async (testDir) => {
    const { runner, logs, launch } = createTestRunner(testDir, "finish");

    assert.equal(runner.start({ ...launch, args: ["--no-open"] }).status, STATUS_OK);
    assert.equal(runner.start(launch).error.code, "ALREADY_RUNNING");

    await waitFor(() => runner.getState().status === "idle", "정상 종료");

    const state = runner.getState();

    assert.equal(state.exitCode, 0);
    assert.equal(state.reason, "예정 시각 도달");
    assert.equal(state.policy, "자율개선 (기본값)");
    assert.equal(state.project, "C:\\work\\demo");
    assert.equal(state.reportFile, "C:\\work\\demo\\report.html");
    assert.equal(state.deadlineAt, new Date("2026-10-08T07:00:00").getTime());
    assert.deepEqual(
        state.rounds.map((round) => [round.round, round.outcome]),
        [
            [1, "완료"],
            [2, "사용량 한도"]
        ]
    );
    assert(state.rounds.every((round) => round.endedAt));
    assert.equal(logs[0].stream, "app");
    assert(logs.some((entry) => entry.stream === "err" && entry.text === "fake stderr 한글"));
    assert(logs.some((entry) => entry.stream === "out" && entry.text === "[사용량 한도] 05:30까지 대기 (실패로 세지 않음)"));
    assert.equal((await runner.stop()).error.code, "NOT_RUNNING");
    assert.equal(runner.kill().error.code, "NOT_RUNNING");
};

const checkStopSignal = async (testDir) => {
    const { runner, launch } = createTestRunner(testDir, "wait");

    runner.start({ ...launch, roundOptions: { model: "opus", effort: "high" } });

    await waitFor(() => runner.getState().round === 1, "1회차 시작");

    assert.equal(runner.getState().status, "running");
    assert.deepEqual(runner.getState().requested, { model: "opus", effort: "high" });
    assert.equal(runner.getState().model, "opus");

    // 변경은 요청 값만 바꾸고, 다음 회차 로그가 올 때 적용 값이 바뀐다.
    const failedSet = await runner.setRoundOptions({ model: "gpt", effort: "low" });

    assert.equal(failedSet.error.code, "SET_OPTIONS_FAILED");
    assert.deepEqual(runner.getState().requested, { model: "opus", effort: "high" });
    assert.equal((await runner.setRoundOptions({ model: "sonnet", effort: "low" })).status, STATUS_OK);
    assert.deepEqual(runner.getState().requested, { model: "sonnet", effort: "low" });
    assert(fs.readFileSync(path.join(testDir, "OPTIONS"), "utf8").includes("--model sonnet --effort low"));

    await waitFor(() => runner.getState().round === 2, "2회차 시작");

    assert.deepEqual([runner.getState().model, runner.getState().effort], ["sonnet", "low"]);
    assert.equal(runner.getState().rounds[0].model, "opus");
    assert.equal(runner.getState().rounds[1].model, "sonnet");
    assert.equal((await runner.stop()).status, STATUS_OK);
    assert.equal(runner.getState().status, "stopping");
    assert.equal((await runner.stop()).status, STATUS_FAILED);
    assert.equal((await runner.setRoundOptions({ model: "opus", effort: "high" })).error.code, "NOT_RUNNING");

    await waitFor(() => runner.getState().status === "idle", "종료 신호 후 종료");

    assert.equal(runner.getState().exitCode, 130);
    assert.equal(runner.getState().reason, "중단 요청");
    assert.deepEqual(
        runner.getState().rounds.map((round) => round.outcome),
        ["완료", "중단됨"]
    );
    assert.equal((await runner.setRoundOptions({ model: "opus", effort: "high" })).error.code, "NOT_RUNNING");
};

const checkForceKill = async (testDir) => {
    const { runner, launch } = createTestRunner(testDir, "hang");
    const pidFile = path.join(testDir, "grandchild.pid");

    runner.start(launch);

    await waitFor(() => fs.existsSync(pidFile) && fs.readFileSync(pidFile, "utf8"), "하위 프로세스 시작");

    const grandchildPid = Number(fs.readFileSync(pidFile, "utf8"));

    assert(isProcessAlive(grandchildPid));
    assert.equal(runner.kill().status, STATUS_OK);

    await waitFor(() => runner.getState().status === "idle", "강제 종료");
    await waitFor(() => !isProcessAlive(grandchildPid), "하위 프로세스 종료");

    assert.equal(runner.getState().reason, "강제 종료");
};

const checkSpawnFailure = async (testDir) => {
    const { runner } = createTestRunner(testDir, "finish");

    runner.start({ command: path.join(testDir, "missing-autopilot") });

    await waitFor(() => runner.getState().status === "idle", "실행 실패 처리");

    assert.equal(runner.getState().exitCode, -1);
    assert(runner.getState().reason.includes("ENOENT"));
};

const runChecks = async () => {
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "autopilot-desktop-"));

    process.env.AP_TEST_DIR = testDir;

    fs.writeFileSync(path.join(testDir, "fakeCli.cjs"), FAKE_CLI_SOURCE);

    try {
        await checkFinishedRun(testDir);

        fs.rmSync(path.join(testDir, "STOP"), { force: true });

        await checkStopSignal(testDir);
        await checkForceKill(testDir);
        await checkSpawnFailure(testDir);

        console.log("Desktop runner checks passed.");
    } finally {
        fs.rmSync(testDir, { recursive: true, force: true });
    }
};

runChecks().catch((error) => {
    console.error(error);

    process.exitCode = 1;
});

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { MODEL_CHOICES as ENGINE_MODELS, EFFORT_LEVELS as ENGINE_EFFORTS, DEFAULT_MODEL, DEFAULT_EFFORT } from "../autopilot/src/utils/config.js";

const require = createRequire(import.meta.url);
const { createRunner, MODEL_CHOICES, EFFORT_CHOICES, STATUS_OK, STATUS_FAILED } = require("../desktop/autopilotRunner.cjs");
const { findEngineExecutable, isKitReportFile } = require("../desktop/engineFinder.cjs");

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

    // 실제 autopilot의 status처럼 실행 중이면 pid와 로그 파일을 한 줄 JSON으로 알려준다. 외부 엔진은 external.pid에 자신의 pid를 남긴다.
    if (process.argv[2] === "status") {
        const pidFile = path.join(dir, "external.pid");
        const pid = fs.existsSync(pidFile) ? Number(fs.readFileSync(pidFile, "utf8")) : 0;
        let isRunning = false;

        if (pid) {
            try {
                process.kill(pid, 0);
                isRunning = true;
            } catch {}
        }

        console.log(JSON.stringify(isRunning ? { running: true, pid: pid, logFile: process.env.AP_LOG_FILE } : { running: false }));
        return 0;
    }

    const mode = process.env.AP_MODE;

    // 앱이 시작하지 않은 엔진. stdout이 아니라 로그 파일에만 기록한다.
    if (mode === "external" || mode === "external-hang") {
        const logFile = process.env.AP_LOG_FILE;
        const appendLog = (text) => fs.appendFileSync(logFile, text + "\n");
        const waitForFile = async (name) => {
            while (!fs.existsSync(path.join(dir, name))) {
                await sleep(20);
            }
        };

        fs.mkdirSync(path.dirname(logFile), { recursive: true });
        fs.writeFileSync(path.join(dir, "external.pid"), String(process.pid));

        appendLog("Project : C:\\work\\demo");
        appendLog("Deadline : 2026-10-08 07:00:00 (실행 인자)");
        appendLog("Policy : 자율개선 (기본값)");
        appendLog("Log : " + logFile);
        appendLog("Report : C:\\work\\demo\\report.html");
        appendLog("[1회차] 시작 - 남은 시간 300분 (model opus, effort high)");

        if (mode === "external-hang") {
            setInterval(() => {}, 1000);
            return null;
        }

        // 한 줄을 글자 중간(한글 3바이트의 둘째 바이트)에서 끊어 먼저 쓰고 나머지는 신호를 받은 뒤에 써서, 따라가는 쪽이 글자를 깨뜨리지 않는지 확인한다.
        const splitLine = Buffer.from("12:00:00 한글 분할 출력\n");

        fs.appendFileSync(logFile, splitLine.subarray(0, 10));
        fs.writeFileSync(path.join(dir, "HALF_WRITTEN"), "");

        await waitForFile("SPLIT");
        fs.appendFileSync(logFile, splitLine.subarray(10));

        // 로그 안의 Log 헤더가 바뀌어도(오래된 엔진이 남긴 위조 줄 등) 읽는 파일은 검증된 경로여야 한다.
        appendLog("Log : /forged/autopilot_999999_ffffffff.log");

        await waitForFile("ADVANCE");
        appendLog("[1회차] 완료");
        appendLog("[2회차] 시작 - 남은 시간 299분 (model sonnet, effort low)");

        await waitForFile("STOP");
        await waitForFile("RELEASE");
        appendLog("[2회차] 중단됨");
        appendLog("AutoPilot 종료 - 중단 요청 (2회차)");
        return 130;
    }

    process.stdout.write("Project : C:\\work\\demo\nDeadline : 2026-10-08 07:00:00 (실행 인자)\nPolicy : 자율");
    await sleep(50);
    console.log("개선 (기본값)\nReport : C:\\work\\demo\\report.html");
    console.log("[1회차] 시작 - 남은 시간 300분 (model opus, effort high)");

    if (mode === "hang") {
        const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });

        fs.writeFileSync(path.join(dir, "grandchild.pid"), String(grandchild.pid));
        // 실제 autopilot은 SIGTERM을 받으면 회차 프로세스 트리를 종료한다. Windows는 taskkill이 트리를 직접 종료한다.
        process.on("SIGTERM", () => {
            grandchild.kill();
            process.exit(143);
        });
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

        // 실제 엔진은 종료 신호를 받아도 현재 회차를 마친 뒤 끝난다. 테스트가 신호 직후 상태를 확인할 때까지 회차를 진행 중으로 둔다.
        while (!fs.existsSync(path.join(dir, "RELEASE"))) {
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
        onState: (state) => states.push(state.status),
        attachPollMs: 20
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

    fs.writeFileSync(path.join(testDir, "RELEASE"), "");

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

// 앱이 시작하지 않은 엔진(예: 시작 배치로 띄운 엔진)에 연결해 로그를 따라가고, 종료 신호·강제 종료·종료 감지를 확인한다.
const checkAttachToRunningEngine = async (testDir) => {
    const kitDir = path.join(testDir, "attach kit", "autopilot");
    const logFile = path.join(kitDir, "progress", "2026-10-10", "autopilot_120000_ab12cd34.log");
    const outsideLogFile = path.join(testDir, "attach kit", "outside", "autopilot_120000_ab12cd34.log");
    const externals = [];
    const spawnExternal = (mode, externalLogFile) => {
        process.env.AP_MODE = mode;
        process.env.AP_LOG_FILE = externalLogFile;

        const external = spawn(process.execPath, [path.join(testDir, "fakeCli.cjs")], { stdio: "ignore", windowsHide: true });

        externals.push(external);

        return external;
    };

    for (const name of ["STOP", "RELEASE", "SPLIT", "ADVANCE", "HALF_WRITTEN", "external.pid"]) {
        fs.rmSync(path.join(testDir, name), { force: true });
    }

    try {
        const { runner, logs, launch } = createTestRunner(testDir, "finish");
        const attachOptions = { ...launch, kitDir: kitDir };
        const signal = (name) => fs.writeFileSync(path.join(testDir, name), "");

        process.env.AP_LOG_FILE = logFile;

        // 실행 중인 엔진이 없으면 연결하지 않는다.
        assert.equal((await runner.attachIfRunning(attachOptions)).data.attached, false);
        assert.equal(runner.getState().status, "idle");

        const external = spawnExternal("external", logFile);

        await waitFor(() => fs.existsSync(path.join(testDir, "HALF_WRITTEN")), "외부 엔진 시작");

        assert.equal((await runner.attachIfRunning(attachOptions)).data.attached, true);

        // 이미 쓰인 로그를 읽어 상태를 복원한다. 회차 시각은 알 수 없다.
        const state = runner.getState();

        assert.equal(state.status, "running");
        assert.equal(state.attached, true);
        assert.equal(state.pid, external.pid);
        assert.equal(state.project, "C:\\work\\demo");
        assert.equal(state.policy, "자율개선 (기본값)");
        assert.equal(state.round, 1);
        assert.equal(state.rounds[0].timesKnown, false);
        assert.deepEqual({ ...state.requested }, { model: "opus", effort: "high" });
        assert(logs.some((entry) => entry.stream === "out" && entry.text === "[1회차] 시작 - 남은 시간 300분 (model opus, effort high)"));
        assert.equal(runner.isRunning(), true);
        assert.equal(runner.isAttached(), true);
        assert.equal(runner.start(launch).error.code, "ALREADY_RUNNING");
        assert.equal((await runner.attachIfRunning(attachOptions)).data.attached, false);

        // 글자 중간에서 잘린 줄은 나머지가 올 때까지 기다렸다가 온전한 글자로 내보낸다.
        await wait(150);

        assert(!logs.some((entry) => entry.text.includes("분할")));

        signal("SPLIT");

        await waitFor(() => logs.some((entry) => entry.text === "12:00:00 한글 분할 출력"), "잘린 줄 이어 읽기");

        assert(!logs.some((entry) => entry.text.includes("\ufffd")));

        // 연결한 뒤에 시작한 회차는 시각을 안다.
        signal("ADVANCE");

        await waitFor(() => runner.getState().round === 2, "2회차 따라가기");

        assert.deepEqual([runner.getState().model, runner.getState().effort], ["sonnet", "low"]);
        assert.deepEqual({ ...runner.getState().requested }, { model: "sonnet", effort: "low" });
        assert.equal(runner.getState().rounds[0].outcome, "완료");
        assert.equal(runner.getState().rounds[1].timesKnown, true);

        assert.equal((await runner.stop()).status, STATUS_OK);
        assert.equal(runner.getState().status, "stopping");

        signal("RELEASE");

        await once(external, "exit");
        await waitFor(() => runner.getState().status === "idle", "연결한 엔진 종료 감지");

        // 앱이 시작한 엔진이 아니므로 종료 코드는 알 수 없고, 사유는 로그의 종료 줄에서 읽는다.
        assert.equal(runner.getState().exitCode, null);
        assert.equal(runner.getState().reason, "중단 요청");
        assert.deepEqual(
            runner.getState().rounds.map((round) => round.outcome),
            ["완료", "중단됨"]
        );
        assert(logs.some((entry) => entry.stream === "app" && entry.text === "[앱] 연결한 엔진이 종료됐어요 - 중단 요청"));
        assert.equal(runner.isRunning(), false);

        // 엔진이 알려준 로그 경로가 키트 progress/ 밖이면 읽지 않는다.
        const outsideExternal = spawnExternal("external-hang", outsideLogFile);

        await waitFor(() => fs.existsSync(outsideLogFile), "키트 밖 로그를 쓰는 엔진 시작");

        process.env.AP_LOG_FILE = outsideLogFile;

        assert.equal((await runner.attachIfRunning(attachOptions)).data.attached, false);
        assert.equal(runner.getState().status, "idle");

        outsideExternal.kill();

        await once(outsideExternal, "exit");

        // 강제 종료는 pid로 한다.
        process.env.AP_LOG_FILE = logFile;
        fs.rmSync(logFile);

        const hangingExternal = spawnExternal("external-hang", logFile);

        await waitFor(() => fs.existsSync(logFile) && fs.readFileSync(logFile, "utf8").includes("[1회차] 시작"), "강제 종료할 엔진 시작");

        assert.equal((await runner.attachIfRunning(attachOptions)).data.attached, true);
        assert.equal(runner.kill().status, STATUS_OK);

        await waitFor(() => runner.getState().status === "idle", "연결한 엔진 강제 종료");
        await waitFor(() => !isProcessAlive(hangingExternal.pid), "엔진 프로세스 종료");

        assert.equal(runner.getState().reason, "강제 종료");
    } finally {
        for (const external of externals) {
            external.kill();
        }

        delete process.env.AP_LOG_FILE;
    }
};

const checkSpawnFailure = async (testDir) => {
    const { runner } = createTestRunner(testDir, "finish");

    runner.start({ command: path.join(testDir, "missing-autopilot") });

    await waitFor(() => runner.getState().status === "idle", "실행 실패 처리");

    assert.equal(runner.getState().exitCode, -1);
    assert(runner.getState().reason.includes("ENOENT"));
};

const checkEngineFinder = (testDir) => {
    const exeName = process.platform === "win32" ? "autopilot.exe" : "autopilot";
    const nestedDir = path.join(testDir, "project", "src", "deep");
    const kitDir = path.join(testDir, "project", "autopilot");
    const repoDir = path.join(testDir, "repo", "desktop");
    const buildDir = path.join(testDir, "repo", "dist", `cli-${process.platform}-${process.arch}`, "autopilot");

    fs.mkdirSync(nestedDir, { recursive: true });
    fs.mkdirSync(path.join(kitDir, exeName), { recursive: true });
    fs.mkdirSync(repoDir, { recursive: true });

    assert.equal(findEngineExecutable([nestedDir, repoDir]), "");

    fs.rmSync(path.join(kitDir, exeName), { recursive: true });
    fs.writeFileSync(path.join(kitDir, exeName), "");

    assert.equal(findEngineExecutable([nestedDir]), path.join(kitDir, exeName));

    fs.mkdirSync(buildDir, { recursive: true });
    fs.writeFileSync(path.join(buildDir, exeName), "");

    assert.equal(findEngineExecutable([repoDir, nestedDir]), path.join(buildDir, exeName));
};

// 엔진 출력에서 읽은 경로로 실행 파일이나 키트 밖의 파일을 열 수 없어야 한다.
const checkReportOpenGuard = (testDir) => {
    const kitDir = path.join(testDir, "report guard", "autopilot");
    const dayDir = path.join(kitDir, "progress", "2026-10-10");
    const outsideDir = path.join(testDir, "report guard", "outside");
    const reportFile = path.join(dayDir, "report_120000_ab12cd34.html");
    const touch = (file) => {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, "");

        return file;
    };

    touch(reportFile);

    assert(isKitReportFile(kitDir, reportFile));

    // 키트 밖, progress 밖, 리포트 이름·확장자가 아닌 파일, 없는 파일, 빈 값은 거부한다.
    const rejectedFiles = [
        touch(path.join(outsideDir, "report_120000_ab12cd34.html")),
        touch(path.join(kitDir, "report_120000_ab12cd34.html")),
        touch(path.join(kitDir, "autopilot.exe")),
        touch(path.join(dayDir, "evil.html")),
        touch(path.join(dayDir, "report_120000_ab12cd34.html.exe")),
        touch(path.join(dayDir, "..", "..", "..", "outside", "report_1.html")),
        path.join(dayDir, "report_999999_00000000.html"),
        ""
    ];

    for (const rejectedFile of rejectedFiles) {
        assert(!isKitReportFile(kitDir, rejectedFile), rejectedFile);
    }

    assert(!isKitReportFile("", reportFile));

    // progress 안의 링크가 밖을 가리키면 실제 경로로 판단해 거부한다.
    const linkDir = path.join(kitDir, "progress", "link");

    touch(path.join(outsideDir, "report_777777_aaaaaaaa.html"));
    fs.symlinkSync(outsideDir, linkDir, "junction");

    assert(!isKitReportFile(kitDir, path.join(linkDir, "report_777777_aaaaaaaa.html")));
};

// select의 option 값과 "기본값" 표시가 붙은 값을 돌려준다.
const readSelectChoices = (html, id) => {
    const optionsHtml = html.match(new RegExp(`<select id="${id}">([\\s\\S]*?)</select>`))[1];
    const options = [...optionsHtml.matchAll(/<option value="([^"]*)">([^<]*)</g)];

    return { values: options.map((option) => option[1]), defaultValue: options.find((option) => option[2].includes("기본값"))?.[1] };
};

// 허용 값은 엔진(config.js)·러너·화면(index.html) 세 곳에 있으므로 어긋나면 실패시킨다.
const checkChoiceSync = () => {
    const html = fs.readFileSync(path.join(import.meta.dirname, "../desktop/index.html"), "utf8");
    const model = readSelectChoices(html, "model");
    const effort = readSelectChoices(html, "effort");

    assert.deepEqual(MODEL_CHOICES, ENGINE_MODELS);
    assert.deepEqual(EFFORT_CHOICES, ENGINE_EFFORTS);
    assert.deepEqual(model.values, ENGINE_MODELS);
    assert.deepEqual(effort.values, ENGINE_EFFORTS);
    assert.equal(model.defaultValue, DEFAULT_MODEL);
    assert.equal(effort.defaultValue, DEFAULT_EFFORT);
};

const runChecks = async () => {
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "autopilot-desktop-"));

    process.env.AP_TEST_DIR = testDir;

    fs.writeFileSync(path.join(testDir, "fakeCli.cjs"), FAKE_CLI_SOURCE);

    try {
        checkChoiceSync();
        checkEngineFinder(testDir);
        checkReportOpenGuard(testDir);

        await checkFinishedRun(testDir);

        fs.rmSync(path.join(testDir, "STOP"), { force: true });

        await checkStopSignal(testDir);
        await checkForceKill(testDir);
        await checkAttachToRunningEngine(testDir);
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

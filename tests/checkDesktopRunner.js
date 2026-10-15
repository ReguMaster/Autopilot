import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
    DEFAULT_EFFORT_LEVEL as UI_DEFAULT_EFFORT_LEVEL,
    DEFAULT_MODEL as UI_DEFAULT_MODEL,
    DEFAULT_POLICY as UI_DEFAULT_POLICY,
    EFFORT_LEVELS as UI_EFFORT_LEVELS,
    MODEL_FAMILIES as UI_MODEL_FAMILIES,
    POLICIES as UI_POLICIES
} from "../desktop/ui/lib/constants.js";
import {
    MODEL_CHOICES as ENGINE_MODELS,
    MODEL_ID_PATTERN as ENGINE_MODEL_ID_PATTERN,
    EFFORT_LEVELS as ENGINE_EFFORTS,
    DEFAULT_MODEL,
    DEFAULT_EFFORT,
    POLICY_ALIASES,
    POLICY_SELF
} from "../autopilot/src/utils/config.js";

const require = createRequire(import.meta.url);
const { createRunner, MODEL_CHOICES, MODEL_ID_PATTERN, EFFORT_CHOICES, STATUS_OK, STATUS_FAILED } = require("../desktop/autopilotRunner.cjs");
const { getProjectError, isProjectReportFile } = require("../desktop/projectFiles.cjs");
const { createAccountReader, parseLoginExpiryFlag } = require("../desktop/claudeAccount.cjs");
const { createUpdateCheck, isNewerVersion } = require("../desktop/updateCheck.cjs");

// 엔진 대신 실행되는 가짜 CLI. AP_MODE로 동작을 고르고 stop 인자는 STOP 파일을 만든다. 받은 인자와 환경은 ARGS_<하위 명령>·ENV_<하위 명령> 파일에 남긴다.
const FAKE_CLI_SOURCE = String.raw`
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const dir = process.env.AP_TEST_DIR;
const stopFile = path.join(dir, "STOP");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const main = async () => {
    const subcommand = process.argv[2]?.startsWith("--") ? "start" : process.argv[2] || "start";

    fs.writeFileSync(path.join(dir, "ARGS_" + subcommand), process.argv.slice(2).join("\n"));
    fs.writeFileSync(path.join(dir, "ENV_" + subcommand), process.env.AP_RUNNER_ENV || "");

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

    console.log("12:00:01   > Read C:\\work\\demo\\search.js");
    console.log("12:00:02   > Read C:\\work\\demo\\search.js");
    console.log("12:00:03   > Edit C:\\work\\demo\\search.js");
    console.log("12:00:04   > Bash npm test");
    console.log("12:00:05 검색을 고쳤어요.");
    console.log("    성과: 검색 응답 1.2초 → 0.2초");
    console.log("[커밋] a3f9c21 +142 -21 [ap] 검색 개선");
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

// extraEnv가 있으면 앱처럼 엔진에 환경을 직접 넘긴다. 없으면 이 프로세스의 환경을 그대로 쓴다.
const createTestRunner = (testDir, mode, extraEnv) => {
    const logs = [];
    const states = [];
    const runner = createRunner({
        onLog: (entries) => logs.push(...entries),
        onState: (state) => states.push(state.status),
        attachPollMs: 20
    });

    process.env.AP_MODE = mode;

    const launch = { command: process.execPath, prefixArgs: [path.join(testDir, "fakeCli.cjs")], projectDir: path.join(testDir, "project 한글"), env: extraEnv && { ...process.env, ...extraEnv } };

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
    // 커밋은 결과 줄 전의 열린 회차에 붙고, 같은 파일은 한 번만 센다.
    assert.deepEqual(state.rounds[0].commits, [{ hash: "a3f9c21", insertions: 142, deletions: 21, subject: "[ap] 검색 개선" }]);
    assert.deepEqual(state.rounds[1].commits, []);
    assert.deepEqual(state.work, { toolCalls: 4, filesRead: 1, filesEdited: 1 });
    assert.deepEqual(state.gains, [{ round: 1, text: "검색 응답 1.2초 → 0.2초" }]);
    assert.equal(logs[0].stream, "app");
    assert(logs.some((entry) => entry.stream === "err" && entry.text === "fake stderr 한글"));
    assert(logs.some((entry) => entry.stream === "out" && entry.text === "[사용량 한도] 05:30까지 대기 (실패로 세지 않음)"));
    assert.equal((await runner.stop()).error.code, "NOT_RUNNING");
    assert.equal(runner.kill().error.code, "NOT_RUNNING");
};

const checkStopSignal = async (testDir) => {
    const { runner, launch } = createTestRunner(testDir, "wait", { AP_RUNNER_ENV: "from-runner" });
    const readTestFile = (name) => fs.readFileSync(path.join(testDir, name), "utf8");

    runner.start({ ...launch, args: ["--project", launch.projectDir, "--no-open"], roundOptions: { model: "opus", effort: "high" } });

    await waitFor(() => runner.getState().round === 1, "1회차 시작");

    // 시작과 하위 명령 모두 앱이 정한 환경과 대상 프로젝트로 실행된다.
    assert.equal(readTestFile("ENV_start"), "from-runner");
    assert.equal(readTestFile("ARGS_start"), ["--project", launch.projectDir, "--no-open"].join("\n"));

    assert.equal(runner.getState().status, "running");
    assert.deepEqual(runner.getState().requested, { model: "opus", effort: "high" });
    assert.equal(runner.getState().model, "opus");

    // 변경은 요청 값만 바꾸고, 다음 회차 로그가 올 때 적용 값이 바뀐다.
    const failedSet = await runner.setRoundOptions({ model: "gpt", effort: "low" });

    assert.equal(failedSet.error.code, "SET_OPTIONS_FAILED");
    assert.deepEqual(runner.getState().requested, { model: "opus", effort: "high" });
    assert.equal((await runner.setRoundOptions({ model: "sonnet", effort: "low" })).status, STATUS_OK);
    assert.deepEqual(runner.getState().requested, { model: "sonnet", effort: "low" });
    assert.equal(readTestFile("OPTIONS"), `--project ${launch.projectDir} --model sonnet --effort low`);
    assert.equal(readTestFile("ENV_set"), "from-runner");

    await waitFor(() => runner.getState().round === 2, "2회차 시작");

    assert.deepEqual([runner.getState().model, runner.getState().effort], ["sonnet", "low"]);
    assert.equal(runner.getState().rounds[0].model, "opus");
    assert.equal(runner.getState().rounds[1].model, "sonnet");
    assert.equal((await runner.stop()).status, STATUS_OK);
    assert.equal(readTestFile("ARGS_stop"), ["stop", "--project", launch.projectDir].join("\n"));
    assert.equal(readTestFile("ENV_stop"), "from-runner");
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

// 앱을 닫았다 켠 사이에 계속 실행된 엔진에 연결해 로그를 따라가고, 종료 신호·강제 종료·종료 감지를 확인한다.
const checkAttachToRunningEngine = async (testDir) => {
    const projectDir = path.join(testDir, "attach project");
    const logFile = path.join(projectDir, ".autopilot", "progress", "2026-10-10", "autopilot_120000_ab12cd34.log");
    const outsideLogFile = path.join(testDir, "attach project", "outside", "autopilot_120000_ab12cd34.log");
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
        const attachOptions = { ...launch, projectDir: projectDir };
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

        // 엔진이 알려준 로그 경로가 프로젝트 .autopilot/progress/ 밖이면 읽지 않는다.
        const outsideExternal = spawnExternal("external-hang", outsideLogFile);

        await waitFor(() => fs.existsSync(outsideLogFile), "프로젝트 작업 폴더 밖 로그를 쓰는 엔진 시작");

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

// 시작하려면 대상 프로젝트가 Git 저장소의 루트 폴더여야 한다. .git은 워크트리에서는 파일이다.
const checkProjectError = (testDir) => {
    const projectDir = path.join(testDir, "project check");
    const worktreeDir = path.join(testDir, "worktree check");

    fs.mkdirSync(path.join(projectDir, "src"), { recursive: true });
    fs.mkdirSync(worktreeDir);
    fs.writeFileSync(path.join(testDir, "not-a-folder"), "");
    fs.writeFileSync(path.join(worktreeDir, ".git"), "gitdir: elsewhere");

    for (const invalidDir of ["", path.join(testDir, "missing"), path.join(testDir, "not-a-folder"), projectDir, path.join(projectDir, "src")]) {
        assert(getProjectError(invalidDir), invalidDir);
    }

    fs.mkdirSync(path.join(projectDir, ".git"));

    assert.equal(getProjectError(projectDir), "");
    assert.equal(getProjectError(worktreeDir), "");
    assert(getProjectError(path.join(projectDir, "src")));
};

// 엔진 출력에서 읽은 경로로 실행 파일이나 작업 폴더 밖의 파일을 열 수 없어야 한다.
const checkReportOpenGuard = (testDir) => {
    const projectDir = path.join(testDir, "report guard");
    const workDir = path.join(projectDir, ".autopilot");
    const dayDir = path.join(workDir, "progress", "2026-10-10");
    const outsideDir = path.join(testDir, "report guard", "outside");
    const reportFile = path.join(dayDir, "report_120000_ab12cd34.html");
    const touch = (file) => {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, "");

        return file;
    };

    touch(reportFile);

    assert(isProjectReportFile(projectDir, reportFile));

    // 작업 폴더 밖, progress 밖, 리포트 이름·확장자가 아닌 파일, 없는 파일, 빈 값은 거부한다.
    const rejectedFiles = [
        touch(path.join(outsideDir, "report_120000_ab12cd34.html")),
        touch(path.join(workDir, "report_120000_ab12cd34.html")),
        touch(path.join(workDir, "autopilot.exe")),
        touch(path.join(dayDir, "evil.html")),
        touch(path.join(dayDir, "report_120000_ab12cd34.html.exe")),
        touch(path.join(dayDir, "..", "..", "..", "outside", "report_1.html")),
        path.join(dayDir, "report_999999_00000000.html"),
        ""
    ];

    for (const rejectedFile of rejectedFiles) {
        assert(!isProjectReportFile(projectDir, rejectedFile), rejectedFile);
    }

    assert(!isProjectReportFile("", reportFile));

    // progress 안의 링크가 밖을 가리키면 실제 경로로 판단해 거부한다.
    const linkDir = path.join(workDir, "progress", "link");

    touch(path.join(outsideDir, "report_777777_aaaaaaaa.html"));
    fs.symlinkSync(outsideDir, linkDir, "junction");

    assert(!isProjectReportFile(projectDir, path.join(linkDir, "report_777777_aaaaaaaa.html")));
};

// 가짜 fetch와 임시 로그인 파일로 계정(프로필·사용량) 조회를 검증한다. 토큰은 조회 두 곳으로만 보내고 결과에는 담지 않아야 한다.
const checkClaudeAccount = async (testDir) => {
    const credentialsFile = path.join(testDir, "credentials.json");
    const clock = { now: Date.parse("2026-10-13T00:00:00Z") };
    const writeCredentials = (oauth) => fs.writeFileSync(credentialsFile, JSON.stringify({ claudeAiOauth: oauth }));
    const jsonResponse = (body, status = 200) => ({ ok: status === 200, status: status, json: async () => body });
    const usageBody = {
        limits: [
            { kind: "session", percent: 3, resets_at: "2026-10-13T06:19:59.526207+00:00" },
            { kind: "weekly_all", percent: 20, resets_at: "2026-10-17T05:59:59+00:00" },
            { kind: "weekly_scoped", percent: 30, resets_at: "2026-10-17T05:59:59+00:00", scope: { model: { display_name: "Fable" } } },
            { kind: "unknown_kind", percent: 99 },
            { kind: "session", percent: null }
        ]
    };
    const profileBody = {
        account: { display_name: "개발자", full_name: "개발자 풀네임", email: "dev@example.com", has_claude_max: false, has_claude_pro: false },
        organization: { name: "Example Org", organization_type: "claude_team", rate_limit_tier: "default_claude_max_5x" }
    };
    const requests = [];
    const changes = [];
    const createReader = ({ usage = jsonResponse(usageBody), profile = jsonResponse(profileBody), renewCredentials, loginExpiresAtOverride } = {}) => {
        const responses = { usage: usage, profile: profile, isDown: false };
        const fetchImpl = async (url, init) => {
            requests.push({ url: url, headers: init.headers });

            if (responses.isDown) {
                throw new Error("fetch failed");
            }

            return new URL(url).pathname.endsWith("/usage") ? responses.usage : responses.profile;
        };
        const reader = createAccountReader({
            credentialsFile: credentialsFile,
            fetchImpl: fetchImpl,
            now: () => clock.now,
            renewCredentials: renewCredentials,
            loginExpiresAtOverride: loginExpiresAtOverride,
            onChange: (account) => changes.push(account)
        });

        return { ...reader, responses: responses };
    };

    writeCredentials({ accessToken: "secret-token", expiresAt: clock.now + 3600000 });

    const reader = createReader();

    assert.deepEqual(reader.getAccount(), { profile: null, limits: [], fetchedAt: 0, error: null, loginExpiresAt: 0 });

    const account = await reader.refresh();

    assert.equal(account.error, null);
    assert.deepEqual(account.profile, { name: "개발자", email: "dev@example.com", plan: "Team", organization: "Example Org" });
    assert.deepEqual(
        account.limits.map((limit) => [limit.label, limit.percent]),
        [
            ["5시간 한도", 3],
            ["주간 한도", 20],
            ["주간 한도 · Fable", 30]
        ]
    );
    assert.equal(account.limits[0].resetsAt, Date.parse("2026-10-13T06:19:59.526207+00:00"));
    assert.equal(account.fetchedAt, clock.now);
    assert.equal(changes.length, 1);
    assert(!JSON.stringify(account).includes("secret-token"));
    assert.equal(requests.length, 2);
    assert(requests.every((request) => request.headers.Authorization === "Bearer secret-token" && new URL(request.url).host === "api.anthropic.com"));

    // 방금 시도했으면 다시 요청하지 않고, 간격이 지나면 다시 읽는다. 진행 중인 요청은 합쳐진다.
    await reader.refresh();

    assert.equal(requests.length, 2);

    clock.now += 16000;

    const concurrent = await Promise.all([reader.refresh(), reader.refresh()]);

    assert.equal(requests.length, 4);
    assert.equal(concurrent[0], concurrent[1]);

    // 요금제 이름: 조직 유형이 우선이고, 개인 계정은 플래그로 정하며 Max는 배수를 붙인다.
    const planCases = [
        [{ account: { email: "a@b.c" }, organization: { organization_type: "claude_max", rate_limit_tier: "default_claude_max_5x" } }, "Max 5x"],
        [{ account: { email: "a@b.c", has_claude_pro: true }, organization: {} }, "Pro"],
        [{ account: { email: "a@b.c", has_claude_max: true }, organization: { rate_limit_tier: "default_claude_max_20x" } }, "Max 20x"],
        [{ account: { email: "a@b.c" }, organization: { organization_type: "something_new" } }, ""]
    ];

    for (const [body, plan] of planCases) {
        clock.now += 16000;

        assert.equal((await createReader({ profile: jsonResponse(body) }).refresh()).profile.plan, plan);
    }

    // 이름이 없으면 이메일만 남기고, 둘 다 없으면 프로필을 찾지 못한 것으로 본다.
    assert.equal((await createReader({ profile: jsonResponse({ account: { full_name: "홍길동" } }) }).refresh()).profile.name, "홍길동");
    assert.equal((await createReader({ profile: jsonResponse({ account: {} }) }).refresh()).error.code, "UNSUPPORTED_RESPONSE");

    // 범위를 벗어난 값은 0~100으로 맞추고, limits가 없으면 five_hour·seven_day로 대신한다.
    const legacy = await createReader({ usage: jsonResponse({ five_hour: { utilization: 130, resets_at: "bad" }, seven_day: { utilization: 20, resets_at: "2026-10-17T05:59:59+00:00" } }) }).refresh();

    assert.deepEqual(
        legacy.limits.map((limit) => [limit.label, limit.percent, limit.resetsAt === 0]),
        [
            ["5시간 한도", 100, true],
            ["주간 한도", 20, false]
        ]
    );

    // 일부만 실패하면 성공한 쪽은 새 값, 실패한 쪽은 이전 값을 유지하고 오류를 알린다. 전부 실패해도 이전 값과 갱신 시각은 그대로다.
    const keepReader = createReader();
    const firstFetchedAt = (await keepReader.refresh()).fetchedAt;

    clock.now += 16000;
    keepReader.responses.usage = jsonResponse({}, 429);
    keepReader.responses.profile = jsonResponse({ ...profileBody, account: { email: "new@example.com" } });

    const partial = await keepReader.refresh();

    assert.equal(partial.error.code, "HTTP_ERROR");
    assert.equal(partial.profile.email, "new@example.com");
    assert.equal(partial.limits.length, 3);
    assert(partial.fetchedAt > firstFetchedAt);

    clock.now += 16000;
    keepReader.responses.isDown = true;

    const down = await keepReader.refresh();

    assert.equal(down.error.code, "REQUEST_FAILED");
    assert.equal(down.profile.email, "new@example.com");
    assert.equal(down.limits.length, 3);
    assert.equal(down.fetchedAt, partial.fetchedAt);

    const failures = [
        [{ usage: jsonResponse({}, 401) }, "TOKEN_EXPIRED"],
        [{ usage: jsonResponse({ limits: [] }) }, "UNSUPPORTED_RESPONSE"]
    ];

    for (const [responses, code] of failures) {
        clock.now += 16000;

        assert.equal((await createReader(responses).refresh()).error.code, code);
    }

    // 로그인 만료 시각은 refreshTokenExpiresAt의 시각 값만 읽고(없거나 숫자가 아니면 0) 토큰은 담지 않는다. 조회가 실패해도 알 수 있고, 개발용 재정의가 있으면 그 값을 쓴다.
    assert.equal(account.loginExpiresAt, 0);

    const loginExpiresAt = clock.now + 29 * 86400000;

    writeCredentials({ accessToken: "secret-token", expiresAt: clock.now + 3600000, refreshToken: "secret-refresh", refreshTokenExpiresAt: loginExpiresAt });

    const expiring = await createReader().refresh();

    assert.equal(expiring.loginExpiresAt, loginExpiresAt);
    assert(!JSON.stringify(expiring).includes("secret-refresh"));
    assert.equal((await createReader({ usage: jsonResponse({}, 401) }).refresh()).loginExpiresAt, loginExpiresAt);
    assert.equal((await createReader({ loginExpiresAtOverride: clock.now + 1000 }).refresh()).loginExpiresAt, clock.now + 1000);

    writeCredentials({ accessToken: "secret-token", expiresAt: clock.now + 3600000, refreshTokenExpiresAt: "soon" });

    assert.equal((await createReader().refresh()).loginExpiresAt, 0);

    const flagNow = Date.parse("2026-10-13T00:00:00Z");

    assert.equal(parseLoginExpiryFlag(["electron", ".", "--debug-login-expiry=2d"], flagNow), flagNow + 2 * 86400000);
    assert.equal(parseLoginExpiryFlag(["--debug-login-expiry=5h"], flagNow), flagNow + 5 * 3600000);
    assert.equal(parseLoginExpiryFlag(["--debug-login-expiry=-1m"], flagNow), flagNow - 60000);

    for (const rejected of [[], ["--dev"], ["--debug-login-expiry="], ["--debug-login-expiry=2w"], ["--debug-login-expiry=abc"], ["--debug-login-expiry=99999d"], ["--debug-login-expiry=1.5d"]]) {
        assert.equal(parseLoginExpiryFlag(rejected, flagNow), 0, rejected.join(" "));
    }

    // 만료된 토큰은 요청하지 않고, 로그인 정보가 없거나 깨져도 실패로 알린다.
    const requestsBeforeExpired = requests.length;

    writeCredentials({ accessToken: "secret-token", expiresAt: clock.now - 1 });

    assert.equal((await createReader().refresh()).error.code, "TOKEN_EXPIRED");
    assert.equal(requests.length, requestsBeforeExpired);

    let renewCount = 0;
    const renewing = createReader({
        renewCredentials: async () => {
            renewCount += 1;
            writeCredentials({ accessToken: "renewed-token", expiresAt: clock.now + 3600000 });

            return true;
        }
    });

    assert.equal((await renewing.refresh()).error, null);
    assert.equal(renewCount, 1);
    assert.equal(requests.at(-1).headers.Authorization, "Bearer renewed-token");

    writeCredentials({ accessToken: "secret-token", expiresAt: clock.now - 1 });
    clock.now += 60000;

    const failingRenew = createReader({ renewCredentials: async () => (renewCount += 1) && false });

    assert.equal((await failingRenew.refresh()).error.code, "TOKEN_EXPIRED");
    assert.equal((await failingRenew.refresh(true)).error.code, "TOKEN_EXPIRED");
    assert.equal(renewCount, 2);

    // macOS는 로그인 정보가 키체인에 있어 파일이 없거나 깨져도 조회할 수 없다는 안내로 답한다.
    const missingCredentialsCode = process.platform === "darwin" ? "UNSUPPORTED_PLATFORM" : "NO_CREDENTIALS";

    fs.writeFileSync(credentialsFile, "{ broken");

    assert.equal((await createReader().refresh()).error.code, missingCredentialsCode);

    fs.rmSync(credentialsFile);

    assert.equal((await createReader().refresh()).error.code, missingCredentialsCode);
};

const checkUpdateCheck = async () => {
    assert(isNewerVersion("v1.0.1", "1.0.0"));
    assert(isNewerVersion("v1.10.0", "1.9.9"));
    assert(isNewerVersion("v2.0.0", "1.99.99"));
    assert(!isNewerVersion("v1.0.0", "1.0.0"));
    assert(!isNewerVersion("v0.9.9", "1.0.0"));
    assert(!isNewerVersion("v1.1.0-beta", "1.0.0"));
    assert(!isNewerVersion(undefined, "1.0.0"));

    const responses = { body: { tag_name: "v1.1.0" }, status: 200, isDown: false };
    const changes = [];
    const requests = [];
    const updateCheck = createUpdateCheck({
        currentVersion: "1.0.0",
        fetchImpl: async (url) => {
            requests.push(url);

            if (responses.isDown) {
                throw new Error("fetch failed");
            }

            return { ok: responses.status === 200, status: responses.status, json: async () => responses.body };
        },
        onChange: (update) => changes.push(update)
    });

    assert.equal(updateCheck.getUpdate(), null);

    const found = await updateCheck.check();

    assert.deepEqual(found, { version: "1.1.0", url: "https://github.com/ReguMaster/Autopilot/releases/tag/v1.1.0" });
    assert(requests[0].startsWith("https://api.github.com/repos/ReguMaster/Autopilot/"));

    await updateCheck.check();

    assert.equal(changes.length, 1);

    responses.isDown = true;

    assert.equal((await updateCheck.check()).version, "1.1.0");

    responses.isDown = false;
    responses.status = 403;

    assert.equal((await updateCheck.check()).version, "1.1.0");

    responses.status = 200;
    responses.body = { tag_name: "v1.0.0" };

    assert.equal(await updateCheck.check(), null);
    assert.deepEqual(changes, [found, null]);

    // 태그에 주소 조각이 섞여도 열 주소로 쓰지 않는다.
    responses.body = { tag_name: "v1.2.0/../../evil" };

    assert.equal(await updateCheck.check(), null);
};

// 허용 값은 엔진(config.js)·러너·화면(desktop/ui/lib/constants.js) 세 곳에 있으므로 어긋나면 실패시킨다. 정책은 화면의 값이 엔진 별칭이고 기본값이 엔진 기본 정책이어야 한다.
const checkChoiceSync = () => {
    assert.deepEqual(MODEL_CHOICES, ENGINE_MODELS);
    assert.equal(MODEL_ID_PATTERN.source, ENGINE_MODEL_ID_PATTERN.source);
    assert.deepEqual(EFFORT_CHOICES, ENGINE_EFFORTS);
    assert.deepEqual(UI_MODEL_FAMILIES, ENGINE_MODELS);
    assert.deepEqual(UI_EFFORT_LEVELS, ENGINE_EFFORTS);
    assert.equal(UI_DEFAULT_MODEL, DEFAULT_MODEL);
    assert.equal(UI_EFFORT_LEVELS[UI_DEFAULT_EFFORT_LEVEL], DEFAULT_EFFORT);

    assert.deepEqual(UI_POLICIES, ["auto", "todo"]);
    assert(UI_POLICIES.every((value) => Object.hasOwn(POLICY_ALIASES, value)));
    assert.equal(POLICY_ALIASES[UI_DEFAULT_POLICY], POLICY_SELF);
};

// 공식 모델 목록: 새 모델은 목록에서 그대로 따라오고, 형식이 다른 항목은 걸러내며, 조회가 안 되면 이전 목록을 유지한다.
const checkModelList = async (testDir) => {
    const credentialsFile = path.join(testDir, "model-credentials.json");
    const clock = { now: Date.parse("2026-10-14T00:00:00Z") };
    const requests = [];
    const state = { response: null, isDown: false };
    const modelsBody = {
        data: [
            { id: "claude-opus-4-8", line: "opus", created_at: "2026-05-28T00:00:00Z" },
            { id: "claude-opus-5-5", line: "opus", created_at: "2026-09-21T16:24:00Z" },
            { id: "claude-nova-1", line: "nova", created_at: "2026-10-01T00:00:00Z" },
            { id: "claude-haiku-4-5-20251001", created_at: "2025-10-15T00:00:00Z" },
            { id: "gpt-5", line: "other" },
            { id: "claude-opus 4; rm", line: "opus" },
            { line: "opus" }
        ]
    };
    const reader = createAccountReader({
        credentialsFile: credentialsFile,
        now: () => clock.now,
        fetchImpl: async (url, init) => {
            requests.push({ url: url, headers: init.headers });

            if (state.isDown) {
                throw new Error("fetch failed");
            }

            return state.response;
        }
    });

    state.response = { ok: true, status: 200, json: async () => modelsBody };

    // 토큰이 없거나 만료됐으면 요청하지 않는다.
    assert.deepEqual(await reader.getModels(), []);

    fs.writeFileSync(credentialsFile, JSON.stringify({ claudeAiOauth: { accessToken: "secret-token", expiresAt: clock.now - 1 } }));

    assert.deepEqual(await reader.getModels(), []);
    assert.equal(requests.length, 0);

    fs.writeFileSync(credentialsFile, JSON.stringify({ claudeAiOauth: { accessToken: "secret-token", expiresAt: clock.now + 3600000 } }));

    const models = await reader.getModels();

    assert.deepEqual(
        models.map((model) => [model.id, model.line]),
        [
            ["claude-nova-1", "nova"],
            ["claude-opus-5-5", "opus"],
            ["claude-opus-4-8", "opus"],
            ["claude-haiku-4-5-20251001", "haiku"]
        ]
    );
    assert.equal(requests.length, 1);
    assert.equal(new URL(requests[0].url).pathname, "/v1/models");
    assert.equal(requests[0].headers.Authorization, "Bearer secret-token");
    assert.equal(requests[0].headers["anthropic-version"], "2023-06-01");
    assert(models.every((model) => MODEL_ID_PATTERN.test(model.id)));

    // 보관 시간 안에는 다시 요청하지 않고, 지나면 다시 읽되 실패하면 이전 목록을 유지한다.
    assert.equal(await reader.getModels(), models);
    assert.equal(requests.length, 1);

    clock.now += 61 * 60 * 1000;
    fs.writeFileSync(credentialsFile, JSON.stringify({ claudeAiOauth: { accessToken: "secret-token", expiresAt: clock.now + 3600000 } }));
    state.response = { ok: false, status: 500, json: async () => ({}) };

    assert.equal(await reader.getModels(), models);

    state.isDown = true;

    assert.equal(await reader.getModels(), models);
    assert.equal(requests.length, 3);
};

const runChecks = async () => {
    const testDir = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), "autopilot-desktop-"));

    process.env.AP_TEST_DIR = testDir;

    fs.writeFileSync(path.join(testDir, "fakeCli.cjs"), FAKE_CLI_SOURCE);

    try {
        checkChoiceSync();
        checkProjectError(testDir);
        checkReportOpenGuard(testDir);

        await checkClaudeAccount(testDir);
        await checkModelList(testDir);
        await checkUpdateCheck();
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

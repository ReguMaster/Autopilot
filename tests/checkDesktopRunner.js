import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import {
    DEFAULT_EFFORT_LEVEL as UI_DEFAULT_EFFORT_LEVEL,
    DEFAULT_MODEL as UI_DEFAULT_MODEL,
    DEFAULT_POLICY as UI_DEFAULT_POLICY,
    EFFORT_LEVELS as UI_EFFORT_LEVELS,
    MODEL_FAMILIES as UI_MODEL_FAMILIES,
    POLICIES as UI_POLICIES,
    MODES as UI_MODES,
    DEFAULT_MODE as UI_DEFAULT_MODE,
    BUILD_PHASES as UI_BUILD_PHASES,
    PHASE_LABELS as UI_PHASE_LABELS,
    GATE_PHASES as UI_GATE_PHASES,
    DEFAULT_GATES as UI_DEFAULT_GATES,
    ALLOW_KEYS as UI_ALLOW_KEYS,
    DEFAULT_ALLOW as UI_DEFAULT_ALLOW,
    DESIGN_FORMATS as UI_DESIGN_FORMATS,
    DEFAULT_DESIGN_FORMAT as UI_DEFAULT_DESIGN_FORMAT,
    ON_FAIL_CHOICES as UI_ON_FAIL_CHOICES,
    DEFAULT_QA_ON_FAIL as UI_DEFAULT_QA_ON_FAIL,
    DEFAULT_SECURITY_ON_FAIL as UI_DEFAULT_SECURITY_ON_FAIL,
    BRAINSTORM_PHASES as UI_BRAINSTORM_PHASES,
    AI_PROVIDERS as UI_AI_PROVIDERS,
    PROVIDER_LABELS as UI_PROVIDER_LABELS,
    CODEX_EFFORT_LEVELS as UI_CODEX_EFFORT_LEVELS,
    DEFAULT_RUNNER as UI_DEFAULT_RUNNER,
    CODEX_RUNNER as UI_CODEX_RUNNER,
    DEFAULT_DEBATE_TURNS as UI_DEFAULT_DEBATE_TURNS,
    DEBATE_TURNS_LIMIT as UI_DEBATE_TURNS_LIMIT,
    RAIL_WIDTH as UI_RAIL_WIDTH
} from "../desktop/ui/lib/constants.js";
import {
    MODEL_CHOICES as ENGINE_MODELS,
    MODEL_ID_PATTERN as ENGINE_MODEL_ID_PATTERN,
    EFFORT_LEVELS as ENGINE_EFFORTS,
    DEFAULT_MODEL,
    DEFAULT_EFFORT,
    AUTOPILOT_DEFAULTS,
    DEFAULT_COMMIT_PREFIX as ENGINE_COMMIT_PREFIX,
    DEFAULT_WORK_BRANCH as ENGINE_WORK_BRANCH,
    MAX_LINKED_REPOS as ENGINE_MAX_LINKED_REPOS,
    POLICY_ALIASES,
    POLICY_SELF,
    MODES as ENGINE_MODES,
    BUILD_PHASES as ENGINE_BUILD_PHASES,
    PHASE_LABELS as ENGINE_PHASE_LABELS,
    GATE_PHASES as ENGINE_GATE_PHASES,
    ALLOW_KEYS as ENGINE_ALLOW_KEYS,
    DESIGN_FORMATS as ENGINE_DESIGN_FORMATS,
    DEFAULT_DESIGN_FORMAT as ENGINE_DEFAULT_DESIGN_FORMAT,
    DEFAULT_QA_ON_FAIL as ENGINE_DEFAULT_QA_ON_FAIL,
    DEFAULT_SECURITY_ON_FAIL as ENGINE_DEFAULT_SECURITY_ON_FAIL,
    MAX_RUN_DAYS as ENGINE_MAX_RUN_DAYS,
    BRAINSTORM_PHASES as ENGINE_BRAINSTORM_PHASES,
    AI_PROVIDERS as ENGINE_AI_PROVIDERS,
    PROVIDER_LABELS as ENGINE_PROVIDER_LABELS,
    CODEX_MODEL_PATTERN as ENGINE_CODEX_MODEL_PATTERN,
    CODEX_EFFORT_LEVELS as ENGINE_CODEX_EFFORT_LEVELS,
    CODEX_DEFAULT_VALUE as ENGINE_CODEX_DEFAULT_VALUE,
    RUNNERS as ENGINE_RUNNERS,
    DEFAULT_RUNNER as ENGINE_DEFAULT_RUNNER,
    DEBATE_DEFAULT_TURNS as ENGINE_DEBATE_DEFAULT_TURNS,
    DEBATE_TURNS_LIMIT as ENGINE_DEBATE_TURNS_LIMIT
} from "../autopilot/src/utils/config.js";
import engineUtil from "../autopilot/src/utils/util.js";
import phaseUtil from "../autopilot/src/utils/phaseUtil.js";

const require = createRequire(import.meta.url);
const {
    createRunner,
    createInitialState,
    parseLine,
    parseBuildPhase,
    MODEL_CHOICES,
    MODEL_ID_PATTERN,
    EFFORT_CHOICES,
    BUILD_PHASES: RUNNER_BUILD_PHASES,
    PHASE_LABELS: RUNNER_PHASE_LABELS,
    STATUS_OK,
    STATUS_FAILED
} = require("../desktop/autopilotRunner.cjs");
const { getProjectError, canInitGitRepo, initGitRepo, getGitAuthor, createProject, isProjectReportFile, getPhaseDoc, readPhaseDoc, MAX_PHASE_DOC_BYTES } = require("../desktop/projectFiles.cjs");
const { getProjectNameError, toFolderName, getDraftPrompt, parseDraft, getExamplesPrompt, parseExamples, buildProjectBrief, sanitizeBrief, DRAFT_LIMITS } = require("../desktop/projectDraft.cjs");
const { DEFAULT_SETTINGS, MIN_RAIL_WIDTH, MAX_RAIL_WIDTH, DEFAULT_RAIL_WIDTH } = require("../desktop/settingsStore.cjs");
const { createAccountReader, parseLoginExpiryFlag } = require("../desktop/claudeAccount.cjs");
const { createUpdateCheck, isNewerVersion } = require("../desktop/updateCheck.cjs");
const {
    getCliArgs,
    getMains,
    getOtherProvider,
    getAssistedPhases,
    isMains,
    getEndTimeError,
    isValidCommitPrefix,
    isValidWorkBranch,
    DEFAULT_COMMIT_PREFIX,
    DEFAULT_WORK_BRANCH,
    DEFAULT_LOG_RETENTION_DAYS,
    MAX_LINKED_REPOS,
    MODES,
    GATE_PHASES,
    ALLOW_KEYS,
    DESIGN_FORMATS,
    DEFAULT_DESIGN_FORMAT,
    ON_FAIL_PATTERN,
    DEFAULT_QA_ON_FAIL,
    DEFAULT_SECURITY_ON_FAIL,
    BRAINSTORM_PHASES,
    AI_PROVIDERS,
    CODEX_MODEL_PATTERN,
    CODEX_EFFORT_LEVELS,
    CODEX_DEFAULT_VALUE,
    RUNNERS,
    DEFAULT_RUNNER,
    DEBATE_DEFAULT_TURNS,
    DEBATE_TURNS_LIMIT,
    MAX_RUN_DAYS
} = require("../desktop/engineArgs.cjs");

// 러너 상태의 요청 값. 실행 에이전트와 Codex 값을 따로 주지 않으면 Claude·빈 값이다.
const getRequested = (values) => {
    return { runner: "claude", model: "", effort: "", codexModel: "", codexEffort: "", ...values };
};

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
    assert.deepEqual(runner.getState().requested, getRequested({ model: "opus", effort: "high" }));
    assert.equal(runner.getState().model, "opus");

    // 변경은 요청 값만 바꾸고, 다음 회차 로그가 올 때 적용 값이 바뀐다.
    const failedSet = await runner.setRoundOptions({ model: "gpt", effort: "low" });

    assert.equal(failedSet.error.code, "SET_OPTIONS_FAILED");
    assert.deepEqual(runner.getState().requested, getRequested({ model: "opus", effort: "high" }));
    assert.equal((await runner.setRoundOptions({ model: "sonnet", effort: "low" })).status, STATUS_OK);
    assert.deepEqual(runner.getState().requested, getRequested({ model: "sonnet", effort: "low" }));
    assert.equal(readTestFile("OPTIONS"), `--project ${launch.projectDir} --runner claude --model sonnet --effort low --codex-model default --codex-effort default`);

    // Codex로 바꾸면 Codex 값을 넘긴다. 비운 Codex 값은 인자로 줄 수 없어 default다. 다시 Claude로 돌려 2회차 기대값을 지킨다.
    assert.equal((await runner.setRoundOptions({ model: "sonnet", effort: "low", runner: "codex", codexModel: "gpt-6.1-sol", codexEffort: "" })).status, STATUS_OK);
    assert.equal(readTestFile("OPTIONS"), `--project ${launch.projectDir} --runner codex --model sonnet --effort low --codex-model gpt-6.1-sol --codex-effort default`);
    assert.deepEqual(runner.getState().requested, getRequested({ runner: "codex", model: "sonnet", effort: "low", codexModel: "gpt-6.1-sol" }));
    assert.equal((await runner.setRoundOptions({ model: "sonnet", effort: "low" })).status, STATUS_OK);
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
        assert.deepEqual({ ...state.requested }, getRequested({ model: "opus", effort: "high" }));
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
        assert.deepEqual({ ...runner.getState().requested }, getRequested({ model: "sonnet", effort: "low" }));
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
    const createReader = ({ usage = jsonResponse(usageBody), profile = jsonResponse(profileBody), renewCredentials, loginExpiresAtOverride, readKeychain = null } = {}) => {
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
            readKeychain: readKeychain,
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

    fs.writeFileSync(credentialsFile, "{ broken");

    assert.equal((await createReader().refresh()).error.code, "NO_CREDENTIALS");

    fs.rmSync(credentialsFile);

    assert.equal((await createReader().refresh()).error.code, "NO_CREDENTIALS");

    // macOS는 로그인 정보가 키체인에 있다. 파일이 없어도 키체인에서 읽어 조회하고, 둘 다 있으면 만료가 더 늦은 쪽을 쓴다.
    const keychainState = { oauth: { accessToken: "keychain-token", expiresAt: clock.now + 7200000, refreshTokenExpiresAt: clock.now + 86400000 }, isBlocked: false, calls: [] };
    const readKeychain = async (configDir) => {
        keychainState.calls.push(configDir);

        return { oauth: keychainState.oauth, isBlocked: keychainState.isBlocked };
    };
    const keychainReader = createReader({ readKeychain: readKeychain });
    const keychainAccount = await keychainReader.refresh();

    assert.equal(keychainAccount.error, null);
    assert.equal(keychainAccount.limits.length, 3);
    assert.equal(keychainAccount.loginExpiresAt, clock.now + 86400000);
    assert.deepEqual(keychainState.calls, [testDir]);
    assert.equal(requests.at(-1).headers.Authorization, "Bearer keychain-token");
    assert(!JSON.stringify(keychainAccount).includes("keychain-token"));

    writeCredentials({ accessToken: "newer-file-token", expiresAt: clock.now + 9000000 });
    await createReader({ readKeychain: readKeychain }).refresh();

    assert.equal(requests.at(-1).headers.Authorization, "Bearer newer-file-token");

    // 키체인을 읽지 못하면(접근 거부) 안내하고, 한 시간 안에는 다시 묻지 않는다.
    fs.rmSync(credentialsFile);
    keychainState.oauth = null;
    keychainState.isBlocked = true;
    keychainState.calls = [];

    const blockedReader = createReader({ readKeychain: readKeychain });

    assert.equal((await blockedReader.refresh()).error.code, "KEYCHAIN_BLOCKED");

    clock.now += 20 * 60 * 1000;

    assert.equal((await blockedReader.refresh()).error.code, "KEYCHAIN_BLOCKED");
    assert.equal(keychainState.calls.length, 1);

    clock.now += 61 * 60 * 1000;
    keychainState.oauth = { accessToken: "keychain-token", expiresAt: clock.now + 3600000 };
    keychainState.isBlocked = false;

    assert.equal((await blockedReader.refresh()).error, null);
    assert.equal(keychainState.calls.length, 2);
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

    // 꺼 두면 네트워크를 쓰지 않고, 알고 있던 안내는 거둔다.
    const toggled = { isEnabled: true };
    const toggledChanges = [];
    let toggledRequests = 0;
    const toggledCheck = createUpdateCheck({
        currentVersion: "1.0.0",
        fetchImpl: async () => {
            toggledRequests++;

            return { ok: true, status: 200, json: async () => ({ tag_name: "v1.1.0" }) };
        },
        onChange: (update) => toggledChanges.push(update),
        isEnabled: () => toggled.isEnabled
    });

    assert.equal((await toggledCheck.check()).version, "1.1.0");

    toggled.isEnabled = false;

    assert.equal(await toggledCheck.check(), null, "끄면 알고 있던 새 버전 안내를 거둔다");
    assert.equal(await toggledCheck.check(), null);
    assert.equal(toggledRequests, 1, "꺼져 있는 동안은 요청하지 않는다");
    assert.deepEqual(
        toggledChanges.map((update) => update?.version ?? null),
        ["1.1.0", null],
        "안내를 거둘 때 한 번만 알린다"
    );

    toggled.isEnabled = true;

    assert.equal((await toggledCheck.check()).version, "1.1.0");
};

// 엔진 시작 인자: 종료 시각·한도 연장·연장 상한·계정 폴더는 있을 때만 붙고, 연장 상한은 연장이 켜졌을 때만 붙는다.
const checkCliArgs = () => {
    const base = { projectDir: "/p", tasksFile: "/t.md", endTime: "", policy: "auto", extendOnLimit: false, extendLimitMinutes: 0, model: "opus", effort: "high", configDir: "" };

    assert.deepEqual(getCliArgs(base), ["--project", "/p", "--no-open", "--tasks-file", "/t.md", "--policy", "auto", "--model", "opus", "--effort", "high"]);
    assert.deepEqual(getCliArgs({ ...base, endTime: "07:30", configDir: "/c" }).slice(-4), ["--end-time", "07:30", "--config-dir", "/c"]);
    assert(!getCliArgs({ ...base, extendLimitMinutes: 180 }).includes("--max-extend-minutes"), "연장이 꺼져 있으면 연장 상한도 보내지 않는다");
    assert(getCliArgs({ ...base, extendOnLimit: true }).includes("--extend-on-limit"));
    assert(!getCliArgs({ ...base, extendOnLimit: true }).includes("--max-extend-minutes"), "제한 없음(0)이면 연장 상한을 보내지 않는다");
    assert.deepEqual(getCliArgs({ ...base, extendOnLimit: true, extendLimitMinutes: 180 }).slice(-3), ["--extend-on-limit", "--max-extend-minutes", "180"]);

    const defaults = getCliArgs({ ...base, commitPrefix: DEFAULT_COMMIT_PREFIX, workBranch: DEFAULT_WORK_BRANCH });

    assert(!defaults.includes("--commit-prefix") && !defaults.includes("--branch"), "기본값이면 인자를 생략한다");
    assert.deepEqual(getCliArgs({ ...base, commitPrefix: "chore(ai):", workBranch: "bot/work" }).slice(-4), ["--commit-prefix", "chore(ai):", "--branch", "bot/work"]);
    assert(!getCliArgs({ ...base, logRetentionDays: DEFAULT_LOG_RETENTION_DAYS }).includes("--log-retention-days"), "기본 보관 기간이면 인자를 생략한다");
    assert.deepEqual(getCliArgs({ ...base, logRetentionDays: 7 }).slice(-2), ["--log-retention-days", "7"]);
    assert(!getCliArgs(base).includes("--link-project"), "연결 저장소가 없으면 인자를 생략한다");
    assert.deepEqual(getCliArgs({ ...base, linkedRepos: ["/api", "/web"] }).slice(-4), ["--link-project", "/api", "--link-project", "/web"]);

    // 신규 개발 인자는 build일 때만 붙고, 엔진 기본값(확인받기·허용 없음, html, retry:3)과 같으면 생략한다. 계정 폴더는 맨 뒤다.
    const buildBase = {
        ...base,
        mode: "build",
        gates: ["plan", "design"],
        allow: ["deps", "large"],
        designFormat: DEFAULT_DESIGN_FORMAT,
        qaOnFail: DEFAULT_QA_ON_FAIL,
        securityOnFail: DEFAULT_SECURITY_ON_FAIL
    };

    assert.deepEqual(getCliArgs({ ...buildBase, mode: "maintain" }), getCliArgs(base));
    assert.deepEqual(getCliArgs({ ...buildBase, configDir: "/c" }).slice(-8), ["--mode", "build", "--gate", "plan,design", "--allow", "deps,large", "--config-dir", "/c"]);
    assert.deepEqual(getCliArgs({ ...buildBase, gates: [], allow: [] }).slice(-2), ["--mode", "build"]);
    assert.deepEqual(getCliArgs({ ...buildBase, gates: [], allow: [], designFormat: "figma", qaOnFail: "stop" }).slice(-6), ["--mode", "build", "--design-format", "figma", "--qa-on-fail", "stop"]);
    assert.deepEqual(getCliArgs({ ...buildBase, gates: [], allow: [], securityOnFail: "retry:1" }).slice(-4), ["--mode", "build", "--security-on-fail", "retry:1"]);

    // 여러 AI 브레인스토밍은 보내기를 허용했을 때만 넘긴다(Codex에 프로젝트 내용이 나간다). 제공자는 엔진 기본값이라 생략한다.
    assert.deepEqual(getCliArgs({ ...buildBase, gates: [], allow: ["send"], brainstorm: ["plan", "design"], crossReview: true }).slice(-6), [
        "build",
        "--allow",
        "send",
        "--brainstorm",
        "plan,design",
        "--cross-review"
    ]);
    assert.deepEqual(getCliArgs({ ...buildBase, gates: [], allow: ["send"], brainstorm: ["design"] }).slice(-2), ["--brainstorm", "design"]);
    assert.deepEqual(getCliArgs({ ...buildBase, gates: [], allow: [], brainstorm: ["plan"], crossReview: true }).slice(-2), ["--mode", "build"]);
    assert.deepEqual(getCliArgs({ ...buildBase, mode: "maintain", allow: ["send"], brainstorm: ["plan"] }), getCliArgs(base));

    // 협의 단계는 :debate를 붙이고, 교차검토는 나란히 비교하는 단계가 있을 때만 넘긴다. brainstorm에 없는 협의 단계는 넘기지 않는다.
    assert.deepEqual(getCliArgs({ ...buildBase, gates: [], allow: ["send"], brainstorm: ["plan", "design"], debate: ["plan"], crossReview: true }).slice(-3), [
        "--brainstorm",
        "plan:debate,design",
        "--cross-review"
    ]);
    assert.deepEqual(getCliArgs({ ...buildBase, gates: [], allow: ["send"], brainstorm: ["plan"], debate: ["plan", "design"], crossReview: true }).slice(-2), ["--brainstorm", "plan:debate"]);

    // 협의 최대 횟수는 기본값과 다르고 협의하는 단계가 있을 때만 넘긴다(엔진이 협의 없는 --debate-turns를 거부한다).
    const debateBase = { ...buildBase, gates: [], allow: ["send"], brainstorm: ["plan", "design"], debate: ["plan"] };

    assert.deepEqual(getCliArgs({ ...debateBase, debateTurns: 12 }).slice(-4), ["--brainstorm", "plan:debate,design", "--debate-turns", "12"]);
    assert.deepEqual(getCliArgs({ ...debateBase, debateTurns: DEBATE_DEFAULT_TURNS }), getCliArgs(debateBase));
    assert.deepEqual(getCliArgs({ ...debateBase, debate: [], debateTurns: 12 }), getCliArgs({ ...debateBase, debate: [] }));
    assert.deepEqual(getCliArgs({ ...debateBase, brainstorm: ["design"], debateTurns: 12 }), getCliArgs({ ...debateBase, brainstorm: ["design"] }));
    assert.deepEqual(getCliArgs({ ...debateBase, allow: [], debateTurns: 12 }), getCliArgs({ ...debateBase, allow: [] }));

    // Codex의 model·effort는 값이 있을 때만, 보내기를 허용해 브레인스토밍을 켰을 때만 넘긴다(비면 Codex 설정을 따른다).
    const codexBase = { ...buildBase, gates: [], allow: ["send"], brainstorm: ["plan"] };

    assert.deepEqual(getCliArgs({ ...codexBase, codexModel: "gpt-6.1-sol", codexEffort: "high" }).slice(-6), ["--brainstorm", "plan", "--codex-model", "gpt-6.1-sol", "--codex-effort", "high"]);
    assert.deepEqual(getCliArgs({ ...codexBase, codexEffort: "xhigh" }).slice(-4), ["--brainstorm", "plan", "--codex-effort", "xhigh"]);
    assert.deepEqual(getCliArgs({ ...codexBase, codexModel: "", codexEffort: "" }), getCliArgs(codexBase));
    assert.deepEqual(getCliArgs({ ...codexBase, allow: [], codexModel: "gpt-6.1-sol", codexEffort: "high" }), getCliArgs({ ...codexBase, allow: [] }));
    assert.deepEqual(getCliArgs({ ...codexBase, brainstorm: [], codexModel: "gpt-6.1-sol", codexEffort: "high" }), getCliArgs({ ...codexBase, brainstorm: [] }));
    assert.deepEqual(getCliArgs({ ...codexBase, mode: "maintain", codexModel: "gpt-6.1-sol", codexEffort: "high" }), getCliArgs(base));

    // Codex가 회차를 돌리면 작업 모드와 상관없이 --runner codex와 Codex의 model·effort를 넘긴다. 기본 실행 에이전트(Claude)는 인자를 생략한다.
    assert.deepEqual(getCliArgs({ ...base, runner: "codex", codexModel: "gpt-6.1-sol", codexEffort: "high" }).slice(-6), [
        "--runner",
        "codex",
        "--codex-model",
        "gpt-6.1-sol",
        "--codex-effort",
        "high"
    ]);
    assert.deepEqual(getCliArgs({ ...base, runner: "codex", codexModel: "", codexEffort: "" }).slice(-2), ["--runner", "codex"]);
    assert.deepEqual(getCliArgs({ ...base, runner: "claude" }), getCliArgs(base));

    // 단계마다 메인(없으면 claude)과 보조(반대쪽 AI): Codex 보조는 보내기를 허용해야 하고 Claude 보조는 허용과 상관없다(엔진 phaseUtil과 같다).
    assert.deepEqual(getMains(), { plan: "claude", design: "claude", build: "claude", qa: "claude", security: "claude" });
    assert.deepEqual(getMains({ plan: "codex" }).plan, "codex");
    assert.equal(getOtherProvider("claude"), "codex");
    assert.equal(getOtherProvider("codex"), "claude");
    assert(isMains({}) && isMains({ qa: "codex" }) && !isMains({ qa: "gemini" }) && !isMains({ ship: "codex" }) && !isMains(null) && !isMains([]));
    assert.deepEqual(getAssistedPhases({ mode: "build", mains: { plan: "codex" }, brainstorm: ["plan", "design"], allow: [] }), ["plan"]);
    assert.deepEqual(getAssistedPhases({ mode: "build", mains: { plan: "codex" }, brainstorm: ["plan", "design"], allow: ["send"] }), ["plan", "design"]);
    assert.deepEqual(getAssistedPhases({ mode: "maintain", mains: {}, brainstorm: ["plan"], allow: ["send"] }), []);

    // 신규 개발은 --runner를 보내지 않는다(저장된 실행 에이전트가 새어 들지 않게). 단계마다 메인은 --main이 정하고, 기본(claude)이 아닌 단계만 넘긴다.
    assert.deepEqual(getCliArgs({ ...codexBase, runner: "codex", codexModel: "gpt-6.1-sol" }).slice(-4), ["--brainstorm", "plan", "--codex-model", "gpt-6.1-sol"]);
    assert(!getCliArgs({ ...buildBase, runner: "codex" }).includes("--runner"));
    assert.deepEqual(
        getCliArgs({ ...buildBase, gates: [], allow: [], mains: { plan: "claude", build: "claude" } }),
        getCliArgs({ ...buildBase, gates: [], allow: [] }),
        "모두 기본이면 --main을 보내지 않는다"
    );
    assert.deepEqual(getCliArgs({ ...buildBase, gates: [], allow: [], mains: { plan: "codex", security: "codex" } }).slice(-4), ["--mode", "build", "--main", "plan=codex,security=codex"]);
    assert.deepEqual(getCliArgs({ ...buildBase, mode: "maintain", mains: { plan: "codex" } }), getCliArgs(base), "유지 보수에는 --main이 없다");

    // 메인이 Codex이면 보조는 Claude라서 보내기를 허용하지 않아도 브레인스토밍한다. Codex가 메인이므로 Codex의 model·effort도 넘긴다.
    assert.deepEqual(getCliArgs({ ...buildBase, gates: [], allow: [], mains: { plan: "codex" }, brainstorm: ["plan"], crossReview: true, codexModel: "gpt-6.1-sol" }).slice(-9), [
        "--mode",
        "build",
        "--main",
        "plan=codex",
        "--brainstorm",
        "plan",
        "--cross-review",
        "--codex-model",
        "gpt-6.1-sol"
    ]);
    assert.deepEqual(getCliArgs({ ...buildBase, gates: [], allow: [], mains: { plan: "codex" }, brainstorm: ["plan"], debate: ["plan"], debateTurns: 5 }).slice(-6), [
        "--main",
        "plan=codex",
        "--brainstorm",
        "plan:debate",
        "--debate-turns",
        "5"
    ]);

    // 메인이 Claude이면 보조는 Codex라서 보내기가 필요하다. 허용하지 않은 단계는 브레인스토밍에서 빠지고, 남은 단계가 없으면 관련 인자도 없다.
    assert.deepEqual(getCliArgs({ ...buildBase, gates: [], allow: [], mains: { plan: "codex" }, brainstorm: ["plan", "design"], crossReview: true }).slice(-5), [
        "--main",
        "plan=codex",
        "--brainstorm",
        "plan",
        "--cross-review"
    ]);
    assert(!getCliArgs({ ...buildBase, gates: [], allow: [], mains: { plan: "codex" }, brainstorm: ["design"], crossReview: true, codexModel: "gpt-6.1-sol" }).includes("--brainstorm"));
    assert(
        getCliArgs({ ...buildBase, gates: [], allow: [], mains: { plan: "codex" }, brainstorm: ["design"], codexModel: "gpt-6.1-sol" }).includes("--codex-model"),
        "Codex가 메인이면 보조가 없어도 model을 넘긴다"
    );
    assert(!getCliArgs({ ...buildBase, gates: [], allow: [], brainstorm: ["design"], codexModel: "gpt-6.1-sol" }).includes("--codex-model"), "Codex가 관여하지 않으면 넘기지 않는다");

    // 종료 시각: HH:mm은 그대로, 날짜를 붙인 값은 엔진처럼 지났거나 없는 날짜이거나 7일보다 뒤면 거부한다.
    const now = new Date(2026, 9, 30, 22, 10).getTime();

    assert.equal(getEndTimeError("", now), "");
    assert.equal(getEndTimeError("07:00", now), "");
    assert.equal(getEndTimeError("2026-11-02 07:00", now), "");
    assert.equal(getEndTimeError("2026-11-06 22:10", now), "");

    for (const invalidEndTime of ["24:00", "7:00", "2026-10-30 22:00", "2026-10-30 22:10", "2026-11-06 22:11", "2026-02-30 07:00", "2026-11-31 07:00", "2026-11-2 07:00", 700]) {
        assert(getEndTimeError(invalidEndTime, now), `종료 시각 ${invalidEndTime}`);
    }
};

// 신규 개발: 로그의 Mode 헤더와 단계 줄을 상태로 읽고, 엔진 status의 단계 상태를 검증해 읽는다.
// Codex가 돌린 회차 시작 줄은 실행 에이전트를 codex로 읽고, 기본값(Codex 설정을 따름)은 빈 값으로 둔다. 실행 값이 없는 옛 줄은 앞 회차 값을 이어 쓴다.
const checkRunnerLogs = () => {
    const state = createInitialState();

    parseLine(state, "[1회차] 시작 - 남은 시간 300분 (model opus, effort high)");
    parseLine(state, "[2회차] 시작 - 남은 시간 299분 (Codex, model gpt-6.1-sol, effort 기본값)");
    parseLine(state, "[3회차] 시작 - 남은 시간 298분 (Codex, model 기본값, effort low)");
    parseLine(state, "[4회차] 시작 - 남은 시간 297분");

    assert.deepEqual(
        state.rounds.map((round) => [round.runner, round.model, round.effort]),
        [
            ["claude", "opus", "high"],
            ["codex", "gpt-6.1-sol", ""],
            ["codex", "", "low"],
            ["codex", "", "low"]
        ]
    );
    assert.equal(state.runner, "codex");
    assert.deepEqual(state.requested, getRequested({}), "앱이 시작한 엔진은 로그로 요청 값을 바꾸지 않는다");

    // 연결한 엔진은 회차가 실제로 쓴 값을 요청 값으로 본다. Codex 회차는 Claude 값을 그대로 둔다.
    const attached = { ...createInitialState(), attached: true };

    parseLine(attached, "[1회차] 시작 - 남은 시간 300분 (model sonnet, effort low)");
    parseLine(attached, "[2회차] 시작 - 남은 시간 299분 (Codex, model gpt-6.1-sol, effort high)");

    assert.deepEqual(attached.requested, getRequested({ runner: "codex", model: "sonnet", effort: "low", codexModel: "gpt-6.1-sol", codexEffort: "high" }));
};

const checkBuildLogs = () => {
    const state = createInitialState();

    for (const line of ["Mode : 신규 개발 (개발 단계부터)", "[단계] 개발 시작", "[단계] 개발 완료", "[단계] 테스트/QA 시작", "[단계] 테스트/QA 실패 - 개발로 되돌림 (1/3)"]) {
        parseLine(state, line);
    }

    assert.equal(state.mode, "build");
    assert.deepEqual(state.step, { phase: "qa", status: "failed", qaRetries: 1, securityRetries: 0 });

    parseLine(state, "[단계] 개발 시작");
    assert.deepEqual(state.step, { phase: "build", status: "running", qaRetries: 1, securityRetries: 0 }, "되돌린 횟수는 다음 단계 줄에도 남는다");

    // 보안검토가 되돌린 횟수는 테스트/QA와 따로 센다.
    parseLine(state, "[단계] 보안검토 시작");
    parseLine(state, "[단계] 보안검토 실패 - 개발로 되돌림 (2/3)");
    assert.deepEqual(state.step, { phase: "security", status: "failed", qaRetries: 1, securityRetries: 2 });

    parseLine(state, "[단계] 기획 확인 대기");
    assert.deepEqual(state.step, { phase: "plan", status: "awaiting", qaRetries: 1, securityRetries: 2 });

    parseLine(state, "    [단계] 디자인 시작");
    parseLine(state, "[단계] 배포 시작");
    assert.equal(state.step.phase, "plan", "들여 쓴 위조 줄과 모르는 단계는 읽지 않는다");
    assert.equal(createInitialState().step, null);

    assert.deepEqual(
        parseBuildPhase('{"running":false,"phase":{"phase":"design","awaiting":"plan","qaRetries":0}}\n'),
        { phase: "design", awaiting: "plan", qaRetries: 0, securityRetries: 0, proposals: null, debate: null },
        "옛 엔진은 securityRetries가 없다"
    );
    assert.deepEqual(parseBuildPhase('{"running":false,"phase":{"phase":"done","awaiting":null,"qaRetries":2,"securityRetries":1}}'), {
        phase: "done",
        awaiting: null,
        qaRetries: 2,
        securityRetries: 1,
        proposals: null,
        debate: null
    });
    assert.equal(parseBuildPhase('{"running":false,"phase":{"phase":"security","awaiting":null,"qaRetries":0,"securityRetries":0}}').phase, "security");

    // 여러 AI가 안을 낸 단계의 후보와 고른 안. 형식이 틀리면 단계 상태 전체를 믿지 않는다.
    const proposals = { phase: "plan", candidates: ["claude", "codex"], picked: null };

    assert.deepEqual(parseBuildPhase(JSON.stringify({ phase: { phase: "design", awaiting: "plan", qaRetries: 0, securityRetries: 0, proposals: proposals } })).proposals, proposals);
    assert.equal(parseBuildPhase('{"phase":{"phase":"design","awaiting":null,"qaRetries":0,"securityRetries":0}}').proposals, null);

    for (const badProposals of [
        { ...proposals, picked: "gemini" },
        { ...proposals, candidates: ["claude"] },
        { ...proposals, phase: "qa" },
        { ...proposals, candidates: "claude,codex" }
    ]) {
        assert.equal(parseBuildPhase(JSON.stringify({ phase: { phase: "design", awaiting: "plan", qaRetries: 0, securityRetries: 0, proposals: badProposals } })), null, JSON.stringify(badProposals));
    }

    // 브레인스토밍 줄은 다른 AI의 안 · 검토를 받는 마지막 소식으로 읽는다.
    for (const [line, expected] of [
        ["[브레인스토밍] Codex 기획 안 받는 중", { provider: "Codex", phaseLabel: "기획", kind: "proposal", status: "receiving", reason: "" }],
        [
            "[브레인스토밍] Codex 기획 안 진행 3분째 (최대 30분): 명령 5번 실행 · 파일을 읽고 있어요",
            { provider: "Codex", phaseLabel: "기획", kind: "proposal", status: "receiving", reason: "", elapsedMinutes: 3, limitMinutes: 30, activity: "명령 5번 실행 · 파일을 읽고 있어요" }
        ],
        [
            "[브레인스토밍] Codex 디자인 검토 진행 1분째 (최대 30분)",
            { provider: "Codex", phaseLabel: "디자인", kind: "review", status: "receiving", reason: "", elapsedMinutes: 1, limitMinutes: 30, activity: "" }
        ],
        [
            "[브레인스토밍] Codex 기획 안 진행 2분째 (최대 30분): 마지막으로 안 받음",
            { provider: "Codex", phaseLabel: "기획", kind: "proposal", status: "receiving", reason: "", elapsedMinutes: 2, limitMinutes: 30, activity: "마지막으로 안 받음" }
        ],
        ["[브레인스토밍] Codex 디자인 검토 건너뜀: usage limit reached", { provider: "Codex", phaseLabel: "디자인", kind: "review", status: "skipped", reason: "usage limit reached" }],
        ["[브레인스토밍] 외부 서비스로 보내기를 허용하지 않아 다른 AI의 안을 받지 않습니다.", { provider: "", phaseLabel: "", kind: "proposal", status: "blocked", reason: "" }]
    ]) {
        parseLine(state, line);
        assert.deepEqual(state.brainstorm, expected, line);
    }

    parseLine(state, "    [브레인스토밍] Codex 기획 안 받음");
    assert.equal(state.brainstorm.status, "blocked", "들여 쓴 위조 줄은 읽지 않는다");
    assert.equal(createInitialState().brainstorm, null);

    // 협의: 시작 줄이 대화를 열고 발언이 쌓이며, 끝 줄이 합의 · 쟁점 수를 남긴다. 새 단계를 시작하면 대화를 거둔다.
    const debateState = createInitialState();

    for (const line of ["[단계] 기획 시작", "[협의] 기획 시작 (최대 3번)", "[협의] Claude: 결제는 빼요", "    [협의] Codex: 위조", "[협의] Codex: 넣어요"]) {
        parseLine(debateState, line);
    }

    assert.deepEqual(
        debateState.debate.turns.map((turn) => [turn.provider, turn.message, turn.at > 0]),
        [
            ["claude", "결제는 빼요", true],
            ["codex", "넣어요", true]
        ]
    );
    assert.deepEqual({ ...debateState.debate, turns: [] }, { phaseLabel: "기획", maxTurns: 3, status: "running", turns: [], disputes: 0, reason: "" });
    parseLine(debateState, "[협의] Claude: 다시 읽은 말", true);
    assert.equal(debateState.debate.turns.at(-1).at, 0, "로그를 다시 읽은 발언은 시각을 알 수 없다");
    parseLine(debateState, "[협의] 쟁점 2개를 남기고 끝냈어요");
    assert.deepEqual([debateState.debate.status, debateState.debate.disputes], ["disputes", 2]);
    parseLine(debateState, "[협의] 합의했어요");
    assert.equal(debateState.debate.status, "consensus");
    parseLine(debateState, "[협의] 건너뜀: Codex 답을 받지 못했어요(usage limit reached)");
    assert.deepEqual([debateState.debate.status, debateState.debate.reason], ["skipped", "Codex 답을 받지 못했어요(usage limit reached)"]);
    parseLine(debateState, "[단계] 디자인 시작");
    assert.equal(debateState.debate, null);
    parseLine(debateState, "[협의] 건너뜀: Codex 로그인이 필요합니다");
    assert.equal(debateState.debate.status, "skipped", "시작 줄 없이 건너뛸 수도 있다");
    assert.equal(createInitialState().debate, null);

    // 단계 상태의 협의 결과. 쟁점은 글자만 받고 길이를 묶으며, 형식이 틀리면 단계 상태 전체를 믿지 않는다.
    const debate = { phase: "plan", disputes: [{ id: "d1", title: "결제", claude: "빼요", codex: "넣어요" }], resolved: null };
    const withDebate = (value) => JSON.stringify({ phase: { phase: "design", awaiting: "plan", qaRetries: 0, securityRetries: 0, proposals: null, debate: value } });

    assert.deepEqual(parseBuildPhase(withDebate(debate)).debate, debate);
    assert.deepEqual(parseBuildPhase(withDebate({ ...debate, resolved: { d1: "codex", extra: "x" } })).debate.resolved, { d1: "codex" });
    assert.equal(parseBuildPhase(withDebate({ ...debate, disputes: [{ ...debate.disputes[0], title: "가".repeat(700) }] })).debate.disputes[0].title.length, 600);

    for (const badDebate of [
        { ...debate, phase: "qa" },
        { ...debate, disputes: [{ ...debate.disputes[0], id: "1" }] },
        { ...debate, disputes: [{ ...debate.disputes[0], codex: 3 }] },
        { ...debate, resolved: { d1: "gemini" } },
        { ...debate, disputes: "결제" }
    ]) {
        assert.equal(parseBuildPhase(withDebate(badDebate)), null, JSON.stringify(badDebate));
    }

    for (const stdout of [
        '{"running":false}',
        '{"phase":{"phase":"ship","awaiting":null,"qaRetries":0}}',
        '{"phase":{"phase":"qa","awaiting":"qa","qaRetries":0}}',
        '{"phase":{"phase":"qa","awaiting":null,"qaRetries":-1}}',
        '{"phase":{"phase":"qa","awaiting":null,"qaRetries":0,"securityRetries":"1"}}',
        '{"phase":5}',
        "nope",
        ""
    ]) {
        assert.equal(parseBuildPhase(stdout), null, stdout);
    }
};

// .git이 없는 폴더에만 새 저장소를 만들 수 있고, 만들면 main 브랜치에 빈 첫 commit이 있는 Git 루트가 된다.
const checkGitInit = async (testDir) => {
    const repoDir = path.join(testDir, "new repo 한글");
    const gitConfig = path.join(testDir, "git-init.gitconfig");
    const env = { ...process.env, GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: "1" };

    fs.mkdirSync(repoDir);
    fs.writeFileSync(path.join(repoDir, "keep.txt"), "기존 파일\n");
    fs.writeFileSync(gitConfig, "[user]\n\tname = AutoPilot Check\n\temail = check@example.invalid\n");

    assert.equal(canInitGitRepo(repoDir), true);
    assert.equal(canInitGitRepo(path.join(testDir, "missing")), false);
    assert.equal(await initGitRepo(repoDir, { env: env }), "");
    assert.equal(getProjectError(repoDir), "");
    assert.equal(canInitGitRepo(repoDir), false, "이미 저장소면 다시 만들지 않는다");

    const head = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: repoDir, env: env, encoding: "utf8" });

    assert.equal(head.stdout.trim(), "main");
    assert.equal(fs.readFileSync(path.join(repoDir, "keep.txt"), "utf8"), "기존 파일\n", "기존 파일은 그대로 둔다");
    assert.notEqual(await initGitRepo(path.join(testDir, "missing"), { env: env }), "", "실패하면 git이 알려준 이유를 돌려준다");
};

// 새 프로젝트 초안: 폴더 이름 규칙, Claude 답 해석(코드 블록·잡음·개수·길이·모르는 값), brief.md 만들기와 다듬기.
const checkProjectDraftRules = () => {
    for (const name of ["hanbit-booking", "미용실 예약", "a.b", "x".repeat(64)]) {
        assert.equal(getProjectNameError(name), "", name);
    }

    for (const name of ["", "  ", " lead", "trail.", "trail ", "con", "COM1", "nul.txt", "a/b", "a\\b", "a:b", "a?b", "a*b", 'a"b', "a<b", "a|b", "x".repeat(65), "tab\tname"]) {
        assert.notEqual(getProjectNameError(name), "", JSON.stringify(name));
    }

    assert.equal(toFolderName("Hanbit Booking!!"), "hanbit-booking");
    assert.equal(toFolderName("미용실"), "", "영문이 없으면 이름을 비워 사용자가 정하게 한다");
    assert.equal(toFolderName("CON"), "");

    const reply = [
        "초안이에요.",
        "```json",
        JSON.stringify({
            name: "Hanbit Booking",
            summary: "  미용실\n예약 웹앱\u0007 ",
            users: [{ label: "손님", picked: true }, { label: "손님" }, "원장", { label: "" }],
            platforms: ["web", "web", "tv"],
            features: Array.from({ length: 14 }, (item, index) => ({ label: `기능 ${index}`, picked: index < 3 })),
            exclusions: [{ label: "결제".repeat(40), picked: true }],
            stack: { items: ["Next.js", 3, ""], reason: "작아서" }
        }),
        "```"
    ].join("\n");
    const draft = parseDraft(reply);

    assert.equal(draft.name, "hanbit-booking");
    assert.equal(draft.summary, "미용실 예약 웹앱");
    assert.deepEqual(draft.users, [
        { label: "손님", picked: true },
        { label: "원장", picked: true }
    ]);
    assert.deepEqual(draft.platforms, ["web"]);
    assert.equal(draft.features.length, DRAFT_LIMITS.features);
    assert.equal(draft.features[3].picked, false);
    assert.equal(draft.exclusions[0].label.length, DRAFT_LIMITS.label);
    assert.deepEqual(draft.stack, { items: ["Next.js"], reason: "작아서" }, "글자가 아닌 항목은 버린다");

    for (const bad of ["", "그냥 글", "{깨진", "[1, 2]", JSON.stringify({ name: "x" })]) {
        assert.equal(parseDraft(bad), null, bad);
    }

    const prompt = getDraftPrompt({ what: "미용실 예약", platforms: ["web", "nope"] });

    assert.match(prompt, /<설명>\n미용실 예약\n<\/설명>/);
    assert.match(prompt, /사용자가 고른 실행 환경: 웹/);

    // 추천 예시: 이미 보인 이름은 겹치지 않게 부탁하고, 답은 JSON 배열에서 이름·설명·실행 환경을 다듬어 5개까지 받는다.
    assert.match(getExamplesPrompt({ exclude: ["가게 예약 웹앱", ""] }), /겹치지 않게 하라: 가게 예약 웹앱$/);
    assert.doesNotMatch(getExamplesPrompt(), /겹치지 않게/);

    const examples = parseExamples(
        `예시예요 ${JSON.stringify([
            { label: "  동네 서점 재고 ", what: "서점 주인이 재고를\n한눈에 봐요", platforms: ["web", "web", "tv", "mobile", "cli"] },
            { label: "동네 서점 재고", what: "겹치는 이름" },
            { label: "빈 설명", what: "" },
            ...Array.from({ length: 8 }, (item, index) => ({ label: `예시 ${index}`, what: "설명" }))
        ])}`
    );

    assert.deepEqual(examples[0], { label: "동네 서점 재고", what: "서점 주인이 재고를 한눈에 봐요", platforms: ["web", "mobile"] });
    assert.equal(examples.length, 5);
    assert.ok(examples.every((example) => example.label && example.what));

    for (const bad of ["", "그냥 글", "[깨진", "{}", "[1, 2]"]) {
        assert.deepEqual(parseExamples(bad), [], bad);
    }

    const brief = buildProjectBrief({
        name: "hanbit-booking",
        what: "미용실 예약 앱",
        summary: "손님이 예약하는 웹앱",
        users: [{ label: "손님", picked: true }],
        platforms: ["mobile", "web"],
        features: [
            { label: "예약", picked: true },
            { label: "알림", picked: false }
        ],
        exclusions: [],
        stack: { choice: "recommended", items: ["Next.js"], reason: "작아서", custom: [] },
        refs: [{ label: "네이버 예약", picked: true }]
    });

    assert.equal(
        brief,
        [
            "# hanbit-booking",
            "",
            "손님이 예약하는 웹앱",
            "",
            "## 누가 쓰나요",
            "",
            "- 손님",
            "",
            "## 어디서 쓰나요",
            "",
            "- 웹",
            "- 모바일 앱",
            "",
            "## 꼭 있어야 할 기능",
            "",
            "- 예약",
            "",
            "## 기술 스택",
            "",
            "- Next.js",
            "",
            "추천 이유: 작아서",
            "",
            "## 참고할 것",
            "",
            "- 네이버 예약",
            "",
            "## 처음 적은 내용",
            "",
            "미용실 예약 앱",
            ""
        ].join("\n")
    );
    assert.match(
        buildProjectBrief({ name: "", what: "", summary: "", users: [], platforms: [], features: [], exclusions: [], stack: { choice: "later", items: ["X"], reason: "", custom: [] }, refs: [] }),
        /^# 새 프로젝트\n[\s\S]*기획 단계에서 정해요\./
    );
    assert.equal(sanitizeBrief("a\r\nb\u0000c\u0007\n\n\n"), "a\nbc\n");
    assert.equal(sanitizeBrief("x".repeat(40000)).length, 32 * 1024 + 1);
};

// 새 프로젝트 만들기: main 저장소·brief.md 첫 commit·이 저장소에만 쓰는 작성자, 비어 있지 않은 폴더 거부, 실패하면 만든 것만 지운다.
const checkCreateProject = async (testDir) => {
    const parentDir = path.join(testDir, "create parent 한글");
    const emptyConfig = path.join(testDir, "create-empty.gitconfig");
    const userConfig = path.join(testDir, "create-user.gitconfig");
    const bareEnv = { ...process.env, GIT_CONFIG_GLOBAL: emptyConfig, GIT_CONFIG_NOSYSTEM: "1" };
    const userEnv = { ...process.env, GIT_CONFIG_GLOBAL: userConfig, GIT_CONFIG_NOSYSTEM: "1" };
    const git = (cwd, ...args) => spawnSync("git", args, { cwd: cwd, env: bareEnv, encoding: "utf8" }).stdout.trim();
    const brief = "# hanbit-booking\n\n미용실 예약\u0000 웹앱\n";

    fs.mkdirSync(parentDir);
    fs.writeFileSync(emptyConfig, "");
    fs.writeFileSync(userConfig, "[user]\n\tname = AutoPilot Check\n\temail = check@example.invalid\n");

    assert.equal(await getGitAuthor({ env: bareEnv }), null);
    assert.deepEqual(await getGitAuthor({ env: userEnv }), { name: "AutoPilot Check", email: "check@example.invalid" });

    // 작성자가 git에 없으면 받은 작성자를 이 저장소에만 쓴다.
    const created = await createProject({ parentDir: parentDir, name: "hanbit-booking", brief: brief, author: { name: "한빛", email: "hanbit@example.com" }, env: bareEnv });
    const projectDir = path.join(parentDir, "hanbit-booking");

    assert.equal(created.projectDir, projectDir, created.error);
    assert.equal(created.brief, "# hanbit-booking\n\n미용실 예약 웹앱\n");
    assert.equal(getProjectError(projectDir), "");
    assert.equal(git(projectDir, "rev-parse", "--abbrev-ref", "HEAD"), "main");
    assert.equal(git(projectDir, "log", "--format=%an <%ae>|%s"), "한빛 <hanbit@example.com>|init: 프로젝트 초안(brief.md)");
    assert.equal(git(projectDir, "show", "HEAD:docs/autopilot/brief.md"), created.brief.trim());
    assert.equal(git(projectDir, "config", "--local", "user.email"), "hanbit@example.com");
    assert.equal(git(projectDir, "status", "--porcelain"), "");

    // 비어 있지 않은 폴더·잘못된 이름·없는 위치·잘못된 작성자는 디스크를 건드리기 전에 거부한다.
    assert.equal((await createProject({ parentDir: parentDir, name: "hanbit-booking", brief: brief, env: userEnv })).code, "NOT_EMPTY");
    assert.equal((await createProject({ parentDir: parentDir, name: "con", brief: brief, env: userEnv })).code, "INVALID_NAME");
    assert.equal((await createProject({ parentDir: path.join(testDir, "missing"), name: "x", brief: brief, env: userEnv })).code, "INVALID_PARENT");
    assert.equal((await createProject({ parentDir: parentDir, name: "x", brief: brief, author: { name: "a", email: "nope" }, env: userEnv })).code, "INVALID_AUTHOR");
    assert(!fs.existsSync(path.join(parentDir, "x")));

    // 이미 있는 빈 폴더에는 만든다.
    fs.mkdirSync(path.join(parentDir, "empty"));
    assert.equal((await createProject({ parentDir: parentDir, name: "empty", brief: brief, env: userEnv })).projectDir, path.join(parentDir, "empty"));

    // commit이 실패하면(작성자 없음) 새 폴더는 통째로, 이미 있던 빈 폴더는 만든 .git·docs만 지운다.
    const failed = await createProject({ parentDir: parentDir, name: "no-author", brief: brief, env: bareEnv });

    assert.equal(failed.code, "CREATE_FAILED");
    assert(!fs.existsSync(path.join(parentDir, "no-author")), "새로 만든 폴더는 지운다");

    fs.mkdirSync(path.join(parentDir, "kept"));

    assert.equal((await createProject({ parentDir: parentDir, name: "kept", brief: brief, env: bareEnv })).code, "CREATE_FAILED");
    assert.deepEqual(fs.readdirSync(path.join(parentDir, "kept")), [], "이미 있던 빈 폴더는 남기고 만든 것만 지운다");

    const missingGit = await createProject({ parentDir: parentDir, name: "no-git", brief: brief, git: path.join(testDir, "missing-git"), env: userEnv });

    assert.equal(missingGit.code, "CREATE_FAILED");
    assert(!fs.existsSync(path.join(parentDir, "no-git")));
};

// 단계 산출물은 정해진 위치만 읽는다. 디자인은 design.md가 없으면 design/ 폴더 목록이고, 링크로 프로젝트 밖을 가리키면 읽지 않는다.
const checkPhaseDocs = (testDir) => {
    const projectDir = path.join(testDir, "phase docs 한글");
    const docsDir = path.join(projectDir, "docs", "autopilot");
    const outsideDir = path.join(testDir, "phase docs outside");

    fs.mkdirSync(path.join(docsDir, "design", "screens"), { recursive: true });
    fs.mkdirSync(outsideDir, { recursive: true });
    fs.writeFileSync(path.join(docsDir, "plan.md"), "﻿# 기획\n- 화면 6개\n");
    fs.writeFileSync(path.join(docsDir, "design", "index.html"), "<p>x</p>");
    fs.writeFileSync(path.join(docsDir, "qa.md"), "가".repeat(MAX_PHASE_DOC_BYTES));

    assert.deepEqual(readPhaseDoc(projectDir, "plan"), { kind: "file", path: "docs/autopilot/plan.md", text: "# 기획\n- 화면 6개\n", isPartial: false });
    assert.deepEqual(readPhaseDoc(projectDir, "design"), { kind: "folder", path: "docs/autopilot/design", entries: ["index.html", "screens/"] });

    const qaDoc = readPhaseDoc(projectDir, "qa");

    assert.equal(qaDoc.isPartial, true, "256KB를 넘으면 앞부분만 읽는다");
    assert(Buffer.byteLength(qaDoc.text) <= MAX_PHASE_DOC_BYTES);
    assert.equal(readPhaseDoc(projectDir, "security"), null, "보안검토 기록이 없으면 읽을 것이 없다");
    fs.writeFileSync(path.join(docsDir, "security.md"), "| 심각도 | 위치 |\n");
    assert.deepEqual(readPhaseDoc(projectDir, "security"), { kind: "file", path: "docs/autopilot/security.md", text: "| 심각도 | 위치 |\n", isPartial: false });

    // 여러 AI 브레인스토밍: 다른 AI의 안(디자인은 HTML일 수 있다)과 검토는 정해진 이름으로만 읽는다.
    fs.mkdirSync(path.join(docsDir, "proposals"), { recursive: true });
    fs.writeFileSync(path.join(docsDir, "proposals", "plan-codex.md"), "# Codex 기획안\n");
    fs.writeFileSync(path.join(docsDir, "proposals", "design-codex.html"), "<h1>x</h1>");
    fs.writeFileSync(path.join(docsDir, "proposals", "plan-review-claude.md"), "- 빈자리\n");
    assert.equal(readPhaseDoc(projectDir, "plan-codex").path, "docs/autopilot/proposals/plan-codex.md");
    assert.equal(readPhaseDoc(projectDir, "design-codex").path, "docs/autopilot/proposals/design-codex.html");
    assert.equal(readPhaseDoc(projectDir, "plan-review-claude").text, "- 빈자리\n");
    assert.equal(readPhaseDoc(projectDir, "plan-review-codex"), null);

    for (const phase of ["build", "../plan", "constructor", "__proto__", "", "plan-gemini", "proposals/plan-codex", "qa-codex"]) {
        assert.equal(readPhaseDoc(projectDir, phase), null, phase);
    }

    assert.equal(getPhaseDoc("", "plan"), null);

    fs.writeFileSync(path.join(docsDir, "design.md"), "# 디자인\n");
    assert.equal(readPhaseDoc(projectDir, "design").kind, "file");

    // design/이 밖을 가리키는 링크면 design.md가 없을 때 읽을 것이 없다.
    fs.rmSync(path.join(docsDir, "design.md"));
    fs.rmSync(path.join(docsDir, "design"), { recursive: true });
    fs.writeFileSync(path.join(outsideDir, "secret.txt"), "x");
    fs.symlinkSync(outsideDir, path.join(docsDir, "design"), "junction");
    assert.equal(readPhaseDoc(projectDir, "design"), null);
};

// 커밋 접두어·작업 브랜치의 기본값과 검증 규칙은 엔진과 앱이 같아야 한다.
const checkGitNameSync = () => {
    assert.equal(DEFAULT_COMMIT_PREFIX, ENGINE_COMMIT_PREFIX);
    assert.equal(DEFAULT_WORK_BRANCH, ENGINE_WORK_BRANCH);
    assert.equal(DEFAULT_LOG_RETENTION_DAYS, AUTOPILOT_DEFAULTS.logRetentionDays);
    assert.equal(MAX_LINKED_REPOS, ENGINE_MAX_LINKED_REPOS);

    const prefixes = ["[ap]", "chore(ai):", "", " x", "x ", "a`b", "x".repeat(20), "x".repeat(21), "--x", "a\nb", "한글 접두어", "🤖"];
    const branches = ["ai/autopilot", "main", "MASTER", "head", "a..b", "/a", "a/", "a//b", "-a", "a b", "x.lock", "a/b.lock", "a.", ".a", "a".repeat(100), "a".repeat(101), "한글", "a_b", "A1/b2"];

    for (const value of prefixes) {
        assert.equal(isValidCommitPrefix(value), engineUtil.isValidCommitPrefix(value), `커밋 접두어 ${JSON.stringify(value)}`);
    }

    for (const value of branches) {
        assert.equal(isValidWorkBranch(value), engineUtil.isValidWorkBranch(value), `작업 브랜치 ${JSON.stringify(value)}`);
    }

    assert.equal(isValidCommitPrefix(undefined), false);
    assert.equal(isValidWorkBranch(null), false);
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

    // 작업 모드와 신규 개발 값: 엔진·engineArgs·러너·화면이 같아야 하고, 테스트/QA·보안검토 실패 처리는 엔진이 받는 값만 고른다.
    for (const [appValue, uiValue, engineValue] of [
        [MODES, UI_MODES, ENGINE_MODES],
        [GATE_PHASES, UI_GATE_PHASES, ENGINE_GATE_PHASES],
        [ALLOW_KEYS, UI_ALLOW_KEYS, ENGINE_ALLOW_KEYS],
        [DESIGN_FORMATS, UI_DESIGN_FORMATS, ENGINE_DESIGN_FORMATS],
        [DEFAULT_DESIGN_FORMAT, UI_DEFAULT_DESIGN_FORMAT, ENGINE_DEFAULT_DESIGN_FORMAT],
        [DEFAULT_QA_ON_FAIL, UI_DEFAULT_QA_ON_FAIL, ENGINE_DEFAULT_QA_ON_FAIL],
        [DEFAULT_SECURITY_ON_FAIL, UI_DEFAULT_SECURITY_ON_FAIL, ENGINE_DEFAULT_SECURITY_ON_FAIL],
        [RUNNER_BUILD_PHASES, UI_BUILD_PHASES, ENGINE_BUILD_PHASES],
        [RUNNER_PHASE_LABELS, UI_PHASE_LABELS, ENGINE_PHASE_LABELS],
        [BRAINSTORM_PHASES, UI_BRAINSTORM_PHASES, ENGINE_BRAINSTORM_PHASES],
        [AI_PROVIDERS, UI_AI_PROVIDERS, ENGINE_AI_PROVIDERS],
        [ENGINE_PROVIDER_LABELS, UI_PROVIDER_LABELS, ENGINE_PROVIDER_LABELS],
        [CODEX_EFFORT_LEVELS, UI_CODEX_EFFORT_LEVELS, ENGINE_CODEX_EFFORT_LEVELS],
        [DEFAULT_RUNNER, UI_DEFAULT_RUNNER, ENGINE_DEFAULT_RUNNER],
        [RUNNERS, [UI_DEFAULT_RUNNER, UI_CODEX_RUNNER], ENGINE_RUNNERS],
        [CODEX_DEFAULT_VALUE, CODEX_DEFAULT_VALUE, ENGINE_CODEX_DEFAULT_VALUE],
        [DEBATE_DEFAULT_TURNS, UI_DEFAULT_DEBATE_TURNS, ENGINE_DEBATE_DEFAULT_TURNS],
        [DEBATE_TURNS_LIMIT, UI_DEBATE_TURNS_LIMIT, ENGINE_DEBATE_TURNS_LIMIT]
    ]) {
        assert.deepEqual(appValue, engineValue);
        assert.deepEqual(uiValue, engineValue);
    }

    assert(ENGINE_DEBATE_DEFAULT_TURNS >= 1 && ENGINE_DEBATE_DEFAULT_TURNS <= ENGINE_DEBATE_TURNS_LIMIT);
    assert.equal(DEFAULT_SETTINGS.debateTurns, ENGINE_DEBATE_DEFAULT_TURNS);

    assert.equal(CODEX_MODEL_PATTERN.source, ENGINE_CODEX_MODEL_PATTERN.source);

    assert.deepEqual(UI_RAIL_WIDTH, { min: MIN_RAIL_WIDTH, max: MAX_RAIL_WIDTH, default: DEFAULT_RAIL_WIDTH });
    assert.equal(DEFAULT_SETTINGS.railWidth, DEFAULT_RAIL_WIDTH);

    assert.equal(MAX_RUN_DAYS, ENGINE_MAX_RUN_DAYS);
    assert.equal(UI_DEFAULT_MODE, ENGINE_MODES[0]);
    assert.deepEqual(UI_DEFAULT_GATES, DEFAULT_SETTINGS.gates);
    assert.deepEqual(UI_DEFAULT_ALLOW, DEFAULT_SETTINGS.allow);
    assert.equal(DEFAULT_SETTINGS.mode, UI_DEFAULT_MODE);

    for (const value of ["stop", "retry:0", "retry:1", "retry:3", "retry:5", "retry:6", "retry:03", "again"]) {
        assert.equal(ON_FAIL_PATTERN.test(value), UI_ON_FAIL_CHOICES.includes(value), `실패 처리 ${value}`);

        if (ON_FAIL_PATTERN.test(value)) {
            assert.notEqual(phaseUtil.parseOnFail(value), null, `엔진도 ${value}를 받는다`);
        }
    }
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
        checkCliArgs();
        checkRunnerLogs();
        checkBuildLogs();
        checkGitNameSync();
        checkProjectError(testDir);
        await checkGitInit(testDir);
        checkProjectDraftRules();
        await checkCreateProject(testDir);
        checkPhaseDocs(testDir);
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

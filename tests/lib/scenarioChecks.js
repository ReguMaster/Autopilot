import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { STATUS_OK, STATUS_FAILED, PROGRESS_MAX_LINES, PROGRESS_TARGET_LINES } from "../../autopilot/src/utils/config.js";
import { runAutopilot, requestRoundOptions, requestProgressReset, requestBuildCancel, requestPhaseApproval, getRunStatus } from "../../autopilot/src/services/autopilotService.js";
import phaseUtil from "../../autopilot/src/utils/phaseUtil.js";
import progressUtil from "../../autopilot/src/utils/progressUtil.js";
import processUtil from "../../autopilot/src/utils/processUtil.js";
import providerUtil from "../../autopilot/src/utils/providerUtil.js";
import autopilotUtil from "../../autopilot/src/utils/autopilotUtil.js";
import dateUtil from "../../autopilot/src/utils/dateUtil.js";
import { FAKE_CODEX_SOURCE, getEndTime, waitForProcessStop, commitInitialProject, writeCmdWrapper } from "./fixtures.js";

const require = createRequire(import.meta.url);
const { createInitialState, parseLine } = require("../../desktop/autopilotRunner.cjs");

// 단계 시작점(phaseHeads)은 commit 해시라 따로 확인하고, 나머지 상태만 비교할 때 뺀다.
const withoutHeads = ({ phaseHeads, ...rest }) => rest;

const DEFAULT_TASKS = "예약 작업 하나\n- 둘째 줄 한글";
const UNFINISHED_RECORD = "# 진행 기록\n\n## 다음 작업\n- 이어갈 일\n";
const FAILURE_LIMITS = { minMinutes: 0, maxRounds: 5, maxRoundMinutes: 1, retryWaitMinutes: [0, 0, 0] };

// 실제 엔진이 남긴 로그를 데스크톱 러너 파서로 읽은 결과가 엔진의 회차 결과와 같아야 한다.
const checkDesktopLogContract = (result) => {
    const state = createInitialState();
    const logText = fs.readFileSync(result.logFile, "utf8");

    // Claude 출력이나 stderr가 줄 맨 앞에서 제어 줄을 흉내 낼 수 없어야 한다. 위조 줄은 가짜 Claude가 회차를 돌렸을 때만 나온다.
    if (result.rounds.some((round) => round.runner !== "codex")) {
        assert.match(
            logText,
            /^\d{2}:\d{2}:\d{2} 한글 출력 <script>bad<\/script>\n {4}Report : \/forged-report\n {4}AutoPilot 종료 - 가짜 \(9회차\)\n {4}\[9회차\] 완료\n {4}\[커밋\] deadbee \+1 -0 가짜\n {4}성과: 응답 시간 1초 → 0\.5초$/m
        );
    }

    assert.doesNotMatch(logText, /^(Report : \/forged|AutoPilot 종료 - 가짜|\[9회차\]|\[커밋\] deadbee)/m);

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
        state.rounds.map((round) => [round.round, round.outcome, round.runner, round.model, round.effort]),
        result.rounds.map((round) => [round.round, round.outcome, round.runner, round.model, round.effort])
    );

    // 커밋 줄은 회차 결과 줄보다 먼저 와서 그 회차에 붙는다. 들여 쓴 위조 줄은 커밋으로 읽지 않는다.
    const getCommitFields = (rounds) => rounds.map((round) => round.commits.map((commit) => [commit.hash, commit.insertions, commit.deletions, commit.subject]));

    assert.deepEqual(getCommitFields(state.rounds), getCommitFields(result.rounds));

    // 가짜 CLI는 세션을 시작하면 성과 줄이 든 메시지를 한 번 남긴다.
    const sessionCount = (logText.match(/^\d{2}:\d{2}:\d{2} 한글 출력/gm) || []).length;

    assert.deepEqual(
        state.gains.map((gain) => gain.text),
        Array(sessionCount).fill("응답 시간 1초 → 0.5초")
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
        const workDir = path.join(projectDir, ".autopilot");

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
        context.git(projectDir, "check-ignore", "-q", ".autopilot/progress/any.log");
        context.git(projectDir, "check-ignore", "-q", ".autopilot/recycle_bin/any.txt");

        if (!["limit", "limit-long", "timeout", "signal"].includes(mode)) {
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
        const archivePath = record.match(/\.autopilot\/progress\/[\d-]+\/AUTOPILOT_PROGRESS_[0-9a-f-]{36}\.md/)?.[0];

        assert(record.startsWith(progressUtil.PROGRESS_TEMPLATE), result.reason);
        assert(!record.includes("이어갈 일"));
        assert(archivePath, "초기화한 기록에 보관본 경로가 있어야 한다");
        assert.equal(fs.readFileSync(path.join(result.projectDir, archivePath), "utf8"), UNFINISHED_RECORD);
        assert.match(fs.readFileSync(result.logFile, "utf8"), /^\[진행 기록\] 초기화했습니다\. 원본 보관: \.autopilot\/progress\//m);
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

// 신규 개발: 단계를 차례로 밟고, 확인받기로 둔 단계에서 멈췄다가 승인하면 다음 단계부터, 승인 없이 다시 하면 그 단계를 다시 한다.
const checkBuildMode = async (scenarioRunner, context, fakeCliFile) => {
    const projectDir = path.join(context.testDir, "build project 한글");
    const dataDir = scenarioRunner.dataDir;

    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, "work.txt"), "initial\n");

    commitInitialProject(context, projectDir);

    const progressFile = autopilotUtil.getProgressFile(projectDir, dataDir);
    const phaseFile = phaseUtil.getPhaseFile(progressFile);
    const runBuild = (options) => {
        return runAutopilot({
            projectDir: projectDir,
            dataDir: dataDir,
            command: process.execPath,
            commandArgs: [fakeCliFile],
            open: false,
            endTime: getEndTime(),
            mode: "build",
            gates: ["design"],
            tasks: "미용실 예약 웹앱",
            env: { ...context.testEnv, AP_MODE: "build", AP_EXPECTED_CWD: projectDir, AP_GIT: context.gitExecutable, AP_PROGRESS_FILE: progressFile, AP_QA_FAILS: "1", AP_SECURITY_FAILS: "1" },
            limits: { minMinutes: 0, maxRounds: 10, maxRoundMinutes: 1, retryWaitMinutes: [0, 0, 0] },
            ...options
        });
    };
    const readLog = (result) => fs.readFileSync(result.data.logFile, "utf8");
    const readPrompt = () => fs.readFileSync(path.join(projectDir, "prompt.txt"), "utf8");
    const getPhaseLines = (result) => readLog(result).match(/^\[단계\] .+$/gm);

    // 기획은 만들 것이 있어야 시작한다.
    assert.equal((await runBuild({ tasks: "" })).status, STATUS_FAILED);

    const firstRun = await runBuild({ designFormat: "image" });

    assert.equal(firstRun.status, STATUS_OK, firstRun.error?.msg);
    assert.equal(firstRun.data.reason, "디자인 확인 대기");
    assert.deepEqual(getPhaseLines(firstRun), ["[단계] 기획 시작", "[단계] 기획 완료", "[단계] 디자인 시작", "[단계] 디자인 완료", "[단계] 디자인 확인 대기"]);
    assert.match(readLog(firstRun), /^\[설정\] 외부 서비스로 보내기를 허용하지 않아 디자인 산출물을 HTML 와이어프레임으로 만듭니다\.$/m);
    assert.match(readLog(firstRun), /^Mode : 신규 개발 \(기획 단계부터\)$/m);
    assert.deepEqual(withoutHeads(JSON.parse(fs.readFileSync(phaseFile, "utf8"))), {
        phase: "build",
        awaiting: "design",
        qaRetries: 0,
        securityRetries: 0,
        proposals: null,
        debate: null,
        receivedProposal: null
    });
    assert.deepEqual(Object.keys(phaseUtil.readPhase(phaseFile).phaseHeads), ["plan", "design", "build"]);
    assert.match(readPrompt(), /지금 단계는 \[디자인\]/);
    assert.match(readPrompt(), /정적 HTML 와이어프레임/);
    assert.match(readPrompt(), /외부 도구\(Codex, MCP 서버/);
    assert.doesNotMatch(readPrompt(), /개선 정책은/);
    const statusData = getRunStatus({ projectDir: projectDir, dataDir: dataDir }).data;

    assert.deepEqual(
        { ...statusData, phase: withoutHeads(statusData.phase) },
        {
            running: false,
            phase: { phase: "build", awaiting: "design", qaRetries: 0, securityRetries: 0, proposals: null, debate: null, receivedProposal: null }
        }
    );
    checkDesktopLogContract(firstRun.data);

    // 승인 없이 다시 시작하면 돌려보낸 디자인을 수정 요청으로 다시 한다.
    const revisionRun = await runBuild({ tasks: "원장 화면에 주간 보기 추가" });

    assert.equal(revisionRun.data.reason, "디자인 확인 대기");
    assert.deepEqual(getPhaseLines(revisionRun), ["[단계] 디자인 시작", "[단계] 디자인 완료", "[단계] 디자인 확인 대기"]);
    assert.match(readPrompt(), /돌려보낸 것이다/);

    // 승인하면 개발부터 하고, 테스트/QA와 보안검토는 각각 한 번씩 실패해 개발로 되돌린 뒤 통과해 끝난다. 확인 대기가 없으면 승인은 거부한다.
    assert.equal(requestPhaseApproval({ projectDir: projectDir, dataDir: dataDir }).status, STATUS_OK);
    assert.equal(requestPhaseApproval({ projectDir: projectDir, dataDir: dataDir }).status, STATUS_FAILED);

    const finalRun = await runBuild({ tasks: "" });

    assert.equal(finalRun.status, STATUS_OK, finalRun.error?.msg);
    assert.equal(finalRun.data.reason, "신규 개발: 모든 단계 완료");
    assert.deepEqual(getPhaseLines(finalRun), [
        "[단계] 개발 시작",
        "[단계] 개발 완료",
        "[단계] 테스트/QA 시작",
        "[단계] 테스트/QA 실패 - 개발로 되돌림 (1/3)",
        "[단계] 개발 시작",
        "[단계] 개발 완료",
        "[단계] 테스트/QA 시작",
        "[단계] 테스트/QA 완료",
        "[단계] 보안검토 시작",
        "[단계] 보안검토 실패 - 개발로 되돌림 (1/3)",
        "[단계] 개발 시작",
        "[단계] 개발 완료",
        "[단계] 테스트/QA 시작",
        "[단계] 테스트/QA 완료",
        "[단계] 보안검토 시작",
        "[단계] 보안검토 완료"
    ]);
    assert.match(readPrompt(), /지금 단계는 \[보안검토\][\s\S]*<PHASE>\n단계: 보안검토 \(5\/5\)/);
    assert.deepEqual(withoutHeads(phaseUtil.readPhase(phaseFile)), { phase: "done", awaiting: null, qaRetries: 1, securityRetries: 1, proposals: null, debate: null, receivedProposal: null });
    assert.equal((await runBuild({})).status, STATUS_FAILED);

    // 진행 기록 초기화는 단계도 처음(기획)으로 돌린다.
    assert.equal(requestProgressReset({ projectDir: projectDir, dataDir: dataDir }).status, STATUS_OK);
    assert(!fs.existsSync(phaseFile));
};

// 신규 개발 취소: 복구 범위에 따라 저장소를 그 단계·신규 개발의 시작점으로 되돌리고, 되돌리기 전 HEAD와 commit 안 된 변경은 backup ref·stash에 남긴다.
const checkBuildCancel = async (scenarioRunner, context, fakeCliFile) => {
    const projectDir = path.join(context.testDir, "build cancel project");
    const dataDir = scenarioRunner.dataDir;
    const { git } = context;

    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, "work.txt"), "initial\n");
    commitInitialProject(context, projectDir);

    const progressFile = autopilotUtil.getProgressFile(projectDir, dataDir);
    const phaseFile = phaseUtil.getPhaseFile(progressFile);
    const options = { projectDir: projectDir, dataDir: dataDir };
    const getHead = () => git(projectDir, "rev-parse", "HEAD").trim();
    const runBuild = (extraOptions) => {
        return runAutopilot({
            ...options,
            command: process.execPath,
            commandArgs: [fakeCliFile],
            open: false,
            endTime: getEndTime(),
            mode: "build",
            gates: ["design"],
            tasks: "CLI 도구",
            env: { ...context.testEnv, AP_MODE: "build", AP_EXPECTED_CWD: projectDir, AP_GIT: context.gitExecutable, AP_PROGRESS_FILE: progressFile },
            limits: { minMinutes: 0, maxRounds: 10, maxRoundMinutes: 1, retryWaitMinutes: [0, 0, 0] },
            ...extraOptions
        });
    };
    const initialHead = getHead();

    assert.equal(requestBuildCancel(options).status, STATUS_FAILED, "신규 개발을 한 적 없으면 취소할 것이 없다");

    const firstRun = await runBuild({});

    assert.equal(firstRun.data.reason, "디자인 확인 대기");

    const { phaseHeads } = phaseUtil.readPhase(phaseFile);

    assert.equal(phaseHeads.plan, initialHead);
    assert.equal(phaseHeads.build, getHead());
    assert.notEqual(phaseHeads.design, getHead());
    fs.writeFileSync(path.join(projectDir, "scratch.txt"), "작업 중\n");
    assert.equal(requestBuildCancel({ ...options, scope: "nope" }).status, STATUS_FAILED);

    // 이번 단계만: 확인을 기다리던 디자인의 시작점으로 돌아가고, 그 뒤의 변경은 backup과 stash에 남으며, 이어서 하면 디자인부터 한다.
    const phaseCancel = requestBuildCancel({ ...options, scope: "phase" });

    assert.equal(phaseCancel.status, STATUS_OK, phaseCancel.error?.msg);
    assert.equal(getHead(), phaseHeads.design);
    assert.equal(git(projectDir, "rev-parse", phaseCancel.data.backupRef).trim(), phaseHeads.build);
    assert(phaseCancel.data.isStashed);
    assert(!fs.existsSync(path.join(projectDir, "scratch.txt")));
    assert.match(git(projectDir, "stash", "list"), /autopilot cancel backup/);
    assert.deepEqual(phaseUtil.readPhase(phaseFile), { ...phaseUtil.INITIAL_PHASE, phase: "design", phaseHeads: { plan: phaseHeads.plan, design: phaseHeads.design } });
    assert.equal(fs.readFileSync(progressFile, "utf8"), progressUtil.PROGRESS_TEMPLATE);

    const rerun = await runBuild({ tasks: "" });

    assert.equal(rerun.data.reason, "디자인 확인 대기");
    assert.equal(fs.readFileSync(rerun.data.logFile, "utf8").match(/^\[단계\] .+$/gm)[0], "[단계] 디자인 시작");

    // 신규 개발 전체: 시작 전 HEAD로 돌아가고 단계 상태가 사라져 다음 실행이 기획부터 한다.
    const allCancel = requestBuildCancel({ ...options, scope: "all" });

    assert.equal(allCancel.status, STATUS_OK, allCancel.error?.msg);
    assert.equal(getHead(), initialHead);
    assert(allCancel.data.isStashed, "가짜 CLI가 남긴 prompt.txt 같은 commit 안 된 파일도 stash에 남는다");
    assert(!fs.existsSync(phaseFile));
    assert.equal(requestBuildCancel(options).status, STATUS_FAILED);

    // 기록해 둔 시작점이 지금 브랜치의 기록에 없거나(브랜치·기록을 고침) 기록되지 않았으면 저장소를 건드리지 않고 거부한다. 상태만은 그래도 초기화할 수 있다.
    const strayHead = git(projectDir, "commit-tree", "HEAD^{tree}", "-m", "stray").trim();

    phaseUtil.writePhase(phaseFile, { ...phaseUtil.INITIAL_PHASE, phaseHeads: { plan: strayHead } });

    const strayCancel = requestBuildCancel({ ...options, scope: "all" });

    assert.equal(strayCancel.status, STATUS_FAILED);
    assert.match(strayCancel.error.msg, /시작점이 지금 브랜치의 기록에 없습니다/);
    assert.equal(getHead(), initialHead);
    assert(fs.existsSync(phaseFile));

    phaseUtil.writePhase(phaseFile, { ...phaseUtil.INITIAL_PHASE, phase: "qa" });

    const noHeadCancel = requestBuildCancel({ ...options, scope: "phase" });

    assert.equal(noHeadCancel.status, STATUS_FAILED);
    assert.match(noHeadCancel.error.msg, /시작한 시점이 기록되지 않았습니다/);
    assert.equal(requestBuildCancel({ ...options, scope: "state" }).status, STATUS_OK);
    assert(!fs.existsSync(phaseFile));
};

// 건너뛰기: 하지 않기로 한 단계는 멈추지 않는 전환에서는 그 자리에서, 확인받고 멈춘 뒤에는 다음 실행이 시작할 때 넘긴다.
const checkBuildSkip = async (scenarioRunner, context, fakeCliFile) => {
    const projectDir = path.join(context.testDir, "build skip project");
    const dataDir = scenarioRunner.dataDir;

    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, "work.txt"), "initial\n");
    commitInitialProject(context, projectDir);

    const progressFile = autopilotUtil.getProgressFile(projectDir, dataDir);
    const phaseFile = phaseUtil.getPhaseFile(progressFile);
    const runBuild = (options) => {
        return runAutopilot({
            projectDir: projectDir,
            dataDir: dataDir,
            command: process.execPath,
            commandArgs: [fakeCliFile],
            open: false,
            endTime: getEndTime(),
            mode: "build",
            tasks: "CLI 도구",
            env: { ...context.testEnv, AP_MODE: "build", AP_EXPECTED_CWD: projectDir, AP_GIT: context.gitExecutable, AP_PROGRESS_FILE: progressFile },
            limits: { minMinutes: 0, maxRounds: 10, maxRoundMinutes: 1, retryWaitMinutes: [0, 0, 0] },
            ...options
        });
    };
    const readLog = (result) => fs.readFileSync(result.data.logFile, "utf8");
    const readPrompt = () => fs.readFileSync(path.join(projectDir, "prompt.txt"), "utf8");
    const getPhaseLines = (result) => readLog(result).match(/^\[단계\] .+$/gm);

    // 기획에서 확인받고 멈추면 PHASE.json은 바로 다음 단계(디자인)를 가리키고, 승인 뒤 다음 실행이 디자인을 건너뛰고 개발부터 한다.
    const gatedRun = await runBuild({ skip: ["design", "security"], gates: ["plan"] });

    assert.equal(gatedRun.status, STATUS_OK, gatedRun.error?.msg);
    assert.equal(gatedRun.data.reason, "기획 확인 대기");
    assert.match(readLog(gatedRun), /^Skip : 디자인, 보안검토$/m);
    assert.deepEqual(getPhaseLines(gatedRun), ["[단계] 기획 시작", "[단계] 기획 완료", "[단계] 기획 확인 대기"]);
    assert.deepEqual(withoutHeads(phaseUtil.readPhase(phaseFile)), { phase: "design", awaiting: "plan", qaRetries: 0, securityRetries: 0, proposals: null, debate: null, receivedProposal: null });
    assert.equal(requestPhaseApproval({ projectDir: projectDir, dataDir: dataDir }).status, STATUS_OK);

    const finalRun = await runBuild({ skip: ["design", "security"], gates: ["plan"], tasks: "" });

    assert.equal(finalRun.status, STATUS_OK, finalRun.error?.msg);
    assert.equal(finalRun.data.reason, "신규 개발: 모든 단계 완료");
    assert.match(readLog(finalRun), /^Mode : 신규 개발 \(개발 단계부터\)$/m);
    assert.deepEqual(getPhaseLines(finalRun), ["[단계] 디자인 건너뜀", "[단계] 개발 시작", "[단계] 개발 완료", "[단계] 테스트/QA 시작", "[단계] 테스트/QA 완료", "[단계] 보안검토 건너뜀"]);
    assert.match(readPrompt(), /지금 단계는 \[테스트\/QA\][\s\S]*<PHASE>\n단계: 테스트\/QA \(3\/3\)/);
    assert.doesNotMatch(/<PHASE>[\s\S]*<\/PHASE>/.exec(readPrompt())[0], /design\.md|security\.md/);
    assert.equal(phaseUtil.readPhase(phaseFile).phase, "done");
    checkDesktopLogContract(finalRun.data);

    // 확인 없이 이어 가는 전환은 그 자리에서 건너뛴다.
    assert.equal(requestProgressReset({ projectDir: projectDir, dataDir: dataDir }).status, STATUS_OK);

    const inRunSkip = await runBuild({ skip: ["design"], gates: [] });

    assert.equal(inRunSkip.data.reason, "신규 개발: 모든 단계 완료");
    assert.deepEqual(getPhaseLines(inRunSkip), [
        "[단계] 기획 시작",
        "[단계] 기획 완료",
        "[단계] 디자인 건너뜀",
        "[단계] 개발 시작",
        "[단계] 개발 완료",
        "[단계] 테스트/QA 시작",
        "[단계] 테스트/QA 완료",
        "[단계] 보안검토 시작",
        "[단계] 보안검토 완료"
    ]);
    assert.doesNotMatch(readLog(inRunSkip), /^Skip : .*보안검토/m);
    assert.match(readPrompt(), /<PHASE>\n단계: 보안검토 \(4\/4\)/);
    checkDesktopLogContract(inRunSkip.data);

    // 남은 단계를 모두 건너뛰면 할 일이 없어 시작하지 않는다. 단계 상태는 그대로 둔다.
    assert.equal(requestProgressReset({ projectDir: projectDir, dataDir: dataDir }).status, STATUS_OK);
    phaseUtil.writePhase(phaseFile, { ...phaseUtil.INITIAL_PHASE, phase: "qa" });

    const emptyRun = await runBuild({ skip: ["qa", "security"], tasks: "" });

    assert.equal(emptyRun.status, STATUS_FAILED);
    assert.match(emptyRun.error.msg, /모두 건너뛰/);
    assert.equal(phaseUtil.readPhase(phaseFile).phase, "qa");
    assert.equal(requestProgressReset({ projectDir: projectDir, dataDir: dataDir }).status, STATUS_OK);
};

// 보안검토가 pass라고 해도 security.md의 점검 결과가 기준에 못 미치면 통과로 받지 않는다.
// 한 번은 다시 쓰게 하고, 또 모자라면 개발로 되돌리지 않고 보안검토 실패로 끝낸다.
const checkSecurityDoc = async (scenarioRunner, context, fakeCliFile) => {
    const projectDir = path.join(context.testDir, "build security doc project");
    const dataDir = scenarioRunner.dataDir;

    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, "work.txt"), "initial\n");
    commitInitialProject(context, projectDir);

    const progressFile = autopilotUtil.getProgressFile(projectDir, dataDir);
    const phaseFile = phaseUtil.getPhaseFile(progressFile);
    const runSecurity = (securityDoc) => {
        phaseUtil.writePhase(phaseFile, { ...phaseUtil.INITIAL_PHASE, phase: "security" });
        fs.rmSync(path.join(projectDir, phaseUtil.SECURITY_DOC_PATH), { force: true });

        return runAutopilot({
            projectDir: projectDir,
            dataDir: dataDir,
            command: process.execPath,
            commandArgs: [fakeCliFile],
            open: false,
            endTime: getEndTime(),
            mode: "build",
            tasks: "CLI 도구",
            env: { ...context.testEnv, AP_MODE: "build", AP_EXPECTED_CWD: projectDir, AP_GIT: context.gitExecutable, AP_PROGRESS_FILE: progressFile, AP_SECURITY_DOC: securityDoc },
            limits: { minMinutes: 0, maxRounds: 10, maxRoundMinutes: 1, retryWaitMinutes: [0, 0, 0] }
        });
    };
    const readLog = (result) => fs.readFileSync(result.data.logFile, "utf8");
    const readPrompt = () => fs.readFileSync(path.join(projectDir, "prompt.txt"), "utf8");

    // 근거 있는 점검 결과는 그대로 통과한다.
    const goodRun = await runSecurity("good");

    assert.equal(goodRun.data.reason, "신규 개발: 모든 단계 완료");
    assert.doesNotMatch(readLog(goodRun), /^\[보안검토\]/m);
    assert.match(readPrompt(), /\| 항목 \| 상태 \| 근거 \|/);

    // 근거 없는 표는 한 번 다시 쓰게 하고, 고쳐 쓰면 통과한다.
    const onceRun = await runSecurity("once");

    assert.equal(onceRun.data.reason, "신규 개발: 모든 단계 완료");
    assert.equal(readLog(onceRun).match(/^\[보안검토\] .+$/gm).length, 1);
    assert.match(readLog(onceRun), /^\[보안검토\] security\.md 점검 결과가 기준에 못 미쳐 한 번 더 확인해요: '비밀값'의 근거가 없거나 너무 짧다/m);
    assert.match(readPrompt(), /앞 회차가 남긴 `docs\/autopilot\/security\.md`의 점검 결과가 기준에 못 미쳐/);

    // 계속 모자라거나 파일이 없으면 보안검토 실패로 끝내고, 단계는 보안검토에 남겨 다음 실행이 다시 한다.
    for (const securityDoc of ["weak", "none"]) {
        const failedRun = await runSecurity(securityDoc);

        assert.equal(failedRun.status, STATUS_OK, failedRun.error?.msg);
        assert.equal(failedRun.data.reason, "보안검토 실패", securityDoc);
        assert.deepEqual(readLog(failedRun).match(/^\[단계\] .+$/gm), ["[단계] 보안검토 시작", "[단계] 보안검토 실패"], securityDoc);
        assert.equal(readLog(failedRun).match(/^\[보안검토\] .+$/gm).length, 2, securityDoc);
        assert.equal(phaseUtil.readPhase(phaseFile).phase, "security", securityDoc);
        checkDesktopLogContract(failedRun.data);
    }

    assert.equal(requestProgressReset({ projectDir: projectDir, dataDir: dataDir }).status, STATUS_OK);
};

// 보안검토의 독립 검토(--security-review): 메인(Claude)의 반대쪽 AI(Codex)가 pass를 다시 확인한다.
// 심각 · 높음을 찾으면 개발로 되돌리고, 못 쓰거나 답을 읽을 수 없으면 건너뛰고 통과시킨다.
const checkSecurityReview = async (scenarioRunner, context, fakeCliFile) => {
    const projectDir = path.join(context.testDir, "build security review project");
    const dataDir = scenarioRunner.dataDir;
    const fakeCodexFile = path.join(context.testDir, "fake-codex-security.mjs");
    const codexLog = path.join(context.testDir, "codex-security.log");

    fs.writeFileSync(fakeCodexFile, FAKE_CODEX_SOURCE);
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, "work.txt"), "initial\n");
    commitInitialProject(context, projectDir);

    const progressFile = autopilotUtil.getProgressFile(projectDir, dataDir);
    const phaseFile = phaseUtil.getPhaseFile(progressFile);
    const runSecurity = (env, options = {}) => {
        phaseUtil.writePhase(phaseFile, { ...phaseUtil.INITIAL_PHASE, phase: "security" });
        fs.rmSync(codexLog, { force: true });
        fs.rmSync(path.join(projectDir, "security-review-count.txt"), { force: true });
        fs.rmSync(path.join(projectDir, phaseUtil.SECURITY_REVIEW_PATH), { force: true });

        return runAutopilot({
            projectDir: projectDir,
            dataDir: dataDir,
            command: process.execPath,
            commandArgs: [fakeCliFile],
            providerCommands: { codex: { command: process.execPath, args: [fakeCodexFile] } },
            open: false,
            endTime: getEndTime(),
            mode: "build",
            allow: ["send"],
            securityReview: "on",
            tasks: "CLI 도구",
            env: { ...context.testEnv, AP_MODE: "build", AP_EXPECTED_CWD: projectDir, AP_GIT: context.gitExecutable, AP_PROGRESS_FILE: progressFile, AP_CODEX_LOG: codexLog, ...env },
            limits: { minMinutes: 0, maxRounds: 10, maxRoundMinutes: 1, retryWaitMinutes: [0, 0, 0] },
            ...options
        });
    };
    const readLog = (result) => fs.readFileSync(result.data.logFile, "utf8");
    const getLines = (result, kind) => readLog(result).match(new RegExp(`^\\[${kind}\\] .+$`, "gm")) ?? [];
    const readReview = () => fs.readFileSync(path.join(projectDir, phaseUtil.SECURITY_REVIEW_PATH), "utf8");

    // 심각 · 높음이 없으면 통과하고, 그 밖의 지적은 문서에만 남긴다.
    const cleanRun = await runSecurity({});

    assert.equal(cleanRun.status, STATUS_OK, cleanRun.error?.msg);
    assert.equal(cleanRun.data.reason, "신규 개발: 모든 단계 완료");
    assert.deepEqual(getLines(cleanRun, "보안검토"), ["[보안검토] Codex 독립 검토에서 심각 · 높음 문제는 없었어요 (그 밖의 지적 1개)"]);
    assert.deepEqual(getLines(cleanRun, "브레인스토밍"), ["[브레인스토밍] Codex 보안검토 검토 받는 중", "[브레인스토밍] Codex 보안검토 검토 받음"]);
    assert.match(readReview(), /^# 보안검토 독립 검토 \(Codex\)$/m);
    assert.match(readReview(), /\| 낮음 \| README\.md \|/);
    assert.match(fs.readFileSync(codexLog, "utf8"), /보안 검토자다[\s\S]*docs\/autopilot\/security\.md[\s\S]*비밀값/);
    checkDesktopLogContract(cleanRun.data);

    // 심각 · 높음을 찾으면 개발로 되돌려 고친 뒤 다시 하고, 다시 한 검토가 깨끗하면 통과한다. 결과 문서는 개발이 읽고, 표의 `|`는 이스케이프한다.
    const blockingRun = await runSecurity({ AP_SECURITY_REVIEW: "blocking-once" });

    assert.equal(blockingRun.data.reason, "신규 개발: 모든 단계 완료");
    assert.deepEqual(readLog(blockingRun).match(/^\[단계\] .+$/gm), [
        "[단계] 보안검토 시작",
        "[단계] 보안검토 실패 - 개발로 되돌림 (1/3)",
        "[단계] 개발 시작",
        "[단계] 개발 완료",
        "[단계] 테스트/QA 시작",
        "[단계] 테스트/QA 완료",
        "[단계] 보안검토 시작",
        "[단계] 보안검토 완료"
    ]);
    assert.match(getLines(blockingRun, "보안검토")[0], /Codex 독립 검토가 심각 · 높음 문제 1개를 찾았어요$/);
    assert.match(readReview(), /낮음/);
    assert.match(fs.readFileSync(path.join(projectDir, "prompt.txt"), "utf8"), /`docs\/autopilot\/security-review\.md`의 심각 · 높음 항목도 같은 기준으로 다룬다/);

    // 계속 찾으면 보안검토 실패 횟수까지 되돌리고 실패로 끝난다. 결과 문서에는 높음이 남는다.
    const stuckRun = await runSecurity({ AP_SECURITY_REVIEW: "blocking" }, { maxSecurityRetries: 1 });

    assert.equal(stuckRun.data.reason, "보안검토 실패");
    assert.equal(getLines(stuckRun, "보안검토").length, 2);
    assert.match(readReview(), /\| 높음 \| src\/api\.js:10 \| 예약 조회에 권한 확인이 없다 \\\| 다른 사람 예약이 보인다 \|/);

    // 답을 읽을 수 없거나 Codex를 쓸 수 없거나 보내기를 허용하지 않았으면 검토를 건너뛰고 메인의 판정대로 통과한다.
    const badRun = await runSecurity({ AP_SECURITY_REVIEW: "bad" });

    assert.equal(badRun.data.reason, "신규 개발: 모든 단계 완료");
    assert.deepEqual(getLines(badRun, "보안검토"), ["[보안검토] Codex 독립 검토의 답을 읽을 수 없어 건너뜁니다."]);
    assert(!fs.existsSync(path.join(projectDir, phaseUtil.SECURITY_REVIEW_PATH)));

    const missingRun = await runSecurity({ AP_CODEX_LOGIN: "0" });

    assert.equal(missingRun.data.reason, "신규 개발: 모든 단계 완료");
    assert.match(getLines(missingRun, "브레인스토밍").at(-1), /^\[브레인스토밍\] Codex 보안검토 검토 건너뜀: /);

    const blockedRun = await runSecurity({ AP_SECURITY_REVIEW: "blocking" }, { allow: [] });

    assert.equal(blockedRun.data.reason, "신규 개발: 모든 단계 완료");
    assert.deepEqual(getLines(blockedRun, "보안검토"), ["[보안검토] 외부 서비스로 보내기를 허용하지 않아 독립 검토를 건너뜁니다."]);
    assert(!fs.existsSync(codexLog));

    // 엄격 모드(strict): 검토하지 못한 보안검토는 통과시키지 않고 보안검토 실패로 끝낸다. 개발로 되돌리지 않고 단계는 보안검토에 남는다. 검토했으면 on과 같다.
    for (const [env, options, expected] of [
        [{ AP_SECURITY_REVIEW: "bad" }, {}, /Codex 독립 검토의 답을 읽을 수 없어 건너뜁니다/],
        [{ AP_CODEX_LOGIN: "0" }, {}, /Codex 보안검토 검토 건너뜀: /],
        [{}, { allow: [] }, /외부 서비스로 보내기를 허용하지 않아 독립 검토를 건너뜁니다/]
    ]) {
        const strictRun = await runSecurity(env, { securityReview: "strict", ...options });

        assert.equal(strictRun.status, STATUS_OK, strictRun.error?.msg);
        assert.equal(strictRun.data.reason, "보안검토 실패", String(expected));
        assert.match(readLog(strictRun), expected);
        assert.match(readLog(strictRun), /^\[보안검토\] 엄격 모드라 독립 검토를 하지 못한 보안검토는 통과시키지 않아요\.$/m);
        assert.deepEqual(readLog(strictRun).match(/^\[단계\] .+$/gm), ["[단계] 보안검토 시작", "[단계] 보안검토 실패"]);
        assert.equal(phaseUtil.readPhase(phaseFile).phase, "security");
        assert.equal(phaseUtil.readPhase(phaseFile).securityRetries, 0, "되돌리지 않으므로 횟수를 쓰지 않는다");
        checkDesktopLogContract(strictRun.data);
    }

    const strictCleanRun = await runSecurity({}, { securityReview: "strict" });

    assert.equal(strictCleanRun.data.reason, "신규 개발: 모든 단계 완료");
    assert.doesNotMatch(readLog(strictCleanRun), /엄격 모드/);

    const strictBlockingRun = await runSecurity({ AP_SECURITY_REVIEW: "blocking-once" }, { securityReview: "strict" });

    assert.equal(strictBlockingRun.data.reason, "신규 개발: 모든 단계 완료", "찾은 문제가 있으면 엄격 모드도 개발로 되돌린다");
    assert.match(readLog(strictBlockingRun), /^\[단계\] 보안검토 실패 - 개발로 되돌림 \(1\/3\)$/m);

    // 메인이 Codex면 반대쪽인 Claude가 읽기 전용으로 검토하고, 보내기를 허용하지 않아도 된다(내용이 이미 Codex에 간다).
    const claudeReviewRun = await runSecurity({ AP_CODEX_ROUND: "build", AP_SECURITY_REVIEW: "blocking-once" }, { allow: [], mains: { security: "codex" } });

    assert.equal(claudeReviewRun.data.reason, "신규 개발: 모든 단계 완료");
    assert.match(getLines(claudeReviewRun, "보안검토")[0], /Claude 독립 검토가 심각 · 높음 문제 1개를 찾았어요$/);

    assert.equal(requestProgressReset({ projectDir: projectDir, dataDir: dataDir }).status, STATUS_OK);
};

// 여러 AI 브레인스토밍: Codex가 단계 시작 전에 따로 안을 내고 교차검토를 하면, 확인받기를 켜지 않아도 사용자가 고르도록 멈춘다.
// 고른 안은 다음 실행의 첫 회차가 확정한다. Codex가 실패하거나 보내기를 허용하지 않았으면 건너뛰고 Claude 안으로 진행한다.
const checkBrainstorm = async (scenarioRunner, context, fakeCliFile) => {
    const dataDir = scenarioRunner.dataDir;
    const fakeCodexFile = path.join(context.testDir, "fake-codex.mjs");
    const codexLog = path.join(context.testDir, "codex-prompts.log");

    fs.writeFileSync(fakeCodexFile, FAKE_CODEX_SOURCE);

    const createProject = (name) => {
        const projectDir = path.join(context.testDir, name);

        fs.mkdirSync(projectDir, { recursive: true });
        fs.writeFileSync(path.join(projectDir, "work.txt"), "initial\n");
        commitInitialProject(context, projectDir);

        return projectDir;
    };
    const runBrainstorm = (projectDir, { env = {}, ...options } = {}) => {
        return runAutopilot({
            projectDir: projectDir,
            dataDir: dataDir,
            command: process.execPath,
            commandArgs: [fakeCliFile],
            providerCommands: { codex: { command: process.execPath, args: [fakeCodexFile] } },
            open: false,
            endTime: getEndTime(),
            mode: "build",
            gates: [],
            allow: ["send"],
            brainstorm: ["plan"],
            crossReview: true,
            tasks: "미용실 예약 웹앱",
            env: {
                ...context.testEnv,
                AP_MODE: "build",
                AP_EXPECTED_CWD: projectDir,
                AP_GIT: context.gitExecutable,
                AP_PROGRESS_FILE: autopilotUtil.getProgressFile(projectDir, dataDir),
                AP_CODEX_LOG: codexLog,
                ...env
            },
            limits: { minMinutes: 0, maxRounds: 1, maxRoundMinutes: 1, retryWaitMinutes: [0, 0, 0] },
            ...options
        });
    };
    const readLog = (result) => fs.readFileSync(result.data.logFile, "utf8");
    const getLines = (result) => readLog(result).match(/^\[(단계|브레인스토밍)\] .+$/gm);
    const projectDir = createProject("brainstorm project 한글");
    const phaseFile = phaseUtil.getPhaseFile(autopilotUtil.getProgressFile(projectDir, dataDir));

    const firstRun = await runBrainstorm(projectDir);

    assert.equal(firstRun.status, STATUS_OK, firstRun.error?.msg);
    assert.equal(firstRun.data.reason, "기획 확인 대기");
    assert.deepEqual(getLines(firstRun), [
        "[단계] 기획 시작",
        "[브레인스토밍] Codex 기획 안 받는 중",
        "[브레인스토밍] Codex 기획 안 받음",
        "[단계] 기획 완료",
        "[브레인스토밍] Codex 기획 검토 받는 중",
        "[브레인스토밍] Codex 기획 검토 받음",
        "[단계] 기획 확인 대기"
    ]);
    assert(readLog(firstRun).indexOf("Codex 기획 안 받음") < readLog(firstRun).indexOf("[1회차] 시작"));
    assert.equal(fs.readFileSync(path.join(projectDir, "docs/autopilot/proposals/plan-codex.md"), "utf8"), "# Codex 기획안\n\n1) 한 줄 요약\n");
    assert.equal(fs.readFileSync(path.join(projectDir, "docs/autopilot/proposals/plan-review-codex.md"), "utf8"), "- Codex 검토: 빈자리 하나\n");
    assert.match(fs.readFileSync(path.join(projectDir, "prompt.txt"), "utf8"), /독립적으로 쓴다[\s\S]*plan-codex\.md`\(Codex 안\)를 읽고 `docs\/autopilot\/proposals\/plan-review-claude\.md`/);
    assert.match(
        fs.readFileSync(codexLog, "utf8"),
        /^exec -s read-only --color never -m gpt-6\.1-sol -c model_reasoning_effort=high -\n너는 제품 기획자이자 테크 리드다[\s\S]*10\) 위험과 가정[\s\S]*검토자다/m
    );
    assert.deepEqual(phaseUtil.readPhase(phaseFile).proposals, { phase: "plan", candidates: ["claude", "codex"], picked: null });
    checkDesktopLogContract(firstRun.data);

    // 후보가 둘이면 고른 안이 있어야 승인한다. Codex 안을 고르면 다음 실행의 첫 회차가 확정하고 상태에서 지운다.
    assert.equal(requestPhaseApproval({ projectDir: projectDir, dataDir: dataDir }).status, STATUS_FAILED);
    assert.equal(requestPhaseApproval({ projectDir: projectDir, dataDir: dataDir, pick: "codex" }).status, STATUS_OK);
    assert.equal(getRunStatus({ projectDir: projectDir, dataDir: dataDir }).data.phase.proposals.picked, "codex");

    const adoptRun = await runBrainstorm(projectDir);

    assert.equal(adoptRun.status, STATUS_OK, adoptRun.error?.msg);
    assert.match(fs.readFileSync(path.join(projectDir, "prompt.txt"), "utf8"), /사용자가 \[기획\]에서 Codex 안을 골랐다[\s\S]*지금 단계는 \[디자인\]/);
    assert.equal(phaseUtil.readPhase(phaseFile).proposals, null);

    // 보내기를 허용하지 않으면 Codex를 부르지 않고, Codex가 실패하면 건너뛰어 확인받기 설정대로 진행한다.
    const otherDir = createProject("brainstorm skip 한글");
    const codexCalls = fs.readFileSync(codexLog, "utf8").split("---\n").length;
    const blockedRun = await runBrainstorm(otherDir, { allow: [] });

    assert.deepEqual(getLines(blockedRun), ["[브레인스토밍] 외부 서비스로 보내기를 허용하지 않아 다른 AI의 안을 받지 않습니다.", "[단계] 기획 시작", "[단계] 기획 완료", "[단계] 디자인 시작"]);
    assert.equal(fs.readFileSync(codexLog, "utf8").split("---\n").length, codexCalls);
    assert.equal(requestProgressReset({ projectDir: otherDir, dataDir: dataDir }).status, STATUS_OK);

    const failedRun = await runBrainstorm(otherDir, { env: { AP_CODEX_FAIL: "1" } });

    assert.deepEqual(getLines(failedRun), [
        "[단계] 기획 시작",
        "[브레인스토밍] Codex 기획 안 받는 중",
        "[브레인스토밍] Codex 기획 안 건너뜀: usage limit reached",
        "[단계] 기획 완료",
        "[단계] 디자인 시작"
    ]);
    assert.equal(failedRun.data.rounds[0].outcome, "완료");
    assert(!fs.existsSync(path.join(otherDir, "docs/autopilot/proposals/plan-codex.md")));

    // 답이 늦으면 경과 줄로 진행을 알린다. 빠른 답에는 경과 줄이 없다(위의 첫 실행).
    const slowDir = createProject("brainstorm slow 한글");
    const slowRun = await runBrainstorm(slowDir, {
        env: { AP_CODEX_SLOW: "1200" },
        limits: { minMinutes: 0, maxRounds: 1, maxRoundMinutes: 1, retryWaitMinutes: [0, 0, 0], providerHeartbeatMs: 200 }
    });
    const progressLines = readLog(slowRun).match(/^\[브레인스토밍\] Codex 기획 안 진행 .+$/gm);

    assert.equal(slowRun.status, STATUS_OK, slowRun.error?.msg);
    assert(progressLines?.length >= 2, "경과 줄이 반복해서 남아야 한다");
    assert(
        progressLines.every((line) => /^\[브레인스토밍\] Codex 기획 안 진행 0분째 \(최대 1분\)(: 명령 1번 실행 · 파일을 읽고 있어요)?$/.test(line)),
        progressLines.join("\n")
    );
    assert(progressLines.at(-1).endsWith(": 명령 1번 실행 · 파일을 읽고 있어요"), "Codex가 한 일이 경과 줄에 실려야 한다");
    assert.equal(getLines(firstRun).filter((line) => line.includes("진행")).length, 0);
    checkDesktopLogContract(slowRun.data);

    // 모델·Effort를 고르면 Codex 호출마다 넘기고 헤더에 남기고, 고르지 않았으면 기본값(gpt-6.1-sol, high)을 넘기고 남긴다(위의 첫 실행).
    const settingsDir = createProject("brainstorm settings 한글");
    const settingsRun = await runBrainstorm(settingsDir, { codexModel: "gpt-6-luna", codexEffort: "high" });
    const settingsCalls = fs.readFileSync(codexLog, "utf8").split("---\n").slice(-2);

    assert.equal(settingsRun.status, STATUS_OK, settingsRun.error?.msg);
    assert.match(readLog(settingsRun), /^Codex : model gpt-6-luna, effort high$/m);
    assert.match(readLog(firstRun), /^Codex : model gpt-6\.1-sol, effort high$/m);
    assert.equal(settingsCalls.length, 2);
    checkDesktopLogContract(settingsRun.data);

    for (const call of settingsCalls) {
        assert.match(call, /^exec -s read-only --color never -m gpt-6-luna -c model_reasoning_effort=high -\n/);
    }

    // 진행 기록을 초기화한 뒤의 새 신규 개발은 저장소에 남은 앞선 개발의 안을 이어 쓰지 않고 다시 받는다.
    assert.equal(requestProgressReset({ projectDir: settingsDir, dataDir: dataDir }).status, STATUS_OK);

    const resetRun = await runBrainstorm(settingsDir);

    assert.equal(resetRun.status, STATUS_OK, resetRun.error?.msg);
    assert(getLines(resetRun).includes("[브레인스토밍] Codex 기획 안 받는 중"), getLines(resetRun).join("\n"));
};

// Codex 회차 실행(--runner codex): JSONL을 Claude와 같은 로그 형식으로 남기고, 실행 중 set으로 Claude↔Codex를 바꾸며,
// Codex를 쓸 수 없으면 그 회차는 Claude로 돌리고, 사용량 한도는 리셋 시각을 몰라 실패로 센다.
const checkCodexRunner = async (scenarioRunner, context, fakeCliFile) => {
    const dataDir = scenarioRunner.dataDir;
    const fakeCodexFile = path.join(context.testDir, "fake-codex-runner.mjs");
    const codexLog = path.join(context.testDir, "codex-rounds.log");

    fs.writeFileSync(fakeCodexFile, FAKE_CODEX_SOURCE);

    const runCodex = async (name, { env = {}, mode = "idle", ...options } = {}) => {
        const projectDir = path.join(context.testDir, name);

        fs.mkdirSync(projectDir, { recursive: true });
        fs.writeFileSync(path.join(projectDir, "work.txt"), "initial\n");
        commitInitialProject(context, projectDir);
        fs.rmSync(codexLog, { force: true });

        const result = await runAutopilot({
            projectDir: projectDir,
            dataDir: dataDir,
            command: process.execPath,
            commandArgs: [fakeCliFile],
            providerCommands: { codex: { command: process.execPath, args: [fakeCodexFile] } },
            open: false,
            endTime: getEndTime(),
            runner: "codex",
            env: {
                ...context.testEnv,
                AP_MODE: mode,
                AP_EXPECTED_CWD: projectDir,
                AP_GIT: context.gitExecutable,
                AP_PROGRESS_FILE: autopilotUtil.getProgressFile(projectDir, dataDir),
                AP_CODEX_LOG: codexLog,
                ...env
            },
            limits: { minMinutes: 0, maxRounds: 2, maxRoundMinutes: 1, retryWaitMinutes: [0, 0, 0] },
            ...options
        });

        assert(result.data, result.error?.msg);

        const logText = fs.readFileSync(result.data.logFile, "utf8");

        checkDesktopLogContract(result.data);

        return {
            ...result.data,
            projectDir: projectDir,
            logText: logText,
            startLines: logText.match(/^\[\d+회차\] 시작 .+$/gm),
            codexCalls: fs.existsSync(codexLog) ? fs.readFileSync(codexLog, "utf8").split("---\n").slice(1) : []
        };
    };

    const codexRun = await runCodex("codex runner 한글", { codexModel: "gpt-6-luna", codexEffort: "high" });

    assert.equal(codexRun.reason, "회차 상한 2회 도달");
    assert.equal(codexRun.startLines.length, 2);
    assert(
        codexRun.startLines.every((line) => /^\[\d회차\] 시작 - 남은 시간 \d+분 \(Codex, model gpt-6-luna, effort high\)$/.test(line)),
        codexRun.startLines.join("\n")
    );
    assert.deepEqual(
        codexRun.rounds.map((round) => [round.runner, round.model, round.effort, round.outcome, round.commits.length]),
        [
            ["codex", "gpt-6-luna", "high", "완료", 1],
            ["codex", "gpt-6-luna", "high", "완료", 1]
        ]
    );
    assert.equal(codexRun.codexCalls.length, 2);
    assert(codexRun.codexCalls.every((call) => call.startsWith("exec --json --color never --dangerously-bypass-approvals-and-sandbox -m gpt-6-luna -c model_reasoning_effort=high -\n")));
    assert.match(codexRun.codexCalls[0], /^작업 전에 프로젝트 루트의 `CLAUDE\.md`를 직접 읽어/m);
    assert(!fs.existsSync(path.join(codexRun.projectDir, "prompt.txt")), "Codex 회차에는 Claude를 부르지 않는다");
    assert.match(codexRun.logText, /^Runner : Codex$/m);
    assert.match(codexRun.logText, /^\d{2}:\d{2}:\d{2} {3}> Bash npm test$/m);
    assert.match(codexRun.logText, /^\d{2}:\d{2}:\d{2} {3}> Edit work\.txt$/m);
    assert.match(codexRun.logText, /^\d{2}:\d{2}:\d{2} \[세션\] 0199a213-81c0-7800-8aa1-bbab2a035a53 \(codex resume/m);
    assert.match(fs.readFileSync(codexRun.reportFile, "utf8"), /Codex gpt-6-luna high[\s\S]*codex resume 0199a213/);

    // 실행 중 set으로 바꾸면 다음 회차부터 Codex가 돈다. 고르지 않은 model은 기본값이다.
    const switchRun = await runCodex("codex switch 한글", { runner: "claude", mode: "to-codex" });

    assert.match(switchRun.startLines[0], /\(model opus, effort high\)$/);
    assert.match(switchRun.startLines[1], /\(Codex, model gpt-6\.1-sol, effort low\)$/);
    assert.deepEqual(
        switchRun.rounds.map((round) => [round.runner, round.model, round.effort]),
        [
            ["claude", "opus", "high"],
            ["codex", "gpt-6.1-sol", "low"]
        ]
    );
    assert.equal(switchRun.codexCalls.length, 1);
    assert(switchRun.codexCalls[0].startsWith("exec --json --color never --dangerously-bypass-approvals-and-sandbox -m gpt-6.1-sol -c model_reasoning_effort=low -\n"));

    // Codex를 쓸 수 없으면 그 회차는 Claude로 돌리고 이유를 남긴다.
    const fallbackRun = await runCodex("codex fallback 한글", { env: { AP_CODEX_LOGIN: "0" }, limits: { minMinutes: 0, maxRounds: 1, maxRoundMinutes: 1, retryWaitMinutes: [0, 0, 0] } });

    assert.match(fallbackRun.logText, /^\[설정\] Codex를 쓸 수 없어 이번 회차는 Claude로 돌립니다: Codex 로그인이 필요합니다$/m);
    assert.match(fallbackRun.startLines[0], /\(model opus, effort high\)$/);
    assert.equal(fallbackRun.rounds[0].runner, "claude");
    assert(fs.existsSync(path.join(fallbackRun.projectDir, "prompt.txt")));

    // 사용량 한도는 리셋 시각이 없어 대기하지 않고 실패로 센다.
    const limitRun = await runCodex("codex limit 한글", { env: { AP_CODEX_ROUND: "limit" }, limits: { minMinutes: 0, maxRounds: 1, maxRoundMinutes: 1, retryWaitMinutes: [0, 0, 0] } });

    assert.equal(limitRun.rounds[0].outcome, "실패 (exit 1, is_error)");
    assert.match(limitRun.logText, /^\d{2}:\d{2}:\d{2} \[사용량 한도\] Codex You've hit your usage limit\.$/m);
    assert.doesNotMatch(limitRun.logText, /까지 대기/);
};

// 협의: Claude와 Codex가 같은 대화를 이어 가며 주고받고(기본 최대 8번, --debate-turns), 정리 회차가 합의안과 쟁점을 남기면 멈춘다.
// 쟁점은 하나도 빠짐없이 골라야 승인하고, 다음 실행이 고른 입장을 확정한다. Codex가 중간에 실패하면 나란히 비교로 넘어간다.
const checkDebate = async (scenarioRunner, context, fakeCliFile) => {
    const dataDir = scenarioRunner.dataDir;
    const fakeCodexFile = path.join(context.testDir, "fake-codex.mjs");
    const codexLog = path.join(context.testDir, "codex-debate.log");

    fs.writeFileSync(fakeCodexFile, FAKE_CODEX_SOURCE);

    const createProject = (name) => {
        const projectDir = path.join(context.testDir, name);

        fs.mkdirSync(projectDir, { recursive: true });
        fs.writeFileSync(path.join(projectDir, "work.txt"), "initial\n");
        commitInitialProject(context, projectDir);

        return projectDir;
    };
    const runDebate = (projectDir, { env = {}, ...options } = {}) => {
        fs.rmSync(codexLog, { force: true });
        fs.rmSync(`${codexLog}.turns`, { force: true });

        return runAutopilot({
            projectDir: projectDir,
            dataDir: dataDir,
            command: process.execPath,
            commandArgs: [fakeCliFile],
            providerCommands: { codex: { command: process.execPath, args: [fakeCodexFile] } },
            open: false,
            endTime: getEndTime(),
            mode: "build",
            gates: [],
            allow: ["send"],
            brainstorm: ["plan"],
            debate: ["plan"],
            tasks: "미용실 예약 웹앱",
            env: {
                ...context.testEnv,
                AP_MODE: "build",
                AP_EXPECTED_CWD: projectDir,
                AP_GIT: context.gitExecutable,
                AP_PROGRESS_FILE: autopilotUtil.getProgressFile(projectDir, dataDir),
                AP_CODEX_LOG: codexLog,
                ...env
            },
            limits: { minMinutes: 0, maxRounds: 2, maxRoundMinutes: 1, retryWaitMinutes: [0, 0, 0] },
            ...options
        });
    };
    const getLines = (result) => fs.readFileSync(result.data.logFile, "utf8").match(/^\[(단계|협의)\] .+$/gm);
    const readPrompt = (projectDir) => fs.readFileSync(path.join(projectDir, "prompt.txt"), "utf8");
    const getPhaseFile = (projectDir) => phaseUtil.getPhaseFile(autopilotUtil.getProgressFile(projectDir, dataDir));
    const approve = (projectDir, extra = {}) => requestPhaseApproval({ projectDir: projectDir, dataDir: dataDir, ...extra }).status;

    // 첫 번에 둘 다 합의하면 일찍 끝낸다. 정리 회차가 쟁점 없이 끝내면 합의안만 확인한다.
    const consensusDir = createProject("debate consensus 한글");
    const consensusRun = await runDebate(consensusDir, { env: { AP_DEBATE: "consensus" } });

    assert.equal(consensusRun.status, STATUS_OK, consensusRun.error?.msg);
    assert.equal(consensusRun.data.reason, "기획 확인 대기");
    assert.deepEqual(getLines(consensusRun), [
        "[단계] 기획 시작",
        "[협의] 기획 시작 (최대 8번)",
        "[협의] Claude: 좋아요, Codex 안의 화면 묶기를 받을게요.",
        "[협의] Codex: 저도 같은 생각이에요.",
        "[협의] 합의했어요",
        "[단계] 기획 완료",
        "[단계] 기획 확인 대기"
    ]);
    assert.equal(consensusRun.data.rounds.length, 2);
    assert.match(readPrompt(consensusDir), /\[기획\] 협의가 끝났다[\s\S]*plan-disputes\.json/);
    assert.doesNotMatch(readPrompt(consensusDir), /열지 말고 독립적으로/);
    assert.match(fs.readFileSync(path.join(consensusDir, "docs/autopilot/proposals/plan-debate.md"), "utf8"), /^# 기획 협의 기록\n\nClaude와 Codex가 1번 주고받았어요\. 두 AI가 합의했어요\./);
    assert.deepEqual(phaseUtil.readPhase(getPhaseFile(consensusDir)).debate, { phase: "plan", disputes: [], resolved: null });
    assert.equal(phaseUtil.readPhase(getPhaseFile(consensusDir)).proposals, null);
    assert.equal(approve(consensusDir, { pick: "codex" }), STATUS_FAILED);
    assert.equal(approve(consensusDir, { resolve: { d1: "claude" } }), STATUS_FAILED);
    assert.equal(approve(consensusDir), STATUS_OK);

    const consensusAdoptRun = await runDebate(consensusDir, { env: { AP_DEBATE: "consensus" }, limits: { minMinutes: 0, maxRounds: 1, maxRoundMinutes: 1, retryWaitMinutes: [0, 0, 0] } });

    assert.equal(consensusAdoptRun.status, STATUS_OK, consensusAdoptRun.error?.msg);
    assert.match(readPrompt(consensusDir), /사용자가 \[기획\] 협의의 합의안을 확인했다[\s\S]*지금 단계는 \[디자인\]/);
    assert.equal(phaseUtil.readPhase(getPhaseFile(consensusDir)).debate, null);

    // 반대가 없어도 더 개선할 점이 남았으면(합의라고 해도) 이어 가고, Codex가 받아들인 것을 Claude가 더 고칠 것이 없다고 확인하면 Codex의 다음 답을 기다리지 않고 끝낸다.
    const improveDir = createProject("debate improve 한글");
    const improveRun = await runDebate(improveDir, { env: { AP_DEBATE: "improve" } });

    assert.equal(improveRun.status, STATUS_OK, improveRun.error?.msg);
    assert.deepEqual(getLines(improveRun), [
        "[단계] 기획 시작",
        "[협의] 기획 시작 (최대 8번)",
        "[협의] Claude: 결제 흐름을 더 보강하면 좋겠어요.",
        "[협의] Codex: 좋아요, 결제 흐름을 반영할게요.",
        "[협의] Claude: 이제 더 고칠 것이 없어요.",
        "[협의] 합의했어요",
        "[단계] 기획 완료",
        "[단계] 기획 확인 대기"
    ]);
    assert.match(
        fs.readFileSync(path.join(improveDir, "docs/autopilot/proposals/plan-debate.md"), "utf8"),
        /Claude와 Codex가 2번 주고받았어요\. 두 AI가 합의했어요\.[\s\S]*- 더 개선할 점: 결제 흐름 보강/
    );
    assert.match(fs.readFileSync(path.join(improveDir, "debate-claude.log"), "utf8"), /"improve": \["더 개선할 점"\]/);

    // 끝까지 맞추지 못하면 --debate-turns(여기서는 3)번까지 주고받고, 둘 다 이어지는 대화로 묻는다. 쟁점은 정리 회차가 남긴 파일에서 형식이 맞는 것만 d1, d2로 옮긴다.
    const disputeDir = createProject("debate dispute 한글");
    const disputeRun = await runDebate(disputeDir, { effort: "max", codexModel: "gpt-6-luna", codexEffort: "xhigh", debateTurns: 3 });

    assert.equal(disputeRun.status, STATUS_OK, disputeRun.error?.msg);
    assert.deepEqual(getLines(disputeRun), [
        "[단계] 기획 시작",
        "[협의] 기획 시작 (최대 3번)",
        ...Array(3).fill(["[협의] Claude: 저는 결제를 넣지 않는 쪽이 맞다고 봐요. 줄바꿈도 한 줄로 펴져야 해요.", "[협의] Codex: 결제는 처음부터 넣는 게 좋아요."]).flat(),
        "[협의] 쟁점 2개를 남기고 끝냈어요",
        "[단계] 기획 완료",
        "[단계] 기획 확인 대기"
    ]);

    const claudeCalls = fs.readFileSync(path.join(disputeDir, "debate-claude.log"), "utf8").split("---\n").slice(1);
    const codexCalls = fs
        .readFileSync(codexLog, "utf8")
        .split("---\n")
        .filter((call) => call.includes("협의") || call.startsWith("exec resume"));

    assert.equal(claudeCalls.length, 3);
    assert.doesNotMatch(claudeCalls[0], /--resume/);
    // 협의의 Claude 발언도 사용자가 고른 effort를 따른다.
    assert.match(claudeCalls[0], /--effort max /);
    assert.match(claudeCalls[0], /<CLAUDE_안>[\s\S]*<CODEX_안>\n# Codex 기획안/);
    assert.match(claudeCalls[2], /--resume 11111111-2222-3333-4444-555555555555[\s\S]*3\/3번째 주고받기다\. 이번이 마지막 주고받기다/);
    assert.equal(codexCalls.length, 3);
    assert.match(codexCalls[0], /^exec -s read-only --color never -m gpt-6-luna -c model_reasoning_effort=xhigh -\n너는 \[기획\] 협의에 참여한 Codex다/);
    assert.match(codexCalls[1], /^exec resume 01a18d02-d1e7-7b20-831e-d85c25a2b4f2 -c sandbox_mode=read-only -m gpt-6-luna -c model_reasoning_effort=xhigh -\nClaude의 답:/);
    assert.deepEqual(phaseUtil.readPhase(getPhaseFile(disputeDir)).debate, {
        phase: "plan",
        disputes: [
            { id: "d1", title: "결제", claude: "이번엔 빼요", codex: "카드 결제를 넣어요" },
            { id: "d2", title: "화면 수", claude: "6개", codex: "4개" }
        ],
        resolved: null
    });
    assert.equal(getRunStatus({ projectDir: disputeDir, dataDir: dataDir }).data.phase.debate.disputes.length, 2);
    checkDesktopLogContract(disputeRun.data);

    // 쟁점은 모두 골라야 승인한다. 고른 입장은 다음 실행의 첫 일로 합의안에 확정한다.
    assert.equal(approve(disputeDir), STATUS_FAILED);
    assert.equal(approve(disputeDir, { resolve: { d1: "claude" } }), STATUS_FAILED);
    assert.equal(approve(disputeDir, { resolve: { d1: "claude", d2: "codex", d3: "claude" } }), STATUS_FAILED);
    assert.equal(approve(disputeDir, { resolve: { d1: "claude", d2: "codex" } }), STATUS_OK);

    const resolveRun = await runDebate(disputeDir, { limits: { minMinutes: 0, maxRounds: 1, maxRoundMinutes: 1, retryWaitMinutes: [0, 0, 0] } });

    assert.equal(resolveRun.status, STATUS_OK, resolveRun.error?.msg);
    assert.match(readPrompt(disputeDir), /협의에서 못 맞춘 쟁점을 정했다[\s\S]*1\) 결제 → Claude 쪽: 이번엔 빼요 2\) 화면 수 → Codex 쪽: 4개[\s\S]*쟁점 확정/);

    // Codex가 협의 중에 실패하면 협의를 건너뛰고 두 안을 나란히 비교한다. 세션 아이디가 없으면 지금까지 주고받은 말을 다시 보낸다.
    const failDir = createProject("debate fail 한글");
    const failRun = await runDebate(failDir, { env: { AP_CODEX_DEBATE_FAIL_AT: "2", AP_CODEX_NO_SESSION: "1" } });
    const failCodexCalls = fs
        .readFileSync(codexLog, "utf8")
        .split("---\n")
        .filter((call) => call.includes("협의에 참여한 Codex"))
        .slice(-2);

    assert.equal(failRun.status, STATUS_OK, failRun.error?.msg);
    assert.deepEqual(getLines(failRun), [
        "[단계] 기획 시작",
        "[협의] 기획 시작 (최대 8번)",
        "[협의] Claude: 저는 결제를 넣지 않는 쪽이 맞다고 봐요. 줄바꿈도 한 줄로 펴져야 해요.",
        "[협의] Codex: 결제는 처음부터 넣는 게 좋아요.",
        "[협의] Claude: 저는 결제를 넣지 않는 쪽이 맞다고 봐요. 줄바꿈도 한 줄로 펴져야 해요.",
        "[협의] 건너뜀: Codex 답을 받지 못했어요(usage limit reached)",
        "[단계] 기획 완료",
        "[단계] 기획 확인 대기"
    ]);
    assert.equal(failRun.data.rounds.length, 1);
    assert.match(failCodexCalls[1], /^exec -s read-only --color never -m gpt-6\.1-sol -c model_reasoning_effort=high -\n[\s\S]*지금까지 주고받은 말:\nClaude: [\s\S]*Codex: /);
    assert.deepEqual(phaseUtil.readPhase(getPhaseFile(failDir)).proposals, { phase: "plan", candidates: ["claude", "codex"], picked: null });
    assert.equal(phaseUtil.readPhase(getPhaseFile(failDir)).debate, null);

    // 답의 형식이 한 번 틀리면 협의를 버리지 않고 같은 대화에서 형식만 고쳐 다시 받는다.
    const formatDir = createProject("debate format 한글");
    const formatRun = await runDebate(formatDir, { env: { AP_DEBATE: "consensus", AP_CODEX_DEBATE_BAD_AT: "1" } });
    const formatCodexCalls = fs
        .readFileSync(codexLog, "utf8")
        .split("---\n")
        .filter((call) => call.startsWith("exec resume"));

    assert.equal(formatRun.status, STATUS_OK, formatRun.error?.msg);
    assert.deepEqual(getLines(formatRun), [
        "[단계] 기획 시작",
        "[협의] 기획 시작 (최대 8번)",
        "[협의] Claude: 좋아요, Codex 안의 화면 묶기를 받을게요.",
        "[협의] Codex: 저도 같은 생각이에요.",
        "[협의] 합의했어요",
        "[단계] 기획 완료",
        "[단계] 기획 확인 대기"
    ]);
    assert.equal(formatCodexCalls.length, 1);
    assert.match(formatCodexCalls[0], /^exec resume 01a18d02-d1e7-7b20-831e-d85c25a2b4f2 [^\n]*\n방금 답은 정해진 JSON으로 읽을 수 없었다/);
    assert.deepEqual(phaseUtil.readPhase(getPhaseFile(formatDir)).debate, { phase: "plan", disputes: [], resolved: null });

    // 협의 중에 중단하면 나란히 비교로 넘기지 않고 끝내며, 다음 실행이 그 단계와 협의를 다시 한다.
    const stopDir = createProject("debate stop 한글");
    const stopRun = await runDebate(stopDir, { env: { AP_CODEX_DEBATE_STOP_AT: "1" } });

    assert.equal(stopRun.status, STATUS_OK, stopRun.error?.msg);
    assert.equal(stopRun.data.reason, "중단 요청");
    assert.deepEqual(getLines(stopRun), [
        "[단계] 기획 시작",
        "[협의] 기획 시작 (최대 8번)",
        "[협의] Claude: 저는 결제를 넣지 않는 쪽이 맞다고 봐요. 줄바꿈도 한 줄로 펴져야 해요.",
        "[협의] 건너뜀: Codex 답을 받지 못했어요(중단 요청)"
    ]);
    assert.deepEqual(withoutHeads(phaseUtil.readPhase(getPhaseFile(stopDir))), {
        phase: "plan",
        awaiting: null,
        qaRetries: 0,
        securityRetries: 0,
        proposals: null,
        debate: null,
        receivedProposal: "plan"
    });

    const resumeRun = await runDebate(stopDir, { env: { AP_DEBATE: "consensus" } });

    assert.equal(resumeRun.status, STATUS_OK, resumeRun.error?.msg);
    assert.doesNotMatch(fs.readFileSync(resumeRun.data.logFile, "utf8"), /Codex 기획 안 받는 중/);
    assert.equal(resumeRun.data.reason, "기획 확인 대기");
    assert.deepEqual(phaseUtil.readPhase(getPhaseFile(stopDir)).debate, { phase: "plan", disputes: [], resolved: null });

    // 정리 회차가 쟁점 파일을 배열이 아닌 JSON으로 남기면 쟁점을 버리고 합의로 넘기지 않고 한 번 더 그 파일을 쓰게 한다. 또 틀리면 쟁점 없이 넘긴다.
    const brokenLimits = { minMinutes: 0, maxRounds: 4, maxRoundMinutes: 1, retryWaitMinutes: [0, 0, 0] };
    const brokenDir = createProject("debate disputes broken 한글");
    const brokenRun = await runDebate(brokenDir, { env: { AP_DISPUTES: "once" }, debateTurns: 1, limits: brokenLimits });

    assert.equal(brokenRun.status, STATUS_OK, brokenRun.error?.msg);
    assert.equal(brokenRun.data.rounds.length, 3);
    assert.match(readPrompt(brokenDir), /plan-disputes\.json`를 JSON 배열로 읽을 수 없었다/);
    assert.equal(phaseUtil.readPhase(getPhaseFile(brokenDir)).debate.disputes.length, 2);
    assert.match(fs.readFileSync(brokenRun.data.logFile, "utf8"), /^\[협의\] 쟁점 2개를 남기고 끝냈어요$/m);
    checkDesktopLogContract(brokenRun.data);

    const alwaysDir = createProject("debate disputes always 한글");
    const alwaysRun = await runDebate(alwaysDir, { env: { AP_DISPUTES: "always" }, debateTurns: 1, limits: brokenLimits });

    assert.equal(alwaysRun.status, STATUS_OK, alwaysRun.error?.msg);
    assert.equal(alwaysRun.data.reason, "기획 확인 대기");
    assert.equal(alwaysRun.data.rounds.length, 3);
    assert.deepEqual(phaseUtil.readPhase(getPhaseFile(alwaysDir)).debate, { phase: "plan", disputes: [], resolved: null });

    // 같은 단계를 다시 협의하면 앞선 협의의 쟁점 파일이 저장소에 남아 있다. 정리 회차가 새로 쓰지 않았으면 옛 쟁점을 이번 결과로 읽지 않고 한 번 더 쓰게 한다.
    const staleDir = path.join(context.testDir, "debate disputes stale 한글");

    fs.mkdirSync(path.join(staleDir, "docs/autopilot/proposals"), { recursive: true });
    fs.writeFileSync(path.join(staleDir, "docs/autopilot/proposals/plan-disputes.json"), JSON.stringify([{ title: "옛 쟁점", claude: "빼요", codex: "넣어요" }]));
    createProject("debate disputes stale 한글");

    const staleRun = await runDebate(staleDir, { env: { AP_DEBATE: "consensus", AP_DISPUTES: "skip" }, debateTurns: 1, limits: brokenLimits });

    assert.equal(staleRun.status, STATUS_OK, staleRun.error?.msg);
    assert.equal(staleRun.data.rounds.length, 3);
    assert.match(readPrompt(staleDir), /plan-disputes\.json`를 JSON 배열로 읽을 수 없었다/);
    assert.deepEqual(phaseUtil.readPhase(getPhaseFile(staleDir)).debate, { phase: "plan", disputes: [], resolved: null });
};

// 하이브리드: 단계마다 메인 AI(그 단계의 회차를 돌린다)를 고르고, 보조는 늘 반대쪽 AI다. Claude가 보조일 때도 안 · 검토 · 협의가 같은 흐름이다.
const checkHybrid = async (scenarioRunner, context, fakeCliFile) => {
    const dataDir = scenarioRunner.dataDir;
    const fakeCodexFile = path.join(context.testDir, "fake-codex-hybrid.mjs");
    const codexLog = path.join(context.testDir, "codex-hybrid.log");

    fs.writeFileSync(fakeCodexFile, FAKE_CODEX_SOURCE);

    const createProject = (name) => {
        const projectDir = path.join(context.testDir, name);

        fs.mkdirSync(projectDir, { recursive: true });
        fs.writeFileSync(path.join(projectDir, "work.txt"), "initial\n");
        commitInitialProject(context, projectDir);

        return projectDir;
    };
    const runHybrid = (projectDir, { env = {}, ...options } = {}) => {
        fs.rmSync(codexLog, { force: true });
        fs.rmSync(`${codexLog}.turns`, { force: true });

        return runAutopilot({
            projectDir: projectDir,
            dataDir: dataDir,
            command: process.execPath,
            commandArgs: [fakeCliFile],
            providerCommands: { codex: { command: process.execPath, args: [fakeCodexFile] } },
            open: false,
            endTime: getEndTime(),
            mode: "build",
            gates: [],
            allow: [],
            tasks: "미용실 예약 웹앱",
            env: {
                ...context.testEnv,
                AP_MODE: "build",
                AP_CODEX_ROUND: "build",
                AP_EXPECTED_CWD: projectDir,
                AP_GIT: context.gitExecutable,
                AP_PROGRESS_FILE: autopilotUtil.getProgressFile(projectDir, dataDir),
                AP_CODEX_LOG: codexLog,
                ...env
            },
            limits: { minMinutes: 0, maxRounds: 1, maxRoundMinutes: 1, retryWaitMinutes: [0, 0, 0] },
            ...options
        });
    };
    const readLog = (result) => fs.readFileSync(result.data.logFile, "utf8");
    const getLines = (result, kinds) => readLog(result).match(new RegExp(`^\\[(${kinds.join("|")})\\] .+$`, "gm"));
    const getPhaseFile = (projectDir) => phaseUtil.getPhaseFile(autopilotUtil.getProgressFile(projectDir, dataDir));
    const readProposal = (projectDir, name) => fs.readFileSync(path.join(projectDir, "docs/autopilot/proposals", name), "utf8");
    const splitCalls = (file) => fs.readFileSync(file, "utf8").split("---\n").slice(1);

    // 단계마다 메인이 다르다: 기획은 Codex, 나머지는 Claude(기본). 회차마다 그 단계의 메인이 돌고 헤더에 단계별 메인이 남는다.
    const mixedDir = createProject("hybrid mixed 한글");
    const mixedRun = await runHybrid(mixedDir, { mains: { plan: "codex" }, limits: { minMinutes: 0, maxRounds: 3, maxRoundMinutes: 1, retryWaitMinutes: [0, 0, 0] } });

    assert.equal(mixedRun.status, STATUS_OK, mixedRun.error?.msg);
    assert.deepEqual(
        mixedRun.data.rounds.map((round) => round.runner),
        ["codex", "claude", "claude"]
    );
    assert.match(readLog(mixedRun), /^Main : 기획 Codex, 디자인 Claude, 개발 Claude, 테스트\/QA Claude, 보안검토 Claude$/m);
    assert.match(readLog(mixedRun), /^\[1회차\] 시작 - 남은 시간 \d+분 \(Codex, model gpt-6\.1-sol, effort high\)$/m);
    assert.match(readLog(mixedRun), /^\[2회차\] 시작 - 남은 시간 \d+분 \(model opus, effort high\)$/m);
    assert.deepEqual(getLines(mixedRun, ["단계"]), [
        "[단계] 기획 시작",
        "[단계] 기획 완료",
        "[단계] 디자인 시작",
        "[단계] 디자인 완료",
        "[단계] 개발 시작",
        "[단계] 개발 완료",
        "[단계] 테스트/QA 시작"
    ]);

    const mixedCodexCalls = splitCalls(codexLog);

    assert.equal(mixedCodexCalls.length, 1);
    assert.match(mixedCodexCalls[0], /^exec --json[\s\S]*\n작업 전에 프로젝트 루트의 `CLAUDE\.md`를 직접 읽어[\s\S]*지금 단계는 \[기획\]/);
    assert.match(fs.readFileSync(path.join(mixedDir, "prompt.txt"), "utf8"), /지금 단계는 \[개발\]/);
    checkDesktopLogContract(mixedRun.data);

    // 메인이 Codex이고 보조가 Claude: Claude가 읽기 도구로 안을 내고(코드 블록은 걷는다) 검토도 한다. 보조가 Claude이면 보내기를 허용하지 않아도 된다.
    const compareDir = createProject("hybrid compare 한글");
    const compareRun = await runHybrid(compareDir, { mains: { plan: "codex" }, brainstorm: ["plan"], crossReview: true });

    assert.equal(compareRun.status, STATUS_OK, compareRun.error?.msg);
    assert.equal(compareRun.data.reason, "기획 확인 대기");
    assert.equal(compareRun.data.rounds[0].runner, "codex");
    assert.deepEqual(getLines(compareRun, ["단계", "브레인스토밍"]), [
        "[단계] 기획 시작",
        "[브레인스토밍] Claude 기획 안 받는 중",
        "[브레인스토밍] Claude 기획 안 받음",
        "[단계] 기획 완료",
        "[브레인스토밍] Claude 기획 검토 받는 중",
        "[브레인스토밍] Claude 기획 검토 받음",
        "[단계] 기획 확인 대기"
    ]);
    assert.equal(readProposal(compareDir, "plan-claude.md"), "# Claude 기획안\n\n1) 한 줄 요약\n");
    assert.equal(readProposal(compareDir, "plan-review-claude.md"), "- Claude 검토: 빈자리 하나\n");

    const assistCalls = splitCalls(path.join(compareDir, "assist-claude.log"));

    assert.equal(assistCalls.length, 2);
    assert.match(assistCalls[0], /--tools=Read,Glob,Grep[\s\S]*\n너는 제품 기획자이자 테크 리드다/);
    assert.match(assistCalls[1], /검토자다/);
    assert.match(splitCalls(codexLog)[0], /`docs\/autopilot\/proposals\/plan-claude\.md`\(Claude 안\)를 읽고 `docs\/autopilot\/proposals\/plan-review-codex\.md`[\s\S]*`\[ap\] 기획: Claude 안 보관`/);
    assert.deepEqual(phaseUtil.readPhase(getPhaseFile(compareDir)).proposals, { phase: "plan", candidates: ["codex", "claude"], picked: null });
    checkDesktopLogContract(compareRun.data);

    // 후보는 메인이 맨 앞이다. 보조(Claude) 안을 고르면 다음 실행의 첫 회차가 메인(Codex)의 기획서를 proposals/로 옮기고 그 안을 확정한다.
    assert.equal(requestPhaseApproval({ projectDir: compareDir, dataDir: dataDir }).status, STATUS_FAILED);
    assert.equal(requestPhaseApproval({ projectDir: compareDir, dataDir: dataDir, pick: "claude" }).status, STATUS_OK);

    const adoptRun = await runHybrid(compareDir, { mains: { plan: "codex" }, brainstorm: ["plan"], crossReview: true });

    assert.equal(adoptRun.status, STATUS_OK, adoptRun.error?.msg);
    assert.equal(adoptRun.data.rounds[0].runner, "claude");
    assert.match(
        fs.readFileSync(path.join(compareDir, "prompt.txt"), "utf8"),
        /사용자가 \[기획\]에서 Claude 안을 골랐다\. 지금 단계의 일을 하기 전에 먼저 지금 `docs\/autopilot\/plan\.md`\(Codex 안\)를 `docs\/autopilot\/proposals\/plan-codex\.md`로 옮기고[\s\S]*지금 단계는 \[디자인\]/
    );
    assert.equal(phaseUtil.readPhase(getPhaseFile(compareDir)).proposals, null);

    // 메인이 Codex이고 보조가 Claude인 협의: Codex가 먼저 말하고 Claude가 답하며, 정리 회차도 메인(Codex)이 돌린다.
    const debateDir = createProject("hybrid debate 한글");
    const debateRun = await runHybrid(debateDir, {
        mains: { plan: "codex" },
        brainstorm: ["plan"],
        debate: ["plan"],
        debateTurns: 2,
        limits: { minMinutes: 0, maxRounds: 2, maxRoundMinutes: 1, retryWaitMinutes: [0, 0, 0] }
    });

    assert.equal(debateRun.status, STATUS_OK, debateRun.error?.msg);
    assert.equal(debateRun.data.reason, "기획 확인 대기");
    assert.deepEqual(
        debateRun.data.rounds.map((round) => round.runner),
        ["codex", "codex"]
    );
    assert.deepEqual(getLines(debateRun, ["단계", "협의"]), [
        "[단계] 기획 시작",
        "[협의] 기획 시작 (최대 2번)",
        ...Array(2).fill(["[협의] Codex: 결제는 처음부터 넣는 게 좋아요.", "[협의] Claude: 저는 결제를 넣지 않는 쪽이 맞다고 봐요. 줄바꿈도 한 줄로 펴져야 해요."]).flat(),
        "[협의] 쟁점 1개를 남기고 끝냈어요",
        "[단계] 기획 완료",
        "[단계] 기획 확인 대기"
    ]);

    const debateClaudeCalls = splitCalls(path.join(debateDir, "debate-claude.log"));
    // Codex가 회차도 돌리므로 협의 발언만 가린다(회차 프롬프트에도 협의라는 말이 있다).
    const debateCodexCalls = splitCalls(codexLog).filter((call) => call.includes("협의에 참여한 Codex") || call.startsWith("exec resume"));

    assert.equal(debateClaudeCalls.length, 2);
    assert.doesNotMatch(debateClaudeCalls[0], /--resume/);
    assert.match(debateClaudeCalls[0], /너는 \[기획\] 협의에 참여한 Claude다[\s\S]*아래 Codex의 발언에 답한다[\s\S]*<CLAUDE_안>\n# Claude 기획안[\s\S]*<CODEX_안>[\s\S]*Codex의 발언: /);
    assert.match(debateClaudeCalls[1], /--resume 11111111-2222-3333-4444-555555555555[\s\S]*2\/2번째 주고받기다\. 이번이 마지막 주고받기다/);
    assert.equal(debateCodexCalls.length, 2);
    assert.match(
        debateCodexCalls[0],
        /^exec -s read-only --color never -m gpt-6\.1-sol -c model_reasoning_effort=high -\n너는 \[기획\] 협의에 참여한 Codex다[\s\S]*두 안을 읽고 먼저 Claude 안을 네 안과 비교해 의견을 말한다/
    );
    assert.match(debateCodexCalls[1], /^exec resume 01a18d02-d1e7-7b20-831e-d85c25a2b4f2 -c sandbox_mode=read-only -m gpt-6\.1-sol -c model_reasoning_effort=high -\nClaude의 답:/);
    assert.match(splitCalls(codexLog).at(-1), /협의가 끝났다[\s\S]*두 안\(`docs\/autopilot\/plan\.md`, `docs\/autopilot\/proposals\/plan-claude\.md`\)/);
    assert.deepEqual(phaseUtil.readPhase(getPhaseFile(debateDir)).debate, {
        phase: "plan",
        disputes: [{ id: "d1", title: "결제", claude: "이번엔 빼요", codex: "카드 결제를 넣어요" }],
        resolved: null
    });
    assert.match(readProposal(debateDir, "plan-debate.md"), /^# 기획 협의 기록\n\nClaude와 Codex가 2번 주고받았어요\. /);
    checkDesktopLogContract(debateRun.data);

    // 메인이 Codex인데 쓸 수 없으면 그 단계는 Claude가 메인이고 보조 없이 진행한다(회차 실패로 세지 않는다).
    const missingDir = createProject("hybrid missing 한글");
    const missingRun = await runHybrid(missingDir, { mains: { plan: "codex" }, brainstorm: ["plan"], crossReview: true, env: { AP_CODEX_LOGIN: "0" } });

    assert.equal(missingRun.status, STATUS_OK, missingRun.error?.msg);
    assert.equal(missingRun.data.rounds[0].runner, "claude");
    assert.deepEqual(getLines(missingRun, ["설정", "단계", "브레인스토밍"]), [
        "[단계] 기획 시작",
        "[설정] Codex를 쓸 수 없어 기획 단계는 Claude가 메인으로 진행합니다: Codex 로그인이 필요합니다",
        "[단계] 기획 완료",
        "[단계] 디자인 시작"
    ]);
    assert.equal(phaseUtil.readPhase(getPhaseFile(missingDir)).proposals, null);
    checkDesktopLogContract(missingRun.data);

    // 보조 Claude가 실패하면 그 안을 건너뛰고 메인만으로 진행한다.
    const failDir = createProject("hybrid assist fail 한글");
    const failRun = await runHybrid(failDir, { mains: { plan: "codex" }, brainstorm: ["plan"], env: { AP_CLAUDE_ASSIST_FAIL: "1" } });

    assert.equal(failRun.status, STATUS_OK, failRun.error?.msg);
    assert.deepEqual(getLines(failRun, ["단계", "브레인스토밍"]), [
        "[단계] 기획 시작",
        "[브레인스토밍] Claude 기획 안 받는 중",
        "[브레인스토밍] Claude 기획 안 건너뜀: usage limit reached",
        "[단계] 기획 완료",
        "[단계] 디자인 시작"
    ]);
    assert(!fs.existsSync(path.join(failDir, "docs/autopilot/proposals/plan-claude.md")));

    // 메인이 Claude이고 보조가 Codex이면 보내기를 허용해야 한다. 허용하지 않으면 그 단계는 메인만으로 진행한다(보내기 허용 없이 Codex를 부르지 않는다).
    const blockedDir = createProject("hybrid blocked 한글");
    const blockedRun = await runHybrid(blockedDir, { mains: { design: "codex" }, brainstorm: ["plan"] });

    assert.equal(blockedRun.status, STATUS_OK, blockedRun.error?.msg);
    assert.deepEqual(getLines(blockedRun, ["브레인스토밍", "단계"]), [
        "[브레인스토밍] 외부 서비스로 보내기를 허용하지 않아 다른 AI의 안을 받지 않습니다.",
        "[단계] 기획 시작",
        "[단계] 기획 완료",
        "[단계] 디자인 시작"
    ]);
    assert(!fs.existsSync(codexLog), "Codex를 부르지 않는다");
};

// 지시개선은 처리할 작업이 있어야 시작한다. 잠금은 실패해도 남기지 않는다.
// --autocompact를 모르는 옛 Claude Code가 PATH에 있어도 그 옵션만 빼고 세션이 돈다(모르는 옵션이면 CLI가 시작하자마자 실패한다).
const checkUnsupportedFlags = async (scenarioRunner, context) => {
    const projectDir = path.join(context.testDir, "old claude project 한글");
    const binDir = path.join(context.testDir, "old-claude-bin");
    const oldClaudeFile = path.join(binDir, "old-claude.mjs");
    const argsFile = path.join(binDir, "args.json");
    const wrapperFile = path.join(binDir, process.platform === "win32" ? "claude.cmd" : "claude");
    const oldClaudeSource = `
import fs from "node:fs";
if (process.argv.includes("--help")) {
    console.log("Usage: claude [options]\\n  --model <model>\\n  --effort <level>\\n  --fallback-model <model>");
    process.exit(0);
}
if (process.argv.includes("--autocompact")) {
    console.error("error: unknown option '--autocompact'");
    process.exit(1);
}
fs.writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(process.argv.slice(2)));
process.stdin.resume();
process.stdin.on("end", () => console.log(JSON.stringify({ type: "result", is_error: false, result: "ok" })));
`;

    fs.mkdirSync(binDir);
    fs.writeFileSync(oldClaudeFile, oldClaudeSource);
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, "work.txt"), "initial\n");

    commitInitialProject(context, projectDir);

    if (process.platform === "win32") {
        writeCmdWrapper(wrapperFile, oldClaudeFile);
    } else {
        fs.writeFileSync(wrapperFile, `#!/bin/sh\nexec "${process.execPath}" "${oldClaudeFile}" "$@"\n`);
        fs.chmodSync(wrapperFile, 0o755);
    }

    const pathKey = Object.keys(context.testEnv).find((key) => key.toUpperCase() === "PATH");
    const result = await runAutopilot({
        projectDir: projectDir,
        dataDir: scenarioRunner.dataDir,
        open: false,
        endTime: getEndTime(),
        env: { ...context.testEnv, [pathKey]: binDir + path.delimiter + context.testEnv[pathKey] },
        limits: { minMinutes: 0, maxRounds: 1, maxRoundMinutes: 1, retryWaitMinutes: [0, 0, 0] }
    });

    assert.equal(result.status, STATUS_OK, result.error?.msg);

    const args = JSON.parse(fs.readFileSync(argsFile, "utf8"));

    assert(!args.includes("--autocompact") && !args.includes("150000"));
    assert(args.includes("--effort") && args.includes("--fallback-model"));
    assert.match(fs.readFileSync(result.data.logFile, "utf8"), /^\[설정\] 설치된 Claude Code가 --autocompact 옵션을 지원하지 않아 빼고 실행합니다/m);
};

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
        assert(!fs.existsSync(autopilotUtil.getLockFile(path.join(projectDir, ".autopilot"))));
        assert(!fs.existsSync(path.join(projectDir, "prompt.txt")));
    }
};

// commit 안 된 파일이 아주 많아 종료 요약의 git status가 출력 한도(1MB)를 넘어도 실행은 정상 종료하고 종료 리포트를 남긴다.
const checkHugeWorkTree = async (context, fakeCliFile) => {
    const projectDir = path.join(context.testDir, "huge work tree project");

    fs.mkdirSync(projectDir);
    fs.writeFileSync(path.join(projectDir, "work.txt"), "initial\n");

    commitInitialProject(context, projectDir);

    // 파일을 만드는 시간이 검증 시간의 대부분이라 이름을 길게 해 파일 수를 줄인다. 전체 경로는 Windows MAX_PATH(260)보다 짧게 둔다.
    for (let index = 0; index < 8000; index++) {
        fs.writeFileSync(path.join(projectDir, `${"x".repeat(140)}${index}.txt`), "");
    }

    const result = await runAutopilot({
        projectDir: projectDir,
        dataDir: path.join(context.testDir, "appdata"),
        tasks: DEFAULT_TASKS,
        command: process.execPath,
        commandArgs: [fakeCliFile],
        open: false,
        endTime: getEndTime(),
        env: { ...context.testEnv, AP_MODE: "idle", AP_EXPECTED_CWD: projectDir },
        limits: { minMinutes: 0, maxRounds: 1, maxRoundMinutes: 1, retryWaitMinutes: [0, 0, 0], resetGraceMs: 0 }
    });

    assert.equal(result.status, STATUS_OK, result.error?.msg);
    assert.equal(result.data.exitCode, 0);
    assert.match(fs.readFileSync(result.data.logFile, "utf8"), /\[오류\] 작업 트리 상태를 읽지 못했습니다: git status 실패/);
    assert.match(fs.readFileSync(result.data.reportFile, "utf8"), /<h2>작업 트리<\/h2><pre>읽지 못했습니다: git status 실패/);
};

// autopilot reset-progress가 쓰는 서비스. 실행 중에는 거부하고, 아니면 원본을 보관하고 초기화한다.
const checkProgressResetCommand = (context) => {
    const projectDir = path.join(context.testDir, "reset command project");
    const workDir = path.join(projectDir, ".autopilot");
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
    const workFile = (relativePath) => path.join(result.projectDir, ".autopilot", relativePath);

    assert(!fs.existsSync(workFile(staleLog)));
    assert(!fs.existsSync(workFile(staleReport)));
    assert(fs.existsSync(workFile(archivedRecord)));
    assert(fs.existsSync(workFile(recentLog)));
    assert.match(fs.readFileSync(result.logFile, "utf8"), /^\[정리\] 보관 기간 30일이 지난 로그·리포트 2개를 삭제했습니다\.$/m);
};

// 보관 기간을 인자로 줄이면 그 기간이 지난 파일만 지운다. 같은 파일이 기본(30일)에서는 남는다.
const checkLogRetentionOption = async (runScenario) => {
    const tenDaysAgo = dateUtil.getDateString(new Date(Date.now() - 10 * 24 * 60 * 60 * 1000));
    const oldLog = `progress/${tenDaysAgo}/autopilot_000000_cccc3333.log`;
    const keptRunData = await runScenario("idle", { staleFiles: [oldLog] });

    assert(fs.existsSync(path.join(keptRunData.projectDir, ".autopilot", oldLog)));

    const prunedRunData = await runScenario("idle", { staleFiles: [oldLog], logRetentionDays: 7 });

    assert(!fs.existsSync(path.join(prunedRunData.projectDir, ".autopilot", oldLog)));
    assert.match(fs.readFileSync(prunedRunData.logFile, "utf8"), /^\[정리\] 보관 기간 7일이 지난 로그·리포트 1개를 삭제했습니다\.$/m);
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
    const optionsWorkDir = path.join(optionsProjectDir, ".autopilot");
    const roundOptionsFile = getRoundOptionsFile(optionsWorkDir);

    fs.mkdirSync(optionsProjectDir, { recursive: true });

    assert.deepEqual(readRoundOptions(roundOptionsFile), {});
    assert.deepEqual(writeRoundOptions(roundOptionsFile, { model: "sonnet" }), { model: "sonnet" });
    assert.deepEqual(writeRoundOptions(roundOptionsFile, { effort: "max" }), { model: "sonnet", effort: "max" });

    // 허용되지 않은 값은 걸러내고, 깨진 파일은 읽을 때 예외, 쓸 때 덮어쓰기다.
    fs.writeFileSync(roundOptionsFile, JSON.stringify({ model: "gpt", effort: "max", extra: 1 }));

    assert.deepEqual(readRoundOptions(roundOptionsFile), { effort: "max" });

    // 특정 버전의 모델 ID는 받고, 형식이 다른 값은 걸러낸다.
    fs.writeFileSync(roundOptionsFile, JSON.stringify({ model: "claude-opus-4-8", effort: "low" }));

    assert.deepEqual(readRoundOptions(roundOptionsFile), { model: "claude-opus-4-8", effort: "low" });

    fs.writeFileSync(roundOptionsFile, JSON.stringify({ model: "claude-opus 4; rm -rf", effort: "low" }));

    assert.deepEqual(readRoundOptions(roundOptionsFile), { effort: "low" });

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
    assert.match(fs.readFileSync(growingRunData.logFile, "utf8"), /^\[진행 기록\] 원본 보관: \.autopilot\/progress\//m);
    assert.match(fs.readFileSync(path.join(growingRunData.projectDir, "prompt.txt"), "utf8"), new RegExp(`${PROGRESS_TARGET_LINES}줄 안팎`));

    // 정리로 줄어든 기록이 다시 상한을 넘으면 다시 지시한다.
    assert.equal(readCleanupLog(await runScenario("regrow", { progressContent: longProgress })), "101");
    assert.equal(readCleanupLog(await runScenario("failure", { progressContent: longProgress, limits: FAILURE_LIMITS })), "1111");
    assert.equal(readCleanupLog(await runScenario("commit")), "000");
};

// 커밋 접두어와 작업 브랜치는 지침과 정책에 들어가고, 바꾸면 기본값은 프롬프트에서 사라진다.
const checkGitNames = async (runScenario) => {
    const readPrompt = (runData) => fs.readFileSync(path.join(runData.projectDir, "prompt.txt"), "utf8");
    const defaultPrompt = readPrompt(await runScenario("idle"));

    assert(defaultPrompt.includes("앞에 `[ap]`를 붙인다."));
    assert(defaultPrompt.includes("[ap] fix: 상태 손실 방지"));
    assert(defaultPrompt.includes("`ai/autopilot` 브랜치에서 작업한다"));

    const customPrompt = readPrompt(await runScenario("idle", { commitPrefix: "chore(ai):", workBranch: "bot/work" }));

    assert(customPrompt.includes("앞에 `chore(ai):`를 붙인다."));
    assert(customPrompt.includes("chore(ai): fix: 상태 손실 방지"));
    assert(customPrompt.includes("`bot/work` 브랜치에서 작업한다"));
    assert(!customPrompt.includes("[ap]"));
    assert(!customPrompt.includes("ai/autopilot"));
};

// 연결 저장소: 검증, 프롬프트의 push·브랜치 규칙, 연결 저장소만 바뀐 회차도 작업으로 세는지, 로그의 저장소 이름
const checkLinkedRepos = async (runScenario, context) => {
    const linkedDir = path.join(context.testDir, "linked repo");

    fs.mkdirSync(linkedDir, { recursive: true });
    fs.writeFileSync(path.join(linkedDir, "work.txt"), "initial\n");
    commitInitialProject(context, linkedDir);

    const linkedRunData = await runScenario("linked-only", { linkedProjectDirs: [linkedDir] });
    const prompt = fs.readFileSync(path.join(linkedRunData.projectDir, "prompt.txt"), "utf8");
    const logText = fs.readFileSync(linkedRunData.logFile, "utf8");

    assert(prompt.includes(`연결 저장소: linked repo (${linkedDir}).`));
    assert(prompt.includes("`git push origin ai/autopilot`"));
    assert(prompt.includes("force push하지 않는다"));
    assert(prompt.includes("각 연결 저장소 루트의 `CLAUDE.md`를 직접 읽고"));
    assert.equal(linkedRunData.rounds.length, 3);
    assert(linkedRunData.rounds.every((round) => round.outcome === "완료" && round.commits.length === 1));
    assert.match(logText, /^\[커밋\] [0-9a-f]+ \+1 -0 linked repo: \[ap\] linked fake$/m);
    assert.match(logText, /^Linked : linked repo \(/m);
    assert.match(logText, /^\[설정\] 연결 저장소 1개: linked repo$/m);

    // 연결 저장소가 없으면 프롬프트에 그 안내가 없다.
    assert(!fs.readFileSync(path.join((await runScenario("idle")).projectDir, "prompt.txt"), "utf8").includes("연결 저장소"));

    // Git 저장소가 아니면 시작하지 않는다.
    const plainDir = path.join(context.testDir, "plain");

    fs.mkdirSync(plainDir, { recursive: true });

    await assert.rejects(runScenario("idle", { linkedProjectDirs: [plainDir] }));
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

    // 기본은 종료 시각을 그대로 두고, extendOnLimit이면 기다린 만큼(초 단위 올림) 늦춘다. 로그 파서도 연장된 시각을 읽는다(checkDesktopLogContract).
    const extendedRunData = await runScenario("limit-long", { extendOnLimit: true, limits: { minMinutes: 0, maxRounds: 1, maxRoundMinutes: 1, retryWaitMinutes: [], resetGraceMs: 0 } });

    assert.equal(rateLimitedRunData.deadline.getSeconds(), 0);
    assert.equal(extendedRunData.rounds.length, 1);
    assert(extendedRunData.deadline.getSeconds() > 0);
    assert.equal(extendedRunData.deadline.getMilliseconds(), 0);
    assert.match(fs.readFileSync(extendedRunData.logFile, "utf8"), /^\[사용량 한도\] 종료 시각 연장 \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \(\+1분\)$/m);

    // 연장 상한이 있으면 한 실행에서 늘리는 총량이 그만큼으로 묶인다. 첫 대기는 상한만큼만 늘리고, 상한을 다 쓴 뒤의 대기는 늘리지 않고 안내만 남긴다.
    const cappedRunData = await runScenario("limit-long", {
        extendOnLimit: true,
        maxExtendMinutes: 1 / 60,
        limits: { minMinutes: 0, maxRounds: 2, maxRoundMinutes: 1, retryWaitMinutes: [], resetGraceMs: 0 }
    });
    const cappedLog = fs.readFileSync(cappedRunData.logFile, "utf8");

    assert.equal(cappedRunData.rounds.length, 2);
    assert.equal(cappedLog.match(/^\[사용량 한도\] 종료 시각 연장 /gm).length, 1);
    assert.equal(cappedLog.match(/^\[사용량 한도\] 연장 상한 [\d.]+분에 도달해 종료 시각을 더 늘리지 않습니다$/gm).length, 2);
    assert.equal(cappedRunData.deadline.getSeconds(), 1, "상한(1초)만큼만 늘어난다");
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
    const lockWorkDir = path.join(lockProjectDir, ".autopilot");
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
    // 번들된 엔진 위치는 macOS(.app/Contents/Resources)와 그 밖(실행 파일 옆 resources)이 다르다.
    const resourcesDir = process.platform === "darwin" ? path.join(path.dirname(command), "..", "Resources") : path.join(path.dirname(command), "resources");
    const bundledEntryFile = appExe ? path.join(resourcesDir, "engine", "core", "autopilot_loop.js") : "";
    const entryFile = bundledEntryFile && fs.existsSync(bundledEntryFile) ? bundledEntryFile : path.join(linkedEngineDir, "core", "autopilot_loop.js");
    const projectDir = path.join(context.testDir, "cli project 한글");
    const workDir = path.join(projectDir, ".autopilot");
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

    // 잘못된 커밋 접두어·보호 브랜치는 시작 전에 거부한다.
    assert.equal(runCli([...projectArgs, "--tasks-file", tasksFile, "--branch", "main", "--no-open"]).status, 1);
    assert.equal(runCli([...projectArgs, "--tasks-file", tasksFile, "--commit-prefix", "a`b", "--no-open"]).status, 1);

    const result = runCli([...projectArgs, "--end-time", getEndTime(), "--policy", "todo", "--tasks-file", tasksFile, "--commit-prefix", "chore(ai):", "--branch", "bot/work", "--no-open"]);

    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.match(result.stdout, /예약 작업 완료/);
    assert.match(fs.readFileSync(path.join(projectDir, "prompt.txt"), "utf8"), /<TASKS>\n첫째 작업\n둘째 작업\n<\/TASKS>/);
    assert.match(fs.readFileSync(path.join(projectDir, "prompt.txt"), "utf8"), /<AUTOPILOT_POLICY\.md>\s+# AutoPilot Policy/);
    assert(fs.readFileSync(path.join(projectDir, "prompt.txt"), "utf8").includes("`bot/work` 브랜치에서 작업한다"));

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
    assert.match(resetResult.stdout, /Progress record reset\. Original archived: \.autopilot\/progress\//);
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
    const { runSession } = processUtil;

    // CLI가 먼저 끝나면 손자 프로세스가 붙잡은 파이프를 기다리지 않는다.
    const pipesDir = path.join(context.testDir, "pipes");
    const startTime = Date.now();

    fs.mkdirSync(pipesDir);

    await runSession(process.execPath, [fakeCliFile], "stdin & | < > 한글", createSessionOptions(context, pipesDir, "pipes"));

    assert(Date.now() - startTime < 2500, "Inherited pipes delayed completion");

    try {
        process.kill(Number(fs.readFileSync(path.join(pipesDir, "grandchild.pid"), "utf8")));
    } catch {}

    if (process.platform === "win32") {
        const wrapperDir = path.join(context.testDir, "wrapper");
        const wrapperFile = path.join(context.testDir, "fake wrapper.cmd");

        fs.mkdirSync(wrapperDir);
        writeCmdWrapper(wrapperFile, fakeCliFile);

        const wrapperResult = await runSession(wrapperFile, ["-p"], "stdin & | < > 한글", createSessionOptions(context, wrapperDir, "idle"));

        assert.equal(wrapperResult.exitCode, 0);
        assert.equal(fs.readFileSync(path.join(wrapperDir, "prompt.txt"), "utf8"), "stdin & | < > 한글");

        // 보조 Claude의 읽기 도구 인자(쉼표 포함)도 CMD 래퍼를 통과해 그대로 전달된다.
        const assistOptions = createSessionOptions(context, wrapperDir, "idle");
        const assistResult = await providerUtil.askClaude({ command: wrapperFile, baseArgs: [], model: "sonnet", tools: "Read,Glob,Grep" }, "안을 내 주세요", {
            cwd: wrapperDir,
            processEnv: assistOptions.processEnv,
            deadline: assistOptions.roundDeadline
        });

        assert.equal(assistResult.error, undefined);
        assert.match(fs.readFileSync(path.join(wrapperDir, "assist-claude.log"), "utf8"), /--tools=Read,Glob,Grep/);
    }

    const missingError = await runSession(path.join(context.testDir, "missing-executable"), [], "", {
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
    checkBuildCancel,
    checkBuildSkip,
    checkSecurityDoc,
    checkSecurityReview,
    checkBrainstorm,
    checkCodexRunner,
    checkDebate,
    checkHybrid
};

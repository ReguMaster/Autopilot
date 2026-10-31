import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";

const UI_DIR = path.join(import.meta.dirname, "../desktop/ui");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 화면 스토어·액션을 Node에서 바로 돌린다. 번들러로 한 파일에 묶어 임시 폴더에서 불러오고, window.autopilot은 가짜로 바꿔 끼운다.
const loadModules = async () => {
    const entry = `
        export * as shareStructure from "./lib/shareStructure.js";
        export * as runStore from "./stores/runStore.js";
        export * as uiStore from "./stores/uiStore.js";
        export * as modalStore from "./stores/modalStore.js";
        export * as composerStore from "./stores/composerStore.js";
        export * as accountStore from "./stores/accountStore.js";
        export * as run from "./actions/run.js";
        export * as events from "./actions/events.js";
        export * as tabs from "./actions/tabs.js";
        export * as tabsStore from "./stores/tabsStore.js";
        export * as runs from "./actions/runs.js";
        export * as runsStore from "./stores/runsStore.js";
        export * as accounts from "./actions/accounts.js";
        export * as schedules from "./actions/schedules.js";
        export * as settingsActions from "./actions/settings.js";
        export * as appStore from "./stores/appStore.js";
        export * as scheduleStore from "./stores/scheduleStore.js";
        export * as storyModel from "./features/run/storyModel.js";
        export * as newProjectStore from "./stores/newProjectStore.js";
        export * as newProjectActions from "./actions/newProject.js";
    `;
    const result = await build({
        stdin: { contents: entry, resolveDir: UI_DIR, loader: "js" },
        bundle: true,
        write: false,
        format: "cjs",
        platform: "node",
        outdir: "out",
        define: { "process.env.NODE_ENV": '"production"' },
        logLevel: "silent"
    });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autopilot-stores-"));
    const file = path.join(dir, "stores.cjs");

    fs.writeFileSync(file, result.outputFiles.find((output) => output.path.endsWith(".js")).text);

    try {
        return createRequire(import.meta.url)(file);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
};

const OK = (data = {}) => ({ status: "OK", data: data });

const createState = (overrides = {}) => ({
    status: "idle",
    startedAt: 0,
    endedAt: 0,
    round: 0,
    rounds: [],
    work: { toolCalls: 0, filesRead: 0, filesEdited: 0 },
    gains: [],
    requested: { model: "", effort: "" },
    model: "",
    effort: "",
    ...overrides
});

const checkShareStructure = ({ shareStructure }) => {
    const previous = { status: "running", rounds: [{ round: 1, outcome: "완료" }], work: { toolCalls: 1 } };
    const same = shareStructure.shareStructure(previous, { status: "running", rounds: [{ round: 1, outcome: "완료" }], work: { toolCalls: 1 } });

    assert.equal(same, previous, "내용이 같으면 이전 객체를 그대로 쓴다");

    const changed = shareStructure.shareStructure(previous, { status: "running", rounds: [{ round: 1, outcome: "완료" }], work: { toolCalls: 2 } });

    assert.notEqual(changed, previous);
    assert.equal(changed.rounds, previous.rounds, "바뀌지 않은 조각은 참조가 유지된다");
    assert.notEqual(changed.work, previous.work);

    const grown = shareStructure.shareStructure(previous, { ...previous, rounds: [...previous.rounds, { round: 2, outcome: "" }] });

    assert.equal(grown.rounds.length, 2);
    assert.equal(grown.rounds[0], previous.rounds[0], "배열 안의 같은 항목도 참조가 유지된다");
    assert.equal(shareStructure.shareStructure(null, { a: 1 }).a, 1);
    assert.equal(shareStructure.shareStructure([1, 2], { a: 1 }).a, 1, "종류가 다르면 새 값이다");
};

const checkRunStore = async ({ runStore }) => {
    const entries = [];
    const unsubscribe = runStore.subscribeEntries((batch) => entries.push(batch.length));

    runStore.appendEntries([{ stream: "out", text: "10:00:00 안녕하세요." }]);
    runStore.appendEntries([
        { stream: "out", text: "10:00:01   > Read a.js" },
        { stream: "err", text: "경고" }
    ]);
    assert.equal(runStore.useRunStore.getState().logs.length, 0, "로그는 모아서 반영한다");

    await wait(90);

    const { logs } = runStore.useRunStore.getState();

    assert.deepEqual(
        logs.map((line) => line.id),
        [1, 2, 3],
        "줄 번호는 이어진다"
    );
    assert.deepEqual(
        logs.map((line) => line.kind),
        ["", "tool", "err"],
        "줄 종류가 붙는다"
    );
    assert.deepEqual(entries, [3], "구독자는 한 묶음으로 받는다");
    unsubscribe();

    runStore.appendEntries(Array.from({ length: runStore.MAX_LOG_LINES + 5 }, (_, index) => ({ stream: "out", text: `줄 ${index}` })));
    await wait(90);

    const capped = runStore.useRunStore.getState().logs;

    assert.equal(capped.length, runStore.MAX_LOG_LINES, "최근 줄만 남긴다");
    assert.equal(capped.at(-1).id, 3 + runStore.MAX_LOG_LINES + 5, "잘려 나간 줄도 번호는 센다");

    runStore.clearLogs();
    assert.equal(runStore.useRunStore.getState().logs.length, 0);

    runStore.appendEntries([{ stream: "out", text: "다시" }]);
    await wait(90);
    assert.equal(runStore.useRunStore.getState().logs[0].id, 1, "지우면 번호가 처음부터다");

    const first = createState({ rounds: [{ round: 1 }] });

    runStore.applyRunState(first);
    runStore.applyRunState(createState({ rounds: [{ round: 1 }], status: "running" }));
    assert.equal(runStore.useRunStore.getState().state.rounds, runStore.useRunStore.getState().state.rounds);
    assert.equal(runStore.useRunStore.getState().state.status, "running");
};

const checkOverlays = ({ uiStore }) => {
    const { ui, useUiStore } = uiStore;
    const get = () => useUiStore.getState();

    ui.setPanel("settings");
    assert.equal(get().panel, "settings");
    ui.setPanel("profile");
    assert.equal(get().panel, "profile", "두 패널은 하나가 열리면 다른 하나가 닫힌다");
    ui.togglePanel("profile");
    assert.equal(get().panel, null, "열린 패널의 버튼을 다시 누르면 닫힌다");

    ui.setHistory(true);
    assert.equal(get().history, true);
    ui.setPanel("settings");
    assert.equal(get().history, true, "패널을 열어도 전체 기록은 그대로다(옛 동작)");

    ui.setArchive(true);
    assert.deepEqual([get().panel, get().history, get().archive], [null, false, true], "시트를 열면 패널·다른 시트가 닫힌다");

    ui.setSchedule(true);
    assert.deepEqual([get().archive, get().schedule], [false, true]);
    ui.setPanel("settings");
    assert.equal(get().schedule, false, "패널을 열면 예약 시트가 닫힌다");

    ui.setHistory(true);
    ui.closeAll();
    assert.deepEqual([get().panel, get().history, get().archive, get().schedule], [null, false, false, false]);

    ui.showFailure({ status: "FAILED", error: { code: "X", msg: "실패했어요" } });
    assert.equal(get().notice.message, "실패했어요");
    ui.showFailure(OK());
    assert.equal(get().notice.message, "", "성공하면 안내가 지워진다");
};

const checkComposer = async ({ runStore, composerStore }) => {
    const { composer, useComposerStore } = composerStore;
    const sent = [];
    let release = () => {};

    window.autopilot = {
        setOptions: (options) => {
            sent.push(options);

            return new Promise((resolve) => {
                release = () => resolve(OK());
            });
        }
    };

    runStore.applyRunState(createState({ status: "running", requested: { model: "claude-opus-4-8", effort: "high" }, model: "claude-opus-4-8", effort: "high" }));
    composer.setSelectedOptions({ model: "claude-sonnet-4-6", effort: "xhigh" });
    assert.deepEqual([useComposerStore.getState().model, useComposerStore.getState().effort], ["sonnet", 3], "모델 ID는 계열로, Effort는 단계로 바뀐다");

    composer.chooseModel("haiku");
    composer.chooseEffort(0);
    composer.chooseEffort(1);
    assert.equal(sent.length, 1, "전달 중에 또 바뀌어도 바로 또 보내지 않는다");
    assert.deepEqual(sent[0], { model: "haiku", effort: "xhigh", runner: "claude", codexModel: "", codexEffort: "" }, "처음 바뀐 시점의 선택이 먼저 나간다");

    release();
    await wait(10);
    assert.equal(sent.length, 2, "끝난 뒤 마지막 선택만 한 번 더 보낸다");
    assert.deepEqual(sent[1], { model: "haiku", effort: "medium", runner: "claude", codexModel: "", codexEffort: "" });

    release();
    await wait(10);

    // 모델·노력은 AI마다 따로 정하고 누가 일하는지(runner)는 바꾸지 않는다. Codex의 모델·추론도 실행 중에 바로 보낸다.
    composer.chooseCodexModel("gpt-6.1-sol");
    release();
    await wait(10);
    composer.chooseCodexEffort("high");
    release();
    await wait(10);
    assert.deepEqual(
        sent.slice(2).map((options) => [options.runner, options.codexModel, options.codexEffort]),
        [
            ["claude", "gpt-6.1-sol", ""],
            ["claude", "gpt-6.1-sol", "high"]
        ]
    );

    // 유지 보수에서 작업할 AI는 따로 바꾸고, 실행 중이면 다음 회차를 위해 바로 보낸다.
    composer.setRunner("codex");
    release();
    await wait(10);
    assert.equal(sent.at(-1).runner, "codex");
    composer.setRunner("claude");
    release();
    await wait(10);
    assert.equal(sent.at(-1).runner, "claude");
    sent.length = 2;

    // 전달이 끝나면 엔진이 받은 값(requested)을 기준으로 선택이 맞춰진다. 실행 에이전트 값이 없는 옛 상태는 지금 고른 값을 둔다.
    runStore.applyRunState(createState({ status: "running", requested: { model: "claude-haiku-4-5", effort: "medium" } }));
    composer.syncFromRun(runStore.useRunStore.getState().state);
    assert.equal(useComposerStore.getState().model, "haiku");
    assert.equal(useComposerStore.getState().runner, "claude");

    runStore.applyRunState(createState({ status: "running", requested: { runner: "codex", model: "claude-haiku-4-5", effort: "medium", codexModel: "", codexEffort: "low" } }));
    composer.syncFromRun(runStore.useRunStore.getState().state);
    assert.deepEqual([useComposerStore.getState().runner, useComposerStore.getState().codexModel, useComposerStore.getState().codexEffort], ["codex", "", "low"]);
    composer.setSelectedOptions({ model: "claude-haiku-4-5", effort: "medium", runner: "claude", codexModel: "", codexEffort: "" });

    runStore.applyRunState(createState({ status: "idle" }));
    composer.chooseModel("opus");
    assert.equal(sent.length, 2, "실행 중이 아니면 엔진에 보내지 않는다");

    // 종료 시각은 고른 날은 두고 시각만 단위만큼 옮긴다. 24시간을 넘어가면 날짜가 붙는다.
    const realNow = Date.now;

    Date.now = () => new Date(2026, 9, 10, 12, 0).getTime();
    composer.setEndTime("22:30");
    composer.stepEndTime(60, 1);
    assert.equal(useComposerStore.getState().endTime, "23:30", "종료 시각은 단위만큼 옮긴다");
    composer.stepEndTime(10, -1);
    assert.equal(useComposerStore.getState().endTime, "23:20");
    composer.setEndTime("2026-10-12 07:00");
    composer.stepEndTime(60, 1);
    assert.equal(useComposerStore.getState().endTime, "2026-10-12 08:00");
    composer.setEndTimeAfter(180);
    assert.equal(useComposerStore.getState().endTime, "15:00");
    Date.now = realNow;
};

const checkRunActions = async ({ runStore, uiStore, composerStore, modalStore, run }) => {
    const { ui, useUiStore } = uiStore;
    let startCalls = 0;
    let stopCalls = 0;
    let killCalls = 0;
    let startResult = OK();
    let release = () => {};

    window.autopilot = {
        start: () => {
            startCalls++;

            return new Promise((resolve) => {
                release = () => resolve(startResult);
            });
        },
        stop: async () => {
            stopCalls++;

            return OK();
        },
        kill: async () => {
            killCalls++;

            return OK();
        },
        listRuns: async () => OK({ runs: [] }),
        getStreakDays: async () => OK({ days: [] }),
        getPhase: async () => OK({ phase: null })
    };
    composerStore.composer.setTasks("한 가지 일");
    runStore.applyRunState(createState({ status: "idle" }));

    const first = run.startRun();
    const second = run.startRun();

    assert.equal(useUiStore.getState().isStarting, true);
    release();
    await Promise.all([first, second]);
    assert.equal(startCalls, 1, "시작 응답을 기다리는 동안 다시 눌러도 한 번만 보낸다");
    assert.equal(useUiStore.getState().isStarting, false);

    startResult = { status: "FAILED", error: { code: "LOGIN_REQUIRED", msg: "Claude 로그인이 필요해요." } };

    const third = run.startRun();

    release();
    await third;
    assert.equal(useUiStore.getState().loginBanner, "Claude 로그인이 필요해요.", "로그인이 필요하면 안내 줄에 알린다");
    assert.equal(useUiStore.getState().notice.message, "", "그때는 실패 안내를 따로 띄우지 않는다");

    startResult = { status: "FAILED", error: { code: "INVALID_PROJECT", msg: "폴더가 올바르지 않아요." } };

    const fourth = run.startRun();

    release();
    await fourth;
    assert.equal(useUiStore.getState().loginBanner, null);
    assert.equal(useUiStore.getState().notice.message, "폴더가 올바르지 않아요.");

    // 실행 중에는 종료 신호를 한 번 누르면 대기하고, 한 번 더 눌러야 보낸다.
    runStore.applyRunState(createState({ status: "running" }));
    await run.handleMainAction();
    assert.equal(useUiStore.getState().stopArmed, true);
    assert.equal(stopCalls, 0);
    await run.handleMainAction();
    assert.equal(stopCalls, 1);
    assert.equal(useUiStore.getState().stopArmed, false);

    await run.handleMainAction();
    run.setStopArmed(false);
    assert.equal(useUiStore.getState().stopArmed, false);

    // 종료 요청 뒤에는 한 번 더 누르지 않고 바로 강제 종료지만, 되돌릴 수 없어 확인 모달을 먼저 거친다.
    runStore.applyRunState(createState({ status: "stopping" }));

    const cancelledKill = run.handleMainAction();

    assert.equal(modalStore.useModalStore.getState().open, true, "강제 종료는 확인 모달을 먼저 띄운다");
    modalStore.modal.answer(false);
    await cancelledKill;
    assert.equal(killCalls, 0, "취소하면 강제 종료를 보내지 않는다");

    const confirmedKill = run.handleMainAction();

    modalStore.modal.answer(true);
    await confirmedKill;
    assert.equal(killCalls, 1, "확인하면 강제 종료를 보낸다");
    ui.set({ stopArmed: false });
};

// 확인을 받는 나머지 동작: 취소하면 IPC를 보내지 않고, 확인해야 보낸다.
const checkConfirmedActions = async ({ modalStore, run, runs, runsStore, accounts, accountStore, uiStore, composerStore }) => {
    const { useUiStore } = uiStore;
    const { modal, useModalStore } = modalStore;
    const calls = [];
    const record = (name, result = OK()) => {
        return async (...args) => {
            calls.push([name, ...args]);

            return result;
        };
    };

    window.autopilot = {
        resetProgress: record("resetProgress", OK({ isReset: true })),
        deleteRun: record("deleteRun"),
        removeAccount: record("removeAccount", OK({ accounts: [{ id: "default", label: "기본 계정" }], activeId: "default", claudeDir: null, snapshots: {} })),
        listRuns: async () => OK({ runs: [] }),
        getStreakDays: async () => OK({ days: [] }),
        getPhase: async () => OK({ phase: null })
    };

    const answer = async (action, isConfirmed) => {
        const pending = action();

        assert.equal(useModalStore.getState().open, true, "확인 모달이 먼저 뜬다");
        modal.answer(isConfirmed);
        await pending;
    };

    await answer(run.resetProgress, false);
    assert.deepEqual(calls, [], "초기화를 취소하면 보내지 않는다");
    await answer(run.resetProgress, true);
    assert.deepEqual(calls, [["resetProgress"]]);

    calls.length = 0;
    runsStore.useRunsStore.setState({ detail: { run: { id: "2026-10-10/autopilot_090000_aaaa0001.log" } } });
    await answer(runs.deleteArchiveRun, false);
    assert.deepEqual(calls, [], "삭제를 취소하면 보내지 않는다");
    await answer(runs.deleteArchiveRun, true);
    assert.deepEqual(calls, [["deleteRun", "2026-10-10/autopilot_090000_aaaa0001.log"]]);

    // 실행한 날짜 목록: 읽으면 스토어에 담기고, 실패하면 조용히 비며, 늦게 도착한 앞선 응답은 버린다.
    const readDays = () => runsStore.useRunsStore.getState().streakDays;

    window.autopilot.getStreakDays = async () => OK({ days: ["2026-10-12", "2026-10-13"] });
    await runs.loadStreakDays();
    assert.deepEqual(readDays(), ["2026-10-12", "2026-10-13"]);

    window.autopilot.getStreakDays = async () => ({ status: "FAILED", error: { code: "STREAK_FAILED", msg: "읽지 못했어요" } });
    await runs.loadStreakDays();
    assert.deepEqual(readDays(), []);

    let releaseSlow = () => {};
    const slow = new Promise((resolve) => (releaseSlow = () => resolve(OK({ days: ["2026-01-01"] }))));

    window.autopilot.getStreakDays = () => slow;

    const stale = runs.loadStreakDays();

    window.autopilot.getStreakDays = async () => OK({ days: ["2026-10-14"] });
    await runs.loadStreakDays();
    releaseSlow();
    await stale;
    assert.deepEqual(readDays(), ["2026-10-14"]);

    // 신규 개발 단계: 읽은 값이 스토어에 담기고, 승인하면 메인이 돌려준 값으로 바뀌며, 읽지 못하면 비운다.
    const readPhase = () => runsStore.useRunsStore.getState().buildPhase;

    window.autopilot.getPhase = async () => OK({ phase: { phase: "design", awaiting: "plan", qaRetries: 0 } });
    await runs.loadBuildPhase();
    assert.deepEqual(readPhase(), { phase: "design", awaiting: "plan", qaRetries: 0 });

    window.autopilot.approvePhase = async () => OK({ phase: { phase: "design", awaiting: null, qaRetries: 0 } });
    assert.equal(await run.approvePhase(), true);
    assert.equal(readPhase().awaiting, null);

    const picks = [];

    window.autopilot.approvePhase = async (projectDir, pick) => {
        picks.push(pick);
        await wait(5);

        return OK({ phase: { phase: "design", awaiting: null, qaRetries: 0 } });
    };
    assert.deepEqual(await Promise.all([run.approvePhase("claude"), run.approvePhase("codex")]), [true, false], "승인하는 동안 다시 누른 승인은 보내지 않는다");
    assert.deepEqual(picks, ["claude"]);
    assert.equal(await run.approvePhase("codex"), true, "승인이 끝나면 다시 승인할 수 있다");

    window.autopilot.approvePhase = async () => ({ status: "FAILED", error: { code: "APPROVE_FAILED", msg: "확인을 기다리는 단계가 없습니다." } });
    assert.equal(await run.approvePhase(), false);
    assert.equal(useUiStore.getState().notice.message, "확인을 기다리는 단계가 없습니다.");

    window.autopilot.getPhase = async () => ({ status: "FAILED", error: { code: "INVALID_PROJECT", msg: "열려 있는 프로젝트가 아니에요." } });
    await runs.loadBuildPhase();
    assert.equal(readPhase(), null);

    // 확인받기·허용 체크는 고를 수 있는 값의 순서로 저장된다.
    const { composer, useComposerStore } = composerStore;

    composer.toggleGate("plan");
    assert.deepEqual(useComposerStore.getState().gates, ["design"]);
    composer.toggleGate("plan");
    assert.deepEqual(useComposerStore.getState().gates, ["plan", "design"]);
    composer.toggleAllow("send");
    composer.toggleAllow("deps");
    assert.deepEqual(useComposerStore.getState().allow, ["large", "send"]);
    composer.setMode("build");
    composer.setSecurityOnFail("stop");
    assert.deepEqual(composer.getModeOptions(), {
        mode: "build",
        gates: ["plan", "design"],
        allow: ["large", "send"],
        designFormat: "html",
        qaOnFail: "retry:3",
        securityOnFail: "stop",
        mains: {},
        brainstorm: [],
        crossReview: false,
        debate: [],
        debateTurns: 8,
        codexModel: "",
        codexEffort: ""
    });
    composer.setSecurityOnFail("retry:3");

    // 협의 최대 횟수는 협의를 끄거나 보내기를 꺼도 고른 값을 남긴다.
    composer.setDebateTurns(12);
    assert.equal(composer.getModeOptions().debateTurns, 12);
    composer.toggleAllow("send");
    composer.toggleAllow("send");
    assert.equal(useComposerStore.getState().debateTurns, 12);
    composer.loadSettings({ debateTurns: 8 }, ["debateTurns"]);
    assert.equal(useComposerStore.getState().debateTurns, 8);

    // Codex의 model·effort는 보내기를 끄거나 Codex를 꺼도 고른 값을 남긴다.
    composer.setCodexModel("gpt-6.1-sol");
    composer.setCodexEffort("high");
    assert.deepEqual([composer.getModeOptions().codexModel, composer.getModeOptions().codexEffort], ["gpt-6.1-sol", "high"]);
    composer.toggleAllow("send");
    composer.toggleAllow("send");
    assert.deepEqual([useComposerStore.getState().codexModel, useComposerStore.getState().codexEffort], ["gpt-6.1-sol", "high"]);
    composer.loadSettings({ codexModel: "", codexEffort: "" }, ["codexModel", "codexEffort"]);
    assert.deepEqual([useComposerStore.getState().codexModel, useComposerStore.getState().codexEffort], ["", ""]);

    // 단계에 Codex를 보조로 켜면(메인이 Claude인 단계의 나란히 비교 · 협의) 보내기도 켜지고, 보내기를 끄면 Codex 보조가 있던 단계는 브레인스토밍 · 협의가 함께 꺼진다.
    const getBrainstormState = () => {
        const { brainstorm, debate, crossReview, allow } = useComposerStore.getState();

        return { brainstorm: brainstorm, debate: debate, crossReview: crossReview, allow: allow };
    };

    composer.toggleAllow("send");
    composer.setBrainstormMode("design", "compare");
    composer.setBrainstormMode("plan", "debate");
    composer.setCrossReview(true);
    assert.deepEqual(getBrainstormState(), { brainstorm: ["plan", "design"], debate: ["plan"], crossReview: true, allow: ["large", "send"] });

    // 나란히 비교하는 단계가 없어지면 교차검토도 끈다.
    composer.setBrainstormMode("design", "debate");
    assert.deepEqual(getBrainstormState(), { brainstorm: ["plan", "design"], debate: ["plan", "design"], crossReview: false, allow: ["large", "send"] });
    composer.setBrainstormMode("plan", "compare");
    assert.deepEqual(getBrainstormState().debate, ["design"]);
    composer.setBrainstormMode("design", "none");
    assert.deepEqual(getBrainstormState(), { brainstorm: ["plan"], debate: [], crossReview: false, allow: ["large", "send"] });
    composer.setBrainstormMode("plan", "debate");
    composer.toggleAllow("send");
    assert.deepEqual(getBrainstormState(), { brainstorm: [], debate: [], crossReview: false, allow: ["large"] });
    composer.setBrainstormMode("plan", "compare");
    composer.setCrossReview(true);
    composer.setBrainstormMode("plan", "none");
    assert.deepEqual(getBrainstormState(), { brainstorm: [], debate: [], crossReview: false, allow: ["large", "send"] });

    // 단계의 메인을 바꾸면 보조는 반대쪽 AI가 된다. 메인이 Codex이면 보조는 Claude라서 보내기와 상관없고, 보내기를 꺼도 그 단계의 보조는 남는다.
    const keys = ["allow", "mains", "brainstorm", "debate", "crossReview"];

    composer.loadSettings({ allow: ["large"], mains: {}, brainstorm: [], debate: [], crossReview: false }, keys);
    composer.setPhaseMain("plan", "codex");
    assert.deepEqual(useComposerStore.getState().mains, { plan: "codex" });
    composer.setBrainstormMode("plan", "compare");
    assert.deepEqual(getBrainstormState(), { brainstorm: ["plan"], debate: [], crossReview: false, allow: ["large"] });
    composer.setBrainstormMode("design", "debate");
    composer.setCrossReview(true);
    assert.deepEqual(getBrainstormState(), { brainstorm: ["plan", "design"], debate: ["design"], crossReview: true, allow: ["large", "send"] }, "메인이 Claude인 디자인의 Codex 보조는 보내기를 켠다");
    composer.toggleAllow("send");
    assert.deepEqual(getBrainstormState(), { brainstorm: ["plan"], debate: [], crossReview: true, allow: ["large"] }, "Codex 보조 단계만 빠지고 Claude 보조(메인이 Codex)는 남는다");
    composer.setPhaseMain("plan", "claude");
    assert.deepEqual(useComposerStore.getState().mains, {}, "기본(Claude)인 단계는 맵에 남기지 않는다");
    assert.deepEqual(getBrainstormState().allow, ["large", "send"], "메인이 Claude가 되면 보조가 Codex라 보내기가 켜진다");
    composer.loadSettings({ mode: "maintain", gates: ["plan", "design"], allow: ["deps", "large"], mains: {}, brainstorm: [], debate: [], crossReview: false }, ["mode", "gates", ...keys]);

    calls.length = 0;
    accountStore.useAccountStore.setState({
        accounts: [
            { id: "default", label: "기본 계정", shared: false },
            { id: "acct-1", label: "회사", shared: false }
        ],
        activeId: "acct-1"
    });

    const pending = accounts.accounts.remove();

    assert.equal(useModalStore.getState().request.title, "'회사' 계정을 제거할까요?", "제목에 계정 이름이 들어간다");
    modal.answer(false);
    await pending;
    assert.deepEqual(calls, [], "제거를 취소하면 보내지 않는다");
    await answer(accounts.accounts.remove, true);
    assert.deepEqual(calls, [["removeAccount", "acct-1"]]);
};

const checkLoginResume = async ({ runStore, uiStore, accounts, accountStore }) => {
    let startCalls = 0;

    window.autopilot = {
        start: async () => {
            startCalls++;

            return OK();
        }
    };
    runStore.applyRunState(createState({ status: "idle" }));
    uiStore.ui.set({ startAfterLogin: true, loginBanner: "Claude 로그인이 필요해요." });

    accounts.applyLogin({ accountId: "default", phase: "waiting", url: "https://claude.ai/x", message: "기다려요" });
    assert.equal(startCalls, 0, "로그인 중에는 시작하지 않는다");
    assert.equal(uiStore.useUiStore.getState().startAfterLogin, true);

    accounts.applyLogin(null);
    assert.equal(startCalls, 0, "결과 전에 비어 오는 갱신은 무시한다");

    accounts.applyLogin({ accountId: "default", phase: "succeeded", url: "", message: "로그인했어요." });
    await wait(10);
    assert.equal(startCalls, 1, "로그인에 성공하면 멈췄던 시작을 이어간다");
    assert.equal(uiStore.useUiStore.getState().loginBanner, null);
    assert.equal(uiStore.useUiStore.getState().startAfterLogin, false);
    assert.equal(accountStore.useAccountStore.getState().login.phase, "succeeded");

    uiStore.ui.set({ startAfterLogin: true });
    accounts.applyLogin({ accountId: "default", phase: "failed", url: "", message: "실패했어요." });
    await wait(10);
    assert.equal(startCalls, 1, "실패하면 시작하지 않는다");
    assert.equal(uiStore.useUiStore.getState().startAfterLogin, false);
};

const checkSchedules = async ({ schedules, scheduleStore, composerStore }) => {
    const payload = { schedules: [{ id: "sch-1" }], statuses: [], maxSchedules: 8, defaults: null };
    let lastSave = null;

    window.autopilot = {
        saveSchedule: async (request) => {
            lastSave = request;

            return request.schedule.kind === "bad" ? { status: "FAILED", error: { code: "X", msg: "시각이 올바르지 않아요." } } : OK(payload);
        },
        deleteSchedule: async () => OK({ ...payload, schedules: [] })
    };
    composerStore.composer.setSelectedOptions({ model: "sonnet", effort: "low" });

    schedules.schedules.openForm(null);
    assert.equal(scheduleStore.useScheduleStore.getState().pane, "form");

    assert.equal(await schedules.schedules.save({ kind: "bad" }), "시각이 올바르지 않아요.", "실패하면 메시지를 돌려준다");
    assert.equal(scheduleStore.useScheduleStore.getState().pane, "form", "실패하면 폼이 남는다");

    assert.equal(await schedules.schedules.save({ kind: "time" }), "");
    assert.equal(scheduleStore.useScheduleStore.getState().pane, "list");
    assert.equal(scheduleStore.useScheduleStore.getState().payload.schedules.length, 1);
    assert.deepEqual(lastSave.options.model, "sonnet", "저장하는 순간의 모델·Effort를 담는다");
    assert.equal(scheduleStore.useScheduleStore.getState().note.message, "예약을 저장했어요.");

    const saveSchedule = window.autopilot.saveSchedule;
    let saveCalls = 0;

    window.autopilot.saveSchedule = async (request) => {
        saveCalls += 1;
        await wait(5);

        return saveSchedule(request);
    };
    await Promise.all([schedules.schedules.save({ kind: "time" }), schedules.schedules.save({ kind: "time" })]);
    assert.equal(saveCalls, 1, "저장 중에 다시 누른 저장은 보내지 않는다");
    await schedules.schedules.save({ kind: "time" });
    assert.equal(saveCalls, 2, "저장이 끝나면 다시 저장할 수 있다");
    window.autopilot.saveSchedule = saveSchedule;

    await schedules.schedules.remove("sch-1");
    assert.equal(scheduleStore.useScheduleStore.getState().payload.schedules.length, 0);

    const failure = { status: "FAILED", error: { code: "UNEXPECTED_ERROR", msg: "처리하지 못했어요: EPERM" } };

    scheduleStore.applySchedulePayload(payload);
    window.autopilot.deleteSchedule = async () => failure;
    window.autopilot.toggleSchedule = async () => failure;

    await schedules.schedules.remove("sch-1");
    assert.equal(scheduleStore.useScheduleStore.getState().payload.schedules.length, 1, "삭제에 실패하면 목록을 그대로 둔다");
    assert.deepEqual(scheduleStore.useScheduleStore.getState().note, { message: "처리하지 못했어요: EPERM", tone: "warn" }, "삭제 실패를 안내한다");

    scheduleStore.useScheduleStore.setState({ note: { message: "", tone: "" } });
    await schedules.schedules.toggle("sch-1", false);
    assert.equal(scheduleStore.useScheduleStore.getState().note.tone, "warn", "켜고 끄기 실패를 안내한다");
};

// 설정 범위: 패널에서 바꾼 값은 고른 범위로 보내고 컴포저는 바뀐 키만 따라가며, 프로젝트를 바꾸면 컴포저를 새 프로젝트의 값으로 채운다.
const checkSettingsScope = async ({ appStore, settingsActions, composerStore, uiStore, run }) => {
    const { settings } = settingsActions;
    const { composer, useComposerStore } = composerStore;
    const { ui, useUiStore } = uiStore;
    const requests = [];
    const getView = (patch, overridden = [], notice = "") => ({
        settings: { projectDir: "/p", tasks: "", endTime: "", policy: "auto", extendOnLimit: false, model: "opus", modelVersions: {}, effort: "high", ...patch },
        overridden: overridden,
        globals: { model: "opus", effort: "high" },
        notice: notice
    });

    appStore.applySettingsView(getView({}));
    composer.loadSettings(getView({}).settings);
    composer.setTasks("작성 중인 작업");

    window.autopilot = {
        updateSettings: async (request) => {
            requests.push(request);

            return OK(getView({ model: request.patch.model }, ["model"]));
        },
        resetSettings: async (keys) => {
            requests.push({ keys: keys });

            return OK(getView({}));
        },
        selectProject: async () => OK(getView({ projectDir: "/other", tasks: "다른 작업", effort: "low" }, [], "설정을 복구했어요.")),
        listRuns: async () => OK({ runs: [] }),
        getStreakDays: async () => OK({ days: [] }),
        getPhase: async () => OK({ phase: null })
    };

    assert.equal(settings.getScope(), "global", "기본은 전역");

    ui.set({ settingsScope: "project" });

    assert.equal(settings.getScope(), "project");
    assert.equal(await settings.update({ model: "sonnet" }), true);
    assert.deepEqual(requests[0], { scope: "project", patch: { model: "sonnet" } });
    assert.equal(useComposerStore.getState().model, "sonnet", "바뀐 키는 컴포저가 따라간다");
    assert.equal(useComposerStore.getState().tasks, "작성 중인 작업", "쓰던 작업 문구는 건드리지 않는다");
    assert.deepEqual(appStore.useAppStore.getState().overridden, ["model"]);

    await settings.reset(["model"]);

    assert.deepEqual(requests[1], { keys: ["model"] });
    assert.equal(useComposerStore.getState().model, "opus");
    assert.deepEqual(appStore.useAppStore.getState().overridden, []);

    appStore.applySettingsView(getView({ projectDir: "" }));

    assert.equal(settings.getScope(), "global", "프로젝트를 고르지 않았으면 이 프로젝트 범위는 전역으로 본다");

    window.autopilot.updateSettings = async () => ({ status: "FAILED", error: { code: "RUNNING", msg: "실행 중에는 설정을 바꿀 수 없어요." } });

    assert.equal(await settings.update({ model: "haiku" }), false);
    assert.equal(await settings.save({ model: "haiku" }), "실행 중에는 설정을 바꿀 수 없어요.", "save는 입력 줄이 보여줄 이유를 돌려준다");
    assert.equal(useUiStore.getState().notice.message, "실행 중에는 설정을 바꿀 수 없어요.");

    window.autopilot.setPreferences = async (patch) => OK({ ...getView({}), settings: { ...getView({}).settings, ...patch } });

    await settings.setPreferences({ notifyFinish: false });

    assert.equal(appStore.useAppStore.getState().settings.notifyFinish, false, "환경설정은 범위 없이 바로 반영된다");

    await run.selectProject();

    assert.equal(useComposerStore.getState().tasks, "다른 작업", "프로젝트를 바꾸면 컴포저가 새 프로젝트의 값으로 채워진다");
    assert.equal(useComposerStore.getState().effort, 0);
    assert.equal(appStore.useAppStore.getState().settings.projectDir, "/other");
    assert.equal(useUiStore.getState().notice.message, "설정을 복구했어요.");
    assert.equal(useUiStore.getState().notice.tone, "warn");
};

// 설정 내보내기·가져오기·되돌리기: 덮어쓰는 두 동작은 확인해야 보내고, 취소한 파일 선택은 아무것도 바꾸지 않는다.
const checkSettingsPorting = async ({ appStore, settingsActions, composerStore, uiStore, modalStore }) => {
    const { settings } = settingsActions;
    const { modal, useModalStore } = modalStore;
    const calls = [];
    const view = {
        settings: { projectDir: "/p", tasks: "가져온 작업", endTime: "", policy: "todo", extendOnLimit: true, model: "haiku", modelVersions: {}, effort: "max" },
        overridden: [],
        globals: {},
        notice: ""
    };
    const answer = async (action, isConfirmed) => {
        const pending = action();

        assert.equal(useModalStore.getState().open, true, "확인 모달이 먼저 뜬다");
        modal.answer(isConfirmed);
        await pending;
    };

    window.autopilot = {
        exportSettings: async () => {
            calls.push("exportSettings");

            return OK({ canceled: false });
        },
        importSettings: async () => {
            calls.push("importSettings");

            return OK({ canceled: false, ...view, keyCount: 4, projectCount: 2, skippedCount: 1 });
        },
        restoreDefaultSettings: async () => {
            calls.push("restoreDefaultSettings");

            return OK(view);
        }
    };

    await settings.exportToFile();
    assert.deepEqual(calls, ["exportSettings"], "내보내기는 확인 없이 파일 선택으로 간다");
    assert.equal(uiStore.useUiStore.getState().notice.message, "설정을 파일로 내보냈어요.");

    calls.length = 0;
    await answer(settings.importFromFile, false);
    assert.deepEqual(calls, [], "가져오기를 취소하면 파일 선택도 열지 않는다");
    await answer(settings.importFromFile, true);
    assert.deepEqual(calls, ["importSettings"]);
    assert.equal(composerStore.useComposerStore.getState().tasks, "가져온 작업", "가져온 값으로 컴포저가 채워진다");
    assert.equal(appStore.useAppStore.getState().settings.model, "haiku");
    assert.match(uiStore.useUiStore.getState().notice.message, /프로젝트 설정 2개.*1개는 건너뛰었어요/);

    calls.length = 0;
    window.autopilot.importSettings = async () => OK({ canceled: true });
    await answer(settings.importFromFile, true);
    assert.equal(uiStore.useUiStore.getState().notice.message, "", "파일 선택을 취소하면 안내도 없다");

    await answer(settings.restoreDefaults, false);
    assert.deepEqual(calls, []);
    await answer(settings.restoreDefaults, true);
    assert.deepEqual(calls, ["restoreDefaultSettings"]);
    assert.equal(uiStore.useUiStore.getState().notice.message, "설정을 기본값으로 되돌렸어요.");
    assert.equal(useModalStore.getState().request.tone, "danger", "되돌리기는 위험 모달이다");

    // 끝난 뒤 PC 동작: 종료는 확인을 받아야 저장하고, 절전은 바로 저장한다. 기다리는 동안의 상태는 화면이 보관한다.
    window.autopilot.setPreferences = async (patch) => {
        calls.push(["setPreferences", patch]);

        return OK({ ...view, settings: { ...view.settings, ...patch } });
    };
    window.autopilot.cancelPostAction = async () => {
        calls.push("cancelPostAction");

        return OK();
    };
    window.autopilot.runPostActionNow = async () => {
        calls.push("runPostActionNow");

        return OK();
    };
    calls.length = 0;

    await answer(() => settings.setPostRunAction("shutdown"), false);
    assert.deepEqual(calls, [], "종료를 취소하면 저장하지 않는다");
    assert.equal(useModalStore.getState().request.tone, "danger");
    await answer(() => settings.setPostRunAction("shutdown"), true);
    assert.deepEqual(calls, [["setPreferences", { postRunAction: "shutdown" }]]);

    calls.length = 0;
    await settings.setPostRunAction("sleep");
    assert.deepEqual(calls, [["setPreferences", { postRunAction: "sleep" }]], "절전은 확인 없이 저장한다");

    settings.applyPostAction({ pending: { action: "sleep", at: 123 }, error: "" });
    assert.deepEqual(uiStore.useUiStore.getState().postAction, { action: "sleep", at: 123 });

    calls.length = 0;
    await settings.cancelPostAction();
    await settings.runPostActionNow();
    assert.deepEqual(calls, ["cancelPostAction", "runPostActionNow"]);

    settings.applyPostAction({ pending: null, error: "PC를 절전하지 못했어요: 권한이 없어요" });
    assert.equal(uiStore.useUiStore.getState().postAction, null);
    assert.equal(uiStore.useUiStore.getState().notice.message, "PC를 절전하지 못했어요: 권한이 없어요");

    // 보관 기간이 지난 기록 지우기: 확인해야 지우고, 지운 뒤 개수와 용량을 알린다.
    window.autopilot.pruneRuns = async () => {
        calls.push("pruneRuns");

        return OK({ deletedCount: 3, freedBytes: 2048 });
    };
    window.autopilot.listRuns = async () => OK({ runs: [] });
    window.autopilot.getStreakDays = async () => OK({ days: [] });
    window.autopilot.getPhase = async () => OK({ phase: null });
    calls.length = 0;

    await answer(settings.pruneStaleRuns, false);
    assert.deepEqual(calls, [], "취소하면 지우지 않는다");
    await answer(settings.pruneStaleRuns, true);
    assert.deepEqual(calls, ["pruneRuns"]);
    assert.equal(uiStore.useUiStore.getState().notice.message, "오래된 기록 3개를 지웠어요 (2.0 KB).");

    window.autopilot.pruneRuns = async () => OK({ deletedCount: 0, freedBytes: 0 });
    await answer(settings.pruneStaleRuns, true);
    assert.equal(uiStore.useUiStore.getState().notice.message, "지울 기록이 없었어요.");
};

const checkModal = async ({ modalStore }) => {
    const { modal, useModalStore } = modalStore;

    const confirmed = modal.confirm({ title: "지울까요?", message: "되돌릴 수 없어요.", tone: "danger" });

    assert.equal(useModalStore.getState().open, true);
    assert.equal(useModalStore.getState().request.title, "지울까요?");
    modal.answer(true);
    assert.equal(await confirmed, true, "확인하면 true로 풀린다");
    assert.equal(useModalStore.getState().open, false);
    assert.equal(useModalStore.getState().request.title, "지울까요?", "닫는 전환 동안 내용이 남는다");

    const cancelled = modal.confirm({ title: "계속할까요?" });

    modal.answer(false);
    assert.equal(await cancelled, false, "취소·Esc·바깥 클릭은 false로 풀린다");

    const replaced = modal.confirm({ title: "첫 번째" });
    const latest = modal.confirm({ title: "두 번째" });

    assert.equal(await replaced, false, "떠 있는 모달 위에 새로 부르면 앞의 것은 취소로 닫힌다");
    assert.equal(useModalStore.getState().request.title, "두 번째");
    modal.answer(true);
    assert.equal(await latest, true);

    modal.answer(false);
    assert.equal(useModalStore.getState().open, false, "이미 풀린 요청에 다시 답해도 오류 없이 닫힌 채다");
};

// 메인이 projectDir을 단 이벤트: 지금 보는 프로젝트의 것만 반영하고, 프로젝트를 고르면 응답의 상태·로그로 바꾼다.
const checkProjectEvents = async ({ events, runStore, runsStore, appStore, run }) => {
    const view = (projectDir) => ({
        settings: { projectDir: projectDir, tasks: "", endTime: "", policy: "auto", extendOnLimit: false, model: "opus", modelVersions: {}, effort: "high" },
        overridden: [],
        globals: {},
        notice: ""
    });
    const readLogs = () => runStore.useRunStore.getState().logs.map((line) => line.text);

    appStore.applySettingsView(view("/a"));
    runStore.clearLogs();

    events.handleStateEvent({ projectDir: "/a", state: createState({ status: "running", round: 1 }) });
    events.handleStateEvent({ projectDir: "/b", state: createState({ status: "idle", round: 9 }) });

    assert.equal(runStore.getRunState().round, 1, "다른 프로젝트의 상태는 반영하지 않는다");
    assert.equal(events.isViewing("/a"), true);
    assert.equal(events.isViewing("/b"), false);

    events.handleLogEvent({ projectDir: "/a", entries: [{ stream: "out", text: "A 줄" }] });
    events.handleLogEvent({ projectDir: "/b", entries: [{ stream: "out", text: "B 줄" }] });
    await wait(90);

    assert.deepEqual(readLogs(), ["A 줄"], "다른 프로젝트의 로그는 반영하지 않는다");

    events.applySessionSnapshot({
        state: createState({ status: "running", round: 4 }),
        logs: [
            { stream: "out", text: "스냅샷 1" },
            { stream: "out", text: "스냅샷 2" }
        ]
    });

    assert.equal(runStore.getRunState().round, 4);
    assert.deepEqual(readLogs(), ["스냅샷 1", "스냅샷 2"], "이전 로그는 지우고 받은 로그로 바꾼다");
    assert.deepEqual(
        runStore.useRunStore.getState().logs.map((line) => line.id),
        [1, 2],
        "번호는 처음부터다"
    );

    window.autopilot = {
        selectProject: async () => OK({ ...view("/b"), state: createState({ status: "idle", round: 0 }), logs: [{ stream: "out", text: "B 기록" }] }),
        listRuns: async () => OK({ runs: [] }),
        getStreakDays: async () => OK({ days: [] }),
        getPhase: async () => OK({ phase: null })
    };

    await run.selectProject();

    assert.equal(appStore.useAppStore.getState().settings.projectDir, "/b");
    assert.equal(runStore.getRunState().round, 0, "고른 프로젝트의 상태로 바뀐다");
    assert.deepEqual(readLogs(), ["B 기록"]);

    events.handleStateEvent({ projectDir: "/b", state: createState({ status: "running", round: 2 }) });

    assert.equal(runStore.getRunState().round, 2, "프로젝트를 고른 뒤의 이벤트는 반영된다");

    window.autopilot.selectProject = async () => OK(view("/c"));

    await run.selectProject();

    assert.equal(runStore.getRunState().round, 2, "상태가 없는 응답(파일 선택 취소 등)은 상태·로그를 건드리지 않는다");
    assert.deepEqual(readLogs(), ["B 기록"]);

    // 승인하는 동안 다른 탭으로 옮기면 승인한 프로젝트의 단계로 기억하고, 옮긴 프로젝트를 대신 시작하지 않는다.
    const approved = { phase: "design", awaiting: null, qaRetries: 0 };
    const calls = [];

    appStore.applySettingsView(view("/a"));
    runsStore.useRunsStore.setState({ phases: {}, buildPhase: null });
    window.autopilot.approvePhase = async (projectDir) => {
        calls.push(["approvePhase", projectDir]);
        appStore.applySettingsView(view("/b"));

        return OK({ phase: approved });
    };
    window.autopilot.start = async () => {
        calls.push(["start"]);

        return OK();
    };

    await run.approveAndStart();

    assert.deepEqual(calls, [["approvePhase", "/a"]]);
    assert.deepEqual(runsStore.useRunsStore.getState().phases, { "/a": approved });
    assert.equal(runsStore.useRunsStore.getState().buildPhase, null);
};

// 탭: 전환하면 그 프로젝트의 설정·상태·로그로 바뀌고, 쓰던 작업은 돌아오면 되살아나며, 다른 탭을 닫아도 보던 화면은 그대로다.
const checkTabs = async ({ tabs, tabsStore, appStore, runStore, composerStore, uiStore, modalStore, scheduleStore }) => {
    const { composer, useComposerStore } = composerStore;
    const { useUiStore } = uiStore;
    const { modal, useModalStore } = modalStore;
    const view = (projectDir, patch = {}) => ({
        settings: { projectDir: projectDir, tasks: "", endTime: "", policy: "auto", extendOnLimit: false, model: "opus", modelVersions: {}, effort: "high", ...patch },
        overridden: [],
        globals: {},
        notice: ""
    });
    const tab = (projectDir, status = "idle") => ({ projectDir: projectDir, name: projectDir.slice(1), status: status });
    const list = (active, dirs = ["/a", "/b"]) => ({ active: active, tabs: dirs.map((dir) => tab(dir)) });
    const calls = [];
    const readLogs = () => runStore.useRunStore.getState().logs.map((line) => line.text);
    const readTabs = () => tabsStore.useTabsStore.getState();

    window.autopilot = {
        activateTab: async (dir) => {
            calls.push(["activate", dir]);

            return OK({
                ...view(dir, { tasks: dir === "/b" ? "B에 저장된 작업" : "" }),
                tabs: list(dir),
                state: createState({ status: "idle", round: dir === "/b" ? 7 : 1 }),
                logs: [{ stream: "out", text: `${dir} 기록` }]
            });
        },
        closeTab: async (dir) => {
            calls.push(["close", dir]);

            return OK({ ...view(dir === "/b" ? "/a" : "/a"), tabs: list("/a", ["/a"]), state: createState({ round: 1 }), logs: [{ stream: "out", text: "/a 기록" }] });
        },
        openTab: async () => OK({ ...view("/c"), canceled: false, existing: false, tabs: list("/c", ["/a", "/b", "/c"]), state: createState({ round: 0 }), logs: [] }),
        listRuns: async () => OK({ runs: [] }),
        getStreakDays: async () => OK({ days: [] }),
        getPhase: async () => OK({ phase: null })
    };

    appStore.applySettingsView(view("/a"));
    composer.loadSettings(view("/a").settings);
    tabsStore.applyTabs(list("/a"));
    runStore.applyRunState(createState({ status: "idle", round: 1 }));
    runStore.resetLogs();
    composer.setTasks("A에서 쓰던 작업");

    await tabs.activateTab("/a");

    assert.equal(calls.length, 0, "보고 있는 탭을 다시 눌러도 메인에 묻지 않는다");

    await tabs.activateTab("/b");

    assert.deepEqual(calls.at(-1), ["activate", "/b"]);
    assert.equal(appStore.useAppStore.getState().settings.projectDir, "/b");
    assert.equal(readTabs().active, "/b");
    assert.equal(useComposerStore.getState().tasks, "B에 저장된 작업", "컴포저는 그 프로젝트의 저장된 값으로 채워진다");
    assert.equal(runStore.getRunState().round, 7, "그 프로젝트의 상태로 바뀐다");
    assert.deepEqual(readLogs(), ["/b 기록"], "그 프로젝트의 로그로 바뀐다");
    assert.equal(useUiStore.getState().finishDismissed, false, "마친 상태가 남은 탭으로 가면 마친 화면을 보여준다");

    composer.setTasks("B에서 새로 쓰는 작업");

    await tabs.activateTab("/a");

    assert.equal(useComposerStore.getState().tasks, "A에서 쓰던 작업", "저장하지 않고 떠난 작업은 돌아오면 되살아난다");

    await tabs.activateTab("/b");

    assert.equal(useComposerStore.getState().tasks, "B에서 새로 쓰는 작업");

    composer.setTasks("B에 저장된 작업");

    await tabs.activateTab("/a");
    await tabs.activateTab("/b");

    assert.equal(useComposerStore.getState().tasks, "B에 저장된 작업", "저장된 값과 같으면 따로 기억하지 않는다");

    // 실행 중이던 탭에서 떠날 때는 작업을 기억하지 않는다(컴포저는 엔진 값을 따라간다).
    runStore.applyRunState(createState({ status: "running" }));
    composer.setTasks("실행 중 편집");
    await tabs.activateTab("/a");
    runStore.applyRunState(createState({ status: "idle" }));
    await tabs.activateTab("/b");

    assert.equal(useComposerStore.getState().tasks, "B에 저장된 작업");

    // 다른 탭을 닫아도 보던 화면(컴포저·로그)은 그대로다. 예약이 있는 탭은 먼저 확인한다.
    appStore.applySettingsView(view("/a"));
    tabsStore.applyTabs(list("/a"));
    runStore.applyRunState(createState({ status: "idle", round: 1 }));
    runStore.resetLogs();
    runStore.appendEntries([{ stream: "out", text: "보던 로그" }]);
    runStore.flushNow();
    composer.setTasks("편집 중");
    calls.length = 0;

    scheduleStore.applySchedulePayload({ schedules: [{ id: "sch-1", scope: "project", projectDir: "/b" }], statuses: [], maxSchedules: 8, defaults: null });

    let pending = tabs.closeTab("/b");

    assert.equal(useModalStore.getState().open, true, "예약이 있는 탭은 닫기 전에 확인한다");
    assert.match(useModalStore.getState().request.message, /예약 1개/);
    modal.answer(false);
    await pending;

    assert.equal(calls.length, 0, "취소하면 메인에 보내지 않는다");

    pending = tabs.closeTab("/b");
    modal.answer(true);
    await pending;

    assert.deepEqual(calls.at(-1), ["close", "/b"]);
    assert.equal(useComposerStore.getState().tasks, "편집 중", "보던 탭이 그대로면 쓰던 작업을 건드리지 않는다");
    assert.deepEqual(readLogs(), ["보던 로그"], "보던 탭이 그대로면 로그를 바꾸지 않는다");
    assert.deepEqual(
        readTabs().tabs.map((entry) => entry.projectDir),
        ["/a"]
    );

    scheduleStore.applySchedulePayload({ schedules: [], statuses: [], maxSchedules: 8, defaults: null });
    calls.length = 0;
    await tabs.closeTab("/a");

    assert.equal(useModalStore.getState().open, false, "예약이 없으면 바로 닫는다");
    assert.deepEqual(calls.at(-1), ["close", "/a"]);

    // 새 탭 열기: 열리면 그 프로젝트로 바뀌고, 이미 열려 있었으면 안내하며, 폴더 선택을 취소하면 아무것도 바꾸지 않는다.
    await tabs.openTab();

    assert.equal(appStore.useAppStore.getState().settings.projectDir, "/c");
    assert.equal(readTabs().tabs.length, 3);

    window.autopilot.openTab = async () => OK({ ...view("/a"), canceled: false, existing: true, tabs: list("/a", ["/a", "/b", "/c"]), state: createState({ round: 1 }), logs: [] });

    await tabs.openTab();

    assert.equal(appStore.useAppStore.getState().settings.projectDir, "/a");
    assert.match(useUiStore.getState().notice.message, /이미 열려 있는 프로젝트/);

    window.autopilot.openTab = async () => OK({ ...view("/b"), canceled: true, tabs: list("/b") });

    await tabs.openTab();

    assert.equal(appStore.useAppStore.getState().settings.projectDir, "/a", "폴더 선택을 취소하면 바뀌지 않는다");

    window.autopilot.activateTab = async () => ({ status: "FAILED", error: { code: "INVALID_PROJECT", msg: "열려 있는 프로젝트가 아니에요." } });

    await tabs.activateTab("/zzz");

    assert.equal(useUiStore.getState().notice.message, "열려 있는 프로젝트가 아니에요.");
    assert.equal(appStore.useAppStore.getState().settings.projectDir, "/a");

    // Git 저장소가 아닌 폴더: 새 저장소를 만들지 먼저 묻고, 취소하면 아무것도 보내지 않으며, 만들면 메인이 이어서 연 결과를 반영한다(경로는 보내지 않는다).
    const notGitRepo = { status: "FAILED", error: { code: "NOT_GIT_REPO", msg: "Git 저장소가 아니에요." }, data: { projectDir: "/new" } };
    const initCalls = [];

    window.autopilot.openTab = async () => notGitRepo;
    window.autopilot.initGitRepo = async (...args) => {
        initCalls.push(args);

        return OK({ ...view("/new"), tabs: list("/new", ["/a", "/new"]), state: createState({}), logs: [] });
    };

    let pendingOpen = tabs.openTab();

    await Promise.resolve();
    assert.match(useModalStore.getState().request.message, /\/new 폴더는 Git 저장소가 아니에요/);
    modal.answer(false);
    await pendingOpen;
    assert.equal(initCalls.length, 0, "취소하면 저장소를 만들지 않는다");
    assert.equal(appStore.useAppStore.getState().settings.projectDir, "/a");

    pendingOpen = tabs.openTab();
    await Promise.resolve();
    modal.answer(true);
    await pendingOpen;
    assert.deepEqual(initCalls, [[]]);
    assert.equal(appStore.useAppStore.getState().settings.projectDir, "/new");
};

const checkStoryView = ({ storyModel }) => {
    const view = { key: "item:3", text: "문장", time: "10:00:03", pastItems: [{ key: "1:0:앞" }, { key: "2:1:뒤" }] };
    const copy = { ...view, pastItems: view.pastItems.map((item) => ({ ...item })) };

    assert.equal(storyModel.isSameView(view, copy), true, "같은 모양이면 다시 그리지 않는다");
    assert.equal(storyModel.isSameView(view, { ...copy, text: "다른 문장" }), false);
    assert.equal(storyModel.isSameView(view, { ...copy, key: "item:4" }), false, "새 문장이면 다시 그린다");
    assert.equal(storyModel.isSameView(view, { ...copy, time: "10:00:04" }), false);
    assert.equal(storyModel.isSameView(view, { ...copy, pastItems: [...copy.pastItems, { key: "3:0:끝" }] }), false, "지난 문장이 늘면 다시 그린다");
    assert.equal(storyModel.isSameView(view, { ...copy, pastItems: [{ key: "1:0:앞" }, { key: "2:2:뒤" }] }), false, "지난 문장의 도구 수가 바뀌면 다시 그린다");
};

// 새 프로젝트: 한두 줄 → 초안 → 칩으로 다듬기 → 만들기. 초안이 실패해도 적은 내용을 잃지 않고, 그만둔 뒤 늦게 온 답은 버린다.
const checkNewProject = async ({ newProjectStore, newProjectActions, uiStore, tabs, tabsStore }) => {
    const { newProject, useNewProjectStore } = newProjectStore;
    const { useUiStore } = uiStore;
    const read = () => useNewProjectStore.getState();
    const draft = {
        name: "hanbit-booking",
        summary: "미용실 예약 웹앱",
        users: [{ label: "손님", picked: true }],
        platforms: ["web"],
        features: [
            { label: "예약", picked: true },
            { label: "알림 문자", picked: false }
        ],
        exclusions: [{ label: "결제", picked: true }],
        stack: { items: ["Next.js"], reason: "작아서" }
    };
    const requests = [];
    let pendingDraft = null;

    window.autopilot = {
        getCreateInfo: async () => OK({ parentDir: "D:\\work", author: { name: "한빛", email: "a@b.c" } }),
        draftProject: (request) => {
            requests.push(["draft", request]);

            return new Promise((resolve) => {
                pendingDraft = resolve;
            });
        },
        cancelDraft: async () => OK({}),
        createProject: async (request) => {
            requests.push(["create", request]);

            return OK({
                settings: { projectDir: "D:\\work\\hanbit-booking", mode: "build", tasks: request.brief },
                overridden: [],
                globals: {},
                notice: "",
                tabs: { active: "D:\\work\\hanbit-booking", tabs: [{ projectDir: "D:\\work\\hanbit-booking", name: "hanbit-booking", status: "idle" }] },
                state: createState({ status: "idle" }),
                logs: []
            });
        },
        activateTab: async () => OK({ settings: { projectDir: "/a" }, overridden: [], globals: {}, notice: "", tabs: { active: "/a", tabs: [] }, state: createState(), logs: [] }),
        listRuns: async () => OK({ runs: [] }),
        getStreakDays: async () => OK({ days: [] }),
        getPhase: async () => OK({ phase: null })
    };

    newProjectActions.openNewProject();
    await wait(0);
    assert.equal(useUiStore.getState().newProject, true);
    assert.equal(read().info.parentDir, "D:\\work");

    // 아직 몰라요는 다른 실행 환경과 함께 고르지 않는다.
    newProject.togglePlatform("web");
    newProject.togglePlatform("unknown");
    assert.deepEqual(read().platforms, ["unknown"]);
    newProject.togglePlatform("cli");
    assert.deepEqual(read().platforms, ["cli"]);
    newProject.togglePlatform("cli");

    // 그만둔 뒤 늦게 온 초안은 버린다.
    newProject.set({ what: "미용실 예약" });
    const canceled = newProjectActions.requestDraft();

    newProjectActions.cancelDraft();
    pendingDraft(OK({ draft: draft }));
    await canceled;
    assert.equal(read().step, "write");
    assert.equal(read().isDrafting, false);

    // 그만두고 바로 다시 요청하면 앞 요청의 그만둔 응답이 늦게 와도 새 요청을 끝내지 않는다.
    const stale = newProjectActions.requestDraft();
    const resolveStale = pendingDraft;

    newProjectActions.cancelDraft();

    // 고른 실행 환경이 없으면 초안의 것을 쓰고, 추천 스택이 있으면 추천대로가 기본이다.
    const drafted = newProjectActions.requestDraft();

    resolveStale({ status: "FAILED", error: { code: "CANCELED", msg: "초안 만들기를 그만뒀어요." } });
    await stale;
    assert.equal(read().isDrafting, true);
    pendingDraft(OK({ draft: draft }));
    await drafted;
    assert.deepEqual(requests.at(-1), ["draft", { what: "미용실 예약", platforms: [] }]);
    assert.equal(read().step, "refine");
    assert.deepEqual(read().platforms, ["web"]);
    assert.equal(read().draft.stack.choice, "recommended");

    // 더한 것은 넣은 상태이고, 이미 있는 추천을 더하면 넣은 상태로 바뀐다.
    newProject.addItems("features", ["알림 문자", "후기"]);
    assert.deepEqual(read().draft.features, [
        { label: "예약", picked: true },
        { label: "알림 문자", picked: true },
        { label: "후기", picked: true }
    ]);
    newProject.toggleItem("features", 0);
    assert.equal(read().draft.features[0].picked, false);

    // 만들면 brief.md를 보내고(작성자는 git에 있으면 보내지 않음) 새 탭으로 옮긴다. 입력은 비운다.
    await newProjectActions.createProject();

    const createRequest = requests.at(-1)[1];

    assert.equal(createRequest.name, "hanbit-booking");
    assert.equal(createRequest.author, null);
    assert.match(createRequest.brief, /^# hanbit-booking\n/);
    assert.match(createRequest.brief, /- 알림 문자/);
    assert.doesNotMatch(createRequest.brief, /- 예약\n/, "뺀 기능은 brief에 넣지 않는다");
    assert.equal(useUiStore.getState().newProject, false);
    assert.equal(tabsStore.useTabsStore.getState().active, "D:\\work\\hanbit-booking");
    assert.equal(read().what, "");

    // 초안이 실패하면 적은 내용을 한 줄 요약으로 두고 이유를 알린다.
    newProject.set({ what: "가계부 앱" });
    const failed = newProjectActions.requestDraft();

    pendingDraft({ status: "FAILED", error: { code: "LOGIN_REQUIRED", msg: "로그인되어 있지 않아요." } });
    await failed;
    assert.equal(read().step, "refine");
    assert.equal(read().draft.summary, "가계부 앱");
    assert.match(read().notice, /로그인되어 있지 않아요\. 적어 주신 내용으로 직접 채워 주세요\./);

    // 처음부터 다시 쓰면 적은 한두 줄은 남기고 초안만 비운다. 탭을 고르면 새 프로젝트 화면을 닫는다.
    newProject.restart();
    assert.equal(read().step, "write");
    assert.equal(read().what, "가계부 앱");

    // 만들 위치·작성자를 읽지 못하면 만들기가 꺼진 채로 두지 않고 이유를 알린다.
    window.autopilot.getCreateInfo = async () => ({ status: "FAILED", error: { code: "UNEXPECTED_ERROR", msg: "처리하지 못했어요: EPERM" } });
    newProjectActions.openNewProject();
    await wait(0);
    assert.equal(useUiStore.getState().notice.message, "처리하지 못했어요: EPERM");
    await tabs.activateTab("D:\\work\\hanbit-booking");
    assert.equal(useUiStore.getState().newProject, false, "같은 탭을 눌러도 새 프로젝트 화면은 닫힌다");
};

const checkStores = async () => {
    const modules = await loadModules();

    globalThis.window = {};

    checkShareStructure(modules);
    await checkRunStore(modules);
    checkOverlays(modules);
    await checkComposer(modules);
    await checkRunActions(modules);
    await checkConfirmedActions(modules);
    await checkLoginResume(modules);
    await checkSchedules(modules);
    await checkSettingsScope(modules);
    await checkSettingsPorting(modules);
    await checkModal(modules);
    await checkProjectEvents(modules);
    await checkTabs(modules);
    await checkNewProject(modules);
    checkStoryView(modules);

    console.log("Desktop store checks passed.");
    process.exit(0);
};

await checkStores();

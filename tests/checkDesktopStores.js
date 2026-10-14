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
        export * as composerStore from "./stores/composerStore.js";
        export * as accountStore from "./stores/accountStore.js";
        export * as run from "./actions/run.js";
        export * as accounts from "./actions/accounts.js";
        export * as schedules from "./actions/schedules.js";
        export * as scheduleStore from "./stores/scheduleStore.js";
        export * as storyModel from "./features/run/storyModel.js";
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
    assert.deepEqual(sent[0], { model: "haiku", effort: "xhigh" }, "처음 바뀐 시점의 선택이 먼저 나간다");

    release();
    await wait(10);
    assert.equal(sent.length, 2, "끝난 뒤 마지막 선택만 한 번 더 보낸다");
    assert.deepEqual(sent[1], { model: "haiku", effort: "medium" });

    release();
    await wait(10);

    // 전달이 끝나면 엔진이 받은 값(requested)을 기준으로 선택이 맞춰진다.
    runStore.applyRunState(createState({ status: "running", requested: { model: "claude-haiku-4-5", effort: "medium" } }));
    composer.syncFromRun(runStore.useRunStore.getState().state);
    assert.equal(useComposerStore.getState().model, "haiku");

    runStore.applyRunState(createState({ status: "idle" }));
    composer.chooseModel("opus");
    assert.equal(sent.length, 2, "실행 중이 아니면 엔진에 보내지 않는다");

    composer.setEndTime("22:30");
    composer.stepEndTime(60, 1);
    assert.equal(useComposerStore.getState().endTime, "23:30", "종료 시각은 단위만큼 옮긴다");
    composer.stepEndTime(10, -1);
    assert.equal(useComposerStore.getState().endTime, "23:20");
};

const checkRunActions = async ({ runStore, uiStore, composerStore, run }) => {
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
        listRuns: async () => OK({ runs: [] })
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

    runStore.applyRunState(createState({ status: "stopping" }));
    await run.handleMainAction();
    assert.equal(killCalls, 1, "종료 요청 뒤에는 바로 강제 종료다");
    ui.set({ stopArmed: false });
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

    await schedules.schedules.remove("sch-1");
    assert.equal(scheduleStore.useScheduleStore.getState().payload.schedules.length, 0);
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

const checkStores = async () => {
    const modules = await loadModules();

    globalThis.window = {};

    checkShareStructure(modules);
    await checkRunStore(modules);
    checkOverlays(modules);
    await checkComposer(modules);
    await checkRunActions(modules);
    await checkLoginResume(modules);
    await checkSchedules(modules);
    checkStoryView(modules);

    console.log("Desktop store checks passed.");
    process.exit(0);
};

await checkStores();

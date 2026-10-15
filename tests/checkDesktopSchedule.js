import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const rules = require("../desktop/scheduleRules.cjs");
const { createScheduler } = require("../desktop/scheduler.cjs");

const { parseSchedule, normalizeSchedules, getDefaultSchedule, evaluateSchedule, createState, getLatestOccurrence, getNextOccurrence, getWindowState, getRemaining, MAX_SCHEDULES, MIN_RUN_MS } = rules;

const MINUTE_MS = 60 * 1000;
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
// 2026-10-14는 수요일이다. 모든 시각은 지역 시각으로 만든다.
const at = (hour, minute, dayOffset = 0) => new Date(2026, 9, 14 + dayOffset, hour, minute, 0, 0).getTime();
const SESSION = "5시간 한도";
const WEEKLY = "주간 한도";
const SCOPED = "주간 한도 · Opus";

const makeSchedule = (overrides = {}) => {
    return { ...getDefaultSchedule("time"), id: "sch-0a1b2c3d", ...overrides };
};

const makeResetSchedule = (overrides = {}) => {
    return { ...getDefaultSchedule("reset"), id: "sch-0a1b2c3d", from: "", to: "", minRemaining: 0, duration: 300, ...overrides };
};

const makeUsage = ({ session, weekly, scoped, fetchedAt = 1 } = {}) => {
    const limits = [];

    if (session) {
        limits.push({ label: SESSION, percent: session.percent, resetsAt: session.resetsAt ?? 0 });
    }

    if (weekly) {
        limits.push({ label: WEEKLY, percent: weekly.percent, resetsAt: weekly.resetsAt ?? 0 });
    }

    if (scoped) {
        limits.push({ label: SCOPED, percent: scoped.percent, resetsAt: 0 });
    }

    return { profile: null, limits: limits, fetchedAt: fetchedAt, error: null };
};

const evaluate = (schedule, state, now, { usage = null, isBusy = false } = {}) => {
    return evaluateSchedule(schedule, state, { now: now, usage: usage, isBusy: isBusy });
};

const checkParse = () => {
    const base = { kind: "time", time: "23:00", days: [1, 3, 5], minRemaining: 0, duration: 360 };
    const { schedule } = parseSchedule({ ...base, window: "weekly", from: "22:00", to: "07:00" });

    assert.deepEqual(schedule, { id: "", enabled: true, kind: "time", time: "23:00", window: "session", from: "", to: "", days: [1, 3, 5], minRemaining: 0, duration: 360 });
    assert.equal(parseSchedule({ ...base, id: "sch-12345678", enabled: false }).schedule.enabled, false);
    assert.equal(parseSchedule({ ...base, id: "../evil" }).schedule.id, "");
    assert.deepEqual(parseSchedule({ ...base, days: [3, 3, 9, "x", 1] }).schedule.days, [1, 3]);

    for (const broken of [
        {},
        null,
        { ...base, kind: "weekly" },
        { ...base, days: [] },
        { ...base, days: [8] },
        { ...base, time: "24:00" },
        { ...base, time: "7:00" },
        { ...base, duration: 61 },
        { ...base, minRemaining: 10 },
        { kind: "reset", window: "daily", days: ALL_DAYS, minRemaining: 0, duration: 60 },
        { kind: "reset", window: "session", from: "22:00", days: ALL_DAYS, minRemaining: 0, duration: 60 },
        { kind: "reset", window: "session", from: "22:00", to: "22:00", days: ALL_DAYS, minRemaining: 0, duration: 60 }
    ]) {
        assert(parseSchedule(broken).error, `거부해야 해요: ${JSON.stringify(broken)}`);
    }

    const reset = parseSchedule({ kind: "reset", window: "weekly", from: "", to: "", days: ALL_DAYS, minRemaining: 50, duration: 300 }).schedule;

    assert.equal(reset.window, "weekly");
    assert.equal(reset.time, "");
    assert.equal(reset.from, "");
};

const checkNormalize = () => {
    const valid = (id) => ({ ...makeSchedule(), id: id });
    const list = [valid("sch-00000001"), valid("sch-00000001"), valid(""), { kind: "x" }, null, valid("sch-00000002")];

    assert.deepEqual(
        normalizeSchedules(list).map((schedule) => schedule.id),
        ["sch-00000001", "sch-00000002"]
    );
    assert.deepEqual(normalizeSchedules("nope"), []);

    const many = Array.from({ length: MAX_SCHEDULES + 4 }, (value, index) => valid(`sch-${String(index).padStart(8, "0")}`));

    assert.equal(normalizeSchedules(many).length, MAX_SCHEDULES);
};

const checkOccurrences = () => {
    const schedule = makeSchedule({ time: "23:00", days: [3] });

    assert.equal(getLatestOccurrence(schedule, at(22, 59)), null);
    assert.equal(getLatestOccurrence(schedule, at(23, 5)), at(23, 0));
    // 자정을 넘긴 뒤에도 전날 시작 시각이 가장 최근이다.
    assert.equal(getLatestOccurrence(schedule, at(0, 30, 1)), at(23, 0));
    // 어제 것까지만 보므로 이틀 전 시작 시각은 찾지 않는다.
    assert.equal(getLatestOccurrence(schedule, at(23, 5, 2)), null);
    assert.equal(getNextOccurrence(schedule, at(23, 5)), at(23, 0, 7));
    assert.equal(getNextOccurrence(makeSchedule({ time: "23:00" }), at(23, 5)), at(23, 0, 1));
};

const checkTimeSchedule = () => {
    const schedule = makeSchedule({ time: "23:00", duration: 360 });

    const early = evaluate(schedule, createState(), at(22, 59));

    assert.equal(early.decision, "wait");
    assert.deepEqual({ code: early.status.code, at: early.status.at }, { code: "next-time", at: at(23, 0) });

    const due = evaluate(schedule, createState(), at(23, 5));

    assert.equal(due.decision, "fire");
    assert.equal(due.plan.endTime, "05:05");
    assert.equal(due.plan.endAt, at(5, 5, 1));

    const after = evaluate(schedule, due.state, at(23, 6));

    assert.equal(after.decision, "wait");
    assert.equal(after.status.at, at(23, 0, 1));

    // 놓친 예약은 유예 시간 안에서만 이어서 시작한다(자정을 넘겨도 된다).
    assert.equal(evaluate(schedule, createState(), at(0, 59, 1)).decision, "fire");
    assert.equal(evaluate(schedule, createState(), at(1, 30, 1)).decision, "wait");

    const busy = evaluate(schedule, createState(), at(23, 5), { isBusy: true });

    assert.equal(busy.status.code, "busy");
    assert.equal(busy.state.lastFiredKey, "");
    assert.equal(evaluate(schedule, busy.state, at(23, 20)).decision, "fire");

    assert.equal(evaluate({ ...schedule, enabled: false }, createState(), at(23, 5)).status.code, "disabled");
    assert.equal(evaluate(makeSchedule({ time: "23:00", days: [1] }), createState(), at(23, 5)).decision, "wait");
};

const checkRemaining = () => {
    const usage = makeUsage({ session: { percent: 70 }, weekly: { percent: 20 }, scoped: { percent: 99 } });

    assert.equal(getRemaining(usage), 30);
    assert.equal(getRemaining(makeUsage({ scoped: { percent: 99 } })), null);
    assert.equal(getRemaining(null), null);

    const schedule = makeSchedule({ minRemaining: 50 });
    const low = evaluate(schedule, createState(), at(23, 5), { usage: usage });

    assert.deepEqual({ code: low.status.code, remaining: low.status.remaining, need: low.status.need }, { code: "low-limit", remaining: 30, need: 50 });
    assert.equal(evaluate(schedule, createState(), at(23, 5), { usage: makeUsage({ session: { percent: 40 }, weekly: { percent: 10 } }) }).decision, "fire");
    // 사용량을 읽지 못했으면 조건을 검사할 수 없어 막지 않는다.
    assert.equal(evaluate(schedule, createState(), at(23, 5), { usage: null }).decision, "fire");
    assert.equal(evaluate(schedule, createState(), at(23, 5), { usage: { limits: [], error: { msg: "x" }, fetchedAt: 0 } }).decision, "fire");
};

const checkWindowState = () => {
    const night = makeResetSchedule({ from: "22:00", to: "07:00", days: [5] });

    // 금요일 22:00에 시작한 시간대는 토요일 새벽까지 이어진다. 요일은 시작하는 날 기준이다.
    const friday = (hour, minute, dayOffset = 0) => at(hour, minute, 2 + dayOffset);

    assert.deepEqual(getWindowState(night, friday(21, 0)), { isOpen: false, closesAt: null, opensAt: friday(22, 0) });
    assert.deepEqual(getWindowState(night, friday(23, 0)), { isOpen: true, closesAt: friday(7, 0, 1), opensAt: friday(22, 0) });
    assert.equal(getWindowState(night, friday(3, 0, 1)).isOpen, true);
    assert.equal(getWindowState(night, friday(23, 0, 1)).isOpen, false);
    assert.equal(getWindowState(night, friday(23, 0, 1)).opensAt, friday(22, 0, 7));

    const day = makeResetSchedule({ from: "09:00", to: "18:00" });

    assert.equal(getWindowState(day, at(12, 0)).closesAt, at(18, 0));
    assert.equal(getWindowState(day, at(19, 0)).opensAt, at(9, 0, 1));

    const anytime = makeResetSchedule({ days: [3] });

    assert.equal(getWindowState(anytime, at(15, 0)).isOpen, true);
    assert.equal(getWindowState(anytime, at(15, 0, 1)).isOpen, false);
};

const checkResetSchedule = () => {
    const schedule = makeResetSchedule({ duration: 300 });
    const resetsAt = at(14, 0);

    // 사용 중인 한도를 처음 보면 리셋을 기다린다.
    const first = evaluate(schedule, createState(), at(11, 0), { usage: makeUsage({ session: { percent: 80, resetsAt: resetsAt } }) });

    assert.deepEqual({ decision: first.decision, code: first.status.code, resetsAt: first.status.resetsAt }, { decision: "wait", code: "waiting-reset", resetsAt: resetsAt });
    assert.equal(first.state.seenResetsAt, resetsAt);

    // 리셋 시각이 지나면(아직 낡은 값이 읽혀도) 무장해 시작한다.
    const stale = makeUsage({ session: { percent: 80, resetsAt: resetsAt } });
    const fired = evaluate(schedule, first.state, at(14, 1), { usage: stale });

    assert.equal(fired.decision, "fire");
    assert.equal(fired.plan.endTime, "19:01");
    assert.equal(fired.state.armed, false);

    // 시작한 뒤에는 다음 리셋까지 다시 시작하지 않는다.
    const running = makeUsage({ session: { percent: 10, resetsAt: at(19, 0) } });
    const waiting = evaluate(schedule, fired.state, at(14, 2), { usage: running });

    assert.equal(waiting.decision, "wait");
    assert.equal(waiting.state.wasFresh, false);
    assert.equal(waiting.state.seenResetsAt, at(19, 0));
    assert.equal(evaluate(schedule, waiting.state, at(19, 1), { usage: running }).decision, "fire");

    // 한도 항목이 없거나 사용률이 0이면 새 한도로 보고 처음 본 순간 무장한다.
    assert.equal(evaluate(schedule, createState(), at(11, 0), { usage: makeUsage({ weekly: { percent: 5 } }) }).decision, "fire");
    assert.equal(evaluate(schedule, createState(), at(11, 0), { usage: makeUsage({ session: { percent: 0, resetsAt: at(16, 0) } }) }).decision, "fire");

    // 사용된 한도가 다시 새 한도로 읽히면 시각을 몰라도 리셋으로 본다.
    const used = evaluate(schedule, createState(), at(11, 0), { usage: makeUsage({ session: { percent: 60, resetsAt: at(15, 0) } }) });

    assert.equal(used.status.code, "waiting-reset");

    const refreshed = evaluate(schedule, used.state, at(11, 5), { usage: makeUsage({ session: { percent: 0 } }) });

    assert.equal(refreshed.decision, "fire");

    const weekly = makeResetSchedule({ window: "weekly" });
    const weeklyUsed = makeUsage({ session: { percent: 0 }, weekly: { percent: 50, resetsAt: at(9, 0, 3) } });

    assert.equal(evaluate(weekly, createState(), at(11, 0), { usage: weeklyUsed }).status.code, "waiting-reset");

    assert.equal(evaluate(schedule, createState(), at(11, 0), { usage: null }).status.code, "loading");
    assert.deepEqual({ code: evaluate(schedule, createState(), at(11, 0), { usage: { limits: [], error: { msg: "읽지 못했어요" }, fetchedAt: 0 } }).status.code }, { code: "no-usage" });
};

const checkResetConditions = () => {
    const schedule = makeResetSchedule({ from: "22:00", to: "07:00", duration: 720, minRemaining: 50 });
    const armed = { ...createState(), armed: true, wasFresh: true };
    const fresh = makeUsage({ session: { percent: 0 }, weekly: { percent: 10 } });

    const outside = evaluate(schedule, armed, at(15, 0), { usage: fresh });

    assert.deepEqual({ decision: outside.decision, code: outside.status.code, opensAt: outside.status.opensAt }, { decision: "wait", code: "outside-window", opensAt: at(22, 0) });
    assert.equal(outside.state.armed, true);

    // 시간대가 닫히는 시각을 넘겨 돌지 않게 종료 시각을 맞춘다.
    const inside = evaluate(schedule, armed, at(22, 30), { usage: fresh });

    assert.equal(inside.decision, "fire");
    assert.equal(inside.plan.endTime, "07:00");
    assert.equal(inside.plan.endAt, at(7, 0, 1));

    // 곧 닫히는 시간대에서는 너무 짧게 돌지 않는다. 무장은 유지한다.
    const late = evaluate(schedule, armed, at(6, 50, 1), { usage: fresh });

    assert.deepEqual({ decision: late.decision, code: late.status.code, armed: late.state.armed }, { decision: "wait", code: "too-short", armed: true });
    assert(at(7, 0, 1) - at(6, 50, 1) < MIN_RUN_MS);

    const lowLimit = evaluate(schedule, armed, at(22, 30), { usage: makeUsage({ session: { percent: 0 }, weekly: { percent: 80 } }) });

    assert.deepEqual({ code: lowLimit.status.code, remaining: lowLimit.status.remaining }, { code: "low-limit", remaining: 20 });
    assert.equal(evaluate(schedule, armed, at(22, 30), { usage: fresh, isBusy: true }).status.code, "busy");
};

const makeEnvironment = (overrides = {}) => {
    const dir = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), "ap-schedule-"));
    const env = {
        dir: dir,
        stateFile: path.join(dir, "state.json"),
        now: at(22, 0),
        schedules: [],
        usage: makeUsage({ session: { percent: 0 }, weekly: { percent: 0 } }),
        busy: false,
        starts: [],
        notices: [],
        payloads: [],
        refreshes: 0,
        startResult: { ok: true, message: "시작했어요" },
        ...overrides
    };

    env.create = () =>
        createScheduler({
            stateFile: env.stateFile,
            readSchedules: () => env.schedules,
            writeSchedules: (schedules) => {
                env.schedules = schedules;
            },
            getKnownIds: () => env.knownIds || env.schedules.map((schedule) => schedule.id),
            getUsage: () => env.usage,
            refreshUsage: async () => {
                env.refreshes++;
            },
            isBusy: async () => env.busy,
            startRun: async (schedule, plan) => {
                env.starts.push({ id: schedule.id, endTime: plan.endTime });

                return env.startResult;
            },
            notify: (title, body) => env.notices.push({ title: title, body: body }),
            onChange: (payload) => env.payloads.push(payload),
            now: () => env.now
        });

    return env;
};

const checkScheduler = async () => {
    const env = makeEnvironment();
    const scheduler = env.create();
    const first = await scheduler.save({ ...getDefaultSchedule("time"), time: "23:00", duration: 120 });

    assert(first.schedule.id.startsWith("sch-"));
    assert.equal(env.starts.length, 0);
    assert.equal(env.schedules.length, 1);

    const invalid = await scheduler.save({ kind: "time" });

    assert(invalid.error);
    assert.equal(env.schedules.length, 1);

    env.now = at(23, 1);
    await scheduler.tick();

    assert.deepEqual(env.starts, [{ id: first.schedule.id, endTime: "01:01" }]);
    assert.equal(env.notices[0].title, "AutoPilot 예약 시작");

    await scheduler.tick();

    assert.equal(env.starts.length, 1);
    assert.equal(scheduler.getPayload().statuses[0].last.ok, true);

    // 앱을 다시 켜도 같은 시작 시각에 두 번 시작하지 않는다.
    const restarted = env.create();

    restarted.loadStates();
    env.now = at(23, 2);
    await restarted.tick();

    assert.equal(env.starts.length, 1);

    await scheduler.setEnabled(first.schedule.id, false);

    assert.equal(scheduler.getPayload().statuses[0].code, "disabled");

    await scheduler.setEnabled(first.schedule.id, true);
    await scheduler.remove(first.schedule.id);

    assert.deepEqual(env.schedules, []);
    assert.deepEqual(JSON.parse(fs.readFileSync(env.stateFile, "utf8")), {});

    fs.rmSync(env.dir, { recursive: true, force: true });
};

const checkSchedulerFailureAndBusy = async () => {
    const env = makeEnvironment({ now: at(23, 1), busy: true, startResult: { ok: false, message: "로그인이 필요해요" } });
    const scheduler = env.create();

    await scheduler.save({ ...getDefaultSchedule("time"), time: "23:00" });

    assert.equal(env.starts.length, 0);
    assert.equal(scheduler.getPayload().statuses[0].code, "busy");

    env.busy = false;
    env.now = at(23, 10);
    await scheduler.tick();

    assert.equal(env.starts.length, 1);
    assert.deepEqual({ code: scheduler.getPayload().statuses[0].code, message: scheduler.getPayload().statuses[0].last.message }, { code: "failed", message: "로그인이 필요해요" });
    assert.equal(env.notices[0].title, "AutoPilot 예약을 시작하지 못했어요");

    // 실패해도 같은 시작 시각을 다시 시도하지 않는다.
    env.now = at(23, 20);
    await scheduler.tick();

    assert.equal(env.starts.length, 1);

    fs.rmSync(env.dir, { recursive: true, force: true });
};

const checkSchedulerLimits = async () => {
    const env = makeEnvironment({ usage: makeUsage({ fetchedAt: 0 }) });
    const scheduler = env.create();

    for (let index = 0; index < MAX_SCHEDULES; index++) {
        assert((await scheduler.save({ ...getDefaultSchedule("time"), time: "10:00" })).schedule);
    }

    assert.match((await scheduler.save({ ...getDefaultSchedule("time") })).error, /8개/);

    env.schedules = [];

    // 한도 리셋을 기다리는 예약은 읽은 적이 없으면 사용량을 다시 읽는다.
    await scheduler.save({ ...getDefaultSchedule("reset"), from: "", to: "" });

    assert(env.refreshes > 0);

    // 수정해서 시작 조건이 바뀌면 이전 판단 상태를 버린다.
    const saved = env.schedules[0];

    env.usage = makeUsage({ session: { percent: 60, resetsAt: at(23, 0) }, weekly: { percent: 0 } });
    await scheduler.tick();

    assert.equal(scheduler.getPayload().statuses[0].code, "waiting-reset");

    await scheduler.save({ ...saved, kind: "time", time: "23:00", from: "", to: "", window: "session" });

    assert.equal(scheduler.getPayload().statuses[0].code, "next-time");

    fs.rmSync(env.dir, { recursive: true, force: true });
};

// 프로젝트 예약은 범위를 달고 저장되고 수정해도 바뀌지 않으며, 목록에서 빠진 예약의 판단 상태도 알려진 id면 남는다.
const checkSchedulerScope = async () => {
    const env = makeEnvironment({ now: at(23, 1) });
    const scheduler = env.create();
    const project = await scheduler.save({ ...getDefaultSchedule("time"), time: "23:00", scope: "project" });

    assert.equal(project.schedule.scope, "project");
    assert.equal(env.schedules[0].scope, "project");

    const global = await scheduler.save({ ...getDefaultSchedule("time"), time: "23:30", scope: "global" });

    assert.equal(global.schedule.scope, undefined, "전역 예약은 범위 표시 없이 저장된다");

    await scheduler.save({ ...env.schedules[0], time: "23:10", scope: "global" });

    assert.equal(env.schedules[0].scope, "project", "수정으로 범위를 바꾸지 않는다");
    assert.equal(env.schedules[0].time, "23:10");

    const states = () => JSON.parse(fs.readFileSync(env.stateFile, "utf8"));
    const id = env.schedules[0].id;

    assert(states()[id]);

    env.schedules = [];
    env.knownIds = [id];
    await scheduler.tick();

    assert(states()[id], "다른 프로젝트를 골라 목록에서 빠져도 알려진 예약의 판단 상태는 남는다");

    fs.rmSync(env.dir, { recursive: true, force: true });
};

checkParse();
checkNormalize();
checkOccurrences();
checkTimeSchedule();
checkRemaining();
checkWindowState();
checkResetSchedule();
checkResetConditions();
await checkScheduler();
await checkSchedulerFailureAndBusy();
await checkSchedulerLimits();
await checkSchedulerScope();

console.log("Desktop schedule checks passed.");

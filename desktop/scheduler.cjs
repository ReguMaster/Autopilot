const crypto = require("node:crypto");
const fs = require("node:fs");
const { MAX_SCHEDULES, getDefaultSchedule, parseSchedule, createState, evaluateSchedule } = require("./scheduleRules.cjs");

const TICK_MS = 30 * 1000;
const FIRST_TICK_DELAY_MS = 3000;

const createId = () => {
    return `sch-${crypto.randomBytes(4).toString("hex")}`;
};

// 예약을 주기적으로 살펴 조건이 맞으면 실행을 시작한다. 설정 저장·사용량 조회·실행 시작·알림은 호출한 쪽이 넘겨 준 함수를 쓴다.
// 예약마다의 진행 상태(마지막으로 시작한 때, 기억해 둔 한도 리셋 시각 등)는 stateFile에 보관해 앱을 다시 켜도 이어간다.
// 예약마다 대상 프로젝트가 다를 수 있어 getUsage·refreshUsage·isBusy는 예약을 받고, getTargetKey는 같은 프로젝트를 같은 값으로 알려 준다(한 번 시작한 프로젝트는 같은 판단 안에서 바쁘다고 본다).
const createScheduler = ({ stateFile, readSchedules, writeSchedules, getKnownIds, getUsage, refreshUsage, isBusy, startRun, notify, onChange, getTargetKey = () => "", now = Date.now }) => {
    let states = {};
    let statuses = [];
    let isTicking = false;
    let isTickQueued = false;
    let timer = null;
    let lastPayloadKey = "";

    const loadStates = () => {
        try {
            const saved = JSON.parse(fs.readFileSync(stateFile, "utf8"));

            states = saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
        } catch {
            states = {};
        }
    };

    const saveStates = () => {
        try {
            fs.writeFileSync(stateFile, JSON.stringify(states), "utf8");
        } catch {}
    };

    const getPayload = () => {
        return { schedules: readSchedules(), statuses: statuses, maxSchedules: MAX_SCHEDULES, defaults: { time: getDefaultSchedule("time"), reset: getDefaultSchedule("reset") } };
    };

    const emitIfChanged = () => {
        const payload = getPayload();
        const key = JSON.stringify(payload);

        if (key !== lastPayloadKey) {
            lastPayloadKey = key;
            onChange(payload);
        }
    };

    // 한도 리셋을 기다리는 예약은 리셋 시각이 지난 직후 새 값을 읽어야 남은 한도 조건을 바로 판단할 수 있다.
    const refreshIfNeeded = async (schedules) => {
        const refreshed = new Set();

        for (const schedule of schedules.filter((entry) => entry.enabled && entry.kind === "reset")) {
            const usage = getUsage(schedule);
            const seen = states[schedule.id]?.seenResetsAt || 0;
            const isStale = !usage.fetchedAt || (seen > 0 && now() >= seen && usage.fetchedAt < seen);
            const key = getTargetKey(schedule);

            if (isStale && !refreshed.has(key)) {
                refreshed.add(key);
                await refreshUsage(schedule);
            }
        }
    };

    const fireSchedule = async (schedule, result) => {
        const outcome = await startRun(schedule, result.plan);
        const last = { at: now(), ok: outcome.ok, message: outcome.message };

        states[schedule.id] = { ...result.state, last: last };

        notify(outcome.ok ? "AutoPilot 예약 시작" : "AutoPilot 예약을 시작하지 못했어요", outcome.message);

        return { code: outcome.ok ? "started" : "failed", last: last };
    };

    const run = async () => {
        const schedules = readSchedules();

        const knownIds = new Set(getKnownIds ? getKnownIds() : schedules.map((schedule) => schedule.id));

        for (const id of Object.keys(states)) {
            if (!knownIds.has(id)) {
                delete states[id];
            }
        }

        await refreshIfNeeded(schedules);

        const before = JSON.stringify(states);
        const startedKeys = new Set();
        const next = [];

        for (const schedule of schedules) {
            const busy = startedKeys.has(getTargetKey(schedule)) || (await isBusy(schedule));
            const result = evaluateSchedule(schedule, states[schedule.id] || createState(), { now: now(), usage: getUsage(schedule), isBusy: busy });
            let status = result.status;

            states[schedule.id] = result.state;

            if (result.decision === "fire") {
                status = await fireSchedule(schedule, result);
                startedKeys.add(getTargetKey(schedule));
            }

            next.push({ id: schedule.id, ...status });
        }

        statuses = next;

        if (JSON.stringify(states) !== before) {
            saveStates();
        }

        emitIfChanged();
    };

    // 겹쳐 부르면 진행 중인 판단이 끝난 뒤 한 번만 더 돈다(저장 직후 화면이 바로 새 상태를 보도록).
    const tick = async () => {
        if (isTicking) {
            isTickQueued = true;

            return;
        }

        isTicking = true;

        try {
            await run();
        } catch {
        } finally {
            isTicking = false;

            if (isTickQueued) {
                isTickQueued = false;
                tick();
            }
        }
    };

    // 저장한 예약은 이전 판단 상태를 이어받되, 시작 조건이 바뀌었으면 처음부터 다시 판단한다.
    const save = async (draft) => {
        const { schedule, error } = parseSchedule(draft);

        if (error) {
            return { error: error };
        }

        const schedules = readSchedules();
        const index = schedules.findIndex((entry) => entry.id === schedule.id);

        if (index < 0 && schedules.length >= MAX_SCHEDULES) {
            return { error: `예약은 ${MAX_SCHEDULES}개까지 만들 수 있어요.` };
        }

        if (index >= 0 && (schedules[index].kind !== schedule.kind || schedules[index].window !== schedule.window)) {
            delete states[schedule.id];
        }

        const scope = index >= 0 ? schedules[index].scope : draft?.scope;
        const projectDir = index >= 0 ? schedules[index].projectDir : draft?.projectDir;
        const saved = { ...schedule, id: index >= 0 ? schedule.id : createId(), ...(scope === "project" && { scope: scope, projectDir: projectDir }) };

        writeSchedules(index >= 0 ? schedules.map((entry, position) => (position === index ? saved : entry)) : [...schedules, saved]);
        await tick();

        return { schedule: saved };
    };

    const remove = async (id) => {
        writeSchedules(readSchedules().filter((schedule) => schedule.id !== id));
        delete states[id];
        saveStates();
        await tick();
    };

    const setEnabled = async (id, enabled) => {
        writeSchedules(readSchedules().map((schedule) => (schedule.id === id ? { ...schedule, enabled: enabled === true } : schedule)));
        await tick();
    };

    const start = () => {
        loadStates();
        setTimeout(tick, FIRST_TICK_DELAY_MS).unref();

        timer = setInterval(tick, TICK_MS);
        timer.unref();
    };

    const stop = () => {
        clearInterval(timer);
    };

    return { start: start, stop: stop, tick: tick, save: save, remove: remove, setEnabled: setEnabled, getPayload: getPayload, loadStates: loadStates };
};

module.exports = { createScheduler, TICK_MS };

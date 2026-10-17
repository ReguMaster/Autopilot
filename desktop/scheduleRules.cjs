const MAX_SCHEDULES = 8;
const KINDS = ["time", "reset"];
const WINDOWS = ["session", "weekly"];
const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const ID_PATTERN = /^sch-[0-9a-f]{8}$/;
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;
// 정해진 시각을 지난 뒤에도 이 시간 안에는 놓친 예약을 이어서 시작한다(앱이 늦게 켜졌거나 PC가 잠들었다 깬 경우).
const TIME_GRACE_MS = 2 * 60 * MINUTE_MS;
// 허용 시간대가 곧 닫혀 이보다 짧게 돌아야 하면 시작하지 않는다. 엔진의 최소 남은 시간(20분)보다 넉넉히 둔다.
const MIN_RUN_MS = 30 * MINUTE_MS;
const MIN_DURATION = MIN_RUN_MS / MINUTE_MS;
// 종료 시각은 HH:mm만 엔진에 넘기므로 하루 안(23시간 59분)까지만 받는다.
const MAX_DURATION = 24 * 60 - 1;
const SESSION_LABEL = "5시간 한도";
const WEEKLY_LABEL = "주간 한도";
const WINDOW_LABELS = { session: SESSION_LABEL, weekly: WEEKLY_LABEL };
// 리셋 직후의 한도는 사용률 0%에 가깝다. 응답에 항목이 없거나 리셋 시각이 지난 항목도 새 한도로 본다.
const FRESH_PERCENT = 1;

const toMinutes = (time) => {
    const [hour, minute] = time.split(":").map(Number);

    return hour * 60 + minute;
};

const isTime = (value) => {
    return typeof value === "string" && TIME_PATTERN.test(value);
};

const isIntegerBetween = (value, min, max) => {
    return Number.isInteger(value) && value >= min && value <= max;
};

const getDefaultSchedule = (kind = "time") => {
    const isReset = kind === "reset";

    return {
        id: "",
        enabled: true,
        kind: kind,
        time: "23:00",
        window: "session",
        from: isReset ? "22:00" : "",
        to: isReset ? "07:00" : "",
        days: [...WEEKDAYS],
        minRemaining: isReset ? 50 : 0,
        duration: isReset ? 300 : 360
    };
};

// 값이 허용 범위를 벗어나면 오류 문구를, 올바르면 정리한 예약을 돌려준다. id는 저장하는 쪽이 정한다.
const parseSchedule = (raw) => {
    const value = raw && typeof raw === "object" ? raw : {};
    const days = Array.isArray(value.days) ? [...new Set(value.days)].filter((day) => WEEKDAYS.includes(day)).sort() : [];
    const isRanged = Boolean(value.from) || Boolean(value.to);

    if (!KINDS.includes(value.kind)) {
        return { error: "시작 조건을 골라 주세요." };
    }

    if (days.length === 0) {
        return { error: "요일을 하나 이상 골라 주세요." };
    }

    if (value.kind === "time" && !isTime(value.time)) {
        return { error: "시작 시각이 올바르지 않아요." };
    }

    if (value.kind === "reset" && !WINDOWS.includes(value.window)) {
        return { error: "기준이 될 한도를 골라 주세요." };
    }

    if (value.kind === "reset" && isRanged && (!isTime(value.from) || !isTime(value.to) || value.from === value.to)) {
        return { error: "허용 시간대의 시작과 끝이 올바르지 않아요." };
    }

    if (!isIntegerBetween(value.duration, MIN_DURATION, MAX_DURATION)) {
        return { error: "실행 시간은 30분부터 23시간 59분까지 정할 수 있어요." };
    }

    if (!isIntegerBetween(value.minRemaining, 0, 100)) {
        return { error: "남은 한도 조건은 0부터 100 사이의 정수(%)로 정해 주세요." };
    }

    const isTimeKind = value.kind === "time";

    return {
        schedule: {
            id: typeof value.id === "string" && ID_PATTERN.test(value.id) ? value.id : "",
            enabled: value.enabled !== false,
            kind: value.kind,
            time: isTimeKind ? value.time : "",
            window: isTimeKind ? "session" : value.window,
            from: isTimeKind || !isRanged ? "" : value.from,
            to: isTimeKind || !isRanged ? "" : value.to,
            days: days,
            minRemaining: value.minRemaining,
            duration: value.duration
        }
    };
};

// 저장된 목록에서 올바르지 않거나 id가 겹치는 항목은 버린다.
const normalizeSchedules = (list) => {
    const seen = new Set();
    const schedules = [];

    for (const raw of Array.isArray(list) ? list : []) {
        const { schedule } = parseSchedule(raw);

        if (schedule?.id && !seen.has(schedule.id) && schedules.length < MAX_SCHEDULES) {
            seen.add(schedule.id);
            schedules.push(schedule);
        }
    }

    return schedules;
};

const atTime = (baseMs, offsetDays, minutes) => {
    const date = new Date(baseMs);

    date.setDate(date.getDate() + offsetDays);
    date.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);

    return date.getTime();
};

const isDayAllowed = (schedule, ms) => {
    return schedule.days.includes(new Date(ms).getDay());
};

// 지금까지 가장 최근에 돌아온 시작 시각. 어제 것까지만 본다(유예가 자정을 넘길 수 있다).
const getLatestOccurrence = (schedule, now) => {
    for (const offset of [0, -1]) {
        const at = atTime(now, offset, toMinutes(schedule.time));

        if (at <= now && isDayAllowed(schedule, at)) {
            return at;
        }
    }

    return null;
};

const getNextOccurrence = (schedule, now) => {
    for (let offset = 0; offset <= 7; offset++) {
        const at = atTime(now, offset, toMinutes(schedule.time));

        if (at > now && isDayAllowed(schedule, at)) {
            return at;
        }
    }

    return null;
};

// 허용 시간대 안인지와, 열려 있으면 닫히는 시각, 닫혀 있으면 다음에 열리는 시각. 요일은 시간대가 시작하는 날 기준이다.
const getWindowState = (schedule, now) => {
    if (!schedule.from) {
        const opensAt = isDayAllowed(schedule, now) ? now : getNextDayStart(schedule, now);

        return { isOpen: isDayAllowed(schedule, now), closesAt: null, opensAt: opensAt };
    }

    const fromMinutes = toMinutes(schedule.from);
    const length = (toMinutes(schedule.to) - fromMinutes + 24 * 60) % (24 * 60);

    for (const offset of [-1, 0]) {
        const start = atTime(now, offset, fromMinutes);

        if (start <= now && now < start + length * MINUTE_MS && isDayAllowed(schedule, start)) {
            return { isOpen: true, closesAt: start + length * MINUTE_MS, opensAt: start };
        }
    }

    for (let offset = 0; offset <= 7; offset++) {
        const start = atTime(now, offset, fromMinutes);

        if (start > now && isDayAllowed(schedule, start)) {
            return { isOpen: false, closesAt: null, opensAt: start };
        }
    }

    return { isOpen: false, closesAt: null, opensAt: null };
};

const getNextDayStart = (schedule, now) => {
    for (let offset = 1; offset <= 7; offset++) {
        const start = atTime(now, offset, 0);

        if (isDayAllowed(schedule, start)) {
            return start;
        }
    }

    return null;
};

const findLimit = (usage, window) => {
    return usage?.limits?.find((limit) => limit.label === WINDOW_LABELS[window]) || null;
};

const hasUsage = (usage) => {
    return Boolean(usage?.limits?.length);
};

// 5시간·주간 한도 중 가장 적게 남은 값(%). 모델별 한도는 보지 않는다. 읽지 못했으면 null이라 조건을 검사하지 않는다.
const getRemaining = (usage) => {
    const percents = Object.keys(WINDOW_LABELS)
        .map((window) => findLimit(usage, window))
        .filter(Boolean)
        .map((limit) => 100 - limit.percent);

    return percents.length ? Math.min(...percents) : null;
};

const isFresh = (limit, now) => {
    return !limit || !(limit.resetsAt > now) || limit.percent < FRESH_PERCENT;
};

const createState = () => {
    return { lastFiredKey: "", lastFiredAt: 0, seenResetsAt: 0, wasFresh: null, armed: false, last: null };
};

// 한도 리셋을 알아채는 두 길: 기억해 둔 리셋 시각이 지났거나, 사용된 한도가 다시 새 한도로 읽힐 때. 시작하면 무장을 풀어 다음 리셋까지 기다린다.
const trackReset = (schedule, state, usage, now) => {
    const next = { ...state };

    if (next.seenResetsAt > 0 && now >= next.seenResetsAt) {
        next.armed = true;
        next.seenResetsAt = 0;
    }

    if (hasUsage(usage)) {
        const limit = findLimit(usage, schedule.window);
        const fresh = isFresh(limit, now);

        if (limit?.resetsAt > now) {
            next.seenResetsAt = limit.resetsAt;
        }

        if (next.wasFresh === null ? fresh : !next.wasFresh && fresh) {
            next.armed = true;
        }

        next.wasFresh = fresh;
    }

    return next;
};

const formatEndTime = (ms) => {
    const date = new Date(ms);

    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};

const wait = (state, status) => {
    return { decision: "wait", state: state, status: { ...status, last: state.last } };
};

// 시작해도 되는지 보는 공통 조건. 막히면 이유를 돌려준다.
const getBlock = (schedule, usage, now, isBusy) => {
    if (isBusy) {
        return { code: "busy" };
    }

    const remaining = getRemaining(usage);

    if (schedule.minRemaining > 0 && remaining !== null && remaining < schedule.minRemaining) {
        return { code: "low-limit", remaining: Math.round(remaining), need: schedule.minRemaining };
    }

    return null;
};

const fire = (schedule, state, now, key, closesAt) => {
    const endAt = Math.min(now + schedule.duration * MINUTE_MS, closesAt || Infinity);

    if (endAt - now < MIN_RUN_MS) {
        return wait(state, { code: "too-short" });
    }

    return {
        decision: "fire",
        state: { ...state, lastFiredKey: key, lastFiredAt: now, armed: false },
        status: { code: "starting", last: state.last },
        plan: { endTime: formatEndTime(endAt), endAt: endAt }
    };
};

const evaluateTime = (schedule, state, context) => {
    const { now, usage, isBusy } = context;
    const latest = getLatestOccurrence(schedule, now);
    const key = `t:${latest}`;
    const isPending = latest !== null && key !== state.lastFiredKey && now - latest <= TIME_GRACE_MS;

    if (!isPending) {
        return wait(state, { code: "next-time", at: getNextOccurrence(schedule, now) });
    }

    const block = getBlock(schedule, usage, now, isBusy);

    return block ? wait(state, block) : fire(schedule, state, now, key, null);
};

const evaluateReset = (schedule, state, context) => {
    const { now, usage, isBusy } = context;
    const tracked = trackReset(schedule, state, usage, now);

    if (!hasUsage(usage)) {
        return wait(tracked, usage?.error ? { code: "no-usage", message: usage.error.msg } : { code: "loading" });
    }

    if (!tracked.armed) {
        return wait(tracked, { code: "waiting-reset", resetsAt: tracked.seenResetsAt || 0 });
    }

    const windowState = getWindowState(schedule, now);

    if (!windowState.isOpen) {
        return wait(tracked, { code: "outside-window", opensAt: windowState.opensAt });
    }

    const block = getBlock(schedule, usage, now, isBusy);

    return block ? wait(tracked, block) : fire(schedule, tracked, now, `r:${now}`, windowState.closesAt);
};

// 예약 하나를 지금 시각 기준으로 판단한다. 시작해야 하면 decision이 fire이고 plan에 종료 시각을 담는다. 상태(state)는 호출한 쪽이 저장한다.
const evaluateSchedule = (schedule, state, context) => {
    if (!schedule.enabled) {
        return wait(state, { code: "disabled" });
    }

    return schedule.kind === "time" ? evaluateTime(schedule, state, context) : evaluateReset(schedule, state, context);
};

module.exports = {
    MAX_SCHEDULES,
    KINDS,
    WINDOWS,
    WINDOW_LABELS,
    TIME_GRACE_MS,
    MIN_RUN_MS,
    MIN_DURATION,
    MAX_DURATION,
    DAY_MS,
    getDefaultSchedule,
    parseSchedule,
    normalizeSchedules,
    getLatestOccurrence,
    getNextOccurrence,
    getWindowState,
    getRemaining,
    createState,
    trackReset,
    evaluateSchedule
};

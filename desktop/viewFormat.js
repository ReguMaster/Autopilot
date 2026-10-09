// 화면 표시용 순수 함수. renderer.js보다 먼저 불러오며 DOM·window에 의존하지 않는다(tests/checkDesktopView.js가 단독으로 불러 검증한다).
const MODEL_LABELS = { fable: "Fable", opus: "Opus", sonnet: "Sonnet", haiku: "Haiku" };

const padNumber = (number) => {
    return String(number).padStart(2, "0");
};

const formatDuration = (ms) => {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));

    return `${padNumber(Math.floor(totalSeconds / 3600))}:${padNumber(Math.floor((totalSeconds % 3600) / 60))}:${padNumber(totalSeconds % 60)}`;
};

const formatClock = (ms) => {
    const date = new Date(ms);

    return `${padNumber(date.getHours())}:${padNumber(date.getMinutes())}`;
};

const formatDeadline = (ms) => {
    const date = new Date(ms);

    return `${date.getMonth() + 1}월 ${date.getDate()}일 ${formatClock(ms)}`;
};

// 종료 시각(HH:mm, 비우면 엔진 기본값). 엔진처럼 날짜는 없고 이미 지난 시각이면 다음 날로 본다.
const DEFAULT_END_TIME = "07:00";
const MINUTES_PER_DAY = 1440;
const PRESET_ROUND_MINUTES = 5;

const parseTimeMinutes = (value) => {
    const [hours, minutes] = (value || DEFAULT_END_TIME).split(":").map(Number);

    return hours * 60 + minutes;
};

const formatTimeMinutes = (totalMinutes) => {
    const minutes = ((totalMinutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;

    return `${padNumber(Math.floor(minutes / 60))}:${padNumber(minutes % 60)}`;
};

const shiftEndTime = (value, minutes) => {
    return formatTimeMinutes(parseTimeMinutes(value) + minutes);
};

// 지금부터 minutes 뒤를 5분 단위로 올려 잡는다.
const getEndTimeAfter = (nowMs, minutes) => {
    const date = new Date(nowMs);
    const target = date.getHours() * 60 + date.getMinutes() + (date.getSeconds() > 0 ? 1 : 0) + minutes;

    return formatTimeMinutes(Math.ceil(target / PRESET_ROUND_MINUTES) * PRESET_ROUND_MINUTES);
};

const formatTimeUntil = (value, nowMs) => {
    const date = new Date(nowMs);
    const nowMinutes = date.getHours() * 60 + date.getMinutes();
    const diff = (((parseTimeMinutes(value) - nowMinutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY || MINUTES_PER_DAY;
    const hours = Math.floor(diff / 60);
    const minutes = diff % 60;

    if (!hours) {
        return `${minutes}분 뒤`;
    }

    return minutes ? `${hours}시간 ${minutes}분 뒤` : `${hours}시간 뒤`;
};

const EFFORT_LABELS = { low: "Low", medium: "Medium", high: "High", xhigh: "XHigh", max: "Max" };

const formatEffort = (effort) => {
    return EFFORT_LABELS[effort] || effort;
};

const formatOptions = (model, effort) => {
    return model ? `${MODEL_LABELS[model] || model} · ${formatEffort(effort)}` : "-";
};

const getLineKind = ({ stream, text }) => {
    if (stream === "err" || text.startsWith("[stderr]")) {
        return "err";
    }

    if (stream === "app") {
        return "app";
    }

    if (/^\[\d+회차\]|^AutoPilot 종료/.test(text)) {
        return "round";
    }

    if (text.includes("[사용량 한도]")) {
        return "warn";
    }

    if (text.includes("[결과]")) {
        return "ok";
    }

    if (/^\d{2}:\d{2}:\d{2} {3}> /.test(text)) {
        return "tool";
    }

    return "";
};

// 앱이 시작하지 않고 연결한 엔진은 종료 코드를 알 수 없어(exitCode가 null) 종료 사유로만 판단한다.
const getRunPhase = (state) => {
    if (state.status === "running") {
        return { label: state.attached ? "실행 중 · 연결됨" : "실행 중", tone: "run" };
    }

    if (state.status === "stopping") {
        return { label: "종료 요청됨", tone: "warn" };
    }

    if (!state.endedAt) {
        return { label: "대기 중", tone: "muted" };
    }

    if (state.exitCode === 0) {
        return { label: "정상 종료", tone: "ok" };
    }

    if (state.reason === "중단 요청" || state.reason === "강제 종료" || state.exitCode === 130) {
        return { label: "중단됨", tone: "warn" };
    }

    if (state.exitCode === null) {
        return { label: "종료됨", tone: "muted" };
    }

    return { label: "오류 종료", tone: "danger" };
};

// 연결하면서 이미 쓰인 로그를 읽은 회차는 시각을 알 수 없다.
const formatRoundTime = (round) => {
    if (!round.timesKnown) {
        return "시각을 알 수 없어요";
    }

    const startedText = `${formatClock(round.startedAt)} 시작`;

    return round.endedAt ? `${startedText}, ${((round.endedAt - round.startedAt) / 60000).toFixed(1)}분` : startedText;
};

const getRoundTone = (outcome) => {
    if (!outcome) {
        return "run";
    }

    if (outcome === "완료") {
        return "ok";
    }

    if (outcome.startsWith("실패") || outcome === "시한 초과") {
        return "danger";
    }

    if (outcome === "commit 없음") {
        return "muted";
    }

    return "warn";
};

const { readJsonFile, writeJsonFile } = require("./jsonFile.cjs");
const { listRunDays } = require("./runHistory.cjs");

const STREAK_VERSION = 1;
// 로그는 보관 기간이 지나면 지워지므로 날짜만 따로 남겨 긴 연속 기록을 잃지 않는다. 약 3년치까지 둔다.
const MAX_DAYS = 1000;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const sanitizeDays = (days) => {
    return [...new Set((Array.isArray(days) ? days : []).filter((day) => typeof day === "string" && DAY_PATTERN.test(day)))].sort();
};

// 프로젝트마다 "실행한 날" 목록을 userData의 파일 하나에 보관한다. 읽는 쪽(화면)이 오늘 날짜로 연속 일수를 센다.
// 이미 적은 날은 다시 읽지 않아 첫 한 번만 지난 로그를 훑는다.
const createStreakStore = ({ file, getKey }) => {
    let queue = Promise.resolve();

    const read = () => {
        const { state, data } = readJsonFile(file);

        return state === "ok" && data.version === STREAK_VERSION && data.projects && typeof data.projects === "object" ? data : { version: STREAK_VERSION, projects: {} };
    };

    const run = async (projectDir) => {
        const key = getKey(projectDir);
        const data = read();
        const known = sanitizeDays(data.projects[key]?.days);
        const found = await listRunDays(projectDir, { skipDays: new Set(known) });

        if (!found.length) {
            return known;
        }

        const days = sanitizeDays([...known, ...found]).slice(-MAX_DAYS);

        writeJsonFile(file, { ...data, projects: { ...data.projects, [key]: { days: days } } });

        return days;
    };

    // 화면의 여러 요청이 겹쳐도 저장이 서로 덮어쓰지 않게 하나씩 처리한다.
    const refresh = (projectDir) => {
        const result = queue.then(() => run(projectDir));

        queue = result.catch(() => {});

        return result;
    };

    return { refresh: refresh };
};

module.exports = { createStreakStore, sanitizeDays, MAX_DAYS };

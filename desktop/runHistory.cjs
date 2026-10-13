const fs = require("node:fs");
const path = require("node:path");
const { createInitialState, parseLine } = require("./autopilotRunner.cjs");
const { getProgressDir, isProjectLogFile, isProjectReportFile, LOG_FILE_PATTERN } = require("./projectFiles.cjs");

const DAY_DIR_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const RUN_ID_PATTERN = /^(\d{4}-\d{2}-\d{2})\/(autopilot_[\w-]+\.log)$/i;
const LOG_TIME_PATTERN = /^autopilot_(\d{2})(\d{2})(\d{2})_/i;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const MAX_READ_BYTES = 16 * 1024 * 1024;
const MAX_LINE_LENGTH = 2000;
const MAX_DETAIL_LINES = 20000;
const MAX_RUN_COUNT = 200;
const MAX_GAIN_COUNT = 5;
const MAX_RUN_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

const summaryCache = new Map();

const normalizePath = (file) => {
    const normalized = path.normalize(file);

    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
};

// 로그가 어떻게 깨져 있어도 줄 단위로 읽을 수 있게 한다. 잘못된 UTF-8은 대체 문자가 되고, 제어 문자와 너무 긴 줄은 정리한다.
const splitLines = (text, isPartial) => {
    const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);

    // 끝에서부터 읽었으면 첫 줄은 중간에서 잘렸다.
    if (isPartial) {
        lines.shift();
    }

    if (lines.at(-1) === "") {
        lines.pop();
    }

    return lines.map((line) => line.replace(CONTROL_CHARACTER_PATTERN, "").slice(0, MAX_LINE_LENGTH));
};

// 큰 로그는 끝부분만 읽는다. 종료 줄과 최근 회차가 거기에 있다.
const readLogLines = async (file, size) => {
    const length = Math.min(size, MAX_READ_BYTES);
    const handle = await fs.promises.open(file, "r");

    try {
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await handle.read(buffer, 0, length, size - length);
        const isPartial = size > length;

        return { lines: splitLines(buffer.subarray(0, bytesRead).toString("utf8"), isPartial), isPartial: isPartial };
    } finally {
        await handle.close();
    }
};

// 시작 시각은 폴더 날짜와 파일 이름의 HHmmss로 정한다. 이름이 어긋나면 파일 생성 시각으로 대신한다.
const getStartedAt = (day, name, stat) => {
    const time = name.match(LOG_TIME_PATTERN);
    const startedAt = time ? new Date(`${day}T${time[1]}:${time[2]}:${time[3]}`).getTime() : NaN;

    if (Number.isFinite(startedAt)) {
        return startedAt;
    }

    const fileTime = stat.birthtimeMs > 0 ? stat.birthtimeMs : stat.mtimeMs;

    return fileTime > 0 ? fileTime : new Date(`${day}T00:00:00`).getTime() || 0;
};

const getReportFile = (logFile) => {
    return path.join(
        path.dirname(logFile),
        path
            .basename(logFile)
            .replace(/^autopilot_/i, "report_")
            .replace(/\.log$/i, ".html")
    );
};

const summarizeLines = (lines) => {
    const state = createInitialState();

    for (const line of lines) {
        try {
            parseLine(state, line, true);
        } catch {}
    }

    const commits = state.rounds.flatMap((round) => round.commits);
    const gains = state.gains.slice(-MAX_GAIN_COUNT);

    return {
        policy: state.policy.replace(/ \(.+\)$/, ""),
        deadlineAt: state.deadlineAt,
        reason: state.reason,
        roundCount: state.rounds.length,
        commitCount: commits.length,
        insertions: commits.reduce((sum, commit) => sum + commit.insertions, 0),
        deletions: commits.reduce((sum, commit) => sum + commit.deletions, 0),
        toolCalls: state.work.toolCalls,
        filesEdited: state.work.filesEdited,
        gains: gains,
        headline: gains.at(-1)?.text || commits[0]?.subject || "",
        isEmpty: !state.project && !state.rounds.length && !state.reason && !state.work.toolCalls && !state.gains.length
    };
};

const buildSummary = (projectDir, { day, name, logFile }, stat, { lines, isPartial }) => {
    const startedAt = getStartedAt(day, name, stat);
    const endedAt = stat.mtimeMs;

    return {
        ...summarizeLines(lines),
        id: `${day}/${name}`,
        startedAt: startedAt,
        endedAt: endedAt > startedAt && endedAt - startedAt < MAX_RUN_DURATION_MS ? endedAt : 0,
        hasReport: isProjectReportFile(projectDir, getReportFile(logFile)),
        isPartial: isPartial,
        isUnreadable: false,
        isActive: false
    };
};

const summarizeFile = async (projectDir, files) => {
    try {
        const stat = await fs.promises.stat(files.logFile);
        const cached = summaryCache.get(files.logFile);

        if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) {
            return cached.summary;
        }

        if (!isProjectLogFile(projectDir, files.logFile)) {
            throw new Error("프로젝트 밖을 가리키는 로그예요.");
        }

        const summary = buildSummary(projectDir, files, stat, await readLogLines(files.logFile, stat.size));

        summaryCache.set(files.logFile, { size: stat.size, mtimeMs: stat.mtimeMs, summary: summary });

        return summary;
    } catch {
        return { id: `${files.day}/${files.name}`, startedAt: getStartedAt(files.day, files.name, { birthtimeMs: 0, mtimeMs: 0 }), endedAt: 0, isUnreadable: true, isActive: false };
    }
};

const isActiveLog = (logFile, activeLogFile) => {
    return Boolean(activeLogFile) && normalizePath(logFile) === normalizePath(activeLogFile);
};

// 최근 실행부터 limit개의 요약을 돌려준다. 읽지 못하는 로그도 목록에서 빠지지 않고 읽을 수 없음으로 표시한다.
// activeLogFile은 지금 실행 중인 엔진의 로그라 끝맺음이 없어도 비정상으로 보지 않는다.
const listRuns = async (projectDir, { limit = MAX_RUN_COUNT, activeLogFile = "" } = {}) => {
    const progressDir = getProgressDir(projectDir);
    const maxCount = Math.min(MAX_RUN_COUNT, Math.max(1, Math.floor(limit) || 1));
    const runs = [];
    let days = [];

    try {
        days = (await fs.promises.readdir(progressDir, { withFileTypes: true })).filter((entry) => entry.isDirectory() && DAY_DIR_PATTERN.test(entry.name)).map((entry) => entry.name);
    } catch {
        return runs;
    }

    for (const day of days.sort().reverse()) {
        let names = [];

        try {
            names = (await fs.promises.readdir(path.join(progressDir, day), { withFileTypes: true })).filter((entry) => entry.isFile() && LOG_FILE_PATTERN.test(entry.name)).map((entry) => entry.name);
        } catch {
            continue;
        }

        for (const name of names.sort().reverse()) {
            const files = getRunFiles(projectDir, `${day}/${name}`);
            const run = await summarizeFile(projectDir, files);

            runs.push({ ...run, isActive: isActiveLog(files.logFile, activeLogFile) });

            if (runs.length >= maxCount) {
                return runs;
            }
        }
    }

    return runs;
};

// 렌더러가 보낸 id는 형식을 검사해 진행 기록 폴더 안의 로그와 리포트 경로로만 바꾼다.
const getRunFiles = (projectDir, id) => {
    const match = typeof id === "string" ? id.match(RUN_ID_PATTERN) : null;

    if (!match) {
        return null;
    }

    const logFile = path.join(getProgressDir(projectDir), match[1], match[2]);

    return { day: match[1], name: match[2], logFile: logFile, reportFile: getReportFile(logFile) };
};

// 한 실행의 요약과 로그 줄을 돌려준다. 줄이 너무 많으면 최근 줄만 보내고 건너뛴 줄 수를 알린다.
const readRun = async (projectDir, id, { activeLogFile = "" } = {}) => {
    const files = getRunFiles(projectDir, id);

    if (!files || !isProjectLogFile(projectDir, files.logFile)) {
        throw new Error("열 수 없는 기록이에요.");
    }

    const stat = await fs.promises.stat(files.logFile);
    const log = await readLogLines(files.logFile, stat.size);
    const run = buildSummary(projectDir, files, stat, log);

    return {
        run: { ...run, isActive: isActiveLog(files.logFile, activeLogFile) },
        lines: log.lines.slice(-MAX_DETAIL_LINES),
        omittedLines: Math.max(0, log.lines.length - MAX_DETAIL_LINES)
    };
};

// 실행 한 건의 로그와 리포트를 지운다. 진행 중인 실행은 지우지 않고, 날짜 폴더가 비면 함께 지운다.
// 그날의 완료 마커·보관한 진행 기록 원본처럼 이 실행의 것이 아닌 파일은 건드리지 않는다.
const deleteRun = async (projectDir, id, { activeLogFile = "" } = {}) => {
    const files = getRunFiles(projectDir, id);

    if (!files || !isProjectLogFile(projectDir, files.logFile)) {
        throw new Error("지울 수 없는 기록이에요.");
    }

    if (isActiveLog(files.logFile, activeLogFile)) {
        throw new Error("진행 중인 실행은 지울 수 없어요.");
    }

    await fs.promises.unlink(files.logFile);

    summaryCache.delete(files.logFile);

    if (isProjectReportFile(projectDir, files.reportFile)) {
        await fs.promises.rm(files.reportFile, { force: true });
    }

    // 비어 있을 때만 지워진다.
    await fs.promises.rmdir(path.dirname(files.logFile)).catch(() => {});
};

module.exports = { listRuns, readRun, deleteRun, getRunFiles, MAX_RUN_COUNT, MAX_DETAIL_LINES };

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isSea } from "node:sea";
import {
    DEFAULT_EFFORT,
    DEFAULT_MODEL,
    EFFORT_LEVELS,
    EXIT_CODE_FAILED,
    EXIT_CODE_INTERRUPTED,
    EXIT_CODE_SUCCESS,
    FALLBACK_MODEL,
    KIT_DIR_NAME,
    LOCK_FILE_NAME,
    MODEL_CHOICES,
    PROGRESS_DIR_NAME,
    ROUND_OPTIONS_FILE_NAME,
    ROUND_OUTCOME_COMPLETE,
    ROUND_OUTCOME_IDLE,
    ROUND_OUTCOME_INTERRUPTED,
    ROUND_OUTCOME_RATE_LIMITED,
    ROUND_OUTCOME_TIMED_OUT,
    STOP_FILE_NAME
} from "./config.js";
import fileUtil from "./fileUtil.js";
import processUtil from "./processUtil.js";

const LOCK_MAX_ATTEMPTS = 2;

// kitDir는 core/의 상위 폴더다. 단일 실행 파일은 실행 파일이 있는 폴더가 kitDir다.
const getKitDir = (kitDirOption) => {
    if (kitDirOption) {
        return path.resolve(kitDirOption);
    }

    if (isSea()) {
        return path.dirname(process.execPath);
    }

    return path.resolve(import.meta.dirname, "../..");
};

const assertKitDir = (kitDir) => {
    if (path.basename(kitDir) !== KIT_DIR_NAME) {
        throw new Error("키트를 대상 프로젝트의 autopilot/ 폴더에 복사한 뒤 실행하세요.");
    }
};

const getStopFile = (kitDir) => {
    return path.join(kitDir, PROGRESS_DIR_NAME, STOP_FILE_NAME);
};

const getLockFile = (kitDir) => {
    return path.join(kitDir, PROGRESS_DIR_NAME, LOCK_FILE_NAME);
};

const getRoundOptionsFile = (kitDir) => {
    return path.join(kitDir, PROGRESS_DIR_NAME, ROUND_OPTIONS_FILE_NAME);
};

// 첫 줄은 pid, 둘째 줄은 실행 파일 이름, 셋째 줄은 이번 실행의 로그 파일이다. 이름이 없는 이전 형식은 pid만 확인한다.
const readRunLock = (lockFile) => {
    const [pidText = "", name = "", logFile = ""] = fileUtil.readTextFile(lockFile).split(/\r?\n/);

    return { pid: Number(pidText.trim()), name: name.trim(), logFile: logFile.trim() };
};

const formatRunLock = (logFile = "") => {
    return [process.pid, path.basename(process.execPath), logFile].join("\n").trimEnd();
};

const isRunLockActive = (lockFile) => {
    const { pid, name } = readRunLock(lockFile);

    return processUtil.isSameProcess(pid, name);
};

// 실행 중인 엔진의 상태. 앱이 낡은 잠금과 pid 재사용을 따로 판단하지 않도록 엔진이 판정해 알려준다.
const getRunStatus = (lockFile) => {
    const { pid, name, logFile } = readRunLock(lockFile);

    return processUtil.isSameProcess(pid, name) ? { running: true, pid: pid, logFile: logFile } : { running: false };
};

// 로그 파일은 잠금을 얻은 뒤에 정해지므로 나중에 기록한다. 읽는 쪽이 쓰다 만 파일을 보지 않도록 임시 파일을 교체한다.
const writeRunLockLogFile = (lockFile, logFile) => {
    const tempFile = `${lockFile}.${process.pid}.tmp`;

    fs.writeFileSync(tempFile, formatRunLock(logFile), "utf8");
    fs.renameSync(tempFile, lockFile);
};

// 실행 중인 pid와 실행 파일 이름을 기록해 같은 프로젝트의 동시 실행을 막는다. pid가 없거나 다른 프로그램이 재사용한 낡은 잠금은 덮어쓴다. 해제 함수를 반환한다.
const acquireRunLock = (lockFile) => {
    fs.mkdirSync(path.dirname(lockFile), { recursive: true });

    for (let attempt = 0; attempt < LOCK_MAX_ATTEMPTS; attempt++) {
        try {
            fs.writeFileSync(lockFile, formatRunLock(), { flag: "wx" });

            return () => {
                fs.rmSync(lockFile, { force: true });
            };
        } catch (error) {
            if (error.code !== "EEXIST") {
                throw error;
            }
        }

        const { pid, name } = readRunLock(lockFile);

        if (processUtil.isSameProcess(pid, name)) {
            throw new Error(`이미 실행 중인 AutoPilot이 있습니다 (PID ${pid}). 실행 중이 아니라면 ${lockFile} 파일을 지우세요.`);
        }

        fs.rmSync(lockFile, { force: true });
    }

    throw new Error(`실행 잠금을 얻지 못했습니다: ${lockFile}`);
};

const getRunEnv = (options) => {
    return { ...process.env, ...options.env, CLAUDE_CONFIG_DIR: path.resolve(os.homedir(), options.configDir || ".claude") };
};

// 회차마다 읽는 model·effort 변경 파일. 허용된 값만 돌려주고, JSON이 깨져 있으면 예외를 던진다.
const readRoundOptions = (roundOptionsFile) => {
    const text = fileUtil.readTextFile(roundOptionsFile);

    if (!text.trim()) {
        return {};
    }

    const savedOptions = JSON.parse(text);

    return {
        ...(MODEL_CHOICES.includes(savedOptions?.model) ? { model: savedOptions.model } : {}),
        ...(EFFORT_LEVELS.includes(savedOptions?.effort) ? { effort: savedOptions.effort } : {})
    };
};

// 읽는 쪽이 쓰다 만 파일을 보지 않도록 임시 파일에 쓴 뒤 교체한다. 깨진 기존 파일은 덮어쓴다.
const writeRoundOptions = (roundOptionsFile, roundOptions) => {
    let savedOptions = {};

    try {
        savedOptions = readRoundOptions(roundOptionsFile);
    } catch {}

    const nextOptions = { ...savedOptions, ...roundOptions };
    const tempFile = `${roundOptionsFile}.${process.pid}.tmp`;

    fs.mkdirSync(path.dirname(roundOptionsFile), { recursive: true });
    fs.writeFileSync(tempFile, JSON.stringify(nextOptions), "utf8");
    fs.renameSync(tempFile, roundOptionsFile);

    return nextOptions;
};

// 우선순위: 실행 중 변경 파일 > 실행 인자 > 기본값
const getRoundOptions = (startOptions, savedOptions) => {
    return { model: savedOptions.model || startOptions.model || DEFAULT_MODEL, effort: savedOptions.effort || startOptions.effort || DEFAULT_EFFORT };
};

const getClaudeArgs = ({ model = DEFAULT_MODEL, effort = DEFAULT_EFFORT } = {}) => {
    const fallbackArgs = model === FALLBACK_MODEL ? [] : ["--fallback-model", FALLBACK_MODEL];

    return ["--model", model, "--effort", effort, ...fallbackArgs, "--autocompact", "150000", "--dangerously-skip-permissions", "--output-format", "stream-json", "--verbose", "-p"];
};

const getRoundOutcome = ({ isInterrupted, isRateLimited, timedOut, isFailed, exitCode, isError, idleCount }) => {
    if (isInterrupted) {
        return ROUND_OUTCOME_INTERRUPTED;
    }

    if (isRateLimited) {
        return ROUND_OUTCOME_RATE_LIMITED;
    }

    if (timedOut) {
        return ROUND_OUTCOME_TIMED_OUT;
    }

    if (isFailed) {
        return `실패 (exit ${exitCode}${isError ? ", is_error" : ""})`;
    }

    return idleCount ? ROUND_OUTCOME_IDLE : ROUND_OUTCOME_COMPLETE;
};

const getExitCode = (isAborted, isInterrupted) => {
    if (isAborted) {
        return EXIT_CODE_FAILED;
    }

    return isInterrupted ? EXIT_CODE_INTERRUPTED : EXIT_CODE_SUCCESS;
};

export default {
    getKitDir,
    assertKitDir,
    getStopFile,
    getLockFile,
    getRoundOptionsFile,
    isRunLockActive,
    getRunStatus,
    acquireRunLock,
    writeRunLockLogFile,
    getRunEnv,
    readRoundOptions,
    writeRoundOptions,
    getRoundOptions,
    getClaudeArgs,
    getRoundOutcome,
    getExitCode
};

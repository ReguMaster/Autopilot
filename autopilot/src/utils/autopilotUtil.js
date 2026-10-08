import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isSea } from "node:sea";
import {
    DEFAULT_EFFORT,
    EXIT_CODE_FAILED,
    EXIT_CODE_INTERRUPTED,
    EXIT_CODE_SUCCESS,
    KIT_DIR_NAME,
    LOCK_FILE_NAME,
    PROGRESS_DIR_NAME,
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

// 실행 중인 pid를 기록해 같은 프로젝트의 동시 실행을 막는다. 살아 있는 프로세스가 없는 낡은 잠금은 덮어쓴다. 해제 함수를 반환한다.
const acquireRunLock = (lockFile) => {
    fs.mkdirSync(path.dirname(lockFile), { recursive: true });

    for (let attempt = 0; attempt < LOCK_MAX_ATTEMPTS; attempt++) {
        try {
            fs.writeFileSync(lockFile, String(process.pid), { flag: "wx" });

            return () => {
                fs.rmSync(lockFile, { force: true });
            };
        } catch (error) {
            if (error.code !== "EEXIST") {
                throw error;
            }
        }

        const lockPid = Number(fileUtil.readTextFile(lockFile).trim());

        if (processUtil.isProcessRunning(lockPid)) {
            throw new Error(`이미 실행 중인 AutoPilot이 있습니다 (PID ${lockPid}). 실행 중이 아니라면 ${lockFile} 파일을 지우세요.`);
        }

        fs.rmSync(lockFile, { force: true });
    }

    throw new Error(`실행 잠금을 얻지 못했습니다: ${lockFile}`);
};

const getRunEnv = (options) => {
    return { ...process.env, ...options.env, CLAUDE_CONFIG_DIR: path.resolve(os.homedir(), options.configDir || ".claude") };
};

const getClaudeArgs = (effort = DEFAULT_EFFORT) => {
    return ["--model", "opus", "--effort", effort, "--fallback-model", "sonnet", "--autocompact", "150000", "--dangerously-skip-permissions", "--output-format", "stream-json", "--verbose", "-p"];
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

export default { getKitDir, assertKitDir, getStopFile, getLockFile, acquireRunLock, getRunEnv, getClaudeArgs, getRoundOutcome, getExitCode };

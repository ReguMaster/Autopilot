import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { KIT_DIR_NAME, PROGRESS_DIR_NAME, PROGRESS_FILE_NAME, PROGRESS_MAX_LINES } from "./config.js";
import fileUtil from "./fileUtil.js";
import promptUtil from "./promptUtil.js";

const countLines = (content) => {
    const lines = content.split(/\r\n|\n|\r/);

    if (lines.at(-1) === "") {
        lines.pop();
    }

    return lines.length;
};

// 진행 기록이 상한을 넘으면 원본을 보관하고 정리를 지시하는 프롬프트를 반환한다. 보관에 실패하면 원본을 유지한다.
const archiveProgressRecord = (kitDir, progressDir, runDate, writeLog) => {
    const progressFile = path.join(kitDir, PROGRESS_FILE_NAME);

    try {
        if (countLines(fileUtil.readTextFile(progressFile)) <= PROGRESS_MAX_LINES) {
            return "";
        }

        const archiveName = `AUTOPILOT_PROGRESS_${randomUUID()}.md`;
        const archivePath = `${KIT_DIR_NAME}/${PROGRESS_DIR_NAME}/${runDate}/${archiveName}`;

        fs.copyFileSync(progressFile, path.join(progressDir, archiveName), fs.constants.COPYFILE_EXCL);

        writeLog(`[진행 기록] 원본 보관: ${archivePath}`);

        return promptUtil.getProgressCleanupPrompt(archivePath);
    } catch (error) {
        writeLog(`[진행 기록] 보관 실패, 기존 문서 유지: ${error.message}`);

        return "";
    }
};

export default { archiveProgressRecord };

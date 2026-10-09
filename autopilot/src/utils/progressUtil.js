import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { KIT_DIR_NAME, PROGRESS_DIR_NAME, PROGRESS_FILE_NAME, PROGRESS_MAX_LINES } from "./config.js";
import dateUtil from "./dateUtil.js";
import fileUtil from "./fileUtil.js";
import promptUtil from "./promptUtil.js";

const RUN_DATE_DIR_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const RUN_FILE_PATTERN = /^(autopilot_[\w-]+\.log|report_[\w-]+\.html)$/;

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

// 보관 기간이 지난 날짜 폴더에서 회차 로그와 리포트만 지운다. 보관한 진행 기록 원본과 완료 마커는 남기고, 링크는 따라가지 않는다. 지운 파일 수를 반환한다.
const pruneRunFiles = (progressRoot, runDate, retentionDays, writeLog) => {
    if (!(retentionDays > 0)) {
        return 0;
    }

    const cutoff = new Date(`${runDate}T00:00:00`);

    cutoff.setDate(cutoff.getDate() - retentionDays);

    const cutoffDate = dateUtil.getDateString(cutoff);
    let deletedCount = 0;

    try {
        for (const dateEntry of fs.readdirSync(progressRoot, { withFileTypes: true })) {
            if (!dateEntry.isDirectory() || !RUN_DATE_DIR_PATTERN.test(dateEntry.name) || dateEntry.name >= cutoffDate) {
                continue;
            }

            const dateDir = path.join(progressRoot, dateEntry.name);

            try {
                for (const fileEntry of fs.readdirSync(dateDir, { withFileTypes: true })) {
                    if (fileEntry.isFile() && RUN_FILE_PATTERN.test(fileEntry.name)) {
                        fs.rmSync(path.join(dateDir, fileEntry.name));

                        deletedCount++;
                    }
                }

                if (!fs.readdirSync(dateDir).length) {
                    fs.rmdirSync(dateDir);
                }
            } catch (error) {
                writeLog(`[정리] ${dateEntry.name} 정리 실패: ${error.message}`);
            }
        }
    } catch (error) {
        if (error.code !== "ENOENT") {
            writeLog(`[정리] 오래된 로그를 정리하지 못했습니다: ${error.message}`);
        }
    }

    if (deletedCount) {
        writeLog(`[정리] 보관 기간 ${retentionDays}일이 지난 로그·리포트 ${deletedCount}개를 삭제했습니다.`);
    }

    return deletedCount;
};

export default { archiveProgressRecord, pruneRunFiles };

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PROGRESS_DIR_NAME, PROGRESS_MAX_LINES, WORK_DIR_NAME } from "./config.js";
import dateUtil from "./dateUtil.js";
import fileUtil from "./fileUtil.js";
import promptUtil from "./promptUtil.js";

const PROGRESS_TEMPLATE = ["# AutoPilot 작업 진행 기록", "", "AutoPilot 세션 간 인수인계 문서. 새 세션은 이 파일을 먼저 읽고 `다음 작업`부터 이어간다.", "", "---", ""].join("\n");
const RESET_NOTICE_PREFIX = "이전 작업을 모두 마쳐 기록을 초기화했다. 이전 기록은 `";
const RUN_DATE_DIR_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const RUN_FILE_PATTERN = /^(autopilot_[\w-]+\.log|report_[\w-]+\.html)$/;

// 초기화한 기록에는 보관본 경로만 남겨, 세션이 필요할 때만 읽도록 한다.
const getResetRecord = (archivePath) => {
    return `${PROGRESS_TEMPLATE}\n${RESET_NOTICE_PREFIX}${archivePath}\`에 보관했다(필요할 때만 읽는다).\n`;
};

const countLines = (content) => {
    const lines = content.split(/\r\n|\n|\r/);

    if (lines.at(-1) === "") {
        lines.pop();
    }

    return lines.length;
};

// 이어받을 기록이 없는 프로젝트의 첫 실행에서 세션이 빈 문서를 열도록 초기 내용을 만들어 둔다. 이미 있으면 건드리지 않는다.
const ensureProgressRecord = (progressFile) => {
    fs.mkdirSync(path.dirname(progressFile), { recursive: true });

    try {
        fs.writeFileSync(progressFile, PROGRESS_TEMPLATE, { encoding: "utf8", flag: "wx" });
    } catch (error) {
        if (error.code !== "EEXIST") {
            throw error;
        }
    }
};

// 기록이 없으면 0이다.
const countProgressLines = (progressFile) => {
    return countLines(fileUtil.readTextFile(progressFile));
};

// 진행 기록 원본을 날짜 폴더에 복사하고 프로젝트 루트 기준 보관 경로를 반환한다. 복사에 실패하면 예외를 던진다.
const copyProgressRecord = (progressFile, progressDir, runDate) => {
    const archiveName = `AUTOPILOT_PROGRESS_${randomUUID()}.md`;

    fs.copyFileSync(progressFile, path.join(progressDir, archiveName), fs.constants.COPYFILE_EXCL);

    return `${WORK_DIR_NAME}/${PROGRESS_DIR_NAME}/${runDate}/${archiveName}`;
};

// 진행 기록이 상한을 넘으면 원본을 보관하고 정리를 지시하는 프롬프트를 반환한다. 보관에 실패하면 원본을 유지한다.
const archiveProgressRecord = (progressFile, progressDir, runDate, writeLog) => {
    try {
        if (countLines(fileUtil.readTextFile(progressFile)) <= PROGRESS_MAX_LINES) {
            return "";
        }

        const archivePath = copyProgressRecord(progressFile, progressDir, runDate);

        writeLog(`[진행 기록] 원본 보관: ${archivePath}`);

        return promptUtil.getProgressCleanupPrompt(progressFile, archivePath);
    } catch (error) {
        writeLog(`[진행 기록] 보관 실패, 기존 문서 유지: ${error.message}`);

        return "";
    }
};

// 비어 있거나 템플릿뿐이거나, 템플릿 뒤에 초기화 안내 한 줄만 있는 기록이다. 세션이 내용을 덧붙였다면 초기 상태가 아니다.
const isInitialRecord = (content) => {
    const record = content.replace(/\r\n/g, "\n").trimEnd();
    const template = PROGRESS_TEMPLATE.trimEnd();

    if (!record || record === template) {
        return true;
    }

    const notice = record.startsWith(template) ? record.slice(template.length).trim() : "";

    return notice.startsWith(RESET_NOTICE_PREFIX) && !notice.includes("\n");
};

// 진행 기록 원본을 보관하고 초기 상태로 되돌린다. 이미 초기 상태이거나 기록이 없으면 아무것도 하지 않고, 보관에 실패하면 원본을 유지한다(isDone이 false).
const resetProgressRecord = (progressFile, progressDir, runDate, writeLog) => {
    try {
        if (isInitialRecord(fileUtil.readTextFile(progressFile))) {
            return { isDone: true, archivePath: "" };
        }

        fs.mkdirSync(progressDir, { recursive: true });

        const archivePath = copyProgressRecord(progressFile, progressDir, runDate);

        fs.writeFileSync(progressFile, getResetRecord(archivePath), "utf8");

        writeLog(`[진행 기록] 초기화했습니다. 원본 보관: ${archivePath}`);

        return { isDone: true, archivePath: archivePath };
    } catch (error) {
        writeLog(`[진행 기록] 초기화 실패, 기존 문서 유지: ${error.message}`);

        return { isDone: false, archivePath: "" };
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

export default { PROGRESS_TEMPLATE, ensureProgressRecord, countProgressLines, archiveProgressRecord, resetProgressRecord, pruneRunFiles };

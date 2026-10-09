const fs = require("node:fs");
const path = require("node:path");

const WORK_DIR_NAME = "autopilot";
const PROGRESS_DIR_NAME = "progress";
const REPORT_FILE_PATTERN = /^report_[\w-]+\.html$/i;
const LOG_FILE_PATTERN = /^autopilot_[\w-]+\.log$/i;

// 엔진은 프로젝트가 Git 저장소의 루트일 때만 시작한다. .git은 워크트리에서는 파일이다.
const getProjectError = (projectDir) => {
    try {
        if (!projectDir || !fs.statSync(projectDir).isDirectory()) {
            return "대상 프로젝트 폴더를 선택해 주세요.";
        }

        return fs.existsSync(path.join(projectDir, ".git")) ? "" : "Git 저장소의 루트 폴더(.git이 있는 폴더)를 선택해 주세요.";
    } catch {
        return "대상 프로젝트 폴더를 찾지 못했어요. 다시 선택해 주세요.";
    }
};

// 엔진이 알려준 경로를 그대로 열거나 읽지 않도록, 프로젝트 autopilot/progress/ 아래에 있고 이름이 엔진이 만드는 형식인 파일만 허용한다.
// 심볼릭 링크·junction으로 밖을 가리키는 경로는 실제 경로로 풀어서 거른다.
const isProgressFile = (projectDir, file, namePattern) => {
    if (!projectDir || !file) {
        return false;
    }

    try {
        const progressDir = fs.realpathSync.native(path.join(projectDir, WORK_DIR_NAME, PROGRESS_DIR_NAME));
        const realFile = fs.realpathSync.native(file);
        const relativePath = path.relative(progressDir, realFile);

        return relativePath.split(path.sep)[0] !== ".." && !path.isAbsolute(relativePath) && namePattern.test(path.basename(realFile));
    } catch {
        return false;
    }
};

// 리포트를 shell로 열면 실행 파일이 실행될 수 있으므로 리포트 HTML만 허용한다.
const isProjectReportFile = (projectDir, reportFile) => {
    return isProgressFile(projectDir, reportFile, REPORT_FILE_PATTERN);
};

const isProjectLogFile = (projectDir, logFile) => {
    return isProgressFile(projectDir, logFile, LOG_FILE_PATTERN);
};

module.exports = { getProjectError, isProjectReportFile, isProjectLogFile };

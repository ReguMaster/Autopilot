const fs = require("node:fs");
const path = require("node:path");

const KIT_DIR_NAME = "autopilot";
const PROGRESS_DIR_NAME = "progress";
const REPORT_FILE_PATTERN = /^report_[\w-]+\.html$/i;
const LOG_FILE_PATTERN = /^autopilot_[\w-]+\.log$/i;

const isFile = (file) => {
    try {
        return fs.statSync(file).isFile();
    } catch {
        return false;
    }
};

// 시작 위치에서 상위 폴더로 올라가며 대상 프로젝트의 autopilot/과 개발 빌드 산출물(dist/cli-<OS>-<CPU>/autopilot/)을 찾는다.
const findEngineExecutable = (startDirs, { platform = process.platform, arch = process.arch } = {}) => {
    const exeName = platform === "win32" ? "autopilot.exe" : "autopilot";
    const visited = new Set();

    for (const startDir of startDirs) {
        for (let dir = path.resolve(startDir); !visited.has(dir); dir = path.dirname(dir)) {
            visited.add(dir);

            const candidates = [path.join(dir, KIT_DIR_NAME, exeName), path.join(dir, "dist", `cli-${platform}-${arch}`, KIT_DIR_NAME, exeName)];
            const found = candidates.find(isFile);

            if (found) {
                return found;
            }
        }
    }

    return "";
};

// 엔진이 알려준 경로를 그대로 열거나 읽지 않도록, 키트 progress/ 아래에 있고 이름이 엔진이 만드는 형식인 파일만 허용한다.
// 심볼릭 링크·junction으로 밖을 가리키는 경로는 실제 경로로 풀어서 거른다.
const isKitProgressFile = (kitDir, file, namePattern) => {
    if (!kitDir || !file) {
        return false;
    }

    try {
        const progressDir = fs.realpathSync.native(path.join(kitDir, PROGRESS_DIR_NAME));
        const realFile = fs.realpathSync.native(file);
        const relativePath = path.relative(progressDir, realFile);

        return relativePath.split(path.sep)[0] !== ".." && !path.isAbsolute(relativePath) && namePattern.test(path.basename(realFile));
    } catch {
        return false;
    }
};

// 리포트를 shell로 열면 실행 파일이 실행될 수 있으므로 리포트 HTML만 허용한다.
const isKitReportFile = (kitDir, reportFile) => {
    return isKitProgressFile(kitDir, reportFile, REPORT_FILE_PATTERN);
};

const isKitLogFile = (kitDir, logFile) => {
    return isKitProgressFile(kitDir, logFile, LOG_FILE_PATTERN);
};

module.exports = { KIT_DIR_NAME, findEngineExecutable, isKitReportFile, isKitLogFile };

const fs = require("node:fs");
const path = require("node:path");

const KIT_DIR_NAME = "autopilot";

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

module.exports = { KIT_DIR_NAME, findEngineExecutable };

const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");

const GIT_TIMEOUT_MS = 30000;
const WORK_DIR_NAME = ".autopilot";
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

// .git이 없는 폴더에는 사용자가 확인하면 새 저장소를 만들 수 있다.
const canInitGitRepo = (dir) => {
    try {
        return fs.statSync(dir).isDirectory() && !fs.existsSync(path.join(dir, ".git"));
    } catch {
        return false;
    }
};

const runGit = (git, args, options) => {
    return new Promise((resolve) => {
        execFile(git, args, { ...options, windowsHide: true, timeout: GIT_TIMEOUT_MS, encoding: "utf8" }, (error, stdout, stderr) => resolve(error ? (stderr || error.message).trim() : ""));
    });
};

// main 브랜치로 새 저장소를 만들고 빈 첫 commit을 남긴다(작업 브랜치가 main에서 갈라진다). 실패하면 git이 알려준 이유를, 성공하면 빈 문자열을 돌려준다.
// commit 작성자가 설정되지 않았으면 지어내지 않고 git의 안내를 그대로 알린다.
const initGitRepo = async (dir, { git = "git", env = process.env } = {}) => {
    for (const args of [
        ["init", "-b", "main"],
        ["commit", "--allow-empty", "-m", "init"]
    ]) {
        const error = await runGit(git, args, { cwd: dir, env: env });

        if (error) {
            return error;
        }
    }

    return "";
};

// 엔진이 알려준 경로를 그대로 열거나 읽지 않도록, 프로젝트 .autopilot/progress/ 아래에 있고 이름이 엔진이 만드는 형식인 파일만 허용한다.
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

const getProgressDir = (projectDir) => {
    return path.join(projectDir, WORK_DIR_NAME, PROGRESS_DIR_NAME);
};

// 신규 개발 단계 산출물. 렌더러는 단계 이름만 보내고 경로는 여기서 정한다. 디자인은 design.md가 없으면 design/ 폴더다.
const PHASE_DOCS = {
    plan: [{ path: "docs/autopilot/plan.md", isDir: false }],
    design: [
        { path: "docs/autopilot/design.md", isDir: false },
        { path: "docs/autopilot/design", isDir: true }
    ],
    qa: [{ path: "docs/autopilot/qa.md", isDir: false }],
    security: [{ path: "docs/autopilot/security.md", isDir: false }]
};
const MAX_PHASE_DOC_BYTES = 256 * 1024;
const MAX_PHASE_DOC_ENTRIES = 200;

// 단계 산출물의 실제 경로. 없거나, 링크로 프로젝트 밖을 가리키거나, 종류(파일·폴더)가 다르면 건너뛴다.
const getPhaseDoc = (projectDir, phase) => {
    if (!projectDir || !Object.hasOwn(PHASE_DOCS, phase)) {
        return null;
    }

    for (const doc of PHASE_DOCS[phase]) {
        try {
            const realProject = fs.realpathSync.native(projectDir);
            const realPath = fs.realpathSync.native(path.join(projectDir, doc.path));
            const relativePath = path.relative(realProject, realPath);
            const isInside = relativePath !== "" && relativePath.split(path.sep)[0] !== ".." && !path.isAbsolute(relativePath);

            if (isInside && fs.statSync(realPath).isDirectory() === doc.isDir) {
                return { ...doc, realPath: realPath };
            }
        } catch {}
    }

    return null;
};

// 미리보기용으로 읽는다. 파일은 앞 256KB까지 글자로, 디자인 폴더는 이름 목록(링크는 빼고)으로 돌려준다.
const readPhaseDoc = (projectDir, phase) => {
    const doc = getPhaseDoc(projectDir, phase);

    if (!doc) {
        return null;
    }

    if (doc.isDir) {
        const entries = fs
            .readdirSync(doc.realPath, { withFileTypes: true })
            .filter((entry) => !entry.isSymbolicLink())
            .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
            .sort();

        return { kind: "folder", path: doc.path, entries: entries.slice(0, MAX_PHASE_DOC_ENTRIES) };
    }

    const buffer = Buffer.alloc(MAX_PHASE_DOC_BYTES + 1);
    const fd = fs.openSync(doc.realPath, "r");

    try {
        const size = fs.readSync(fd, buffer, 0, buffer.length, 0);

        // stream \uB514\uCF54\uB529\uC740 256KB \uACBD\uACC4\uC5D0\uC11C \uC798\uB9B0 \uB9C8\uC9C0\uB9C9 \uAE00\uC790\uB97C \uAE68\uC9C4 \uBB38\uC790\uB85C \uB0A8\uAE30\uC9C0 \uC54A\uACE0 \uBC84\uB9B0\uB2E4.
        const text = new TextDecoder("utf-8", { ignoreBOM: false }).decode(buffer.subarray(0, Math.min(size, MAX_PHASE_DOC_BYTES)), { stream: true });

        return { kind: "file", path: doc.path, text: text, isPartial: size > MAX_PHASE_DOC_BYTES };
    } finally {
        fs.closeSync(fd);
    }
};

module.exports = {
    getProjectError,
    canInitGitRepo,
    initGitRepo,
    isProjectReportFile,
    isProjectLogFile,
    getProgressDir,
    getPhaseDoc,
    readPhaseDoc,
    LOG_FILE_PATTERN,
    REPORT_FILE_PATTERN,
    MAX_PHASE_DOC_BYTES
};

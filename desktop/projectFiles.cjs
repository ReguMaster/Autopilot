const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { getProjectNameError, sanitizeBrief } = require("./projectDraft.cjs");

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

// 차례로 실행하다 처음 실패한 git의 이유를, 모두 성공하면 빈 문자열을 돌려준다.
const runGitSteps = async (git, steps, options) => {
    for (const args of steps) {
        const error = await runGit(git, args, options);

        if (error) {
            return error;
        }
    }

    return "";
};

// main 브랜치로 시작하는 저장소 만들기. init -b는 git 2.28부터라 옛 git도 되게 HEAD를 직접 main으로 돌린다.
const INIT_MAIN_STEPS = [["init"], ["symbolic-ref", "HEAD", "refs/heads/main"]];

// main 브랜치로 새 저장소를 만들고 빈 첫 commit을 남긴다(작업 브랜치가 main에서 갈라진다). 실패하면 git이 알려준 이유를, 성공하면 빈 문자열을 돌려준다.
// commit 작성자가 설정되지 않았으면 지어내지 않고 git의 안내를 그대로 알린다.
const initGitRepo = async (dir, { git = "git", env = process.env } = {}) => {
    return runGitSteps(git, [...INIT_MAIN_STEPS, ["commit", "--allow-empty", "-m", "init"]], { cwd: dir, env: env });
};

const readGitConfig = (git, key, env) => {
    return new Promise((resolve) => {
        execFile(git, ["config", "--get", key], { cwd: os.tmpdir(), env: env, windowsHide: true, timeout: GIT_TIMEOUT_MS, encoding: "utf8" }, (error, stdout) => resolve(error ? "" : stdout.trim()));
    });
};

// 저장소 밖(전역·시스템 설정)에 commit 작성자가 있는지. 둘 중 하나라도 없으면 null이라 새 프로젝트 화면이 작성자를 받는다.
const getGitAuthor = async ({ git = "git", env = process.env } = {}) => {
    const [name, email] = await Promise.all([readGitConfig(git, "user.name", env), readGitConfig(git, "user.email", env)]);

    return name && email ? { name: name, email: email } : null;
};

const AUTHOR_NAME_PATTERN = /^[^\u0000-\u001f\u007f<>]{1,100}$/;
const AUTHOR_EMAIL_PATTERN = /^[^\s@<>]{1,64}@[^\s@<>]{1,253}$/;
const BRIEF_PATH = "docs/autopilot/brief.md";

const isDirectory = (dir) => {
    try {
        return fs.statSync(dir).isDirectory();
    } catch {
        return false;
    }
};

// 새 프로젝트: <만들 위치>/<이름> 폴더(없거나 비어 있어야 함)에 main 저장소를 만들고 brief.md를 첫 commit으로 남긴다.
// 작성자를 받았으면 이 저장소에만 설정한다. 도중에 실패하면 만든 것만 지운다(이미 있던 빈 폴더는 남긴다).
const createProject = async ({ parentDir, name, brief, author = null, git = "git", env = process.env }) => {
    const nameError = getProjectNameError(name);

    if (nameError) {
        return { code: "INVALID_NAME", error: nameError };
    }

    if (!parentDir || !isDirectory(parentDir)) {
        return { code: "INVALID_PARENT", error: "만들 위치 폴더를 찾지 못했어요. 다시 골라 주세요." };
    }

    if (author && !(AUTHOR_NAME_PATTERN.test(author.name ?? "") && AUTHOR_EMAIL_PATTERN.test(author.email ?? ""))) {
        return { code: "INVALID_AUTHOR", error: "작성자 이름과 이메일을 확인해 주세요." };
    }

    const projectDir = path.join(parentDir, name);
    const isExisting = fs.existsSync(projectDir);

    if (isExisting && (!isDirectory(projectDir) || fs.readdirSync(projectDir).length > 0)) {
        return { code: "NOT_EMPTY", error: `${name} 폴더가 이미 있고 비어 있지 않아요. 다른 이름을 써 주세요.` };
    }

    const briefText = sanitizeBrief(brief);
    const options = { cwd: projectDir, env: env };

    try {
        if (!isExisting) {
            fs.mkdirSync(projectDir);
        }

        const initError = await runGitSteps(
            git,
            [
                ...INIT_MAIN_STEPS,
                ...(author
                    ? [
                          ["config", "user.name", author.name],
                          ["config", "user.email", author.email]
                      ]
                    : [])
            ],
            options
        );

        if (initError) {
            throw new Error(initError);
        }

        fs.mkdirSync(path.join(projectDir, path.dirname(BRIEF_PATH)), { recursive: true });
        fs.writeFileSync(path.join(projectDir, BRIEF_PATH), briefText, "utf8");

        const commitError = await runGitSteps(
            git,
            [
                ["add", "--", BRIEF_PATH],
                ["commit", "-m", "init: 프로젝트 초안(brief.md)"]
            ],
            options
        );

        if (commitError) {
            throw new Error(commitError);
        }
    } catch (error) {
        const created = isExisting ? [".git", "docs"].map((entry) => path.join(projectDir, entry)) : [projectDir];

        created.forEach((target) => fs.rmSync(target, { recursive: true, force: true }));

        return { code: "CREATE_FAILED", error: `프로젝트를 만들지 못했어요: ${error.message}` };
    }

    return { projectDir: projectDir, brief: briefText };
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
    security: [{ path: "docs/autopilot/security.md", isDir: false }],
    // 여러 AI 브레인스토밍의 보조 안(디자인은 HTML일 수 있다. 메인이 Codex이면 Claude 안)과 서로의 검토. 이름은 엔진 phaseUtil.getProposalPath·getReviewPath와 같다.
    ...Object.fromEntries(
        ["plan", "design"].flatMap((phase) => [
            ...["claude", "codex"].map((provider) => [
                `${phase}-${provider}`,
                ["md", "html"].map((extension) => ({ path: `docs/autopilot/proposals/${phase}-${provider}.${extension}`, isDir: false }))
            ]),
            ...["claude", "codex"].map((reviewer) => [`${phase}-review-${reviewer}`, [{ path: `docs/autopilot/proposals/${phase}-review-${reviewer}.md`, isDir: false }]]),
            // 협의 기록(엔진 phaseUtil.getDebatePath). 쟁점은 엔진이 단계 상태로 옮겨 status로 받는다.
            [`${phase}-debate`, [{ path: `docs/autopilot/proposals/${phase}-debate.md`, isDir: false }]]
        ])
    )
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

        // stream 디코딩은 256KB 경계에서 잘린 마지막 글자를 깨진 문자로 남기지 않고 버린다.
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
    getGitAuthor,
    createProject,
    isProjectReportFile,
    isProjectLogFile,
    getProgressDir,
    getPhaseDoc,
    readPhaseDoc,
    LOG_FILE_PATTERN,
    REPORT_FILE_PATTERN,
    MAX_PHASE_DOC_BYTES
};

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { STATUS_FAILED, PROGRESS_MAX_LINES } from "../../autopilot/src/utils/config.js";
import { runAutopilot } from "../../autopilot/src/services/autopilotService.js";
import settingsUtil from "../../autopilot/src/utils/settingsUtil.js";
import cliUtil from "../../autopilot/src/utils/cliUtil.js";
import progressUtil from "../../autopilot/src/utils/progressUtil.js";
import streamUtil from "../../autopilot/src/utils/streamUtil.js";
import autopilotUtil from "../../autopilot/src/utils/autopilotUtil.js";

const BOM = String.fromCodePoint(0xfeff);

const checkInvalidProject = async (context, errorMessages) => {
    for (const projectDir of [path.join(context.testDir, "missing"), undefined]) {
        const invalidRunResult = await runAutopilot({ projectDir: projectDir });

        assert.equal(invalidRunResult.status, STATUS_FAILED);
        assert.equal(invalidRunResult.error.code, "AUTOPILOT_ERROR");
        assert.equal(invalidRunResult.data, undefined);
    }

    assert(errorMessages.some((message) => message.includes("프로젝트 폴더를 찾지 못했습니다")));

    // 없는 프로젝트에는 작업 폴더를 만들지 않는다.
    assert(!fs.existsSync(path.join(context.testDir, "missing")));
};

const checkRunSettings = () => {
    const { getRunSettings } = settingsUtil;
    const now = new Date(2026, 9, 8, 12, 0, 0);
    const runSettings = getRunSettings("16:30", "지시개선", now);

    assert.equal(runSettings.deadline.getHours(), 16);
    assert.equal(runSettings.deadline.getMinutes(), 30);
    assert.equal(runSettings.policy, "지시개선");
    assert.equal(runSettings.endSource, "실행 인자");
    assert.equal(getRunSettings("07:00", "", now).deadline.getDate(), 9);
    assert.equal(getRunSettings("23:00", "AUTO", now).policy, "자율개선");

    const defaultSettings = getRunSettings("", "", now);

    assert.equal(defaultSettings.deadline.getHours(), 7);
    assert.equal(defaultSettings.policy, "자율개선");
    assert.equal(defaultSettings.endSource, "기본값");
    assert.equal(defaultSettings.policySource, "기본값");

    for (const invalidEndTime of ["24:00", "12:60", "1:00", "nope", "오후 4시"]) {
        assert.throws(() => getRunSettings(invalidEndTime));
    }

    assert.throws(() => getRunSettings("", "not-todo"));
    assert.throws(() => getRunSettings("", "constructor"));
};

const checkCommandArgs = () => {
    const { parseRunArgs, parseProjectArgs, parseSetArgs } = cliUtil;
    const project = ["--project", "C:\\work\\demo project"];

    assert.deepEqual(parseRunArgs([...project, "--end-time", "07:00", "--policy", "todo", "--tasks-file", "t.md", "--model", "sonnet", "--effort", "max", "--no-open"]), {
        projectDir: "C:\\work\\demo project",
        endTime: "07:00",
        policy: "todo",
        tasksFile: "t.md",
        model: "sonnet",
        effort: "max",
        open: false
    });
    assert.equal(parseRunArgs(project).open, undefined);

    // 프로젝트가 없거나 위치 인자·알 수 없는 인자·잘못된 값은 거부한다. 이전 형식(HH:mm todo 위치 인자)은 더 받지 않는다.
    assert.throws(() => parseRunArgs([]), /--project/);
    assert.throws(() => parseRunArgs(["23:00", "todo", ...project]), /알 수 없는 인자/);
    assert.throws(() => parseRunArgs([...project, "--unknown"]), /알 수 없는 인자/);
    assert.throws(() => parseRunArgs([...project, "--effort", "high & echo bad"]));
    assert.throws(() => parseRunArgs([...project, "--model", "gpt"]), /model/);
    assert.throws(() => parseRunArgs([...project, "--model"]));
    assert.throws(() => parseRunArgs(["--project", "--no-open"]));

    assert.deepEqual(parseProjectArgs(project), { projectDir: "C:\\work\\demo project" });
    assert.throws(() => parseProjectArgs([]), /--project/);
    assert.throws(() => parseProjectArgs([...project, "extra"]), /알 수 없는 인자/);
    assert.throws(() => parseProjectArgs([...project, "--model", "opus"]), /알 수 없는 인자/);

    assert.deepEqual(parseSetArgs([...project, "--model", "haiku", "--effort", "low"]), { projectDir: "C:\\work\\demo project", model: "haiku", effort: "low" });
    assert.deepEqual(parseSetArgs([...project, "--effort", "xhigh"]), { projectDir: "C:\\work\\demo project", effort: "xhigh" });

    for (const invalidArgs of [[], project, [...project, "--no-open"], [...project, "23:00"], [...project, "--model", "gpt"], [...project, "--effort", "extreme"], [...project, "--model"]]) {
        assert.throws(() => parseSetArgs(invalidArgs), undefined, `set ${invalidArgs.join(" ")}`);
    }
};

const checkClaudeArgs = () => {
    const { getClaudeArgs } = autopilotUtil;
    const getValue = (args, flag) => args[args.indexOf(flag) + 1];

    assert.equal(getValue(getClaudeArgs(), "--model"), "opus");
    assert.equal(getValue(getClaudeArgs(), "--effort"), "high");
    assert.equal(getValue(getClaudeArgs(), "--fallback-model"), "sonnet");
    assert.equal(getValue(getClaudeArgs({ model: "haiku", effort: "max" }), "--effort"), "max");

    // 같은 모델로는 fallback을 지정하지 않는다.
    assert(!getClaudeArgs({ model: "sonnet", effort: "low" }).includes("--fallback-model"));
};

// 엔진은 Electron을 Node로 실행하므로 그 표시가 Claude 세션과 그 하위 프로세스로 새면 안 된다.
const checkRunEnv = () => {
    const env = autopilotUtil.getRunEnv({ env: { ELECTRON_RUN_AS_NODE: "1", AP_KEEP: "yes" } });

    assert.equal(env.ELECTRON_RUN_AS_NODE, undefined);
    assert.equal(env.AP_KEEP, "yes");
    assert(env.CLAUDE_CONFIG_DIR.endsWith(".claude"));
};

// 진행 기록은 프로젝트마다 앱 데이터 폴더의 고유한 경로를 쓰고, 작업 폴더는 프로젝트 git이 추적하지 않도록 만든다.
const checkProjectPaths = (context) => {
    const { getProjectDir, getWorkDir, getProgressFile, ensureWorkDir } = autopilotUtil;
    const dataDir = path.join(context.testDir, "appdata");
    const projectDir = path.join(context.testDir, "paths project 한글");
    const otherProjectDir = path.join(context.testDir, "other", "paths project 한글");

    fs.mkdirSync(projectDir);
    fs.mkdirSync(otherProjectDir, { recursive: true });
    fs.writeFileSync(path.join(context.testDir, "not-a-dir"), "");

    assert.equal(getProjectDir(projectDir), path.resolve(projectDir));
    assert.throws(() => getProjectDir(""), /프로젝트 폴더/);
    assert.throws(() => getProjectDir(path.join(context.testDir, "missing")), /프로젝트 폴더/);
    assert.throws(() => getProjectDir(path.join(context.testDir, "not-a-dir")), /프로젝트 폴더/);

    const progressFile = getProgressFile(projectDir, dataDir);

    assert.equal(progressFile, getProgressFile(projectDir, dataDir));
    assert.notEqual(progressFile, getProgressFile(otherProjectDir, dataDir));
    assert.match(path.relative(dataDir, progressFile), /^AutoPilot[\\/]projects[\\/]paths project 한글-[0-9a-f]{8}[\\/]AUTOPILOT_PROGRESS\.md$/);

    // 기본 위치는 %APPDATA%다.
    if (process.env.APPDATA) {
        assert(getProgressFile(projectDir).startsWith(path.join(process.env.APPDATA, "AutoPilot", "projects")));
    }
    assert(path.relative(projectDir, progressFile).startsWith(".."), "진행 기록은 프로젝트 밖에 있어야 한다");

    const workDir = getWorkDir(projectDir);

    assert.equal(workDir, path.join(projectDir, "autopilot"));

    ensureWorkDir(workDir);

    assert.equal(fs.readFileSync(path.join(workDir, ".gitignore"), "utf8"), "*\n");

    // 이미 있는 .gitignore는 덮어쓰지 않는다.
    fs.writeFileSync(path.join(workDir, ".gitignore"), "/progress/\n");

    ensureWorkDir(workDir);

    assert.equal(fs.readFileSync(path.join(workDir, ".gitignore"), "utf8"), "/progress/\n");
};

const checkProgressArchive = (context) => {
    const { archiveProgressRecord } = progressUtil;
    const archiveRoot = path.join(context.testDir, "archive");
    const archiveDir = path.join(archiveRoot, "progress");
    const progressFile = path.join(archiveRoot, "AUTOPILOT_PROGRESS.md");

    fs.mkdirSync(archiveDir, { recursive: true });

    assert.equal(
        archiveProgressRecord(progressFile, archiveDir, "test", () => {}),
        ""
    );

    // 상한 줄은 그대로 두고 그보다 한 줄 많을 때부터 보관한다.
    for (const lineCount of [PROGRESS_MAX_LINES, PROGRESS_MAX_LINES + 1]) {
        const content = BOM + Array.from({ length: lineCount }, (_, index) => `${index} 한글`).join("\r\n") + "\r\n";

        fs.writeFileSync(progressFile, content);

        const cleanupPrompt = archiveProgressRecord(progressFile, archiveDir, "test", () => {});

        assert.equal(Boolean(cleanupPrompt), lineCount > PROGRESS_MAX_LINES);
        assert.equal(fs.readFileSync(progressFile, "utf8"), content);

        if (lineCount > PROGRESS_MAX_LINES) {
            assert(cleanupPrompt.includes(`\`${progressFile}\``));
            assert.equal(fs.readFileSync(path.join(archiveDir, fs.readdirSync(archiveDir)[0]), "utf8"), content);
        }
    }

    assert.equal(
        archiveProgressRecord(progressFile, path.join(context.testDir, "missing"), "test", () => {}),
        ""
    );
};

const checkStreamEvent = () => {
    const { handleStreamEvent } = streamUtil;
    const sessionStats = {};

    handleStreamEvent(JSON.stringify({ type: "rate_limit_event", rate_limit_info: { status: "allowed", resetsAt: 123 } }), sessionStats, () => {});

    assert.equal(sessionStats.resetAt, 123000);
    assert.equal(sessionStats.limitHit, undefined);

    handleStreamEvent(JSON.stringify({ type: "rate_limit_event", rate_limit_info: { status: "rejected" } }), sessionStats, () => {});

    assert.equal(sessionStats.limitHit, true);

    // JSON이지만 이벤트가 아닌 줄은 무시한다.
    for (const ignoredLine of ["null", "123", "not json"]) {
        handleStreamEvent(ignoredLine, sessionStats, () => {});
    }
};

// 진행 기록이 없으면 초기 내용을 만들고, 이미 있으면 건드리지 않는다.
const checkProgressEnsure = (context) => {
    const { ensureProgressRecord, PROGRESS_TEMPLATE } = progressUtil;
    const progressFile = path.join(context.testDir, "ensure", "deep", "AUTOPILOT_PROGRESS.md");

    ensureProgressRecord(progressFile);

    assert.equal(fs.readFileSync(progressFile, "utf8"), PROGRESS_TEMPLATE);

    fs.writeFileSync(progressFile, "이어갈 기록\n");

    ensureProgressRecord(progressFile);

    assert.equal(fs.readFileSync(progressFile, "utf8"), "이어갈 기록\n");
};

// 진행 기록은 원본을 보관하고 초기 상태로 되돌린다. 이미 초기 상태면 건드리지 않고, 보관에 실패하면 원본을 유지한다.
const checkProgressReset = (context) => {
    const { resetProgressRecord, PROGRESS_TEMPLATE } = progressUtil;
    const resetRoot = path.join(context.testDir, "reset root");
    const progressDir = path.join(resetRoot, "progress", "2026-10-10");
    const blockedDir = path.join(resetRoot, "blocked");
    const progressFile = path.join(resetRoot, "AUTOPILOT_PROGRESS.md");
    const original = `${PROGRESS_TEMPLATE}\n## 다음 작업\n- 한글 작업\n`;
    const logs = [];
    const writeLog = (message) => logs.push(message);
    const readRecord = () => fs.readFileSync(progressFile, "utf8");

    fs.mkdirSync(resetRoot, { recursive: true });

    // 기록이 없거나 이미 초기 상태면 보관본도 폴더도 만들지 않는다.
    assert.deepEqual(resetProgressRecord(progressFile, progressDir, "2026-10-10", writeLog), { isDone: true, archivePath: "" });

    fs.writeFileSync(progressFile, PROGRESS_TEMPLATE);

    assert.deepEqual(resetProgressRecord(progressFile, progressDir, "2026-10-10", writeLog), { isDone: true, archivePath: "" });
    assert(!fs.existsSync(progressDir));

    fs.writeFileSync(progressFile, BOM + original);

    const resetResult = resetProgressRecord(progressFile, progressDir, "2026-10-10", writeLog);
    const archiveFile = path.join(progressDir, path.basename(resetResult.archivePath));

    assert.equal(resetResult.isDone, true);
    assert.match(resetResult.archivePath, /^autopilot\/progress\/2026-10-10\/AUTOPILOT_PROGRESS_[0-9a-f-]{36}\.md$/);
    assert.equal(fs.readFileSync(archiveFile, "utf8"), BOM + original);
    assert(readRecord().startsWith(PROGRESS_TEMPLATE));
    assert(readRecord().includes(resetResult.archivePath));
    assert(!readRecord().includes("한글 작업"));

    // 초기화한 기록을 다시 초기화하지 않으므로 보관본이 쌓이지 않는다.
    assert.deepEqual(resetProgressRecord(progressFile, progressDir, "2026-10-10", writeLog), { isDone: true, archivePath: "" });
    assert.equal(fs.readdirSync(progressDir).length, 1);

    // 보관할 수 없으면(날짜 폴더를 만들 수 없음) 원본을 유지한다.
    fs.writeFileSync(progressFile, original);
    fs.writeFileSync(blockedDir, "");

    assert.equal(resetProgressRecord(progressFile, path.join(blockedDir, "2026-10-10"), "2026-10-10", writeLog).isDone, false);
    assert.equal(readRecord(), original);
    assert.match(logs.at(-1), /초기화 실패, 기존 문서 유지/);
};

// 보관 기간이 지난 날짜 폴더의 로그·리포트만 지운다.
const checkRunFilePrune = (context) => {
    const { pruneRunFiles } = progressUtil;
    const progressRoot = path.join(context.testDir, "prune", "progress");
    const outsideDir = path.join(context.testDir, "prune", "outside");
    const seed = (...parts) => {
        const file = path.join(progressRoot, ...parts);

        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, "");

        return file;
    };
    const logs = [];

    // 기준일 2026-10-10, 보관 30일이면 2026-09-10부터 남기고 그 전 폴더는 정리 대상이다.
    seed("2026-09-09", "autopilot_120000_aaaa1111.log");
    seed("2026-09-09", "report_120000_aaaa1111.html");
    seed("2026-09-09", "AUTOPILOT_PROGRESS_aaaa1111.md");
    seed("2026-09-09", "TODO_COMPLETE");
    seed("2026-08-01", "autopilot_000000_cccc3333.log");
    seed("2026-09-10", "autopilot_120000_bbbb2222.log");
    seed("notes", "autopilot_120000_dddd4444.log");
    seed("STOP");

    // 링크로 이어진 폴더는 따라가지 않는다.
    fs.mkdirSync(outsideDir, { recursive: true });
    fs.writeFileSync(path.join(outsideDir, "autopilot_000000_eeee5555.log"), "");
    fs.symlinkSync(outsideDir, path.join(progressRoot, "2020-01-01"), "junction");

    assert.equal(
        pruneRunFiles(progressRoot, "2026-10-10", 0, (message) => logs.push(message)),
        0
    );
    assert.equal(
        pruneRunFiles(progressRoot, "2026-10-10", 30, (message) => logs.push(message)),
        3
    );

    assert(!fs.existsSync(path.join(progressRoot, "2026-08-01")));
    assert.deepEqual(fs.readdirSync(path.join(progressRoot, "2026-09-09")).sort(), ["AUTOPILOT_PROGRESS_aaaa1111.md", "TODO_COMPLETE"]);
    assert(fs.existsSync(path.join(progressRoot, "2026-09-10", "autopilot_120000_bbbb2222.log")));
    assert(fs.existsSync(path.join(progressRoot, "notes", "autopilot_120000_dddd4444.log")));
    assert(fs.existsSync(path.join(progressRoot, "STOP")));
    assert(fs.existsSync(path.join(outsideDir, "autopilot_000000_eeee5555.log")));
    assert.deepEqual(logs, ["[정리] 보관 기간 30일이 지난 로그·리포트 3개를 삭제했습니다."]);

    // 폴더가 없어도 오류 없이 넘어간다.
    assert.equal(
        pruneRunFiles(path.join(context.testDir, "missing"), "2026-10-10", 30, (message) => logs.push(message)),
        0
    );
    assert.equal(logs.length, 1);
};

export {
    checkInvalidProject,
    checkRunFilePrune,
    checkProgressEnsure,
    checkProgressReset,
    checkRunSettings,
    checkCommandArgs,
    checkClaudeArgs,
    checkRunEnv,
    checkProjectPaths,
    checkProgressArchive,
    checkStreamEvent
};

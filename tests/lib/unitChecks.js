import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { STATUS_FAILED } from "../../autopilot/src/utils/config.js";
import { runAutopilot } from "../../autopilot/src/services/autopilotService.js";
import settingsUtil from "../../autopilot/src/utils/settingsUtil.js";
import cliUtil from "../../autopilot/src/utils/cliUtil.js";
import progressUtil from "../../autopilot/src/utils/progressUtil.js";
import streamUtil from "../../autopilot/src/utils/streamUtil.js";
import autopilotUtil from "../../autopilot/src/utils/autopilotUtil.js";

const BOM = String.fromCodePoint(0xfeff);

const checkInvalidKit = async (context, errorMessages) => {
    const invalidRunResult = await runAutopilot({ kitDir: path.join(context.testDir, "missing") });

    assert.equal(invalidRunResult.status, STATUS_FAILED);
    assert.equal(invalidRunResult.error.code, "AUTOPILOT_ERROR");
    assert.equal(invalidRunResult.data, undefined);
    assert(errorMessages.some((message) => message.includes("키트를 대상 프로젝트")));
};

const checkRunSettings = () => {
    const { getRunSettings } = settingsUtil;
    const now = new Date(2026, 9, 8, 12, 0, 0);
    const runSettings = getRunSettings("## 실행시간\r\n1999년 오후 4시 30분까지\r\n## 정책\r\n\r\n지시개선\r\n", "", "", now);

    assert.equal(runSettings.deadline.getHours(), 16);
    assert.equal(runSettings.deadline.getMinutes(), 30);
    assert.equal(runSettings.policy, "지시개선");
    assert.equal(getRunSettings("", "07:00", "", now).deadline.getDate(), 9);
    assert.equal(getRunSettings("## 정책\n자율개선 대신 지시개선으로\n", "", "", now).policy, "자율개선");
    assert.equal(getRunSettings("## 정책\n**지시개선**\n", "23:00", "AUTO", now).policy, "자율개선");
    assert.equal(getRunSettings("## 실행시간\n오전 12시\n", "", "", now).deadline.getHours(), 0);
    assert.equal(getRunSettings("## 실행시간\n오후 12시\n", "", "", now).deadline.getHours(), 12);

    for (const invalidEndTime of ["24:00", "12:60", "1:00", "nope"]) {
        assert.throws(() => getRunSettings("", invalidEndTime));
    }

    assert.throws(() => getRunSettings("", "", "not-todo"));
    assert.throws(() => getRunSettings("", "", "constructor"));
};

const checkCommandArgs = () => {
    const { parseCommandArgs } = cliUtil;

    assert.throws(() => parseCommandArgs(["--effort", "high & echo bad"]));
    assert.throws(() => parseCommandArgs(["--unknown"]));
    assert.throws(() => parseCommandArgs(["23:00", "todo", "extra"]));
    assert.equal(parseCommandArgs(["constructor"]).endTime, "constructor");
    assert.equal(parseCommandArgs(["23:00", "todo", "--no-open"]).open, false);
    assert.equal(parseCommandArgs(["--model", "sonnet", "--effort", "max"]).model, "sonnet");
    assert.throws(() => parseCommandArgs(["--model", "gpt"]), /model/);
    assert.throws(() => parseCommandArgs(["--model"]));

    const { parseSetArgs } = cliUtil;

    assert.deepEqual(parseSetArgs(["--model", "haiku", "--effort", "low"]), { model: "haiku", effort: "low" });
    assert.deepEqual(parseSetArgs(["--effort", "xhigh"]), { effort: "xhigh" });

    for (const invalidArgs of [[], ["--no-open"], ["23:00"], ["--model", "gpt"], ["--effort", "extreme"], ["--model"]]) {
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

const checkProgressArchive = (context) => {
    const { archiveProgressRecord } = progressUtil;
    const archiveKit = path.join(context.testDir, "archive");
    const archiveDir = path.join(archiveKit, "progress");
    const progressFile = path.join(archiveKit, "AUTOPILOT_PROGRESS.md");

    fs.mkdirSync(archiveDir, { recursive: true });

    assert.equal(
        archiveProgressRecord(archiveKit, archiveDir, "test", () => {}),
        ""
    );

    // 200줄은 그대로 두고 201줄부터 보관한다.
    for (const lineCount of [200, 201]) {
        const content = BOM + Array.from({ length: lineCount }, (_, index) => `${index} 한글`).join("\r\n") + "\r\n";

        fs.writeFileSync(progressFile, content);

        const cleanupPrompt = archiveProgressRecord(archiveKit, archiveDir, "test", () => {});

        assert.equal(Boolean(cleanupPrompt), lineCount === 201);
        assert.equal(fs.readFileSync(progressFile, "utf8"), content);

        if (lineCount === 201) {
            assert.equal(fs.readFileSync(path.join(archiveDir, fs.readdirSync(archiveDir)[0]), "utf8"), content);
        }
    }

    assert.equal(
        archiveProgressRecord(archiveKit, path.join(context.testDir, "missing"), "test", () => {}),
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

export { checkInvalidKit, checkRunFilePrune, checkRunSettings, checkCommandArgs, checkClaudeArgs, checkProgressArchive, checkStreamEvent };

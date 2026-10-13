import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { listRuns, readRun, deleteRun, getRunFiles, MAX_DETAIL_LINES } = require("../desktop/runHistory.cjs");

const DAY = "2026-10-13";
const OTHER_DAY = "2026-10-12";
const COMPLETE_LINES = [
    "Claude Code AutoPilot",
    "Project : C:\\work\\app",
    "Deadline : 2026-10-14 07:00:00 (default)",
    "Policy : auto (default)",
    "[1회차] 시작 - 남은 시간 480분 (model opus, effort high)",
    "23:15:10   > Read C:/work/app/search.js",
    "23:15:11   > Edit C:/work/app/search.js",
    "23:15:12 인덱스를 쓰도록 고쳤어요.",
    "    성과: 응답 1.2초 → 0.2초",
    "[커밋] abc1234 +10 -2 검색 인덱스 사용",
    "[1회차] 완료",
    "[2회차] 시작 - 남은 시간 400분",
    "[커밋] def5678 +5 -1 테스트 보강",
    "[2회차] 완료",
    "AutoPilot 종료 - 예정 시각 도달 (2회차)"
];

const createProject = () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "autopilot-history-"));

    fs.mkdirSync(path.join(projectDir, ".git"));
    fs.mkdirSync(path.join(projectDir, ".autopilot", "progress"), { recursive: true });

    return projectDir;
};

const writeRun = (projectDir, day, name, content) => {
    const dayDir = path.join(projectDir, ".autopilot", "progress", day);

    fs.mkdirSync(dayDir, { recursive: true });
    fs.writeFileSync(path.join(dayDir, name), content);

    return path.join(dayDir, name);
};

const checkSummary = async (projectDir) => {
    writeRun(projectDir, DAY, "autopilot_231500_aaaaaaaa.log", COMPLETE_LINES.join("\n") + "\n");
    writeRun(projectDir, DAY, "report_231500_aaaaaaaa.html", "<html></html>");

    const [run] = await listRuns(projectDir);

    assert.equal(run.id, `${DAY}/autopilot_231500_aaaaaaaa.log`);
    assert.equal(run.startedAt, new Date(2026, 9, 13, 23, 15, 0).getTime());
    assert(run.endedAt > run.startedAt || run.endedAt === 0);
    assert.equal(run.reason, "예정 시각 도달");
    assert.equal(run.policy, "auto");
    assert.equal(run.roundCount, 2);
    assert.equal(run.commitCount, 2);
    assert.equal(run.insertions, 15);
    assert.equal(run.deletions, 3);
    assert.equal(run.toolCalls, 2);
    assert.equal(run.filesEdited, 1);
    assert.deepEqual(run.gains, [{ round: 1, text: "응답 1.2초 → 0.2초" }]);
    assert.equal(run.headline, "응답 1.2초 → 0.2초");
    assert.equal(run.hasReport, true);
    assert.equal(run.isEmpty, false);
    assert.equal(run.isUnreadable, false);
    assert.equal(run.isPartial, false);
    assert.equal(run.isActive, false);

    const detail = await readRun(projectDir, run.id);

    assert.deepEqual(detail.lines, COMPLETE_LINES);
    assert.equal(detail.omittedLines, 0);
    assert.equal(detail.run.id, run.id);
};

// 최근 실행이 먼저 오고, 날짜 폴더와 파일 이름에 맞지 않는 항목은 목록에 들어오지 않는다.
const checkListing = async (projectDir) => {
    writeRun(projectDir, DAY, "autopilot_090000_bbbbbbbb.log", COMPLETE_LINES.join("\n"));
    writeRun(projectDir, OTHER_DAY, "autopilot_220000_cccccccc.log", COMPLETE_LINES.join("\n"));
    writeRun(projectDir, DAY, "notes.txt", "x");
    writeRun(projectDir, DAY, "autopilot_bad name.log", "x");
    writeRun(projectDir, "not-a-date", "autopilot_100000_dddddddd.log", COMPLETE_LINES.join("\n"));
    fs.mkdirSync(path.join(projectDir, ".autopilot", "progress", DAY, "autopilot_120000_eeeeeeee.log"));

    const runs = await listRuns(projectDir);

    assert.deepEqual(
        runs.map((run) => run.id),
        [`${DAY}/autopilot_231500_aaaaaaaa.log`, `${DAY}/autopilot_090000_bbbbbbbb.log`, `${OTHER_DAY}/autopilot_220000_cccccccc.log`]
    );
    assert.equal((await listRuns(projectDir, { limit: 1 })).length, 1);
    assert.equal((await listRuns(projectDir, { limit: 0 })).length, 1);
    assert.equal((await listRuns(projectDir, { limit: Number.NaN })).length, 1);

    const activeFile = path.join(projectDir, ".autopilot", "progress", DAY, "autopilot_090000_bbbbbbbb.log");
    const active = await listRuns(projectDir, { activeLogFile: activeFile });

    assert.deepEqual(
        active.map((run) => run.isActive),
        [false, true, false]
    );
    assert.deepEqual(await listRuns(path.join(projectDir, "missing")), []);
};

// 깨지거나 끝맺음이 없는 로그도 목록에서 빠지지 않고 읽을 수 있는 만큼만 요약한다.
const checkBrokenLogs = async (projectDir) => {
    writeRun(projectDir, DAY, "autopilot_010000_f0000001.log", "");
    writeRun(projectDir, DAY, "autopilot_010100_f0000002.log", Buffer.from([0xff, 0xfe, 0x00, 0x01, 0x02, 0x80, 0x81, 0xc3, 0x28, 0x0a, 0xff, 0xff]));
    writeRun(projectDir, DAY, "autopilot_010200_f0000003.log", COMPLETE_LINES.slice(0, 10).join("\n") + "\n[2회차] 시작 - 남은 시");
    writeRun(projectDir, DAY, "autopilot_010300_f0000004.log", "\ufeff" + COMPLETE_LINES.join("\r\n") + "\r\n");
    writeRun(
        projectDir,
        DAY,
        "autopilot_010400_f0000005.log",
        ["Project : x", "[1회차] 시작 - 남은 시간 60분", "23:00:00 " + "가\u0000\u001b[31m".repeat(3000), "[커밋] 해시없음", "[999999999999회차] 완료", "AutoPilot 종료 - 이유 (회차)"].join("\n")
    );

    const runs = new Map((await listRuns(projectDir)).map((run) => [run.id.split("/")[1], run]));
    const empty = runs.get("autopilot_010000_f0000001.log");
    const garbage = runs.get("autopilot_010100_f0000002.log");
    const truncated = runs.get("autopilot_010200_f0000003.log");
    const crlf = runs.get("autopilot_010300_f0000004.log");
    const noisy = runs.get("autopilot_010400_f0000005.log");

    assert.equal(empty.isEmpty, true);
    assert.equal(empty.isUnreadable, false);
    assert.equal(empty.roundCount, 0);
    assert.equal(garbage.isEmpty, true);
    assert.equal(garbage.isUnreadable, false);

    // 끝이 잘린 로그는 읽은 만큼만 보여주고 끝맺음 사유는 비어 있다.
    assert.equal(truncated.isEmpty, false);
    assert.equal(truncated.reason, "");
    assert.equal(truncated.roundCount, 1);
    assert.equal(truncated.commitCount, 1);

    // BOM과 CRLF가 섞여도 같은 요약이 나온다.
    assert.equal(crlf.reason, "예정 시각 도달");
    assert.equal(crlf.roundCount, 2);
    assert.equal(crlf.commitCount, 2);

    // 제어 문자·긴 줄·어긋난 줄은 요약을 망가뜨리지 않는다.
    assert.equal(noisy.isEmpty, false);
    assert.equal(noisy.roundCount, 1);
    assert.equal(noisy.reason, "");

    const detail = await readRun(projectDir, noisy.id);

    assert(detail.lines.every((line) => line.length <= 2000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(line)));
    assert.equal((await readRun(projectDir, garbage.id)).lines.length, 2);
};

const checkLargeLog = async (projectDir) => {
    const filler = `23:00:00 ${"가".repeat(1000)}\n`;
    const head = COMPLETE_LINES.slice(0, 4).join("\n") + "\n";
    const tail = COMPLETE_LINES.slice(4).join("\n") + "\n";
    const target = writeRun(projectDir, OTHER_DAY, "autopilot_030000_a0000001.log", head);

    fs.appendFileSync(target, filler.repeat(Math.ceil((17 * 1024 * 1024) / Buffer.byteLength(filler))));
    fs.appendFileSync(target, tail);

    const run = (await listRuns(projectDir)).find((item) => item.id.endsWith("autopilot_030000_a0000001.log"));

    assert.equal(run.isPartial, true);
    assert.equal(run.reason, "예정 시각 도달");
    assert.equal(run.commitCount, 2);

    const detail = await readRun(projectDir, run.id);

    assert(detail.lines.length <= MAX_DETAIL_LINES);
    assert(detail.omittedLines >= 0);
    assert.equal(detail.lines.at(-1), COMPLETE_LINES.at(-1));
    assert.equal(detail.run.isPartial, true);

    const lineCount = MAX_DETAIL_LINES + 500;
    const manyLines = writeRun(projectDir, OTHER_DAY, "autopilot_040000_a0000002.log", Array.from({ length: lineCount }, (item, index) => `23:00:00 문장 ${index}`).join("\n"));
    const many = await readRun(projectDir, `${OTHER_DAY}/${path.basename(manyLines)}`);

    assert.equal(many.lines.length, MAX_DETAIL_LINES);
    assert.equal(many.omittedLines, 500);
    assert.equal(many.lines.at(-1), `23:00:00 문장 ${lineCount - 1}`);
};

// 렌더러가 보낸 id는 형식을 검사하고, 진행 기록 폴더 밖을 가리키는 로그는 읽지 않는다.
const checkSafety = async (projectDir) => {
    for (const id of ["../../autopilot_1.log", `${DAY}/../../x.log`, `${DAY}\\autopilot_1_a.log`, `${DAY}/autopilot_1_a.txt`, "2026-10-13/autopilot_1_a.log/../x", "", null, undefined, 42, {}]) {
        assert.equal(getRunFiles(projectDir, id), null);
        await assert.rejects(() => readRun(projectDir, id));
    }

    await assert.rejects(() => readRun(projectDir, `${DAY}/autopilot_999999_ffffffff.log`));

    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "autopilot-outside-"));
    const outsideFile = path.join(outsideDir, "secret.log");
    const linkPath = path.join(projectDir, ".autopilot", "progress", DAY, "autopilot_050000_b0000001.log");

    fs.writeFileSync(outsideFile, COMPLETE_LINES.join("\n"));

    try {
        fs.symlinkSync(outsideFile, linkPath);
    } catch {
        return;
    }

    assert.equal(
        (await listRuns(projectDir)).some((run) => run.id.endsWith("autopilot_050000_b0000001.log")),
        false
    );
    await assert.rejects(() => readRun(projectDir, `${DAY}/autopilot_050000_b0000001.log`));
};

// 로그가 목록을 만든 뒤에 사라지거나 바뀌어도 오류 없이 읽을 수 없음으로 표시한다.
const checkUnreadable = async (projectDir) => {
    const target = writeRun(projectDir, DAY, "autopilot_060000_c0000001.log", COMPLETE_LINES.join("\n"));
    const before = (await listRuns(projectDir)).find((run) => run.id.endsWith("autopilot_060000_c0000001.log"));

    assert.equal(before.reason, "예정 시각 도달");

    fs.appendFileSync(target, "\n23:59:59 한 줄 더\n");

    const changed = (await listRuns(projectDir)).find((run) => run.id.endsWith("autopilot_060000_c0000001.log"));

    assert.equal(changed.reason, "예정 시각 도달");
    assert.equal(changed.toolCalls, before.toolCalls);

    fs.rmSync(target);

    await assert.rejects(() => readRun(projectDir, before.id));
    assert.equal(
        (await listRuns(projectDir)).some((run) => run.id === before.id),
        false
    );
};

// 지우면 그 실행의 로그·리포트만 사라지고, 다른 파일과 진행 중인 실행은 그대로다.
const checkDelete = async (projectDir) => {
    const deleteDay = "2026-09-01";
    const log = writeRun(projectDir, deleteDay, "autopilot_070000_d0000001.log", COMPLETE_LINES.join("\n") + "\n");
    const report = writeRun(projectDir, deleteDay, "report_070000_d0000001.html", "<html></html>");
    const marker = writeRun(projectDir, deleteDay, "TODO_COMPLETE", "");
    const other = writeRun(projectDir, deleteDay, "autopilot_080000_d0000002.log", COMPLETE_LINES.join("\n") + "\n");
    const id = `${deleteDay}/autopilot_070000_d0000001.log`;

    await assert.rejects(() => deleteRun(projectDir, id, { activeLogFile: log }), /진행 중/);
    assert(fs.existsSync(log));

    for (const badId of ["../x.log", `${deleteDay}/TODO_COMPLETE`, `${deleteDay}/report_070000_d0000001.html`, "", null, 42]) {
        await assert.rejects(() => deleteRun(projectDir, badId));
    }

    assert(fs.existsSync(marker) && fs.existsSync(report));

    await deleteRun(projectDir, id);

    assert.equal(fs.existsSync(log), false);
    assert.equal(fs.existsSync(report), false);
    assert(fs.existsSync(marker) && fs.existsSync(other));
    assert.equal(
        (await listRuns(projectDir)).some((run) => run.id === id),
        false
    );
    await assert.rejects(() => deleteRun(projectDir, id));

    // 날짜 폴더에 다른 파일이 없으면 폴더도 함께 지워진다.
    fs.rmSync(marker);
    await deleteRun(projectDir, `${deleteDay}/autopilot_080000_d0000002.log`);

    assert.equal(fs.existsSync(path.dirname(log)), false);
};

const checkHistory = async () => {
    const projectDir = createProject();

    try {
        await checkSummary(projectDir);
        await checkListing(projectDir);
        await checkBrokenLogs(projectDir);
        await checkLargeLog(projectDir);
        await checkSafety(projectDir);
        await checkUnreadable(projectDir);
        await checkDelete(projectDir);

        console.log("Desktop history checks passed.");
    } finally {
        fs.rmSync(projectDir, { recursive: true, force: true });
    }
};

await checkHistory();

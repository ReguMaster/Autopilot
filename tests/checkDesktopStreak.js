import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { listRunDays } = require("../desktop/runHistory.cjs");
const { createStreakStore, sanitizeDays, MAX_DAYS } = require("../desktop/streakStore.cjs");

const WITH_ROUNDS =
    ["Claude Code AutoPilot", "Project : C:\\work\\app", "[1회차] 시작 - 남은 시간 480분 (model opus, effort high)", "[1회차] 완료", "AutoPilot 종료 - 예정 시각 도달 (1회차)"].join("\n") + "\n";
// 시작 단계에서 실패해 회차가 없는 실행
const WITHOUT_ROUNDS = ["Claude Code AutoPilot", "Project : C:\\work\\app", "오류: claude 실행 파일을 찾지 못했습니다"].join("\n") + "\n";

const createProject = () => {
    const projectDir = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), "autopilot-streak-"));

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

const checkListRunDays = async (projectDir) => {
    assert.deepEqual(await listRunDays(projectDir), []);

    writeRun(projectDir, "2026-10-12", "autopilot_230000_aaaaaaaa.log", WITH_ROUNDS);
    writeRun(projectDir, "2026-10-13", "autopilot_230500_bbbbbbbb.log", WITHOUT_ROUNDS);
    writeRun(projectDir, "2026-10-13", "autopilot_231000_cccccccc.log", "");
    writeRun(projectDir, "2026-10-14", "autopilot_000100_dddddddd.log", WITHOUT_ROUNDS);
    writeRun(projectDir, "2026-10-14", "autopilot_230000_eeeeeeee.log", WITH_ROUNDS);
    writeRun(projectDir, "2026-10-15", "report_230000_ffffffff.html", "<html></html>");
    fs.mkdirSync(path.join(projectDir, ".autopilot", "progress", "not-a-day"));

    // 회차가 없는 실행과 빈 로그만 있는 날은 세지 않고, 같은 날 다른 실행에 회차가 있으면 센다.
    assert.deepEqual(await listRunDays(projectDir), ["2026-10-12", "2026-10-14"]);
    assert.deepEqual(await listRunDays(projectDir, { skipDays: new Set(["2026-10-12"]) }), ["2026-10-14"]);
};

const checkStore = async (projectDir) => {
    const dir = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), "autopilot-streak-store-"));
    const file = path.join(dir, "streaks.json");
    const store = createStreakStore({ file: file, getKey: (target) => path.basename(target) });
    const key = path.basename(projectDir);

    assert.deepEqual(await store.refresh(projectDir), ["2026-10-12", "2026-10-14"]);

    const saved = JSON.parse(fs.readFileSync(file, "utf8"));

    assert.equal(saved.version, 1);
    assert.deepEqual(saved.projects[key].days, ["2026-10-12", "2026-10-14"]);

    // 보관 기간이 지나 로그가 지워져도 적어 둔 날은 남고, 새로 생긴 날은 더해진다.
    fs.rmSync(path.join(projectDir, ".autopilot", "progress", "2026-10-12"), { recursive: true });
    writeRun(projectDir, "2026-10-16", "autopilot_230000_aaaaaaa1.log", WITH_ROUNDS);

    assert.deepEqual(await store.refresh(projectDir), ["2026-10-12", "2026-10-14", "2026-10-16"]);

    // 겹친 요청도 같은 결과로 끝나고 저장이 서로 덮어쓰지 않는다.
    writeRun(projectDir, "2026-10-17", "autopilot_230000_aaaaaaa2.log", WITH_ROUNDS);

    const results = await Promise.all([store.refresh(projectDir), store.refresh(projectDir), store.refresh(projectDir)]);

    for (const days of results) {
        assert.deepEqual(days, ["2026-10-12", "2026-10-14", "2026-10-16", "2026-10-17"]);
    }

    assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")).projects[key].days, ["2026-10-12", "2026-10-14", "2026-10-16", "2026-10-17"]);

    // 다른 프로젝트의 기록과 섞이지 않는다.
    const other = createProject();

    writeRun(other, "2026-10-20", "autopilot_230000_aaaaaaa3.log", WITH_ROUNDS);

    assert.deepEqual(await store.refresh(other), ["2026-10-20"]);
    assert.deepEqual(await store.refresh(projectDir), ["2026-10-12", "2026-10-14", "2026-10-16", "2026-10-17"]);

    // 깨진 파일은 비워 둔 것으로 보고 로그에서 다시 만든다.
    fs.writeFileSync(file, "{ broken");

    assert.deepEqual(await store.refresh(projectDir), ["2026-10-14", "2026-10-16", "2026-10-17"]);

    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(other, { recursive: true, force: true });
};

const checkSanitize = () => {
    assert.deepEqual(sanitizeDays(["2026-10-02", "2026-10-01", "2026-10-02", "x", 5, null, "2026-1-1", "2026-10-03T00:00"]), ["2026-10-01", "2026-10-02"]);
    assert.deepEqual(sanitizeDays("nope"), []);
    assert(MAX_DAYS >= 366);
};

const projectDir = createProject();

try {
    checkSanitize();
    await checkListRunDays(projectDir);
    await checkStore(projectDir);
} finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
}

console.log("Desktop streak checks passed.");

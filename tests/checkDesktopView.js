import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const EXPORTED_NAMES = ["MODEL_LABELS", "formatDuration", "formatClock", "formatDeadline", "formatOptions", "getLineKind", "getRunPhase", "getRoundTone", "formatRoundTime", "getEngineVersionNote"];

// 브라우저의 클래식 스크립트처럼 DOM 없이 viewFormat.js만 불러와 순수 함수를 꺼낸다.
const loadViewFormat = () => {
    const source = fs.readFileSync(path.join(import.meta.dirname, "../desktop/viewFormat.js"), "utf8");

    return vm.runInNewContext(`${source}\n({ ${EXPORTED_NAMES.join(", ")} })`);
};

const checkFormatting = ({ formatDuration, formatClock, formatDeadline, formatOptions }) => {
    assert.equal(formatDuration(0), "00:00:00");
    assert.equal(formatDuration(3661000), "01:01:01");
    assert.equal(formatDuration(59999), "00:00:59");
    assert.equal(formatDuration(100 * 3600000), "100:00:00");
    assert.equal(formatDuration(-5000), "00:00:00");

    const morning = new Date(2026, 9, 10, 7, 5).getTime();

    assert.equal(formatClock(morning), "07:05");
    assert.equal(formatDeadline(morning), "10월 10일 07:05");

    assert.equal(formatOptions("opus", "high"), "Opus · high");
    assert.equal(formatOptions("unknown-model", "low"), "unknown-model · low");
    assert.equal(formatOptions("", "high"), "-");
};

const checkLineKind = ({ getLineKind }) => {
    const cases = [
        [{ stream: "err", text: "x" }, "err"],
        [{ stream: "out", text: "[stderr] boom" }, "err"],
        [{ stream: "app", text: "[앱] 시작" }, "app"],
        [{ stream: "out", text: "[3회차] 완료" }, "round"],
        [{ stream: "out", text: "AutoPilot 종료 - 예정 시각 도달 (3회차)" }, "round"],
        [{ stream: "out", text: "[사용량 한도] 05:30까지 대기" }, "warn"],
        [{ stream: "out", text: "12:00:00 [결과] success · 3턴" }, "ok"],
        [{ stream: "out", text: "12:00:00   > Bash ls" }, "tool"],
        [{ stream: "out", text: "12:00:00 일반 출력" }, ""],
        // 들여쓴 이어지는 줄은 제어 줄로 취급하지 않는다.
        [{ stream: "out", text: "    [9회차] 완료" }, ""]
    ];

    for (const [entry, kind] of cases) {
        assert.equal(getLineKind(entry), kind, entry.text);
    }
};

const checkPhases = ({ getRunPhase, getRoundTone }) => {
    const cases = [
        [{ status: "running" }, "실행 중", "run"],
        [{ status: "running", attached: true }, "실행 중 · 연결됨", "run"],
        // 연결한 엔진은 종료 코드를 알 수 없으므로(null) 사유로 판단한다.
        [{ status: "idle", endedAt: 1, exitCode: null, reason: "예정 시각 도달" }, "종료됨", "muted"],
        [{ status: "idle", endedAt: 1, exitCode: null, reason: "중단 요청" }, "중단됨", "warn"],
        [{ status: "idle", endedAt: 1, exitCode: null, reason: "강제 종료" }, "중단됨", "warn"],
        [{ status: "stopping" }, "종료 요청됨", "warn"],
        [{ status: "idle", endedAt: 0 }, "대기 중", "muted"],
        [{ status: "idle", endedAt: 1, exitCode: 0 }, "정상 종료", "ok"],
        [{ status: "idle", endedAt: 1, exitCode: 130, reason: "중단 요청" }, "중단됨", "warn"],
        [{ status: "idle", endedAt: 1, exitCode: -1, reason: "강제 종료" }, "중단됨", "warn"],
        [{ status: "idle", endedAt: 1, exitCode: 1, reason: "연속 4회 실패로 중단" }, "오류 종료", "danger"]
    ];

    for (const [state, label, tone] of cases) {
        const phase = getRunPhase(state);

        assert.equal(phase.label, label);
        assert.equal(phase.tone, tone);
    }

    const tones = [
        ["", "run"],
        ["완료", "ok"],
        ["실패 (exit 1)", "danger"],
        ["시한 초과", "danger"],
        ["commit 없음", "muted"],
        ["사용량 한도", "warn"],
        ["중단됨", "warn"]
    ];

    for (const [outcome, tone] of tones) {
        assert.equal(getRoundTone(outcome), tone, outcome);
    }
};

const checkRoundTime = ({ formatRoundTime }) => {
    const startedAt = new Date(2026, 9, 10, 7, 5).getTime();

    assert.equal(formatRoundTime({ timesKnown: true, startedAt: startedAt, endedAt: 0 }), "07:05 시작");
    assert.equal(formatRoundTime({ timesKnown: true, startedAt: startedAt, endedAt: startedAt + 90000 }), "07:05 시작, 1.5분");

    // 연결하면서 이미 쓰인 로그를 읽은 회차는 시각을 표시하지 않는다.
    assert.equal(formatRoundTime({ timesKnown: false, startedAt: startedAt, endedAt: startedAt }), "시각을 알 수 없어요");
};

const checkEngineVersionNote = ({ getEngineVersionNote }) => {
    const same = getEngineVersionNote("0.1.0", "0.1.0");

    assert.equal(same.summary, "앱 v0.1.0 · 엔진 v0.1.0");
    assert.equal(same.warning, "");

    const different = getEngineVersionNote("0.2.0", "0.1.0");

    assert.equal(different.summary, "앱 v0.2.0 · 엔진 v0.1.0");
    assert.match(different.warning, /버전이 달라요/);

    // --version을 모르는 이전 엔진은 버전이 비어 있다.
    const unknown = getEngineVersionNote("0.1.0", "");

    assert.match(unknown.summary, /확인하지 못했어요/);
    assert.match(unknown.warning, /이전 버전의 엔진/);
};

const checkViewFormat = () => {
    const viewFormat = loadViewFormat();

    checkFormatting(viewFormat);
    checkLineKind(viewFormat);
    checkPhases(viewFormat);
    checkRoundTime(viewFormat);
    checkEngineVersionNote(viewFormat);

    console.log("Desktop view checks passed.");
};

checkViewFormat();

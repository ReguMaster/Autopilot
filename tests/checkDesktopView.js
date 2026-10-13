import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const EXPORTED_NAMES = [
    "MODEL_LABELS",
    "formatDuration",
    "formatClock",
    "formatDeadline",
    "formatOptions",
    "getLineKind",
    "getRunPhase",
    "getRoundTone",
    "formatRoundTime",
    "shiftEndTime",
    "getEndTimeAfter",
    "formatTimeUntil",
    "formatUsageReset",
    "getUsageTone",
    "getView",
    "getGreeting",
    "getWorkSummary",
    "describeFinish",
    "getWaitSentence",
    "getTrack",
    "parseStoryLine",
    "describeTool",
    "createStory",
    "applyStoryEntry",
    "parseGain",
    "splitFigure",
    "describePastRun",
    "buildTranscript"
];

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

    assert.equal(formatOptions("opus", "high"), "Opus · High");
    assert.equal(formatOptions("sonnet", "xhigh"), "Sonnet · XHigh");
    assert.equal(formatOptions("unknown-model", "low"), "unknown-model · Low");
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

// 종료 시각은 날짜 없이 HH:mm이고, 비우면 07:00, 지난 시각은 다음 날이다(엔진과 같다).
const checkEndTime = ({ shiftEndTime, getEndTimeAfter, formatTimeUntil }) => {
    const at2232 = new Date(2026, 9, 10, 22, 32, 10).getTime();
    const at0700 = new Date(2026, 9, 10, 7, 0).getTime();

    assert.equal(shiftEndTime("", 60), "08:00");
    assert.equal(shiftEndTime("23:30", 60), "00:30");
    assert.equal(shiftEndTime("00:05", -10), "23:55");

    assert.equal(getEndTimeAfter(at2232, 60), "23:35");
    assert.equal(getEndTimeAfter(at2232, 180), "01:35");

    assert.equal(formatTimeUntil("", at2232), "8시간 28분 뒤");
    assert.equal(formatTimeUntil("23:00", at2232), "28분 뒤");
    assert.equal(formatTimeUntil("09:00", at0700), "2시간 뒤");
    assert.equal(formatTimeUntil("07:00", at0700), "24시간 뒤");
};

const checkUsageFormat = ({ formatUsageReset, getUsageTone }) => {
    const now = new Date(2026, 9, 13, 10, 0).getTime();
    const minutes = (count) => count * 60000;

    assert.equal(formatUsageReset(now + minutes(130), now), "12:10 리셋 · 2시간 10분 후");
    assert.equal(formatUsageReset(now + minutes(5), now), "10:05 리셋 · 5분 후");
    assert.equal(formatUsageReset(now + minutes(4 * 1440 + 3 * 60), now), "10월 17일 13:00 리셋 · 4일 3시간 후");
    assert.equal(formatUsageReset(now - minutes(1), now), "09:59 리셋 · 0분 후");
    assert.equal(formatUsageReset(0, now), "리셋 시각을 알 수 없어요");

    const tones = [
        [0, "ok"],
        [69.9, "ok"],
        [70, "warn"],
        [89, "warn"],
        [90, "danger"],
        [100, "danger"]
    ];

    for (const [percent, tone] of tones) {
        assert.equal(getUsageTone(percent), tone, String(percent));
    }
};

const createRound = (round, startedAt, endedAt, commits = [], timesKnown = true) => {
    return { round: round, startedAt: startedAt, endedAt: endedAt, outcome: endedAt ? "완료" : "", timesKnown: timesKnown, commits: commits };
};

const createState = (fields) => {
    return {
        status: "idle",
        startedAt: 0,
        endedAt: 0,
        deadlineAt: 0,
        exitCode: null,
        reason: "",
        phase: "",
        attached: false,
        rounds: [],
        work: { toolCalls: 0, filesRead: 0, filesEdited: 0 },
        ...fields
    };
};

const checkViewAndGreeting = ({ getView, getGreeting }) => {
    assert.equal(getView(createState({ status: "running" }), false), "run");
    assert.equal(getView(createState({ status: "stopping" }), true), "run");
    assert.equal(getView(createState({}), false), "ready");
    assert.equal(getView(createState({ endedAt: 1 }), false), "done");
    assert.equal(getView(createState({ endedAt: 1 }), true), "ready");

    const projectName = "Kirikomodo";

    assert.equal(getGreeting({ hour: 23, policy: "auto", endTime: "", projectName: projectName }).title, "오늘 밤에는 Kirikomodo에 무엇을 해 둘까요? 🌙");
    assert.equal(getGreeting({ hour: 8, policy: "auto", endTime: "", projectName: projectName }).title, "지금부터 Kirikomodo에 무엇을 해 둘까요? ☀️");
    assert.equal(getGreeting({ hour: 14, policy: "auto", endTime: "", projectName: projectName }).title, "지금부터 Kirikomodo에 무엇을 해 둘까요? ☕");
    assert.match(getGreeting({ hour: 23, policy: "auto", endTime: "", projectName: projectName }).lead, /07:00까지 .*스스로 고칠 곳/);
    assert.match(getGreeting({ hour: 23, policy: "todo", endTime: "05:30", projectName: projectName }).lead, /늦어도 05:30에는 멈춰요/);
    assert.match(getGreeting({ hour: 23, policy: "auto", endTime: "", projectName: "" }).title, /프로젝트를 골라/);
};

const checkFinishText = ({ getWorkSummary, describeFinish, getWaitSentence }) => {
    const morning = new Date(2026, 9, 14, 7, 0).getTime();
    const commits = [
        { hash: "a", insertions: 142, deletions: 21 },
        { hash: "b", insertions: 42, deletions: 16 }
    ];
    const finished = createState({
        endedAt: morning,
        exitCode: 0,
        reason: "예정 시각 도달",
        deadlineAt: morning,
        rounds: [createRound(1, 1, 2, commits), createRound(2, 3, 4)],
        work: { toolCalls: 186, filesRead: 41, filesEdited: 9 }
    });

    assert.deepEqual({ ...getWorkSummary(finished) }, { toolCalls: 186, filesRead: 41, filesEdited: 9, commits: 2, insertions: 184, deletions: 37 });
    assert.deepEqual({ ...describeFinish(finished) }, { title: "좋은 아침이에요.", lead: "2회차 동안 쉬지 않고 일해서 커밋 2개를 남겼어요. 종료 시각 07:00에 맞춰 멈췄어요." });

    const afternoon = new Date(2026, 9, 14, 15, 0).getTime();

    assert.equal(describeFinish({ ...finished, endedAt: afternoon }).title, "일을 마쳤어요.");
    assert.equal(describeFinish({ ...finished, exitCode: 1, reason: "연속 4회 실패로 중단" }).title, "도중에 멈췄어요.");
    assert.equal(describeFinish({ ...finished, exitCode: 130, reason: "중단 요청" }).title, "여기까지 하고 멈췄어요.");
    assert.equal(describeFinish({ ...finished, rounds: [createRound(1, 1, 2)] }).lead, "1회차 동안 일했지만 커밋으로 남길 만한 변경은 없었어요. 종료 시각 07:00에 맞춰 멈췄어요.");
    assert.equal(describeFinish({ ...finished, rounds: [], reason: "알 수 없는 사유" }).lead, "회차를 시작하기 전에 멈췄어요. 종료 사유: 알 수 없는 사유");

    assert.equal(getWaitSentence(createState({ status: "running", phase: "3회차 진행 중" })), "");
    assert.match(getWaitSentence(createState({ status: "stopping", phase: "현재 회차 후 종료 예정" })), /이번 회차를 마치는 대로/);
    assert.equal(getWaitSentence(createState({ status: "running", phase: "5분 후 재시도 대기" })), "잠깐 문제가 생겼어요. 5분 뒤에 다시 해 볼게요.");
    assert.equal(getWaitSentence(createState({ status: "running", phase: "사용량 한도 대기 (03:01:00까지)" })), "사용량 한도에 닿아서 잠깐 쉬고 있어요. 03:01에 다시 이어서 할게요.");
};

const checkTrack = ({ getTrack }) => {
    const minute = 60000;
    const start = new Date(2026, 9, 14, 0, 30).getTime();
    const state = createState({
        status: "running",
        startedAt: start,
        deadlineAt: start + 100 * minute,
        rounds: [createRound(1, start, start + 10 * minute, [{ hash: "a" }, { hash: "b" }]), createRound(2, start + 11 * minute, start + 14 * minute), createRound(3, start + 15 * minute, 0)]
    });
    const track = getTrack(state, start + 20 * minute);

    assert.equal(getTrack(createState({ startedAt: start }), start), null);
    assert.deepEqual(
        Array.from(track.segments, (segment) => [Math.round(segment.from), Math.round(segment.to), segment.isLive]),
        [
            [0, 10, false],
            [11, 14, false],
            [15, 20, true]
        ]
    );
    assert.deepEqual(
        Array.from(track.commits, (commit) => [commit.at, commit.count]),
        [[10, 2]]
    );
    assert.equal(track.head, 20);
    assert.equal(track.startText, "00:30");
    assert.equal(track.endText, "02:10");
    // 끝난 실행은 지금 위치가 없고, 다시 읽은 회차(시각 모름)는 그리지 않는다.
    assert.equal(getTrack({ ...state, status: "idle", endedAt: start + 20 * minute, rounds: [createRound(1, start, start + 10 * minute, [], false)] }, start).segments.length, 0);
};

const checkStory = ({ parseStoryLine, describeTool, createStory, applyStoryEntry, parseGain, splitFigure }) => {
    assert.deepEqual({ ...parseStoryLine("02:17:12   > Grep searchOrders") }, { type: "tool", time: "02:17:12", name: "Grep", argument: "searchOrders" });
    assert.deepEqual({ ...parseStoryLine("02:17:12   > TodoWrite") }, { type: "tool", time: "02:17:12", name: "TodoWrite", argument: "" });
    assert.deepEqual({ ...parseStoryLine("02:18:30 **읽어 보니** `orders` 표를 훑고 있었어요.") }, { type: "say", time: "02:18:30", text: "읽어 보니 orders 표를 훑고 있었어요." });
    assert.deepEqual({ ...parseStoryLine("    - 이어지는 줄") }, { type: "more", text: "이어지는 줄" });
    assert.deepEqual({ ...parseStoryLine("02:20:05 성과: 응답 1.2초 → 0.2초") }, { type: "gain", time: "02:20:05", text: "응답 1.2초 → 0.2초" });
    assert.equal(parseStoryLine("02:31:55 [결과] success · 42턴"), null);
    assert.equal(parseStoryLine("[1회차] 완료"), null);

    assert.equal(describeTool("Read", "C:\\work\\src\\searchController.js"), "searchController.js 파일을 차근차근 읽어 보고 있어요.");
    assert.equal(describeTool("Edit", "/repo/a.sql"), "a.sql 파일을 조심스럽게 고치고 있어요.");
    assert.equal(describeTool("Bash", "git add -A && git commit -m 'test: 보강'"), "지금까지 한 일을 커밋으로 남기고 있어요.");
    assert.equal(describeTool("Bash", "npm test -- admin"), "테스트를 돌려 보고 결과를 기다리고 있어요.");
    assert.equal(describeTool("Bash", "ls"), "터미널에서 명령을 실행하고 있어요.");
    assert.equal(describeTool("Mystery", ""), "Mystery 도구로 일하고 있어요.");

    const story = createStory();
    const out = (text) => applyStoryEntry(story, { stream: "out", text: text });

    out("Project : C:\\work");
    out("02:17:12   > Grep searchOrders");
    out("02:18:30   > Read C:\\work\\src\\search.js");

    // 도구만 온 동안에는 마지막 도구를 설명하는 문장 하나에 칩이 쌓인다.
    assert.equal(story.items.length, 1);
    assert.equal(story.items[0].isPhrase, true);
    assert.equal(story.items[0].text, "search.js 파일을 차근차근 읽어 보고 있어요.");
    assert.deepEqual(
        Array.from(story.items[0].tools, (tool) => `${tool.name} ${tool.detail}`),
        ["Grep searchOrders", "Read search.js"]
    );

    const phraseId = story.items[0].id;

    out("02:18:40 읽어 보니 주문 표 전체를 훑고 있었어요.");
    out("    성과: 응답 1.2초 → 0.2초");
    out("    그래서 인덱스를 쓰도록 바꿀게요.");

    // Claude의 문장이 오면 같은 묶음을 문장으로 바꾸고, 메시지 중간의 성과 줄 뒤 줄도 잇는다.
    assert.equal(story.items.length, 1);
    assert.equal(story.items[0].isPhrase, false);
    assert.notEqual(story.items[0].id, phraseId);
    assert.equal(story.items[0].text, "읽어 보니 주문 표 전체를 훑고 있었어요. 그래서 인덱스를 쓰도록 바꿀게요.");

    out("[stderr] 경고");
    out("    들여 쓴 stderr 줄");
    out("02:19:00 다음 문장이에요.");

    assert.deepEqual(
        Array.from(story.items, (item) => item.text),
        ["읽어 보니 주문 표 전체를 훑고 있었어요. 그래서 인덱스를 쓰도록 바꿀게요.", "다음 문장이에요."]
    );

    for (let index = 0; index < 10; index++) {
        out(`02:20:0${index} 문장 ${index}`);
    }

    assert.equal(story.items.length, 10);

    applyStoryEntry(story, { stream: "app", text: "[앱] 엔진을 시작했어요: autopilot" });

    assert.equal(story.items.length, 0);

    assert.deepEqual({ ...parseGain("관리자 검색 응답 시간 1.2초 → 0.2초") }, { label: "관리자 검색 응답 시간", before: "1.2초", after: "0.2초" });
    assert.deepEqual({ ...parseGain("번들 크기 820KB -> 610KB") }, { label: "번들 크기", before: "820KB", after: "610KB" });
    assert.deepEqual({ ...parseGain("테스트가 모두 통과했어요") }, { label: "테스트가 모두 통과했어요", before: "", after: "" });
    assert.deepEqual({ ...splitFigure("1.2초") }, { number: "1.2", unit: "초" });
    assert.deepEqual({ ...splitFigure("빠름") }, { number: "빠름", unit: "" });
};

const checkPastRuns = ({ describePastRun, buildTranscript }) => {
    const now = new Date(2026, 9, 14, 9, 0).getTime();
    const base = {
        id: "2026-10-13/autopilot_231500_ab12cd34.log",
        startedAt: new Date(2026, 9, 13, 23, 15).getTime(),
        endedAt: new Date(2026, 9, 14, 0, 35).getTime(),
        reason: "예정 시각 도달",
        deadlineAt: 0,
        roundCount: 3,
        commitCount: 5,
        insertions: 120,
        deletions: 30,
        headline: "검색 응답 1.2초 → 0.2초",
        isEmpty: false,
        isUnreadable: false,
        isPartial: false,
        isActive: false
    };
    const done = describePastRun(base, now);

    assert.equal(done.day, "어제");
    assert.equal(done.time, "23:15");
    assert.equal(done.duration, "1시간 20분");
    assert.deepEqual({ ...done.status }, { label: "정상 종료", tone: "ok" });
    assert.equal(done.meta, "3회차 · 커밋 5개 +120 −30");
    assert.match(done.lead, /3회차 동안 쉬지 않고 일해서 커밋 5개를 남겼어요\. 정해 둔 종료 시각에 맞춰 멈췄어요\./);
    assert.deepEqual(Array.from(done.notes), []);
    assert.equal(describePastRun({ ...base, startedAt: new Date(2026, 9, 14, 1, 0).getTime() }, now).day, "오늘");
    assert.equal(describePastRun({ ...base, startedAt: new Date(2026, 9, 10, 1, 0).getTime() }, now).day, "10월 10일 (토)");

    // 끝맺음 줄이 없거나 읽을 수 없거나 비어 있어도 같은 모양으로 설명한다.
    const unfinished = describePastRun({ ...base, reason: "" }, now);

    assert.deepEqual({ ...unfinished.status }, { label: "끝맺음 없음", tone: "muted" });
    assert.match(unfinished.notes[0], /끝맺음 줄이 없어요/);
    assert.deepEqual({ ...describePastRun({ ...base, reason: "", isActive: true }, now).status }, { label: "진행 중", tone: "run" });
    assert.equal(describePastRun({ ...base, reason: "", isActive: true }, now).notes.length, 0);
    assert.deepEqual({ ...describePastRun({ ...base, reason: "중단 요청" }, now).status }, { label: "중단됨", tone: "warn" });
    assert.deepEqual({ ...describePastRun({ ...base, reason: "연속 4회 실패로 중단" }, now).status }, { label: "오류 종료", tone: "danger" });
    assert.deepEqual({ ...describePastRun({ ...base, reason: "실행 오류: spawn" }, now).status }, { label: "오류 종료", tone: "danger" });
    assert.deepEqual({ ...describePastRun({ ...base, reason: "사용량 한도 리셋이 종료 시각 이후" }, now).status }, { label: "한도로 멈춤", tone: "warn" });
    assert.deepEqual({ ...describePastRun({ ...base, reason: "처음 보는 사유" }, now).status }, { label: "종료", tone: "muted" });
    assert.match(describePastRun({ ...base, reason: "처음 보는 사유" }, now).lead, /종료 사유: 처음 보는 사유/);

    const empty = describePastRun({ ...base, isEmpty: true, reason: "" }, now);

    assert.deepEqual({ ...empty.status }, { label: "내용 없음", tone: "muted" });
    assert.equal(empty.meta, "");
    assert.equal(empty.lead, "");
    assert.match(empty.notes[0], /읽을 수 있는 내용이 없어요/);

    const unreadable = describePastRun({ id: base.id, startedAt: 0, endedAt: 0, isUnreadable: true }, now);

    assert.deepEqual({ ...unreadable.status }, { label: "읽을 수 없음", tone: "danger" });
    assert.equal(unreadable.day, "날짜를 알 수 없어요");
    assert.equal(unreadable.time, "");
    assert.match(unreadable.notes[0], /읽지 못했어요/);
    assert.match(describePastRun({ ...base, isPartial: true }, now).notes.at(-1), /마지막 부분만/);
    assert.equal(describePastRun({ ...base, endedAt: base.startedAt + 1000 }, now).duration, "1분 미만");
    assert.equal(describePastRun({ ...base, endedAt: 0 }, now).duration, "");

    const transcript = buildTranscript([
        "Claude Code AutoPilot",
        "[1회차] 시작 - 남은 시간 60분 (model opus, effort high)",
        "12:00:01   > Read C:/app/search.js",
        "12:00:02   > Edit C:/app/search.js",
        "12:00:03 인덱스를 쓰도록 고쳤어요.",
        "    그래서 더 빨라질 거예요.",
        "    성과: 응답 1.2초 → 0.2초",
        "    다음엔 테스트를 돌릴게요.",
        "12:00:09   > Bash npm test",
        "[커밋] abc1234 +3 -1 검색 인덱스 사용",
        "[1회차] 완료",
        "[사용량 한도] 14:00까지 대기",
        "AutoPilot 종료 - 예정 시각 도달 (1회차)"
    ]);

    assert.deepEqual(
        Array.from(transcript.items, (item) => item.kind),
        ["round", "say", "gain", "work", "commit", "result", "notice", "finish"]
    );
    assert.equal(transcript.omitted, 0);
    assert.equal(transcript.items[0].options, "Opus · High");
    assert.equal(transcript.items[1].text, "인덱스를 쓰도록 고쳤어요. 그래서 더 빨라질 거예요. 다음엔 테스트를 돌릴게요.");
    assert.equal(transcript.items[1].count, 2);
    assert.deepEqual(
        Array.from(transcript.items[1].tools, (tool) => `${tool.name} ${tool.detail}`),
        ["Read search.js", "Edit search.js"]
    );
    assert.equal(transcript.items[2].text, "응답 1.2초 → 0.2초");
    assert.equal(transcript.items[3].count, 1);
    assert.deepEqual({ ...transcript.items[4] }, { kind: "commit", hash: "abc1234", insertions: 3, deletions: 1, subject: "검색 인덱스 사용" });
    assert.equal(transcript.items[5].tone, "ok");

    // 깨진 입력은 건너뛰고, 길거나 많은 입력은 자른다.
    const broken = buildTranscript([null, 42, undefined, "", "�����", "[ㅁㅁ회차] 시작", "99:99:99 형식만 맞는 줄", "    들여 쓴 줄만 있어요"]);

    assert.deepEqual(
        Array.from(broken.items, (item) => item.kind),
        ["say"]
    );
    assert.deepEqual(Array.from(buildTranscript(undefined).items), []);
    assert.deepEqual(Array.from(buildTranscript("문자열").items), []);
    assert.equal(buildTranscript(["12:00:00 " + "가".repeat(5000)]).items[0].text.length, 600);

    const many = buildTranscript(Array.from({ length: 2000 }, (item, index) => `12:00:00 문장 ${index}`));

    assert.equal(many.items.length, 1500);
    assert.equal(many.omitted, 500);
    assert.equal(many.items.at(-1).text, "문장 1999");
};

const checkViewFormat = () => {
    const viewFormat = loadViewFormat();

    checkViewAndGreeting(viewFormat);
    checkFinishText(viewFormat);
    checkTrack(viewFormat);
    checkStory(viewFormat);
    checkPastRuns(viewFormat);

    checkEndTime(viewFormat);
    checkFormatting(viewFormat);
    checkLineKind(viewFormat);
    checkPhases(viewFormat);
    checkRoundTime(viewFormat);
    checkUsageFormat(viewFormat);

    console.log("Desktop view checks passed.");
};

checkViewFormat();

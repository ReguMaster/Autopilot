const { NOW, MINUTE, HOUR, DAY, makeRun } = require("./data.cjs");

// README와 랜딩 페이지에 싣는 화면(docs/screenshots). 실제 프로젝트·사람이 보이지 않게 가칭 프로젝트와 가짜 계정만 쓴다.
// 찍은 PNG를 이름 그대로 docs/screenshots/에 옮기고, 랜딩 페이지(Autopilot-landing)는 그중 쓰는 것을 assets/screenshots/로 복사한다. --root는 절대 경로로 준다.
// electron tests/tools/ui/runScenes.cjs -- --root <저장소 절대 경로> --out <폴더> --scenes readme-ready,readme-running,...
const BOOKING = "D:/Projects/moa-booking";
const STORE = "D:/Projects/orbit-store";
const DOCS = "D:/Projects/lumen-docs";

const TOOL = (name, argument, time) => `${time}   > ${name} ${argument}`;
const TASKS = "동네 공방 원데이 클래스 예약 웹앱. 손님은 클래스와 날짜를 골라 자리를 예약하고, 운영자는 주간 수업표와 예약 명단을 한눈에 본다.";

const ACCOUNTS = {
    accounts: [{ id: "default", label: "기본 계정", shared: false }],
    activeId: "default",
    claudeDir: { path: "C:/Users/me/.claude", isAuto: true, exists: true },
    snapshots: {
        default: {
            profile: { name: "ReguMaster", email: "regumaster@example.com", plan: "Max 20x", organization: "" },
            limits: [
                { label: "5시간 한도", percent: 24, resetsAt: NOW + 3 * HOUR },
                { label: "주간 한도 (전체)", percent: 41, resetsAt: NOW + 4 * DAY },
                { label: "주간 한도 (Sonnet)", percent: 12, resetsAt: NOW + 4 * DAY }
            ],
            fetchedAt: NOW - MINUTE,
            error: null
        }
    },
    login: null
};
const PROVIDERS = {
    codex: {
        available: true,
        reason: "",
        models: [
            { id: "gpt-6.1-sol", label: "GPT-6.1-Sol" },
            { id: "gpt-6-astra", label: "GPT-6-Astra" }
        ],
        defaults: { model: "gpt-6.1-sol", effort: "medium" }
    }
};
const MODELS = [
    { id: "claude-opus-5-5", line: "opus" },
    { id: "claude-sonnet-5-5", line: "sonnet" },
    { id: "claude-haiku-5-5", line: "haiku" }
];

const getTabs = (bookingStatus = "idle", storeStatus = "idle") => [
    { projectDir: BOOKING, name: "moa-booking", status: bookingStatus },
    { projectDir: STORE, name: "orbit-store", status: storeStatus },
    { projectDir: DOCS, name: "lumen-docs", status: "idle" }
];

// 신규 개발 설정: 기획은 Codex가 메인이고 Claude와 협의, 디자인은 Claude가 메인이고 Codex가 따로 안을 낸다. 테스트/QA도 Codex가 맡는다.
const BUILD_SETTINGS = {
    projectDir: BOOKING,
    mode: "build",
    tasks: TASKS,
    mains: { plan: "codex", qa: "codex" },
    brainstorm: ["plan", "design"],
    debate: ["plan"],
    designFormat: "md",
    allow: ["deps", "large", "send"]
};
const phase = (name, overrides = {}) => ({ phase: name, awaiting: null, qaRetries: 0, securityRetries: 0, proposals: null, debate: null, ...overrides });
// 다른 탭은 단계가 없는 유지 보수 프로젝트로 보인다.
const phaseByProject = (bookingPhase) => ({ [BOOKING]: bookingPhase, [STORE]: null, [DOCS]: null });
const buildModel = (bookingPhase, extra = {}) => ({ buildPhase: bookingPhase, phaseByProject: phaseByProject(bookingPhase), providers: PROVIDERS, ...extra });
const BUILD_INIT = { settings: BUILD_SETTINGS, accounts: ACCOUNTS, models: MODELS, tabs: getTabs() };

const commit = (hash, insertions, deletions, subject) => ({ hash: hash, insertions: insertions, deletions: deletions, subject: subject });
const finished = (number, startedAt, minutes, commits, overrides = {}) => ({
    round: number,
    startedAt: startedAt,
    endedAt: startedAt + minutes * MINUTE,
    outcome: "완료",
    model: "claude-opus-5-5",
    effort: "high",
    commits: commits,
    timesKnown: true,
    ...overrides
});
const current = (number, startedAt, overrides = {}) => ({ ...finished(number, startedAt, 0, []), endedAt: 0, outcome: "", ...overrides });
const CODEX = { model: "", effort: "", runner: "codex" };
// Codex가 메인인 단계의 실행 상태(Codex 설정을 따르는 model·effort는 빈 값)
const CODEX_RUN = { runner: "codex", model: "", effort: "", requested: { runner: "codex", model: "claude-opus-5-5", effort: "high", codexModel: "", codexEffort: "" } };

// 신규 개발 한 건의 회차(기획 1 · 디자인 2 · 개발 3~5 · 테스트/QA 6 · 보안검토 7). 시작·끝은 실행 시작부터의 분이다.
const BUILD_ROUNDS = [
    { span: [0, 24], extra: CODEX, commits: [commit("5d0c2aa", 186, 0, "[ap] 기획: 합의안 확정")] },
    { span: [28, 59], extra: {}, commits: [commit("8b41e07", 312, 4, "[ap] 디자인: 화면 5개 와이어프레임")] },
    { span: [63, 109], extra: {}, commits: [commit("e02b5c9", 903, 0, "[ap] Next.js와 SQLite 기본 구조")] },
    { span: [113, 165], extra: {}, commits: [commit("3fa77d2", 241, 12, "[ap] 클래스 둘러보기와 날짜 고르기 화면")] },
    { span: [169, 217], extra: {}, commits: [commit("9c1e04a", 188, 21, "[ap] 남은 자리 계산과 정원 초과 예약 막기")] },
    { span: [221, 259], extra: CODEX, commits: [commit("c7d2f18", 96, 14, "[ap] 테스트/QA: 마감된 시간 안내와 E2E 18개")] },
    { span: [263, 292], extra: {}, commits: [commit("41ab9e3", 37, 8, "[ap] 보안검토: 예약 조회에 예약 번호 확인 추가")] }
];
// count회차까지의 기록. isLastCurrent면 마지막 회차가 진행 중이다.
const getBuildRounds = (base, count, isLastCurrent) =>
    BUILD_ROUNDS.slice(0, count).map(({ span: [start, end], extra, commits }, index) => {
        const startedAt = base + start * MINUTE;

        return isLastCurrent && index === count - 1 ? current(index + 1, startedAt, extra) : finished(index + 1, startedAt, end - start, commits, extra);
    });
// count회차가 20분 전에 시작해 진행 중인 신규 개발 실행
const buildRunState = (count, overrides = {}) => {
    const base = NOW - (BUILD_ROUNDS[count - 1].span[0] + 20) * MINUTE;

    return runState({ startedAt: base - 5 * MINUTE, rounds: getBuildRounds(base, count, true), round: count, phase: `${count}회차 진행 중`, ...overrides });
};
const runState = (overrides = {}) => ({
    status: "running",
    pid: 4242,
    startedAt: NOW - 2 * HOUR,
    deadlineAt: NOW + 4 * HOUR,
    endedAt: 0,
    attached: false,
    exitCode: null,
    reason: "",
    model: "claude-opus-5-5",
    effort: "high",
    requested: { model: "claude-opus-5-5", effort: "high" },
    project: BOOKING,
    policy: "자율개선",
    mode: "build",
    logFile: `${BOOKING}/.autopilot/progress/2026-09-01/autopilot_030000_x.log`,
    reportFile: `${BOOKING}/.autopilot/progress/2026-09-01/report_030000_x.html`,
    gains: [],
    ...overrides
});

// 기획 협의: 메인인 Codex가 먼저 말하고 Claude가 답한다. 마지막 말은 길어서 접혔다가 더 보기로 펴진다.
const DEBATE_TURNS = [
    { provider: "codex", at: NOW - 6 * MINUTE, message: "Claude 안의 주간 수업표는 좋아요. 다만 정원이 찬 수업에 대기 신청을 처음부터 넣어야 인기 클래스에서 손님을 놓치지 않아요." },
    { provider: "claude", at: NOW - 4 * MINUTE, message: "대기가 필요하다는 데 동의해요. 그래도 누구에게 먼저 알릴지 규칙이 커지니, 이번엔 '자리 나면 알림 받기' 버튼 하나만 두면 좋겠어요." },
    {
        provider: "codex",
        at: NOW - 2 * MINUTE,
        message:
            "좋아요, 알림 받기 버튼 하나로 줄여요. 자리가 나면 **신청 순서대로 한 명씩** 알리고 `30분` 안에 예약하지 않으면 다음 사람에게 넘겨요. 운영자 화면에는 대기 인원만 숫자로 보여 주고, 명단 관리는 다음 버전에서 다시 이야기해요. 결제는 둘 다 이번에 빼기로 했으니 화면은 5개로 끝내요."
    }
];
const PLAN_DOC = {
    kind: "file",
    path: "docs/autopilot/plan.md",
    isPartial: false,
    text: [
        "# 공방 원데이 클래스 예약 웹앱",
        "",
        "손님이 클래스와 날짜를 골라 자리를 예약하고, 운영자가 주간 수업표와 예약 명단을 보는 웹앱이에요.",
        "",
        "## 화면 5개",
        "- 손님: 클래스 둘러보기, 날짜와 시간 고르기, 예약 확인",
        "- 운영자: 주간 수업표, 클래스와 정원 관리",
        "",
        "## 기술 선택",
        "- Next.js 15, SQLite(Prisma), Tailwind. 새 라이브러리 5개(허용됨)",
        "- 손님은 전화번호와 예약 번호로 `예약 조회`",
        "",
        "## 이번에 하지 않는 것",
        "- 결제, 알림톡, 여러 공방",
        "",
        "## 개발 순서",
        "1. 데이터 구조와 남은 자리 계산",
        "2. 손님 화면",
        "3. 운영자 화면"
    ].join("\n")
};
const DEBATE_DOC = {
    kind: "file",
    path: "docs/autopilot/proposals/plan-debate.md",
    isPartial: false,
    text: [
        "# 기획 협의 기록",
        "",
        "Codex와 Claude가 2번 주고받았어요. 끝까지 맞추지 못한 쟁점이 남았어요.",
        "",
        "## 1번째 주고받기 - Codex",
        "",
        DEBATE_TURNS[0].message,
        "",
        "- 동의: 주간 수업표: 운영자가 한 주를 한눈에 봐요",
        "- 반대: 대기 신청 없이 시작하기 (이유: 인기 클래스에서 손님을 놓쳐요)",
        "",
        "## 1번째 주고받기 - Claude",
        "",
        DEBATE_TURNS[1].message,
        "",
        "- 바꾼 점: 자리 나면 알림 받기 버튼을 기능에 더해요",
        "",
        "## 2번째 주고받기 - Codex",
        "",
        DEBATE_TURNS[2].message,
        "",
        "## 2번째 주고받기 - Claude",
        "",
        "알림 순서 규칙은 좋아요. 첫 화면은 이번 주 수업을 날짜순으로 보여 주는 게 맞다고 봐요."
    ].join("\n")
};
const DISPUTES = [
    {
        id: "d1",
        title: "대기 알림 규칙",
        claude: "'자리 나면 알림 받기' 버튼 하나만 둬요. 순서 규칙은 몇 주 운영해 보고 정해요.",
        codex: "신청 순서대로 한 명씩 알리고, 30분 안에 예약하지 않으면 다음 사람에게 넘겨요."
    },
    {
        id: "d2",
        title: "첫 화면에 보여 줄 것",
        claude: "이번 주 수업을 날짜순으로 보여 줘요. 다시 온 손님이 빨리 찾아요.",
        codex: "인기 클래스를 큰 카드로 먼저 보여 줘요. 처음 온 손님이 둘러보기 좋아요."
    }
];
const DESIGN_DOC = {
    kind: "file",
    path: "docs/autopilot/design.md",
    isPartial: false,
    text: [
        "# 공방 클래스 예약 디자인",
        "",
        "## 공통 규칙",
        "- 강조색 테라코타 `#C8643B`, 배경 아이보리 `#FBF7F2`",
        "- 본문 16px, 버튼 높이 48px, 모서리 12px",
        "",
        "## 화면",
        "1. 클래스 둘러보기: 이번 주 수업 카드, 남은 자리 배지",
        "2. 날짜와 시간 고르기: 달력과 시간 칩, 마감된 시간은 흐리게",
        "3. 예약 확인: 요약 카드와 전화번호 입력",
        "4. 주간 수업표: 요일 × 시간 표, 칸마다 예약 수와 정원",
        "5. 클래스와 정원 관리: 목록과 편집 패널"
    ].join("\n")
};
const CODEX_DESIGN_DOC = {
    kind: "file",
    path: "docs/autopilot/proposals/design-codex.md",
    isPartial: false,
    text: [
        "# 공방 예약 디자인 안",
        "",
        "## 방향",
        "- 사진이 큰 카드와 짧은 설명",
        "- 강조색 올리브 `#5B6B3A`, 배경 흰색",
        "",
        "## 화면",
        "1. 홈: 인기 클래스 큰 카드 3개, 아래에 이번 주 일정",
        "2. 클래스 상세: 사진, 소요 시간, 준비물, 날짜 선택",
        "3. 예약 완료: 일정 저장과 공유하기",
        "4. 운영자 대시보드: 오늘 수업과 대기 인원",
        "5. 클래스 편집"
    ].join("\n")
};
const DESIGN_REVIEW_BY_CODEX = {
    kind: "file",
    path: "docs/autopilot/proposals/design-review-codex.md",
    isPartial: false,
    text: "- 휴대폰에서 시간 칩이 두 줄을 넘으면 접는 규칙이 필요해요\n- 마감된 시간을 흐리게만 하면 색약 손님이 구분하기 어려워요"
};
const DESIGN_REVIEW_BY_CLAUDE = {
    kind: "file",
    path: "docs/autopilot/proposals/design-review-claude.md",
    isPartial: false,
    text: "- 사진이 없는 클래스는 카드가 비어 보여요\n- 운영자 대시보드에 주간 보기가 없어요"
};

// 유지 보수 프로젝트(orbit-store)
const STORE_ROUNDS = [
    finished(1, NOW - 2 * HOUR, 34, [commit("b18e6d2", 64, 11, "[ap] 결제 재시도에 멱등 키를 붙여 중복 청구 방지")]),
    finished(2, NOW - HOUR - 20 * MINUTE, 41, [commit("f48e64d", 28, 5, "[ap] 상품 검색이 인덱스를 쓰도록 쿼리 정리")]),
    current(3, NOW - 35 * MINUTE)
];
const storeState = (overrides = {}) =>
    runState({
        startedAt: NOW - 2 * HOUR - 5 * MINUTE,
        deadlineAt: NOW + 5 * HOUR,
        project: STORE,
        mode: "maintain",
        phase: "3회차 진행 중",
        round: 3,
        rounds: STORE_ROUNDS,
        logFile: `${STORE}/.autopilot/progress/2026-09-01/autopilot_075500_x.log`,
        reportFile: `${STORE}/.autopilot/progress/2026-09-01/report_075500_x.html`,
        work: { toolCalls: 96, filesRead: 38, filesEdited: 9 },
        gains: [
            { round: 1, text: "결제 중복 청구 재현 4건 → 0건" },
            { round: 2, text: "검색 응답 시간 1.4초 → 0.2초" }
        ],
        ...overrides
    });
const STORE_RUNS = [
    makeRun(0, { headline: "검색 응답 시간 1.4초 → 0.2초", gains: [{ round: 2, text: "검색 응답 시간 1.4초 → 0.2초" }] }),
    makeRun(1, { reason: "사용량 한도로 종료", headline: "린트 경고 24 → 3" }),
    makeRun(2, { headline: "주문 목록 첫 응답 2.4MB → 36KB" })
];
const STORE_LINES = [
    "[앱] 엔진을 시작했어요",
    "[1회차] 시작 - 남은 시간 420분 (model claude-opus-5-5, effort high)",
    TOOL("Read", "src/payments/retry.ts", "08:00:04"),
    "08:00:09 결제를 다시 시도할 때마다 새 청구가 만들어지고 있었어요.",
    TOOL("Edit", "src/payments/retry.ts", "08:12:30"),
    TOOL("Bash", "npm test -- payments", "08:20:11"),
    "성과: 결제 중복 청구 재현 4건 → 0건",
    "[커밋] b18e6d2 +64 -11 [ap] 결제 재시도에 멱등 키를 붙여 중복 청구 방지",
    "[1회차] 완료",
    "[2회차] 시작 - 남은 시간 380분 (model claude-opus-5-5, effort high)",
    TOOL("Bash", "npm run bench -- search", "08:40:09"),
    "08:40:11 상품 2만 개 기준으로 지금은 한 번 검색에 1.4초가 걸려요.",
    TOOL("Edit", "src/search/query.ts", "08:52:20"),
    TOOL("Bash", "npm run bench -- search", "09:05:41"),
    "성과: 검색 응답 시간 1.4초 → 0.2초",
    "[커밋] f48e64d +28 -5 [ap] 상품 검색이 인덱스를 쓰도록 쿼리 정리",
    "[2회차] 완료",
    "[3회차] 시작 - 남은 시간 335분 (model claude-opus-5-5, effort high)",
    TOOL("Grep", "findAllOrders", "09:25:03"),
    TOOL("Read", "src/orders/list.ts", "09:25:06"),
    "09:25:10 주문 목록이 첫 화면에서 모든 주문을 한 번에 내려보내고 있어요.",
    TOOL("Edit", "src/orders/list.ts", "09:40:22"),
    "09:41:02 첫 응답은 20건만 보내고 나머지는 스크롤할 때 받게 바꾸고 있어요."
];

const NEW_PROJECT_WHAT = "반려견 산책 기록 앱. 산책 경로와 시간을 남기고, 주간 산책량을 그래프로 봐요.";
const NEW_PROJECT_DRAFT = {
    name: "petwalk-log",
    summary: "산책 경로와 시간을 기록하고 주간 산책량을 그래프로 보는 반려견 보호자용 웹앱",
    users: [
        { label: "반려견 보호자", picked: true },
        { label: "산책 도우미", picked: false }
    ],
    platforms: ["web", "mobile"],
    features: [
        { label: "산책 시작 · 종료 기록", picked: true },
        { label: "지도에 산책 경로 표시", picked: true },
        { label: "주간 산책량 그래프", picked: true },
        { label: "여러 마리 프로필", picked: true },
        { label: "산책 알림", picked: false },
        { label: "동네 산책 친구", picked: false }
    ],
    exclusions: [
        { label: "결제", picked: true },
        { label: "커뮤니티", picked: true },
        { label: "웨어러블 연동", picked: false }
    ],
    stack: { items: ["Next.js", "PWA", "SQLite"], reason: "휴대폰 홈 화면에 둘 수 있는 웹앱이면 앱 심사 없이 바로 써요." }
};

const SCENES = [
    {
        // 신규 개발 시작 전: 단계마다 메인 AI·보조·방식을 고르는 카드와 입력창
        name: "readme-ready",
        init: { ...BUILD_INIT, model: buildModel(null) },
        run: async (t) => {
            await t.shot("ready");
            await t.click("#ai-pill-codex");
            await t.wait(300);
            await t.shot("ai-popover", "#ai-popover-codex");
        }
    },
    {
        // 기획: Codex(메인)와 Claude가 실시간으로 협의
        name: "readme-plan",
        init: {
            ...BUILD_INIT,
            tabs: getTabs("running"),
            state: runState({
                ...CODEX_RUN,
                startedAt: NOW - 35 * MINUTE,
                step: { phase: "plan", status: "running", qaRetries: 0 },
                rounds: [finished(1, NOW - 30 * MINUTE, 22, [commit("2c9d0b1", 174, 0, "[ap] 기획: plan.md 초안")], CODEX)],
                round: 1,
                phase: "1회차 완료",
                work: { toolCalls: 34, filesRead: 9, filesEdited: 2 },
                debate: { phaseLabel: "기획", maxTurns: 8, firstProvider: "codex", status: "running", turns: DEBATE_TURNS, turnCount: DEBATE_TURNS.length, disputes: 0, reason: "" }
            }),
            model: buildModel(phase("plan"))
        },
        run: async (t) => {
            await t.log([
                "[앱] 엔진을 시작했어요",
                "[단계] 기획 시작",
                "[브레인스토밍] Claude 기획 안 받음",
                "09:52:09 기획서의 화면과 기능 목록을 다 썼어요.",
                "[협의] 기획 시작 (최대 8번)",
                ...DEBATE_TURNS.map((turn) => `[협의] ${turn.provider === "claude" ? "Claude" : "Codex"}: ${turn.message}`)
            ]);
            await t.shot("plan");
        }
    },
    {
        // 기획 확인: 합의안과 협의 기록, 못 맞춘 쟁점만 고른다.
        name: "readme-approval",
        init: {
            ...BUILD_INIT,
            model: buildModel(phase("design", { awaiting: "plan", debate: { phase: "plan", disputes: DISPUTES, resolved: null } }), {
                phaseDocs: { plan: PLAN_DOC, "plan-debate": DEBATE_DOC }
            })
        },
        run: async (t) => {
            await t.click('.dispute[data-dispute="d1"] .dispute-option[data-provider="codex"]');
            await t.click('.dispute[data-dispute="d2"] .dispute-option[data-provider="claude"]');
            await t.click(".debate-tabs .seg-option:nth-child(2)");
            await t.scrollTo(".approval-card", 0);
            await t.wait(400);
            await t.shot("approval");
        }
    },
    {
        // 디자인 확인: Claude(메인)와 Codex가 따로 낸 두 안을 나란히 보고 고른다.
        name: "readme-design",
        init: {
            ...BUILD_INIT,
            model: buildModel(phase("build", { awaiting: "design", proposals: { phase: "design", candidates: ["claude", "codex"], picked: null } }), {
                phaseDocs: { design: DESIGN_DOC, "design-codex": CODEX_DESIGN_DOC, "design-review-codex": DESIGN_REVIEW_BY_CODEX, "design-review-claude": DESIGN_REVIEW_BY_CLAUDE }
            })
        },
        run: async (t) => {
            await t.shot("design");
        }
    },
    {
        // 개발: 회차마다 고치고 검증하고 커밋한다(README 맨 위·랜딩 첫 화면).
        name: "readme-running",
        init: {
            ...BUILD_INIT,
            tabs: getTabs("running"),
            state: buildRunState(5, {
                step: { phase: "build", status: "running", qaRetries: 0 },
                work: { toolCalls: 212, filesRead: 48, filesEdited: 31 }
            }),
            model: buildModel(phase("build"), { phaseDocs: { plan: PLAN_DOC, design: DESIGN_DOC } })
        },
        run: async (t) => {
            await t.log([
                "[앱] 엔진을 시작했어요",
                TOOL("Read", "prisma/schema.prisma", "09:35:02"),
                TOOL("Edit", "app/classes/[id]/book/page.tsx", "09:41:05"),
                "09:41:07 날짜를 고르면 남은 자리가 있는 시간만 보이게 했어요.",
                TOOL("Bash", "npm test", "09:52:09"),
                "09:52:12 정원을 넘는 예약을 서버에서도 막는 검사를 넣고 있어요."
            ]);
            await t.shot("running");
        }
    },
    {
        // 테스트/QA: Codex가 E2E를 돌려 실패를 고친다.
        name: "readme-qa",
        init: {
            ...BUILD_INIT,
            tabs: getTabs("running"),
            state: buildRunState(6, {
                ...CODEX_RUN,
                step: { phase: "qa", status: "running", qaRetries: 0 },
                work: { toolCalls: 268, filesRead: 61, filesEdited: 36 },
                gains: [{ round: 6, text: "E2E 통과 16 → 18" }]
            }),
            model: buildModel(phase("qa"), { phaseDocs: { plan: PLAN_DOC, design: DESIGN_DOC } })
        },
        run: async (t) => {
            await t.log([
                "[앱] 엔진을 시작했어요",
                "[단계] 테스트/QA 시작",
                TOOL("Bash", "npx playwright test", "09:44:04"),
                "09:44:31 예약 흐름 E2E 18개 중 2개가 실패했어요. 마감된 시간을 누르면 아무 안내가 없어요.",
                TOOL("Edit", "app/classes/[id]/book/TimeChips.tsx", "09:48:36"),
                TOOL("Bash", "npx playwright test", "09:55:02"),
                "성과: E2E 통과 16 → 18",
                "09:55:40 모두 통과해서 qa.md에 확인한 흐름과 결과를 적고 있어요."
            ]);
            await t.shot("qa");
        }
    },
    {
        // 보안검토: 고치지 못한 심각·높음이 남으면 개발로 되돌린다.
        name: "readme-security",
        init: {
            ...BUILD_INIT,
            tabs: getTabs("running"),
            state: buildRunState(7, {
                step: { phase: "security", status: "running", qaRetries: 0, securityRetries: 0 },
                work: { toolCalls: 301, filesRead: 77, filesEdited: 38 }
            }),
            model: buildModel(phase("security"), { phaseDocs: { plan: PLAN_DOC, design: DESIGN_DOC } })
        },
        run: async (t) => {
            await t.log([
                "[앱] 엔진을 시작했어요",
                "[단계] 보안검토 시작",
                TOOL("Grep", "dangerouslySetInnerHTML", "09:48:02"),
                TOOL("Read", "app/api/bookings/route.ts", "09:48:10"),
                "09:48:31 예약 조회 API가 전화번호만으로 다른 사람의 예약을 보여 주고 있었어요.",
                TOOL("Edit", "app/api/bookings/route.ts", "09:53:05"),
                "09:56:12 조회할 때 예약 번호도 함께 확인하게 고치고, security.md에 심각도 높음으로 적었어요."
            ]);
            await t.shot("security");
        }
    },
    {
        // 다섯 단계를 모두 마친 화면
        name: "readme-done",
        init: {
            ...BUILD_INIT,
            state: runState({
                status: "idle",
                pid: 0,
                startedAt: NOW - 305 * MINUTE,
                deadlineAt: NOW + 4 * HOUR,
                endedAt: NOW - 8 * MINUTE,
                exitCode: 0,
                reason: "신규 개발: 모든 단계 완료",
                step: { phase: "security", status: "done", qaRetries: 0, securityRetries: 0 },
                rounds: getBuildRounds(NOW - 300 * MINUTE, BUILD_ROUNDS.length, false),
                round: 7,
                phase: "",
                work: { toolCalls: 318, filesRead: 80, filesEdited: 39 },
                gains: [{ round: 5, text: "테스트 통과 0 → 46" }]
            }),
            model: buildModel(phase("done")),
            logs: ["09:56:12 보안검토를 마쳤어요. 고치지 못한 심각·높음은 없어요."].map((text) => ({ stream: "out", text: text, at: NOW }))
        },
        run: async (t) => {
            await t.shot("done");
        }
    },
    {
        // 유지 보수 시작 화면: 인사와 지난 실행
        name: "readme-maintain-ready",
        init: {
            settings: { projectDir: STORE, tasks: "상품 검색이 느려요. 상품 2만 개 기준으로 0.5초 안에 응답하게 해 주세요.\n결제를 다시 시도할 때 중복 청구가 생기는지 확인하고 막아 주세요." },
            accounts: ACCOUNTS,
            models: MODELS,
            runs: STORE_RUNS,
            tabs: getTabs(),
            streakDays: [NOW - 2 * DAY, NOW - DAY],
            model: { phaseByProject: phaseByProject(null), providers: PROVIDERS }
        },
        run: async (t) => {
            await t.shot("maintain-ready");
            await t.shot("composer-maintain", ".composer");
        }
    },
    {
        // 유지 보수 실행 중: 검증으로 확인한 성과
        name: "readme-maintain",
        init: {
            settings: { projectDir: STORE },
            accounts: ACCOUNTS,
            models: MODELS,
            state: storeState(),
            tabs: getTabs("idle", "running"),
            model: { phaseByProject: phaseByProject(null), providers: PROVIDERS }
        },
        run: async (t) => {
            await t.log(STORE_LINES);
            await t.shot("maintain");
        }
    },
    {
        // 유지 보수를 마친 화면: 성과 세 가지와 회차별 커밋
        name: "readme-maintain-done",
        init: {
            settings: { projectDir: STORE },
            accounts: ACCOUNTS,
            models: MODELS,
            state: storeState({
                status: "idle",
                pid: 0,
                endedAt: NOW - 5 * MINUTE,
                exitCode: 0,
                reason: "예정 시각 도달",
                phase: "",
                rounds: [...STORE_ROUNDS.slice(0, 2), finished(3, NOW - 35 * MINUTE, 28, [commit("7e3a5c0", 52, 18, "[ap] 주문 목록 첫 응답을 20건으로 나눠 보내기")])],
                gains: [
                    { round: 2, text: "검색 응답 시간 1.4초 → 0.2초" },
                    { round: 3, text: "주문 목록 첫 응답 2.4MB → 36KB" }
                ]
            }),
            tabs: getTabs(),
            model: { phaseByProject: phaseByProject(null), providers: PROVIDERS },
            logs: ["09:58:40 주문 목록을 나눠 보내게 바꾸고 테스트를 모두 통과했어요."].map((text) => ({ stream: "out", text: text, at: NOW }))
        },
        run: async (t) => {
            await t.shot("maintain-done");
        }
    },
    {
        name: "readme-history",
        init: {
            settings: { projectDir: STORE },
            accounts: ACCOUNTS,
            models: MODELS,
            state: storeState(),
            tabs: getTabs("idle", "running"),
            model: { phaseByProject: phaseByProject(null), providers: PROVIDERS }
        },
        run: async (t) => {
            await t.log(STORE_LINES);
            await t.click("#live-panel");
            await t.wait(700);
            await t.shot("history", "", { skipDom: true });
            await t.shot("history-sheet", "#history", { skipDom: true });
        }
    },
    {
        name: "readme-settings",
        init: { settings: { projectDir: STORE }, accounts: ACCOUNTS, models: MODELS, runs: STORE_RUNS, tabs: getTabs(), model: { phaseByProject: phaseByProject(null), providers: PROVIDERS } },
        run: async (t) => {
            await t.click("#settings-toggle");
            await t.wait(700);
            await t.shot("settings", "", { skipDom: true });
            await t.shot("settings-panel", "#settings", { skipDom: true });
        }
    },
    {
        // 새 프로젝트: 한두 줄을 적으면 Claude가 초안을 채우고 칩으로 다듬는다.
        name: "readme-new-project",
        init: {
            settings: { projectDir: STORE },
            accounts: ACCOUNTS,
            models: MODELS,
            runs: STORE_RUNS,
            tabs: getTabs("running"),
            model: {
                phaseByProject: phaseByProject(null),
                providers: PROVIDERS,
                draft: NEW_PROJECT_DRAFT,
                createInfo: { parentDir: "D:\\Projects", author: { name: "ReguMaster", email: "regumaster@example.com" } }
            }
        },
        run: async (t) => {
            await t.click("#new-project-toggle");
            await t.wait(300);
            await t.click("#new-project-what");
            await t.type(NEW_PROJECT_WHAT);
            await t.click(".np-pick button:first-child");
            await t.click("#new-project-draft");
            await t.wait(4200);
            await t.shot("new-project");
        }
    }
];

module.exports = { SCENES };

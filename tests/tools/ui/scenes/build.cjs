const { PROJECT, RUNS, round, runningState, doneState } = require("./data.cjs");

const SECOND = "E:/Workspaces/Demo/hanbit-booking";

const getTabs = () => [
    { projectDir: SECOND, name: "hanbit-booking", status: "idle" },
    { projectDir: PROJECT, name: "Kirikomodo", status: "idle" }
];

const BUILD = {
    settings: { projectDir: SECOND, mode: "build", tasks: "동네 미용실 예약 웹앱. 손님은 날짜와 디자이너를 골라 예약하고, 원장은 하루 예약표를 한눈에 본다." },
    tabs: getTabs(),
    runs: RUNS
};

const PLAN_DOC = {
    kind: "file",
    path: "docs/autopilot/plan.md",
    isPartial: false,
    text: [
        "# 동네 미용실 예약 웹앱",
        "",
        "손님이 날짜와 디자이너를 골라 30분 단위로 예약하고, 원장이 하루 예약표를 보는 웹앱이에요.",
        "",
        "## 화면 6개",
        "- 손님: 디자이너 고르기, 날짜와 시간 고르기, 예약 확인, 내 예약",
        "- 원장: 하루 예약표, 디자이너 근무 시간 설정",
        "",
        "## 기술 선택",
        "- Next.js 15, SQLite(Prisma), Tailwind. 새 라이브러리 6개(허용됨)",
        "- 로그인은 원장 한 명만, 손님은 전화번호로 `예약 조회`",
        "",
        "## 이번에 하지 않는 것",
        "- 카카오 알림톡, 결제, 여러 매장",
        "",
        "## 개발 순서",
        "1. 데이터 구조와 예약 가능 시간 계산",
        "2. 손님 화면",
        "3. 원장 화면"
    ].join("\n")
};
const DESIGN_DOC = {
    kind: "folder",
    path: "docs/autopilot/design",
    entries: ["customer-choose.html", "customer-confirm.html", "customer-time.html", "index.html", "owner-day.html", "owner-hours.html", "style.css"]
};

// 여러 AI 브레인스토밍: Codex가 따로 낸 기획안 · 디자인 안과 서로의 검토
const CODEX_PLAN_DOC = {
    kind: "file",
    path: "docs/autopilot/proposals/plan-codex.md",
    isPartial: false,
    text: [
        "# 미용실 예약 웹앱",
        "",
        "1) 한 줄 요약: 손님은 링크 하나로 예약하고 원장은 오늘 예약을 한 화면에서 관리한다.",
        "",
        "## 화면 4개",
        "- 손님: 예약하기(디자이너 · 날짜 · 시간을 한 화면에서), 예약 확인",
        "- 원장: 오늘 예약, 근무 시간과 휴무",
        "",
        "## 기술 선택",
        "- SvelteKit, SQLite(Drizzle). 서버 하나로 끝낸다(가정)",
        "",
        "## 이번에 하지 않는 것",
        "- 결제, 알림 문자, 여러 매장"
    ].join("\n")
};
const REVIEW_BY_CODEX = {
    kind: "file",
    path: "docs/autopilot/proposals/plan-review-codex.md",
    isPartial: false,
    text: "- 예약 변경 · 취소 규칙(몇 시간 전까지)이 없어요\n- 디자이너 휴무가 예약 가능 시간 계산에 빠져 있어요"
};
const REVIEW_BY_CLAUDE = {
    kind: "file",
    path: "docs/autopilot/proposals/plan-review-claude.md",
    isPartial: false,
    text: "- 화면을 한 장으로 합쳐 휴대폰에서 길어질 수 있어요\n- 같은 시간 동시 예약을 막는 방법이 없어요"
};
const CODEX_DESIGN_DOC = { kind: "file", path: "docs/autopilot/proposals/design-codex.html", isPartial: false, text: "<!doctype html><title>Codex 디자인 안</title><h1>예약하기</h1>" };
const PLAN_PROPOSALS = { phase: "plan", candidates: ["claude", "codex"], picked: null };
const commit = (hash, insertions, subject) => ({ hash: hash, insertions: insertions, deletions: 0, subject: subject });
const BUILD_ROUNDS = [
    round(1, { commits: [commit("e02b5c9", 903, "[ap] Next.js와 SQLite 기본 구조")] }),
    round(2, { commits: [commit("3fa77d2", 167, "[ap] 디자이너 선택 화면")] }),
    round(3, { commits: [commit("9c1e04a", 214, "[ap] 예약 가능 시간 계산")] }),
    round(4, { endedAt: 0, outcome: "", commits: [] })
];
const buildRunState = (overrides = {}) =>
    runningState({
        project: SECOND,
        mode: "build",
        step: { phase: "build", status: "running", qaRetries: 0 },
        phase: "4회차 진행 중",
        round: 4,
        rounds: BUILD_ROUNDS,
        gains: [],
        work: { toolCalls: 212, filesRead: 48, filesEdited: 31 },
        ...overrides
    });
const BUILD_LINES = [
    "[앱] 엔진을 시작했어요",
    "10:00:05   > Edit app/reserve/page.tsx",
    "10:00:07 예약 화면에서 디자이너를 고르면 그날 비어 있는 시간만 보이게 했어요.",
    "10:00:09   > Bash npm test",
    "10:00:12 겹치는 예약을 막는 검사를 서버에도 넣고 있어요."
];
const getRunTabs = () => [
    { projectDir: SECOND, name: "hanbit-booking", status: "running" },
    { projectDir: PROJECT, name: "Kirikomodo", status: "idle" }
];
const RUN_BUILD = { settings: BUILD.settings, tabs: getRunTabs(), state: buildRunState(), model: { buildPhase: { phase: "build", awaiting: null, qaRetries: 0 } } };
const NARROW = [820, 700];

// Claude · Codex 협의: 고르는 칸, 실행 중 대화, 합의안과 쟁점 고르기
// at은 말을 받은 시각이다(말풍선 옆 시각). 마지막 말은 길어서 접혔다가 더 보기로 펴진다.
const DEBATE_TURNS = [
    { provider: "claude", at: new Date(2026, 9, 31, 10, 2).getTime(), message: "Codex 안의 한 화면 예약은 좋아요. 다만 결제를 처음부터 넣으면 범위가 커져서 이번엔 빼는 게 맞다고 봐요." },
    { provider: "codex", at: new Date(2026, 9, 31, 10, 3).getTime(), message: "한 화면 예약에 동의해 줘서 고마워요. 노쇼가 많아서 예약금 결제는 처음부터 있어야 원장님이 써요." },
    {
        provider: "claude",
        at: new Date(2026, 9, 31, 10, 4).getTime(),
        message:
            "노쇼 걱정은 맞아요. 결제 대신 **전날 확인 문자**를 넣으면 범위를 지키면서 노쇼를 줄일 수 있어요. 문자는 `D-1 18시`에 한 번만 보내고, 답장이 없으면 원장님 화면에 표시해서 직접 연락하게 해요. 예약금은 문자를 두 달 써 보고 노쇼가 그대로인지 확인한 뒤에 다시 이야기해요. 결제 연동은 심사와 수수료 때문에 일정이 길어지니 그때 넣어도 늦지 않아요. 지금은 화면 4개와 문자 하나로 끝내요."
    }
];
const DEBATE_DOC = {
    kind: "file",
    path: "docs/autopilot/proposals/plan-debate.md",
    isPartial: false,
    text: [
        "# 기획 협의 기록",
        "",
        "Claude와 Codex가 3번 주고받았어요. 끝까지 맞추지 못한 쟁점이 남았어요.",
        "",
        "## 1번째 주고받기 - Claude",
        "",
        DEBATE_TURNS[0].message,
        "",
        "- 동의: 한 화면 예약: 손님이 거치는 단계가 줄어요",
        "- 반대: 결제를 처음부터 넣기 (이유: 심사 · 수수료로 일정이 길어져요)",
        "",
        "## 1번째 주고받기 - Codex",
        "",
        DEBATE_TURNS[1].message,
        "",
        "## 2번째 주고받기 - Claude",
        "",
        DEBATE_TURNS[2].message,
        "",
        "- 바꾼 점: 전날 확인 문자를 기능에 더해요",
        "",
        "## 2번째 주고받기 - Codex",
        "",
        "문자는 좋아요. 그래도 결제는 남겨 두는 게 맞다고 봐요. 화면은 4개로 줄이는 데 합의해요."
    ].join("\n")
};
const DISPUTES = [
    {
        id: "d1",
        title: "예약금 결제",
        claude: "이번엔 빼고 전날 확인 문자로 노쇼를 줄여요. 결제 연동은 심사 · 수수료 때문에 일정이 길어져요.",
        codex: "예약금 결제를 처음부터 넣어요. 노쇼가 원장님의 가장 큰 고민이라 문자만으로는 부족해요."
    },
    {
        id: "d2",
        title: "디자이너와 시간 중 먼저 고를 것",
        claude: "디자이너를 먼저 고르게 해요. 단골은 디자이너가 정해져 있어요.",
        codex: "시간을 먼저 고르고 그 시간에 되는 디자이너를 보여 줘요. 처음 온 손님이 더 빨리 예약해요."
    }
];
const DEBATE_SCENES = [
    {
        name: "ready-build-debate",
        init: { ...BUILD, settings: { ...BUILD.settings, brainstorm: ["plan", "design"], debate: ["plan"], allow: ["deps", "large", "send"] } },
        run: async (t) => {
            await t.shot("ready");
            await t.shot("steps", "#build-steps");
        }
    },
    {
        name: "run-build-debate",
        init: {
            ...RUN_BUILD,
            state: buildRunState({
                step: { phase: "plan", status: "running", qaRetries: 0 },
                rounds: [round(1, { commits: [commit("5d0c2aa", 182, "[ap] 기획서 초안")] })],
                round: 1,
                phase: "1회차 완료",
                debate: { phaseLabel: "기획", maxTurns: 3, status: "running", turns: DEBATE_TURNS, disputes: 0, reason: "" }
            }),
            model: { buildPhase: { phase: "plan", awaiting: null, qaRetries: 0, securityRetries: 0, proposals: null, debate: null } }
        },
        run: async (t) => {
            await t.log([
                "[앱] 엔진을 시작했어요",
                "[단계] 기획 시작",
                "10:00:09 기획서의 기능 목록을 다 썼어요.",
                "[협의] 기획 시작 (최대 3번)",
                ...DEBATE_TURNS.map((turn) => `[협의] ${turn.provider === "claude" ? "Claude" : "Codex"}: ${turn.message}`)
            ]);
            await t.shot("run");
        }
    },
    {
        name: "run-build-debate-long",
        init: {
            ...RUN_BUILD,
            state: buildRunState({
                step: { phase: "plan", status: "running", qaRetries: 0 },
                rounds: [round(1, { commits: [commit("5d0c2aa", 182, "[ap] 기획서 초안")] })],
                round: 1,
                phase: "1회차 완료",
                debate: { phaseLabel: "기획", maxTurns: 3, status: "running", turns: DEBATE_TURNS, disputes: 0, reason: "" }
            }),
            model: { buildPhase: { phase: "plan", awaiting: null, qaRetries: 0, securityRetries: 0, proposals: null, debate: null } }
        },
        // 협의가 끝나도 합의안을 고치는 정리 회차가 도는 동안은 협의 대화가 남아, 그 회차의 긴 보고문이 대화와 한 열을 나눠 쓴다.
        run: async (t) => {
            const longReport = Array.from({ length: 18 }, (_, index) => `    ${index + 1}. 정해진 절을 채웠고 다른 AI의 안이 있는 docs/autopilot/proposals/는 열지 않고 따로 썼어요.`);

            await t.log([
                "[앱] 엔진을 시작했어요",
                "[단계] 기획 시작",
                "10:00:09 기획서의 기능 목록을 다 썼어요.",
                "[협의] 기획 시작 (최대 3번)",
                ...DEBATE_TURNS.map((turn) => `[협의] ${turn.provider === "claude" ? "Claude" : "Codex"}: ${turn.message}`)
            ]);
            await t.shot("turns");
            await t.log(["[2회차] 시작 - 남은 시간 290분 (model opus, effort high)", "10:05:00 개발자님, 기획 단계를 마쳤어요. 기획서는 ai/autopilot 브랜치에 commit했어요(626ae9d).", ...longReport]);
            await t.shot("synthesis");
            await t.eval("document.querySelector('.now').scrollTop = 9999");
            await t.shot("synthesis-scrolled");
            await t.state({ debate: { phaseLabel: "기획", maxTurns: 3, status: "consensus", turns: DEBATE_TURNS, disputes: 0, reason: "" } });
            await t.wait(150);
            t.note(
                "leaving",
                await t.eval(
                    "(() => { const chat = document.querySelector('#debate-chat'); return JSON.stringify({ isLeaving: chat?.classList.contains('is-leaving'), opacity: chat && getComputedStyle(chat).opacity, anim: chat?.getAnimations().map((a) => a.animationName + '/' + a.playState + '/' + Math.round(a.currentTime)) }); })()"
                )
            );
            await t.wait(600);
            t.note("removed", await t.eval("!document.querySelector('#debate-chat')"));
            await t.shot("after-debate");
        }
    },
    {
        name: "approval-plan-debate",
        init: {
            ...BUILD,
            model: {
                buildPhase: { phase: "design", awaiting: "plan", qaRetries: 0, securityRetries: 0, proposals: null, debate: { phase: "plan", disputes: DISPUTES, resolved: null } },
                phaseDocs: { plan: PLAN_DOC, "plan-debate": DEBATE_DOC }
            }
        },
        run: async (t) => {
            await t.shot("approval");
            await t.click('.dispute[data-dispute="d1"] .dispute-option[data-provider="claude"]');
            await t.click('.dispute[data-dispute="d2"] .dispute-option[data-provider="codex"]');
            await t.click(".debate-tabs .seg-option:nth-child(2)");
            await t.wait(300);
            await t.shot("chosen");
            await t.click("#approval-approve");
            await t.wait(300);
            await t.note(
                "calls",
                await t.eval("JSON.stringify(window.__calls.filter((call) => ['approvePhase', 'start'].includes(call[0])).map((call) => call.slice(0, call[0] === 'approvePhase' ? 4 : 1)))")
            );
        }
    },
    {
        name: "approval-plan-debate-consensus",
        init: {
            ...BUILD,
            model: {
                buildPhase: { phase: "design", awaiting: "plan", qaRetries: 0, securityRetries: 0, proposals: null, debate: { phase: "plan", disputes: [], resolved: null } },
                phaseDocs: { plan: PLAN_DOC, "plan-debate": DEBATE_DOC }
            }
        },
        run: async (t) => {
            await t.shot("approval");
        }
    }
];

// 신규 개발의 실행 중·확인 기다림·마친 화면과 유지 보수 실행 중, 좁은 창
const BUILD_RUN_SCENES = [
    {
        name: "run-build",
        init: RUN_BUILD,
        run: async (t) => {
            await t.log(BUILD_LINES);
            await t.shot("run");
            await t.shot("steps", "#run-steps");
            await t.shot("card", "#run-card");
        }
    },
    {
        name: "run-build-qa-retry",
        init: { ...RUN_BUILD, state: buildRunState({ step: { phase: "build", status: "running", qaRetries: 1 } }) },
        run: async (t) => {
            await t.log(BUILD_LINES);
            await t.shot("steps", "#run-steps");
        }
    },
    {
        name: "run-build-security-retry",
        init: {
            ...RUN_BUILD,
            state: buildRunState({ step: { phase: "build", status: "running", qaRetries: 1, securityRetries: 1 } }),
            model: { buildPhase: { phase: "build", awaiting: null, qaRetries: 1, securityRetries: 1 } }
        },
        run: async (t) => {
            await t.log(BUILD_LINES);
            await t.shot("run");
            await t.shot("steps", "#run-steps");
            await t.shot("card", "#run-card");
        }
    },
    {
        name: "run-build-brainstorm",
        init: {
            ...RUN_BUILD,
            state: buildRunState({
                step: { phase: "plan", status: "running", qaRetries: 0 },
                rounds: [round(1, { endedAt: 0, outcome: "", commits: [] })],
                round: 1,
                phase: "1회차 진행 중",
                brainstorm: { provider: "Codex", phaseLabel: "기획", kind: "proposal", status: "received", reason: "" }
            }),
            model: { buildPhase: { phase: "plan", awaiting: null, qaRetries: 0, securityRetries: 0, proposals: null } }
        },
        run: async (t) => {
            await t.log([
                "[앱] 엔진을 시작했어요",
                "[단계] 기획 시작",
                "[브레인스토밍] Codex 기획 안 받는 중",
                "[브레인스토밍] Codex 기획 안 받음",
                "10:00:05   > Read docs/autopilot/brief.md",
                "10:00:09 기획서의 기능 목록을 쓰고 있어요."
            ]);
            await t.shot("run");
            await t.shot("card", "#run-card");
        }
    },
    {
        name: "run-build-brainstorm-progress",
        init: {
            ...RUN_BUILD,
            state: buildRunState({
                step: { phase: "plan", status: "running", qaRetries: 0 },
                phase: "Codex 기획 안 받는 중",
                brainstorm: {
                    provider: "Codex",
                    phaseLabel: "기획",
                    kind: "proposal",
                    status: "receiving",
                    reason: "",
                    elapsedMinutes: 3,
                    limitMinutes: 30,
                    activity: "명령 5번 실행 · 저장소에는 brief와 실행 기록만 있고 구현 코드는 없어요."
                }
            }),
            model: { buildPhase: { phase: "plan", awaiting: null, qaRetries: 0, securityRetries: 0, proposals: null } }
        },
        run: async (t) => {
            await t.log(["[앱] 엔진을 시작했어요", "[단계] 기획 시작", "[브레인스토밍] Codex 기획 안 받는 중"]);
            await t.shot("card", "#run-card");
        }
    },
    {
        name: "run-maintain",
        init: { settings: { projectDir: PROJECT }, state: runningState(), tabs: [{ projectDir: PROJECT, name: "Kirikomodo", status: "running" }] },
        run: async (t) => {
            await t.log(["[앱] 엔진을 시작했어요", "10:00:05   > Grep createStory", "10:00:07 이야기를 만드는 부분을 찾았어요.", "10:00:10 이야기 영역이 같은 모양이면 다시 그리지 않게 고쳤어요."]);
            await t.shot("run");
        }
    },
    {
        name: "approval-plan",
        init: { ...BUILD, model: { buildPhase: { phase: "design", awaiting: "plan", qaRetries: 0 }, phaseDocs: { plan: PLAN_DOC } } },
        run: async (t) => {
            await t.shot("approval");
            await t.click("#approval-feedback");
            await t.type("원장 화면에 주간 보기도 넣어 주세요");
            await t.click("#approval-revise");
            await t.wait(300);
            await t.note("revise", await t.eval("JSON.stringify(window.__calls.filter((call) => call[0] === 'start').map((call) => ({ tasks: call[1].tasks, keepTasks: call[1].keepTasks })))"));
        }
    },
    {
        name: "approval-plan-approve",
        init: { ...BUILD, model: { buildPhase: { phase: "design", awaiting: "plan", qaRetries: 0 }, phaseDocs: { plan: PLAN_DOC } } },
        run: async (t) => {
            await t.click("#approval-approve");
            await t.wait(300);
            await t.note("calls", await t.eval("JSON.stringify(window.__calls.filter((call) => ['approvePhase', 'start'].includes(call[0])).map((call) => call[0]))"));
        }
    },
    {
        name: "approval-design",
        init: {
            ...BUILD,
            state: doneState({
                project: SECOND,
                mode: "build",
                reason: "디자인 확인 대기",
                exitCode: 0,
                step: { phase: "design", status: "awaiting", qaRetries: 0 },
                rounds: BUILD_ROUNDS.slice(0, 2),
                gains: []
            }),
            model: { buildPhase: { phase: "build", awaiting: "design", qaRetries: 0 }, phaseDocs: { design: DESIGN_DOC } }
        },
        run: async (t) => {
            await t.shot("approval");
        }
    },
    {
        name: "approval-plan-pick",
        init: {
            ...BUILD,
            model: {
                buildPhase: { phase: "design", awaiting: "plan", qaRetries: 0, securityRetries: 0, proposals: PLAN_PROPOSALS },
                phaseDocs: { plan: PLAN_DOC, "plan-codex": CODEX_PLAN_DOC, "plan-review-codex": REVIEW_BY_CODEX, "plan-review-claude": REVIEW_BY_CLAUDE }
            }
        },
        run: async (t) => {
            await t.shot("approval");
            await t.click('.proposal[data-provider="codex"] .proposal-review summary');
            await t.wait(300);
            await t.shot("review", '.proposal[data-provider="codex"]');
            await t.click("#approval-pick-codex");
            await t.wait(300);
            await t.note(
                "calls",
                await t.eval("JSON.stringify(window.__calls.filter((call) => ['approvePhase', 'start'].includes(call[0])).map((call) => call.slice(0, call[0] === 'approvePhase' ? 3 : 1)))")
            );
        }
    },
    {
        name: "approval-design-pick",
        init: {
            ...BUILD,
            model: {
                buildPhase: { phase: "build", awaiting: "design", qaRetries: 0, securityRetries: 0, proposals: { ...PLAN_PROPOSALS, phase: "design" } },
                phaseDocs: { design: DESIGN_DOC, "design-codex": CODEX_DESIGN_DOC }
            }
        },
        run: async (t) => {
            await t.shot("approval");
        }
    },
    {
        name: "approval-no-doc",
        init: { ...BUILD, model: { buildPhase: { phase: "design", awaiting: "plan", qaRetries: 0 } } },
        run: async (t) => {
            await t.shot("approval");
        }
    },
    {
        name: "done-build-complete",
        init: {
            ...BUILD,
            state: doneState({
                project: SECOND,
                mode: "build",
                reason: "신규 개발: 모든 단계 완료",
                exitCode: 0,
                step: { phase: "security", status: "done", qaRetries: 1, securityRetries: 0 },
                rounds: BUILD_ROUNDS.slice(0, 3),
                gains: [{ round: 3, text: "테스트 통과 0 → 34" }]
            }),
            model: { buildPhase: { phase: "done", awaiting: null, qaRetries: 1, securityRetries: 0 } }
        },
        run: async (t) => {
            await t.shot("done");
        }
    },
    {
        name: "done-qa-failed",
        init: {
            ...BUILD,
            state: doneState({
                project: SECOND,
                mode: "build",
                reason: "테스트/QA 실패",
                exitCode: 0,
                step: { phase: "qa", status: "failed", qaRetries: 3 },
                rounds: BUILD_ROUNDS.slice(0, 3),
                gains: []
            }),
            model: { buildPhase: { phase: "qa", awaiting: null, qaRetries: 3 } }
        },
        run: async (t) => {
            await t.shot("done");
        }
    },
    {
        name: "done-security-failed",
        init: {
            ...BUILD,
            state: doneState({
                project: SECOND,
                mode: "build",
                reason: "보안검토 실패",
                exitCode: 0,
                step: { phase: "security", status: "failed", qaRetries: 0, securityRetries: 3 },
                rounds: BUILD_ROUNDS.slice(0, 3),
                gains: []
            }),
            model: { buildPhase: { phase: "security", awaiting: null, qaRetries: 0, securityRetries: 3 } }
        },
        run: async (t) => {
            await t.shot("done");
        }
    },
    {
        name: "run-build-narrow",
        size: NARROW,
        init: RUN_BUILD,
        run: async (t) => {
            await t.log(BUILD_LINES);
            await t.shot("run");
        }
    },
    {
        name: "approval-plan-narrow",
        size: NARROW,
        init: { ...BUILD, model: { buildPhase: { phase: "design", awaiting: "plan", qaRetries: 0 }, phaseDocs: { plan: PLAN_DOC } } },
        run: async (t) => {
            await t.shot("approval");
        }
    },
    {
        name: "ready-build-narrow",
        size: NARROW,
        init: BUILD,
        run: async (t) => {
            await t.shot("ready");
            await t.click("#end-time-button");
            await t.wait(400);
            await t.shot("endtime", "");
        }
    }
];

// 신규 개발의 시작 전 화면: 단계 카드(칸마다 설정), 허용 팝오버, 날짜를 고르는 종료 시각, 이어서 할 단계
const SCENES = [
    {
        name: "ready-build",
        init: BUILD,
        run: async (t) => {
            await t.shot("ready");
            await t.shot("steps", "#build-steps");
            await t.shot("composer", ".composer");
        }
    },
    {
        name: "ready-build-allow-popover",
        init: BUILD,
        run: async (t) => {
            await t.click("#allow-chip");
            await t.wait(400);
            await t.shot("ready");
            await t.click('[data-allow="send"]');
            await t.wait(300);
            await t.shot("popover-send", "#allow-popover");
            await t.note("allow", await t.eval("document.querySelector('#allow-count').textContent"));
        }
    },
    {
        name: "ready-build-endtime-popover",
        init: BUILD,
        run: async (t) => {
            await t.click("#end-time-button");
            await t.wait(400);
            await t.click('[data-shortcut="weekend"]');
            await t.wait(400);
            await t.shot("ready");
            await t.shot("popover", "#end-time-popover");
        }
    },
    {
        name: "ready-build-brainstorm",
        init: { ...BUILD, settings: { ...BUILD.settings, brainstorm: ["plan"], crossReview: true, allow: ["deps", "large", "send"] } },
        run: async (t) => {
            await t.shot("ready");
            await t.shot("steps", "#build-steps");
            // 디자인 칸에도 Codex를 켜면 두 칸 모두 교차검토가 보인다. 보내기를 끄면 다시 Claude만이다.
            await t.click('[aria-label="디자인을 누가 쓸까요"]');
            await t.wait(300);
            await t.press("Down");
            await t.press("Return");
            await t.wait(300);
            await t.shot("steps-design", "#build-steps");
            await t.note("modeOptions", await t.eval("JSON.stringify([...document.querySelectorAll('[data-cross-review]')].map((input) => input.dataset.crossReview))"));
        }
    },
    {
        // Codex를 켠 칸에만 모델·Effort 선택 상자가 보이고, 어느 칸에서 바꿔도 같은 값이다.
        name: "ready-build-codex-settings",
        init: {
            ...BUILD,
            settings: { ...BUILD.settings, brainstorm: ["plan", "design"], debate: ["plan"], allow: ["deps", "large", "send"] },
            model: {
                providers: {
                    codex: {
                        available: true,
                        reason: "",
                        models: [
                            { id: "gpt-6.1-sol", label: "GPT-6.1-Sol" },
                            { id: "gpt-6-astra", label: "GPT-6-Astra" },
                            { id: "gpt-6-luna", label: "GPT-6-Luna" }
                        ]
                    }
                }
            }
        },
        run: async (t) => {
            await t.shot("steps", "#build-steps");
            await t.click('[aria-label="Codex 모델"]');
            await t.wait(300);
            await t.shot("model-list");
            await t.press("Down");
            await t.press("Down");
            await t.press("Return");
            await t.wait(300);
            await t.click('[aria-label="Codex Effort"]');
            await t.wait(300);
            await t.shot("effort-list");
            await t.press("Down");
            await t.press("Down");
            await t.press("Down");
            await t.press("Return");
            await t.wait(300);
            await t.shot("steps-chosen", "#build-steps");
            await t.note(
                "codexTriggers",
                await t.eval("JSON.stringify([...document.querySelectorAll('[aria-label^=\"Codex\"]')].map((el) => `${el.getAttribute('aria-label')}=${el.textContent.trim()}`))")
            );
        }
    },
    {
        name: "ready-build-brainstorm-unavailable",
        init: { ...BUILD, model: { providers: { codex: { available: false, reason: "Codex 로그인이 필요해요" } } } },
        run: async (t) => {
            await t.shot("steps", "#build-steps");
        }
    },
    {
        name: "ready-build-resume",
        init: { ...BUILD, settings: { ...BUILD.settings, tasks: "" }, model: { buildPhase: { phase: "design", awaiting: null, qaRetries: 0 } } },
        run: async (t) => {
            await t.shot("ready");
        }
    },
    {
        name: "ready-build-awaiting",
        init: { ...BUILD, model: { buildPhase: { phase: "design", awaiting: "plan", qaRetries: 0 }, phaseDocs: { plan: PLAN_DOC } } },
        run: async (t) => {
            await t.shot("ready");
        }
    },
    ...BUILD_RUN_SCENES,
    ...DEBATE_SCENES
];

module.exports = { SCENES };

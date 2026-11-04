const { PROJECT, RUNS, NOW, HOUR } = require("./data.cjs");

const TABS = [
    { projectDir: PROJECT, name: "Kirikomodo", status: "running" },
    { projectDir: "E:/Workspaces/Demo/autopilot-landing", name: "autopilot-landing", status: "idle" }
];
const BASE = { settings: { projectDir: PROJECT }, tabs: TABS, runs: RUNS };
const WHAT = "동네 미용실 예약 웹앱. 손님이 날짜랑 디자이너 골라서 예약하고, 원장은 하루 예약표를 봐요.";
const DRAFT = {
    name: "hanbit-booking",
    summary: "손님은 날짜와 디자이너를 골라 30분 단위로 예약하고, 원장은 하루 예약표를 보는 미용실 예약 웹앱",
    users: [
        { label: "손님", picked: true },
        { label: "원장", picked: true },
        { label: "디자이너", picked: false }
    ],
    platforms: ["web"],
    features: [
        { label: "디자이너 · 날짜 · 시간 고르기", picked: true },
        { label: "전화번호로 예약 확인 · 취소", picked: true },
        { label: "원장용 하루 예약표", picked: true },
        { label: "디자이너 근무 시간 설정", picked: true },
        { label: "예약 전날 알림 문자", picked: false },
        { label: "단골 손님 메모", picked: false }
    ],
    exclusions: [
        { label: "결제", picked: true },
        { label: "카카오 알림톡", picked: true },
        { label: "여러 매장", picked: true },
        { label: "다국어", picked: false }
    ],
    stack: { items: ["Next.js", "SQLite", "Tailwind"], reason: "매장 하나라 서버 하나와 파일 DB로 충분해요." }
};
const NARROW = [820, 700];
const READY = { state: "ready", reason: "", resetsAt: 0, limitLabel: "" };
const CODEX_EXAMPLES = [
    { label: "독서 모임 일정", what: "독서 모임 일정을 정하는 웹앱. 후보 날짜에 투표하고, 가장 많이 고른 날을 모임으로 확정해요.", platforms: ["web"] },
    { label: "로그 요약 CLI", what: "서버 로그를 읽어 오류 유형별 건수와 최근 예시를 요약해 주는 명령줄 도구예요.", platforms: ["cli"] },
    { label: "스터디 타이머", what: "공부 시간을 과목별로 재고 주간 기록을 보여 주는 데스크톱 앱이에요.", platforms: ["desktop"] }
];
const CODEX_OPTION = ".np-provider .seg-option:nth-child(2)";
const CLAUDE_OPTION = ".np-provider .seg-option:nth-child(1)";

const writeWhat = async (t) => {
    await t.click("#new-project-toggle");
    await t.wait(300);
    await t.click("#new-project-what");
    await t.type(WHAT);
    await t.click(".np-pick button:first-child");
};

const draft = async (t) => {
    await writeWhat(t);
    await t.click("#new-project-draft");
    await t.wait(4200);
};

// 새 프로젝트: 한두 줄 적기, 초안을 쓰는 중, 초안 다듬기, 작성자 칸, 초안 실패
const SCENES = [
    {
        name: "new-project-write",
        init: BASE,
        run: async (t) => {
            await writeWhat(t);
            await t.shot("create");
            await t.scrollTo(".new-project", 9999);
            await t.shot("bottom");
        }
    },
    // 창이 좁거나 낮아 내용이 넘쳐도 만들기 줄은 아래에 붙어 있다
    {
        name: "new-project-write-narrow",
        size: NARROW,
        init: BASE,
        run: async (t) => {
            await writeWhat(t);
            await t.shot("create");
            await t.note("footVisible", await t.eval("(() => { const foot = document.querySelector('.np-start-foot').getBoundingClientRect(); return foot.bottom <= window.innerHeight + 1; })()"));
            await t.scrollTo(".new-project", 9999);
            await t.shot("bottom");
        }
    },
    {
        name: "new-project-drafting",
        init: { ...BASE, model: { draftDelay: 60000, draft: DRAFT } },
        run: async (t) => {
            await writeWhat(t);
            await t.click("#new-project-draft");
            await t.wait(300);
            await t.shot("create");
            await t.click("#new-project-cancel");
            await t.wait(300);
            await t.note("after-cancel", await t.eval("document.querySelector('#new-project-what').value.length > 0 && Boolean(document.querySelector('#new-project-write'))"));
        }
    },
    {
        name: "new-project-reveal",
        init: { ...BASE, model: { draft: DRAFT, draftDelay: 1200 } },
        run: async (t) => {
            await writeWhat(t);
            await t.click("#new-project-draft");
            await t.wait(500);
            await t.shot("waiting");
            await t.wait(4800);
            await t.shot("filled");
            await t.note("done", await t.eval("!document.querySelector('#new-project-refine').hasAttribute('data-mode')"));
        }
    },
    {
        name: "new-project-refine",
        init: { ...BASE, model: { draft: DRAFT } },
        run: async (t) => {
            await draft(t);
            await t.shot("create");
            await t.click('#new-project-refine .tag-chip[aria-pressed="false"]');
            await t.wait(200);
            await t.note("brief", await t.eval("document.querySelector('.np-side .doc-preview').textContent.includes('디자이너')"));
        }
    },
    {
        name: "new-project-author",
        init: { ...BASE, model: { draft: DRAFT, createInfo: { parentDir: "D:\\work", author: null } } },
        run: async (t) => {
            await draft(t);
            await t.shot("create");
        }
    },
    {
        name: "new-project-error",
        init: { ...BASE, model: { draftError: { code: "LOGIN_REQUIRED", msg: "새 탭에 쓰는 계정에 로그인되어 있지 않아요. 프로필에서 로그인한 뒤 다시 해 주세요." } } },
        run: async (t) => {
            await draft(t);
            await t.shot("create");
        }
    },
    // 초안·추천을 써 줄 AI를 Codex로 바꿔 추천을 받는다: 받는 동안 자리 표시, 받은 뒤 칩, 고른 칩은 눌린 모양
    {
        name: "new-project-codex",
        init: { ...BASE, model: { examples: CODEX_EXAMPLES, examplesDelay: 1500, draft: DRAFT } },
        run: async (t) => {
            await t.click("#new-project-toggle");
            await t.wait(300);
            await t.click(CODEX_OPTION);
            await t.click(".np-suggest");
            await t.wait(300);
            await t.shot("loading", "#new-project-write");
            await t.wait(1500);
            await t.click(".np-ex-group:nth-child(2) .np-chips button[aria-pressed]");
            await t.shot("picked", "#new-project-write");
            await t.note("provider", await t.eval("document.querySelector('.np-provider input:checked').value"));
            await t.note("pressed", await t.eval("document.querySelectorAll('.np-examples button[aria-pressed=true]').length"));
            await t.click("#new-project-draft");
            await t.wait(600);
            await t.note("progress", await t.eval("document.querySelector('.np-prog b').textContent"));
        }
    },
    // 초안 만들기 줄의 선택으로 Codex를 고르면 추천 줄도 따라가고, 초안 요청이 Codex로 간다
    {
        name: "new-project-draft-codex",
        init: { ...BASE, model: { draft: DRAFT, draftDelay: 1500 } },
        run: async (t) => {
            await writeWhat(t);
            await t.click(".np-foot-ai .seg-option:nth-child(2)");
            await t.shot("footer", "#new-project-write");
            await t.note("synced", await t.eval("[...document.querySelectorAll('.np-provider input:checked')].map((input) => input.value).join(',')"));
            await t.clearCalls();
            await t.click("#new-project-draft");
            await t.wait(300);
            await t.shot("drafting");
            await t.note("request", JSON.stringify((await t.calls()).filter((call) => JSON.stringify(call).includes("draftProject"))));
        }
    },
    // 두 AI 모두 로그인이 안 됐거나 설치돼 있지 않으면 받기·초안 만들기가 잠기고 길을 알린다
    {
        name: "new-project-provider-login",
        init: {
            ...BASE,
            model: {
                draftProviders: {
                    claude: { state: "login", reason: "", resetsAt: 0, limitLabel: "" },
                    codex: { state: "missing", reason: "Codex가 설치돼 있지 않아요. Codex CLI를 먼저 설치해 주세요.", resetsAt: 0, limitLabel: "" }
                }
            }
        },
        run: async (t) => {
            await writeWhat(t);
            await t.shot("create", "#new-project-write");
            await t.note("locked", await t.eval("document.querySelector('#new-project-draft').disabled && document.querySelector('.np-suggest').disabled"));
            await t.click(CODEX_OPTION);
            await t.shot("codex", "#new-project-write");
            await t.click(CLAUDE_OPTION);
            await t.click("#new-project-provider-login");
            await t.wait(300);
            await t.note("profile", await t.eval("document.body.dataset.panel ?? String(Boolean(document.querySelector('#profile')))"));
        }
    },
    // Claude가 5시간 한도를 다 썼고 Codex는 쓸 수 있다: 직접 고르지 않았으면 Codex로 시작하고, Claude를 고르면 리셋 시각과 바꾸기 길을 알린다
    {
        name: "new-project-provider-limit",
        init: {
            ...BASE,
            model: {
                draftProviders: {
                    claude: { state: "limit", reason: "", resetsAt: NOW + 2 * HOUR, limitLabel: "5시간 한도" },
                    codex: READY
                }
            }
        },
        run: async (t) => {
            await writeWhat(t);
            await t.note("auto", await t.eval("document.querySelector('.np-provider input:checked').value"));
            await t.click(CLAUDE_OPTION);
            await t.shot("limit", "#new-project-write");
            await t.click("#new-project-provider-switch");
            await t.wait(300);
            await t.note("switched", await t.eval("document.querySelector('.np-provider input:checked').value + ':' + Boolean(document.querySelector('#new-project-provider-note'))"));
        }
    },
    {
        name: "new-project-refine-narrow",
        size: NARROW,
        init: { ...BASE, model: { draft: DRAFT } },
        run: async (t) => {
            await draft(t);
            await t.shot("create");
        }
    }
];

module.exports = { SCENES };

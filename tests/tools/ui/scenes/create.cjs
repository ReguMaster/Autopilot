const { PROJECT, RUNS } = require("./data.cjs");

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

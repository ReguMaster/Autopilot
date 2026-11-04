import { buildProjectBrief, DRAFT_PROVIDERS, getRecommendedSkip } from "../../projectDraft.cjs";
import { STATUS_OK } from "../lib/constants.js";
import { createDraft, newProject } from "../stores/newProjectStore.js";
import { ui } from "../stores/uiStore.js";
import { applyProjectSwitch } from "./tabs.js";

// 예시 칩. 누르면 한두 줄과 실행 환경을 채운다.
const EXAMPLES = [
    { label: "가게 예약 웹앱", what: "동네 미용실 예약 웹앱. 손님은 날짜와 디자이너를 골라 예약하고, 원장은 하루 예약표를 봐요.", platforms: ["web"] },
    { label: "팀 할 일 관리", what: "다섯 명 팀이 쓰는 할 일 관리 웹앱. 할 일을 만들어 담당자를 정하고, 이번 주에 끝낼 일을 한눈에 봐요.", platforms: ["web"] },
    { label: "가계부 모바일 앱", what: "혼자 쓰는 가계부 모바일 앱. 지출을 빠르게 적고, 달마다 어디에 많이 썼는지 그래프로 봐요.", platforms: ["mobile"] },
    { label: "사내 데이터 API", what: "사내 판매 데이터를 다른 팀이 가져다 쓰는 API 서버. 기간·지점별로 조회하고 API 키로 접근을 막아요.", platforms: ["server"] },
    { label: "파일 정리 CLI", what: "다운로드 폴더의 파일을 종류와 날짜별 폴더로 정리하는 명령줄 도구. 옮기기 전에 미리보기를 보여 줘요.", platforms: ["cli"] },
    { label: "학원 출결 관리", what: "작은 학원의 출결 웹앱. 선생님이 수업별로 출석을 체크하면 학부모에게 그날 결과가 가요.", platforms: ["web"] },
    { label: "독서 기록 앱", what: "읽은 책과 마음에 든 문장을 모아 두는 모바일 앱. 올해 몇 권 읽었는지 한눈에 봐요.", platforms: ["mobile"] },
    { label: "회의록 정리 도구", what: "회의 메모를 붙여 넣으면 결정한 일과 할 일로 나눠 주는 데스크톱 앱. 할 일은 담당자별로 모아 봐요.", platforms: ["desktop"] }
];

// 응답이 오면 다듬기 화면의 칸이 위에서부터 차례로 채워진다(NewProject.css, 칸마다 0.45초). 끝나면 효과 표시를 내려 다시 그려도 반복하지 않는다.
const REVEAL_MS = 3600;
let revealTimer = 0;

const startReveal = () => {
    clearTimeout(revealTimer);
    newProject.set({ isRevealing: true });
    revealTimer = setTimeout(() => newProject.set({ isRevealing: false }), REVEAL_MS);
};

// 만들 위치와 Git 작성자는 열 때마다 메인에서 다시 읽는다(그 사이에 git 설정을 했을 수 있다).
const loadCreateInfo = async () => {
    const result = await window.autopilot.getCreateInfo();

    ui.showFailure(result);

    if (result.status === STATUS_OK) {
        newProject.set({ info: { ...result.data, isLoaded: true } });
    }
};

// 초안·추천을 써 줄 AI를 지금 쓸 수 있는지(로그인·설치·한도) 메인에 묻는다. 직접 고르기 전이고 지금 AI를 쓸 수 없는데 다른 AI는 쓸 수 있으면 그쪽으로 옮긴다(받는 중에는 옮기지 않는다).
// 읽지 못하면 아는 상태를 그대로 두고, 모르면 쓸 수 있다고 보고 메인이 부를 때 다시 확인한다. 마지막 요청의 응답만 받는다.
let providerSeq = 0;

const loadDraftProviders = async () => {
    const seq = ++providerSeq;
    const result = await window.autopilot.getDraftProviders();

    if (seq !== providerSeq || result.status !== STATUS_OK) {
        return;
    }

    const { provider, isProviderPicked, isDrafting, isSuggesting } = newProject.get();
    const isReady = (key) => result.data[key]?.state === "ready";
    const fallback = !isProviderPicked && !isDrafting && !isSuggesting && !isReady(provider) ? DRAFT_PROVIDERS.find((item) => isReady(item.key)) : undefined;

    newProject.set({ providerStates: result.data, provider: fallback?.key ?? provider });
};

// 로그인하러 나갔다 창에 돌아왔을 때를 위해, 지금 AI를 쓸 수 없던 때만 다시 묻는다(포커스마다 계정을 읽지 않도록).
const recheckDraftProviders = () => {
    const { provider, providerStates } = newProject.get();

    if (providerStates?.[provider]?.state !== "ready") {
        loadDraftProviders();
    }
};

const pickProvider = (provider) => {
    newProject.set({ provider: provider, isProviderPicked: true, suggestError: "" });
    loadDraftProviders();
};

// 로그인은 프로필 패널(Claude·Codex 탭)에서 한다. 마치고 돌아오면 창에 포커스가 올 때 다시 확인한다.
const openProviderLogin = (provider) => {
    ui.set({ profileProvider: provider });
    ui.setPanel("profile");
};

const openNewProject = () => {
    ui.set({ newProject: true });
    ui.closeAll();
    loadCreateInfo();
    loadDraftProviders();
};

const pickParentDir = async () => {
    const result = await window.autopilot.pickCreateDir();

    ui.showFailure(result);

    if (result.status === STATUS_OK && !result.data.canceled) {
        newProject.set({ info: { ...newProject.get().info, parentDir: result.data.parentDir } });
    }
};

const applyExample = (example) => {
    newProject.set({ what: example.what, platforms: example.platforms });
};

// 추천 예시만 고른 AI(Claude haiku·Codex)에게 새로 받는다. 기본 예시는 그대로 두고, 그 AI가 이미 보인 이름과 겹치지 않게 부탁한다.
// 받는 동안 AI를 바꿀 수 없으므로 결과는 요청한 AI의 목록으로 간다. 실패해도 쓰던 예시는 남고, 로그인·한도 탓일 수 있어 상태를 다시 묻는다.
const suggestExamples = async () => {
    const { provider, suggestions } = newProject.get();

    newProject.set({ isSuggesting: true, suggestError: "" });

    const result = await window.autopilot.suggestExamples({ provider: provider, exclude: [...EXAMPLES, ...suggestions[provider]].map((example) => example.label) });

    if (result.status === STATUS_OK) {
        newProject.set({ isSuggesting: false, suggestions: { ...newProject.get().suggestions, [provider]: result.data.examples } });

        return;
    }

    newProject.set({ isSuggesting: false, suggestError: result.error.msg });
    loadDraftProviders();
};

// 초안 없이 다듬기로 간다. 적은 한두 줄이 한 줄 요약이 된다.
const writeManually = (notice = "") => {
    const { what } = newProject.get();

    newProject.set({ step: "refine", isDrafting: false, isRevealing: false, isDrafted: false, notice: notice, draft: createDraft({ summary: what.trim() }) });
};

// 그만두고 바로 다시 요청하면 앞 요청의 CANCELED가 늦게 와 새 요청을 끝내므로 마지막 요청의 응답만 받는다.
let draftSeq = 0;

// 고른 AI(Claude·Codex)의 초안을 받아 다듬기로 간다. 고른 실행 환경이 없으면 초안이 고른 것을 쓴다. 실패하면 적은 내용을 그대로 두고 직접 채우게 하고, 로그인·한도 탓일 수 있어 상태를 다시 묻는다.
const requestDraft = async () => {
    const { what, platforms, provider } = newProject.get();
    const seq = ++draftSeq;

    newProject.set({ isDrafting: true, notice: "" });

    const result = await window.autopilot.draftProject({ what: what, platforms: platforms, provider: provider });

    if (seq !== draftSeq || !newProject.get().isDrafting) {
        return;
    }

    if (result.status !== STATUS_OK) {
        if (result.error.code === "CANCELED") {
            newProject.set({ isDrafting: false });
        } else {
            writeManually(`${result.error.msg} 적어 주신 내용으로 직접 채워 주세요.`);
            loadDraftProviders();
        }

        return;
    }

    const { draft } = result.data;

    newProject.set({
        step: "refine",
        isDrafting: false,
        isDrafted: true,
        platforms: platforms.length ? platforms : draft.platforms,
        draft: createDraft({
            name: draft.name,
            summary: draft.summary,
            users: draft.users,
            features: draft.features,
            exclusions: draft.exclusions,
            stack: { choice: draft.stack.items.length ? "recommended" : "later", items: draft.stack.items, reason: draft.stack.reason, custom: [] }
        })
    });
    startReveal();
};

const cancelDraft = () => {
    newProject.set({ isDrafting: false });
    window.autopilot.cancelDraft();
};

const getBrief = (state) => {
    return buildProjectBrief({ ...state.draft, what: state.what, platforms: state.platforms });
};

// 작성자는 git에 없을 때만 받는다(이 저장소에만 설정된다).
const createProject = async () => {
    const state = newProject.get();

    newProject.set({ isCreating: true, notice: "" });

    const result = await window.autopilot.createProject({ name: state.draft.name, brief: getBrief(state), platforms: state.platforms, author: state.info.author ? null : state.author });

    newProject.set({ isCreating: false });

    if (result.status !== STATUS_OK) {
        newProject.set({ notice: result.error.msg });

        return;
    }

    newProject.clear();
    ui.set({ newProject: false });
    applyProjectSwitch(result.data);
    ui.showNotice(
        `${state.draft.name} 프로젝트를 만들었어요. ${getRecommendedSkip(state.platforms).length ? "화면이 없어서 디자인은 건너뛰도록 해 뒀어요. " : ""}단계 설정을 확인하고 기획을 시작해 주세요.`
    );
};

export {
    EXAMPLES,
    openNewProject,
    pickParentDir,
    pickProvider,
    loadDraftProviders,
    recheckDraftProviders,
    openProviderLogin,
    applyExample,
    suggestExamples,
    writeManually,
    requestDraft,
    cancelDraft,
    getBrief,
    createProject
};

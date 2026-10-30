import { buildProjectBrief } from "../../projectDraft.cjs";
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
    { label: "파일 정리 CLI", what: "다운로드 폴더의 파일을 종류와 날짜별 폴더로 정리하는 명령줄 도구. 옮기기 전에 미리보기를 보여 줘요.", platforms: ["cli"] }
];

// 만들 위치와 Git 작성자는 열 때마다 메인에서 다시 읽는다(그 사이에 git 설정을 했을 수 있다).
const loadCreateInfo = async () => {
    const result = await window.autopilot.getCreateInfo();

    if (result.status === STATUS_OK) {
        newProject.set({ info: { ...result.data, isLoaded: true } });
    }
};

const openNewProject = () => {
    ui.set({ newProject: true });
    ui.closeAll();
    loadCreateInfo();
};

const closeNewProject = () => {
    ui.set({ newProject: false });
};

const pickParentDir = async () => {
    const result = await window.autopilot.pickCreateDir();

    if (result.status === STATUS_OK && !result.data.canceled) {
        newProject.set({ info: { ...newProject.get().info, parentDir: result.data.parentDir } });
    }
};

const applyExample = (example) => {
    newProject.set({ what: example.what, platforms: example.platforms });
};

// 초안 없이 다듬기로 간다. 적은 한두 줄이 한 줄 요약이 된다.
const writeManually = (notice = "") => {
    const { what } = newProject.get();

    newProject.set({ step: "refine", isDrafting: false, isDrafted: false, notice: notice, draft: createDraft({ summary: what.trim() }) });
};

// Claude 초안을 받아 다듬기로 간다. 고른 실행 환경이 없으면 초안이 고른 것을 쓴다. 실패하면 적은 내용을 그대로 두고 직접 채우게 한다.
const requestDraft = async () => {
    const { what, platforms } = newProject.get();

    newProject.set({ isDrafting: true, notice: "" });

    const result = await window.autopilot.draftProject({ what: what, platforms: platforms });

    if (!newProject.get().isDrafting) {
        return;
    }

    if (result.status !== STATUS_OK) {
        if (result.error.code === "CANCELED") {
            newProject.set({ isDrafting: false });
        } else {
            writeManually(`${result.error.msg} 적어 주신 내용으로 직접 채워 주세요.`);
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

    const result = await window.autopilot.createProject({ name: state.draft.name, brief: getBrief(state), author: state.info.author ? null : state.author });

    newProject.set({ isCreating: false });

    if (result.status !== STATUS_OK) {
        newProject.set({ notice: result.error.msg });

        return;
    }

    newProject.clear();
    ui.set({ newProject: false });
    applyProjectSwitch(result.data);
    ui.showNotice(`${state.draft.name} 프로젝트를 만들었어요. 단계 설정을 확인하고 기획을 시작해 주세요.`);
};

export { EXAMPLES, openNewProject, closeNewProject, pickParentDir, applyExample, writeManually, requestDraft, cancelDraft, getBrief, createProject };

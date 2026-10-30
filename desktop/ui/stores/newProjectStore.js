import { create } from "zustand";

// 새 프로젝트 화면의 입력. 다른 탭을 봐도 만들거나 처음부터 다시 쓸 때까지 남는다.
// suggestions는 Claude(haiku)가 새로 추천한 예시([{ label, what, platforms }])다. 기본 예시는 화면이 따로 갖는다.
// isDrafting은 Claude가 초안을 쓰는 중(다듬기 틀에 자리 표시), isRevealing은 응답이 온 뒤 칸이 차례로 채워지는 몇 초다.
// step: write(한두 줄 적기) → refine(초안 다듬기). 칸 목록은 [{ label, picked }]이고 picked가 거짓이면 추천(회색)이다.
const createDraft = (patch = {}) => {
    return { name: "", summary: "", users: [], features: [], exclusions: [], stack: { choice: "later", items: [], reason: "", custom: [] }, refs: [], ...patch };
};

const INITIAL_STATE = {
    step: "write",
    what: "",
    platforms: [],
    draft: createDraft(),
    isDrafted: false,
    isDrafting: false,
    isRevealing: false,
    isCreating: false,
    isRefsOpen: false,
    isMoreOpen: false,
    suggestions: [],
    isSuggesting: false,
    suggestError: "",
    notice: "",
    info: { parentDir: "", author: null, isLoaded: false },
    author: { name: "", email: "" }
};

const useNewProjectStore = create(() => structuredClone(INITIAL_STATE));

const newProject = {
    set: (patch) => useNewProjectStore.setState(patch),
    get: () => useNewProjectStore.getState(),
    setDraft: (patch) => useNewProjectStore.setState((state) => ({ draft: { ...state.draft, ...patch } })),
    setStack: (patch) => useNewProjectStore.setState((state) => ({ draft: { ...state.draft, stack: { ...state.draft.stack, ...patch } } })),

    togglePlatform: (key) =>
        useNewProjectStore.setState((state) => {
            // "아직 몰라요"는 다른 것과 함께 고르지 않는다.
            const rest = state.platforms.filter((item) => item !== key && (key === "unknown" ? false : item !== "unknown"));

            return { platforms: state.platforms.includes(key) ? state.platforms.filter((item) => item !== key) : [...rest, key] };
        }),

    toggleItem: (field, index) =>
        useNewProjectStore.setState((state) => ({
            draft: { ...state.draft, [field]: state.draft[field].map((item, itemIndex) => (itemIndex === index ? { ...item, picked: !item.picked } : item)) }
        })),

    // 더한 것은 넣은 상태다. 이미 있는 이름이면 추천이어도 넣은 상태로 바꾼다.
    addItems: (field, labels) =>
        useNewProjectStore.setState((state) => {
            const items = [...state.draft[field]];

            for (const label of labels) {
                const index = items.findIndex((item) => item.label === label);

                if (index < 0) {
                    items.push({ label: label, picked: true });
                } else {
                    items[index] = { ...items[index], picked: true };
                }
            }

            return { draft: { ...state.draft, [field]: items } };
        }),

    removeItem: (field, index) => useNewProjectStore.setState((state) => ({ draft: { ...state.draft, [field]: state.draft[field].filter((item, itemIndex) => itemIndex !== index) } })),

    // 처음부터 다시: 적은 한두 줄과 실행 환경은 남기고 초안만 비운다.
    restart: () =>
        useNewProjectStore.setState((state) => ({
            ...structuredClone(INITIAL_STATE),
            what: state.what,
            platforms: state.platforms,
            info: state.info,
            author: state.author,
            suggestions: state.suggestions
        })),
    clear: () => useNewProjectStore.setState((state) => ({ ...structuredClone(INITIAL_STATE), info: state.info }))
};

export { useNewProjectStore, newProject, createDraft };

import { create } from "zustand";

const EMPTY_CODEX_ACCOUNT = { installed: true, loggedIn: false, profile: null, limits: [], fetchedAt: 0, error: null, loginExpiresAt: 0 };

// Codex 계정 목록·선택·로그인 상태와 계정별 프로필·한도. 메인 프로세스가 보내는 값을 그대로 담는다(Claude 계정의 accountStore와 같은 모양).
const useCodexAccountStore = create(() => ({
    accounts: [],
    activeId: "default",
    snapshots: {},
    login: null,
    message: "",
    isFormOpen: false,
    isRefreshing: false
}));

const applyCodexAccountsPayload = (payload) => {
    useCodexAccountStore.setState((current) => ({
        accounts: payload.accounts,
        activeId: payload.activeId,
        snapshots: { ...current.snapshots, ...payload.snapshots }
    }));
};

const setCodexAccountSnapshot = (id, account) => {
    useCodexAccountStore.setState((current) => ({ snapshots: { ...current.snapshots, [id]: account } }));
};

export { EMPTY_CODEX_ACCOUNT, useCodexAccountStore, applyCodexAccountsPayload, setCodexAccountSnapshot };

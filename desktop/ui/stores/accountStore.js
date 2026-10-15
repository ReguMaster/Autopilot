import { create } from "zustand";

const EMPTY_ACCOUNT = { profile: null, limits: [], fetchedAt: 0, error: null, loginExpiresAt: 0 };

// 계정 목록·선택·로그인 상태와 계정별 프로필·사용량. 메인 프로세스가 보내는 값을 그대로 담는다.
const useAccountStore = create(() => ({
    accounts: [],
    activeId: "default",
    claudeDir: null,
    snapshots: {},
    login: null,
    message: "",
    isFormOpen: false,
    isRefreshing: false
}));

const applyAccountsPayload = (payload) => {
    useAccountStore.setState((current) => ({
        accounts: payload.accounts,
        activeId: payload.activeId,
        claudeDir: payload.claudeDir,
        snapshots: { ...current.snapshots, ...payload.snapshots }
    }));
};

const setAccountSnapshot = (id, account) => {
    useAccountStore.setState((current) => ({ snapshots: { ...current.snapshots, [id]: account } }));
};

export { EMPTY_ACCOUNT, useAccountStore, applyAccountsPayload, setAccountSnapshot };

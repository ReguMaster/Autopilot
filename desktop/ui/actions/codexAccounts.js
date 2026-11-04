import { STATUS_OK } from "../lib/constants.js";
import { applyCodexAccountsPayload, setCodexAccountSnapshot, useCodexAccountStore } from "../stores/codexAccountStore.js";
import { modal } from "../stores/modalStore.js";

const LOGIN_DONE_HIDE_MS = 3000;

let loginHideTimer = 0;

const setMessage = (message) => useCodexAccountStore.setState({ message: message });

const showFailure = (result) => {
    setMessage(result.status === STATUS_OK ? "" : result.error.msg);

    return result.status === STATUS_OK;
};

const hideLogin = () => {
    clearTimeout(loginHideTimer);
    useCodexAccountStore.setState({ login: null });
};

const applyCodexLogin = (login) => {
    clearTimeout(loginHideTimer);
    useCodexAccountStore.setState(login?.phase === "waiting" ? { login: login, isFormOpen: false } : { login: login });

    if (login?.phase === "succeeded") {
        loginHideTimer = setTimeout(hideLogin, LOGIN_DONE_HIDE_MS);
    }
};

const applyCodexPayload = (payload) => {
    const wasWaiting = useCodexAccountStore.getState().login?.phase === "waiting";

    applyCodexAccountsPayload(payload);

    if (payload.login || wasWaiting) {
        applyCodexLogin(payload.login);
    }
};

const getLabel = (id) => useCodexAccountStore.getState().accounts.find((account) => account.id === id)?.label;

// Codex 계정 동작. id를 생략하면 지금 고른 계정이다.
const codexAccounts = {
    select: async (id) => {
        if (id === useCodexAccountStore.getState().activeId) {
            return;
        }

        const result = await window.autopilot.selectCodexAccount(id);

        if (showFailure(result)) {
            applyCodexPayload(result.data);
        }
    },
    openForm: () => {
        setMessage("");
        useCodexAccountStore.setState({ isFormOpen: true });
    },
    closeForm: () => useCodexAccountStore.setState({ isFormOpen: false }),
    add: async (label) => {
        const isOk = showFailure(await window.autopilot.addCodexAccount({ label: label }));

        if (isOk) {
            useCodexAccountStore.setState({ isFormOpen: false });
        }

        return isOk;
    },
    login: async (id = useCodexAccountStore.getState().activeId) => {
        showFailure(await window.autopilot.loginCodexAccount(id));
    },
    logout: async (id = useCodexAccountStore.getState().activeId) => {
        const isConfirmed = await modal.confirm({
            title: `'${getLabel(id)}' 계정을 로그아웃할까요?`,
            message: "이 계정의 Codex 로그인 정보를 지워요. 계정은 목록에 남아 있어서 다시 로그인하면 바로 쓸 수 있어요.",
            confirmLabel: "로그아웃",
            tone: "danger"
        });

        if (isConfirmed) {
            const result = await window.autopilot.logoutCodexAccount(id);

            if (showFailure(result)) {
                applyCodexPayload(result.data);
            }
        }
    },
    remove: async (id = useCodexAccountStore.getState().activeId) => {
        const isConfirmed = await modal.confirm({
            title: `'${getLabel(id)}' 계정을 제거할까요?`,
            message: "앱에 저장된 이 계정의 로그인 정보와 설정 폴더를 지워요. Codex 계정 자체에는 영향이 없고, 다시 추가하면 새로 로그인해야 해요.",
            confirmLabel: "제거",
            tone: "danger"
        });

        if (isConfirmed) {
            const result = await window.autopilot.removeCodexAccount(id);

            if (showFailure(result)) {
                applyCodexPayload(result.data);
            }
        }
    },
    cancelLogin: async () => {
        if (useCodexAccountStore.getState().login?.phase === "waiting") {
            await window.autopilot.cancelCodexLogin();
        } else {
            hideLogin();
        }
    },
    openLoginUrl: async () => {
        showFailure(await window.autopilot.openCodexLoginUrl());
    },
    refresh: async () => {
        useCodexAccountStore.setState({ isRefreshing: true });

        const result = await window.autopilot.refreshCodexAccount(useCodexAccountStore.getState().activeId);

        useCodexAccountStore.setState({ isRefreshing: false });

        if (showFailure(result)) {
            setCodexAccountSnapshot(result.data.id, result.data.account);
        }
    }
};

export { codexAccounts, applyCodexPayload, applyCodexLogin };

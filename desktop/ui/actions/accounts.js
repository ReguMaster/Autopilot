import { STATUS_OK } from "../lib/constants.js";
import { applyAccountsPayload, setAccountSnapshot, useAccountStore } from "../stores/accountStore.js";
import { ui, useUiStore } from "../stores/uiStore.js";
import { startRun } from "./run.js";

const LOGIN_DONE_HIDE_MS = 3000;

let loginHideTimer = 0;

const setMessage = (message) => useAccountStore.setState({ message: message });

const showAccountFailure = (result) => {
    setMessage(result.status === STATUS_OK ? "" : result.error.msg);

    return result.status === STATUS_OK;
};

const hideLogin = () => {
    clearTimeout(loginHideTimer);
    useAccountStore.setState({ login: null });
};

// 로그인이 끝나면 멈췄던 시작을 이어간다. 결과 전에 로그인 상태가 비어(null) 오는 갱신이 있어 끝난 단계만 본다.
const applyLogin = (login) => {
    clearTimeout(loginHideTimer);
    useAccountStore.setState({ login: login });

    if (login?.phase === "succeeded") {
        loginHideTimer = setTimeout(hideLogin, LOGIN_DONE_HIDE_MS);
    }

    if (useUiStore.getState().startAfterLogin && login && login.phase !== "waiting") {
        ui.set({ startAfterLogin: false });

        if (login.phase === "succeeded") {
            ui.showLoginRequired(null);
            startRun();
        }
    }
};

const applyPayload = (payload) => {
    const wasWaiting = useAccountStore.getState().login?.phase === "waiting";

    applyAccountsPayload(payload);

    if (payload.login || wasWaiting) {
        applyLogin(payload.login);
    }
};

const accounts = {
    select: async (id) => {
        if (id === useAccountStore.getState().activeId) {
            return;
        }

        const result = await window.autopilot.selectAccount(id);

        if (showAccountFailure(result)) {
            applyPayload(result.data);
        }
    },
    openForm: () => {
        setMessage("");
        useAccountStore.setState({ isFormOpen: true });
    },
    closeForm: () => useAccountStore.setState({ isFormOpen: false }),
    // 만들면 폼을 닫는다. 성공 여부를 돌려줘 폼이 입력을 비울 수 있게 한다.
    add: async (label, shareData) => {
        const isOk = showAccountFailure(await window.autopilot.addAccount({ label: label, shareData: shareData }));

        if (isOk) {
            useAccountStore.setState({ isFormOpen: false });
        }

        return isOk;
    },
    login: async () => {
        showAccountFailure(await window.autopilot.loginAccount(useAccountStore.getState().activeId));
    },
    remove: async () => {
        const result = await window.autopilot.removeAccount(useAccountStore.getState().activeId);

        if (showAccountFailure(result) && !result.data.cancelled) {
            applyPayload(result.data);
        }
    },
    cancelLogin: async () => {
        if (useAccountStore.getState().login?.phase === "waiting") {
            await window.autopilot.cancelLogin();
        } else {
            hideLogin();
        }
    },
    submitLoginCode: async (code) => showAccountFailure(await window.autopilot.submitLoginCode(code)),
    openLoginUrl: async () => {
        showAccountFailure(await window.autopilot.openLoginUrl());
    },
    changeClaudeDir: async (request) => {
        const result = await request();

        ui.showFailure(result);

        if (result.status === STATUS_OK) {
            applyPayload(result.data);
        }
    },
    refresh: async () => {
        useAccountStore.setState({ isRefreshing: true });

        const result = await window.autopilot.refreshAccount(useAccountStore.getState().activeId);

        useAccountStore.setState({ isRefreshing: false });

        if (showAccountFailure(result)) {
            setAccountSnapshot(result.data.id, result.data.account);
        }
    },
    // 안내 줄의 로그인 버튼: 선택한 계정의 로그인을 시작하고 주소·코드 입력이 있는 프로필 패널을 연다.
    loginFromBanner: async () => {
        const result = await window.autopilot.loginAccount(useAccountStore.getState().activeId);

        ui.showFailure(result);

        if (result.status === STATUS_OK) {
            ui.set({ startAfterLogin: true });
            ui.setPanel("profile");
        }
    }
};

export { accounts, applyPayload, applyLogin };

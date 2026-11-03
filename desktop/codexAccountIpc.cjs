const { app, shell } = require("electron");
const path = require("node:path");
const { STATUS_OK, STATUS_FAILED } = require("./autopilotRunner.cjs");
const { sanitizeLabel, MAX_ACCOUNTS } = require("./accountStore.cjs");
const { createCodexAccountReader } = require("./codexAccount.cjs");
const { createCodexAccountStore, normalizeCodexAccounts, DEFAULT_CODEX_ACCOUNT_ID, DEFAULT_CODEX_ACCOUNT_LABEL } = require("./codexAccountStore.cjs");
const { getDefaultCodexHome, startCodexLogin, logoutCodex, isCodexLoginUrl } = require("./codexCli.cjs");

const LOGIN_WAITING_MESSAGE = "열린 브라우저에서 로그인을 마쳐 주세요.";

const createFailure = (code, msg) => {
    return { status: STATUS_FAILED, error: { code: code, msg: msg } };
};

// Codex 계정의 목록·선택·로그인·로그아웃·제거와 계정별 한도 조회를 맡는다. Claude 계정(accountIpc)과 같은 규칙이다:
// 계정은 프로젝트(탭)마다 고르고, 실행 중에는 바꾸지 못하며, 로그인 정보는 계정마다 따로 둔 CODEX_HOME 폴더에만 있다.
const createCodexAccountIpc = ({
    readSettings,
    writeSettings,
    getCodexAccountId,
    setCodexAccountId,
    resolveProjectDir,
    broadcast,
    isRunning,
    isProjectRunning,
    onAccountsChange = () => {},
    launch = undefined,
    store = createCodexAccountStore({ accountsRoot: path.join(app.getPath("userData"), "codex-accounts"), getBaseHome: () => getDefaultCodexHome() })
}) => {
    const readers = new Map();
    const startedReaders = new Set();
    let login = null;
    let isWatching = false;

    const listAccounts = (settings) => {
        const added = normalizeCodexAccounts(settings.codexAccounts).map((account) => ({ ...account, isDefault: false }));

        return [{ id: DEFAULT_CODEX_ACCOUNT_ID, label: DEFAULT_CODEX_ACCOUNT_LABEL, isDefault: true }, ...added];
    };

    const hasAccount = (accountId) => listAccounts(readSettings()).some((account) => account.id === accountId);

    const getActiveId = (settings, projectDir) => {
        const accountId = getCodexAccountId(projectDir);

        return listAccounts(settings).some((account) => account.id === accountId) ? accountId : DEFAULT_CODEX_ACCOUNT_ID;
    };

    const getReader = (accountId) => {
        if (!readers.has(accountId)) {
            readers.set(
                accountId,
                createCodexAccountReader({
                    codexHome: store.getHome(accountId),
                    launch: launch,
                    onChange: (account) => broadcast("autopilot:codex-account", { id: accountId, account: account })
                })
            );
        }

        return readers.get(accountId);
    };

    const startReader = (accountId) => {
        if (!startedReaders.has(accountId)) {
            startedReaders.add(accountId);
            getReader(accountId).start();
        }
    };

    const dropReader = (accountId) => {
        readers.get(accountId)?.stop();
        readers.delete(accountId);
        startedReaders.delete(accountId);
    };

    const getLoginPhase = (result) => {
        if (result.ok) {
            return "succeeded";
        }

        return result.cancelled ? "cancelled" : "failed";
    };

    const getLoginState = (phase, message) => {
        return login ? { accountId: login.accountId, phase: phase || "waiting", url: login.url, message: message || LOGIN_WAITING_MESSAGE } : null;
    };

    const getPayload = (projectDir) => {
        const settings = readSettings();
        const accounts = listAccounts(settings);

        return {
            accounts: accounts,
            activeId: getActiveId(settings, projectDir),
            snapshots: Object.fromEntries(accounts.map((account) => [account.id, getReader(account.id).getAccount()])),
            login: getLoginState()
        };
    };

    const broadcastPayload = () => {
        const payload = getPayload();

        onAccountsChange();
        broadcast("autopilot:codex-accounts", payload);

        return { status: STATUS_OK, data: payload };
    };

    const getBusyFailure = () => {
        if (isRunning()) {
            return createFailure("RUNNING", "실행 중에는 계정을 바꿀 수 없어요.");
        }

        return login ? createFailure("LOGIN_IN_PROGRESS", "로그인이 진행 중이에요. 마치거나 취소한 뒤 다시 시도해 주세요.") : null;
    };

    const createNoProjectFailure = () => {
        return createFailure("INVALID_PROJECT", "열려 있는 프로젝트가 아니에요.");
    };

    const createNoAccountFailure = () => {
        return createFailure("INVALID_ACCOUNT", "알 수 없는 계정이에요.");
    };

    const finishLogin = async (accountId, isNew, projectDir, result) => {
        login = null;

        const settings = readSettings();
        const accounts = normalizeCodexAccounts(settings.codexAccounts);

        if (result.ok) {
            const labeled = accounts.map((account) => (account.id === accountId && account.label === account.id ? { ...account, label: sanitizeLabel(result.email) || account.label } : account));

            writeSettings({ ...settings, codexAccounts: labeled });

            if (isNew) {
                setCodexAccountId(projectDir, accountId);
            }

            await getReader(accountId).refresh(true);

            if (isWatching) {
                startReader(accountId);
            }
        } else if (isNew) {
            dropReader(accountId);

            // 방금 끝난 로그인 프로세스가 폴더를 잡고 있으면(Windows EBUSY) 못 지운다. 그래도 목록 정리와 결과 알림은 해야 화면이 로그인 대기에 멈추지 않는다.
            try {
                store.removeAccountDir(accountId);
            } catch {}

            writeSettings({ ...settings, codexAccounts: accounts.filter((account) => account.id !== accountId) });
        }

        broadcastPayload();
        broadcast("autopilot:codex-login", { accountId: accountId, phase: getLoginPhase(result), url: "", message: result.ok ? "로그인했어요." : result.message });
    };

    const beginLogin = (accountId, isNew, projectDir) => {
        login = { accountId: accountId, isNew: isNew, session: null, url: "" };

        const session = startCodexLogin(
            store.getHome(accountId),
            {
                onUrl: (url) => {
                    if (login?.accountId === accountId) {
                        login.url = url;
                        broadcast("autopilot:codex-login", getLoginState());
                    }
                },
                onFinish: (result) => finishLogin(accountId, isNew, projectDir, result)
            },
            launch
        );

        if (login?.accountId === accountId) {
            login.session = session;
        }
    };

    const handleGetAccounts = (event, requestedDir) => {
        const projectDir = resolveProjectDir(requestedDir);

        return projectDir === null ? createNoProjectFailure() : { status: STATUS_OK, data: getPayload(projectDir) };
    };

    const handleRefresh = async (event, accountId) => {
        if (!hasAccount(accountId)) {
            return createNoAccountFailure();
        }

        return { status: STATUS_OK, data: { id: accountId, account: await getReader(accountId).refresh(true) } };
    };

    const handleSelect = (event, accountId, requestedDir) => {
        const projectDir = resolveProjectDir(requestedDir);

        if (projectDir === null) {
            return createNoProjectFailure();
        }

        if (isProjectRunning(projectDir)) {
            return createFailure("RUNNING", "실행 중에는 계정을 바꿀 수 없어요.");
        }

        if (!hasAccount(accountId)) {
            return createNoAccountFailure();
        }

        setCodexAccountId(projectDir, accountId);

        return broadcastPayload();
    };

    const handleAdd = (event, options = {}) => {
        const busyFailure = getBusyFailure();
        const projectDir = resolveProjectDir(options.projectDir);

        if (busyFailure) {
            return busyFailure;
        }

        if (projectDir === null) {
            return createNoProjectFailure();
        }

        const settings = readSettings();
        const accounts = normalizeCodexAccounts(settings.codexAccounts);

        if (accounts.length >= MAX_ACCOUNTS) {
            return createFailure("TOO_MANY_ACCOUNTS", `계정은 기본 계정 외에 ${MAX_ACCOUNTS}개까지 추가할 수 있어요.`);
        }

        let created = null;

        try {
            created = store.createAccount({ label: options.label });
        } catch (error) {
            return createFailure("CREATE_FAILED", `계정 폴더를 만들지 못했어요. ${error.message}`);
        }

        writeSettings({ ...settings, codexAccounts: [...accounts, { id: created.id, label: created.label }] });
        beginLogin(created.id, true, projectDir);
        broadcastPayload();

        return { status: STATUS_OK, data: { accountId: created.id } };
    };

    const handleLogin = (event, accountId) => {
        const busyFailure = getBusyFailure();

        if (busyFailure) {
            return busyFailure;
        }

        if (!hasAccount(accountId)) {
            return createNoAccountFailure();
        }

        beginLogin(accountId, false, resolveProjectDir());
        broadcast("autopilot:codex-login", getLoginState());

        return { status: STATUS_OK };
    };

    const handleCancelLogin = () => {
        login?.session?.cancel();

        return { status: STATUS_OK };
    };

    const handleOpenLoginUrl = async () => {
        if (!login?.url || !isCodexLoginUrl(login.url)) {
            return createFailure("NO_LOGIN_URL", "열 수 있는 로그인 주소가 아직 없어요.");
        }

        await shell.openExternal(login.url);

        return { status: STATUS_OK };
    };

    const handleLogout = async (event, accountId) => {
        const busyFailure = getBusyFailure();

        if (busyFailure) {
            return busyFailure;
        }

        if (!hasAccount(accountId)) {
            return createNoAccountFailure();
        }

        const result = await logoutCodex(store.getHome(accountId), launch);

        if (!result.ok) {
            return createFailure("LOGOUT_FAILED", result.message);
        }

        await getReader(accountId).refresh(true);

        return broadcastPayload();
    };

    const handleRemove = async (event, accountId) => {
        const busyFailure = getBusyFailure();

        if (busyFailure) {
            return busyFailure;
        }

        const target = listAccounts(readSettings()).find((account) => account.id === accountId);

        if (!target || target.isDefault) {
            return createFailure("INVALID_ACCOUNT", "제거할 수 있는 계정이 아니에요.");
        }

        dropReader(accountId);

        // 로그인 정보를 키링에 두는 환경도 있어 폴더를 지우기 전에 로그아웃을 먼저 시도한다(실패해도 제거는 계속한다).
        await logoutCodex(store.getHome(accountId), launch);

        try {
            store.removeAccountDir(accountId);
        } catch (error) {
            return createFailure("REMOVE_FAILED", `계정 폴더를 지우지 못했어요. 사용 중인 파일이 없는지 확인해 주세요. (${error.code || error.message})`);
        }

        // 로그아웃을 기다리는 동안 다른 곳이 저장했을 수 있어 다시 읽는다.
        const settings = readSettings();

        writeSettings({
            ...settings,
            codexAccounts: normalizeCodexAccounts(settings.codexAccounts).filter((account) => account.id !== accountId),
            codexAccountId: settings.codexAccountId === accountId ? DEFAULT_CODEX_ACCOUNT_ID : settings.codexAccountId
        });

        return broadcastPayload();
    };

    const register = (handle) => {
        handle("autopilot:get-codex-accounts", handleGetAccounts);
        handle("autopilot:refresh-codex-account", handleRefresh);
        handle("autopilot:select-codex-account", handleSelect);
        handle("autopilot:add-codex-account", handleAdd);
        handle("autopilot:login-codex-account", handleLogin);
        handle("autopilot:cancel-codex-login", handleCancelLogin);
        handle("autopilot:open-codex-login-url", handleOpenLoginUrl);
        handle("autopilot:logout-codex-account", handleLogout);
        handle("autopilot:remove-codex-account", handleRemove);
    };

    const startWatch = () => {
        isWatching = true;

        for (const account of listAccounts(readSettings())) {
            startReader(account.id);
        }
    };

    // 엔진에 넘길 CODEX_HOME. 기본 계정은 엔진이 환경의 CODEX_HOME·~/.codex를 그대로 쓰도록 빈 문자열이다.
    const getRunHome = (projectDir) => {
        const activeId = getActiveId(readSettings(), projectDir);

        return activeId === DEFAULT_CODEX_ACCOUNT_ID ? "" : store.getHome(activeId);
    };

    // 선택한 계정의 실제 CODEX_HOME(기본 계정 포함). 설치·로그인 확인과 모델 목록 읽기에 쓴다.
    const getActiveHome = (projectDir) => {
        return store.getHome(getActiveId(readSettings(), projectDir));
    };

    return {
        register: register,
        startWatch: startWatch,
        getRunHome: getRunHome,
        getActiveHome: getActiveHome,
        cancelLogin: handleCancelLogin,
        broadcastPayload: broadcastPayload
    };
};

module.exports = { createCodexAccountIpc };

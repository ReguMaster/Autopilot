const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { STATUS_OK, STATUS_FAILED } = require("./autopilotRunner.cjs");
const { createAccountReader } = require("./claudeAccount.cjs");
const { startLogin, isLoginUrl, getAuthStatus, renewCredentials } = require("./claudeCli.cjs");
const { createAccountStore, normalizeAccounts, sanitizeLabel, resolveBaseDir, getHomeConfigDir, DEFAULT_ACCOUNT_ID, DEFAULT_ACCOUNT_LABEL, MAX_ACCOUNTS } = require("./accountStore.cjs");

const CREDENTIALS_FILE_NAME = ".credentials.json";
const LOGIN_WAITING_MESSAGE = "브라우저에서 로그인을 마쳐 주세요.";

const createFailure = (code, msg) => {
    return { status: STATUS_FAILED, error: { code: code, msg: msg } };
};

// 계정 목록·선택·로그인·제거와 계정별 사용량 조회를 맡는다. 설정 저장과 화면 전달은 호출한 쪽이 넘겨 준 함수를 쓴다.
// 선택한 계정은 프로젝트(탭)마다 다르다. getAccountId·setAccountId는 프로젝트(생략하면 활성 프로젝트)의 계정 id를 읽고 쓰고,
// resolveProjectDir은 요청한 프로젝트가 열려 있으면 그 경로(생략하면 활성 프로젝트), 아니면 null을 돌려준다.
// isRunning은 어느 프로젝트든 실행 중인지, isProjectRunning은 그 프로젝트가 실행 중인지다.
const createAccountIpc = ({
    readSettings,
    writeSettings,
    getAccountId,
    setAccountId,
    resolveProjectDir,
    broadcast,
    isRunning,
    isProjectRunning,
    loginExpiresAtOverride = 0,
    store = createAccountStore({ accountsRoot: path.join(app.getPath("userData"), "accounts"), getBaseDir: () => resolveBaseDir(readSettings().claudeDir) })
}) => {
    const readers = new Map();
    const startedReaders = new Set();
    let login = null;
    let isWatching = false;

    const listAccounts = (settings) => {
        const added = normalizeAccounts(settings.accounts).map((account) => ({ ...account, isDefault: false }));

        return [{ id: DEFAULT_ACCOUNT_ID, label: DEFAULT_ACCOUNT_LABEL, isDefault: true }, ...added];
    };

    // 프로젝트가 고른 계정. 지워졌거나 알 수 없는 id는 기본 계정으로 본다.
    const getActiveId = (settings, projectDir) => {
        const accountId = getAccountId(projectDir);

        return listAccounts(settings).some((account) => account.id === accountId) ? accountId : DEFAULT_ACCOUNT_ID;
    };

    const getReader = (accountId) => {
        if (!readers.has(accountId)) {
            const reader = createAccountReader({
                credentialsFile: path.join(store.getConfigDir(accountId), CREDENTIALS_FILE_NAME),
                loginExpiresAtOverride: loginExpiresAtOverride,
                renewCredentials: async () => (isRunning() || login ? false : renewCredentials(store.getConfigDir(accountId))),
                onChange: (account) => broadcast("autopilot:account", { id: accountId, account: account })
            });

            readers.set(accountId, reader);
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

    const getClaudeDirInfo = (settings) => {
        const dir = resolveBaseDir(settings.claudeDir);

        return { path: dir, isAuto: !settings.claudeDir, exists: fs.existsSync(dir) };
    };

    const getPayload = (projectDir) => {
        const settings = readSettings();
        const accounts = listAccounts(settings);

        return {
            accounts: accounts,
            activeId: getActiveId(settings, projectDir),
            claudeDir: getClaudeDirInfo(settings),
            snapshots: Object.fromEntries(accounts.map((account) => [account.id, getReader(account.id).getAccount()])),
            login: getLoginState()
        };
    };

    const broadcastPayload = () => {
        const payload = getPayload();

        broadcast("autopilot:accounts", payload);

        return { status: STATUS_OK, data: payload };
    };

    const getBusyFailure = () => {
        if (isRunning()) {
            return createFailure("RUNNING", "실행 중에는 계정을 바꿀 수 없어요.");
        }

        return login ? createFailure("LOGIN_IN_PROGRESS", "로그인이 진행 중이에요. 마치거나 취소한 뒤 다시 시도해 주세요.") : null;
    };

    const finishLogin = async (accountId, isNew, projectDir, result) => {
        login = null;

        const settings = readSettings();
        const accounts = normalizeAccounts(settings.accounts);

        if (result.ok) {
            const labeled = accounts.map((account) => (account.id === accountId && account.label === account.id ? { ...account, label: sanitizeLabel(result.email) || account.label } : account));

            writeSettings({ ...settings, accounts: labeled });

            if (isNew) {
                setAccountId(projectDir, accountId);
            }

            await getReader(accountId).refresh(true);

            if (isWatching) {
                startReader(accountId);
            }
        } else if (isNew) {
            dropReader(accountId);
            store.removeAccountDir(accountId);
            writeSettings({ ...settings, accounts: accounts.filter((account) => account.id !== accountId) });
        }

        broadcastPayload();
        broadcast("autopilot:login", { accountId: accountId, phase: getLoginPhase(result), url: "", message: result.ok ? "로그인했어요." : result.message });
    };

    // 이미 로그인했던 계정은 알고 있는 이메일을 로그인 페이지에 미리 채워 인증 코드만 입력하면 되게 한다.
    const beginLogin = (accountId, isNew, projectDir) => {
        login = { accountId: accountId, isNew: isNew, session: null, url: "" };

        const session = startLogin(
            store.getConfigDir(accountId),
            {
                onUrl: (url) => {
                    if (login?.accountId === accountId) {
                        login.url = url;
                        broadcast("autopilot:login", getLoginState());
                    }
                },
                onFinish: (result) => finishLogin(accountId, isNew, projectDir, result)
            },
            { email: isNew ? "" : getReader(accountId).getAccount().profile?.email }
        );

        if (login?.accountId === accountId) {
            login.session = session;
        }
    };

    const createNoProjectFailure = () => {
        return createFailure("INVALID_PROJECT", "열려 있는 프로젝트가 아니에요.");
    };

    const handleGetAccounts = (event, requestedDir) => {
        const projectDir = resolveProjectDir(requestedDir);

        return projectDir === null ? createNoProjectFailure() : { status: STATUS_OK, data: getPayload(projectDir) };
    };

    const handleRefresh = async (event, accountId) => {
        if (!listAccounts(readSettings()).some((account) => account.id === accountId)) {
            return createFailure("INVALID_ACCOUNT", "알 수 없는 계정이에요.");
        }

        return { status: STATUS_OK, data: { id: accountId, account: await getReader(accountId).refresh() } };
    };

    // 선택한 계정으로 쓸 수 있는 모델 목록. 조회하지 못하면 빈 목록이고 화면은 "최신"만 보여준다.
    const handleGetModels = async (event, requestedDir) => {
        const projectDir = resolveProjectDir(requestedDir);

        if (projectDir === null) {
            return createNoProjectFailure();
        }

        const models = await getReader(getActiveId(readSettings(), projectDir)).getModels();

        return { status: STATUS_OK, data: { models: models } };
    };

    // 계정은 그 프로젝트가 실행 중이 아닐 때 바꾼다. 다른 프로젝트가 돌고 있어도 이 프로젝트의 계정은 바꿀 수 있다.
    const handleSelect = (event, accountId, requestedDir) => {
        const projectDir = resolveProjectDir(requestedDir);

        if (projectDir === null) {
            return createNoProjectFailure();
        }

        if (isProjectRunning(projectDir)) {
            return createFailure("RUNNING", "실행 중에는 계정을 바꿀 수 없어요.");
        }

        if (!listAccounts(readSettings()).some((account) => account.id === accountId)) {
            return createFailure("INVALID_ACCOUNT", "알 수 없는 계정이에요.");
        }

        setAccountId(projectDir, accountId);

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
        const accounts = normalizeAccounts(settings.accounts);

        if (accounts.length >= MAX_ACCOUNTS) {
            return createFailure("TOO_MANY_ACCOUNTS", `계정은 기본 계정 외에 ${MAX_ACCOUNTS}개까지 추가할 수 있어요.`);
        }

        let created = null;

        try {
            created = store.createAccount({ label: options.label, shareData: options.shareData === true });
        } catch (error) {
            return createFailure("CREATE_FAILED", `계정 폴더를 만들지 못했어요. ${error.message}`);
        }

        writeSettings({ ...settings, accounts: [...accounts, { id: created.id, label: created.label, shared: created.shared }] });
        beginLogin(created.id, true, projectDir);
        broadcastPayload();

        return { status: STATUS_OK, data: { accountId: created.id } };
    };

    const handleLogin = (event, accountId) => {
        const busyFailure = getBusyFailure();

        if (busyFailure) {
            return busyFailure;
        }

        if (!listAccounts(readSettings()).some((account) => account.id === accountId)) {
            return createFailure("INVALID_ACCOUNT", "알 수 없는 계정이에요.");
        }

        beginLogin(accountId, false, resolveProjectDir());
        broadcast("autopilot:login", getLoginState());

        return { status: STATUS_OK };
    };

    const handleSubmitCode = (event, code) => {
        if (!login?.session || !login.session.submitCode(String(code ?? "").trim())) {
            return createFailure("INVALID_CODE", "로그인 코드를 확인해 주세요.");
        }

        return { status: STATUS_OK };
    };

    const handleCancelLogin = () => {
        login?.session?.cancel();

        return { status: STATUS_OK };
    };

    const handleOpenLoginUrl = async () => {
        if (!login?.url || !isLoginUrl(login.url)) {
            return createFailure("NO_LOGIN_URL", "열 수 있는 로그인 주소가 아직 없어요.");
        }

        await shell.openExternal(login.url);

        return { status: STATUS_OK };
    };

    const handleRemove = async (event, accountId) => {
        const busyFailure = getBusyFailure();

        if (busyFailure) {
            return busyFailure;
        }

        const settings = readSettings();
        const target = listAccounts(settings).find((account) => account.id === accountId);

        if (!target || target.isDefault) {
            return createFailure("INVALID_ACCOUNT", "제거할 수 있는 계정이 아니에요.");
        }

        dropReader(accountId);

        try {
            store.removeAccountDir(accountId);
        } catch (error) {
            return createFailure("REMOVE_FAILED", `계정 폴더를 지우지 못했어요. 사용 중인 파일이 없는지 확인해 주세요. (${error.code || error.message})`);
        }

        writeSettings({
            ...settings,
            accounts: normalizeAccounts(settings.accounts).filter((account) => account.id !== accountId),
            accountId: settings.accountId === accountId ? DEFAULT_ACCOUNT_ID : settings.accountId
        });

        return broadcastPayload();
    };

    // 기본 계정은 기본 .claude를 쓴다. 엔진의 기본값(~/.claude)과 같으면 빈 문자열로 두고, 다른 위치면 그 폴더를 명시한다. 직접 고른 폴더가 없어졌으면 시작하지 않는다.
    const getDefaultRunAccount = (settings) => {
        const baseDir = resolveBaseDir(settings.claudeDir);

        if (settings.claudeDir && !fs.existsSync(baseDir)) {
            return createFailure("CLAUDE_DIR_MISSING", "설정에서 지정한 Claude 데이터 폴더를 찾지 못했어요. 폴더를 다시 지정하거나 자동 감지로 바꿔 주세요.");
        }

        return { status: STATUS_OK, data: { configDir: path.resolve(baseDir) === path.resolve(getHomeConfigDir()) ? "" : baseDir } };
    };

    // 시작할 때 쓸 계정의 설정 폴더. 기본 계정은 엔진의 기본값(~/.claude)을 쓰도록 빈 문자열이다. 어느 계정이든 로그인돼 있어야 한다.
    // 로그인 정보가 저장되는 곳이 플랫폼마다 다르므로(macOS는 키체인) 파일 대신 `claude auth status`로 확인한다.
    const getRunAccount = async (projectDir) => {
        const settings = readSettings();
        const activeId = getActiveId(settings, projectDir);

        if (login) {
            return createFailure("LOGIN_IN_PROGRESS", "로그인이 진행 중이에요. 마치거나 취소한 뒤 시작해 주세요.");
        }

        const runAccount = activeId === DEFAULT_ACCOUNT_ID ? getDefaultRunAccount(settings) : { status: STATUS_OK, data: { configDir: store.getConfigDir(activeId) } };

        if (runAccount.status !== STATUS_OK) {
            return runAccount;
        }

        const status = await getAuthStatus(store.getConfigDir(activeId));

        if (status.error) {
            return createFailure("LOGIN_STATUS_FAILED", `선택한 계정의 로그인 상태를 확인하지 못했어요. ${status.error}`);
        }

        if (!status.loggedIn) {
            return createFailure("LOGIN_REQUIRED", "선택한 계정에 로그인되어 있지 않아요. 로그인한 뒤 다시 시작해 주세요.");
        }

        return runAccount;
    };

    // 기본 .claude의 위치가 바뀌면 기본 계정의 조회를 새 위치로 옮기고, 다른 계정의 연결을 다시 잇는다.
    const applyBaseDirChange = () => {
        dropReader(DEFAULT_ACCOUNT_ID);

        for (const account of normalizeAccounts(readSettings().accounts).filter((entry) => entry.shared)) {
            try {
                store.syncSharedData(account.id);
            } catch {}
        }

        if (isWatching) {
            startReader(DEFAULT_ACCOUNT_ID);
        }

        return broadcastPayload();
    };

    const handleSelectClaudeDir = async (event) => {
        const busyFailure = getBusyFailure();

        if (busyFailure) {
            return busyFailure;
        }

        const settings = readSettings();
        const selection = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
            title: "Claude 데이터 폴더 선택 (.claude)",
            defaultPath: resolveBaseDir(settings.claudeDir),
            properties: ["openDirectory", "showHiddenFiles"]
        });

        if (selection.canceled) {
            return { status: STATUS_OK, data: getPayload() };
        }

        writeSettings({ ...settings, claudeDir: selection.filePaths[0] });

        return applyBaseDirChange();
    };

    const handleResetClaudeDir = () => {
        const busyFailure = getBusyFailure();

        if (busyFailure) {
            return busyFailure;
        }

        writeSettings({ ...readSettings(), claudeDir: "" });

        return applyBaseDirChange();
    };

    const register = () => {
        ipcMain.handle("autopilot:get-accounts", handleGetAccounts);
        ipcMain.handle("autopilot:refresh-account", handleRefresh);
        ipcMain.handle("autopilot:get-models", handleGetModels);
        ipcMain.handle("autopilot:select-account", handleSelect);
        ipcMain.handle("autopilot:add-account", handleAdd);
        ipcMain.handle("autopilot:login-account", handleLogin);
        ipcMain.handle("autopilot:submit-login-code", handleSubmitCode);
        ipcMain.handle("autopilot:cancel-login", handleCancelLogin);
        ipcMain.handle("autopilot:open-login-url", handleOpenLoginUrl);
        ipcMain.handle("autopilot:remove-account", handleRemove);
        ipcMain.handle("autopilot:select-claude-dir", handleSelectClaudeDir);
        ipcMain.handle("autopilot:reset-claude-dir", handleResetClaudeDir);
    };

    // 앱을 켤 때 모든 계정을 한 번 조회하고 이후 주기적으로 다시 읽는다. 스모크 테스트는 네트워크를 쓰지 않도록 호출하지 않는다.
    const startWatch = () => {
        isWatching = true;

        for (const account of normalizeAccounts(readSettings().accounts).filter((entry) => entry.shared)) {
            try {
                store.syncSharedData(account.id);
            } catch {}
        }

        for (const account of listAccounts(readSettings())) {
            startReader(account.id);
        }
    };

    // 예약이 한도를 판단할 때 쓴다. 프로젝트(생략하면 활성 프로젝트)가 고른 계정의 마지막으로 읽은 사용량과 다시 읽기.
    const getActiveUsage = (projectDir) => {
        return getReader(getActiveId(readSettings(), projectDir)).getAccount();
    };

    const refreshActiveUsage = (projectDir) => {
        return getReader(getActiveId(readSettings(), projectDir)).refresh();
    };

    return {
        register: register,
        startWatch: startWatch,
        getRunAccount: getRunAccount,
        cancelLogin: handleCancelLogin,
        getActiveUsage: getActiveUsage,
        refreshActiveUsage: refreshActiveUsage,
        broadcastPayload: broadcastPayload
    };
};

module.exports = { createAccountIpc };

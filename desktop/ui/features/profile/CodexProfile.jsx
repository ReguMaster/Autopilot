import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { codexAccounts } from "../../actions/codexAccounts.js";
import { Button } from "../../components/Button.jsx";
import { Icon } from "../../components/Icon.jsx";
import { useAnyRunning } from "../../hooks/useAnyRunning.js";
import { EMPTY_CODEX_ACCOUNT, useCodexAccountStore } from "../../stores/codexAccountStore.js";
import { useRunStore } from "../../stores/runStore.js";
import { getAccountStatus, getAvatarLetter, ProfileCard, Usage } from "./profileParts.jsx";

const MAX_ACCOUNT_COUNT = 9;
const DEFAULT_ACCOUNT_ID = "default";

const CodexAccountList = ({ isLocked, isIdle }) => {
    const { accounts: list, activeId } = useCodexAccountStore(useShallow((store) => ({ accounts: store.accounts, activeId: store.activeId })));

    return (
        <div id="account-select" className="account-list" role="radiogroup" aria-label="사용할 Codex 계정">
            {list.map((account) => (
                <button
                    key={account.id}
                    type="button"
                    className="account-option"
                    data-id={account.id}
                    role="radio"
                    aria-checked={account.id === activeId}
                    disabled={isLocked}
                    title={isIdle ? undefined : "실행 중에는 계정을 바꿀 수 없어요."}
                    onClick={() => codexAccounts.select(account.id)}
                >
                    <span className="initial">{getAvatarLetter({ name: account.label, email: "" })}</span>
                    <span>{account.label}</span>
                </button>
            ))}
        </div>
    );
};

const CodexAccountForm = () => {
    const isOpen = useCodexAccountStore((store) => store.isFormOpen);
    const [label, setLabel] = useState("");
    const inputRef = useRef(null);

    useEffect(() => {
        if (isOpen) {
            inputRef.current?.focus();
        }
    }, [isOpen]);

    return (
        <form
            id="account-form"
            className="account-form"
            hidden={!isOpen}
            onSubmit={async (event) => {
                event.preventDefault();

                if (await codexAccounts.add(label)) {
                    setLabel("");
                }
            }}
        >
            <input
                id="account-label"
                ref={inputRef}
                className="account-input"
                type="text"
                maxLength={30}
                autoComplete="off"
                spellCheck={false}
                placeholder="계정 이름 (비우면 이메일)"
                aria-label="계정 이름"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
            />
            <p className="panel-note">계정마다 로그인 정보를 따로 두는 폴더(CODEX_HOME)를 만들어요. 로그인은 브라우저에서 이어져요.</p>
            <div className="account-actions">
                <Button type="submit" variant="primary">
                    로그인 시작
                </Button>
                <Button
                    id="account-form-cancel"
                    onClick={() => {
                        codexAccounts.closeForm();
                        setLabel("");
                    }}
                >
                    취소
                </Button>
            </div>
        </form>
    );
};

// Codex 로그인은 브라우저에서 끝나면 CLI가 알아서 이어진다(코드 입력 없음). 브라우저가 열리지 않았을 때를 위해 주소 열기를 둔다.
const CodexLoginBox = () => {
    const login = useCodexAccountStore((store) => store.login);
    const isWaiting = login?.phase === "waiting";

    return (
        <section id="login-box" className="login-box" aria-live="polite" hidden={!login} data-phase={login?.phase}>
            <p id="login-message" className="panel-note" data-tone={login?.phase === "failed" ? "warn" : undefined}>
                {login?.message}
            </p>
            <Button id="login-open" hidden={!isWaiting || !login?.url} onClick={codexAccounts.openLoginUrl}>
                브라우저에서 열기
            </Button>
            <Button id="login-cancel" onClick={codexAccounts.cancelLogin}>
                {isWaiting ? "취소" : "닫기"}
            </Button>
        </section>
    );
};

const CodexProfile = () => {
    const isIdle = useRunStore((store) => store.state.status === "idle");
    const {
        activeId,
        accounts: list,
        message,
        login,
        isRefreshing,
        snapshots
    } = useCodexAccountStore(
        useShallow((store) => ({ activeId: store.activeId, accounts: store.accounts, message: store.message, login: store.login, isRefreshing: store.isRefreshing, snapshots: store.snapshots }))
    );
    const account = snapshots[activeId] || EMPTY_CODEX_ACCOUNT;
    const isLoading = !account.fetchedAt && !account.error && !account.loggedIn;
    const isAnyRunning = useAnyRunning();
    const isLocked = !isIdle || login?.phase === "waiting";
    const isManageLocked = isAnyRunning || login?.phase === "waiting";
    const manageTitle = isAnyRunning && isIdle ? "다른 프로젝트가 실행 중이에요." : undefined;
    const status = getAccountStatus(account, isLoading);
    const needsLogin = !isLoading && !account.loggedIn;
    const topPercent = account.limits.length > 0 ? Math.max(...account.limits.map((limit) => limit.percent)) : null;

    return (
        <>
            <ProfileCard profile={account.profile} isLoading={isLoading} percent={topPercent} />
            <div id="login-expiry" className="profile-warn" hidden={!needsLogin} data-tone="warn">
                <span>{account.installed ? "이 계정은 Codex에 로그인되어 있지 않아요." : "Codex가 설치돼 있지 않아요. Codex CLI를 설치한 뒤 다시 확인해 주세요."}</span>
                <Button id="account-login" hidden={!account.installed} disabled={isManageLocked} title={manageTitle} onClick={() => codexAccounts.login()}>
                    로그인
                </Button>
            </div>
            <Usage limits={account.limits} isLoading={isLoading} />
            <section className="profile-accounts" aria-label="Codex 계정">
                <h3 className="profile-section">계정</h3>
                <div className="account-chips">
                    <CodexAccountList isLocked={isLocked} isIdle={isIdle} />
                    <Button id="account-add" className="account-add" disabled={isManageLocked || list.length >= MAX_ACCOUNT_COUNT} title={manageTitle} onClick={codexAccounts.openForm}>
                        <Icon symbol="icon-plus" />
                        계정 추가
                    </Button>
                </div>
                <p id="account-message" className="panel-note" aria-live="polite" hidden={!message} data-tone={message ? "warn" : undefined}>
                    {message}
                </p>
                <CodexAccountForm />
                <CodexLoginBox />
            </section>
            <div className="panel-foot">
                <p id="usage-status" className="panel-note" aria-live="polite" data-tone={status.tone || undefined}>
                    {status.text}
                </p>
                <div className="panel-foot-actions">
                    <Button id="account-logout" hidden={!account.loggedIn} disabled={isManageLocked} title={manageTitle} onClick={() => codexAccounts.logout()}>
                        로그아웃
                    </Button>
                    <Button id="account-remove" variant="danger" hidden={activeId === DEFAULT_ACCOUNT_ID} disabled={isManageLocked} title={manageTitle} onClick={() => codexAccounts.remove()}>
                        이 계정 제거
                    </Button>
                    <Button id="usage-refresh" disabled={isRefreshing} onClick={codexAccounts.refresh}>
                        <Icon symbol="icon-refresh" />
                        새로 고침
                    </Button>
                </div>
            </div>
        </>
    );
};

export { CodexProfile };

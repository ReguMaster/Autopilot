import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { codexAccounts } from "../../actions/codexAccounts.js";
import { Button } from "../../components/Button.jsx";
import { Icon } from "../../components/Icon.jsx";
import { useAnyRunning } from "../../hooks/useAnyRunning.js";
import { EMPTY_CODEX_ACCOUNT, useCodexAccountStore } from "../../stores/codexAccountStore.js";
import { useRunStore } from "../../stores/runStore.js";
import { getAvatarLetter, ProviderColumn } from "./profileParts.jsx";

const MAX_ACCOUNT_COUNT = 9;
const DEFAULT_ACCOUNT_ID = "default";

const CodexAccountList = ({ isLocked, isIdle }) => {
    const { accounts: list, activeId } = useCodexAccountStore(useShallow((store) => ({ accounts: store.accounts, activeId: store.activeId })));

    return (
        <div id="codex-account-select" className="account-list" role="radiogroup" aria-label="사용할 Codex 계정">
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
            id="codex-account-form"
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
                id="codex-account-label"
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
                    id="codex-account-form-cancel"
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
        <section id="codex-login-box" className="login-box" aria-live="polite" hidden={!login} data-phase={login?.phase}>
            <p id="codex-login-message" className="panel-note" data-tone={login?.phase === "failed" ? "warn" : undefined}>
                {login?.message}
            </p>
            <Button id="codex-login-open" hidden={!isWaiting || !login?.url} onClick={codexAccounts.openLoginUrl}>
                브라우저에서 열기
            </Button>
            <Button id="codex-login-cancel" onClick={codexAccounts.cancelLogin}>
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
        isFormOpen,
        snapshots
    } = useCodexAccountStore(
        useShallow((store) => ({ activeId: store.activeId, accounts: store.accounts, message: store.message, login: store.login, isFormOpen: store.isFormOpen, snapshots: store.snapshots }))
    );
    const account = snapshots[activeId] || EMPTY_CODEX_ACCOUNT;
    const isLoading = !account.fetchedAt && !account.error && !account.loggedIn;
    const isAnyRunning = useAnyRunning();
    const isLocked = !isIdle || login?.phase === "waiting";
    const isManageLocked = isAnyRunning || login?.phase === "waiting";
    const manageTitle = isAnyRunning && isIdle ? "다른 프로젝트가 실행 중이에요." : undefined;
    const needsLogin = !isLoading && !account.loggedIn;

    return (
        <ProviderColumn
            provider="codex"
            label="Codex"
            account={account}
            accountLabel={list.find((item) => item.id === activeId)?.label ?? ""}
            isLoading={isLoading}
            needsLogin={needsLogin}
            isFormOpen={isFormOpen}
            fold={
                <>
                    <div className="account-chips">
                        <CodexAccountList isLocked={isLocked} isIdle={isIdle} />
                        <Button id="codex-account-add" className="account-add" disabled={isManageLocked || list.length >= MAX_ACCOUNT_COUNT} title={manageTitle} onClick={codexAccounts.openForm}>
                            <Icon symbol="icon-plus" />
                            계정 추가
                        </Button>
                    </div>
                    <CodexAccountForm />
                    <div className="profile-fold-actions">
                        <Button id="codex-account-logout" hidden={!account.loggedIn} disabled={isManageLocked} title={manageTitle} onClick={() => codexAccounts.logout()}>
                            로그아웃
                        </Button>
                        <Button
                            id="codex-account-remove"
                            variant="danger"
                            hidden={activeId === DEFAULT_ACCOUNT_ID}
                            disabled={isManageLocked}
                            title={manageTitle}
                            onClick={() => codexAccounts.remove()}
                        >
                            이 계정 제거
                        </Button>
                    </div>
                </>
            }
            alerts={
                <>
                    <div id="codex-login-expiry" className="profile-warn" hidden={!needsLogin} data-tone="warn">
                        <span>{account.installed ? "이 계정은 Codex에 로그인되어 있지 않아요." : "Codex가 설치돼 있지 않아요. Codex CLI를 설치한 뒤 다시 확인해 주세요."}</span>
                        <Button id="codex-account-login" hidden={!account.installed} disabled={isManageLocked} title={manageTitle} onClick={() => codexAccounts.login()}>
                            로그인
                        </Button>
                    </div>
                    <CodexLoginBox />
                    <p className="panel-note profile-message" aria-live="polite" hidden={!message} data-tone={message ? "warn" : undefined}>
                        {message}
                    </p>
                </>
            }
        />
    );
};

export { CodexProfile };

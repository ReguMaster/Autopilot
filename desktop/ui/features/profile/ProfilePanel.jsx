import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { accounts } from "../../actions/accounts.js";
import { Button } from "../../components/Button.jsx";
import { Icon } from "../../components/Icon.jsx";
import { Panel } from "../../components/Panel.jsx";
import { Seg } from "../../components/Seg.jsx";
import { useAnyRunning } from "../../hooks/useAnyRunning.js";
import { useLoginExpiry } from "../../hooks/useLoginExpiry.js";
import { EMPTY_ACCOUNT, useAccountStore } from "../../stores/accountStore.js";
import { useRunStore } from "../../stores/runStore.js";
import { ui, useUiStore } from "../../stores/uiStore.js";
import { CodexProfile } from "./CodexProfile.jsx";
import { getAccountStatus, getAvatarLetter, ProfileCard, Usage } from "./profileParts.jsx";

const MAX_ACCOUNT_COUNT = 9;
const DEFAULT_ACCOUNT_ID = "default";
// 로그인 정보가 없거나 만료돼 사용량을 읽지 못할 때, 또는 로그인 만료가 가까울 때 다시 로그인이 필요하다.
const RELOGIN_ERROR_CODES = ["NO_CREDENTIALS", "TOKEN_EXPIRED"];
const RELOGIN_FALLBACK_TEXT = "다시 로그인이 필요해요.";

// 계정은 이름 첫 글자를 단 줄로 고른다(라디오 묶음). 실행 중이거나 로그인 중에는 바꿀 수 없다.
const AccountList = ({ isLocked, isIdle }) => {
    const { accounts: list, activeId } = useAccountStore(useShallow((store) => ({ accounts: store.accounts, activeId: store.activeId })));

    return (
        <div id="account-select" className="account-list" role="radiogroup" aria-label="사용할 계정">
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
                    onClick={() => accounts.select(account.id)}
                >
                    <span className="initial">{getAvatarLetter({ name: account.label, email: "" })}</span>
                    <span>{account.label}</span>
                </button>
            ))}
        </div>
    );
};

const AccountForm = () => {
    const isOpen = useAccountStore((store) => store.isFormOpen);
    const [label, setLabel] = useState("");
    const [isShared, setIsShared] = useState(true);
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

                if (await accounts.add(label, isShared)) {
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
            <label className="check" title="기본 .claude의 메모리·세션 기록(projects), CLAUDE.md, settings.json, 스킬, 플러그인을 이 계정이 함께 써요. 로그인 정보는 계정마다 따로예요.">
                <input type="checkbox" id="account-share" checked={isShared} onChange={(event) => setIsShared(event.target.checked)} />
                기본 .claude의 메모리·지침·스킬 함께 쓰기
            </label>
            <div className="account-actions">
                <Button type="submit" variant="primary">
                    로그인 시작
                </Button>
                <Button
                    id="account-form-cancel"
                    onClick={() => {
                        accounts.closeForm();
                        setLabel("");
                    }}
                >
                    취소
                </Button>
            </div>
        </form>
    );
};

// 로그인 안내: 주소를 브라우저에서 열고, 브라우저가 보여 준 코드를 입력해 확인한다.
const LoginBox = () => {
    const login = useAccountStore((store) => store.login);
    const [code, setCode] = useState("");
    const isWaiting = login?.phase === "waiting";
    const canEnterCode = isWaiting && Boolean(login.url);

    useEffect(() => {
        if (login?.phase === "succeeded") {
            setCode("");
        }
    }, [login?.phase]);

    return (
        <section id="login-box" className="login-box" aria-live="polite" hidden={!login} data-phase={login?.phase}>
            <p id="login-message" className="panel-note" data-tone={login?.phase === "failed" ? "warn" : undefined}>
                {login?.message}
            </p>
            <Button id="login-open" hidden={!canEnterCode} onClick={accounts.openLoginUrl}>
                브라우저에서 열기
            </Button>
            <form
                id="login-code-form"
                className="login-code"
                hidden={!canEnterCode}
                onSubmit={async (event) => {
                    event.preventDefault();

                    if (await accounts.submitLoginCode(code)) {
                        setCode("");
                    }
                }}
            >
                <input
                    id="login-code"
                    className="account-input"
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="브라우저에 표시된 코드"
                    aria-label="로그인 코드"
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                />
                <Button type="submit">확인</Button>
            </form>
            <Button id="login-cancel" onClick={accounts.cancelLogin}>
                {isWaiting ? "취소" : "닫기"}
            </Button>
        </section>
    );
};

const ClaudeProfile = () => {
    const isIdle = useRunStore((store) => store.state.status === "idle");
    const {
        activeId,
        accounts: list,
        message,
        login,
        isRefreshing,
        snapshots
    } = useAccountStore(
        useShallow((store) => ({ activeId: store.activeId, accounts: store.accounts, message: store.message, login: store.login, isRefreshing: store.isRefreshing, snapshots: store.snapshots }))
    );
    const account = snapshots[activeId] || EMPTY_ACCOUNT;
    const isLoading = !account.fetchedAt && !account.error;
    const isAnyRunning = useAnyRunning();
    const isLocked = !isIdle || login?.phase === "waiting";
    const isManageLocked = isAnyRunning || login?.phase === "waiting";
    const manageTitle = isAnyRunning && isIdle ? "다른 프로젝트가 실행 중이에요." : undefined;
    const status = getAccountStatus(account, isLoading);
    const expiry = useLoginExpiry();
    const needsRelogin = RELOGIN_ERROR_CODES.includes(account.error?.code) || Boolean(expiry?.isExpiring);
    const topPercent = account.limits.length > 0 ? Math.max(...account.limits.map((limit) => limit.percent)) : null;

    return (
        <>
            <ProfileCard profile={account.profile} isLoading={isLoading} percent={topPercent} />
            <div id="login-expiry" className="profile-warn" hidden={!expiry && !needsRelogin} data-tone={needsRelogin ? "warn" : undefined}>
                <span>{expiry?.text ?? RELOGIN_FALLBACK_TEXT}</span>
                <Button id="account-login" hidden={!needsRelogin} disabled={isManageLocked} title={manageTitle} onClick={() => accounts.login()}>
                    다시 로그인
                </Button>
            </div>
            <Usage limits={account.limits} isLoading={isLoading} />
            <section className="profile-accounts" aria-label="계정">
                <h3 className="profile-section">계정</h3>
                <div className="account-chips">
                    <AccountList isLocked={isLocked} isIdle={isIdle} />
                    <Button id="account-add" className="account-add" disabled={isManageLocked || list.length >= MAX_ACCOUNT_COUNT} title={manageTitle} onClick={accounts.openForm}>
                        <Icon symbol="icon-plus" />
                        계정 추가
                    </Button>
                </div>
                <p id="account-message" className="panel-note" aria-live="polite" hidden={!message} data-tone={message ? "warn" : undefined}>
                    {message}
                </p>
                <AccountForm />
                <LoginBox />
            </section>
            <div className="panel-foot">
                <p id="usage-status" className="panel-note" aria-live="polite" data-tone={status.tone || undefined}>
                    {status.text}
                </p>
                <div className="panel-foot-actions">
                    <Button id="account-logout" hidden={isLoading || account.error?.code === "NO_CREDENTIALS"} disabled={isManageLocked} title={manageTitle} onClick={() => accounts.logout()}>
                        로그아웃
                    </Button>
                    <Button id="account-remove" variant="danger" hidden={activeId === DEFAULT_ACCOUNT_ID} disabled={isManageLocked} title={manageTitle} onClick={accounts.remove}>
                        이 계정 제거
                    </Button>
                    <Button id="usage-refresh" disabled={isRefreshing} onClick={accounts.refresh}>
                        <Icon symbol="icon-refresh" />
                        새로 고침
                    </Button>
                </div>
            </div>
        </>
    );
};

const PROVIDER_OPTIONS = [
    { value: "claude", label: "Claude" },
    { value: "codex", label: "Codex" }
];

// 프로필 패널은 AI마다 계정·한도를 보여 준다. 위 탭으로 Claude와 Codex를 오간다(두 몸통은 한 번에 하나만 그려 id가 겹치지 않는다).
const ProfilePanel = () => {
    const open = useUiStore((store) => store.panel === "profile");
    const provider = useUiStore((store) => store.profileProvider);

    return (
        <Panel id="profile" className="profile-panel" aria-label="프로필" open={open}>
            <Seg
                name="profile-provider"
                label="AI 선택"
                className="mode-seg profile-provider"
                slide
                options={PROVIDER_OPTIONS}
                value={provider}
                onChange={(value) => ui.set({ profileProvider: value })}
            />
            {provider === "codex" ? <CodexProfile /> : <ClaudeProfile />}
        </Panel>
    );
};

export { ProfilePanel, ClaudeProfile };

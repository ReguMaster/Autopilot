import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { accounts } from "../../actions/accounts.js";
import { codexAccounts } from "../../actions/codexAccounts.js";
import { settings } from "../../actions/settings.js";
import { Button } from "../../components/Button.jsx";
import { Icon } from "../../components/Icon.jsx";
import { ProviderAvatar } from "../../components/ProviderAvatar.jsx";
import { useAnyRunning } from "../../hooks/useAnyRunning.js";
import { useAccountStore } from "../../stores/accountStore.js";
import { useAppStore } from "../../stores/appStore.js";
import { useCodexAccountStore } from "../../stores/codexAccountStore.js";
import "./Welcome.css";

const MAX_ACCOUNT_COUNT = 9;
const CLAUDE_RELOGIN_CODES = ["NO_CREDENTIALS", "TOKEN_EXPIRED"];

// 처음 켰고 열린 프로젝트가 없을 때만 보인다. 이미 쓰던 사람은 탭이 있어 보이지 않는다.
const useWelcomeOpen = () => {
    return useAppStore((store) => store.settings.onboarded === false && (store.settings.tabs ?? []).length === 0);
};

// 계정 한 줄의 상태. connected는 지금 쓸 수 있다는 뜻이다.
const getClaudeRow = (snapshot) => {
    if (!snapshot) {
        return { connected: false, text: "확인 중이에요", tone: "" };
    }

    if (snapshot.profile && !CLAUDE_RELOGIN_CODES.includes(snapshot.error?.code)) {
        return { connected: true, text: [snapshot.profile.email, snapshot.profile.plan].filter(Boolean).join(" · "), tone: "ok" };
    }

    return { connected: false, text: snapshot.error?.code === "TOKEN_EXPIRED" ? "로그인이 만료됐어요" : "로그인이 필요해요", tone: "warn" };
};

const getCodexRow = (snapshot) => {
    if (!snapshot) {
        return { connected: false, text: "확인 중이에요", tone: "" };
    }

    if (!snapshot.installed) {
        return { connected: false, text: "Codex가 설치돼 있지 않아요", tone: "warn" };
    }

    if (snapshot.loggedIn) {
        return { connected: true, text: [snapshot.profile?.email, snapshot.profile?.plan].filter(Boolean).join(" · ") || "로그인됨", tone: "ok" };
    }

    return { connected: false, text: "로그인이 필요해요", tone: "warn" };
};

// 로그인이 진행되는 동안의 안내. Claude는 브라우저가 보여 준 코드를 입력해야 하고, Codex는 브라우저에서 끝나면 알아서 이어진다.
const LoginProgress = ({ login, needsCode, onOpen, onCancel, onSubmitCode }) => {
    const [code, setCode] = useState("");
    const isWaiting = login?.phase === "waiting";

    if (!login) {
        return null;
    }

    return (
        <div className="welcome-login" aria-live="polite" data-phase={login.phase}>
            <p data-tone={login.phase === "failed" ? "warn" : undefined}>{login.message}</p>
            <div className="welcome-login-actions">
                {isWaiting && login.url ? <Button onClick={onOpen}>브라우저에서 열기</Button> : null}
                <Button onClick={onCancel}>{isWaiting ? "취소" : "닫기"}</Button>
            </div>
            {needsCode && isWaiting && login.url ? (
                <form
                    className="welcome-code"
                    onSubmit={async (event) => {
                        event.preventDefault();

                        if (await onSubmitCode(code)) {
                            setCode("");
                        }
                    }}
                >
                    <input
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
            ) : null}
        </div>
    );
};

// AI 하나의 연동 카드. 계정마다 로그인·로그아웃 단추가 있고, 계정 추가로 같은 AI의 다른 계정도 로그인해 둘 수 있다.
const ProviderCard = ({ provider, title, role, installHint, rows, login, message, isBusy, canAdd, actions, needsCode }) => {
    const isConnected = rows.some((row) => row.connected);
    const isLoginWaiting = login?.phase === "waiting";

    return (
        <section className="welcome-card" data-provider={provider} data-connected={isConnected ? "" : undefined} aria-label={`${title} 연동`}>
            <header>
                <ProviderAvatar provider={provider} size="md" />
                <div>
                    <h2>{title}</h2>
                    <p>{role}</p>
                </div>
                <span className="welcome-badge" data-tone={isConnected ? "ok" : undefined}>
                    {isConnected ? "연결됨" : "연결 전"}
                </span>
            </header>
            <ul className="welcome-accounts">
                {rows.map((row) => (
                    <li key={row.id} data-tone={row.tone || undefined}>
                        <span className="welcome-dot" aria-hidden="true"></span>
                        <div>
                            <b>{row.label}</b>
                            <small>{row.text}</small>
                        </div>
                        {row.connected ? (
                            <Button disabled={isBusy} onClick={() => actions.logout(row.id)}>
                                로그아웃
                            </Button>
                        ) : (
                            <Button variant="primary" disabled={isBusy || !row.canLogin} onClick={() => actions.login(row.id)}>
                                로그인
                            </Button>
                        )}
                    </li>
                ))}
            </ul>
            <LoginProgress login={login} needsCode={needsCode} onOpen={actions.openLoginUrl} onCancel={actions.cancelLogin} onSubmitCode={actions.submitLoginCode} />
            <p className="welcome-message" hidden={!message} data-tone="warn">
                {message}
            </p>
            <footer>
                <Button disabled={isBusy || isLoginWaiting || !canAdd} onClick={actions.add}>
                    <Icon symbol="icon-plus" />
                    다른 계정 추가
                </Button>
                <small>{installHint}</small>
            </footer>
        </section>
    );
};

const ClaudeCard = () => {
    const { list, snapshots, login, message } = useAccountStore(useShallow((store) => ({ list: store.accounts, snapshots: store.snapshots, login: store.login, message: store.message })));
    const isBusy = useAnyRunning() || login?.phase === "waiting";
    const rows = list.map((account) => ({ id: account.id, label: account.label, canLogin: true, ...getClaudeRow(snapshots[account.id]) }));

    return (
        <ProviderCard
            provider="claude"
            title="Claude"
            role="작업을 맡아 코드를 쓰는 기본 AI예요"
            installHint="Claude Code가 필요해요. 설치돼 있지 않으면 로그인할 때 알려드려요."
            rows={rows}
            login={login}
            message={message}
            isBusy={isBusy}
            canAdd={list.length < MAX_ACCOUNT_COUNT}
            needsCode
            actions={{
                login: (id) => accounts.login(id),
                logout: (id) => accounts.logout(id),
                add: () => accounts.add("", true),
                cancelLogin: accounts.cancelLogin,
                openLoginUrl: accounts.openLoginUrl,
                submitLoginCode: accounts.submitLoginCode
            }}
        />
    );
};

const CodexCard = () => {
    const { list, snapshots, login, message } = useCodexAccountStore(useShallow((store) => ({ list: store.accounts, snapshots: store.snapshots, login: store.login, message: store.message })));
    const isBusy = useAnyRunning() || login?.phase === "waiting";
    const rows = list.map((account) => ({ id: account.id, label: account.label, canLogin: snapshots[account.id]?.installed !== false, ...getCodexRow(snapshots[account.id]) }));

    return (
        <ProviderCard
            provider="codex"
            title="Codex"
            role="기획·디자인의 보조나 메인으로 함께 일하는 AI예요 (선택)"
            installHint="npm i -g @openai/codex 로 설치할 수 있어요."
            rows={rows}
            login={login}
            message={message}
            isBusy={isBusy}
            canAdd={list.length < MAX_ACCOUNT_COUNT}
            actions={{
                login: (id) => codexAccounts.login(id),
                logout: (id) => codexAccounts.logout(id),
                add: () => codexAccounts.add(""),
                cancelLogin: codexAccounts.cancelLogin,
                openLoginUrl: codexAccounts.openLoginUrl
            }}
        />
    );
};

// 처음 켰을 때 AI(Claude·Codex)를 연동하는 안내. 본문 위에 덮여 있고, 마치면(또는 나중으로 미루면) 다시 뜨지 않는다. 연동은 프로필에서 언제든 바꿀 수 있다.
const Welcome = () => {
    const isOpen = useWelcomeOpen();
    const hasClaude = useAccountStore((store) => store.accounts.some((account) => getClaudeRow(store.snapshots[account.id]).connected));
    const hasCodex = useCodexAccountStore((store) => store.accounts.some((account) => getCodexRow(store.snapshots[account.id]).connected));

    return (
        <section id="welcome" className="welcome" role="dialog" aria-label="AI 연동" hidden={!isOpen}>
            <div className="welcome-inner">
                <h1>AutoPilot에 오신 걸 환영해요</h1>
                <p className="welcome-lead">작업을 맡길 AI를 먼저 연결해요. Claude 하나만 연결해도 바로 시작할 수 있고, Codex는 나중에 연결해도 돼요. 같은 AI의 계정을 여러 개 연결할 수도 있어요.</p>
                <div className="welcome-cards">
                    <ClaudeCard />
                    <CodexCard />
                </div>
                <div className="welcome-foot">
                    <p>{hasClaude || hasCodex ? "연결한 계정은 프로필 패널에서 언제든 바꾸고 로그아웃할 수 있어요." : "연결하지 않아도 둘러볼 수 있지만, 작업을 시작하려면 AI 로그인이 필요해요."}</p>
                    <Button id="welcome-done" variant="primary" size="" onClick={() => settings.setPreferences({ onboarded: true })}>
                        {hasClaude || hasCodex ? "시작하기" : "나중에 연결할게요"}
                    </Button>
                </div>
            </div>
        </section>
    );
};

export { Welcome, useWelcomeOpen };

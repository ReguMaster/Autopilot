import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { formatClock, formatUsageReset, getUsageTone } from "../../../viewFormat.js";
import { accounts } from "../../actions/accounts.js";
import { Button } from "../../components/Button.jsx";
import { Icon } from "../../components/Icon.jsx";
import { Panel } from "../../components/Panel.jsx";
import { useLoginExpiry } from "../../hooks/useLoginExpiry.js";
import { useClock } from "../../stores/clock.js";
import { EMPTY_ACCOUNT, useAccountStore } from "../../stores/accountStore.js";
import { useRunStore } from "../../stores/runStore.js";
import { useUiStore } from "../../stores/uiStore.js";

const MAX_ACCOUNT_COUNT = 9;
const DEFAULT_ACCOUNT_ID = "default";
const SKELETON_ITEM_COUNT = 3;
const SESSION_LIMIT_PREFIX = "5시간";
// 로그인 정보가 없거나 만료돼 사용량을 읽지 못할 때, 또는 로그인 만료가 가까울 때 다시 로그인이 필요하다.
const RELOGIN_ERROR_CODES = ["NO_CREDENTIALS", "TOKEN_EXPIRED"];

const getAvatarLetter = ({ name, email }) => {
    return Array.from(name || email)[0]?.toUpperCase() ?? "";
};

const getAccountStatus = (account, isLoading) => {
    if (isLoading) {
        return { text: "불러오는 중이에요.", tone: "" };
    }

    if (!account.error) {
        return { text: `${formatClock(account.fetchedAt)} 기준`, tone: "" };
    }

    const staleNote = account.fetchedAt ? ` (${formatClock(account.fetchedAt)} 기준 값)` : "";

    return { text: account.error.msg + staleNote, tone: "warn" };
};

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
                    <Icon symbol="icon-check" className="icon tick" />
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

// 아바타 사진은 계정 정보에 없어 이름(없으면 이메일)의 첫 글자를 그린다. 조직 이름은 요금제 표시의 툴팁에 둔다.
const ProfileCard = ({ profile, isLoading }) => {
    return (
        <section id="profile-card" className="profile-card" aria-busy={isLoading} hidden={!profile && !isLoading}>
            <span id="profile-avatar" className="profile-avatar" aria-hidden="true">
                {profile ? getAvatarLetter(profile) : ""}
            </span>
            <div className="profile-id">
                <b id="profile-name" className="profile-name">
                    {profile ? profile.name || profile.email : ""}
                </b>
                <span id="profile-email" className="profile-email">
                    {profile?.name ? profile.email : ""}
                </span>
            </div>
            <span id="profile-plan" className="profile-plan" hidden={!profile?.plan} title={profile?.organization || undefined}>
                {profile?.plan || ""}
            </span>
        </section>
    );
};

// 항목 구성이 같으면 막대를 다시 만들지 않아(key가 이름) 값이 바뀔 때만 막대가 움직인다.
const UsageItem = ({ limit, nowMs }) => {
    const percent = Math.round(limit.percent);

    return (
        <section className="usage-item" data-tone={getUsageTone(limit.percent)} data-session={limit.label.startsWith(SESSION_LIMIT_PREFIX) ? "" : undefined}>
            <h3>{limit.label}</h3>
            <b className="usage-percent num">{`${percent}%`}</b>
            <div className="usage-meter" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow={String(percent)} aria-label={limit.label} style={{ "--value": String(limit.percent) }}>
                <i></i>
            </div>
            <span className="usage-reset">{formatUsageReset(limit.resetsAt, nowMs)}</span>
        </section>
    );
};

const UsageSkeleton = () => {
    return (
        <section className="usage-item">
            <h3></h3>
            <b className="usage-percent num"></b>
            <div className="usage-meter" role="meter" aria-valuemin="0" aria-valuemax="100">
                <i></i>
            </div>
            <span className="usage-reset"></span>
        </section>
    );
};

const Usage = ({ limits, isLoading }) => {
    const isRunning = useRunStore((store) => store.state.status === "running");
    const minute = useClock((now) => Math.floor(now / 60000));
    const nowMs = useMemo(() => Date.now(), [minute, limits]);

    return (
        <section id="usage-section" className="profile-usage" aria-label="사용량과 한도" hidden={!isLoading && limits.length === 0}>
            <div id="usage-list" className="usage-list" data-loading={isLoading ? "" : undefined} data-working={isRunning ? "" : undefined}>
                {isLoading
                    ? Array.from({ length: SKELETON_ITEM_COUNT }, (_, index) => <UsageSkeleton key={index} />)
                    : limits.map((limit) => <UsageItem key={limit.label} limit={limit} nowMs={nowMs} />)}
            </div>
        </section>
    );
};

const ProfilePanel = () => {
    const open = useUiStore((store) => store.panel === "profile");
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
    const isLocked = !isIdle || login?.phase === "waiting";
    const status = getAccountStatus(account, isLoading);
    const expiry = useLoginExpiry();
    const needsRelogin = RELOGIN_ERROR_CODES.includes(account.error?.code) || Boolean(expiry?.isExpiring);

    return (
        <Panel id="profile" className="profile-panel" aria-label="프로필" open={open}>
            <AccountList isLocked={isLocked} isIdle={isIdle} />
            <div className="account-actions">
                <Button id="account-add" disabled={isLocked || list.length >= MAX_ACCOUNT_COUNT} onClick={accounts.openForm}>
                    <Icon symbol="icon-plus" />
                    계정 추가
                </Button>
                <Button id="account-login" hidden={!needsRelogin} disabled={isLocked} onClick={accounts.login}>
                    다시 로그인
                </Button>
                <Button id="account-remove" variant="danger" hidden={activeId === DEFAULT_ACCOUNT_ID} disabled={isLocked} onClick={accounts.remove}>
                    제거
                </Button>
            </div>
            <p id="account-message" className="panel-note" aria-live="polite" hidden={!message} data-tone={message ? "warn" : undefined}>
                {message}
            </p>
            <AccountForm />
            <LoginBox />
            <ProfileCard profile={account.profile} isLoading={isLoading} />
            <Usage limits={account.limits} isLoading={isLoading} />
            <p id="login-expiry" className="panel-note login-expiry" hidden={!expiry} data-tone={expiry?.isExpiring ? "warn" : undefined}>
                {expiry?.text}
            </p>
            <div className="panel-foot">
                <p id="usage-status" className="panel-note" aria-live="polite" data-tone={status.tone || undefined}>
                    {status.text}
                </p>
                <Button id="usage-refresh" disabled={isRefreshing} onClick={accounts.refresh}>
                    <Icon symbol="icon-refresh" />
                    새로 고침
                </Button>
            </div>
        </Panel>
    );
};

export { ProfilePanel };

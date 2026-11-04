import { useEffect, useMemo, useState } from "react";
import { formatClock, formatUsageReset, getUsageForecast, getUsageTone } from "../../../viewFormat.js";
import { Icon } from "../../components/Icon.jsx";
import { ProviderAvatar } from "../../components/ProviderAvatar.jsx";
import { useClock } from "../../stores/clock.js";
import { useRunStore } from "../../stores/runStore.js";

const SKELETON_ITEM_COUNT = 3;
const SESSION_LIMIT_PREFIX = "5시간";

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

const getIdentityText = (profile, needsLogin) => {
    if (profile) {
        return profile.email || profile.name;
    }

    return needsLogin ? "로그인 필요" : "";
};

// 항목 구성이 같으면 막대를 다시 만들지 않아(key가 이름) 값이 바뀔 때만 막대가 움직인다. 막대 아래 한 문장은 지금 속도가 리셋까지 이어지면 어떻게 되는지다.
const UsageItem = ({ limit, nowMs }) => {
    const percent = Math.round(limit.percent);
    const forecast = getUsageForecast(limit, nowMs);

    return (
        <section className="usage-item" data-tone={getUsageTone(limit.percent)} data-session={limit.label.startsWith(SESSION_LIMIT_PREFIX) ? "" : undefined}>
            <h3>{limit.label}</h3>
            <b className="usage-percent num">
                {`${percent}%`}
                <small>사용</small>
            </b>
            <div className="usage-meter" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow={String(percent)} aria-label={limit.label} style={{ "--value": String(limit.percent) }}>
                <i></i>
            </div>
            <span className="usage-reset">{formatUsageReset(limit.resetsAt, nowMs)}</span>
            {forecast ? (
                <p className="usage-forecast" data-tone={forecast.tone}>
                    {forecast.text}
                </p>
            ) : null}
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
        <section className="profile-usage" aria-label="사용량과 한도" hidden={!isLoading && limits.length === 0}>
            <div className="usage-list" data-loading={isLoading ? "" : undefined} data-working={isRunning ? "" : undefined}>
                {isLoading
                    ? Array.from({ length: SKELETON_ITEM_COUNT }, (_, index) => <UsageSkeleton key={index} />)
                    : limits.map((limit) => <UsageItem key={limit.label} limit={limit} nowMs={nowMs} />)}
            </div>
        </section>
    );
};

// 한 AI의 열. 머리(로고·이름·요금제, 이메일·기준 시각, 계정 단추) 아래에 접었다 펴는 계정 관리(fold), 알림(alerts), 한도, 읽기 실패 안내가 차례로 온다.
// 계정 단추를 누르면 fold가 열리고, 알림은 접혀 있어도 보여야 하는 것(로그인 안내·실패 메시지)이라 fold 밖에 둔다.
const ProviderColumn = ({ provider, label, account, accountLabel, isLoading, needsLogin, isFormOpen, fold, alerts }) => {
    const [isFoldOpen, setIsFoldOpen] = useState(false);
    const status = getAccountStatus(account, isLoading);
    const hasProblem = isLoading || Boolean(account.error);
    const isNote = hasProblem && !needsLogin;
    const foldId = `${provider}-account-fold`;

    useEffect(() => {
        if (isFormOpen) {
            setIsFoldOpen(true);
        }
    }, [isFormOpen]);

    return (
        <section id={`${provider}-column`} className="profile-col" data-provider={provider} aria-label={`${label} 한도`}>
            <header className="profile-col-head" aria-busy={isLoading}>
                <ProviderAvatar provider={provider} size="sm" />
                <b className="profile-col-name">
                    {label}
                    <span className="profile-plan" hidden={!account.profile?.plan} title={account.profile?.organization || undefined}>
                        {account.profile?.plan || ""}
                    </span>
                </b>
                <button
                    type="button"
                    className="profile-acct-toggle"
                    aria-expanded={isFoldOpen}
                    aria-controls={foldId}
                    aria-label={`${label} 계정: ${accountLabel}`}
                    title="계정 고르기·추가·로그아웃"
                    onClick={() => setIsFoldOpen(!isFoldOpen)}
                >
                    <span className="profile-acct-name">{accountLabel}</span>
                    <Icon symbol="icon-chevron" />
                </button>
                <span className="profile-col-sub">
                    <span className="profile-email">{getIdentityText(account.profile, needsLogin)}</span>
                    <span className="profile-clock">{hasProblem ? "" : status.text}</span>
                </span>
            </header>
            <div id={foldId} className="profile-fold" hidden={!isFoldOpen}>
                {fold}
            </div>
            {alerts}
            <Usage limits={account.limits} isLoading={isLoading} />
            <p className="panel-note profile-status" aria-live="polite" hidden={!isNote} data-tone={status.tone || undefined}>
                {isNote ? status.text : ""}
            </p>
        </section>
    );
};

export { getAvatarLetter, ProviderColumn };

import { useMemo } from "react";
import { formatClock, formatUsageReset, getUsagePace, getUsageTone } from "../../../viewFormat.js";
import { AvatarRing } from "../../components/AvatarRing.jsx";
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

// 아바타 사진은 계정 정보에 없어 이름(없으면 이메일)의 첫 글자를 그린다. 조직 이름은 요금제 표시의 툴팁에 둔다.
const ProfileCard = ({ profile, isLoading, percent }) => {
    return (
        <section id="profile-card" className="profile-card" aria-busy={isLoading} hidden={!profile && !isLoading}>
            <AvatarRing id="profile-avatar" className="profile-avatar" size="lg" letter={profile ? getAvatarLetter(profile) : ""} percent={percent} aria-hidden="true" />
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

// 항목 구성이 같으면 막대를 다시 만들지 않아(key가 이름) 값이 바뀔 때만 막대가 움직인다. 막대 위 세로 선은 한도 기간이 지난 만큼이다.
const UsageItem = ({ limit, nowMs }) => {
    const percent = Math.round(limit.percent);
    const pace = getUsagePace(limit, nowMs);

    return (
        <section className="usage-item" data-tone={getUsageTone(limit.percent)} data-session={limit.label.startsWith(SESSION_LIMIT_PREFIX) ? "" : undefined}>
            <h3>{limit.label}</h3>
            <b className="usage-percent num">{`${percent}%`}</b>
            <div
                className="usage-meter"
                role="meter"
                aria-valuemin="0"
                aria-valuemax="100"
                aria-valuenow={String(percent)}
                aria-label={limit.label}
                style={{ "--value": String(limit.percent), "--elapsed": String(pace?.elapsed ?? 0) }}
            >
                <i></i>
                {pace ? <span className="usage-pace" aria-hidden="true"></span> : null}
            </div>
            <span className="usage-reset">
                <span>{formatUsageReset(limit.resetsAt, nowMs)}</span>
                {pace?.isFast ? <em>시간보다 빨리 쓰고 있어요</em> : null}
            </span>
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
            <p className="panel-note usage-legend" hidden={isLoading || !limits.some((limit) => getUsagePace(limit, nowMs))}>
                막대 위 세로 선은 한도 기간이 지난 만큼이에요.
            </p>
        </section>
    );
};

export { getAvatarLetter, getAccountStatus, ProfileCard, Usage };

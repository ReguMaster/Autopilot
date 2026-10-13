// 시안 전용 스크립트. 주소 해시(#a, #b, #c, 뒤에 -loading·-error)로 패널 구성을 고른다. 값은 모두 가짜다.
const PROFILE = { name: "개발자", email: "dev@example.com", plan: "Team", organization: "Example Org" };
const LIMITS = [
    { label: "5시간 한도", percent: 3, reset: "13:35 리셋 · 2시간 10분 후", tone: "ok" },
    { label: "주간 한도", percent: 78, reset: "10월 17일 11:25 리셋 · 4일 후", tone: "warn" },
    { label: "주간 한도 · Fable", percent: 93, reset: "10월 17일 11:25 리셋 · 4일 후", tone: "danger" }
];

const [variant, state = "ok"] = (location.hash.slice(1) || "a").split("-");

const avatar = `<span class="pf-avatar" aria-hidden="true">${PROFILE.name[0]}</span>`;

const identity = {
    a: `<section class="pf-card">
            ${avatar}
            <div class="pf-id"><b class="pf-name">${PROFILE.name}</b><span class="pf-email">${PROFILE.email}</span></div>
            <span class="pf-plan">${PROFILE.plan}</span>
        </section>`,
    b: `<section class="settings-group pf-rows">
            <h3>계정</h3>
            <dl>
                <div><dt>이름</dt><dd>${PROFILE.name}</dd></div>
                <div><dt>이메일</dt><dd>${PROFILE.email}</dd></div>
                <div><dt>요금제</dt><dd>${PROFILE.plan}</dd></div>
                <div><dt>조직</dt><dd>${PROFILE.organization}</dd></div>
            </dl>
        </section>`,
    c: `<section class="pf-hero">
            <span class="pf-hero-label">요금제</span>
            <b class="pf-hero-plan">${PROFILE.plan}</b>
            <div class="pf-hero-id">
                ${avatar}
                <div class="pf-id"><b class="pf-name">${PROFILE.name}</b><span class="pf-email">${PROFILE.email}</span></div>
            </div>
        </section>`
};

const skeleton = {
    a: `<section class="pf-card pf-skeleton">${'<span class="pf-avatar"></span>'}<div class="pf-id"><i class="pf-bar" style="width: 7em"></i><i class="pf-bar" style="width: 11em"></i></div></section>`,
    b: `<section class="settings-group pf-rows pf-skeleton"><h3>계정</h3><dl>${'<div><i class="pf-bar" style="width: 4em"></i><i class="pf-bar" style="width: 8em"></i></div>'.repeat(4)}</dl></section>`,
    c: `<section class="pf-hero pf-skeleton"><i class="pf-bar" style="width: 3em"></i><i class="pf-bar big" style="width: 6em"></i><div class="pf-hero-id"><span class="pf-avatar"></span><div class="pf-id"><i class="pf-bar" style="width: 7em"></i><i class="pf-bar" style="width: 11em"></i></div></div></section>`
};

const usageItems = LIMITS.map(
    (limit) => `<section class="usage-item" data-tone="${limit.tone}">
        <h3>${limit.label}</h3>
        <b class="usage-percent num">${limit.percent}%</b>
        <div class="usage-meter" style="--value: ${limit.percent}"><i></i></div>
        <span class="usage-reset">${limit.reset}</span>
    </section>`
).join("");

const usageSkeleton = [1, 2, 3]
    .map(() => `<section class="usage-item pf-skeleton"><i class="pf-bar" style="width: 6em"></i><i class="pf-bar" style="width: 2em; justify-self: end"></i><div class="usage-meter"></div></section>`)
    .join("");

const isLoading = state === "loading";
const statusText = state === "error" ? "Claude 로그인 정보가 만료됐어요. Claude Code를 한 번 실행하면 갱신돼요. (09:12 기준 값)" : "11:25 기준";

document.getElementById("panel-body").innerHTML = `
    ${isLoading ? skeleton[variant] : identity[variant]}
    <section class="pf-usage">
        <h3 class="pf-section">사용량과 한도</h3>
        <div class="usage-list">${isLoading ? usageSkeleton : usageItems}</div>
    </section>
    <section class="settings-group pf-foot">
        <p class="settings-note" ${state === "error" ? 'data-tone="warn"' : ""}>${isLoading ? "불러오는 중이에요." : statusText}</p>
        <button type="button" class="text-button">새로 고침</button>
    </section>`;

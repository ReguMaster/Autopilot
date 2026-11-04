import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { DRAFT_PROVIDERS, getProjectNameError, MAX_WHAT_LENGTH, PLATFORMS } from "../../../projectDraft.cjs";
import { formatUsageReset } from "../../../viewFormat.js";
import {
    applyExample,
    cancelDraft,
    createProject,
    EXAMPLES,
    getBrief,
    loadDraftProviders,
    openProviderLogin,
    pickParentDir,
    pickProvider,
    recheckDraftProviders,
    requestDraft,
    suggestExamples,
    writeManually
} from "../../actions/newProject.js";
import { Button } from "../../components/Button.jsx";
import { Icon } from "../../components/Icon.jsx";
import { Seg } from "../../components/Seg.jsx";
import { cx } from "../../lib/cx.js";
import { getOtherProvider, PROVIDER_LOGOS } from "../../lib/phaseAgents.js";
import { newProject, useNewProjectStore } from "../../stores/newProjectStore.js";
import { useClock } from "../../stores/clock.js";
import { DocPreview } from "../approval/DocPreview.jsx";
import { TagChips } from "./TagChips.jsx";
import "./NewProject.css";

const FLOW = ["한두 줄 적기", "초안 다듬기", "만들기"];
const SUBTITLES = {
    write: "한두 줄이면 충분해요. 나머지는 초안으로 채워 드릴게요.",
    drafted: "{AI}가 쓴 초안이에요. 눌러서 빼거나 더하면 돼요.",
    manual: "칸을 채우고 눌러서 넣거나 빼면 돼요.",
    drafting: "{AI}가 초안을 쓰는 동안 잠깐만 기다려 주세요."
};
const PROVIDER_LABELS = Object.fromEntries(DRAFT_PROVIDERS.map((provider) => [provider.key, provider.label]));
// 초안을 받는 데 걸리는 시간의 어림. Codex는 Claude보다 오래 걸린다.
const DRAFT_SECONDS = { claude: 10, codex: 30 };
const STATE_SUFFIXES = { login: "로그인 필요", missing: "설치 안 됨", limit: "한도 도달" };
const SKELETON_CHIP_WIDTHS = ["92px", "118px", "76px"];
const STACK_LABELS = { recommended: "추천대로", later: "나중에", custom: "직접" };
const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+$/;

const getFlowState = (index, current) => {
    if (index === current) {
        return "active";
    }

    return index < current ? "done" : undefined;
};

const getFlowCurrent = (isWriting, isCreating) => {
    if (isCreating) {
        return 2;
    }

    return isWriting ? 0 : 1;
};

// 초안을 쓰는 동안은 두 번째 칸이, 만들기를 누르면 세 번째 칸이 켜진다.
const Flow = ({ isWriting, isCreating }) => {
    const current = getFlowCurrent(isWriting, isCreating);

    return (
        <ol className="np-flow" aria-label="만드는 순서">
            {FLOW.map((label, index) => (
                <li key={label} data-state={getFlowState(index, current)} aria-current={index === current ? "step" : undefined}>
                    <span className="np-node">{index < current ? <Icon symbol="icon-check" /> : index + 1}</span>
                    {label}
                </li>
            ))}
        </ol>
    );
};

const getPathSeparator = (dir) => {
    return dir.includes("\\") ? "\\" : "/";
};

// 프로젝트 폴더가 생길 위치. 폴더 아이콘과 전체 경로, 바꾸기를 한 덩어리로 보여 눌러서 바꾸는 곳임이 바로 보이게 한다.
const FolderField = ({ parentDir, name = "", disabled = false }) => {
    const separator = getPathSeparator(parentDir);

    return (
        <div className="np-field">
            <span className="np-label">
                만들 위치 <span className="np-opt">{name ? "폴더가 이 안에 생겨요" : "프로젝트 폴더가 이 안에 생겨요"}</span>
            </span>
            <button type="button" className="np-folder" disabled={disabled} title={name ? `${parentDir}${separator}${name}` : parentDir} onClick={pickParentDir}>
                <Icon symbol="icon-folder" />
                <span className="np-folder-path">
                    <code>{name ? `${parentDir}${separator}` : parentDir}</code>
                    {name ? <b>{name}</b> : null}
                </span>
                <span className="np-folder-change">폴더 바꾸기</span>
            </button>
        </div>
    );
};

// 아직 모르면(처음 묻는 동안) 쓸 수 있다고 보고 막지 않는다. 메인이 부를 때 다시 확인한다.
const isProviderReady = (providerStates, provider) => {
    const state = providerStates?.[provider]?.state;

    return state === undefined || state === "ready";
};

const getProviderOptions = (providerStates, isBusy) => {
    return DRAFT_PROVIDERS.map((provider) => {
        const suffix = STATE_SUFFIXES[providerStates?.[provider.key]?.state];

        return {
            value: provider.key,
            icon: PROVIDER_LOGOS[provider.key],
            disabled: isBusy,
            label: (
                <>
                    {provider.label}
                    {suffix ? <em>{suffix}</em> : null}
                </>
            )
        };
    });
};

// 로그인·설치·한도 때문에 지금 AI를 쓸 수 없을 때의 안내. 할 수 있는 일(로그인하기·다른 AI로 바꾸기·다시 확인)을 옆에 둔다.
const getProviderNote = (provider, status, nowMs) => {
    const label = PROVIDER_LABELS[provider];

    if (status.state === "login") {
        return `${label}에 로그인되어 있지 않아요.`;
    }

    if (status.state === "limit") {
        return `${label}의 ${status.limitLabel}에 걸렸어요. ${formatUsageReset(status.resetsAt, nowMs)}`;
    }

    return status.reason;
};

const ProviderNote = ({ provider, providerStates }) => {
    const minute = useClock((now) => Math.floor(now / 60000));
    const status = providerStates?.[provider];
    const other = getOtherProvider(provider);

    if (!status || status.state === "ready") {
        return null;
    }

    return (
        <div id="new-project-provider-note" className="np-provider-note" data-state={status.state} role="status">
            <span>{getProviderNote(provider, status, minute * 60000)}</span>
            <span className="np-provider-actions">
                {status.state === "login" ? (
                    <button type="button" id="new-project-provider-login" onClick={() => openProviderLogin(provider)}>
                        로그인하기
                    </button>
                ) : null}
                {providerStates?.[other]?.state === "ready" ? (
                    <button type="button" id="new-project-provider-switch" onClick={() => pickProvider(other)}>
                        {`${PROVIDER_LABELS[other]}로 바꾸기`}
                    </button>
                ) : null}
                <button type="button" id="new-project-provider-recheck" onClick={loadDraftProviders}>
                    다시 확인
                </button>
            </span>
        </div>
    );
};

// 초안과 추천을 써 줄 AI 선택. 같은 상태를 두 곳(추천 줄 · 초안 만들기 줄)에서 보이고 바꾸므로 라디오 이름만 다르다. 받는 중에는 바꿀 수 없다.
const ProviderSeg = ({ name, label }) => {
    const { provider, providerStates, isBusy } = useNewProjectStore(
        useShallow((store) => ({ provider: store.provider, providerStates: store.providerStates, isBusy: store.isSuggesting || store.isDrafting }))
    );

    return <Seg name={name} label={label} className="mode-seg np-seg np-provider" options={getProviderOptions(providerStates, isBusy)} value={provider} onChange={pickProvider} />;
};

const ExampleChip = ({ example, what }) => {
    return (
        <button type="button" title={example.what} aria-pressed={what === example.what} onClick={() => applyExample(example)}>
            {example.label}
        </button>
    );
};

// 한 칸 위에서 고른 예시를 채우는 칩 두 묶음. 기본 예시는 그대로 두고, 고른 AI(Claude haiku · Codex)가 새로 추천한 예시를 아래 묶음에 따로 보인다. 같은 AI가 초안도 쓴다.
// 받는 동안은 자리 표시를 보이고 AI를 바꿀 수 없다. 로그인·한도로 쓸 수 없는 AI는 받기가 잠기고 이유가 아래에 나온다.
const Examples = () => {
    const { provider, what, providerStates, suggestions, isSuggesting, suggestError } = useNewProjectStore(
        useShallow((store) => ({
            provider: store.provider,
            what: store.what,
            providerStates: store.providerStates,
            suggestions: store.suggestions,
            isSuggesting: store.isSuggesting,
            suggestError: store.suggestError
        }))
    );
    const list = suggestions[provider];
    const isReady = isProviderReady(providerStates, provider);
    const suggestLabel = list.length ? "다시 받기" : "추천 예시 받기";

    const isWaiting = isSuggesting && list.length === 0;

    return (
        <div className="np-examples">
            <div className="np-ex-group" role="group" aria-labelledby="new-project-examples-basic">
                <span id="new-project-examples-basic" className="np-ex-label">
                    기본 예시
                </span>
                <div className="np-chips">
                    {EXAMPLES.map((example) => (
                        <ExampleChip key={example.label} example={example} what={what} />
                    ))}
                </div>
            </div>
            <div className="np-ex-group" role="group" aria-labelledby="new-project-examples-ai" aria-busy={isSuggesting}>
                <div className="np-ex-head">
                    <span id="new-project-examples-ai" className="np-ex-label">
                        AI 추천
                    </span>
                    <ProviderSeg name="new-project-provider" label="추천을 써 줄 AI" />
                    <button type="button" className={cx("np-suggest", isSuggesting && "is-busy")} disabled={isSuggesting || !isReady} onClick={suggestExamples}>
                        {isSuggesting ? <span className="ring" aria-hidden="true" /> : <Icon symbol="icon-refresh" />}
                        {isSuggesting ? "받는 중" : suggestLabel}
                    </button>
                </div>
                {isWaiting || list.length > 0 || isReady ? (
                    <div className="np-chips">
                        {isWaiting ? SKELETON_CHIP_WIDTHS.map((width) => <span key={width} className="np-chip-skel" style={{ width: width }} aria-hidden="true" />) : null}
                        {list.map((example) => (
                            <ExampleChip key={example.label} example={example} what={what} />
                        ))}
                        {!isWaiting && list.length === 0 ? <p className="np-hint">{`${PROVIDER_LABELS[provider]}에게 새 아이디어를 받아 볼 수 있어요.`}</p> : null}
                    </div>
                ) : null}
                {suggestError && isReady ? (
                    <p className="np-error" role="status">
                        {suggestError}
                    </p>
                ) : null}
            </div>
        </div>
    );
};

// 1단계: 무엇을 만들지 한두 줄과 실행 환경만 받는다. 초안 만들기를 누르면 다듬기 화면의 틀이 바로 나와 고른 AI(Claude·Codex)가 칸을 채운다(RefineStep의 waiting). 직접 다 쓸게요는 빈 다듬기로 간다.
// 로그인·한도로 고른 AI를 쓸 수 없으면 초안 만들기는 잠기고(Examples의 안내가 이유와 길을 알린다), 직접 다 쓸게요는 늘 쓸 수 있다.
const WriteStep = () => {
    const { what, platforms, parentDir, provider, providerStates } = useNewProjectStore(
        useShallow((store) => ({ what: store.what, platforms: store.platforms, parentDir: store.info.parentDir, provider: store.provider, providerStates: store.providerStates }))
    );
    const canDraft = Boolean(what.trim()) && isProviderReady(providerStates, provider);

    const handleKeyDown = (event) => {
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && canDraft) {
            requestDraft();
        }
    };

    return (
        <div id="new-project-write" className="np-start">
            <section className="np-block np-block-main">
                <label className="np-start-label" htmlFor="new-project-what">
                    무엇을 만들고 싶으세요?
                </label>
                <textarea
                    id="new-project-what"
                    className="np-input big"
                    rows={3}
                    maxLength={MAX_WHAT_LENGTH}
                    spellCheck={false}
                    placeholder="예: 동네 미용실 예약 웹앱. 손님은 날짜와 디자이너를 골라 예약하고, 원장은 하루 예약표를 봐요."
                    value={what}
                    onChange={(event) => newProject.set({ what: event.target.value })}
                    onKeyDown={handleKeyDown}
                ></textarea>
                <p className="np-count">
                    <span>누가 무엇을 하는지 한두 줄이면 충분해요. Ctrl + Enter로 바로 초안을 만들어요.</span>
                    <span className="num">{`${what.length} / ${MAX_WHAT_LENGTH}`}</span>
                </p>
            </section>
            <section className="np-block" aria-labelledby="new-project-ideas-title">
                <h2 id="new-project-ideas-title" className="np-label">
                    막막하다면 예시로 시작해 보세요 <span className="np-opt">누르면 위 칸이 채워져요</span>
                </h2>
                <Examples />
            </section>
            <section className="np-block" aria-labelledby="new-project-platform-label">
                <h2 id="new-project-platform-label" className="np-label">
                    어디서 쓰나요? <span className="np-opt">몰라도 괜찮아요</span>
                </h2>
                <div className="np-pick" role="group" aria-labelledby="new-project-platform-label">
                    {PLATFORMS.map((platform) => (
                        <button key={platform.key} type="button" aria-pressed={platforms.includes(platform.key)} onClick={() => newProject.togglePlatform(platform.key)}>
                            {platform.label}
                        </button>
                    ))}
                </div>
            </section>
            <section className="np-block">
                <FolderField parentDir={parentDir} />
            </section>
            <footer className="np-start-foot">
                <ProviderNote provider={provider} providerStates={providerStates} />
                <div className="np-foot-ai">
                    <div className="np-foot-ai-row">
                        <span className="np-ex-label">초안 AI</span>
                        <ProviderSeg name="new-project-provider-draft" label="초안을 써 줄 AI" />
                    </div>
                    <p className="np-ai-note">{`${PROVIDER_LABELS[provider]}가 ${DRAFT_SECONDS[provider]}초쯤 걸려 초안을 써요. 고른 계정의 사용량을 조금 써요.`}</p>
                </div>
                <div className="np-foot-actions">
                    <button type="button" id="new-project-manual" className="np-text" onClick={() => writeManually()}>
                        직접 다 쓸게요
                    </button>
                    <Button id="new-project-draft" variant="primary" size="" disabled={!canDraft} onClick={requestDraft}>
                        초안 만들기
                        <Icon symbol="icon-back" className="icon np-forward" />
                    </Button>
                </div>
            </footer>
        </div>
    );
};

const StackField = ({ stack }) => {
    const options = [
        { value: "recommended", label: STACK_LABELS.recommended, disabled: stack.items.length === 0 },
        { value: "later", label: STACK_LABELS.later },
        { value: "custom", label: STACK_LABELS.custom }
    ];

    return (
        <div className="np-field">
            <span className="np-label">기술 스택</span>
            <Seg name="new-project-stack" label="기술 스택" className="mode-seg np-seg" options={options} value={stack.choice} onChange={(choice) => newProject.setStack({ choice: choice })} />
            {stack.choice === "recommended" ? (
                <>
                    <div className="tags">
                        {stack.items.map((item) => (
                            <span key={item} className="tag-chip" data-picked="">
                                {item}
                            </span>
                        ))}
                    </div>
                    {stack.reason ? <span className="np-hint">{stack.reason}</span> : null}
                </>
            ) : null}
            {stack.choice === "custom" ? (
                <TagChips
                    label="정한 기술"
                    items={stack.custom.map((item) => ({ label: item, picked: true }))}
                    onToggle={(index) => newProject.setStack({ custom: stack.custom.filter((item, itemIndex) => itemIndex !== index) })}
                    onAdd={(labels) => newProject.setStack({ custom: [...new Set([...stack.custom, ...labels])] })}
                    addLabel="기술 추가"
                />
            ) : null}
            {stack.choice === "later" ? <span className="np-hint">기획 단계에서 고른 이유와 함께 정해요.</span> : null}
        </div>
    );
};

const AuthorField = ({ author }) => {
    return (
        <div id="new-project-author" className="np-author" role="group" aria-labelledby="new-project-author-title">
            <p id="new-project-author-title" className="np-author-title">
                첫 커밋에 쓸 작성자가 없어요
            </p>
            <div className="np-row2">
                <input
                    className="np-input"
                    aria-label="작성자 이름"
                    placeholder="이름"
                    maxLength={100}
                    value={author.name}
                    onChange={(event) => newProject.set({ author: { ...author, name: event.target.value } })}
                />
                <input
                    className="np-input"
                    type="email"
                    aria-label="작성자 이메일"
                    placeholder="이메일"
                    maxLength={200}
                    value={author.email}
                    onChange={(event) => newProject.set({ author: { ...author, email: event.target.value } })}
                />
            </div>
            <small>이 저장소에만 저장해요.</small>
        </div>
    );
};

// 칸이 채워지는 순서와 간격(초). 응답이 오면 위에서부터 한 칸씩 채워진다(NewProject.css의 --d).
const FILL_STEP = 0.45;
const FILL_COUNT = 4;
const SKELETON_LINES = ["38%", "92%", "78%", "26%", "64%", "56%", "30%", "70%", "48%"];

const getFill = (order) => {
    return order === undefined ? {} : { "data-fill": "", style: { "--d": String(order * FILL_STEP) } };
};

const ItemField = ({ field, label, addLabel, hint = "", order }) => {
    const items = useNewProjectStore((store) => store.draft[field]);
    const hasSuggestion = items.some((item) => !item.picked);

    return (
        <div className="np-field" {...getFill(order)}>
            <span className="np-label">
                {label}
                {hint && hasSuggestion ? <span className="np-opt">{hint}</span> : null}
            </span>
            <div className="np-fill">
                <TagChips label={label} items={items} onToggle={(index) => newProject.toggleItem(field, index)} onAdd={(labels) => newProject.addItems(field, labels)} addLabel={addLabel} />
            </div>
        </div>
    );
};

// 초안을 쓰는 동안(waiting)과 응답이 온 뒤(revealing)의 머리글. 쓰는 동안은 막대가 흐르고 그만둘 수 있고, 응답이 오면 채워지는 칸 수가 올라간다.
// 응답이 언제 올지 알 수 없어 쓰는 동안에는 몇 칸째인지 말하지 않는다.
const DraftProgress = ({ mode, provider }) => {
    return (
        <header className="np-prog" role="status">
            <b>{mode === "waiting" ? `${PROVIDER_LABELS[provider]}가 초안을 쓰고 있어요` : "초안을 채우고 있어요"}</b>
            {mode === "waiting" ? (
                <button type="button" id="new-project-cancel" className="np-text" onClick={cancelDraft}>
                    그만두기
                </button>
            ) : (
                <span className="np-prog-count">
                    <i aria-hidden="true"></i>
                    {` / ${FILL_COUNT}칸`}
                </span>
            )}
            <span className="np-prog-bar" aria-hidden="true">
                <i></i>
            </span>
            {mode === "waiting" ? <span className="np-prog-note">{`${DRAFT_SECONDS[provider]}초쯤 걸려요. 다 쓰면 이 칸들이 위에서부터 차례로 채워져요.`}</span> : null}
        </header>
    );
};

// 쓰는 동안 brief.md 자리에 보이는 반짝이는 자리 표시.
const DocSkeleton = () => {
    return (
        <article className="doc-preview np-doc-skeleton" aria-busy="true" aria-label="초안을 쓰는 중">
            <p className="doc-path">docs/autopilot/brief.md</p>
            {SKELETON_LINES.map((width, index) => (
                <i key={index} className="np-skel" style={{ width: width }} />
            ))}
        </article>
    );
};

const getDraftMode = (isDrafting, isRevealing) => {
    if (isDrafting) {
        return "waiting";
    }

    return isRevealing ? "revealing" : undefined;
};

// 2단계: 초안(또는 빈 칸)을 칩으로 넣고 빼며 다듬는다. 자주 고치는 칸(기본 정보 · 사용자와 기능)만 펴 두고, 하지 않을 것 · 기술 스택 · 참고할 것은 "더 정하기"에 접어 둔다.
// 오른쪽은 만들 brief.md를 그대로 보여 준다. 초안을 쓰는 동안(waiting)은 같은 틀에 반짝이는 자리 표시가 깔리고, 응답이 오면(revealing) 칸이 위에서부터 차례로 채워진다.
const RefineStep = () => {
    const state = useNewProjectStore();
    const { draft, platforms, provider, info, author, notice, isCreating, isRefsOpen, isMoreOpen, isDrafting, isRevealing } = state;
    const mode = getDraftMode(isDrafting, isRevealing);
    const nameError = draft.name ? getProjectNameError(draft.name) : "";
    const isAuthorMissing = info.isLoaded && !info.author;
    const isAuthorReady = !isAuthorMissing || (Boolean(author.name.trim()) && EMAIL_PATTERN.test(author.email.trim()));
    const canCreate = info.isLoaded && Boolean(draft.name) && !nameError && Boolean(draft.summary.trim()) && isAuthorReady && !isCreating && !isDrafting;
    const excluded = draft.exclusions.filter((item) => item.picked).length;

    return (
        <div id="new-project-refine" className="np-grid" data-mode={mode}>
            <form className="np-form" onSubmit={(event) => event.preventDefault()}>
                {mode ? <DraftProgress mode={mode} provider={provider} /> : null}
                {notice ? (
                    <p className="np-notice" role="status">
                        {notice}
                    </p>
                ) : null}
                <section className="np-section" aria-labelledby="np-section-basic" inert={isDrafting}>
                    <h2 id="np-section-basic" className="np-section-title">
                        기본 정보
                    </h2>
                    <div className="np-field" {...getFill(0)}>
                        <label htmlFor="new-project-name">프로젝트 이름</label>
                        <div className="np-fill">
                            <input
                                id="new-project-name"
                                className="np-input"
                                value={draft.name}
                                maxLength={64}
                                spellCheck={false}
                                placeholder="예: hanbit-booking"
                                aria-invalid={Boolean(nameError)}
                                aria-describedby={nameError ? "new-project-name-error" : undefined}
                                onChange={(event) => newProject.setDraft({ name: event.target.value })}
                            />
                        </div>
                        {nameError ? (
                            <span id="new-project-name-error" className="np-error">
                                {nameError}
                            </span>
                        ) : null}
                    </div>
                    <FolderField parentDir={info.parentDir} name={draft.name} />
                    <div className="np-field" {...getFill(1)}>
                        <label htmlFor="new-project-summary">한 줄 요약</label>
                        <div className="np-fill">
                            <input
                                id="new-project-summary"
                                className="np-input"
                                value={draft.summary}
                                maxLength={200}
                                spellCheck={false}
                                onChange={(event) => newProject.setDraft({ summary: event.target.value })}
                            />
                        </div>
                    </div>
                </section>
                <section className="np-section" aria-labelledby="np-section-scope" inert={isDrafting}>
                    <h2 id="np-section-scope" className="np-section-title">
                        쓰는 사람과 기능
                    </h2>
                    <ItemField field="users" label="누가 쓰나요?" addLabel="사용자 추가" order={2} />
                    <div className="np-field">
                        <span className="np-label">어디서 쓰나요?</span>
                        <TagChips
                            label="어디서 쓰나요"
                            items={PLATFORMS.map((platform) => ({ label: platform.label, picked: platforms.includes(platform.key) }))}
                            onToggle={(index) => newProject.togglePlatform(PLATFORMS[index].key)}
                        />
                    </div>
                    <ItemField field="features" label="꼭 있어야 할 기능" addLabel="기능 추가" hint="회색은 추천이에요. 누르면 넣어요" order={3} />
                </section>
                <details className="np-extra" open={isMoreOpen} inert={isDrafting} onToggle={(event) => newProject.set({ isMoreOpen: event.currentTarget.open })}>
                    <summary>
                        <Icon symbol="icon-chevron" className="chevron" />더 정하기
                        <span>{`하지 않을 것 ${excluded}개 · 기술 스택 ${STACK_LABELS[draft.stack.choice]}`}</span>
                    </summary>
                    <div className="np-extra-body">
                        <ItemField field="exclusions" label="이번에 하지 않을 것" addLabel="추가" />
                        <StackField stack={draft.stack} />
                        {isRefsOpen || draft.refs.length > 0 ? (
                            <div className="np-field">
                                <span className="np-label">참고할 것</span>
                                <TagChips
                                    label="참고할 것"
                                    items={draft.refs}
                                    onToggle={(index) => newProject.toggleItem("refs", index)}
                                    onAdd={(labels) => newProject.addItems("refs", labels)}
                                    addLabel="서비스나 링크"
                                    autoFocus={draft.refs.length === 0}
                                />
                            </div>
                        ) : (
                            <button type="button" className="np-more" onClick={() => newProject.set({ isRefsOpen: true })}>
                                <Icon symbol="icon-plus" />
                                참고할 서비스나 링크 더하기
                            </button>
                        )}
                    </div>
                </details>
            </form>
            <div className="np-side">
                <header className="np-brief-head">
                    <p>
                        <b>기획 설명서</b>
                        <code>brief.md</code>
                    </p>
                    <span>기획 단계가 가장 먼저 읽는 한 장짜리 문서예요. 왼쪽에서 고른 내용이 그대로 담기고, 만들면 프로젝트의 첫 커밋이 돼요.</span>
                </header>
                {isDrafting ? <DocSkeleton /> : <DocPreview doc={{ kind: "file", path: "docs/autopilot/brief.md", text: getBrief(state) }} />}
                {isAuthorMissing ? <AuthorField author={author} /> : null}
                <div className="np-actions">
                    <Button id="new-project-create" variant="primary" size="" disabled={!canCreate} onClick={createProject}>
                        <Icon symbol="icon-plus" />
                        {isCreating ? "만드는 중" : "만들기"}
                    </Button>
                    <p>폴더를 만들고 Git 저장소를 시작해요. 첫 커밋에 brief.md를 담고 신규 개발 준비 화면으로 이동해요.</p>
                    <button type="button" id="new-project-restart" className="np-text" disabled={isCreating || isDrafting} onClick={newProject.restart}>
                        처음부터 다시 쓰기
                    </button>
                </div>
            </div>
        </div>
    );
};

const getSubtitleKey = (isDrafting, isWriting, isDrafted) => {
    if (isDrafting) {
        return "drafting";
    }

    if (isWriting) {
        return "write";
    }

    return isDrafted ? "drafted" : "manual";
};

// 새 프로젝트 만들기: 한두 줄 적기 → 초안 다듬기 → 만들기(폴더·Git·brief.md 첫 커밋, 신규 개발 탭). 레일의 "새 프로젝트"가 연다.
// 초안을 쓰는 동안에는 다음 단계(다듬기)의 틀을 미리 보여 준다.
const NewProjectView = () => {
    const { step, isDrafted, isCreating, isDrafting, provider } = useNewProjectStore(
        useShallow((store) => ({ step: store.step, isDrafted: store.isDrafted, isCreating: store.isCreating, isDrafting: store.isDrafting, provider: store.provider }))
    );
    const isWriting = step === "write" && !isDrafting;
    const subtitle = SUBTITLES[getSubtitleKey(isDrafting, isWriting, isDrafted)].replace("{AI}", PROVIDER_LABELS[provider]);

    useEffect(() => {
        window.addEventListener("focus", recheckDraftProviders);

        return () => window.removeEventListener("focus", recheckDraftProviders);
    }, []);

    return (
        <section id="new-project" className={cx("new-project", `is-${isWriting ? "write" : "refine"}`)} aria-labelledby="new-project-title">
            <header className="np-head">
                <h1 id="new-project-title">새 프로젝트</h1>
                <p className="np-sub">{subtitle}</p>
            </header>
            <Flow isWriting={isWriting} isCreating={isCreating} />
            {isWriting ? <WriteStep /> : <RefineStep />}
        </section>
    );
};

export { NewProjectView, TagChips };

import { useShallow } from "zustand/react/shallow";
import { getProjectNameError, PLATFORMS } from "../../../projectDraft.cjs";
import { applyExample, cancelDraft, createProject, EXAMPLES, getBrief, pickParentDir, requestDraft, suggestExamples, writeManually } from "../../actions/newProject.js";
import { Button } from "../../components/Button.jsx";
import { Icon } from "../../components/Icon.jsx";
import { Seg } from "../../components/Seg.jsx";
import { cx } from "../../lib/cx.js";
import { newProject, useNewProjectStore } from "../../stores/newProjectStore.js";
import { DocPreview } from "../approval/DocPreview.jsx";
import { TagChips } from "./TagChips.jsx";
import "./NewProject.css";

const FLOW = ["한두 줄 적기", "초안 다듬기", "만들기"];
const SUBTITLES = {
    write: "한두 줄이면 충분해요. 나머지는 초안으로 채워 드릴게요.",
    drafted: "Claude가 쓴 초안이에요. 눌러서 빼거나 더하면 돼요.",
    manual: "칸을 채우고 눌러서 넣거나 빼면 돼요.",
    drafting: "Claude가 초안을 쓰는 동안 잠깐만 기다려 주세요."
};
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

// 기본 예시는 그대로 두고, Claude(haiku)가 새로 추천한 예시를 그 아래 줄에 따로 보인다.
const Examples = () => {
    const { suggestions, isSuggesting, suggestError } = useNewProjectStore(
        useShallow((store) => ({ suggestions: store.suggestions, isSuggesting: store.isSuggesting, suggestError: store.suggestError }))
    );
    const suggestLabel = suggestions.length ? "다시 받기" : "추천 예시 받기";

    return (
        <div className="np-examples">
            <div className="np-example-row">
                <span>예시로 시작하기</span>
                {EXAMPLES.map((example) => (
                    <button key={example.label} type="button" title={example.what} onClick={() => applyExample(example)}>
                        {example.label}
                    </button>
                ))}
            </div>
            <div className="np-example-row">
                <span>Claude 추천</span>
                {suggestions.map((example) => (
                    <button key={example.label} type="button" title={example.what} onClick={() => applyExample(example)}>
                        {example.label}
                    </button>
                ))}
                <button type="button" className="np-suggest" disabled={isSuggesting} onClick={suggestExamples}>
                    {isSuggesting ? <span className="ring" aria-hidden="true" /> : <Icon symbol="icon-refresh" />}
                    {isSuggesting ? "받는 중" : suggestLabel}
                </button>
                {suggestError ? (
                    <span className="np-error" role="status">
                        {suggestError}
                    </span>
                ) : null}
            </div>
        </div>
    );
};

// 1단계: 무엇을 만들지 한두 줄과 실행 환경만 받는다. 초안 만들기를 누르면 다듬기 화면의 틀이 바로 나와 Claude가 칸을 채운다(RefineStep의 waiting). 직접 다 쓸게요는 빈 다듬기로 간다.
const WriteStep = () => {
    const { what, platforms, parentDir } = useNewProjectStore(useShallow((store) => ({ what: store.what, platforms: store.platforms, parentDir: store.info.parentDir })));

    const handleKeyDown = (event) => {
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && what.trim()) {
            requestDraft();
        }
    };

    return (
        <div id="new-project-write" className="np-start">
            <label className="np-start-label" htmlFor="new-project-what">
                무엇을 만들고 싶으세요?
            </label>
            <textarea
                id="new-project-what"
                className="np-input big"
                rows={3}
                maxLength={2000}
                spellCheck={false}
                placeholder="예: 동네 미용실 예약 웹앱. 손님은 날짜와 디자이너를 골라 예약하고, 원장은 하루 예약표를 봐요."
                value={what}
                onChange={(event) => newProject.set({ what: event.target.value })}
                onKeyDown={handleKeyDown}
            ></textarea>
            <Examples />
            <div className="np-field">
                <span className="np-label" id="new-project-platform-label">
                    어디서 쓰나요? <span className="np-opt">몰라도 괜찮아요</span>
                </span>
                <div className="np-pick" role="group" aria-labelledby="new-project-platform-label">
                    {PLATFORMS.map((platform) => (
                        <button key={platform.key} type="button" aria-pressed={platforms.includes(platform.key)} onClick={() => newProject.togglePlatform(platform.key)}>
                            {platform.label}
                        </button>
                    ))}
                </div>
            </div>
            <FolderField parentDir={parentDir} />
            <div className="np-start-foot">
                <button type="button" id="new-project-manual" className="np-text" onClick={() => writeManually()}>
                    직접 다 쓸게요
                </button>
                <Button id="new-project-draft" variant="primary" size="" disabled={!what.trim()} onClick={requestDraft}>
                    초안 만들기
                    <Icon symbol="icon-back" className="icon np-forward" />
                </Button>
            </div>
            <p className="np-ai-note">Claude가 10초쯤 걸려 초안을 써요. 고른 계정의 사용량을 조금 써요.</p>
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
const DraftProgress = ({ mode }) => {
    return (
        <header className="np-prog" role="status">
            <b>{mode === "waiting" ? "Claude가 초안을 쓰고 있어요" : "초안을 채우고 있어요"}</b>
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
            {mode === "waiting" ? <span className="np-prog-note">10초쯤 걸려요. 다 쓰면 이 칸들이 위에서부터 차례로 채워져요.</span> : null}
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
    const { draft, platforms, info, author, notice, isCreating, isRefsOpen, isMoreOpen, isDrafting, isRevealing } = state;
    const mode = getDraftMode(isDrafting, isRevealing);
    const nameError = draft.name ? getProjectNameError(draft.name) : "";
    const isAuthorMissing = info.isLoaded && !info.author;
    const isAuthorReady = !isAuthorMissing || (Boolean(author.name.trim()) && EMAIL_PATTERN.test(author.email.trim()));
    const canCreate = info.isLoaded && Boolean(draft.name) && !nameError && Boolean(draft.summary.trim()) && isAuthorReady && !isCreating && !isDrafting;
    const excluded = draft.exclusions.filter((item) => item.picked).length;

    return (
        <div id="new-project-refine" className="np-grid" data-mode={mode}>
            <form className="np-form" onSubmit={(event) => event.preventDefault()}>
                {mode ? <DraftProgress mode={mode} /> : null}
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
    const { step, isDrafted, isCreating, isDrafting } = useNewProjectStore(
        useShallow((store) => ({ step: store.step, isDrafted: store.isDrafted, isCreating: store.isCreating, isDrafting: store.isDrafting }))
    );
    const isWriting = step === "write" && !isDrafting;
    const subtitle = SUBTITLES[getSubtitleKey(isDrafting, isWriting, isDrafted)];

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

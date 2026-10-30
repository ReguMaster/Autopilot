import { useShallow } from "zustand/react/shallow";
import { getProjectNameError, PLATFORMS } from "../../../projectDraft.cjs";
import { applyExample, cancelDraft, createProject, EXAMPLES, getBrief, pickParentDir, requestDraft, writeManually } from "../../actions/newProject.js";
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
    manual: "칸을 채우고 눌러서 넣거나 빼면 돼요."
};
const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+$/;

const getFlowState = (index, current) => {
    if (index === current) {
        return "active";
    }

    return index < current ? "done" : undefined;
};

const Flow = ({ step }) => {
    const current = step === "write" ? 0 : 1;

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

// 1단계: 무엇을 만들지 한두 줄과 실행 환경만 받는다. 초안 만들기는 Claude에게 나머지를 맡기고, 직접 다 쓸게요는 빈 다듬기로 간다.
const WriteStep = () => {
    const { what, platforms, isDrafting, parentDir } = useNewProjectStore(
        useShallow((store) => ({ what: store.what, platforms: store.platforms, isDrafting: store.isDrafting, parentDir: store.info.parentDir }))
    );

    const handleKeyDown = (event) => {
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && what.trim() && !isDrafting) {
            requestDraft();
        }
    };

    return (
        <div id="new-project-write" className="np-start" aria-busy={isDrafting}>
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
                readOnly={isDrafting}
                onChange={(event) => newProject.set({ what: event.target.value })}
                onKeyDown={handleKeyDown}
            ></textarea>
            <div className="np-examples">
                <span>예시로 시작하기</span>
                {EXAMPLES.map((example) => (
                    <button key={example.label} type="button" disabled={isDrafting} onClick={() => applyExample(example)}>
                        {example.label}
                    </button>
                ))}
            </div>
            <div className="np-field">
                <span className="np-label" id="new-project-platform-label">
                    어디서 쓰나요? <span className="np-opt">몰라도 괜찮아요</span>
                </span>
                <div className="np-pick" role="group" aria-labelledby="new-project-platform-label">
                    {PLATFORMS.map((platform) => (
                        <button key={platform.key} type="button" aria-pressed={platforms.includes(platform.key)} disabled={isDrafting} onClick={() => newProject.togglePlatform(platform.key)}>
                            {platform.label}
                        </button>
                    ))}
                </div>
            </div>
            <div className="np-start-foot">
                <p className="np-where">
                    <code title={parentDir}>{parentDir}</code>
                    <span>안에 만들어요</span>
                    <button type="button" className="np-link" disabled={isDrafting} onClick={pickParentDir}>
                        바꾸기
                    </button>
                </p>
                {isDrafting ? (
                    <button type="button" id="new-project-cancel" className="np-text" onClick={cancelDraft}>
                        그만두기
                    </button>
                ) : (
                    <button type="button" id="new-project-manual" className="np-text" onClick={() => writeManually()}>
                        직접 다 쓸게요
                    </button>
                )}
                <Button id="new-project-draft" variant="primary" size="" disabled={!what.trim() || isDrafting} onClick={requestDraft}>
                    {isDrafting ? <span className="ring" aria-hidden="true" /> : null}
                    {isDrafting ? "초안을 쓰고 있어요" : "초안 만들기"}
                    {isDrafting ? null : <Icon symbol="icon-back" className="icon np-forward" />}
                </Button>
            </div>
            <p className="np-ai-note" role="status">
                {isDrafting ? "Claude가 초안을 쓰고 있어요. 10초쯤 걸려요." : "Claude가 10초쯤 걸려 초안을 써요. 고른 계정의 사용량을 조금 써요."}
            </p>
        </div>
    );
};

const getPathSeparator = (dir) => {
    return dir.includes("\\") ? "\\" : "/";
};

const StackField = ({ stack }) => {
    const options = [
        { value: "recommended", label: "추천대로", disabled: stack.items.length === 0 },
        { value: "later", label: "나중에" },
        { value: "custom", label: "직접" }
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

const ItemField = ({ field, label, addLabel, hint = "" }) => {
    const items = useNewProjectStore((store) => store.draft[field]);
    const hasSuggestion = items.some((item) => !item.picked);

    return (
        <div className="np-field">
            <span className="np-label">
                {label}
                {hint && hasSuggestion ? <span className="np-opt">{hint}</span> : null}
            </span>
            <TagChips label={label} items={items} onToggle={(index) => newProject.toggleItem(field, index)} onAdd={(labels) => newProject.addItems(field, labels)} addLabel={addLabel} />
        </div>
    );
};

// 2단계: 초안(또는 빈 칸)을 칩으로 넣고 빼며 다듬는다. 오른쪽은 만들 brief.md를 그대로 보여 준다.
const RefineStep = () => {
    const state = useNewProjectStore();
    const { draft, platforms, info, author, notice, isCreating, isRefsOpen } = state;
    const nameError = draft.name ? getProjectNameError(draft.name) : "";
    const isAuthorMissing = info.isLoaded && !info.author;
    const isAuthorReady = !isAuthorMissing || (Boolean(author.name.trim()) && EMAIL_PATTERN.test(author.email.trim()));
    const canCreate = info.isLoaded && Boolean(draft.name) && !nameError && Boolean(draft.summary.trim()) && isAuthorReady && !isCreating;
    const separator = getPathSeparator(info.parentDir);

    return (
        <div id="new-project-refine" className="np-grid">
            <form className="np-form" onSubmit={(event) => event.preventDefault()}>
                {notice ? (
                    <p className="np-notice" role="status">
                        {notice}
                    </p>
                ) : null}
                <div className="np-row2">
                    <div className="np-field">
                        <label htmlFor="new-project-name">프로젝트 이름</label>
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
                        {nameError ? (
                            <span id="new-project-name-error" className="np-error">
                                {nameError}
                            </span>
                        ) : null}
                    </div>
                    <div className="np-field">
                        <span className="np-label">만들 위치</span>
                        <div className="np-input np-path" title={`${info.parentDir}${separator}${draft.name}`}>
                            <code>{`${info.parentDir}${separator}`}</code>
                            <b>{draft.name}</b>
                            <button type="button" className="np-link" onClick={pickParentDir}>
                                바꾸기
                            </button>
                        </div>
                    </div>
                </div>
                <div className="np-field">
                    <label htmlFor="new-project-summary">한 줄 요약</label>
                    <input
                        id="new-project-summary"
                        className="np-input"
                        value={draft.summary}
                        maxLength={200}
                        spellCheck={false}
                        onChange={(event) => newProject.setDraft({ summary: event.target.value })}
                    />
                </div>
                <ItemField field="users" label="누가 쓰나요?" addLabel="사용자 추가" />
                <div className="np-field">
                    <span className="np-label">어디서 쓰나요?</span>
                    <TagChips
                        label="어디서 쓰나요"
                        items={PLATFORMS.map((platform) => ({ label: platform.label, picked: platforms.includes(platform.key) }))}
                        onToggle={(index) => newProject.togglePlatform(PLATFORMS[index].key)}
                    />
                </div>
                <ItemField field="features" label="꼭 있어야 할 기능" addLabel="기능 추가" hint="회색은 추천이에요. 누르면 넣어요" />
                <div className="np-row2">
                    <ItemField field="exclusions" label="이번에 하지 않을 것" addLabel="추가" />
                    <StackField stack={draft.stack} />
                </div>
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
            </form>
            <div className="np-side">
                <DocPreview doc={{ kind: "file", path: "docs/autopilot/brief.md", text: getBrief(state) }} />
                {isAuthorMissing ? <AuthorField author={author} /> : null}
                <div className="np-actions">
                    <Button id="new-project-create" variant="primary" size="" disabled={!canCreate} onClick={createProject}>
                        <Icon symbol="icon-plus" />
                        {isCreating ? "만드는 중" : "만들기"}
                    </Button>
                    <p>폴더를 만들고 Git 저장소를 시작해요. 첫 커밋에 brief.md를 담고 신규 개발 준비 화면으로 이동해요.</p>
                    <button type="button" id="new-project-restart" className="np-text" disabled={isCreating} onClick={newProject.restart}>
                        처음부터 다시 쓰기
                    </button>
                </div>
            </div>
        </div>
    );
};

// 새 프로젝트 만들기: 한두 줄 적기 → 초안 다듬기 → 만들기(폴더·Git·brief.md 첫 커밋, 신규 개발 탭). 레일의 "새 프로젝트"가 연다.
const NewProjectView = () => {
    const { step, isDrafted } = useNewProjectStore(useShallow((store) => ({ step: store.step, isDrafted: store.isDrafted })));
    const subtitle = step === "write" ? SUBTITLES.write : SUBTITLES[isDrafted ? "drafted" : "manual"];

    return (
        <section id="new-project" className={cx("new-project", `is-${step}`)} aria-labelledby="new-project-title">
            <header className="np-head">
                <h1 id="new-project-title">새 프로젝트</h1>
                <p className="np-sub">{subtitle}</p>
            </header>
            <Flow step={step} />
            {step === "write" ? <WriteStep /> : <RefineStep />}
        </section>
    );
};

export { NewProjectView, TagChips };

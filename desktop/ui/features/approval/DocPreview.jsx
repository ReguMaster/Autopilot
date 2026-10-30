import { useMemo, useState } from "react";
import { Icon } from "../../components/Icon.jsx";
import { Blocks, Block, Inline, lexMarkdown } from "../../components/Markdown.jsx";

const HEADING_TAGS = { 1: "h3", 2: "h4", 3: "h5" };

// 같은 단계의 제목이 둘 이상인 가장 얕은 제목으로 문서를 가른다(보통 ##). 첫 제목 앞은 접지 않는 머리글이다.
const getSections = (tokens) => {
    const level = [1, 2, 3].find((candidate) => tokens.filter((token) => token.type === "heading" && Math.min(token.depth, 3) === candidate).length >= 2);
    const sections = [{ heading: null, body: [] }];

    for (const token of tokens) {
        if (level && token.type === "heading" && Math.min(token.depth, 3) === level) {
            sections.push({ heading: token, body: [] });
        } else {
            sections.at(-1).body.push(token);
        }
    }

    return sections.filter((section) => section.heading || section.body.length);
};

// 접힌 칸은 inert로 포커스와 읽기에서 뺀다. 높이는 0fr↔1fr로 미끄러진다(stage.css).
const Section = ({ section, isOpen, onToggle }) => {
    const Heading = HEADING_TAGS[Math.min(section.heading.depth, 3)];

    return (
        <section className="doc-section" data-closed={isOpen ? undefined : ""}>
            <Heading>
                <button type="button" className="doc-section-head" aria-expanded={isOpen} onClick={onToggle}>
                    <Icon symbol="icon-chevron" className="chevron" />
                    <span>
                        <Inline tokens={section.heading.tokens} />
                    </span>
                </button>
            </Heading>
            <div className="doc-section-body" inert={!isOpen}>
                <div>
                    <Blocks tokens={section.body} />
                </div>
            </div>
        </section>
    );
};

const DocMarkdown = ({ doc }) => {
    const sections = useMemo(() => getSections(lexMarkdown(doc.text)), [doc.text]);
    const [closed, setClosed] = useState(() => new Set());
    const foldable = sections.flatMap((section, index) => (section.heading ? [index] : []));
    const isAllClosed = foldable.length > 0 && foldable.every((index) => closed.has(index));

    const toggle = (index) => {
        setClosed((current) => {
            const next = new Set(current);

            return next.delete(index) ? next : next.add(index);
        });
    };

    return (
        <>
            <div className="doc-bar">
                <p className="doc-path">{doc.path}</p>
                {foldable.length ? (
                    <button type="button" className="doc-fold-all" onClick={() => setClosed(isAllClosed ? new Set() : new Set(foldable))}>
                        {isAllClosed ? "모두 펴기" : "모두 접기"}
                    </button>
                ) : null}
            </div>
            {sections.map((section, index) =>
                section.heading ? (
                    <Section key={index} section={section} isOpen={!closed.has(index)} onToggle={() => toggle(index)} />
                ) : (
                    section.body.map((token, tokenIndex) => <Block key={`${index}-${tokenIndex}`} token={token} />)
                )
            )}
        </>
    );
};

// 단계 산출물 미리보기. 마크다운은 표·중첩 목록·인용까지 그리고(HTML은 해석하지 않는다) 칸 안에서 스크롤한다. 제목이 여럿이면 칸마다 접고 펼 수 있다. 디자인 폴더는 파일 목록이다.
const DocPreview = ({ doc, isLoading = false }) => {
    if (isLoading) {
        return <article className="doc-preview" aria-busy="true" aria-label="산출물 미리보기"></article>;
    }

    if (!doc) {
        return (
            <article className="doc-preview is-empty" aria-label="산출물 미리보기">
                <p className="doc-empty">산출물 문서를 아직 찾지 못했어요. 전체 기록에서 이번 단계에 한 일을 확인해 주세요.</p>
            </article>
        );
    }

    const isHtml = doc.kind === "file" && doc.path.endsWith(".html");

    return (
        <article className="doc-preview" aria-label="산출물 미리보기">
            {doc.kind === "file" && !isHtml ? (
                <DocMarkdown doc={doc} />
            ) : (
                <>
                    <p className="doc-path">{doc.kind === "folder" ? `${doc.path}/` : doc.path}</p>
                    {isHtml ? (
                        <p className="doc-empty">HTML 시안이라 여기서는 그리지 않아요. 열기로 브라우저에서 화면을 봐 주세요.</p>
                    ) : (
                        <ul className="doc-files">
                            {doc.entries.map((entry) => (
                                <li key={entry}>
                                    <code>{entry}</code>
                                </li>
                            ))}
                        </ul>
                    )}
                </>
            )}
        </article>
    );
};

export { DocPreview };

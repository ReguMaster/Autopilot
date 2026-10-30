import { parsePreviewBlocks, splitInlineCode } from "../../../viewFormat.js";

const HEADING_TAGS = { 1: "h3", 2: "h4", 3: "h5" };

const InlineText = ({ text }) => {
    return splitInlineCode(text).map((part, index) => (part.isCode ? <code key={index}>{part.text}</code> : part.text));
};

// 이어진 목록 항목은 한 목록으로 묶는다.
const groupBlocks = (blocks) => {
    return blocks.reduce((groups, block) => {
        if (block.type === "item" && groups.at(-1)?.type === "list") {
            groups.at(-1).items.push(block.text);
        } else {
            groups.push(block.type === "item" ? { type: "list", items: [block.text] } : block);
        }

        return groups;
    }, []);
};

const DocBlocks = ({ text }) => {
    return groupBlocks(parsePreviewBlocks(text)).map((group, index) => {
        if (group.type === "heading") {
            const Heading = HEADING_TAGS[group.level];

            return (
                <Heading key={index}>
                    <InlineText text={group.text} />
                </Heading>
            );
        }

        if (group.type === "list") {
            return (
                <ul key={index}>
                    {group.items.map((item, itemIndex) => (
                        <li key={itemIndex}>
                            <InlineText text={item} />
                        </li>
                    ))}
                </ul>
            );
        }

        if (group.type === "code") {
            return (
                <pre key={index}>
                    <code>{group.text}</code>
                </pre>
            );
        }

        return (
            <p key={index}>
                <InlineText text={group.text} />
            </p>
        );
    });
};

// 단계 산출물 미리보기. 문서는 글자로만 그리고(HTML은 해석하지 않는다) 아래는 흐리게 잘라 전체 열기로 넘긴다. 디자인 폴더는 파일 목록이다.
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

    return (
        <article className="doc-preview" aria-label="산출물 미리보기">
            <p className="doc-path">{doc.kind === "folder" ? `${doc.path}/` : doc.path}</p>
            {doc.kind === "file" && doc.path.endsWith(".html") ? (
                <p className="doc-empty">HTML 시안이라 여기서는 그리지 않아요. 열기로 브라우저에서 화면을 봐 주세요.</p>
            ) : doc.kind === "folder" ? (
                <ul className="doc-files">
                    {doc.entries.map((entry) => (
                        <li key={entry}>
                            <code>{entry}</code>
                        </li>
                    ))}
                </ul>
            ) : (
                <DocBlocks text={doc.text} />
            )}
        </article>
    );
};

export { DocPreview };

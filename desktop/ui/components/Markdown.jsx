import { marked } from "marked";

const HEADING_TAGS = { 1: "h3", 2: "h4", 3: "h5" };

// marked는 글을 토큰으로만 나눈다. HTML로 바꾸지 않고 아래에서 React 요소로만 그려서 글 속 HTML·링크는 글자로 남고 눌러서 열리지 않는다.
const lexMarkdown = (text) => {
    try {
        return marked.lexer(String(text ?? "")).filter((token) => token.type !== "space");
    } catch {
        return [{ type: "code", text: String(text ?? "") }];
    }
};

const Inline = ({ tokens }) => {
    return tokens.map((token, index) => <InlineToken key={index} token={token} />);
};

const InlineToken = ({ token }) => {
    if (token.type === "strong") {
        return (
            <strong>
                <Inline tokens={token.tokens} />
            </strong>
        );
    }

    if (token.type === "em") {
        return (
            <em>
                <Inline tokens={token.tokens} />
            </em>
        );
    }

    if (token.type === "del") {
        return (
            <del>
                <Inline tokens={token.tokens} />
            </del>
        );
    }

    if (token.type === "link") {
        return (
            <span className="md-link">
                <Inline tokens={token.tokens} />
            </span>
        );
    }

    if (token.type === "image") {
        return <span className="md-image">{token.text || "이미지"}</span>;
    }

    if (token.type === "codespan") {
        return <code>{token.text}</code>;
    }

    if (token.type === "br") {
        return <br />;
    }

    if (token.type === "checkbox") {
        return <span className="md-check" role="img" aria-label={token.checked ? "완료" : "아직"} data-checked={token.checked ? "" : undefined} />;
    }

    return token.tokens ? <Inline tokens={token.tokens} /> : (token.text ?? token.raw);
};

const Table = ({ token }) => {
    return (
        <div className="doc-table">
            <table>
                <thead>
                    <tr>
                        {token.header.map((cell, index) => (
                            <th key={index} data-align={cell.align || undefined}>
                                <Inline tokens={cell.tokens} />
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {token.rows.map((row, rowIndex) => (
                        <tr key={rowIndex}>
                            {row.map((cell, index) => (
                                <td key={index} data-align={cell.align || undefined}>
                                    <Inline tokens={cell.tokens} />
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

const List = ({ token }) => {
    const Tag = token.ordered ? "ol" : "ul";

    return (
        <Tag start={token.ordered && token.start > 1 ? token.start : undefined}>
            {token.items.map((item, index) => (
                <li key={index} className={item.task ? "md-task" : undefined}>
                    <Blocks tokens={item.tokens} />
                </li>
            ))}
        </Tag>
    );
};

const Block = ({ token }) => {
    if (token.type === "heading") {
        const Heading = HEADING_TAGS[Math.min(token.depth, 3)];

        return (
            <Heading>
                <Inline tokens={token.tokens} />
            </Heading>
        );
    }

    if (token.type === "paragraph") {
        return (
            <p>
                <Inline tokens={token.tokens} />
            </p>
        );
    }

    if (token.type === "text" || token.type === "checkbox") {
        return token.tokens ? <Inline tokens={token.tokens} /> : <InlineToken token={token} />;
    }

    if (token.type === "list") {
        return <List token={token} />;
    }

    if (token.type === "blockquote") {
        return (
            <blockquote>
                <Blocks tokens={token.tokens} />
            </blockquote>
        );
    }

    if (token.type === "code") {
        return (
            <pre>
                <code>{token.text}</code>
            </pre>
        );
    }

    if (token.type === "table") {
        return <Table token={token} />;
    }

    if (token.type === "hr") {
        return <hr />;
    }

    // 글 속 HTML은 해석하지 않고 글자로 보인다. 주석만 숨긴다.
    if (token.type === "html" && !token.text.trimStart().startsWith("<!--")) {
        return <p className="md-raw">{token.text.trim()}</p>;
    }

    return null;
};

const Blocks = ({ tokens }) => {
    return tokens.map((token, index) => <Block key={index} token={token} />);
};

export { lexMarkdown, Blocks, Block, Inline };

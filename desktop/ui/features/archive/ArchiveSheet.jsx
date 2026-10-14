import { memo, useLayoutEffect, useMemo, useRef } from "react";
import { buildTranscript, describePastRun } from "../../../viewFormat.js";
import { deleteArchiveRun, openArchiveDetail, openArchiveFile, openArchiveList } from "../../actions/runs.js";
import { Button } from "../../components/Button.jsx";
import { Gains } from "../../components/Gains.jsx";
import { Icon } from "../../components/Icon.jsx";
import { RunList } from "../../components/RunList.jsx";
import { Tag } from "../../components/Tag.jsx";
import { useRunsStore } from "../../stores/runsStore.js";
import { ui, useUiStore } from "../../stores/uiStore.js";

const CHAT_TOOL_CHIP_LIMIT = 4;

const ToolChip = ({ tool }) => {
    return (
        <span className="tool">
            <b>{tool.name}</b>
            {tool.detail}
        </span>
    );
};

// 문장 앞에 붙는 도구 칩. 숨긴 도구는 "외 N번"으로 센다.
const ChatChips = ({ item }) => {
    const chips = item.tools.slice(-CHAT_TOOL_CHIP_LIMIT);

    return (
        <>
            {chips.map((tool, index) => (
                <ToolChip key={index} tool={tool} />
            ))}
            {item.count > chips.length ? <small className="chat-more">{`외 ${item.count - chips.length}번`}</small> : null}
        </>
    );
};

const ChatItem = memo(({ item }) => {
    if (item.kind === "say") {
        return (
            <li className="chat-item say">
                <div className="bubble">
                    <ChatChips item={item} />
                    <span className="said">{item.text}</span>
                    <time className="num">{item.time}</time>
                </div>
            </li>
        );
    }

    if (item.kind === "work") {
        return (
            <li className="chat-item work">
                <ChatChips item={item} />
            </li>
        );
    }

    if (item.kind === "round") {
        return (
            <li className="chat-item round">
                <b>{`${item.round}회차 시작`}</b>
                <small>{item.options}</small>
            </li>
        );
    }

    if (item.kind === "result") {
        return (
            <li className="chat-item result">
                <b>{`${item.round}회차`}</b>
                <Tag tone={item.tone}>{item.outcome}</Tag>
            </li>
        );
    }

    if (item.kind === "commit") {
        return (
            <li className="chat-item commit">
                <code>{item.hash}</code>
                <span className="subject">{item.subject || "제목 없음"}</span>
                <ins>{`+${item.insertions}`}</ins>
                <del>{`−${item.deletions}`}</del>
            </li>
        );
    }

    if (item.kind === "gain") {
        return (
            <li className="chat-item gain">
                <b>성과</b>
                <span>{item.text}</span>
            </li>
        );
    }

    return (
        <li className="chat-item note">
            <span>{item.kind === "finish" ? `종료 · ${item.text}` : item.text}</span>
        </li>
    );
});

const EMPTY_NOTE = { kind: "note", text: "대화로 보여 줄 내용이 없어요." };

// 상세는 로그 줄을 한 번만 대화로 바꾼다(최대 20000줄). 같은 기록이면 다시 계산하지 않는다.
const useDetail = (detail) => {
    return useMemo(() => {
        if (!detail) {
            return null;
        }

        const description = describePastRun(detail.run, Date.now());
        const transcript = buildTranscript(detail.lines);
        const notes = [...description.notes];

        if (detail.omittedLines || transcript.omitted) {
            notes.push("기록이 길어 최근 대화만 보여줘요. 전체는 원본 로그에서 볼 수 있어요.");
        }

        return { description: description, items: transcript.items, notes: notes };
    }, [detail]);
};

const DetailPane = ({ detail, view, hidden }) => {
    const chatRef = useRef(null);
    const run = detail?.run;

    useLayoutEffect(() => {
        if (chatRef.current) {
            chatRef.current.scrollTop = 0;
        }
    }, [detail]);

    return (
        <div id="archive-detail-pane" className="archive-pane" hidden={hidden}>
            <div className="archive-summary">
                <p id="archive-lead" className="archive-lead">
                    {view ? view.description.lead || view.description.meta : ""}
                </p>
                <Gains id="archive-gains" aria-label="이 실행의 성과" hidden={!run?.gains?.length} gains={(run?.gains || []).slice().reverse()} />
                <p id="archive-notes" className="archive-notes" hidden={!view?.notes.length}>
                    {view ? view.notes.join(" ") : ""}
                </p>
                <div className="finish-links">
                    <Button id="archive-report" disabled={!run?.hasReport} onClick={() => openArchiveFile("report")}>
                        <Icon symbol="icon-out" />
                        리포트 열기
                    </Button>
                    <Button id="archive-log" disabled={Boolean(run?.isUnreadable)} onClick={() => openArchiveFile("log")}>
                        <Icon symbol="icon-lines" />
                        원본 로그 열기
                    </Button>
                    <Button id="archive-delete" variant="danger" disabled={Boolean(run?.isActive)} onClick={deleteArchiveRun}>
                        기록 삭제
                    </Button>
                </div>
            </div>
            <ol id="archive-chat" ref={chatRef} className="chat" aria-label="그날의 작업 대화">
                {view ? view.items.length ? view.items.map((item, index) => <ChatItem key={index} item={item} />) : <ChatItem item={EMPTY_NOTE} /> : null}
            </ol>
        </div>
    );
};

// 지난 실행 시트: 목록과 그날의 작업 대화(채팅처럼 이어지는 상세)를 한 시트에 담는다.
const ArchiveSheet = () => {
    const open = useUiStore((store) => store.archive);
    const { pane, note, list, detail, isListLoaded } = useRunsStore();
    const view = useDetail(detail);
    const description = view?.description;
    const isDetail = pane === "detail";
    const title = isDetail && description ? `${description.day} ${description.time}`.trim() : "지난 실행";
    const count = isDetail ? (description ? [description.duration, description.status.label].filter(Boolean).join(" · ") : "") : isListLoaded && list.length ? `${list.length}개` : "";

    return (
        <section id="archive" className="archive" aria-label="지난 실행 기록" inert={!open}>
            <div className="archive-head">
                <Button id="archive-back" hidden={!isDetail} onClick={openArchiveList}>
                    <Icon symbol="icon-chevron" className="icon back" />
                    목록
                </Button>
                <h2 id="archive-title">{title}</h2>
                <span id="archive-count" className="num">
                    {count}
                </span>
                <Button id="archive-close" onClick={() => ui.setArchive(false)}>
                    닫기
                </Button>
            </div>
            <p id="archive-note" className="archive-note" hidden={!note.message} data-tone={note.tone || undefined}>
                {note.message}
            </p>

            <div id="archive-list-pane" className="archive-pane" hidden={isDetail}>
                <RunList id="archive-list" className="archive-list" runs={list} onOpen={openArchiveDetail} />
            </div>

            <DetailPane detail={detail} view={view} hidden={!isDetail} />
        </section>
    );
};

export { ArchiveSheet };

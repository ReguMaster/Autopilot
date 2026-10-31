import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { formatChatDate, formatChatTime } from "../../../viewFormat.js";
import { Blocks, lexMarkdown } from "../../components/Markdown.jsx";
import { ProviderAvatar } from "../../components/ProviderAvatar.jsx";
import { PROVIDER_LABELS } from "../../lib/constants.js";
import { cx } from "../../lib/cx.js";
import { useRunStore } from "../../stores/runStore.js";
import "./Debate.css";

// debate-out 전환(0.36초)보다 조금 길게 둔다.
const LEAVE_MS = 400;

const PARTICIPANTS = ["claude", "codex"];

const NOTE_LABELS = { agree: "동의", disagree: "반대", change: "바꾼 점" };

const isSameDay = (first, second) => new Date(first).toDateString() === new Date(second).toDateString();

// 말풍선 하나. 글은 마크다운으로 그리고, 몇 줄을 넘는 긴 말은 접어 두었다가 더 보기로 편다(접는 높이는 Debate.css의 .debate-text).
const Bubble = ({ message }) => {
    const textRef = useRef(null);
    const [isOpen, setIsOpen] = useState(false);
    const [isLong, setIsLong] = useState(false);
    const tokens = useMemo(() => lexMarkdown(message), [message]);

    useLayoutEffect(() => {
        const text = textRef.current;

        if (!text || isOpen) {
            return undefined;
        }

        const measure = () => setIsLong(text.scrollHeight > text.clientHeight + 1);
        const observer = new ResizeObserver(measure);

        measure();
        observer.observe(text);

        return () => observer.disconnect();
    }, [isOpen, tokens]);

    return (
        <div className="debate-bubble">
            <div ref={textRef} className="debate-text" data-open={isOpen ? "" : undefined} data-fade={isLong && !isOpen ? "" : undefined}>
                <Blocks tokens={tokens} />
            </div>
            {isLong || isOpen ? (
                <button type="button" className="debate-more" aria-expanded={isOpen} onClick={() => setIsOpen(!isOpen)}>
                    {isOpen ? "접기" : "더 보기"}
                </button>
            ) : null}
        </div>
    );
};

// 두 AI가 주고받은 말. 카카오톡처럼 Claude는 왼쪽, Codex는 오른쪽에 프로필 사진과 이름을 단 말풍선이고 말풍선 옆에 시각, 날짜가 바뀌는 곳에 날짜 구분선이 붙는다.
// 시각을 모르는 발언(협의 기록 파일, 다시 읽은 로그)은 시각과 날짜를 보이지 않는다. hasRounds를 주면 협의 기록처럼 주고받기마다 구분선을 둔다.
// notes는 협의 기록 파일에서 읽은 동의 · 반대 · 바꾼 점이다. typing을 주면 그쪽 차례의 빈 말풍선을 맨 아래에 둔다.
// firstIndex는 turns[0]이 대화 전체에서 몇 번째 발언인지다. 앞쪽 발언이 잘려 나가도 말풍선이 같은 발언에 붙어 있게 key로 쓴다.
const DebateBubbles = ({ turns, typing = "", hasRounds = false, firstIndex = 0 }) => {
    return (
        <>
            {turns.map((turn, index) => {
                const previous = turns[index - 1];
                const isNewDay = turn.at && (!previous?.at || !isSameDay(turn.at, previous.at));
                const time = formatChatTime(turn.at);

                return (
                    <Fragment key={firstIndex + index}>
                        {isNewDay ? (
                            <li className="debate-divider">
                                <span>{formatChatDate(turn.at)}</span>
                            </li>
                        ) : null}
                        {hasRounds && index % 2 === 0 ? (
                            <li className="debate-divider">
                                <span>{`${index / 2 + 1}번째 주고받기`}</span>
                            </li>
                        ) : null}
                        <li className="debate-turn" data-provider={turn.provider}>
                            <ProviderAvatar provider={turn.provider} />
                            <div className="debate-body">
                                <b className="debate-who">{PROVIDER_LABELS[turn.provider]}</b>
                                <div className="debate-line">
                                    <Bubble message={turn.message} />
                                    {time ? <time className="debate-time">{time}</time> : null}
                                </div>
                                {turn.notes?.length ? (
                                    <ul className="debate-notes">
                                        {turn.notes.map((note, noteIndex) => (
                                            <li key={noteIndex} data-kind={note.kind}>
                                                <b>{NOTE_LABELS[note.kind]}</b>
                                                {note.text}
                                            </li>
                                        ))}
                                    </ul>
                                ) : null}
                            </div>
                        </li>
                    </Fragment>
                );
            })}
            {typing ? (
                <li key={typing} className="debate-turn is-typing" data-provider={typing} aria-label={`${PROVIDER_LABELS[typing]}가 답하는 중`}>
                    <ProviderAvatar provider={typing} />
                    <div className="debate-body">
                        <b className="debate-who">{PROVIDER_LABELS[typing]}</b>
                        <div className="debate-line">
                            <div className="debate-bubble" aria-hidden="true">
                                <i></i>
                                <i></i>
                                <i></i>
                            </div>
                        </div>
                    </div>
                </li>
            ) : null}
        </>
    );
};

// 확인 기다림에서 보는 협의 기록: 엔진이 쓴 기록 파일을 채팅방처럼 합의안과 같은 크기로 보인다.
const DebateTranscript = ({ turns }) => {
    return (
        <div id="debate-log" className="debate-room">
            <ol className="debate-list">
                <DebateBubbles turns={turns} hasRounds />
            </ol>
        </div>
    );
};

// 실행 중 협의: 엔진의 [협의] 줄로 쌓인 대화를 보여 주고 다음 차례의 말풍선을 비워 둔다. 새 말이 오면 맨 아래로 내린다.
// 협의가 끝나면 마지막 대화를 사라지는 전환(Debate.css의 debate-out)이 끝날 때까지 남겨 둔다.
const DebateChat = () => {
    const debate = useRunStore((store) => store.state.debate);
    const [shown, setShown] = useState(null);
    const listRef = useRef(null);
    const turnCount = shown?.turnCount || 0;
    const isRunning = debate?.status === "running";
    const isLeaving = !isRunning && shown !== null;
    const hasChat = shown !== null;

    if (isRunning && shown !== debate) {
        setShown(debate);
    }

    useEffect(() => {
        if (!isLeaving) {
            return undefined;
        }

        const timer = setTimeout(() => setShown(null), LEAVE_MS);

        return () => clearTimeout(timer);
    }, [isLeaving]);

    // 화면이 숨겨진 채로 그려졌다가 보이거나 크기가 바뀌어도 맨 아래(가장 새 말)에 붙어 있게 한다.
    useLayoutEffect(() => {
        const list = listRef.current;

        if (!list) {
            return undefined;
        }

        const pinToEnd = () => {
            list.scrollTop = list.scrollHeight;
        };
        const observer = new ResizeObserver(pinToEnd);

        pinToEnd();
        observer.observe(list);
        // 더 보기 단추처럼 말풍선이 그려진 뒤에 높이가 바뀌는 경우도 따라간다
        [...list.children].forEach((child) => observer.observe(child));

        return () => observer.disconnect();
    }, [turnCount, hasChat]);

    if (!hasChat) {
        return null;
    }

    const nextProvider = shown.turns.at(-1)?.provider === "claude" ? "codex" : "claude";
    const typing = isLeaving ? "" : nextProvider;
    const exchange = Math.min(Math.floor(turnCount / 2) + 1, shown.maxTurns);

    return (
        <section id="debate-chat" className={cx("debate-chat", isLeaving && "is-leaving")} aria-label={`${shown.phaseLabel} 협의`}>
            <header className="debate-head">
                <div className="debate-members">
                    <b>{`${shown.phaseLabel} 협의`}</b>
                    {PARTICIPANTS.map((provider) => (
                        <span key={provider} className="debate-member" data-speaking={typing === provider}>
                            <ProviderAvatar provider={provider} size="sm" />
                        </span>
                    ))}
                </div>
                <span className="num">{`${exchange} / ${shown.maxTurns}번째 주고받기`}</span>
            </header>
            <ol ref={listRef} className="debate-list" aria-live="polite">
                <DebateBubbles turns={shown.turns} typing={typing} firstIndex={turnCount - shown.turns.length} />
            </ol>
        </section>
    );
};

export { DebateBubbles, DebateChat, DebateTranscript };

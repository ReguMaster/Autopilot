import { useLayoutEffect, useRef } from "react";
import { PROVIDER_LABELS } from "../../lib/constants.js";
import { useRunStore } from "../../stores/runStore.js";
import "./Debate.css";

// 두 AI가 주고받은 말. Claude는 왼쪽, Codex는 오른쪽 말풍선이다. notes는 협의 기록 파일에서 읽은 동의 · 반대 · 바꾼 점이다.
// typing을 주면 그쪽 차례의 빈 말풍선을 맨 아래에 둔다.
const DebateBubbles = ({ turns, typing = "" }) => {
    return (
        <>
            {turns.map((turn, index) => (
                <li key={index} className="debate-turn" data-provider={turn.provider}>
                    <b className="debate-who">{PROVIDER_LABELS[turn.provider]}</b>
                    <p className="debate-bubble">{turn.message}</p>
                    {turn.notes?.length ? (
                        <ul className="debate-notes">
                            {turn.notes.map((note, noteIndex) => (
                                <li key={noteIndex}>{note}</li>
                            ))}
                        </ul>
                    ) : null}
                </li>
            ))}
            {typing ? (
                <li className="debate-turn is-typing" data-provider={typing} aria-label={`${PROVIDER_LABELS[typing]}가 답하는 중`}>
                    <b className="debate-who">{PROVIDER_LABELS[typing]}</b>
                    <p className="debate-bubble" aria-hidden="true">
                        <i></i>
                        <i></i>
                        <i></i>
                    </p>
                </li>
            ) : null}
        </>
    );
};

// 실행 중 협의: 엔진의 [협의] 줄로 쌓인 대화를 보여 주고 다음 차례의 말풍선을 비워 둔다. 새 말이 오면 맨 아래로 내린다.
const DebateChat = () => {
    const debate = useRunStore((store) => store.state.debate);
    const listRef = useRef(null);
    const turnCount = debate?.turns.length || 0;
    const isRunning = debate?.status === "running";

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

        return () => observer.disconnect();
    }, [turnCount, isRunning]);

    if (!isRunning) {
        return null;
    }

    const typing = debate.turns.at(-1)?.provider === "claude" ? "codex" : "claude";
    const exchange = Math.min(Math.floor(turnCount / 2) + 1, debate.maxTurns);

    return (
        <section id="debate-chat" className="debate-chat" aria-label={`${debate.phaseLabel} 협의`}>
            <header className="debate-head">
                <b>{`${debate.phaseLabel} 협의`}</b>
                <span className="num">{`${exchange} / ${debate.maxTurns}번째 주고받기`}</span>
            </header>
            <ol ref={listRef} className="debate-list" aria-live="polite">
                <DebateBubbles turns={debate.turns} typing={typing} />
            </ol>
        </section>
    );
};

export { DebateBubbles, DebateChat };

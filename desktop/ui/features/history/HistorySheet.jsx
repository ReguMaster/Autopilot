import { memo, useLayoutEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { formatOptions, formatRoundTime, getRoundTone } from "../../../viewFormat.js";
import { Button } from "../../components/Button.jsx";
import { Tag } from "../../components/Tag.jsx";
import { clearLogs, useRunStore } from "../../stores/runStore.js";
import { ui, useUiStore } from "../../stores/uiStore.js";

const FOLLOW_THRESHOLD_PX = 24;

const LogLine = memo(({ line }) => {
    return (
        <div className="line" data-kind={line.kind}>
            <span className="ln">{line.id}</span>
            <span className="tx">{line.text}</span>
        </div>
    );
});

// 로그 줄은 열려 있는 동안에만 그린다. 줄은 늘어나기만 하고 바뀌지 않으므로(최대 3000줄) 새 줄만 DOM에 더해진다.
const LogList = ({ follow, onScrollEnd }) => {
    const logs = useRunStore((store) => store.logs);
    const ref = useRef(null);

    useLayoutEffect(() => {
        if (follow) {
            ref.current.scrollTop = ref.current.scrollHeight;
        }
    }, [logs, follow]);

    const handleScroll = () => {
        const { scrollHeight, scrollTop, clientHeight } = ref.current;

        onScrollEnd(scrollHeight - scrollTop - clientHeight < FOLLOW_THRESHOLD_PX);
    };

    return (
        <div id="log" ref={ref} className="log" role="log" aria-live="off" tabIndex={0} onScroll={handleScroll}>
            {logs.length === 0 ? (
                <div className="line empty" id="log-empty">
                    <span className="ln">1</span>
                    <span className="tx">아직 기록된 로그가 없어요.</span>
                </div>
            ) : (
                <>
                    <div className="line empty" id="log-empty" hidden>
                        <span className="ln">1</span>
                        <span className="tx">아직 기록된 로그가 없어요.</span>
                    </div>
                    {logs.map((line) => (
                        <LogLine key={line.id} line={line} />
                    ))}
                </>
            )}
        </div>
    );
};

const RoundItem = ({ round }) => {
    return (
        <li className="round">
            <span className="round-no num">{round.round}</span>
            <div className="round-body">
                <span className="num">{formatRoundTime(round)}</span>
                <small>{formatOptions(round.model, round.effort)}</small>
            </div>
            <Tag tone={getRoundTone(round.outcome)}>{round.outcome || "진행 중"}</Tag>
        </li>
    );
};

const Rounds = () => {
    const { rounds, policy } = useRunStore(useShallow((store) => ({ rounds: store.state.rounds, policy: store.state.policy })));
    const lastRound = rounds[rounds.length - 1];
    const finishedCount = rounds.filter((round) => round.outcome === "완료").length;
    const policyText = policy ? `, 정책 ${policy.replace(/ \(.+\)$/, "")}` : "";

    return (
        <div className="history-rounds">
            <div className="history-head">
                <h2>회차</h2>
                <span id="round-count" className="num">{`${rounds.length}회`}</span>
            </div>
            <p id="round-summary" className="round-summary">
                {lastRound ? `완료 ${finishedCount}회, 최근 결과 ${lastRound.outcome || "진행 중"}${policyText}` : "아직 시작한 회차가 없어요."}
            </p>
            <ol id="rounds" className="rounds">
                {[...rounds].reverse().map((round) => (
                    <RoundItem key={round.round} round={round} />
                ))}
            </ol>
        </div>
    );
};

// 전체 기록은 아래에서 올라오는 흰 시트다. 로그와 회차를 나란히 둔다.
const HistorySheet = () => {
    const open = useUiStore((store) => store.history);
    const lineCount = useRunStore((store) => store.logs.length);
    const [follow, setFollow] = useState(true);

    return (
        <section id="history" className="history" aria-label="실행 기록" inert={!open}>
            <div className="history-log">
                <div className="history-head">
                    <h2>로그</h2>
                    <span id="log-count" className="num">{`${lineCount}줄`}</span>
                    <label className="check">
                        <input type="checkbox" id="follow" checked={follow} onChange={(event) => setFollow(event.target.checked)} />
                        따라가기
                    </label>
                    <Button id="clear-log" onClick={clearLogs}>
                        지우기
                    </Button>
                    <Button id="history-close" onClick={() => ui.setHistory(false)}>
                        닫기
                    </Button>
                </div>
                {open ? <LogList follow={follow} onScrollEnd={setFollow} /> : <div id="log" className="log" role="log" aria-live="off" tabIndex={0}></div>}
            </div>
            <Rounds />
        </section>
    );
};

export { HistorySheet };

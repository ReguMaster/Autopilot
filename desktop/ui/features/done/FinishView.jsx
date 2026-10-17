import { useShallow } from "zustand/react/shallow";
import { describeFinish } from "../../../viewFormat.js";
import { openReport, saveShareCard } from "../../actions/run.js";
import { Button } from "../../components/Button.jsx";
import { Gains } from "../../components/Gains.jsx";
import { Icon } from "../../components/Icon.jsx";
import { useView } from "../../hooks/useView.js";
import { useRunStore } from "../../stores/runStore.js";
import { ui, useUiStore } from "../../stores/uiStore.js";

const FINISH_GAIN_LIMIT = 3;
const FINISH_ROUND_LIMIT = 6;

const sum = (commits, field) => commits.reduce((total, commit) => total + commit[field], 0);

const FinishRound = ({ round }) => {
    const hasCommits = round.commits.length > 0;

    return (
        <li>
            <b>{`${round.round}회차`}</b>
            <span>
                {hasCommits ? (
                    <>
                        {`커밋 ${round.commits.length}개`}
                        <code>{round.commits.map((commit) => commit.hash).join(" ")}</code>
                    </>
                ) : (
                    round.outcome || "진행 중"
                )}
            </span>
            <span>
                {hasCommits ? (
                    <>
                        <ins>{`+${sum(round.commits, "insertions")}`}</ins>
                        <del>{`−${sum(round.commits, "deletions")}`}</del>
                    </>
                ) : null}
            </span>
        </li>
    );
};

const FinishBody = () => {
    const state = useRunStore(useShallow((store) => store.state));
    const isHistoryOpen = useUiStore((store) => store.history);
    const finish = describeFinish(state);

    return (
        <>
            <button type="button" id="back-to-ready" className="finish-back" onClick={() => ui.set({ finishDismissed: true })}>
                <Icon symbol="icon-back" />
                처음으로
            </button>
            <h1 id="finish-title">{finish.title}</h1>
            <p id="finish-lead" className="lead">
                {finish.lead}
            </p>
            <Gains id="finish-gains" aria-label="이번 실행의 성과" hidden={!state.gains.length} gains={state.gains.slice(-FINISH_GAIN_LIMIT).reverse()} />
            <ol id="finish-rounds" className="finish-rounds" aria-label="회차별 결과">
                {state.rounds.slice(-FINISH_ROUND_LIMIT).map((round) => (
                    <FinishRound key={round.round} round={round} />
                ))}
            </ol>
            <div className="finish-links">
                <Button id="done-report" onClick={openReport}>
                    <Icon symbol="icon-out" />
                    리포트 열기
                </Button>
                <Button id="done-card" onClick={saveShareCard}>
                    카드 저장
                </Button>
                <Button id="done-history" onClick={() => ui.setHistory(!isHistoryOpen)}>
                    <Icon symbol="icon-lines" />
                    전체 기록
                </Button>
            </div>
        </>
    );
};

// 실행을 마친 뒤의 정리. 마친 화면일 때만 내용을 계산해 그린다.
const FinishView = () => {
    const view = useView();

    return (
        <section className="finish view-done" aria-label="실행을 마치고">
            {view === "done" ? <FinishBody /> : null}
        </section>
    );
};

export { FinishView };

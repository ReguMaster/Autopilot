import { useShallow } from "zustand/react/shallow";
import { openPhaseDoc } from "../../actions/run.js";
import { Icon } from "../../components/Icon.jsx";
import { getPhaseDocs } from "../../lib/buildSteps.js";
import { useComposerStore } from "../../stores/composerStore.js";
import { useRunStore } from "../../stores/runStore.js";
import { useRunsStore } from "../../stores/runsStore.js";
import { Work } from "./Work.jsx";

const CARD_ROUND_LIMIT = 4;
const CARD_COMMIT_LIMIT = 4;

const PhaseDocs = ({ step }) => {
    const buildPhase = useRunsStore((store) => store.buildPhase);
    const { gates, designFormat } = useComposerStore(useShallow((store) => ({ gates: store.gates, designFormat: store.designFormat })));
    const docs = getPhaseDocs({ step: step, buildPhase: buildPhase, gates: gates, designFormat: designFormat });

    return (
        <section className="card-section" aria-label="단계 문서">
            <h3>단계 문서</h3>
            <ul className="card-docs">
                {docs.map((doc) => (
                    <li key={doc.phase}>
                        <button type="button" className="card-doc" title={`${doc.path} 열기`} onClick={() => openPhaseDoc(doc.phase)}>
                            <Icon symbol="icon-lines" />
                            <code>{doc.path}</code>
                            <span data-note={doc.note === "쓰는 중" ? "writing" : "done"}>{doc.note}</span>
                        </button>
                    </li>
                ))}
            </ul>
        </section>
    );
};

const RoundList = ({ rounds }) => {
    return (
        <section className="card-section" aria-label="회차">
            <h3>회차</h3>
            <ul className="card-rounds">
                {rounds.slice(-CARD_ROUND_LIMIT).map((round) => (
                    <li key={round.round} data-live={round.outcome ? undefined : ""}>
                        <b>{`${round.round}회차`}</b>
                        <span>{round.outcome ? `${round.outcome}${round.commits?.length ? `, 커밋 ${round.commits.length}개` : ""}` : "진행 중"}</span>
                    </li>
                ))}
            </ul>
        </section>
    );
};

const CommitList = ({ rounds }) => {
    const commits = rounds
        .flatMap((round) => round.commits || [])
        .slice(-CARD_COMMIT_LIMIT)
        .reverse();

    return (
        <section className="card-section" aria-label="남긴 커밋">
            <h3>남긴 커밋</h3>
            {commits.length ? (
                <ul className="card-commits">
                    {commits.map((commit) => (
                        <li key={commit.hash}>
                            <code>{commit.hash}</code>
                            <span title={commit.subject}>{commit.subject}</span>
                            <em>
                                <ins>{`+${commit.insertions}`}</ins> <del>{`−${commit.deletions}`}</del>
                            </em>
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="card-empty">아직 남긴 커밋이 없어요</p>
            )}
        </section>
    );
};

// 실행 중 오른쪽 카드: 신규 개발은 단계 문서, 유지 보수는 회차 목록, 그 아래에 남긴 커밋과 한 일의 숫자를 둔다.
const RunCard = () => {
    const { mode, rounds, step } = useRunStore(useShallow((store) => ({ mode: store.state.mode, rounds: store.state.rounds, step: store.state.step })));

    return (
        <aside id="run-card" className="run-card" aria-label="이번 실행">
            {mode === "build" ? <PhaseDocs step={step} /> : <RoundList rounds={rounds} />}
            <CommitList rounds={rounds} />
            <Work />
        </aside>
    );
};

export { RunCard };

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

const BRAINSTORM_NOTES = { receiving: "받는 중", received: "받음", skipped: "건너뜀" };

// 다른 AI(지금은 Codex)의 안 · 검토를 받는 상태. 엔진 로그의 마지막 브레인스토밍 줄을 따른다.
const BrainstormState = ({ brainstorm }) => {
    const isBlocked = brainstorm.status === "blocked";

    return (
        <section className="card-section" aria-label="다른 AI">
            <h3>다른 AI</h3>
            <p id="card-ai" className="card-ai" data-status={brainstorm.status} title={brainstorm.reason || undefined}>
                <b>{isBlocked ? "보내기가 꺼져 있어 Claude만 써요" : `${brainstorm.provider} ${brainstorm.phaseLabel} ${brainstorm.kind === "review" ? "검토" : "안"}`}</b>
                {isBlocked ? null : <span>{BRAINSTORM_NOTES[brainstorm.status]}</span>}
            </p>
            {brainstorm.status === "skipped" && brainstorm.reason ? <p className="card-empty">{brainstorm.reason}</p> : null}
            {brainstorm.status === "receiving" && brainstorm.limitMinutes ? (
                <p id="card-ai-progress" className="card-empty">
                    {`${brainstorm.elapsedMinutes}분째 (최대 ${brainstorm.limitMinutes}분)${brainstorm.activity ? ` · ${brainstorm.activity}` : ""}`}
                </p>
            ) : null}
        </section>
    );
};

// 실행 중 오른쪽 카드: 신규 개발은 단계 문서, 유지 보수는 회차 목록, 그 아래에 남긴 커밋과 한 일의 숫자를 둔다.
const RunCard = () => {
    const { mode, rounds, step, brainstorm } = useRunStore(useShallow((store) => ({ mode: store.state.mode, rounds: store.state.rounds, step: store.state.step, brainstorm: store.state.brainstorm })));

    return (
        <aside id="run-card" className="run-card" aria-label="이번 실행">
            {mode === "build" ? <PhaseDocs step={step} /> : <RoundList rounds={rounds} />}
            {mode === "build" && brainstorm ? <BrainstormState brainstorm={brainstorm} /> : null}
            <CommitList rounds={rounds} />
            <Work />
        </aside>
    );
};

export { RunCard };

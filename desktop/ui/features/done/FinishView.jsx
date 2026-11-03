import { useShallow } from "zustand/react/shallow";
import { describeFinish, getPastStatus, getRunPhase } from "../../../viewFormat.js";
import { openPhaseDoc, openReport, saveShareCard } from "../../actions/run.js";
import { Button } from "../../components/Button.jsx";
import { Gains } from "../../components/Gains.jsx";
import { HeadTag } from "../../components/HeadTag.jsx";
import { Icon } from "../../components/Icon.jsx";
import { useApproval } from "../../hooks/useApproval.js";
import { useView } from "../../hooks/useView.js";
import { getRunSteps } from "../../lib/buildSteps.js";
import { composer, useComposerStore } from "../../stores/composerStore.js";
import { useRunStore } from "../../stores/runStore.js";
import { useRunsStore } from "../../stores/runsStore.js";
import { ui, useUiStore } from "../../stores/uiStore.js";
import { ApprovalView } from "../approval/ApprovalView.jsx";
import { Course } from "../shell/Course.jsx";
import { ProjectHead } from "../shell/ProjectHead.jsx";
import { StepCard } from "../steps/StepCard.jsx";

const FINISH_GAIN_LIMIT = 3;
const FINISH_ROUND_LIMIT = 6;
const TAG_ICONS = { ok: "icon-check", warn: "icon-pause", danger: "icon-x" };
// 단계 실패로 멈췄을 때 열어 볼 그 단계의 기록
const FAILED_DOCS = { "테스트/QA 실패": { phase: "qa", name: "qa.md" }, "보안검토 실패": { phase: "security", name: "security.md" } };

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

// 신규 개발을 모두 마쳤으면 유지 보수로 넘어가 다듬기를 권하고, 테스트/QA·보안검토 실패로 멈췄으면 그 기록(qa.md·security.md)을 열게 한다(다시 하기는 주 버튼이 맡는다).
const BuildNext = ({ reason }) => {
    if (/모든 단계 완료$/.test(reason)) {
        return (
            <Button
                id="done-to-maintain"
                variant="primary"
                onClick={() => {
                    composer.setMode("maintain");
                    ui.set({ finishDismissed: true });
                }}
            >
                유지 보수로 이어 다듬기
            </Button>
        );
    }

    const failedDoc = FAILED_DOCS[reason];

    if (failedDoc) {
        return (
            <Button id={`done-open-${failedDoc.phase}`} onClick={() => openPhaseDoc(failedDoc.phase)}>
                <Icon symbol="icon-out" />
                {`${failedDoc.name} 열기`}
            </Button>
        );
    }

    return null;
};

const FinishSteps = ({ state }) => {
    const buildPhase = useRunsStore((store) => store.buildPhase);
    const { gates, skip, qaOnFail, securityOnFail } = useComposerStore(
        useShallow((store) => ({ gates: store.gates, skip: store.skip, qaOnFail: store.qaOnFail, securityOnFail: store.securityOnFail }))
    );

    return (
        <StepCard
            id="finish-steps"
            cells={getRunSteps({ step: state.step, buildPhase: buildPhase, gates: gates, skip: skip, qaOnFail: qaOnFail, securityOnFail: securityOnFail, round: state.round })}
        />
    );
};

const FinishBody = () => {
    const state = useRunStore(useShallow((store) => store.state));
    const isHistoryOpen = useUiStore((store) => store.history);
    const finish = describeFinish(state);
    const tag = state.reason ? getPastStatus({ reason: state.reason }) : getRunPhase(state);
    const isBuild = state.mode === "build";

    return (
        <>
            <ProjectHead>
                <HeadTag id="finish-tag" tone={tag.tone} icon={TAG_ICONS[tag.tone]}>
                    {tag.label}
                </HeadTag>
            </ProjectHead>
            {isBuild ? <FinishSteps state={state} /> : null}
            <Course />
            <div className="finish-grid">
                <div className="finish-main">
                    <button type="button" id="back-to-ready" className="finish-back" onClick={() => ui.set({ finishDismissed: true })}>
                        <Icon symbol="icon-back" />
                        처음으로
                    </button>
                    <h1 id="finish-title">{finish.title}</h1>
                    <p id="finish-lead" className="lead">
                        {finish.lead}
                    </p>
                    <Gains id="finish-gains" aria-label="이번 실행의 성과" hidden={!state.gains.length} gains={state.gains.slice(-FINISH_GAIN_LIMIT).reverse()} />
                    <div className="finish-links">
                        {isBuild ? <BuildNext reason={state.reason} /> : null}
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
                </div>
                <aside className="finish-card" aria-label="회차별 결과">
                    <h3>회차별 커밋</h3>
                    <ol id="finish-rounds" className="finish-rounds">
                        {state.rounds.slice(-FINISH_ROUND_LIMIT).map((round) => (
                            <FinishRound key={round.round} round={round} />
                        ))}
                    </ol>
                </aside>
            </div>
        </>
    );
};

// 실행을 마친 뒤의 정리. 마친 화면일 때만 내용을 계산해 그린다.
// 확인받기 단계에서 멈춘 실행이면 정리 대신 산출물을 확인하는 화면을 보여준다.
const FinishView = () => {
    const view = useView();
    const approval = useApproval();
    let body = null;

    if (view === "done") {
        body = approval ? <ApprovalView phase={approval} /> : <FinishBody />;
    }

    return (
        <section className={approval ? "finish view-done approval" : "finish view-done"} aria-label="실행을 마치고">
            {body}
        </section>
    );
};

export { FinishView };

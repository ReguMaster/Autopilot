import { useState } from "react";
import { formatMinutesSpan, getWorkSummary } from "../../../viewFormat.js";
import { approveAndStart, openPhaseDoc, revisePhase } from "../../actions/run.js";
import { Button } from "../../components/Button.jsx";
import { HeadTag } from "../../components/HeadTag.jsx";
import { Icon } from "../../components/Icon.jsx";
import { getReadySteps } from "../../lib/buildSteps.js";
import { PHASE_LABELS } from "../../lib/constants.js";
import { useAppStore } from "../../stores/appStore.js";
import { useRunStore } from "../../stores/runStore.js";
import { useRunsStore } from "../../stores/runsStore.js";
import { useUiStore } from "../../stores/uiStore.js";
import { ProjectHead } from "../shell/ProjectHead.jsx";
import { StepCard } from "../steps/StepCard.jsx";
import { DebateReview } from "./DebateReview.jsx";
import { DocPreview } from "./DocPreview.jsx";
import { ProposalCompare } from "./ProposalCompare.jsx";
import { usePhaseDoc } from "./usePhaseDoc.js";

const NEXT_PHASES = { plan: "design", design: "build" };
const LEADS = {
    plan: { title: "기획서가 준비됐어요.", lead: "읽어 보시고 괜찮으면 디자인을 시작할게요. 고칠 점을 적어 주시면 기획을 다시 해 둘게요.", docName: "기획서" },
    design: { title: "디자인이 준비됐어요.", lead: "살펴보시고 괜찮으면 개발을 시작할게요. 고칠 점을 적어 주시면 디자인을 다시 해 둘게요.", docName: "디자인" }
};
// 여러 AI가 따로 안을 낸 단계. 합치지 않고 나란히 보여주고 사용자가 고른다.
const COMPARE_LEADS = {
    plan: { title: "기획안이 두 개 준비됐어요.", lead: "Claude와 Codex가 따로 쓴 안이에요. 하나를 골라 주세요." },
    design: { title: "디자인 안이 두 개 준비됐어요.", lead: "Claude와 Codex가 따로 그린 안이에요. 하나를 골라 주세요." }
};

// Claude와 Codex가 협의한 단계. 합의안을 보여 주고 못 맞춘 쟁점만 고른다.
const DEBATE_LEADS = {
    plan: { title: "협의한 기획안이 준비됐어요." },
    design: { title: "협의한 디자인이 준비됐어요." }
};

const getDebateLead = (debate) => {
    return debate.disputes.length ? "Claude와 Codex가 주고받아 합의안을 만들었어요. 끝까지 못 맞춘 쟁점만 골라 주세요." : "Claude와 Codex가 주고받아 합의했어요. 합의안을 확인해 주세요.";
};

// 방금 이 단계에서 멈춘 실행이면 몇 회차·얼마나 걸렸는지와 커밋 수를 알린다. 커밋은 작업 브랜치에 있다.
const getMeta = (state, phase, workBranch) => {
    const label = PHASE_LABELS[phase];

    if (state.reason !== `${label} 확인 대기` || !state.startedAt || !state.endedAt) {
        return [`산출물 커밋은 ${workBranch} 브랜치에 있어요.`];
    }

    const minutes = Math.max(1, Math.round((state.endedAt - state.startedAt) / 60000));
    const commits = getWorkSummary(state).commits;

    return [`${label}에 ${state.rounds.length}회차, ${formatMinutesSpan(minutes)}이 걸렸어요.`, commits ? `커밋 ${commits}개는 ${workBranch} 브랜치에 있어요.` : "이번에는 커밋을 남기지 않았어요."];
};

const getLeadText = (phase, proposals, debate) => {
    if (debate) {
        return { ...LEADS[phase], ...DEBATE_LEADS[phase], lead: getDebateLead(debate) };
    }

    return proposals ? { ...LEADS[phase], ...COMPARE_LEADS[phase] } : LEADS[phase];
};

// 확인 기다림: 확인받기로 둔 단계(기획·디자인)가 끝나 멈춘 뒤 산출물을 보여주고, 확인하고 다음 단계를 시작하거나 고칠 점과 함께 그 단계를 다시 한다.
const ApprovalView = ({ phase, side = null }) => {
    const buildPhase = useRunsStore((store) => store.buildPhase);
    const workBranch = useAppStore((store) => store.settings.workBranch);
    const runState = useRunStore((store) => store.state);
    const isStarting = useUiStore((store) => store.isStarting);
    const doc = usePhaseDoc(phase);
    const [feedback, setFeedback] = useState("");
    const label = PHASE_LABELS[phase];
    const proposals = buildPhase?.proposals?.phase === phase && !buildPhase.proposals.picked ? buildPhase.proposals : null;
    const debate = buildPhase?.debate?.phase === phase && !buildPhase.debate.resolved ? buildPhase.debate : null;
    const text = getLeadText(phase, proposals, debate);
    const feedbackArea = (
        <>
            <label className="approval-feedback">
                <span>{proposals ? "고칠 점" : "고칠 점이 있으면"}</span>
                <textarea
                    id="approval-feedback"
                    rows={proposals ? 2 : 4}
                    spellCheck={false}
                    placeholder={phase === "plan" ? "예: 원장 화면에 주간 보기도 넣어 주세요" : "예: 예약 확인 화면을 한 장으로 줄여 주세요"}
                    value={feedback}
                    onChange={(event) => setFeedback(event.target.value)}
                ></textarea>
            </label>
            <Button id="approval-revise" size="" disabled={isStarting || !feedback.trim()} onClick={() => revisePhase(feedback)}>
                {`이 내용으로 ${label} 다시 하기`}
            </Button>
        </>
    );

    return (
        <>
            <ProjectHead>
                <div className="head-side">
                    <HeadTag id="approval-tag" tone="warn" icon="icon-pause">
                        {`${label} 확인 기다림`}
                    </HeadTag>
                    {side}
                </div>
            </ProjectHead>
            <StepCard id="approval-steps" cells={getReadySteps(buildPhase)} />
            <div className="approval-lead">
                <h1 id="approval-title">{text.title}</h1>
                <p className="lead">{text.lead}</p>
            </div>
            {debate ? (
                <DebateReview phase={phase} debate={debate} nextPhase={NEXT_PHASES[phase]} doc={doc} docName={text.docName} isStarting={isStarting} feedbackArea={feedbackArea} />
            ) : proposals ? (
                <>
                    <ProposalCompare phase={phase} proposals={proposals} nextPhase={NEXT_PHASES[phase]} isStarting={isStarting} />
                    <details className="approval-revise">
                        <summary>둘 다 아쉬우면 고칠 점을 적어 주세요</summary>
                        <div className="approval-revise-row">{feedbackArea}</div>
                    </details>
                </>
            ) : (
                <div className="approval-grid">
                    <DocPreview doc={doc.data} isLoading={doc.isLoading} />
                    <div className="approval-card">
                        <Button id="approval-approve" variant="primary" size="" disabled={isStarting} onClick={() => approveAndStart()}>
                            {`확인하고 ${PHASE_LABELS[NEXT_PHASES[phase]]} 시작`}
                        </Button>
                        <Button id="approval-open" size="" disabled={!doc.data} onClick={() => openPhaseDoc(phase)}>
                            <Icon symbol="icon-out" />
                            {`${text.docName} 전체 열기`}
                        </Button>
                        {feedbackArea}
                        <p className="approval-meta">
                            {getMeta(runState, phase, workBranch).map((line) => (
                                <span key={line}>{line}</span>
                            ))}
                        </p>
                    </div>
                </div>
            )}
        </>
    );
};

export { ApprovalView };

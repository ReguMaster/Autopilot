import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { formatMinutesSpan, getWorkSummary } from "../../../viewFormat.js";
import { approveAndStart, openPhaseDoc, readPhaseDoc, revisePhase } from "../../actions/run.js";
import { Button } from "../../components/Button.jsx";
import { HeadTag } from "../../components/HeadTag.jsx";
import { Icon } from "../../components/Icon.jsx";
import { getReadySteps } from "../../lib/buildSteps.js";
import { PHASE_LABELS, STATUS_OK } from "../../lib/constants.js";
import { useAppStore } from "../../stores/appStore.js";
import { useRunStore } from "../../stores/runStore.js";
import { useRunsStore } from "../../stores/runsStore.js";
import { useUiStore } from "../../stores/uiStore.js";
import { ProjectHead } from "../shell/ProjectHead.jsx";
import { StepCard } from "../steps/StepCard.jsx";
import { DocPreview } from "./DocPreview.jsx";

const NEXT_PHASES = { plan: "design", design: "build" };
const LEADS = {
    plan: { title: "기획서가 준비됐어요.", lead: "읽어 보시고 괜찮으면 디자인을 시작할게요. 고칠 점을 적어 주시면 기획을 다시 해 둘게요.", docName: "기획서" },
    design: { title: "디자인이 준비됐어요.", lead: "살펴보시고 괜찮으면 개발을 시작할게요. 고칠 점을 적어 주시면 디자인을 다시 해 둘게요.", docName: "디자인" }
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

// 확인 기다림: 확인받기로 둔 단계(기획·디자인)가 끝나 멈춘 뒤 산출물을 보여주고, 확인하고 다음 단계를 시작하거나 고칠 점과 함께 그 단계를 다시 한다.
const ApprovalView = ({ phase, side = null }) => {
    const buildPhase = useRunsStore((store) => store.buildPhase);
    const { projectDir, workBranch } = useAppStore(useShallow((store) => ({ projectDir: store.settings.projectDir, workBranch: store.settings.workBranch })));
    const runState = useRunStore((store) => store.state);
    const isStarting = useUiStore((store) => store.isStarting);
    const [doc, setDoc] = useState({ isLoading: true, data: null });
    const [feedback, setFeedback] = useState("");
    const label = PHASE_LABELS[phase];
    const text = LEADS[phase];

    useEffect(() => {
        let isCurrent = true;

        setDoc({ isLoading: true, data: null });
        readPhaseDoc(phase).then((result) => {
            if (isCurrent) {
                setDoc({ isLoading: false, data: result.status === STATUS_OK ? result.data : null });
            }
        });

        return () => {
            isCurrent = false;
        };
    }, [phase, projectDir]);

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
            <div className="approval-grid">
                <DocPreview doc={doc.data} isLoading={doc.isLoading} />
                <div className="approval-card">
                    <Button id="approval-approve" variant="primary" size="" disabled={isStarting} onClick={approveAndStart}>
                        {`확인하고 ${PHASE_LABELS[NEXT_PHASES[phase]]} 시작`}
                    </Button>
                    <Button id="approval-open" size="" disabled={!doc.data} onClick={() => openPhaseDoc(phase)}>
                        <Icon symbol="icon-out" />
                        {`${text.docName} 전체 열기`}
                    </Button>
                    <label className="approval-feedback">
                        <span>고칠 점이 있으면</span>
                        <textarea
                            id="approval-feedback"
                            rows={4}
                            spellCheck={false}
                            placeholder={phase === "plan" ? "예: 원장 화면에 주간 보기도 넣어 주세요" : "예: 예약 확인 화면을 한 장으로 줄여 주세요"}
                            value={feedback}
                            onChange={(event) => setFeedback(event.target.value)}
                        ></textarea>
                    </label>
                    <Button id="approval-revise" size="" disabled={isStarting || !feedback.trim()} onClick={() => revisePhase(feedback)}>
                        {`이 내용으로 ${label} 다시 하기`}
                    </Button>
                    <p className="approval-meta">
                        {getMeta(runState, phase, workBranch).map((line) => (
                            <span key={line}>{line}</span>
                        ))}
                    </p>
                </div>
            </div>
        </>
    );
};

export { ApprovalView };

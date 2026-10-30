import { approveAndStart, openPhaseDoc } from "../../actions/run.js";
import { Button } from "../../components/Button.jsx";
import { Icon } from "../../components/Icon.jsx";
import { PHASE_LABELS, PROVIDER_LABELS } from "../../lib/constants.js";
import { DocPreview } from "./DocPreview.jsx";
import { usePhaseDoc } from "./usePhaseDoc.js";

// 안의 문서 키. Claude 안은 단계 산출물 그 자체이고 다른 AI의 안은 proposals/<단계>-<제공자>.*다(메인의 projectFiles.PHASE_DOCS).
const getDocKey = (phase, provider) => {
    return provider === "claude" ? phase : `${phase}-${provider}`;
};

// 이 안을 검토한 쪽. 두 안일 때 상대가 검토자다.
const getReviewer = (candidates, provider) => {
    return candidates.find((candidate) => candidate !== provider);
};

const Proposal = ({ phase, provider, candidates, nextLabel, isStarting }) => {
    const docKey = getDocKey(phase, provider);
    const reviewer = getReviewer(candidates, provider);
    const doc = usePhaseDoc(docKey);
    const review = usePhaseDoc(`${phase}-review-${reviewer}`);

    return (
        <section className="proposal" data-provider={provider} aria-label={`${PROVIDER_LABELS[provider]} 안`}>
            <header className="proposal-head">
                <b>{`${PROVIDER_LABELS[provider]} 안`}</b>
                <button type="button" className="proposal-open" disabled={!doc.data} title="전체 열기" onClick={() => openPhaseDoc(docKey)}>
                    <Icon symbol="icon-out" />
                    열기
                </button>
                <Button id={`approval-pick-${provider}`} variant="primary" disabled={isStarting || !doc.data} onClick={() => approveAndStart(provider)}>
                    {`이 안으로 ${nextLabel} 시작`}
                </Button>
            </header>
            <DocPreview doc={doc.data} isLoading={doc.isLoading} />
            {review.data ? (
                <details className="proposal-review">
                    <summary>{`${PROVIDER_LABELS[reviewer]}의 검토`}</summary>
                    <DocPreview doc={review.data} />
                </details>
            ) : null}
        </section>
    );
};

// 여러 AI가 따로 낸 안을 합치지 않고 나란히 보여주고, 사용자가 고른 안으로 다음 단계를 시작한다.
const ProposalCompare = ({ phase, proposals, nextPhase, isStarting }) => {
    return (
        <div className="approval-compare">
            {proposals.candidates.map((provider) => (
                <Proposal key={provider} phase={phase} provider={provider} candidates={proposals.candidates} nextLabel={PHASE_LABELS[nextPhase]} isStarting={isStarting} />
            ))}
        </div>
    );
};

export { ProposalCompare };

import { useState } from "react";
import { parseDebateTranscript } from "../../../viewFormat.js";
import { approveAndStart, openPhaseDoc } from "../../actions/run.js";
import { Button } from "../../components/Button.jsx";
import { Icon } from "../../components/Icon.jsx";
import { Seg } from "../../components/Seg.jsx";
import { PHASE_LABELS, PROVIDER_LABELS } from "../../lib/constants.js";
import { DebateTranscript } from "../debate/DebateChat.jsx";
import { PhasePreview } from "./DocPreview.jsx";
import { usePhaseDoc } from "./usePhaseDoc.js";

const SIDES = ["claude", "codex"];

// 쟁점 하나: 두 입장 중 하나를 고른다(라디오라 화살표 키로도 바꾼다).
const Dispute = ({ dispute, chosen, onChoose }) => {
    return (
        <fieldset className="dispute" data-dispute={dispute.id}>
            <legend>{dispute.title}</legend>
            {SIDES.map((side) => (
                <label key={side} className="dispute-option" data-provider={side}>
                    <input type="radio" name={`dispute-${dispute.id}`} checked={chosen === side} onChange={() => onChoose(dispute.id, side)} />
                    <b>{`${PROVIDER_LABELS[side]} 쪽`}</b>
                    <span>{dispute[side]}</span>
                </label>
            ))}
        </fieldset>
    );
};

// 협의한 단계의 확인: 합의안(단계 산출물)과 협의 기록을 보여 주고, 못 맞춘 쟁점만 쟁점마다 한쪽을 골라 다음 단계를 시작한다.
const DebateReview = ({ phase, debate, nextPhase, doc, docName, isStarting, skipSuggest, feedbackArea }) => {
    const transcript = usePhaseDoc(`${phase}-debate`);
    const [choices, setChoices] = useState({});
    const [tab, setTab] = useState("plan");
    const turns = parseDebateTranscript(transcript.data?.text);
    const isReady = debate.disputes.every((dispute) => choices[dispute.id]);

    return (
        <div className="approval-grid approval-debate">
            <div className="debate-main">
                {turns.length ? (
                    <Seg
                        name="debate-tab"
                        label="볼 내용"
                        className="mode-seg debate-tabs"
                        options={[
                            { value: "plan", label: docName },
                            { value: "log", label: `협의 기록 ${turns.length}마디` }
                        ]}
                        value={tab}
                        onChange={setTab}
                    />
                ) : null}
                {tab === "log" && turns.length ? <DebateTranscript turns={turns} /> : <PhasePreview docKey={phase} doc={doc} />}
            </div>
            <div className="approval-card">
                <h2 id="dispute-title" className="dispute-title">
                    {debate.disputes.length ? `못 맞춘 쟁점 ${debate.disputes.length}개` : "쟁점 없이 합의했어요"}
                </h2>
                {skipSuggest}
                {/* 쟁점이 길어도 보이도록 시작 버튼을 쟁점보다 위에 둔다. 모두 고르기 전에는 몇 개 골랐는지 알린다 */}
                <div className="debate-go">
                    <Button id="approval-approve" variant="primary" size="" disabled={isStarting || !isReady} onClick={() => approveAndStart(undefined, debate.disputes.length ? choices : undefined)}>
                        {`이대로 ${PHASE_LABELS[nextPhase]} 시작`}
                    </Button>
                    {isReady ? null : <p className="debate-go-hint">{`쟁점마다 한쪽을 골라 주세요 (${Object.keys(choices).length}/${debate.disputes.length})`}</p>}
                </div>
                {debate.disputes.map((dispute) => (
                    <Dispute key={dispute.id} dispute={dispute} chosen={choices[dispute.id]} onChoose={(id, side) => setChoices((current) => ({ ...current, [id]: side }))} />
                ))}
                <Button id="approval-open" size="" disabled={!doc.data} onClick={() => openPhaseDoc(phase)}>
                    <Icon symbol="icon-out" />
                    {`${docName} 전체 열기`}
                </Button>
                {feedbackArea}
            </div>
        </div>
    );
};

export { DebateReview };

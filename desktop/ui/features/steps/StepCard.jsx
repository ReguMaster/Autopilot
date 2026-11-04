import { Fragment, useState } from "react";
import { Collapse } from "../../components/Collapse.jsx";
import { Icon } from "../../components/Icon.jsx";
import { PHASE_LABELS } from "../../lib/constants.js";
import "./StepCard.css";

const CHANGED_TITLE = "기본값에서 바꿨어요";

// 단계 설정 한 줄. 접히면 요약 한 줄이고, 펼치면 그 자리에 설정 문장이 선다. 고른 값을 한눈에 훑고, 바꿀 단계만 펼쳐 고친다.
const StepGroup = ({ id, phase, name, summary, isOpen, onToggle, children }) => {
    const bodyId = `${id ?? "steps"}-${phase}-body`;

    return (
        <div className="step-group" data-phase={phase} data-open={isOpen ? "" : undefined}>
            <button type="button" className="step-group-head" aria-expanded={isOpen} aria-controls={bodyId} onClick={onToggle}>
                <span className="step-group-label">
                    <b className="step-group-name">{name}</b>
                    <Icon symbol="icon-chevron" className="chevron" />
                </span>
                <span className="step-group-summary" title={summary?.text}>
                    {summary?.text}
                </span>
                {summary?.isChanged ? (
                    <span className="step-group-changed" title={CHANGED_TITLE}>
                        바꿈
                    </span>
                ) : null}
            </button>
            <Collapse isOpen={isOpen} className="step-group-body" id={bodyId}>
                {children}
            </Collapse>
        </div>
    );
};

// 신규 개발 단계 막대. cells는 [{ phase, state: done|active|hold|next|waiting, detail }]이고 단계마다 4px 막대와 한 줄 라벨이다.
// settings({ phase: 요소 })를 주면 막대 아래에 그 단계의 설정을 단계별 줄로 둔다(시작 전). 줄은 summaries({ phase: { text, isChanged } })의 요약 한 줄로 접혀 있고, 맨 위 줄만 처음부터 펼쳐진다. 실행 중에는 settings 없이 막대만 쓴다.
// extra({ name, after, node })는 여러 단계가 함께 쓰는 값의 줄이고, after 단계의 줄 바로 뒤에 놓인다. 요약은 summaries.shared다.
const StepCard = ({ id, cells, settings = null, summaries = null, extra = null, label = "신규 개발 단계" }) => {
    const [overrides, setOverrides] = useState({});
    const settingCells = settings ? cells.filter((cell) => settings[cell.phase]) : [];
    const firstPhase = settingCells[0]?.phase;
    const isOpen = (key) => overrides[key] ?? key === firstPhase;
    const toggle = (key) => setOverrides((current) => ({ ...current, [key]: !(current[key] ?? key === firstPhase) }));

    return (
        <div id={id} className="steps">
            <ol className="step-card" aria-label={label}>
                {cells.map((cell) => (
                    <li
                        key={cell.phase}
                        className="step"
                        data-phase={cell.phase}
                        data-state={cell.state}
                        aria-current={["active", "hold"].includes(cell.state) ? "step" : undefined}
                        title={`${PHASE_LABELS[cell.phase]}: ${cell.detail}`}
                    >
                        <span className="step-seg" aria-hidden="true"></span>
                        <span className="step-top">
                            <b className="step-label">{PHASE_LABELS[cell.phase]}</b>
                            <span className="step-detail">{cell.detail}</span>
                        </span>
                    </li>
                ))}
            </ol>
            {settingCells.length ? (
                <div className="step-settings" role="group" aria-label="단계 설정">
                    {settingCells.map((cell) => (
                        <Fragment key={cell.phase}>
                            <StepGroup id={id} phase={cell.phase} name={PHASE_LABELS[cell.phase]} summary={summaries?.[cell.phase]} isOpen={isOpen(cell.phase)} onToggle={() => toggle(cell.phase)}>
                                {settings[cell.phase]}
                            </StepGroup>
                            {extra?.after === cell.phase ? (
                                <StepGroup id={id} phase="shared" name={extra.name} summary={summaries?.shared} isOpen={isOpen("shared")} onToggle={() => toggle("shared")}>
                                    {extra.node}
                                </StepGroup>
                            ) : null}
                        </Fragment>
                    ))}
                </div>
            ) : null}
        </div>
    );
};

export { StepCard };

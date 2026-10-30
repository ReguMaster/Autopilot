import { Fragment } from "react";
import { PHASE_LABELS } from "../../lib/constants.js";
import "./StepCard.css";

// 신규 개발 단계 막대. cells는 [{ phase, state: done|active|hold|next|waiting, detail }]이고 단계마다 4px 막대와 한 줄 라벨이다.
// settings({ phase: 요소 })를 주면 막대 아래에 그 단계의 설정을 단계별 묶음으로 한 줄(넘치면 줄바꿈)에 둔다(시작 전). 실행 중에는 settings 없이 막대만 쓴다.
// extra({ name, after, node })는 여러 단계가 함께 쓰는 값의 묶음이고, after 단계의 묶음 바로 뒤에 놓인다.
const StepCard = ({ id, cells, settings = null, extra = null, label = "신규 개발 단계" }) => {
    const settingCells = settings ? cells.filter((cell) => settings[cell.phase]) : [];

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
                            <div className="step-group" data-phase={cell.phase}>
                                <b className="step-group-name">{PHASE_LABELS[cell.phase]}</b>
                                {settings[cell.phase]}
                            </div>
                            {extra?.after === cell.phase ? (
                                <div className="step-group" data-phase="shared">
                                    <b className="step-group-name">{extra.name}</b>
                                    {extra.node}
                                </div>
                            ) : null}
                        </Fragment>
                    ))}
                </div>
            ) : null}
        </div>
    );
};

export { StepCard };

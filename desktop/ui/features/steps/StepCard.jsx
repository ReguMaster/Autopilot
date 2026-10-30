import { Icon } from "../../components/Icon.jsx";
import { PHASE_LABELS } from "../../lib/constants.js";
import { cx } from "../../lib/cx.js";
import "./StepCard.css";

const NODE_SYMBOLS = { done: "icon-check", hold: "icon-pause" };

// 신규 개발 단계 카드. cells는 [{ phase, state: done|active|hold|next|waiting, detail }]이고 위 막대는 마친 단계의 비율이다.
// settings({ phase: 요소 })를 주면 칸 아래에 그 단계의 설정을 펼친다(시작 전). 실행 중에는 settings 없이 한 줄로 쓴다.
const StepCard = ({ id, cells, settings = null, label = "신규 개발 단계" }) => {
    const doneCount = cells.filter((cell) => cell.state === "done").length;

    return (
        <ol id={id} className={cx("step-card", settings && "expanded")} aria-label={label} style={{ "--step-progress": `${(doneCount / cells.length) * 100}%` }}>
            {cells.map((cell, index) => (
                <li key={cell.phase} className="step" data-phase={cell.phase} data-state={cell.state} aria-current={["active", "hold"].includes(cell.state) ? "step" : undefined}>
                    <div className="step-top">
                        <span className="step-node" aria-hidden="true">
                            {NODE_SYMBOLS[cell.state] ? <Icon symbol={NODE_SYMBOLS[cell.state]} /> : index + 1}
                        </span>
                        <span className="step-label">{PHASE_LABELS[cell.phase]}</span>
                    </div>
                    <p className="step-detail" title={cell.detail}>
                        {cell.detail}
                    </p>
                    {settings?.[cell.phase] ? <div className="step-set">{settings[cell.phase]}</div> : null}
                </li>
            ))}
        </ol>
    );
};

export { StepCard };

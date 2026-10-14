import { useMemo } from "react";
import { describePastRun } from "../../viewFormat.js";
import { useClock } from "../stores/clock.js";
import { Tag } from "./Tag.jsx";

const RunItem = ({ run, nowMs, onOpen }) => {
    const description = describePastRun(run, nowMs);

    return (
        <li>
            <button type="button" className="run-item" data-id={run.id} onClick={() => onOpen(run.id)}>
                <span className="run-when">
                    <b>{description.day}</b>
                    <span className="num">{[description.time, description.duration].filter(Boolean).join(" · ")}</span>
                </span>
                <Tag tone={description.status.tone}>{description.status.label}</Tag>
                <small className="run-meta">{description.meta || description.notes[0] || ""}</small>
                <span className="run-headline">{description.headline}</span>
            </button>
        </li>
    );
};

// 지난 실행 목록. "오늘·어제" 같은 날짜 문구가 날이 바뀌면 따라가도록 분 단위로 기준 시각을 갱신한다.
const RunList = ({ runs, onOpen, ...props }) => {
    const minute = useClock((now) => Math.floor(now / 60000));
    const nowMs = useMemo(() => Date.now(), [minute, runs]);

    return (
        <ul {...props}>
            {runs.map((run) => (
                <RunItem key={run.id} run={run} nowMs={nowMs} onOpen={onOpen} />
            ))}
        </ul>
    );
};

export { RunList };

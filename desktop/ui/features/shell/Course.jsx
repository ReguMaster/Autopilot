import { useShallow } from "zustand/react/shallow";
import { formatDuration, getRunPhase, getTrack } from "../../../viewFormat.js";
import { SwapText } from "../../components/SwapText.jsx";
import { useView } from "../../hooks/useView.js";
import { EMPTY_CLOCK, getPhaseText, getStatusText } from "../../lib/runText.js";
import { useClock } from "../../stores/clock.js";
import { useAppStore } from "../../stores/appStore.js";
import { useRunStore } from "../../stores/runStore.js";

const CLOCK_FIELDS = (store) => {
    const { startedAt, endedAt, deadlineAt, status } = store.state;

    return { startedAt: startedAt, endedAt: endedAt, deadlineAt: deadlineAt, status: status };
};

// 실행 중에는 남은 시간(종료 예정 시각을 모르면 경과 시간), 끝난 뒤에는 실행한 시간을 보여준다.
const getClockText = ({ startedAt, endedAt, deadlineAt, status }, now) => {
    if (!startedAt) {
        return "";
    }

    if (status === "idle") {
        return `실행 시간|${endedAt ? formatDuration(endedAt - startedAt) : EMPTY_CLOCK}`;
    }

    return deadlineAt ? `남은 시간|${formatDuration(deadlineAt - now)}` : `경과|${formatDuration(now - startedAt)}`;
};

const Clock = () => {
    const fields = useRunStore(useShallow(CLOCK_FIELDS));
    const text = useClock((now) => getClockText(fields, now));
    const [label, value] = text ? text.split("|") : ["남은 시간", EMPTY_CLOCK];

    return (
        <p id="clock" className="clock" hidden={!text}>
            <b id="clock-value" className="num">
                {value}
            </b>{" "}
            <span id="clock-label">{label}</span>
        </p>
    );
};

// 지금 위치는 매초 조금씩 움직이므로, 0.1% 넘게 바뀔 때만 다시 그린다.
const getTrackKey = (track) => JSON.stringify(track, (name, value) => (typeof value === "number" ? Math.round(value * 10) : value));
const isSameTrack = (a, b) => a === b || (a !== null && b !== null && getTrackKey(a) === getTrackKey(b));

const Track = () => {
    const view = useView();
    const state = useRunStore((store) => store.state);
    const track = useClock((now) => getTrack(state, now), isSameTrack);

    return (
        <div id="track" className="track-row" hidden={!track || view === "ready"}>
            <span id="track-start" className="num">
                {track?.startText}
            </span>
            <div id="track-bar" className="track" role="img" aria-label={track ? `${track.startText}부터 ${track.endText}까지, 회차 ${track.segments.length}개` : undefined}>
                {track?.segments.map((segment, index) => (
                    <i key={`s${index}`} className={segment.isLive ? "seg live" : "seg"} style={{ "--from": String(segment.from), "--to": String(segment.to) }} />
                ))}
                {track?.commits.map((commit, index) => (
                    <i key={`c${index}`} className="commit" title={`커밋 ${commit.count}개`} style={{ "--at": String(commit.at) }} />
                ))}
                {track && track.head !== null ? <i className="head" style={{ "--at": String(track.head) }} /> : null}
            </div>
            <span id="track-end" className="num">
                {track?.endText}
            </span>
        </div>
    );
};

// 상태 문구는 바뀔 때만 새 문구가 맺힌다. 진행 단계 줄은 상태 문구와 겹치면 숨는다.
const Course = () => {
    const hasProject = useAppStore((store) => Boolean(store.settings.projectDir));
    const status = useRunStore(
        useShallow((store) => {
            const { status, round, attached, exitCode, reason, endedAt, phase } = store.state;

            return { status: status, round: round, attached: attached, exitCode: exitCode, reason: reason, endedAt: endedAt, phase: phase };
        })
    );
    const phase = hasProject ? getRunPhase(status) : { label: "프로젝트 미선택", tone: "muted" };
    const phaseText = getPhaseText(status);

    return (
        <section className="course" aria-label="실행 상태">
            <div className="course-top">
                <p className="status-line">
                    <i className="status-dot" aria-hidden="true"></i>
                    <SwapText as="b" id="status-badge" className="state" data-tone={phase.tone} value={getStatusText(status, phase)} />
                    <span id="stat-phase" className="phase" hidden={!phaseText}>
                        {phaseText}
                    </span>
                </p>
                <Clock />
            </div>
            <Track />
        </section>
    );
};

export { Course };

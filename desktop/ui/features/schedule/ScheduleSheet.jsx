import { useMemo } from "react";
import { describeSchedule, describeScheduleLast, describeScheduleStatus } from "../../../viewFormat.js";
import { schedules } from "../../actions/schedules.js";
import { Button } from "../../components/Button.jsx";
import { Icon } from "../../components/Icon.jsx";
import { useClock } from "../../stores/clock.js";
import { useScheduleStore } from "../../stores/scheduleStore.js";
import { useUiStore } from "../../stores/uiStore.js";
import { ScheduleForm } from "./ScheduleForm.jsx";

const SCHEDULE_REFRESH_MS = 20000;

const ScheduleItem = ({ schedule, status, nowMs }) => {
    const description = describeSchedule(schedule);
    const state = describeScheduleStatus(schedule, status, nowMs);
    const last = describeScheduleLast(status?.last, nowMs);

    return (
        <li className="schedule-item" data-id={schedule.id} data-off={schedule.enabled ? undefined : ""}>
            <button type="button" className="schedule-body" title="눌러서 수정" onClick={() => schedules.openForm(schedule)}>
                <b>{description.title}</b>
                <small>{description.detail}</small>
                <small className="schedule-status" data-tone={state.tone}>
                    {state.text}
                </small>
                <small data-tone={last.tone}>{last.text}</small>
            </button>
            <input type="checkbox" className="switch" checked={schedule.enabled} aria-label={`${description.title} 켜기`} onChange={(event) => schedules.toggle(schedule.id, event.target.checked)} />
            <button type="button" className="schedule-delete" aria-label={`${description.title} 삭제`} title="삭제" onClick={() => schedules.remove(schedule.id)}>
                <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M3.5 4.5h9M6.5 4.5V3h3v1.5M5 4.5l.5 8h5l.5-8" />
                </svg>
            </button>
        </li>
    );
};

// 예약 시트: 정해진 시각이나 한도 리셋에 맞춰 자동으로 시작하는 조건을 목록으로 보고 만든다. 남은 시간 문구가 분 단위로 바뀌므로 열려 있는 동안만 가끔 다시 그린다.
const ScheduleSheet = () => {
    const open = useUiStore((store) => store.schedule);
    const { payload, pane, editing, note } = useScheduleStore();
    const { schedules: list, statuses, maxSchedules } = payload;
    const isForm = pane === "form";
    const slot = useClock((now) => (open && !isForm ? Math.floor(now / SCHEDULE_REFRESH_MS) : 0));
    const nowMs = useMemo(() => Date.now(), [slot, list, statuses]);

    return (
        <section id="schedule" className="schedule" aria-label="예약" inert={!open}>
            <div className="archive-head">
                <h2 id="schedule-title">{isForm ? (editing ? "예약 수정" : "예약 추가") : "예약"}</h2>
                <span id="schedule-count" className="num">
                    {list.length ? `${list.length}개` : ""}
                </span>
                <Button id="schedule-add" hidden={isForm} disabled={list.length >= maxSchedules} onClick={() => schedules.openForm(null)}>
                    <Icon symbol="icon-plus" />
                    추가
                </Button>
                <Button id="schedule-close" onClick={schedules.close}>
                    닫기
                </Button>
            </div>
            <p id="schedule-note" className="archive-note" hidden={!note.message} data-tone={note.tone || undefined}>
                {note.message}
            </p>

            <div id="schedule-list-pane" className="archive-pane schedule-pane" hidden={isForm}>
                <p className="schedule-plan">예약은 저장하는 순간의 작업·정책·모델·Effort로 실행해요. 앱이 켜져 있거나 트레이에 있어야 시작할 수 있어요.</p>
                <ul id="schedule-list" className="schedule-list">
                    {list.map((schedule) => (
                        <ScheduleItem key={schedule.id} schedule={schedule} status={statuses.find((entry) => entry.id === schedule.id)} nowMs={nowMs} />
                    ))}
                </ul>
                <p id="schedule-empty" className="schedule-empty" hidden={list.length > 0}>
                    아직 예약이 없어요. 정해진 시각이나 사용량 한도가 리셋되는 때에 맞춰 자동으로 시작하게 해 두면, 자는 동안에도 한도를 알뜰하게 쓸 수 있어요.
                </p>
            </div>

            {isForm ? <ScheduleForm editing={editing} defaults={payload.defaults} /> : <form id="schedule-form" className="archive-pane schedule-pane schedule-form" noValidate hidden></form>}
        </section>
    );
};

export { ScheduleSheet };

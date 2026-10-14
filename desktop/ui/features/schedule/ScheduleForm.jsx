import { useState } from "react";
import { schedules } from "../../actions/schedules.js";
import { Button } from "../../components/Button.jsx";

const WEEKDAYS = [
    { value: 1, label: "월" },
    { value: 2, label: "화" },
    { value: 3, label: "수" },
    { value: 4, label: "목" },
    { value: 5, label: "금" },
    { value: 6, label: "토" },
    { value: 0, label: "일" }
];
const KIND_OPTIONS = [
    { value: "time", label: "정해진 시각에" },
    { value: "reset", label: "사용량 한도가 리셋되면" }
];
const WINDOW_OPTIONS = [
    { value: "session", label: "5시간 한도" },
    { value: "weekly", label: "주간 한도" }
];
const MIN_OPTIONS = [
    { value: 0, label: "제한 없음" },
    { value: 30, label: "30% 이상" },
    { value: 50, label: "50% 이상" },
    { value: 70, label: "70% 이상" }
];
const DURATION_OPTIONS = [
    { value: 60, label: "1시간" },
    { value: 120, label: "2시간" },
    { value: 240, label: "4시간" },
    { value: 300, label: "5시간" },
    { value: 360, label: "6시간" },
    { value: 480, label: "8시간" },
    { value: 720, label: "12시간" }
];

// 라디오로 하나를 고르는 묶음
const Seg = ({ name, label, options, value, onChange }) => {
    return (
        <div className="seg" role="radiogroup" aria-label={label}>
            {options.map((option) => (
                <label key={option.value} className="seg-option">
                    <input type="radio" name={name} value={option.value} checked={String(value) === String(option.value)} onChange={() => onChange(option.value)} />
                    <span>{option.label}</span>
                </label>
            ))}
        </div>
    );
};

// 수정 중인 예약(또는 새 예약의 기본값)으로 폼 값을 채운다.
const getInitialValues = (schedule, defaults) => {
    return {
        kind: schedule.kind,
        window: schedule.window,
        minRemaining: schedule.minRemaining,
        duration: schedule.duration,
        time: schedule.time || defaults.time.time,
        isAnytime: !schedule.from,
        from: schedule.from || defaults.reset.from,
        to: schedule.to || defaults.reset.to,
        days: schedule.days
    };
};

// 폼은 열 때마다 새로 만들어져 값이 처음부터 채워진다.
const ScheduleForm = ({ editing, defaults }) => {
    const [values, setValues] = useState(() => getInitialValues(editing || defaults.time, defaults));
    const [error, setError] = useState("");
    const isReset = values.kind === "reset";

    const update = (patch) => setValues((current) => ({ ...current, ...patch }));

    // 시작 조건을 바꾸면 그 조건에 어울리는 기본값(실행 시간·남은 한도·시간대)으로 맞춘다. 수정 중이면 건드리지 않는다.
    const changeKind = (kind) => {
        if (editing) {
            update({ kind: kind });

            return;
        }

        const preset = defaults[kind];

        update({ kind: kind, minRemaining: preset.minRemaining, duration: preset.duration, isAnytime: !preset.from });
    };

    const toggleDay = (day, isOn) => {
        update({ days: isOn ? [...values.days, day] : values.days.filter((item) => item !== day) });
    };

    const submit = async (event) => {
        event.preventDefault();

        const isRanged = isReset && !values.isAnytime;
        const message = await schedules.save({
            id: editing?.id || "",
            enabled: editing ? editing.enabled : true,
            kind: values.kind,
            time: values.time,
            window: values.window,
            from: isRanged ? values.from : "",
            to: isRanged ? values.to : "",
            days: WEEKDAYS.map((day) => day.value).filter((day) => values.days.includes(day)),
            minRemaining: Number(values.minRemaining),
            duration: Number(values.duration)
        });

        setError(message);
    };

    return (
        <form id="schedule-form" className="archive-pane schedule-pane schedule-form" noValidate onSubmit={submit}>
            <div className="form-group">
                <span className="form-label">언제 시작할까요?</span>
                <Seg name="schedule-kind" label="시작 조건" options={KIND_OPTIONS} value={values.kind} onChange={changeKind} />
            </div>

            <div className="form-group" data-for="time" hidden={isReset}>
                <label className="form-label" htmlFor="schedule-time">
                    시작 시각
                </label>
                <input id="schedule-time" className="account-input schedule-time num" type="time" value={values.time} onChange={(event) => update({ time: event.target.value })} />
            </div>

            <div className="form-group" data-for="reset" hidden={!isReset}>
                <span className="form-label">기준이 되는 한도</span>
                <Seg name="schedule-window" label="기준이 되는 한도" options={WINDOW_OPTIONS} value={values.window} onChange={(window) => update({ window: window })} />
                <p className="form-hint">한도가 리셋되면 한 번 시작하고, 다음 리셋까지 기다려요. 이미 새 한도로 읽히면 바로 시작할 수 있어요.</p>
            </div>

            <div className="form-group" data-for="reset" hidden={!isReset}>
                <span className="form-label">시작할 수 있는 시간대</span>
                <label className="check">
                    <input type="checkbox" id="schedule-anytime" checked={values.isAnytime} onChange={(event) => update({ isAnytime: event.target.checked })} />
                    하루 종일
                </label>
                <div id="schedule-range" className="schedule-range" hidden={values.isAnytime}>
                    <input
                        id="schedule-from"
                        className="account-input schedule-time num"
                        type="time"
                        aria-label="시간대 시작"
                        value={values.from}
                        onChange={(event) => update({ from: event.target.value })}
                    />
                    <span aria-hidden="true">부터</span>
                    <input id="schedule-to" className="account-input schedule-time num" type="time" aria-label="시간대 끝" value={values.to} onChange={(event) => update({ to: event.target.value })} />
                    <span aria-hidden="true">까지</span>
                </div>
                <p className="form-hint">내가 직접 작업하는 낮 시간에 시작되지 않게 막아 줘요. 시간대가 끝나기 전에 실행도 마쳐요.</p>
            </div>

            <div className="form-group">
                <span className="form-label">요일</span>
                <div id="schedule-days" className="seg" role="group" aria-label="요일">
                    {WEEKDAYS.map((day) => (
                        <label key={day.value} className="seg-option">
                            <input type="checkbox" value={day.value} checked={values.days.includes(day.value)} onChange={(event) => toggleDay(day.value, event.target.checked)} />
                            <span>{day.label}</span>
                        </label>
                    ))}
                </div>
            </div>

            <div className="form-group">
                <span className="form-label">남은 한도가 이만큼 있을 때만</span>
                <Seg name="schedule-min" label="남은 한도 조건" options={MIN_OPTIONS} value={values.minRemaining} onChange={(minRemaining) => update({ minRemaining: minRemaining })} />
                <p className="form-hint">5시간·주간 한도 중 더 적게 남은 쪽을 봐요. 부족하면 조건이 맞을 때까지 기다려요.</p>
            </div>

            <div className="form-group">
                <span className="form-label">얼마나 실행할까요?</span>
                <Seg name="schedule-duration" label="실행 시간" options={DURATION_OPTIONS} value={values.duration} onChange={(duration) => update({ duration: duration })} />
            </div>

            <p id="schedule-form-error" className="archive-note" data-tone="warn" role="alert" hidden={!error}>
                {error}
            </p>
            <div className="form-actions">
                <Button type="submit" variant="primary">
                    저장
                </Button>
                <Button id="schedule-form-cancel" onClick={schedules.closeForm}>
                    취소
                </Button>
            </div>
        </form>
    );
};

export { ScheduleForm };

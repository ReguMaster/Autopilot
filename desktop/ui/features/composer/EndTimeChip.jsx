import { useEffect, useRef, useState } from "react";
import { DAY_MS, MAX_RUN_DAYS, WEEKDAY_NAMES, buildEndTime, describeEndTime, formatEndTimeLabel, formatTimeUntil, getEndTimeParts, getEndTimeShortcuts, getStartOfDay } from "../../../viewFormat.js";
import { Chip } from "../../components/Chip.jsx";
import { Icon } from "../../components/Icon.jsx";
import { Popover } from "../../components/Popover.jsx";
import { composer, useComposerStore } from "../../stores/composerStore.js";
import { useClock } from "../../stores/clock.js";
import { useRunStore } from "../../stores/runStore.js";

const TIME_PATTERN = /^([01]?\d|2[0-3]):?([0-5]\d)$/;
const STEP_MINUTES = 10;
const DAY_OFFSETS = Array.from({ length: MAX_RUN_DAYS + 1 }, (_, index) => index);

// 분 단위 시계. 팝오버의 날짜 띠·합계는 분이 바뀔 때만 다시 그린다.
const getMinute = (now) => now - (now % 60000);

// 시각 칸: 직접 적거나(Enter·포커스를 떠날 때 반영) ↑↓로 10분(Shift는 1시간)씩 옮긴다. 고른 날은 그대로 둔다.
const TimeBox = ({ dayOffset, time }) => {
    const [draft, setDraft] = useState(time);

    useEffect(() => setDraft(time), [time]);

    const commit = () => {
        const match = TIME_PATTERN.exec(draft.trim());

        if (!match) {
            setDraft(time);

            return;
        }

        composer.setEndTime(buildEndTime(dayOffset, `${match[1].padStart(2, "0")}:${match[2]}`, Date.now()));
    };

    const step = (minutes) => composer.stepEndTime(minutes, 1);

    return (
        <div className="time-box">
            <input
                id="end-time-input"
                className="num"
                inputMode="numeric"
                spellCheck={false}
                aria-label="끝낼 시각"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={commit}
                onKeyDown={(event) => {
                    if (event.key === "Enter") {
                        event.preventDefault();
                        commit();
                    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                        event.preventDefault();
                        step((event.key === "ArrowUp" ? 1 : -1) * (event.shiftKey ? 60 : STEP_MINUTES));
                    }
                }}
            />
            <span className="time-box-steps">
                <button type="button" className="spin-button" aria-label="10분 늦게" onClick={() => step(STEP_MINUTES)}>
                    <Icon symbol="icon-chevron" className="chevron up" />
                </button>
                <button type="button" className="spin-button" aria-label="10분 이르게" onClick={() => step(-STEP_MINUTES)}>
                    <Icon symbol="icon-chevron" className="chevron" />
                </button>
            </span>
        </div>
    );
};

// 언제까지 할지: 바로가기, 오늘부터 7일 뒤까지의 날짜 띠, 끝낼 시각, 남은 시간 합계. 값은 24시간 안이면 HH:mm, 그보다 뒤면 날짜를 붙여 컴포저가 갖는다.
const EndTimePicker = () => {
    const endTime = useComposerStore((store) => store.endTime);
    const nowMs = useClock(getMinute);
    const { dayOffset, time } = getEndTimeParts(endTime, nowMs);
    const total = describeEndTime(endTime, nowMs);
    const shortcuts = getEndTimeShortcuts(nowMs);

    return (
        <>
            <div className="time-quick">
                {shortcuts.map((shortcut) => (
                    <button
                        key={shortcut.key}
                        type="button"
                        data-shortcut={shortcut.key}
                        aria-pressed={shortcut.value === endTime}
                        onClick={() => composer.setEndTime(getEndTimeShortcuts(Date.now()).find((fresh) => fresh.key === shortcut.key).value)}
                    >
                        {shortcut.label}
                    </button>
                ))}
            </div>
            <div className="time-days" role="group" aria-label="끝낼 날">
                {DAY_OFFSETS.map((offset) => {
                    const date = new Date(getStartOfDay(nowMs) + offset * DAY_MS + DAY_MS / 2);
                    // 오늘인데 그 시각이 이미 지났으면 고를 수 없다(다음 날이 된다).
                    const isUnreachable = getEndTimeParts(buildEndTime(offset, time, nowMs), nowMs).dayOffset !== offset;

                    return (
                        <button
                            key={offset}
                            type="button"
                            data-offset={offset}
                            data-weekend={[0, 6].includes(date.getDay()) ? "" : undefined}
                            data-span={offset < dayOffset ? "" : undefined}
                            aria-pressed={offset === dayOffset}
                            aria-label={`${date.getMonth() + 1}월 ${date.getDate()}일 ${WEEKDAY_NAMES[date.getDay()]}요일`}
                            disabled={isUnreachable}
                            onClick={() => composer.setEndTime(buildEndTime(offset, time, Date.now()))}
                        >
                            <small>{offset ? WEEKDAY_NAMES[date.getDay()] : "오늘"}</small>
                            <b className="num">{date.getDate()}</b>
                        </button>
                    );
                })}
            </div>
            <div className="time-row">
                <span className="time-row-label">끝낼 시각</span>
                <TimeBox dayOffset={dayOffset} time={time} />
                <p id="time-until" className="time-total">
                    <b className="num">{total.span}</b>
                    <span>{total.until}</span>
                </p>
            </div>
            <p className="time-foot">
                <Icon symbol="icon-clock" />
                {`${MAX_RUN_DAYS}일 뒤까지 정할 수 있어요. 한도로 기다린 시간은 사용량 한도 설정대로 따로 늘어나요`}
            </p>
        </>
    );
};

// 종료 시각 알약: 오늘·내일은 말로, 그 밖에는 날짜와 요일로 보이고 남은 시간을 붙인다. 실행 중에는 상태 줄이 보여주므로 숨긴다.
const EndTimeChip = () => {
    const endTime = useComposerStore((store) => store.endTime);
    const isIdle = useRunStore((store) => store.state.status === "idle");
    const label = useClock((now) => formatEndTimeLabel(endTime, now));
    const until = useClock((now) => formatTimeUntil(endTime, now));
    const [isOpen, setIsOpen] = useState(false);
    const popoverRef = useRef(null);

    useEffect(() => {
        if (!isIdle) {
            popoverRef.current?.hidePopover();
        }
    }, [isIdle]);

    return (
        <>
            <Chip id="end-time-button" className="end-time-chip" popoverTarget="end-time-popover" aria-label="종료 시각 고르기" aria-expanded={isOpen} disabled={!isIdle}>
                <Icon symbol="icon-clock" className="chip-icon" />
                <b id="end-time-value" className="num">
                    {label}
                </b>
                <small id="end-time-until" className="end-time-until num">
                    {until}
                </small>
                <Icon symbol="icon-chevron" className="chevron" />
            </Chip>
            <Popover id="end-time-popover" className="popover time-popover" aria-label="종료 시각" popoverRef={popoverRef} onToggle={setIsOpen}>
                <p className="time-popover-title">언제까지 할까요?</p>
                <EndTimePicker />
            </Popover>
        </>
    );
};

export { EndTimeChip };

import { useEffect, useRef, useState } from "react";
import { DEFAULT_END_TIME, formatTimeUntil } from "../../../viewFormat.js";
import { Button } from "../../components/Button.jsx";
import { Chip } from "../../components/Chip.jsx";
import { Icon } from "../../components/Icon.jsx";
import { Popover } from "../../components/Popover.jsx";
import { TickText } from "../../components/TickText.jsx";
import { composer, useComposerStore } from "../../stores/composerStore.js";
import { useClock } from "../../stores/clock.js";
import { useRunStore } from "../../stores/runStore.js";

const PRESETS = [
    { minutes: 60, label: "1시간 뒤" },
    { minutes: 180, label: "3시간 뒤" },
    { minutes: 360, label: "6시간 뒤" }
];

const Arrow = ({ points }) => {
    return (
        <svg viewBox="0 0 12 12" aria-hidden="true">
            <path d={points} />
        </svg>
    );
};

// 시·분 한 자리. 위·아래 버튼이나 마우스 휠로 단위만큼 옮긴다.
const TimeSpin = ({ unit, id, value, direction, upLabel, downLabel, onStep }) => {
    const ref = useRef(null);

    // 휠은 화면이 스크롤되지 않도록 preventDefault가 필요해 passive가 아닌 리스너로 건다.
    useEffect(() => {
        const element = ref.current;
        const handleWheel = (event) => {
            event.preventDefault();
            onStep(unit, event.deltaY < 0 ? 1 : -1);
        };

        element.addEventListener("wheel", handleWheel, { passive: false });

        return () => element.removeEventListener("wheel", handleWheel);
    }, [unit, onStep]);

    return (
        <div ref={ref} className="time-spin" data-unit={unit}>
            <button type="button" className="spin-button" data-step="1" aria-label={upLabel} onClick={() => onStep(unit, 1)}>
                <Arrow points="M3 7.5 6 4.5l3 3" />
            </button>
            <TickText as="b" id={id} className="num" value={value} direction={direction} />
            <button type="button" className="spin-button" data-step="-1" aria-label={downLabel} onClick={() => onStep(unit, -1)}>
                <Arrow points="M3 4.5 6 7.5l3-3" />
            </button>
        </div>
    );
};

// 종료 시각: 비우면 엔진 기본값(07:00)이고, 지난 시각이면 다음 날이다. 바뀐 자리의 숫자만 바뀐 방향에서 미끄러져 들어온다.
const EndTimeChip = () => {
    const endTime = useComposerStore((store) => store.endTime);
    const isIdle = useRunStore((store) => store.state.status === "idle");
    const until = useClock((now) => formatTimeUntil(endTime, now));
    const [isOpen, setIsOpen] = useState(false);
    const [direction, setDirection] = useState("up");
    const popoverRef = useRef(null);
    const [hour, minute] = (endTime || DEFAULT_END_TIME).split(":");

    useEffect(() => {
        if (!isIdle) {
            popoverRef.current?.hidePopover();
        }
    }, [isIdle]);

    const step = (unit, direction) => {
        setDirection(direction > 0 ? "up" : "down");
        composer.stepEndTime(unit, direction);
    };

    const setAfter = (minutes) => {
        setDirection("up");
        composer.setEndTimeAfter(minutes);
    };

    return (
        <>
            <Chip id="end-time-button" className="end-time-chip" popoverTarget="end-time-popover" aria-label="종료 시각 고르기" aria-expanded={isOpen} disabled={!isIdle}>
                <b id="end-time-value" className="num">
                    {endTime || DEFAULT_END_TIME}
                </b>
                <small id="end-time-until" className="end-time-until num">
                    {until}
                </small>
                <Icon symbol="icon-chevron" className="chevron" />
            </Chip>
            <Popover id="end-time-popover" className="popover time-popover" aria-label="종료 시각" popoverRef={popoverRef} onToggle={setIsOpen}>
                <p className="time-popover-title">언제 끝낼까요?</p>
                <div className="time-spinners">
                    <TimeSpin unit={60} id="time-hour" value={hour} direction={direction} upLabel="1시간 늦게" downLabel="1시간 이르게" onStep={step} />
                    <span className="time-colon">:</span>
                    <TimeSpin unit={10} id="time-minute" value={minute} direction={direction} upLabel="10분 늦게" downLabel="10분 이르게" onStep={step} />
                </div>
                <p id="time-until" className="time-until num">{`지금부터 ${until}에 끝나요`}</p>
                <div className="time-presets">
                    {PRESETS.map((preset) => (
                        <Button key={preset.minutes} data-after={preset.minutes} onClick={() => setAfter(preset.minutes)}>
                            {preset.label}
                        </Button>
                    ))}
                    <Button
                        data-reset=""
                        onClick={() => {
                            setDirection("up");
                            composer.setEndTime("");
                        }}
                    >
                        {`기본 ${DEFAULT_END_TIME}`}
                    </Button>
                </div>
            </Popover>
        </>
    );
};

export { EndTimeChip };

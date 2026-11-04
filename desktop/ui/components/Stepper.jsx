import "./Stepper.css";

// 횟수처럼 작은 정수를 알약 안에서 줄이고 늘려 정하는 조절기(문장 속에 끼는 모양). 목록에서 비슷한 숫자를 찾지 않아도 된다.
// 키보드는 spinbutton을 따른다(↑→ 늘림·↓← 줄임·Home·End). 범위를 벗어난 값은 막는다.
const Stepper = ({ value, min = 0, max, onChange, ariaLabel, disabled = false }) => {
    const change = (next) => {
        const clamped = Math.min(max, Math.max(min, next));

        if (!disabled && clamped !== value) {
            onChange(clamped);
        }
    };

    const handleKeyDown = (event) => {
        const next = { ArrowUp: value + 1, ArrowRight: value + 1, ArrowDown: value - 1, ArrowLeft: value - 1, Home: min, End: max }[event.key];

        if (next !== undefined) {
            event.preventDefault();
            change(next);
        }
    };

    return (
        <span
            className="stepper"
            role="spinbutton"
            tabIndex={disabled ? -1 : 0}
            aria-label={ariaLabel}
            aria-disabled={disabled || undefined}
            aria-valuenow={value}
            aria-valuemin={min}
            aria-valuemax={max}
            onKeyDown={handleKeyDown}
        >
            <button type="button" tabIndex={-1} aria-label="줄이기" disabled={disabled || value <= min} onClick={() => change(value - 1)}>
                −
            </button>
            <output>{value}</output>
            <button type="button" tabIndex={-1} aria-label="늘리기" disabled={disabled || value >= max} onClick={() => change(value + 1)}>
                +
            </button>
        </span>
    );
};

export { Stepper };

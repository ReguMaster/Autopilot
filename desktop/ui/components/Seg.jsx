import { cx } from "../lib/cx.js";
import { Icon } from "./Icon.jsx";

// 라디오로 하나를 고르는 알약 묶음. options는 [{ value, label, icon, disabled }]이다(styles/schedule.css의 .seg, 이어 붙은 모양은 .mode-seg).
// slide를 켜면 고른 칸 뒤로 알약(.seg-thumb)이 미끄러져 옮겨 간다. 칸 너비가 같아야 하므로 .mode-seg.seg-slide가 칸을 같은 너비로 깐다.
const Seg = ({ name, label, options, value, onChange, className = "", slide = false }) => {
    const selectedIndex = options.findIndex((option) => String(option.value) === String(value));

    return (
        <div
            className={cx("seg", slide && "seg-slide", className)}
            role="radiogroup"
            aria-label={label}
            style={slide ? { "--seg-index": Math.max(selectedIndex, 0), "--seg-count": options.length } : undefined}
        >
            {slide ? <i className="seg-thumb" aria-hidden="true"></i> : null}
            {options.map((option) => (
                <label key={option.value} className="seg-option">
                    <input type="radio" name={name} value={option.value} checked={String(value) === String(option.value)} disabled={option.disabled} onChange={() => onChange(option.value)} />
                    <span>
                        {option.icon ? <Icon symbol={option.icon} /> : null}
                        {option.label}
                    </span>
                </label>
            ))}
        </div>
    );
};

export { Seg };

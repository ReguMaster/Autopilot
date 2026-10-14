import { cx } from "../lib/cx.js";

// 컴포저 알약. 팝오버를 여는 버튼이고, 잠기면 자물쇠가 화살표 자리에 맺힌다(styles.css의 .chip).
const Chip = ({ className = "", chipRef, children, ...props }) => {
    return (
        <button type="button" ref={chipRef} className={cx("chip", className)} {...props}>
            {children}
        </button>
    );
};

export { Chip };

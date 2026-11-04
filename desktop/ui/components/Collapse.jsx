import { useEffect, useState } from "react";
import { cx } from "../lib/cx.js";

// 접고 펴는 칸. 높이가 0fr↔1fr로 미끄러지고(styles/motion.css의 .collapse) 접힌 칸은 inert라 포커스와 읽기에서 빠진다.
// 안쪽은 펴져 있거나 접히는 전환이 끝나기 전까지만 그린다(전환이 없는 환경에서는 접은 뒤에도 그려 두지만 보이지 않는다).
// isKept면 접어도 안쪽을 계속 그려 안의 입력·상태를 지킨다.
const Collapse = ({ isOpen, isKept = false, className = "", children, ...props }) => {
    const [isSettled, setIsSettled] = useState(!isOpen);

    useEffect(() => {
        if (isOpen) {
            setIsSettled(false);
        }
    }, [isOpen]);

    const handleTransitionEnd = (event) => {
        if (!isOpen && event.target === event.currentTarget && event.propertyName === "grid-template-rows") {
            setIsSettled(true);
        }
    };

    return (
        <div className={cx("collapse", className)} data-open={isOpen ? "" : undefined} inert={!isOpen} onTransitionEnd={handleTransitionEnd} {...props}>
            <div>{isOpen || isKept || !isSettled ? children : null}</div>
        </div>
    );
};

export { Collapse };

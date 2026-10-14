import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

const CHOICE_CLOSE_DELAY_MS = 320;

// native popover(auto): 바깥을 누르거나 Esc로 닫히고, anchor 위치는 CSS가 정한다. body에 직접 붙여 컴포저의 글꼴·색 상속을 받지 않게 한다.
// 열리고 닫힐 때 onToggle(isOpen)으로 그 팝오버를 여는 알약에 알린다. popoverRef로 hidePopover를 부를 수 있다.
const Popover = ({ popoverRef, onToggle, children, ...props }) => {
    const innerRef = useRef(null);
    const ref = popoverRef || innerRef;

    useEffect(() => {
        const element = ref.current;
        const handleToggle = (event) => onToggle?.(event.newState === "open");

        element.addEventListener("toggle", handleToggle);

        return () => element.removeEventListener("toggle", handleToggle);
    }, [ref, onToggle]);

    return createPortal(
        <div ref={ref} popover="" {...props}>
            {children}
        </div>,
        document.body
    );
};

// 목록의 선택 표시가 미끄러지는 것을 보여준 뒤 팝오버를 닫는다.
const closePopoverSoon = (popoverRef) => {
    setTimeout(() => popoverRef.current?.hidePopover(), CHOICE_CLOSE_DELAY_MS);
};

export { Popover, closePopoverSoon };

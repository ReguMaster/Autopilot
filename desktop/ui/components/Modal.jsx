import { useEffect, useId, useRef } from "react";
import { Icon } from "./Icon.jsx";
import "./Modal.css";

// 네이티브 <dialog>를 showModal()로 연다. 포커스 가두기·뒤쪽 비활성·Esc·닫힌 뒤 포커스 복원은 브라우저가 하고, 닫는 전환이 보이도록 항상 그려 두고 open으로만 연다.
// Esc·X·바깥 클릭은 onClose로 알린다. data-autofocus가 붙은 요소가 있으면 열릴 때 거기에 포커스를 둔다.
const Modal = ({ open, title, onClose, footer = null, role = "dialog", children }) => {
    const id = useId();
    const dialogRef = useRef(null);
    const isClosingRef = useRef(false);
    const isBackdropPressRef = useRef(false);

    useEffect(() => {
        const dialog = dialogRef.current;

        if (open && !dialog.open) {
            dialog.showModal();
            dialog.querySelector("[data-autofocus]")?.focus();
        } else if (!open && dialog.open) {
            isClosingRef.current = true;
            dialog.close();
        }
    }, [open]);

    // 코드가 닫은 close 이벤트는 건너뛴다. 그 사이에 새 모달이 열렸을 때 지난 이벤트가 새 모달을 닫지 않게 한다.
    const handleClose = () => {
        if (isClosingRef.current) {
            isClosingRef.current = false;

            return;
        }

        onClose();
    };

    // 바깥(::backdrop)은 dialog 자신이 대상이다. 누르기와 떼기가 모두 바깥일 때만 닫아, 버튼을 누른 채 바깥으로 끌어낸 경우를 거른다.
    const handleMouseDown = (event) => {
        isBackdropPressRef.current = event.target === event.currentTarget;
    };

    const handleClick = (event) => {
        if (isBackdropPressRef.current && event.target === event.currentTarget) {
            onClose();
        }
    };

    return (
        <dialog ref={dialogRef} className="modal" role={role} aria-labelledby={`${id}-title`} aria-describedby={`${id}-body`} onClose={handleClose} onMouseDown={handleMouseDown} onClick={handleClick}>
            <header className="modal-head">
                <h2 id={`${id}-title`} className="modal-title">
                    {title}
                </h2>
                <button type="button" className="modal-close" aria-label="닫기" onClick={onClose}>
                    <Icon symbol="icon-x" />
                </button>
            </header>
            <div id={`${id}-body`} className="modal-body">
                {children}
            </div>
            {footer && <footer className="modal-foot">{footer}</footer>}
        </dialog>
    );
};

export { Modal };
